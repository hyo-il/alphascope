/**
 * 현금 자동 반영(v2.71.0) — 설정 · 반영 기록 · 「현금」 탭 쓰기 · 되돌리기 **한 곳**. 날짜 · 예약은 `cashSchedule.ts`, 줄 알아보기는 `cashKeys.ts`.
 *
 * - 앱이 쓰는 칸은 「현금」 탭 **은행 계좌 줄의 C열 금액 칸뿐**(총액 줄 · 이름 칸 · 퇴직 연금 · 「월 고정지출」 · 줄 넣기/지우기 없음).
 * - 반영 한 번 = 쓰기 한 번(`writeCashMove`): 쓰기 직전 「현금」 B:C 를 수식 그대로 다시 읽어 이름 · 순서로 줄을 찾고 **지금 숫자**에서 이어 간다
 *   (사용자가 시트에서 고친 숫자) → 출금 줄 −금액 · 입금 줄 +금액을 `valuesWrite` **한 요청**(RAW) → 다시 읽어 같은지 확인.
 *   줄을 못 찾거나 · 금액 칸이 숫자가 아니거나(빈칸 · 글자 · 수식) 하면 쓰지 않고 「건너뜀」.
 * - 기록 `asset_cash_moves`(선택 기능 표 — 이 파일에서 만든다): 월급 · 고정 흐름은 (종류 · 항목 · 그 달) 하나에 한 줄(고유 색인) —
 *   **쓰기 전에** 「쓰는 중」 줄을 먼저 넣어 자리를 잡고(두 번 쓰지 않기 · 서버가 다시 켜져도) 쓴 뒤 「반영」 으로 바꾼다.
 *   쓰는 중에 멈춘 줄(「쓰는 중」 이 남음)은 다음 시작 때 「다시 확인 필요(쓰는 중에 멈춤)」 로 바꾸고 다시 쓰지 않는다.
 * - 되돌리기(`undoCashMove`): 「반영」 줄만 · 그 기록의 반대 금액을 **지금 숫자**에 더하고 빼서 같은 방법으로 쓴다 · 「되돌리는 중」 으로 먼저 바꿔 두 번 되돌리지 않는다.
 * - 설정 `app_settings` 'asset.cash'(JSON — 키-값은 기능 표에 얹지 않는다 · CLAUDE.md 8). 저장 모양 2(v2.71.1 · `v: 2`): 고정 흐름 빠지는 계좌에
 *   「월급 받는 계좌 따라감」(`'salary'`)을 둘 수 있다 — 옛 모양(139차 · `v` 없음)의 빠지는 계좌 빈칸은 「따라감」 으로 읽는다(사용자 결정 — 처음부터 모든 줄 = 월급 받는 계좌).
 *   반영 · 쓰기 · 예약은 `readCashSettings()` 의 **풀린 설정**(따라감 → 그때의 월급 받는 계좌 열쇠)만 본다 — 판단 코드는 그대로.
 * - 켬 조건: `ASSET_SYNC_ENABLED`(시트 쓰기 스위치) **그리고** 설정 「현금 자동 반영」 켬(기본 꺼짐). 하나라도 꺼지면 쓰기 0.
 * - 직접 입출금(v2.72.0 · 이체 · 입금 · 출금 — `cashManual.ts`)은 사용자가 누르는 일이라 「현금 자동 반영」 설정은 보지 않고 `ASSET_SYNC_ENABLED` 만 본다(`manual`).
 *   요청 번호 하나에 한 줄(고유 색인 — 두 번 눌러도 · 다시 보내도 쓰기 1번) · 쓰기 전에 실패하면(줄 못 찾음 · 숫자 아님 · 구글 거절) 기록을 남기지 않고 까닭을 돌려준다.
 * ⚠️ 로그에는 기록 id · 종류 · 상태 · 까닭 종류만(금액 · 수량 · 계좌 이름 없음).
 */
import { getDb } from '../db';
import {
  ASSET_CASH_DEFAULT_SALARY_DAY,
  ASSET_CASH_MAX,
  ASSET_CASH_FROM_SALARY,
  assetCashDefaultTo,
  type AssetCashFlowEdit,
  type AssetCashFlowSetting,
  type AssetCashFrom,
  type AssetCashKey,
  type AssetCashMoveKindAll,
  type AssetCashMoveRecordAll,
  type AssetCashMoveStatus,
  type AssetCashReason,
  type AssetCashSettings,
  type AssetCashSettingsPatchV2,
  type AssetCashShift,
  type AssetCashTarget,
  type AssetCashTradeOutcome,
  type AssetFixedKey,
} from '../../src/types/asset';
import { assetSheetConfig, isAssetSyncEnabled, type AssetSheetConfig } from './config';
import { AssetSheetError, batchGet, valuesWrite, type CellRows, type CellWrite } from './google';
import { one, wideRange } from './sheet';
import { SHEET_LAYOUT } from './sheetLayout';
import { cashLines, cellName, findCashLine, storedCashKey, storedFixedKey, findFixedLine, fixedLines, salaryOf, sameCashKey, type CashLine, type FixedLine } from './cashKeys';

const CASH_TAB = SHEET_LAYOUT.cash.tab;
const SETTINGS_KEY = 'asset.cash';
const MOVES_LIMIT = 50;

// ── 표 ──

let ready = false;
function db() {
  const database = getDb();
  if (!ready) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS asset_cash_moves (
        id INTEGER PRIMARY KEY,
        at TEXT NOT NULL,          -- 기록 시각(ISO)
        kind TEXT NOT NULL,        -- salary | fixed | buy | sell | transfer | deposit | withdraw(직접 입출금 · label = 메모)
        item_key TEXT NOT NULL,    -- 항목 열쇠 JSON(월급 = "salary" · 고정 흐름 = AssetFixedKey · 매수 · 매도 = 매매 기록 id)
        label TEXT NOT NULL,       -- 화면 이름(사유 · 종목)
        month TEXT NOT NULL,       -- 그 달 YYYY-MM
        day TEXT NOT NULL,         -- 반영 날(한국 날짜)
        from_key TEXT,             -- 출금 줄 AssetCashKey JSON(없으면 NULL)
        to_key TEXT,               -- 입금 줄 AssetCashKey JSON(밖으로 · 없으면 NULL)
        amount REAL NOT NULL,      -- 원
        before_json TEXT,          -- 쓰기 전 값 {from, to}
        after_json TEXT,           -- 쓴 뒤 값 {from, to}
        status TEXT NOT NULL,      -- pending | applied | undoing | undone | skipped | check
        reason TEXT,               -- 건너뜀 · 다시 확인 필요 까닭
        detail TEXT,               -- 까닭 종류(시트 오류 kind)
        undone_at TEXT,
        undo_json TEXT             -- 되돌릴 때 쓰기 전 · 뒤 값
      );
      CREATE UNIQUE INDEX IF NOT EXISTS asset_cash_moves_once ON asset_cash_moves(kind, item_key, month) WHERE kind IN ('salary', 'fixed');
      CREATE UNIQUE INDEX IF NOT EXISTS asset_cash_moves_trade_once ON asset_cash_moves(kind, item_key) WHERE kind IN ('buy', 'sell');
      CREATE UNIQUE INDEX IF NOT EXISTS asset_cash_moves_manual_once ON asset_cash_moves(item_key) WHERE kind IN ('transfer', 'deposit', 'withdraw');
    `);
    ready = true;
  }
  return database;
}

interface MoveRow {
  id: number; at: string; kind: AssetCashMoveKindAll; item_key: string; label: string; month: string; day: string; from_key: string | null; to_key: string | null;
  amount: number; status: AssetCashMoveStatus; reason: AssetCashReason | null; undone_at: string | null;
}

const parseKey = (v: string | null): AssetCashKey | null => {
  if (!v) return null;
  try {
    const k = JSON.parse(v) as AssetCashKey;
    return typeof k?.name === 'string' && typeof k.nth === 'number' ? k : null;
  } catch {
    return null;
  }
};

const recordOf = (r: MoveRow): AssetCashMoveRecordAll => ({
  id: r.id, at: r.at, kind: r.kind, label: r.label, month: r.month, day: r.day, from: parseKey(r.from_key), to: parseKey(r.to_key),
  amount: r.amount, status: r.status, reason: r.reason, undoneAt: r.undone_at,
});

/** 반영 기록 — 최근 50 · 최신 위 */
export const listCashMoves = (): AssetCashMoveRecordAll[] => (db().prepare(`SELECT * FROM asset_cash_moves ORDER BY id DESC LIMIT ?`).all(MOVES_LIMIT) as MoveRow[]).map(recordOf);

/** 직접 입출금 기록(요청 번호 하나에 한 줄) — 기록 + 쓴 뒤 값(없으면 null) */
export function manualMoveOf(itemKey: string): { move: AssetCashMoveRecordAll; after: { from: number | null; to: number | null } } | null {
  const r = db().prepare(`SELECT * FROM asset_cash_moves WHERE item_key = ? AND kind IN ('transfer', 'deposit', 'withdraw')`).get(itemKey) as (MoveRow & { after_json: string | null }) | undefined;
  if (!r) return null;
  let after = { from: null as number | null, to: null as number | null };
  try {
    const a = r.after_json ? (JSON.parse(r.after_json) as { from?: unknown; to?: unknown }) : {};
    after = { from: typeof a.from === 'number' ? a.from : null, to: typeof a.to === 'number' ? a.to : null };
  } catch {
    // 쓴 뒤 값을 못 읽으면 null(기록은 그대로)
  }
  return { move: recordOf(r), after };
}

/** 월급 · 고정 흐름 그 달 기록이 이미 있나(어떤 상태든 — 두 번 쓰지 않기) */
export const hasMonthMove = (kind: 'salary' | 'fixed', itemKey: string, month: string): boolean =>
  Boolean(db().prepare(`SELECT 1 FROM asset_cash_moves WHERE kind = ? AND item_key = ? AND month = ?`).get(kind, itemKey, month));

/** 월급 · 고정 흐름 그 달 기록의 상태(없으면 null) — 미리 보기 「이미 기록 있음」 */
export const monthMoveStatus = (kind: 'salary' | 'fixed', itemKey: string, month: string): AssetCashMoveStatus | null =>
  (db().prepare(`SELECT status FROM asset_cash_moves WHERE kind = ? AND item_key = ? AND month = ?`).get(kind, itemKey, month) as { status: AssetCashMoveStatus } | undefined)?.status ?? null;

/** 시험이 비운다 */
export const clearCashMovesForTest = (): void => void db().prepare(`DELETE FROM asset_cash_moves`).run();

/** 서버 시작 때 한 번 — 쓰는 중 · 되돌리는 중에 멈춘 줄은 「다시 확인 필요(쓰는 중에 멈춤)」(다시 쓰지 않는다 · 시트를 직접 확인) */
export function settleStoppedMoves(): number {
  const n =
    db().prepare(`UPDATE asset_cash_moves SET status = 'check', reason = 'stopped', detail = 'write' WHERE status = 'pending'`).run().changes +
    db().prepare(`UPDATE asset_cash_moves SET status = 'check', reason = 'stopped', detail = 'undo' WHERE status = 'undoing'`).run().changes;
  if (n > 0) console.warn(`[asset] 현금 반영 쓰는 중 멈춤 ${n}건 — 다시 확인 필요`);
  return n;
}

// ── 설정 ──

const DEFAULT_SETTINGS: AssetCashSettings = {
  enabled: false,
  enabledDay: null,
  depositPairs: {},
  salary: { to: null, day: ASSET_CASH_DEFAULT_SALARY_DAY, shift: 'prev' },
  flowShift: 'next',
  flows: [],
};

const isKey = (v: unknown): v is AssetCashKey => {
  const o = v as AssetCashKey | null;
  return o != null && typeof o === 'object' && typeof o.name === 'string' && o.name.length > 0 && Number.isInteger(o.nth) && o.nth >= 1;
};
const isFixedKey = (v: unknown): v is AssetFixedKey => {
  const o = v as AssetFixedKey | null;
  return o != null && typeof o === 'object' && typeof o.category === 'string' && typeof o.reason === 'string' && o.reason.length > 0 && Number.isInteger(o.nth) && o.nth >= 1;
};
const isShift = (v: unknown): v is AssetCashShift => v === 'prev' || v === 'next';
const isDay = (v: unknown): v is number => Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 31;
const isTarget = (v: unknown): v is AssetCashTarget => v === 'out' || isKey(v);
const isFrom = (v: unknown): v is AssetCashFrom => v === ASSET_CASH_FROM_SALARY || isKey(v);
/** 저장 · 고치기 한 줄 — 빠지는 계좌는 「현금」 줄 · 월급 받는 계좌 따라감 · 빈칸 */
const isFlowEdit = (v: unknown): v is AssetCashFlowEdit => {
  const o = v as AssetCashFlowEdit | null;
  return o != null && typeof o === 'object' && isFixedKey(o.item) && (o.day === null || isDay(o.day)) && (o.from === null || isFrom(o.from)) && (o.to === null || isTarget(o.to));
};

/** 저장 모양 2 — 고정 흐름 빠지는 계좌에 「따라감」 */
interface StoredCashSettings extends Omit<AssetCashSettings, 'flows'> {
  flows: AssetCashFlowEdit[];
}

/** 저장값 그대로(모양 2) — 옛 모양(`v` 없음)의 빠지는 계좌 빈칸은 「월급 받는 계좌 따라감」 · 모양이 틀린 칸은 처음 값 */
export function readCashStored(): StoredCashSettings {
  const row = getDb().prepare(`SELECT value FROM app_settings WHERE key = ?`).get(SETTINGS_KEY) as { value: string } | undefined;
  let v: Partial<StoredCashSettings> & { v?: unknown } = {};
  try {
    v = row ? ((JSON.parse(row.value) as Partial<StoredCashSettings>) ?? {}) : {};
  } catch {
    v = {};
  }
  const s = DEFAULT_SETTINGS;
  const pairs: Record<string, AssetCashKey> = {};
  if (v.depositPairs && typeof v.depositPairs === 'object') for (const [k, key] of Object.entries(v.depositPairs)) if (isKey(key)) pairs[k] = key;
  const salary = (v.salary ?? {}) as Partial<AssetCashSettings['salary']>;
  const old = v.v !== 2;
  return {
    enabled: v.enabled === true,
    enabledDay: typeof v.enabledDay === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v.enabledDay) ? v.enabledDay : null,
    depositPairs: pairs,
    salary: { to: isKey(salary.to) ? salary.to : null, day: isDay(salary.day) ? salary.day : s.salary.day, shift: isShift(salary.shift) ? salary.shift : s.salary.shift },
    flowShift: isShift(v.flowShift) ? v.flowShift : s.flowShift,
    flows: Array.isArray(v.flows) ? v.flows.filter(isFlowEdit).map((f) => (old && f.from === null ? { ...f, from: ASSET_CASH_FROM_SALARY } : f)) : [],
  };
}

/** 저장값 → 반영에 쓰는 설정 — 「따라감」 은 지금 월급 받는 계좌 열쇠(없거나 들어가는 계좌와 같으면 빈칸 = 반영 안 함) */
export function resolveCashSettings(st: StoredCashSettings): AssetCashSettings {
  const salaryTo = st.salary.to;
  return {
    ...st,
    flows: st.flows.map((f) => {
      if (f.from !== ASSET_CASH_FROM_SALARY) return f as AssetCashFlowSetting;
      const same = salaryTo != null && f.to != null && f.to !== 'out' && sameCashKey(salaryTo, f.to);
      return { ...f, from: salaryTo && !same ? salaryTo : null };
    }),
  };
}

/** 반영 · 예약 · 화면이 쓰는 설정(따라감을 푼 것) */
export const readCashSettings = (): AssetCashSettings => resolveCashSettings(readCashStored());

function putSettings(next: StoredCashSettings): void {
  getDb().prepare(`INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(SETTINGS_KEY, JSON.stringify({ v: 2, ...next }));
}

/** 시험이 지운다 */
export const clearCashSettingsForTest = (): void => void getDb().prepare(`DELETE FROM app_settings WHERE key = ?`).run(SETTINGS_KEY);

/** 설정 검사에 쓰는 지금 시트 — 계좌 key · 「현금」 줄 · 「월 고정지출」 줄(못 읽었으면 null — 고정 흐름 고치기만 막는다) */
export interface CashSheetNow {
  sections: string[];
  lines: CashLine[];
  fixed: FixedLine[] | null;
}

/**
 * 고칠 칸만(`AssetCashSettingsPatchV2`) — 틀리면 null(요청 전체 거절). 「현금」 줄 · 「월 고정지출」 줄은 **지금 시트에 있는 것만** 고를 수 있다.
 * 켜면 그날(`today`)을 `enabledDay` 로 — 그 앞 날짜는 반영하지 않는다(끄고 다시 켜면 다시 그날부터).
 * `flow`(139차 이름)와 `flowEdit` 은 같은 한 줄 고치기 · `flowDayAll` = 반영하는 분류의 ₩0 아닌 줄 모두 그 날(설정이 없던 줄은 빠지는 계좌 = 따라감 · 들어가는 계좌 = 분류 기본값).
 */
export function writeCashSettings(patch: unknown, now: CashSheetNow, today: string): AssetCashSettings | null {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return null;
  const p = patch as AssetCashSettingsPatchV2 & Record<string, unknown>;
  const keys = Object.keys(p);
  const known = ['enabled', 'depositPair', 'salary', 'flowShift', 'flow', 'flowEdit', 'flowDayAll'];
  if (keys.length === 0 || !keys.every((k) => known.includes(k))) return null;
  if (p.flow !== undefined && p.flowEdit !== undefined) return null;
  const cur = readCashStored();
  const next: StoredCashSettings = { ...cur, depositPairs: { ...cur.depositPairs }, salary: { ...cur.salary }, flows: [...cur.flows] };
  const lineOk = (k: AssetCashKey) => findCashLine(now.lines, k) != null;

  if (p.enabled !== undefined) {
    if (typeof p.enabled !== 'boolean') return null;
    if (p.enabled && !cur.enabled) next.enabledDay = today;
    next.enabled = p.enabled;
  }
  if (p.depositPair !== undefined) {
    const d = p.depositPair as { section?: unknown; key?: unknown } | null;
    if (!d || typeof d.section !== 'string' || !now.sections.includes(d.section)) return null;
    if (d.key === null) delete next.depositPairs[d.section];
    else if (isKey(d.key) && lineOk(d.key)) next.depositPairs[d.section] = storedCashKey(now.lines, d.key);
    else return null;
  }
  if (p.salary !== undefined) {
    const sp = p.salary as Record<string, unknown> | null;
    if (!sp || typeof sp !== 'object' || Object.keys(sp).length === 0 || !Object.keys(sp).every((k) => ['to', 'day', 'shift'].includes(k))) return null;
    if (sp.to !== undefined) {
      if (sp.to === null) next.salary.to = null;
      else if (isKey(sp.to) && lineOk(sp.to)) next.salary.to = storedCashKey(now.lines, sp.to);
      else return null;
    }
    if (sp.day !== undefined) {
      if (!isDay(sp.day)) return null;
      next.salary.day = sp.day;
    }
    if (sp.shift !== undefined) {
      if (!isShift(sp.shift)) return null;
      next.salary.shift = sp.shift;
    }
  }
  if (p.flowShift !== undefined) {
    if (!isShift(p.flowShift)) return null;
    next.flowShift = p.flowShift;
  }
  const edit = p.flowEdit ?? p.flow;
  if (edit !== undefined) {
    const f = edit as unknown;
    if (!isFlowEdit(f)) return null;
    const idx = next.flows.findIndex((x) => sameItem(x.item, f.item));
    const empty = f.day === null && f.from === null && f.to === null;
    if (empty) {
      // 지우기는 시트에서 사라진 줄도 된다(「다시 확인 필요」 줄 정리)
      if (idx >= 0) next.flows.splice(idx, 1);
    } else {
      const item = now.fixed ? findFixedLine(now.fixed, f.item) : null;
      if (!item || !item.reflect) return null;
      if (f.from && f.from !== ASSET_CASH_FROM_SALARY && !lineOk(f.from)) return null;
      if (f.to && f.to !== 'out' && !lineOk(f.to)) return null;
      const fromKey = f.from === ASSET_CASH_FROM_SALARY ? next.salary.to : f.from;
      if (fromKey && f.to && f.to !== 'out' && sameCashKey(fromKey, f.to)) return null;
      const clean: AssetCashFlowEdit = {
        item: storedFixedKey(now.fixed!, item.key),
        day: f.day,
        from: f.from === ASSET_CASH_FROM_SALARY ? ASSET_CASH_FROM_SALARY : f.from ? storedCashKey(now.lines, f.from) : null,
        to: f.to === 'out' ? 'out' : f.to ? storedCashKey(now.lines, f.to) : null,
      };
      if (idx >= 0) next.flows[idx] = clean;
      else next.flows.push(clean);
    }
  }
  if (p.flowDayAll !== undefined) {
    if (!isDay(p.flowDayAll) || !now.fixed) return null;
    for (const line of now.fixed) {
      if (!line.reflect || line.amount == null || !(line.amount > 0)) continue;
      const idx = next.flows.findIndex((x) => findFixedLine(now.fixed!, x.item)?.row === line.row);
      if (idx >= 0) next.flows[idx] = { ...next.flows[idx], day: p.flowDayAll };
      else next.flows.push({ item: storedFixedKey(now.fixed, line.key), day: p.flowDayAll, from: ASSET_CASH_FROM_SALARY, to: assetCashDefaultTo(line.key.category) });
    }
  }
  putSettings(next);
  return readCashSettings();
}

const sameItem = (a: AssetFixedKey, b: AssetFixedKey) => a.category === b.category && a.reason === b.reason && a.nth === b.nth;

/** 쓰기를 해도 되나 — 시트 쓰기 스위치 **그리고** 설정 켬 */
export const isCashWriteOn = (): boolean => isAssetSyncEnabled() && readCashSettings().enabled;

// ── 시트 읽기 · 쓰기 ──

/** 「현금」 B:C · 「월 고정지출」 A:Z 넓은 범위 */
export const cashWide = () => wideRange(CASH_TAB, SHEET_LAYOUT.cash.lastColumn);
export const fixedWide = () => `'${SHEET_LAYOUT.fixedCosts.tab.replace(/'/g, "''")}'!A1:${SHEET_LAYOUT.fixedCosts.lastColumn}`;

/** 「월 고정지출」 을 읽어 표 · 월급(값으로) — 실패는 `AssetSheetError` */
export async function readFixedSheet(config: AssetSheetConfig): Promise<{ fixed: FixedLine[]; salary: number | null }> {
  const [rows] = await batchGet(config, [fixedWide()], 'UNFORMATTED_VALUE');
  return { fixed: fixedLines(rows), salary: salaryOf(rows) };
}

/** 건너뛸 까닭 — 쓰지 않았다(시트 그대로) */
export class CashSkip extends Error {
  constructor(readonly reason: AssetCashReason, readonly detail: string | null = null) {
    super(reason);
  }
}

/**
 * 쓰기 요청을 **보낸 뒤**의 실패(응답 시간 초과 · 쓴 뒤 다시 읽기 실패 등) — 시트가 이미 바뀌었을 수 있다.
 * 다시 쓰지도(예약), 「반영」 으로 되돌리지도(되돌리기) 않고 「다시 확인 필요」 로 남긴다(두 번 쓰지 않게).
 */
export class CashMaybeWritten extends Error {
  constructor(readonly kind: string) {
    super(kind);
  }
}

/** 쓴 칸 하나의 전 · 뒤 */
export interface CashSide {
  row: number;
  before: number;
  after: number;
}

export interface CashWriteResult {
  from: CashSide | null;
  to: CashSide | null;
}

/** 금액 칸 — 숫자만(수식 · 빈칸 · 글자는 건너뜀) */
function amountOf(line: CashLine): number {
  const c = line.cell;
  if (typeof c === 'string' && c.trim().startsWith('=')) throw new CashSkip('formula-cell');
  if (typeof c !== 'number' || !Number.isFinite(c)) throw new CashSkip('not-number');
  return c;
}

const sameNum = (a: number, b: number) => Math.abs(a - b) < 1e-6;
/** 원 단위 계산 — 소수 둘째 자리까지 반올림(부동소수 찌꺼기를 남기지 않게 · 시트 금액은 원 단위 정수가 보통) */
const plus = (a: number, b: number) => Math.round((a + b) * 100) / 100;

/**
 * 「현금」 은행 계좌 줄 C열에 한 번 쓰기 — 출금 줄 −금액 · 입금 줄 +금액(둘 중 하나는 없어도 된다)을 **한 요청**으로.
 * ① 「현금」 B:C 를 수식 그대로 다시 읽어 이름 · 순서로 줄을 찾음(못 찾으면 `missing-row`) ② 지금 숫자(수식 · 빈칸 · 글자면 건너뜀)
 * ③ `valuesWrite`(RAW · 은행 계좌 줄 C열만) ④ 다시 읽어 같은지 — 다르면 `mismatch`(이미 쓴 뒤라 `CashSkip` 이 아니라 결과에 `mismatch: true`).
 * 쓰기 전에 실패하면 `CashSkip`(시트 그대로) · 구글 실패는 `AssetSheetError`.
 */
export async function writeCashMove(config: AssetSheetConfig, from: AssetCashKey | null, to: AssetCashKey | null, amount: number): Promise<CashWriteResult & { mismatch: boolean }> {
  if (!(amount > 0)) throw new CashSkip('zero');
  if (amount > ASSET_CASH_MAX) throw new CashSkip('not-number', 'too-large');
  if (!from && !to) throw new CashSkip('missing-row');
  if (from && to && sameCashKey(from, to)) throw new CashSkip('missing-row');
  const [rows] = await batchGet(config, [cashWide()], 'FORMULA');
  const lines = cashLines(rows);
  const fromLine = from ? findCashLine(lines, from) : null;
  const toLine = to ? findCashLine(lines, to) : null;
  if ((from && !fromLine) || (to && !toLine)) throw new CashSkip('missing-row');
  const sides: { line: CashLine; before: number; after: number }[] = [];
  if (fromLine) {
    const b = amountOf(fromLine);
    sides.push({ line: fromLine, before: b, after: plus(b, -amount) });
  }
  if (toLine) {
    const b = amountOf(toLine);
    sides.push({ line: toLine, before: b, after: plus(b, amount) });
  }
  // 쓰는 칸 = 방금 찾은 은행 계좌 줄의 C열뿐(총액 줄 · 이름 칸 · 퇴직 연금 줄은 `cashLines` 가 내지 않는다)
  const cells: CellWrite[] = sides.map((s) => ({ range: one(CASH_TAB, `C${s.line.row}`), value: s.after }));
  try {
    await valuesWrite(config, cells, 'RAW');
  } catch (e) {
    // 구글이 분명히 거절한 것(권한 · 인증 · 범위 · 시트 없음 — 4xx)은 쓰이지 않았다 · 네트워크(시간 초과) · 5xx 는 쓰였을 수 있다
    if (e instanceof AssetSheetError && e.kind !== 'network') throw e;
    throw new CashMaybeWritten(e instanceof AssetSheetError ? e.kind : 'unknown');
  }
  let back: CellRows[];
  try {
    // 다시 읽기는 이름(B)까지 — 그 사이 사용자가 줄을 넣어 C{줄} 이 다른 계좌가 됐는지도 본다
    back = await batchGet(config, sides.map((s) => one(CASH_TAB, `B${s.line.row}:C${s.line.row}`)), 'FORMULA');
  } catch (e) {
    throw new CashMaybeWritten(e instanceof AssetSheetError ? e.kind : 'unknown');
  }
  const mismatch = !sides.every((s, i) => {
    const row = back[i]?.[0] ?? [];
    return cellName(row[0]) === s.line.key.name && typeof row[1] === 'number' && sameNum(row[1], s.after);
  });
  const sideOf = (line: CashLine | null) => {
    const s = line ? sides.find((x) => x.line === line) : null;
    return s ? { row: s.line.row, before: s.before, after: s.after } : null;
  };
  return { from: sideOf(fromLine), to: sideOf(toLine), mismatch };
}

/** 한 번에 한 반영씩(예약 · 매수 · 매도 · 되돌리기가 같은 칸을 동시에 읽고 쓰지 않게) — 앞의 것이 끝나면 다음 */
let chain: Promise<unknown> = Promise.resolve();
export function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = chain.then(fn, fn);
  chain = run.catch(() => undefined);
  return run;
}

/** 반영 한 건 */
export interface CashMoveInput {
  kind: AssetCashMoveKindAll;
  /** 항목 열쇠 글자(월급 · 고정 흐름은 그 달 한 번의 기준) */
  itemKey: string;
  label: string;
  month: string;
  day: string;
  from: AssetCashKey | null;
  to: AssetCashKey | null;
  amount: number;
}

export type CashMoveOutcome = { id: number; status: 'applied' | 'skipped' | 'check'; reason: AssetCashReason | null; detail: string | null } | { id: null; status: 'duplicate'; reason: null; detail: null };

const nowIso = () => new Date().toISOString();

/** 쓰지 않고 「건너뜀」 한 줄 — 월급 · 고정 흐름은 그 달 자리를 잡는다(이미 있으면 그대로) */
export function recordCashSkip(m: CashMoveInput, reason: AssetCashReason, detail: string | null = null): CashMoveOutcome {
  const res = db()
    .prepare(`INSERT OR IGNORE INTO asset_cash_moves (at, kind, item_key, label, month, day, from_key, to_key, amount, status, reason, detail) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'skipped', ?, ?)`)
    .run(nowIso(), m.kind, m.itemKey, m.label, m.month, m.day, m.from ? JSON.stringify(m.from) : null, m.to ? JSON.stringify(m.to) : null, m.amount, reason, detail);
  if (res.changes === 0) return { id: null, status: 'duplicate', reason: null, detail: null };
  const id = Number(res.lastInsertRowid);
  console.log(`[asset] 현금 반영 건너뜀 id=${id} ${m.kind} ${reason}${detail ? `(${detail})` : ''}`);
  return { id, status: 'skipped', reason, detail };
}

/**
 * 반영 한 건 — 스위치 확인 → 「쓰는 중」 줄로 자리 잡기(월급 · 고정 흐름은 그 달에 이미 있으면 쓰기 0 · `duplicate`) → `writeCashMove` → 상태.
 * 시트를 쓰지 못하면(줄 없음 · 숫자 아님 · 구글 실패) 「건너뜀(까닭)」 · 쓴 뒤 다시 읽은 값이 다르면 「다시 확인 필요」.
 * `transientRetry` 면 구글 실패(네트워크 등)는 기록 없이 다시 던진다(예약이 다음 확인에 다시 — 그 달 자리를 잡지 않는다).
 */
export function applyCashMove(m: CashMoveInput, opts: { transientRetry?: boolean; manual?: boolean } = {}): Promise<CashMoveOutcome> {
  return serial(async () => {
    // 직접 입출금(`manual`)은 시트 쓰기 스위치만 본다(사용자 결정 2026-11-17 — 「현금 자동 반영」 이 꺼져 있어도 됨)
    if (opts.manual ? !isAssetSyncEnabled() : !isCashWriteOn()) throw new AssetSheetError('disabled', opts.manual ? '시트 쓰기가 꺼져 있어요.' : '현금 자동 반영이 꺼져 있습니다.');
    const config = assetSheetConfig();
    if (!config) throw new AssetSheetError('not-configured', '시트 연결 정보가 없습니다(`.env`).');
    const d = db();
    const ins = d
      .prepare(`INSERT OR IGNORE INTO asset_cash_moves (at, kind, item_key, label, month, day, from_key, to_key, amount, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`)
      .run(nowIso(), m.kind, m.itemKey, m.label, m.month, m.day, m.from ? JSON.stringify(m.from) : null, m.to ? JSON.stringify(m.to) : null, m.amount);
    if (ins.changes === 0) return { id: null, status: 'duplicate', reason: null, detail: null };
    const id = Number(ins.lastInsertRowid);
    const finish = (status: 'applied' | 'skipped' | 'check', reason: AssetCashReason | null, detail: string | null, w?: CashWriteResult) => {
      d.prepare(`UPDATE asset_cash_moves SET status = ?, reason = ?, detail = ?, before_json = ?, after_json = ? WHERE id = ?`).run(
        status, reason, detail,
        w ? JSON.stringify({ from: w.from?.before ?? null, to: w.to?.before ?? null }) : null,
        w ? JSON.stringify({ from: w.from?.after ?? null, to: w.to?.after ?? null }) : null,
        id,
      );
      console.log(`[asset] 현금 반영 id=${id} ${m.kind} ${status}${reason ? ` ${reason}` : ''}${detail ? `(${detail})` : ''}`);
      return { id, status, reason, detail };
    };
    try {
      const w = await writeCashMove(config, m.from, m.to, m.amount);
      return w.mismatch ? finish('check', 'mismatch', null, w) : finish('applied', null, null, w);
    } catch (e) {
      // 직접 입출금 — 쓰기 전 실패(줄 못 찾음 · 숫자 아님 · 구글 거절)는 쓰지 않았다: 기록을 남기지 않고(같은 요청 번호로 다시 할 수 있게) 까닭을 던진다
      if (opts.manual && !(e instanceof CashMaybeWritten)) {
        d.prepare(`DELETE FROM asset_cash_moves WHERE id = ? AND status = 'pending'`).run(id);
        throw e;
      }
      if (e instanceof CashSkip) return finish('skipped', e.reason, e.detail);
      // 쓰기 요청을 보낸 뒤 실패 — 쓰였을 수 있다: 다시 쓰지 않고 「다시 확인 필요」(그 달 자리도 그대로)
      if (e instanceof CashMaybeWritten) return finish('check', 'write-failed', e.kind);
      const kind = e instanceof AssetSheetError ? e.kind : 'unknown';
      // 다음 확인에 다시 하는 것은 네트워크 · 구글 일시 오류뿐(쓰기 전) — 설정 오류(권한 · 열쇠 · 시트 없음)는 「건너뜀(까닭)」 으로 남긴다
      if (opts.transientRetry && kind === 'network') {
        // 그 달 자리를 내놓는다 — 다음 확인에 다시(쓰기 전 실패라 시트 그대로)
        d.prepare(`DELETE FROM asset_cash_moves WHERE id = ? AND status = 'pending'`).run(id);
        throw e;
      }
      return finish('skipped', kind === 'shape' ? 'missing-row' : 'write-failed', kind);
    }
  });
}

/**
 * 되돌리기 — 「반영」 줄만. 「되돌리는 중」 으로 먼저 바꿔(두 번 누름 · 두 서버 요청이 겹쳐도 한 번) 반대 금액을 **지금 숫자**에 쓴다
 * (출금 줄 +금액 · 입금 줄 −금액 · 같은 `writeCashMove`). 쓰지 못하면 「반영」 으로 되돌리고 이유를 알린다 · 다시 읽은 값이 다르면 「다시 확인 필요」.
 */
export function undoCashMove(id: unknown): Promise<AssetCashMoveRecordAll> {
  return serial(async () => {
    // 직접 입출금 기록은 시트 쓰기 스위치만 본다(「현금 자동 반영」 이 꺼져 있어도 되돌림) · 그 밖 기록은 지금 그대로
    if (!isCashWriteOn() && !(isAssetSyncEnabled() && isManualMoveId(id))) throw new AssetSheetError('disabled', '현금 자동 반영이 꺼져 있어 되돌릴 수 없습니다.');
    if (typeof id !== 'number' || !Number.isInteger(id) || id < 1) throw new AssetSheetError('not-editable', '되돌릴 기록이 올바르지 않습니다.');
    const config = assetSheetConfig();
    if (!config) throw new AssetSheetError('not-configured', '시트 연결 정보가 없습니다(`.env`).');
    const d = db();
    const row = d.prepare(`SELECT * FROM asset_cash_moves WHERE id = ?`).get(id) as MoveRow | undefined;
    if (!row) throw new AssetSheetError('not-editable', '되돌릴 기록이 없습니다.');
    if (d.prepare(`UPDATE asset_cash_moves SET status = 'undoing' WHERE id = ? AND status = 'applied'`).run(id).changes !== 1) {
      throw new AssetSheetError('already-done', row.status === 'undone' ? '이미 되돌린 기록입니다.' : '「반영」 기록만 되돌릴 수 있습니다.');
    }
    try {
      // 반대로: 입금했던 줄에서 빼고(출금 쪽) 출금했던 줄에 더한다(입금 쪽)
      const w = await writeCashMove(config, parseKey(row.to_key), parseKey(row.from_key), row.amount);
      const undo = JSON.stringify({ before: { from: w.to?.before ?? null, to: w.from?.before ?? null }, after: { from: w.to?.after ?? null, to: w.from?.after ?? null } });
      if (w.mismatch) d.prepare(`UPDATE asset_cash_moves SET status = 'check', reason = 'mismatch', undone_at = ?, undo_json = ? WHERE id = ?`).run(nowIso(), undo, id);
      else d.prepare(`UPDATE asset_cash_moves SET status = 'undone', undone_at = ?, undo_json = ? WHERE id = ?`).run(nowIso(), undo, id);
      console.log(`[asset] 현금 반영 되돌림 id=${id}${w.mismatch ? ' mismatch' : ''}`);
    } catch (e) {
      if (e instanceof CashMaybeWritten) {
        // 되돌리기 요청을 보낸 뒤 실패 — 되돌려졌을 수 있다: 「반영」 으로 두면 다시 눌러 두 번 되돌린다
        d.prepare(`UPDATE asset_cash_moves SET status = 'check', reason = 'write-failed', detail = 'undo', undone_at = ? WHERE id = ? AND status = 'undoing'`).run(nowIso(), id);
        console.warn(`[asset] 현금 반영 되돌리기 확인 못 함 id=${id} ${e.kind}`);
        throw new AssetSheetError('network', '되돌렸는지 확인하지 못했어요 — 시트 「현금」 탭을 확인해 주세요(기록은 「다시 확인 필요」).');
      }
      d.prepare(`UPDATE asset_cash_moves SET status = 'applied' WHERE id = ? AND status = 'undoing'`).run(id);
      if (e instanceof CashSkip) {
        console.warn(`[asset] 현금 반영 되돌리기 못 함 id=${id} ${e.reason}`);
        throw new AssetSheetError('sheet-changed', `되돌리지 못했어요 — 시트에서 고쳐 주세요(${CASH_SKIP_TEXT[e.reason] ?? e.reason}).`);
      }
      throw e;
    }
    return recordOf(d.prepare(`SELECT * FROM asset_cash_moves WHERE id = ?`).get(id) as MoveRow);
  });
}

/** 직접 입출금 기록인가(되돌리기 켬 판단) */
function isManualMoveId(id: unknown): boolean {
  if (typeof id !== 'number' || !Number.isInteger(id) || id < 1) return false;
  const r = db().prepare(`SELECT kind FROM asset_cash_moves WHERE id = ?`).get(id) as { kind: string } | undefined;
  return r != null && ['transfer', 'deposit', 'withdraw'].includes(r.kind);
}

/** 되돌리기 실패 문구 — 화면 문구(`ASSET_CASH_REASON_LABEL`)와 같은 뜻 */
export const CASH_SKIP_TEXT: Partial<Record<AssetCashReason, string>> = {
  'missing-row': '「현금」 줄을 찾지 못함',
  'not-number': '금액 칸이 숫자가 아님',
  'formula-cell': '금액 칸이 수식',
};

/** 지금 「현금」 줄(값) · 「월 고정지출」(못 읽으면 이유) — 설정 화면 · 설정 저장 검사 */
export async function readCashSheetNow(config: AssetSheetConfig): Promise<{ lines: CashLine[]; fixed: FixedLine[] | null; salary: number | null; fixedError: string | null }> {
  const [cashRows] = await batchGet(config, [cashWide()], 'UNFORMATTED_VALUE');
  const lines = cashLines(cashRows);
  try {
    const f = await readFixedSheet(config);
    return { lines, fixed: f.fixed, salary: f.salary, fixedError: null };
  } catch (e) {
    if (e instanceof AssetSheetError) return { lines, fixed: null, salary: null, fixedError: e.message };
    throw e;
  }
}

// ── 매수 · 매도 때 예수금(①) ──

/**
 * 요청의 `cashAmount`(원) — 없으면 null(예수금은 안 바꿈) · 0 이상 정수 · 상한 안. 틀리면 `not-editable`(보유 쓰기 **전에** 거절 — 시트는 그대로).
 */
export function parseCashAmount(body: unknown): number | null {
  const v = body && typeof body === 'object' ? (body as Record<string, unknown>).cashAmount : undefined;
  if (v === undefined || v === null) return null;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > ASSET_CASH_MAX) {
    throw new AssetSheetError('not-editable', '예수금 금액은 0 이상 원 단위 정수여야 합니다.');
  }
  return v;
}

/** 매매 기록의 종목 이름 — 화면 「무엇」(60자까지) */
const tradeLabel = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 60) : '종목');

/** 예수금 결과 문구 — 보유는 이미 바뀌었고 예수금만 못 바꾼 때 */
const cashFailText = (reason: AssetCashReason | null) =>
  `예수금 줄은 바꾸지 못했어요 — 시트에서 고쳐 주세요(${reason ? (CASH_SKIP_TEXT[reason] ?? CASH_REASON_TEXT[reason] ?? reason) : '알 수 없음'}).`;
const CASH_REASON_TEXT: Partial<Record<AssetCashReason, string>> = { mismatch: '쓴 뒤 다시 읽은 값이 다름', 'write-failed': '시트를 읽거나 쓰지 못함' };

/**
 * 보유 줄 쓰기가 **성공한 뒤** 예수금 줄 쓰기(①). 짝이 없거나 · 꺼졌거나 · 금액이 없거나 0 이면 `none`(쓰기 0 · 지금과 같음).
 * 매수 = 짝 줄에서 출금 · 매도 = 짝 줄로 입금(밖과 오가는 돈이라 한 줄만). 실패해도 보유는 그대로 — 「건너뜀」 기록 + 안내 문구.
 */
export async function tradeCash(side: 'buy' | 'sell', section: string, tradeId: number, name: unknown, amount: number | null, today: string): Promise<AssetCashTradeOutcome> {
  const none: AssetCashTradeOutcome = { cash: { status: 'none', message: null } };
  if (amount == null || amount === 0 || !isCashWriteOn()) return none;
  const pair = readCashSettings().depositPairs[section];
  if (!pair) return none;
  const m: CashMoveInput = { kind: side, itemKey: `trade:${tradeId}`, label: tradeLabel(name), month: today.slice(0, 7), day: today, from: side === 'buy' ? pair : null, to: side === 'sell' ? pair : null, amount };
  try {
    const r = await applyCashMove(m);
    if (r.status === 'applied') return { cash: { status: 'applied', message: null } };
    if (r.status === 'check') return { cash: { status: 'skipped', message: '예수금 줄이 바뀌었는지 확인하지 못했어요 — 시트 「현금」 탭을 확인해 주세요(다시 빼거나 더하기 전에).' } };
    return { cash: { status: 'skipped', message: cashFailText(r.reason) } };
  } catch (e) {
    const kind = e instanceof AssetSheetError ? e.kind : 'unknown';
    recordCashSkip(m, 'write-failed', kind);
    return { cash: { status: 'skipped', message: cashFailText('write-failed') } };
  }
}
