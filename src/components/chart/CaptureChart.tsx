import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { DrawingManager, getToolRegistry } from 'lightweight-charts-drawing';
import {
  CandlestickSeries,
  createChart,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
} from 'lightweight-charts';
import type { Candle } from '../../types/toss';
import type { IndicatorSeries, IndicatorToggles } from '../../types/chart';
import type { DrawingSnapshot } from './CandleChart';
import {
  BASE_CHART_OPTIONS,
  CANDLE_SERIES_OPTIONS,
  renderIndicators,
  toChartTime,
} from './chartTheme';

interface Props {
  candles: Candle[];
  indicators: IndicatorSeries | null;
  /** 팝업의 '포함 항목' 체크박스 상태 */
  toggles: IndicatorToggles;
  /** 메인 차트에서 복제해 올 드로잉 (체크 해제 시 빈 배열) */
  drawings: DrawingSnapshot[];
  /** 처음 보여 줄 범위 — 메인 차트가 보고 있던 구간 */
  initialRange: { from: number; to: number } | null;
}

export interface CaptureChartHandle {
  /** html2canvas 가 캡처할 DOM */
  getElement: () => HTMLElement | null;
  /** '다시 캡처' 할 때 조정해 둔 범위를 잃지 않기 위해 읽어 간다 */
  getVisibleRange: () => { from: number; to: number } | null;
}

/**
 * 캡처 팝업 안의 차트 (수정 3).
 *
 * 메인 차트와 같은 캔들·지표로 별도 인스턴스를 만든다. 메인 차트를 직접 캡처하지 않는 이유는
 * 사용자가 "보낼 그림"을 보고 있는 화면과 따로 다듬을 수 있어야 하기 때문이다.
 * 여기서는 드로잉을 새로 그릴 일이 없으므로 라이브러리 기본 조작(드래그 팬·휠 줌)을 그대로 쓴다.
 */
/**
 * 메인 차트에서 떠 온 범위를 캡처 차트의 데이터 안으로 당겨 넣는다.
 *
 * AI 분석 화면에서 메인 차트는 화면 밖 960×640 으로 옮겨져 있다. 크기가 바뀌면
 * 라이브러리는 봉 간격을 유지한 채 범위를 넓히므로, `to` 가 마지막 봉을 한참 지나 있다.
 * 그대로 쓰면 캡처 차트 오른쪽이 텅 빈다 — 보던 봉 수는 유지하되 끝을 데이터에 맞춘다.
 */
function clampRange(
  range: { from: number; to: number } | null,
  barCount: number,
): { from: number; to: number } | null {
  if (!range || barCount === 0) return null;

  const width = range.to - range.from;
  if (!(width > 0)) return null;

  const last = barCount - 1;
  // 오른쪽에 약간의 여백은 남긴다 (마지막 봉이 축에 붙어 있으면 답답하다).
  const margin = Math.min(5, Math.round(width * 0.05));
  let to = Math.min(range.to, last + margin);
  let from = to - width;

  if (from < 0) {
    from = 0;
    to = Math.min(width, last + margin);
  }
  return { from, to };
}

const CaptureChart = forwardRef<CaptureChartHandle, Props>(function CaptureChart(
  { candles, indicators, toggles, drawings, initialRange },
  ref,
) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const drawingManagerRef = useRef<DrawingManager | null>(null);
  const indicatorSeriesRef = useRef<ISeriesApi<'Line' | 'Histogram'>[]>([]);
  /** 최초 1회만 메인 차트의 범위를 따라간다 — 이후에는 사용자가 맞춘 범위를 존중한다. */
  const rangeAppliedRef = useRef(false);

  useImperativeHandle(ref, () => ({
    getElement: () => wrapperRef.current,
    getVisibleRange: () => {
      const range = chartRef.current?.timeScale().getVisibleLogicalRange();
      return range ? { from: range.from, to: range.to } : null;
    },
  }));

  // ── 차트 생성 (한 번만) ──
  useEffect(() => {
    const container = wrapperRef.current;
    if (!container) return;

    const chart = createChart(container, { ...BASE_CHART_OPTIONS, autoSize: true });
    const candleSeries = chart.addSeries(CandlestickSeries, CANDLE_SERIES_OPTIONS);
    candleSeries.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.08 } });

    const manager = new DrawingManager();
    manager.attach(chart, candleSeries, container);

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    drawingManagerRef.current = manager;

    return () => {
      manager.detach();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      drawingManagerRef.current = null;
      indicatorSeriesRef.current = [];
      rangeAppliedRef.current = false;
    };
  }, []);

  // ── 캔들 ──
  useEffect(() => {
    const series = candleSeriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart || !candles.length) return;

    series.setData(
      candles.map(
        (c): CandlestickData => ({
          time: toChartTime(c.timestamp),
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close,
        }),
      ),
    );

  }, [candles]);

  // ── 지표 (체크박스에 따라 다시 그린다) ──
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    for (const series of indicatorSeriesRef.current) chart.removeSeries(series);
    indicatorSeriesRef.current = renderIndicators(chart, candles, indicators, toggles).series;
  }, [candles, indicators, toggles]);

  /*
   * 시작 범위는 데이터·패널이 모두 자리를 잡은 뒤 한 번만 맞춘다.
   * setData 와 패널 추가는 타임스케일을 다시 건드리므로, 그보다 먼저 범위를 넣으면 덮어써진다.
   * autoSize 로 컨테이너 폭이 정해지는 것도 첫 페인트 이후라 rAF 를 한 번 기다린다.
   */
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !candles.length || rangeAppliedRef.current) return;
    rangeAppliedRef.current = true;

    const frame = requestAnimationFrame(() => {
      const scale = chartRef.current?.timeScale();
      if (!scale) return;
      const range = clampRange(initialRange, candles.length);
      if (range) scale.setVisibleLogicalRange(range);
      else scale.fitContent();
    });
    return () => cancelAnimationFrame(frame);
  }, [candles, initialRange]);

  // ── 드로잉 복제 ──
  useEffect(() => {
    const manager = drawingManagerRef.current;
    if (!manager) return;

    manager.clearAll();
    const registry = getToolRegistry();
    for (const [i, snapshot] of drawings.entries()) {
      const drawing = registry.createDrawing(
        snapshot.type,
        `capture-${i}-${snapshot.type}`,
        snapshot.anchors,
        snapshot.style,
        snapshot.options,
      );
      if (drawing) manager.addDrawing(drawing);
    }
  }, [drawings]);

  return <div ref={wrapperRef} className="h-full w-full bg-bg-primary" />;
});

export default CaptureChart;
