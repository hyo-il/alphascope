/**
 * 국내/미국 판별 — **이 파일 한 곳**이다.
 *
 * 통화(₩/$)·날짜 시간대·빠른매수·서버의 통화 판별이 모두 여기를 부른다.
 * 화면마다 `/^\d{6}$/` 를 따로 적으면 영문이 섞인 국내 코드(`0126Z0` 삼성에피스홀딩스 등
 * 카탈로그에 408개)가 **어떤 화면에서는 ₩, 어떤 화면에서는 $** 로 보인다.
 *
 * 판별 순서: 카탈로그의 시장 정보(KOSPI·KOSDAQ·KR_ETC)를 알면 그것으로, 모르면 심볼 규칙으로.
 * ⚠️ Python(`python/fundamentals.py`)은 이 파일을 부를 수 없어 같은 규칙을 따로 적었다 — 함께 고친다.
 */

export const KR_MARKETS = ['KOSPI', 'KOSDAQ', 'KR_ETC'] as const;

/** 카탈로그 시장이 국내인가 */
export function isKrMarket(market?: string | null): boolean {
  return !!market && (KR_MARKETS as readonly string[]).includes(market);
}

/**
 * 심볼만 보고 국내인가 — 토스의 국내 심볼은 **숫자로 시작하는 6자리**다
 * (005930 처럼 숫자만인 것 + 0126Z0 처럼 영문이 섞인 것). 미국 심볼은 숫자로 시작하지 않는다
 * (카탈로그 0건, 2026-09-29 확인).
 * ⚠️ `/^\d{6}$/` 로 판별하지 말 것 — 영문이 섞인 국내 코드를 미국으로 본다.
 */
export function isKrSymbol(symbol: string): boolean {
  return /^\d[0-9A-Z]{5}$/.test(symbol);
}

/** 국내 종목인가 — 시장을 알면 시장으로, 모르면 심볼 규칙으로 */
export function isKrStock(symbol: string, market?: string | null): boolean {
  return market ? isKrMarket(market) : isKrSymbol(symbol);
}

/** 표기 통화 */
export function currencyOfSymbol(symbol: string, market?: string | null): 'KRW' | 'USD' {
  return isKrStock(symbol, market) ? 'KRW' : 'USD';
}

/**
 * 시장 기준 (거름망 「시장 필터」) — 시장 → 지수를 따라가는 ETF. **이 표 한 곳**을 서버(`server/rules/marketRef.ts` 가 받는다)와
 * 화면 문장(쉬운 말 · 규칙 창 설명)이 같이 쓴다 — 기준 ETF 를 바꾸면 문장도 같이 바뀐다.
 */
export const MARKET_REF = {
  US: { symbol: 'SPY', name: 'SPY', tracks: 'S&P 500' },
  KR: { symbol: '069500', name: 'KODEX 200', tracks: '코스피 200' },
} as const;

/** 이 종목의 시장 기준 */
export const marketRefOfSymbol = (symbol: string) => MARKET_REF[isKrSymbol(symbol) ? 'KR' : 'US'];

/**
 * 종목 지도 · 실시간 순위의 시작 시장 — **한국 시간** 08:00 이상 17:00 미만 = 국내, 나머지 = 미국 (사용자 결정 2026-10-21).
 * - PC 시계의 시간대와 상관없이 Asia/Seoul 로 시 · 분을 구한다.
 * - 시간만 본다 — 주말 · 휴장일은 따지지 않는다(사용자 결정). 장이 열렸는지는 `server/marketHours.ts` 가 따로 판단한다.
 * - 화면을 열 때 한 번만 부른다 — 보는 동안 08:00 · 17:00 이 지나도 시장을 바꾸지 않는다.
 */
const KST_HOUR_MINUTE = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Seoul', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

export function marketByKstTime(now: Date = new Date()): 'kr' | 'us' {
  const parts = KST_HOUR_MINUTE.formatToParts(now);
  const hour = Number(parts.find((p) => p.type === 'hour')?.value);
  const minute = Number(parts.find((p) => p.type === 'minute')?.value);
  const minutes = hour * 60 + minute;
  return minutes >= 8 * 60 && minutes < 17 * 60 ? 'kr' : 'us';
}
