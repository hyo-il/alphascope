/**
 * 정규장 열림 판정 — **한 곳** (미국 · 국내, 휴장일 확인).
 * - 미국: 09:30~16:00 ET, 평일
 * - 국내: 09:00~15:30 KST, 평일
 * - 휴장일: `marketCalendar.isMarketClosed` (토스 휴장 달력 · 미국은 NYSE 표 보완) — 확인 범위 밖은 주말만 쉰다.
 * 종목의 시장은 `isKrSymbol` 하나로 가른다. 계좌 자동매매 스케줄러(`autoTrading/scheduler.ts`)가 쓴다.
 */
import { isMarketClosed, type CalendarMarket } from './marketCalendar';
import { isKrSymbol } from '../src/utils/market';

const SESSION: Record<CalendarMarket, { tz: string; open: number; close: number }> = {
  US: { tz: 'America/New_York', open: 9 * 60 + 30, close: 16 * 60 },
  KR: { tz: 'Asia/Seoul', open: 9 * 60, close: 15 * 60 + 30 },
};

/** 그 시장 시간대의 날짜(YYYY-MM-DD) · 분 */
function localParts(market: CalendarMarket, now: Date): { day: string; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: SESSION[market].tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const hour = Number(get('hour')) % 24;
  return { day: `${get('year')}-${get('month')}-${get('day')}`, minutes: hour * 60 + Number(get('minute')) };
}

/**
 * 휴장일 판단 — 점검(`npm run autotrade:test`)이 휴장일을 넣어 시험할 수 있게 한 자리.
 * ⚠️ 실제 DB 의 휴장 달력을 바꾸지 않으려는 것이다. 서버는 이 함수를 부르지 않는다(늘 `isMarketClosed`).
 */
let closedLookup: typeof isMarketClosed = isMarketClosed;
export function setClosedLookupForTest(fn: typeof isMarketClosed | null): void {
  closedLookup = fn ?? isMarketClosed;
}

/** 그 시장이 지금 열려 있나 — 휴장일(주말 포함)이면 닫힘 */
export function isMarketOpen(market: CalendarMarket, now = new Date()): boolean {
  const { day, minutes } = localParts(market, now);
  if (closedLookup(market, day)) return false;
  return minutes >= SESSION[market].open && minutes < SESSION[market].close;
}

export const marketOf = (symbol: string): CalendarMarket => (isKrSymbol(symbol) ? 'KR' : 'US');

/** 종목의 시장이 지금 열려 있나 */
export const isSymbolMarketOpen = (symbol: string, now = new Date()): boolean => isMarketOpen(marketOf(symbol), now);

/**
 * 지금 「끝나 있어야 하는」 마지막 일봉의 날짜 — 그 시장 날짜로, 오늘 일봉이 끝났으면(`closeOffsetMs` — `marketBar.dailyCloseOffsetMs`) 오늘,
 * 아니면 어제부터 거꾸로 **휴장일(주말 · 확인된 휴장일 — `closedLookup`)을 건너뛴 첫 거래일**. 판단(`rules/judge.judgeOnClose`)은 마지막 끝난 봉이
 * 이 날짜보다 앞이면(받기 실패로 오래된 값만 있음) 판단하지 않고 미룬다. ⚠️ 휴장 달력 확인 범위 밖은 주말만 쉰다(`isMarketClosed`).
 */
export function lastClosedDay(market: CalendarMarket, now: number, closeOffsetMs: number): string {
  const { day, minutes } = localParts(market, new Date(now));
  const back = (d: string) => {
    const t = new Date(`${d}T12:00:00Z`);
    t.setUTCDate(t.getUTCDate() - 1);
    return t.toISOString().slice(0, 10);
  };
  let d = minutes * 60_000 >= closeOffsetMs ? day : back(day);
  // 30일 — 연휴가 길어도 넉넉하다(무한 반복 방지)
  for (let k = 0; k < 30 && closedLookup(market, d); k++) d = back(d);
  return d;
}

/** 그 시장 날짜(day)의 자정 + `offsetMs` 의 시각(ms) — 일봉 timestamp(그 시장 자정)와 같은 기준 */
export function marketDayTime(market: CalendarMarket, day: string, offsetMs: number): number {
  const noon = Date.parse(`${day}T12:00:00Z`);
  const p = localParts(market, new Date(noon));
  const shift = p.minutes - 12 * 60 + (p.day > day ? 1440 : p.day < day ? -1440 : 0); // 그 시장의 UTC 차(분)
  return Date.parse(`${day}T00:00:00Z`) - shift * 60_000 + offsetMs;
}

/**
 * 다음 정규장 시작 시각 — `now` 보다 뒤의 첫 개장. **휴장일을 본다**(확인 범위 밖은 주말만).
 * 개장 시각은 UTC 로 늘 15분 경계라(시간대 차가 정수 시간) 15분씩 넘기며 찾는다. 계좌 자동매매 상태의 「다음 판단」 이 쓴다 — 화면은 계산하지 않는다.
 */
export function nextMarketOpen(market: CalendarMarket, now = new Date()): Date {
  const step = 15 * 60_000;
  let t = Math.floor(now.getTime() / step) * step + step;
  for (let k = 0; k < 4 * 24 * 30; k++, t += step) {
    const at = new Date(t);
    const { day, minutes } = localParts(market, at);
    if (minutes === SESSION[market].open && !closedLookup(market, day)) return at;
  }
  return new Date(t);
}
