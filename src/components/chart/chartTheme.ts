/**
 * 차트 색과 지표 렌더링 — 메인 차트와 캡처 팝업 차트가 함께 쓴다.
 *
 * 캡처 팝업은 메인 차트와 "똑같이 생긴" 그림을 만들어야 하므로, 두 곳에 같은
 * 렌더 코드를 두면 반드시 갈라진다. 한 곳에 모아 둔다.
 */
import {
  createSeriesMarkers,
  HistogramSeries,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type SeriesMarker,
  type UTCTimestamp,
} from 'lightweight-charts';
import { formatPrice } from '../../utils/formatters';
import type { VisibleExtent } from './ChartInfoBar';
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
  /** 앵커 점의 테두리 — 어떤 캔들 위에서도 보이도록 순백을 쓴다 */
  handleRing: '#FFFFFF',
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

/**
 * 가격축 위아래 여백.
 *
 * 캔들이 pane 의 위아래 끝에 붙으면 답답하고, 고점·저점 근처의 꼬리가 축 라벨과 겹친다.
 * 메인 차트·캡처 팝업·지표 pane 이 같은 값을 써야 두 그림이 같아 보인다.
 */
export const PRICE_SCALE_MARGINS = { top: 0.12, bottom: 0.12 };

/**
 * 거래량은 아래 여백을 두지 않는다 — 히스토그램의 기준선(0)이 pane 바닥이라,
 * 여백을 주면 막대가 바닥에서 떠 있는 것처럼 보인다. 위쪽만 띄운다.
 */
export const VOLUME_SCALE_MARGINS = { top: 0.12, bottom: 0 };

const pad2 = (n: number) => String(n).padStart(2, '0');

/** yyyy-MM-dd */
export function formatChartDate(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/** yyyy-MM-dd HH:mm (분봉) / yyyy-MM-dd (일봉) */
export function formatChartDateTime(ms: number, intraday: boolean): string {
  const date = new Date(ms);
  if (!intraday) return formatChartDate(date);
  return `${formatChartDate(date)} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

/**
 * 캔들 간격으로 분봉 여부를 판정한다.
 *
 * 두 차트 모두 타임프레임을 props 로 받지 않는다 — 캔들만 있으면 알 수 있는 것을
 * 위에서부터 내려보내면 전달 경로만 늘어난다. 마지막 두 봉의 간격이 하루 미만이면 분봉이다.
 */
export function isIntraday(candles: Candle[]): boolean {
  if (candles.length < 2) return false;
  const gap = candles[candles.length - 1].timestamp - candles[candles.length - 2].timestamp;
  return gap > 0 && gap < 24 * 60 * 60 * 1000;
}

/**
 * 크로스헤어 라벨·시간축 눈금의 날짜 형식 (yyyy-MM-dd 통일).
 *
 * 라이브러리 기본값은 로케일에 따라 "27 Aug '26" 처럼 나와 연·월·일 순서가 한눈에 안 들어온다.
 * 차트를 만든 뒤 `chart.applyOptions(dateTimeOptions(intraday))` 로 덮어쓴다.
 */
export function dateTimeOptions(intraday: boolean) {
  return {
    localization: {
      dateFormat: 'yyyy-MM-dd',
      timeFormatter: (time: number) => formatChartDateTime(time * 1000, intraday),
    },
    timeScale: {
      // tickMarkType 3(Time)·4(TimeWithSeconds) 는 하루 안쪽 눈금이다 — 시각을 적는다.
      tickMarkFormatter: (time: number, tickMarkType: number) => {
        const date = new Date(time * 1000);
        if (intraday && tickMarkType >= 3) return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
        if (tickMarkType === 0) return String(date.getFullYear());
        return `${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
      },
    },
  };
}

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
    /*
     * ⚠️ 확대 상한. 없으면 봉 하나가 화면을 가득 채울 때까지 벌어지는데, 그 구간에서
     * 캔들 몸통·꼬리가 서로 어긋나 깨져 보인다 (보이는 봉 수 하한과 별개로 필요하다 —
     * 축 드래그·핀치 줌은 휠 핸들러를 거치지 않는다).
     */
    maxBarSpacing: 50,
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

/**
 * 화면에 보이는 구간의 고점·저점을 **그 봉 위에 마커로** 표시한다 (토스 스타일).
 *
 * 값을 정보 바에 글자로만 적으면 "어느 봉이 고점인지" 는 눈으로 다시 찾아야 한다.
 * 화살표를 그 자리에 찍으면 위치와 값이 한 번에 읽힌다 — 고점은 ↓(여기서 떨어졌다),
 * 저점은 ↑(여기서 올라왔다).
 *
 * v5 에서 `series.setMarkers()` 는 사라졌다. `createSeriesMarkers` 가 돌려주는 핸들로
 * 갱신·정리한다. 반환값은 지우는 함수다.
 */
export function drawExtremeMarkers(
  series: ISeriesApi<'Candlestick'>,
  candles: Candle[],
  extent: VisibleExtent | null,
  current: number | null,
  currency: 'KRW' | 'USD',
  intraday: boolean,
): () => void {
  if (!extent || !candles.length) return () => {};

  const highBar = candles[extent.highIndex];
  const lowBar = candles[extent.lowIndex];
  // 한 봉만 보이면 고점과 저점이 같은 봉이라 화살표 둘이 겹친다 — 그때는 그리지 않는다.
  if (!highBar || !lowBar || extent.highIndex === extent.lowIndex) return () => {};

  /*
   * ⚠️ 마커 글자는 **봉을 중심으로** 그려지고 pane 안으로 밀어 넣어 주지 않는다.
   * 고·저가 보이는 구간의 끝쪽 봉이면 (스크롤하면 흔히 그렇다) 글자 절반이 잘려
   * "…85%)" 처럼 남는다. 라이브러리에 정렬 옵션이 없다.
   *
   * 그래서 **가장자리에서는 글자를 아예 붙이지 않고 화살표만 남긴다** — 잘린 글자는
   * 읽히지 않으면서 캔들만 가린다. 값은 정보 바의 '구간↑/↓' 이 항상 들고 있으므로
   * 잃는 정보가 없다 (그래서 그 줄을 정보 바에 남겨 두었다).
   */
  const span = Math.max(1, extent.end - extent.start);
  const atEdge = (index: number) =>
    (index - extent.start) / span < 0.12 || (extent.end - index) / span < 0.12;

  const label = (price: number, at: number) => {
    const gap = current != null && price > 0 ? ((current - price) / price) * 100 : null;
    const rate = gap == null ? '' : `${gap > 0 ? '+' : ''}${gap.toFixed(2)}%, `;
    const date = new Date(at);
    const when = intraday
      ? `${pad2(date.getMonth() + 1)}.${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
      : `${pad2(date.getMonth() + 1)}.${pad2(date.getDate())}`;
    return `${formatPrice(price, currency)} (${rate}${when})`;
  };

  const markers: SeriesMarker<UTCTimestamp>[] = [
    {
      time: toChartTime(highBar.timestamp),
      position: 'aboveBar',
      color: COLORS.bearish,
      shape: 'arrowDown',
      text: atEdge(extent.highIndex) ? undefined : label(extent.high, highBar.timestamp),
    },
    {
      time: toChartTime(lowBar.timestamp),
      position: 'belowBar',
      color: COLORS.bullish,
      shape: 'arrowUp',
      text: atEdge(extent.lowIndex) ? undefined : label(extent.low, lowBar.timestamp),
    },
  ];

  const handle = createSeriesMarkers(series, markers);
  return () => {
    // 차트가 이미 사라진 뒤에 정리가 돌면 던진다 — 그때는 지울 것도 없다.
    try {
      handle.detach();
    } catch {
      /* 시리즈가 이미 제거됨 */
    }
  };
}

/** 논리 인덱스 구간(줌·스크롤 상태)에서 실제 고·저를 낸다 */
export function extentOf(candles: Candle[], from: number, to: number): VisibleExtent | null {
  const start = Math.max(0, Math.floor(from));
  const end = Math.min(candles.length - 1, Math.ceil(to));
  if (start > end || !candles.length) return null;

  let highIndex = start;
  let lowIndex = start;
  for (let i = start; i <= end; i++) {
    if (candles[i].high > candles[highIndex].high) highIndex = i;
    if (candles[i].low < candles[lowIndex].low) lowIndex = i;
  }

  return {
    high: candles[highIndex].high,
    low: candles[lowIndex].low,
    highIndex,
    lowIndex,
    start,
    end,
  };
}

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
    // 지표 pane 도 가격 차트와 같은 여백을 준다 — 선이 pane 경계에 붙으면 읽기 어렵다.
    if (options.paneIndex) series.priceScale().applyOptions({ scaleMargins: PRICE_SCALE_MARGINS });

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
    volume.priceScale().applyOptions({ scaleMargins: VOLUME_SCALE_MARGINS });
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
