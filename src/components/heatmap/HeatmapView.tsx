import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { squarify, type Rect } from '../../utils/treemap';
import { formatCompactMoney, formatPrice } from '../../utils/formatters';
import type { HeatmapCell, HeatmapMarket, HeatmapResponse } from '../../types/heatmap';

/**
 * 🗺 종목 지도 (v2.18.0) — 시장 온도를 한눈에. 네모 크기 = 시가총액, 색 = 전 거래일 종가 대비 등락, 섹터로 묶는다.
 *
 * - 데이터는 `GET /api/heatmap?market=` 한 곳(서버 60초 캐시). 화면이 보일 때만 60초마다 다시 받는다(숨은 탭 정지).
 * - 배치는 직접 구현한 squarified treemap(`utils/treemap.ts`) — 섹터를 먼저 나누고, 섹터 안에서 종목을 나눈다.
 * - 색은 `index.css` 토큰(bullish/bearish) + 진하기 구간(±0.5·1·2·3%). 0% 근처는 회색.
 * - ⚠️ 다른 사이트의 데이터·디자인을 가져오지 않았다 — 앱 다크 테마로 새로 그렸다.
 */

const REFRESH_MS = 60_000;
const SECTOR_HEADER = 16;

function colorOf(change: number | null): string {
  if (change == null) return 'bg-bg-tertiary';
  const a = Math.abs(change);
  if (a < 0.5) return 'bg-bg-tertiary';
  const up = change > 0;
  if (a < 1) return up ? 'bg-bullish/25' : 'bg-bearish/25';
  if (a < 2) return up ? 'bg-bullish/45' : 'bg-bearish/45';
  if (a < 3) return up ? 'bg-bullish/65' : 'bg-bearish/65';
  return up ? 'bg-bullish/85' : 'bg-bearish/85';
}

/** 칸 글자 — 미국은 티커, 국내는 이름(6자리 코드로는 알아볼 수 없다. 이름을 못 받았으면 코드) */
const tileLabel = (c: HeatmapCell) => (c.currency === 'KRW' && c.name ? c.name : c.symbol);

const pct = (v: number | null) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`);

interface Tile {
  rect: Rect;
  cell: HeatmapCell;
}
interface SectorBox {
  rect: Rect;
  name: string;
}

export default function HeatmapView({ onSelectSymbol }: { onSelectSymbol: (symbol: string) => void }) {
  const [market, setMarket] = useState<HeatmapMarket>('us');
  const [data, setData] = useState<HeatmapResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [hover, setHover] = useState<{ cell: HeatmapCell; x: number; y: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const sequence = useRef(0);

  const load = useCallback(async () => {
    const mine = ++sequence.current;
    setLoading(true);
    try {
      const r = await fetch(`/api/heatmap?market=${market}`);
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
  }, [market]);

  // 처음 + 60초마다 — 탭이 숨어 있으면 쉬고, 다시 보이면 곧바로 한 번
  useEffect(() => {
    setData(null);
    void load();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, REFRESH_MS);
    const onVisible = () => document.visibilityState === 'visible' && void load();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [load]);

  useLayoutEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setSize({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  const { tiles, sectors } = useMemo(() => {
    const tiles: Tile[] = [];
    const sectors: SectorBox[] = [];
    if (!data || size.w <= 0 || size.h <= 0) return { tiles, sectors };
    const groups = new Map<string, HeatmapCell[]>();
    for (const c of data.cells) (groups.get(c.sector) ?? groups.set(c.sector, []).get(c.sector)!).push(c);
    const sectorLayout = squarify(
      [...groups.entries()].map(([name, cells]) => ({ value: cells.reduce((a, c) => a + c.marketCap, 0), data: { name, cells } })),
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
      for (const t of squarify(s.data.cells.map((c) => ({ value: c.marketCap, data: c })), inner)) {
        tiles.push({ rect: t.rect, cell: t.data });
      }
    }
    return { tiles, sectors };
  }, [data, size]);

  const up = data?.cells.filter((c) => (c.changeRate ?? 0) > 0).length ?? 0;
  const down = data?.cells.filter((c) => (c.changeRate ?? 0) < 0).length ?? 0;

  return (
    <div className="flex h-full flex-col p-3">
      <header className="mb-2 flex shrink-0 flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold text-text-primary">🗺 종목 지도</h2>
        <div className="flex gap-1">
          {(['us', 'kr'] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => setMarket(m)}
              className={`rounded border px-2.5 py-0.5 text-[11px] transition-colors ${
                market === m ? 'border-accent bg-accent/10 font-medium text-accent' : 'border-border text-text-secondary'
              }`}
            >
              {m === 'us' ? '미국' : '국내'}
            </button>
          ))}
        </div>
        {data && (
          <span className="text-[11px] text-text-muted">
            시총 상위 100 + 관심 종목 · {data.cells.length}종목 · 오름 {up} · 내림 {down} ·{' '}
            {new Date(data.asOf).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 기준
            {loading && ' · 새로고침 중…'}
          </span>
        )}
        {/* 색 범례 */}
        <span className="ml-auto flex items-center gap-0.5 text-[10px] text-text-muted">
          {[-3, -2, -1, -0.5, 0, 0.5, 1, 2, 3].map((v) => (
            <span key={v} className={`flex h-4 w-8 items-center justify-center ${colorOf(v === 0 ? 0 : v > 0 ? v + 0.1 : v - 0.1)}`}>
              {v > 0 ? `+${v}` : v}
            </span>
          ))}
        </span>
      </header>

      {error && <p className="mb-2 rounded border border-bearish/40 bg-bearish/10 px-3 py-1.5 text-[11px] text-bearish">{error}</p>}
      {data && data.missingSectors > 0 && (
        <p className="mb-2 text-[11px] text-text-muted">
          섹터 정보가 없는 {data.missingSectors}종목은 「기타」 로 묶었습니다 (새로 들어온 종목은 하루 한 번 뒤에서 채웁니다).
        </p>
      )}

      <div ref={box} className="relative min-h-0 flex-1 overflow-hidden rounded-lg border border-border bg-bg-secondary">
        {!data && !error && <p className="p-4 text-xs text-text-muted">지도를 그리는 중… (처음은 전 거래일 종가를 모으느라 조금 걸립니다)</p>}
        {sectors.map((s) => (
          <div
            key={s.name}
            className="pointer-events-none absolute border border-bg-primary"
            style={{ left: s.rect.x, top: s.rect.y, width: s.rect.w, height: s.rect.h }}
          >
            {s.rect.w > 40 && (
              <span className="block truncate px-1 text-[10px] font-medium leading-4 text-text-secondary">{s.name}</span>
            )}
          </div>
        ))}
        {tiles.map(({ rect, cell }) => {
          const big = rect.w > 46 && rect.h > 30;
          const medium = rect.w > 30 && rect.h > 16;
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
              className={`absolute flex flex-col items-center justify-center overflow-hidden border border-bg-primary/70 text-center transition-[filter] hover:brightness-125 ${colorOf(cell.changeRate)} ${
                cell.watch ? 'ring-1 ring-inset ring-accent/70' : ''
              }`}
              style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
              aria-label={`${cell.name ?? cell.symbol} ${pct(cell.changeRate)}`}
            >
              {medium && (
                <span
                  className="max-w-full truncate px-0.5 font-semibold text-text-primary"
                  style={{ fontSize: Math.max(9, Math.min(20, Math.sqrt(rect.w * rect.h) / 6)) }}
                >
                  {tileLabel(cell)}
                </span>
              )}
              {big && <span className="text-[10px] tabular-nums text-text-primary/90">{pct(cell.changeRate)}</span>}
            </button>
          );
        })}
        {hover && (
          <div
            className="pointer-events-none absolute z-10 w-48 rounded border border-border bg-bg-primary/95 px-2 py-1.5 text-[11px] shadow-lg"
            style={{
              left: Math.min(hover.x + 12, Math.max(0, size.w - 200)),
              top: Math.min(hover.y + 12, Math.max(0, size.h - 90)),
            }}
          >
            <p className="truncate font-medium text-text-primary">
              {hover.cell.name ?? hover.cell.symbol} <span className="text-text-muted">{hover.cell.symbol}</span>
            </p>
            <p className="text-text-secondary">
              {hover.cell.price != null ? formatPrice(hover.cell.price, hover.cell.currency) : '—'}{' '}
              <span className={(hover.cell.changeRate ?? 0) >= 0 ? 'text-bullish' : 'text-bearish'}>{pct(hover.cell.changeRate)}</span>
            </p>
            <p className="text-text-muted">
              {hover.cell.sector} · 시총 {formatCompactMoney(hover.cell.marketCap, hover.cell.currency)}
              {hover.cell.watch && ' · 관심 종목'}
            </p>
            <p className="text-text-muted">누르면 차트로</p>
          </div>
        )}
      </div>
      <p className="mt-1 shrink-0 text-[10px] text-text-muted">
        색은 전 거래일 종가 대비 등락입니다. 파란 테두리는 관심 종목. 1분마다 새로고침(화면을 보고 있을 때만).
      </p>
    </div>
  );
}
