/**
 * 시트 가격(v2.65.0) 공용 상태 — 출처 · 바꾼 줄 · 바꾸지 않은 줄(`app_settings`) · 토스 가격 받기 · 잠금.
 * `priceSheet.ts`(바꾸기 · 되돌리기)와 `priceWriter.ts`(10초 쓰기)가 함께 쓴다.
 *
 * - 토스 가격 · 환율은 **있는 함수를 부르기만** 한다(`fetchQuotes` — 관심 목록과 같은 토스 /prices 묶음 · `fetchExchangeRate` — 60초 캐시).
 *   캐시된 지난 종가(stale — 토스가 막힘)는 가격이 아니다(`summary.ts` 와 같은 규칙).
 * - 잠금: 바꾸기 · 되돌리기 · 10초 쓰기는 한 번에 하나만 돈다(되돌린 뒤 10초 쓰기가 숫자를 다시 쓰지 않게).
 * ⚠️ 가격 · 코드 · 이름을 로그에 찍지 않는다.
 */
import { getDb } from '../db';
import { fetchQuotes } from '../quoteService';
import { isMockMode } from '../mockData';
import { fetchExchangeRate } from '../../src/services/toss/account';
import type { AssetPriceMoved, AssetPriceSkip, AssetPriceSource } from '../../src/types/asset';

const KEYS = { source: 'asset.priceSource', rows: 'asset.priceRows', skipped: 'asset.priceSkipped', moved: 'asset.priceMoved' } as const;

/**
 * 토스로 바꾼 줄 — 「티커」 줄 번호 · 바꿀 때 그 줄의 코드(쓰기 · 되돌리기 전에 같은지 본다) · 시장 · 그때 이름(v2.65.1 — 「줄이 옮겨짐」 목록에만).
 * [되돌리기] 가 줄이 옮겨져 쓰지 않은 줄은 출처가 google 이 되어도 여기에 남는다(다시 누를 때 견줄 코드).
 */
export interface PriceRow {
  row: number;
  code: string;
  market: 'US' | 'KR';
  name?: string;
}

function read(key: string): unknown {
  const r = getDb().prepare(`SELECT value FROM app_settings WHERE key = ?`).get(key) as { value: string } | undefined;
  if (!r) return undefined;
  try {
    return JSON.parse(r.value) as unknown;
  } catch {
    return undefined;
  }
}
function put(key: string, value: unknown): void {
  getDb().prepare(`INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, JSON.stringify(value));
}

export const priceSource = (): AssetPriceSource => (read(KEYS.source) === 'toss' ? 'toss' : 'google');

const isRow = (v: unknown): v is PriceRow => {
  const o = v as PriceRow;
  return !!o && Number.isInteger(o.row) && typeof o.code === 'string' && (o.market === 'US' || o.market === 'KR');
};
export function priceRows(): PriceRow[] {
  const v = read(KEYS.rows);
  return Array.isArray(v) ? v.filter(isRow) : [];
}
export function priceSkipped(): AssetPriceSkip[] {
  const v = read(KEYS.skipped);
  return Array.isArray(v) ? (v as AssetPriceSkip[]).filter((s) => s && Number.isInteger(s.row) && typeof s.reason === 'string') : [];
}

/** [되돌리기] 가 쓰지 않은 「줄이 옮겨짐 — 직접 확인」 목록(v2.65.1 · 'asset.priceMoved') */
export function priceMoved(): AssetPriceMoved[] {
  const v = read(KEYS.moved);
  return Array.isArray(v) ? (v as AssetPriceMoved[]).filter((m) => m && Number.isInteger(m.row) && typeof m.wasCode === 'string') : [];
}

/** 출처 · 바꾼 줄 · 바꾸지 않은 줄 · 옮겨진 줄을 한 트랜잭션으로 */
export function savePriceState(next: { source?: AssetPriceSource; rows?: PriceRow[]; skipped?: AssetPriceSkip[]; moved?: AssetPriceMoved[] }): void {
  const db = getDb();
  db.transaction(() => {
    if (next.source) put(KEYS.source, next.source);
    if (next.rows) put(KEYS.rows, [...next.rows].sort((a, b) => a.row - b.row));
    if (next.skipped) put(KEYS.skipped, [...next.skipped].sort((a, b) => a.row - b.row));
    if (next.moved) put(KEYS.moved, [...next.moved].sort((a, b) => a.row - b.row));
  })();
}

/** 시험이 네 키를 지운다(사본 DB) */
export function clearPriceStateForTest(): void {
  for (const k of Object.values(KEYS)) getDb().prepare(`DELETE FROM app_settings WHERE key = ?`).run(k);
}

// ── 토스 가격 · 환율 (시험이 바꿔 끼운다) ──

export interface PriceTools {
  /** 종목 → 원래 통화 가격(받은 것만) — 요청 1번 */
  quotes: (symbols: string[]) => Promise<Map<string, number>>;
  /** 1달러 = N원 — 못 받으면 null */
  rate: () => Promise<number | null>;
}

const tossTools: PriceTools = {
  quotes: async (symbols) => {
    const out = new Map<string, number>();
    if (symbols.length === 0) return out;
    for (const q of await fetchQuotes(symbols)) {
      if (q.price != null && Number.isFinite(q.price) && q.price > 0 && !q.stale) out.set(q.symbol, q.price);
    }
    return out;
  },
  rate: async () => {
    try {
      const r = (await fetchExchangeRate('USD', 'KRW')).rate;
      return Number.isFinite(r) && r > 0 ? r : null;
    } catch {
      return null;
    }
  },
};

let tools: PriceTools = tossTools;
export const priceTools = (): PriceTools => tools;
/** 시험이 가짜 토스를 끼운다(null = 토스) */
export function setPriceToolsForTest(t: PriceTools | null): void {
  tools = t ?? tossTools;
}
/** 모의 데이터 모드(토스 키 없음)면 쓰지 않는다 — 받은 가격이 아니다(가짜 토스를 끼운 시험은 예외) */
export const isMockPrices = (): boolean => tools === tossTools && isMockMode();

// ── 잠금 — 바꾸기 · 되돌리기 · 10초 쓰기는 한 번에 하나 ──

let running: Promise<unknown> | null = null;
let opBusy = false;

/** 10초 쓰기 — 다른 것이 돌고 있으면 이번 회차는 건너뜀(null) */
export async function tryExclusive<T>(fn: () => Promise<T>): Promise<T | null> {
  if (running) return null;
  const p = fn();
  running = p;
  try {
    return await p;
  } finally {
    running = null;
  }
}

/** 바꾸기 · 되돌리기 — 바꾸기 · 되돌리기가 이미 돌면 `{ ok: false }`(busy) · 10초 쓰기가 돌면 끝나기를 기다린 뒤 */
export async function runOperation<T>(fn: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> {
  if (opBusy) return { ok: false };
  opBusy = true;
  try {
    while (running) await running.catch(() => undefined);
    const p = fn();
    running = p;
    try {
      return { ok: true, value: await p };
    } finally {
      running = null;
    }
  } finally {
    opBusy = false;
  }
}
