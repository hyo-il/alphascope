import type { Candle, Timeframe } from '../types/toss';
import { calendarKey } from './candleAggregator';

/**
 * 마지막 봉이 아직 만들어지는 중인지.
 *
 * 장중·애프터마켓에는 마지막 봉의 종가·고가·저가·거래량이 확정이 아니다.
 * 특히 거래량은 개장 직후 평균의 0.02% 같은 값이라, 그대로 "20봉 평균 대비 0%" 로
 * 프롬프트에 실으면 모델이 '거래량 급감' 으로 읽는다. 실제로 리스크 매니저가
 * 이 값을 매도 근거로 삼은 적이 있다.
 *
 * ⚠️ 일봉 timestamp 는 **거래일의 ET 자정**이다. 그래서 "봉 날짜 == 오늘" 로 비교하면
 * 어긋난다 — 애프터마켓에는 다음 거래일 봉이 이미 열려 있다. 정규장 마감
 * (자정 + 16시간 = 16:00 ET)이 지났는지로 판단해야 한다.
 */
const MARKET_CLOSE_OFFSET_MS = 16 * 60 * 60 * 1000;

const MINUTES: Record<string, number> = { '1m': 1, '5m': 5, '15m': 15, '30m': 30 };

/** `now` 는 시험용(v2.31.0 — 규칙형 판정 점검). 넣지 않으면 지금 시각 */
export function isFormingBar(candles: Candle[], timeframe: Timeframe = '1d', symbol = '', now = Date.now()): boolean {
  const last = candles.at(-1);
  if (!last) return false;

  // 주봉·월봉(v2.20.0): **이번 주·이번 달 봉은 미완성**이다 — 그 시장 달력으로 지금과 같은 주·달인지 본다.
  // symbol 을 모르면 미국 시간대로 본다(국내 6자리 코드는 KST).
  if (timeframe === '1w' || timeframe === '1M') {
    const unit = timeframe === '1w' ? 'week' : 'month';
    return calendarKey(last.timestamp, symbol, unit) === calendarKey(now, symbol, unit);
  }

  const minutes = MINUTES[timeframe];
  if (minutes) return now < last.timestamp + minutes * 60_000;
  return now < last.timestamp + MARKET_CLOSE_OFFSET_MS;
}

/**
 * 20봉 평균 대비 거래량(%) — 진행 중인 봉은 빼고 계산한다.
 * 완성된 봉이 없으면 null.
 */
export function completedVolumeRatio(
  candles: Candle[],
  timeframe: Timeframe = '1d',
  period = 20,
  symbol = '',
): { ratio: number | null; forming: boolean; formingVolume: number | null } {
  const forming = isFormingBar(candles, timeframe, symbol);
  const completed = forming ? candles.slice(0, -1) : candles;

  if (completed.length < 2) {
    return { ratio: null, forming, formingVolume: forming ? (candles.at(-1)?.volume ?? null) : null };
  }

  const last = completed.at(-1)!;
  const window = completed.slice(-period - 1, -1);
  const average = window.length
    ? window.reduce((sum, candle) => sum + candle.volume, 0) / window.length
    : 0;

  return {
    ratio: average ? (last.volume / average) * 100 : null,
    forming,
    formingVolume: forming ? (candles.at(-1)?.volume ?? null) : null,
  };
}
