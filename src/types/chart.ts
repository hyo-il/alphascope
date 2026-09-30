import type { Timeframe } from './toss';

/** 지표 시리즈 — 값이 없는 구간(워밍업 등)은 null */
export type IndicatorLine = (number | null)[];

export interface IndicatorSeries {
  /** 각 값에 대응하는 캔들 시각 (epoch ms) */
  timestamps: number[];

  // 추세 — 가격 차트에 겹쳐 그린다
  sma5: IndicatorLine;
  sma20: IndicatorLine;
  sma60: IndicatorLine;
  sma120: IndicatorLine;
  ema12: IndicatorLine;
  ema26: IndicatorLine;
  bbLower: IndicatorLine;
  bbMiddle: IndicatorLine;
  bbUpper: IndicatorLine;
  vwap: IndicatorLine;

  // 오실레이터 — 하단 별도 패널
  rsi14: IndicatorLine;
  macd: IndicatorLine;
  macdSignal: IndicatorLine;
  macdHistogram: IndicatorLine;
  stochK: IndicatorLine;
  stochD: IndicatorLine;

  // 변동성·거래량
  atr14: IndicatorLine;
  obv: IndicatorLine;
}

/** 가격 차트에 겹쳐 그리는 오버레이 지표 */
export type OverlayIndicator =
  | 'ma5'
  | 'ma20'
  | 'ma60'
  | 'ma120'
  | 'ema'
  | 'bb'
  | 'vwap'
  /** 화면에 보이는 구간의 고점·저점 마커. 엔진 지표가 아니라 차트가 직접 그린다. */
  | 'extremes';

/** 하단 별도 패널로 표시하는 지표 */
export type PanelIndicator = 'volume' | 'rsi' | 'macd' | 'stoch' | 'atr' | 'obv';

export interface IndicatorToggles {
  overlays: Record<OverlayIndicator, boolean>;
  panels: Record<PanelIndicator, boolean>;
}

export const DEFAULT_TOGGLES: IndicatorToggles = {
  overlays: {
    ma5: true,
    ma20: true,
    ma60: true,
    ma120: false,
    ema: false,
    bb: false,
    vwap: false,
    extremes: true,
  },
  panels: { volume: true, rsi: false, macd: false, stoch: false, atr: false, obv: false },
};

/** 이동평균 오버레이의 표시 정보 — 범례와 차트가 같은 색을 쓰도록 한 곳에 모은다. */
export const MA_LINES: {
  key: Extract<OverlayIndicator, 'ma5' | 'ma20' | 'ma60' | 'ma120'>;
  label: string;
  series: keyof Pick<IndicatorSeries, 'sma5' | 'sma20' | 'sma60' | 'sma120'>;
  color: string;
}[] = [
  { key: 'ma5', label: '5일선', series: 'sma5', color: '#F5B041' },
  { key: 'ma20', label: '20일선', series: 'sma20', color: '#5DADE2' },
  { key: 'ma60', label: '60일선', series: 'sma60', color: '#AF7AC5' },
  { key: 'ma120', label: '120일선', series: 'sma120', color: '#58D68D' },
];

/**
 * 타임프레임 버튼 정의 — 메인 차트 툴바와 캡처 팝업이 같은 목록을 쓴다.
 * 두 곳에 두면 한쪽에만 타임프레임이 추가되는 일이 생긴다.
 */
/** 타임프레임 항목 — `short` 는 차트 툴바 버튼용(`일 · 주 · 월`), `label` 은 캡처 문구 등 풀어 쓰는 자리용 */
export const TIMEFRAME_ITEMS: { value: Timeframe; label: string; short: string }[] = [
  { value: '1m', label: '1분', short: '1분' },
  { value: '5m', label: '5분', short: '5분' },
  { value: '15m', label: '15분', short: '15분' },
  { value: '30m', label: '30분', short: '30분' },
  { value: '1d', label: '일봉', short: '일' },
  { value: '1w', label: '주봉', short: '주' },
  { value: '1M', label: '월봉', short: '월' },
];

/** 지표 드롭다운에 노출하는 항목 정의 */
export const OVERLAY_ITEMS: { key: OverlayIndicator; label: string; indent?: boolean }[] = [
  { key: 'ma5', label: '5일', indent: true },
  { key: 'ma20', label: '20일', indent: true },
  { key: 'ma60', label: '60일', indent: true },
  { key: 'ma120', label: '120일', indent: true },
  { key: 'ema', label: 'EMA 12·26' },
  { key: 'bb', label: '볼린저밴드' },
  { key: 'vwap', label: 'VWAP' },
  { key: 'extremes', label: '고·저점 표시' },
];

export const PANEL_ITEMS: { key: PanelIndicator; label: string }[] = [
  { key: 'volume', label: '거래량' },
  { key: 'rsi', label: 'RSI' },
  { key: 'macd', label: 'MACD' },
  { key: 'stoch', label: '스토캐스틱' },
  { key: 'atr', label: 'ATR' },
  { key: 'obv', label: 'OBV' },
];

/**
 * 봉 간격으로 본 단위 (v2.20.0) — 차트 컴포넌트는 타임프레임을 모르므로 봉 사이 간격(중앙값)으로 가른다.
 * 25일 이상 = 월봉, 5일 이상 = 주봉, 그 밖 = 일봉·분봉(이동평균 이름은 예전 그대로 둔다).
 */
export type BarUnit = 'day' | 'week' | 'month';

export function barUnitOf(candles: { timestamp: number }[]): BarUnit {
  if (candles.length < 3) return 'day';
  const tail = candles.slice(-30);
  const gaps = tail.slice(1).map((c, i) => c.timestamp - tail[i].timestamp).sort((a, b) => a - b);
  const days = gaps[Math.floor(gaps.length / 2)] / 86_400_000;
  return days >= 25 ? 'month' : days >= 5 ? 'week' : 'day';
}

/** 이동평균 이름 — 주봉에서 "20일선" 이라 쓰면 20주 평균을 20일로 읽는다 (5주선 · 20개월선) */
export function maLabel(line: { label: string; key: string }, unit: BarUnit): string {
  if (unit === 'day') return line.label;
  const period = line.key.replace('ma', '');
  return `${period}${unit === 'week' ? '주' : '개월'}선`;
}
