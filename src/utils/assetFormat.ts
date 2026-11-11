import { formatNumber, formatPrice } from './formatters';
import { MINUS, formatSignedMoney } from './formatters';
import type { AssetCurrency } from '../types/asset';

/**
 * 자산 관리 화면의 숫자 **표시** 한 곳(v2.68.2) — 계좌별 표 · 종목별 표 · 평단 계산기 · 매수 · 매도 창 · 새 종목 창 · 기록 창이 같이 쓴다.
 * - 보이는 글자만 정한다. 시트에 쓰는 값 · 계산 값(`assetAverage.ts` · 서버)과 입력 칸 자릿수(`TRADE_DIGITS`)는 그대로.
 * - 가격 · 평균가 · 돈: 국내 원 정수(「₩71,000」) · 미국 달러 소수 2자리(「$12.50」) — `formatPrice` 와 같은 규칙.
 * - 수량: 정수면 「30주」 · 소수면 소수 2자리까지 반올림하고 끝 0 은 지운다(「0.5주」 · 「12.35주」) · 쉼표.
 *   `ceil` 은 「목표 평단까지」 의 필요 수량처럼 모자라면 안 되는 수 — 소수 2자리로 **올림**(3.429167 → 「3.43주」).
 */

/** 가격 · 평균가 · 돈 — 국내 원 정수 · 미국 $ 소수 2자리 */
export function formatAssetPrice(price: number | null | undefined, currency: AssetCurrency): string {
  return formatPrice(price, currency);
}

/** 수량 — 「30주」 · 「0.5주」(소수 2자리까지 · 끝 0 지움) · 값이 없으면 「—」 */
export function formatAssetQty(qty: number | null | undefined, opts: { ceil?: boolean } = {}): string {
  if (qty == null || !Number.isFinite(qty)) return '—';
  // 올림은 부동소수 오차(3.43 * 100 = 343.00000000000006)로 한 칸 더 올라가지 않게 아주 작은 값을 빼고 올린다
  const v = opts.ceil ? Math.ceil(qty * 100 - 1e-9) / 100 : Math.round(qty * 100) / 100;
  const frac = Number.isInteger(v) ? 0 : (String(v).split('.')[1] ?? '').length;
  return `${formatNumber(v, Math.min(2, frac))}주`;
}

/** 원화 금액 정확히 — 「₩5,123,456,789」(원 단위 정수 · v2.70.0 총 자산 추이 · 일별 변화 표) */
export function formatAssetWon(value: number | null | undefined): string {
  return formatPrice(value, 'KRW');
}

/** 부호 있는 원화 금액 정확히 — 「+₩12,345,678」 · 「−₩1,000」 · 「₩0」 */
export function formatAssetWonSigned(value: number | null | undefined): string {
  return formatSignedMoney(value, 'KRW');
}

/**
 * 부호 있는 만 원 단위(반올림) — 「+₩90만」 · 「−₩1,235만」(일별 변화 표 「무엇 때문에」 칸). 1만 원 아래는 부호와 상관없이 「1만 원 미만」 으로 묶는다.
 * 정확한 금액은 줄을 펼쳐 `formatAssetWonSigned` 로 본다.
 */
export function formatAssetManwon(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  if (Math.abs(value) < 10_000) return '1만 원 미만';
  const man = Math.round(Math.abs(value) / 10_000);
  return `${value > 0 ? '+' : MINUS}₩${man.toLocaleString('ko-KR')}만`;
}
