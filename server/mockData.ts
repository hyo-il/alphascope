import type { BaseTimeframe, Candle, Orderbook, Price } from '../src/types/toss';

/**
 * 토스 API 키가 아직 없을 때 UI를 검증하기 위한 모의 데이터.
 *
 * ⚠️ 실제 시세가 아니다. .env 에 유효한 TOSS_CLIENT_ID / TOSS_CLIENT_SECRET 을 넣으면
 * 자동으로 비활성화되고 실 API 를 호출한다. 응답에는 항상 mock: true 가 붙어
 * 화면 상단에 경고 배너가 뜬다.
 */

/** 자격증명이 비어 있거나 .env.example 의 플레이스홀더 그대로인가? */
export function isMockMode(): boolean {
  const id = process.env.TOSS_CLIENT_ID;
  const secret = process.env.TOSS_CLIENT_SECRET;
  if (!id || !secret) return true;
  return id.startsWith('your_') || secret.startsWith('your_');
}

/** 심볼로부터 재현 가능한 시드를 만든다 (새로고침해도 같은 차트가 나오도록) */
function seedFrom(symbol: string): number {
  let hash = 2166136261;
  for (const char of symbol) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function makeRandom(seed: number): () => number {
  let state = seed || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0xffffffff;
  };
}

/** 랜덤워크로 OHLCV 캔들을 생성한다. */
export function mockCandles(
  symbol: string,
  timeframe: BaseTimeframe,
  count: number,
): Candle[] {
  const random = makeRandom(seedFrom(symbol));
  const stepMs = timeframe === '1d' ? 86_400_000 : 60_000;
  const volatility = timeframe === '1d' ? 0.018 : 0.0025;

  let price = 80 + (seedFrom(symbol) % 200);
  const now = Math.floor(Date.now() / stepMs) * stepMs;
  const candles: Candle[] = [];

  for (let i = count - 1; i >= 0; i--) {
    const drift = (random() - 0.48) * volatility;
    const open = price;
    const close = Math.max(1, open * (1 + drift));
    const high = Math.max(open, close) * (1 + random() * volatility * 0.6);
    const low = Math.min(open, close) * (1 - random() * volatility * 0.6);

    candles.push({
      timestamp: now - i * stepMs,
      open: round(open),
      high: round(high),
      low: round(low),
      close: round(close),
      volume: Math.round((0.6 + random()) * (timeframe === '1d' ? 4e7 : 3e5)),
    });
    price = close;
  }

  // 분봉 시리즈의 끝값을 일봉 마지막 종가에 맞춘다.
  // 그러지 않으면 두 시리즈가 서로 다른 가격대를 떠돌아, 타임프레임을 바꿀 때마다
  // 헤더의 현재가와 차트가 어긋난다.
  if (timeframe === '1m' && candles.length) {
    const target = mockCandles(symbol, '1d', 2).at(-1)!.close;
    const factor = target / candles.at(-1)!.close;
    for (const candle of candles) {
      candle.open = round(candle.open * factor);
      candle.high = round(candle.high * factor);
      candle.low = round(candle.low * factor);
      candle.close = round(candle.close * factor);
    }
  }

  return candles;
}

export function mockPrice(symbol: string): Price {
  const recent = mockCandles(symbol, '1d', 2);
  const [prev, last] = recent;
  const change = last.close - prev.close;
  return {
    symbol,
    close: last.close,
    change: round(change),
    changeRate: round((change / prev.close) * 100),
    volume: last.volume,
    fetchedAt: Date.now(),
  };
}

export function mockOrderbook(symbol: string): Orderbook {
  const base = mockPrice(symbol).close;
  const tick = Math.max(0.01, round(base * 0.0004));
  const random = makeRandom(seedFrom(symbol) + 7);

  return {
    symbol,
    asks: Array.from({ length: 10 }, (_, i) => ({
      price: round(base + tick * (i + 1)),
      quantity: Math.round(100 + random() * 900),
    })),
    bids: Array.from({ length: 10 }, (_, i) => ({
      price: round(base - tick * (i + 1)),
      quantity: Math.round(100 + random() * 900),
    })),
    fetchedAt: Date.now(),
  };
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
