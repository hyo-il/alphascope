import type { Candle } from '../types/toss';

/**
 * 경량 기술적 지표 계산 (TypeScript).
 *
 * Step 4(수동 분석)의 요약 텍스트를 만들기 위한 최소 구현이다.
 * Step 5 에서 pandas-ta 기반 Python 엔진이 들어오면 차트 오버레이와 정밀 계산은
 * 그쪽이 맡고, 이 모듈은 화면 요약용으로 남는다.
 */

/** 단순이동평균 — 마지막 값만 필요할 때 */
export function sma(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const window = values.slice(-period);
  return window.reduce((sum, v) => sum + v, 0) / period;
}

/** 지수이동평균 전체 시리즈 */
export function emaSeries(values: number[], period: number): number[] {
  if (!values.length) return [];
  const k = 2 / (period + 1);
  const out: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    out.push(values[i] * k + out[i - 1] * (1 - k));
  }
  return out;
}

/**
 * RSI(14) — Wilder 평활법.
 * 0~100. 70 이상 과매수, 30 이하 과매도로 읽는다.
 */
export function rsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null;

  let avgGain = 0;
  let avgLoss = 0;

  // 첫 period 구간은 단순 평균
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) avgGain += diff;
    else avgLoss -= diff;
  }
  avgGain /= period;
  avgLoss /= period;

  // 이후는 Wilder 평활
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

export interface MacdResult {
  macd: number;
  signal: number;
  histogram: number;
  /** 시그널선 위에 있으면 강세 */
  isBullish: boolean;
  /** 직전 봉 대비 히스토그램이 커지는 중인지 */
  isExpanding: boolean;
}

/** MACD(12, 26, 9) */
export function macd(closes: number[], fast = 12, slow = 26, signalPeriod = 9): MacdResult | null {
  if (closes.length < slow + signalPeriod) return null;

  const fastEma = emaSeries(closes, fast);
  const slowEma = emaSeries(closes, slow);
  const macdLine = closes.map((_, i) => fastEma[i] - slowEma[i]);
  const signalLine = emaSeries(macdLine, signalPeriod);

  const last = macdLine.length - 1;
  const histogram = macdLine[last] - signalLine[last];
  const prevHistogram = macdLine[last - 1] - signalLine[last - 1];

  return {
    macd: macdLine[last],
    signal: signalLine[last],
    histogram,
    isBullish: macdLine[last] > signalLine[last],
    isExpanding: Math.abs(histogram) > Math.abs(prevHistogram),
  };
}

/** 최근 봉 거래량이 직전 N봉 평균의 몇 %인지 */
export function volumeRatio(candles: Candle[], period = 20): number | null {
  if (candles.length < period + 1) return null;
  const recent = candles.at(-1)!.volume;
  const past = candles.slice(-period - 1, -1);
  const average = past.reduce((sum, c) => sum + c.volume, 0) / past.length;
  if (average === 0) return null;
  return (recent / average) * 100;
}

export interface IndicatorSummary {
  price: number;
  rsi: number | null;
  macd: MacdResult | null;
  ma20: number | null;
  ma60: number | null;
  volumeRatio: number | null;
  /** 최근 20봉 고가/저가 — 단순 지지·저항 참고선 */
  recentHigh: number | null;
  recentLow: number | null;
}

/** 요약 텍스트 생성에 필요한 지표를 한 번에 계산한다. */
export function summarize(candles: Candle[]): IndicatorSummary | null {
  if (!candles.length) return null;
  const closes = candles.map((c) => c.close);
  const recent = candles.slice(-20);

  return {
    price: closes.at(-1)!,
    rsi: rsi(closes),
    macd: macd(closes),
    ma20: sma(closes, 20),
    ma60: sma(closes, 60),
    volumeRatio: volumeRatio(candles),
    recentHigh: recent.length ? Math.max(...recent.map((c) => c.high)) : null,
    recentLow: recent.length ? Math.min(...recent.map((c) => c.low)) : null,
  };
}
