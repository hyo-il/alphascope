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
  sm: 'text-caption',
  md: 'text-caption',
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
  wrap = false,
  keepTicker = false,
}: {
  symbol: string;
  name?: string | null;
  showTicker?: boolean;
  size?: keyof typeof TICKER_SIZE;
  className?: string;
  tickerClassName?: string;
  /** 카드 제목처럼 자리가 넉넉하지 않아도 이름 전체가 보여야 하는 곳 — 말줄임 대신 단어 단위로 줄바꿈 */
  wrap?: boolean;
  /**
   * 한 줄 표의 좁은 이름 칸 — 이름만 0 까지 줄어들고(말줄임) 전체 폭은 **티커 폭 밑으로 줄지 않는다**(flex 안에서 min-w-0 을 주지 않아도 된다).
   * 기본(inline-flex + min-w-0)은 칸이 티커보다 좁아지면 티커가 옆 글자 위로 넘쳐 겹쳤다.
   */
  keepTicker?: boolean;
}) {
  const raw = name ?? stockNameOf(symbol);
  // 이름이 티커와 같으면(QQQ·SOXL 같은 ETF) 같은 값을 두 번 적지 않는다 — 티커만
  const label = raw && raw.trim().toUpperCase() === symbol.toUpperCase() ? null : raw;
  /*
   * 굵기 기본은 중간(500) — 디자인 규칙 4(표의 종목명 = 500). 늘 600 으로 박아 두면
   * 표·목록이 전부 굵게 보인다. 카드 제목처럼 600 이 필요한 곳은 className 에 `font-semibold` 를 준다.
   */
  const weight = /\bfont-(normal|medium|semibold)\b/.test(className) ? '' : 'font-medium';

  // wrap: 글자 흐름 그대로(이름 다음 줄에 티커가 이어진다) — flex 로 두면 이름이 두 줄일 때 티커가 오른쪽 끝으로 떨어져 나갔다
  if (wrap)
    return (
      <span className={`min-w-0 break-keep ${weight} ${className}`} title={label || symbol}>
        {label || symbol}
        {label && showTicker && (
          <span className={`ml-1.5 whitespace-nowrap font-normal ${TICKER_SIZE[size]} ${tickerClassName}`}>{symbol}</span>
        )}
      </span>
    );

  // 첫 칸 minmax(0, auto) — 최소 폭 계산에서 이름은 0, 티커만 남는다
  const layout = keepTicker && label && showTicker ? 'inline-grid grid-cols-[minmax(0,auto)_auto]' : 'inline-flex min-w-0';
  return (
    <span className={`${layout} items-baseline gap-1.5 ${weight} ${className}`}>
      {/* 좁은 자리에서 이름이 말줄임되면 마우스로 전체 이름을 본다 — 티커는 자르지 않는다 */}
      <span className="truncate" title={label || symbol}>{label || symbol}</span>
      {label && showTicker && (
        <span className={`shrink-0 font-normal ${TICKER_SIZE[size]} ${tickerClassName}`}>
          {symbol}
        </span>
      )}
    </span>
  );
}
