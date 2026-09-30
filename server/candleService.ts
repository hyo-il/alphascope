import type { Candle, Timeframe } from '../src/types/toss';
import { fetchCandles, fetchCandlesBefore } from '../src/services/toss/market';
import {
  aggregateCalendar,
  aggregateCandles,
  calendarKey,
  DAYS_PER_CALENDAR_BAR,
  resolveTimeframe,
  type CalendarUnit,
} from '../src/utils/candleAggregator';
import { latestCandleTimestamp, loadCandles, loadCandlesBefore, saveCandles } from './db';
import { isMockMode, mockCandles } from './mockData';

/** 원본 주기별 캐시 신선도 — 이 시간 안에 받아온 데이터면 API를 다시 부르지 않는다. */
const FRESHNESS_MS: Record<'1m' | '1d', number> = {
  '1m': 60_000,
  '1d': 60 * 60_000,
};

/** 원본 일봉 수 — 주·월 봉 N개에 필요한 만큼 + 앞쪽이 잘린 버킷 하나 여유 */
const calendarBaseLimit = (unit: CalendarUnit, limit: number) =>
  (limit + 1) * DAYS_PER_CALENDAR_BAR[unit] + DAYS_PER_CALENDAR_BAR[unit];

/**
 * 일봉 → 주·월 봉. 받은 일봉이 한도에 걸려 **맨 앞 버킷이 잘렸을 수 있으면 버린다** — 월요일부터가 아닌 주봉,
 * 1일부터가 아닌 월봉이 섞이면 그 봉의 시가·거래량이 틀린다. 과거 스크롤도 같은 규칙이라 경계가 깔끔하게 이어진다.
 */
function toCalendarBars(daily: Candle[], symbol: string, unit: CalendarUnit, truncated: boolean): Candle[] {
  const bars = aggregateCalendar(daily, symbol, unit);
  return truncated && bars.length > 1 ? bars.slice(1) : bars;
}

/**
 * 주·월 봉에 쓸 일봉 — **SQLite 캐시를 먼저** 보고 모자란 만큼만 받는다 (v2.20.0).
 * 캐시가 충분하고 구멍이 없으면 최근 한 페이지(200봉)만 갱신한다. 월봉 60개면 일봉 1,300여 개라
 * 매번 전부 받으면 7페이지씩 나간다(MARKET_DATA_CHART 20/s 는 httpClient 가 지킨다).
 */
async function dailyForCalendar(symbol: string, need: number): Promise<Candle[]> {
  const cached = loadCandles(symbol, '1d', need);
  // 구멍 점검: 캐시의 첫~마지막 날 사이 달력일수로 기대하는 거래일 수(연 252/365)보다 10% 넘게 적으면 빈 구간이 있다
  const spanDays = cached.length > 1 ? (cached.at(-1)!.timestamp - cached[0].timestamp) / 86_400_000 : 0;
  const complete = cached.length >= need && cached.length >= spanDays * (252 / 365) * 0.9;
  try {
    const fresh = await fetchCandles(symbol, '1d', complete ? 200 : need);
    if (fresh.length) saveCandles(symbol, '1d', fresh);
  } catch (error) {
    if (!cached.length) throw error;
    console.warn(`[candles] ${symbol} 1d 실시간 조회 실패, 캐시로 주·월 봉을 만든다:`, error);
  }
  return loadCandles(symbol, '1d', need);
}

/**
 * 캔들 조회: SQLite 캐시 우선, 오래됐으면 토스 API 갱신.
 * 5m/15m/30m 은 1분봉을 받아 집계한다. 1w/1M 은 일봉을 **시장 달력**의 주·월로 묶는다(v2.20.0).
 */
export async function getCandles(
  symbol: string,
  timeframe: Timeframe,
  limit: number,
): Promise<Candle[]> {
  const { base, minutes, calendar } = resolveTimeframe(timeframe);

  if (calendar) {
    const need = calendarBaseLimit(calendar, limit);
    const daily = isMockMode() ? mockCandles(symbol, '1d', need) : await dailyForCalendar(symbol, need);
    return toCalendarBars(daily, symbol, calendar, daily.length >= need).slice(-limit);
  }

  // 집계 타임프레임은 배수만큼 원본 캔들이 더 필요하다.
  const baseLimit = minutes > 1 ? limit * minutes : limit;

  // API 키가 없으면 모의 데이터로 UI 를 검증할 수 있게 한다 (캐시에 저장하지 않는다).
  if (isMockMode()) {
    const rows = mockCandles(symbol, base, baseLimit);
    return minutes > 1 ? aggregateCandles(rows, minutes).slice(-limit) : rows;
  }

  const latest = latestCandleTimestamp(symbol, base);
  const isFresh = latest !== null && Date.now() - latest < FRESHNESS_MS[base];
  const cached = loadCandles(symbol, base, baseLimit);

  if (!isFresh || cached.length < baseLimit) {
    // 실시간 조회가 막혀도(API 장애·IP 차단) 캐시가 있으면 그걸로 그린다 —
    // 여기서 그냥 던지면 이미 받아 둔 수천 봉을 두고도 차트가 통째로 빈다.
    // 캐시가 아예 없을 때만 원래 에러를 올려 보낸다. (summaryService 와 같은 방침)
    try {
      const fresh = await fetchCandles(symbol, base, baseLimit);
      if (fresh.length) saveCandles(symbol, base, fresh);
    } catch (error) {
      if (!cached.length) throw error;
      console.warn(`[candles] ${symbol} ${base} 실시간 조회 실패, 캐시 사용:`, error);
    }
  }

  const rows = loadCandles(symbol, base, baseLimit);
  if (minutes > 1) return aggregateCandles(rows, minutes).slice(-limit);
  return rows.slice(-limit);
}

/**
 * 지정 시각 이전의 과거 캔들 (차트를 왼쪽으로 스크롤할 때 이어 받는다).
 *
 * 토스는 일봉을 1990년까지(약 9,200봉) 보유하지만 1분봉은 3일치뿐이다.
 * 더 없으면 빈 배열이 오고, 호출부는 그걸로 "끝"을 판단한다.
 */
export async function getCandlesBefore(
  symbol: string,
  timeframe: Timeframe,
  beforeMs: number,
  limit: number,
): Promise<Candle[]> {
  const { base, minutes, calendar } = resolveTimeframe(timeframe);
  const baseLimit = calendar ? calendarBaseLimit(calendar, limit) : minutes > 1 ? limit * minutes : limit;

  if (isMockMode()) {
    // 모의 모드에서는 과거를 무한히 만들지 않는다.
    return [];
  }

  // 과거 구간도 마찬가지다. 조회가 막히면 캐시에 남아 있는 그 구간을 돌려준다 —
  // 무한 스크롤이 에러로 끊기는 것보다 있는 만큼 보여 주는 편이 낫다.
  let fresh: Candle[];
  try {
    fresh = await fetchCandlesBefore(symbol, base, beforeMs, baseLimit);
    if (fresh.length) saveCandles(symbol, base, fresh);
  } catch (error) {
    fresh = loadCandlesBefore(symbol, base, beforeMs, baseLimit);
    if (!fresh.length) throw error;
    console.warn(`[candles] ${symbol} ${base} 과거 구간 조회 실패, 캐시 사용:`, error);
  }

  if (calendar) {
    // beforeMs 는 화면의 가장 오래된 주·월 봉 = 그 버킷의 첫 일봉이라, 그 앞 일봉은 전부 이전 버킷이다.
    // 같은 버킷의 일봉이 섞여 들어오지 않게 한 번 더 거른다(버킷 시작이 휴장일 다음 날인 경우 등).
    const edgeKey = calendarKey(beforeMs, symbol, calendar);
    const older = fresh.filter((c) => calendarKey(c.timestamp, symbol, calendar) !== edgeKey);
    return toCalendarBars(older, symbol, calendar, fresh.length >= baseLimit);
  }
  return minutes > 1 ? aggregateCandles(fresh, minutes) : fresh;
}
