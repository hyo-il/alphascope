/**
 * 마감 판단 — **한 곳** (v2.45.0). 계좌 자동매매(`autoTrading/engine.runSignalChecks`)와 매수 판단(`buyJudge`)이 같은 경로를 지난다:
 * 일봉 300 → 끝난 봉만(`completedDaily`) → 지표 한 번 → 마지막 봉에서 `evaluateRule`.
 * 그래서 같은 종목·같은 날·같은 규칙·같은 상태(보유 없음 등)면 action · score · code 가 같다(`npm run buyjudge:test`).
 */
import { getCandles } from '../candleService';
import { unconfirmedDailyTimestamps } from '../db';
import { dailyCloseOffsetMs } from '../../src/utils/marketBar';
import { marketDate } from '../../src/utils/marketDate';
import { computeIndicators } from '../indicatorService';
import { completedDaily, evaluateRule, type RuleEvaluation, type RuleState } from './engine';
import { usesMarketFilter, type RuleBody } from '../../src/types/tradingRule';
import { loadMarketRef, marketOfSymbol, type MarketRefLoader } from './marketRef';
import { lastClosedDay } from '../marketHours';
import { isMockMode } from '../mockData';
import type { Candle } from '../../src/types/toss';
import type { IndicatorSeries } from '../../src/types/chart';

/** 받는 일봉 수 — 지표 준비(120일선·120일 고점) + 여유 */
export const JUDGE_CANDLE_LIMIT = 300;
/** 이보다 적으면 판단하지 않는다 */
export const JUDGE_MIN_CANDLES = 30;

export type ClosedJudgement =
  | { kind: 'ok'; ev: RuleEvaluation; candles: Candle[]; completed: Candle[]; series: IndicatorSeries }
  | { kind: 'short'; count: number; candles: Candle[] }
  /**
   * v2.51.1 — 끝난 봉 가운데 그 시장 마감 전에 받은 값(장중에 저장된 뒤 다시 받기 실패)이 있다 → 판단하지 않는다(다음 틱에 다시).
   * v2.51.2 — 마지막 끝난 봉이 직전 거래일(`marketHours.lastClosedDay`)보다 오래됐다(받기 실패로 옛 값만 있음)도 같다. `dates` = 확정하지 못한 날짜
   */
  | { kind: 'unconfirmed'; dates: string[]; candles: Candle[] };

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
  // 끝나지 않은 채 저장된 봉(v2.51.1) — 캐시에서 읽은 경우만(넘겨받은 캔들은 부른 쪽이 책임진다). 끝나지 않은 값으로 판단하지 않는다
  if (!candles) {
    const bad = unconfirmedDailyTimestamps(symbol, completed[0].timestamp, dailyCloseOffsetMs(symbol)).filter((ts) => ts <= completed.at(-1)!.timestamp);
    if (bad.length) return { kind: 'unconfirmed', dates: bad.map((ts) => marketDate(ts, symbol)), candles: all };
    // 오래된 끝난 봉(v2.51.2) — 받기에 실패했고 장중 저장 봉도 없으면 마지막 끝난 봉이 직전 거래일보다 앞이다. 그 값으로 판단하고 그날을 마치지 않는다.
    // 모의 데이터 모드는 뺀다 — 모의 일봉은 받은 값이 아니라 지금 시각으로 매일(주말 포함) 만들어 시장 달력과 맞지 않는다
    if (!isMockMode()) {
      const expected = lastClosedDay(marketOfSymbol(symbol), now, dailyCloseOffsetMs(symbol));
      if (marketDate(completed.at(-1)!.timestamp, symbol) < expected) return { kind: 'unconfirmed', dates: [expected], candles: all };
    }
  }
  const series = await computeIndicators(completed);
  const market = usesMarketFilter(rule) ? await (refs ? refs.get(marketOfSymbol(symbol)) : loadMarketRef(marketOfSymbol(symbol), now)) : undefined;
  const ev = evaluateRule({ symbol, candles: completed, series, ...(market !== undefined ? { market } : {}) }, completed.length - 1, rule, state);
  return { kind: 'ok', ev, candles: all, completed, series };
}
