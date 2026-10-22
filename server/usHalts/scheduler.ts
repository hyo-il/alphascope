/**
 * 미국 거래정지 받기 작업 (실험실 「미국 거래정지」, v2.55.0) — **이 폴더 한 곳**에서 받고 · 쌓고 · 방향을 추정한다.
 *
 * - 미국 **평일 04:00~20:00 ET**, 휴장일 제외(`marketCalendar.isMarketClosed`)에만 1분마다 한 번 받는다. 그 밖에는 받지 않는다.
 * - 스위치 `US_HALTS_ENABLED`(기본 켬). 시험 서버는 끈다.
 * - 받기 실패(네트워크 · 200 아님 · 시간 초과 · RSS 아님)는 로그 한 줄 + 연속 실패 수 — 다음 분에 다시. 앱의 다른 일을 막지 않는다.
 * - 처음 본 LULD 정지는 방향을 한 번 추정한다(토스 1분봉 1번 — `directionEstimate.ts`). 오늘(미국 날짜) 정지만 — 지난 정지는 「판정 못 함」.
 * - 30일 지난 줄은 하루 한 번 지운다(받는 시간대와 상관없이).
 * ⚠️ 매매 판단 · 주문 · 자동매매와 닿지 않는다(이 폴더는 그쪽을 import 하지 않는다).
 */
import { isMarketClosed } from '../marketCalendar';
import { isMockMode } from '../mockData';
import { getDb } from '../db';
import { marketMinutes } from '../../src/utils/marketDate';
import { MARKET_REF } from '../../src/utils/market';
import type { UsHaltFetchStatus } from '../../src/types/usHalts';
import { fetchHaltsFeed, type RawHaltItem } from './feed';
import { ingestHalts, pendingDirection, purgeOldHalts, saveDirection, usDayOf } from './store';
import { estimateDirection, type EstimateFetcher } from './directionEstimate';

export const FETCH_INTERVAL_MS = 60_000;
/** 받는 시간대 — 미국 현지 분 [04:00, 20:00) */
export const WINDOW_START_MIN = 4 * 60;
export const WINDOW_END_MIN = 20 * 60;

export const isUsHaltsEnabled = (): boolean => process.env.US_HALTS_ENABLED !== 'false';

/** 지금이 받는 시간대인가 — 미국 평일 04:00~20:00 ET, 휴장일 제외. 시험이 휴장 판단을 바꿔 넣는다 */
export function isFetchWindow(now: number, closed: (day: string) => boolean = (day) => isMarketClosed('US', day)): boolean {
  if (closed(usDayOf(now))) return false;
  const minutes = marketMinutes(now, MARKET_REF.US.symbol);
  return minutes >= WINDOW_START_MIN && minutes < WINDOW_END_MIN;
}

const status: Omit<UsHaltFetchStatus, 'enabled' | 'inWindow'> = {
  lastSuccessAt: null,
  lastAttemptAt: null,
  consecutiveFailures: 0,
  lastError: null,
};

export function fetchStatus(now = Date.now()): UsHaltFetchStatus {
  return { enabled: isUsHaltsEnabled(), inWindow: isFetchWindow(now), ...status };
}

/** 시험용 — 상태를 처음으로 */
export function resetFetchStatusForTest(): void {
  Object.assign(status, { lastSuccessAt: null, lastAttemptAt: null, consecutiveFailures: 0, lastError: null });
}

export interface TickDeps {
  now?: number;
  /** RSS 받기 — 시험은 시험용 XML 을 돌려준다 */
  load?: () => Promise<RawHaltItem[]>;
  /** 1분봉 받기 — 시험은 가짜 봉 */
  bars?: EstimateFetcher;
  closed?: (day: string) => boolean;
}

/** 방향 추정을 기다리는 줄을 처리한다 — 줄마다 토스 호출 많아야 1번 */
async function estimatePending(now: number, bars?: EstimateFetcher): Promise<void> {
  const today = usDayOf(now);
  const db = getDb();
  const catalogCount = (db.prepare(`SELECT COUNT(*) AS n FROM stock_catalog`).get() as { n: number }).n;
  const inCatalog = db.prepare(`SELECT 1 FROM stock_catalog WHERE symbol = ?`);
  for (const p of pendingDirection()) {
    if (p.haltDay !== today) {
      // 지난 정지(서버가 꺼져 있던 날 등)는 부르지 않는다
      saveDirection(p.id, 'unknown', { reason: 'not_today' });
      continue;
    }
    const symbol = p.symbol.trim();
    const r = await estimateDirection(symbol, p.haltAtMs, {
      inToss: catalogCount === 0 || Boolean(inCatalog.get(symbol)),
      mock: bars ? false : isMockMode(),
      fetcher: bars,
    });
    saveDirection(p.id, r.est, r.detail);
  }
}

let lastPurgeDay: string | null = null;

/**
 * 한 번 — 받는 시간대면 받아 쌓고, 새 LULD 정지의 방향을 추정한다. 하루 한 번 30일 지난 줄을 지운다.
 * 받기가 실패해도 던지지 않는다(상태에만 남긴다).
 */
export async function usHaltsTick(deps: TickDeps = {}): Promise<'fetched' | 'failed' | 'outside'> {
  const now = deps.now ?? Date.now();
  const day = usDayOf(now);
  if (lastPurgeDay !== day) {
    const purged = purgeOldHalts(now);
    lastPurgeDay = day;
    if (purged) console.log(`[usHalts] 30일 지난 정지 ${purged}줄 지움`);
  }
  if (!isFetchWindow(now, deps.closed)) return 'outside';

  status.lastAttemptAt = new Date(now).toISOString();
  let items: RawHaltItem[];
  try {
    items = await (deps.load ?? (() => fetchHaltsFeed()))();
  } catch (e) {
    status.consecutiveFailures++;
    status.lastError = (e as Error).message.slice(0, 200);
    console.warn(`[usHalts] 받기 실패(${status.consecutiveFailures}번 연속): ${status.lastError}`);
    return 'failed';
  }
  const ingested = ingestHalts(items, now);
  // Nasdaq 이 날짜 · 시각 모양을 바꾸면 줄이 조용히 빠진다 — 로그로 알리고, 하나도 못 읽었으면 받기 실패로 센다(화면이 「없음」 으로 읽지 않게)
  if (ingested.skippedBad) console.warn(`[usHalts] 날짜 · 시각 모양이 달라 저장하지 않은 항목 ${ingested.skippedBad}개`);
  if (items.length && ingested.skippedBad === items.length) {
    status.consecutiveFailures++;
    status.lastError = `항목 ${items.length}개 모두 날짜 · 시각 모양이 다릅니다`;
    return 'failed';
  }
  status.lastSuccessAt = new Date(now).toISOString();
  status.consecutiveFailures = 0;
  status.lastError = null;
  await estimatePending(now, deps.bars).catch((e) => console.warn('[usHalts] 방향 추정 실패:', (e as Error).message));
  return 'fetched';
}

let timer: ReturnType<typeof setInterval> | null = null;
let running = false;

/*
  실제로 Nasdaq 을 부른 마지막 시각 — DB(app_settings)에 남긴다. 개발 서버(tsx watch)는 파일을 저장할 때마다 다시 켜져
  켤 때마다 곧바로 받으면 1분에 여러 번 부르게 된다 → 60초가 지나지 않았으면 이번 분은 건너뛴다.
*/
const LAST_FETCH_KEY = 'usHalts.lastFetchAt';
export function tooSoon(now: number): boolean {
  const row = getDb().prepare(`SELECT value FROM app_settings WHERE key = ?`).get(LAST_FETCH_KEY) as { value: string } | undefined;
  const last = row ? Number(row.value) : NaN;
  return Number.isFinite(last) && now - last < FETCH_INTERVAL_MS && now >= last;
}
export function markFetched(now: number): void {
  getDb()
    .prepare(`INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .run(LAST_FETCH_KEY, String(now));
}

/** 서버가 켜질 때 한 번 — 스위치가 꺼져 있으면 아무것도 하지 않는다 */
export function startUsHaltsScheduler(): void {
  if (!isUsHaltsEnabled()) {
    console.log('[alphascope] 미국 거래정지 받기를 하지 않습니다 (US_HALTS_ENABLED=false)');
    return;
  }
  if (timer) return;
  const run = () => {
    // 한 번이 1분을 넘기면(토스 대기 등) 겹치지 않게 건너뛴다 — Nasdaq 은 1분에 1번 이하
    if (running) return;
    const now = Date.now();
    if (isFetchWindow(now) && tooSoon(now)) return;
    running = true;
    void usHaltsTick({
      now,
      load: () => {
        markFetched(now);
        return fetchHaltsFeed();
      },
    })
      .catch((e) => console.warn('[usHalts] 작업 실패:', (e as Error).message))
      .finally(() => {
        running = false;
      });
  };
  run();
  timer = setInterval(run, FETCH_INTERVAL_MS);
  console.log('[alphascope] 미국 거래정지 받기 준비됨 (평일 04:00~20:00 ET, 1분마다)');
}
