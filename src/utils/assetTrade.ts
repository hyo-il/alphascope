/**
 * 매수 · 매도 입력 자릿수 · 검사(v2.66.0) — 서버(`server/asset/trade.ts`)와 화면(`AssetTradeDialog`)이 **같은 값**을 쓴다.
 * 거래 뒤 수량 · 평균 계산은 `src/utils/assetAverage.ts` 한 곳(v2.68.0).
 * 순수 함수 · DOM 없음. ⚠️ 값을 로그에 찍지 않는다.
 */

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
