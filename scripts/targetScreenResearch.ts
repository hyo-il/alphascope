/**
 * "지금 사면 N일 안에 +X%" 후보 선별 — **검증 연구** (`npm run research:target [--shuffle]`)
 *
 * 방법: 오늘 종목의 상태를 구간으로 나눠 이름표를 붙이고, 과거에 **같은 이름표였던 날** 샀다면
 * N일 안에 +X% 에 먼저 닿은 비율을 센다. 그 비율로 매일 기대값 상위 10종목을 뽑아,
 * 같은 날 시장 전 종목(기준선)·무작위 10종목보다 나았는지 최근 12개월 워크포워드로 본다.
 *
 * ⚠️ 이 파일의 **상수는 결과를 보기 전에 고정했다** (2026-09-29 지시서 4~6절). 결과를 본 뒤
 * 특징 구간·섞기 값(20)·상위 개수(10)·통과 기준을 바꾸면 검증이 아니다. 바꾸고 싶으면 "제안" 으로만.
 * ⚠️ **미래 누설 금지** — t 일 추정에 쓰는 과거 표본 s 는 결과 판정에 본 **마지막 봉(s+N)이 t 보다
 * 앞선** 것만 쓴다. 표본을 "확정되는 순서" 로 정렬해 두고 포인터로 더하므로 구조적으로 막히고,
 * 실행마다 한 날짜에서 위반 0개를 다시 세어 로그로 남긴다.
 * ⚠️ 화면·판정·자동매매·사용자 데이터를 건드리지 않는다. LLM 을 부르지 않는다.
 * `--shuffle`: 결과(목표/손절/미도달)를 무작위로 뒤섞어 돌린다 — 누설이 없으면 통과가 거의 0 이어야 한다.
 */

import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import type { Candle } from '../src/types/toss';
import { getCandles } from '../server/candleService';
import { loadCandles } from '../server/db';
import { ROUND_TRIP_COST, atr, touchOutcome, type TouchOutcome } from '../server/analysis/targetHit';
import { outputDir } from '../server/diagnose/report';
import { rsi, sma } from '../src/utils/indicators';
import { isFormingBar } from '../src/utils/marketBar';
import { isKrSymbol, marketDate } from '../src/utils/marketDate';
import { UNIVERSE_PATH, type Universe } from './universeUpdate';

// ── 고정값 (결과를 본 뒤 바꾸지 않는다) ─────────────────────────────────────

/** 일봉 3년 */
const BARS = 760;
/** 종목 표본과 시장 표본을 섞는 강도 — p = (k + 20·p시장) / (n + 20) */
const PRIOR = 20;
/** 이름표 조합의 시장 전체 표본이 이보다 적으면 그날 후보에서 뺀다 */
const MIN_MARKET_SAMPLES = 50;
const TOP = 10;
const RANDOM_REPS = 1000;
const BOOT_REPS = 2000;
const TEST_MONTHS = 12;
const TARGETS = [3, 5, 10];
const HORIZONS = [5, 10, 20];
/** 손절 = 목표 × 비율 — 1 이 1:1, 0.5 가 2:1 */
const STOP_RATIOS = [1, 0.5];
/** 연구 대상 관심 종목 (오라클 기준, 지시서 2절) */
const WATCHLIST = ['AAPL', 'GOOGL', 'NVDA', 'TSM', 'AVGO', 'MU', 'BE', 'ETN', 'VRT', 'GEV', 'NEE'];

const RSI_EDGES = [30, 40, 50, 60, 70];
const DIST_EDGES = [-2, -1, 0, 1, 2];
const RET5_EDGES = [-2, 0, 2];

const SHUFFLE = process.argv.includes('--shuffle');
const SEED = 20260929;

// ── 유틸 ─────────────────────────────────────────────────────────────────────

/** 재현 가능한 난수 (mulberry32) — 같은 데이터면 같은 결과가 나와야 한다 */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round = (v: number, d = 2) => Math.round(v * 10 ** d) / 10 ** d;
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const bin = (v: number, edges: number[]) => {
  let i = 0;
  while (i < edges.length && v >= edges[i]) i += 1;
  return i;
};
const shiftMonths = (date: string, months: number) => {
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + months, d));
  return dt.toISOString().slice(0, 10);
};
/** 주 단위 블록 키 — 월요일 시작 */
const weekKey = (date: string) => {
  const [y, m, d] = date.split('-').map(Number);
  return Math.floor((Date.UTC(y, m - 1, d) / 86_400_000 + 3) / 7);
};

// ── 데이터 ───────────────────────────────────────────────────────────────────

interface Series {
  symbol: string;
  candles: Candle[];
  dates: string[];
  /** 봉 i 의 시장 달력 순번 */
  ord: number[];
  label: (string | null)[];
  /** 특징 원값 — 참고표용 */
  parts: (number[] | null)[];
  atrPct: (number | null)[];
}

async function loadSeries(symbols: string[]): Promise<Map<string, Candle[]>> {
  const out = new Map<string, Candle[]>();
  let done = 0;
  for (const symbol of symbols) {
    let candles: Candle[] = [];
    try {
      candles = await getCandles(symbol, '1d', BARS);
    } catch {
      candles = loadCandles(symbol, '1d', BARS);
    }
    // 진행 중인 봉은 종가가 확정이 아니다 — 연구에서는 뺀다
    if (candles.length && isFormingBar(candles, '1d')) candles = candles.slice(0, -1);
    if (candles.length >= 120) out.set(symbol, candles);
    done += 1;
    if (done % 25 === 0) console.log(`[research] 캔들 ${done}/${symbols.length}`);
  }
  return out;
}

/**
 * 특징(지시서 4절) — **t 일까지의 봉만** 넣는다. 기존 `sma`·`rsi`(utils/indicators)·`atr`(targetHit)를
 * 그대로 쓰고, 앞부분(prefix)만 잘라 넘기므로 뒤의 봉이 섞일 수 없다.
 */
function buildFeatures(symbol: string, candles: Candle[]): Series {
  const closes = candles.map((c) => c.close);
  const n = candles.length;
  const s: Series = {
    symbol,
    candles,
    dates: candles.map((c) => marketDate(c.timestamp, symbol)),
    ord: [],
    label: new Array(n).fill(null),
    parts: new Array(n).fill(null),
    atrPct: new Array(n).fill(null),
  };
  for (let i = 60; i < n; i += 1) {
    const sma20 = sma(closes.slice(i - 19, i + 1), 20);
    const sma60 = sma(closes.slice(i - 59, i + 1), 60);
    const r = rsi(closes.slice(0, i + 1), 14);
    const a = atr(candles.slice(i - 14, i + 1), 14);
    if (sma20 == null || sma60 == null || r == null || !a) continue;
    const close = closes[i];
    const trend = close > sma60 && sma20 > sma60 ? 1 : 0;
    const dist = (close - sma20) / a;
    const ret5 = (close - closes[i - 5]) / a;
    s.atrPct[i] = (a / close) * 100;
    s.parts[i] = [trend, bin(r, RSI_EDGES), bin(dist, DIST_EDGES), bin(ret5, RET5_EDGES)];
  }
  return s;
}

/** 변동성 3분위 — 그날 그 시장 전 종목의 ATR% 순위로 정한다 (그날 값만 쓴다) */
function attachVolatility(series: Series[], calendar: string[]) {
  const byDate = new Map<string, { s: Series; i: number; v: number }[]>();
  for (const s of series) {
    s.dates.forEach((d, i) => {
      const v = s.atrPct[i];
      if (v == null || !s.parts[i]) return;
      (byDate.get(d) ?? byDate.set(d, []).get(d)!).push({ s, i, v });
    });
  }
  for (const d of calendar) {
    const rows = byDate.get(d);
    if (!rows || rows.length < 3) continue;
    rows.sort((a, b) => a.v - b.v);
    rows.forEach((row, rank) => {
      const tercile = Math.min(2, Math.floor((rank / rows.length) * 3));
      const p = row.s.parts[row.i]!;
      p[4] = tercile;
      row.s.label[row.i] = p.join('|');
    });
  }
}

// ── 워크포워드 ───────────────────────────────────────────────────────────────

interface Sample {
  s: number; // series index
  i: number; // bar index
  label: string;
  outcome: TouchOutcome;
  /** 결과 판정에 본 마지막 봉(i+N)의 달력 순번 — 이것이 t 보다 작아야 쓸 수 있다 */
  resolveOrd: number;
}

interface DayResult {
  date: string;
  top: number;
  base: number;
  topHit: number;
  baseHit: number;
  picks: number;
  pool: number[];
}

interface ComboResult {
  market: 'US' | 'KR';
  target: number;
  stop: number;
  horizon: number;
  ratio: string;
  days: number;
  topEv: number;
  baseEv: number;
  randomEv: number;
  topHit: number;
  baseHit: number;
  randomHit: number;
  diff: number;
  ciLow: number;
  ciHigh: number;
  segments: { from: string; to: string; top: number; base: number; days: number }[];
  segmentWins: number;
  avgPicks: number;
  criteria: [boolean, boolean, boolean, boolean];
  passed: boolean;
}

const valueOf = (o: TouchOutcome, X: number, Y: number) =>
  (o === 'target' ? X : o === 'stop' ? -Y : 0) - ROUND_TRIP_COST;

function runCombo(
  market: 'US' | 'KR',
  series: Series[],
  calendar: string[],
  X: number,
  ratio: number,
  N: number,
  leakProbe: { log: string[] } | null,
): ComboResult {
  const Y = X * ratio;
  const random = rng(SEED + X * 1000 + N * 10 + ratio * 7 + (market === 'KR' ? 1 : 0));

  // 1) 전 표본의 결과 — 진단과 같은 first-touch 함수
  const outcomes: (TouchOutcome | null)[][] = series.map((s) =>
    s.candles.map((_, i) => touchOutcome(s.candles, i, X, Y, N)),
  );
  if (SHUFFLE) {
    // 누설 점검: 결과를 무작위로 섞으면 특징과 결과의 관계가 끊긴다 → 통과가 거의 없어야 한다
    const flat: TouchOutcome[] = [];
    outcomes.forEach((row) => row.forEach((o) => o && flat.push(o)));
    for (let k = flat.length - 1; k > 0; k -= 1) {
      const j = Math.floor(random() * (k + 1));
      [flat[k], flat[j]] = [flat[j], flat[k]];
    }
    let p = 0;
    outcomes.forEach((row) => row.forEach((o, i) => { if (o) row[i] = flat[p++]; }));
  }

  // 2) 표본을 "확정되는 순서" 로 — t 일에는 resolveOrd < ord(t) 인 것만 더해진다
  const samples: Sample[] = [];
  series.forEach((s, si) => {
    s.label.forEach((label, i) => {
      const o = outcomes[si][i];
      if (!label || !o) return;
      samples.push({ s: si, i, label, outcome: o, resolveOrd: s.ord[i + N] });
    });
  });
  samples.sort((a, b) => a.resolveOrd - b.resolveOrd);

  const mkt = new Map<string, { n: number; t: number; st: number }>();
  const own = new Map<string, { n: number; t: number; st: number }>();
  const add = (m: Map<string, { n: number; t: number; st: number }>, key: string, o: TouchOutcome) => {
    const c = m.get(key) ?? { n: 0, t: 0, st: 0 };
    c.n += 1;
    if (o === 'target') c.t += 1;
    if (o === 'stop') c.st += 1;
    m.set(key, c);
  };

  // 시험 기간: 최근 12개월, 결과가 확정될 수 있는 날까지
  const last = calendar.length - 1;
  const testStart = shiftMonths(calendar[last], -TEST_MONTHS);
  const testDays = calendar
    .map((d, ord) => ({ d, ord }))
    .filter(({ d, ord }) => d >= testStart && ord + N <= last);
  const probeAt = testDays[Math.floor(testDays.length / 2)]?.ord ?? -1;

  // 날짜별 봉 위치
  const indexAt = series.map((s) => new Map(s.ord.map((o, i) => [o, i])));

  let pointer = 0;
  const days: DayResult[] = [];
  for (const { d, ord } of testDays) {
    while (pointer < samples.length && samples[pointer].resolveOrd < ord) {
      const sm = samples[pointer];
      add(mkt, sm.label, sm.outcome);
      add(own, `${sm.s}|${sm.label}`, sm.outcome);
      pointer += 1;
    }

    // 누설 증명 — 한 날짜에서 추정에 들어간 표본을 다시 센다
    if (leakProbe && ord === probeAt) {
      let violations = 0;
      let violationsByS = 0;
      let maxResolve = -1;
      for (let k = 0; k < pointer; k += 1) {
        const sm = samples[k];
        if (sm.resolveOrd >= ord) violations += 1;
        if (series[sm.s].ord[sm.i] + N >= ord) violationsByS += 1;
        maxResolve = Math.max(maxResolve, sm.resolveOrd);
      }
      leakProbe.log.push(
        `[누설 점검] ${market} +${X}%/−${Y}%/${N}일 · t=${d}(순번 ${ord}) · 추정에 쓰인 과거 표본 ${pointer.toLocaleString()}개 · ` +
          `결과 확정일 ≥ t: ${violations}개 · s+N ≥ t: ${violationsByS}개 · 가장 늦은 확정일 ${calendar[maxResolve]} ` +
          `· 다음 대기 표본의 확정일 ${pointer < samples.length ? calendar[samples[pointer].resolveOrd] : '없음'}`,
      );
    }

    const scored: { ev: number; v: number | null; hit: boolean; symbol: string }[] = [];
    const pool: number[] = [];
    let poolHit = 0;
    series.forEach((s, si) => {
      const i = indexAt[si].get(ord);
      if (i === undefined) return;
      const o = outcomes[si][i];
      if (o) {
        pool.push(valueOf(o, X, Y));
        if (o === 'target') poolHit += 1;
      }
      const label = s.label[i];
      if (!label) return;
      const m = mkt.get(label);
      if (!m || m.n < MIN_MARKET_SAMPLES) return;
      const k = own.get(`${si}|${label}`) ?? { n: 0, t: 0, st: 0 };
      const pT = (k.t + PRIOR * (m.t / m.n)) / (k.n + PRIOR);
      const pS = (k.st + PRIOR * (m.st / m.n)) / (k.n + PRIOR);
      scored.push({
        ev: pT * X - pS * Y - ROUND_TRIP_COST,
        v: o ? valueOf(o, X, Y) : null,
        hit: o === 'target',
        symbol: s.symbol,
      });
    });
    if (!pool.length) continue;
    scored.sort((a, b) => b.ev - a.ev || a.symbol.localeCompare(b.symbol));
    // 고른 뒤에 결과가 없는 종목(거래정지 등)은 뺀다 — 결과로 고르지 않기 위해 선택 뒤에 거른다
    const picks = scored.slice(0, TOP).filter((p) => p.v !== null);
    if (!picks.length) continue;
    days.push({
      date: d,
      top: mean(picks.map((p) => p.v!)),
      base: mean(pool),
      topHit: (picks.filter((p) => p.hit).length / picks.length) * 100,
      baseHit: (poolHit / pool.length) * 100,
      picks: picks.length,
      pool,
    });
  }

  // 무작위 10종목 — 같은 날 같은 풀에서, 1,000번
  const randomMeans: number[] = [];
  const randomHits: number[] = [];
  for (let r = 0; r < RANDOM_REPS; r += 1) {
    let sum = 0;
    let hits = 0;
    for (const day of days) {
      const size = Math.min(TOP, day.pool.length);
      const chosen = new Set<number>();
      while (chosen.size < size) chosen.add(Math.floor(random() * day.pool.length));
      let s = 0;
      for (const idx of chosen) {
        s += day.pool[idx];
        if (day.pool[idx] > 0) hits += 1 / size; // 목표 먼저만 양수다 (손절·미도달은 비용 때문에 음수)
      }
      sum += s / size;
    }
    randomMeans.push(sum / days.length);
    randomHits.push((hits / days.length) * 100);
  }

  // 주 단위 블록 부트스트랩 — 차이(상위 10 − 기준선)의 95% 구간
  const weeks = new Map<number, number[]>();
  for (const day of days) {
    const key = weekKey(day.date);
    (weeks.get(key) ?? weeks.set(key, []).get(key)!).push(day.top - day.base);
  }
  const blocks = [...weeks.values()];
  const boots: number[] = [];
  for (let b = 0; b < BOOT_REPS; b += 1) {
    let sum = 0;
    let n = 0;
    for (let k = 0; k < blocks.length; k += 1) {
      const block = blocks[Math.floor(random() * blocks.length)];
      for (const v of block) { sum += v; n += 1; }
    }
    boots.push(sum / n);
  }
  boots.sort((a, b) => a - b);
  const ciLow = boots[Math.floor(BOOT_REPS * 0.025)];
  const ciHigh = boots[Math.floor(BOOT_REPS * 0.975)];

  // 4개월씩 3구간
  const first = testDays[0]?.d ?? testStart;
  const edges = [first, shiftMonths(first, 4), shiftMonths(first, 8), '9999-12-31'];
  const segments = [0, 1, 2].map((k) => {
    const part = days.filter((day) => day.date >= edges[k] && day.date < edges[k + 1]);
    return {
      from: part[0]?.date ?? edges[k],
      to: part.at(-1)?.date ?? edges[k + 1],
      top: round(mean(part.map((x) => x.top)), 3),
      base: round(mean(part.map((x) => x.base)), 3),
      days: part.length,
    };
  });
  const segmentWins = segments.filter((s) => s.days > 0 && s.top > s.base).length;

  const topEv = mean(days.map((x) => x.top));
  const baseEv = mean(days.map((x) => x.base));
  const randomEv = mean(randomMeans);
  const criteria: [boolean, boolean, boolean, boolean] = [
    topEv > 0,
    ciLow > 0,
    segmentWins >= 2,
    topEv > randomEv,
  ];

  return {
    market,
    target: X,
    stop: Y,
    horizon: N,
    ratio: ratio === 1 ? '1:1' : '2:1',
    days: days.length,
    topEv: round(topEv, 3),
    baseEv: round(baseEv, 3),
    randomEv: round(randomEv, 3),
    topHit: round(mean(days.map((x) => x.topHit)), 1),
    baseHit: round(mean(days.map((x) => x.baseHit)), 1),
    randomHit: round(mean(randomHits), 1),
    diff: round(topEv - baseEv, 3),
    ciLow: round(ciLow, 3),
    ciHigh: round(ciHigh, 3),
    segments,
    segmentWins,
    avgPicks: round(mean(days.map((x) => x.picks)), 1),
    criteria,
    passed: criteria.every(Boolean),
  };
}

/** 참고표 — 특징 구간별 목표 먼저 비율 (전 기간·표본 안이라 **검증이 아니다**) */
function featureReference(series: Series[], X: number, Y: number, N: number) {
  const names = ['추세', 'RSI', 'SMA20 거리', '5일 수익', '변동성'];
  const labels = [
    ['그 외', '상승 정배열'],
    ['<30', '30–40', '40–50', '50–60', '60–70', '≥70'],
    ['<−2', '−2~−1', '−1~0', '0~1', '1~2', '≥2'],
    ['<−2', '−2~0', '0~2', '≥2'],
    ['하', '중', '상'],
  ];
  const counts = names.map((_, f) => labels[f].map(() => ({ n: 0, t: 0 })));
  let all = 0;
  let allT = 0;
  for (const s of series) {
    s.label.forEach((label, i) => {
      if (!label) return;
      const o = touchOutcome(s.candles, i, X, Y, N);
      if (!o) return;
      all += 1;
      if (o === 'target') allT += 1;
      label.split('|').map(Number).forEach((b, f) => {
        counts[f][b].n += 1;
        if (o === 'target') counts[f][b].t += 1;
      });
    });
  }
  return {
    overall: round((allT / Math.max(1, all)) * 100, 1),
    features: names.map((name, f) => ({
      name,
      bins: labels[f].map((l, b) => ({
        bin: l,
        n: counts[f][b].n,
        hit: round((counts[f][b].t / Math.max(1, counts[f][b].n)) * 100, 1),
      })),
    })),
  };
}

// ── 판정·리포트 ──────────────────────────────────────────────────────────────

/** 이웃 = 같은 시장·같은 손절 비율에서 목표 또는 기간만 한 칸 다른 조합 */
function neighbors(a: ComboResult, b: ComboResult) {
  if (a.market !== b.market || a.ratio !== b.ratio) return false;
  const ti = Math.abs(TARGETS.indexOf(a.target) - TARGETS.indexOf(b.target));
  const hi = Math.abs(HORIZONS.indexOf(a.horizon) - HORIZONS.indexOf(b.horizon));
  return (ti === 1 && hi === 0) || (ti === 0 && hi === 1);
}

const sign = (v: number, unit = '%p') => `${v > 0 ? '+' : ''}${v.toFixed(2)}${unit}`;
const comboName = (r: ComboResult) => `${r.market} +${r.target}%/−${r.stop}% ${r.horizon}일(${r.ratio})`;

async function main() {
  const started = Date.now();
  const universe = JSON.parse(fs.readFileSync(UNIVERSE_PATH, 'utf8')) as Universe;
  const us = [...new Set([...WATCHLIST.filter((s) => !isKrSymbol(s)), ...universe.us.map((e) => e.symbol)])];
  const kr = [...new Set([...WATCHLIST.filter(isKrSymbol), ...universe.kr.map((e) => e.symbol)])];
  console.log(`[research] 유니버스 ${universe.asOf.slice(0, 10)} · 미국 ${us.length} · 국내 ${kr.length}${SHUFFLE ? ' · ⚠️ 결과 섞기 모드' : ''}`);

  const candles = await loadSeries([...us, ...kr]);
  const loadedAt = Math.round((Date.now() - started) / 1000);
  console.log(`[research] 캔들 확보 ${candles.size}종목 (${loadedAt}초)`);

  const results: ComboResult[] = [];
  const leakLog: string[] = [];
  const reference: Record<string, ReturnType<typeof featureReference>> = {};
  const coverage: Record<string, { symbols: number; from: string; to: string; bars: number }> = {};

  for (const [market, list] of [['US', us], ['KR', kr]] as const) {
    const series = list.filter((s) => candles.has(s)).map((s) => buildFeatures(s, candles.get(s)!));
    const calendar = [...new Set(series.flatMap((s) => s.dates))].sort();
    const ordOf = new Map(calendar.map((d, i) => [d, i]));
    for (const s of series) s.ord = s.dates.map((d) => ordOf.get(d)!);
    attachVolatility(series, calendar);
    coverage[market] = { symbols: series.length, from: calendar[0], to: calendar.at(-1)!, bars: calendar.length };
    console.log(`[research] ${market} ${series.length}종목 · ${calendar[0]} ~ ${calendar.at(-1)} (${calendar.length}거래일)`);

    for (const X of TARGETS) {
      for (const N of HORIZONS) {
        for (const ratio of STOP_RATIOS) {
          const probe = X === 5 && N === 10 && ratio === 1 ? { log: leakLog } : null;
          results.push(runCombo(market, series, calendar, X, ratio, N, probe));
        }
      }
    }
    reference[market] = featureReference(series, 5, 5, 10);
  }
  for (const line of leakLog) console.log(line);

  // 판정
  const passed = results.filter((r) => r.passed);
  const isolated =
    passed.length > 0 &&
    passed.length <= 2 &&
    !passed.some((a) => passed.some((b) => a !== b && neighbors(a, b)));
  const conclusion =
    passed.length === 0
      ? '검증 통과 없음 — 이 방법은 아무 날 사는 것보다 낫다는 근거가 없음'
      : isolated
        ? `통과 ${passed.length}개가 서로 이웃하지 않음 — 우연일 가능성 높음 (화면으로 만들 근거로 약함)`
        : `화면으로 만들 가치 있음 (조합 ${passed.map(comboName).join(', ')}) — 단, 36개 중 ${passed.length}개 통과이므로 우연 가능성을 함께 적는다`;

  const elapsed = Math.round((Date.now() - started) / 1000);
  const { dir, server } = outputDir();
  const stamp = new Date().toISOString().slice(0, 10);
  fs.mkdirSync(dir, { recursive: true });
  const base = path.join(dir, `target_screen_${stamp}${SHUFFLE ? '_shuffle' : ''}`);

  const md: string[] = [];
  md.push(`# 목표 수익 후보 선별 — 검증 리포트 (${server} · ${stamp}${SHUFFLE ? ' · ⚠️ 결과 섞기(누설 점검)' : ''})`);
  md.push('');
  md.push('## 요약');
  md.push('');
  md.push(`- **검증 통과 조합: ${passed.length} / ${results.length}**`);
  for (const r of passed) {
    md.push(`  - ${comboName(r)} — 상위 10 기대값 ${sign(r.topEv)} · 기준선 대비 ${sign(r.diff)} (95% 구간 ${sign(r.ciLow)} ~ ${sign(r.ciHigh)})`);
  }
  md.push(`- **결론: ${conclusion}**`);
  if (passed.length) md.push(`- 여러 번 시험한 효과: 36개를 시험하면 우연히 몇 개는 통과할 수 있다(통과 ${passed.length}/36).`);
  md.push('- 한계: 생존 편향(오늘의 시총 상위로 과거를 시험), 기간 3년, 비용 왕복 0.30%p 가정, 미도달은 0 으로 셈(종가 청산 아님).');
  md.push('');
  md.push('---');
  md.push('');
  md.push('## 방법 (시험 전에 고정한 값)');
  md.push('');
  md.push(`- 대상: 관심 ${WATCHLIST.length}종목 + 유니버스(${universe.asOf.slice(0, 10)}, ${universe.source})`);
  for (const [m, c] of Object.entries(coverage)) md.push(`  - ${m}: ${c.symbols}종목 · ${c.from} ~ ${c.to} (${c.bars}거래일)`);
  md.push(`- 이름표: 추세(종가>SMA60 & SMA20>SMA60) · RSI14 6구간 · SMA20 거리(ATR 배수) 6구간 · 5일 수익(ATR 배수) 4구간 · 변동성(그날 시장 ATR% 3분위)`);
  md.push(`- 추정: p = (k종목 + ${PRIOR}·p시장) / (n종목 + ${PRIOR}), 시장 표본 ${MIN_MARKET_SAMPLES} 미만이면 제외. 과거 표본은 결과 확정일 < t 만.`);
  md.push(`- 시험: 최근 ${TEST_MONTHS}개월 매 거래일 기대값 상위 ${TOP} · 기준선(그날 전 종목) · 무작위 ${TOP}종목 ${RANDOM_REPS}회`);
  md.push('- 무작위 10종목은 그날 기준선과 같은 풀에서 뽑으므로 평균이 기준선과 거의 같다 — ④는 사실상 "상위 10 > 기준선" 과 겹친다.');
  md.push(`- 통과: ① 상위 10 기대값 > 0 ② 차이의 95% 구간 하한 > 0 (주 단위 블록 부트스트랩 ${BOOT_REPS}회) ③ 4개월×3구간 중 2구간 이상 우위 ④ 무작위보다 높음`);
  md.push(`- 실행 ${elapsed}초 (캔들 확보 ${loadedAt}초)`);
  md.push('');
  md.push('## 누설 점검');
  md.push('');
  for (const line of leakLog) md.push(`- ${line}`);
  md.push('');
  md.push('## 전체 36개 조합');
  md.push('');
  md.push('| 시장 | 목표 | 손절 | 기간 | 일수 | 상위10 도달 | 기준 도달 | 무작위 도달 | 상위10 기대값 | 기준선 | 무작위 | 차이 | 95% 구간 | 3구간 우위 | ①②③④ | 통과 |');
  md.push('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const r of results) {
    md.push(
      `| ${r.market} | +${r.target}% | −${r.stop}% | ${r.horizon}일 | ${r.days} | ${r.topHit}% | ${r.baseHit}% | ${r.randomHit}% | ${sign(r.topEv)} | ${sign(r.baseEv)} | ${sign(r.randomEv)} | ${sign(r.diff)} | ${sign(r.ciLow)} ~ ${sign(r.ciHigh)} | ${r.segmentWins}/3 | ${r.criteria.map((c) => (c ? '✅' : '❌')).join('')} | ${r.passed ? '✅' : '—'} |`,
    );
  }
  md.push('');
  md.push('구간별(상위 10 / 기준선 기대값):');
  md.push('');
  for (const r of results) {
    md.push(`- ${comboName(r)}: ${r.segments.map((s) => `${s.from}~${s.to} ${sign(s.top)}/${sign(s.base)}`).join(' · ')}`);
  }
  md.push('');
  md.push('## 참고 — 특징 구간별 목표 먼저 비율 (+5%/−5%/10일, 전 기간·표본 안)');
  md.push('');
  md.push('⚠️ 검증이 아니다. 어느 이름표가 과거에 잘 맞았는지 보는 참고용이다.');
  md.push('');
  for (const [m, ref] of Object.entries(reference)) {
    md.push(`### ${m} (전체 ${ref.overall}%)`);
    md.push('');
    for (const f of ref.features) {
      md.push(`- ${f.name}: ${f.bins.map((b) => `${b.bin} ${b.hit}% (${b.n.toLocaleString()})`).join(' · ')}`);
    }
    md.push('');
  }
  md.push('## 유니버스');
  md.push('');
  md.push(`- 기준일 ${universe.asOf} · 출처 ${universe.source}`);
  md.push(`- 미국: ${universe.us.map((e) => e.symbol).join(' ')}`);
  md.push(`- 국내: ${universe.kr.map((e) => `${e.symbol}(${e.name})`).join(' ')}`);
  md.push(`- 캔들 부족(120봉 미만)으로 빠진 종목: ${[...us, ...kr].filter((s) => !candles.has(s)).join(' ') || '없음'}`);
  md.push(`- 제외 ${universe.excluded.length}건: ${universe.excluded.map((e) => `${e.symbol}(${e.reason})`).join(' ')}`);

  fs.writeFileSync(`${base}.md`, md.join('\n'), 'utf8');
  fs.writeFileSync(
    `${base}.json`,
    JSON.stringify({ server, stamp, shuffle: SHUFFLE, elapsed, coverage, universe: { asOf: universe.asOf, source: universe.source }, leakLog, passed: passed.length, conclusion, results, reference }, null, 2),
    'utf8',
  );

  console.log('');
  console.log(md.slice(0, md.indexOf('---')).join('\n'));
  console.log(`리포트: ${base}.md · ${elapsed}초`);
  process.exit(0);
}

void main().catch((e) => {
  console.error('[research] 실패:', e instanceof Error ? e.stack ?? e.message : String(e));
  process.exit(1);
});

