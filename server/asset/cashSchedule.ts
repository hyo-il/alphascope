/**
 * 현금 자동 반영 예약(v2.71.0) — 월급 · 고정 흐름을 「현금」 탭에 그 달 한 번씩. 쓰기 · 기록은 `cashMoves.ts` `applyCashMove` 한 곳.
 *
 * - 은행 영업일 = 주말 · 공휴일을 뺀 날. 공휴일은 앱의 국내 휴장일 표(`market_holidays` — `marketCalendar.ts` `isMarketClosed('KR')`)를 쓰되
 *   **12-31 은 영업일**(증시만 쉼 · 은행은 엶). 휴장일 표가 확인한 범위 밖 날짜는 주말만 쉬는 날로 본다(`isMarketClosed` 와 같음).
 * - 월급: 매달 `salary.day`(처음 25일) → 쉬는 날이면 `salary.shift`(처음 앞 영업일) · 금액 = 「월 고정지출」 「현재 월 급여」(반영할 때 읽은 값).
 * - 고정 흐름: 줄마다 매달 며칠(그 달에 없는 날은 말일) → 쉬는 날이면 `flowShift`(처음 다음 영업일 — 은행 자동이체 일반 규칙) ·
 *   금액 = 반영할 때 읽은 「비용」(₩0 · 빈칸이면 「건너뜀」) · 날짜 · 출금 줄 · 입금 줄이 정해지지 않은 줄은 반영하지 않는다.
 * - 그 달 M 의 반영 날 D(다음 영업일로 밀려 M+1 이 될 수 있다): 한국 D 08:00 뒤 첫 확인에 반영 · D 가 켠 날(`enabledDay`)보다 앞이면 하지 않음(기록도 없음) ·
 *   오늘의 달이 D 의 달보다 뒤면(서버가 꺼져 있다가 다음 달로 넘어감) 쓰지 않고 「건너뜀(서버 꺼짐)」 — 지난달 · 이번 달만 본다.
 * - 확인: 서버 시작 1분 뒤 + 30분마다. 켜는 조건 = `ASSET_SYNC_ENABLED` · 시트 연결 정보 · 설정 켬.
 * ⚠️ 로그에는 종류 · 상태 · 까닭 종류만(금액 · 계좌 이름 없음).
 */
import { isMarketClosed } from '../marketCalendar';
import type { AssetCashFlowSetting, AssetCashKey, AssetCashSettings, AssetCashShift, AssetFixedKey } from '../../src/types/asset';
import { assetSheetConfig, isAssetSyncEnabled, isSheetConfigured } from './config';
import { AssetSheetError } from './google';
import { findFixedLine, fixedLabel, type FixedLine } from './cashKeys';
import { applyCashMove, hasMonthMove, readCashSettings, readFixedSheet, recordCashSkip, settleStoppedMoves, type CashMoveInput } from './cashMoves';

const CHECK_MS = 30 * 60_000;
/** 그날 이 시각(한국) 뒤에 반영 */
const RUN_HOUR_KST = 8;
const DAY_MS = 86_400_000;
const KST_MS = 9 * 3_600_000;

const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
/** 한국 날짜 · 시 */
export const kstDay = (now: number) => iso(now + KST_MS);
const kstHour = (now: number) => new Date(now + KST_MS).getUTCHours();
const monthOfDay = (day: string) => day.slice(0, 7);
const addMonth = (month: string, n: number) => {
  const [y, m] = month.split('-').map(Number);
  const k = y * 12 + (m - 1) + n;
  return `${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, '0')}`;
};

/** 쉬는 날인가 — 시험이 가짜 달력을 끼운다 */
export type ClosedFn = (day: string) => boolean;

/** 은행 쉬는 날 — 주말 · 국내 휴장일(`krClosed`) · 단 12-31 은 영업일(증시만 쉼). 순수 함수 */
export const bankCalendar =
  (krClosed: ClosedFn): ClosedFn =>
  (day) => {
    const dow = new Date(`${day}T00:00:00Z`).getUTCDay();
    if (dow === 0 || dow === 6) return true;
    if (day.slice(5) === '12-31') return false;
    return krClosed(day);
  };

/** 실제 달력 — 앱의 국내 휴장일 표 */
export const bankClosed: ClosedFn = bankCalendar((day) => isMarketClosed('KR', day));

/** 그 달(YYYY-MM)의 d일(그 달에 없으면 말일) → 쉬는 날이면 앞 / 다음 영업일. 순수 함수 */
export function dueDay(month: string, d: number, shift: AssetCashShift, closed: ClosedFn): string {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  let t = Date.UTC(y, m - 1, Math.min(d, last));
  for (let i = 0; i < 40 && closed(iso(t)); i++) t += shift === 'prev' ? -DAY_MS : DAY_MS;
  return iso(t);
}

/** 반영할 항목 하나(그 달) */
interface Planned {
  kind: 'salary' | 'fixed';
  itemKey: string;
  item: AssetFixedKey | null;
  month: string;
  day: string;
  from: AssetCashKey | null;
  to: AssetCashKey | null;
}

export const SALARY_ITEM = 'salary';
export const flowItemKey = (k: AssetFixedKey) => JSON.stringify({ category: k.category, reason: k.reason, nth: k.nth });
const ready = (f: AssetCashFlowSetting): f is AssetCashFlowSetting & { day: number; from: AssetCashKey } => f.day != null && f.from != null && f.to != null;

/** 그 달에 반영할 항목(설정이 다 된 것만) */
function plannedOf(s: AssetCashSettings, month: string, closed: ClosedFn): Planned[] {
  const out: Planned[] = [];
  if (s.salary.to) out.push({ kind: 'salary', itemKey: SALARY_ITEM, item: null, month, day: dueDay(month, s.salary.day, s.salary.shift, closed), from: null, to: s.salary.to });
  for (const f of s.flows) {
    if (!ready(f)) continue;
    out.push({ kind: 'fixed', itemKey: flowItemKey(f.item), item: f.item, month, day: dueDay(month, f.day, s.flowShift, closed), from: f.from, to: f.to === 'out' ? null : (f.to as AssetCashKey) });
  }
  return out;
}

/**
 * 다음 반영 날(화면) — 이번 달 날이 아직 안 왔거나(오늘 08:00 전 포함) 이번 달 기록이 없으면 그 날 · 아니면 다음 달 날.
 * 켜기 전 날짜는 건너뛴다.
 */
export function nextDueDay(s: AssetCashSettings, kind: 'salary' | 'fixed', f: AssetCashFlowSetting | null, now: number, closed: ClosedFn): string | null {
  if (!s.enabled) return null;
  if (kind === 'salary' && !s.salary.to) return null;
  if (kind === 'fixed' && (!f || !ready(f))) return null;
  const itemKey = kind === 'salary' ? SALARY_ITEM : flowItemKey((f as AssetCashFlowSetting).item);
  const today = kstDay(now);
  for (let n = -1; n <= 2; n++) {
    const month = addMonth(monthOfDay(today), n);
    const day = kind === 'salary' ? dueDay(month, s.salary.day, s.salary.shift, closed) : dueDay(month, (f as { day: number }).day, s.flowShift, closed);
    if (s.enabledDay && day < s.enabledDay) continue;
    if (monthOfDay(day) < monthOfDay(today)) continue;
    if (hasMonthMove(kind, itemKey, month)) continue;
    return day;
  }
  return null;
}

/** 한 번 확인 결과 — 꺼짐이면 셋 다 0 */
export interface CashTickResult {
  status: 'off' | 'done';
  applied: number;
  skipped: number;
  waiting: number;
}
const OFF: CashTickResult = { status: 'off', applied: 0, skipped: 0, waiting: 0 };

let running = false;
let closedFn: ClosedFn = bankClosed;
/** 시험이 가짜 국내 휴장일을 끼운다(주말 · 12-31 규칙은 그대로 · null = 실제) */
export function setCashCalendarForTest(krClosed: ClosedFn | null): void {
  closedFn = krClosed ? bankCalendar(krClosed) : bankClosed;
}

/** 지금 달력(설정 화면의 다음 반영 날 · 시험과 같은 달력) */
export const cashCalendar = (): ClosedFn => closedFn;

/**
 * 한 번 확인 — 시험이 가짜 시계(`now`)로 부른다. 지난달 · 이번 달 항목마다:
 * 이미 기록 있음 → 그대로 · 반영 날이 켠 날보다 앞 → 하지 않음 · 아직 날이 아님(그날 08:00 전 포함) → 기다림 ·
 * 반영 날의 달이 지났음 → 「건너뜀(서버 꺼짐)」 · 그 밖 → 「월 고정지출」 을 그때 읽어 금액을 정하고 반영.
 */
export async function cashTick(now = Date.now()): Promise<CashTickResult> {
  if (!isAssetSyncEnabled() || !isSheetConfigured()) return OFF;
  const s = readCashSettings();
  if (!s.enabled) return OFF;
  if (running) return { status: 'done', applied: 0, skipped: 0, waiting: 0 };
  running = true;
  let applied = 0;
  let skipped = 0;
  let waiting = 0;
  try {
    const today = kstDay(now);
    const thisMonth = monthOfDay(today);
    const due: Planned[] = [];
    for (const month of [addMonth(thisMonth, -1), thisMonth]) {
      for (const p of plannedOf(s, month, closedFn)) {
        if (s.enabledDay && p.day < s.enabledDay) continue; // 켜기 전 날짜는 채우지 않는다
        if (hasMonthMove(p.kind, p.itemKey, p.month)) continue;
        if (p.day > today || (p.day === today && kstHour(now) < RUN_HOUR_KST)) {
          waiting++;
          continue;
        }
        if (monthOfDay(p.day) < thisMonth) {
          if (recordCashSkip(moveOf(p, 0, labelOf(p, null)), 'server-off').status === 'skipped') skipped++;
          continue;
        }
        due.push(p);
      }
    }
    if (due.length === 0) return { status: 'done', applied, skipped, waiting };

    const config = assetSheetConfig();
    if (!config) return OFF;
    let sheet: { fixed: FixedLine[]; salary: number | null };
    try {
      sheet = await readFixedSheet(config);
    } catch (e) {
      // 「월 고정지출」 을 못 읽음 — 모양이 바뀌었으면 그 달 항목은 「건너뜀」 · 구글 실패는 다음 확인에 다시
      const kind = e instanceof AssetSheetError ? e.kind : 'unknown';
      console.warn(`[asset] 현금 반영 「월 고정지출」 읽기 실패: ${kind}`);
      if (kind !== 'shape') return { status: 'done', applied, skipped, waiting: waiting + due.length };
      for (const p of due) if (recordCashSkip(moveOf(p, 0, labelOf(p, null)), p.kind === 'salary' ? 'no-salary' : 'missing-item', kind).status === 'skipped') skipped++;
      return { status: 'done', applied, skipped, waiting };
    }
    for (const p of due) {
      const line = p.item ? findFixedLine(sheet.fixed, p.item) : null;
      const label = labelOf(p, sheet.fixed);
      if (p.kind === 'fixed' && (!line || !line.reflect)) {
        if (recordCashSkip(moveOf(p, 0, label), 'missing-item').status === 'skipped') skipped++;
        continue;
      }
      const amount = p.kind === 'salary' ? sheet.salary : line?.amount ?? null;
      if (amount == null || !(amount > 0)) {
        if (recordCashSkip(moveOf(p, 0, label), p.kind === 'salary' ? 'no-salary' : 'zero').status === 'skipped') skipped++;
        continue;
      }
      try {
        const r = await applyCashMove(moveOf(p, amount, label), { transientRetry: true });
        if (r.status === 'applied') applied++;
        else if (r.status !== 'duplicate') skipped++;
      } catch (e) {
        console.warn(`[asset] 현금 반영 실패 — 다음 확인에 다시: ${e instanceof AssetSheetError ? e.kind : 'unknown'}`);
        waiting++;
      }
    }
    return { status: 'done', applied, skipped, waiting };
  } finally {
    running = false;
  }
}

function labelOf(p: Planned, fixed: FixedLine[] | null): string {
  if (p.kind === 'salary') return '월급';
  const k = p.item as AssetFixedKey;
  return fixed ? fixedLabel(k, fixed) : k.nth > 1 ? `${k.reason} #${k.nth}` : k.reason;
}

const moveOf = (p: Planned, amount: number, label: string): CashMoveInput => ({ kind: p.kind, itemKey: p.itemKey, label, month: p.month, day: p.day, from: p.from, to: p.to, amount });

/** 서버 시작 때 한 번 — 멈춘 「쓰는 중」 정리 · 1분 뒤 첫 확인 · 30분마다 */
export function startCashScheduler(): void {
  if (!isAssetSyncEnabled()) {
    console.log('[asset] 현금 자동 반영 예약을 하지 않습니다 (ASSET_SYNC_ENABLED=false)');
    return;
  }
  if (!isSheetConfigured()) return;
  try {
    settleStoppedMoves();
  } catch {
    console.warn('[asset] 현금 반영 기록 정리 실패');
  }
  const tick = () =>
    void cashTick().catch((e) => console.warn(`[asset] 현금 반영 확인 실패: ${e instanceof AssetSheetError ? e.kind : 'unknown'}`));
  setTimeout(tick, 60_000);
  setInterval(tick, CHECK_MS);
}
