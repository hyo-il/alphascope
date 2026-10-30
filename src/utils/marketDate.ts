/**
 * 봉 timestamp → **그 시장의** 거래일 문자열(YYYY-MM-DD).
 *
 * ⚠️ `new Date(ts).toISOString().slice(0, 10)` 을 쓰지 않는다. 일봉 timestamp 는
 * **거래소 현지 자정**이다 — 미국은 ET 자정(04:00/05:00 UTC)이라 UTC 날짜와 우연히 같지만,
 * 한국은 KST 자정 = **전날 15:00 UTC** 라 UTC 로 자르면 하루 앞당겨진다.
 * 실제로 000660·005930 의 BUY 날짜가 일요일(2026-07-26·07-05)로 찍혔다.
 *
 * 서버(진단·급등·Gemini 프롬프트)와 화면이 함께 쓴다 — 변환을 여러 곳에 두면 또 갈라진다.
 */

import { isKrSymbol, MARKET_REF } from './market';

export type MarketTimeZone = 'Asia/Seoul' | 'America/New_York';

// 국내 판별은 `utils/market.ts` 한 곳이다.
export function marketTimeZone(symbol: string): MarketTimeZone {
  return isKrSymbol(symbol) ? 'Asia/Seoul' : 'America/New_York';
}

const formatters = new Map<MarketTimeZone, Intl.DateTimeFormat>();

function formatterOf(timeZone: MarketTimeZone): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    // en-CA 는 YYYY-MM-DD 로 적는다
    formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

/** 시장 시간대 기준 날짜 — 한국 = Asia/Seoul, 미국 = America/New_York */
export function marketDate(timestamp: number, symbol: string): string {
  return formatterOf(marketTimeZone(symbol)).format(new Date(timestamp));
}

/** 시장 시간대 기준 월(0~11) — "달이 바뀌는 첫 봉" 판정용 */
export function marketMonth(timestamp: number, symbol: string): number {
  return Number(marketDate(timestamp, symbol).slice(5, 7)) - 1;
}

// ── 장 마감 판정 (AI 채점 기준일) ──────────────────────────────────

/** 정규장 마감 시각(현지, 자정부터 분) — 미국 16:00 ET · 국내 15:30 KST */
export function marketCloseMinutes(symbol: string): number {
  return marketTimeZone(symbol) === 'Asia/Seoul' ? 15 * 60 + 30 : 16 * 60;
}

const clockFormatters = new Map<MarketTimeZone, Intl.DateTimeFormat>();

/** 그 시장 현지 시각(자정부터 분) */
export function marketMinutes(timestamp: number, symbol: string): number {
  const timeZone = marketTimeZone(symbol);
  let formatter = clockFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    clockFormatters.set(timeZone, formatter);
  }
  const [h, m] = formatter.format(new Date(timestamp)).split(':').map(Number);
  return h * 60 + m;
}

/**
 * 종목 지도 · 실시간 순위의 시작 시장 — **한국 시간** 08:00 이상 17:00 미만 = 국내, 나머지 = 미국 (사용자 결정 2026-10-21).
 * - PC 시계의 시간대와 상관없이 한국 시간으로 본다(`marketMinutes` 한 곳 — 국내 종목의 현지 시각).
 * - 시간만 본다 — 주말 · 휴장일은 따지지 않는다(사용자 결정). 장이 열렸는지는 `server/marketHours.ts` 가 따로 판단한다.
 * - 화면을 열 때 한 번만 부른다 — 보는 동안 08:00 · 17:00 이 지나도 시장을 바꾸지 않는다.
 */
export function marketByKstTime(now: Date = new Date()): 'kr' | 'us' {
  const minutes = marketMinutes(now.getTime(), MARKET_REF.KR.symbol);
  return minutes >= 8 * 60 && minutes < 17 * 60 ? 'kr' : 'us';
}

let kstClockFormatter: Intl.DateTimeFormat | null = null;

/** 한국 시각 `HH:MM:SS`(24시간제) — 떠 있는 시계(`common/KstClock`). PC 시계의 시간대와 상관없이 Asia/Seoul */
export function kstClockText(timestamp: number): string {
  kstClockFormatter ??= new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
  return kstClockFormatter.format(new Date(timestamp));
}

/**
 * 「미국 날짜」 표시 — 미국 일정(실적 · FOMC · 옵션 만기 · 미국 휴장)의 날짜는 미국 동부 날짜다(계산 · 「지남」 도 그 날짜로).
 * 화면은 그 날짜 옆에 이 글자를 붙인다(공용 부품 `common/UsDateTag` · 서버 문장(매수 판단 실적 경고)도 같은 글자 — 문구 한 곳).
 */
export const US_DATE_LABEL = '미국 날짜';
export const US_DATE_TIP = '미국 동부 시간 기준 날짜입니다 — 한국 시간으로는 다음 날 새벽일 수 있습니다. 남은 날수와 「지남」 도 미국 날짜로 셉니다.';
