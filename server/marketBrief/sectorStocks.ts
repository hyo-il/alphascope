/**
 * 오늘 시황 — ③ 주도 섹터 대표 종목(v2.59.6). AI 는 **이 목록 안에서만** 고르고, 서버가 목록 밖 · 섹터가 다른 종목을 뺀다.
 *
 * - 후보 = 실적 대상(`earningsTargets()` — 시총 상위 100 × 미 · 국 + 관심 + 자동매매) ∪ 종목 지도 유니버스. 섹터 = 종목 지도와 같은
 *   한국어 섹터(`stock_profiles.sector` → `sectorKo`). 섹터를 모르는 종목은 후보가 아니다(그 섹터 소속인지 확인할 수 없다).
 * - 섹터 · 시장마다 시가총액 큰 순으로 `SECTOR_STOCKS_PER_MARKET` 개 — 이것이 프롬프트에 주는 목록이자 거르기 기준이다.
 * - 응답은 `[{ticker, name}]` — 티커로 먼저 찾고, 없으면 그 섹터 · 시장 목록의 이름과 같은 것. 이름은 목록 이름으로 바꿔 저장한다.
 * - 스키마 enum 으로 강제하지 않는다 — 후보가 섹터 × 시장마다 달라 한 enum 으로 묶으면 다른 섹터 종목을 막지 못하고,
 *   실제 Gemini 로 확인할 수 없는 큰 스키마를 보내지 않는다(서버 거르기가 최종).
 */

import { getDb } from '../db';
import { earningsTargets } from '../earningsCalendar';
import { findNames } from '../stockCatalog';
import { readUniverse } from '../universe';
import { sectorKo } from '../../src/data/sectors';
import { isKrSymbol } from '../../src/utils/market';
import type { BriefAi, BriefSectorStock } from '../../src/types/marketBrief';

/** 섹터 · 시장마다 프롬프트에 주는 후보 수(시총 큰 순) */
export const SECTOR_STOCKS_PER_MARKET = 6;
/** 응답에서 섹터 · 시장마다 남기는 최대 수 */
export const SECTOR_STOCKS_KEEP = 3;

/** 섹터(한국어) → 시장별 후보 */
export type SectorStockPool = Record<string, { kr: BriefSectorStock[]; us: BriefSectorStock[] }>;

/** 후보 목록 — DB(섹터 · 시총) · 유니버스 파일만 읽는다(네트워크 없음) */
export function sectorStockPool(targets: string[] = earningsTargets()): SectorStockPool {
  const caps = new Map<string, number>();
  const names: Record<string, string> = {};
  const symbols = new Set(targets.map((s) => s.toUpperCase()));
  try {
    const u = readUniverse();
    for (const e of [...u.us, ...u.kr]) {
      const s = e.symbol.toUpperCase();
      symbols.add(s);
      if (e.marketCap) caps.set(s, e.marketCap);
      if (e.name) names[s] = e.name;
    }
  } catch {
    /* 유니버스 파일이 없으면 실적 대상만 */
  }
  const list = [...symbols];
  if (!list.length) return {};
  const rows = getDb()
    .prepare(`SELECT symbol, sector, market_cap FROM stock_profiles WHERE symbol IN (${list.map(() => '?').join(',')})`)
    .all(...list) as { symbol: string; sector: string | null; market_cap: number | null }[];
  Object.assign(names, findNames(list)); // 카탈로그 한글명이 있으면 그것(화면 · AI 입력이 같은 이름)
  const bySector: Record<string, { s: BriefSectorStock; cap: number; kr: boolean }[]> = {};
  for (const r of rows) {
    if (!r.sector) continue;
    const sector = sectorKo(r.sector);
    const symbol = r.symbol.toUpperCase();
    (bySector[sector] ??= []).push({ s: { symbol, name: names[symbol] ?? symbol }, cap: caps.get(symbol) ?? r.market_cap ?? 0, kr: isKrSymbol(symbol) });
  }
  const pool: SectorStockPool = {};
  for (const [sector, items] of Object.entries(bySector)) {
    const top = (kr: boolean) =>
      items
        .filter((i) => i.kr === kr)
        .sort((a, b) => b.cap - a.cap || a.s.symbol.localeCompare(b.s.symbol))
        .slice(0, SECTOR_STOCKS_PER_MARKET)
        .map((i) => i.s);
    pool[sector] = { kr: top(true), us: top(false) };
  }
  return pool;
}

/** 프롬프트 한 덩어리 — 섹터마다 한 줄 */
export function poolText(pool: SectorStockPool): string {
  const fmt = (list: BriefSectorStock[]) => (list.length ? list.map((s) => `${s.name}(${s.symbol})`).join(', ') : '없음');
  const rows = Object.entries(pool)
    .filter(([, p]) => p.kr.length || p.us.length)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([sector, p]) => `- [${sector}] 국내: ${fmt(p.kr)} | 미국: ${fmt(p.us)}`);
  return rows.length ? rows.join('\n') : '(후보 없음 — stocks_kr · stocks_us 는 빈 배열로)';
}

const bare = (t: string) => t.trim().toUpperCase().replace(/\.(KS|KQ)$/, '');

/** 응답 한 칸(배열 · 옛 글자) → 목록 안의 것만. 글자면 쉼표 · 가운뎃점으로 나눠 이름으로 찾는다 */
function pick(raw: unknown, allowed: BriefSectorStock[]): { kept: BriefSectorStock[]; dropped: number } {
  const items: { ticker: string; name: string }[] = Array.isArray(raw)
    ? raw.filter((r) => r && typeof r === 'object').map((r) => ({ ticker: String((r as { ticker?: unknown }).ticker ?? (r as { symbol?: unknown }).symbol ?? ''), name: String((r as { name?: unknown }).name ?? '') }))
    : typeof raw === 'string'
      ? raw.split(/[,·/、]/).map((n) => ({ ticker: '', name: n.trim() })).filter((r) => r.name)
      : [];
  const kept: BriefSectorStock[] = [];
  let dropped = 0;
  for (const it of items) {
    const hit = (it.ticker && allowed.find((a) => a.symbol === bare(it.ticker))) || (it.name && allowed.find((a) => a.name === it.name.trim()));
    if (!hit) {
      dropped++;
      continue;
    }
    if (kept.some((k) => k.symbol === hit.symbol)) continue;
    if (kept.length < SECTOR_STOCKS_KEEP) kept.push(hit);
  }
  return { kept, dropped };
}

/**
 * 받은 응답의 대표 종목을 후보 목록으로 거른다(그 자리를 바꾼다) — 목록 밖 이름 · 다른 섹터 · 다른 시장 종목은 뺀다.
 * 돌려주는 값 = 뺀 개수(수집 상태 줄).
 */
export function filterSectorStocks(brief: BriefAi, pool: SectorStockPool): number {
  let dropped = 0;
  for (const s of brief.leading_sectors) {
    const p = pool[s.name] ?? { kr: [], us: [] };
    const kr = pick(s.stocks_kr, p.kr);
    const us = pick(s.stocks_us, p.us);
    s.stocks_kr = kr.kept;
    s.stocks_us = us.kept;
    dropped += kr.dropped + us.dropped;
  }
  return dropped;
}
