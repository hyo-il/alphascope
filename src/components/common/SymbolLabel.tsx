import { stockNameOf } from '../../utils/stockNames';

/**
 * 심볼 + 종목명 표시.
 *
 * 표기를 한 곳에 모아 둔다 — 화면마다 다르게 쓰면 어디선 "AAPL 애플",
 * 어디선 "애플(AAPL)" 이 되어 같은 앱처럼 보이지 않는다.
 * 이름을 아직 못 받았으면 심볼만 보여 준다 (레이아웃이 흔들리지 않게).
 */
export default function SymbolLabel({
  symbol,
  /** 서버 응답에 이름이 함께 온 경우 (카탈로그 조회보다 우선) */
  name,
  /** 심볼 글자 크기·굵기는 쓰는 곳에서 정한다 */
  className = '',
  nameClassName = 'text-text-secondary',
}: {
  symbol: string;
  name?: string | null;
  className?: string;
  nameClassName?: string;
}) {
  const label = name ?? stockNameOf(symbol);

  return (
    <span className={`inline-flex min-w-0 items-baseline gap-1.5 ${className}`}>
      <span className="font-semibold">{symbol}</span>
      {label && <span className={`truncate text-xs font-normal ${nameClassName}`}>{label}</span>}
    </span>
  );
}
