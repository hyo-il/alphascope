/**
 * 거래정지 받기 작업 (실험실 「거래정지」, v2.55.0) — **이 폴더 한 곳**에서 받고 · 쌓고 · 방향을 추정한다.
 *
 * - 미국 **평일 04:00~20:00 ET**, 휴장일 제외(`marketCalendar.isMarketClosed`)에 1분마다 한 번 받는다 — **피드가 새로 만들어지는 때에 맞춰**
 *   (`planNextFetch`: 만든 시각 + `ALIGN_SLACK_MS`). 두 받기 사이는 늘 60초 이상(피드 `ttl` 1) · 실패가 아니면 60초 + `ALIGN_MAX_EXTRA_MS` 이하 · 맞출 근거가 없거나 흔들리면 60초 고정. 20:00 ET 뒤에는 **오늘(미국 날짜) 안 풀린
 *   정지가 남아 있을 때만** 미국 자정(00:00 ET) 전까지 이어 받는다(사용자 결정 2026-10-22 — 「안 풀림」 = `utils/usHalts.isHaltOngoing`). 그 밖에는 받지 않는다.
 * - 스위치 `US_HALTS_ENABLED`(기본 켬). 시험 서버는 끈다.
 * - 받기 실패(네트워크 · 200 아님 · 시간 초과 · RSS 아님)는 로그 한 줄 + 연속 실패 수 — 다음 분에 다시, 연속 `US_HALTS_FAIL_WARN` 번부터는
 *   2분 → 5분 → 10분(`US_HALTS_BACKOFF_MS` · 성공하면 1분). 403 · 429 는 「차단으로 보이는 응답」 으로 따로 적는다. 앱의 다른 일을 막지 않는다.
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
import { US_HALTS_BACKOFF_MS, US_HALTS_FAIL_WARN, US_HALTS_FETCH_INTERVAL_MS, type UsHaltFetchStatus, type UsHaltFetchWindow } from '../../src/types/usHalts';
import { FeedHttpError, fetchHaltsFeed, isBlockedStatus, type HaltsFeed } from './feed';
import { countOngoingOfDay, ingestHalts, pendingAnalysis, purgeOldHalts, saveAnalysis, usDayOf } from './store';
import { analyzeHalt, type EstimateFetcher } from './directionEstimate';

export const FETCH_INTERVAL_MS = US_HALTS_FETCH_INTERVAL_MS;
/**
 * 피드를 만든 시각 뒤 이만큼 기다렸다 받는다 — 만든 직후 CDN 에 퍼지기 전 옛 목록을 받지 않게(관찰: 만든 뒤 약 2초에 응답 · 여유 포함).
 * 숫자는 2026-11-05 관찰로 정했다(보고서 · `prompts/v2.60.8`).
 */
export const ALIGN_SLACK_MS = 3_000;
/** 만든 자리(분 안의 초)가 이만큼 안이면 같은 자리로 본다 */
export const ALIGN_TOLERANCE_MS = 2_000;
/**
 * 만든 자리가 이보다 많은 곳에 흩어지면 「흔들림」 — 60초 고정으로.
 * 관찰(2026-11-05): 캐시 서버가 여럿이라 만든 자리가 두세 곳(:04 · :49 · :31)이고 받을 때마다 어느 쪽이 올지 모른다.
 */
export const ALIGN_MAX_PHASES = 2;
/**
 * 맞추기 근거로 쓰는 최근 만든 시각 수 — 만든 자리는 몇 분마다 옮겨 간다(관찰 15분 동안 :04 → :49~:50 → :31).
 * 관찰 순서로 견줘 5개가 받을 때 목록 나이가 가장 짧았다(평균 12.6초 · 10개 14.5초 · 60초 고정은 켠 자리에 따라 0~59초 · 평균 약 30초).
 */
export const ALIGN_HISTORY = 5;
/**
 * 「마지막 받기 + 60초」 뒤로 더 기다리는 시간의 상한 — 두 받기 사이는 60초 ~ 60초 + 이 값(연속 실패 늘리기만 예외 · 사용자 결정 2026-11-05).
 * 맞출 자리가 60초 바로 앞이면 다음 분 자리까지 약 2분을 기다렸다(오라클 로그 120초 · 118초 · 114초) — 한 번을 건너뛰지 않게.
 * 값: 관찰한 맞춤 받기의 더 기다림은 1~3초 · 2분이 된 경우는 54~60초 — 그 사이에서 「1분 남짓」(≤ 75초)으로 둔다.
 */
export const ALIGN_MAX_EXTRA_MS = 15_000;
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
  blockedStatus: null,
};

/** 성공한 받기의 피드 만든 시각(서버 시계 · 최근 `ALIGN_HISTORY` 개 · 최신이 끝) — 다음 받기를 맞추는 근거 */
const builtAts: number[] = [];

export type NextFetchMode = 'first' | 'aligned' | 'fixed' | 'fixed-far' | 'approach' | 'backoff';
/** 로그에 쓰는 방식 이름 — fixed-far · approach 는 fixed 와 구별되게 */
export function nextFetchModeLabel(mode: NextFetchMode, waitSec: number): string {
  if (mode === 'fixed-far') return `fixed(자리 너무 멀어 ${waitSec}초)`;
  if (mode === 'approach') return `approach(자리로 ${ALIGN_MAX_EXTRA_MS / 1000}초 다가감 · ${waitSec}초 뒤)`;
  return `${mode}(${waitSec}초 뒤)`;
}

/**
 * 다음 받기 시각 — 순수 함수(시험이 시계를 빠르게 돌려 본다).
 * - 받은 적 없음 → 지금(`first`).
 * - 연속 실패 `US_HALTS_FAIL_WARN` 번 이상 → 마지막 받기 + 2분 · 5분 · 10분(`backoff`).
 * - 최근 만든 시각이 2개 이상이고 만든 자리(분 안의 초)가 `ALIGN_MAX_PHASES` 곳 이하면 → 그 자리 가운데
 *   **어느 서버의 목록을 받아도 나이 합이 가장 작은 자리** + `ALIGN_SLACK_MS` 에 받는다(`aligned` — 자리가 하나면 그 자리 + 여유).
 *   그 자리까지 `ALIGN_MAX_EXTRA_MS` 넘게 더 기다려야 하면 기다리지 않는다 —
 *   · 자리를 방금(`ALIGN_TOLERANCE_MS` 안 — 같은 자리로 봄) 지났으면 마지막 받기 + 60초(`fixed-far` — 목록 나이 ≤ 여유 + 2초 · 다음에도 같은 자리).
 *   · 그 밖(자리가 멂)이면 마지막 받기 + 60초 + `ALIGN_MAX_EXTRA_MS`(`approach` — 받는 자리를 그만큼 옮겨 많아야 4번 안에 맞춘다.
 *     60초에만 받으면 받는 자리가 옮겨 가지 않아 영영 맞추지 못한다).
 * - 그 밖(만든 시각 없음 · 하나뿐 · 자리가 흩어짐) → 마지막 받기 + 60초(`fixed` — 지금까지와 같음).
 * - ⚠️ 어느 경우든 **마지막 받기 + 60초보다 빠르지 않다**(피드 `ttl` 1 · Nasdaq 1분 1번 이하).
 */
const MOD = (n: number) => ((n % FETCH_INTERVAL_MS) + FETCH_INTERVAL_MS) % FETCH_INTERVAL_MS;

/** 받을 자리(분 안의 ms + 여유 · 0 기준 epoch 와 같은 위상) — 근거가 없거나 흩어지면 null */
export function alignedPhase(builtAts: readonly number[]): number | null {
  const recent = builtAts.slice(-ALIGN_HISTORY);
  if (recent.length < 2) return null;
  const phases = recent.map(MOD);
  const dist = (a: number, b: number) => Math.min(MOD(a - b), MOD(b - a));
  const centers: number[] = [];
  for (const p of phases) if (!centers.some((c) => dist(c, p) <= ALIGN_TOLERANCE_MS)) centers.push(p);
  if (centers.length > ALIGN_MAX_PHASES) return null;
  // 후보 = 자리마다 그 자리 + 여유 · 비용 = 관찰한 자리 모두에서 받을 때 목록 나이의 합
  let best: { at: number; cost: number } | null = null;
  for (const c of centers) {
    const at = MOD(c + ALIGN_SLACK_MS);
    const cost = phases.reduce((sum, p) => sum + MOD(at - p), 0);
    if (!best || cost < best.cost) best = { at, cost };
  }
  return best!.at;
}

export function planNextFetch(input: { now: number; lastFetchAt: number | null; builtAts: readonly number[]; failures: number }): { at: number; mode: NextFetchMode } {
  const { now, lastFetchAt, failures } = input;
  if (lastFetchAt == null) return { at: now, mode: 'first' };
  const floor = lastFetchAt + FETCH_INTERVAL_MS;
  if (failures >= US_HALTS_FAIL_WARN) {
    const step = US_HALTS_BACKOFF_MS[Math.min(failures - US_HALTS_FAIL_WARN, US_HALTS_BACKOFF_MS.length - 1)];
    return { at: Math.max(lastFetchAt + step, floor, now), mode: 'backoff' };
  }
  const target = alignedPhase(input.builtAts);
  if (target != null) {
    const base = Math.max(floor, now);
    const k = Math.ceil((base - target) / FETCH_INTERVAL_MS);
    const at = Math.max(target + k * FETCH_INTERVAL_MS, floor);
    const extra = at - base;
    if (extra > ALIGN_MAX_EXTRA_MS) {
      // 자리를 지난 지 (60초 − extra) — 같은 자리로 볼 만큼 방금 지났으면 지금 받아도 맞춘 것과 같다
      if (FETCH_INTERVAL_MS - extra <= ALIGN_TOLERANCE_MS) return { at: base, mode: 'fixed-far' };
      return { at: base + ALIGN_MAX_EXTRA_MS, mode: 'approach' };
    }
    return { at, mode: 'aligned' };
  }
  return { at: Math.max(floor, now), mode: 'fixed' };
}

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
  Object.assign(status, { lastSuccessAt: null, lastAttemptAt: null, consecutiveFailures: 0, lastError: null, blockedStatus: null });
  builtAts.length = 0;
  getDb().prepare(`DELETE FROM app_settings WHERE key = ?`).run(LAST_SUCCESS_KEY);
}

export interface TickDeps {
  now?: number;
  /** RSS 받기 — 시험은 시험용 항목을 돌려준다(만든 시각은 없어도 된다) */
  load?: () => Promise<HaltsFeed>;
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
  let feed: HaltsFeed;
  try {
    feed = await (deps.load ?? (() => fetchHaltsFeed()))();
  } catch (e) {
    status.consecutiveFailures++;
    status.lastError = (e as Error).message.slice(0, 200);
    const blocked = e instanceof FeedHttpError && isBlockedStatus(e.status) ? e.status : null;
    status.blockedStatus = blocked;
    if (blocked) console.warn(`[usHalts] 차단으로 보이는 응답 ${blocked}(${status.consecutiveFailures}번 연속) — 받는 간격을 늘립니다`);
    else console.warn(`[usHalts] 받기 실패(${status.consecutiveFailures}번 연속): ${status.lastError}`);
    return 'failed';
  }
  const items = feed.items;
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
  status.blockedStatus = null;
  if (feed.builtAt != null) {
    builtAts.push(feed.builtAt);
    if (builtAts.length > ALIGN_HISTORY) builtAts.shift();
  }
  await analyzePending(now, deps.bars).catch((e) => console.warn('[usHalts] 1분봉 처리 실패:', (e as Error).message));
  return 'fetched';
}

let timer: ReturnType<typeof setTimeout> | null = null;

/** 받을 때마다 한 줄 — 받은 목록의 나이(받은 시각 − 피드 만든 시각) · 직전 받기와의 간격(초). 오라클 로그로 실제로 빨라졌는지 본다 */
export function fetchLogLine(received: { at: number; builtAt: number | null }, gapMs: number | null): string {
  const age = received.builtAt == null ? '모름' : `${Math.round((received.at - received.builtAt) / 1000)}초`;
  const gap = gapMs == null ? '—' : `${Math.round(gapMs / 1000)}초`;
  return `[usHalts] 받음 · 목록 나이 ${age} · 직전과 ${gap}`;
}

/*
  실제로 Nasdaq 을 부른 마지막 시각 — DB(app_settings)에 남긴다. 개발 서버(tsx watch)는 파일을 저장할 때마다 다시 켜져
  켤 때마다 곧바로 받으면 1분에 여러 번 부르게 된다 → 60초가 지나지 않았으면 이번 분은 건너뛴다.
*/
const LAST_FETCH_KEY = 'usHalts.lastFetchAt';
function storedLastFetchAt(): number | null {
  const row = getDb().prepare(`SELECT value FROM app_settings WHERE key = ?`).get(LAST_FETCH_KEY) as { value: string } | undefined;
  const last = row ? Number(row.value) : NaN;
  return Number.isFinite(last) ? last : null;
}
export function tooSoon(now: number): boolean {
  const last = storedLastFetchAt();
  return last != null && now - last < FETCH_INTERVAL_MS && now >= last;
}
export function markFetched(now: number): void {
  getDb()
    .prepare(`INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .run(LAST_FETCH_KEY, String(now));
}

/** 서버가 켜질 때 한 번 — 스위치가 꺼져 있으면 아무것도 하지 않는다 */
export function startUsHaltsScheduler(): void {
  if (!isUsHaltsEnabled()) {
    console.log('[alphascope] 거래정지 받기를 하지 않습니다 (US_HALTS_ENABLED=false)');
    return;
  }
  if (timer) return;
  let lastMode: NextFetchMode | null = null;
  let prevFetchedAt: number | null = null;
  const schedule = (at: number) => {
    timer = setTimeout(() => void run(), Math.max(0, at - Date.now()));
  };
  // 한 번 끝나고 다음 시각을 잡는다(겹치지 않음) — 받는 시간대 밖이면 1분 뒤 다시 본다(받지 않음)
  const run = async () => {
    const now = Date.now();
    const inWindow = fetchWindowOf(now).window !== 'outside';
    if (inWindow && tooSoon(now)) {
      // 다시 켠 직후(개발 서버 tsx watch) — 마지막 실제 받기 + 60초까지 기다린다
      schedule((storedLastFetchAt() ?? now) + FETCH_INTERVAL_MS);
      return;
    }
    let fetchedAt: number | null = null;
    let received: { at: number; builtAt: number | null } | null = null;
    const result = await usHaltsTick({
      now,
      load: async () => {
        fetchedAt = now;
        markFetched(now);
        const feed = await fetchHaltsFeed();
        received = { at: Date.now(), builtAt: feed.builtAt };
        return feed;
      },
    }).catch((e) => {
      console.warn('[usHalts] 작업 실패:', (e as Error).message);
      return 'failed' as const;
    });
    if (fetchedAt == null) {
      schedule(now + FETCH_INTERVAL_MS);
      return;
    }
    const gap = prevFetchedAt == null ? null : fetchedAt - prevFetchedAt;
    prevFetchedAt = fetchedAt;
    if (result === 'fetched' && received) console.log(fetchLogLine(received, gap));
    const plan = planNextFetch({ now: Date.now(), lastFetchAt: fetchedAt, builtAts, failures: status.consecutiveFailures });
    if (plan.mode !== lastMode) console.log(`[usHalts] 다음 받기 방식: ${nextFetchModeLabel(plan.mode, Math.round((plan.at - fetchedAt) / 1000))}`);
    lastMode = plan.mode;
    schedule(plan.at);
  };
  void run();
  const sec = FETCH_INTERVAL_MS / 1000;
  console.log(
    `[alphascope] 거래정지 받기 준비됨 (평일 04:00~20:00 ET · 목록이 새로 만들어지는 때에 맞춰 ${sec}초에 1번 · 연속 ${US_HALTS_FAIL_WARN}번 실패하면 간격을 늘림 · 20:00 뒤는 안 풀린 오늘 정지가 있으면 미국 자정까지)`,
  );
}
