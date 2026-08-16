import type { Candle, Timeframe } from '../src/types/toss';
import { fetchCandles } from '../src/services/toss/market';
import { aggregateCandles, resolveTimeframe } from '../src/utils/candleAggregator';
import { latestCandleTimestamp, loadCandles, saveCandles } from './db';

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

  const latest = latestCandleTimestamp(symbol, base);
  const isFresh = latest !== null && Date.now() - latest < FRESHNESS_MS[base];
  const cached = loadCandles(symbol, base, baseLimit);

  if (!isFresh || cached.length < baseLimit) {
    const fresh = await fetchCandles(symbol, base, baseLimit);
    if (fresh.length) saveCandles(symbol, base, fresh);
  }

  const rows = loadCandles(symbol, base, baseLimit);
  if (minutes > 1) return aggregateCandles(rows, minutes).slice(-limit);
  return rows.slice(-limit);
}
