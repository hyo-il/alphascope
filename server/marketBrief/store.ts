/**
 * 오늘 시황 저장 — 표 `market_briefs`(정의 `db/schema.sql`). 한 번 만들 때마다 한 줄 · 30일 보관.
 * 「오늘 예상 방향」 채점 `market_brief_scores` — 대상 · 거래일마다 한 줄 · 1년 보관(v2.60.0).
 */

import { getDb } from '../db';
import {
  BRIEF_KEEP_DAYS,
  type BriefAi,
  type BriefEdition,
  type BriefOutlook,
  type BriefSourceStatus,
  type BriefTrigger,
  type MarketBrief,
  type MarketBriefListItem,
  type OutlookConfidence,
  type OutlookDirection,
  type OutlookTarget,
} from '../../src/types/marketBrief';

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

// ── 「오늘 예상 방향」 채점(v2.60.0) — 표 `market_brief_scores` ─────────────────────────

/** 채점할 수 있는 브리핑 — AI 결과에 예상이 있는 것(만든 한국 날짜 sinceDay 부터). 오래된 것부터 */
export function listOutlookBriefs(sinceDay: string): { id: number; createdAt: string; outlook: BriefOutlook[] }[] {
  const rows = getDb()
    .prepare(`SELECT id, created_at, brief_json FROM market_briefs WHERE brief_date >= ? AND brief_json IS NOT NULL ORDER BY created_at, id`)
    .all(sinceDay) as { id: number; created_at: string; brief_json: string }[];
  return rows.flatMap((r) => {
    const outlook = (JSON.parse(r.brief_json) as BriefAi).today_outlook ?? [];
    return outlook.length ? [{ id: r.id, createdAt: r.created_at, outlook }] : [];
  });
}

export interface ScoreRow {
  target: OutlookTarget;
  tradeDay: string;
  briefId: number;
  direction: OutlookDirection;
  confidence: OutlookConfidence;
  actualPct: number;
  actualDirection: OutlookDirection;
  hit: boolean;
  scoredAt: string;
}

interface ScoreDbRow {
  target: OutlookTarget;
  trade_day: string;
  brief_id: number;
  direction: OutlookDirection;
  confidence: OutlookConfidence;
  actual_pct: number;
  actual_direction: OutlookDirection;
  hit: number;
  scored_at: string;
}

const toScore = (r: ScoreDbRow): ScoreRow => ({
  target: r.target,
  tradeDay: r.trade_day,
  briefId: r.brief_id,
  direction: r.direction,
  confidence: r.confidence,
  actualPct: r.actual_pct,
  actualDirection: r.actual_direction,
  hit: r.hit === 1,
  scoredAt: r.scored_at,
});

/** 같은 대상 · 같은 거래일은 한 줄 — 다시 채점하면 덮는다 */
export function upsertScore(s: ScoreRow): void {
  getDb()
    .prepare(
      `INSERT INTO market_brief_scores (target, trade_day, brief_id, direction, confidence, actual_pct, actual_direction, hit, scored_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(target, trade_day) DO UPDATE SET brief_id = excluded.brief_id, direction = excluded.direction, confidence = excluded.confidence,
         actual_pct = excluded.actual_pct, actual_direction = excluded.actual_direction, hit = excluded.hit, scored_at = excluded.scored_at`,
    )
    .run(s.target, s.tradeDay, s.briefId, s.direction, s.confidence, s.actualPct, s.actualDirection, s.hit ? 1 : 0, s.scoredAt);
}

export function getScore(target: OutlookTarget, tradeDay: string): ScoreRow | null {
  const r = getDb().prepare(`SELECT * FROM market_brief_scores WHERE target = ? AND trade_day = ?`).get(target, tradeDay) as ScoreDbRow | undefined;
  return r ? toScore(r) : null;
}

/** 최근 n번(거래일 최근 것부터) */
export function recentScores(target: OutlookTarget, n: number): ScoreRow[] {
  return (getDb().prepare(`SELECT * FROM market_brief_scores WHERE target = ? ORDER BY trade_day DESC LIMIT ?`).all(target, n) as ScoreDbRow[]).map(toScore);
}

/** 거래일이 keepDays 보다 오래된 채점 줄을 지운다. 지운 줄 수 */
export function purgeOldScores(today: string, keepDays: number): number {
  const cutoff = new Date(Date.parse(`${today}T00:00:00Z`) - keepDays * 86_400_000).toISOString().slice(0, 10);
  return getDb().prepare(`DELETE FROM market_brief_scores WHERE trade_day < ?`).run(cutoff).changes;
}
