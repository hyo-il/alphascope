/**
 * 매수 · 매도 입력 계산(v2.66.0) — 서버(`server/asset/trade.ts` — 시트에 쓸 값)와 화면(`AssetTradeDialog` — 미리 보기)이 **같은 함수**를 쓴다.
 * 순수 함수 · DOM 없음. ⚠️ 값을 로그에 찍지 않는다.
 */
import type { AssetCurrency, AssetTradeSide } from '../types/asset';

/** 입력 자릿수 — 수량: 국내 정수 · 미국 소수 6자리 / 가격: 국내 원 정수 · 미국 달러 소수 4자리 */
export const TRADE_DIGITS = {
  KRW: { qty: 0, price: 0 },
  USD: { qty: 6, price: 4 },
} as const;
/** 터무니없는 입력 막기(지수 표기가 되어 시트에 잘못 들어가지 않게) */
export const TRADE_MAX = { qty: 1e9, price: 1e12 } as const;

/** 소수 자릿수 — 지수 표기면(너무 작거나 큼) Infinity */
export function decimalPlaces(n: number): number {
  const s = String(n);
  if (s.includes('e')) return Infinity;
  return s.split('.')[1]?.length ?? 0;
}

export const roundTo = (n: number, digits: number) => Number(n.toFixed(digits));

/** 두 수량의 합 · 차 — 부동소수 찌꺼기 없이(둘 중 긴 소수 자릿수까지만 · 수량은 「받은 그대로」) */
function addQty(a: number, b: number): number {
  return roundTo(a + b, Math.min(12, Math.max(decimalPlaces(a), decimalPlaces(b))));
}

/** 거래 뒤 수량 · 평균가 — 매수: 가중 평균(국내 원 단위 · 미국 소수 4자리 반올림) · 매도: 수량만 줄고 평균 그대로 */
export function tradeAfter(input: { side: AssetTradeSide; currency: AssetCurrency; beforeQty: number; beforeAvg: number; qty: number; price: number }): { afterQty: number; afterAvg: number } {
  const { side, currency, beforeQty, beforeAvg, qty, price } = input;
  if (side === 'sell') return { afterQty: addQty(beforeQty, -qty), afterAvg: beforeAvg };
  const afterQty = addQty(beforeQty, qty);
  const avg = (beforeQty * beforeAvg + qty * price) / (beforeQty + qty);
  return { afterQty, afterAvg: currency === 'KRW' ? Math.round(avg) : roundTo(avg, 4) };
}
