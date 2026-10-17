/**
 * AI 검증 저장 — `ai_checks`(날짜·종목 한 줄) · `ai_check_uses`(계좌별 사용). 표는 `db/schema.sql`.
 */
import { getDb } from '../db';
import type { AiUnavailableReason, AiVerdict } from '../../src/types/aiCheck';

export interface AiCheckRow {
  id: number;
  market_date: string;
  symbol: string;
  verdict: AiVerdict;
  reasons_json: string;
  unavailable_reason: AiUnavailableReason | null;
  price_at_check: number | null;
  model: string | null;
  prompt_version: string;
  input_json: string | null;
  raw_output: string | null;
  tokens: number | null;
  elapsed_ms: number | null;
  created_at: string;
}

/** Gemini 를 실제로 부른 「못 함」 까닭 — 하루 횟수에 센다 */
export const CALLED_UNAVAILABLE: AiUnavailableReason[] = ['rate_limit', 'error', 'timeout', 'format'];

export function findCheck(marketDate: string, symbol: string): AiCheckRow | null {
  return (getDb().prepare(`SELECT * FROM ai_checks WHERE market_date = ? AND symbol = ?`).get(marketDate, symbol) as AiCheckRow | undefined) ?? null;
}

export function insertCheck(row: Omit<AiCheckRow, 'id' | 'created_at'>, now = new Date()): AiCheckRow {
  const db = getDb();
  // 같은 날 같은 종목이 이미 있으면(드문 경합) 그 줄을 쓴다 — UNIQUE(market_date, symbol)
  db.prepare(
    `INSERT INTO ai_checks (market_date, symbol, verdict, reasons_json, unavailable_reason, price_at_check, model, prompt_version,
       input_json, raw_output, tokens, elapsed_ms, created_at)
     VALUES (@market_date, @symbol, @verdict, @reasons_json, @unavailable_reason, @price_at_check, @model, @prompt_version,
       @input_json, @raw_output, @tokens, @elapsed_ms, @created_at)
     ON CONFLICT(market_date, symbol) DO NOTHING`,
  ).run({ ...row, created_at: now.toISOString() });
  return findCheck(row.market_date, row.symbol)!;
}

/**
 * 그날(한국 시간 날짜) **실제로 Gemini 를 부른** 수 — 통과 · 위험 · 부른 뒤 못 한 것(한도 초과 · 오류 · 시간 초과 · 형식).
 * 꺼짐 · 하루 한도로 못 한 줄, 부르기 전 정보 모으기에서 실패한 줄(input_json 없음), 저장된 결과 재사용은 세지 않는다. 따로 카운터를 두지 않는다(재시작해도 같다).
 */
export function countCallsOn(kstDate: string): number {
  const placeholders = CALLED_UNAVAILABLE.map(() => '?').join(', ');
  return (
    getDb()
      .prepare(
        `SELECT COUNT(*) AS n FROM ai_checks
          WHERE date(created_at, '+9 hours') = ?
            AND (verdict IN ('pass', 'risk') OR (unavailable_reason IN (${placeholders}) AND input_json IS NOT NULL))`,
      )
      .get(kstDate, ...CALLED_UNAVAILABLE) as { n: number }
  ).n;
}

export function addUse(checkId: number, accountId: number, action: 'bought' | 'skipped', orderId: number | null, now = new Date()): void {
  getDb()
    .prepare(`INSERT INTO ai_check_uses (check_id, account_id, action, order_id, created_at) VALUES (?, ?, ?, ?, ?)`)
    .run(checkId, accountId, action, orderId, now.toISOString());
}

export interface UseRow extends AiCheckRow {
  use_id: number;
  account_id: number;
  action: 'bought' | 'skipped';
  order_id: number | null;
  used_at: string;
}

/** 계좌가 쓴 검증 — 최근 것부터. `accountId` 가 null 이면 모든 계좌(「검증 기록」) */
export function listUses(accountId: number | null, limit: number, offset = 0): UseRow[] {
  const where = accountId == null ? '' : 'WHERE u.account_id = ?';
  const args = accountId == null ? [limit, offset] : [accountId, limit, offset];
  return getDb()
    .prepare(
      `SELECT c.*, u.id AS use_id, u.account_id, u.action, u.order_id, u.created_at AS used_at
         FROM ai_check_uses u JOIN ai_checks c ON c.id = u.check_id
        ${where}
        ORDER BY u.created_at DESC, u.id DESC
        LIMIT ? OFFSET ?`,
    )
    .all(...args) as UseRow[];
}

export function countUses(accountId: number | null): number {
  const row =
    accountId == null
      ? getDb().prepare(`SELECT COUNT(*) AS n FROM ai_check_uses`).get()
      : getDb().prepare(`SELECT COUNT(*) AS n FROM ai_check_uses WHERE account_id = ?`).get(accountId);
  return (row as { n: number }).n;
}

/** 계좌를 지울 때 그 계좌의 사용 기록도 — 검증 줄(ai_checks)은 다른 계좌와 같이 쓰므로 남긴다 */
export function deleteUsesOf(accountId: number): void {
  getDb().prepare(`DELETE FROM ai_check_uses WHERE account_id = ?`).run(accountId);
}
