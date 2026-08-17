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
export type OverlayIndicator = 'ma5' | 'ma20' | 'ma60' | 'ma120' | 'ema' | 'bb' | 'vwap';

/** 하단 별도 패널로 표시하는 지표 */
export type PanelIndicator = 'volume' | 'rsi' | 'macd' | 'stoch' | 'atr' | 'obv';

export interface IndicatorToggles {
  overlays: Record<OverlayIndicator, boolean>;
  panels: Record<PanelIndicator, boolean>;
}

export const DEFAULT_TOGGLES: IndicatorToggles = {
  overlays: { ma5: true, ma20: true, ma60: true, ma120: false, ema: false, bb: false, vwap: false },
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

/** 지표 드롭다운에 노출하는 항목 정의 */
export const OVERLAY_ITEMS: { key: OverlayIndicator; label: string; indent?: boolean }[] = [
  { key: 'ma5', label: '5일', indent: true },
  { key: 'ma20', label: '20일', indent: true },
  { key: 'ma60', label: '60일', indent: true },
  { key: 'ma120', label: '120일', indent: true },
  { key: 'ema', label: 'EMA 12·26' },
  { key: 'bb', label: '볼린저밴드' },
  { key: 'vwap', label: 'VWAP' },
];

export const PANEL_ITEMS: { key: PanelIndicator; label: string }[] = [
  { key: 'volume', label: '거래량' },
  { key: 'rsi', label: 'RSI' },
  { key: 'macd', label: 'MACD' },
  { key: 'stoch', label: '스토캐스틱' },
  { key: 'atr', label: 'ATR' },
  { key: 'obv', label: 'OBV' },
];
