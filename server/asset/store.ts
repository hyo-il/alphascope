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
        done_at TEXT                    -- 「구매 완료」 를 누른 날(한국 날짜 YYYY-MM-DD — 시트 계좌 이름에 쓴 날짜)
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

/** 시험이 표를 비운다(사본 DB) · 줄 수를 센다 */
export function clearPurchasesForTest(): void {
  purchaseDb().prepare(`DELETE FROM asset_purchase`).run();
}
export const purchaseCountForTest = (): number => (purchaseDb().prepare(`SELECT COUNT(*) AS n FROM asset_purchase`).get() as { n: number }).n;
