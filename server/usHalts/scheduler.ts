/**
 * 실시간 거래정지 받기 작업 (실험실 「실시간 거래정지」, v2.55.0) — **이 폴더 한 곳**에서 받고 · 쌓고 · 방향을 추정한다.
 *
 * - 미국 **평일 04:00~20:00 ET**, 휴장일 제외(`marketCalendar.isMarketClosed`)에 1분마다 한 번 받는다. 20:00 ET 뒤에는 **오늘(미국 날짜) 안 풀린
 *   정지가 남아 있을 때만** 미국 자정(00:00 ET) 전까지 이어 받는다(사용자 결정 2026-10-22 — 「안 풀림」 = `utils/usHalts.isHaltOngoing`). 그 밖에는 받지 않는다.
 * - 스위치 `US_HALTS_ENABLED`(기본 켬). 시험 서버는 끈다.
 * - 받기 실패(네트워크 · 200 아님 · 시간 초과 · RSS 아님)는 로그 한 줄 + 연속 실패 수 — 다음 분에 다시. 앱의 다른 일을 막지 않는다.
 * - 처음 본 정지는 토스 1분봉을 **한 번** 받아 정지 전 5분 거래대금(전부)과 방향(LULD 만)을 낸다(`directionEstimate.ts`).
 *   오늘(미국 날짜) 정지만 — 지난 정지는 부르지 않는다(거래대금 모름 · 방향 「판정 못 함」).
 * - 30일 지난 줄은 하루 한 번 지운다(받는 시간대와 상관없이).
 * ⚠️ 매매 판단 · 주문 · 자동매매와 닿지 않는다(이 폴더는 그쪽을 import 하지 않는다).
 */
import { isMarketClosed } from '../marketCalendar';
import { isMockMode } from '../mockData';
import { getDb } from '../db';
import { marketMinutes } from '../../src/utils/marketDate';
import { MARKET_REF } from '../../src/utils/market';
import type { UsHaltFetchStatus, UsHaltFetchWindow } from '../../src/types/usHalts';
import { fetchHaltsFeed, type RawHaltItem } from './feed';
import { countOngoingOfDay, ingestHalts, pendingAnalysis, purgeOldHalts, saveAnalysis, usDayOf } from './store';
import { analyzeHalt, type EstimateFetcher } from './directionEstimate';

export const FETCH_INTERVAL_MS = 60_000;
/** 받는 시간대 — 미국 현지 분 [04:00, 20:00). 20:00 뒤 자정 전은 이어 받기(안 풀린 오늘 정지가 있을 때만) */
export const WINDOW_START_MIN = 4 * 60;
export const WINDOW_END_MIN = 20 * 60;
/**
 * 20:00 ET 뒤 3분은 안 풀린 정지가 없어도 받는다 — 목록은 정지 뒤 0.5~2분 늦게 올라와, 19:58~19:59 ET 정지는 20:00 전에 한 번도 보이지 않을 수 있다
 * (보이지 않으면 「안 풀린 오늘 정지」 로 셀 수도 없어 이어 받기가 시작되지 않는다).
 */
export const GRACE_END_MIN = WINDOW_END_MIN + 3;

export const isUsHaltsEnabled = (): boolean => process.env.US_HALTS_ENABLED !== 'false';

export interface WindowDeps {
  /** 휴장 판단 — 시험이 바꿔 넣는다 */
  closed?: (day: string) => boolean;
  /** 오늘 안 풀린 정지 수 — 시험이 바꿔 넣는다(기본 = DB) */
  openToday?: (day: string, now: number) => number;
}

/**
 * 지금 받는가 — regular: 미국 평일(휴장 제외) [04:00, 20:00) ET · extended: 같은 날 [20:00, 24:00) ET 이고 오늘 안 풀린 정지가 1건 이상 ·
 * (20:00~20:02 ET 는 안 풀린 정지가 없어도 regular — `GRACE_END_MIN`) · outside: 그 밖(00:00 ET 가 되면 미국 날짜가 바뀌어 그날 것은 끝 — 다음 날 04:00 부터). 휴장일 · 주말은 이어 받기도 하지 않는다.
 */
export function fetchWindowOf(now: number, deps: WindowDeps = {}): { window: UsHaltFetchWindow; openToday: number } {
  const day = usDayOf(now);
  if ((deps.closed ?? ((d: string) => isMarketClosed('US', d)))(day)) return { window: 'outside', openToday: 0 };
  const minutes = marketMinutes(now, MARKET_REF.US.symbol);
  if (minutes >= WINDOW_START_MIN && minutes < WINDOW_END_MIN) return { window: 'regular', openToday: 0 };
  if (minutes < WINDOW_END_MIN) return { window: 'outside', openToday: 0 };
  const openToday = (deps.openToday ?? countOngoingOfDay)(day, now);
  if (openToday > 0) return { window: 'extended', openToday };
  return { window: minutes < GRACE_END_MIN ? 'regular' : 'outside', openToday };
}

const status: Omit<UsHaltFetchStatus, 'enabled' | 'inWindow' | 'window' | 'openToday'> = {
  lastSuccessAt: null,
  lastAttemptAt: null,
  consecutiveFailures: 0,
  lastError: null,
};

/*
  마지막으로 성공한 받기 시각 — DB(app_settings)에도 남긴다. 「며칠째 정지 중」 의 「목록에서 사라짐」 판단이 이 시각과 줄의 마지막으로 본 시각을
  비교하는데, 메모리에만 두면 서버를 다시 켠 뒤 첫 받기 전에는 판단을 못 한다.
*/
const LAST_SUCCESS_KEY = 'usHalts.lastSuccessAt';
export function lastSuccessAt(): string | null {
  if (status.lastSuccessAt) return status.lastSuccessAt;
  const row = getDb().prepare(`SELECT value FROM app_settings WHERE key = ?`).get(LAST_SUCCESS_KEY) as { value: string } | undefined;
  return row?.value ?? null;
}

export function fetchStatus(now = Date.now(), deps: WindowDeps = {}): UsHaltFetchStatus {
  const w = fetchWindowOf(now, deps);
  return { enabled: isUsHaltsEnabled(), inWindow: w.window !== 'outside', ...w, ...status, lastSuccessAt: lastSuccessAt() };
}

/** 시험용 — 상태를 처음으로 */
export function resetFetchStatusForTest(): void {
  Object.assign(status, { lastSuccessAt: null, lastAttemptAt: null, consecutiveFailures: 0, lastError: null });
  getDb().prepare(`DELETE FROM app_settings WHERE key = ?`).run(LAST_SUCCESS_KEY);
}

export interface TickDeps {
  now?: number;
  /** RSS 받기 — 시험은 시험용 XML 을 돌려준다 */
  load?: () => Promise<RawHaltItem[]>;
  /** 1분봉 받기 — 시험은 가짜 봉 */
  bars?: EstimateFetcher;
  closed?: (day: string) => boolean;
  openToday?: (day: string, now: number) => number;
}

/** 1분봉 차례인 줄을 처리한다 — 줄마다 토스 호출 많아야 1번(그 줄 평생) */
async function analyzePending(now: number, bars?: EstimateFetcher): Promise<void> {
  const today = usDayOf(now);
  const db = getDb();
  const catalogCount = (db.prepare(`SELECT COUNT(*) AS n FROM stock_catalog`).get() as { n: number }).n;
  const inCatalog = db.prepare(`SELECT 1 FROM stock_catalog WHERE symbol = ?`);
  for (const p of pendingAnalysis()) {
    if (p.checked) {
      // 1분봉을 이미 받은 줄의 사유가 뒤에 LULD 로 바뀌었다 — 다시 부르지 않는다(정지 1건당 1번)
      saveAnalysis(p.id, { direction: { est: 'unknown', detail: { reason: 'code_changed' } } });
      continue;
    }
    if (p.haltDay !== today) {
      // 지난 정지(서버가 꺼져 있던 날 등)는 부르지 않는다
      saveAnalysis(p.id, { direction: p.luld ? { est: 'unknown', detail: { reason: 'not_today' } } : null, turnover: { usd: null } });
      continue;
    }
    const symbol = p.symbol.trim();
    const r = await analyzeHalt(symbol, p.haltAtMs, {
      luld: p.luld,
      inToss: catalogCount === 0 || Boolean(inCatalog.get(symbol)),
      mock: bars ? false : isMockMode(),
      fetcher: bars,
    });
    saveAnalysis(p.id, { direction: r.direction, turnover: { usd: r.turnover5mUsd } });
  }
}

let lastPurgeDay: string | null = null;

/**
 * 한 번 — 받는 시간대면 받아 쌓고, 새 정지의 거래대금 · 방향(LULD)을 낸다. 하루 한 번 30일 지난 줄을 지운다.
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
  if (fetchWindowOf(now, deps).window === 'outside') return 'outside';

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
  getDb()
    .prepare(`INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .run(LAST_SUCCESS_KEY, status.lastSuccessAt);
  status.consecutiveFailures = 0;
  status.lastError = null;
  await analyzePending(now, deps.bars).catch((e) => console.warn('[usHalts] 1분봉 처리 실패:', (e as Error).message));
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
    console.log('[alphascope] 실시간 거래정지 받기를 하지 않습니다 (US_HALTS_ENABLED=false)');
    return;
  }
  if (timer) return;
  const run = () => {
    // 한 번이 1분을 넘기면(토스 대기 등) 겹치지 않게 건너뛴다 — Nasdaq 은 1분에 1번 이하
    if (running) return;
    const now = Date.now();
    if (fetchWindowOf(now).window !== 'outside' && tooSoon(now)) return;
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
  console.log('[alphascope] 실시간 거래정지 받기 준비됨 (평일 04:00~20:00 ET 1분마다 · 20:00 뒤는 안 풀린 오늘 정지가 있으면 미국 자정까지)');
}
