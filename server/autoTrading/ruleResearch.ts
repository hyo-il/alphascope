/**
 * 백테스트 — 「퀀트 > 백테스트」 사용자 시험(`runCustomBacktest`). 사용자가 고른 종목 · 방법(매매 규칙 1~3개) · 기간(1~3년).
 * 판단은 계좌와 같은 엔진(`ruleBacktest.simulateRule` → `evaluateRule`). 판정 배지 없음.
 * 구간 나누기 · 아무 날이나 기준선(`randomBaseline`) · 미래 누설 검사 · MDD · Profit Factor · SPY 비교는 v2.37~v2.41 그대로다.
 * v2.44.0 에 예전 「미리 정한 시험」(교차 계산기 고정 3년 — `runRuleResearch` · 판정 · 보고서 md)을 지웠다.
 *
 * ⚠️ **주문을 전혀 내지 않는다.** 모의투자·주문 모듈을 import 하지 않는다.
 */

import { profitFactor } from '../../src/utils/profitFactor';
import { getCandles } from '../candleService';
import { computeIndicators, IndicatorEngineError } from '../indicatorService';
import { ROUND_TRIP_COST } from '../analysis/targetHit';
import { completedDaily } from '../rules/engine';
import { LeakError, equityCurve, holdCurve, leakCheck, MIN_TRADES, simulateRule } from './ruleBacktest';
import { maxDrawdown } from '../../src/utils/drawdown';
import { readUniverse } from '../universe';
import { profiles, sectorKo } from '../heatmap';
import { findNames } from '../stockCatalog';
import { refreshEarnings } from '../earningsCalendar';
import { marketDate } from '../../src/utils/marketDate';
import type { Candle } from '../../src/types/toss';
import type { IndicatorSeries } from '../../src/types/chart';
import type { RuleBody } from '../../src/types/tradingRule';
import {
  BACKTEST_SECTORS,
  type BacktestConditionResult,
  type BacktestCustomReport,
  type BacktestCustomStats,
  type BacktestCustomSymbol,
  type BacktestExitName,
  type BacktestInput,
} from '../../src/types/backtest';

export const SEGMENT_DAYS = 252;
/** 받는 일봉 = 기간 + 이만큼(지표 준비) */
const WARMUP = 140;
/**
 * 지표 준비에 필요한 끝난 봉 — 120일선 · 120일 고점(참고 계획) · 60일선 기울기가 구간 첫날에 값을 가져야 한다.
 * 예전 교차 규칙은 장기 이동평균 + 1 이었다 — 규칙의 점수 조건이 더 긴 지표를 쓴다(v2.44.0).
 */
const WARMUP_NEEDED = 130;
const RANDOM_RUNS = 200;

const round2 = (v: number) => Math.round(v * 100) / 100;
const mean = (xs: (number | null | undefined)[]) => {
  const v = xs.filter((x): x is number => x != null && Number.isFinite(x));
  return v.length ? round2(v.reduce((a, b) => a + b, 0) / v.length) : null;
};
const compound = (rs: number[]) => round2((rs.reduce((acc, r) => acc * (1 + r / 100), 1) - 1) * 100);

/** 시드 고정 난수 — mulberry32 */
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
function hashSeed(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * 기준선 2 — 같은 횟수·같은 보유일로 겹치지 않는 무작위 진입, 200번 평균 (사전 등록 표).
 * 거래 하나는 진입 봉 ~ 청산 봉(h+1 봉)을 차지한다. 남는 봉을 n+1 틈에 무작위로 나누고 거래 순서도 섞는다.
 */
export function randomBaseline(candles: Candle[], start: number, end: number, holdDays: number[], seed: number): number | null {
  const n = holdDays.length;
  if (!n) return 0;
  const span = end - start + 1;
  const used = holdDays.reduce((a, h) => a + h + 1, 0);
  const free = span - used;
  if (free < 0) return null;
  const cost = ROUND_TRIP_COST;
  const rand = rng(seed);
  let total = 0;
  for (let run = 0; run < RANDOM_RUNS; run++) {
    // 틈 나누기: free 개의 빈 봉을 n+1 칸에 (막대와 별 — n 개 칸막이 위치를 고른다)
    const cuts: number[] = [];
    for (let k = 0; k < n; k++) cuts.push(Math.floor(rand() * (free + 1)));
    cuts.sort((a, b) => a - b);
    const order = holdDays.map((h, i) => ({ h, key: rand(), i })).sort((a, b) => a.key - b.key);
    let pos = start;
    let prevCut = 0;
    let acc = 1;
    for (let k = 0; k < n; k++) {
      pos += cuts[k] - prevCut;
      prevCut = cuts[k];
      const h = order[k].h;
      const entry = candles[pos].open;
      const exit = h > 0 ? candles[pos + h].open : candles[pos].close;
      acc *= 1 + ((exit / entry - 1) * 100 - cost) / 100;
      pos += h + 1;
    }
    total += (acc - 1) * 100;
  }
  return round2(total / RANDOM_RUNS);
}

interface Target {
  symbol: string;
  name: string | null;
  sector: string;
}

/** 대상 고르기 — 섹터가 빈 종목은 한 번 채워 본다 */
export async function researchTargets(): Promise<{ asOf: string; included: Target[]; outOfSector: Target[]; unknown: { symbol: string; name: string | null }[] }> {
  const u = readUniverse();
  const list = u.us.map((e) => ({ symbol: e.symbol.toUpperCase(), name: e.name ?? null }));
  let prof = profiles(list.map((e) => e.symbol));
  const missing = list.filter((e) => !prof.get(e.symbol)?.sector).map((e) => e.symbol);
  if (missing.length) {
    try {
      await refreshEarnings(missing);
    } catch (e) {
      console.warn('[rule-research] 섹터 채우기 실패 — 미확인으로 뺍니다:', (e as Error).message);
    }
    prof = profiles(list.map((e) => e.symbol));
  }
  const included: Target[] = [];
  const outOfSector: Target[] = [];
  const unknown: { symbol: string; name: string | null }[] = [];
  for (const e of list) {
    const raw = prof.get(e.symbol)?.sector;
    if (!raw) {
      unknown.push(e);
      continue;
    }
    const sector = sectorKo(raw);
    if ((BACKTEST_SECTORS as readonly string[]).includes(sector)) included.push({ ...e, sector });
    else outOfSector.push({ ...e, sector });
  }
  return { asOf: u.asOf, included, outOfSector, unknown };
}

export interface ResearchProgress {
  (done: number, total: number, current: string): void;
}

// ── 내가 고른 종목 · 내가 정한 조건 (v2.38.0) · 조건 비교·MDD·Profit Factor·익절 (v2.39.0) ─────────────

/** 종목·기간·방법(규칙 내용까지) 전체가 같으면 같은 결과 — 같은 날 다시 계산하지 않는 비교 키(종목 순서는 무시) */
export function customInputKey(input: BacktestInput): string {
  return JSON.stringify([[...input.symbols].sort(), input.years, input.conditions.map((c) => [c.ruleId, c.rule])]);
}

/** 종목 이름·분야 — 이름은 카탈로그(한글) → 유니버스, 분야는 stock_profiles(없으면 null). 여기서 yfinance 를 부르지 않는다 */
export function namesAndSectors(symbols: string[]): Map<string, { name: string | null; sector: string | null }> {
  const catalog = findNames(symbols);
  let uni = new Map<string, string>();
  try {
    const u = readUniverse();
    uni = new Map([...u.us, ...u.kr].map((e) => [e.symbol.toUpperCase(), e.name]));
  } catch {
    /* 유니버스 파일이 없어도 이름만 비게 둔다 */
  }
  const prof = profiles(symbols);
  return new Map(
    symbols.map((sym) => {
      const raw = prof.get(sym)?.sector;
      return [sym, { name: catalog[sym] ?? uni.get(sym) ?? null, sector: raw ? sectorKo(raw) : null }];
    }),
  );
}

export type Cell = {
  rule: number;
  hold: number | null;
  random: number | null;
  trades: number;
  list: { returnPct: number; exitKind: string }[];
  /** 그 구간의 일별 자산 곡선(1 에서 시작) — MDD 용 (v2.39.0) */
  curve: number[];
};

const EXIT_NAMES = ['signal', 'stop', 'take_profit', 'trailing', 'end'] as const;

/** 구간 곡선을 복리로 이어 붙인다(다음 구간은 앞 구간 끝 값에서 시작) */
function chainCurves(curves: number[][]): number[] {
  const out: number[] = [];
  let base = 1;
  for (const c of curves) {
    for (const v of c) out.push(base * v);
    base *= c[c.length - 1] ?? 1;
  }
  return out;
}

/**
 * 한 종목을 1년(252봉)씩 `years` 구간으로 — 순수 함수(합성 캔들 검산과 실제 시험이 같은 함수).
 * 시험 기간 = 마지막 `252 × years` 봉. 구간마다 `simulateRule(…, end)` 와 같은 횟수·보유일의 무작위 기준선.
 * 시드는 조건과 무관(`custom|종목|구간`) — 같은 거래 횟수·보유일이면 같은 기준선이 나와 조건끼리 공정하게 비교된다.
 */
export function simulateSegments(symbol: string, candles: Candle[], series: IndicatorSeries, years: number, rule: RuleBody) {
  const first = candles.length - SEGMENT_DAYS * years;
  const date = (i: number) => marketDate(candles[i].timestamp, symbol);
  const bounds = Array.from({ length: years }, (_, k) => {
    const start = first + k * SEGMENT_DAYS;
    return { start, end: start + SEGMENT_DAYS - 1 };
  });
  const segs = bounds.map((b, k): Cell => {
    const r = simulateRule(symbol, candles, series, b.start, rule, b.end);
    const random = randomBaseline(candles, b.start, b.end, r.list.map((t) => t.holdDays), hashSeed(`custom|${symbol}|${k}`));
    return {
      rule: r.ruleReturn,
      hold: r.holdReturn,
      random,
      trades: r.trades,
      list: r.list.map((t) => ({ returnPct: t.returnPct, exitKind: t.exitKind })),
      curve: equityCurve(candles, b.start, b.end, r.list),
    };
  });
  const holdCurves = bounds.map((b) => holdCurve(candles, b.start, b.end));
  return { segs, holdCurves, dates: bounds.map((b) => ({ from: date(b.start), to: date(b.end) })) };
}

const toMdd = (curve: number[]) => {
  const v = maxDrawdown(curve);
  return v == null ? null : round2(v);
};

/** 셀 묶음 → 종목 평균 숫자 (요약·구간 표 공용). 20차 칸(앞 8개)은 계산이 그대로다 */
export function customStats(cells: Cell[], who: { symbol: string; name: string | null }[]): BacktestCustomStats {
  const per = cells.map((c) => {
    const n = c.list.length;
    return {
      rule: c.rule,
      hold: c.hold,
      random: c.random,
      trades: c.trades,
      avg: n ? round2(c.list.reduce((a, t) => a + t.returnPct, 0) / n) : null,
      win: n ? round2((c.list.filter((t) => t.returnPct > 0).length / n) * 100) : null,
      mdd: toMdd(c.curve),
    };
  });
  // MDD — 종목 평균과 가장 나쁜 종목
  let worst: BacktestCustomStats['mddWorst'] = null;
  per.forEach((p, i) => {
    if (p.mdd != null && (worst == null || p.mdd < worst.value)) worst = { ...who[i], value: p.mdd };
  });
  // Profit Factor — 모든 종목·모든 거래를 모아 (+ 합) ÷ |− 합|
  const all = cells.flatMap((c) => c.list);
  const pf = profitFactor(all.map((t) => t.returnPct));
  const exits = Object.fromEntries(
    EXIT_NAMES.map((k) => [k, all.length ? round2((all.filter((t) => t.exitKind === k).length / all.length) * 100) : 0]),
  ) as Record<BacktestExitName, number>;
  return {
    symbols: cells.length,
    rule: mean(per.map((p) => p.rule)),
    hold: mean(per.map((p) => p.hold)),
    random: mean(per.map((p) => p.random)),
    avgTradeReturn: mean(per.map((p) => p.avg)),
    winRate: mean(per.map((p) => p.win)),
    avgTrades: mean(per.map((p) => p.trades)),
    weakSymbols: per.filter((p) => p.trades < MIN_TRADES).length,
    mdd: mean(per.map((p) => p.mdd)),
    mddWorst: worst,
    profitFactor: pf.value != null ? round2(pf.value) : null,
    profitFactorNote: pf.note as '손실 거래 없음' | '거래 없음' | null,
    exits: all.length ? exits : null,
  };
}

/**
 * 사용자 시험 본체 — 같은 종목·같은 기간에 조건 1~3개. 종목마다 캔들·지표를 **한 번** 받아 모든 조건에 쓴다.
 * 구간 = 1년(252 완성 거래일)씩 `years` 개, 구간마다 빈손으로 시작해 끝 종가로 정리(고정 시험과 같다). 기간 전체 = 구간 수익률 복리.
 * 일봉이 모자라거나 오류가 난 종목은 `excluded` 에 이유와 함께 — 조용히 빼지 않는다.
 * 미래 누설: 첫 종목(계산되는)에서 `leakCheck` 한 번 — 조건들이 쓰는 이동평균을 모두 본다. 실패하면 결과를 내지 않는다(LeakError).
 * ⚠️ 주문을 내지 않는다.
 */
/** 같은 기간 비교용 — 미국 시장 전체를 따르는 ETF(지수 자체가 아니다) */
const SPY = 'SPY';

export async function runCustomBacktest(input: BacktestInput, onProgress?: ResearchProgress): Promise<BacktestCustomReport> {
  const t0 = Date.now();
  let indicatorCalls = 0;
  let rssMax = process.memoryUsage().rss;
  const sample = () => (rssMax = Math.max(rssMax, process.memoryUsage().rss));
  const days = SEGMENT_DAYS * input.years;
  const warmup = WARMUP_NEEDED;
  const info = namesAndSectors(input.symbols);
  const rules = input.conditions.map((c) => c.rule);

  const done: { symbol: string; segsBy: Cell[][]; holdCurves: number[][]; dates: { from: string; to: string }[] }[] = [];
  const excluded: BacktestCustomReport['excluded'] = [];
  let leak: BacktestCustomReport['leakCheck'] = { symbol: '', bars: 0, ok: true };
  const total = input.symbols.length;

  for (let n = 0; n < total; n++) {
    const symbol = input.symbols[n];
    onProgress?.(n, total, symbol);
    try {
      const candles = completedDaily(await getCandles(symbol, '1d', days + WARMUP), symbol);
      if (candles.length < days + warmup) {
        throw new Error(`일봉이 ${candles.length}개뿐입니다 — ${input.years}년 시험에 ${days}개 + 지표 준비 ${warmup}개가 필요합니다(상장이 짧은 종목 등)`);
      }
      const series: IndicatorSeries = await computeIndicators(candles);
      indicatorCalls++;
      const first = candles.length - days;
      if (!leak.symbol) {
        // 누설 검사: 모든 방법의 판단(보유·미보유)을 봉마다 — 지표를 잘라 다시 계산해 같은지
        const bad = await leakCheck(symbol, candles, series, first, rules);
        indicatorCalls += candles.length - first;
        leak = { symbol, bars: candles.length - first, ok: !bad };
        console.log(`[backtest] 미래 누설 검사 ${symbol} ${leak.bars}봉: ${bad ? `실패 — ${bad}` : '통과'}`);
        if (bad) throw new LeakError(`미래 누설 검사 실패(${symbol}): ${bad}`);
      }
      const runs = rules.map((r) => simulateSegments(symbol, candles, series, input.years, r));
      done.push({ symbol, segsBy: runs.map((r) => r.segs), holdCurves: runs[0].holdCurves, dates: runs[0].dates });
    } catch (e) {
      if (e instanceof LeakError || e instanceof IndicatorEngineError) throw e; // 엔진 꺼짐·누설은 결과로 꾸미지 않는다
      excluded.push({ symbol, name: info.get(symbol)?.name ?? null, reason: (e as Error).message });
    }
    sample();
  }
  // 같은 기간 SPY 그냥 들고 있기 (v2.41.0) — 종목의 「그냥 들고 있기」 와 **같은 함수**(simulateSegments 의 holdReturn)·같은 기간·
  // 같은 구간 복리. 비교 기준일 뿐 판정·"좋음" 표시는 없다. 고른 종목에 SPY 가 있으면 그 계산을 그대로 쓴다.
  let spy: BacktestCustomReport['spy'];
  try {
    const mine = done.find((d) => d.symbol === SPY);
    let segs: Cell[];
    let dates: { from: string; to: string }[];
    if (mine) {
      segs = mine.segsBy[0];
      dates = mine.dates;
    } else {
      const candles = completedDaily(await getCandles(SPY, '1d', days + WARMUP), SPY);
      if (candles.length < days + warmup) throw new Error('short');
      const series: IndicatorSeries = await computeIndicators(candles);
      indicatorCalls++;
      const run = simulateSegments(SPY, candles, series, input.years, rules[0]);
      segs = run.segs;
      dates = run.dates;
    }
    const hold = segs.every((c) => c.hold != null) ? compound(segs.map((c) => c.hold!)) : null;
    spy = hold == null || !dates.length ? { error: 'SPY 일봉이 모자라 비교하지 못했습니다' } : { hold, from: dates[0].from, to: dates[dates.length - 1].to };
  } catch (e) {
    if (e instanceof IndicatorEngineError) throw e;
    spy = { error: 'SPY 일봉이 모자라 비교하지 못했습니다' };
  }

  // 기간 전체 셀(구간 복리, 거래 목록·자산 곡선은 이어 붙인다)
  const whole = (segs: Cell[]): Cell => ({
    rule: compound(segs.map((c) => c.rule)),
    hold: segs.every((c) => c.hold != null) ? compound(segs.map((c) => c.hold!)) : null,
    random: segs.every((c) => c.random != null) ? compound(segs.map((c) => c.random!)) : null,
    trades: segs.reduce((a, c) => a + c.trades, 0),
    list: segs.flatMap((c) => c.list),
    curve: chainCurves(segs.map((c) => c.curve)),
  });
  const who = done.map((d) => ({ symbol: d.symbol, name: info.get(d.symbol)?.name ?? null }));
  const segDates = done[0]?.dates ?? [];

  const conditions: BacktestConditionResult[] = input.conditions.map((condition, ci) => {
    const wholeCells = done.map((d) => whole(d.segsBy[ci]));
    const summary = customStats(wholeCells, who);
    const segmentRows =
      input.years > 1 ? segDates.map((d, k) => ({ segment: k + 1, ...d, ...customStats(done.map((x) => x.segsBy[ci][k]), who) })) : [];
    const symbols: BacktestCustomSymbol[] = done.map((d, i) => {
      const c = wholeCells[i];
      const n = c.list.length;
      return {
        symbol: d.symbol,
        name: info.get(d.symbol)?.name ?? null,
        sector: info.get(d.symbol)?.sector ?? null,
        trades: c.trades,
        winRate: n ? round2((c.list.filter((t) => t.returnPct > 0).length / n) * 100) : null,
        avgReturn: n ? round2(c.list.reduce((a, t) => a + t.returnPct, 0) / n) : null,
        stopRate: n ? round2((c.list.filter((t) => t.exitKind === 'stop').length / n) * 100) : null,
        rule: c.rule,
        hold: c.hold,
        random: c.random,
        mdd: toMdd(c.curve),
        holdMdd: toMdd(chainCurves(d.holdCurves)),
      };
    });
    return {
      label: condition.label,
      condition,
      summary: { ...summary, hardToTell: summary.symbols === 0 || summary.weakSymbols * 2 >= summary.symbols },
      segmentRows,
      symbols,
    };
  });

  // 그냥 들고 있기 — 조건과 무관
  const holdMdds = done.map((d) => toMdd(chainCurves(d.holdCurves)));
  let holdWorst: BacktestCustomReport['hold']['mddWorst'] = null;
  holdMdds.forEach((v, i) => {
    if (v != null && (holdWorst == null || v < holdWorst.value)) holdWorst = { ...who[i], value: v };
  });

  sample();
  return {
    kind: 'custom',
    input,
    segments: segDates.map((d, k) => ({ segment: k + 1, ...d })),
    conditions,
    hold: { rule: conditions[0]?.summary.hold ?? null, mdd: mean(holdMdds), mddWorst: holdWorst },
    excluded,
    leakCheck: leak,
    spy,
    measure: { ms: Date.now() - t0, indicatorCalls, rssMaxMb: Math.round(rssMax / 1048576), symbols: total },
    computedAt: new Date().toISOString(),
  };
}
