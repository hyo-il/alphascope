import type { Candle, Timeframe } from '../src/types/toss';
import { fetchCandles, fetchCandlesBefore } from '../src/services/toss/market';
import { aggregateCandles, resolveTimeframe } from '../src/utils/candleAggregator';
import { latestCandleTimestamp, loadCandles, loadCandlesBefore, saveCandles } from './db';
import { isMockMode, mockCandles } from './mockData';

/** 원본 주기별 캐시 신선도 — 이 시간 안에 받아온 데이터면 API를 다시 부르지 않는다. */
const FRESHNESS_MS: Record<'1m' | '1d', number> = {
  '1m': 60_000,
  '1d': 60 * 60_000,
};

/**
 * 캔들 조회: SQLite 캐시 우선, 오래됐으면 토스 API 갱신.
 * 5m/15m/30m 은 1분봉을 받아 집계한다.
 */
export async function getCandles(
  symbol: string,
  timeframe: Timeframe,
  limit: number,
): Promise<Candle[]> {
  const { base, minutes } = resolveTimeframe(timeframe);

  // 집계 타임프레임은 배수만큼 원본 캔들이 더 필요하다.
  const baseLimit = minutes > 1 ? limit * minutes : limit;

  // API 키가 없으면 모의 데이터로 UI 를 검증할 수 있게 한다 (캐시에 저장하지 않는다).
  if (isMockMode()) {
    const rows = mockCandles(symbol, base, baseLimit);
    return minutes > 1 ? aggregateCandles(rows, minutes).slice(-limit) : rows;
  }

  const latest = latestCandleTimestamp(symbol, base);
  const isFresh = latest !== null && Date.now() - latest < FRESHNESS_MS[base];
  const cached = loadCandles(symbol, base, baseLimit);

  if (!isFresh || cached.length < baseLimit) {
    // 실시간 조회가 막혀도(API 장애·IP 차단) 캐시가 있으면 그걸로 그린다 —
    // 여기서 그냥 던지면 이미 받아 둔 수천 봉을 두고도 차트가 통째로 빈다.
    // 캐시가 아예 없을 때만 원래 에러를 올려 보낸다. (summaryService 와 같은 방침)
    try {
      const fresh = await fetchCandles(symbol, base, baseLimit);
      if (fresh.length) saveCandles(symbol, base, fresh);
    } catch (error) {
      if (!cached.length) throw error;
      console.warn(`[candles] ${symbol} ${base} 실시간 조회 실패, 캐시 사용:`, error);
    }
  }

  const rows = loadCandles(symbol, base, baseLimit);
  if (minutes > 1) return aggregateCandles(rows, minutes).slice(-limit);
  return rows.slice(-limit);
}

/**
 * 지정 시각 이전의 과거 캔들 (차트를 왼쪽으로 스크롤할 때 이어 받는다).
 *
 * 토스는 일봉을 1990년까지(약 9,200봉) 보유하지만 1분봉은 3일치뿐이다.
 * 더 없으면 빈 배열이 오고, 호출부는 그걸로 "끝"을 판단한다.
 */
export async function getCandlesBefore(
  symbol: string,
  timeframe: Timeframe,
  beforeMs: number,
  limit: number,
): Promise<Candle[]> {
  const { base, minutes } = resolveTimeframe(timeframe);
  const baseLimit = minutes > 1 ? limit * minutes : limit;

  if (isMockMode()) {
    // 모의 모드에서는 과거를 무한히 만들지 않는다.
    return [];
  }

  // 과거 구간도 마찬가지다. 조회가 막히면 캐시에 남아 있는 그 구간을 돌려준다 —
  // 무한 스크롤이 에러로 끊기는 것보다 있는 만큼 보여 주는 편이 낫다.
  let fresh: Candle[];
  try {
    fresh = await fetchCandlesBefore(symbol, base, beforeMs, baseLimit);
    if (fresh.length) saveCandles(symbol, base, fresh);
  } catch (error) {
    fresh = loadCandlesBefore(symbol, base, beforeMs, baseLimit);
    if (!fresh.length) throw error;
    console.warn(`[candles] ${symbol} ${base} 과거 구간 조회 실패, 캐시 사용:`, error);
  }

  return minutes > 1 ? aggregateCandles(fresh, minutes) : fresh;
}
