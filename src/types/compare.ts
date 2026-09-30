import type { Candle, Timeframe } from './toss';

/** 최대 4개까지만 나란히 둔다 — 그 이상은 차트가 읽을 수 없을 만큼 작아진다 */
export const MAX_COMPARE_SYMBOLS = 4;

/** 비교 차트의 타임프레임 셀렉트 항목 */
/**
 * 비교 차트의 타임프레임 셀렉트 항목.
 * v2.20.0 부터 메인 차트와 **같은 `Timeframe`** 이다(예전 `CompareTimeframe` 을 합쳤다 — 두 벌이면 주봉 규칙이 갈라진다).
 * 주봉·월봉은 서버가 일봉을 시장 달력으로 묶어 준다(`aggregateCalendar`).
 */
export const COMPARE_TIMEFRAMES: { value: Timeframe; label: string }[] = [
  { value: '1m', label: '1분' },
  { value: '5m', label: '5분' },
  { value: '15m', label: '15분' },
  { value: '30m', label: '30분' },
  { value: '1d', label: '일봉' },
  { value: '1w', label: '주봉' },
  { value: '1M', label: '월봉' },
];

/**
 * 관심 목록 → 비교 영역 드래그에 쓰는 데이터 형식.
 *
 * `text/plain` 도 함께 넣지만, 드롭을 받을 때는 이 전용 타입이 있는지로 판단한다 —
 * 바깥에서 끌어온 아무 텍스트나 종목으로 받아들이지 않기 위해서다.
 */
export const COMPARE_DRAG_TYPE = 'application/x-alphascope-symbol';

/** 종목 하나의 캔들 적재 상태 */
export interface CompareChartData {
  symbol: string;
  timeframe: Timeframe;
  candles: Candle[];
  loading: boolean;
  error: string | null;
}
