import { useEffect, useRef, useState } from 'react';
import {
  LineSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { PaperSnapshot } from '../../types/paper';
import { BASE_CHART_OPTIONS, COLORS } from '../chart/chartTheme';

interface Props {
  snapshots: PaperSnapshot[];
}

type Range = '1w' | '1m' | '3m' | 'all';

const RANGES: { id: Range; label: string; days: number | null }[] = [
  { id: '1w', label: '1주', days: 7 },
  { id: '1m', label: '1개월', days: 30 },
  { id: '3m', label: '3개월', days: 90 },
  { id: 'all', label: '전체', days: null },
];

/**
 * 누적 수익률 곡선.
 *
 * 스냅샷은 앱을 켜 둔 날에만 찍힌다 — 하루 한 점이라 라인 차트로 충분하고,
 * 0% 기준선을 함께 그려 손익 방향을 바로 읽게 한다.
 */
export default function PerformanceChart({ snapshots }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const [range, setRange] = useState<Range>('all');

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      ...BASE_CHART_OPTIONS,
      autoSize: true,
      rightPriceScale: { borderColor: COLORS.border, scaleMargins: { top: 0.15, bottom: 0.15 } },
      timeScale: { borderColor: COLORS.border, timeVisible: false },
    });

    const series = chart.addSeries(LineSeries, {
      color: COLORS.accent,
      lineWidth: 2,
      priceLineVisible: false,
      crosshairMarkerVisible: true,
      pointMarkersVisible: true,
      priceFormat: { type: 'custom', formatter: (v: number) => `${v.toFixed(2)}%` },
    });
    // 0% 기준선 — 이 위/아래가 곧 손익이다.
    series.createPriceLine({
      price: 0,
      color: COLORS.text,
      lineWidth: 1,
      lineStyle: 2,
      axisLabelVisible: true,
      title: '',
    });

    chartRef.current = chart;
    seriesRef.current = series;

    return () => {
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
    };
  }, []);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;

    const days = RANGES.find((r) => r.id === range)?.days ?? null;
    const cutoff = days ? Date.now() - days * 86_400_000 : 0;

    const points = snapshots
      .filter((s) => new Date(s.date).getTime() >= cutoff)
      .map((s) => ({
        time: (new Date(`${s.date}T00:00:00Z`).getTime() / 1000) as UTCTimestamp,
        value: s.cumulativeReturn ?? 0,
      }));

    series.setData(points);
    chartRef.current?.timeScale().fitContent();
  }, [snapshots, range]);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex items-center gap-1">
        <h4 className="mr-auto text-xs font-medium text-text-secondary">누적 수익률</h4>
        {RANGES.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => setRange(r.id)}
            className={`rounded px-2 py-0.5 text-[11px] transition-colors ${
              range === r.id
                ? 'bg-accent/15 font-medium text-accent'
                : 'text-text-secondary hover:bg-bg-tertiary'
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div className="relative min-h-0 flex-1 rounded-md border border-border">
        <div ref={containerRef} className="h-full w-full" />
        {snapshots.length < 2 && (
          <p className="pointer-events-none absolute inset-0 flex items-center justify-center text-center text-[11px] text-text-muted">
            수익률 곡선은 스냅샷이 2일 이상 쌓이면 그려집니다.
            <br />
            (스냅샷은 모의투자 화면을 열 때 하루 한 번 기록됩니다)
          </p>
        )}
      </div>
    </div>
  );
}
