/**
 * 종합 진단 — `npm run diagnose [--quick] [--symbols AAPL,NVDA]`
 *
 * 사용자가 물은 네 가지에 **숫자로** 답하기 위한 도구다 (2026-09-25).
 *   1) 관심 종목이 스윙에서 전부 부적합인 이유
 *   2) 목표 수익률(3·5·10·15%)을 바꾸면 결과가 달라지는가
 *   3) 급등 탐지의 주기성 예측이 실제로 맞는가
 *   4) Gemini 분석이 정확한가
 *
 * ⚠️ **판정 엔진을 복사하지 않는다.** `evaluateSwing`·`findSurgeEvents`·`analyzePeriodicity`·
 * `scoredAnalyses` 를 그대로 부른다. 복사하면 진단과 실제 화면이 다른 말을 하게 된다.
 * ⚠️ **미래 데이터 금지.** 과거 날짜 D 의 판정에는 **D 까지의 봉만** 넣는다.
 * ⚠️ **표본을 오염시키지 않는다.** `swing_recommendations`·`gemini_analysis` 에 새 행을 쓰지
 * 않는다. 급등 채점(기존 행의 결과 칸 채우기)만 예외다 — 그건 원래 돌아야 하는 기능이다.
 * ⚠️ **Gemini 를 새로 부르지 않는다** (비용·한도). 기존 기록만 읽는다.
 * ⚠️ HTTP API 를 거치지 않고 DB·함수를 직접 부른다 — 그래서 **로그인과 무관하게** 서버 안에서 돈다.
 */

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import type { Candle } from '../src/types/toss';
import { getDb, loadCandles } from '../server/db';
import { getCandles } from '../server/candleService';
import { evaluateSwing } from '../server/swingAnalyzer';
import { getActiveSwingParams } from '../server/strategyProfile';
import {
  analyzePeriodicity,
  findSurgeEvents,
  getHistory,
  thresholdFor,
} from '../server/surgeDetector';
import { getSettings, listDetections } from '../server/surgeStore';
import { refreshOutcomes } from '../server/surgeScanner';
import { scoredAnalyses } from '../server/gemini/accuracy';

const DAY_MS = 86_400_000;

// ── 인자 ─────────────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
const has = (flag: string) => argv.includes(flag);
function optionOf(name: string): string | null {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
}

/** 오라클(ARM 무료)에서 오래 걸릴 수 있어 종목 5개·기간 절반으로 줄이는 모드 */
const QUICK = has('--quick');
const REPLAY_DAYS = QUICK ? 60 : 120;
const FREQ_DAYS = QUICK ? 125 : 250;

// ── 유틸 ─────────────────────────────────────────────────────────────────────

const pct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
const round2 = (v: number) => Math.round(v * 100) / 100;
const dateOf = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** 표본이 적으면 숫자를 믿을 수 없다 — 리포트가 그 사실을 먼저 말하게 한다 */
const MIN_SAMPLE = 30;
const weak = (n: number) => (n < MIN_SAMPLE ? ` ⚠️표본 ${n}` : '');

function table(headers: string[], rows: (string | number)[][]): string {
  const head = `| ${headers.join(' | ')} |`;
  const sep = `|${headers.map(() => '---').join('|')}|`;
  const body = rows.map((r) => `| ${r.join(' | ')} |`).join('\n');
  return [head, sep, body].join('\n');
}

/** 캔들 확보 — 실시간이 막히면 SQLite 캐시로 내려간다 (엔진과 같은 방침) */
async function candlesOf(symbol: string, limit = 400): Promise<Candle[]> {
  return getCandles(symbol, '1d', limit).catch(() => loadCandles(symbol, '1d', limit));
}

// ── 대상 종목 ────────────────────────────────────────────────────────────────

/** 이 서버의 관심 목록 (user_data). `--symbols` 로 덮어쓸 수 있다. */
function targetSymbols(): { symbols: string[]; source: string } {
  const override = optionOf('--symbols');
  if (override) {
    return { symbols: override.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean), source: '--symbols 인자' };
  }
  try {
    const row = getDb()
      .prepare(`SELECT value FROM user_data WHERE key = 'watchlist.folders'`)
      .get() as { value: string } | undefined;
    const folders = row ? (JSON.parse(row.value) as { symbols: string[] }[]) : [];
    const symbols = folders.flatMap((f) => f.symbols ?? []);
    if (symbols.length) return { symbols, source: '서버의 관심 목록 (user_data)' };
  } catch {
    /* 아래 기본값으로 내려간다 */
  }
  return { symbols: ['AAPL', 'NVDA', 'MSFT'], source: '기본값 (관심 목록이 비어 있음)' };
}

// ── 3-1. 스윙: 왜 부적합인가 ─────────────────────────────────────────────────

interface SwingToday {
  symbol: string;
  grade: string;
  score: number;
  conditions: Record<string, { score: number; max: number; checks: string[] }>;
  numbers: Record<string, string>;
  rejection: string | null;
  missing: string[];
  error?: string;
}

async function swingToday(symbols: string[]): Promise<SwingToday[]> {
  const profile = getActiveSwingParams();
  const out: SwingToday[] = [];

  for (const symbol of symbols) {
    try {
      const r = await evaluateSwing(symbol, profile);
      const c = r.conditions;
      const cond = (x: { score: number; max: number; checks: { label: string; passed: boolean }[] }) => ({
        score: x.score,
        max: x.max,
        checks: x.checks.map((k) => `${k.passed ? '✅' : '❌'} ${k.label}`),
      });

      /*
        "BUY 까지 무엇이 모자란가" 를 가격·지표 조건으로 적는다.
        점수만 보여 주면 "그래서 뭘 기다려야 하나" 에 답이 안 된다.
      */
      const missing: string[] = [];
      const p = profile.params;
      const price = r.currentPrice;
      const rsi = r.indicators.rsi14 ?? null;
      const ma20 = r.indicators.sma20 ?? null;
      const ma60 = r.indicators.sma60 ?? null;
      const atr = r.indicators.atr14 ?? null;
      const gap20 = ma20 ? ((price - ma20) / ma20) * 100 : null;
      const gap60 = ma60 ? ((price - ma60) / ma60) * 100 : null;

      if (rsi !== null && rsi > p.rsiBand.high) {
        missing.push(`RSI ${rsi.toFixed(1)} → ${p.rsiBand.high} 이하로 내려오면 타이밍 점수`);
      }
      if (c.riskReward.ratio < p.rrDemoteBelow) {
        missing.push(`손익비 ${c.riskReward.ratio.toFixed(2)} → ${p.rrDemoteBelow} 이상이어야 강등을 면함`);
      }
      if (gap60 !== null && gap60 < 0) {
        missing.push(`60일선 아래 ${pct(gap60)} → 위로 올라와야 추세 점수(최대 30)`);
      }
      const need = p.grades.buy - r.score;
      if (need > 0) missing.push(`BUY(${p.grades.buy}점)까지 ${need}점 부족`);

      out.push({
        symbol,
        grade: r.grade,
        score: r.score,
        conditions: {
          '추세(30)': cond(c.trend),
          '타이밍(25)': cond(c.timing),
          '모멘텀(20)': cond(c.momentum),
          '거래량(15)': cond(c.volume),
          '손익비(10)': cond(c.riskReward),
        },
        numbers: {
          현재가: String(round2(price)),
          RSI: rsi?.toFixed(1) ?? '—',
          '20일선거리': gap20 !== null ? pct(gap20) : '—',
          '60일선거리': gap60 !== null ? pct(gap60) : '—',
          'ATR%': atr ? `${((atr / price) * 100).toFixed(2)}%` : '—',
          진입: `${round2(r.entry.price)} (${r.entry.type})`,
          손절: `${round2(r.stopLoss.price)} (${r.stopLoss.maxLossPercent.toFixed(1)}%)`,
          '1차목표': `${round2(r.targets.target1.price)} (${r.targets.target1.percent.toFixed(1)}%)`,
          손익비: c.riskReward.ratio.toFixed(2),
        },
        rejection: r.rejection,
        missing,
      });
    } catch (e) {
      out.push({
        symbol, grade: 'ERROR', score: 0, conditions: {}, numbers: {}, rejection: null,
        missing: [], error: e instanceof Error ? e.message : String(e),
      });
    }
  }
  return out;
}

interface ReplayResult {
  symbol: string;
  days: number;
  grades: Record<string, number>;
  buyDates: string[];
  rrDemoted: number;
  forward: { d5: number[]; d10: number[]; d20: number[] };
  lastBarChecked: string | null;
}

/**
 * 과거 재현 — 하루씩 뒤로 가며 **그날까지의 봉만** 넣어 평가한다.
 * ⚠️ `slice(0, i + 1)` 이 미래 차단의 전부다. 여기를 잘못 건드리면 숫자가 전부 거짓이 된다.
 */
async function swingReplay(symbols: string[]): Promise<ReplayResult[]> {
  const profile = getActiveSwingParams();
  const out: ReplayResult[] = [];

  for (const symbol of symbols) {
    const candles = await candlesOf(symbol, 400);
    if (candles.length < 120) continue;

    const grades: Record<string, number> = {};
    const buyDates: string[] = [];
    const forward = { d5: [] as number[], d10: [] as number[], d20: [] as number[] };
    let rrDemoted = 0;
    let lastBarChecked: string | null = null;

    const start = Math.max(60, candles.length - REPLAY_DAYS);
    for (let i = start; i < candles.length; i += 1) {
      const upto = candles.slice(0, i + 1); // ← 미래 차단
      let r;
      try {
        r = await evaluateSwing(symbol, profile, upto);
      } catch {
        continue;
      }
      lastBarChecked = dateOf(upto.at(-1)!.timestamp);
      grades[r.grade] = (grades[r.grade] ?? 0) + 1;
      if (r.rejection?.includes('손익비')) rrDemoted += 1;

      if (r.grade === 'STRONG' || r.grade === 'BUY') {
        buyDates.push(lastBarChecked);
        const base = upto.at(-1)!.close;
        for (const [key, n] of [['d5', 5], ['d10', 10], ['d20', 20]] as const) {
          const later = candles[i + n];
          if (later) forward[key].push(((later.close - base) / base) * 100);
        }
      }
    }
    out.push({ symbol, days: candles.length - start, grades, buyDates, rrDemoted, forward, lastBarChecked });
  }
  return out;
}

// ── 3-2. 목표 수익률별 "먼저 닿을 확률" ─────────────────────────────────────

/** 모의계좌 기본값 — 왕복으로 뺀다 */
const COMMISSION = 0.001;
const SLIPPAGE = 0.0005;
const ROUND_TRIP_COST = (COMMISSION + SLIPPAGE) * 2 * 100; // %

interface FreqRow {
  target: number;
  stop: number;
  horizon: number;
  samples: number;
  hitTarget: number;
  hitStop: number;
  neither: number;
  expectancy: number;
}

/**
 * 매일 종가에 샀다고 가정하고, N 거래일 안에 목표(+X%)와 손절(−Y%) 중 **어느 쪽에 먼저**
 * 닿았는지 센다.
 *
 * ⚠️ 같은 날 둘 다 닿으면 **손절로 센다**(보수적). 일봉만으로는 장중 순서를 알 수 없어서,
 * 유리한 쪽으로 가정하면 실제보다 좋아 보인다.
 * ⚠️ 이것은 **예측이 아니라 과거 빈도**다. 아무 조건 없이 매일 샀을 때의 숫자이므로,
 * 신호는 이 기준선보다 나아야 의미가 있다.
 */
function firstTouchFrequency(candles: Candle[], targets: number[], horizons: number[]): FreqRow[] {
  const rows: FreqRow[] = [];
  const usable = candles.slice(-FREQ_DAYS);

  for (const X of targets) {
    for (const [label, Y] of [['2:1', X / 2], ['1:1', X]] as const) {
      for (const N of horizons) {
        let samples = 0;
        let hitTarget = 0;
        let hitStop = 0;

        for (let i = 0; i < usable.length - N; i += 1) {
          const buy = usable[i].close;
          const tp = buy * (1 + X / 100);
          const sl = buy * (1 - Y / 100);
          samples += 1;

          let done = false;
          for (let k = 1; k <= N && !done; k += 1) {
            const bar = usable[i + k];
            const touchedStop = bar.low <= sl;
            const touchedTarget = bar.high >= tp;
            // 같은 날 둘 다면 손절 (보수적)
            if (touchedStop) { hitStop += 1; done = true; }
            else if (touchedTarget) { hitTarget += 1; done = true; }
          }
        }

        const neither = samples - hitTarget - hitStop;
        const tRate = samples ? (hitTarget / samples) * 100 : 0;
        const sRate = samples ? (hitStop / samples) * 100 : 0;
        rows.push({
          target: X,
          stop: Number(`${Y}`),
          horizon: N,
          samples,
          hitTarget: round2(tRate),
          hitStop: round2(sRate),
          neither: round2(samples ? (neither / samples) * 100 : 0),
          // 기대값 = 도달률×X − 손절률×Y − 왕복 비용
          expectancy: round2((tRate / 100) * X - (sRate / 100) * Y - ROUND_TRIP_COST),
        });
        void label;
      }
    }
  }
  return rows;
}

/** 하루 평균 변동폭 — "3% 는 이 종목의 며칠치인가" 를 보여 준다 */
function atrPercent(candles: Candle[], period = 14): number | null {
  const c = candles.slice(-(period + 1));
  if (c.length < period + 1) return null;
  let sum = 0;
  for (let i = 1; i < c.length; i += 1) {
    const tr = Math.max(
      c[i].high - c[i].low,
      Math.abs(c[i].high - c[i - 1].close),
      Math.abs(c[i].low - c[i - 1].close),
    );
    sum += tr;
  }
  const atr = sum / period;
  return round2((atr / c.at(-1)!.close) * 100);
}

// ── 3-3. 급등: 주기성 예측이 실제로 맞는가 ──────────────────────────────────

interface PeriodicCase {
  symbol: string;
  asOf: string;
  surgeCount: number;
  regularity: number;
  avgInterval: number;
  predicted: string;
  hit: boolean;
  /** 예상일이 기준일보다 과거인가 — "이미 지난 날짜" 사례 */
  stale: boolean;
}

interface SurgeVerdict {
  cases: PeriodicCase[];
  hitRate: number;
  baseline: number;
  edge: number;
  byRegularity: { band: string; n: number; hit: number; base: number }[];
  chase: { n: number; d1: number; d3: number; d5: number; d10: number; up5: number; down5: number };
  staleCount: number;
}

/**
 * 워크포워드 — 매월 1일을 기준일로 삼아, **그날까지의 봉만**으로 엔진이 "주기적" 이라
 * 판정한 경우를 모으고 예상일 ±3일 안에 실제 급등이 있었는지 센다.
 *
 * ⚠️ 기준선(우연히 맞을 확률)을 함께 낸다. 그 종목의 과거 급등 빈도로 계산한
 * "아무 7일 창에 급등이 1번 이상 있을 확률" 이다. **적중률이 이보다 높아야** 의미가 있다.
 */
async function surgeWalkForward(symbols: string[]): Promise<SurgeVerdict> {
  const settings = getSettings();
  /*
    ⚠️ 워크포워드는 **설정의 기간(기본 6mo·126봉)이 아니라 가장 긴 `1y`** 를 쓴다.
    126봉으로는 "기준일까지의 봉" 을 잘라 내고 나면 남는 구간이 거의 없어 판정이 한 건도
    안 나온다(실제로 0건이었다). 지시서는 2년을 말했지만 기존 `/history` 경로가 받는
    최댓값이 `1y` 다 — 엔진 타입을 넓히지 않고 가장 긴 값을 쓴다.
  */
  const period = '1y' as const;
  const cases: PeriodicCase[] = [];
  const chaseReturns = { d1: [] as number[], d3: [] as number[], d5: [] as number[], d10: [] as number[] };
  let up5 = 0;
  let down5 = 0;
  let chaseN = 0;
  const baselines: number[] = [];

  for (const symbol of symbols) {
    let candles: Candle[];
    let marketCap: number | null = null;
    try {
      const h = await getHistory(symbol, period);
      candles = h.candles;
      marketCap = h.marketCap;
    } catch {
      continue;
    }
    if (candles.length < 120) continue;

    const { threshold } = thresholdFor(settings.thresholdMode, settings.priceThreshold, marketCap);

    // 전체 기간의 급등 빈도 → 기준선(아무 7일 창에 1번 이상 있을 확률)
    const allEvents = findSurgeEvents(candles, threshold, settings.volumeThreshold);
    const spanDays = (candles.at(-1)!.timestamp - candles[0].timestamp) / DAY_MS;
    const perDay = spanDays > 0 ? allEvents.length / spanDays : 0;
    baselines.push(Math.min(1, perDay * 7) * 100);

    // 추격 매수: 급등 다음 날 시가에 샀다면
    for (const e of allEvents) {
      const idx = candles.findIndex((c) => dateOf(c.timestamp) === e.date);
      const entryBar = candles[idx + 1];
      if (!entryBar) continue;
      chaseN += 1;
      const entry = entryBar.open;
      for (const [key, n] of [['d1', 1], ['d3', 3], ['d5', 5], ['d10', 10]] as const) {
        const later = candles[idx + 1 + n];
        if (later) chaseReturns[key].push(((later.close - entry) / entry) * 100);
      }
      // +5% 먼저 / −5% 먼저 (같은 날 둘 다면 손절)
      for (let k = 1; k <= 10; k += 1) {
        const bar = candles[idx + 1 + k];
        if (!bar) break;
        if (bar.low <= entry * 0.95) { down5 += 1; break; }
        if (bar.high >= entry * 1.05) { up5 += 1; break; }
      }
    }

    // 매월 1일 기준으로 워크포워드
    for (let i = 120; i < candles.length; i += 1) {
      const d = new Date(candles[i].timestamp);
      const prev = new Date(candles[i - 1].timestamp);
      if (d.getUTCMonth() === prev.getUTCMonth()) continue; // 달이 바뀌는 첫 봉만

      const upto = candles.slice(0, i + 1); // ← 미래 차단
      const events = findSurgeEvents(upto, threshold, settings.volumeThreshold);
      const per = analyzePeriodicity(events, settings.minSurgeCount, settings.regularityThreshold);
      if (!per.isPeriodic || !per.nextEstimatedDate) continue;

      const asOfMs = upto.at(-1)!.timestamp;
      const predMs = Date.parse(per.nextEstimatedDate);
      const stale = predMs < asOfMs;

      // 예상일 ±3일 안에 실제 급등이 있었나 (기준일 **이후**의 급등만 인정)
      const hit = allEvents.some((e) => {
        const ms = Date.parse(e.date);
        return ms > asOfMs && Math.abs(ms - predMs) <= 3 * DAY_MS;
      });

      cases.push({
        symbol,
        asOf: dateOf(asOfMs),
        surgeCount: per.surgeCount,
        regularity: round2(per.regularity),
        avgInterval: round2(per.avgInterval),
        predicted: per.nextEstimatedDate,
        hit,
        stale,
      });
    }
  }

  const hits = cases.filter((c) => c.hit).length;
  const hitRate = cases.length ? (hits / cases.length) * 100 : 0;
  const baseline = baselines.length ? baselines.reduce((a, b) => a + b, 0) / baselines.length : 0;

  const band = (lo: number, hi: number) => {
    const subset = cases.filter((c) => c.regularity >= lo && c.regularity < hi);
    return {
      band: `규칙성 ${lo}~${hi}%`,
      n: subset.length,
      hit: subset.length ? round2((subset.filter((c) => c.hit).length / subset.length) * 100) : 0,
      base: round2(baseline),
    };
  };

  const avg = (xs: number[]) => (xs.length ? round2(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);

  return {
    cases,
    hitRate: round2(hitRate),
    baseline: round2(baseline),
    edge: round2(hitRate - baseline),
    byRegularity: [band(50, 70), band(70, 90), band(90, 101)],
    chase: {
      n: chaseN,
      d1: avg(chaseReturns.d1),
      d3: avg(chaseReturns.d3),
      d5: avg(chaseReturns.d5),
      d10: avg(chaseReturns.d10),
      up5: chaseN ? round2((up5 / chaseN) * 100) : 0,
      down5: chaseN ? round2((down5 / chaseN) * 100) : 0,
    },
    staleCount: cases.filter((c) => c.stale).length,
  };
}

// ── 3-4. 급등 성과 채점 ─────────────────────────────────────────────────────

/**
 * `surge_detections` 의 성과 칸이 비어 있던 이유를 확인하고 채운다.
 *
 * ⚠️ 채점은 `/api/surge/history` 를 **읽을 때만** 돈다(CLAUDE.md Step 9 — 별도 스케줄러를
 * 두지 않았다). 탐지 이력 화면을 열지 않으면 영영 비어 있는 **구조**이지 버그가 아니다.
 * 진단이 `refreshOutcomes()` 를 한 번 부르는 것은 원래 돌아야 하는 기능을 돌리는 것이라 허용된다.
 */
async function surgeOutcomes() {
  const before = listDetections();
  const emptyBefore = before.filter((d) => d.actualSurged === null || d.priceAfter30d === null).length;

  const updated = await refreshOutcomes().catch(() => 0);

  const after = listDetections();
  const emptyAfter = after.filter((d) => d.actualSurged === null || d.priceAfter30d === null).length;
  const judged = after.filter((d) => d.actualSurged !== null);

  const ret = (a: number | null, base: number | null) =>
    a === null || base === null || base === 0 ? null : ((a - base) / base) * 100;
  const avg = (xs: (number | null)[]) => {
    const v = xs.filter((x): x is number => x !== null);
    return v.length ? round2(v.reduce((a, b) => a + b, 0) / v.length) : null;
  };

  return {
    total: after.length,
    emptyBefore,
    emptyAfter,
    updated,
    judged: judged.length,
    hits: judged.filter((d) => d.actualSurged).length,
    avg7: avg(after.map((d) => ret(d.priceAfter7d, d.priceAtDetection))),
    avg14: avg(after.map((d) => ret(d.priceAfter14d, d.priceAtDetection))),
    avg30: avg(after.map((d) => ret(d.priceAfter30d, d.priceAtDetection))),
    rows: after.slice(0, 20).map((d) => ({
      date: d.detectedAt.slice(0, 10),
      symbol: d.symbol,
      score: d.surgeScore,
      expected: d.nextEstimatedDate ?? '—',
      r7: ret(d.priceAfter7d, d.priceAtDetection),
      r30: ret(d.priceAfter30d, d.priceAtDetection),
      surged: d.actualSurged,
    })),
  };
}

// ── 3-5. Gemini 정확도 ──────────────────────────────────────────────────────

/** 기존 채점(`gemini/accuracy.ts`)을 그대로 부른다 — 새로 호출하지 않는다 */
async function geminiAccuracy(symbols: string[]) {
  const scored = scoredAnalyses(500);
  const judged = scored.filter((s) => s.outcome !== 'pending');

  const bySignal = (sig: string) => {
    const subset = judged.filter((s) => s.signal === sig);
    return {
      signal: sig,
      n: subset.length,
      correct: subset.filter((s) => s.outcome === 'correct').length,
      rate: subset.length ? round2((subset.filter((s) => s.outcome === 'correct').length / subset.length) * 100) : 0,
    };
  };

  const byConfidence = (lo: number, hi: number) => {
    const subset = judged.filter((s) => (s.confidence ?? 0) >= lo && (s.confidence ?? 0) < hi);
    return {
      band: `${Math.round(lo * 100)}~${Math.round(hi * 100)}%`,
      n: subset.length,
      rate: subset.length ? round2((subset.filter((s) => s.outcome === 'correct').length / subset.length) * 100) : 0,
    };
  };

  /*
    기준선 — "그 종목들을 같은 날 무조건 샀다면 5일 뒤 상승했을 비율".
    AI 적중률이 이 값보다 높아야 의미가 있다.
  */
  let upDays = 0;
  let totalDays = 0;
  for (const symbol of symbols.slice(0, QUICK ? 5 : 12)) {
    const candles = await candlesOf(symbol, 300);
    for (let i = 0; i < candles.length - 5; i += 1) {
      totalDays += 1;
      if (candles[i + 5].close > candles[i].close) upDays += 1;
    }
  }

  return {
    total: scored.length,
    judged: judged.length,
    correct: judged.filter((s) => s.outcome === 'correct').length,
    rate: judged.length ? round2((judged.filter((s) => s.outcome === 'correct').length / judged.length) * 100) : 0,
    bySignal: ['BUY', 'SELL', 'HOLD'].map(bySignal),
    byConfidence: [byConfidence(0, 0.6), byConfidence(0.6, 0.7), byConfidence(0.7, 0.8), byConfidence(0.8, 1.01)],
    baselineUp5: totalDays ? round2((upDays / totalDays) * 100) : 0,
  };
}

/** 자동매매 AI형의 실제 거래 (사유로 가른다 — TradeHistory 의 `isAuto` 와 같은 방식) */
function autoTrades() {
  const rows = getDb()
    .prepare(
      `SELECT pnl, pnl_percent FROM paper_trades
        WHERE side = 'SELL' AND reason IS NOT NULL AND reason != '' AND pnl IS NOT NULL`,
    )
    .all() as { pnl: number; pnl_percent: number }[];
  if (!rows.length) return { n: 0, winRate: 0, avgPnl: 0 };
  const wins = rows.filter((r) => r.pnl > 0).length;
  return {
    n: rows.length,
    winRate: round2((wins / rows.length) * 100),
    avgPnl: round2(rows.reduce((a, r) => a + r.pnl_percent, 0) / rows.length),
  };
}

// ── 리포트 ───────────────────────────────────────────────────────────────────

/**
 * 출력 위치 — 맥은 관리 루트(`docs/analysis/`), 오라클은 `~/alphascope/reports/`.
 * 오라클에는 관리 루트가 없다.
 */
function outputDir(): { dir: string; server: string } {
  const server = os.hostname().toLowerCase().includes('mac') || process.platform === 'darwin' ? 'mac' : 'oracle';
  const root = path.resolve(process.cwd());
  const dir = server === 'mac' ? path.resolve(root, '../../docs/analysis') : path.resolve(root, 'reports');
  return { dir, server };
}

/**
 * ⚠️ 지표 엔진(5001)이 꺼져 있으면 스윙 점수도 급등 채점도 전부 0·빈 값이 되는데,
 * 그것이 **결과처럼 보인다**(실제로 첫 실행에서 "BUY 0일 / 급등 채점 0건" 이 나왔고
 * 원인은 엔진이 꺼진 것이었다). 숫자를 내기 전에 먼저 확인하고, 꺼져 있으면 멈춘다.
 */
async function requireEngine() {
  const url = process.env.INDICATORS_URL ?? `http://127.0.0.1:${process.env.INDICATORS_PORT ?? 5001}`;
  const ok = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) })
    .then((r) => r.ok)
    .catch(() => false);
  if (ok) return;
  console.error('[진단] ⚠️ 지표 엔진(5001)이 응답하지 않습니다.');
  console.error('       이 상태로 돌리면 스윙 점수·급등 채점이 전부 0 으로 나와 **결과처럼 보입니다**.');
  console.error('       `npm run dev:py` 로 먼저 띄운 뒤 다시 실행하세요.');
  process.exit(1);
}

async function main() {
  await requireEngine();
  const started = Date.now();
  const { symbols, source } = targetSymbols();
  const list = QUICK ? symbols.slice(0, 5) : symbols;
  const profile = getActiveSwingParams();

  console.log(`[진단] 대상 ${list.length}종목 (${source})${QUICK ? ' · --quick' : ''}`);

  const beforeRows = {
    swing: (getDb().prepare(`SELECT COUNT(*) n FROM swing_recommendations`).get() as { n: number }).n,
    gemini: (getDb().prepare(`SELECT COUNT(*) n FROM gemini_analysis`).get() as { n: number }).n,
  };

  console.log('[진단] 1/5 스윙 — 오늘 기준');
  const today = await swingToday(list);
  console.log('[진단] 2/5 스윙 — 과거 재현');
  const replay = await swingReplay(list);

  console.log('[진단] 3/5 목표 수익률별 빈도');
  const freq: Record<string, { rows: FreqRow[]; atr: number | null }> = {};
  for (const symbol of [...list, 'SPY']) {
    const candles = await candlesOf(symbol, FREQ_DAYS + 30);
    if (candles.length < 60) continue;
    freq[symbol] = {
      rows: firstTouchFrequency(candles, [3, 5, 10, 15], [3, 5, 10, 20]),
      atr: atrPercent(candles),
    };
  }

  console.log('[진단] 4/5 급등 — 주기성 검증');
  const detected = [...new Set(listDetections().map((d) => d.symbol))];
  const surgePool = [...new Set([...detected, ...list])].slice(0, QUICK ? 8 : 25);
  const surge = await surgeWalkForward(surgePool);
  const outcomes = await surgeOutcomes();

  console.log('[진단] 5/5 Gemini 정확도');
  const gemini = await geminiAccuracy(list);
  const trades = autoTrades();

  const afterRows = {
    swing: (getDb().prepare(`SELECT COUNT(*) n FROM swing_recommendations`).get() as { n: number }).n,
    gemini: (getDb().prepare(`SELECT COUNT(*) n FROM gemini_analysis`).get() as { n: number }).n,
  };

  const elapsed = Math.round((Date.now() - started) / 1000);
  const { dir, server } = outputDir();
  const stamp = new Date().toISOString().slice(0, 10);
  fs.mkdirSync(dir, { recursive: true });
  const base = path.join(dir, `diagnosis_${server}_${stamp}`);

  const buyTotal = replay.reduce((n, r) => n + r.buyDates.length, 0);
  const replayDays = replay.reduce((n, r) => n + r.days, 0);

  // ── 마크다운 ──
  const md: string[] = [];
  md.push(`# AlphaScope 진단 리포트 — ${server} · ${stamp}`);
  md.push('');
  md.push(`- 대상: **${list.length}종목** (${source}) — ${list.join(', ')}`);
  md.push(`- 판정 기준: **${profile.id}** (BUY 컷 ${profile.params.grades.buy}점, 손익비 ${profile.params.rrDemoteBelow} 미만 강등)`);
  md.push(`- 실행 시간 ${elapsed}초${QUICK ? ' (--quick)' : ''}`);
  md.push('');
  md.push('---');
  md.push('');
  md.push('## 네 가지 질문에 대한 답');
  md.push('');

  // Q1
  const gradeAll: Record<string, number> = {};
  for (const r of replay) for (const [g, n] of Object.entries(r.grades)) gradeAll[g] = (gradeAll[g] ?? 0) + n;
  md.push('### 1. 관심 종목이 스윙에서 전부 부적합한 것은 정상인가?');
  md.push(
    buyTotal === 0
      ? `- 과거 ${REPLAY_DAYS}거래일을 되돌려도 **BUY 이상이 ${buyTotal}일**(총 ${replayDays}일 평가)이었습니다. 오늘만의 일이 아닙니다.`
      : `- 과거 ${REPLAY_DAYS}거래일 중 **BUY 이상이 ${buyTotal}일**(총 ${replayDays}일 중 ${round2((buyTotal / Math.max(1, replayDays)) * 100)}%)이었습니다.`,
  );
  md.push(`- 등급 분포: ${Object.entries(gradeAll).map(([g, n]) => `${g} ${n}일`).join(' · ') || '—'}`);
  md.push(`- 엔진 오류로 평가에 실패한 종목: ${today.filter((t) => t.error).length}개`);
  md.push('');

  // Q2
  md.push('### 2. 목표 수익을 3%처럼 작게 잡으면 달라지는가?');
  const spy = freq['SPY'];
  const pick = (f: typeof spy | undefined, X: number, N: number, ratio: '2:1' | '1:1') =>
    f?.rows.find((r) => r.target === X && r.horizon === N && (ratio === '2:1' ? r.stop === X / 2 : r.stop === X));
  const sample = list.map((s) => pick(freq[s], 3, 10, '2:1')).filter(Boolean) as FreqRow[];
  if (sample.length) {
    const avgHit = round2(sample.reduce((a, r) => a + r.hitTarget, 0) / sample.length);
    const avgExp = round2(sample.reduce((a, r) => a + r.expectancy, 0) / sample.length);
    md.push(`- **+3% / −1.5% / 10거래일** 기준: 목표 먼저 도달 평균 **${avgHit}%**, 기대값 평균 **${avgExp}%p** (수수료·슬리피지 왕복 ${ROUND_TRIP_COST.toFixed(2)}%p 반영).`);
    const spyRow = pick(spy, 3, 10, '2:1');
    if (spyRow) md.push(`- 같은 조건의 **SPY(시장 전체)**: 도달 ${spyRow.hitTarget}%, 기대값 ${spyRow.expectancy}%p. 개별 종목이 시장보다 나은지 비교하세요.`);
  }
  md.push('- ⚠️ 이 숫자는 **아무 조건 없이 매일 샀을 때의 과거 빈도**입니다. 신호는 이 기준선보다 나아야 의미가 있고, 과거 빈도가 미래를 보장하지 않습니다.');
  md.push('');

  // Q3
  md.push('### 3. 급등 탐지의 "며칠에 한 번" 예측이 맞는가?');
  if (surge.cases.length === 0) {
    md.push('- **판단 불가** — 워크포워드에서 "주기적" 판정이 한 건도 나오지 않았습니다.');
  } else {
    md.push(`- 주기적 판정 **${surge.cases.length}건**${weak(surge.cases.length)} 중 예상일 ±3일 적중 **${surge.hitRate}%**.`);
    md.push(`- 우연히 맞을 확률(기준선) **${surge.baseline}%** → 차이 **${surge.edge >= 0 ? '+' : ''}${surge.edge}%p**.`);
    md.push(
      Math.abs(surge.edge) < 10 || surge.cases.length < MIN_SAMPLE
        ? '- → **주기성 예측이 우연보다 낫다는 근거가 없습니다.**'
        : surge.edge > 0
          ? '- → 기준선보다 높습니다. 다만 표본과 기간을 늘려 재확인이 필요합니다.'
          : '- → 기준선보다 **낮습니다**.',
    );
    md.push(`- 급등 **다음 날 시가에 산 경우**(${surge.chase.n}건): 1일 ${pct(surge.chase.d1)} · 5일 ${pct(surge.chase.d5)} · 10일 ${pct(surge.chase.d10)} / +5% 먼저 ${surge.chase.up5}% vs −5% 먼저 ${surge.chase.down5}%.`);
    if (surge.staleCount) md.push(`- 예상일이 **이미 지난 날짜**로 나온 경우 ${surge.staleCount}건.`);
  }
  md.push('');

  // Q4
  md.push('### 4. Gemini 분석은 정확한가?');
  if (gemini.judged < MIN_SAMPLE) {
    md.push(`- **표본 부족 — 결론 내릴 수 없음** (채점 가능 ${gemini.judged}건, 전체 ${gemini.total}건).`);
  }
  md.push(`- 적중률 **${gemini.rate}%** (${gemini.correct}/${gemini.judged})${weak(gemini.judged)}.`);
  md.push(`- 기준선(같은 종목을 아무 날 샀을 때 5일 뒤 상승 비율) **${gemini.baselineUp5}%** — AI 가 이보다 높아야 의미가 있습니다.`);
  if (trades.n) md.push(`- 자동매매 청산 거래 ${trades.n}건: 승률 ${trades.winRate}%, 평균 ${pct(trades.avgPnl)}.`);
  md.push('');
  md.push('---');
  md.push('');
  // ── 상세 ──
  md.push('## 상세 1 — 스윙: 오늘 기준');
  md.push('');
  md.push(table(
    ['종목', '등급', '점수', '추세', '타이밍', '모멘텀', '거래량', '손익비', 'RSI', '20일선', '60일선', 'ATR%'],
    today.map((t) => t.error
      ? [t.symbol, 'ERROR', '—', '—', '—', '—', '—', '—', '—', '—', '—', '—']
      : [
          t.symbol, t.grade, t.score,
          `${t.conditions['추세(30)'].score}/30`,
          `${t.conditions['타이밍(25)'].score}/25`,
          `${t.conditions['모멘텀(20)'].score}/20`,
          `${t.conditions['거래량(15)'].score}/15`,
          `${t.conditions['손익비(10)'].score}/10`,
          t.numbers.RSI, t.numbers['20일선거리'], t.numbers['60일선거리'], t.numbers['ATR%'],
        ]),
  ));
  md.push('');
  for (const t of today) {
    md.push(`### ${t.symbol} — ${t.grade} (${t.score}점)`);
    if (t.error) { md.push(`- ⚠️ 평가 실패: ${t.error}`); md.push(''); continue; }
    md.push(`- 진입 ${t.numbers.진입} · 손절 ${t.numbers.손절} · 1차목표 ${t.numbers['1차목표']} · 손익비 ${t.numbers.손익비}`);
    if (t.rejection) md.push(`- 제외 사유: ${t.rejection}`);
    for (const [name, c] of Object.entries(t.conditions)) {
      md.push(`- **${name} ${c.score}/${c.max}** — ${c.checks.join(' · ') || '체크 없음'}`);
    }
    if (t.missing.length) md.push(`- **BUY 까지 모자란 것**: ${t.missing.join(' / ')}`);
    md.push('');
  }

  md.push(`## 상세 2 — 스윙: 과거 ${REPLAY_DAYS}거래일 재현`);
  md.push('');
  md.push('⚠️ 각 날짜의 판정에는 **그날까지의 봉만** 넣었습니다(미래 차단).');
  md.push('');
  md.push(table(
    ['종목', '평가일수', '마지막 검사봉', 'STRONG', 'BUY', 'WATCH', 'HOLD', 'AVOID', '손익비 강등', 'BUY 날짜'],
    replay.map((r) => [
      r.symbol, r.days, r.lastBarChecked ?? '—',
      r.grades.STRONG ?? 0, r.grades.BUY ?? 0, r.grades.WATCH ?? 0, r.grades.HOLD ?? 0, r.grades.AVOID ?? 0,
      r.rrDemoted, r.buyDates.slice(0, 5).join(' ') || '—',
    ]),
  ));
  md.push('');
  const fwd = replay.filter((r) => r.forward.d5.length);
  if (fwd.length) {
    const mean = (xs: number[]) => round2(xs.reduce((a, b) => a + b, 0) / xs.length);
    md.push('BUY 날 이후 수익률:');
    md.push('');
    md.push(table(['종목', '건수', '5일', '10일', '20일'],
      fwd.map((r) => [r.symbol, r.forward.d5.length, pct(mean(r.forward.d5)), pct(mean(r.forward.d10)), pct(mean(r.forward.d20))])));
    md.push('');
  } else {
    md.push('BUY 신호가 없어 이후 수익률을 낼 수 없습니다.');
    md.push('');
  }

  md.push(`## 상세 3 — 목표 수익률별 먼저 닿을 확률 (최근 ${FREQ_DAYS}거래일)`);
  md.push('');
  md.push('⚠️ 매일 종가 매수 가정. 같은 날 목표·손절 동시 도달은 **손절로** 셉니다(보수적).');
  md.push(`⚠️ 기대값에는 수수료·슬리피지 왕복 ${ROUND_TRIP_COST.toFixed(2)}%p 를 뺐습니다.`);
  md.push('');
  for (const [symbol, f] of Object.entries(freq)) {
    md.push(`### ${symbol}${symbol === 'SPY' ? ' (기준선 — 시장 전체)' : ''} · ATR ${f.atr ?? '—'}%/일`);
    md.push(table(
      ['목표', '손절', '기간', '표본', '목표먼저', '손절먼저', '미도달', '기대값'],
      f.rows.filter((r) => r.horizon === 10 || r.horizon === 5).map((r) => [
        `+${r.target}%`, `−${r.stop}%`, `${r.horizon}일`, r.samples,
        `${r.hitTarget}%`, `${r.hitStop}%`, `${r.neither}%`, `${r.expectancy}%p`,
      ]),
    ));
    md.push('');
  }

  md.push('## 상세 4 — 급등: 주기성 워크포워드');
  md.push('');
  md.push(`대상 ${surgePool.length}종목 · 주기 판정 ${surge.cases.length}건 · 적중 ${surge.hitRate}% · 기준선 ${surge.baseline}% · 차이 ${surge.edge >= 0 ? '+' : ''}${surge.edge}%p`);
  md.push('');
  md.push(table(['구간', '건수', '적중률', '기준선'],
    surge.byRegularity.map((b) => [b.band, b.n, `${b.hit}%`, `${b.base}%`])));
  md.push('');
  if (surge.cases.length) {
    md.push(table(['기준일', '종목', '급등횟수', '규칙성', '평균간격', '예상일', '적중', '지난날짜'],
      surge.cases.slice(0, 30).map((c) => [
        c.asOf, c.symbol, c.surgeCount, `${c.regularity}%`, `${c.avgInterval}일`,
        c.predicted, c.hit ? '✅' : '❌', c.stale ? '⚠️' : '',
      ])));
    md.push('');
  }

  md.push('## 상세 5 — 급등 탐지 기록의 실제 성과');
  md.push('');
  md.push(`- 기록 ${outcomes.total}건 · 채점 전 미완 ${outcomes.emptyBefore}건 → 이번 실행으로 ${outcomes.updated}건 갱신 → 남은 미완 ${outcomes.emptyAfter}건`);
  md.push(`- 채점 완료 ${outcomes.judged}건 중 30일 안 실제 급등 ${outcomes.hits}건`);
  md.push(`- 평균 수익률: 7일 ${outcomes.avg7 === null ? '—' : pct(outcomes.avg7)} · 14일 ${outcomes.avg14 === null ? '—' : pct(outcomes.avg14)} · 30일 ${outcomes.avg30 === null ? '—' : pct(outcomes.avg30)}`);
  md.push('');
  if (outcomes.rows.length) {
    md.push(table(['탐지일', '종목', '점수', '예상일', '7일', '30일', '실제급등'],
      outcomes.rows.map((r) => [r.date, r.symbol, r.score, r.expected,
        r.r7 === null ? '—' : pct(r.r7), r.r30 === null ? '—' : pct(r.r30),
        r.surged === null ? '미채점' : r.surged ? '✅' : '❌'])));
    md.push('');
  }

  md.push('## 상세 6 — Gemini 정확도');
  md.push('');
  md.push(`- 전체 ${gemini.total}건 · 채점 가능 ${gemini.judged}건 · 적중 ${gemini.rate}%`);
  md.push('');
  md.push(table(['신호', '건수', '적중', '적중률'],
    gemini.bySignal.map((b) => [b.signal, b.n, b.correct, `${b.rate}%`])));
  md.push('');
  md.push(table(['신뢰도', '건수', '적중률'],
    gemini.byConfidence.map((b) => [b.band, b.n, `${b.rate}%`])));
  md.push('');
  md.push(`기준선(무조건 매수 5일 뒤 상승 비율): **${gemini.baselineUp5}%**`);
  md.push('');
  md.push('---');
  md.push('');
  md.push(`표본 오염 확인: swing_recommendations ${beforeRows.swing}→${afterRows.swing}행, gemini_analysis ${beforeRows.gemini}→${afterRows.gemini}행 (같아야 정상)`);

  fs.writeFileSync(`${base}.md`, md.join('\n'), 'utf8');
  fs.writeFileSync(`${base}.json`, JSON.stringify(
    { server, stamp, symbols: list, profile: profile.id, today, replay, freq, surge, outcomes, gemini, trades, beforeRows, afterRows, elapsed },
    null, 2), 'utf8');

  // ── 콘솔 요약 (20줄 이내) ──
  console.log('');
  console.log(`── 진단 요약 (${server} · ${stamp} · ${elapsed}초) ──`);
  console.log(`1) 스윙: 과거 ${replayDays}일 평가 중 BUY 이상 ${buyTotal}일`);
  console.log(`2) +3%/−1.5%/10일 기대값 평균: ${sample.length ? round2(sample.reduce((a, r) => a + r.expectancy, 0) / sample.length) : '—'}%p (SPY ${pick(spy, 3, 10, '2:1')?.expectancy ?? '—'}%p)`);
  console.log(`3) 급등 주기 적중 ${surge.hitRate}% vs 기준선 ${surge.baseline}% (차이 ${surge.edge >= 0 ? '+' : ''}${surge.edge}%p, 표본 ${surge.cases.length})`);
  console.log(`4) Gemini 적중 ${gemini.rate}% vs 기준선 ${gemini.baselineUp5}% (채점 ${gemini.judged}건)`);
  console.log(`급등 채점: ${outcomes.updated}건 갱신, 미완 ${outcomes.emptyAfter}건`);
  console.log(`표본 오염: swing ${beforeRows.swing}→${afterRows.swing}, gemini ${beforeRows.gemini}→${afterRows.gemini}`);
  console.log(`리포트: ${base}.md`);
  process.exit(0);
}

void main().catch((e) => {
  console.error('[진단] 실패:', e instanceof Error ? e.message : String(e));
  process.exit(1);
});
