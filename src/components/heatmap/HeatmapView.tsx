import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { squarify, type Rect } from '../../utils/treemap';
import { formatCompactMoney, formatPrice } from '../../utils/formatters';
import {
  HEATMAP_PERIODS,
  type HeatmapCell,
  type HeatmapMarket,
  type HeatmapPeriod,
  type HeatmapResponse,
  type HeatmapView as HeatmapViewId,
} from '../../types/heatmap';
import SectorRanking from './SectorRanking';
import HeatmapViewMenu, { TOP_CHOICES, type TopChoice } from './HeatmapViewMenu';

/**
 * 🗺 종목 지도 (v2.18.0) — 시장 온도를 한눈에. 네모 크기 = 시가총액, 색 = 기간 수익률, 섹터로 묶는다.
 *
 * - 데이터는 `GET /api/heatmap?market=&period=` 한 곳. 1일은 서버 60초 캐시 + 화면이 보일 때만 60초마다 다시 받는다(숨은 탭 정지).
 *   1주 이상(v2.19.0)은 종가 기준이라 주기 새로고침을 하지 않는다(탭이 다시 보일 때만).
 * - 배치는 직접 구현한 squarified treemap(`utils/treemap.ts`) — 섹터를 먼저 나누고, 섹터 안에서 종목을 나눈다.
 * - 색은 `index.css` 의 heat-* 불투명 단계색(v2.27.0 — bullish/bearish 를 회색에 섞은 4단계 + 회색) + 진하기 구간 —
 *   기간이 길수록 구간을 넓힌다(`BINS`). 0% 근처는 회색.
 * - 탭(v2.27.0): 「시장 상위」(상위 30·50·100 — 서버가 100 캐시에서 자른다) / 「내 관심 종목」(그 시장의 관심 종목, 크기 = 시총).
 *   [보기 ▾] 의 분야 거르기는 화면에서만 한다. 마지막 보기는 localStorage `alphascope.heatmapView`.
 * - 오른쪽 「섹터 강세 순위」(v2.19.0)는 **설명용**이다 — 지난 기간의 결과이고 판정·자동매매에 쓰지 않는다.
 * - ⚠️ 다른 사이트의 데이터·디자인을 가져오지 않았다 — 앱 다크 테마로 새로 그렸다.
 */

const REFRESH_MS = 60_000;
const SECTOR_HEADER = 16;

// ── 마지막 보기 기억 (v2.27.0) ──────────────────────────────────────────────
// 이 기기·화면 크기에 딸린 설정이라 localStorage 다(서버 user_data 가 아니다).
// 분야는 **끈 것**을 적는다 — 켠 것을 적으면 나중에 새 분야(섹터를 새로 채운 종목 등)가 생겼을 때 조용히 빠진다.

const VIEW_KEY = 'alphascope.heatmapView';

interface SavedView {
  view: HeatmapViewId;
  market: HeatmapMarket;
  period: HeatmapPeriod;
  top: TopChoice;
  /** 끈 분야 — 탭마다 따로(관심 종목 지도에서 끈 분야가 시장 지도에서도 꺼지면 헷갈린다) */
  off: Record<HeatmapViewId, string[]>;
  /** 관심 종목 탭의 칸 크기 (v2.29.0) — cap = 시가총액 그대로(기본), sqrt = 시가총액의 제곱근(크기 차이 줄이기) */
  watchSize: WatchSize;
}

export type WatchSize = 'cap' | 'sqrt';

const DEFAULT_VIEW: SavedView = { view: 'market', market: 'us', period: '1d', top: 50, off: { market: [], watch: [] }, watchSize: 'cap' };

const strings = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);

function readView(): SavedView {
  try {
    const raw = JSON.parse(localStorage.getItem(VIEW_KEY) ?? 'null') as Partial<SavedView> | null;
    if (!raw || typeof raw !== 'object') return DEFAULT_VIEW;
    const off = (raw.off ?? {}) as Partial<Record<HeatmapViewId, unknown>>;
    return {
      view: raw.view === 'watch' ? 'watch' : 'market',
      market: raw.market === 'kr' ? 'kr' : 'us',
      period: HEATMAP_PERIODS.some((p) => p.id === raw.period) ? (raw.period as HeatmapPeriod) : '1d',
      top: TOP_CHOICES.find((n) => n === raw.top) ?? 50,
      off: { market: strings(off.market), watch: strings(off.watch) },
      watchSize: raw.watchSize === 'sqrt' ? 'sqrt' : 'cap',
    };
  } catch {
    return DEFAULT_VIEW;
  }
}

function writeView(v: SavedView) {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify(v));
  } catch {
    /* 저장이 막힌 브라우저 — 이번 화면에서만 유지 */
  }
}

// ── 칸 글자 맞추기 (v2.27.0) ────────────────────────────────────────────────
// 최소 12px(앱 글자 규칙) · 최대 20px. 12px 로도 칸에 안 들어가면 글자를 **그리지 않는다** — 「AA…」 처럼 잘린 글자는
// 다른 종목으로 읽힌다. 마우스를 올리면 툴팁이 이름을 보여 준다. 폭은 실제 글꼴로 잰다(canvas measureText).

const LABEL_MIN = 12;
const LABEL_MAX = 20;
const RATE_SIZE = 12;
/** 칸 테두리(1px×2) + 좌우 여백(2px×2) */
const TILE_PAD_X = 6;
const LINE = 1.2;

let measureCtx: CanvasRenderingContext2D | null = null;
let measureFamily = '';
const widthCache = new Map<string, number>();
function textWidth(text: string, size: number, weight = 600): number {
  const key = `${weight}|${size}|${text}`;
  const hit = widthCache.get(key);
  if (hit !== undefined) return hit;
  const width = measure(text, size, weight);
  if (widthCache.size > 20000) widthCache.clear();
  widthCache.set(key, width);
  return width;
}
function measure(text: string, size: number, weight: number): number {
  if (!measureCtx) {
    measureCtx = document.createElement('canvas').getContext('2d');
    measureFamily = getComputedStyle(document.body).fontFamily || 'sans-serif';
  }
  if (!measureCtx) return text.length * size * 0.65;
  measureCtx.font = `${weight} ${size}px ${measureFamily}`;
  return measureCtx.measureText(text).width;
}

interface LabelFit {
  size: number;
  /** 한 줄 또는 두 줄(국내 종목명) */
  lines: string[];
  rate: boolean;
}

/** 두 줄로 나눌 자리 — 띄어쓰기가 있으면 그 자리만, 없으면 글자 사이(한글 종목명은 대개 붙여 쓴다) */
function splitCandidates(label: string): [string, string][] {
  const out: [string, string][] = [];
  const spaces = [...label.matchAll(/ /g)].map((m) => m.index!);
  if (spaces.length) for (const i of spaces) out.push([label.slice(0, i), label.slice(i + 1)]);
  else for (let i = 1; i < label.length; i++) out.push([label.slice(0, i), label.slice(i)]);
  return out;
}

/**
 * 칸에 맞는 이름 글자 크기·줄과 등락률 줄을 그릴지 — 이름이 안 들어가면 null.
 * 국내(`twoLines`)는 한 줄에 안 들어가면 **두 줄**까지 나눠 본다(v2.29.0 — 1280 폭 국내 상위 50 에서 이름 보이는 칸이 21/50 이었다).
 * 12px 최소·말줄임 없음·칸 밖으로 나가지 않음은 그대로 — 두 줄로도 안 들어가면 그리지 않는다(툴팁).
 */
function fitLabel(label: string, rate: string, w: number, h: number, twoLines = false): LabelFit | null {
  const room = w - TILE_PAD_X;
  const rateW = textWidth(rate, RATE_SIZE, 400);
  for (let size = Math.max(LABEL_MIN, Math.min(LABEL_MAX, Math.floor(Math.sqrt(w * h) / 6))); size >= LABEL_MIN; size--) {
    if (textWidth(label, size) <= room && size * LINE <= h - 2) {
      return { size, lines: [label], rate: size * LINE + RATE_SIZE * LINE <= h - 4 && rateW <= room };
    }
    if (twoLines && size * LINE * 2 <= h - 2) {
      // 두 줄 중 긴 줄이 가장 짧아지는 자리
      let best: [string, string] | null = null;
      let bestW = Infinity;
      for (const pair of splitCandidates(label)) {
        const width = Math.max(textWidth(pair[0], size), textWidth(pair[1], size));
        if (width < bestW) {
          bestW = width;
          best = pair;
        }
      }
      if (best && bestW <= room) {
        return { size, lines: best, rate: size * LINE * 2 + RATE_SIZE * LINE <= h - 4 && rateW <= room };
      }
    }
  }
  return null;
}

/** 기간별 색 구간(%) — 네 단계. 1일 ±0.5·1·2·3 / 1주 ±1·2·4·6 / 1·3개월 ±2·5·10·15 */
const BINS: Record<HeatmapPeriod, [number, number, number, number]> = {
  '1d': [0.5, 1, 2, 3],
  '1w': [1, 2, 4, 6],
  '1m': [2, 5, 10, 15],
  '3m': [2, 5, 10, 15],
};
/** 불투명 단계색 — `index.css` 의 heat-* 토큰(앱 bullish/bearish 에서 섞은 값, v2.27.0) */
const SHADES = {
  up: ['bg-heat-up-1', 'bg-heat-up-2', 'bg-heat-up-3', 'bg-heat-up-4'],
  down: ['bg-heat-down-1', 'bg-heat-down-2', 'bg-heat-down-3', 'bg-heat-down-4'],
};

/**
 * 칸 글자 그림자 — text-primary(#e0e0e0) 대 단계색 대비가 2·3·4단계에서 4.5:1 에 못 미친다
 * (상승 3.97·2.97·2.27 / 하락 4.34·3.35·2.64 — 회색·1단계는 8.14·5.52·5.80). 글자 둘레를 어둡게 둘러 바탕과 떼어 놓는다.
 */
const TILE_TEXT_SHADOW = '0 0 2px rgb(0 0 0 / 0.9), 0 1px 1px rgb(0 0 0 / 0.7)';

function colorOf(change: number | null, period: HeatmapPeriod): string {
  if (change == null) return 'bg-heat-flat';
  const [b0, b1, b2, b3] = BINS[period];
  const a = Math.abs(change);
  if (a < b0) return 'bg-heat-flat';
  const shades = change > 0 ? SHADES.up : SHADES.down;
  if (a < b1) return shades[0];
  if (a < b2) return shades[1];
  if (a < b3) return shades[2];
  return shades[3];
}

/** 칸 글자 — 미국은 티커, 국내는 이름(6자리 코드로는 알아볼 수 없다. 이름을 못 받았으면 코드) */
const tileLabel = (c: HeatmapCell) => (c.currency === 'KRW' && c.name ? c.name : c.symbol);

const pct = (v: number | null) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`);

interface Tile {
  rect: Rect;
  cell: HeatmapCell;
  fit: LabelFit | null;
}
interface SectorBox {
  rect: Rect;
  name: string;
}

export default function HeatmapView({ onSelectSymbol }: { onSelectSymbol: (symbol: string) => void }) {
  const [saved] = useState(readView);
  const [view, setView] = useState<HeatmapViewId>(saved.view);
  const [market, setMarket] = useState<HeatmapMarket>(saved.market);
  const [period, setPeriod] = useState<HeatmapPeriod>(saved.period);
  const [top, setTop] = useState<TopChoice>(saved.top);
  const [watchSize, setWatchSize] = useState<WatchSize>(saved.watchSize);
  const [offByView, setOffByView] = useState<Record<HeatmapViewId, Set<string>>>(() => ({
    market: new Set(saved.off.market),
    watch: new Set(saved.off.watch),
  }));
  const off = offByView[view];
  const setOff = useCallback((next: Set<string>) => setOffByView((prev) => ({ ...prev, [view]: next })), [view]);
  const [data, setData] = useState<HeatmapResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<{ cell: HeatmapCell; x: number; y: number } | null>(null);
  const [focusSector, setFocusSector] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const sequence = useRef(0);

  const load = useCallback(async () => {
    const mine = ++sequence.current;
    setLoading(true);
    try {
      const q = view === 'watch' ? 'view=watch' : `view=market&top=${top}`;
      const r = await fetch(`/api/heatmap?market=${market}&period=${period}&${q}`);
      const payload = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(payload.error ?? `요청 실패 (${r.status})`);
      if (mine === sequence.current) {
        setData(payload as HeatmapResponse);
        setError(null);
      }
    } catch (e) {
      if (mine === sequence.current) setError((e as Error).message);
    } finally {
      if (mine === sequence.current) setLoading(false);
    }
  }, [market, period, top, view]);

  useEffect(() => {
    writeView({ view, market, period, top, off: { market: [...offByView.market], watch: [...offByView.watch] }, watchSize });
  }, [view, market, period, top, offByView, watchSize]);

  // 처음 + (1일만) 60초마다 — 탭이 숨어 있으면 쉬고, 다시 보이면 곧바로 한 번
  // 상위 N 만 바꿀 때는 보던 지도를 남긴 채 다시 받는다(서버가 같은 100 캐시에서 자른다 — 금방 온다)
  useEffect(() => {
    setData(null);
    setFocusSector(null);
  }, [market, period, view]);

  useEffect(() => {
    void load();
    const timer =
      period === '1d'
        ? setInterval(() => {
            if (document.visibilityState === 'visible') void load();
          }, REFRESH_MS)
        : null;
    const onVisible = () => document.visibilityState === 'visible' && void load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      if (timer) clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load, period]);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // 지금 데이터의 분야(종목 수 많은 순)와, 실제로 끈 분야 — 끈 분야가 지금 데이터의 분야 전부를 덮으면 거르지 않는다(빈 지도 방지)
  const sectorCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of data?.cells ?? []) m.set(c.sector, (m.get(c.sector) ?? 0) + 1);
    return [...m.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [data]);
  const activeOff = useMemo(
    () => (sectorCounts.length && sectorCounts.every((s) => off.has(s.name)) ? new Set<string>() : off),
    [sectorCounts, off],
  );

  useEffect(() => {
    if (focusSector && activeOff.has(focusSector)) setFocusSector(null);
  }, [focusSector, activeOff]);

  const { tiles, sectors } = useMemo(() => {
    const tiles: Tile[] = [];
    const sectors: SectorBox[] = [];
    if (!data || size.w <= 0 || size.h <= 0) return { tiles, sectors };
    const groups = new Map<string, HeatmapCell[]>();
    for (const c of data.cells) {
      if (activeOff.has(c.sector)) continue;
      (groups.get(c.sector) ?? groups.set(c.sector, []).get(c.sector)!).push(c);
    }
    // 칸 크기 — 관심 종목 탭의 「크기 차이 줄이기」 면 시가총액의 제곱근(보기일 뿐 — 섹터 강세 순위는 서버가 실제 시총으로 낸다)
    const sizeOf = (c: HeatmapCell) => (view === 'watch' && watchSize === 'sqrt' ? Math.sqrt(c.marketCap) : c.marketCap);
    const sectorLayout = squarify(
      [...groups.entries()].map(([name, cells]) => ({ value: cells.reduce((a, c) => a + sizeOf(c), 0), data: { name, cells } })),
      { x: 0, y: 0, w: size.w, h: size.h },
    );
    for (const s of sectorLayout) {
      sectors.push({ rect: s.rect, name: s.data.name });
      const inner = {
        x: s.rect.x + 1,
        y: s.rect.y + SECTOR_HEADER,
        w: Math.max(0, s.rect.w - 2),
        h: Math.max(0, s.rect.h - SECTOR_HEADER - 1),
      };
      for (const t of squarify(s.data.cells.map((c) => ({ value: sizeOf(c), data: c })), inner)) {
        const twoLines = t.data.currency === 'KRW' && Boolean(t.data.name); // 국내 종목명만 두 줄 — 미국 티커는 한 줄
        tiles.push({ rect: t.rect, cell: t.data, fit: fitLabel(tileLabel(t.data), pct(t.data.changeRate), t.rect.w, t.rect.h, twoLines) });
      }
    }
    return { tiles, sectors };
  }, [data, size, activeOff, view, watchSize]);
  const labeled = tiles.filter((t) => t.fit).length;

  const periodInfo = HEATMAP_PERIODS.find((p) => p.id === period)!;
  const marketLabel = market === 'us' ? '미국' : '국내';
  const watchView = view === 'watch';
  const empty = watchView && data !== null && data.cells.length === 0 && data.missingCap.length === 0;
  const best = data?.sectors[0];
  const worst = data && data.sectors.length > 1 ? data.sectors[data.sectors.length - 1] : undefined;
  const bins = BINS[period];
  const legend = [...[...bins].reverse().map((b) => -b), 0, ...bins];

  return (
    <div className="flex h-full flex-col p-3">
      <header className="mb-2 flex shrink-0 flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-text-primary">🗺 종목 지도</h2>
        {/* 탭 (v2.27.0) — 시장·기간은 두 탭이 함께 쓴다 */}
        <div className="flex rounded border border-border p-0.5" role="tablist" aria-label="지도 대상">
          {(
            [
              ['market', '시장 상위'],
              ['watch', '내 관심 종목'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={view === id}
              onClick={() => setView(id)}
              className={`rounded px-2.5 py-0.5 text-[12px] transition-colors ${
                view === id ? 'bg-accent/15 font-medium text-accent' : 'text-text-secondary hover:text-text-primary'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex gap-1">
          {(['us', 'kr'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMarket(m)}
              className={`rounded border px-2.5 py-0.5 text-[12px] transition-colors ${
                market === m ? 'border-accent bg-accent/10 font-medium text-accent' : 'border-border text-text-secondary'
              }`}
            >
              {m === 'us' ? '미국' : '국내'}
            </button>
          ))}
        </div>
        <div className="flex gap-1" role="group" aria-label="기간">
          {HEATMAP_PERIODS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPeriod(p.id)}
              aria-pressed={period === p.id}
              className={`rounded border px-2 py-0.5 text-[12px] transition-colors ${
                period === p.id ? 'border-accent bg-accent/10 font-medium text-accent' : 'border-border text-text-secondary'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <HeatmapViewMenu
          top={watchView ? null : top}
          onTopChange={setTop}
          sectors={sectorCounts}
          off={activeOff}
          onOffChange={setOff}
          watchSize={watchView ? watchSize : null}
          onWatchSizeChange={setWatchSize}
        />
      </header>

      {/* 한 줄 요약 — 지난 기간의 결과 */}
      {data && best && (
        <p className="mb-1 shrink-0 text-[13px] text-text-primary">
          {marketLabel} {watchView ? '관심 종목' : '대형주'} {periodInfo.label}: 강세 1위 <b>{best.sector}</b>{' '}
          <span className={best.capReturn >= 0 ? 'text-bullish' : 'text-bearish'}>{pct(best.capReturn)}</span>
          {worst && (
            <>
              , 약세 1위 <b>{worst.sector}</b>{' '}
              <span className={worst.capReturn >= 0 ? 'text-bullish' : 'text-bearish'}>{pct(worst.capReturn)}</span>
            </>
          )}{' '}
          <span className="text-text-muted">(시장 평균 {pct(data.marketReturn)})</span>
        </p>
      )}

      {error && <p className="mb-2 rounded border border-bearish/40 bg-bearish/10 px-3 py-1.5 text-[12px] text-bearish">{error}</p>}
      {data && data.missingSectors > 0 && (
        <p className="mb-1 text-[12px] text-text-muted">
          섹터 정보가 없는 {data.missingSectors}종목은 「기타」 로 묶었습니다 (새로 들어온 종목은 하루 한 번 뒤에서 채웁니다).
        </p>
      )}

      <div className="flex min-h-0 flex-1 gap-2">
        <div
          ref={box}
          data-tiles={tiles.length}
          data-labeled={labeled}
          className="relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-lg border border-border bg-bg-secondary"
        >
          {empty && (
            <p className="p-4 text-[13px] text-text-secondary">
              관심 목록에 {marketLabel} 종목이 없습니다. 오른쪽 관심 목록에서 ★ 로 담아 보세요.
            </p>
          )}
          {!data && !error && (
            <p className="p-4 text-xs text-text-muted">
              지도를 그리는 중… {period === '1d' ? '(처음은 전 거래일 종가를 모으느라 조금 걸립니다)' : '(처음은 일봉을 모으느라 조금 걸립니다)'}
            </p>
          )}
          {sectors.map((s) => (
            <div
              key={s.name}
              className={`pointer-events-none absolute border ${
                focusSector === s.name ? 'z-[1] border-accent ring-2 ring-inset ring-accent' : 'border-bg-primary'
              }`}
              style={{ left: s.rect.x, top: s.rect.y, width: s.rect.w, height: s.rect.h }}
            >
              {s.rect.w > 40 && (
                <span
                  className={`block truncate px-1 text-[12px] font-medium leading-4 ${
                    focusSector === s.name ? 'text-accent' : 'text-text-secondary'
                  }`}
                >
                  {s.name}
                </span>
              )}
            </div>
          ))}
          {tiles.map(({ rect, cell, fit }) => {
            const dimmed = focusSector !== null && focusSector !== cell.sector;
            return (
              <button
                key={cell.symbol}
                type="button"
                onClick={() => onSelectSymbol(cell.symbol)}
                onMouseMove={(e) => {
                  const r = box.current!.getBoundingClientRect();
                  setHover({ cell, x: e.clientX - r.left, y: e.clientY - r.top });
                }}
                onMouseLeave={() => setHover(null)}
                className={`absolute flex flex-col items-center justify-center overflow-hidden border border-bg-primary/70 text-center transition-[filter,opacity] hover:brightness-125 ${colorOf(cell.changeRate, period)} ${
                  cell.watch && !watchView ? 'ring-1 ring-inset ring-accent/70' : ''
                } ${dimmed ? 'opacity-25' : ''}`}
                style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h, textShadow: TILE_TEXT_SHADOW }}
                aria-label={`${cell.name ?? cell.symbol} ${pct(cell.changeRate)}`}
              >
                {fit?.lines.map((line, i) => (
                  <span
                    key={i}
                    className="max-w-full whitespace-nowrap px-0.5 font-semibold leading-[1.2] text-text-primary"
                    style={{ fontSize: fit.size }}
                  >
                    {line}
                  </span>
                ))}
                {fit?.rate && <span className="text-[12px] leading-[1.2] tabular-nums text-text-primary">{pct(cell.changeRate)}</span>}
              </button>
            );
          })}
          {hover && (
            <div
              className="pointer-events-none absolute z-10 w-52 rounded border border-border bg-bg-primary/95 px-2 py-1.5 text-[12px] shadow-lg"
              style={{
                left: Math.min(hover.x + 12, Math.max(0, size.w - 212)),
                top: Math.min(hover.y + 12, Math.max(0, size.h - 90)),
              }}
            >
              <p className="truncate font-medium text-text-primary">
                {hover.cell.name ?? hover.cell.symbol} <span className="text-text-muted">{hover.cell.symbol}</span>
              </p>
              <p className="text-text-secondary">
                {hover.cell.price != null ? formatPrice(hover.cell.price, hover.cell.currency) : '—'}
                {period !== '1d' && <span className="text-text-muted"> (종가)</span>}{' '}
                <span className={(hover.cell.changeRate ?? 0) >= 0 ? 'text-bullish' : 'text-bearish'}>
                  {periodInfo.label} {hover.cell.changeRate == null ? '— (기간 데이터 없음)' : pct(hover.cell.changeRate)}
                </span>
              </p>
              <p className="text-text-muted">
                {hover.cell.sector} · 시총 {formatCompactMoney(hover.cell.marketCap, hover.cell.currency)}
                {hover.cell.watch && ' · 관심 종목'}
              </p>
              <p className="text-text-muted">누르면 차트로</p>
            </div>
          )}
        </div>

        {/* 섹터 강세 순위 — 설명용 */}
        <aside className="flex w-72 shrink-0 flex-col overflow-hidden rounded-lg border border-border bg-bg-secondary">
          <div className="shrink-0 border-b border-border px-2.5 py-1.5">
            <p className="text-[13px] font-semibold text-text-primary">
              섹터 강세 순위 · {periodInfo.label}
              {watchView && <span className="ml-1.5 font-normal text-accent">관심 종목 기준</span>}
            </p>
            <p className="text-[12px] text-text-muted">
              시총 가중(현재 시총) 수익률 높은 순 · 줄을 누르면 지도에서 강조{activeOff.size > 0 && ' · 흐린 줄은 지도에서 끈 분야'}
            </p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {data ? (
              <SectorRanking sectors={data.sectors} selected={focusSector} onSelect={setFocusSector} dimmed={activeOff} />
            ) : (
              <p className="p-3 text-[12px] text-text-muted">불러오는 중…</p>
            )}
          </div>
          {data && data.excluded > 0 && (
            <p className="shrink-0 border-t border-border px-2.5 py-1 text-[12px] text-text-muted">
              {periodInfo.label} 전 종가가 없어 제외한 종목 {data.excluded}개 (상장 직후·거래 정지 등)
            </p>
          )}
        </aside>
      </div>
      <div className="mt-1 flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1">
  {/* 색 범례 — 기간마다 구간이 다르다. v2.29.0 에 머리줄에서 지도 아래로(1280 폭에서 머리줄이 두 줄이 됐다) */}
      <span className="flex items-center gap-0.5 text-[12px] text-text-muted" aria-label={`색 구간 ±${bins.join('·')}%`}>
        {legend.map((v) => (
          <span
            key={v}
            style={{ textShadow: TILE_TEXT_SHADOW }}
            className={`flex h-4 w-8 items-center justify-center text-text-primary ${colorOf(v === 0 ? 0 : v > 0 ? v + 0.01 : v - 0.01, period)}`}
          >
            {v > 0 ? `+${v}` : v}
          </span>
        ))}
        <span className="ml-0.5">%</span>
      </span>
        {/* 대상·기준 시각 — v2.29.0 에 머리줄에서 이 줄로(1280 폭에서 머리줄이 두 줄이 됐다) */}
        {data && (
          <span className="ml-auto text-[12px] text-text-muted">
            {watchView ? `${marketLabel} 관심 종목` : `시총 상위 ${data.top ?? top}`} · {tiles.length < data.cells.length ? `${tiles.length}/${data.cells.length}` : data.cells.length}
            종목 ·{' '}
            {period === '1d'
              ? `${new Date(data.asOf).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 기준`
              : `최근 종가 기준 ${periodInfo.bars}거래일`}
            {loading && ' · 새로고침 중…'}
          </span>
        )}
        {watchView && watchSize === 'sqrt' && (
          <span className="text-[12px] text-warning">칸 크기는 시가총액의 제곱근에 비례합니다(크기 차이를 줄인 보기)</span>
        )}
      </div>
      {watchView && data && data.missingCap.length > 0 && (
        <p className="mt-1 shrink-0 text-[12px] text-text-muted">
          크기 정보가 없어 빠진 종목 {data.missingCap.length}개: {data.missingCap.map((m) => m.name ?? m.symbol).join(', ')} (하루 한 번
          뒤에서 채웁니다)
        </p>
      )}
      <p className="mt-1 shrink-0 text-[12px] text-text-muted">
        <b className="font-medium text-text-secondary">지난 기간의 결과입니다. 앞으로도 강할 것이라는 뜻이 아닙니다.</b> 색은{' '}
        {period === '1d' ? '전 거래일 종가 대비 등락' : `최근 종가 ÷ ${periodInfo.bars}거래일 전 종가`}입니다.{watchView ? (watchSize === 'sqrt' ? ' 크기 = 시가총액의 제곱근(크기 차이 줄인 보기).' : ' 크기 = 시가총액.') : ' 파란 테두리는 관심 종목.'}
        {period === '1d' && ' 1분마다 새로고침(화면을 보고 있을 때만).'}
      </p>
    </div>
  );
}
