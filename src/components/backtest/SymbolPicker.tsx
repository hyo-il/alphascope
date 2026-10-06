import { useMemo, useState } from 'react';
import { Check, ChevronDown, ChevronRight, Search } from 'lucide-react';
import StockName from '../common/StockName';
import SymbolSearch from '../common/SymbolSearch';
import { SkeletonList } from '../common/SkeletonLoader';
import { Button, Panel, SectionTitle } from '../ui';
import { ICON_SM } from '../ui/icon';
import { isChoseongOnly, toChoseong, toJamo } from '../../utils/hangul';
import { stockNameOf } from '../../utils/stockNames';
import type { BacktestUniverse } from '../../types/backtest';

/**
 * ① 종목 고르기 (v2.38.0) — 묶음: 「내 관심 목록」 → 7분야(시총 상위 100) → 「직접 추가한 종목」.
 * - 행을 누르면 담기/빼기(체크 + 밝은 바탕 — 파란 테두리 없음). 같은 종목이 두 묶음에 있으면 둘 다 체크로 보인다(같은 값을 본다).
 * - 위 검색칸은 **보이는 목록 안에서** 이름·티커·한글 초성으로 거른다(`utils/hangul.ts` — 서버 종목 검색과 같은 함수).
 *   [다른 종목 검색해서 추가] 는 기존 `SymbolSearch` — 목록 밖 종목을 「직접 추가한 종목」 에 넣고 바로 고른다.
 * - 종목 수 제한 없음.
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

function Group({
  title,
  rows,
  selected,
  onToggle,
  onAll,
  open,
  setOpen,
  showSector,
  emptyText,
}: {
  title: string;
  rows: Row[];
  selected: Set<string>;
  onToggle: (s: string) => void;
  onAll: (rows: Row[], add: boolean) => void;
  open: boolean;
  setOpen: (v: boolean) => void;
  showSector: boolean;
  emptyText: string;
}) {
  const all = rows.length > 0 && rows.every((r) => selected.has(r.symbol));
  return (
    <section>
      <div className="flex items-center gap-2 px-1 py-1">
        <button
          type="button"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-1 text-left text-xs font-medium text-text-secondary hover:text-text-primary"
        >
          {open ? <ChevronDown {...ICON_SM} /> : <ChevronRight {...ICON_SM} />}
          <span className="truncate">{title}</span>
          <span className="shrink-0 text-text-muted">{rows.length}</span>
        </button>
        {rows.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => onAll(rows, !all)}>
            {all ? '전부 빼기' : '전부 담기'}
          </Button>
        )}
      </div>
      {open && (
        <ul>
          {rows.map((r) => {
            const on = selected.has(r.symbol);
            return (
              <li key={r.symbol}>
                <button
                  type="button"
                  onClick={() => onToggle(r.symbol)}
                  aria-pressed={on}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors ${
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
              </li>
            );
          })}
          {rows.length === 0 && <li className="px-2 py-1.5 text-[13px] text-text-muted">{emptyText}</li>}
        </ul>
      )}
    </section>
  );
}

export default function SymbolPicker({
  universe,
  loading,
  error,
  onRetry,
  selected,
  added,
  onToggle,
  onAddMany,
  onRemoveMany,
  onAddOutside,
}: {
  universe: BacktestUniverse | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  selected: string[];
  added: string[];
  onToggle: (s: string) => void;
  onAddMany: (list: string[]) => void;
  onRemoveMany: (list: string[]) => void;
  onAddOutside: (s: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [openMap, setOpenMap] = useState<Record<string, boolean>>({ watch: true, added: true });
  const sel = useMemo(() => new Set(selected), [selected]);
  const q = query.trim();

  const groups = useMemo(() => {
    if (!universe) return [];
    const sectorOf = new Map<string, string>();
    for (const g of universe.sectors) for (const s of g.symbols) sectorOf.set(s.symbol, g.sector);
    const out: { id: string; title: string; rows: Row[]; showSector: boolean }[] = [
      { id: 'watch', title: '내 관심 목록', rows: universe.watchlist.map((w) => ({ ...w })), showSector: true },
      ...universe.sectors.map((g) => ({
        id: `sector:${g.sector}`,
        title: g.sector,
        rows: g.symbols.map((s) => ({ ...s, sector: g.sector })),
        showSector: false,
      })),
      { id: 'added', title: '직접 추가한 종목', rows: added.map((s) => ({ symbol: s, name: null, sector: sectorOf.get(s) ?? null })), showSector: true },
    ];
    return out.map((g) => ({ ...g, rows: g.rows.filter((r) => matches(r, q)) }));
  }, [universe, added, q]);

  const watchAll = universe?.watchlist.map((w) => w.symbol) ?? [];

  return (
    <Panel pad="sm" className="flex min-h-0 flex-col gap-2">
      <SectionTitle
        aside={`고른 종목 ${selected.length}개`}
        right={
          selected.length > 0 ? (
            <Button size="sm" variant="ghost" onClick={() => onRemoveMany(selected)}>
              모두 빼기
            </Button>
          ) : undefined
        }
      >
        ① 종목 고르기
      </SectionTitle>

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
        placeholder="다른 종목 검색해서 추가"
        submitLabel="추가"
        isAdded={(s) => sel.has(s.toUpperCase())}
        onSubmit={(s) => onAddOutside(s.toUpperCase())}
      />
      <Button size="sm" onClick={() => onAddMany(watchAll)} disabled={!watchAll.length || watchAll.every((s) => sel.has(s))} className="self-start">
        관심 목록 전부 담기
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
              title={g.title}
              rows={g.rows}
              selected={sel}
              onToggle={onToggle}
              onAll={(rows, add) => (add ? onAddMany(rows.map((r) => r.symbol)) : onRemoveMany(rows.map((r) => r.symbol)))}
              // 찾는 중이면 맞는 종목이 있는 묶음을 펼친다
              open={q ? g.rows.length > 0 : (openMap[g.id] ?? false)}
              setOpen={(v) => setOpenMap((m) => ({ ...m, [g.id]: v }))}
              showSector={g.showSector}
              emptyText={q ? '맞는 종목이 없습니다.' : g.id === 'added' ? '위 [다른 종목 검색해서 추가] 로 넣은 종목이 여기에 보입니다.' : '종목이 없습니다.'}
            />
          ))
        )}
        {universe && <p className="px-1 pt-2 text-[13px] text-text-muted">분야 묶음 = 미국 시가총액 상위 100 기준 {universe.asOf.slice(0, 10)}</p>}
      </div>
    </Panel>
  );
}
