import { stockNameOf } from '../../utils/stockNames';

/**
 * 종목 표기 — **종목명이 먼저, 티커가 뒤**다.
 *
 * 사람은 "애플" 로 종목을 기억하지 "AAPL" 로 기억하지 않는다. 티커는 주문·조회에
 * 필요한 보조 정보라 뒤에 작게 둔다.
 *
 * 표기를 한 곳에 모아 두는 이유: 화면마다 다르게 쓰면 어디선 "애플 AAPL",
 * 어디선 "AAPL 애플" 이 되어 같은 앱처럼 보이지 않는다.
 * 이름을 아직 못 받았으면 **티커만** 보여 준다 (같은 값을 두 번 적지 않는다).
 */

const TICKER_SIZE = {
  sm: 'text-[10px]',
  md: 'text-[11px]',
  lg: 'text-xs',
} as const;

export default function StockName({
  symbol,
  /** 서버 응답에 이름이 함께 온 경우 (카탈로그 캐시보다 우선) */
  name,
  /** 티커를 함께 적을지 — 이미 다른 열에 티커가 있으면 끈다 */
  showTicker = true,
  size = 'md',
  /** 종목명 쪽 글자 크기·굵기는 쓰는 곳에서 정한다 */
  className = '',
  tickerClassName = 'text-text-secondary',
}: {
  symbol: string;
  name?: string | null;
  showTicker?: boolean;
  size?: keyof typeof TICKER_SIZE;
  className?: string;
  tickerClassName?: string;
}) {
  const label = name ?? stockNameOf(symbol);

  return (
    <span className={`inline-flex min-w-0 items-baseline gap-1.5 ${className}`}>
      <span className="truncate font-semibold">{label || symbol}</span>
      {label && showTicker && (
        <span className={`shrink-0 font-normal ${TICKER_SIZE[size]} ${tickerClassName}`}>
          {symbol}
        </span>
      )}
    </span>
  );
}
