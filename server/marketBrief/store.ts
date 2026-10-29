/**
 * 오늘 시황 저장 — 표 `market_briefs`(정의 `db/schema.sql`). 한 번 만들 때마다 한 줄 · 30일 보관.
 */

import { getDb } from '../db';
import { BRIEF_KEEP_DAYS, type BriefAi, type BriefEdition, type BriefSourceStatus, type BriefTrigger, type MarketBrief, type MarketBriefListItem } from '../../src/types/marketBrief';

interface Row {
  id: number;
  brief_date: string;
  edition: BriefEdition;
  trigger: BriefTrigger;
  created_at: string;
  model: string | null;
  tokens: number | null;
  ai_calls: number;
  prompt_version: string;
  sources_json: string;
  data_json: string;
  brief_json: string | null;
  ai_error: string | null;
}

export type NewBrief = Omit<MarketBrief, 'id'>;

export function insertBrief(b: NewBrief): number {
  const info = getDb()
    .prepare(
      `INSERT INTO market_briefs (brief_date, edition, trigger, created_at, model, tokens, ai_calls, prompt_version, sources_json, data_json, brief_json, ai_error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      b.date,
      b.edition,
      b.trigger,
      b.createdAt,
      b.model,
      b.tokens,
      b.aiCalls,
      b.promptVersion,
      JSON.stringify(b.sources),
      JSON.stringify(b.data),
      b.brief ? JSON.stringify(b.brief) : null,
      b.aiError,
    );
  return Number(info.lastInsertRowid);
}

function toBrief(r: Row): MarketBrief {
  return {
    id: r.id,
    date: r.brief_date,
    edition: r.edition,
    trigger: r.trigger,
    createdAt: r.created_at,
    model: r.model,
    tokens: r.tokens,
    aiCalls: r.ai_calls,
    promptVersion: r.prompt_version,
    sources: JSON.parse(r.sources_json) as BriefSourceStatus[],
    data: JSON.parse(r.data_json) as MarketBrief['data'],
    brief: r.brief_json ? (JSON.parse(r.brief_json) as BriefAi) : null,
    aiError: r.ai_error,
  };
}

export function getBrief(id: number): MarketBrief | null {
  const row = getDb().prepare(`SELECT * FROM market_briefs WHERE id = ?`).get(id) as Row | undefined;
  return row ? toBrief(row) : null;
}

/** 그날 목록 — 최근 것부터 */
export function listBriefsOf(day: string): MarketBriefListItem[] {
  const rows = getDb()
    .prepare(
      `SELECT id, edition, trigger, created_at, brief_json IS NOT NULL AS has_ai FROM market_briefs WHERE brief_date = ? ORDER BY created_at DESC, id DESC`,
    )
    .all(day) as { id: number; edition: BriefEdition; trigger: BriefTrigger; created_at: string; has_ai: number }[];
  return rows.map((r) => ({ id: r.id, edition: r.edition, trigger: r.trigger, createdAt: r.created_at, hasAi: r.has_ai === 1 }));
}

/** 브리핑이 있는 날짜 — 최근 것부터 */
export function listBriefDays(): { date: string; count: number }[] {
  return getDb()
    .prepare(`SELECT brief_date AS date, COUNT(*) AS count FROM market_briefs GROUP BY brief_date ORDER BY brief_date DESC`)
    .all() as { date: string; count: number }[];
}

export function countBriefs(day: string, trigger: BriefTrigger): number {
  return (getDb().prepare(`SELECT COUNT(*) AS n FROM market_briefs WHERE brief_date = ? AND trigger = ?`).get(day, trigger) as { n: number }).n;
}

/** 그날 Gemini 호출 수 — 사용량(`gemini/usage.ts`) */
export function countBriefAiCalls(day: string): number {
  try {
    return (getDb().prepare(`SELECT COALESCE(SUM(ai_calls), 0) AS n FROM market_briefs WHERE brief_date = ?`).get(day) as { n: number }).n;
  } catch (e) {
    if (/no such table/i.test((e as Error).message)) return 0;
    throw e;
  }
}

/** 오늘 포함 30일(한국 날짜 `today − 29일` 부터)만 남기고 지운다. 지운 줄 수 */
export function purgeOldBriefs(today: string): number {
  const cutoff = new Date(Date.parse(`${today}T00:00:00Z`) - (BRIEF_KEEP_DAYS - 1) * 86_400_000).toISOString().slice(0, 10);
  return getDb().prepare(`DELETE FROM market_briefs WHERE brief_date < ?`).run(cutoff).changes;
}
