import type { WatchFolder } from '../../types/watchlist';
import type { Quote } from '../../types/toss';
import { COMPARE_DRAG_TYPE } from '../../types/compare';
import { formatPercent, formatPrice } from '../../utils/formatters';

/**
 * 관심 목록 패널의 폴더 하나 — **읽기 전용**이다.
 *
 * 패널에서는 보는 것만 한다: 종목 클릭(차트 전환)과 접기/펼치기.
 * 폴더 만들기·이름 변경·삭제·순서 변경·종목 이동은 전부 관리 팝업(⚙️)에 있다.
 * 좁은 사이드 패널에 조작 버튼을 늘어놓으면 정작 시세가 안 보인다.
 *
 * 기업 비교 화면에서는 **클릭의 뜻이 달라진다** (`compareMode`) — 차트 전환이 아니라
 * 비교에 담기/빼기다. 비교는 관심 목록에서 고르는 것이 기본 방법이라, 담긴 종목은
 * ✓ 와 배경색으로 표시하고 행을 드래그해 비교 영역에 떨어뜨릴 수도 있다.
 */
export default function WatchFolderView({
  folder,
  currentSymbol,
  quotes,
  nameOf,
  onSelect,
  onToggle,
  compareMode = false,
  selectedSymbols = [],
}: {
  folder: WatchFolder;
  currentSymbol: string;
  quotes: Record<string, Quote | undefined>;
  nameOf: (symbol: string) => string | null | undefined;
  onSelect: (symbol: string) => void;
  onToggle: (id: string) => void;
  compareMode?: boolean;
  selectedSymbols?: string[];
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
            const picked = compareMode && selectedSymbols.includes(symbol);
            const highlighted = compareMode ? picked : symbol === currentSymbol;

            return (
              <button
                key={symbol}
                type="button"
                onClick={() => onSelect(symbol)}
                /*
                 * 비교 화면에서만 끌 수 있게 한다. 평소에도 draggable 로 두면
                 * 종목을 눌러 차트를 바꾸려던 동작이 드래그로 먹힌다.
                 */
                draggable={compareMode}
                onDragStart={(e) => {
                  e.dataTransfer.setData(COMPARE_DRAG_TYPE, symbol);
                  e.dataTransfer.setData('text/plain', symbol);
                  e.dataTransfer.effectAllowed = 'copy';
                }}
                title={
                  compareMode
                    ? picked
                      ? `${nameOf(symbol) || symbol} 비교에서 빼기`
                      : `${nameOf(symbol) || symbol} 비교에 담기`
                    : undefined
                }
                className={`flex w-full items-center justify-between py-2 pl-3 pr-2 text-left transition-colors hover:bg-bg-tertiary/60 ${
                  highlighted ? 'bg-accent/10' : ''
                }`}
              >
                <span className="flex min-w-0 flex-col">
                  <span
                    className={`truncate text-xs font-medium ${
                      highlighted ? 'text-accent' : 'text-text-primary'
                    }`}
                  >
                    {/* 담긴 종목은 ✓ 로 한눈에 구분한다 */}
                    {picked && <span className="mr-1 text-accent">✓</span>}
                    {nameOf(symbol) ? `${nameOf(symbol)} (${symbol})` : symbol}
                  </span>
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
