/**
 * 규칙형 자동매매 — 과거 재현의 계산 부품 (v2.31.0).
 * `simulateRule`·`leakCheck` 는 백테스트(`ruleResearch.ts` — 미리 정한 시험·사용자 시험)가 쓴다.
 * 계좌 설정 창의 「과거 1년에 썼다면?」 과 그 라우트(`/api/auto-trading/rule-preview`)·하루 캐시는 v2.38.0 에 지웠다
 * (「실험실 > 백테스트」 가 대신한다). `runRuleBacktest` 는 회귀 비교용으로 남겼다.
 *
 * ⚠️ **주문을 전혀 내지 않는다.** 모의투자·주문 모듈을 import 하지 않는다 — 캔들(`getCandles`)·지표(`computeIndicators`)·
 * 판정(`decideRule`, 실제 엔진과 **같은 함수**)만 쓴다.
 *
 * ── 시험 규칙 (사전 고정 — 결과를 보기 전에 정했다. 결과를 보고 바꾸지 않는다) ─────────────────────────
 * | 항목       | 규칙 |
 * | 기간       | 최근 **250 거래일**(완성 봉). 지표 계산용으로 그 앞 봉을 더 받는다(MA 최대 120 + RSI 워밍업). |
 * | 신호       | `decideRule` 그대로, **완성된 봉 i** 기준 |
 * | 사는 값    | 신호가 난 **다음 거래일 시가** (실제 동작: 전날 마감 신호 → 다음 날 장중 매수) |
 * | 파는 값    | 매도 신호 → 다음 거래일 시가. **하드 손절**: 그날 저가 ≤ 매수가 × (1 − 손절%) 이면 손절가에(시가가 이미 그 아래면 시가).
 * |            | **트레일링**(켰을 때): 종가 기준 고점 × (1 − %) 를 같은 방식으로. 같은 날 여러 조건이면 **손절 먼저**(보수적). |
 * | 비용       | `ROUND_TRIP_COST`(왕복 0.30%p, `analysis/targetHit.ts`) 그대로 |
 * | 기간 끝    | 아직 들고 있으면 마지막 종가로 정리 — 「기간 끝 정리」 로 따로 센다 |
 * | 종목       | 계좌의 대상 종목(없으면 관심 목록, 최대 20). **종목마다 따로** — 비중·동시 보유 한도는 재현하지 않는다 |
 * | 비교 기준  | 같은 종목을 기간 첫날 시가에 사서 마지막 종가에 팔았을 때(그냥 들고 있기, 비용 반영) |
 * | 표본       | 거래 10회 미만이면 「표본 적음」 |
 * | 미래 누설  | 첫 종목에서 봉 i 까지만 잘라 다시 계산한 지표 == 전체로 계산한 지표 를 모든 i 에서 확인 — 다르면 결과를 내지 않는다 |
 */

import { getCandles } from '../candleService';
import { computeIndicators, IndicatorEngineError } from '../indicatorService';
import { ROUND_TRIP_COST } from '../analysis/targetHit';
import { completedDaily, decideRule, pickMa } from './ruleEngine';
import { marketDate } from '../../src/utils/marketDate';
import type { Candle } from '../../src/types/toss';
import type { IndicatorSeries } from '../../src/types/chart';
import type { RuleConfig } from '../../src/types/autoTrading';

export const BACKTEST_DAYS = 250;
/** MA 최대 120 + RSI 14 워밍업 여유 */
const WARMUP = 140;
export const MIN_TRADES = 10;
export const MAX_SYMBOLS = 20;

export interface BacktestOptions {
  rule: RuleConfig;
  hardStopLossPercent: number;
  trailingStopEnabled: boolean;
  trailingStopPercent: number;
  /**
   * 익절 (v2.39.0, 생략 = 꺼짐). 그날 고가 ≥ 매수가 × (1 + %) 이면 `max(시가, 익절가)` 에 판다.
   * 같은 날 순서: 손절 → 익절 → 트레일링 — 손절과 익절이 같은 날 둘 다 닿으면 손절(보수적, 일봉으로는 어느 쪽이 먼저인지 모른다).
   * 꺼져 있으면 결과가 예전과 바이트 단위로 같다.
   */
  takeProfitEnabled?: boolean;
  takeProfitPercent?: number;
}

export type ExitKind = 'signal' | 'stop' | 'take_profit' | 'trailing' | 'end';

export interface BacktestTrade {
  entryDate: string;
  exitDate: string;
  entry: number;
  exit: number;
  /** 비용 반영 수익률(%) */
  returnPct: number;
  holdDays: number;
  exitKind: ExitKind;
  reason: string;
  /** 캔들 배열 위치 (v2.39.0) — 일별 자산 곡선(MDD)에 쓴다 */
  entryIdx: number;
  exitIdx: number;
}

export interface SymbolResult {
  symbol: string;
  trades: number;
  winRate: number | null;
  avgReturn: number | null;
  stopRate: number | null;
  trailingExits: number;
  endExits: number;
  avgHoldDays: number | null;
  /** 이 규칙으로 거래를 이어 붙인 합계 수익률(%) — 매번 전액, 복리 */
  ruleReturn: number;
  /** 그냥 들고 있기(%) */
  holdReturn: number | null;
  weak: boolean;
  from: string | null;
  to: string | null;
  error?: string;
  list: BacktestTrade[];
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * 한 종목 재현 — 순수 함수(캔들·지표를 받는다). 합성 캔들 검산과 실제 재현이 같은 함수를 쓴다.
 * `start` 부터 끝까지가 재현 구간이다(그 앞은 지표 워밍업).
 * `end`(v2.37.0, 생략 가능) — 구간의 마지막 봉. 3년 백테스트(`ruleResearch.ts`)가 1년씩 끊어 쓴다:
 * 그 봉 뒤는 보지 않고, 들고 있으면 그 봉 종가로 정리한다. 생략하면 마지막 봉 — 1년 재현은 예전과 바이트 단위로 같다.
 */
export function simulateRule(
  symbol: string,
  candles: Candle[],
  series: IndicatorSeries,
  start: number,
  opts: BacktestOptions,
  end?: number,
): Omit<SymbolResult, 'symbol'> {
  const list: BacktestTrade[] = [];
  const cost = ROUND_TRIP_COST; // %p
  let position: { entry: number; entryIdx: number; peak: number } | null = null;
  let pending: { action: 'BUY' | 'SELL'; reason: string } | null = null;
  const last = end ?? candles.length - 1;
  const date = (i: number) => marketDate(candles[i].timestamp, symbol);

  const close = (i: number, exit: number, kind: ExitKind, reason: string) => {
    const p = position!;
    list.push({
      entryDate: date(p.entryIdx),
      exitDate: date(i),
      entry: p.entry,
      exit,
      returnPct: round2((exit / p.entry - 1) * 100 - cost),
      holdDays: i - p.entryIdx,
      exitKind: kind,
      reason,
      entryIdx: p.entryIdx,
      exitIdx: i,
    });
    position = null;
  };

  for (let i = start; i <= last; i++) {
    const bar = candles[i];
    // 1) 전날 신호를 오늘 시가에 체결
    if (pending?.action === 'BUY' && !position) {
      position = { entry: bar.open, entryIdx: i, peak: bar.open };
    } else if (pending?.action === 'SELL' && position) {
      close(i, bar.open, 'signal', pending.reason);
    }
    pending = null;

    // 2) 보유 중이면 그날의 손절·트레일링 (같은 날 둘 다면 손절 먼저)
    if (position) {
      const p = position as { entry: number; entryIdx: number; peak: number };
      const stopPrice = p.entry * (1 - opts.hardStopLossPercent / 100);
      const trailPrice = opts.trailingStopEnabled ? p.peak * (1 - opts.trailingStopPercent / 100) : null;
      const takePrice = opts.takeProfitEnabled && opts.takeProfitPercent ? p.entry * (1 + opts.takeProfitPercent / 100) : null;
      if (bar.low <= stopPrice) {
        close(i, Math.min(bar.open, stopPrice), 'stop', `하드 손절 −${opts.hardStopLossPercent}%`);
      } else if (takePrice != null && bar.high >= takePrice) {
        close(i, Math.max(bar.open, takePrice), 'take_profit', `익절 +${opts.takeProfitPercent}%`);
      } else if (trailPrice != null && bar.low <= trailPrice) {
        close(i, Math.min(bar.open, trailPrice), 'trailing', `트레일링 고점 대비 −${opts.trailingStopPercent}%`);
      } else {
        p.peak = Math.max(p.peak, bar.close); // 종가 기준 고점
      }
    }

    // 3) 오늘(완성 봉 i) 판정 → 내일 시가에
    if (i < last) {
      const d = decideRule(series, i, opts.rule, position !== null, date(i));
      if ((d.action === 'BUY' && !position) || (d.action === 'SELL' && position)) {
        pending = { action: d.action, reason: d.reason };
      }
    }
  }
  if (position) close(last, candles[last].close, 'end', '기간 끝 정리');

  const n = list.length;
  const wins = list.filter((t) => t.returnPct > 0).length;
  const stops = list.filter((t) => t.exitKind === 'stop').length;
  const ruleReturn = round2((list.reduce((acc, t) => acc * (1 + t.returnPct / 100), 1) - 1) * 100);
  const firstOpen = candles[start]?.open;
  const holdReturn = firstOpen ? round2((candles[last].close / firstOpen - 1) * 100 - cost) : null;
  return {
    trades: n,
    winRate: n ? round2((wins / n) * 100) : null,
    avgReturn: n ? round2(list.reduce((a, t) => a + t.returnPct, 0) / n) : null,
    stopRate: n ? round2((stops / n) * 100) : null,
    trailingExits: list.filter((t) => t.exitKind === 'trailing').length,
    endExits: list.filter((t) => t.exitKind === 'end').length,
    avgHoldDays: n ? round2(list.reduce((a, t) => a + t.holdDays, 0) / n) : null,
    ruleReturn,
    holdReturn,
    weak: n < MIN_TRADES,
    from: candles[start] ? date(start) : null,
    to: date(last),
    list,
  };
}

/**
 * 일별 자산 곡선 (v2.39.0, MDD 용) — 구간 [start, end] 를 1 에서 시작. 들고 있는 날은 종가로 평가(매수가 대비),
 * 판 날은 그 거래의 비용 반영 수익률로 확정, 안 들고 있는 날은 현금 그대로. 끝 값 = 거래 수익률을 이어 붙인 복리(= ruleReturn).
 */
export function equityCurve(candles: Candle[], start: number, end: number, list: BacktestTrade[]): number[] {
  const out: number[] = [];
  let cash = 1;
  let k = 0;
  for (let i = start; i <= end; i++) {
    const t = list[k];
    if (t && i >= t.entryIdx && i < t.exitIdx) {
      out.push(cash * (candles[i].close / t.entry));
    } else if (t && i === t.exitIdx) {
      cash *= 1 + t.returnPct / 100;
      out.push(cash);
      k++;
      // 같은 날 판 다음 거래가 그날 사는 일은 없다(체결은 다음 날 시가) — 그래도 남은 거래가 같은 날이면 넘긴다
      while (list[k] && list[k].exitIdx === i) {
        cash *= 1 + list[k].returnPct / 100;
        k++;
      }
    } else {
      out.push(cash);
    }
  }
  return out;
}

/** 그냥 들고 있기 자산 곡선 — 구간 첫날 시가에 사서 종가로 평가, 마지막 날은 비용 반영(= holdReturn) */
export function holdCurve(candles: Candle[], start: number, end: number): number[] {
  const first = candles[start].open;
  const out: number[] = [];
  for (let i = start; i <= end; i++) out.push(candles[i].close / first);
  out[out.length - 1] = 1 + ((candles[end].close / first - 1) * 100 - ROUND_TRIP_COST) / 100;
  return out;
}

/**
 * 미래 누설 검사 — 봉 i 까지만 잘라 다시 계산한 지표가 전체 계산과 같은지(판정에 쓰는 선: 단기·장기 MA, RSI, 봉 i-1·i).
 * 다르면 그 i 를 돌려준다(없으면 null).
 * `extraMa`(v2.39.0) — 조건을 비교할 때 다른 조건이 쓰는 이동평균 일수도 함께 본다(생략하면 예전과 같다).
 */
export async function leakCheck(candles: Candle[], series: IndicatorSeries, start: number, rule: RuleConfig, extraMa: number[] = []): Promise<string | null> {
  const lines = (s: IndicatorSeries) => [pickMa(s, rule.maShort).line, pickMa(s, rule.maLong).line, s.rsi14, ...extraMa.map((p) => pickMa(s, p).line)];
  const full = lines(series);
  for (let i = start; i < candles.length; i++) {
    const part = lines(await computeIndicators(candles.slice(0, i + 1)));
    for (let k = 0; k < full.length; k++) {
      for (const j of [i - 1, i]) {
        const a = full[k][j];
        const b = part[k][j];
        if (a == null && b == null) continue;
        if (a == null || b == null || Math.abs(a - b) > 1e-6 * Math.max(1, Math.abs(a))) {
          return `봉 ${i}(${j}) 선 ${k}: 전체 ${a} vs 잘라서 ${b}`;
        }
      }
    }
  }
  return null;
}

export interface BacktestResult {
  rule: RuleConfig;
  hardStopLossPercent: number;
  trailingStopEnabled: boolean;
  trailingStopPercent: number;
  days: number;
  symbols: SymbolResult[];
  /** 종목별 결과의 단순 평균(동일 가중) */
  summary: {
    symbols: number;
    avgTrades: number | null;
    avgWinRate: number | null;
    avgReturn: number | null;
    avgRuleReturn: number | null;
    avgHoldReturn: number | null;
    totalTrades: number;
    weak: boolean;
    /** 거래 10회 미만 종목 수 (v2.37.0) — 화면이 「M개 중 K개」·결론 배지에 쓴다 */
    weakSymbols: number;
  };
  leakCheck: { symbol: string; bars: number; ok: boolean };
  computedAt: string;
}

const mean = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x != null);
  return v.length ? round2(v.reduce((a, b) => a + b, 0) / v.length) : null;
};

export async function runRuleBacktest(
  input: { symbols: string[] } & BacktestOptions,
  onProgress?: (done: number, total: number, current: string) => void,
): Promise<BacktestResult> {
  const symbols = input.symbols.slice(0, MAX_SYMBOLS);
  const out: SymbolResult[] = [];
  let leak: BacktestResult['leakCheck'] = { symbol: '', bars: 0, ok: true };
  for (let n = 0; n < symbols.length; n++) {
    const symbol = symbols[n];
    onProgress?.(n, symbols.length, symbol);
    try {
      const candles = completedDaily(await getCandles(symbol, '1d', BACKTEST_DAYS + WARMUP), symbol);
      if (candles.length < BACKTEST_DAYS + 30) throw new Error(`일봉이 ${candles.length}개뿐입니다`);
      const series = await computeIndicators(candles);
      const start = candles.length - BACKTEST_DAYS;
      if (!leak.symbol) {
        // 첫 종목에서 매번 확인 — 다르면 결과를 내지 않는다
        const bad = await leakCheck(candles, series, start, input.rule);
        leak = { symbol, bars: candles.length - start, ok: !bad };
        console.log(`[rule-backtest] 미래 누설 검사 ${symbol} ${leak.bars}봉: ${bad ? `실패 — ${bad}` : '통과'}`);
        if (bad) throw new LeakError(`미래 누설 검사 실패(${symbol}): ${bad}`);
      }
      out.push({ symbol, ...simulateRule(symbol, candles, series, start, input) });
    } catch (e) {
      if (e instanceof LeakError) throw e;
      if (e instanceof IndicatorEngineError) throw e; // 엔진 꺼짐은 0 으로 꾸미지 않는다
      out.push({
        symbol, trades: 0, winRate: null, avgReturn: null, stopRate: null, trailingExits: 0, endExits: 0, avgHoldDays: null,
        ruleReturn: 0, holdReturn: null, weak: true, from: null, to: null, error: (e as Error).message, list: [],
      });
    }
  }
  onProgress?.(symbols.length, symbols.length, '');
  const ok = out.filter((r) => !r.error);
  const totalTrades = ok.reduce((a, r) => a + r.trades, 0);
  return {
    rule: input.rule,
    hardStopLossPercent: input.hardStopLossPercent,
    trailingStopEnabled: input.trailingStopEnabled,
    trailingStopPercent: input.trailingStopPercent,
    days: BACKTEST_DAYS,
    symbols: out,
    summary: {
      symbols: ok.length,
      avgTrades: mean(ok.map((r) => r.trades)),
      avgWinRate: mean(ok.map((r) => r.winRate)),
      avgReturn: mean(ok.map((r) => r.avgReturn)),
      avgRuleReturn: mean(ok.map((r) => r.ruleReturn)),
      avgHoldReturn: mean(ok.map((r) => r.holdReturn)),
      totalTrades,
      weak: totalTrades < MIN_TRADES,
      weakSymbols: ok.filter((r) => r.weak).length,
    },
    leakCheck: leak,
    computedAt: new Date().toISOString(),
  };
}

export class LeakError extends Error {}
