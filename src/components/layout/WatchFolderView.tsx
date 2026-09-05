import { useState } from 'react';
import type { WatchFolder } from '../../types/watchlist';
import { DEFAULT_FOLDER_ID } from '../../types/watchlist';
import type { Quote } from '../../types/toss';
import { formatPercent, formatPrice } from '../../utils/formatters';
import { modal } from '../../store/uiStore';

/**
 * 관심 목록의 폴더 하나 — 헤더(접기·⋮ 메뉴)와 그 안의 종목들.
 *
 * 드래그는 외부 라이브러리 없이 HTML5 Drag and Drop 으로 한다 (번들을 늘리지 않는다).
 * ⚠️ **드래그 손잡이(⠿)만 draggable** 이다. 행 전체를 draggable 로 두면 종목을 클릭해
 * 차트를 바꾸려던 동작이 드래그로 먹혀 버린다.
 */

export type DragPayload =
  | { kind: 'symbol'; symbol: string }
  | { kind: 'folder'; folderId: string };

/** 드롭 위치 표시 — 이 폴더의 몇 번째 앞에 넣을지 */
export interface DropMark {
  folderId: string;
  index: number;
}

function GripIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 10 16" fill="currentColor" className={className} aria-hidden>
      <circle cx="3" cy="3" r="1.2" />
      <circle cx="7" cy="3" r="1.2" />
      <circle cx="3" cy="8" r="1.2" />
      <circle cx="7" cy="8" r="1.2" />
      <circle cx="3" cy="13" r="1.2" />
      <circle cx="7" cy="13" r="1.2" />
    </svg>
  );
}

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

interface Props {
  folder: WatchFolder;
  folders: WatchFolder[];
  currentSymbol: string;
  quotes: Record<string, Quote | undefined>;
  nameOf: (symbol: string) => string | null | undefined;
  dropMark: DropMark | null;
  dragging: DragPayload | null;
  onSelect: (symbol: string) => void;
  onRemove: (symbol: string) => void;
  onToggleFolder: (id: string) => void;
  onRenameFolder: (id: string, name: string) => void;
  onDeleteFolder: (id: string) => void;
  onMoveFolder: (id: string, direction: -1 | 1) => void;
  onMoveSymbol: (symbol: string, folderId: string, index?: number) => void;
  onDragStart: (payload: DragPayload) => void;
  onDragEnd: () => void;
  onDropMark: (mark: DropMark | null) => void;
  onDropFolder: (targetId: string) => void;
}

export default function WatchFolderView({
  folder,
  folders,
  currentSymbol,
  quotes,
  nameOf,
  dropMark,
  dragging,
  onSelect,
  onRemove,
  onToggleFolder,
  onRenameFolder,
  onDeleteFolder,
  onMoveFolder,
  onMoveSymbol,
  onDragStart,
  onDragEnd,
  onDropMark,
  onDropFolder,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(folder.name);
  /** 종목 우클릭 메뉴 — 폴더 이동 */
  const [moveTarget, setMoveTarget] = useState<string | null>(null);

  const isDefault = folder.id === DEFAULT_FOLDER_ID;

  const dropAt = (index: number) => {
    if (dragging?.kind !== 'symbol') return;
    onMoveSymbol(dragging.symbol, folder.id, index);
    onDropMark(null);
  };

  const confirmDelete = () => {
    setMenuOpen(false);
    modal.confirm({
      title: `'${folder.name}' 폴더 삭제`,
      message:
        folder.symbols.length > 0
          ? `안에 있는 ${folder.symbols.length}개 종목은 '미분류' 로 옮깁니다. 종목이 지워지지는 않습니다.`
          : '빈 폴더를 삭제합니다.',
      confirmText: '삭제',
      danger: true,
      onConfirm: () => onDeleteFolder(folder.id),
    });
  };

  return (
    <section className="border-b border-border/40">
      {/* 폴더 헤더 */}
      <div
        className="group/folder relative flex items-center gap-1 bg-bg-tertiary/40 px-1.5 py-1.5"
        onDragOver={(e) => {
          if (dragging?.kind === 'symbol') {
            e.preventDefault();
            // 헤더에 떨어뜨리면 그 폴더의 맨 앞에 넣는다.
            onDropMark({ folderId: folder.id, index: 0 });
          } else if (dragging?.kind === 'folder' && !isDefault) {
            e.preventDefault();
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          if (dragging?.kind === 'symbol') dropAt(0);
          else if (dragging?.kind === 'folder') onDropFolder(folder.id);
        }}
      >
        {/* '미분류' 는 맨 아래 고정이라 손잡이를 주지 않는다 */}
        {!isDefault ? (
          <span
            draggable
            onDragStart={() => onDragStart({ kind: 'folder', folderId: folder.id })}
            onDragEnd={onDragEnd}
            title="드래그해 폴더 순서 변경"
            className="cursor-grab px-0.5 text-text-muted active:cursor-grabbing"
          >
            <GripIcon className="h-3 w-2" />
          </span>
        ) : (
          <span className="w-3" />
        )}

        <button
          type="button"
          onClick={() => onToggleFolder(folder.id)}
          className="flex min-w-0 flex-1 items-center gap-1 text-left text-[11px] font-medium text-text-secondary transition-colors hover:text-text-primary"
        >
          <span className="w-3 shrink-0">{folder.collapsed ? '▶' : '▼'}</span>
          {renaming ? (
            <input
              autoFocus
              value={draft}
              onClick={(e) => e.stopPropagation()}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => {
                onRenameFolder(folder.id, draft);
                setRenaming(false);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  onRenameFolder(folder.id, draft);
                  setRenaming(false);
                }
                if (e.key === 'Escape') {
                  setDraft(folder.name);
                  setRenaming(false);
                }
              }}
              className="min-w-0 flex-1 rounded border border-accent bg-bg-tertiary px-1 py-0.5 text-[11px]"
            />
          ) : (
            <span className="truncate">{folder.name}</span>
          )}
          <span className="shrink-0 text-[10px] tabular-nums text-text-muted">
            ({folder.symbols.length})
          </span>
        </button>

        <button
          type="button"
          onClick={() => setMenuOpen((v) => !v)}
          title="폴더 메뉴"
          className="shrink-0 rounded px-1 text-text-muted transition-colors hover:bg-bg-tertiary hover:text-text-primary"
        >
          ⋮
        </button>

        {menuOpen && (
          <>
            {/* 바깥을 누르면 닫힌다 */}
            <span className="fixed inset-0 z-30" onClick={() => setMenuOpen(false)} />
            <ul className="absolute right-1 top-full z-40 mt-0.5 w-32 overflow-hidden rounded-md border border-border bg-bg-secondary py-1 text-[11px] shadow-xl">
              {isDefault ? (
                <li className="px-2 py-1 text-text-muted">기본 폴더입니다</li>
              ) : (
                <>
                  <li>
                    <button
                      type="button"
                      onClick={() => {
                        setDraft(folder.name);
                        setRenaming(true);
                        setMenuOpen(false);
                      }}
                      className="w-full px-2 py-1 text-left transition-colors hover:bg-bg-tertiary"
                    >
                      이름 변경
                    </button>
                  </li>
                  <li>
                    <button
                      type="button"
                      onClick={() => {
                        onMoveFolder(folder.id, -1);
                        setMenuOpen(false);
                      }}
                      className="w-full px-2 py-1 text-left transition-colors hover:bg-bg-tertiary"
                    >
                      위로 이동
                    </button>
                  </li>
                  <li>
                    <button
                      type="button"
                      onClick={() => {
                        onMoveFolder(folder.id, 1);
                        setMenuOpen(false);
                      }}
                      className="w-full px-2 py-1 text-left transition-colors hover:bg-bg-tertiary"
                    >
                      아래로 이동
                    </button>
                  </li>
                  <li>
                    <button
                      type="button"
                      onClick={confirmDelete}
                      className="w-full px-2 py-1 text-left text-bearish transition-colors hover:bg-bearish/10"
                    >
                      삭제
                    </button>
                  </li>
                </>
              )}
            </ul>
          </>
        )}
      </div>

      {/* 종목 목록 */}
      {!folder.collapsed && (
        <div
          onDragOver={(e) => {
            if (dragging?.kind === 'symbol') {
              e.preventDefault();
              if (!folder.symbols.length) onDropMark({ folderId: folder.id, index: 0 });
            }
          }}
          onDrop={(e) => {
            if (dragging?.kind !== 'symbol') return;
            e.preventDefault();
            dropAt(dropMark?.folderId === folder.id ? dropMark.index : folder.symbols.length);
          }}
        >
          {folder.symbols.length === 0 && (
            <p className="px-3 py-2 text-[11px] text-text-muted">
              비어 있습니다. 종목을 끌어다 놓으세요.
            </p>
          )}

          {folder.symbols.map((symbol, index) => {
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
            const markHere = dropMark?.folderId === folder.id && dropMark.index === index;

            return (
              <div key={symbol} className="relative">
                {markHere && <span className="absolute inset-x-2 -top-px z-10 h-0.5 bg-accent" />}

                <div
                  onDragOver={(e) => {
                    if (dragging?.kind !== 'symbol') return;
                    e.preventDefault();
                    // 행의 위쪽 절반이면 앞, 아래쪽 절반이면 뒤에 넣는다.
                    const box = e.currentTarget.getBoundingClientRect();
                    const after = e.clientY - box.top > box.height / 2;
                    onDropMark({ folderId: folder.id, index: after ? index + 1 : index });
                  }}
                  onDrop={(e) => {
                    if (dragging?.kind !== 'symbol') return;
                    e.preventDefault();
                    e.stopPropagation();
                    dropAt(dropMark?.folderId === folder.id ? dropMark.index : index);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setMoveTarget(moveTarget === symbol ? null : symbol);
                  }}
                  className={`group flex items-center transition-colors hover:bg-bg-tertiary/60 ${
                    symbol === currentSymbol ? 'bg-accent/10' : ''
                  } ${dragging?.kind === 'symbol' && dragging.symbol === symbol ? 'opacity-40 ring-1 ring-accent' : ''}`}
                >
                  <span
                    draggable
                    onDragStart={() => onDragStart({ kind: 'symbol', symbol })}
                    onDragEnd={onDragEnd}
                    title="드래그해 순서·폴더 변경"
                    className="cursor-grab px-1 py-2 text-text-muted opacity-0 transition-opacity active:cursor-grabbing group-hover:opacity-100"
                  >
                    <GripIcon className="h-3 w-2" />
                  </span>

                  <button
                    type="button"
                    onClick={() => onSelect(symbol)}
                    className="flex min-w-0 flex-1 items-center justify-between py-2 pr-1 text-left"
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
                    onClick={() => onRemove(symbol)}
                    title="관심 목록에서 삭제"
                    aria-label={`${symbol} 삭제`}
                    className="mr-2 shrink-0 rounded p-1 text-text-muted opacity-0 transition-all hover:bg-bearish/15 hover:text-bearish focus:opacity-100 group-hover:opacity-100"
                  >
                    <TrashIcon className="h-3.5 w-3.5" />
                  </button>
                </div>

                {/* 우클릭 → 폴더 이동 */}
                {moveTarget === symbol && (
                  <>
                    <span className="fixed inset-0 z-30" onClick={() => setMoveTarget(null)} />
                    <ul className="absolute right-2 top-full z-40 w-32 overflow-hidden rounded-md border border-border bg-bg-secondary py-1 text-[11px] shadow-xl">
                      <li className="px-2 py-1 text-text-muted">폴더 이동</li>
                      {folders.map((target) => (
                        <li key={target.id}>
                          <button
                            type="button"
                            disabled={target.id === folder.id}
                            onClick={() => {
                              onMoveSymbol(symbol, target.id);
                              setMoveTarget(null);
                            }}
                            className="w-full truncate px-2 py-1 text-left transition-colors hover:bg-bg-tertiary disabled:text-text-muted disabled:hover:bg-transparent"
                          >
                            {target.id === folder.id ? `${target.name} (현재)` : target.name}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                {/* 마지막 항목 뒤에 놓는 자리 */}
                {index === folder.symbols.length - 1 &&
                  dropMark?.folderId === folder.id &&
                  dropMark.index === folder.symbols.length && (
                    <span className="absolute inset-x-2 -bottom-px z-10 h-0.5 bg-accent" />
                  )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
