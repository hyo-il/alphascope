import type { Candle } from '../types/toss';

/** 현재가가 마지막 봉 종가와 이만큼(비율) 넘게 다르면 다른 종목 값이거나 잘못 온 값으로 보고 무시한다 */
export const LIVE_PRICE_MAX_JUMP = 0.2;

/**
 * 현재가로 고친 마지막 봉 — 메인 차트(`CandleChart`)와 가벼운 차트(`LiteCandleChart`, 실시간 순위 미리보기)가 같이 쓴다.
 * 종가 = 현재가, 고가 · 저가는 현재가까지 넓힌다. 시가 · 거래량 · 시각은 그대로.
 * 고칠 수 없으면(봉 없음 · 값 없음 · 20% 넘게 다름) null — 차트는 그대로 둔다.
 */
export function liveCandle(last: Candle | undefined, price: number | null | undefined): Candle | null {
  if (!last || price == null || !Number.isFinite(price)) return null;
  if (Math.abs(price - last.close) / last.close > LIVE_PRICE_MAX_JUMP) return null;
  return {
    ...last,
    high: Math.max(last.high, price),
    low: Math.min(last.low, price),
    close: price,
  };
}
