import type { Candle, Timeframe } from '../types/toss';
import { AGGREGATION_MINUTES } from './constants';

/**
 * 1분봉을 N분봉으로 집계한다.
 * 버킷 경계는 UTC 기준 절대 시각(epoch)으로 나누므로 시장 시간대와 무관하게 일관적이다.
 */
export function aggregateCandles(candles: Candle[], minutes: number): Candle[] {
  if (minutes <= 1) return candles;
  const bucketMs = minutes * 60_000;
  const out: Candle[] = [];

  for (const candle of candles) {
    const bucketStart = Math.floor(candle.timestamp / bucketMs) * bucketMs;
    const current = out.at(-1);

    if (current && current.timestamp === bucketStart) {
      current.high = Math.max(current.high, candle.high);
      current.low = Math.min(current.low, candle.low);
      current.close = candle.close;
      current.volume += candle.volume;
    } else {
      out.push({ ...candle, timestamp: bucketStart });
    }
  }

  return out;
}

/** 요청 타임프레임에 필요한 원본 주기와 집계 배수를 알려준다. */
export function resolveTimeframe(timeframe: Timeframe): {
  base: '1m' | '1d';
  minutes: number;
} {
  if (timeframe === '1d') return { base: '1d', minutes: 0 };
  return { base: '1m', minutes: AGGREGATION_MINUTES[timeframe] ?? 1 };
}
