import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  DrawingManager,
  getToolRegistry,
  type Anchor,
  type DrawingOptions,
} from 'lightweight-charts-drawing';
import {
  CandlestickSeries,
  HistogramSeries,
  createChart,
  type CandlestickData,
  type HistogramData,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { Candle, Price } from '../../types/toss';
import type { DrawingToolType } from './DrawingTools';

const COLORS = {
  background: '#0D0D1A',
  grid: '#1E1E35',
  text: '#9898B0',
  border: '#2A2A45',
  bullish: '#26A69A',
  bearish: '#EF5350',
};

interface Props {
  candles: Candle[];
  /** 1초 폴링으로 들어오는 현재가 — 마지막 캔들을 실시간 갱신한다. */
  livePrice: Price | null;
  /** 선택된 드로잉 도구 (null 이면 커서 모드) */
  activeTool?: DrawingToolType;
  /** 드로잉 개수가 바뀔 때 호출 — 툴바의 '전체 삭제' 활성화에 쓴다. */
  onDrawingCountChange?: (count: number) => void;
  /** 하나 그리고 나면 호출 — 툴바를 커서 모드로 되돌린다. */
  onToolConsumed?: () => void;
}

/** 부모가 차트를 직접 조작할 때 쓰는 핸들 */
export interface CandleChartHandle {
  clearDrawings: () => void;
  deleteSelectedDrawing: () => void;
  /** 캡처 대상 DOM (차트 컨테이너) */
  getElement: () => HTMLElement | null;
}

interface HoverInfo {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const toChartTime = (ms: number) => (ms / 1000) as UTCTimestamp;

const CandleChart = forwardRef<CandleChartHandle, Props>(function CandleChart(
  { candles, livePrice, activeTool = null, onDrawingCountChange, onToolConsumed },
  ref,
) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const drawingsRef = useRef<DrawingManager | null>(null);
  const [hover, setHover] = useState<HoverInfo | null>(null);

  // 차트 생성 effect 를 한 번만 돌리기 위해 콜백은 ref 로 넘긴다.
  const countCallbackRef = useRef(onDrawingCountChange);
  countCallbackRef.current = onDrawingCountChange;
  const onToolConsumedRef = useRef(onToolConsumed);
  onToolConsumedRef.current = onToolConsumed;

  useImperativeHandle(ref, () => ({
    clearDrawings: () => {
      drawingsRef.current?.clearAll();
    },
    deleteSelectedDrawing: () => {
      const selected = drawingsRef.current?.getSelectedDrawing();
      if (selected) drawingsRef.current?.removeDrawing(selected.id);
    },
    getElement: () => wrapperRef.current,
  }));

  // 차트 생성은 한 번만. 데이터 갱신은 별도 effect 에서 setData 로 처리한다.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      layout: {
        background: { color: COLORS.background },
        textColor: COLORS.text,
        attributionLogo: false,
      },
      grid: {
        vertLines: { color: COLORS.grid },
        horzLines: { color: COLORS.grid },
      },
      rightPriceScale: { borderColor: COLORS.border },
      timeScale: {
        borderColor: COLORS.border,
        timeVisible: true,
        secondsVisible: false,
      },
      crosshair: {
        mode: 0, // Normal — 마우스 위치를 그대로 따라간다
        vertLine: { color: COLORS.border, labelBackgroundColor: '#252540' },
        horzLine: { color: COLORS.border, labelBackgroundColor: '#252540' },
      },
      // 드래그는 아래에서 직접 처리한다 (기본 드래그 = 팬 동작을 끈다)
      handleScroll: { pressedMouseMove: false, mouseWheel: true, horzTouchDrag: true },
      handleScale: { axisPressedMouseMove: true, mouseWheel: true, pinch: true },
      autoSize: true,
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: COLORS.bullish,
      downColor: COLORS.bearish,
      borderUpColor: COLORS.bullish,
      borderDownColor: COLORS.bearish,
      wickUpColor: COLORS.bullish,
      wickDownColor: COLORS.bearish,
    });
    // 캔들은 위쪽 80%, 거래량은 아래 20% 를 쓴다.
    candleSeries.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.26 } });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
      // 거래량은 가격축에 마지막 값 라인을 그리지 않는다 (가격 라인과 헷갈린다).
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.8, bottom: 0 },
      visible: false,
    });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;

    // 드로잉 플러그인 — 캔들 시리즈에 primitive 로 붙는다.
    const drawings = new DrawingManager();
    drawings.attach(chart, candleSeries, container);
    drawingsRef.current = drawings;

    const reportCount = () => countCallbackRef.current?.(drawings.getAllDrawings().length);
    const unsubscribers = (
      ['drawing:added', 'drawing:removed', 'drawing:cleared'] as const
    ).map((event) => drawings.on(event, reportCount));

    // 크로스헤어 위치의 OHLCV 를 좌상단 레전드에 표시
    chart.subscribeCrosshairMove((param) => {
      const candleData = param.seriesData.get(candleSeries) as CandlestickData | undefined;
      const volumeData = param.seriesData.get(volumeSeries) as HistogramData | undefined;
      if (!param.time || !candleData) {
        setHover(null);
        return;
      }
      setHover({
        time: (param.time as number) * 1000,
        open: candleData.open,
        high: candleData.high,
        low: candleData.low,
        close: candleData.close,
        volume: volumeData?.value ?? 0,
      });
    });

    // 마우스 좌표 → 차트 좌표(시간·가격). 플러그인 앵커가 이 형식을 쓴다.
    const toAnchor = (e: MouseEvent): Anchor | null => {
      const rect = container.getBoundingClientRect();
      const time = chart.timeScale().coordinateToTime(e.clientX - rect.left);
      const price = candleSeries.coordinateToPrice(e.clientY - rect.top);
      if (time === null || price === null) return null;
      return { time, price };
    };

    /**
     * 드로잉을 생성한다.
     * DrawingManager 는 선택·앵커 편집만 담당하고 생성은 하지 않으므로,
     * 도구별 필요 앵커 수를 보고 여기서 직접 만들어 등록한다.
     */
    const createDrawing = (type: string, anchors: Anchor[]) => {
      const registry = getToolRegistry();
      const definition = registry.get(type);
      if (!definition) return;

      // 자(측정) 도구는 방향에 따라 색을 바꾼다: 상승 초록 / 하락 빨강.
      const isMeasure = type === 'date-price-range';
      const isUp = anchors.length > 1 && anchors[1].price >= anchors[0].price;
      const color = isMeasure ? (isUp ? COLORS.bullish : COLORS.bearish) : '#6366F1';

      const drawing = registry.createDrawing(
        type,
        `${type}-${Date.now()}`,
        anchors,
        {
          lineColor: color,
          lineWidth: 1.5,
          fillColor: color,
          fillOpacity: 0.15,
          showLabels: true,
          labelColor: '#E8E8F0',
        },
        // 측정 도구 전용 옵션(filled/showPercentage/…)은 DatePriceRangeOptions 에만 있고
        // createDrawing 의 시그니처는 공통 DrawingOptions 라서 캐스팅이 필요하다.
        isMeasure
          ? ({ filled: true, showPercentage: true, showPrices: true } as DrawingOptions)
          : {},
      );

      if (drawing) drawings.addDrawing(drawing);
    };

    // 드래그 = 확대/축소, Shift + 드래그 = 좌우 이동(팬)
    let dragging = false;
    let lastX = 0;
    // 드로잉 시작 앵커 (2점 도구용)
    let drawStart: Anchor | null = null;

    const onMouseDown = (e: MouseEvent) => {
      const tool = drawings.getActiveTool();

      if (tool) {
        const anchor = toAnchor(e);
        if (!anchor) return;
        const required = getToolRegistry().get(tool)?.requiredAnchors ?? 2;

        if (required <= 1) {
          // 수평선처럼 한 점이면 클릭 즉시 생성
          createDrawing(tool, [anchor]);
          onToolConsumedRef.current?.();
        } else {
          drawStart = anchor;
        }
        return;
      }

      // 선택된 드로잉의 앵커를 끌고 있을 수 있으므로 줌/팬을 가로채지 않는다.
      if (drawings.getSelectedDrawing()) return;
      dragging = true;
      lastX = e.clientX;
    };

    const onDrawEnd = (e: MouseEvent) => {
      const tool = drawings.getActiveTool();
      if (!tool || !drawStart) {
        drawStart = null;
        return;
      }

      const start = drawStart;
      drawStart = null;

      const end = toAnchor(e);
      // 클릭만 하고 끝난 경우(시작=끝)는 무시한다.
      if (!end || (end.time === start.time && end.price === start.price)) return;

      createDrawing(tool, [start, end]);
      onToolConsumedRef.current?.();
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!dragging) return;
      const dx = e.clientX - lastX;
      if (dx === 0) return;
      lastX = e.clientX;

      const timeScale = chart.timeScale();
      const range = timeScale.getVisibleLogicalRange();
      if (!range) return;

      if (e.shiftKey) {
        // 팬: 커서를 따라가도록 화면을 이동
        const bars = dx / timeScale.options().barSpacing;
        timeScale.setVisibleLogicalRange({ from: range.from - bars, to: range.to - bars });
      } else {
        // 줌: 오른쪽으로 끌면 확대, 왼쪽으로 끌면 축소 (중앙 기준)
        const span = range.to - range.from;
        const center = (range.from + range.to) / 2;
        const nextSpan = Math.min(5000, Math.max(10, span * (1 - dx / 400)));
        timeScale.setVisibleLogicalRange({
          from: center - nextSpan / 2,
          to: center + nextSpan / 2,
        });
      }
    };

    const stopDrag = () => {
      dragging = false;
    };

    container.addEventListener('mousedown', onMouseDown);
    container.addEventListener('mouseup', onDrawEnd);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', stopDrag);

    return () => {
      container.removeEventListener('mousedown', onMouseDown);
      container.removeEventListener('mouseup', onDrawEnd);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', stopDrag);
      for (const unsubscribe of unsubscribers) unsubscribe();
      drawings.detach();
      drawingsRef.current = null;
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
    };
  }, []);

  // 선택된 드로잉 도구를 플러그인에 전달
  useEffect(() => {
    const drawings = drawingsRef.current;
    if (!drawings) return;
    drawings.setActiveTool(activeTool);
    if (!activeTool) drawings.deselectAll();
  }, [activeTool]);

  // 캔들 데이터 반영
  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    const volumeSeries = volumeSeriesRef.current;
    if (!candleSeries || !volumeSeries || !candles.length) return;

    candleSeries.setData(
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

    volumeSeries.setData(
      candles.map(
        (c): HistogramData => ({
          time: toChartTime(c.timestamp),
          value: c.volume,
          color: c.close >= c.open ? `${COLORS.bullish}66` : `${COLORS.bearish}66`,
        }),
      ),
    );

    chartRef.current?.timeScale().fitContent();
  }, [candles]);

  // 현재가로 마지막 캔들을 실시간 갱신
  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    const last = candles.at(-1);
    if (!candleSeries || !last || !livePrice || !Number.isFinite(livePrice.close)) return;

    // 폴링 가격이 마지막 캔들과 지나치게 동떨어지면(시세 오류·모의 데이터 불일치) 무시한다.
    // 잘못된 값 하나가 캔들의 고가/저가를 영구히 늘려 차트를 망가뜨리기 때문이다.
    if (Math.abs(livePrice.close - last.close) / last.close > 0.2) return;

    candleSeries.update({
      time: toChartTime(last.timestamp),
      open: last.open,
      high: Math.max(last.high, livePrice.close),
      low: Math.min(last.low, livePrice.close),
      close: livePrice.close,
    });
  }, [livePrice, candles]);

  const legend = hover ?? lastAsHover(candles);

  return (
    <div ref={wrapperRef} className="relative h-full w-full bg-bg-primary">
      {legend && (
        <div className="pointer-events-none absolute left-3 top-3 z-10 flex flex-wrap gap-x-3 gap-y-1 rounded-md bg-bg-secondary/80 px-3 py-2 text-xs backdrop-blur-sm">
          <span className="text-text-muted">
            {new Date(legend.time).toLocaleString('ko-KR', {
              year: '2-digit',
              month: '2-digit',
              day: '2-digit',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
          <span>
            시 <span className="text-text-primary">{legend.open}</span>
          </span>
          <span>
            고 <span className="text-bullish">{legend.high}</span>
          </span>
          <span>
            저 <span className="text-bearish">{legend.low}</span>
          </span>
          <span>
            종 <span className="text-text-primary">{legend.close}</span>
          </span>
          <span className="text-text-muted">
            거래량 {Intl.NumberFormat('ko-KR', { notation: 'compact' }).format(legend.volume)}
          </span>
        </div>
      )}
      <div ref={containerRef} className="h-full w-full cursor-crosshair" />
    </div>
  );
});

export default CandleChart;

function lastAsHover(candles: Candle[]): HoverInfo | null {
  const last = candles.at(-1);
  if (!last) return null;
  return {
    time: last.timestamp,
    open: last.open,
    high: last.high,
    low: last.low,
    close: last.close,
    volume: last.volume,
  };
}
