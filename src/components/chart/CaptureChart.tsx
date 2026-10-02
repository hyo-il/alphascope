import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { DrawingManager, getToolRegistry } from 'lightweight-charts-drawing';
import {
  CandlestickSeries,
  createChart,
  type CandlestickData,
  type IChartApi,
  type ISeriesApi,
  type MouseEventParams,
} from 'lightweight-charts';
import { TIMEFRAME_LABEL, type Candle, type Timeframe } from '../../types/toss';
import { useStockNames } from '../../hooks/useStockNames';
import { MA_LINES, type IndicatorSeries, type IndicatorToggles } from '../../types/chart';
import type { DrawingSnapshot } from './CandleChart';
import ChartInfoBar, { lastAsHover, type HoverInfo, type VisibleExtent } from './ChartInfoBar';
import type { RangeStats } from '../../hooks/useRangeStats';
import {
  BASE_CHART_OPTIONS,
  drawExtremeMarkers,
  extentOf,
  PRICE_SCALE_MARGINS,
  dateTimeOptions,
  isIntraday,
  CANDLE_SERIES_OPTIONS,
  priceFormatOf,
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
  /** 52주 고저 — 캡처 그림의 정보 바에 함께 찍는다 */
  week52?: RangeStats | null;
  currency?: 'KRW' | 'USD';
  /** 캡처 그림 맨 위 제목 줄 — 붙여넣은 쪽에서 어느 종목·어느 봉인지 알 수 있게 */
  symbol: string;
  timeframe: Timeframe;
}

export interface CaptureChartHandle {
  /** html2canvas 가 캡처할 DOM */
  getElement: () => HTMLElement | null;
  /** '다시 캡처' 할 때 조정해 둔 범위를 잃지 않기 위해 읽어 간다 */
  getVisibleRange: () => { from: number; to: number } | null;
  /**
   * 찍기 직전에 차트를 칸 크기에 **지금** 맞춘다 (v2.33.0 — 캡처 PNG 아래 날짜 축 잘림).
   * `autoSize` 는 ResizeObserver·다음 프레임에 맞추므로, 정보 줄·제목 줄이 늦게 자라 칸이 줄어든 직후에 찍으면
   * 차트가 옛 높이로 남아 맨 아래 날짜 축이 칸 밖으로 밀려 잘렸다(실측: 칸 583px · 차트 604px → 21px 잘림).
   */
  fitToHost: () => void;
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
  { candles, indicators, toggles, drawings, initialRange, week52, currency = 'USD', symbol, timeframe },
  ref,
) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const titleName = useStockNames([symbol])(symbol);
  /** 차트가 붙는 안쪽 div — 정보 바를 위에 두려면 캡처 대상(wrapper)과 나뉘어야 한다 */
  const chartHostRef = useRef<HTMLDivElement>(null);
  /** 팝업 차트에서도 크로스헤어를 따라 값이 바뀐다 (없으면 마지막 봉) */
  const [hover, setHover] = useState<HoverInfo | null>(null);
  const [visibleExtent, setVisibleExtent] = useState<VisibleExtent | null>(null);
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
    fitToHost: () => {
      const chart = chartRef.current;
      const host = chartHostRef.current;
      if (!chart || !host || !host.clientWidth || !host.clientHeight) return;
      // autoSize 가 켜져 있으면 resize 가 무시된다 — 잠깐 끄고 즉시 다시 그린 뒤 되돌린다
      chart.applyOptions({ autoSize: false });
      chart.resize(host.clientWidth, host.clientHeight, true);
      chart.applyOptions({ autoSize: true });
    },
  }));

  // ── 차트 생성 (한 번만) ──
  useEffect(() => {
    const container = chartHostRef.current;
    if (!container) return;

    const chart = createChart(container, { ...BASE_CHART_OPTIONS, autoSize: true });
    const candleSeries = chart.addSeries(CandlestickSeries, CANDLE_SERIES_OPTIONS);
    candleSeries.priceScale().applyOptions({ scaleMargins: PRICE_SCALE_MARGINS });

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

  // 가격 자릿수는 통화로 — 원화는 소수점 없이 (v2.33.0, `priceFormatOf` 한 곳)
  useEffect(() => {
    candleSeriesRef.current?.applyOptions({ priceFormat: priceFormatOf(currency) });
  }, [currency]);

  // ── 캔들 ──
  useEffect(() => {
    const series = candleSeriesRef.current;
    const chart = chartRef.current;
    if (!series || !chart || !candles.length) return;

    // 캡처 그림도 메인 차트와 같은 날짜 형식이어야 한다 (붙여넣었을 때 어긋나 보인다).
    chart.applyOptions(dateTimeOptions(isIntraday(candles)));

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

  /*
   * ── 크로스헤어 → 정보 바 ──
   * 캡처 전에 팝업 안에서 봉을 짚어 볼 수 있어야 "이 봉을 보내는 게 맞나" 를 확인한다.
   * 메인 차트는 MA 시리즈 핸들에서 값을 읽지만, 여기서는 시리즈를 따로 들고 있지 않아
   * 지표 배열에서 같은 timestamp 를 찾는다 (봉 수가 적어 비용이 없다).
   */
  useEffect(() => {
    const chart = chartRef.current;
    const series = candleSeriesRef.current;
    if (!chart || !series) return;

    const onMove = (param: MouseEventParams) => {
      const data = param.seriesData.get(series) as CandlestickData | undefined;
      if (!param.time || !data) {
        setHover(null);
        return;
      }

      const ms = (param.time as number) * 1000;
      const candle = candles.find((c) => c.timestamp === ms);
      const at = indicators ? indicators.timestamps.indexOf(ms) : -1;

      const ma: Record<string, number | null> = {};
      if (indicators && at >= 0) {
        for (const line of MA_LINES) ma[line.label] = indicators[line.series]?.[at] ?? null;
      }

      setHover({
        time: ms,
        open: data.open,
        high: data.high,
        low: data.low,
        close: data.close,
        volume: candle?.volume ?? 0,
        ma,
      });
    };

    chart.subscribeCrosshairMove(onMove);
    // 제거된 차트에는 손대지 않는다 — 언마운트 때는 생성 effect 정리(remove)가 먼저 돈다
    return () => {
      if (chartRef.current) chart.unsubscribeCrosshairMove(onMove);
    };
  }, [candles, indicators]);

  // ── 보이는 구간의 고·저 (정보 바 · 구간 점선) ──
  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;

    const scale = chart.timeScale();
    const onRange = (range: { from: number; to: number } | null) => {
      if (range) setVisibleExtent(extentOf(candles, range.from, range.to));
    };

    scale.subscribeVisibleLogicalRangeChange(onRange);
    // 구독만으로는 첫 값이 오지 않는다 — 지금 상태로 한 번 잰다.
    onRange(scale.getVisibleLogicalRange());
    return () => {
      if (chartRef.current) scale.unsubscribeVisibleLogicalRangeChange(onRange);
    };
  }, [candles]);

  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series || !toggles.overlays.extremes) return;
    const dispose = drawExtremeMarkers(
      series,
      candles,
      visibleExtent,
      candles.at(-1)?.close ?? null,
      currency,
      isIntraday(candles),
    );
    // 차트가 이미 제거됐으면(언마운트 — 생성 effect 정리가 먼저 돈다) 떼지 않는다. CandleChart 와 같은 이유 (v2.24.0)
    return () => {
      if (chartRef.current) dispose();
    };
  }, [visibleExtent, toggles.overlays.extremes, candles, currency]);

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

  return (
    <div ref={wrapperRef} className="flex h-full w-full flex-col bg-bg-primary">
      {/*
        제목 줄 — 미리보기 화면에만 있던 종목명을 그림 안에도 찍는다(v2.22.0).
        배경은 캡처 배경(#141414 = bg-primary)과 같고, 글자는 붙여넣은 뒤에도 읽히도록 15px.
        ⚠️ StockName 컴포넌트를 쓰지 않는다 — 그 안의 inline-flex + items-baseline 을 html2canvas 가
        잘못 그려 글자가 아래로 밀리고 정보 바에 잘렸다. 규칙(이름 먼저·티커 뒤·이름 없으면 티커만)은 같다.
      */}
      <div className="flex h-8 shrink-0 items-center gap-2 bg-bg-primary px-3 text-[18px] leading-8">
        <span className="font-semibold text-text-primary">{titleName || symbol}</span>
        {titleName && <span className="text-sm text-text-secondary">{symbol}</span>}
        <span className="text-sm text-text-secondary">· {TIMEFRAME_LABEL[timeframe]}</span>
      </div>
      {/* 캡처 그림에도 같은 줄이 찍혀야 붙여넣은 쪽에서 언제·어느 봉인지 알 수 있다 */}
      <ChartInfoBar
        legend={hover ?? lastAsHover(candles, indicators)}
        candles={candles}
        toggles={toggles}
        week52={week52}
        visible={visibleExtent}
        currency={currency}
        price={candles.at(-1)?.close ?? null}
      />
      <div ref={chartHostRef} className="min-h-0 flex-1" />
    </div>
  );
});

export default CaptureChart;
