/**
 * 국내/미국 판별 — **이 파일 한 곳**이다 (v2.15.0).
 *
 * 통화(₩/$)·날짜 시간대·스윙 카드·빠른매수·서버의 통화 판별이 모두 여기를 부른다.
 * 예전에는 화면마다 `/^\d{6}$/` 를 따로 적어서, 영문이 섞인 국내 코드(`0126Z0` 삼성에피스홀딩스 등
 * 카탈로그에 408개)가 **어떤 화면에서는 ₩, 어떤 화면에서는 $** 로 보였다.
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
