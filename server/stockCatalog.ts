import type { StockSearchResult } from '../src/types/toss';
import { tossGet } from '../src/services/toss/httpClient';
import { getDb } from './db';
import { englishNameOf, symbolsByAlias, STOCK_ALIASES } from './stockAliases';
import { hasHangul, isChoseongOnly, toChoseong, toJamo } from './hangul';

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

  invalidateJamoIndex();
  return catalogSize();
}

/**
 * 자모 인덱스 — 조합 중인 한글과 초성 검색을 받기 위한 것.
 *
 * 글자 단위 LIKE 만으로는 "애플" 을 치는 도중의 **"애프"** 가 0건이 된다 (`hangul.ts` 참고).
 * 이름을 자모로 펴 두면 `ㅇㅐㅍㅡ` 가 `ㅇㅐㅍㅡㄹ` 의 앞부분이라 그대로 이어진다.
 *
 * 전종목(약 15,000건)을 한 번만 펴서 메모리에 둔다 — 요청마다 펴면 그때마다 15,000번이다.
 * 카탈로그는 하루 한 번 갱신되므로 그때 버린다.
 */
interface JamoEntry {
  row: StockSearchResult;
  /** 이름과 별칭을 **각각** 편 것 — 이어 붙이면 별칭의 앞부분 일치를 잃는다 */
  jamo: string[];
  choseong: string[];
}

let jamoIndex: JamoEntry[] | null = null;

function buildJamoIndex(): JamoEntry[] {
  const rows = getDb()
    .prepare(
      `SELECT symbol, name, english_name AS englishName, market FROM stock_catalog WHERE name <> ''`,
    )
    .all() as StockSearchResult[];

  return rows.map((row) => {
    /*
     * 별칭도 함께 편다 — 카탈로그 이름은 정식 명칭이라 "구글" 로는 "알파벳 A" 를 찾지 못한다.
     * ⚠️ 이름과 별칭을 한 문자열로 이어 붙이지 않는다. 붙이면 "구글"(별칭)이 문자열 중간에
     * 들어가 앞부분 일치로 잡히지 않고, 이름이 우연히 비슷한 종목들 뒤로 밀린다.
     */
    const texts = [row.name, ...(STOCK_ALIASES[row.symbol] ?? [])];
    return { row, jamo: texts.map(toJamo), choseong: texts.map(toChoseong) };
  });
}

function getJamoIndex(): JamoEntry[] {
  if (!jamoIndex) jamoIndex = buildJamoIndex();
  return jamoIndex;
}

/** 카탈로그를 새로 받으면 인덱스도 버린다 */
export function invalidateJamoIndex(): void {
  jamoIndex = null;
}

/**
 * 같은 그룹 안의 순서: 별칭 표에 있는 종목 → 미국 시장 → 짧은 이름.
 *
 * 별칭 표(`stockAliases.ts`)는 **사람들이 실제로 찾는 종목** 목록이다. "ㅁㅅ" 을 친 사람이
 * 찾는 것은 '마스'(MAAS)보다 마이크로소프트일 가능성이 크다 — 이름 길이만으로 줄을 세우면
 * 짧은 이름의 소형주가 늘 위에 온다.
 */
const US_MARKETS = new Set(['NASDAQ', 'NYSE', 'AMEX']);
const usFirst = (a: StockSearchResult, b: StockSearchResult) =>
  Number(!STOCK_ALIASES[a.symbol]) - Number(!STOCK_ALIASES[b.symbol]) ||
  Number(!US_MARKETS.has(a.market)) - Number(!US_MARKETS.has(b.market)) ||
  a.name.length - b.name.length;

/**
 * 자모·초성으로 찾는다. 이름의 **앞부분**이 맞는 것을 먼저, 그다음 중간 일치를 준다 —
 * "애플" 을 쳤는데 "파인애플" 이 위에 오면 안 된다.
 */
function searchByJamo(query: string, limit: number): StockSearchResult[] {
  const index = getJamoIndex();
  const choseongOnly = isChoseongOnly(query);
  const needle = choseongOnly ? toChoseong(query) : toJamo(query);
  if (!needle) return [];

  /*
   * 셋으로 나눈다: 딱 맞음 → 앞부분 일치 → 중간 일치.
   * "마소"(MSFT 의 별칭)처럼 **정확히 같은 이름**은 맨 위여야 한다 — 그렇지 않으면
   * 이름이 짧다는 이유로 엉뚱한 종목("마스")이 위에 온다.
   */
  const exact: StockSearchResult[] = [];
  const starts: StockSearchResult[] = [];
  const contains: StockSearchResult[] = [];

  for (const entry of index) {
    const haystacks = choseongOnly ? entry.choseong : entry.jamo;
    if (haystacks.some((text) => text === needle)) exact.push(entry.row);
    else if (haystacks.some((text) => text.startsWith(needle))) starts.push(entry.row);
    else if (haystacks.some((text) => text.includes(needle))) contains.push(entry.row);
  }

  exact.sort(usFirst);
  starts.sort(usFirst);
  contains.sort(usFirst);
  return [...exact, ...starts, ...contains].slice(0, limit);
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

  /*
   * 별칭 먼저 — 카탈로그의 한글명은 정식 명칭이라 사람들이 부르는 이름과 다르다.
   * "구글" 로는 "알파벳 A"(GOOGL)를 찾을 수 없고, 영문명 컬럼은 비어 있어
   * "apple" 같은 영문 검색도 안 된다. (server/stockAliases.ts 참고)
   */
  const aliasSymbols = symbolsByAlias(q);
  const aliasRows = aliasSymbols.length
    ? (getDb()
        .prepare(
          `SELECT symbol, name, english_name AS englishName, market
             FROM stock_catalog
            WHERE symbol IN (${aliasSymbols.map(() => '?').join(',')})`,
        )
        .all(...aliasSymbols) as StockSearchResult[])
    : [];

  // SQL 은 IN 목록의 순서를 지키지 않는다 — 별칭에 적은 순서(대표 티커 우선)로 되돌린다.
  aliasRows.sort((a, b) => aliasSymbols.indexOf(a.symbol) - aliasSymbols.indexOf(b.symbol));

  const rows = getDb()
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
          /*
           * ⚠️ 같은 순위 안에서는 **미국 종목을 앞에 둔다.** 이 앱은 미국 주식용인데,
           * "엔비디아" 를 치면 NVDA 다음이 전부 국내 엔비디아 관련 ETF 라
           * "한국 ETF 만 나온다" 로 보였다 (실제 신고). 국내 종목을 빼지는 않는다 —
           * 삼성전자도 조회하는 앱이다.
           */
          CASE WHEN market IN ('NASDAQ','NYSE','AMEX') THEN 0 ELSE 1 END,
          LENGTH(name),
          symbol
        LIMIT ?`,
    )
    .all(upper, `${upper}%`, like, like, upper, `${upper}%`, `${q}%`, limit) as StockSearchResult[];

  /*
   * 한글 검색은 자모로 한 번 더 훑는다. LIKE 는 글자가 완성돼야 맞기 때문에,
   * 조합 중인 "애프"(→ 애플)나 초성 "ㅇㅂㄷㅇ"(→ 엔비디아) 이 여기서 살아난다.
   */
  const jamoRows = hasHangul(q) ? searchByJamo(q, limit) : [];

  // 별칭 → SQL → 자모 순으로 앞에 두고, 중복은 뺀다.
  const seen = new Set<string>();
  const merged: StockSearchResult[] = [];
  for (const row of [...aliasRows, ...rows, ...jamoRows]) {
    if (seen.has(row.symbol)) continue;
    seen.add(row.symbol);
    merged.push(row);
  }

  return (
    merged
      .slice(0, limit)
      // 카탈로그의 영문명은 비어 있다 — 별칭에 적어 둔 영문명으로 채운다.
      .map((row) => ({ ...row, englishName: row.englishName || englishNameOf(row.symbol) }))
  );
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
