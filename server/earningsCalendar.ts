/**
 * 실적 발표일 — **실적일 소스는 이 파일 한 곳이다** (v2.16.0).
 *
 * 스윙의 "실적 발표 14일 이내" 경고와 자동매매의 "실적 전 신규 매수 회피" 가 모두 `getEarningsDate()` 를 부른다.
 * 예전에는 스윙이 기업정보 캐시(`cachedFundamentals`)에서만 읽어, 기업정보를 한 번도 안 연 종목은 경고가 없었다.
 *
 * - 출처: yfinance `earningsTimestamp`(지표 엔진 `/earnings` — 실적일만 받는 가벼운 라우트)
 * - `is_estimate`: 회사가 확정하기 전의 추정일이면 1 — 화면·사유에 "(예정)" 을 붙인다
 * - 대상: 관심 목록 + `server/data/universe.json`(미·국 시총 상위 100) + 자동매매 대상 종목
 * - **하루 1회** 갱신: 마지막 갱신 날짜(KST)를 `app_settings` 에 두고, 오늘 이미 받았으면 재시작해도 다시 받지 않는다
 * - 호출은 **순차**, 10종목씩 묶어 1초 간격 (yfinance 를 몰아 두드리지 않는다)
 */

import { getDb } from './db';
import { watchlistSymbols } from './analysis/targetHit';
import { readUniverse } from './universe';
import { listStrategies } from './autoTrading/store';
import { marketDate } from '../src/utils/marketDate';

const ENGINE_URL = process.env.INDICATORS_URL ?? `http://127.0.0.1:${process.env.INDICATORS_PORT ?? 5001}`;
const LAST_REFRESH_KEY = 'earnings.lastRefresh';
const CHUNK = 10;
const GAP_MS = 1000;

export interface EarningsDate {
  /** YYYY-MM-DD */
  date: string;
  /** 추정일인가 (회사 확정 전) */
  isEstimate: boolean;
}

interface Row {
  symbol: string;
  earnings_date: string | null;
  fetched_at: string;
  is_estimate: number | null;
}

/** 저장된 실적일 — 없거나(한 번도 못 받음) 실적일이 비어 있으면 null */
export function getEarningsDate(symbol: string): EarningsDate | null {
  const row = getDb()
    .prepare(`SELECT symbol, earnings_date, fetched_at, is_estimate FROM earnings_calendar WHERE symbol = ?`)
    .get(symbol.toUpperCase()) as Row | undefined;
  if (!row?.earnings_date) return null;
  return { date: row.earnings_date, isEstimate: row.is_estimate === 1 };
}

export function listEarnings(): { symbol: string; date: string | null; isEstimate: boolean | null; fetchedAt: string }[] {
  return (
    getDb().prepare(`SELECT symbol, earnings_date, fetched_at, is_estimate FROM earnings_calendar ORDER BY symbol`).all() as Row[]
  ).map((r) => ({
    symbol: r.symbol,
    date: r.earnings_date,
    isEstimate: r.is_estimate === null ? null : r.is_estimate === 1,
    fetchedAt: r.fetched_at,
  }));
}

/** 받을 종목 — 관심 목록 + 대형주 유니버스 + 자동매매 대상 (중복 제거) */
export function earningsTargets(): string[] {
  const set = new Set<string>();
  try {
    for (const s of watchlistSymbols()) set.add(s);
  } catch {
    /* 관심 목록이 없으면 건너뛴다 */
  }
  try {
    const u = readUniverse();
    for (const e of [...u.us, ...u.kr]) set.add(e.symbol);
  } catch {
    /* 유니버스 파일이 없으면 건너뛴다 */
  }
  try {
    for (const strategy of listStrategies()) for (const s of strategy.symbols) set.add(s);
  } catch {
    /* 전략이 없으면 건너뛴다 */
  }
  return [...set].map((s) => s.toUpperCase());
}

type EarningsRowIn = {
  symbol: string;
  date: string | null;
  isEstimate: boolean | null;
  /** v2.18.0 — 같은 yfinance info 에서 온 섹터·시총 (종목 지도가 쓴다) */
  sector?: string | null;
  marketCap?: number | null;
};

function saveRows(rows: EarningsRowIn[], at: string): void {
  // 섹터·시총은 stock_profiles 에 — 실적과 성격이 달라 표를 나눈다. 값이 없으면 기존 값을 지우지 않는다
  const profile = getDb().prepare(
    `INSERT INTO stock_profiles (symbol, sector, market_cap, fetched_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(symbol) DO UPDATE SET sector = COALESCE(excluded.sector, sector),
         market_cap = COALESCE(excluded.market_cap, market_cap), fetched_at = excluded.fetched_at`,
  );
  for (const r of rows) profile.run(r.symbol.toUpperCase(), r.sector ?? null, r.marketCap ?? null, at);
  const put = getDb().prepare(
    `INSERT INTO earnings_calendar (symbol, earnings_date, fetched_at, is_estimate) VALUES (?, ?, ?, ?)
       ON CONFLICT(symbol) DO UPDATE SET earnings_date = excluded.earnings_date,
         fetched_at = excluded.fetched_at, is_estimate = excluded.is_estimate`,
  );
  for (const r of rows) put.run(r.symbol.toUpperCase(), r.date, at, r.isEstimate === null ? null : r.isEstimate ? 1 : 0);
}

/** 지정 종목을 받아 저장한다. 돌려준 값은 저장한 행 수 */
export async function refreshEarnings(symbols: string[] = earningsTargets()): Promise<number> {
  let saved = 0;
  for (let i = 0; i < symbols.length; i += CHUNK) {
    const chunk = symbols.slice(i, i + CHUNK);
    const response = await fetch(`${ENGINE_URL}/earnings?symbols=${encodeURIComponent(chunk.join(','))}`, {
      signal: AbortSignal.timeout(120_000),
    });
    const payload = (await response.json().catch(() => ({}))) as {
      earnings?: EarningsRowIn[];
      error?: string;
    };
    if (!response.ok || !payload.earnings) throw new Error(payload.error ?? `지표 엔진 응답 ${response.status}`);
    saveRows(payload.earnings, new Date().toISOString());
    saved += payload.earnings.length;
    if (i + CHUNK < symbols.length) await new Promise((r) => setTimeout(r, GAP_MS));
  }
  return saved;
}

/** 오늘(KST) 이미 받았나 — 재시작해도 하루에 한 번만 받게 한다 */
const todayKst = (now = Date.now()) => marketDate(now, '005930');

function lastRefreshDate(): string | null {
  const row = getDb().prepare(`SELECT value FROM app_settings WHERE key = ?`).get(LAST_REFRESH_KEY) as
    | { value: string }
    | undefined;
  return row?.value ?? null;
}

function markRefreshed(day: string): void {
  getDb()
    .prepare(`INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .run(LAST_REFRESH_KEY, day);
}

/** 오늘 아직 안 받았으면 받는다. 반환: 'skipped' | 저장 행 수 */
export async function ensureDailyEarnings(now = Date.now()): Promise<'skipped' | number> {
  const day = todayKst(now);
  if (lastRefreshDate() === day) return 'skipped';
  const saved = await refreshEarnings();
  markRefreshed(day);
  return saved;
}

let running = false;

/**
 * 하루 1회 — 기동 90초 뒤(카탈로그·스냅샷과 겹치지 않게) + 6시간마다 "오늘 받았나" 만 확인한다.
 * 실패하면 로그만 남기고 다음 확인 때 다시 시도한다. 한 번에 하나만 돈다.
 */
export function startEarningsScheduler(): void {
  const tick = () => {
    if (running) return;
    running = true;
    ensureDailyEarnings()
      .then((result) => {
        if (result !== 'skipped') console.log(`[earnings] 실적일 ${result}종목 갱신`);
      })
      .catch((e) => console.warn('[earnings] 실적일 갱신 실패 — 다음 확인 때 다시 시도:', e instanceof Error ? e.message : e))
      .finally(() => {
        running = false;
      });
  };
  setTimeout(tick, 90_000);
  setInterval(tick, 6 * 60 * 60_000);
}
