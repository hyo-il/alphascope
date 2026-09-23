import { useEffect, useMemo, useRef, useState } from 'react';
import type { useWatchlist } from '../../hooks/useWatchlist';
import { DEFAULT_FOLDER_ID } from '../../types/watchlist';
import SymbolSearch from '../common/SymbolSearch';
import { modal } from '../../store/uiStore';
import { useQuotes } from '../../hooks/useQuotes';
import { useStockNames } from '../../hooks/useStockNames';
import { formatPercent } from '../../utils/formatters';

/**
 * 관심 종목 편집 팝업 — 토스증권 스타일 2단 레이아웃.
 *
 * 좌: 그룹 목록 / 우: 선택한 그룹의 종목. 예전에는 모든 폴더를 세로로 펼쳐 놓고
 * 행마다 [이름변경][삭제][▲][▼]와 폴더 드롭다운까지 붙어 있어서, 종목이 조금만 늘어도
 * 무엇이 어느 폴더인지 읽히지 않았다. 조작은 **선택 후 툴바**로 모은다 —
 * 행에는 이름과 티커만 남는다.
 *
 * **저장/취소를 두지 않았다.** 모든 변경은 즉시 localStorage 에 반영된다.
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

/** 정렬 방식. '수익률순' 은 시세가 필요해 그때만 폴링한다. */
type SortMode = 'manual' | 'name' | 'change';
const SORT_LABEL: Record<SortMode, string> = {
  manual: '직접 설정한 순',
  name: '이름순',
  change: '수익률순',
};
const SORT_ORDER: SortMode[] = ['manual', 'name', 'change'];

/**
 * 왼쪽 목록 맨 위의 **`전체 종목` 은 폴더가 아니라 '보기'** 다 (2026-09-23).
 *
 * 예전에는 여기 '미분류' 폴더가 있었는데, 사용자에게 그것은 폴더가 아니라
 * "폴더에 없음" 이라는 상태다. 이름변경·삭제·순서변경이 없고 모양도 그룹 행과 구분한다.
 */
const ALL_VIEW = '__all__';

export default function WatchlistManager({
  watch,
  onClose,
}: {
  watch: ReturnType<typeof useWatchlist>;
  onClose: () => void;
}) {
  const { folders } = watch;

  const [selectedFolderId, setSelectedFolderId] = useState<string>(ALL_VIEW);
  const isAllView = selectedFolderId === ALL_VIEW;
  const folder = isAllView ? null : (folders.find((f) => f.id === selectedFolderId) ?? null);
  /** 화면에 그룹으로 보이는 폴더 — 기본 폴더(폴더 없음)는 그룹이 아니다 */
  const movable = folders.filter((f) => f.id !== DEFAULT_FOLDER_ID);
  /** 종목 → 소속 그룹 이름 (없으면 null) — `전체 종목` 보기에서 뒤에 작게 적는다 */
  const folderNameOf = (symbol: string) => {
    const found = folders.find((f) => f.id !== DEFAULT_FOLDER_ID && f.symbols.includes(symbol));
    return found?.name ?? null;
  };

  const [checked, setChecked] = useState<string[]>([]);
  const [sort, setSort] = useState<SortMode>('manual');
  const [adding, setAdding] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
  const [newFolder, setNewFolder] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [dragFolder, setDragFolder] = useState<string | null>(null);
  const [dragSymbol, setDragSymbol] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const moveRef = useRef<HTMLDivElement>(null);

  // 폴더가 바뀌면 선택·열려 있던 조작을 정리한다 — 다른 그룹 종목이 선택된 채로 남으면
  // [삭제]가 화면에 없는 종목을 지운다.
  useEffect(() => {
    setChecked([]);
    setMoveOpen(false);
    setAdding(false);
  }, [selectedFolderId]);

  // ESC 로 닫는다 — 팝업의 기본 기대다. 검색·이름 입력이 열려 있으면 그것부터 닫는다.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (adding) setAdding(false);
      else if (moveOpen) setMoveOpen(false);
      else if (newFolder !== null) setNewFolder(null);
      else if (renaming) setRenaming(null);
      else onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, adding, moveOpen, newFolder, renaming]);

  // [군 이동] 드롭다운은 바깥을 누르면 닫는다.
  useEffect(() => {
    if (!moveOpen) return;
    const onDown = (e: MouseEvent) => {
      if (!moveRef.current?.contains(e.target as Node)) setMoveOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [moveOpen]);

  // `전체 종목` 보기에서는 모든 폴더의 종목을 이어 붙인다 (기본 폴더가 맨 앞이다).
  const symbols = isAllView ? folders.flatMap((f) => f.symbols) : (folder?.symbols ?? []);
  const names = useStockNames(symbols);
  // 수익률순일 때만 시세를 받는다 — 편집 화면이 열려 있는 내내 1초 폴링을 돌릴 이유가 없다.
  const quotes = useQuotes(sort === 'change' ? symbols : []);

  const sorted = useMemo(() => {
    if (sort === 'name') {
      return [...symbols].sort((a, b) =>
        (names(a) || a).localeCompare(names(b) || b, 'ko'),
      );
    }
    if (sort === 'change') {
      return [...symbols].sort(
        (a, b) => (quotes[b]?.changeRate ?? -Infinity) - (quotes[a]?.changeRate ?? -Infinity),
      );
    }
    return symbols;
    // names 는 캐시가 갱신될 때마다 새 값을 돌려주는 조회 함수다 (참조는 그대로).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbols, sort, quotes, names]);

  const allChecked = symbols.length > 0 && checked.length === symbols.length;
  const toggleAll = () => setChecked(allChecked ? [] : [...symbols]);
  const toggleOne = (symbol: string) =>
    setChecked((prev) =>
      prev.includes(symbol) ? prev.filter((s) => s !== symbol) : [...prev, symbol],
    );

  const confirmDeleteSymbols = () =>
    modal.confirm({
      title: '관심 종목 삭제',
      message: `${checked.length}개 종목을 관심 목록에서 삭제합니다.`,
      confirmText: '삭제',
      danger: true,
      onConfirm: () => {
        checked.forEach((symbol) => watch.remove(symbol));
        setChecked([]);
      },
    });

  const confirmDeleteFolder = (id: string, name: string, count: number) =>
    modal.confirm({
      title: `'${name}' 그룹 삭제`,
      message:
        count > 0
          ? `안에 있는 ${count}개 종목은 폴더 밖으로 나옵니다. 종목이 지워지지는 않습니다.`
          : '빈 그룹을 삭제합니다.',
      confirmText: '삭제',
      danger: true,
      onConfirm: () => {
        watch.deleteFolder(id);
        if (selectedFolderId === id) setSelectedFolderId(ALL_VIEW);
      },
    });

  const moveChecked = (targetId: string) => {
    checked.forEach((symbol) => watch.moveSymbol(symbol, targetId));
    setChecked([]);
    setMoveOpen(false);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex h-[min(600px,75vh)] w-[min(700px,80vw)] flex-col overflow-hidden rounded-xl border border-border bg-bg-secondary shadow-2xl"
      >
        <header className="flex shrink-0 items-center justify-between border-b border-border px-5 py-3.5">
          <h2 className="text-base font-semibold">관심 종목 편집</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="flex h-8 w-8 items-center justify-center rounded text-text-muted transition-colors hover:bg-bg-tertiary hover:text-text-primary"
          >
            ✕
          </button>
        </header>

        <div className="flex min-h-0 flex-1">
          {/* ── 좌: 그룹 목록 ───────────────────────────── */}
          <nav className="flex w-[30%] min-w-[160px] shrink-0 flex-col border-r border-border">
            <ul className="min-h-0 flex-1 overflow-y-auto">
              {/*
                ⚠️ **폴더가 아니라 '보기'** 다 — 이름변경·삭제·순서변경이 없다.
                그래서 아이콘(손잡이·▲▼·✕) 없이 굵은 글씨 + 아래 구분선으로 그룹 행과 구분한다.
                종목을 여기에 떨어뜨리면 **폴더에서 빼기**가 된다.
              */}
              <li className="border-b-2 border-border">
                <div
                  onDragOver={(e) => {
                    if (dragSymbol) e.preventDefault();
                  }}
                  onDrop={(e) => {
                    if (!dragSymbol) return;
                    e.preventDefault();
                    const moving = checked.includes(dragSymbol) ? checked : [dragSymbol];
                    moving.forEach((symbol) => watch.moveSymbol(symbol, DEFAULT_FOLDER_ID));
                    setChecked([]);
                    setDragSymbol(null);
                  }}
                  className={`border-l-2 transition-colors ${
                    isAllView ? 'border-accent bg-bg-tertiary' : 'border-transparent hover:bg-bg-tertiary/50'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setSelectedFolderId(ALL_VIEW)}
                    className="flex h-12 w-full items-center gap-2 px-3 text-left"
                  >
                    <span
                      className={`min-w-0 flex-1 truncate text-sm font-semibold ${
                        isAllView ? 'text-text-primary' : 'text-text-secondary'
                      }`}
                    >
                      전체 종목
                    </span>
                    <span className="shrink-0 text-sm tabular-nums text-text-muted">
                      {watch.watchlist.length}
                    </span>
                  </button>
                </div>
              </li>

              {movable.map((f) => {
                const isDefault = false;
                const active = f.id === folder?.id;
                /*
                  ⚠️ 순서 이동의 **주 수단은 ▲▼** 다 (2026-09-22). 드래그 손잡이만 두었더니
                  10×14px 를 정확히 집어야 해서 "순서가 안 바뀐다" 는 신고가 났다 — 그룹 이름을
                  잡으면 아무 일도 일어나지 않는다. `moveFolder` 는 이미 있는 검증된 함수다.
                  인덱스는 그룹으로 보이는 폴더 기준이다(기본 폴더는 목록에 없다).
                */
                const movableIndex = isDefault ? -1 : movable.findIndex((m) => m.id === f.id);

                return (
                  <li
                    key={f.id}
                    onDragOver={(e) => {
                      if (dragFolder && !isDefault) e.preventDefault();
                    }}
                    onDrop={(e) => {
                      if (!dragFolder) return;
                      e.preventDefault();
                      watch.reorderFolder(dragFolder, f.id);
                      setDragFolder(null);
                    }}
                    className={`border-b border-border/70 ${
                      dragFolder === f.id ? 'opacity-40' : ''
                    }`}
                  >
                    {renaming === f.id ? (
                      <input
                        autoFocus
                        value={draft}
                        onChange={(e) => setDraft(e.target.value)}
                        onBlur={() => {
                          watch.renameFolder(f.id, draft);
                          setRenaming(null);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            watch.renameFolder(f.id, draft);
                            setRenaming(null);
                          }
                        }}
                        className="m-2 w-[calc(100%-1rem)] rounded px-2 py-1 text-xs"
                      />
                    ) : (
                      <div
                        className={`group flex h-12 items-center gap-1.5 border-l-2 pr-2 transition-colors ${
                          active
                            ? 'border-accent bg-bg-tertiary'
                            : 'border-transparent hover:bg-bg-tertiary/50'
                        }`}
                      >
                        {/* 손잡이만 draggable — 행 전체를 잡게 하면 그룹을 눌러 여는 동작이 먹힌다 */}
                        {!isDefault ? (
                          <span
                            draggable
                            onDragStart={() => setDragFolder(f.id)}
                            onDragEnd={() => setDragFolder(null)}
                            title="드래그 또는 ▲▼ 로 순서 변경"
                            className="cursor-grab pl-1.5 text-text-muted active:cursor-grabbing"
                          >
                            <GripIcon className="h-4 w-3" />
                          </span>
                        ) : (
                          <span className="w-2.5 pl-1.5" />
                        )}

                        <button
                          type="button"
                          onClick={() => setSelectedFolderId(f.id)}
                          onDoubleClick={() => {
                            if (isDefault) return;
                            setDraft(f.name);
                            setRenaming(f.id);
                          }}
                          className="flex min-w-0 flex-1 items-center gap-2 py-3 text-left"
                        >
                          <span
                            className={`min-w-0 flex-1 truncate text-sm ${
                              active ? 'text-text-primary' : 'text-text-secondary'
                            }`}
                          >
                            {f.name}
                          </span>
                          <span className="shrink-0 text-sm tabular-nums text-text-muted">
                            {f.symbols.length}
                          </span>
                        </button>

                        {!isDefault && (
                          <span className="flex shrink-0 flex-col">
                            {([
                              { dir: -1 as const, label: '▲', disabled: movableIndex <= 0 },
                              {
                                dir: 1 as const,
                                label: '▼',
                                disabled: movableIndex < 0 || movableIndex >= movable.length - 1,
                              },
                            ]).map((b) => (
                              <button
                                key={b.label}
                                type="button"
                                disabled={b.disabled}
                                onClick={() => watch.moveFolder(f.id, b.dir)}
                                title={b.dir === -1 ? '위로 이동' : '아래로 이동'}
                                aria-label={`${f.name} 그룹 ${b.dir === -1 ? '위로' : '아래로'} 이동`}
                                className="rounded px-1 text-[9px] leading-tight text-text-muted/70 transition-colors hover:text-accent disabled:cursor-not-allowed disabled:opacity-25 disabled:hover:text-text-muted/70"
                              >
                                {b.label}
                              </button>
                            ))}
                          </span>
                        )}

                        {!isDefault && (
                          <button
                            type="button"
                            onClick={() => confirmDeleteFolder(f.id, f.name, f.symbols.length)}
                            title="그룹 삭제 (종목은 폴더 밖으로)"
                            aria-label={`${f.name} 그룹 삭제`}
                            className="shrink-0 rounded px-1 text-xs text-text-muted opacity-0 transition-all hover:text-bearish focus:opacity-100 group-hover:opacity-100"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>

            {/*
              ⚠️ '+ 그룹 추가' 는 목록 **아래**다. 맨 위에 두면 입력창처럼 보여 검색창으로
              읽히고, 바로 아래 그룹 행들과 구분되지 않았다. 목록(`flex-1`)이 남은 높이를
              가져가므로 그룹이 적어도 이 버튼은 컬럼 바닥에 붙는다.
            */}
            <div className="mt-auto shrink-0 border-t border-border p-3">
              {newFolder === null ? (
                <button
                  type="button"
                  onClick={() => setNewFolder('')}
                  className="w-full rounded-md border border-border py-1.5 text-xs text-text-secondary transition-colors hover:border-accent hover:text-accent"
                >
                  + 그룹 추가
                </button>
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    watch.createFolder(newFolder);
                    setNewFolder(null);
                  }}
                >
                  <input
                    autoFocus
                    value={newFolder}
                    onChange={(e) => setNewFolder(e.target.value)}
                    onBlur={() => {
                      watch.createFolder(newFolder);
                      setNewFolder(null);
                    }}
                    placeholder="그룹 이름"
                    className="w-full rounded-md px-2 py-1.5 text-xs"
                  />
                </form>
              )}
            </div>

            <p className="shrink-0 border-t border-border px-3 py-2 text-[10px] leading-snug text-text-muted">
              더블클릭: 이름 변경 · ▲▼ 또는 ⠿ 드래그: 순서
            </p>
          </nav>

          {/* ── 우: 선택한 그룹의 종목 ───────────────────── */}
          <section className="flex min-w-0 flex-1 flex-col">
            <div className="flex shrink-0 flex-wrap items-center gap-1.5 border-b border-border px-4 py-2.5">
              <label className="inline-flex w-fit items-center gap-1.5 text-xs text-text-secondary">
                <input
                  type="checkbox"
                  checked={allChecked}
                  onChange={toggleAll}
                  disabled={symbols.length === 0}
                />
                전체
              </label>

              <div ref={moveRef} className="relative">
                <button
                  type="button"
                  onClick={() => setMoveOpen((v) => !v)}
                  disabled={checked.length === 0}
                  className={ACTION}
                >
                  군 이동
                </button>
                {moveOpen && (
                  <ul className="absolute left-0 top-full z-40 mt-1 max-h-56 w-40 overflow-y-auto rounded-md border border-border bg-bg-secondary py-1 shadow-xl">
                    {/*
                      기본 폴더는 이름('미분류')이 아니라 **'폴더에서 빼기'** 라는 동작으로 적는다 —
                      사용자에게 그것은 옮겨 갈 폴더가 아니라 폴더를 벗어나는 일이다.
                    */}
                    <li>
                      <button
                        type="button"
                        onClick={() => moveChecked(DEFAULT_FOLDER_ID)}
                        className="w-full px-3 py-1.5 text-left text-xs text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary"
                      >
                        폴더에서 빼기
                      </button>
                    </li>
                    {movable
                      .filter((f) => f.id !== folder?.id)
                      .map((f) => (
                        <li key={f.id}>
                          <button
                            type="button"
                            onClick={() => moveChecked(f.id)}
                            className="w-full px-3 py-1.5 text-left text-xs text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary"
                          >
                            {f.name}
                          </button>
                        </li>
                      ))}
                  </ul>
                )}
              </div>

              <button
                type="button"
                onClick={confirmDeleteSymbols}
                disabled={checked.length === 0}
                className={`${ACTION} hover:border-bearish hover:text-bearish`}
              >
                🗑 삭제
              </button>

              <button
                type="button"
                onClick={() => setAdding((v) => !v)}
                className={`${ACTION} ml-auto`}
              >
                + 종목 추가
              </button>

              <button
                type="button"
                onClick={() =>
                  setSort((prev) => SORT_ORDER[(SORT_ORDER.indexOf(prev) + 1) % SORT_ORDER.length])
                }
                title="정렬 방식 전환"
                className={ACTION}
              >
                ↕ {SORT_LABEL[sort]}
              </button>
            </div>

            {adding && (
              <div className="shrink-0 border-b border-border px-4 py-2">
                <div className="flex items-center gap-2">
                  <span className="shrink-0 text-xs text-text-muted">🔍</span>
                  <div className="min-w-0 flex-1">
                    <SymbolSearch
                      symbol=""
                      onSubmit={(symbol) => {
                        // `전체 종목` 보기에서 추가하면 폴더 없이 담는다.
                        watch.add(symbol, folder?.id ?? DEFAULT_FOLDER_ID);
                        watch.rememberFolder(folder?.id ?? DEFAULT_FOLDER_ID);
                      }}
                      placeholder={
                        folder ? `'${folder.name}' 에 추가 (구글, 애플, AAPL…)` : '폴더 없이 추가 (구글, 애플, AAPL…)'
                      }
                      submitLabel="추가"
                      compact
                      clearOnSubmit
                      /*
                       * ⚠️ 이 입력창은 팝업 **위쪽**에 있다 — 아래로 펼쳐야 한다.
                       * `compact` 의 기본값은 '위로' 인데(관심 목록 패널의 맨 아래 입력창 기준),
                       * 여기서 위로 열면 팝업 헤더에 가리고 팝업의 `overflow-hidden` 에 잘려
                       * 첫 결과를 누를 수 없다. 비교 화면의 빈 칸 검색도 같은 이유로 false 다.
                       */
                      dropUp={false}
                      isAdded={(candidate) => watch.watchlist.includes(candidate)}
                    />
                  </div>
                  <button type="button" onClick={() => setAdding(false)} className={ACTION}>
                    취소
                  </button>
                </div>
              </div>
            )}

            <div
              className="min-h-0 flex-1 overflow-y-auto"
              onDragOver={(e) => {
                if (dragSymbol && sort === 'manual' && symbols.length === 0) e.preventDefault();
              }}
            >
              {symbols.length === 0 ? (
                <p className="px-4 py-8 text-center text-xs text-text-muted">
                  {isAllView
                    ? '관심 종목이 없습니다. [+ 종목 추가] 로 시작해 보세요.'
                    : '이 그룹에 담긴 종목이 없습니다. [+ 종목 추가] 로 시작해 보세요.'}
                </p>
              ) : (
                sorted.map((symbol, index) => {
                  const isChecked = checked.includes(symbol);
                  const rate = quotes[symbol]?.changeRate ?? null;

                  return (
                    <div key={symbol} className="relative">
                      {dropIndex === index && (
                        <span className="absolute inset-x-2 -top-px z-10 h-0.5 bg-accent" />
                      )}

                      <div
                        onDragOver={(e) => {
                          // `전체 종목` 은 여러 폴더가 섞여 있어 순서 인덱스가 뜻을 잃는다.
                          if (!dragSymbol || sort !== 'manual' || isAllView) return;
                          e.preventDefault();
                          const box = e.currentTarget.getBoundingClientRect();
                          setDropIndex(e.clientY - box.top > box.height / 2 ? index + 1 : index);
                        }}
                        onDrop={(e) => {
                          if (!dragSymbol || !folder) return;
                          e.preventDefault();
                          watch.moveSymbol(dragSymbol, folder.id, dropIndex ?? index);
                          setDragSymbol(null);
                          setDropIndex(null);
                        }}
                        className={`flex h-14 items-center gap-3 border-b border-border/70 px-4 transition-colors hover:bg-bg-tertiary ${
                          isChecked ? 'bg-bg-tertiary/60' : ''
                        } ${
                          dragSymbol === symbol
                            ? 'opacity-40 shadow-lg ring-1 ring-accent'
                            : ''
                        }`}
                      >
                        {/* 손잡이만 draggable — 행 전체는 체크 토글에 쓴다 */}
                        <span
                          draggable={sort === 'manual' && !isAllView}
                          onDragStart={() => setDragSymbol(symbol)}
                          onDragEnd={() => {
                            setDragSymbol(null);
                            setDropIndex(null);
                          }}
                          title={
                            isAllView
                              ? '그룹을 골라야 순서를 바꿀 수 있습니다'
                              : sort === 'manual'
                                ? '드래그해 순서 변경'
                                : '직접 설정한 순일 때만 순서를 바꿀 수 있습니다'
                          }
                          className={`shrink-0 text-text-muted ${
                            sort === 'manual' && !isAllView
                              ? 'cursor-grab active:cursor-grabbing'
                              : 'cursor-not-allowed opacity-30'
                          }`}
                        >
                          <GripIcon className="h-4 w-2.5" />
                        </span>

                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => toggleOne(symbol)}
                          aria-label={`${symbol} 선택`}
                          className="shrink-0"
                        />

                        <button
                          type="button"
                          onClick={() => toggleOne(symbol)}
                          className="flex min-w-0 flex-1 items-center gap-3 text-left"
                        >
                          <span className="min-w-0 flex-1 truncate text-sm font-medium text-text-primary">
                            {names(symbol) || symbol}
                          </span>
                          {names(symbol) && (
                            <span className="shrink-0 text-[13px] tabular-nums text-text-secondary">
                              {symbol}
                            </span>
                          )}
                          {/* 전체 보기에서는 어느 그룹에 있는지 알아야 옮길지 말지 정할 수 있다 */}
                          {isAllView && (
                            <span className="shrink-0 text-[11px] text-text-muted">
                              {folderNameOf(symbol) ?? '—'}
                            </span>
                          )}
                        </button>

                        {sort === 'change' && (
                          <span
                            className={`w-16 shrink-0 text-right text-[13px] tabular-nums ${
                              rate == null
                                ? 'text-text-muted'
                                : rate > 0
                                  ? 'text-bullish'
                                  : rate < 0
                                    ? 'text-bearish'
                                    : 'text-text-secondary'
                            }`}
                          >
                            {rate == null ? '—' : formatPercent(rate)}
                          </span>
                        )}
                      </div>

                      {index === sorted.length - 1 && dropIndex === sorted.length && (
                        <span className="absolute inset-x-2 -bottom-px z-10 h-0.5 bg-accent" />
                      )}
                    </div>
                  );
                })
              )}
            </div>

            <p className="shrink-0 border-t border-border px-4 py-2 text-[10px] text-text-muted">
              변경은 바로 저장됩니다 · 폴더에 넣지 않은 종목은 목록 맨 위에 그대로 보입니다.
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}

const ACTION =
  'shrink-0 rounded border border-border px-2 py-1 text-xs text-text-secondary transition-colors hover:border-accent hover:text-accent disabled:opacity-40 disabled:hover:border-border disabled:hover:text-text-secondary';
