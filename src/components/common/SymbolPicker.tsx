import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Check, ChevronDown, ChevronRight, Search } from 'lucide-react';
import StockName from './StockName';
import SymbolSearch from './SymbolSearch';
import { SkeletonList } from './SkeletonLoader';
import { Button, ListRemoveButton, RemoveAllButton, Tabs } from '../ui';
import Dialog from '../ui/Dialog';
import { ICON_SM } from '../ui/icon';
import { useBacktestUniverse } from '../../hooks/useBacktest';
import { useWatchlist } from '../../hooks/useWatchlist';
import { useStockNames } from '../../hooks/useStockNames';
import { DEFAULT_FOLDER_ID } from '../../types/watchlist';
import { isChoseongOnly, toChoseong, toJamo } from '../../utils/hangul';
import { stockNameOf } from '../../utils/stockNames';

/**
 * 여러 종목 고르기 — 앱에 하나 (v2.41.0). 자동매매 대상 종목 · 백테스트 · 목표 수익 가능성 · AI 지정 종목이 같은 부품을 쓴다.
 * (한 종목만 고르는 검색은 `SymbolSearch`, 기업 비교는 칸에 놓는 방식이라 예외 — CLAUDE.md 「공통 동작 규칙」)
 *
 * 화면에 놓이는 부분: 도구 줄 [종목 고르기] · (화면별 버튼) · (N/최대) · [모두 삭제] + 고른 종목 칩(× = 목록에서 삭제, 2줄 넘으면 「+N개 더 보기」).
 * [종목 고르기] 창: 왼쪽 = 목록 안 검색 · 「종목 추가」 · 관심 목록 전부 선택 · 묶음(관심 목록(폴더 밖 종목 → 폴더별) → 분야 7개 → 직접 추가한 종목),
 * 오른쪽 = 고른 종목. **누르는 즉시 반영**하고 [완료]·ESC·바깥 클릭은 닫기만 한다.
 *
 * 최대 개수는 화면마다 그대로 —
 * - `max`(목표 수익 가능성 5 · 지정 종목 10): 넘게 고를 수 없다(체크 꺼짐) + 창 안 한 줄 `maxReason`.
 * - `softLimit`(백테스트, 방법 2개 이상 20): 막지 않고 넘으면 빨간 글자 — 실행 버튼이 꺼지는 것은 화면 쪽 규칙.
 * 저장 흐름도 화면마다 그대로다 — 이 부품은 `selected` 를 받고 `onChange(next)` 로 돌려줄 뿐이다.
 */
export interface SymbolPickerProps {
  selected: string[];
  onChange: (next: string[]) => void;
  /** 넘게 고를 수 없는 최대 개수 */
  max?: number | null;
  /** `max` 에 닿았을 때의 이유(지금 화면에 있던 문구 그대로) */
  maxReason?: string;
  /** 막지 않는 한도 — 넘으면 빨간 글자(`softLimitText`) */
  softLimit?: number | null;
  softLimitText?: (n: number, limit: number) => string;
  /** 「직접 추가한 종목」 을 화면이 따로 기억할 때(백테스트 초안). 없으면 이 창이 고른 종목에서 묶음 밖 종목을 모은다 */
  added?: string[];
  onAddedChange?: (next: string[]) => void;
  /** 도구 줄 왼쪽 제목(없으면 그리지 않는다) */
  title?: ReactNode;
  /** 도구 줄의 화면별 버튼([지금 살 만한가 추천 추가] 등) */
  extraButtons?: ReactNode;
  /** 0개일 때 칩 자리에 보일 문장 */
  emptyText?: ReactNode;
  /** 창 제목 */
  dialogTitle?: string;
}

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

const uniq = (list: string[]) => [...new Set(list.map((s) => s.toUpperCase()))];

function RowButton({
  row,
  on,
  disabled,
  showSector,
  onToggle,
  onRemove,
}: {
  row: Row;
  on: boolean;
  disabled: boolean;
  showSector: boolean;
  onToggle: (s: string) => void;
  onRemove?: (s: string) => void;
}) {
  return (
    <li className="flex items-center gap-1">
      <button
        type="button"
        onClick={() => onToggle(row.symbol)}
        aria-pressed={on}
        disabled={disabled}
        className={`flex min-h-9 min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors disabled:opacity-40 ${
          on ? 'bg-bg-elevated text-text-primary' : 'hover:bg-bg-tertiary'
        }`}
      >
        <span className={`flex h-4 w-4 shrink-0 items-center justify-center ${on ? 'text-text-primary' : 'text-transparent'}`}>
          <Check {...ICON_SM} aria-hidden />
        </span>
        <span className="min-w-0 flex-1 truncate">
          <StockName symbol={row.symbol} name={row.name} size="sm" />
        </span>
        {showSector && <span className="shrink-0 text-caption text-text-muted">{row.sector ?? '분야 미확인'}</span>}
      </button>
      {onRemove && <ListRemoveButton onClick={() => onRemove(row.symbol)} name={row.symbol} label="직접 추가한 종목에서 삭제" keeps="선택도 함께 해제" />}
    </li>
  );
}

function GroupHead({
  id,
  title,
  count,
  open,
  setOpen,
  all,
  onAll,
  onRemoveAll,
  indent = false,
}: {
  id: string;
  title: string;
  count: number;
  open: boolean;
  setOpen: (v: boolean) => void;
  all: boolean;
  onAll?: (add: boolean) => void;
  onRemoveAll?: () => void;
  indent?: boolean;
}) {
  return (
    <div className={`flex items-center gap-2 py-1 ${indent ? 'pl-4 pr-1' : 'px-1'}`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={`sp-group-${id}`}
        className="flex min-w-0 flex-1 items-center gap-1 text-left text-xs font-medium text-text-secondary hover:text-text-primary"
      >
        {open ? <ChevronDown {...ICON_SM} /> : <ChevronRight {...ICON_SM} />}
        <span className="truncate">{title}</span>
        <span className="shrink-0 text-text-muted">{count}</span>
      </button>
      {onRemoveAll && count > 0 && <RemoveAllButton onClick={onRemoveAll} />}
      {onAll && count > 0 && (
        <Button size="sm" variant="ghost" onClick={() => onAll(!all)}>
          {all ? '선택 해제' : '전부 선택'}
        </Button>
      )}
    </div>
  );
}

function PickerDialog({
  selected,
  onChange,
  max,
  maxReason,
  softLimit,
  softLimitText,
  added,
  onAddedChange,
  dialogTitle,
  onClose,
}: SymbolPickerProps & { added: string[]; onAddedChange: (next: string[]) => void; onClose: () => void }) {
  const uni = useBacktestUniverse();
  const { folders } = useWatchlist();
  const [query, setQuery] = useState('');
  const [leftTab, setLeftTab] = useState<'list' | 'search'>('list');
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({ watch: true, added: true });
  const sel = useMemo(() => new Set(selected), [selected]);
  const q = query.trim();
  const full = max != null && selected.length >= max;
  const soft = softLimit != null && selected.length > softLimit;

  const sectorOf = useMemo(() => {
    const m = new Map<string, string>();
    for (const g of uni.data?.sectors ?? []) for (const s of g.symbols) m.set(s.symbol, g.sector);
    for (const w of uni.data?.watchlist ?? []) if (w.sector && !m.has(w.symbol)) m.set(w.symbol, w.sector);
    return m;
  }, [uni.data]);

  const toRow = (s: string): Row => ({ symbol: s, name: null, sector: sectorOf.get(s) ?? null });
  const bare = (folders.find((f) => f.id === DEFAULT_FOLDER_ID)?.symbols ?? []).map(toRow).filter((r) => matches(r, q));
  const folderGroups = folders
    .filter((f) => f.id !== DEFAULT_FOLDER_ID)
    .map((f) => ({ id: `folder-${f.id}`, title: f.name, rows: f.symbols.map(toRow).filter((r) => matches(r, q)) }));
  const sectorGroups = (uni.data?.sectors ?? []).map((g) => ({
    id: `sector-${g.sector}`,
    title: g.sector,
    rows: g.symbols.map((s) => ({ ...s, sector: g.sector })).filter((r) => matches(r, q)),
  }));
  const addedRows = added.map(toRow).filter((r) => matches(r, q));
  const watchAll = folders.flatMap((f) => f.symbols);
  const watchCount = bare.length + folderGroups.reduce((n, g) => n + g.rows.length, 0);
  useStockNames(watchAll);

  /** 고르기 — 최대 개수가 있으면 남은 자리만큼만(순서대로) */
  const add = (list: string[]) => {
    const fresh = uniq(list).filter((s) => !sel.has(s));
    const room = max != null ? Math.max(0, max - selected.length) : fresh.length;
    if (!fresh.length || !room) return;
    onChange([...selected, ...fresh.slice(0, room)]);
  };
  const remove = (list: string[]) => {
    const drop = new Set(uniq(list));
    onChange(selected.filter((s) => !drop.has(s)));
  };
  const toggle = (s: string) => (sel.has(s) ? remove([s]) : add([s]));
  const all = (rows: Row[]) => rows.length > 0 && rows.every((r) => sel.has(r.symbol));
  const isOpen = (id: string, rows: Row[]) => (q ? rows.length > 0 : (openMap[id] ?? false));
  const setOpen = (id: string) => (v: boolean) => setOpenMap((m) => ({ ...m, [id]: v }));
  const rowDisabled = (s: string) => full && !sel.has(s);

  const loadingSectors = uni.loading && !uni.data;

  return (
    <Dialog
      title={dialogTitle ?? '종목 고르기'}
      titleAside="누르는 즉시 반영됩니다"
      onClose={onClose}
      size="xl"
      z={98}
      bodyClassName="flex"
      footer={<Button onClick={onClose}>완료</Button>}
    >
      {/* 왼쪽 — 맨 위 탭 둘 (v2.42.0): [목록에서 고르기] 목록 안 찾기 + 묶음 목록 / [새 종목 검색] 목록 밖 종목 추가 */}
      <div className="flex min-w-0 flex-1 flex-col gap-2 border-r border-border/40 p-3">
        <Tabs
          label="종목 고르는 방법"
          size="sm"
          value={leftTab}
          onChange={setLeftTab}
          items={[
            { id: 'list', label: '목록에서 고르기' },
            { id: 'search', label: '새 종목 검색' },
          ]}
        />
        {leftTab === 'search' && (
          <div className="space-y-2">
            <SymbolSearch
              symbol=""
              compact
              dropUp={false}
              clearOnSubmit
              placeholder="목록에 없는 종목 검색 (이름·티커)"
              submitLabel="종목 추가"
              isAdded={(s) => sel.has(s.toUpperCase())}
              onSubmit={(s) => {
                const sym = s.toUpperCase();
                if (!added.includes(sym)) onAddedChange([...added, sym]);
                add([sym]);
              }}
            />
            <p className="text-caption text-text-muted">추가한 종목은 「직접 추가한 종목」 에 들어가며 바로 선택됩니다.</p>
          </div>
        )}
        {leftTab === 'list' && (
          <>
        <label className="flex h-8 items-center gap-2 rounded-md bg-bg-tertiary px-2">
          <Search {...ICON_SM} className="shrink-0 text-text-muted" aria-hidden />
          {/* design-lint-ignore: 아이콘과 한 상자인 검색칸 — 바깥 상자가 입력칸 모양(높이·바탕)을 맡는다 */}
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="목록 안에서 찾기 (이름·티커·초성)"
            aria-label="목록 안에서 찾기"
            className="h-full min-w-0 flex-1 bg-transparent text-xs outline-none"
          />
        </label>
        <Button size="sm" onClick={() => add(watchAll)} disabled={!watchAll.length || full || watchAll.every((s) => sel.has(s))} className="self-start">
          관심 목록 전부 선택
        </Button>
          </>
        )}
        {full && maxReason && <p className="text-caption text-warning">최대 {max}개입니다 — {maxReason}</p>}
        <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1 [scrollbar-gutter:stable]">
          {leftTab === 'list' && (
          <>
          {/* 관심 목록 — 폴더 밖 종목은 머리 바로 아래(패널과 같은 규칙), 그다음 폴더별 */}
          <section>
            <GroupHead id="watch" title="관심 목록" count={watchCount} open={isOpen('watch', [...bare, ...folderGroups.flatMap((g) => g.rows)])} setOpen={setOpen('watch')} all={false} />
            {isOpen('watch', [...bare, ...folderGroups.flatMap((g) => g.rows)]) && (
              <div id="sp-group-watch">
                <ul data-list className="space-y-1">
                  {bare.map((r) => (
                    <RowButton key={r.symbol} row={r} on={sel.has(r.symbol)} disabled={rowDisabled(r.symbol)} showSector onToggle={toggle} />
                  ))}
                </ul>
                {folderGroups.map((g) => (
                  <section key={g.id}>
                    <GroupHead
                      id={g.id}
                      title={g.title}
                      count={g.rows.length}
                      open={isOpen(g.id, g.rows) || (!q && openMap[g.id] === undefined)}
                      setOpen={setOpen(g.id)}
                      all={all(g.rows)}
                      onAll={(on) => (on ? add(g.rows.map((r) => r.symbol)) : remove(g.rows.map((r) => r.symbol)))}
                      indent
                    />
                    {(isOpen(g.id, g.rows) || (!q && openMap[g.id] === undefined)) && (
                      <ul id={`sp-group-${g.id}`} data-list className="space-y-1 pl-3">
                        {g.rows.map((r) => (
                          <RowButton key={r.symbol} row={r} on={sel.has(r.symbol)} disabled={rowDisabled(r.symbol)} showSector onToggle={toggle} />
                        ))}
                        {g.rows.length === 0 && <li className="px-2 py-1.5 text-caption text-text-muted">{q ? '맞는 종목이 없습니다.' : '빈 폴더입니다.'}</li>}
                      </ul>
                    )}
                  </section>
                ))}
                {watchCount === 0 && <p className="px-2 py-1.5 text-caption text-text-muted">{q ? '맞는 종목이 없습니다.' : '관심 목록이 비어 있습니다.'}</p>}
              </div>
            )}
          </section>

          {/* 분야 7개 — 미국 시가총액 상위 100 */}
          {loadingSectors ? (
            <div className="px-1 py-2">
              <p className="pb-1 text-caption text-text-muted">분야 목록을 불러오는 중…</p>
              <SkeletonList count={4} />
            </div>
          ) : uni.error && !uni.data ? (
            <div className="space-y-2 p-2 text-caption text-danger">
              <p>분야 목록을 불러오지 못했습니다: {uni.error}</p>
              <Button size="sm" onClick={uni.reload}>
                다시 시도
              </Button>
            </div>
          ) : (
            sectorGroups.map((g) => (
              <section key={g.id}>
                <GroupHead
                  id={g.id}
                  title={g.title}
                  count={g.rows.length}
                  open={isOpen(g.id, g.rows)}
                  setOpen={setOpen(g.id)}
                  all={all(g.rows)}
                  onAll={(on) => (on ? add(g.rows.map((r) => r.symbol)) : remove(g.rows.map((r) => r.symbol)))}
                />
                {isOpen(g.id, g.rows) && (
                  <ul id={`sp-group-${g.id}`} data-list className="space-y-1">
                    {g.rows.map((r) => (
                      <RowButton key={r.symbol} row={r} on={sel.has(r.symbol)} disabled={rowDisabled(r.symbol)} showSector={false} onToggle={toggle} />
                    ))}
                  </ul>
                )}
              </section>
            ))
          )}

          </>
          )}
          {/* 직접 추가한 종목 — 두 탭 모두에 보인다(새 종목 검색으로 추가한 것이 바로 여기 들어간다) */}
          <section>
            <GroupHead
              id="added"
              title="직접 추가한 종목"
              count={addedRows.length}
              open={isOpen('added', addedRows) || (!q && openMap.added !== false)}
              setOpen={setOpen('added')}
              all={all(addedRows)}
              onRemoveAll={() => {
                remove(added);
                onAddedChange([]);
              }}
            />
            {(isOpen('added', addedRows) || (!q && openMap.added !== false)) && (
              <ul id="sp-group-added" data-list className="space-y-1">
                {addedRows.map((r) => (
                  <RowButton
                    key={r.symbol}
                    row={r}
                    on={sel.has(r.symbol)}
                    disabled={rowDisabled(r.symbol)}
                    showSector
                    onToggle={toggle}
                    onRemove={(s) => {
                      remove([s]);
                      onAddedChange(added.filter((x) => x !== s));
                    }}
                  />
                ))}
                {addedRows.length === 0 && (
                  <li className="px-2 py-1.5 text-caption text-text-muted">{q ? '맞는 종목이 없습니다.' : '위 「종목 추가」 로 넣은 종목이 여기에 보입니다.'}</li>
                )}
              </ul>
            )}
          </section>
          {uni.data && <p className="px-1 pt-2 text-caption text-text-muted">분야 묶음 = 미국 시가총액 상위 100 기준 {uni.data.asOf.slice(0, 10)}</p>}
        </div>
      </div>

      {/* 오른쪽 — 고른 종목 */}
      <div className="flex w-[300px] shrink-0 flex-col gap-2 p-3">
        <div className="flex items-center gap-2">
          <p className="text-xs font-semibold text-text-primary">
            고른 종목 {selected.length}
            {max != null ? `/${max}` : ''}개
          </p>
          {selected.length > 0 && <RemoveAllButton onClick={() => onChange([])} className="ml-auto" />}
        </div>
        {softLimit != null && (
          <p className={`text-caption ${soft ? 'text-danger' : 'text-text-muted'}`}>
            {softLimitText ? softLimitText(selected.length, softLimit) : `${softLimit}개까지 — 지금 ${selected.length}개`}
          </p>
        )}
        <ul data-list className="-mx-1 min-h-0 flex-1 space-y-1 overflow-y-auto px-1 [scrollbar-gutter:stable]">
          {selected.map((s) => (
            <li key={s} className="flex min-h-9 items-center gap-2 rounded-md px-2 py-1 hover:bg-bg-tertiary/60">
              <span className="min-w-0 flex-1 truncate">
                <StockName symbol={s} size="sm" />
              </span>
              <span className="shrink-0 text-caption text-text-muted">{sectorOf.get(s) ?? ''}</span>
              <ListRemoveButton onClick={() => remove([s])} name={s} label="고른 종목에서 삭제" />
            </li>
          ))}
          {selected.length === 0 && <li className="px-2 py-1.5 text-caption text-text-muted">왼쪽에서 종목을 누르면 여기에 보입니다.</li>}
        </ul>
      </div>
    </Dialog>
  );
}

export default function SymbolPicker(props: SymbolPickerProps) {
  const { selected, onChange, max, softLimit, softLimitText, title, extraButtons, emptyText } = props;
  const [open, setOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [hidden, setHidden] = useState(0);
  /** 화면이 따로 기억하지 않을 때 — 이 화면에서 「종목 추가」 로 넣은 종목 */
  const [ownAdded, setOwnAdded] = useState<string[]>([]);
  const boxRef = useRef<HTMLDivElement>(null);
  const { watchlist } = useWatchlist();
  const uni = useBacktestUniverse();
  useStockNames(selected);

  // 「직접 추가한 종목」 — 화면이 넘긴 목록, 아니면 「종목 추가」 로 넣은 것 + 관심 목록·분야 어디에도 없는 고른 종목
  const inGroups = useMemo(() => {
    const s = new Set(watchlist);
    for (const g of uni.data?.sectors ?? []) for (const x of g.symbols) s.add(x.symbol);
    return s;
  }, [watchlist, uni.data]);
  const added = props.added ?? uniq([...ownAdded, ...selected.filter((s) => !inGroups.has(s))]);
  const onAddedChange = props.onAddedChange ?? setOwnAdded;

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

  const soft = softLimit != null && selected.length > softLimit;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {title != null && <h3 className="shrink-0 text-sm font-semibold text-text-primary">{title}</h3>}
        <Button size="sm" onClick={() => setOpen(true)} className="shrink-0 whitespace-nowrap">
          종목 고르기
        </Button>
        {extraButtons}
        <span className="ml-auto flex shrink-0 items-center gap-2">
          <span className="text-caption text-text-muted tabular-nums">
            ({selected.length}
            {max != null ? `/${max}` : ''})
          </span>
          {selected.length > 0 && <RemoveAllButton onClick={() => onChange([])} />}
        </span>
      </div>
      {selected.length === 0 ? (
        <p className="text-caption text-text-muted">{emptyText ?? '[종목 고르기] 에서 관심 목록·분야별 종목을 고르거나 다른 종목을 추가하세요.'}</p>
      ) : (
        <>
          <div ref={boxRef} className={`flex flex-wrap gap-1.5 overflow-hidden ${expanded ? '' : 'max-h-[3.75rem]'}`}>
            {selected.map((s) => (
              <span key={s} className="inline-flex items-center gap-0.5 rounded-md bg-bg-tertiary py-0.5 pl-2 pr-0.5 text-caption">
                <StockName symbol={s} size="sm" />
                <ListRemoveButton onClick={() => onChange(selected.filter((x) => x !== s))} name={s} label="목록에서 삭제" />
              </span>
            ))}
          </div>
          {(hidden > 0 || expanded) && (
            <Button variant="ghost" size="sm" onClick={() => setExpanded((v) => !v)}>
              {expanded ? '접기' : `+${hidden}개 더 보기`}
            </Button>
          )}
        </>
      )}
      {soft && softLimit != null && (
        <p className="text-caption text-danger">
          {softLimitText ? softLimitText(selected.length, softLimit) : `${softLimit}개까지 — 지금 ${selected.length}개`}
        </p>
      )}
      {open && <PickerDialog {...props} added={added} onAddedChange={onAddedChange} onClose={() => setOpen(false)} />}
    </div>
  );
}
