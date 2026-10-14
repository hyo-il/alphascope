/**
 * 정규장 열림 판정 — **한 곳** (v2.44.0 국내 추가 · 휴장일 확인).
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

/** 그 시장이 지금 열려 있나 — 휴장일(주말 포함)이면 닫힘 */
export function isMarketOpen(market: CalendarMarket, now = new Date()): boolean {
  const { day, minutes } = localParts(market, now);
  if (isMarketClosed(market, day)) return false;
  return minutes >= SESSION[market].open && minutes < SESSION[market].close;
}

export const marketOf = (symbol: string): CalendarMarket => (isKrSymbol(symbol) ? 'KR' : 'US');

/** 종목의 시장이 지금 열려 있나 */
export const isSymbolMarketOpen = (symbol: string, now = new Date()): boolean => isMarketOpen(marketOf(symbol), now);

/** 미국 정규장 — 예전 이름 (쓰는 곳이 남아 있다) */
export function isUsMarketOpen(now = new Date()): boolean {
  return isMarketOpen('US', now);
}
