/**
 * 전 거래일 종가 — 관심 목록 시세(`quoteService`) · 종목 지도(`heatmap`) · 차트 머리 현재가(`/api/price`)가 함께 쓴다 (v2.18.0 → v2.44.3).
 *
 * 기준은 **날짜**다 — 「오늘(그 종목 시장 날짜) 바로 앞의 영업일」 의 봉 종가. 주말과 확인된 휴장일(`marketCalendar.isMarketClosed`)은 건너뛴다
 * (확인 범위 밖은 주말만 — 달력 규칙 그대로).
 *
 * ⚠️ v2.44.3 까지의 버그: "오늘보다 앞선 마지막 캐시 봉" 을 썼고, 캐시가 5일보다 오래됐을 때만 다시 받았다. 그래서 캐시에 **어제 봉이 아직 없고
 *    그저께 봉까지만** 있으면 그저께 종가를 전일 종가로 썼다 — 등락률이 이틀치(SK하이닉스 −10% 가 −21%)로 보였고, 그 값을 하루 동안 기억했다.
 *    (v2.44.0 데이터 정리로 자동매매가 모두 꺼진 뒤 일봉을 받는 일이 줄어 드러났다.)
 * ⚠️ 토스 `/prices` · `/price-limits` · `/stocks` 응답에는 전일 종가·전일 대비 칸이 없다(2026-10-15 실제 응답 확인) — 일봉에서 구한다.
 *
 * - 종목·시장 날짜마다 **한 번 일봉을 새로 받는다**(`getCandles` — 마지막 캐시 봉부터 겹쳐 다시 받으므로 장중에 캐시된 어제 봉도 최종 종가로 바뀐다).
 *   캐시에 그 날짜 봉이 있어도 받는다: 어제 장중에 캐시된 봉이면 종가가 마감 값이 아니다(봉마다 받은 시각을 남기지 않아 구분할 수 없다).
 * - 그 날짜 봉이 있을 때만 값을 낸다. 없으면 **null**(화면 「—」) — 틀린 숫자보다 빈칸이 낫다. 그저께 값으로 대신하지 않는다.
 * - 기억(`memo`)은 새로 받은 뒤 그 날짜 봉을 찾았을 때만. 받기에 실패했거나 봉이 없으면 기억하지 않고 `RETRY_MS` 뒤에 다시 받는다.
 */

import { getCandles } from './candleService';
import { loadCandles } from './db';
import { isMarketClosed } from './marketCalendar';
import { marketOf } from './marketHours';
import { marketDate } from '../src/utils/marketDate';

/** 다시 받기 실패·봉 없음일 때 다음 시도까지 — 1초 폴링마다 캔들 요청이 나가지 않게 */
const RETRY_MS = 5 * 60_000;

const memo = new Map<string, number>();
const tried = new Map<string, number>();
const inflight = new Map<string, Promise<number | null>>();
const warned = new Set<string>();

/** 일봉 다시 받기 — 점검이 바꿔 끼울 수 있게 한 자리(서버는 늘 `getCandles`) */
let refresh: (symbol: string) => Promise<unknown> = (symbol) => getCandles(symbol, '1d', 5);
export function setCandleRefreshForTest(fn: ((symbol: string) => Promise<unknown>) | null): void {
  refresh = fn ?? ((symbol) => getCandles(symbol, '1d', 5));
}

/** YYYY-MM-DD 하루 전 (날짜 산수) */
function dayBefore(day: string): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

/** 그 종목 시장에서 `day` 바로 앞의 영업일 — 주말·확인된 휴장일을 건너뛴다 */
export function previousTradingDay(symbol: string, day: string): string {
  const market = marketOf(symbol);
  let d = dayBefore(day);
  for (let i = 0; i < 15 && isMarketClosed(market, d); i++) d = dayBefore(d);
  return d;
}

/** 캐시에서 정확히 그 날짜의 봉 종가 */
function closeOn(symbol: string, day: string): number | null {
  const bar = loadCandles(symbol, '1d', 10).find((c) => marketDate(c.timestamp, symbol) === day);
  return bar && bar.close > 0 ? bar.close : null;
}

export async function previousClose(symbol: string, now = Date.now()): Promise<number | null> {
  const today = marketDate(now, symbol);
  const key = `${symbol}|${today}`;
  const hit = memo.get(key);
  if (hit !== undefined) return hit;
  const expected = previousTradingDay(symbol, today);

  // 최근에 시도했는데 못 구했으면 그사이에는 캐시만 본다(다시 받지 않는다)
  const last = tried.get(key);
  if (last !== undefined && Date.now() - last < RETRY_MS) return closeOn(symbol, expected);

  let pending = inflight.get(key);
  if (!pending) {
    pending = (async () => {
      tried.set(key, Date.now());
      let refreshed = false;
      try {
        await refresh(symbol);
        refreshed = true;
      } catch (e) {
        console.warn(`[previousClose] ${symbol} 일봉 다시 받기 실패:`, e instanceof Error ? e.message : e);
      }
      const value = closeOn(symbol, expected);
      if (value !== null && refreshed) {
        memo.set(key, value);
        tried.delete(key);
        if (memo.size > 2000) for (const k of memo.keys()) if (!k.endsWith(`|${today}`)) memo.delete(k);
      } else if (value === null && !warned.has(`${key}|${expected}`)) {
        warned.add(`${key}|${expected}`);
        console.warn(`[previousClose] ${symbol} 전 거래일(${expected}) 봉이 없어 등락률을 비웁니다`);
      }
      return value;
    })().finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }
  return pending;
}

/** 점검(`npm run prevclose:test`)용 — 기억·시도 기록을 비운다 */
export function resetPreviousCloseForTest(): void {
  memo.clear();
  tried.clear();
  inflight.clear();
  warned.clear();
}
