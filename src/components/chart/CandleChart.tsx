import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  DrawingManager,
  getToolRegistry,
  type Anchor,
  type DrawingOptions,
  type DrawingStyle,
  type IDrawing,
} from 'lightweight-charts-drawing';
import {
  CandlestickSeries,
  createChart,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
} from 'lightweight-charts';
import type { Candle, Price } from '../../types/toss';
import { MA_LINES, type IndicatorSeries, type IndicatorToggles } from '../../types/chart';
import { cursorFor, type DrawingToolType } from './DrawingTools';
import {
  BASE_CHART_OPTIONS,
  CANDLE_SERIES_OPTIONS,
  COLORS,
  renderIndicators,
  toChartTime,
} from './chartTheme';

/**
 * 좌상단 레전드는 배경 없이 캔들 위에 바로 얹는다 (수정 1).
 * 불투명 배경이 있으면 확대·이동할 때 그 아래 봉을 볼 수 없다.
 * 대신 이중 텍스트 그림자로 밝은 캔들 위에서도 글자가 읽히게 한다.
 */
const LEGEND_TEXT_SHADOW = {
  textShadow: '0 0 4px rgba(0,0,0,0.8), 0 0 8px rgba(0,0,0,0.6)',
} as const;

/** 휠 한 번에 얼마나 확대/축소할지 — 기본 대비 3배 (수정 1) */
const ZOOM_SPEED_MULTIPLIER = 3;
const ZOOM_STEP = 0.1;
/**
 * 드로잉 라벨용 폰트.
 *
 * 드로잉 플러그인의 텍스트 렌더러는 좌표에만 devicePixelRatio 를 곱하고 폰트 크기에는
 * 곱하지 않는다. 그래서 Retina(dpr 2)에서 글자가 의도한 절반 크기로 나온다.
 * 여기서 미리 dpr 을 곱해 화면상 크기를 맞춘다. (줌 배율과는 무관하다 — 라벨은 항상 같은 크기다.)
 */
function labelFont(sizePx: number, bold = false): string {
  const dpr = window.devicePixelRatio || 1;
  return `${bold ? 'bold ' : ''}${Math.round(sizePx * dpr)}px sans-serif`;
}

/** 드래그 팬 감도 — 1 이면 커서를 그대로 따라간다. 너무 빨라 절반으로 낮췄다. */
const PAN_SPEED = 0.5;
/** 화면에 보이는 봉 개수 한계 */
const MIN_VISIBLE_BARS = 10;
const MAX_VISIBLE_BARS = 5000;

interface Props {
  candles: Candle[];
  livePrice: Price | null;
  activeTool?: DrawingToolType;
  onDrawingCountChange?: (count: number) => void;
  /**
   * 하나 그리고 나면 호출 — 툴바를 커서 모드로 되돌린다.
   * 도구를 계속 쥐고 있으면 그린 선을 지우려고 클릭했을 때 새 선이 그려진다.
   */
  onToolConsumed?: () => void;
  /** 차트를 과거로 스크롤했을 때 이어 받기 */
  onReachPast?: () => void;
  indicators?: IndicatorSeries | null;
  toggles?: IndicatorToggles;
}

export interface CandleChartHandle {
  clearDrawings: () => void;
  deleteSelectedDrawing: () => void;
  getElement: () => HTMLElement | null;
  /** 캡처 팝업이 같은 구간에서 시작하도록 현재 보이는 범위를 넘겨 준다 */
  getVisibleRange: () => { from: number; to: number } | null;
  /** 캡처 팝업 차트에 같은 드로잉을 복제하기 위한 스냅샷 */
  getDrawings: () => DrawingSnapshot[];
}

/** 캡처 팝업 차트로 옮겨 그릴 드로잉 한 개 (수정 3) */
export interface DrawingSnapshot {
  type: string;
  anchors: Anchor[];
  style: Partial<DrawingStyle>;
  options: Partial<DrawingOptions>;
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

const CandleChart = forwardRef<CandleChartHandle, Props>(function CandleChart(
  {
    candles,
    livePrice,
    activeTool = null,
    onDrawingCountChange,
    onToolConsumed,
    onReachPast,
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
  /** 직전에 그린 캔들 수 — 과거가 앞에 덧붙었는지 판단한다 */
  const renderedCountRef = useRef(0);

  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [measure, setMeasure] = useState<MeasurePreview | null>(null);
  /**
   * 2점 도구에서 시작점만 찍은 상태. 표시가 없으면 클릭이 먹혔는지 알 수 없어
   * 시작점 마커와 커서까지의 고무줄 선을 그린다.
   */
  const [pending, setPending] = useState<{
    x: number;
    y: number;
    curX: number;
    curY: number;
    /** 시작점 대비 등락률 — 긋는 동안 바로 보이게 한다 */
    percent: number | null;
  } | null>(null);
  const [menu, setMenu] = useState<DrawingMenu | null>(null);
  const [selectedAnchor, setSelectedAnchor] = useState<{ x: number; y: number; id: string } | null>(
    null,
  );

  const countCallbackRef = useRef(onDrawingCountChange);
  countCallbackRef.current = onDrawingCountChange;
  const onReachPastRef = useRef(onReachPast);
  onReachPastRef.current = onReachPast;
  const cancelPendingRef = useRef<(() => void) | null>(null);
  const onToolConsumedRef = useRef(onToolConsumed);
  onToolConsumedRef.current = onToolConsumed;

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
    getVisibleRange: () => {
      const range = chartRef.current?.timeScale().getVisibleLogicalRange();
      return range ? { from: range.from, to: range.to } : null;
    },
    getDrawings: () =>
      (drawingsRef.current?.getAllDrawings() ?? []).map((d) => ({
        type: d.type,
        anchors: d.anchors,
        style: d.style,
        options: d.options,
      })),
  }));

  // ── 차트 생성 (한 번만) ──────────────────────────────────────────────
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      ...BASE_CHART_OPTIONS,
      // 휠 줌은 마우스 위치 기준으로 직접 구현한다 (수정 2).
      handleScroll: { pressedMouseMove: false, mouseWheel: false, horzTouchDrag: true },
      handleScale: { axisPressedMouseMove: true, mouseWheel: false, pinch: true },
      autoSize: true,
    });

    const candleSeries = chart.addSeries(CandlestickSeries, CANDLE_SERIES_OPTIONS);
    candleSeries.priceScale().applyOptions({ scaleMargins: { top: 0.08, bottom: 0.08 } });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;

    const drawings = new DrawingManager();
    drawings.attach(chart, candleSeries, container);
    drawingsRef.current = drawings;

    const reportCount = () => countCallbackRef.current?.(drawings.getAllDrawings().length);

    /**
     * 마지막으로 누른 지점. 삭제 버튼을 여기에 띄운다 —
     * 자 도구처럼 넓은 도형은 첫 앵커가 멀리 있어서, 누른 자리에 버튼이 뜨는 편이 훨씬 가깝다.
     */
    let lastPointer: { x: number; y: number } | null = null;

    const unsubscribers = [
      ...(['drawing:added', 'drawing:removed', 'drawing:cleared'] as const).map((event) =>
        drawings.on(event, reportCount),
      ),
      // 선택되면 첫 앵커 근처에 ✕ 버튼을 띄운다 (수정 3-B).
      drawings.on('drawing:selected', () => {
        const selected = drawings.getSelectedDrawing();
        if (!selected) return setSelectedAnchor(null);
        setSelectedAnchor(
          lastPointer
            ? { x: lastPointer.x, y: lastPointer.y, id: selected.id }
            : anchorToScreen(selected),
        );
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

    // ── 과거 데이터 이어 받기 ──
    // 남은 봉이 얼마 없을 때 미리 요청해 두면 스크롤이 끊기지 않는다.
    chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (!range) return;
      if (range.from < 20) onReachPastRef.current?.();
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
    /**
     * 클릭 좌표를 앵커로. 마지막 봉 오른쪽 빈 공간에서는 `coordinateToTime` 이 null 을 주는데,
     * 여기서 포기하면 그 영역 클릭이 전부 무시된다 — 확대해서 볼수록 빈 공간이 넓어지므로
     * "도구가 아예 동작하지 않는" 것처럼 보인다. 시간축 밖이면 가장 가까운 봉의 시간을 쓴다.
     * (수평선은 시간이 의미 없고, 추세선도 끝점이 마지막 봉에 붙는 편이 자연스럽다.)
     */
    const toAnchor = (e: MouseEvent): Anchor | null => {
      const rect = container.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const price = candleSeries.coordinateToPrice(e.clientY - rect.top);
      if (price === null) return null;

      const time = chart.timeScale().coordinateToTime(x);
      if (time !== null) return { time, price };

      const data = candleSeries.data();
      if (!data.length) return null;
      const logical = chart.timeScale().coordinateToLogical(x);
      const index =
        logical === null
          ? data.length - 1
          : Math.min(data.length - 1, Math.max(0, Math.round(logical)));
      return { time: data[index].time, price };
    };

    /** 실제로 그려졌는지 돌려준다 — 실패했는데 도구까지 풀리면 사용자는 원인을 알 수 없다. */
    const createDrawing = (type: string, anchors: Anchor[]): boolean => {
      const registry = getToolRegistry();
      if (!registry.get(type)) return false;

      const isMeasure = type === 'date-price-range';
      const isTrend = type === 'trend-line';
      const isUp = anchors.length > 1 && anchors[1].price >= anchors[0].price;
      // 자·추세선은 방향이 정보다 — 상승/하락 색을 준다. 나머지는 액센트 색.
      const color = isMeasure || isTrend ? (isUp ? COLORS.bullish : COLORS.bearish) : COLORS.accent;

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
          // 추세선 라벨은 등락률이라 색으로도 방향을 읽게 한다.
          labelColor: isTrend ? color : COLORS.label,
          labelFont: labelFont(isTrend ? 13 : 12, isTrend),
        },
        isMeasure
          ? ({ filled: true, showPercentage: true, showPrices: true } as DrawingOptions)
          : isTrend
            ? // 라이브러리 기본값은 전부 꺼져 있어 선만 남는다. 등락률·등락폭을 켠다.
              ({ showPercentChange: true, showPriceChange: true } as DrawingOptions)
            : {},
      );

      if (!drawing) return false;
      drawings.addDrawing(drawing);
      return true;
    };

    // ── 마우스: 팬 / 드로잉 / 자 프리뷰 ──
    let dragging = false;
    let lastX = 0;
    let drawStart: Anchor | null = null;
    let drawStartScreen: { x: number; y: number } | null = null;

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return; // 우클릭은 컨텍스트 메뉴가 처리
      setMenu(null);

      const rect0 = container.getBoundingClientRect();
      lastPointer = { x: e.clientX - rect0.left, y: e.clientY - rect0.top };

      const tool = drawings.getActiveTool();
      if (tool) {
        const anchor = toAnchor(e);
        if (!anchor) return;
        const required = getToolRegistry().get(tool)?.requiredAnchors ?? 2;

        if (required <= 1) {
          if (createDrawing(tool, [anchor])) onToolConsumedRef.current?.();
        } else if (!drawStart) {
          // 이미 시작점을 찍어 둔 상태면 덮어쓰지 않는다 — 클릭·클릭으로 긋는 경우다.
          const rect = container.getBoundingClientRect();
          const x = e.clientX - rect.left;
          const y = e.clientY - rect.top;
          drawStart = anchor;
          drawStartScreen = { x, y };
          setPending({ x, y, curX: x, curY: y, percent: null });
        }
        return;
      }

      // 도구를 놓았으면 대기 중이던 시작점도 버린다.
      drawStart = null;
      drawStartScreen = null;
      setPending(null);

      if (drawings.getSelectedDrawing()) return;
      dragging = true;
      lastX = e.clientX;
    };

    const onMouseMove = (e: MouseEvent) => {
      // 시작점을 찍어 둔 동안에는 커서까지 고무줄 선을 따라오게 한다.
      if (drawStartScreen && drawStart) {
        const rect = container.getBoundingClientRect();
        const curY = e.clientY - rect.top;
        const price = candleSeries.coordinateToPrice(curY);
        setPending({
          x: drawStartScreen.x,
          y: drawStartScreen.y,
          curX: e.clientX - rect.left,
          curY,
          percent:
            price !== null && drawStart.price
              ? ((price - drawStart.price) / drawStart.price) * 100
              : null,
        });
      }

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
      const bars = (dx / timeScale.options().barSpacing) * PAN_SPEED;
      timeScale.setVisibleLogicalRange({ from: range.from - bars, to: range.to - bars });
    };

    const onDrawEnd = (e: MouseEvent) => {
      const tool = drawings.getActiveTool();
      const start = drawStart;
      if (!tool || !start) {
        drawStart = null;
        drawStartScreen = null;
        setMeasure(null);
        setPending(null);
        return;
      }

      const end = toAnchor(e);
      // 같은 자리에서 뗐다 = 아직 시작점만 찍은 것. 시작점을 남겨 두 번째 클릭을 기다린다.
      if (!end || (end.time === start.time && end.price === start.price)) return;

      drawStart = null;
      drawStartScreen = null;
      setMeasure(null);
      setPending(null);

      if (createDrawing(tool, [start, end])) onToolConsumedRef.current?.();
    };

    const stopDrag = () => {
      dragging = false;
    };

    // 도구를 바꾸거나 놓을 때 찍어 둔 시작점을 버린다 (effect 밖에서 호출한다).
    cancelPendingRef.current = () => {
      drawStart = null;
      drawStartScreen = null;
      setPending(null);
      setMeasure(null);
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
    cancelPendingRef.current?.();
    setMenu(null);
  }, [activeTool]);

  // ── 지표 · 거래량 렌더링 (렌더 로직은 chartTheme 에 모아 캡처 팝업과 공유한다) ──
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    for (const series of indicatorSeriesRef.current) chart.removeSeries(series);
    const rendered = renderIndicators(chart, candles, indicators, toggles);
    indicatorSeriesRef.current = rendered.series;
    maSeriesRef.current = rendered.maSeries;
  }, [indicators, toggles, candles]);

  // ── 캔들 데이터 ──
  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    if (!candleSeries || !candles.length) return;

    const chart = chartRef.current;
    // 앞쪽에 과거가 덧붙은 경우, 보던 위치를 그대로 유지해야 화면이 튀지 않는다.
    const previousCount = renderedCountRef.current;
    const isPrepend = previousCount > 0 && candles.length > previousCount;
    const range = isPrepend ? chart?.timeScale().getVisibleLogicalRange() : null;

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

    if (range) {
      const added = candles.length - previousCount;
      chart?.timeScale().setVisibleLogicalRange({
        from: range.from + added,
        to: range.to + added,
      });
    } else {
      chart?.timeScale().fitContent();
    }

    renderedCountRef.current = candles.length;
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
        <div
          className="pointer-events-none absolute left-3 top-2 z-10 flex flex-col gap-0.5"
          style={LEGEND_TEXT_SHADOW}
        >
          {/* 캔들 OHLC — 종가는 시가 대비 등락 색으로 표시한다 */}
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 bg-transparent px-0.5 py-0.5 text-[11px]">
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
            <div className="flex flex-wrap gap-x-3 bg-transparent px-0.5 py-0.5 text-[11px]">
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

      {/* 2점 도구: 찍어 둔 시작점 + 커서까지의 고무줄 선 */}
      {pending && (
        <svg className="pointer-events-none absolute inset-0 z-20 h-full w-full">
          {!measure && (
            <line
              x1={pending.x}
              y1={pending.y}
              x2={pending.curX}
              y2={pending.curY}
              stroke={COLORS.accent}
              strokeWidth={1.5}
              strokeDasharray="5 4"
              opacity={0.9}
            />
          )}
          <circle cx={pending.x} cy={pending.y} r={7} fill={COLORS.accent} opacity={0.25} />
          <circle
            cx={pending.x}
            cy={pending.y}
            r={3.5}
            fill={COLORS.accent}
            stroke="#FFFFFF"
            strokeWidth={1.5}
          />
          {!measure && pending.percent !== null && (
            <text
              x={pending.curX + 10}
              y={pending.curY - 8}
              fill={pending.percent >= 0 ? COLORS.bullish : COLORS.bearish}
              fontSize={12}
              fontWeight={600}
            >
              {pending.percent >= 0 ? '+' : ''}
              {pending.percent.toFixed(2)}%
            </text>
          )}
        </svg>
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
          title="이 드로잉 삭제 (Delete)"
          className="absolute z-20 flex items-center gap-1 rounded-full bg-bearish px-2.5 py-1 text-[11px] font-bold text-white shadow-lg transition-transform hover:scale-105"
          style={{ left: selectedAnchor.x - 24, top: selectedAnchor.y - 30 }}
        >
          ✕ 삭제
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

      <div ref={containerRef} className="h-full w-full" style={{ cursor: cursorFor(activeTool) }} />
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
