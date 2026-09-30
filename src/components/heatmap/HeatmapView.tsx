import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { squarify, type Rect } from '../../utils/treemap';
import { formatCompactMoney, formatPrice } from '../../utils/formatters';
import {
  HEATMAP_PERIODS,
  type HeatmapCell,
  type HeatmapMarket,
  type HeatmapPeriod,
  type HeatmapResponse,
} from '../../types/heatmap';
import SectorRanking from './SectorRanking';

/**
 * 🗺 종목 지도 (v2.18.0) — 시장 온도를 한눈에. 네모 크기 = 시가총액, 색 = 기간 수익률, 섹터로 묶는다.
 *
 * - 데이터는 `GET /api/heatmap?market=&period=` 한 곳. 1일은 서버 60초 캐시 + 화면이 보일 때만 60초마다 다시 받는다(숨은 탭 정지).
 *   1주 이상(v2.19.0)은 종가 기준이라 주기 새로고침을 하지 않는다(탭이 다시 보일 때만).
 * - 배치는 직접 구현한 squarified treemap(`utils/treemap.ts`) — 섹터를 먼저 나누고, 섹터 안에서 종목을 나눈다.
 * - 색은 `index.css` 토큰(bullish/bearish) + 진하기 구간 — 기간이 길수록 구간을 넓힌다(`BINS`). 0% 근처는 회색.
 * - 오른쪽 「섹터 강세 순위」(v2.19.0)는 **설명용**이다 — 지난 기간의 결과이고 판정·자동매매에 쓰지 않는다.
 * - ⚠️ 다른 사이트의 데이터·디자인을 가져오지 않았다 — 앱 다크 테마로 새로 그렸다.
 */

const REFRESH_MS = 60_000;
const SECTOR_HEADER = 16;

/** 기간별 색 구간(%) — 네 단계. 1일 ±0.5·1·2·3 / 1주 ±1·2·4·6 / 1·3개월 ±2·5·10·15 */
const BINS: Record<HeatmapPeriod, [number, number, number, number]> = {
  '1d': [0.5, 1, 2, 3],
  '1w': [1, 2, 4, 6],
  '1m': [2, 5, 10, 15],
  '3m': [2, 5, 10, 15],
};
const SHADES = {
  up: ['bg-bullish/25', 'bg-bullish/45', 'bg-bullish/65', 'bg-bullish/85'],
  down: ['bg-bearish/25', 'bg-bearish/45', 'bg-bearish/65', 'bg-bearish/85'],
};

function colorOf(change: number | null, period: HeatmapPeriod): string {
  if (change == null) return 'bg-bg-tertiary';
  const [b0, b1, b2, b3] = BINS[period];
  const a = Math.abs(change);
  if (a < b0) return 'bg-bg-tertiary';
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
}
interface SectorBox {
  rect: Rect;
  name: string;
}

export default function HeatmapView({ onSelectSymbol }: { onSelectSymbol: (symbol: string) => void }) {
  const [market, setMarket] = useState<HeatmapMarket>('us');
  const [period, setPeriod] = useState<HeatmapPeriod>('1d');
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
      const r = await fetch(`/api/heatmap?market=${market}&period=${period}`);
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
  }, [market, period]);

  // 처음 + (1일만) 60초마다 — 탭이 숨어 있으면 쉬고, 다시 보이면 곧바로 한 번
  useEffect(() => {
    setData(null);
    setFocusSector(null);
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

  const periodInfo = HEATMAP_PERIODS.find((p) => p.id === period)!;
  const marketLabel = market === 'us' ? '미국' : '국내';
  const best = data?.sectors[0];
  const worst = data && data.sectors.length > 1 ? data.sectors[data.sectors.length - 1] : undefined;
  const bins = BINS[period];
  const legend = [...[...bins].reverse().map((b) => -b), 0, ...bins];

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
        <div className="flex gap-1" role="group" aria-label="기간">
          {HEATMAP_PERIODS.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPeriod(p.id)}
              aria-pressed={period === p.id}
              className={`rounded border px-2 py-0.5 text-[11px] transition-colors ${
                period === p.id ? 'border-accent bg-accent/10 font-medium text-accent' : 'border-border text-text-secondary'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        {data && (
          <span className="text-[11px] text-text-muted">
            시총 상위 100 + 관심 종목 · {data.cells.length}종목 ·{' '}
            {period === '1d'
              ? `${new Date(data.asOf).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 기준`
              : `최근 종가 기준 ${periodInfo.bars}거래일`}
            {loading && ' · 새로고침 중…'}
          </span>
        )}
        {/* 색 범례 — 기간마다 구간이 다르다 */}
        <span className="ml-auto flex items-center gap-0.5 text-[10px] text-text-muted" aria-label={`색 구간 ±${bins.join('·')}%`}>
          {legend.map((v) => (
            <span
              key={v}
              className={`flex h-4 w-8 items-center justify-center ${colorOf(v === 0 ? 0 : v > 0 ? v + 0.01 : v - 0.01, period)}`}
            >
              {v > 0 ? `+${v}` : v}
            </span>
          ))}
          <span className="ml-0.5">%</span>
        </span>
      </header>

      {/* 한 줄 요약 — 지난 기간의 결과 */}
      {data && best && (
        <p className="mb-1 shrink-0 text-[12px] text-text-primary">
          {marketLabel} 대형주 {periodInfo.label}: 강세 1위 <b>{best.sector}</b>{' '}
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

      {error && <p className="mb-2 rounded border border-bearish/40 bg-bearish/10 px-3 py-1.5 text-[11px] text-bearish">{error}</p>}
      {data && data.missingSectors > 0 && (
        <p className="mb-1 text-[11px] text-text-muted">
          섹터 정보가 없는 {data.missingSectors}종목은 「기타」 로 묶었습니다 (새로 들어온 종목은 하루 한 번 뒤에서 채웁니다).
        </p>
      )}

      <div className="flex min-h-0 flex-1 gap-2">
        <div ref={box} className="relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-lg border border-border bg-bg-secondary">
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
                  className={`block truncate px-1 text-[10px] font-medium leading-4 ${
                    focusSector === s.name ? 'text-accent' : 'text-text-secondary'
                  }`}
                >
                  {s.name}
                </span>
              )}
            </div>
          ))}
          {tiles.map(({ rect, cell }) => {
            const big = rect.w > 46 && rect.h > 30;
            const medium = rect.w > 30 && rect.h > 16;
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
                  cell.watch ? 'ring-1 ring-inset ring-accent/70' : ''
                } ${dimmed ? 'opacity-25' : ''}`}
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
              className="pointer-events-none absolute z-10 w-52 rounded border border-border bg-bg-primary/95 px-2 py-1.5 text-[11px] shadow-lg"
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
            <p className="text-[12px] font-semibold text-text-primary">섹터 강세 순위 · {periodInfo.label}</p>
            <p className="text-[10px] text-text-muted">시총 가중(현재 시총) 수익률 높은 순 · 줄을 누르면 지도에서 강조</p>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {data ? (
              <SectorRanking sectors={data.sectors} selected={focusSector} onSelect={setFocusSector} />
            ) : (
              <p className="p-3 text-[11px] text-text-muted">불러오는 중…</p>
            )}
          </div>
          {data && data.excluded > 0 && (
            <p className="shrink-0 border-t border-border px-2.5 py-1 text-[10px] text-text-muted">
              {periodInfo.label} 전 종가가 없어 제외한 종목 {data.excluded}개 (상장 직후·거래 정지 등)
            </p>
          )}
        </aside>
      </div>
      <p className="mt-1 shrink-0 text-[10px] text-text-muted">
        <b className="font-medium text-text-secondary">지난 기간의 결과입니다. 앞으로도 강할 것이라는 뜻이 아닙니다.</b> 색은{' '}
        {period === '1d' ? '전 거래일 종가 대비 등락' : `최근 종가 ÷ ${periodInfo.bars}거래일 전 종가`}입니다. 파란 테두리는 관심 종목.
        {period === '1d' && ' 1분마다 새로고침(화면을 보고 있을 때만).'}
      </p>
    </div>
  );
}
