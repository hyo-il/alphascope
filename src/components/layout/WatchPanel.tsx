import { useState } from 'react';
import { useQuotes } from '../../hooks/useQuotes';
import { formatPercent, formatUsd } from '../../utils/formatters';

interface Props {
  currentSymbol: string;
  watchlist: string[];
  recent: string[];
  onSelect: (symbol: string) => void;
  onAdd: (symbol: string) => void;
  onRemove: (symbol: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

type PanelTab = 'watch' | 'recent';

/** 오른쪽 사이드 패널 — 관심 목록과 최근 조회. 클릭하면 즉시 그 종목 차트로 전환된다. */
export default function WatchPanel({
  currentSymbol,
  watchlist,
  recent,
  onSelect,
  onAdd,
  onRemove,
  collapsed,
  onToggleCollapse,
}: Props) {
  const [tab, setTab] = useState<PanelTab>('watch');
  const [input, setInput] = useState('');
  const [menuFor, setMenuFor] = useState<string | null>(null);

  const symbols = tab === 'watch' ? watchlist : recent;
  // 보이는 목록만 폴링한다 (Rate Limit 고려).
  const quotes = useQuotes(symbols);

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onToggleCollapse}
        title="관심 목록 펼치기"
        className="flex w-7 shrink-0 items-center justify-center border-l border-border bg-bg-secondary text-xs text-text-muted transition-colors hover:text-text-primary"
      >
        ◀
      </button>
    );
  }

  const handleAdd = (e: React.FormEvent) => {
    e.preventDefault();
    const next = input.trim().toUpperCase();
    if (!next) return;
    onAdd(next);
    setInput('');
  };

  return (
    <aside className="flex w-[250px] shrink-0 flex-col border-l border-border bg-bg-secondary">
      <div className="flex items-center border-b border-border">
        {(
          [
            ['watch', '관심 목록'],
            ['recent', '최근 조회'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`flex-1 border-b-2 py-2 text-xs transition-colors ${
              tab === id
                ? 'border-accent text-text-primary'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          onClick={onToggleCollapse}
          title="접기"
          className="px-2 text-xs text-text-muted transition-colors hover:text-text-primary"
        >
          ▶
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {symbols.length === 0 && (
          <p className="px-3 py-6 text-center text-xs text-text-muted">
            {tab === 'watch' ? '관심 종목을 추가해 보세요.' : '최근 조회한 종목이 없습니다.'}
          </p>
        )}

        {symbols.map((symbol) => {
          const quote = quotes[symbol];
          const rate = quote?.changeRate ?? null;
          const color =
            rate == null ? 'text-text-muted' : rate > 0 ? 'text-bullish' : rate < 0 ? 'text-bearish' : 'text-text-secondary';

          return (
            <div key={symbol} className="relative">
              <button
                type="button"
                onClick={() => onSelect(symbol)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setMenuFor(menuFor === symbol ? null : symbol);
                }}
                className={`flex w-full items-center justify-between px-3 py-2 text-left transition-colors hover:bg-bg-tertiary/60 ${
                  symbol === currentSymbol ? 'bg-accent/10' : ''
                }`}
              >
                <span
                  className={`text-xs font-medium ${
                    symbol === currentSymbol ? 'text-accent' : 'text-text-primary'
                  }`}
                >
                  {symbol}
                </span>
                <span className="text-right">
                  <span className="block text-xs tabular-nums text-text-secondary">
                    {quote?.price != null ? formatUsd(quote.price) : '—'}
                  </span>
                  <span className={`block text-[11px] tabular-nums ${color}`}>
                    {rate == null ? '—' : formatPercent(rate)}
                  </span>
                </span>
              </button>

              {menuFor === symbol && (
                <div className="absolute right-2 top-1 z-10 rounded border border-border bg-bg-tertiary shadow-lg">
                  <button
                    type="button"
                    onClick={() => {
                      onRemove(symbol);
                      setMenuFor(null);
                    }}
                    className="block px-3 py-1.5 text-[11px] text-text-secondary transition-colors hover:text-bearish"
                  >
                    목록에서 삭제
                  </button>
                  <button
                    type="button"
                    onClick={() => setMenuFor(null)}
                    className="block px-3 py-1.5 text-[11px] text-text-muted transition-colors hover:text-text-primary"
                  >
                    취소
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {tab === 'watch' && (
        <form onSubmit={handleAdd} className="flex gap-1 border-t border-border p-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="+ 종목 추가"
            spellCheck={false}
            className="min-w-0 flex-1 rounded border border-border bg-bg-primary px-2 py-1 text-xs uppercase text-text-primary placeholder:normal-case placeholder:text-text-muted focus:border-accent focus:outline-none"
          />
          <button
            type="submit"
            className="rounded border border-border px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary"
          >
            추가
          </button>
        </form>
      )}

      <p className="border-t border-border px-3 py-1.5 text-[10px] text-text-muted">
        우클릭으로 삭제 · 1초 갱신
      </p>
    </aside>
  );
}
