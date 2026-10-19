import StockName from './StockName';

/**
 * 종목 이름을 누르면 차트로 — 계좌 화면(보유 종목 · 거래 내역 · AI 검증 기록)이 같이 쓴다(모양 한 벌: 글자 그대로 · 마우스를 올리면 밑줄).
 * 누르는 줄 안에 있어도 그 줄의 동작(펼치기 등)이 함께 일어나지 않게 click 을 위로 올리지 않는다.
 * 키(Enter · Space)는 버튼의 몫이다 — 바깥 칸의 키 처리는 `e.target === e.currentTarget` 일 때만 한다(CLAUDE.md 화면·차트).
 */
export default function SymbolChartLink({
  symbol,
  name,
  onOpen,
  className = '',
}: {
  symbol: string;
  name?: string | null;
  onOpen: (symbol: string) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      title={`${name || symbol} 차트로 이동`}
      onClick={(e) => {
        e.stopPropagation();
        onOpen(symbol);
      }}
      className={`min-w-0 max-w-full text-left text-text-primary hover:underline ${className}`}
    >
      <StockName symbol={symbol} name={name} className="max-w-full" />
    </button>
  );
}
