import { useEffect, useState } from 'react';
import type { useWatchlist } from '../../hooks/useWatchlist';
import { DEFAULT_FOLDER_ID } from '../../types/watchlist';
import SymbolSearch from '../common/SymbolSearch';
import { modal } from '../../store/uiStore';
import { stockNameOf } from '../../utils/stockNames';

/**
 * 관심 목록 관리 팝업.
 *
 * 좁은 사이드 패널에 조작 버튼을 늘어놓으면 정작 시세가 안 보인다 — 관리는 여기서 하고
 * 패널은 결과만 보여 준다.
 *
 * **저장/취소를 두지 않았다.** 모든 변경은 즉시 localStorage 에 반영된다.
 * 폴더 하나 지우자고 [저장] 을 눌러야 하면, 누르지 않고 닫았을 때 무엇이 남는지
 * 매번 헷갈린다 (원본 지시도 이 방식을 택했다).
 */

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

type Drag =
  | { kind: 'symbol'; symbol: string; from: string }
  | { kind: 'folder'; id: string };

export default function WatchlistManager({
  watch,
  onClose,
}: {
  watch: ReturnType<typeof useWatchlist>;
  onClose: () => void;
}) {
  const { folders } = watch;
  const [adding, setAdding] = useState(false);
  const [addFolder, setAddFolder] = useState(watch.lastFolderId);
  const [newFolder, setNewFolder] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [drag, setDrag] = useState<Drag | null>(null);
  const [dropMark, setDropMark] = useState<{ folderId: string; index: number } | null>(null);

  // ESC 로 닫는다 — 팝업의 기본 기대다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const confirmDeleteFolder = (id: string, name: string, count: number) =>
    modal.confirm({
      title: `'${name}' 폴더 삭제`,
      message:
        count > 0
          ? `안에 있는 ${count}개 종목은 '미분류' 로 옮깁니다. 종목이 지워지지는 않습니다.`
          : '빈 폴더를 삭제합니다.',
      confirmText: '삭제',
      danger: true,
      onConfirm: () => watch.deleteFolder(id),
    });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[min(700px,70vh)] w-[600px] max-w-full flex-col rounded-lg border border-border bg-bg-secondary shadow-2xl"
      >
        <header className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2.5">
          <h2 className="text-sm font-semibold">관심 목록 관리</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="rounded px-2 py-1 text-sm text-text-muted transition-colors hover:bg-bg-tertiary hover:text-text-primary"
          >
            ✕
          </button>
        </header>

        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border px-4 py-2">
          <button
            type="button"
            onClick={() => setNewFolder('')}
            className="rounded border border-border px-2 py-1 text-xs text-text-secondary transition-colors hover:border-accent hover:text-accent"
          >
            + 폴더 추가
          </button>
          <button
            type="button"
            onClick={() => setAdding((v) => !v)}
            className="rounded border border-border px-2 py-1 text-xs text-text-secondary transition-colors hover:border-accent hover:text-accent"
          >
            + 종목 추가
          </button>
          <span className="ml-auto text-[11px] text-text-muted">변경은 바로 저장됩니다</span>
        </div>

        {newFolder !== null && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              watch.createFolder(newFolder);
              setNewFolder(null);
            }}
            className="flex shrink-0 gap-2 border-b border-border px-4 py-2"
          >
            <input
              autoFocus
              value={newFolder}
              onChange={(e) => setNewFolder(e.target.value)}
              onKeyDown={(e) => e.key === 'Escape' && setNewFolder(null)}
              placeholder="폴더 이름 (예: 반도체)"
              className="min-w-0 flex-1 rounded px-2 py-1 text-xs"
            />
            <button
              type="submit"
              className="rounded bg-accent px-2.5 py-1 text-xs text-white transition-colors hover:bg-accent-hover"
            >
              만들기
            </button>
          </form>
        )}

        {adding && (
          <div className="shrink-0 space-y-2 border-b border-border px-4 py-2">
            <div className="flex items-center gap-2">
              <span className="shrink-0 text-xs text-text-secondary">폴더</span>
              <select
                value={folders.some((f) => f.id === addFolder) ? addFolder : DEFAULT_FOLDER_ID}
                onChange={(e) => setAddFolder(e.target.value)}
                className="rounded px-2 py-1 text-xs"
              >
                {folders.map((folder) => (
                  <option key={folder.id} value={folder.id}>
                    {folder.name}
                  </option>
                ))}
              </select>
            </div>
            <SymbolSearch
              symbol=""
              onSubmit={(symbol) => {
                watch.add(symbol, addFolder);
                watch.rememberFolder(addFolder);
              }}
              placeholder="종목 검색 (구글, 애플, AAPL…)"
              submitLabel="추가"
              clearOnSubmit
              isAdded={(candidate) => watch.watchlist.includes(candidate)}
            />
          </div>
        )}

        {/* 폴더 · 종목 목록 */}
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {folders.map((folder) => {
            const isDefault = folder.id === DEFAULT_FOLDER_ID;
            const movable = folders.filter((f) => f.id !== DEFAULT_FOLDER_ID);
            const movableIndex = movable.findIndex((f) => f.id === folder.id);

            return (
              <section
                key={folder.id}
                onDragOver={(e) => {
                  if (drag?.kind === 'folder' && !isDefault) e.preventDefault();
                }}
                onDrop={(e) => {
                  if (drag?.kind !== 'folder') return;
                  e.preventDefault();
                  watch.reorderFolder(drag.id, folder.id);
                  setDrag(null);
                }}
                className="rounded-md border border-border/60"
              >
                <header className="flex items-center gap-2 rounded-t-md bg-bg-tertiary/50 px-2 py-1.5">
                  {!isDefault ? (
                    <span
                      draggable
                      onDragStart={() => setDrag({ kind: 'folder', id: folder.id })}
                      onDragEnd={() => setDrag(null)}
                      title="드래그해 폴더 순서 변경"
                      className="cursor-grab text-text-muted active:cursor-grabbing"
                    >
                      <GripIcon className="h-3.5 w-2.5" />
                    </span>
                  ) : (
                    <span className="w-2.5" />
                  )}
                  <span className="shrink-0">📁</span>

                  {renaming === folder.id ? (
                    <input
                      autoFocus
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={() => {
                        watch.renameFolder(folder.id, draft);
                        setRenaming(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          watch.renameFolder(folder.id, draft);
                          setRenaming(null);
                        }
                        if (e.key === 'Escape') setRenaming(null);
                      }}
                      className="min-w-0 flex-1 rounded px-1.5 py-0.5 text-xs"
                    />
                  ) : (
                    <span className="min-w-0 flex-1 truncate text-xs font-medium">
                      {folder.name}
                      {isDefault && <span className="ml-1.5 text-[10px] text-text-muted">(기본)</span>}
                      <span className="ml-1.5 text-[10px] tabular-nums text-text-muted">
                        {folder.symbols.length}
                      </span>
                    </span>
                  )}

                  {!isDefault && (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          setDraft(folder.name);
                          setRenaming(folder.id);
                        }}
                        className={ACTION}
                      >
                        이름변경
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          confirmDeleteFolder(folder.id, folder.name, folder.symbols.length)
                        }
                        className={`${ACTION} hover:border-bearish hover:text-bearish`}
                      >
                        삭제
                      </button>
                      <button
                        type="button"
                        onClick={() => watch.moveFolder(folder.id, -1)}
                        disabled={movableIndex === 0}
                        title="위로"
                        className={ACTION}
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        onClick={() => watch.moveFolder(folder.id, 1)}
                        disabled={movableIndex === movable.length - 1}
                        title="아래로"
                        className={ACTION}
                      >
                        ▼
                      </button>
                    </>
                  )}
                </header>

                <div
                  onDragOver={(e) => {
                    if (drag?.kind !== 'symbol') return;
                    e.preventDefault();
                    if (!folder.symbols.length) setDropMark({ folderId: folder.id, index: 0 });
                  }}
                  onDrop={(e) => {
                    if (drag?.kind !== 'symbol') return;
                    e.preventDefault();
                    watch.moveSymbol(
                      drag.symbol,
                      folder.id,
                      dropMark?.folderId === folder.id ? dropMark.index : folder.symbols.length,
                    );
                    setDrag(null);
                    setDropMark(null);
                  }}
                  className="min-h-[2rem] p-1"
                >
                  {folder.symbols.length === 0 && (
                    <p className="px-2 py-1 text-[11px] text-text-muted">
                      비어 있습니다. 종목을 끌어다 놓으세요.
                    </p>
                  )}

                  {folder.symbols.map((symbol, index) => (
                    <div key={symbol} className="relative">
                      {dropMark?.folderId === folder.id && dropMark.index === index && (
                        <span className="absolute inset-x-1 -top-px h-0.5 bg-accent" />
                      )}

                      <div
                        onDragOver={(e) => {
                          if (drag?.kind !== 'symbol') return;
                          e.preventDefault();
                          const box = e.currentTarget.getBoundingClientRect();
                          const after = e.clientY - box.top > box.height / 2;
                          setDropMark({ folderId: folder.id, index: after ? index + 1 : index });
                        }}
                        className={`flex items-center gap-2 rounded px-1 py-1 hover:bg-bg-tertiary/50 ${
                          drag?.kind === 'symbol' && drag.symbol === symbol
                            ? 'opacity-40 ring-1 ring-accent'
                            : ''
                        }`}
                      >
                        <span
                          draggable
                          onDragStart={() => setDrag({ kind: 'symbol', symbol, from: folder.id })}
                          onDragEnd={() => {
                            setDrag(null);
                            setDropMark(null);
                          }}
                          title="드래그해 순서·폴더 변경"
                          className="cursor-grab text-text-muted active:cursor-grabbing"
                        >
                          <GripIcon className="h-3.5 w-2.5" />
                        </span>

                        <span className="min-w-0 flex-1 truncate text-xs">
                          <span className="font-medium">{stockNameOf(symbol) || symbol}</span>
                          {stockNameOf(symbol) && (
                            <span className="ml-1.5 text-[11px] text-text-secondary">{symbol}</span>
                          )}
                        </span>

                        <select
                          value={folder.id}
                          onChange={(e) => watch.moveSymbol(symbol, e.target.value)}
                          title="폴더 이동"
                          className="shrink-0 rounded px-1.5 py-0.5 text-[11px]"
                        >
                          {folders.map((target) => (
                            <option key={target.id} value={target.id}>
                              {target.name}
                            </option>
                          ))}
                        </select>

                        <button
                          type="button"
                          onClick={() => watch.remove(symbol)}
                          title="관심 목록에서 삭제"
                          className={`${ACTION} shrink-0 hover:border-bearish hover:text-bearish`}
                        >
                          ✕
                        </button>
                      </div>

                      {index === folder.symbols.length - 1 &&
                        dropMark?.folderId === folder.id &&
                        dropMark.index === folder.symbols.length && (
                          <span className="absolute inset-x-1 -bottom-px h-0.5 bg-accent" />
                        )}
                    </div>
                  ))}
                </div>
              </section>
            );
          })}

          {folders.every((f) => f.symbols.length === 0) && (
            <p className="py-6 text-center text-xs text-text-muted">
              담긴 종목이 없습니다. [+ 종목 추가] 로 시작해 보세요.
            </p>
          )}
        </div>

        <footer className="shrink-0 border-t border-border px-4 py-2 text-[11px] text-text-muted">
          ⠿ 드래그로 순서·폴더 변경 · '미분류' 는 삭제할 수 없고 항상 맨 아래입니다.
        </footer>
      </div>
    </div>
  );
}

const ACTION =
  'shrink-0 rounded border border-border px-1.5 py-0.5 text-[11px] text-text-secondary transition-colors hover:border-accent hover:text-accent disabled:opacity-40 disabled:hover:border-border disabled:hover:text-text-secondary';
