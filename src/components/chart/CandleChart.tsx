import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  DrawingManager,
  getToolRegistry,
  type Anchor,
  type DrawingOptions,
  type IDrawing,
} from 'lightweight-charts-drawing';
import {
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  createChart,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { Candle, Price } from '../../types/toss';
import {
  MA_LINES,
  type IndicatorLine,
  type IndicatorSeries,
  type IndicatorToggles,
} from '../../types/chart';
import type { DrawingToolType } from './DrawingTools';

/** index.css 의 @theme 토큰과 같은 값을 유지한다 (차트는 JS 로 색을 받는다). */
const COLORS = {
  background: '#141414',
  grid: '#222222',
  text: '#999999',
  border: '#333333',
  bullish: '#26A69A',
  bearish: '#EF5350',
  accent: '#3182F6',
  label: '#E0E0E0',
  tooltipBg: '#1E1E1EE6',
};

const INDICATOR_COLORS = {
  ema12: '#58D68D',
  ema26: '#EC7063',
  bb: '#7F8C9A',
  vwap: '#F7DC6F',
  rsi: '#5B8DEF',
  macd: '#5DADE2',
  macdSignal: '#F5B041',
  stochK: '#58D68D',
  stochD: '#EC7063',
  atr: '#F5B041',
  obv: '#5DADE2',
};

/** 휠 한 번에 얼마나 확대/축소할지 — 기본 대비 3배 (수정 1) */
const ZOOM_SPEED_MULTIPLIER = 3;
const ZOOM_STEP = 0.1;
/** 화면에 보이는 봉 개수 한계 */
const MIN_VISIBLE_BARS = 10;
const MAX_VISIBLE_BARS = 5000;

interface Props {
  candles: Candle[];
  livePrice: Price | null;
  activeTool?: DrawingToolType;
  onDrawingCountChange?: (count: number) => void;
  indicators?: IndicatorSeries | null;
  toggles?: IndicatorToggles;
}

export interface CandleChartHandle {
  clearDrawings: () => void;
  deleteSelectedDrawing: () => void;
  getElement: () => HTMLElement | null;
}

interface HoverInfo {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** 크로스헤어 위치의 이동평균 값 (범례용) */
  ma: Record<string, number | null>;
}

/** 자(Measure) 도구 드래그 중 표시하는 실시간 정보 */
interface MeasurePreview {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  startPrice: number;
  currentPrice: number;
  bars: number;
  days: number;
}

interface DrawingMenu {
  x: number;
  y: number;
  drawingId: string;
}

const toChartTime = (ms: number) => (ms / 1000) as UTCTimestamp;

const CandleChart = forwardRef<CandleChartHandle, Props>(function CandleChart(
  {
    candles,
    livePrice,
    activeTool = null,
    onDrawingCountChange,
    indicators = null,
    toggles,
  },
  ref,
) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const drawingsRef = useRef<DrawingManager | null>(null);
  const indicatorSeriesRef = useRef<ISeriesApi<'Line' | 'Histogram'>[]>([]);
  /** 범례에서 값을 읽기 위해 MA 시리즈를 따로 보관한다 */
  const maSeriesRef = useRef<Map<string, ISeriesApi<'Line'>>>(new Map());
  /** 크로스헤어 콜백에서 최신 캔들을 읽기 위한 참조 (effect 는 한 번만 돌기 때문) */
  const candlesRef = useRef<Candle[]>(candles);
  candlesRef.current = candles;

  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [measure, setMeasure] = useState<MeasurePreview | null>(null);
  const [menu, setMenu] = useState<DrawingMenu | null>(null);
  const [selectedAnchor, setSelectedAnchor] = useState<{ x: number; y: number; id: string } | null>(
    null,
  );

  const countCallbackRef = useRef(onDrawingCountChange);
  countCallbackRef.current = onDrawingCountChange;

  useImperativeHandle(ref, () => ({
    clearDrawings: () => {
      drawingsRef.current?.clearAll();
      setSelectedAnchor(null);
      setMenu(null);
    },
    deleteSelectedDrawing: () => {
      const selected = drawingsRef.current?.getSelectedDrawing();
      if (selected) drawingsRef.current?.removeDrawing(selected.id);
      setSelectedAnchor(null);
    },
    getElement: () => wrapperRef.current,
  }));

  // ── 차트 생성 (한 번만) ──────────────────────────────────────────────
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
      timeScale: { borderColor: COLORS.border, timeVisible: true, secondsVisible: false },
      crosshair: {
        mode: 0,
        vertLine: { color: COLORS.border, labelBackgroundColor: '#2A2A2A' },
        horzLine: { color: COLORS.border, labelBackgroundColor: '#2A2A2A' },
      },
      // 휠 줌은 마우스 위치 기준으로 직접 구현한다 (수정 2).
      handleScroll: { pressedMouseMove: false, mouseWheel: false, horzTouchDrag: true },
      handleScale: { axisPressedMouseMove: true, mouseWheel: false, pinch: true },
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
    candleSeries.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.08 } });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;

    const drawings = new DrawingManager();
    drawings.attach(chart, candleSeries, container);
    drawingsRef.current = drawings;

    const reportCount = () => countCallbackRef.current?.(drawings.getAllDrawings().length);
    const unsubscribers = [
      ...(['drawing:added', 'drawing:removed', 'drawing:cleared'] as const).map((event) =>
        drawings.on(event, reportCount),
      ),
      // 선택되면 첫 앵커 근처에 ✕ 버튼을 띄운다 (수정 3-B).
      drawings.on('drawing:selected', () => {
        const selected = drawings.getSelectedDrawing();
        setSelectedAnchor(selected ? anchorToScreen(selected) : null);
      }),
      drawings.on('drawing:deselected', () => setSelectedAnchor(null)),
    ];

    /** 드로잉의 첫 앵커를 화면 좌표로 변환 */
    const anchorToScreen = (drawing: IDrawing) => {
      const anchor = drawing.anchors[0];
      if (!anchor) return null;
      const x = chart.timeScale().timeToCoordinate(anchor.time);
      const y = candleSeries.priceToCoordinate(anchor.price);
      if (x === null || y === null) return null;
      return { x, y, id: drawing.id };
    };

    // ── 크로스헤어 → 레전드 (OHLCV + MA) ──
    chart.subscribeCrosshairMove((param) => {
      const candleData = param.seriesData.get(candleSeries) as CandlestickData | undefined;
      if (!param.time || !candleData) {
        setHover(null);
        return;
      }

      const ma: Record<string, number | null> = {};
      for (const [key, series] of maSeriesRef.current) {
        const point = param.seriesData.get(series) as { value?: number } | undefined;
        ma[key] = point?.value ?? null;
      }

      // 거래량은 캔들 배열에서 같은 시각을 찾아 채운다.
      const timeMs = (param.time as number) * 1000;
      const matched = candlesRef.current.find((c) => c.timestamp === timeMs);

      setHover({
        time: timeMs,
        open: candleData.open,
        high: candleData.high,
        low: candleData.low,
        close: candleData.close,
        volume: matched?.volume ?? 0,
        ma,
      });
    });

    // ── 마우스 위치 기준 휠 줌 (수정 1·2) ──
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();

      const timeScale = chart.timeScale();
      const range = timeScale.getVisibleLogicalRange();
      if (!range) return;

      const rect = container.getBoundingClientRect();
      // 커서 아래의 봉(logical index)을 기준점으로 삼아 그 지점이 고정되게 한다.
      const anchor = timeScale.coordinateToLogical(e.clientX - rect.left);
      if (anchor === null) return;

      // 마우스 휠은 deltaY 가 100 이상, 트랙패드는 한 자릿수로 잘게 들어온다.
      // 크기에 비례시키면 두 입력이 모두 자연스럽고, 트랙패드 관성 스크롤도 폭주하지 않는다.
      const intensity = Math.min(1, Math.max(0.08, Math.abs(e.deltaY) / 100));
      const direction = e.deltaY > 0 ? 1 : -1;
      const factor = 1 + direction * ZOOM_STEP * ZOOM_SPEED_MULTIPLIER * intensity;

      const nextSpan = (range.to - range.from) * factor;
      if (nextSpan < MIN_VISIBLE_BARS || nextSpan > MAX_VISIBLE_BARS) return;

      timeScale.setVisibleLogicalRange({
        from: anchor - (anchor - range.from) * factor,
        to: anchor + (range.to - anchor) * factor,
      });
    };
    container.addEventListener('wheel', onWheel, { passive: false });

    // ── 드로잉 생성 ──
    const toAnchor = (e: MouseEvent): Anchor | null => {
      const rect = container.getBoundingClientRect();
      const time = chart.timeScale().coordinateToTime(e.clientX - rect.left);
      const price = candleSeries.coordinateToPrice(e.clientY - rect.top);
      if (time === null || price === null) return null;
      return { time, price };
    };

    const createDrawing = (type: string, anchors: Anchor[]) => {
      const registry = getToolRegistry();
      if (!registry.get(type)) return;

      const isMeasure = type === 'date-price-range';
      const isUp = anchors.length > 1 && anchors[1].price >= anchors[0].price;
      const color = isMeasure ? (isUp ? COLORS.bullish : COLORS.bearish) : COLORS.accent;

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
          labelColor: COLORS.label,
        },
        isMeasure
          ? ({ filled: true, showPercentage: true, showPrices: true } as DrawingOptions)
          : {},
      );

      if (drawing) drawings.addDrawing(drawing);
    };

    // ── 마우스: 팬 / 드로잉 / 자 프리뷰 ──
    let dragging = false;
    let lastX = 0;
    let drawStart: Anchor | null = null;
    let drawStartScreen: { x: number; y: number } | null = null;

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return; // 우클릭은 컨텍스트 메뉴가 처리
      setMenu(null);

      const tool = drawings.getActiveTool();
      if (tool) {
        const anchor = toAnchor(e);
        if (!anchor) return;
        const required = getToolRegistry().get(tool)?.requiredAnchors ?? 2;

        if (required <= 1) {
          createDrawing(tool, [anchor]);
        } else {
          const rect = container.getBoundingClientRect();
          drawStart = anchor;
          drawStartScreen = { x: e.clientX - rect.left, y: e.clientY - rect.top };
        }
        return;
      }

      if (drawings.getSelectedDrawing()) return;
      dragging = true;
      lastX = e.clientX;
    };

    const onMouseMove = (e: MouseEvent) => {
      // 자 도구 드래그 중이면 실시간 박스를 갱신한다 (수정 4).
      if (drawStart && drawStartScreen && drawings.getActiveTool() === 'date-price-range') {
        const rect = container.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const price = candleSeries.coordinateToPrice(y);
        const startLogical = chart.timeScale().coordinateToLogical(drawStartScreen.x);
        const nowLogical = chart.timeScale().coordinateToLogical(x);
        const time = chart.timeScale().coordinateToTime(x);

        if (price !== null) {
          setMeasure({
            startX: drawStartScreen.x,
            startY: drawStartScreen.y,
            currentX: x,
            currentY: y,
            startPrice: drawStart.price,
            currentPrice: price,
            bars:
              startLogical !== null && nowLogical !== null
                ? Math.abs(Math.round(nowLogical - startLogical))
                : 0,
            days:
              time !== null && typeof time === 'number' && typeof drawStart.time === 'number'
                ? Math.abs(Math.round((time - drawStart.time) / 86400))
                : 0,
          });
        }
        return;
      }

      if (!dragging) return;
      const dx = e.clientX - lastX;
      if (dx === 0) return;
      lastX = e.clientX;

      const timeScale = chart.timeScale();
      const range = timeScale.getVisibleLogicalRange();
      if (!range) return;

      // 드래그는 항상 좌우 이동(팬)이다 — 줌은 휠이 담당한다.
      const bars = dx / timeScale.options().barSpacing;
      timeScale.setVisibleLogicalRange({ from: range.from - bars, to: range.to - bars });
    };

    const onDrawEnd = (e: MouseEvent) => {
      const tool = drawings.getActiveTool();
      const start = drawStart;
      drawStart = null;
      drawStartScreen = null;
      setMeasure(null);

      if (!tool || !start) return;

      const end = toAnchor(e);
      if (!end || (end.time === start.time && end.price === start.price)) return;

      createDrawing(tool, [start, end]);
    };

    const stopDrag = () => {
      dragging = false;
    };

    // ── 우클릭 삭제 메뉴 (수정 3-A) ──
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      const rect = container.getBoundingClientRect();
      const point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const hit = drawings.hitTest(point);

      if (hit) {
        drawings.selectDrawing(hit.id);
        setMenu({ x: point.x, y: point.y, drawingId: hit.id });
      } else {
        setMenu(null);
      }
    };

    container.addEventListener('mousedown', onMouseDown);
    container.addEventListener('mouseup', onDrawEnd);
    container.addEventListener('contextmenu', onContextMenu);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', stopDrag);

    return () => {
      container.removeEventListener('mousedown', onMouseDown);
      container.removeEventListener('mouseup', onDrawEnd);
      container.removeEventListener('contextmenu', onContextMenu);
      container.removeEventListener('wheel', onWheel);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', stopDrag);
      for (const unsubscribe of unsubscribers) unsubscribe();
      drawings.detach();
      drawingsRef.current = null;
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      indicatorSeriesRef.current = [];
      maSeriesRef.current.clear();
      setMenu(null);
      setSelectedAnchor(null);
    };
  }, []);

  // ── 도구 선택 반영 ──
  useEffect(() => {
    const drawings = drawingsRef.current;
    if (!drawings) return;
    drawings.setActiveTool(activeTool);
    if (!activeTool) drawings.deselectAll();
    setMenu(null);
  }, [activeTool]);

  // ── 지표 · 거래량 렌더링 ──
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    for (const series of indicatorSeriesRef.current) chart.removeSeries(series);
    indicatorSeriesRef.current = [];
    maSeriesRef.current.clear();

    if (!toggles) return;

    const addLine = (
      line: IndicatorLine | undefined,
      color: string,
      options: { paneIndex?: number; title?: string; maKey?: string } = {},
    ) => {
      if (!line?.length || !indicators) return;
      const series = chart.addSeries(
        LineSeries,
        {
          color,
          lineWidth: 1,
          priceLineVisible: false,
          lastValueVisible: false,
          // 스크롤할 때 선 위에 점이 찍히면 시선을 뺏고 값 판독을 방해한다.
          crosshairMarkerVisible: false,
          pointMarkersVisible: false,
          title: options.title,
        },
        options.paneIndex ?? 0,
      );
      series.setData(
        indicators.timestamps
          .map((ts, i) => ({ time: toChartTime(ts), value: line[i] }))
          .filter((p): p is { time: UTCTimestamp; value: number } => p.value != null),
      );
      indicatorSeriesRef.current.push(series);
      if (options.maKey) maSeriesRef.current.set(options.maKey, series);
    };

    // 가격 차트 오버레이
    for (const ma of MA_LINES) {
      if (toggles.overlays[ma.key]) {
        addLine(indicators?.[ma.series], ma.color, { title: ma.label, maKey: ma.label });
      }
    }
    if (toggles.overlays.ema) {
      addLine(indicators?.ema12, INDICATOR_COLORS.ema12, { title: 'EMA12' });
      addLine(indicators?.ema26, INDICATOR_COLORS.ema26, { title: 'EMA26' });
    }
    if (toggles.overlays.bb) {
      addLine(indicators?.bbUpper, INDICATOR_COLORS.bb, { title: 'BB' });
      addLine(indicators?.bbMiddle, INDICATOR_COLORS.bb);
      addLine(indicators?.bbLower, INDICATOR_COLORS.bb);
    }
    if (toggles.overlays.vwap) {
      addLine(indicators?.vwap, INDICATOR_COLORS.vwap, { title: 'VWAP' });
    }

    // 별도 패널 — 켜진 순서대로 pane 1, 2, 3…
    let pane = 1;

    if (toggles.panels.volume && candles.length) {
      const volume = chart.addSeries(
        HistogramSeries,
        { priceFormat: { type: 'volume' }, priceLineVisible: false, lastValueVisible: false },
        pane,
      );
      volume.setData(
        candles.map((c) => ({
          time: toChartTime(c.timestamp),
          value: c.volume,
          color: c.close >= c.open ? `${COLORS.bullish}66` : `${COLORS.bearish}66`,
        })),
      );
      indicatorSeriesRef.current.push(volume);
      pane += 1;
    }

    if (toggles.panels.rsi) {
      addLine(indicators?.rsi14, INDICATOR_COLORS.rsi, { paneIndex: pane, title: 'RSI(14)' });
      pane += 1;
    }

    if (toggles.panels.macd && indicators) {
      addLine(indicators.macd, INDICATOR_COLORS.macd, { paneIndex: pane, title: 'MACD' });
      addLine(indicators.macdSignal, INDICATOR_COLORS.macdSignal, { paneIndex: pane });

      const histogram = chart.addSeries(
        HistogramSeries,
        { priceLineVisible: false, lastValueVisible: false },
        pane,
      );
      histogram.setData(
        indicators.timestamps
          .map((ts, i) => ({ time: toChartTime(ts), value: indicators.macdHistogram[i] }))
          .filter((p): p is { time: UTCTimestamp; value: number } => p.value != null)
          .map((p) => ({
            ...p,
            color: p.value >= 0 ? `${COLORS.bullish}99` : `${COLORS.bearish}99`,
          })),
      );
      indicatorSeriesRef.current.push(histogram);
      pane += 1;
    }

    if (toggles.panels.stoch) {
      addLine(indicators?.stochK, INDICATOR_COLORS.stochK, { paneIndex: pane, title: 'Stoch %K' });
      addLine(indicators?.stochD, INDICATOR_COLORS.stochD, { paneIndex: pane });
      pane += 1;
    }

    if (toggles.panels.atr) {
      addLine(indicators?.atr14, INDICATOR_COLORS.atr, { paneIndex: pane, title: 'ATR(14)' });
      pane += 1;
    }

    if (toggles.panels.obv) {
      addLine(indicators?.obv, INDICATOR_COLORS.obv, { paneIndex: pane, title: 'OBV' });
      pane += 1;
    }

    // 빈 pane 정리 후 높이 비율 배분
    const panes = chart.panes();
    for (let i = panes.length - 1; i >= pane; i--) {
      if (panes[i].getSeries().length === 0) chart.removePane(i);
    }

    const remaining = chart.panes();
    remaining[0]?.setStretchFactor(6);
    for (let i = 1; i < remaining.length; i++) remaining[i].setStretchFactor(1.6);
  }, [indicators, toggles, candles]);

  // ── 캔들 데이터 ──
  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    if (!candleSeries || !candles.length) return;

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
    chartRef.current?.timeScale().fitContent();
  }, [candles]);

  // ── 현재가로 마지막 캔들 갱신 ──
  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    const last = candles.at(-1);
    if (!candleSeries || !last || !livePrice || !Number.isFinite(livePrice.close)) return;
    if (Math.abs(livePrice.close - last.close) / last.close > 0.2) return;

    candleSeries.update({
      time: toChartTime(last.timestamp),
      open: last.open,
      high: Math.max(last.high, livePrice.close),
      low: Math.min(last.low, livePrice.close),
      close: livePrice.close,
    });
  }, [livePrice, candles]);

  // 크로스헤어가 없을 때는 마지막 봉 값을 보여 준다 (빈 칸보다 유용하다).
  const legend = hover ?? lastAsHover(candles, indicators);
  const measureInfo = measure ? describeMeasure(measure) : null;

  return (
    <div ref={wrapperRef} className="relative h-full w-full bg-bg-primary">
      {/* 좌상단 레전드 — OHLCV + 이동평균 (수정 6-A) */}
      {legend && (
        <div className="pointer-events-none absolute left-3 top-2 z-10 flex flex-col gap-0.5">
          {/* 캔들 OHLC — 종가는 시가 대비 등락 색으로 표시한다 */}
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 rounded-md bg-bg-secondary/85 px-2.5 py-1 text-[11px] backdrop-blur-sm">
            <span className="text-text-muted">
              {new Date(legend.time).toLocaleString('ko-KR', {
                year: '2-digit',
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </span>
            <span className="text-text-muted">
              시 <span className="tabular-nums text-text-primary">{legend.open.toFixed(2)}</span>
            </span>
            <span className="text-text-muted">
              고 <span className="tabular-nums text-bullish">{legend.high.toFixed(2)}</span>
            </span>
            <span className="text-text-muted">
              저 <span className="tabular-nums text-bearish">{legend.low.toFixed(2)}</span>
            </span>
            <span className="text-text-muted">
              종{' '}
              <span
                className={`font-medium tabular-nums ${
                  legend.close >= legend.open ? 'text-bullish' : 'text-bearish'
                }`}
              >
                {legend.close.toFixed(2)}
              </span>
            </span>
            <span className="text-text-muted">
              거래량{' '}
              <span className="tabular-nums text-text-secondary">
                {legend.volume > 0
                  ? Intl.NumberFormat('ko-KR', { notation: 'compact' }).format(legend.volume)
                  : '—'}
              </span>
            </span>
          </div>

          {toggles && MA_LINES.some((ma) => toggles.overlays[ma.key]) && (
            <div className="flex flex-wrap gap-x-3 rounded-md bg-bg-secondary/85 px-2.5 py-1 text-[11px] backdrop-blur-sm">
              {MA_LINES.filter((ma) => toggles.overlays[ma.key]).map((ma) => {
                const value = legend.ma?.[ma.label];
                return (
                  <span key={ma.key} style={{ color: ma.color }}>
                    {ma.label}{' '}
                    <span className="tabular-nums">{value != null ? value.toFixed(2) : '—'}</span>
                  </span>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 자 도구 실시간 박스 (수정 4) */}
      {measure && measureInfo && (
        <div
          className="pointer-events-none absolute z-20 border-2"
          style={{
            left: Math.min(measure.startX, measure.currentX),
            top: Math.min(measure.startY, measure.currentY),
            width: Math.abs(measure.currentX - measure.startX),
            height: Math.abs(measure.currentY - measure.startY),
            borderColor: measureInfo.isUp ? COLORS.bullish : COLORS.bearish,
            backgroundColor: `${measureInfo.isUp ? COLORS.bullish : COLORS.bearish}22`,
          }}
        >
          <div
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded px-2 py-1 text-center text-[11px] font-medium tabular-nums"
            style={{
              backgroundColor: COLORS.tooltipBg,
              color: measureInfo.isUp ? COLORS.bullish : COLORS.bearish,
            }}
          >
            <div>
              {measureInfo.sign}${measureInfo.diff}
            </div>
            <div>
              {measureInfo.sign}
              {measureInfo.percent}%
            </div>
            <div className="text-text-muted">
              {measure.bars}봉 · {measure.days}일
            </div>
          </div>
        </div>
      )}

      {/* 드로잉 선택 시 ✕ 버튼 (수정 3-B) */}
      {selectedAnchor && (
        <button
          type="button"
          onClick={() => {
            drawingsRef.current?.removeDrawing(selectedAnchor.id);
            setSelectedAnchor(null);
          }}
          title="이 드로잉 삭제"
          className="absolute z-20 flex h-5 w-5 items-center justify-center rounded-full bg-bearish text-[11px] font-bold text-white shadow-lg transition-transform hover:scale-110"
          style={{ left: selectedAnchor.x - 10, top: selectedAnchor.y - 24 }}
        >
          ✕
        </button>
      )}

      {/* 우클릭 컨텍스트 메뉴 (수정 3-A) */}
      {menu && (
        <div
          className="absolute z-30 min-w-[110px] overflow-hidden rounded-md border border-border bg-bg-secondary shadow-xl"
          style={{ left: menu.x, top: menu.y }}
        >
          <button
            type="button"
            onClick={() => {
              drawingsRef.current?.removeDrawing(menu.drawingId);
              setMenu(null);
              setSelectedAnchor(null);
            }}
            className="block w-full px-3 py-1.5 text-left text-xs text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-bearish"
          >
            삭제
          </button>
          <button
            type="button"
            onClick={() => {
              drawingsRef.current?.clearAll();
              setMenu(null);
              setSelectedAnchor(null);
            }}
            className="block w-full px-3 py-1.5 text-left text-xs text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary"
          >
            모두 지우기
          </button>
          <button
            type="button"
            onClick={() => setMenu(null)}
            className="block w-full border-t border-border px-3 py-1.5 text-left text-xs text-text-muted transition-colors hover:bg-bg-tertiary"
          >
            취소
          </button>
        </div>
      )}

      <div
        ref={containerRef}
        className={`h-full w-full ${activeTool ? 'cursor-crosshair' : 'cursor-default'}`}
      />
    </div>
  );
});

function lastAsHover(candles: Candle[], indicators: IndicatorSeries | null): HoverInfo | null {
  const last = candles.at(-1);
  if (!last) return null;

  // 각 이동평균의 마지막 유효 값 (워밍업 구간의 null 은 건너뛴다)
  const ma: Record<string, number | null> = {};
  if (indicators) {
    for (const line of MA_LINES) {
      const series = indicators[line.series];
      ma[line.label] = series?.filter((v): v is number => v != null).at(-1) ?? null;
    }
  }

  return {
    time: last.timestamp,
    open: last.open,
    high: last.high,
    low: last.low,
    close: last.close,
    volume: last.volume,
    ma,
  };
}

function describeMeasure(measure: MeasurePreview) {
  const diff = measure.currentPrice - measure.startPrice;
  const percent = measure.startPrice ? (diff / measure.startPrice) * 100 : 0;
  return {
    isUp: diff >= 0,
    sign: diff >= 0 ? '+' : '-',
    diff: Math.abs(diff).toFixed(2),
    percent: Math.abs(percent).toFixed(2),
  };
}

export default CandleChart;
