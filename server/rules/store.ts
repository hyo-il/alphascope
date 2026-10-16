/**
 * 매매 규칙 저장 — `trading_rules` (db/schema.sql, v2.43.0).
 *
 * - 예시 규칙 「기본 규칙 + 200일선」 도 처음 한 번만(v2.50.0, 표시 'tradingRules.seeded.above200').
 * - 「기본 규칙」 은 **처음 한 번만** 넣는다: `app_settings` 'tradingRules.seeded' 가 없을 때만 넣고 표시를 남긴다.
 *   사용자가 모두 지워도 다시 만들지 않는다(사용자 결정 A-2).
 * - 「적용된 곳」(`usedBy`) — 계좌(`accounts`, v2.44.0) · 매수 판단(`buyJudge`, v2.45.0). 백테스트는 기록이라 「쓰는 곳」 이 아니다(늘 false).
 *   삭제·저장 확인 창은 이 값으로 문장을 만든다. 쓰는 규칙을 지우면 그 계좌들은 자동매매가 꺼지고 규칙이 비워진다(`detachRule`).
 */
import { getDb } from '../db';
import { accountsUsingRule, detachRule } from '../autoTrading/store';
import { detachBuyJudgeRule, getRuleId as getBuyJudgeRuleId } from '../buyJudge/store';
import {
  ABOVE200_RULE_NAME,
  DEFAULT_RULE_NAME,
  EMPTY_USAGE,
  above200RuleBody,
  cloneRuleBody,
  defaultRuleBody,
  type RuleBody,
  type RuleUsage,
  type TradingRule,
} from '../../src/types/tradingRule';

const SEEDED_KEY = 'tradingRules.seeded';
/** 예시 규칙 「기본 규칙 + 200일선」 (v2.50.0 — 사용자 결정 A-3) 을 넣었다는 표시 — 지워도 다시 만들지 않는다 */
const SEEDED_ABOVE200_KEY = 'tradingRules.seeded.above200';

interface Row {
  id: number;
  name: string;
  rule_json: string;
  created_at: string;
  updated_at: string;
}

export class RuleNameTakenError extends Error {}

/** 이 규칙을 쓰는 곳 — 계좌(v2.44.0) · 매수 판단(v2.45.0) */
function usageOf(id: number): RuleUsage {
  return { ...EMPTY_USAGE, buyJudge: getBuyJudgeRuleId() === id, accounts: accountsUsingRule(id) };
}

function toRule(row: Row): TradingRule {
  const body = JSON.parse(row.rule_json) as RuleBody;
  return {
    id: row.id,
    name: row.name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...cloneRuleBody(body),
    usedBy: usageOf(row.id),
  };
}

let seededChecked = false;

/** 기본 규칙을 처음 한 번만 넣는다 — 표시와 규칙을 한 트랜잭션으로 */
export function ensureSeeded(): void {
  if (seededChecked) return;
  const db = getDb();
  db.transaction(() => {
    const done = db.prepare(`SELECT value FROM app_settings WHERE key = ?`).get(SEEDED_KEY);
    if (done) return;
    const now = new Date().toISOString();
    db.prepare(`INSERT INTO trading_rules (name, rule_json, created_at, updated_at) VALUES (?, ?, ?, ?)`).run(
      DEFAULT_RULE_NAME,
      JSON.stringify(defaultRuleBody()),
      now,
      now,
    );
    db.prepare(`INSERT INTO app_settings (key, value) VALUES (?, ?)`).run(SEEDED_KEY, now);
  })();
  // 예시 규칙 — 기본 규칙과 같고 200일선 거름망만 켬. 같은 이름이 이미 있으면 만들지 않고 표시만 남긴다. 「기본 규칙」 은 손대지 않는다
  db.transaction(() => {
    const done = db.prepare(`SELECT value FROM app_settings WHERE key = ?`).get(SEEDED_ABOVE200_KEY);
    if (done) return;
    const now = new Date().toISOString();
    if (!db.prepare(`SELECT id FROM trading_rules WHERE name = ?`).get(ABOVE200_RULE_NAME)) {
      db.prepare(`INSERT INTO trading_rules (name, rule_json, created_at, updated_at) VALUES (?, ?, ?, ?)`).run(
        ABOVE200_RULE_NAME,
        JSON.stringify(above200RuleBody()),
        now,
        now,
      );
    }
    db.prepare(`INSERT INTO app_settings (key, value) VALUES (?, ?)`).run(SEEDED_ABOVE200_KEY, now);
  })();
  seededChecked = true;
}

export function listRules(): TradingRule[] {
  ensureSeeded();
  return (getDb().prepare(`SELECT * FROM trading_rules ORDER BY id`).all() as Row[]).map(toRule);
}

export function getRule(id: number): TradingRule | null {
  ensureSeeded();
  const row = getDb().prepare(`SELECT * FROM trading_rules WHERE id = ?`).get(id) as Row | undefined;
  return row ? toRule(row) : null;
}

function nameTaken(name: string, exceptId?: number): boolean {
  const row = getDb()
    .prepare(`SELECT id FROM trading_rules WHERE name = ? AND id != ?`)
    .get(name, exceptId ?? -1);
  return !!row;
}

export function createRule(name: string, body: RuleBody): TradingRule {
  ensureSeeded();
  const n = name.trim();
  if (nameTaken(n)) throw new RuleNameTakenError(`같은 이름의 규칙이 있습니다: ${n}`);
  const now = new Date().toISOString();
  const info = getDb()
    .prepare(`INSERT INTO trading_rules (name, rule_json, created_at, updated_at) VALUES (?, ?, ?, ?)`)
    .run(n, JSON.stringify(cloneRuleBody(body)), now, now);
  return getRule(Number(info.lastInsertRowid))!;
}

export function updateRule(id: number, name: string, body: RuleBody): TradingRule | null {
  ensureSeeded();
  const n = name.trim();
  if (!getRule(id)) return null;
  if (nameTaken(n, id)) throw new RuleNameTakenError(`같은 이름의 규칙이 있습니다: ${n}`);
  getDb()
    .prepare(`UPDATE trading_rules SET name = ?, rule_json = ?, updated_at = ? WHERE id = ?`)
    .run(n, JSON.stringify(cloneRuleBody(body)), new Date().toISOString(), id);
  return getRule(id);
}

/** 지운다 — 이 규칙을 쓰던 계좌는 자동매매가 꺼지고 규칙이 비워진다(매수 판단도 쓰고 있었으면 비운다). 꺼진 계좌 id (지우지 못했으면 null) */
export function deleteRule(id: number): number[] | null {
  ensureSeeded();
  if (!getRule(id)) return null;
  const detached = detachRule(id);
  detachBuyJudgeRule(id);
  getDb().prepare(`DELETE FROM trading_rules WHERE id = ?`).run(id);
  return detached;
}

/** 복사 이름 — 「○○ 복사본」, 이미 있으면 「○○ 복사본 2」 · 3 … (40자를 넘으면 원래 이름을 줄인다) */
export function copyName(name: string): string {
  const fit = (base: string, suffix: string) => base.slice(0, Math.max(1, 40 - suffix.length)) + suffix;
  let candidate = fit(name, ' 복사본');
  for (let n = 2; nameTaken(candidate); n++) candidate = fit(name, ` 복사본 ${n}`);
  return candidate;
}

export function copyRule(id: number): TradingRule | null {
  const src = getRule(id);
  if (!src) return null;
  return createRule(copyName(src.name), src);
}
