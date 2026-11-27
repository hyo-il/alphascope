import type { Price } from '../../types/toss';
import { displayMinus, formatPercent, formatSigned } from '../../utils/formatters';

/**
 * 종목 등락 글(「+1.25 (+0.35%)」 · 국내는 원 정수 「+1,500 (+0.55%)」) — 큰 화면 종목 머리 줄과 폰 가격 줄이 같이 쓴다(v2.82.0 · 같은 값 · 같은 함수).
 */
export function priceChangeText(live: Price, currency: 'KRW' | 'USD'): string {
  const change =
    currency === 'KRW'
      ? displayMinus(`${live.change > 0 ? '+' : ''}${Math.round(live.change).toLocaleString('ko-KR')}`)
      : formatSigned(live.change, 2);
  return `${change} (${formatPercent(live.changeRate)})`;
}
