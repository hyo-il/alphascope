/**
 * 종목 지도(히트맵) 데이터 — `GET /api/heatmap?market=us|kr` (v2.18.0).
 *
 * - 대상: `server/data/universe.json` 의 시장별 상위 100 + 그 시장의 관심 종목 — 앱 전체의 "대형주" 정의를 하나로 둔다.
 * - 크기: 유니버스의 시가총액, 없으면 `stock_profiles.market_cap`(실적일 하루 1회 갱신이 함께 채운다).
 * - 색: 당일 등락률 = 토스 `/prices` 현재가(30종목씩 묶어서) ÷ **전 거래일 종가**.
 *   전 거래일 종가는 `previousClose.ts`(관심 목록 시세와 공유 — 종목·시장 날짜별 1회).
 * - 섹터: `stock_profiles.sector`(yfinance). 없으면 '기타' — 처음 한 번은 빠진 종목의 프로필을 뒤에서 채운다.
 * - 응답 전체를 시장별 **60초 캐시**한다 (화면도 60초마다 부른다 — Rate Limit 보호).
 *
 * 기간(v2.19.0): `period=1w|1m|3m` 은 색이 **마지막 완성 종가 ÷ N거래일 전 종가 − 1** 이 된다(5·21·63봉).
 * 종가 기준이라 **종목·시장 날짜·마감 전후별 1회**만 계산한다(오늘 봉은 정규장 마감 뒤에만 완성으로 본다).
 * 응답에 `sectors[]`(섹터 강세 순위)를 붙인다 — ⚠️ **설명용 통계**다. 판정·자동매매에 쓰지 않는다(검증 전).
 *
 * 보기(v2.27.0):
 * - `view=market`(기본) — **유니버스 상위 100 을 그대로 만들어 캐시**하고, 응답할 때 `top`(30·50·100, 기본 50)만큼
 *   유니버스 시총 순으로 잘라 `sectorStats()` 를 다시 낸다. ⚠️ 토스 `/prices`·일봉 호출 수는 N 과 무관하다(언제나 100 기준).
 *   상위 N 밖의 관심 종목은 넣지 않는다(예전에는 100 밖 관심 종목을 더했다) — 그것은 「내 관심 종목」 지도가 맡는다.
 *   상위 N 안의 관심 종목 표시(`watch`)는 캐시가 아니라 응답 때 붙인다(별을 누르면 다음 응답부터 보인다).
 * - `view=watch` — 그 시장의 관심 종목만. `top` 은 무시. 크기 = 유니버스 시총 → `stock_profiles.market_cap`.
 *   크기를 모르는 종목은 `missingCap` 으로 돌려준다(화면이 지도 아래에 적는다). 캐시 키에 관심 종목 목록이 들어간다.
 * - 분야(섹터) 거르기는 화면에서만 한다 — 서버는 섹터를 모두 돌려준다.
 */

import { getDb } from './db';
import { previousClose } from './previousClose';
import { getCandles } from './candleService';
import { loadCandles } from './db';
import { marketCloseMinutes, marketDate, marketMinutes } from '../src/utils/marketDate';
import { readUniverse } from './universe';
import { watchlistSymbols } from './analysis/targetHit';
import { findStock } from './stockCatalog';
import { refreshEarnings } from './earningsCalendar';
import { isMockMode, mockPrice } from './mockData';
import { tossGet } from '../src/services/toss/httpClient';
import { currencyOfSymbol, isKrSymbol } from '../src/utils/market';
import {
  HEATMAP_PERIODS,
  type HeatmapCell,
  type HeatmapMarket,
  type HeatmapPeriod,
  type HeatmapResponse,
  type HeatmapSector,
  type HeatmapView,
} from '../src/types/heatmap';

const CACHE_MS = 60_000;
/** 1주 이상은 종가 기준이라 자주 바뀌지 않는다 — 관심 종목·섹터 변경만 반영되면 된다 */
const PERIOD_CACHE_MS = 10 * 60_000;
const PRICE_CHUNK = 30;

/** yfinance 섹터 → 한국어 (GICS 11개 + yfinance 표기) */
const SECTOR_KO: Record<string, string> = {
  Technology: '기술',
  'Communication Services': '커뮤니케이션',
  'Consumer Cyclical': '경기소비재',
  'Consumer Defensive': '필수소비재',
  'Financial Services': '금융',
  Healthcare: '헬스케어',
  Industrials: '산업재',
  Energy: '에너지',
  Utilities: '유틸리티',
  'Real Estate': '부동산',
  'Basic Materials': '소재',
};

/** 섹터 연구(`npm run research:sector`)도 쓴다 — 지도와 같은 분류여야 한다 */
export const sectorKo = (sector: string | null | undefined) => (sector ? SECTOR_KO[sector] ?? sector : '기타');

interface ProfileRow {
  symbol: string;
  sector: string | null;
  market_cap: number | null;
}

export function profiles(symbols: string[]): Map<string, ProfileRow> {
  if (!symbols.length) return new Map();
  const rows = getDb()
    .prepare(`SELECT symbol, sector, market_cap FROM stock_profiles WHERE symbol IN (${symbols.map(() => '?').join(',')})`)
    .all(...symbols) as ProfileRow[];
  return new Map(rows.map((r) => [r.symbol, r]));
}

interface Target {
  symbol: string;
  cap: number | null;
}

/** 유니버스(시장별 시총 상위 100)와 그 시가총액 — 파일이 없으면 빈 목록 */
function universeOf(market: HeatmapMarket): Target[] {
  try {
    const u = readUniverse();
    return (market === 'us' ? u.us : u.kr).map((e) => ({ symbol: e.symbol, cap: e.marketCap }));
  } catch {
    return [];
  }
}

/** 그 시장의 관심 종목(저장 순서) */
function watchOf(market: HeatmapMarket): string[] {
  try {
    return watchlistSymbols().filter((s) => isKrSymbol(s) === (market === 'kr'));
  } catch {
    return [];
  }
}

async function lastPrices(symbols: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (isMockMode()) {
    for (const s of symbols) out.set(s, mockPrice(s).close);
    return out;
  }
  for (let i = 0; i < symbols.length; i += PRICE_CHUNK) {
    const chunk = symbols.slice(i, i + PRICE_CHUNK);
    const payload = await tossGet<{ result?: { symbol: string; lastPrice: string | number }[] }>(
      '/api/v1/prices',
      { symbols: chunk.join(',') },
      'MARKET_DATA',
    );
    for (const row of payload.result ?? []) {
      const price = Number(row.lastPrice);
      if (Number.isFinite(price)) out.set(row.symbol, price);
    }
  }
  return out;
}

// ── 섹터가 빠진 종목 한 번 채우기 ─────────────────────────────────────────

let filling = false;
/** 이미 시도한 종목(하루 1회) — yfinance 에 섹터가 없는 종목(BRK.B 등)을 1분마다 다시 묻지 않는다 */
const attempted = new Set<string>();

function fillMissingProfiles(all: string[]): void {
  const day = new Date().toISOString().slice(0, 10);
  const symbols = all.filter((s) => !attempted.has(`${s}|${day}`));
  if (filling || !symbols.length) return;
  for (const s of symbols) attempted.add(`${s}|${day}`);
  filling = true;
  // 실적일 갱신과 같은 경로 — 같은 yfinance info 에서 섹터·시총·실적일을 함께 받는다
  refreshEarnings(symbols)
    .then((n) => console.log(`[heatmap] 섹터 없는 ${n}종목 프로필 채움`))
    .catch((e) => console.warn('[heatmap] 프로필 채우기 실패:', e instanceof Error ? e.message : e))
    .finally(() => {
      filling = false;
    });
}

// ── 기간 수익률 (1주 이상, 종목·기간·시장 날짜별 1회) ───────────────────────

const closesMemo = new Map<string, number[] | null>();
const MAX_BARS = Math.max(...HEATMAP_PERIODS.map((p) => p.bars));

/**
 * 완성된 일봉 종가(오래된 → 최신), 최근 `MAX_BARS + 1` 개. 세 기간(1주·1개월·3개월)이 함께 쓴다.
 *
 * "완성" = 시장 날짜가 오늘보다 앞선 봉 + **오늘 정규장 마감(미국 16:00 ET · 국내 15:30 KST)이 지났으면 오늘 봉**.
 * 마감 전의 오늘 봉은 미확정이라 쓰지 않는다 — 기간 수익률은 종가로 고정한다.
 * 종목·시장 날짜·(마감 전/후)별로 한 번만 만든다. 마감 후에는 캐시의 오늘 봉이 장중에 저장됐을 수 있어 **한 번 새로 받는다**.
 */
async function completedCloses(symbol: string, now: number): Promise<number[] | null> {
  const today = marketDate(now, symbol);
  const afterClose = marketMinutes(now, symbol) >= marketCloseMinutes(symbol);
  const key = `${symbol}|${today}|${afterClose ? 'post' : 'pre'}`;
  if (closesMemo.has(key)) return closesMemo.get(key)!;
  const need = MAX_BARS + 1;
  const done = (list: { timestamp: number; close: number }[]) =>
    list.filter((c) => {
      const day = marketDate(c.timestamp, symbol);
      return day < today || (afterClose && day === today);
    });
  let completed = done(loadCandles(symbol, '1d', need + 10));
  const lastDay = completed.at(-1) ? marketDate(completed.at(-1)!.timestamp, symbol) : null;
  const staleLimit = new Date(Date.parse(`${today}T12:00:00Z`) - 5 * 86_400_000).toISOString().slice(0, 10);
  if (afterClose || completed.length < need || !lastDay || lastDay < staleLimit) {
    // 캐시가 모자라거나 오래됐거나 오늘 종가가 필요할 때만 받는다 (MARKET_DATA_CHART 한도는 httpClient 가 지킨다)
    const fresh = await getCandles(symbol, '1d', need + 10).catch(() => null);
    if (fresh) completed = done(fresh);
  }
  const value = completed.length ? completed.slice(-need).map((c) => c.close) : null;
  // 실패(null)도 그날은 기억한다 — 상장 직후 종목을 1분마다 다시 받지 않게. 날짜·마감 전후가 바뀌면 다시 본다
  closesMemo.set(key, value);
  if (closesMemo.size > 2000) for (const k of closesMemo.keys()) if (!k.includes(`|${today}|`)) closesMemo.delete(k);
  return value;
}

/** 마지막 완성 종가와 그보다 `bars` 봉 앞의 종가. 모자라면 null(= 그 기간에서 제외) */
async function periodCloses(symbol: string, bars: number, now: number): Promise<{ close: number; base: number } | null> {
  const closes = await completedCloses(symbol, now);
  if (!closes || closes.length < bars + 1) return null;
  return { close: closes.at(-1)!, base: closes.at(-1 - bars)! };
}

// ── 섹터 강세 (설명용) ────────────────────────────────────────────────────────

/**
 * 섹터별 시총 가중 수익률 = Σ(시총 × 수익률) ÷ Σ시총.
 * ⚠️ 시총은 지도와 같은 **현재 시총**이다 — 기간 초 시총이 아니다. 짧은 기간이라 차이는 작지만, 크게 오른 종목의
 * 비중이 약간 부풀려진다. 그래서 동일 가중 수익률과 상승 종목 비율을 함께 보여 준다(초대형주 하나가 섹터를 좌우하는지 보이게).
 */
export function sectorStats(cells: HeatmapCell[]): Pick<HeatmapResponse, 'sectors' | 'marketReturn' | 'counted' | 'excluded'> {
  const valid = cells.filter((c) => c.changeRate != null);
  const totalCap = valid.reduce((a, c) => a + c.marketCap, 0);
  const marketReturn = totalCap > 0 ? valid.reduce((a, c) => a + c.marketCap * c.changeRate!, 0) / totalCap : null;
  const groups = new Map<string, HeatmapCell[]>();
  for (const c of cells) (groups.get(c.sector) ?? groups.set(c.sector, []).get(c.sector)!).push(c);
  const round2 = (v: number) => Math.round(v * 100) / 100;
  const sectors: HeatmapSector[] = [];
  for (const [sector, list] of groups) {
    const ok = list.filter((c) => c.changeRate != null);
    if (!ok.length) continue;
    const cap = ok.reduce((a, c) => a + c.marketCap, 0);
    const capReturn = ok.reduce((a, c) => a + c.marketCap * c.changeRate!, 0) / cap;
    sectors.push({
      sector,
      capReturn: round2(capReturn),
      equalReturn: round2(ok.reduce((a, c) => a + c.changeRate!, 0) / ok.length),
      up: ok.filter((c) => c.changeRate! > 0).length,
      counted: ok.length,
      excluded: list.length - ok.length,
      vsMarket: round2(capReturn - (marketReturn ?? 0)),
      top: ok
        .map((c) => ({
          symbol: c.symbol,
          name: c.name,
          returnPct: round2(c.changeRate!),
          contribution: round2((c.marketCap / cap) * c.changeRate!),
        }))
        .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
        .slice(0, 3),
    });
  }
  sectors.sort((a, b) => b.capReturn - a.capReturn);
  return {
    sectors,
    marketReturn: marketReturn == null ? null : round2(marketReturn),
    counted: valid.length,
    excluded: cells.length - valid.length,
  };
}

// ── 응답 ────────────────────────────────────────────────────────────────────


interface Built {
  cells: HeatmapCell[];
  /** 섹터를 아직 모르는 종목 */
  missing: Set<string>;
  missingCap: { symbol: string; name: string | null }[];
  asOf: string;
}

async function build(list: Target[], period: HeatmapPeriod, now: number): Promise<Built> {
  const symbols = list.map((t) => t.symbol);
  const prof = profiles(symbols);
  const bars = HEATMAP_PERIODS.find((p) => p.id === period)!.bars;
  // 1일만 실시간 시세를 부른다. 1주 이상은 종가 기준이라 토스 /prices 를 부르지 않는다
  const prices = period === '1d' ? await lastPrices(symbols) : new Map<string, number>();

  const cells: HeatmapCell[] = [];
  const missing = new Set<string>();
  const missingCap: Built['missingCap'] = [];
  for (const t of list) {
    const p = prof.get(t.symbol);
    if (!p?.sector) missing.add(t.symbol);
    const cap = t.cap ?? p?.market_cap ?? null;
    if (!cap || cap <= 0) {
      // 크기를 모르면 그릴 수 없다 — 이름만 돌려주고, 프로필 채우기가 시총도 함께 받는다
      missing.add(t.symbol);
      missingCap.push({ symbol: t.symbol, name: findStock(t.symbol)?.name ?? null });
      continue;
    }
    let price: number | null;
    let changeRate: number | null;
    if (period === '1d') {
      price = prices.get(t.symbol) ?? null;
      const prev = price !== null ? await previousClose(t.symbol, now) : null;
      changeRate = price !== null && prev ? ((price - prev) / prev) * 100 : null;
    } else {
      const c = await periodCloses(t.symbol, bars, now);
      price = c?.close ?? null;
      changeRate = c && c.base > 0 ? (c.close / c.base - 1) * 100 : null;
    }
    cells.push({
      symbol: t.symbol,
      name: findStock(t.symbol)?.name ?? null,
      sector: sectorKo(p?.sector),
      marketCap: cap,
      price,
      changeRate,
      currency: currencyOfSymbol(t.symbol, findStock(t.symbol)?.market),
      watch: false,
    });
  }
  if (missing.size) fillMissingProfiles([...missing]);
  return { cells, missing, missingCap, asOf: new Date(now).toISOString() };
}

const cache = new Map<string, { at: number; data: Built }>();
const inflight = new Map<string, Promise<Built>>();

/** 같은 키는 한 번만 만든다(두 화면이 동시에 불러도) — 1d 60초 · 그 밖 10분 */
async function cached(key: string, period: HeatmapPeriod, now: number, make: () => Promise<Built>): Promise<Built> {
  const ttl = period === '1d' ? CACHE_MS : PERIOD_CACHE_MS;
  const hit = cache.get(key);
  if (hit && now - hit.at < ttl) return hit.data;
  let pending = inflight.get(key);
  if (!pending) {
    pending = make()
      .then((data) => {
        const at = Date.now();
        cache.set(key, { at, data });
        // 관심 목록이 바뀌면 키가 바뀐다 — 오래된 키를 남겨 두지 않는다
        for (const [k, v] of cache) if (at - v.at > PERIOD_CACHE_MS) cache.delete(k);
        return data;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }
  return pending;
}

export const HEATMAP_TOPS = [30, 50, 100] as const;
export type HeatmapTop = (typeof HEATMAP_TOPS)[number];

export async function heatmap(
  market: HeatmapMarket,
  period: HeatmapPeriod = '1d',
  options: { view?: HeatmapView; top?: HeatmapTop } = {},
  now = Date.now(),
): Promise<HeatmapResponse> {
  const view = options.view ?? 'market';
  const watch = watchOf(market);
  const watchSet = new Set(watch);

  if (view === 'watch') {
    const caps = new Map(universeOf(market).map((t) => [t.symbol, t.cap]));
    const built = await cached(`watch|${market}|${period}|${watch.join(',')}`, period, now, () =>
      build(watch.map((symbol) => ({ symbol, cap: caps.get(symbol) ?? null })), period, now),
    );
    const cells = built.cells.map((c) => ({ ...c, watch: true }));
    return {
      market, period, view, top: null, cells, ...sectorStats(cells), asOf: built.asOf,
      missingSectors: cells.filter((c) => built.missing.has(c.symbol)).length,
      missingCap: built.missingCap,
    };
  }

  const top = options.top ?? 50;
  // 언제나 상위 100 전체를 만든다 — N 을 바꿔도 토스·yfinance 호출이 늘지 않는다
  const built = await cached(`market|${market}|${period}`, period, now, () => build(universeOf(market), period, now));
  const cells = [...built.cells]
    .sort((a, b) => b.marketCap - a.marketCap)
    .slice(0, top)
    .map((c) => ({ ...c, watch: watchSet.has(c.symbol) }));
  return {
    market, period, view, top, cells, ...sectorStats(cells), asOf: built.asOf,
    missingSectors: cells.filter((c) => built.missing.has(c.symbol)).length,
    missingCap: [],
  };
}
