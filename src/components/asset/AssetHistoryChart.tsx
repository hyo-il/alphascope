import { useEffect, useRef, useState } from 'react';
import { LineSeries, createChart, type IChartApi, type ISeriesApi, type MouseEventParams, type UTCTimestamp } from 'lightweight-charts';
import { BASE_CHART_OPTIONS, COLORS, dateTimeOptions } from '../chart/chartTheme';
import { TOOLTIP_BOX, TOOLTIP_EDGE, TOOLTIP_GAP } from '../ui/tokens';
import { changeColor, formatCompactMoney, formatNumber, formatSigned } from '../../utils/formatters';
import { formatAssetWon, formatAssetWonSigned } from '../../utils/assetFormat';
import type { AssetDailyChange, AssetHistoryPoint } from '../../types/asset';

/**
 * 총 자산 선 차트(v2.62.0) — 하루 기록(미국 거래일마다 한 점) · `lightweight-charts` 선 하나.
 * 점이 하나뿐이어도 점으로 그린다(선은 둘째 기록부터). 축 · 십자선 값은 억 단위 소수 둘째 자리(₩51.23억 — 하루 움직임이 축에 보이게) · 1억 미만은 압축 표기.
 * 마우스 오버(v2.70.0): 마우스 아래 점의 날짜 · 원 단위 정확한 금액 · 전날 기록 대비(원 · % — 일별 변화 표와 같은 `rows` 값 · 첫 기록은 대비 없음).
 *   상자는 앱 툴팁과 같은 모양(`TOOLTIP_BOX`) · 차트 칸 안에서 잘리지 않게 자리를 옮긴다(오른쪽 · 아래가 모자라면 반대쪽).
 */
const axisMoney = (v: number) => (Math.abs(v) >= 1e8 ? `₩${formatNumber(v / 1e8, 2, '억')}` : formatCompactMoney(v, 'KRW'));
const timeOf = (day: string) => (Date.parse(`${day}T00:00:00Z`) / 1000) as UTCTimestamp;

export default function AssetHistoryChart({ points, rows }: { points: AssetHistoryPoint[]; rows: AssetDailyChange[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  /** 마우스 아래 점 — 날짜 · 차트 칸 안 좌표(px) */
  const [hover, setHover] = useState<{ day: string; x: number; y: number } | null>(null);
  const [tipPos, setTipPos] = useState<{ left: number; top: number } | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const chart = createChart(container, {
      ...BASE_CHART_OPTIONS,
      autoSize: true,
      rightPriceScale: { borderColor: COLORS.border, scaleMargins: { top: 0.15, bottom: 0.15 } },
      timeScale: { borderColor: COLORS.border, timeVisible: false },
    });
    // 십자선 아래 날짜 글 — 라이브러리 기본(「10 11월 '26」) 대신 앱 날짜 표기 한 곳(`dateTimeOptions` · 2026-11-10) · 아래 축 눈금은 그대로
    chart.applyOptions({ localization: dateTimeOptions(false).localization });
    seriesRef.current = chart.addSeries(LineSeries, {
      color: COLORS.accent,
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: true,
      crosshairMarkerVisible: true,
      pointMarkersVisible: true,
      pointMarkersRadius: 4,
      priceFormat: { type: 'custom', minMove: 1, formatter: axisMoney },
      // 값이 하나뿐이거나 모두 같으면 축 눈금이 모두 같은 숫자가 된다 — 위아래 1% 를 넓혀 서로 다른 눈금이 나오게
      autoscaleInfoProvider: (original: () => { priceRange: { minValue: number; maxValue: number } } | null) => {
        const r = original();
        if (!r || r.priceRange.maxValue - r.priceRange.minValue > Math.abs(r.priceRange.maxValue) * 0.001) return r;
        const v = r.priceRange.maxValue;
        return { ...r, priceRange: { minValue: v - Math.abs(v) * 0.01, maxValue: v + Math.abs(v) * 0.01 } };
      },
    });
    chartRef.current = chart;
    const onMove = (param: MouseEventParams) => {
      const series = seriesRef.current;
      const data = series && param.point && param.time != null ? param.seriesData.get(series) : undefined;
      if (!param.point || param.time == null || !data || !('value' in data)) return setHover(null);
      const y = series?.priceToCoordinate(Number(data.value));
      const x = chart.timeScale().timeToCoordinate(param.time);
      if (x == null || y == null) return setHover(null);
      const t = Number(param.time);
      setHover({ day: new Date(t * 1000).toISOString().slice(0, 10), x, y });
    };
    chart.subscribeCrosshairMove(onMove);
    return () => {
      chart.unsubscribeCrosshairMove(onMove);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    seriesRef.current?.setData(points.map((p) => ({ time: timeOf(p.day), value: p.total })));
    chartRef.current?.timeScale().fitContent();
    setHover(null);
  }, [points]);

  // 상자 자리 — 점 오른쪽 아래가 기본, 차트 칸을 넘으면 왼쪽 · 위로(칸 안 `TOOLTIP_EDGE` 안쪽)
  useEffect(() => {
    const box = tipRef.current;
    const host = containerRef.current;
    if (!hover || !box || !host) return setTipPos(null);
    const w = box.offsetWidth;
    const h = box.offsetHeight;
    const W = host.clientWidth;
    const H = host.clientHeight;
    const gap = TOOLTIP_GAP * 3;
    let left = hover.x + gap;
    if (left + w > W - TOOLTIP_EDGE) left = hover.x - gap - w;
    let top = hover.y + gap;
    if (top + h > H - TOOLTIP_EDGE) top = hover.y - gap - h;
    const r = host.getBoundingClientRect();
    setTipPos({ left: r.left + Math.max(TOOLTIP_EDGE, Math.min(left, W - TOOLTIP_EDGE - w)), top: r.top + Math.max(TOOLTIP_EDGE, Math.min(top, H - TOOLTIP_EDGE - h)) });
  }, [hover]);

  const point = hover ? points.find((p) => p.day === hover.day) : undefined;
  const row = hover ? rows.find((r) => r.day === hover.day) : undefined;
  return (
    <div ref={containerRef} className="relative h-full min-h-0 w-full" data-testid="asset-history-chart">
      {point && (
        <div
          ref={tipRef}
          role="tooltip"
          data-testid="asset-history-tip"
          className={`${TOOLTIP_BOX} pointer-events-none tabular-nums ${tipPos ? '' : 'invisible'}`}
          style={tipPos ? { left: tipPos.left, top: tipPos.top } : { left: 0, top: 0 }}
        >
          <div className="text-caption text-text-muted">{point.day}</div>
          <div className="font-semibold">{formatAssetWon(point.total)}</div>
          {row?.change != null ? (
            <div className={changeColor(row.change)}>
              전날보다 {formatAssetWonSigned(row.change)} ({formatSigned(row.ratio == null ? null : row.ratio * 100, 2, '%')})
            </div>
          ) : (
            <div className="text-caption text-text-muted">전날 기록 대비 없음</div>
          )}
        </div>
      )}
    </div>
  );
}
