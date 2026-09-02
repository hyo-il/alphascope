import type { Quote } from '../src/types/toss';
import { getCandles } from './candleService';
import { loadCandles } from './db';
import { isMockMode, mockPrice } from './mockData';
import { findStock } from './stockCatalog';
import { currencyOf } from '../src/utils/formatters';
import { tossGet } from '../src/services/toss/httpClient';

/**
 * 관심 목록·최근 조회용 **가벼운** 다종목 시세.
 *
 * `/api/summary` 는 지표 계산과 yfinance 까지 거쳐 무겁다. 목록에 필요한 것은
 * 현재가와 전일 대비뿐이므로, 토스 `/prices` 의 복수 심볼 조회를 한 번만 쓴다.
 */

type Raw = Record<string, unknown>;

/** 표기 통화 — 목록 화면이 국내 종목을 $ 로 적지 않게 시장으로 판별한다. */
function currencyFor(symbol: string): 'KRW' | 'USD' {
  return currencyOf(findStock(symbol)?.market);
}

function num(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return NaN;
}

/** 전일 종가 — 캐시된 일봉을 쓰고, 없으면 한 번 받아 채운다. */
async function previousClose(symbol: string): Promise<number | null> {
  let daily = loadCandles(symbol, '1d', 2);
  if (daily.length < 2) {
    try {
      await getCandles(symbol, '1d', 5);
      daily = loadCandles(symbol, '1d', 2);
    } catch {
      return null;
    }
  }
  return daily.length >= 2 ? daily[0].close : null;
}

export async function fetchQuotes(symbols: string[]): Promise<Quote[]> {
  if (!symbols.length) return [];

  if (isMockMode()) {
    return symbols.map((symbol) => {
      const price = mockPrice(symbol);
      return {
        symbol,
        price: price.close,
        changeRate: price.changeRate,
        currency: currencyFor(symbol),
        error: null,
      };
    });
  }

  // 토스 /prices 는 symbols(복수)를 지원한다 — 목록 전체를 한 번에 받는다.
  let rows: Raw[] = [];
  try {
    const payload = await tossGet<{ result?: Raw[] }>(
      '/api/v1/prices',
      { symbols: symbols.join(',') },
      'MARKET_DATA',
    );
    rows = payload.result ?? [];
  } catch (e) {
    // 실시간 조회가 막혀도(API 장애·IP 차단) 캐시된 일봉이 있으면 그 종가를 보여 준다.
    // 다만 지연된 값이므로 stale 로 표시해, 화면이 실시간인 척하지 않게 한다.
    const message = e instanceof Error ? e.message : String(e);
    return symbols.map((symbol) => {
      const daily = loadCandles(symbol, '1d', 2);
      const last = daily.at(-1);
      if (!last) return { symbol, price: null, changeRate: null, error: message };
      const previous = daily.length >= 2 ? daily[0].close : null;
      return {
        symbol,
        price: last.close,
        changeRate: previous ? ((last.close - previous) / previous) * 100 : null,
        currency: currencyFor(symbol),
        stale: true,
        error: message,
      };
    });
  }

  return Promise.all(
    symbols.map(async (symbol): Promise<Quote> => {
      const row = rows.find((item) => item.symbol === symbol);
      const price = row ? num(row.lastPrice) : NaN;

      if (!Number.isFinite(price)) {
        return { symbol, price: null, changeRate: null, error: '시세 없음' };
      }

      const previous = await previousClose(symbol);
      return {
        symbol,
        price,
        changeRate: previous ? ((price - previous) / previous) * 100 : null,
        currency: currencyFor(symbol),
        error: null,
      };
    }),
  );
}
