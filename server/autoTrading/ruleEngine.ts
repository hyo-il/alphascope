/**
 * 규칙형 전략의 매수·매도 판정.
 *
 * 지표는 **기존 경로를 그대로 쓴다** — `getCandles`(SQLite 캐시 + 토스) →
 * `computeIndicators`(Python 5001). 여기서 이동평균을 다시 구현하면 차트가 보여 주는 값과
 * 자동매매가 쓰는 값이 갈라진다 (CLAUDE.md: 지표 계산은 한 곳).
 *
 * ⚠️ Gemini 를 부르지 않는다. 규칙형 계좌는 API 키가 없어도 돈다.
 */

import { getCandles } from '../candleService';
import { computeIndicators } from '../indicatorService';
import type { IndicatorSeries } from '../../src/types/chart';
import type { Candle } from '../../src/types/toss';
import { isFormingBar } from '../../src/utils/marketBar';
import { marketDate } from '../../src/utils/marketDate';
import type { RuleConfig } from '../../src/types/autoTrading';

/** 규칙 판정에 필요한 최소 봉 수 — 장기 MA + RSI 워밍업 여유 */
const CANDLE_LIMIT = 200;

export interface RuleDecision {
  action: 'BUY' | 'SELL' | 'HOLD';
  /** 사람이 읽는 사유 — 그대로 거래내역에 남는다 */
  reason: string;
  price: number | null;
}

/** 봉 i-1 → i 두 값 (null 이 섞여 있으면 판정하지 않는다) */
function pairAt(line: (number | null)[] | undefined, i: number): [number, number] | null {
  if (!Array.isArray(line) || i < 1 || i >= line.length) return null;
  const a = line[i - 1];
  const b = line[i];
  return a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b) ? null : [a, b];
}

/**
 * 설정의 MA 기간을 실제 시리즈에 맞춘다.
 *
 * 지표 엔진은 5·20·60·120 만 돌려준다. 사용자가 다른 값을 넣으면 가장 가까운 것으로
 * 내림한다 — 없는 기간을 조용히 무시하면 "설정은 10인데 5로 돈다" 를 아무도 모른다.
 */
export function pickMa(series: IndicatorSeries, period: number): { line: (number | null)[]; used: number } {
  const available: { period: number; line: (number | null)[] }[] = [
    { period: 5, line: series.sma5 },
    { period: 20, line: series.sma20 },
    { period: 60, line: series.sma60 },
    { period: 120, line: series.sma120 },
  ];
  let best = available[0];
  for (const item of available) {
    if (Math.abs(item.period - period) < Math.abs(best.period - period)) best = item;
  }
  return { line: best.line, used: best.period };
}

/**
 * 규칙 판정 — **순수 함수 한 곳** (v2.31.0). 실제 엔진(`evaluateRule`)과 과거 재현(`ruleBacktest.ts`)이 이것을 부른다(두 벌 금지).
 *
 * 매수 = 골든크로스(단기가 장기를 아래→위로 통과) **또는** 과매도 반등(RSI 가 기준 아래에
 * 있다가 올라서는 순간). 매도 = 데드크로스 **또는** RSI 과열.
 * 둘 다 "봉 i-1 → 봉 i" 의 변화를 본다 — 조건이 계속 참인 구간에서 매 주기 주문이
 * 나가지 않도록, **교차하는 그 순간**만 신호로 본다.
 * `i` 는 **완성된 봉**이어야 한다(호출하는 쪽이 진행 중 봉을 뺀다). 사유 끝에 `(MM-DD 마감 기준)`.
 */
export function decideRule(
  series: IndicatorSeries,
  i: number,
  rule: RuleConfig,
  /** 이미 보유 중인지 — 보유분이 있으면 매도 조건을, 없으면 매수 조건을 본다 */
  held: boolean,
  /** 기준 봉의 시장 날짜(YYYY-MM-DD) — 사유에 붙인다 */
  barDate: string,
): { action: 'BUY' | 'SELL' | 'HOLD'; reason: string } {
  const short = pickMa(series, rule.maShort);
  const long = pickMa(series, rule.maLong);
  const shortPair = pairAt(short.line, i);
  const longPair = pairAt(long.line, i);
  const rsiPair = pairAt(series.rsi14, i);
  const basis = ` (${barDate.slice(5)} 마감 기준)`;

  const maLabel = `MA${short.used}·MA${long.used}`;
  const golden =
    rule.useMaCross && shortPair && longPair
      ? shortPair[0] <= longPair[0] && shortPair[1] > longPair[1]
      : false;
  const dead =
    rule.useMaCross && shortPair && longPair
      ? shortPair[0] >= longPair[0] && shortPair[1] < longPair[1]
      : false;

  const rsiRebound =
    rule.useRsi && rsiPair ? rsiPair[0] <= rule.rsiBuyBelow && rsiPair[1] > rsiPair[0] : false;
  const rsiHot = rule.useRsi && rsiPair ? rsiPair[1] >= rule.rsiSellAbove : false;
  const rsiNow = rsiPair ? rsiPair[1].toFixed(1) : '—';

  if (held) {
    if (dead) return { action: 'SELL', reason: `${maLabel} 데드크로스 — 추세 이탈로 전량 매도${basis}` };
    if (rsiHot) {
      return { action: 'SELL', reason: `RSI ${rsiNow} — 과열(${rule.rsiSellAbove} 이상) 구간이라 전량 매도${basis}` };
    }
    return { action: 'HOLD', reason: `매도 조건 없음 (RSI ${rsiNow}, ${maLabel} 교차 없음) — 보유 유지${basis}` };
  }

  if (golden) return { action: 'BUY', reason: `${maLabel} 골든크로스 — 추세 전환 매수${basis}` };
  if (rsiRebound) {
    return {
      action: 'BUY',
      reason: `RSI ${rsiPair![0].toFixed(1)} → ${rsiNow} — 과매도(${rule.rsiBuyBelow} 이하) 반등 매수${basis}`,
    };
  }
  return { action: 'HOLD', reason: `매수 조건 없음 (RSI ${rsiNow}, ${maLabel} 교차 없음)${basis}` };
}

/** 진행 중인 일봉을 뺀 완성 봉 (v2.31.0) — 장중에는 오늘 봉이 만들어지는 중이라 교차가 생겼다 사라질 수 있다 */
export function completedDaily(candles: Candle[], symbol: string, now = Date.now()): Candle[] {
  return isFormingBar(candles, '1d', symbol, now) ? candles.slice(0, -1) : candles;
}

/**
 * 한 종목의 규칙 판정 — **완성된 일봉만** 쓴다 (v2.31.0).
 *
 * 장중에는 마지막 봉이 진행 중이라, 그 가격으로 판정하면 교차가 생겼다가 마감 때 사라질 수 있다
 * (그 사이 사고 다음 시간에 반대 신호로 파는 일). 그래서 진행 중 봉을 빼고 판정한다 — 신호는 **하루에 한 번** 바뀌고
 * (전날 마감 기준), 주문은 지금처럼 다음 판단 시각(정규장)에 나간다. 과거 재현과 같은 판정이 된다.
 * 가격(`price`, 수량 계산용)은 지금 가격(마지막 봉 종가 = 실시간)을 그대로 쓴다. 하드 손절·트레일링은 엔진이 매 틱 따로 본다.
 */
export async function evaluateRule(
  symbol: string,
  rule: RuleConfig,
  held: boolean,
  now = Date.now(),
): Promise<RuleDecision> {
  const candles = await getCandles(symbol, '1d', CANDLE_LIMIT);
  const completed = completedDaily(candles, symbol, now);
  if (completed.length < 30) {
    return { action: 'HOLD', reason: `캔들이 ${completed.length}개뿐이라 판정을 건너뜁니다`, price: null };
  }

  const series = await computeIndicators(completed);
  const i = completed.length - 1;
  const decision = decideRule(series, i, rule, held, marketDate(completed[i].timestamp, symbol));
  return { ...decision, price: candles.at(-1)?.close ?? null };
}
