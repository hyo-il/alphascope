/** 국내 시장 종목은 원화, 그 외는 달러로 본다. */
export function currencyOf(market?: string | null): 'KRW' | 'USD' {
  return market === 'KOSPI' || market === 'KOSDAQ' || market === 'KR_ETC' ? 'KRW' : 'USD';
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
