import type { Candle, Timeframe } from '../types/toss';
import { AGGREGATION_MINUTES } from './constants';
import { marketDate } from './marketDate';

/**
 * 1분봉을 N분봉으로 집계한다.
 * 버킷 경계는 UTC 기준 절대 시각(epoch)으로 나누므로 시장 시간대와 무관하게 일관적이다.
 */
export function aggregateCandles(candles: Candle[], minutes: number): Candle[] {
  if (minutes <= 1) return candles;
  const bucketMs = minutes * 60_000;
  const out: Candle[] = [];

  for (const candle of candles) {
    const bucketStart = Math.floor(candle.timestamp / bucketMs) * bucketMs;
    const current = out.at(-1);

    if (current && current.timestamp === bucketStart) {
      current.high = Math.max(current.high, candle.high);
      current.low = Math.min(current.low, candle.low);
      current.close = candle.close;
      current.volume += candle.volume;
    } else {
      out.push({ ...candle, timestamp: bucketStart });
    }
  }

  return out;
}

/** 달력 단위로 묶는 타임프레임 — 일봉을 받아 시장 시간대의 주·월로 집계한다 (v2.20.0) */
export type CalendarUnit = 'week' | 'month';

/** 요청 타임프레임에 필요한 원본 주기와 집계 방식을 알려준다. */
export function resolveTimeframe(timeframe: Timeframe): {
  base: '1m' | '1d';
  minutes: number;
  calendar: CalendarUnit | null;
} {
  if (timeframe === '1d') return { base: '1d', minutes: 0, calendar: null };
  if (timeframe === '1w') return { base: '1d', minutes: 0, calendar: 'week' };
  if (timeframe === '1M') return { base: '1d', minutes: 0, calendar: 'month' };
  return { base: '1m', minutes: AGGREGATION_MINUTES[timeframe] ?? 1, calendar: null };
}

/** 주봉·월봉 1개에 들어가는 일봉 수(넉넉히) — 필요한 일봉 수를 어림할 때 쓴다 */
export const DAYS_PER_CALENDAR_BAR: Record<CalendarUnit, number> = { week: 5, month: 22 };

/** 그 시장 날짜(YYYY-MM-DD)가 속한 주의 월요일 날짜 — 날짜 산수라 UTC 로 계산해도 된다 */
function mondayOf(day: string): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

/** 주·월 버킷 키 — **시장 날짜** 기준(한국 = KST, 미국 = ET). 같은 키면 같은 봉이다 */
export function calendarKey(timestamp: number, symbol: string, unit: CalendarUnit): string {
  const day = marketDate(timestamp, symbol);
  return unit === 'week' ? mondayOf(day) : day.slice(0, 7);
}

/**
 * 일봉을 주봉·월봉으로 묶는다 (v2.20.0).
 *
 * ⚠️ 경계는 **그 시장의 달력**이다 — `marketDate()` 로 날짜를 만든 뒤 월요일·그달로 묶는다.
 * 예전 `aggregateWeekly` 는 UTC 요일로 나눠서, KST 자정(= 전날 15:00 UTC)인 **국내 월요일 봉이 앞 주로** 들어갔다.
 * 시가 = 첫 봉 시가, 종가 = 마지막 봉 종가, 고·저 = 최대·최소, 거래량 = 합.
 * 봉의 timestamp 는 **그 주·달의 첫 거래일 봉** 것이다(월요일이 휴장이면 화요일).
 */
export function aggregateCalendar(candles: Candle[], symbol: string, unit: CalendarUnit): Candle[] {
  const out: Candle[] = [];
  let currentKey: string | null = null;
  for (const candle of candles) {
    const key = calendarKey(candle.timestamp, symbol, unit);
    const current = out.at(-1);
    if (current && key === currentKey) {
      current.high = Math.max(current.high, candle.high);
      current.low = Math.min(current.low, candle.low);
      current.close = candle.close;
      current.volume += candle.volume;
    } else {
      out.push({ ...candle });
      currentKey = key;
    }
  }
  return out;
}

export const aggregateWeekly = (candles: Candle[], symbol: string) => aggregateCalendar(candles, symbol, 'week');
export const aggregateMonthly = (candles: Candle[], symbol: string) => aggregateCalendar(candles, symbol, 'month');
