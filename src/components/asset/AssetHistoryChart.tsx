import { useEffect, useRef } from 'react';
import { LineSeries, createChart, type IChartApi, type ISeriesApi, type UTCTimestamp } from 'lightweight-charts';
import { BASE_CHART_OPTIONS, COLORS } from '../chart/chartTheme';
import { formatCompactMoney, formatNumber } from '../../utils/formatters';
import type { AssetHistoryPoint } from '../../types/asset';

/**
 * 총 자산 선 차트(v2.62.0) — 하루 기록(미국 거래일마다 한 점) · `lightweight-charts` 선 하나.
 * 점이 하나뿐이어도 점으로 그린다(선은 둘째 기록부터). 축 · 십자선 값은 억 단위 소수 둘째 자리(₩51.23억 — 하루 움직임이 축에 보이게) · 1억 미만은 압축 표기.
 */
const axisMoney = (v: number) => (Math.abs(v) >= 1e8 ? `₩${formatNumber(v / 1e8, 2, '억')}` : formatCompactMoney(v, 'KRW'));
export default function AssetHistoryChart({ points }: { points: AssetHistoryPoint[] }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Line'> | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const chart = createChart(container, {
      ...BASE_CHART_OPTIONS,
      autoSize: true,
      rightPriceScale: { borderColor: COLORS.border, scaleMargins: { top: 0.15, bottom: 0.15 } },
      timeScale: { borderColor: COLORS.border, timeVisible: false },
    });
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
    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    seriesRef.current?.setData(points.map((p) => ({ time: (Date.parse(`${p.day}T00:00:00Z`) / 1000) as UTCTimestamp, value: p.total })));
    chartRef.current?.timeScale().fitContent();
  }, [points]);

  return <div ref={containerRef} className="h-full min-h-0 w-full" data-testid="asset-history-chart" />;
}
