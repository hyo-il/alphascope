import { isKrMarket } from './market';

/** 국내 시장 종목은 원화, 그 외는 달러로 본다 (시장만 알 때). 심볼로 가를 때는 `market.ts` 의 `currencyOfSymbol` */
export function currencyOf(market?: string | null): 'KRW' | 'USD' {
  return isKrMarket(market) ? 'KRW' : 'USD';
}

/**
 * 통화에 맞춘 가격 표기.
 * 원화는 소수점을 쓰지 않는다 (274,500원을 274,500.00 으로 적으면 어색하다).
 */
export function formatPrice(
  value: number | null | undefined,
  currency: 'KRW' | 'USD' = 'USD',
): string {
  if (value == null || !Number.isFinite(value)) return '—';
  if (currency === 'KRW') return `₩${Math.round(value).toLocaleString('ko-KR')}`;
  return `$${value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/**
 * 부호가 붙는 금액(손익·변동액) — **화면 전용** (v2.42.1). `−₩12,180` · `+$18.19` · `₩0`.
 * 예전 화면은 `formatPrice` 앞에 '+' 만 붙여 손실이 `₩-12,180` 처럼 부호가 통화 기호 **뒤**에 붙었다(이익으로 잘못 읽힐 수 있다).
 * ⚠️ `formatPrice` 는 분석 프롬프트에도 쓰이므로 바꾸지 않는다 — 부호 금액을 그리는 화면만 이 함수를 쓴다.
 * 부호 = 마이너스 기호(U+2212 −) 또는 +, 0 은 부호 없음. 통화 규칙은 `formatPrice` 그대로(원화 소수점 없음).
 */
export function formatSignedMoney(
  value: number | null | undefined,
  currency: 'KRW' | 'USD' = 'USD',
): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const body = formatPrice(Math.abs(value), currency);
  // 반올림해서 0 이 되는 값(−0.004 달러 등)은 부호를 붙이지 않는다
  if (body === formatPrice(0, currency)) return body;
  return `${value > 0 ? '+' : '−'}${body}`;
}

export function formatUsd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `$${value.toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const sign = value > 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}%`;
}

export function formatCompact(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return Intl.NumberFormat('ko-KR', { notation: 'compact' }).format(value);
}

/**
 * 통화 기호 + 압축 표기 (시가총액·매출 등).
 * 국내 종목의 시총을 `$1663조` 로 적지 않기 위해 통화를 함께 받는다.
 */
export function formatCompactMoney(
  value: number | null | undefined,
  currency?: string | null,
): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${currency === 'KRW' ? '₩' : '$'}${formatCompact(value)}`;
}

/** 상승/하락에 따른 Tailwind 텍스트 색 클래스 */
export function changeColor(value: number): string {
  if (value > 0) return 'text-bullish';
  if (value < 0) return 'text-bearish';
  return 'text-text-secondary';
}
