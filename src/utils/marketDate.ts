/**
 * 봉 timestamp → **그 시장의** 거래일 문자열(YYYY-MM-DD).
 *
 * ⚠️ `new Date(ts).toISOString().slice(0, 10)` 을 쓰지 않는다. 일봉 timestamp 는
 * **거래소 현지 자정**이다 — 미국은 ET 자정(04:00/05:00 UTC)이라 UTC 날짜와 우연히 같지만,
 * 한국은 KST 자정 = **전날 15:00 UTC** 라 UTC 로 자르면 하루 앞당겨진다.
 * 실제로 000660·005930 의 BUY 날짜가 일요일(2026-07-26·07-05)로 찍혔다 (v2.14.0).
 *
 * 서버(진단·급등·Gemini 프롬프트)와 화면이 함께 쓴다 — 변환을 여러 곳에 두면 또 갈라진다.
 */

export type MarketTimeZone = 'Asia/Seoul' | 'America/New_York';

/** 토스의 국내 종목 심볼은 6자리 숫자다 (005930). 그 밖은 미국으로 본다. */
export function marketTimeZone(symbol: string): MarketTimeZone {
  return /^\d{6}$/.test(symbol) ? 'Asia/Seoul' : 'America/New_York';
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
