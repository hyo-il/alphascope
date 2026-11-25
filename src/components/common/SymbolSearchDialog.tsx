import Dialog from '../ui/Dialog';
import SymbolSearch from './SymbolSearch';

/**
 * 종목 찾기 창(v2.73.0) — 폰 위쪽 막대 [종목 찾기]. 안은 큰 화면 종목 머리줄의 검색과 같은 부품 · 같은 함수(고르면 `onSubmit` 후 닫힘).
 */
export default function SymbolSearchDialog({ symbol, onSubmit, onClose }: { symbol: string; onSubmit: (symbol: string) => void; onClose: () => void }) {
  return (
    <Dialog title="종목 찾기" onClose={onClose} size="sm" bodyClassName="min-h-[320px] p-4">
      <SymbolSearch
        symbol={symbol}
        autoFocus
        dropUp={false}
        onSubmit={(next) => {
          onSubmit(next);
          onClose();
        }}
      />
    </Dialog>
  );
}
