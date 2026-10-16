/**
 * 백테스트 재현 부품 (v2.44.0 — 매매 규칙 엔진). `simulateRule` · `leakCheck` 는 사용자 시험(`ruleResearch.ts`)이 쓴다.
 *
 * ⚠️ **주문을 전혀 내지 않는다.** 판단은 계좌와 **같은 함수** `evaluateRule`(`server/rules/engine.ts`) 하나다.
 *
 * ── 재현 규칙 (v2.31.0 구조 그대로, 판단만 새 엔진) ──────────────────────────────────────────
 * | 신호       | 끝난 봉 i 로 `evaluateRule` (state = 보유 · 매수가 · 최고가 · 손절한 날) — 손익비 1 미만 막음은 **항상**(시험 스크립트만 끈다) |
 * | 사는 값    | 신호가 난 **다음 거래일 시가** |
 * | 파는 값    | 매도 신호 → 다음 거래일 시가. 보유 중이면 그날 규칙의 매도 조건: 손절 = 저가 ≤ 손절가면 `min(시가, 손절가)` ·
 * |            | 익절 = 고가 ≥ 익절가면 `max(시가, 익절가)` · 트레일링 = 저가 ≤ 최고가×(1−%)면 `min(시가, 그 값)`. 같은 날 순서 손절 → 익절 → 트레일링 |
 * |            | 꺼진 조건은 보지 않는다. 트레일링 최고가는 **종가 기준**(계좌는 1분 시세 — 남은 차이, 나중 「내용」 단계) |
 * | 손절 뒤    | 손절로 판 날을 `lastStopDate` 로 넘긴다(계좌와 같은 뜻 — 트레일링·익절·신호 매도는 넣지 않는다) |
 * | 비용       | `ROUND_TRIP_COST`(왕복 0.30%p) |
 * | 기간 끝    | 아직 들고 있으면 마지막 종가로 정리 — 「기간 끝 정리」 |
 * | 미래 누설  | 봉 i 까지 잘라 다시 계산한 지표로 낸 판단 == 전체로 낸 판단 (모든 i, 보유·미보유) — 다르면 결과를 내지 않는다 |
 */

import { computeIndicators } from '../indicatorService';
import { ROUND_TRIP_COST } from '../analysis/targetHit';
import { evaluateRule, exitLevels, type EvaluateOptions, type MarketRefData } from '../rules/engine';
import { marketDate } from '../../src/utils/marketDate';
import type { Candle } from '../../src/types/toss';
import type { IndicatorSeries } from '../../src/types/chart';
import { usesMarketFilter, type RuleBody } from '../../src/types/tradingRule';

export const MIN_TRADES = 10;

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
  /** 캔들 배열 위치 — 일별 자산 곡선(MDD)에 쓴다 */
  entryIdx: number;
  exitIdx: number;
}

export interface SimResult {
  trades: number;
  winRate: number | null;
  avgReturn: number | null;
  /** 이 규칙으로 거래를 이어 붙인 합계 수익률(%) — 매번 전액, 복리 */
  ruleReturn: number;
  /** 그냥 들고 있기(%) */
  holdReturn: number | null;
  list: BacktestTrade[];
}

const round2 = (v: number) => Math.round(v * 100) / 100;

/**
 * 한 종목 재현 — 순수 함수(캔들·지표를 받는다). `start` 부터 `end`(생략 = 마지막 봉)까지가 재현 구간이다(그 앞은 지표 워밍업).
 * `opts` 는 시험 스크립트용(`testOnlySkipRrGuard`) — 화면·API 는 넘기지 않는다.
 */
export function simulateRule(
  symbol: string,
  candles: Candle[],
  series: IndicatorSeries,
  start: number,
  rule: RuleBody,
  end?: number,
  opts: EvaluateOptions = {},
  /** 시장 기준(v2.51.0 — 시장 필터를 켠 규칙). 날짜로 맞춰 쓴다 */
  market?: MarketRefData | null,
): SimResult {
  const list: BacktestTrade[] = [];
  const cost = ROUND_TRIP_COST; // %p
  let position: { entry: number; entryIdx: number; peak: number } | null = null;
  let pending: { action: 'BUY' | 'SELL'; reason: string } | null = null;
  let lastStopDate: string | null = null;
  const last = end ?? candles.length - 1;
  const date = (i: number) => marketDate(candles[i].timestamp, symbol);
  const ctx = { symbol, candles, series, ...(market !== undefined ? { market } : {}) };

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
    if (kind === 'stop') lastStopDate = date(i);
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

    // 2) 보유 중이면 그날의 손절 → 익절 → 트레일링 (규칙의 매도 조건 — 꺼진 것은 보지 않는다)
    if (position) {
      const p = position as { entry: number; entryIdx: number; peak: number };
      const lv = exitLevels(rule, { held: true, avgPrice: p.entry, peak: p.peak });
      if (lv.stop != null && bar.low <= lv.stop) {
        close(i, Math.min(bar.open, lv.stop), 'stop', `손절 −${rule.sell.stopLoss.percent}%`);
      } else if (lv.takeProfit != null && bar.high >= lv.takeProfit) {
        close(i, Math.max(bar.open, lv.takeProfit), 'take_profit', `익절 +${rule.sell.takeProfit.percent}%`);
      } else if (lv.trailing != null && bar.low <= lv.trailing) {
        close(i, Math.min(bar.open, lv.trailing), 'trailing', `트레일링 고점 대비 −${rule.sell.trailing.percent}%`);
      } else {
        p.peak = Math.max(p.peak, bar.close); // 종가 기준 고점
      }
    }

    // 3) 오늘(끝난 봉 i) 판단 → 내일 시가에
    if (i < last) {
      const p = position as { entry: number; entryIdx: number; peak: number } | null;
      const ev = evaluateRule(ctx, i, rule, { held: p !== null, avgPrice: p?.entry, peak: p?.peak, lastStopDate }, opts);
      if ((ev.action === 'BUY' && !p) || (ev.action === 'SELL' && p)) pending = { action: ev.action, reason: ev.reasons[0] ?? '' };
    }
  }
  if (position) close(last, candles[last].close, 'end', '기간 끝 정리');

  const n = list.length;
  const wins = list.filter((t) => t.returnPct > 0).length;
  const firstOpen = candles[start]?.open;
  return {
    trades: n,
    winRate: n ? round2((wins / n) * 100) : null,
    avgReturn: n ? round2(list.reduce((a, t) => a + t.returnPct, 0) / n) : null,
    ruleReturn: round2((list.reduce((acc, t) => acc * (1 + t.returnPct / 100), 1) - 1) * 100),
    holdReturn: firstOpen ? round2((candles[last].close / firstOpen - 1) * 100 - cost) : null,
    list,
  };
}

/**
 * 일별 자산 곡선 (MDD 용) — 구간 [start, end] 를 1 에서 시작. 들고 있는 날은 종가로 평가(매수가 대비),
 * 판 날은 그 거래의 비용 반영 수익률로 확정, 안 들고 있는 날은 현금 그대로.
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
 * 미래 누설 검사 — 봉 i 까지만 잘라 다시 계산한 지표로 낸 판단이 전체로 낸 판단과 같은지(보유·미보유, 규칙마다).
 * 다르면 그 i 를 돌려준다(없으면 null).
 */
export async function leakCheck(
  symbol: string,
  candles: Candle[],
  series: IndicatorSeries,
  start: number,
  rules: RuleBody[],
  /** 시장 기준(v2.51.0) — 있으면 시장 기준도 그 날짜까지 잘라 지표를 다시 계산해 넣는다(시장 필터를 켠 규칙만) */
  market?: MarketRefData | null,
): Promise<string | null> {
  const full = { symbol, candles, series, ...(market !== undefined ? { market } : {}) };
  const useMarket = market != null && rules.some((r) => usesMarketFilter(r));
  let lastCut: MarketRefData | null = null;
  for (let i = start; i < candles.length; i++) {
    const cut = candles.slice(0, i + 1);
    let partMarket: MarketRefData | null | undefined = market;
    if (useMarket) {
      // 그 날짜까지의 시장 기준 끝난 봉만 — 미래 봉을 넣지 않고 다시 계산한 200일선으로도 같은 판단이 나와야 한다
      const day = marketDate(candles[i].timestamp, symbol);
      const refCut = market!.candles.filter((c) => marketDate(c.timestamp, market!.symbol) <= day);
      // 봉 수가 같으면 앞에서 계산한 것을 다시 쓴다(시장 기준 지표는 그 날짜까지의 봉에만 달렸다)
      if (lastCut && lastCut.candles.length === refCut.length) partMarket = lastCut;
      else partMarket = lastCut = refCut.length ? { ...market!, candles: refCut, series: await computeIndicators(refCut) } : null;
    }
    const part = { symbol, candles: cut, series: await computeIndicators(cut), ...(partMarket !== undefined ? { market: partMarket } : {}) };
    for (const [k, rule] of rules.entries()) {
      for (const held of [false, true]) {
        const a = JSON.stringify(evaluateRule(full, i, rule, { held }));
        const b = JSON.stringify(evaluateRule(part, i, rule, { held }));
        if (a !== b) return `봉 ${i} 방법 ${k + 1} (${held ? '보유' : '미보유'}): 전체와 잘라서 계산한 판단이 다릅니다`;
      }
    }
  }
  return null;
}

export class LeakError extends Error {}
