import type { BaseTimeframe, Candle, Orderbook, Price } from '../../types/toss';
import { tossGet } from './httpClient';

/**
 * 시세 / 호가 / 캔들 조회.
 *
 * 응답 스키마는 실제 API 응답으로 확인했다 (`npm run probe` 로 언제든 다시 확인 가능).
 * - 숫자는 모두 **문자열**로 온다: "306", "28229375"
 * - timestamp 는 ISO 8601 + KST 오프셋: "2026-08-14T13:00:00.000+09:00"
 * - 캔들은 **최신 → 과거** 순으로 온다
 */

type Raw = Record<string, unknown>;

/** 문자열로 오는 숫자를 안전하게 변환 */
function num(source: Raw, key: string): number {
  const value = source[key];
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') return Number(value);
  return NaN;
}

/** ISO 8601 문자열 → epoch ms */
function toEpochMs(value: unknown): number {
  if (typeof value === 'number') return value < 1e12 ? value * 1000 : value;
  if (typeof value === 'string') return Date.parse(value);
  return NaN;
}

interface CandlesResponse {
  result?: {
    candles?: Raw[];
    /** 다음 페이지 조회용 커서 (더 과거 데이터) */
    nextBefore?: string;
  };
}

/** 한 번에 받을 수 있는 최대 캔들 수 (API 제약: count 는 1~200) */
const MAX_COUNT_PER_REQUEST = 200;

/** 페이지 하나를 조회한다. `before` 를 주면 그 시각 **이전** 데이터를 돌려준다. */
async function fetchCandlePage(
  symbol: string,
  timeframe: BaseTimeframe,
  count: number,
  before?: string,
): Promise<{ candles: Candle[]; nextBefore?: string }> {
  const payload = await tossGet<CandlesResponse>(
    '/api/v1/candles',
    { symbol, interval: timeframe, count, before },
    'MARKET_DATA_CHART',
  );

  const candles = (payload.result?.candles ?? [])
    .map(
      (row): Candle => ({
        timestamp: toEpochMs(row.timestamp),
        open: num(row, 'openPrice'),
        high: num(row, 'highPrice'),
        low: num(row, 'lowPrice'),
        close: num(row, 'closePrice'),
        volume: num(row, 'volume'),
      }),
    )
    .filter((candle) => Number.isFinite(candle.timestamp) && Number.isFinite(candle.close));

  return { candles, nextBefore: payload.result?.nextBefore };
}

/**
 * 지정한 시각 **이전**의 과거 캔들만 가져온다 (차트를 과거로 스크롤할 때).
 * 더 이상 데이터가 없으면 빈 배열을 돌려준다.
 */
export async function fetchCandlesBefore(
  symbol: string,
  timeframe: BaseTimeframe,
  beforeMs: number,
  limit = 200,
): Promise<Candle[]> {
  const collected: Candle[] = [];
  let before = new Date(beforeMs).toISOString();

  while (collected.length < limit) {
    const remaining = Math.min(MAX_COUNT_PER_REQUEST, limit - collected.length);
    const page = await fetchCandlePage(symbol, timeframe, remaining, before);

    if (!page.candles.length) break;
    collected.push(...page.candles);

    if (!page.nextBefore) break;
    before = page.nextBefore;
  }

  return collected.sort((a, b) => a.timestamp - b.timestamp);
}

/**
 * 캔들 조회.
 *
 * - 토스가 지원하는 주기는 1m 과 1d 뿐이다 (그 외는 400).
 *   5·15·30분봉은 1분봉을 집계해서 만든다 — `utils/candleAggregator.ts`
 * - 한 요청당 최대 200개라, 그보다 많이 필요하면 `nextBefore` 커서로 과거 페이지를 이어 받는다.
 */
export async function fetchCandles(
  symbol: string,
  timeframe: BaseTimeframe,
  limit = 300,
): Promise<Candle[]> {
  const collected: Candle[] = [];
  let before: string | undefined;

  while (collected.length < limit) {
    const remaining = Math.min(MAX_COUNT_PER_REQUEST, limit - collected.length);
    const page = await fetchCandlePage(symbol, timeframe, remaining, before);

    if (!page.candles.length) break;
    collected.push(...page.candles);

    // 커서가 없으면 더 과거 데이터가 없다는 뜻이다.
    if (!page.nextBefore) break;
    before = page.nextBefore;
  }

  // 응답은 최신순이므로 차트가 쓰는 오름차순으로 뒤집는다.
  return collected.sort((a, b) => a.timestamp - b.timestamp);
}

interface PricesResponse {
  result?: Raw[];
}

/**
 * 현재가 조회. 파라미터는 `symbols` (복수형)이고 결과도 배열이다.
 *
 * 응답에는 전일 대비 변동이 없다 (`{symbol, timestamp, lastPrice, currency}`).
 * 변동액·변동률은 호출부에서 전일 종가로 계산한다 — `server/index.ts` 참고.
 */
export async function fetchPrice(symbol: string): Promise<Price> {
  const payload = await tossGet<PricesResponse>(
    '/api/v1/prices',
    { symbols: symbol },
    'MARKET_DATA',
  );

  const row = payload.result?.find((item) => item.symbol === symbol) ?? payload.result?.[0] ?? {};

  return {
    symbol,
    close: num(row, 'lastPrice'),
    change: 0,
    changeRate: 0,
    volume: 0,
    fetchedAt: toEpochMs(row.timestamp) || Date.now(),
  };
}

interface OrderbookResponse {
  result?: {
    timestamp?: string;
    asks?: Raw[];
    bids?: Raw[];
  };
}

/**
 * 호가 조회. 파라미터는 `symbol` (단수형)이다.
 *
 * 실제 응답으로 확인한 레벨 구조 (2026-08 기준):
 *   { "price": "305.36", "volume": "6" }   ← 수량 키는 quantity 가 아니라 **volume**
 *
 * 장 마감 중에는 asks/bids 가 빈 배열로 온다.
 */
export async function fetchOrderbook(symbol: string): Promise<Orderbook> {
  const payload = await tossGet<OrderbookResponse>(
    '/api/v1/orderbook',
    { symbol },
    'MARKET_DATA',
  );

  const levels = (rows: Raw[] | undefined) =>
    (rows ?? [])
      .map((row) => ({
        price: num(row, 'price'),
        quantity: num(row, 'volume'),
      }))
      .filter((level) => Number.isFinite(level.price));

  return {
    symbol,
    asks: levels(payload.result?.asks).sort((a, b) => a.price - b.price),
    bids: levels(payload.result?.bids).sort((a, b) => b.price - a.price),
    fetchedAt: toEpochMs(payload.result?.timestamp) || Date.now(),
  };
}

