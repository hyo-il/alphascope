import { formatSigned } from '../../utils/formatters';
import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { modal } from '../../store/uiStore';
import {
  DrawingManager,
  getToolRegistry,
  type Anchor,
  type DrawingOptions,
  type DrawingStyle,
} from 'lightweight-charts-drawing';
import {
  CandlestickSeries,
  createChart,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
} from 'lightweight-charts';
import type { Candle, Price } from '../../types/toss';
import type { IndicatorSeries, IndicatorToggles } from '../../types/chart';
import ChartInfoBar, { lastAsHover, type HoverInfo, type VisibleExtent } from './ChartInfoBar';
import type { RangeStats } from '../../hooks/useRangeStats';
import { liveCandle } from '../../utils/liveCandle';
import { cursorFor, type DrawingToolType } from './DrawingTools';
import {
  chartTimeCoords,
  measureLines,
  MEASURE_INFO_GAP,
  prepareDrawing,
  shapeTopOf,
  withBarTime,
  withShapeHit,
  type ChartTimeCoords,
} from './drawingSupport';
import {
  BASE_CHART_OPTIONS,
  drawExtremeMarkers,
  extentOf,
  fitCandleScale,
  dateTimeOptions,
  isIntraday,
  CANDLE_SERIES_OPTIONS,
  priceFormatOf,
  COLORS,
  renderIndicators,
  toChartTime,
} from './chartTheme';

/**
 * 좌상단 레전드는 배경 없이 캔들 위에 바로 얹는다 (수정 1).
 * 불투명 배경이 있으면 확대·이동할 때 그 아래 봉을 볼 수 없다.
 * 대신 이중 텍스트 그림자로 밝은 캔들 위에서도 글자가 읽히게 한다.
 */
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
  /**
   * 지금 `candles` 가 어느 종목·봉의 것인지 — 예: `AAPL|1d`.
   * 종목·봉을 바꿔도 차트를 **다시 만들지 않고** 이 키가 바뀐 첫 데이터에서 초기화한다:
   * 드로잉 지우기(드로잉은 종목별) · 확대·위치를 기본으로 · 가격 축 자동 · 마우스 상태 비우기.
   * 로딩 중에는 App 이 이전 키를 그대로 넘긴다(아직 이전 종목 캔들이 들어 있다).
   */
  datasetKey?: string;
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
  /** 52주 고저 — 정보 바의 "고점 대비" 에 쓴다 */
  week52?: RangeStats | null;
  /** 마커의 가격 표기용 (국내 종목은 원화) */
  currency?: 'KRW' | 'USD';
}

export interface CandleChartHandle {
  clearDrawings: () => void;
  deleteSelectedDrawing: () => void;
  getElement: () => HTMLElement | null;
  /** 캡처 팝업이 같은 구간에서 시작하도록 현재 보이는 범위를 넘겨 준다 */
  getVisibleRange: () => { from: number; to: number } | null;
  /** 캡처 팝업 차트에 같은 드로잉을 복제하기 위한 스냅샷 */
  getDrawings: () => DrawingSnapshot[];
  /** 확대·위치를 처음으로 — 종목을 바꿀 때와 같은 값([초기화]). 드로잉은 지우지 않는다 */
  resetView: () => void;
}

/** 캡처 팝업 차트로 옮겨 그릴 드로잉 한 개 (수정 3) */
export interface DrawingSnapshot {
  type: string;
  anchors: Anchor[];
  style: Partial<DrawingStyle>;
  options: Partial<DrawingOptions>;
}

/** 자(Measure) 도구 드래그 중 표시하는 실시간 정보 — 글은 그린 뒤 차트 위 글과 같은 함수(`measureLines`) */
interface MeasurePreview {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  info: ReturnType<typeof measureLines>;
}

interface DrawingMenu {
  x: number;
  y: number;
  drawingId: string;
}

const CandleChart = forwardRef<CandleChartHandle, Props>(function CandleChart(
  {
    candles,
    datasetKey,
    livePrice,
    activeTool = null,
    onDrawingCountChange,
    onToolConsumed,
    onReachPast,
    indicators = null,
    toggles,
    week52,
    currency = 'USD',
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
  /** 직전에 그린 데이터 묶음(종목|봉) — 바뀌면 덧붙이기가 아니라 새 데이터다 */
  const renderedKeyRef = useRef<string | undefined>(undefined);

  const [hover, setHover] = useState<HoverInfo | null>(null);
  /** 지금 화면에 보이는 구간의 고·저 — 줌·스크롤할 때마다 다시 잰다 */
  const [visibleExtent, setVisibleExtent] = useState<VisibleExtent | null>(null);
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
  const deleteButtonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const onReachPastRef = useRef(onReachPast);
  onReachPastRef.current = onReachPast;
  const cancelPendingRef = useRef<(() => void) | null>(null);
  const onToolConsumedRef = useRef(onToolConsumed);
  onToolConsumedRef.current = onToolConsumed;
  /** 자 정보 글의 통화 — 그린 뒤 글은 차트가 다시 그릴 때마다 읽는다 */
  const currencyRef = useRef(currency);
  currencyRef.current = currency;
  const measureInfoRef = useRef<HTMLDivElement>(null);

  /*
   * 드로잉 모두 지우기 — 도구줄 「전체 삭제」 와 우클릭 「모두 지우기」 가 같은 함수.
   * 2개 이상이면 확인 창(되돌릴 수 없다), 1개면 바로(개별 삭제와 같다), 0개면 아무 일도 하지 않는다.
   */
  const clearAllDrawings = () => {
    const manager = drawingsRef.current;
    setMenu(null);
    if (!manager) return;
    const count = manager.getAllDrawings().length;
    const run = () => {
      drawingsRef.current?.clearAll();
      setSelectedAnchor(null);
    };
    if (count === 0) return;
    if (count === 1) return run();
    modal.confirm({
      title: '차트 드로잉 모두 삭제',
      message: `이 종목 차트에 그린 ${count}개를 모두 삭제합니다. 되돌릴 수 없습니다.`,
      confirmText: '삭제',
      danger: true,
      onConfirm: run,
    });
  };

  /** 모든 칸(가격 · 거래량 · 지표)의 축을 자동 맞춤으로 — 축을 끌거나 휠로 늘린 배율을 푼다([초기화] · 종목 바뀜) */
  const autoScaleAllPanes = () => {
    for (const pane of chartRef.current?.panes() ?? []) {
      for (const series of pane.getSeries()) series.priceScale().applyOptions({ autoScale: true });
    }
  };

  useImperativeHandle(ref, () => ({
    clearDrawings: clearAllDrawings,
    resetView: () => {
      chartRef.current?.timeScale().resetTimeScale();
      autoScaleAllPanes();
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
    fitCandleScale(candleSeries, { extremes: true });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;

    /** 시간 ↔ 화면 x(빈 곳 포함) · 봉 수 — 드로잉 · 자 정보가 같이 쓴다 */
    const coords: ChartTimeCoords = chartTimeCoords(chart, candleSeries);
    // 시간 ↔ x 는 빈 곳 포함(withBarTime) · 누르기 판정은 상자 모양 안쪽 포함(withShapeHit)
    const drawings = withShapeHit(withBarTime(new DrawingManager(), coords));
    drawings.attach(chart, candleSeries, container);
    drawingsRef.current = drawings;
    // 시험(`chartview:test`)이 축 범위 · 시리즈 값 · 드로잉 수를 재는 손잡이(차트 칸 요소에 붙임 · 화면 · 동작에는 쓰지 않는다).
    // 개발 서버 · 시험에서만 — 운영 빌드에는 이 줄이 빠진다(`import.meta.env.DEV` = false → 빌드가 지움)
    if (import.meta.env.DEV) Object.assign(container, { __chartProbe: { chart, candleSeries, drawings } });

    const reportCount = () => countCallbackRef.current?.(drawings.getAllDrawings().length);

    /** 마지막으로 누른 지점 — 수평선의 「삭제」 버튼 가로 자리(선이 칸 끝에서 끝까지라 누른 x 위에 띄운다) */
    let lastPointer: { x: number; y: number } | null = null;

    /** 고른 그림의 「삭제」 버튼 자리 = 모양 위쪽 가장자리(133차) — 고를 때 · 확대 · 이동 · 끝점을 끌 때 다시 잰다 */
    const placeDeleteButton = () => {
      const selected = drawings.getSelectedDrawing();
      const top = selected ? shapeTopOf(selected, lastPointer?.x ?? null) : null;
      setSelectedAnchor(selected && top ? { x: top.x, y: top.y, id: selected.id } : null);
    };
    const unsubscribers = [
      ...(['drawing:added', 'drawing:removed', 'drawing:cleared'] as const).map((event) =>
        drawings.on(event, reportCount),
      ),
      // 지우거나 선택이 풀리면 메뉴도 닫는다(Delete 키로 지운 뒤 남은 메뉴가 없는 그림을 가리키지 않게).
      ...(['drawing:removed', 'drawing:cleared', 'drawing:deselected'] as const).map((event) =>
        drawings.on(event, () => setMenu(null)),
      ),
      // 고르면 모양 위에 「삭제」 버튼 (수정 3-B · 133차)
      drawings.on('drawing:selected', placeDeleteButton),
      drawings.on('drawing:updated', placeDeleteButton),
      drawings.on('drawing:deselected', () => setSelectedAnchor(null)),
      // 지운 그림이 선택돼 있었으면 deselected 가 먼저 오지만, 남은 버튼을 확실히 지운다.
      drawings.on('drawing:cleared', () => setSelectedAnchor(null)),
    ];

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
      // 구간 고·저는 여기서만 갱신한다 — 줌·스크롤·데이터 추가가 모두 이 이벤트를 거친다.
      setVisibleExtent(extentOf(candlesRef.current, range.from, range.to));
      // 고른 그림의 「삭제」 버튼이 모양을 따라간다(가격 축은 같은 프레임에 다시 맞춰지므로 다음 프레임에 잰다)
      if (drawings.getSelectedDrawing()) requestAnimationFrame(placeDeleteButton);
    });

    /** 마우스가 오른쪽 가격 축 위면 그 칸(pane) 번호 — 그림 영역 · 아래 시간 축 위면 null */
    const priceAxisPaneAt = (x: number, y: number): number | null => {
      if (x < chart.timeScale().width()) return null;
      const top = container.getBoundingClientRect().top;
      const index = chart.panes().findIndex((pane) => {
        const r = pane.getHTMLElement()?.getBoundingClientRect();
        return !!r && y >= r.top - top && y < r.bottom - top;
      });
      return index < 0 ? null : index;
    };

    /**
     * 가격 축 위 휠 = 그 칸의 세로 배율(축을 끌 때와 같은 결과) — 마우스 아래 가격이 제자리에 남는다.
     * 범위를 정하면 자동 맞춤이 꺼진다. 축 두 번 누르기 · [초기화] 로 돌아온다.
     * 칸에 시리즈가 없으면 아무 일도 하지 않는다.
     */
    const zoomPriceAxis = (paneIndex: number, y: number, factor: number) => {
      const pane = chart.panes()[paneIndex];
      const series = paneIndex === 0 ? candleSeries : pane?.getSeries()[0];
      const paneEl = pane?.getHTMLElement();
      if (!series || !paneEl) return;
      const scale = series.priceScale();
      const range = scale.getVisibleRange();
      const paneY = y - (paneEl.getBoundingClientRect().top - container.getBoundingClientRect().top);
      const anchor = series.coordinateToPrice(paneY);
      if (!range || anchor === null) return;
      scale.applyOptions({ autoScale: false });
      scale.setVisibleRange({
        from: anchor - (anchor - range.from) * factor,
        to: anchor + (range.to - anchor) * factor,
      });
    };

    // ── 마우스 위치 기준 휠 줌 (수정 1·2) — 가격 축 위면 세로, 그 밖(그림 영역 · 시간 축)은 가로 ──
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();

      const rect = container.getBoundingClientRect();
      // 마우스 휠은 deltaY 가 100 이상, 트랙패드는 한 자릿수로 잘게 들어온다.
      // 크기에 비례시키면 두 입력이 모두 자연스럽고, 트랙패드 관성 스크롤도 폭주하지 않는다.
      const intensity = Math.min(1, Math.max(0.08, Math.abs(e.deltaY) / 100));
      const direction = e.deltaY > 0 ? 1 : -1;
      const factor = 1 + direction * ZOOM_STEP * ZOOM_SPEED_MULTIPLIER * intensity;

      const axisPane = priceAxisPaneAt(e.clientX - rect.left, e.clientY - rect.top);
      if (axisPane !== null) return zoomPriceAxis(axisPane, e.clientY - rect.top, factor);

      const timeScale = chart.timeScale();
      const range = timeScale.getVisibleLogicalRange();
      if (!range) return;

      // 커서 아래의 봉(logical index)을 기준점으로 삼아 그 지점이 고정되게 한다.
      const anchor = timeScale.coordinateToLogical(e.clientX - rect.left);
      if (anchor === null) return;

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
     * 클릭 좌표를 앵커로. 마지막 봉 오른쪽 빈 곳도 **찍은 그 자리**(봉 간격으로 늘린 시간 — `chartTimeCoords`)로 남긴다.
     * 가장 가까운 봉으로 당기면 빈 곳에 그린 자 · 추세선의 두 점이 같은 봉이 되어 폭 0 · 「0봉 · 0일」 이 되고 누를 수도 없었다(133차).
     */
    const toAnchor = (e: MouseEvent): Anchor | null => {
      const rect = container.getBoundingClientRect();
      const price = candleSeries.coordinateToPrice(e.clientY - rect.top);
      const time = coords.coordinateToTime(e.clientX - rect.left);
      return price === null || time === null ? null : { time, price };
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
          ? // 정보 글(가격 차 · 등락률 · 봉 · 일)은 라이브러리 글을 끄고 앱이 그린다(`prepareDrawing`)
            ({ filled: true } as DrawingOptions)
          : isTrend
            ? // 라이브러리 기본값은 전부 꺼져 있어 선만 남는다. 등락률·등락폭을 켠다.
              ({ showPercentChange: true, showPriceChange: true } as DrawingOptions)
            : {},
      );

      if (!drawing) return false;
      drawings.addDrawing(prepareDrawing(drawing, coords, () => currencyRef.current));
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

      /*
       * 그림을 누르면 **누른 그 순간** 선택한다. 라이브러리 선택은 차트 click 을 기다리는데, 앞 클릭에서 0.5초 안의
       * 클릭은 차트가 두 번 누르기로 보고 click 을 내지 않는다 — 한 번 못 맞혀 곧바로 다시 누르면 선택이 끝내 되지 않아
       * 「삭제」 버튼이 뜨지 않았다(132차). 선택한 그림의 끝점을 끄는 것(라이브러리)은 그대로 둔다.
       */
      if (drawings.hitTestAnchor(lastPointer) !== null) return;
      const hit = drawings.hitTest(lastPointer);
      if (hit) return drawings.selectDrawing(hit.id);
      if (drawings.getSelectedDrawing()) return drawings.deselectAll();
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

      // 자 도구 드래그 중이면 실시간 박스 · 정보를 갱신한다 (수정 4) — 정보 글은 그린 뒤와 같은 함수
      if (drawStart && drawStartScreen && drawings.getActiveTool() === 'date-price-range') {
        const rect = container.getBoundingClientRect();
        const end = toAnchor(e);
        if (end) {
          setMeasure({
            startX: drawStartScreen.x,
            startY: drawStartScreen.y,
            currentX: e.clientX - rect.left,
            currentY: e.clientY - rect.top,
            info: measureLines(drawStart, end, coords, currencyRef.current),
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

    // ── 우클릭 삭제 메뉴 (수정 3-A) — 그림 위면 그것을 선택하고, 그림이 선택된 상태면 차트 아무 곳에서나 ──
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      const rect = container.getBoundingClientRect();
      const point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      lastPointer = point;
      const hit = drawings.hitTest(point);
      if (hit) drawings.selectDrawing(hit.id);
      const target = hit ?? drawings.getSelectedDrawing();
      setMenu(target ? { x: point.x, y: point.y, drawingId: target.id } : null);
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

  // 자 정보는 커서 오른쪽 — 차트 칸 오른쪽 끝에 닿으면 커서 왼쪽으로
  useLayoutEffect(() => {
    if (measure) placeBesideCursor(measureInfoRef.current, measure.currentX, measure.currentY);
  }, [measure]);
  // 「삭제」 버튼 · 메뉴는 차트 칸 안에 — 화면 끝에서 잘리면 안쪽으로 옮긴다(메뉴는 누른 자리 반대쪽으로 넘긴다).
  useLayoutEffect(() => {
    if (selectedAnchor) placeAboveShape(deleteButtonRef.current, selectedAnchor);
    fitInside(deleteButtonRef.current, false);
  }, [selectedAnchor]);
  useLayoutEffect(() => fitInside(menuRef.current, true), [menu]);

  // 메뉴는 Esc · 바깥 누르기 · 휠 · 스크롤에 닫는다.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    const onDown = (e: MouseEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) close();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onDown, true);
    window.addEventListener('wheel', close, { capture: true, passive: true });
    window.addEventListener('scroll', close, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onDown, true);
      window.removeEventListener('wheel', close, { capture: true });
      window.removeEventListener('scroll', close, true);
    };
  }, [menu]);

  // 가격 자릿수는 통화로 — 원화는 소수점 없이 (`priceFormatOf` 한 곳)
  useEffect(() => {
    candleSeriesRef.current?.applyOptions({ priceFormat: priceFormatOf(currency) });
  }, [currency]);

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
    // 날짜 형식은 봉 간격에 따라 다르다 (분봉은 시각까지). 캔들이 바뀔 때 함께 맞춘다.
    chart?.applyOptions(dateTimeOptions(isIntraday(candles)));

    /*
     * 종목·봉이 바뀐 첫 데이터 — 차트를 언마운트하지 않으므로
     * 여기서 처음 상태로 되돌린다. (처음 그리는 데이터는 초기화할 것이 없다)
     */
    if (renderedKeyRef.current !== undefined && datasetKey !== renderedKeyRef.current) {
      renderedCountRef.current = 0; // 덧붙이기로 오인하지 않게 — 새 종목 봉 수가 더 많아도
      drawingsRef.current?.clearAll(); // 드로잉은 종목별 — 이전 종목의 선을 남기지 않는다
      cancelPendingRef.current?.();
      setMenu(null);
      setSelectedAnchor(null);
      setHover(null);
      setMeasure(null);
      chart?.timeScale().resetTimeScale(); // 확대·위치를 기본(barSpacing 9 · 오른쪽 끝)으로
      autoScaleAllPanes(); // 축을 끌거나 휠로 늘려 고정했어도 새 종목 범위로
    }
    renderedKeyRef.current = datasetKey;

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
      // fitContent 는 전체를 욱여넣어 봉이 얇아진다. 최신 봉을 오른쪽 끝에 붙인다.
      chart?.timeScale().scrollToRealTime();
    }

    renderedCountRef.current = candles.length;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- datasetKey 는 candles 와 같은 렌더에 바뀐다
  }, [candles]);

  /*
   * ── 고점·저점 마커 ──
   * 보이는 구간이 바뀔 때마다 지우고 다시 찍는다. 마커는 둘뿐이라 비용이 없다.
   */
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series || !toggles?.overlays.extremes) return;
    const dispose = drawExtremeMarkers(
      series,
      candles,
      visibleExtent,
      livePrice?.close ?? candles.at(-1)?.close ?? null,
      currency,
      isIntraday(candles),
      chartRef.current?.timeScale().options().barSpacing ?? 9,
    );
    /*
     * ⚠️ 언마운트 때는 차트 생성 effect 의 정리(`chart.remove()`)가 **먼저** 돈다(effect 선언 순서).
     * 그 뒤에 마커를 떼면 제거된 차트에 다시 그리기가 예약돼 "Object is disposed" 가 났다 — 차트가 없으면 떼지 않는다.
     */
    return () => {
      if (chartRef.current) dispose();
    };
  }, [visibleExtent, toggles?.overlays.extremes, candles, livePrice?.close, currency]);

  // ── 현재가로 마지막 캔들 갱신 ──
  useEffect(() => {
    const candleSeries = candleSeriesRef.current;
    // 규칙(20% 넘게 다르면 무시)은 `liveCandle` 한 곳 — 실시간 순위 미리보기와 같다
    const next = candleSeries ? liveCandle(candles.at(-1), livePrice?.close) : null;
    if (!candleSeries || !next) return;

    candleSeries.update({
      time: toChartTime(next.timestamp),
      open: next.open,
      high: next.high,
      low: next.low,
      close: next.close,
    });
  }, [livePrice, candles]);

  // 크로스헤어가 없을 때는 마지막 봉 값을 보여 준다 (빈 칸보다 유용하다).
  const legend = hover ?? lastAsHover(candles, indicators);
  const measureColor = measure?.info.isUp ? COLORS.bullish : COLORS.bearish;

  return (
    /*
     * ⚠️ 오버레이(고무줄 선·자 박스·✕ 버튼·컨텍스트 메뉴)의 좌표는 **차트 컨테이너**
     * 기준이다(container.getBoundingClientRect()). 그래서 position:relative 는 바깥
     * 래퍼가 아니라 차트를 감싼 안쪽 div 가 가진다 — 래퍼에 두면 정보 바 높이만큼
     * 전부 위로 밀린다. 래퍼는 캡처 대상이라 정보 바까지 포함해야 한다.
     */
    <div ref={wrapperRef} className="flex h-full w-full flex-col bg-bg-primary">
      <ChartInfoBar
        legend={legend}
        candles={candles}
        toggles={toggles}
        week52={week52}
        visible={visibleExtent}
        currency={currency}
        price={livePrice?.close ?? null}
      />

      <div className="relative min-h-0 flex-1">
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
              stroke={COLORS.handleRing}
              strokeWidth={1.5}
            />
            {!measure && pending.percent !== null && (
              <text
                x={pending.curX + 10}
                y={pending.curY - 8}
                fill={pending.percent >= 0 ? COLORS.bullish : COLORS.bearish}
                fontSize={14}
                fontWeight={600}
              >
                {formatSigned(pending.percent, 2, '%')}
              </text>
            )}
          </svg>
        )}

        {/* 자 도구 실시간 박스 (수정 4) */}
        {measure && (
          <div
            className="pointer-events-none absolute z-20 border-2"
            style={{
              left: Math.min(measure.startX, measure.currentX),
              top: Math.min(measure.startY, measure.currentY),
              width: Math.abs(measure.currentX - measure.startX),
              height: Math.abs(measure.currentY - measure.startY),
              borderColor: measureColor,
              backgroundColor: `${measureColor}22`,
            }}
          />
        )}
        {/* 자 정보 — 커서 오른쪽(상자 크기와 상관없이 늘 보임 · 133차). 자리는 placeBesideCursor */}
        {measure && (
          <div
            ref={measureInfoRef}
            data-testid="measure-info"
            className="pointer-events-none absolute z-20 whitespace-nowrap rounded px-2 py-1 text-caption font-medium tabular-nums"
            style={{ left: measure.currentX + MEASURE_INFO_GAP, top: measure.currentY, backgroundColor: COLORS.tooltipBg, color: measureColor }}
          >
            <div>{measure.info.money}</div>
            <div>{measure.info.percent}</div>
            <div className="text-text-secondary">{measure.info.span}</div>
          </div>
        )}

        {/*
          드로잉 선택 시 「삭제」 버튼 (수정 3-B) — 자리는 fitInside 가 차트 칸 안으로.
          오른쪽 클릭 메뉴가 열린 동안은 숨긴다(메뉴에 「삭제」 가 있고, 버튼이 메뉴 모서리와 겹쳤다 — 132차 캡처 검토)
        */}
        {selectedAnchor && !menu && (
          <button
            ref={deleteButtonRef}
            type="button"
            data-testid="drawing-delete"
            onClick={() => {
              drawingsRef.current?.removeDrawing(selectedAnchor.id);
              setSelectedAnchor(null);
            }}
            data-tip="이 드로잉 삭제 (Delete)"
            className="absolute z-20 flex items-center gap-1 rounded-full bg-danger px-2.5 py-1 text-caption font-semibold text-white shadow-lg transition-transform hover:scale-105"
            style={{ left: selectedAnchor.x, top: selectedAnchor.y }}
          >
            삭제
          </button>
        )}

        {/* 우클릭 컨텍스트 메뉴 (수정 3-A) */}
        {menu && (
          <div
            ref={menuRef}
            role="menu"
            aria-label="드로잉 메뉴"
            className="absolute z-40 min-w-[110px] overflow-hidden rounded-lg bg-bg-elevated shadow-xl"
            style={{ left: menu.x, top: menu.y }}
          >
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                drawingsRef.current?.removeDrawing(menu.drawingId);
                setMenu(null);
                setSelectedAnchor(null);
              }}
              className="block w-full px-3 py-1.5 text-left text-xs text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-danger"
            >
              삭제
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={clearAllDrawings}
              className="block w-full px-3 py-1.5 text-left text-xs text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary"
            >
              모두 삭제
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => setMenu(null)}
              className="block w-full border-t border-border px-3 py-1.5 text-left text-xs text-text-muted transition-colors hover:bg-bg-tertiary"
            >
              취소
            </button>
          </div>
        )}

        <div
          ref={containerRef}
          data-testid="candle-chart"
          className="h-full w-full"
          style={{ cursor: cursorFor(activeTool) }}
        />
      </div>
    </div>
  );
});

/** 차트 칸 가장자리와 띄울 거리(px) */
const EDGE_GAP = 4;

/**
 * 차트 칸(가장 가까운 position 조상) 안에 들어오게 자리를 옮긴다 — 「삭제」 버튼 · 우클릭 메뉴.
 * `flip` 이면 넘치는 쪽에서 누른 자리 반대편으로 넘긴다(메뉴가 커서 왼쪽 · 위로), 아니면 안쪽으로 붙인다.
 * React 는 자리 값(style)이 바뀔 때만 다시 쓰므로, 여기서 고친 자리는 다음 선택 · 메뉴 전까지 남는다.
 */
/** 모양 위쪽 가장자리와 「삭제」 버튼 사이(px) */
const SHAPE_GAP = 4;

/**
 * 「삭제」 버튼을 모양 위쪽 가장자리 바로 위(가로 가운데)에 — 칸 위 끝이라 자리가 없으면 가장자리 바로 아래(모양 안쪽)로.
 * 그다음 fitInside 가 칸 안으로 맞춘다.
 */
function placeAboveShape(el: HTMLElement | null, top: { x: number; y: number }) {
  if (!el) return;
  const above = top.y - SHAPE_GAP - el.offsetHeight;
  el.style.left = `${top.x - el.offsetWidth / 2}px`;
  el.style.top = `${above >= EDGE_GAP ? above : top.y + SHAPE_GAP}px`;
}

/**
 * 자 정보 상자를 커서 옆에 — 오른쪽(커서에서 MEASURE_INFO_GAP)에 두고, 차트 칸 오른쪽 끝을 넘으면 커서 왼쪽으로.
 * 세로는 커서 높이 가운데(칸 위아래 끝에서는 안쪽으로).
 */
function placeBesideCursor(el: HTMLElement | null, x: number, y: number) {
  const box = el?.offsetParent as HTMLElement | null;
  if (!el || !box) return;
  const w = el.offsetWidth;
  const h = el.offsetHeight;
  const right = x + MEASURE_INFO_GAP;
  const left = right + w > box.clientWidth - EDGE_GAP ? x - MEASURE_INFO_GAP - w : right;
  el.style.left = `${Math.max(EDGE_GAP, left)}px`;
  el.style.top = `${Math.max(EDGE_GAP, Math.min(y - h / 2, box.clientHeight - h - EDGE_GAP))}px`;
}

function fitInside(el: HTMLElement | null, flip: boolean) {
  const box = el?.offsetParent as HTMLElement | null;
  if (!el || !box) return;
  const place = (start: number, size: number, room: number) => {
    let next = start;
    if (flip && next + size > room - EDGE_GAP) next = start - size;
    return Math.max(EDGE_GAP, Math.min(next, room - size - EDGE_GAP));
  };
  el.style.left = `${place(el.offsetLeft, el.offsetWidth, box.clientWidth)}px`;
  el.style.top = `${place(el.offsetTop, el.offsetHeight, box.clientHeight)}px`;
}

export default CandleChart;
