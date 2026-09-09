import { getCandles } from './candleService';

/**
 * 52주 고저.
 *
 * **일봉 캔들에서 직접 낸다.** yfinance 의 `fiftyTwoWeekHigh` 를 쓰면 값 하나 때문에
 * 종목마다 `/fundamentals` 를 부르게 되는데, 그 호출은 종목당 1~3초라 차트를 열 때마다
 * 붙이면 체감이 바뀐다 (차트 하단 탭의 기본 탭을 '기업정보' 로 두지 않은 것과 같은 이유다).
 * 일봉은 이미 `candleService` 가 SQLite 에 캐시해 두므로 대개 네트워크가 필요 없다.
 *
 * ⚠️ 오늘 캔들까지 포함한다 — 장중 신고가를 갱신하는 중이면 그 값이 곧 52주 최고다.
 */

export interface RangeStats {
  symbol: string;
  high: number;
  low: number;
  /** 고·저를 찍은 날 (epoch ms) — 화면에서 툴팁으로 쓴다 */
  highTime: number;
  lowTime: number;
  /** 실제로 몇 거래일을 봤는지. 상장한 지 얼마 안 된 종목은 52주가 안 된다. */
  days: number;
}

const WEEKS_52_MS = 52 * 7 * 24 * 60 * 60 * 1000;
/** 52주를 채우려면 약 252 거래일이 필요하다 (여유를 둔다) */
const DAILY_LIMIT = 300;
const TTL_MS = 10 * 60 * 1000;

const cache = new Map<string, { at: number; value: RangeStats | null }>();
/** 진행 중인 조회는 공유한다 — 차트를 빠르게 옮겨 다녀도 같은 요청이 겹치지 않는다 */
const inflight = new Map<string, Promise<RangeStats | null>>();

async function compute(symbol: string): Promise<RangeStats | null> {
  const candles = await getCandles(symbol, '1d', DAILY_LIMIT);
  const since = Date.now() - WEEKS_52_MS;
  const window = candles.filter((c) => c.timestamp >= since);
  if (!window.length) return null;

  let high = window[0];
  let low = window[0];
  for (const candle of window) {
    if (candle.high > high.high) high = candle;
    if (candle.low < low.low) low = candle;
  }

  return {
    symbol,
    high: high.high,
    low: low.low,
    highTime: high.timestamp,
    lowTime: low.timestamp,
    days: window.length,
  };
}

export async function getRangeStats(symbol: string): Promise<RangeStats | null> {
  const hit = cache.get(symbol);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const running = inflight.get(symbol);
  if (running) return running;

  const task = compute(symbol)
    .then((value) => {
      cache.set(symbol, { at: Date.now(), value });
      return value;
    })
    .catch(() => {
      // 실패는 캐시하지 않는다 — 일시적인 장애 뒤에 10분을 기다릴 이유가 없다.
      return null;
    })
    .finally(() => inflight.delete(symbol));

  inflight.set(symbol, task);
  return task;
}
