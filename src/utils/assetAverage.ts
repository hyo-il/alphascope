/**
 * 평균 단가 계산 한 곳(v2.68.0) — **평균 식은 이 파일에만 있다.**
 * - 서버 `server/asset/trade.ts` `recordTrade`(시트에 쓸 값) · 매수 창 미리 보기(`AssetTradeDialog` · `AssetNewBuyDialog`) ·
 *   물타기 계산기(`AssetAverageCalculator`)가 모두 이 함수를 쓴다.
 * - 매수 평균 = (수량 × 평균 + 산 수량 × 산 가격) ÷ (수량 + 산 수량) · 국내 원 단위 반올림 · 미국 달러 소수 4자리(v2.66.0 규칙 그대로).
 * 순수 함수 · DOM 없음(서버도 컴파일한다 — `tsconfig.node.json`). ⚠️ 값을 로그에 찍지 않는다.
 */
import type { AssetCurrency, AssetTradeSide } from '../types/asset';
import { TRADE_DIGITS, decimalPlaces, roundTo } from './assetTrade';

/** 두 수량의 합 · 차 — 부동소수 찌꺼기 없이(둘 중 긴 소수 자릿수까지만 · 수량은 「받은 그대로」) */
function addQty(a: number, b: number): number {
  return roundTo(a + b, Math.min(12, Math.max(decimalPlaces(a), decimalPlaces(b))));
}

/** 산 뒤 평균 — 가중 평균(국내 원 단위 · 미국 소수 4자리 반올림) */
function buyAverage(currency: AssetCurrency, beforeQty: number, beforeAvg: number, qty: number, price: number): number {
  const avg = (beforeQty * beforeAvg + qty * price) / (beforeQty + qty);
  return currency === 'KRW' ? Math.round(avg) : roundTo(avg, 4);
}

/** 거래 뒤 수량 · 평균가 — 매수: 가중 평균 · 매도: 수량만 줄고 평균 그대로 */
export function tradeAfter(input: { side: AssetTradeSide; currency: AssetCurrency; beforeQty: number; beforeAvg: number; qty: number; price: number }): { afterQty: number; afterAvg: number } {
  const { side, currency, beforeQty, beforeAvg, qty, price } = input;
  if (side === 'sell') return { afterQty: addQty(beforeQty, -qty), afterAvg: beforeAvg };
  return { afterQty: addQty(beforeQty, qty), afterAvg: buyAverage(currency, beforeQty, beforeAvg, qty, price) };
}

/** 돈 — 국내 원 정수 · 미국 달러 소수 4자리(가격 자릿수와 같다) */
const money = (n: number, currency: AssetCurrency) => roundTo(n, TRADE_DIGITS[currency].price);

/** 수익률 — (가격 − 평균) ÷ 평균 · 가격을 모르거나 평균이 0 이하면 null */
const returnOf = (price: number | null, avg: number) => (price == null || !(avg > 0) ? null : (price - avg) / avg);

export interface AverageHolding {
  currency: AssetCurrency;
  /** 지금 수량 · 지금 평균 단가(원래 통화) */
  qty: number;
  avg: number;
  /** 지금 가격(원래 통화 — 미국은 달러) · 모르면 null */
  price: number | null;
}

export interface AddBuysResult {
  newQty: number;
  newAvg: number;
  /** 더 드는 돈(원래 통화) */
  extraCost: number;
  /** 지금 가격 기준 수익률(0~1 비율) — 가격을 모르면 null */
  returnBefore: number | null;
  returnAfter: number | null;
}

/**
 * 물타기 — 「가격 · 수량」 여러 줄을 **한 줄씩 차례로** 더한다(앱에 매수를 한 번씩 적은 것과 같은 값 · 반올림도 줄마다).
 * 수량 · 가격이 0 이하인 줄은 부르는 쪽이 빼고 넘긴다.
 */
export function addBuys(h: AverageHolding, buys: { price: number; qty: number }[]): AddBuysResult {
  let qty = h.qty;
  let avg = h.avg;
  let cost = 0;
  for (const b of buys) {
    const next = tradeAfter({ side: 'buy', currency: h.currency, beforeQty: qty, beforeAvg: avg, qty: b.qty, price: b.price });
    qty = next.afterQty;
    avg = next.afterAvg;
    cost += b.qty * b.price;
  }
  return { newQty: qty, newAvg: avg, extraCost: money(cost, h.currency), returnBefore: returnOf(h.price, h.avg), returnAfter: returnOf(h.price, avg) };
}

export type BuysToTarget =
  | { ok: true; qty: number; cost: number }
  /** above-avg: 목표가 지금 평균보다 높거나 같다 · price-too-high: 지금 가격이 목표보다 높거나 같다(아무리 사도 못 내림) · no-price: 지금 가격을 모른다 */
  | { ok: false; reason: 'above-avg' | 'price-too-high' | 'no-price' };

/**
 * 거꾸로 계산 — 지금 가격에 몇 주를 더 사면 평균이 목표 이하가 되나.
 * x ≥ 수량 × (평균 − 목표) ÷ (목표 − 가격) · 수량은 국내 정수 · 미국 소수 6자리까지 **올림**.
 */
export function buysToTarget(h: AverageHolding, target: number): BuysToTarget {
  if (!(target < h.avg)) return { ok: false, reason: 'above-avg' };
  if (h.price == null) return { ok: false, reason: 'no-price' };
  if (!(h.price < target)) return { ok: false, reason: 'price-too-high' };
  const exact = (h.qty * (h.avg - target)) / (target - h.price);
  const digits = TRADE_DIGITS[h.currency].qty;
  const scale = 10 ** digits;
  // 부동소수 찌꺼기(9.0000000001 → 10)로 한 칸 더 올리지 않게 아주 작은 값을 뺀 뒤 올림
  const qty = roundTo(Math.ceil(exact * scale - 1e-7) / scale, digits);
  return { ok: true, qty, cost: money(qty * h.price, h.currency) };
}
