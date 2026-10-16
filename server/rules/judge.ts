/**
 * 마감 판단 — **한 곳** (v2.45.0). 계좌 자동매매(`autoTrading/engine.runSignalChecks`)와 매수 판단(`buyJudge`)이 같은 경로를 지난다:
 * 일봉 300 → 끝난 봉만(`completedDaily`) → 지표 한 번 → 마지막 봉에서 `evaluateRule`.
 * 그래서 같은 종목·같은 날·같은 규칙·같은 상태(보유 없음 등)면 action · score · code 가 같다(`npm run buyjudge:test`).
 */
import { getCandles } from '../candleService';
import { computeIndicators } from '../indicatorService';
import { completedDaily, evaluateRule, type RuleEvaluation, type RuleState } from './engine';
import { usesMarketFilter, type RuleBody } from '../../src/types/tradingRule';
import { loadMarketRef, marketOfSymbol, type MarketRefLoader } from './marketRef';
import type { Candle } from '../../src/types/toss';
import type { IndicatorSeries } from '../../src/types/chart';

/** 받는 일봉 수 — 지표 준비(120일선·120일 고점) + 여유 */
export const JUDGE_CANDLE_LIMIT = 300;
/** 이보다 적으면 판단하지 않는다 */
export const JUDGE_MIN_CANDLES = 30;

export type ClosedJudgement =
  | { kind: 'ok'; ev: RuleEvaluation; candles: Candle[]; completed: Candle[]; series: IndicatorSeries }
  | { kind: 'short'; count: number; candles: Candle[] };

/**
 * 끝난 봉 기준 판단. `candles` 를 넘기면 다시 받지 않는다(시험·한 번 받은 것을 같이 쓸 때).
 * `refs` = 이번 판단(계좌 한 바퀴 · 매수 판단 실행)이 같이 쓰는 시장 기준 받기(v2.51.0 — 시장마다 한 번). 시장 필터를 켠 규칙만 쓴다.
 */
export async function judgeOnClose(
  symbol: string,
  rule: RuleBody,
  state: RuleState,
  now = Date.now(),
  candles?: Candle[],
  refs?: MarketRefLoader,
): Promise<ClosedJudgement> {
  const all = candles ?? (await getCandles(symbol, '1d', JUDGE_CANDLE_LIMIT));
  const completed = completedDaily(all, symbol, now);
  if (completed.length < JUDGE_MIN_CANDLES) return { kind: 'short', count: completed.length, candles: all };
  const series = await computeIndicators(completed);
  const market = usesMarketFilter(rule) ? await (refs ? refs.get(marketOfSymbol(symbol)) : loadMarketRef(marketOfSymbol(symbol), now)) : undefined;
  const ev = evaluateRule({ symbol, candles: completed, series, ...(market !== undefined ? { market } : {}) }, completed.length - 1, rule, state);
  return { kind: 'ok', ev, candles: all, completed, series };
}
