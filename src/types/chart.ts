/** 지표 시리즈 — 값이 없는 구간(워밍업 등)은 null */
export type IndicatorLine = (number | null)[];

export interface IndicatorSeries {
  /** 각 값에 대응하는 캔들 시각 (epoch ms) */
  timestamps: number[];

  // 추세 — 가격 차트에 겹쳐 그린다
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

/** 차트에 겹쳐 그리는 오버레이 지표 */
export type OverlayIndicator = 'ma' | 'ema' | 'bb' | 'vwap';

/** 하단 패널로 표시하는 지표 */
export type PanelIndicator = 'rsi' | 'macd' | 'stoch';

export interface IndicatorToggles {
  overlays: Record<OverlayIndicator, boolean>;
  panels: Record<PanelIndicator, boolean>;
}

export const DEFAULT_TOGGLES: IndicatorToggles = {
  overlays: { ma: true, ema: false, bb: false, vwap: false },
  panels: { rsi: false, macd: false, stoch: false },
};
