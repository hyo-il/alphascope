/**
 * 시장 기준 (v2.51.0 — 사용자 결정 A-1) — **한 곳**. 거름망 「시장이 200일선 위일 때만 매수」(시장 필터)가 쓴다.
 * 미국 종목 → SPY · 국내 종목 → KODEX 200(069500). 지수를 따라가는 ETF 를 **토스로** 받는다(종목 일봉과 같은 `getCandles` · 캐시 · `completedDaily`).
 * 200일선은 종목과 같은 지표 엔진(`sma200`)으로 낸다.
 *
 * 확인(2026-10-16, 토스 실제 응답): SPY 일봉 8,487개(1993-01-29 부터) · 069500 일봉 5,924개(2002-10-14 부터) — 3년 + 준비 210봉에 충분하다.
 *
 * ⚠️ 한 번의 판단(계좌 한 바퀴 · 매수 판단 실행 · 백테스트)에서 시장 기준은 **시장마다 한 번만** 받는다 — `marketRefLoader()` 를 그 판단에 하나 만들어 같이 쓴다.
 * ⚠️ 시장 필터를 켜지 않은 규칙은 이 파일을 부르지 않는다(받지 않는다 → 예전과 같은 판단·같은 토스 호출).
 */
import { getCandles } from '../candleService';
import { computeIndicators } from '../indicatorService';
import { completedDaily } from './engine';
import { isKrSymbol } from '../../src/utils/market';
import type { CalendarMarket } from '../marketCalendar';
import type { MarketRefData } from './engine';

export const MARKET_REF: Record<CalendarMarket, { symbol: string; name: string }> = {
  US: { symbol: 'SPY', name: 'SPY' },
  KR: { symbol: '069500', name: 'KODEX 200' },
};

export const marketOfSymbol = (symbol: string): CalendarMarket => (isKrSymbol(symbol) ? 'KR' : 'US');

/** 판단용으로 받는 시장 기준 일봉 — 200일선 + 여유(종목 판단 `JUDGE_CANDLE_LIMIT` 과 같은 300) */
export const MARKET_REF_LIMIT = 300;

/** 시장 기준 일봉(끝난 봉) + 지표. 받기 실패 · 봉 없음이면 null — 거름망은 「시장 데이터 없음」 으로 사지 않는다 */
export async function loadMarketRef(market: CalendarMarket, now = Date.now(), limit = MARKET_REF_LIMIT): Promise<MarketRefData | null> {
  const { symbol, name } = MARKET_REF[market];
  try {
    const candles = completedDaily(await getCandles(symbol, '1d', limit), symbol, now);
    if (!candles.length) return null;
    const series = await computeIndicators(candles);
    return { market, symbol, name, candles, series };
  } catch (e) {
    console.warn(`[market-ref] ${name}(${symbol}) 일봉을 받지 못했습니다 — 시장 필터는 「시장 데이터 없음」 으로 사지 않습니다:`, (e as Error).message);
    return null;
  }
}

export interface MarketRefLoader {
  get(market: CalendarMarket): Promise<MarketRefData | null>;
  /** 실제로 받은 횟수(시장별) — 시험용 */
  fetched(): Record<string, number>;
}

/** 한 판단 안에서 시장마다 한 번만 받는다(같은 시장 요청은 같은 Promise) */
export function marketRefLoader(now = Date.now(), load: typeof loadMarketRef = loadMarketRef): MarketRefLoader {
  const cache = new Map<CalendarMarket, Promise<MarketRefData | null>>();
  const counts: Record<string, number> = {};
  return {
    get(market) {
      let p = cache.get(market);
      if (!p) {
        counts[market] = (counts[market] ?? 0) + 1;
        p = load(market, now);
        cache.set(market, p);
      }
      return p;
    },
    fetched: () => ({ ...counts }),
  };
}
