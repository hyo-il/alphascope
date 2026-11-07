/**
 * 자산 하루 기록 표 `asset_daily`(v2.62.0) — 선택 기능이라 이 폴더에서 만든다(`server/gemini/targetAnalysis.ts` 와 같은 방식).
 * 미국 거래일마다 한 줄(`day` 가 기본 키 — 같은 날 두 번 쓰지 않는다 · `INSERT OR IGNORE`). 지난 날은 채우지 않는다.
 * ⚠️ 금액은 이 표에만 — 로그 · 응답 밖으로 내보내지 않는다(화면 응답은 자산 문지기 뒤).
 */
import { getDb } from '../db';
import { ASSET_GROUP_LABEL, type AssetHistoryPoint, type AssetHistoryRange, type AssetTotals } from '../../src/types/asset';

let ready = false;
function db() {
  const database = getDb();
  if (!ready) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS asset_daily (
        day TEXT PRIMARY KEY,           -- 미국 거래일(토스 달력 날짜) — 그날 미국 애프터가 끝난 뒤 1번
        total REAL NOT NULL,            -- 총 자산(연금 뺌, 원) — 가격 못 받은 줄은 빠진 값
        total_pension REAL NOT NULL,    -- 연금 포함 총 자산(원)
        totals_json TEXT NOT NULL,      -- {"plain": AssetTotals, "pension": AssetTotals} — 분류별 금액 · 코어 · 위성 · 가격 못 받은 줄 수
        missing INTEGER NOT NULL,       -- 가격 못 받은 줄 수(연금 포함 기준 — 모든 구간)
        recorded_at TEXT NOT NULL       -- 기록 시각(ISO)
      );
    `);
    ready = true;
  }
  return database;
}

export interface DailyRecord {
  day: string;
  total: number;
  totalPension: number;
  plain: AssetTotals;
  pension: AssetTotals;
  missing: number;
  recordedAt: string;
}

/** 그날 기록이 있는가 */
export const hasRecord = (day: string): boolean => db().prepare(`SELECT 1 FROM asset_daily WHERE day = ?`).get(day) !== undefined;

/** 한 줄 쓰기 — 이미 있으면 쓰지 않고 false */
export function insertRecord(day: string, plain: AssetTotals, pension: AssetTotals, recordedAt: string): boolean {
  const r = db()
    .prepare(`INSERT OR IGNORE INTO asset_daily (day, total, total_pension, totals_json, missing, recorded_at) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(day, plain.total, pension.total, JSON.stringify({ plain, pension }), pension.missing, recordedAt);
  return r.changes === 1;
}

/** 저장된 묶음 이름을 지금 이름으로 — 옛 기록(v2.62.0 · v2.62.1)에 저장된 옛 이름도 「미지정」(저장값은 고치지 않는다) */
const relabel = (t: AssetTotals): AssetTotals => ({ ...t, groups: t.groups.map((g) => ({ ...g, label: ASSET_GROUP_LABEL[g.key] ?? g.label })) });

/** 가장 최근 기록 — 「어제보다」 의 기준 */
export function latestRecord(): DailyRecord | null {
  const row = db().prepare(`SELECT * FROM asset_daily ORDER BY day DESC LIMIT 1`).get() as
    | { day: string; total: number; total_pension: number; totals_json: string; missing: number; recorded_at: string }
    | undefined;
  if (!row) return null;
  const t = JSON.parse(row.totals_json) as { plain: AssetTotals; pension: AssetTotals };
  return { day: row.day, total: row.total, totalPension: row.total_pension, plain: relabel(t.plain), pension: relabel(t.pension), missing: row.missing, recordedAt: row.recorded_at };
}

const RANGE_DAYS: Record<Exclude<AssetHistoryRange, 'all'>, number> = { '1m': 31, '3m': 92, '1y': 366 };
export const isHistoryRange = (v: unknown): v is AssetHistoryRange => v === 'all' || (typeof v === 'string' && v in RANGE_DAYS);

/** 기간 안의 하루 기록(날짜 순) — 오늘(UTC 날짜)부터 거꾸로 N일 */
export function historyPoints(range: AssetHistoryRange, includePension: boolean, now = Date.now()): AssetHistoryPoint[] {
  const col = includePension ? 'total_pension' : 'total';
  const rows = db().prepare(`SELECT day, ${col} AS total FROM asset_daily ORDER BY day`).all() as AssetHistoryPoint[];
  if (range === 'all') return rows;
  const from = new Date(now - RANGE_DAYS[range] * 86_400_000).toISOString().slice(0, 10);
  return rows.filter((r) => r.day > from);
}

/** 시험이 표를 비운다(사본 DB) */
export function clearRecordsForTest(): void {
  db().prepare(`DELETE FROM asset_daily`).run();
}

// ── 구매 완료 기록 `asset_purchase`(v2.64.0) — 구매 차례(구매일)마다 한 줄 · 시트 계좌 이름 날짜를 바꾼 뒤에만 쓴다 ──
let purchaseReady = false;
function purchaseDb() {
  const database = getDb();
  if (!purchaseReady) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS asset_purchase (
        cycle_date TEXT PRIMARY KEY,    -- 구매 차례 = 그 달 구매일(한국 날짜 YYYY-MM-DD)
        done_at TEXT                    -- 「구매 완료」 를 누른 날(한국 날짜 YYYY-MM-DD — 시트에는 차례의 날짜를 쓴다 · v2.64.1)
      );
    `);
    purchaseReady = true;
  }
  return database;
}

/** 그 차례에 「구매 완료」 를 누른 날 — 없으면 null */
export function purchaseDoneDay(cycleDay: string): string | null {
  const row = purchaseDb().prepare(`SELECT done_at FROM asset_purchase WHERE cycle_date = ?`).get(cycleDay) as { done_at: string | null } | undefined;
  return row ? (row.done_at ?? cycleDay) : null;
}

/** 한 줄 쓰기 — 이미 있으면 쓰지 않고 false */
export function recordPurchase(cycleDay: string, doneDay: string): boolean {
  return purchaseDb().prepare(`INSERT OR IGNORE INTO asset_purchase (cycle_date, done_at) VALUES (?, ?)`).run(cycleDay, doneDay).changes === 1;
}

/**
 * 이 기능을 쓰기 시작한 날(v2.64.1) — `app_settings` 'asset.purchaseStartDay'(YYYY-MM-DD). 이 날보다 앞선 구매 차례는 묻지 않는다.
 * 처음 부를 때 값이 없으면 한 번 저장한다: `asset_purchase` 에 기록이 있으면 가장 이른 기록의 차례 날짜(지금까지의 기록을 「시작 전」 으로 바꾸지 않게),
 * 없으면 `today`(한국 날짜). 그 뒤로는 바꾸지 않는다.
 */
const START_KEY = 'asset.purchaseStartDay';
export function purchaseStartDay(today: string): string {
  const database = purchaseDb();
  const row = database.prepare(`SELECT value FROM app_settings WHERE key = ?`).get(START_KEY) as { value: string } | undefined;
  if (row && /^\d{4}-\d{2}-\d{2}$/.test(row.value)) return row.value;
  const first = database.prepare(`SELECT MIN(cycle_date) AS d FROM asset_purchase`).get() as { d: string | null };
  const day = first.d ?? today;
  database.prepare(`INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(START_KEY, day);
  return day;
}

/** 시험이 표 · 시작한 날을 비운다(사본 DB) · 줄 수를 센다 */
export function clearPurchasesForTest(): void {
  purchaseDb().prepare(`DELETE FROM asset_purchase`).run();
  purchaseDb().prepare(`DELETE FROM app_settings WHERE key = ?`).run(START_KEY);
}
export const purchaseStartDayStoredForTest = (): string | null =>
  (purchaseDb().prepare(`SELECT value FROM app_settings WHERE key = ?`).get(START_KEY) as { value: string } | undefined)?.value ?? null;
export const purchaseCountForTest = (): number => (purchaseDb().prepare(`SELECT COUNT(*) AS n FROM asset_purchase`).get() as { n: number }).n;

// ── 시트 가격(v2.65.0) — 바꾸기 전 원래 수식 `asset_sheet_backup` · 출처 · 바꾼 줄(`app_settings`) ──
/*
  - `asset_sheet_backup(cell, formula, saved_at)` — 「티커」 탭의 칸 주소(C9 · E14 · F14 …) → 바꾸기 전 수식 글자 그대로.
    [바꾸기] 가 시트에 쓰기 **전에** 저장한다(저장 실패면 쓰지 않음). 같은 칸은 처음 것을 지킨다(INSERT OR IGNORE — 남은 종목 바꾸기가 원래 수식을 덮지 않게).
    [되돌리기] 가 다시 읽어 같음을 확인한 뒤에만 지운다.
  - `app_settings` 'asset.priceSource'(`google` | `toss` — 없으면 google) · 'asset.priceRows'(바꾼 줄 `[{ row, code, market }]`) ·
    'asset.priceSkipped'(바꾸지 않은 줄과 이유 — 설정 창 목록).
  ⚠️ 수식 · 코드 · 이름을 로그에 찍지 않는다.
*/
let backupReady = false;
function backupDb() {
  const database = getDb();
  if (!backupReady) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS asset_sheet_backup (
        cell TEXT PRIMARY KEY,          -- 「티커」 탭 칸 주소(C9 · E14 · F14 …)
        formula TEXT NOT NULL,          -- 바꾸기 전 수식 글자 그대로([되돌리기] 가 이 글자를 다시 넣는다)
        saved_at TEXT NOT NULL          -- 저장 시각(ISO)
      );
    `);
    backupReady = true;
  }
  return database;
}

/** 원래 수식 저장 — 한 트랜잭션(하나라도 실패하면 아무것도 저장하지 않고 throw) · 이미 있는 칸은 그대로 */
export function saveSheetBackup(cells: { cell: string; formula: string }[], savedAt: string): void {
  const database = backupDb();
  const ins = database.prepare(`INSERT OR IGNORE INTO asset_sheet_backup (cell, formula, saved_at) VALUES (?, ?, ?)`);
  database.transaction(() => {
    for (const c of cells) ins.run(c.cell, c.formula, savedAt);
  })();
}

/** 저장된 원래 수식 전부(칸 주소 순) */
export const sheetBackup = (): { cell: string; formula: string }[] =>
  backupDb().prepare(`SELECT cell, formula FROM asset_sheet_backup ORDER BY cell`).all() as { cell: string; formula: string }[];

/** 되돌리기를 확인한 뒤 백업 지우기 */
export function clearSheetBackup(): void {
  backupDb().prepare(`DELETE FROM asset_sheet_backup`).run();
}

/** 되돌린 칸만 백업에서 지우기(v2.65.1 — 줄이 옮겨져 쓰지 않은 칸의 백업은 남긴다) */
export function deleteSheetBackupCells(cells: string[]): void {
  const database = backupDb();
  const del = database.prepare(`DELETE FROM asset_sheet_backup WHERE cell = ?`);
  database.transaction(() => {
    for (const c of cells) del.run(c);
  })();
}

// ── 시트가 바뀌었을 때 보관(v2.65.1 · `sheetSwitch.ts`) — 지우지 않고 옮긴다 ──
/*
  - `asset_daily_archive` — `asset_daily` 와 같은 칸 + `sheet_key`(그 기록을 쌓은 시트 ID 의 sha256 앞 12자) · `archived_at`(옮긴 시각 ISO).
    같은 시트로 다시 돌아와도 자동으로 되돌리지 않는다(보관만).
  - `asset_sheet_backup_archive` — `asset_sheet_backup` 과 같은 칸 + `sheet_key` · `sheet_hint`(그 시트 ID 앞 4글자) · `archived_at`.
    옛 시트의 원래 수식 — 새 시트에는 절대 쓰지 않는다(되돌리기는 `asset_sheet_backup` 만 읽는다).
*/
let archiveReady = false;
function archiveDb() {
  const database = getDb();
  db();
  backupDb();
  if (!archiveReady) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS asset_daily_archive (
        day TEXT NOT NULL,              -- asset_daily 와 같은 칸
        total REAL NOT NULL,
        total_pension REAL NOT NULL,
        totals_json TEXT NOT NULL,
        missing INTEGER NOT NULL,
        recorded_at TEXT NOT NULL,
        sheet_key TEXT NOT NULL,        -- 그 기록을 쌓은 시트 ID 의 sha256 앞 12자(ID 자체는 저장하지 않음)
        archived_at TEXT NOT NULL       -- 옮긴 시각(ISO)
      );
      CREATE TABLE IF NOT EXISTS asset_sheet_backup_archive (
        cell TEXT NOT NULL,             -- asset_sheet_backup 과 같은 칸
        formula TEXT NOT NULL,
        saved_at TEXT NOT NULL,
        sheet_key TEXT NOT NULL,        -- 옛 시트 ID 의 sha256 앞 12자
        sheet_hint TEXT NOT NULL,       -- 옛 시트 ID 앞 4글자(화면 「○… 시트」)
        archived_at TEXT NOT NULL
      );
    `);
    archiveReady = true;
  }
  return database;
}

/**
 * 하루 기록 · 시트 가격 백업을 보관표로 옮긴다(한 트랜잭션 — 부르는 쪽이 감싼다). 옮긴 줄 수가 원래 줄 수와 다르면 throw(아무것도 바뀌지 않음).
 * 돌려주는 값 = 옮긴 하루 기록 줄 수 · 백업 칸 수.
 */
export function archiveForSheetSwitch(oldKey: string, oldHint: string, at: string): { daily: number; backup: number } {
  const database = archiveDb();
  const count = (table: string) => (database.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
  const daily = count('asset_daily');
  const backup = count('asset_sheet_backup');
  const movedDaily = database
    .prepare(`INSERT INTO asset_daily_archive (day, total, total_pension, totals_json, missing, recorded_at, sheet_key, archived_at)
              SELECT day, total, total_pension, totals_json, missing, recorded_at, ?, ? FROM asset_daily`)
    .run(oldKey, at).changes;
  const movedBackup = database
    .prepare(`INSERT INTO asset_sheet_backup_archive (cell, formula, saved_at, sheet_key, sheet_hint, archived_at)
              SELECT cell, formula, saved_at, ?, ?, ? FROM asset_sheet_backup`)
    .run(oldKey, oldHint, at).changes;
  if (movedDaily !== daily || movedBackup !== backup) throw new Error('보관표로 옮긴 줄 수가 다릅니다');
  database.prepare(`DELETE FROM asset_daily`).run();
  database.prepare(`DELETE FROM asset_sheet_backup`).run();
  return { daily, backup };
}

/** 보관 중인 옛 시트 백업 — 칸 수 · 시트 앞 4글자(옮긴 순) */
export function archivedBackup(): { cells: number; sheets: string[] } {
  const database = archiveDb();
  const rows = database.prepare(`SELECT sheet_hint AS hint, COUNT(*) AS n, MIN(archived_at) AS at FROM asset_sheet_backup_archive GROUP BY sheet_key, sheet_hint ORDER BY at`).all() as { hint: string; n: number }[];
  return { cells: rows.reduce((a, r) => a + r.n, 0), sheets: rows.map((r) => r.hint) };
}

/** 시험이 보관표 줄 수를 센다 · 비운다(사본 DB) */
export const archiveCountsForTest = (): { daily: number; backup: number } => {
  const database = archiveDb();
  const n = (t: string) => (database.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n;
  return { daily: n('asset_daily_archive'), backup: n('asset_sheet_backup_archive') };
};
export function clearArchivesForTest(): void {
  const database = archiveDb();
  database.prepare(`DELETE FROM asset_daily_archive`).run();
  database.prepare(`DELETE FROM asset_sheet_backup_archive`).run();
}
