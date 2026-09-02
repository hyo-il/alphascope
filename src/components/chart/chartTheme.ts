/**
 * 차트 색과 지표 렌더링 — 메인 차트와 캡처 팝업 차트가 함께 쓴다.
 *
 * 캡처 팝업은 메인 차트와 "똑같이 생긴" 그림을 만들어야 하므로, 두 곳에 같은
 * 렌더 코드를 두면 반드시 갈라진다. 한 곳에 모아 둔다.
 */
import {
  HistogramSeries,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import type { Candle } from '../../types/toss';
import {
  MA_LINES,
  type IndicatorLine,
  type IndicatorSeries,
  type IndicatorToggles,
} from '../../types/chart';

/** index.css 의 @theme 토큰과 같은 값을 유지한다 (차트는 JS 로 색을 받는다). */
export const COLORS = {
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

export const INDICATOR_COLORS = {
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

export const toChartTime = (ms: number) => (ms / 1000) as UTCTimestamp;

/** 메인 차트와 캡처 팝업이 공유하는 차트 생성 옵션 */
export const BASE_CHART_OPTIONS = {
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
    // 기본값(6)은 축소 상태에서 캔들이 실선처럼 얇아진다. 거래량 히스토그램도 같이 두꺼워진다.
    barSpacing: 9,
    minBarSpacing: 4,
    // 기본 여백은 오른쪽이 크게 비어 데이터가 왼쪽으로 몰려 보인다.
    rightOffset: 5,
    shiftVisibleRangeOnNewBar: true,
  },
  crosshair: {
    mode: 0 as const,
    vertLine: { color: COLORS.border, labelBackgroundColor: '#2A2A2A' },
    horzLine: { color: COLORS.border, labelBackgroundColor: '#2A2A2A' },
  },
};

/** 캔들 시리즈 옵션 (상승/하락 색) */
export const CANDLE_SERIES_OPTIONS = {
  upColor: COLORS.bullish,
  downColor: COLORS.bearish,
  borderUpColor: COLORS.bullish,
  borderDownColor: COLORS.bearish,
  wickUpColor: COLORS.bullish,
  wickDownColor: COLORS.bearish,
};

export interface RenderedIndicators {
  /** 정리할 때 제거할 시리즈 목록 */
  series: ISeriesApi<'Line' | 'Histogram'>[];
  /** 범례가 값을 읽어야 하는 이동평균 시리즈 (라벨 → 시리즈) */
  maSeries: Map<string, ISeriesApi<'Line'>>;
}

/**
 * 토글 상태에 맞춰 오버레이·패널 지표를 그린다.
 * 이전에 그린 시리즈는 호출부가 `series` 를 들고 있다가 지운 뒤 다시 부른다.
 */
export function renderIndicators(
  chart: IChartApi,
  candles: Candle[],
  indicators: IndicatorSeries | null,
  toggles: IndicatorToggles | undefined,
): RenderedIndicators {
  const result: RenderedIndicators = { series: [], maSeries: new Map() };
  if (!toggles) return result;

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
    result.series.push(series);
    if (options.maKey) result.maSeries.set(options.maKey, series);
  };

  // 가격 차트 오버레이
  for (const ma of MA_LINES) {
    if (toggles.overlays[ma.key]) {
      // title 은 주지 않는다 — 가격축 옆에 불투명 뱃지로 그려져 캔들을 가리는데,
      // 같은 내용을 좌상단 MA 범례가 이미 (크로스헤어 값까지) 보여 준다.
      // maKey 는 그 범례가 시리즈를 찾는 열쇠라 그대로 둔다.
      addLine(indicators?.[ma.series], ma.color, { maKey: ma.label });
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
    result.series.push(volume);
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
    result.series.push(histogram);
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

  return result;
}
