/**
 * 종목 지도(히트맵) 데이터 — `GET /api/heatmap?market=us|kr` (v2.18.0).
 *
 * - 대상: `server/data/universe.json` 의 시장별 상위 100 + 그 시장의 관심 종목 — 앱 전체의 "대형주" 정의를 하나로 둔다.
 * - 크기: 유니버스의 시가총액, 없으면 `stock_profiles.market_cap`(실적일 하루 1회 갱신이 함께 채운다).
 * - 색: 당일 등락률 = 토스 `/prices` 현재가(30종목씩 묶어서) ÷ **전 거래일 종가**.
 *   전 거래일 종가는 `previousClose.ts`(관심 목록 시세와 공유 — 종목·시장 날짜별 1회).
 * - 섹터: `stock_profiles.sector`(yfinance). 없으면 '기타' — 처음 한 번은 빠진 종목의 프로필을 뒤에서 채운다.
 * - 응답 전체를 시장별 **60초 캐시**한다 (화면도 60초마다 부른다 — Rate Limit 보호).
 */

import { getDb } from './db';
import { previousClose } from './previousClose';
import { readUniverse } from './universe';
import { watchlistSymbols } from './analysis/targetHit';
import { findStock } from './stockCatalog';
import { refreshEarnings } from './earningsCalendar';
import { isMockMode, mockPrice } from './mockData';
import { tossGet } from '../src/services/toss/httpClient';
import { currencyOfSymbol, isKrSymbol } from '../src/utils/market';
import type { HeatmapCell, HeatmapMarket, HeatmapResponse } from '../src/types/heatmap';

const CACHE_MS = 60_000;
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

const sectorKo = (sector: string | null | undefined) => (sector ? SECTOR_KO[sector] ?? sector : '기타');

interface ProfileRow {
  symbol: string;
  sector: string | null;
  market_cap: number | null;
}

function profiles(symbols: string[]): Map<string, ProfileRow> {
  if (!symbols.length) return new Map();
  const rows = getDb()
    .prepare(`SELECT symbol, sector, market_cap FROM stock_profiles WHERE symbol IN (${symbols.map(() => '?').join(',')})`)
    .all(...symbols) as ProfileRow[];
  return new Map(rows.map((r) => [r.symbol, r]));
}

/** 대상 종목과 유니버스 시가총액 */
function targets(market: HeatmapMarket): { symbol: string; cap: number | null; watch: boolean }[] {
  const out = new Map<string, { symbol: string; cap: number | null; watch: boolean }>();
  try {
    const u = readUniverse();
    for (const e of market === 'us' ? u.us : u.kr) out.set(e.symbol, { symbol: e.symbol, cap: e.marketCap, watch: false });
  } catch {
    /* 유니버스 파일이 없으면 관심 종목만 */
  }
  try {
    for (const s of watchlistSymbols()) {
      if (isKrSymbol(s) !== (market === 'kr')) continue;
      const found = out.get(s);
      out.set(s, { symbol: s, cap: found?.cap ?? null, watch: true });
    }
  } catch {
    /* 관심 목록이 없으면 유니버스만 */
  }
  return [...out.values()];
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

// ── 응답 ────────────────────────────────────────────────────────────────────

const cache = new Map<HeatmapMarket, { at: number; data: HeatmapResponse }>();
const inflight = new Map<HeatmapMarket, Promise<HeatmapResponse>>();

async function build(market: HeatmapMarket, now: number): Promise<HeatmapResponse> {
  const list = targets(market);
  const symbols = list.map((t) => t.symbol);
  const prof = profiles(symbols);
  const prices = await lastPrices(symbols);

  const cells: HeatmapCell[] = [];
  const missing: string[] = [];
  for (const t of list) {
    const p = prof.get(t.symbol);
    if (!p?.sector) missing.push(t.symbol);
    const cap = t.cap ?? p?.market_cap ?? null;
    if (!cap || cap <= 0) continue; // 크기를 모르면 그릴 수 없다
    const price = prices.get(t.symbol) ?? null;
    const prev = price !== null ? await previousClose(t.symbol, now) : null;
    cells.push({
      symbol: t.symbol,
      name: findStock(t.symbol)?.name ?? null,
      sector: sectorKo(p?.sector),
      marketCap: cap,
      price,
      changeRate: price !== null && prev ? ((price - prev) / prev) * 100 : null,
      currency: currencyOfSymbol(t.symbol, findStock(t.symbol)?.market),
      watch: t.watch,
    });
  }
  if (missing.length) fillMissingProfiles(missing);
  return { market, cells, asOf: new Date(now).toISOString(), missingSectors: missing.length };
}

export async function heatmap(market: HeatmapMarket, now = Date.now()): Promise<HeatmapResponse> {
  const hit = cache.get(market);
  if (hit && now - hit.at < CACHE_MS) return hit.data;
  // 두 화면이 동시에 불러도 한 번만 만든다
  let pending = inflight.get(market);
  if (!pending) {
    pending = build(market, now)
      .then((data) => {
        cache.set(market, { at: Date.now(), data });
        return data;
      })
      .finally(() => inflight.delete(market));
    inflight.set(market, pending);
  }
  return pending;
}
