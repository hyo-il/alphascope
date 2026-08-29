import type { StockSearchResult } from '../src/types/toss';
import { tossGet } from '../src/services/toss/httpClient';
import { getDb } from './db';

/**
 * 전종목 카탈로그 — 한글 종목명 검색을 위한 로컬 캐시.
 *
 * 토스 API 의 `symbol` 은 `^[A-Za-z0-9.\-]+$` 만 허용해서 "삼성전자" 를 그대로 보내면 실패한다.
 * 그래서 전종목 목록을 받아 두고, 이름으로 찾아 심볼(005930)로 바꿔 준다.
 *
 * `/api/v1/stocks/all` 은 Rate Limit 이 1/s 이라 시장당 1초 간격으로 받고, SQLite 에 캐시한다.
 */

const MARKETS = ['KOSPI', 'KOSDAQ', 'NASDAQ', 'NYSE', 'AMEX'] as const;
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

type Raw = Record<string, unknown>;

interface StocksAllResponse {
  result?: Raw[];
}

function str(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** 마지막 갱신 시각 (없으면 null) */
function lastUpdatedAt(): number | null {
  const row = getDb()
    .prepare(`SELECT MAX(updated_at) AS at FROM stock_catalog`)
    .get() as { at: string | null } | undefined;
  return row?.at ? Date.parse(row.at) : null;
}

export function catalogSize(): number {
  const row = getDb().prepare(`SELECT COUNT(*) AS n FROM stock_catalog`).get() as { n: number };
  return row?.n ?? 0;
}

/**
 * 전종목 목록을 받아 캐시한다.
 * 이미 신선한 캐시가 있으면 건너뛴다 (강제하려면 refresh=true).
 */
export async function refreshCatalog(refresh = false): Promise<number> {
  const updatedAt = lastUpdatedAt();
  if (!refresh && updatedAt && Date.now() - updatedAt < CACHE_TTL_MS && catalogSize() > 0) {
    return catalogSize();
  }

  const db = getDb();
  const upsert = db.prepare(
    `INSERT INTO stock_catalog (symbol, name, english_name, market, updated_at)
     VALUES (@symbol, @name, @english_name, @market, @updated_at)
     ON CONFLICT(symbol) DO UPDATE SET
       name = excluded.name,
       english_name = excluded.english_name,
       market = excluded.market,
       updated_at = excluded.updated_at`,
  );

  const now = new Date().toISOString();

  for (const market of MARKETS) {
    try {
      const payload = await tossGet<StocksAllResponse>(
        '/api/v1/stocks/all',
        { market },
        'STOCK_ALL',
      );

      const rows = (payload.result ?? [])
        .map((row) => ({
          symbol: str(row.symbol),
          name: str(row.name),
          english_name: str(row.englishName),
          market,
          updated_at: now,
        }))
        .filter((row) => row.symbol);

      db.transaction((items: typeof rows) => {
        for (const item of items) upsert.run(item);
      })(rows);
    } catch (e) {
      // 한 시장이 실패해도 나머지는 채운다.
      console.error(`[catalog] ${market} 조회 실패:`, e instanceof Error ? e.message : e);
    }

    // STOCK_ALL 은 초당 1회 — 다음 시장 전에 여유를 둔다.
    await sleep(1100);
  }

  return catalogSize();
}

/**
 * 종목 검색 — 심볼·한글명·영문명 어디든 일치하면 찾는다.
 * 정확히 일치하는 심볼을 맨 앞에 두고, 그 다음 앞부분 일치, 나머지 순으로 정렬한다.
 */
export function searchStocks(query: string, limit = 12): StockSearchResult[] {
  const q = query.trim();
  if (!q) return [];

  const upper = q.toUpperCase();
  const like = `%${q}%`;

  return getDb()
    .prepare(
      `SELECT symbol, name, english_name AS englishName, market
         FROM stock_catalog
        WHERE symbol = ?
           OR symbol LIKE ?
           OR name LIKE ?
           OR english_name LIKE ?
        ORDER BY
          CASE WHEN symbol = ? THEN 0
               WHEN symbol LIKE ? THEN 1
               WHEN name LIKE ? THEN 2
               ELSE 3 END,
          LENGTH(name),
          symbol
        LIMIT ?`,
    )
    .all(upper, `${upper}%`, like, like, upper, `${upper}%`, `${q}%`, limit) as StockSearchResult[];
}

/** 심볼 하나의 정보 (헤더에 종목명을 띄울 때 쓴다) */
/**
 * 여러 심볼의 이름을 한 번에 — 목록 화면이 종목마다 따로 묻지 않도록.
 *
 * 전종목(약 14,700건)을 통째로 내려 주지 않는 이유: 화면에 보이는 종목은 많아야
 * 수십 개라, 전체를 받으면 앱 시작마다 수백 KB 를 낭비한다.
 */
export function findNames(symbols: string[]): Record<string, string> {
  const wanted = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  if (!wanted.length) return {};

  const placeholders = wanted.map(() => '?').join(',');
  const rows = getDb()
    .prepare(`SELECT symbol, name FROM stock_catalog WHERE symbol IN (${placeholders})`)
    .all(...wanted) as { symbol: string; name: string }[];

  const names: Record<string, string> = {};
  for (const row of rows) if (row.name) names[row.symbol] = row.name;
  return names;
}

export function findStock(symbol: string): StockSearchResult | null {
  const row = getDb()
    .prepare(
      `SELECT symbol, name, english_name AS englishName, market
         FROM stock_catalog WHERE symbol = ?`,
    )
    .get(symbol.toUpperCase()) as StockSearchResult | undefined;
  return row ?? null;
}
