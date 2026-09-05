import { useState } from 'react';
import SymbolSearch from '../common/SymbolSearch';
import WatchFolderView, { type DragPayload, type DropMark } from './WatchFolderView';
import type { useWatchlist } from '../../hooks/useWatchlist';
import { DEFAULT_FOLDER_ID } from '../../types/watchlist';
import { useQuotes } from '../../hooks/useQuotes';
import { useStockNames } from '../../hooks/useStockNames';
import { formatPercent, formatPrice } from '../../utils/formatters';

interface Props {
  currentSymbol: string;
  /** `useWatchlist()` 결과 그대로 — 폴더 조작이 많아 통째로 받는다 */
  watch: ReturnType<typeof useWatchlist>;
  recent: string[];
  onSelect: (symbol: string) => void;
  /** 최근 조회에서 제거 */
  onRemoveRecent: (symbol: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

type PanelTab = 'watch' | 'recent';

/** 별 아이콘 — 관심 목록을 뜻한다 */
function StarIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden>
      <path d="M10 1.6l2.47 5.3 5.53.68-4.09 3.9 1.06 5.72L10 14.5l-4.97 2.7 1.06-5.72L2 7.58l5.53-.68L10 1.6z" />
    </svg>
  );
}

/** 시계 아이콘 — 최근 조회를 뜻한다 */
function ClockIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden>
      <circle cx="10" cy="10" r="7.5" />
      <path d="M10 5.5V10l3 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 휴지통 아이콘 — 목록에서 제거 */
function TrashIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className={className} aria-hidden>
      <path d="M3.5 5.5h13" strokeLinecap="round" />
      <path d="M8 5.5V4a1 1 0 011-1h2a1 1 0 011 1v1.5" strokeLinecap="round" />
      <path d="M5.5 5.5l.7 10a1.5 1.5 0 001.5 1.4h4.6a1.5 1.5 0 001.5-1.4l.7-10" strokeLinejoin="round" />
      <path d="M8.5 8.5v5M11.5 8.5v5" strokeLinecap="round" />
    </svg>
  );
}

/** 오른쪽 사이드 패널 — 관심 목록과 최근 조회. 클릭하면 즉시 그 종목 차트로 전환된다. */
export default function WatchPanel({
  currentSymbol,
  watch,
  recent,
  onSelect,
  onRemoveRecent,
  collapsed,
  onToggleCollapse,
}: Props) {
  const [tab, setTab] = useState<PanelTab>('watch');
  /** 새 종목을 어느 폴더에 담을지 */
  const [addFolder, setAddFolder] = useState(watch.lastFolderId);
  const [newFolder, setNewFolder] = useState<string | null>(null);
  const [dragging, setDragging] = useState<DragPayload | null>(null);
  const [dropMark, setDropMark] = useState<DropMark | null>(null);

  const { folders, watchlist, visibleSymbols } = watch;

  /*
   * 폴링 대상은 **펼쳐진 폴더의 종목뿐**이다. 접어 둔 폴더까지 1초마다 받아 오면
   * 보지도 않는 값에 Rate Limit 을 쓴다.
   */
  const symbols = tab === 'watch' ? visibleSymbols : recent;
  const quotes = useQuotes(collapsed ? [] : symbols);
  // 티커만 있으면 어떤 종목인지 바로 떠오르지 않는다 — 이름을 함께 적는다.
  const names = useStockNames(collapsed ? [] : symbols);

  // 접힌 상태 — 눈에 띄는 세로 탭. 세로 텍스트로 정체가 바로 드러난다.
  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onToggleCollapse}
        title="관심 목록 열기"
        className="group flex w-9 shrink-0 flex-col items-center gap-2 border-l border-border bg-bg-secondary py-3 transition-colors hover:bg-bg-tertiary"
      >
        <span className="flex h-6 w-6 items-center justify-center rounded text-base text-text-secondary transition-colors group-hover:bg-bg-tertiary group-hover:text-text-primary">
          ‹
        </span>

        <span className="flex flex-col items-center gap-0.5 text-warning">
          <StarIcon className="h-5 w-5" />
          <span className="text-[10px] tabular-nums text-text-secondary">{watchlist.length}</span>
        </span>

        <span
          className="text-[11px] leading-tight tracking-widest text-text-secondary transition-colors group-hover:text-text-primary"
          style={{ writingMode: 'vertical-rl' }}
        >
          관심
        </span>

        <span className="my-0.5 h-px w-4 bg-border" />

        <span className="flex flex-col items-center gap-0.5 text-text-muted">
          <ClockIcon className="h-5 w-5" />
          <span className="text-[10px] tabular-nums text-text-secondary">{recent.length}</span>
        </span>

        <span
          className="text-[11px] leading-tight tracking-widest text-text-secondary transition-colors group-hover:text-text-primary"
          style={{ writingMode: 'vertical-rl' }}
        >
          최근
        </span>
      </button>
    );
  }

  return (
    <aside className="flex w-[250px] shrink-0 flex-col border-l border-border bg-bg-secondary">
      <div className="flex items-center border-b border-border">
        {(
          [
            ['watch', '관심 목록', <StarIcon key="s" className="h-3 w-3" />],
            ['recent', '최근 조회', <ClockIcon key="c" className="h-3 w-3" />],
          ] as const
        ).map(([id, label, icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`flex flex-1 items-center justify-center gap-1.5 border-b-2 py-2 text-xs transition-colors ${
              tab === id
                ? 'border-accent text-text-primary'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            {icon}
            {label}
          </button>
        ))}
        <button
          type="button"
          onClick={onToggleCollapse}
          title="접기"
          className="px-2 text-xs text-text-muted transition-colors hover:text-text-primary"
        >
          ›
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'watch' ? (
          folders.map((folder) => (
            <WatchFolderView
              key={folder.id}
              folder={folder}
              folders={folders}
              currentSymbol={currentSymbol}
              quotes={quotes}
              nameOf={names}
              dropMark={dropMark}
              dragging={dragging}
              onSelect={onSelect}
              onRemove={watch.remove}
              onToggleFolder={watch.toggleFolder}
              onRenameFolder={watch.renameFolder}
              onDeleteFolder={watch.deleteFolder}
              onMoveFolder={watch.moveFolder}
              onMoveSymbol={watch.moveSymbol}
              onDragStart={setDragging}
              onDragEnd={() => {
                setDragging(null);
                setDropMark(null);
              }}
              onDropMark={setDropMark}
              onDropFolder={(targetId) => {
                if (dragging?.kind === 'folder') watch.reorderFolder(dragging.folderId, targetId);
                setDragging(null);
                setDropMark(null);
              }}
            />
          ))
        ) : recent.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-text-muted">
            최근 조회한 종목이 없습니다.
          </p>
        ) : (
          recent.map((symbol) => {
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
              <div
                key={symbol}
                className={`group flex items-center transition-colors hover:bg-bg-tertiary/60 ${
                  symbol === currentSymbol ? 'bg-accent/10' : ''
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelect(symbol)}
                  className="flex min-w-0 flex-1 items-center justify-between py-2 pl-3 pr-1 text-left"
                >
                  <span className="flex min-w-0 flex-col">
                    <span
                      className={`truncate text-xs font-medium ${
                        symbol === currentSymbol ? 'text-accent' : 'text-text-primary'
                      }`}
                    >
                      {names(symbol) || symbol}
                    </span>
                    {names(symbol) && (
                      <span className="truncate text-[11px] text-text-muted">{symbol}</span>
                    )}
                  </span>
                  <span
                    className="shrink-0 text-right"
                    title={quote?.stale ? '실시간 조회 실패 — 마지막 캐시 종가입니다.' : undefined}
                  >
                    <span className="block text-xs tabular-nums text-text-secondary">
                      {quote?.price != null
                        ? `${quote.stale ? '· ' : ''}${formatPrice(quote.price, quote.currency)}`
                        : '—'}
                    </span>
                    <span className={`block text-[11px] tabular-nums ${color}`}>
                      {rate == null ? '—' : formatPercent(rate)}
                    </span>
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => onRemoveRecent(symbol)}
                  title="최근 조회에서 삭제"
                  aria-label={`${symbol} 삭제`}
                  className="mr-2 shrink-0 rounded p-1 text-text-muted opacity-0 transition-all hover:bg-bearish/15 hover:text-bearish focus:opacity-100 group-hover:opacity-100"
                >
                  <TrashIcon className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })
        )}
      </div>

      {tab === 'watch' ? (
        <div className="space-y-1.5 border-t border-border p-2">
          {/* 어느 폴더에 담을지 — 마지막으로 쓴 폴더를 기억한다 */}
          <div className="flex items-center gap-1">
            <select
              value={folders.some((f) => f.id === addFolder) ? addFolder : DEFAULT_FOLDER_ID}
              onChange={(e) => setAddFolder(e.target.value)}
              title="추가할 폴더"
              className="min-w-0 flex-1 rounded px-1.5 py-1 text-[11px]"
            >
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setNewFolder('')}
              title="폴더 추가"
              className="shrink-0 rounded border border-border px-1.5 py-1 text-[11px] text-text-secondary transition-colors hover:border-accent hover:text-accent"
            >
              + 폴더
            </button>
          </div>

          {newFolder !== null && (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                watch.createFolder(newFolder);
                setNewFolder(null);
              }}
              className="flex gap-1"
            >
              <input
                autoFocus
                value={newFolder}
                onChange={(e) => setNewFolder(e.target.value)}
                onKeyDown={(e) => e.key === 'Escape' && setNewFolder(null)}
                placeholder="폴더 이름 (예: 반도체)"
                className="min-w-0 flex-1 rounded px-1.5 py-1 text-[11px]"
              />
              <button
                type="submit"
                className="shrink-0 rounded bg-accent px-2 py-1 text-[11px] text-white transition-colors hover:bg-accent-hover"
              >
                만들기
              </button>
            </form>
          )}

          {/*
           * 차트 헤더와 **같은 검색 컴포넌트**를 쓴다. 예전에는 여기만 평범한 입력창이라
           * "구글" 을 치면 그대로 대문자로 바꿔 GOOGL 이 아니라 "구글" 을 담으려 했다.
           */}
          <SymbolSearch
            symbol=""
            onSubmit={(symbol) => {
              watch.add(symbol, addFolder);
              watch.rememberFolder(addFolder);
            }}
            placeholder="+ 종목 추가 (구글, 애플…)"
            submitLabel="추가"
            compact
            clearOnSubmit
            isAdded={(candidate: string) => watchlist.includes(candidate)}
          />
        </div>
      ) : (
        recent.length > 0 && (
          <button
            type="button"
            onClick={() => recent.forEach(onRemoveRecent)}
            className="flex items-center justify-center gap-1.5 border-t border-border py-2 text-xs text-text-muted transition-colors hover:text-bearish"
          >
            <TrashIcon className="h-3.5 w-3.5" />
            기록 모두 지우기
          </button>
        )
      )}

      <p className="border-t border-border px-3 py-1.5 text-[10px] text-text-muted">
        클릭: 종목 전환 · ⠿ 드래그: 순서·폴더 변경 · 우클릭: 폴더 이동
      </p>
    </aside>
  );
}
