/**
 * 매수 판단 저장 (v2.45.0) — 설정 3개(`app_settings`)와 판단 기록 표 `buy_judgments`(`db/schema.sql`).
 * - `buyJudge.symbols` 전용 목록(관심 목록과 따로, 처음 비어 있다) · `buyJudge.ruleId` 고른 규칙 · `buyJudge.retention` 보관 기간(기본 1년)
 * - 기록은 (시장 날짜, 종목, 규칙) 한 줄 — 다시 계산하면 덮어쓴다. 그날 쓴 규칙 이름·내용도 함께 남긴다.
 */
import { getDb } from '../db';
import { DEFAULT_RETENTION, RETENTIONS, isRetention, type Retention } from '../../src/types/buyJudge';
import { DEFAULT_RULE_NAME, type RuleBody } from '../../src/types/tradingRule';

const KEY_SYMBOLS = 'buyJudge.symbols';
const KEY_RULE = 'buyJudge.ruleId';
const KEY_RETENTION = 'buyJudge.retention';
const KEY_RECORDED = 'buyJudge.lastRecorded';
const KEY_CLEANUP = 'buyJudge.lastCleanup';
/** 전용 목록 최대 종목 수 — 판단 한 번에 종목마다 일봉·지표를 두 번 계산한다 */
export const MAX_SYMBOLS = 50;

function read(key: string): string | null {
  const row = getDb().prepare(`SELECT value FROM app_settings WHERE key = ?`).get(key) as { value: string } | undefined;
  return row?.value ?? null;
}
function write(key: string, value: string | null): void {
  if (value === null) getDb().prepare(`DELETE FROM app_settings WHERE key = ?`).run(key);
  else getDb().prepare(`INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value);
}

export function getSymbols(): string[] {
  try {
    const v = JSON.parse(read(KEY_SYMBOLS) ?? '[]');
    return Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [];
  } catch {
    return [];
  }
}
export function setSymbols(symbols: string[]): void {
  write(KEY_SYMBOLS, JSON.stringify(symbols));
}

/** 「기본 규칙」 id — 규칙 목록 함수(`listRules`)는 쓰지 않는다(그쪽이 `usedBy` 를 채우려고 여기를 부른다) */
function defaultRuleId(): number | null {
  const row = getDb().prepare(`SELECT id FROM trading_rules WHERE name = ? ORDER BY id LIMIT 1`).get(DEFAULT_RULE_NAME) as { id: number } | undefined;
  return row?.id ?? null;
}

/** 고른 규칙 id — 처음에는 「기본 규칙」(없으면 null). 한 번 정한 뒤(비운 것 포함)에는 그 값 */
export function getRuleId(): number | null {
  const raw = read(KEY_RULE);
  if (raw === null) return defaultRuleId();
  const n = Number(raw);
  return raw === '' || !Number.isInteger(n) ? null : n;
}
export function setRuleId(id: number | null): void {
  write(KEY_RULE, id === null ? '' : String(id));
}
/** 규칙을 지울 때 — 매수 판단이 그 규칙을 쓰고 있었으면 비운다. 비웠으면 true */
export function detachBuyJudgeRule(ruleId: number): boolean {
  if (getRuleId() !== ruleId) return false;
  setRuleId(null);
  return true;
}

export function getRetention(): Retention {
  const v = read(KEY_RETENTION);
  return isRetention(v) ? v : DEFAULT_RETENTION;
}
export function setRetention(r: Retention): void {
  write(KEY_RETENTION, r);
}

export function getLastRecorded(): Partial<Record<'US' | 'KR', string>> {
  try {
    return JSON.parse(read(KEY_RECORDED) ?? '{}') as Partial<Record<'US' | 'KR', string>>;
  } catch {
    return {};
  }
}
export function setLastRecorded(market: 'US' | 'KR', day: string): void {
  write(KEY_RECORDED, JSON.stringify({ ...getLastRecorded(), [market]: day }));
}
export const getLastCleanup = () => read(KEY_CLEANUP);
export const setLastCleanup = (day: string) => write(KEY_CLEANUP, day);

// ── 판단 기록 ───────────────────────────────────────────────────────────────
export interface JudgmentRow {
  id: number;
  market_date: string;
  symbol: string;
  rule_id: number;
  rule_name: string;
  rule_json: string;
  action: string;
  code: string;
  score: number;
  max_score: number;
  min_score: number;
  breakdown_json: string;
  reference_json: string | null;
  reason: string;
  created_at: string;
}

export interface JudgmentInput {
  marketDate: string;
  symbol: string;
  ruleId: number;
  ruleName: string;
  rule: RuleBody;
  action: string;
  code: string;
  score: number;
  maxScore: number;
  minScore: number;
  breakdown: unknown;
  reference: unknown;
  reason: string;
}

/** 같은 (날짜, 종목, 규칙) 이면 덮어쓴다 */
export function upsertJudgment(j: JudgmentInput): void {
  getDb()
    .prepare(
      `INSERT INTO buy_judgments (market_date, symbol, rule_id, rule_name, rule_json, action, code, score, max_score, min_score, breakdown_json, reference_json, reason, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(market_date, symbol, rule_id) DO UPDATE SET
         rule_name = excluded.rule_name, rule_json = excluded.rule_json, action = excluded.action, code = excluded.code,
         score = excluded.score, max_score = excluded.max_score, min_score = excluded.min_score, breakdown_json = excluded.breakdown_json,
         reference_json = excluded.reference_json, reason = excluded.reason, created_at = excluded.created_at`,
    )
    .run(
      j.marketDate, j.symbol, j.ruleId, j.ruleName, JSON.stringify(j.rule), j.action, j.code, j.score, j.maxScore, j.minScore,
      JSON.stringify(j.breakdown), j.reference == null ? null : JSON.stringify(j.reference), j.reason, new Date().toISOString(),
    );
}

export function listBought(limit = 500): JudgmentRow[] {
  return getDb().prepare(`SELECT * FROM buy_judgments WHERE code = 'score_buy' ORDER BY market_date DESC, symbol LIMIT ?`).all(limit) as JudgmentRow[];
}

/** 종목별 최근 기록(날짜 내림차순) */
export function listForSymbol(symbol: string, limit: number): JudgmentRow[] {
  return getDb().prepare(`SELECT * FROM buy_judgments WHERE symbol = ? ORDER BY market_date DESC, id DESC LIMIT ?`).all(symbol, limit) as JudgmentRow[];
}

export function judgedSymbols(): string[] {
  return (getDb().prepare(`SELECT DISTINCT symbol FROM buy_judgments ORDER BY symbol`).all() as { symbol: string }[]).map((r) => r.symbol);
}

export function countRows(): { all: number; nonBuy: number } {
  const row = getDb()
    .prepare(`SELECT COUNT(*) AS a, SUM(CASE WHEN code = 'score_buy' THEN 0 ELSE 1 END) AS n FROM buy_judgments`)
    .get() as { a: number; n: number | null };
  return { all: row.a, nonBuy: row.n ?? 0 };
}

/** 기록 지우기 — `nonBuy` 면 「사도 됨」 은 남긴다. 지운 줄 수 */
export function clearJudgments(scope: 'all' | 'nonBuy'): number {
  const sql = scope === 'all' ? `DELETE FROM buy_judgments` : `DELETE FROM buy_judgments WHERE code != 'score_buy'`;
  return getDb().prepare(sql).run().changes;
}

/** 보관 기간보다 오래된 줄 중 「사도 됨」 이 아닌 줄 — `dryRun` 이면 세기만 */
export function pruneOld(retention: Retention, today: string, dryRun = false): number {
  const days = RETENTIONS.find((r) => r.id === retention)?.days ?? null;
  if (days === null) return 0;
  const cutoff = new Date(Date.parse(`${today}T12:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);
  const where = `WHERE code != 'score_buy' AND market_date < ?`;
  if (dryRun) return (getDb().prepare(`SELECT COUNT(*) AS n FROM buy_judgments ${where}`).get(cutoff) as { n: number }).n;
  return getDb().prepare(`DELETE FROM buy_judgments ${where}`).run(cutoff).changes;
}
