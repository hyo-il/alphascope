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
import { unconfirmedDailyTimestamps } from '../db';
import { dailyCloseOffsetMs } from '../../src/utils/marketBar';
import { isKrSymbol, MARKET_REF } from '../../src/utils/market';
import type { CalendarMarket } from '../marketCalendar';
import type { MarketRefData } from './engine';

// 시장 → 기준 ETF 표는 화면 문장과 같이 쓰려고 `src/utils/market.ts` 한 곳에 둔다
export { MARKET_REF };

export const marketOfSymbol = (symbol: string): CalendarMarket => (isKrSymbol(symbol) ? 'KR' : 'US');

/** 판단용으로 받는 시장 기준 일봉 — 200일선 + 여유(종목 판단 `JUDGE_CANDLE_LIMIT` 과 같은 300) */
export const MARKET_REF_LIMIT = 300;

/** 시장 기준 일봉(끝난 봉) + 지표. 받기 실패 · 봉 없음이면 null — 거름망은 「시장 데이터 없음」 으로 사지 않는다 */
export async function loadMarketRef(market: CalendarMarket, now = Date.now(), limit = MARKET_REF_LIMIT): Promise<MarketRefData | null> {
  const { symbol, name } = MARKET_REF[market];
  try {
    const all = completedDaily(await getCandles(symbol, '1d', limit), symbol, now);
    // 끝나지 않은 채 저장된 봉(v2.51.1)은 뺀다 — 그날은 「시장 데이터 없음」 이 되고 다음 틱에 다시 받는다(끝나지 않은 값으로 판정하지 않는다)
    const bad = all.length ? new Set(unconfirmedDailyTimestamps(symbol, all[0].timestamp, dailyCloseOffsetMs(symbol))) : new Set<number>();
    // 마지막이 아닌 봉이 비면 200일선이 이어지지 않은 봉으로 계산된다 — 그런 날은 통째로 「시장 데이터 없음」(다시 시도)
    if (bad.size && all.slice(0, -1).some((c) => bad.has(c.timestamp))) return null;
    const candles = bad.size ? all.filter((c) => !bad.has(c.timestamp)) : all;
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

/** 시험 전용 — 받기를 바꿔치기한다(횟수 세기 · 실패 흉내). null 이면 원래대로 */
let loadForTest: typeof loadMarketRef | null = null;
export function setMarketRefLoadForTest(fn: typeof loadMarketRef | null): void {
  loadForTest = fn;
}

/**
 * 「시장 데이터 없음」 뒤 다시 받기 간격 (v2.51.1 — 사용자 결정: 그날 다시 시도, 토스 호출 한도 보호).
 * 계좌 판단이 「시장 데이터 없음」 을 내면 `markMarketRefMiss` — 그 뒤 5분 동안은 그 시장 기준을 받지 않고 바로 null(다시 「시장 데이터 없음」).
 * 그 시장 종목이 시장 필터를 지나면(받은 데이터로 판정) `clearMarketRefMiss`. 서버를 다시 켜면 비워진다(곧바로 한 번 다시 받는다).
 */
export const MARKET_REF_RETRY_MS = 5 * 60_000;
const missAt = new Map<CalendarMarket, number>();
/** 아직 기다리는 중이 아니면 지금을 실패 시각으로(기다리는 동안 다시 표시해도 시작 시각을 늦추지 않는다 — 늦추면 영영 다시 받지 않는다) */
export function markMarketRefMiss(market: CalendarMarket, now = Date.now()): void {
  const at = missAt.get(market);
  if (at == null || now - at >= MARKET_REF_RETRY_MS) missAt.set(market, now);
}
export function clearMarketRefMiss(market: CalendarMarket): void {
  missAt.delete(market);
}
/** 시험 전용 */
export function resetMarketRefMissForTest(): void {
  missAt.clear();
}

/** 한 판단 안에서 시장마다 한 번만 받는다(같은 시장 요청은 같은 Promise). `backoff` = 실패 뒤 5분 간격 지키기(백테스트는 끈다) */
export function marketRefLoader(
  now = Date.now(),
  load: typeof loadMarketRef = loadForTest ?? loadMarketRef,
  limit = MARKET_REF_LIMIT,
  backoff = true,
): MarketRefLoader {
  const cache = new Map<CalendarMarket, Promise<MarketRefData | null>>();
  const counts: Record<string, number> = {};
  return {
    get(market) {
      let p = cache.get(market);
      if (!p) {
        const at = missAt.get(market);
        if (backoff && at != null && now - at < MARKET_REF_RETRY_MS) {
          p = Promise.resolve(null); // 기다리는 중 — 받지 않는다
        } else {
          counts[market] = (counts[market] ?? 0) + 1;
          p = load(market, now, limit);
        }
        cache.set(market, p);
      }
      return p;
    },
    fetched: () => ({ ...counts }),
  };
}
