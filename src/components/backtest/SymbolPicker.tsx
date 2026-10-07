import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Search, X } from 'lucide-react';
import StockName from '../common/StockName';
import SymbolSearch from '../common/SymbolSearch';
import { SkeletonList } from '../common/SkeletonLoader';
import { Button, IconButton, ListRemoveButton, Panel, RemoveAllButton, SectionTitle } from '../ui';
import { ICON_SM } from '../ui/icon';
import { isChoseongOnly, toChoseong, toJamo } from '../../utils/hangul';
import { stockNameOf } from '../../utils/stockNames';
import type { BacktestUniverse } from '../../types/backtest';

/**
 * ① 종목 고르기 (v2.38.0 → v2.40.0 팝업) — 화면에는 **고른 종목 칩**만 두고, 고르는 일은 [종목 고르기] 팝업에서 한다.
 * - 팝업 왼쪽: 목록 안 검색(이름·티커·초성 — `utils/hangul.ts`) · 「종목 추가」(목록 밖 검색 → 「직접 추가한 종목」 묶음에 넣고 바로 선택) ·
 *   묶음(내 관심 목록 → 7분야 → 직접 추가한 종목, 접기·펴기, [전부 선택]). 행 클릭 = 선택/선택 해제(체크 + 밝은 바탕).
 *   「직접 추가한 종목」 은 행마다 ×(선택도 함께 해제) + [모두 삭제](목록에서 삭제라 확인 창 없음).
 * - 팝업 오른쪽: 「고른 종목 N개」 목록(분야, ×, [모두 삭제]). 방법이 2개 이상이면 20개 한도와 지금 개수(넘으면 빨간 글자).
 * - 누르는 즉시 반영(저장/취소 없음 — 관심 관리 창과 같은 방식). ESC·바깥 클릭·[닫기] 로 닫는다.
 * - 고른 값·직접 추가한 종목은 `alphascope.backtestDraft` 에 남는다(훅이 맡는다).
 */
interface Row {
  symbol: string;
  name: string | null;
  sector: string | null;
}

function matches(row: Row, q: string): boolean {
  if (!q) return true;
  const name = row.name ?? stockNameOf(row.symbol) ?? '';
  const lower = q.toLowerCase();
  if (row.symbol.toLowerCase().includes(lower) || name.toLowerCase().includes(lower)) return true;
  if (isChoseongOnly(q)) return toChoseong(name).includes(q.replace(/\s/g, ''));
  return toJamo(name).includes(toJamo(q));
}

interface PickerProps {
  universe: BacktestUniverse | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  selected: string[];
  added: string[];
  onToggle: (s: string) => void;
  onAddMany: (list: string[]) => void;
  onRemoveMany: (list: string[]) => void;
  /** 목록 밖 종목 — 「직접 추가한 종목」 에 넣고 선택 */
  onAddOutside: (s: string) => void;
  /** 「직접 추가한 종목」 에서 삭제(선택도 해제) */
  onRemoveAdded: (list: string[]) => void;
  /** 방법이 2개 이상일 때의 종목 한도(아니면 null) */
  limit: number | null;
}

function Group({
  id,
  title,
  rows,
  selected,
  onToggle,
  onAll,
  open,
  setOpen,
  showSector,
  emptyText,
  onRemoveRow,
  onRemoveAll,
}: {
  id: string;
  title: string;
  rows: Row[];
  selected: Set<string>;
  onToggle: (s: string) => void;
  onAll: (rows: Row[], add: boolean) => void;
  open: boolean;
  setOpen: (v: boolean) => void;
  showSector: boolean;
  emptyText: string;
  onRemoveRow?: (s: string) => void;
  onRemoveAll?: () => void;
}) {
  const all = rows.length > 0 && rows.every((r) => selected.has(r.symbol));
  return (
    <section>
      <div className="flex items-center gap-2 px-1 py-1">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          aria-controls={`bt-group-${id}`}
          className="flex min-w-0 flex-1 items-center gap-1 text-left text-xs font-medium text-text-secondary hover:text-text-primary"
        >
          {open ? <ChevronDown {...ICON_SM} /> : <ChevronRight {...ICON_SM} />}
          <span className="truncate">{title}</span>
          <span className="shrink-0 text-text-muted">{rows.length}</span>
        </button>
        {onRemoveAll && rows.length > 0 && <RemoveAllButton onClick={onRemoveAll} />}
        {rows.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => onAll(rows, !all)}>
            {all ? '선택 해제' : '전부 선택'}
          </Button>
        )}
      </div>
      {open && (
        <ul id={`bt-group-${id}`}>
          {rows.map((r) => {
            const on = selected.has(r.symbol);
            return (
              <li key={r.symbol} className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onToggle(r.symbol)}
                  aria-pressed={on}
                  className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
                    on ? 'bg-bg-elevated text-text-primary' : 'hover:bg-bg-tertiary'
                  }`}
                >
                  <span className={`flex h-4 w-4 shrink-0 items-center justify-center ${on ? 'text-text-primary' : 'text-transparent'}`}>
                    <Check {...ICON_SM} aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1 truncate">
                    <StockName symbol={r.symbol} name={r.name} size="sm" />
                  </span>
                  {showSector && <span className="shrink-0 text-[13px] text-text-muted">{r.sector ?? '분야 미확인'}</span>}
                </button>
                {onRemoveRow && <ListRemoveButton onClick={() => onRemoveRow(r.symbol)} name={r.symbol} label="직접 추가한 종목에서 삭제" keeps="선택도 함께 해제" />}
              </li>
            );
          })}
          {rows.length === 0 && <li className="px-2 py-1.5 text-[13px] text-text-muted">{emptyText}</li>}
        </ul>
      )}
    </section>
  );
}

function PickerModal({ onClose, ...p }: PickerProps & { onClose: () => void }) {
  const { universe, loading, error, onRetry, selected, added, onToggle, onAddMany, onRemoveMany, onAddOutside, onRemoveAdded, limit } = p;
  const [query, setQuery] = useState('');
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({ watch: true, added: true });
  const sel = useMemo(() => new Set(selected), [selected]);
  const q = query.trim();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const sectorOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of universe?.sectors ?? []) for (const s of g.symbols) m.set(s.symbol, g.sector);
    for (const w of universe?.watchlist ?? []) if (w.sector && !m.has(w.symbol)) m.set(w.symbol, w.sector);
    return m;
  }, [universe]);

  const groups = useMemo(() => {
    if (!universe) return [];
    const out: { id: string; title: string; rows: Row[]; showSector: boolean }[] = [
      { id: 'watch', title: '내 관심 목록', rows: universe.watchlist.map((w) => ({ ...w })), showSector: true },
      ...universe.sectors.map((g) => ({
        id: `sector-${g.sector}`,
        title: g.sector,
        rows: g.symbols.map((s) => ({ ...s, sector: g.sector })),
        showSector: false,
      })),
      { id: 'added', title: '직접 추가한 종목', rows: added.map((s) => ({ symbol: s, name: null, sector: sectorOf.get(s) ?? null })), showSector: true },
    ];
    return out.map((g) => ({ ...g, rows: g.rows.filter((r) => matches(r, q)) }));
  }, [universe, added, q, sectorOf]);

  const watchAll = universe?.watchlist.map((w) => w.symbol) ?? [];
  const over = limit != null && selected.length > limit;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="백테스트 종목 고르기"
      className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex h-[min(680px,85vh)] w-[min(960px,90vw)] flex-col rounded-xl bg-bg-secondary shadow-xl">
        <div className="flex items-center gap-2 border-b border-border/50 px-4 py-3">
          <h3 className="text-sm font-semibold text-text-primary">종목 고르기</h3>
          <span className="text-[13px] text-text-muted">누르는 즉시 반영됩니다</span>
          <IconButton icon={X} label="닫기" size="sm" className="ml-auto" onClick={onClose} />
        </div>

        <div className="flex min-h-0 flex-1">
          {/* 왼쪽 — 묶음 목록 */}
          <div className="flex min-w-0 flex-1 flex-col gap-2 border-r border-border/40 p-3">
            <label className="flex items-center gap-2 rounded-md bg-bg-tertiary px-2">
              <Search {...ICON_SM} className="shrink-0 text-text-muted" aria-hidden />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="목록 안에서 찾기 (이름·티커·초성)"
                aria-label="목록 안에서 찾기"
                className="h-8 min-w-0 flex-1 bg-transparent text-xs outline-none"
              />
            </label>
            <SymbolSearch
              symbol=""
              compact
              dropUp={false}
              clearOnSubmit
              placeholder="목록에 없는 종목 검색"
              submitLabel="종목 추가"
              isAdded={(s) => sel.has(s.toUpperCase())}
              onSubmit={(s) => onAddOutside(s.toUpperCase())}
            />
            <Button size="sm" onClick={() => onAddMany(watchAll)} disabled={!watchAll.length || watchAll.every((s) => sel.has(s))} className="self-start">
              관심 목록 전부 선택
            </Button>
            <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 [scrollbar-gutter:stable]">
              {loading && !universe ? (
                <SkeletonList count={6} />
              ) : error && !universe ? (
                <div className="space-y-2 p-2 text-[13px] text-bearish">
                  <p>종목 목록을 불러오지 못했습니다: {error}</p>
                  <Button size="sm" onClick={onRetry}>
                    다시 시도
                  </Button>
                </div>
              ) : (
                groups.map((g) => (
                  <Group
                    key={g.id}
                    id={g.id}
                    title={g.title}
                    rows={g.rows}
                    selected={sel}
                    onToggle={onToggle}
                    onAll={(rows, add) => (add ? onAddMany(rows.map((r) => r.symbol)) : onRemoveMany(rows.map((r) => r.symbol)))}
                    // 찾는 중이면 맞는 종목이 있는 묶음을 펼친다
                    open={q ? g.rows.length > 0 : (openMap[g.id] ?? false)}
                    setOpen={(v) => setOpenMap((m) => ({ ...m, [g.id]: v }))}
                    showSector={g.showSector}
                    emptyText={q ? '맞는 종목이 없습니다.' : g.id === 'added' ? '위 「종목 추가」 로 넣은 종목이 여기에 보입니다.' : '종목이 없습니다.'}
                    onRemoveRow={g.id === 'added' ? (s) => onRemoveAdded([s]) : undefined}
                    onRemoveAll={g.id === 'added' ? () => onRemoveAdded(added) : undefined}
                  />
                ))
              )}
              {universe && <p className="px-1 pt-2 text-[13px] text-text-muted">분야 묶음 = 미국 시가총액 상위 100 기준 {universe.asOf.slice(0, 10)}</p>}
            </div>
          </div>

          {/* 오른쪽 — 고른 종목 */}
          <div className="flex w-[300px] shrink-0 flex-col gap-2 p-3">
            <div className="flex items-center gap-2">
              <p className="text-xs font-semibold text-text-primary">고른 종목 {selected.length}개</p>
              {selected.length > 0 && <RemoveAllButton onClick={() => onRemoveMany(selected)} className="ml-auto" />}
            </div>
            {limit != null && (
              <p className={`text-[13px] ${over ? 'text-bearish' : 'text-text-muted'}`}>
                방법을 비교할 때는 {limit}개까지 — 지금 {selected.length}개
              </p>
            )}
            <ul className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 [scrollbar-gutter:stable]">
              {selected.map((s) => (
                <li key={s} className="flex items-center gap-2 rounded-md px-2 py-1 hover:bg-bg-tertiary/60">
                  <span className="min-w-0 flex-1 truncate">
                    <StockName symbol={s} size="sm" />
                  </span>
                  <span className="shrink-0 text-[13px] text-text-muted">{sectorOf.get(s) ?? '분야 미확인'}</span>
                  <ListRemoveButton onClick={() => onToggle(s)} name={s} label="고른 종목에서 삭제" />
                </li>
              ))}
              {selected.length === 0 && <li className="px-2 py-1.5 text-[13px] text-text-muted">왼쪽에서 종목을 누르면 여기에 보입니다.</li>}
            </ul>
          </div>
        </div>

        <div className="flex justify-end border-t border-border/50 px-4 py-3">
          <Button onClick={onClose}>닫기</Button>
        </div>
      </div>
    </div>
  );
}

/** ① 자리 — 고른 종목 칩(2줄까지, 넘치면 「+N개 더 보기」) + [종목 고르기] + [모두 삭제] */
export default function SymbolPicker(props: PickerProps) {
  const { selected, onToggle, onRemoveMany, limit } = props;
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [hidden, setHidden] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);
  const over = limit != null && selected.length > limit;

  // 접힌 상태에서 2줄 밖으로 밀린 칩 수를 센다(+N개 더 보기)
  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box || expanded) {
      setHidden(0);
      return;
    }
    const chips = [...box.children] as HTMLElement[];
    if (!chips.length) {
      setHidden(0);
      return;
    }
    const tops = [...new Set(chips.map((c) => c.offsetTop))].sort((a, b) => a - b);
    const limitTop = tops[1] ?? tops[0];
    setHidden(chips.filter((c) => c.offsetTop > limitTop).length);
  }, [selected, expanded]);

  return (
    <Panel pad="sm" className="space-y-2">
      <SectionTitle
        aside={`고른 종목 ${selected.length}개`}
        right={
          <span className="flex items-center gap-2">
            {selected.length > 0 && <RemoveAllButton onClick={() => onRemoveMany(selected)} />}
            <Button size="sm" onClick={() => setOpen(true)}>
              종목 고르기
            </Button>
          </span>
        }
      >
        ① 종목
      </SectionTitle>
      {selected.length === 0 ? (
        <p className="text-[13px] text-text-muted">[종목 고르기] 에서 관심 목록·분야별 종목을 고르거나 다른 종목을 추가하세요.</p>
      ) : (
        <>
          <div ref={boxRef} className={`flex flex-wrap gap-1.5 overflow-hidden ${expanded ? '' : 'max-h-[3.75rem]'}`}>
            {selected.map((s) => (
              <span key={s} className="inline-flex items-center gap-0.5 rounded-md bg-bg-tertiary py-0.5 pl-2 pr-0.5 text-[13px]">
                <StockName symbol={s} size="sm" />
                <ListRemoveButton onClick={() => onToggle(s)} name={s} label="고른 종목에서 삭제" />
              </span>
            ))}
          </div>
          {(hidden > 0 || expanded) && (
            <button type="button" onClick={() => setExpanded((v) => !v)} className="text-[13px] text-text-secondary hover:text-text-primary">
              {expanded ? '접기' : `+${hidden}개 더 보기`}
            </button>
          )}
        </>
      )}
      {over && <p className="text-[13px] text-bearish">방법을 비교할 때는 종목을 {limit}개까지 고를 수 있습니다 — 지금 {selected.length}개</p>}
      {open && <PickerModal {...props} onClose={() => setOpen(false)} />}
    </Panel>
  );
}
