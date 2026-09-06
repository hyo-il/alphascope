import type { WatchFolder } from '../../types/watchlist';
import type { Quote } from '../../types/toss';
import { formatPercent, formatPrice } from '../../utils/formatters';

/**
 * 관심 목록 패널의 폴더 하나 — **읽기 전용**이다.
 *
 * 패널에서는 보는 것만 한다: 종목 클릭(차트 전환)과 접기/펼치기.
 * 폴더 만들기·이름 변경·삭제·순서 변경·종목 이동은 전부 관리 팝업(⚙️)에 있다.
 * 좁은 사이드 패널에 조작 버튼을 늘어놓으면 정작 시세가 안 보인다.
 */
export default function WatchFolderView({
  folder,
  currentSymbol,
  quotes,
  nameOf,
  onSelect,
  onToggle,
}: {
  folder: WatchFolder;
  currentSymbol: string;
  quotes: Record<string, Quote | undefined>;
  nameOf: (symbol: string) => string | null | undefined;
  onSelect: (symbol: string) => void;
  onToggle: (id: string) => void;
}) {
  return (
    <section className="border-b border-border/40">
      <button
        type="button"
        onClick={() => onToggle(folder.id)}
        className="flex w-full items-center gap-1 bg-bg-tertiary/40 px-2 py-1.5 text-left text-[11px] font-medium text-text-secondary transition-colors hover:text-text-primary"
      >
        <span className="w-3 shrink-0">{folder.collapsed ? '▶' : '▼'}</span>
        <span className="min-w-0 truncate">{folder.name}</span>
        <span className="shrink-0 text-[10px] tabular-nums text-text-muted">
          ({folder.symbols.length})
        </span>
      </button>

      {!folder.collapsed &&
        (folder.symbols.length === 0 ? (
          <p className="px-3 py-2 text-[11px] text-text-muted">비어 있습니다.</p>
        ) : (
          folder.symbols.map((symbol) => {
            const quote = quotes[symbol];
            const rate = quote?.changeRate ?? null;
            const color =
              rate == null
                ? 'text-text-muted'
                : rate > 0
                  ? 'text-bullish'
                  : rate < 0
                    ? 'text-bearish'
                    : 'text-text-secondary';

            return (
              <button
                key={symbol}
                type="button"
                onClick={() => onSelect(symbol)}
                className={`flex w-full items-center justify-between py-2 pl-3 pr-2 text-left transition-colors hover:bg-bg-tertiary/60 ${
                  symbol === currentSymbol ? 'bg-accent/10' : ''
                }`}
              >
                <span className="flex min-w-0 flex-col">
                  <span
                    className={`truncate text-xs font-medium ${
                      symbol === currentSymbol ? 'text-accent' : 'text-text-primary'
                    }`}
                  >
                    {nameOf(symbol) || symbol}
                  </span>
                  {nameOf(symbol) && (
                    <span className="truncate text-[11px] text-text-muted">{symbol}</span>
                  )}
                </span>

                <span
                  className="shrink-0 text-right"
                  title={quote?.stale ? '실시간 조회 실패 — 마지막 캐시 종가입니다.' : undefined}
                >
                  <span className="block text-xs tabular-nums text-text-secondary">
                    {/* 지연 시세는 앞에 · 를 붙여 실시간인 척하지 않게 한다. */}
                    {quote?.price != null
                      ? `${quote.stale ? '· ' : ''}${formatPrice(quote.price, quote.currency)}`
                      : '—'}
                  </span>
                  <span className={`block text-[11px] tabular-nums ${color}`}>
                    {rate == null ? '—' : formatPercent(rate)}
                  </span>
                </span>
              </button>
            );
          })
        ))}
    </section>
  );
}
