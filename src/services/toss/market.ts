import type { BaseTimeframe, Candle, Orderbook, Price } from '../../types/toss';
import { tossGet } from './httpClient';

/**
 * 시세 / 호가 / 캔들 조회.
 *
 * 토스 Open API 의 정확한 응답 필드명은 계정 발급 후 실제 응답으로 확정해야 한다.
 * 아래 pick* 헬퍼는 흔한 후보 키를 모두 훑어 정규화하므로, 실제 응답을 확인한 뒤
 * 후보 목록을 실제 키 하나로 좁히는 것을 권장한다. (scripts/smokeTest.ts 로 원본 확인 가능)
 */

type Raw = Record<string, unknown>;

function num(source: Raw, keys: string[]): number {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'number') return value;
    if (typeof value === 'string' && value.trim() !== '' && !Number.isNaN(Number(value))) {
      return Number(value);
    }
  }
  return NaN;
}

function toEpochMs(source: Raw, keys: string[]): number {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'number') {
      // 초 단위로 보이면 ms 로 변환
      return value < 1e12 ? value * 1000 : value;
    }
    if (typeof value === 'string') {
      const parsed = Date.parse(value);
      if (!Number.isNaN(parsed)) return parsed;
    }
  }
  return NaN;
}

/** 응답 본문에서 배열 페이로드를 찾아낸다 (result / data / candles 등 래핑 대응) */
function extractList(payload: unknown): Raw[] {
  if (Array.isArray(payload)) return payload as Raw[];
  if (payload && typeof payload === 'object') {
    for (const key of ['candles', 'data', 'result', 'results', 'items', 'list']) {
      const value = (payload as Raw)[key];
      if (Array.isArray(value)) return value as Raw[];
      if (value && typeof value === 'object') {
        const nested = extractList(value);
        if (nested.length) return nested;
      }
    }
  }
  return [];
}

function extractObject(payload: unknown): Raw {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const raw = payload as Raw;
    for (const key of ['data', 'result', 'price', 'orderbook']) {
      const value = raw[key];
      if (Array.isArray(value) && value.length) return value[0] as Raw;
      if (value && typeof value === 'object') return value as Raw;
    }
    return raw;
  }
  if (Array.isArray(payload) && payload.length) return payload[0] as Raw;
  return {};
}

/** 캔들 조회 — timeframe 은 토스가 직접 지원하는 1m / 1d 만 받는다. */
export async function fetchCandles(
  symbol: string,
  timeframe: BaseTimeframe,
  limit = 300,
): Promise<Candle[]> {
  const payload = await tossGet<unknown>(
    '/api/v1/candles',
    {
      symbol,
      // 토스 파라미터 명명이 확정되면 하나로 정리한다.
      interval: timeframe === '1d' ? 'day' : 'minute',
      period: timeframe === '1d' ? 'D' : '1',
      count: limit,
      limit,
    },
    'MARKET_DATA_CHART',
  );

  return extractList(payload)
    .map((row): Candle => ({
      timestamp: toEpochMs(row, ['timestamp', 'time', 'dateTime', 'datetime', 'date', 'baseTime']),
      open: num(row, ['open', 'openPrice', 'o']),
      high: num(row, ['high', 'highPrice', 'h']),
      low: num(row, ['low', 'lowPrice', 'l']),
      close: num(row, ['close', 'closePrice', 'c']),
      volume: num(row, ['volume', 'accVolume', 'tradingVolume', 'v']),
    }))
    .filter((c) => Number.isFinite(c.timestamp) && Number.isFinite(c.close))
    .sort((a, b) => a.timestamp - b.timestamp);
}

/** 현재가 조회 */
export async function fetchPrice(symbol: string): Promise<Price> {
  const payload = await tossGet<unknown>('/api/v1/prices', { symbol }, 'MARKET_DATA');
  const row = extractObject(payload);

  const close = num(row, ['close', 'closePrice', 'price', 'currentPrice', 'last']);
  const change = num(row, ['change', 'changePrice', 'diff']);
  const changeRate = num(row, ['changeRate', 'changePercent', 'fluctuationRate']);

  return {
    symbol,
    close,
    change: Number.isFinite(change) ? change : 0,
    changeRate: Number.isFinite(changeRate) ? changeRate : 0,
    volume: num(row, ['volume', 'accVolume', 'tradingVolume']) || 0,
    fetchedAt: Date.now(),
  };
}

/** 호가 조회 */
export async function fetchOrderbook(symbol: string): Promise<Orderbook> {
  const payload = await tossGet<unknown>('/api/v1/orderbook', { symbol }, 'MARKET_DATA');
  const row = extractObject(payload);

  const levels = (key: string[]): { price: number; quantity: number }[] => {
    for (const k of key) {
      const value = row[k];
      if (Array.isArray(value)) {
        return (value as Raw[])
          .map((level) => ({
            price: num(level, ['price', 'orderPrice']),
            quantity: num(level, ['quantity', 'volume', 'size', 'remainQuantity']),
          }))
          .filter((l) => Number.isFinite(l.price));
      }
    }
    return [];
  };

  return {
    symbol,
    asks: levels(['asks', 'askLevels', 'sell']).sort((a, b) => a.price - b.price),
    bids: levels(['bids', 'bidLevels', 'buy']).sort((a, b) => b.price - a.price),
    fetchedAt: Date.now(),
  };
}
