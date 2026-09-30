/**
 * 전 거래일 종가 — 관심 목록 시세(`quoteService`)와 종목 지도(`heatmap`)가 함께 쓴다 (v2.18.0).
 *
 * ⚠️ "캐시의 끝에서 두 번째 봉" 으로 잡지 않는다. 오늘 봉이 아직 캐시에 없으면(국내 장중 오전 등)
 * 그 봉은 **그저께**라 등락률이 틀린다 — 실제로 삼성전자가 −0.18% 인데 +1.40% 로 보였다.
 * 기준은 날짜다: **시장 날짜가 오늘보다 앞선 마지막 봉**의 종가.
 *
 * 종목·시장 날짜별로 한 번만 구한다(하루 안에는 바뀌지 않는다). 일봉 캐시는 하루의 첫 1시간이 지나면
 * '오래됨' 으로 보고 다시 받으므로, 매번 `getCandles` 를 부르면 1초 폴링마다 캔들 요청이 나간다.
 */

import { getCandles } from './candleService';
import { loadCandles } from './db';
import { marketDate } from '../src/utils/marketDate';

const memo = new Map<string, number>();

export async function previousClose(symbol: string, now = Date.now()): Promise<number | null> {
  const today = marketDate(now, symbol);
  const key = `${symbol}|${today}`;
  const hit = memo.get(key);
  if (hit !== undefined) return hit;
  let candles = loadCandles(symbol, '1d', 5);
  // 캐시의 마지막 봉이 5일(주말·연휴 여유)보다 오래됐으면 새로 받는다
  const lastDay = candles.at(-1) ? marketDate(candles.at(-1)!.timestamp, symbol) : null;
  const staleLimit = new Date(Date.parse(`${today}T12:00:00Z`) - 5 * 86_400_000).toISOString().slice(0, 10);
  if (!lastDay || lastDay < staleLimit) {
    candles = await getCandles(symbol, '1d', 5).catch(() => candles);
  }
  const value = candles.filter((c) => marketDate(c.timestamp, symbol) < today).at(-1)?.close ?? null;
  // 실패(null)는 기억하지 않는다 — 하루 종일 비어 있게 된다
  if (value !== null) {
    memo.set(key, value);
    if (memo.size > 2000) for (const k of memo.keys()) if (!k.endsWith(`|${today}`)) memo.delete(k);
  }
  return value;
}
