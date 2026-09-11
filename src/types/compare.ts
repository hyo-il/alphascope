import type { Candle, Timeframe } from './toss';

/**
 * 비교 화면 전용 타임프레임.
 *
 * 메인 차트의 `Timeframe` 에 '1w' 를 더하지 않고 여기서만 넓힌다 —
 * 토스 `/candles` 는 주봉을 주지 않아 일봉을 집계해 만들고,
 * `Timeframe` 을 건드리면 LIMITS·TIMEFRAME_LABEL 같은 Record 가 전부 따라온다.
 */
export type CompareTimeframe = Timeframe | '1w';

/** 최대 4개까지만 나란히 둔다 — 그 이상은 차트가 읽을 수 없을 만큼 작아진다 */
export const MAX_COMPARE_SYMBOLS = 4;

/** 비교 차트의 타임프레임 셀렉트 항목 */
export const COMPARE_TIMEFRAMES: { value: CompareTimeframe; label: string }[] = [
  { value: '1m', label: '1분' },
  { value: '5m', label: '5분' },
  { value: '15m', label: '15분' },
  { value: '30m', label: '30분' },
  { value: '1d', label: '일봉' },
  { value: '1w', label: '주봉' },
];

/** 종목 하나의 캔들 적재 상태 */
export interface CompareChartData {
  symbol: string;
  timeframe: CompareTimeframe;
  candles: Candle[];
  loading: boolean;
  error: string | null;
}
