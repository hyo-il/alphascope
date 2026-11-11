import { useEffect, useRef } from 'react';
import {
  CandlestickSeries,
  HistogramSeries,
  LineSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import {
  BASE_CHART_OPTIONS,
  CANDLE_SERIES_OPTIONS,
  dateTimeOptions,
  isIntraday,
  priceFormatOf,
  COLORS,
  PANE_EDGE_LABELS,
  fitCandleScale,
  VOLUME_SCALE_MARGINS,
  toChartTime,
  VOLUME_PRICE_FORMAT,
} from './chartTheme';
import { MA_LINES } from '../../types/chart';
import type { Candle } from '../../types/toss';
import { liveCandle } from '../../utils/liveCandle';

/**
 * 가벼운 캔들 차트 — 캔들 + 거래량 + MA(5·20·60)뿐 — 기업 비교 · 실시간 순위 미리보기가 쓴다.
 * 기업 비교 칸과 실시간 순위의 미리보기가 함께 쓴다.
 *
 * - ⚠️ 차트 인스턴스는 **마운트 때 한 번만** 만들고, 종목·봉이 바뀌면 `setData` 로 데이터만 갈아 끼운다
 *   (미리보기에서 행을 훑을 때마다 차트를 새로 만들지 않는다).
 * - 메인 `CandleChart.tsx` 는 드로잉·지표 패널·실시간 폴링·캡처가 붙어 있어 여기서 쓰지 않는다.
 * - 색은 `chartTheme.ts` 한 곳.
 * - `livePrice`(선택 — 실시간 순위 미리보기)를 주면 마지막 봉을 현재가로 고친다(메인 차트와 같은 규칙 `liveCandle`).
 * - 분봉이면 시간축 · 십자선 시각을 메인 차트와 같은 모양으로(`dateTimeOptions`). 일 · 주 · 월은 라이브러리 기본 그대로.
 *   ⚠️ 십자선 시각(`timeFormatter`)은 한 번 넣으면 라이브러리 기본으로 되돌릴 수 없다(옵션 합치기가 undefined 를 건너뜀) —
 *   그래서 분봉 ↔ 일·주·월이 **바뀔 때만** 차트를 새로 만든다(봉 버튼을 누를 때뿐 · 종목을 훑을 때는 그대로 하나).
 */

/** 이동평균은 비교용이라 프런트에서 낸다 — 지표 엔진(5001)을 네 번 부르지 않는다. */
function maPoints(candles: Candle[], period: number) {
  const points: { time: UTCTimestamp; value: number }[] = [];
  let sum = 0;

  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].close;
    if (i >= period) sum -= candles[i - period].close;
    if (i >= period - 1) {
      points.push({ time: toChartTime(candles[i].timestamp), value: sum / period });
    }
  }

  return points;
}

/** 가벼운 차트에 그리는 이동평균 — 메인 차트와 같은 색을 쓴다 */
const COMPARE_MAS = MA_LINES.filter((ma) => ma.key !== 'ma120');
const PERIODS: Record<string, number> = { ma5: 5, ma20: 20, ma60: 60 };

/** 범례 — 색만 봐도 어느 선인지 알 수 있게 (메인 차트와 같은 색) */
export const LITE_CHART_MAS = COMPARE_MAS;

export default function LiteCandleChart({
  candles,
  barSpacing = 5,
  currency,
  datasetKey,
  onReachStart,
  livePrice,
}: {
  candles: Candle[];
  barSpacing?: number;
  /** 가격 자릿수 — 원화는 소수점 없이 */
  currency?: 'KRW' | 'USD' | string | null;
  /**
   * 과거 봉 이어 받기 (선택 — 실시간 순위 미리보기). 둘 다 주면: 사용자가 끌어서 왼쪽 끝에 닿으면 `onReachStart`,
   * 같은 `datasetKey` 에서 앞에 봉이 붙으면 보던 위치를 유지한다(fitContent 하지 않는다). 주지 않으면 이어 받지 않는다(기업 비교).
   */
  datasetKey?: string;
  onReachStart?: () => void;
  /** 현재가 — 마지막 봉 종가 · 고가 · 저가를 고친다(20% 넘게 다르면 무시). 이 `candles` 와 같은 종목 값만 넘긴다 */
  livePrice?: number | null;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const maSeriesRef = useRef<ISeriesApi<'Line'>[]>([]);
  const reachRef = useRef(onReachStart);
  reachRef.current = onReachStart;
  /** 직전에 그린 데이터 — 앞에 붙은 것인지 가린다 */
  const drawnRef = useRef<{ key: string | undefined; count: number; first: number | null }>({ key: undefined, count: 0, first: null });
  /** 사용자가 차트를 움직였는가 — fitContent 로 왼쪽 끝이 보이는 것만으로는 받지 않는다(종목마다 자동으로 받지 않게) */
  const interactedRef = useRef(false);
  /** 분봉 모양인가 — 봉이 2개 미만(빈 차트 등)이면 앞 모양을 그대로 둔다(빈 차트로 바뀔 때마다 새로 만들지 않게) */
  const intradayRef = useRef(false);
  const intraday = candles.length >= 2 ? isIntraday(candles) : intradayRef.current;
  intradayRef.current = intraday;

  // 차트 생성 (한 번만 — 분봉 ↔ 일·주·월이 바뀔 때만 다시)
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      ...BASE_CHART_OPTIONS,
      timeScale: { ...BASE_CHART_OPTIONS.timeScale, barSpacing, rightOffset: 2 },
      autoSize: true,
    });
    if (intraday) chart.applyOptions(dateTimeOptions(true));
    drawnRef.current = { key: undefined, count: 0, first: null };
    interactedRef.current = false;

    const candleSeries = chart.addSeries(CandlestickSeries, CANDLE_SERIES_OPTIONS);
    fitCandleScale(candleSeries, { extremes: false });

    const volumeSeries = chart.addSeries(
      HistogramSeries,
      { priceFormat: VOLUME_PRICE_FORMAT, priceLineVisible: false, lastValueVisible: false },
      1,
    );
    volumeSeries.priceScale().applyOptions({ scaleMargins: VOLUME_SCALE_MARGINS, ...PANE_EDGE_LABELS });

    maSeriesRef.current = COMPARE_MAS.map((ma) =>
      chart.addSeries(LineSeries, {
        color: ma.color,
        lineWidth: 1,
        priceLineVisible: false,
        lastValueVisible: false,
        crosshairMarkerVisible: false,
        pointMarkersVisible: false,
      }),
    );

    // 가격 6 : 거래량 1.6 — 메인 차트와 같은 비율이라 나란히 둬도 낯설지 않다.
    const panes = chart.panes();
    panes[0]?.setStretchFactor(6);
    panes[1]?.setStretchFactor(1.6);

    // 왼쪽 끝 근처까지 끌면 과거를 이어 받는다(onReachStart 가 있을 때만)
    chart.timeScale().subscribeVisibleLogicalRangeChange((range) => {
      if (!range || !interactedRef.current || !reachRef.current) return;
      if (range.from < 3) reachRef.current();
    });
    const mark = () => {
      interactedRef.current = true;
    };
    container.addEventListener('mousedown', mark);
    container.addEventListener('wheel', mark, { passive: true });
    container.addEventListener('touchstart', mark, { passive: true });

    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    volumeSeriesRef.current = volumeSeries;

    return () => {
      container.removeEventListener('mousedown', mark);
      container.removeEventListener('wheel', mark);
      container.removeEventListener('touchstart', mark);
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      maSeriesRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- barSpacing 은 처음 값만 쓴다
  }, [intraday]);

  // 데이터 갱신
  // 가격 자릿수는 통화로 — 원화는 소수점 없이
  useEffect(() => {
    candleSeriesRef.current?.applyOptions({ priceFormat: priceFormatOf(currency) });
  }, [currency, intraday]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !candleSeriesRef.current || !volumeSeriesRef.current) return;

    // 같은 데이터 묶음에 과거가 앞에 붙었는가 — 그렇다면 보던 위치를 붙은 만큼 밀어 유지한다
    const drawn = drawnRef.current;
    const added = candles.length - drawn.count;
    const prepended =
      onReachStart != null &&
      datasetKey != null &&
      drawn.key === datasetKey &&
      added > 0 &&
      drawn.first != null &&
      candles[added]?.timestamp === drawn.first;
    const keep = prepended ? chart.timeScale().getVisibleLogicalRange() : null;
    /*
      같은 데이터 묶음을 다시 받아 뒤에 봉이 붙거나 마지막 봉이 바뀐 것(분봉 1분 다시 받기) — 사용자가 움직여 둔 위치 · 확대를 지킨다.
      맨 오른쪽(마지막 봉)을 보고 있었으면 붙은 만큼 따라간다. 움직이지 않았으면 지금처럼 전부 맞춘다(fitContent).
    */
    const refreshed = !prepended && datasetKey != null && drawn.key === datasetKey && drawn.count > 0 && interactedRef.current;
    const view = refreshed ? chart.timeScale().getVisibleLogicalRange() : null;
    if (datasetKey !== drawn.key) interactedRef.current = false;
    drawnRef.current = { key: datasetKey, count: candles.length, first: candles[0]?.timestamp ?? null };

    candleSeriesRef.current.setData(
      candles.map((c) => ({
        time: toChartTime(c.timestamp),
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      })),
    );
    volumeSeriesRef.current.setData(
      candles.map((c) => ({
        time: toChartTime(c.timestamp),
        value: c.volume,
        color: c.close >= c.open ? `${COLORS.bullish}66` : `${COLORS.bearish}66`,
      })),
    );
    maSeriesRef.current.forEach((series, index) => {
      series.setData(maPoints(candles, PERIODS[COMPARE_MAS[index].key] ?? 20));
    });

    if (keep) chart.timeScale().setVisibleLogicalRange({ from: keep.from + added, to: keep.to + added });
    else if (view) {
      const follow = view.to >= drawn.count - 1 ? Math.max(0, added) : 0;
      chart.timeScale().setVisibleLogicalRange({ from: view.from + follow, to: view.to + follow });
    } else if (candles.length) chart.timeScale().fitContent();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, intraday]);

  // 현재가로 마지막 봉 — 데이터 effect 뒤에 둔다(setData 로 되돌아간 마지막 봉을 곧바로 다시 고친다)
  useEffect(() => {
    const series = candleSeriesRef.current;
    const next = series ? liveCandle(candles.at(-1), livePrice) : null;
    if (!series || !next) return;
    series.update({ time: toChartTime(next.timestamp), open: next.open, high: next.high, low: next.low, close: next.close });
  }, [livePrice, candles, intraday]);

  return <div ref={containerRef} data-testid="lite-candle-chart" className="h-full w-full" />;
}
