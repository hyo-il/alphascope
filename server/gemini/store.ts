/**
 * Gemini 분석 결과 저장소.
 *
 * 테이블 생성을 db/schema.sql 이 아니라 여기서 하는 이유:
 * Gemini 모듈은 키가 없으면 통째로 꺼지는 선택 기능이라,
 * 스키마도 이 폴더 안에 두어야 폴더째 들어내도 나머지가 멀쩡하다.
 */

import { getDb } from '../db';
import type { AgentOpinion, GeminiAnalysis, GeminiTrigger, ModeratorVerdict } from '../../src/types/gemini';

let ready = false;

function db() {
  const database = getDb();
  if (!ready) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS gemini_analysis (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT NOT NULL,
        created_at TEXT NOT NULL,
        model TEXT NOT NULL,
        signal TEXT NOT NULL,
        confidence REAL NOT NULL,
        summary TEXT,
        price_at_analysis REAL,
        agents TEXT NOT NULL,
        verdict TEXT NOT NULL,
        paper_order_id INTEGER,
        trade_note TEXT,
        tokens INTEGER DEFAULT 0,
        elapsed_ms INTEGER DEFAULT 0,
        trigger TEXT DEFAULT 'auto'
      );
      CREATE INDEX IF NOT EXISTS idx_gemini_symbol_time
        ON gemini_analysis (symbol, created_at DESC);

      CREATE TABLE IF NOT EXISTS gemini_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
    `);
    /*
      v2.15.0 — 프롬프트 버전. CREATE TABLE IF NOT EXISTS 는 있는 테이블을 바꾸지 않으므로
      칼럼이 없을 때만 더한다. 기존 행은 NULL 로 두고 읽을 때 'v1' 로 본다(원본을 고치지 않는다).
    */
    const columns = database.prepare(`PRAGMA table_info(gemini_analysis)`).all() as { name: string }[];
    if (!columns.some((c) => c.name === 'prompt_version')) {
      database.exec(`ALTER TABLE gemini_analysis ADD COLUMN prompt_version TEXT`);
    }
    // v2.23.0 — 계좌 자동매매가 낸 분석의 계좌. 같은 방식(칼럼이 없을 때만). 옛 행은 NULL.
    if (!columns.some((c) => c.name === 'account_id')) {
      database.exec(`ALTER TABLE gemini_analysis ADD COLUMN account_id INTEGER`);
    }
    ready = true;
  }
  return database;
}

/** 칼럼이 생기기 전의 기록(NULL)은 v1 이다 */
export const LEGACY_PROMPT_VERSION = 'v1';

/** 스키마(칼럼 추가 포함)를 보장한다 — 이 테이블을 직접 읽는 곳(accuracy.ts)이 먼저 부른다 */
export function ensureGeminiSchema(): void {
  db();
}

type Row = {
  id: number;
  symbol: string;
  created_at: string;
  model: string;
  signal: string;
  confidence: number;
  summary: string | null;
  price_at_analysis: number | null;
  agents: string;
  verdict: string;
  paper_order_id: number | null;
  trade_note: string | null;
  tokens: number;
  elapsed_ms: number;
  trigger: string;
  prompt_version: string | null;
  account_id: number | null;
};

/** 옛 행은 'auto'·'manual' 둘뿐이다 — 모르는 값은 예전처럼 auto 로 읽는다 */
export function triggerOf(value: string): GeminiTrigger {
  return value === 'manual' || value === 'scheduled' ? value : 'auto';
}

function toRecord(row: Row): GeminiAnalysis {
  return {
    id: row.id,
    symbol: row.symbol,
    createdAt: row.created_at,
    model: row.model,
    signal: row.signal as GeminiAnalysis['signal'],
    confidence: row.confidence,
    summary: row.summary ?? '',
    priceAtAnalysis: row.price_at_analysis,
    agents: safeParse<AgentOpinion[]>(row.agents, []),
    verdict: safeParse<ModeratorVerdict>(row.verdict, {} as ModeratorVerdict),
    paperOrderId: row.paper_order_id,
    tradeNote: row.trade_note,
    tokens: row.tokens,
    elapsedMs: row.elapsed_ms,
    trigger: triggerOf(row.trigger),
    accountId: row.account_id ?? null,
    promptVersion: row.prompt_version ?? LEGACY_PROMPT_VERSION,
  };
}

function safeParse<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export function insertAnalysis(record: Omit<GeminiAnalysis, 'id'>): number {
  const result = db()
    .prepare(
      `INSERT INTO gemini_analysis
         (symbol, created_at, model, signal, confidence, summary, price_at_analysis,
          agents, verdict, paper_order_id, trade_note, tokens, elapsed_ms, trigger, prompt_version, account_id)
       VALUES (@symbol, @createdAt, @model, @signal, @confidence, @summary, @priceAtAnalysis,
          @agents, @verdict, @paperOrderId, @tradeNote, @tokens, @elapsedMs, @trigger, @promptVersion, @accountId)`,
    )
    .run({
      ...record,
      agents: JSON.stringify(record.agents),
      verdict: JSON.stringify(record.verdict),
    });
  return Number(result.lastInsertRowid);
}

export function attachOrder(id: number, orderId: number | null, note: string | null): void {
  db()
    .prepare(`UPDATE gemini_analysis SET paper_order_id = ?, trade_note = ? WHERE id = ?`)
    .run(orderId, note, id);
}

export function listAnalyses(symbol?: string, limit = 100): GeminiAnalysis[] {
  const rows = symbol
    ? (db()
        .prepare(
          `SELECT * FROM gemini_analysis WHERE symbol = ? ORDER BY created_at DESC LIMIT ?`,
        )
        .all(symbol.toUpperCase(), limit) as Row[])
    : (db()
        .prepare(`SELECT * FROM gemini_analysis ORDER BY created_at DESC LIMIT ?`)
        .all(limit) as Row[]);
  return rows.map(toRecord);
}

export function getAnalysis(id: number): GeminiAnalysis | null {
  const row = db().prepare(`SELECT * FROM gemini_analysis WHERE id = ?`).get(id) as Row | undefined;
  return row ? toRecord(row) : null;
}

export function deleteAnalysis(id: number): void {
  db().prepare(`DELETE FROM gemini_analysis WHERE id = ?`).run(id);
}

/** 전체(또는 한 종목) 일괄 삭제 — 지운 건수를 돌려준다 */
export function deleteAllAnalyses(symbol?: string): number {
  const result = symbol
    ? db().prepare(`DELETE FROM gemini_analysis WHERE symbol = ?`).run(symbol.toUpperCase())
    : db().prepare(`DELETE FROM gemini_analysis`).run();
  return result.changes;
}

/** 오늘(서버 로컬 기준) 저장된 분석 건수 — 출처(계좌·지정·바로)를 가리지 않는다 */
export function analysesToday(): number {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const row = db()
    .prepare(`SELECT COUNT(*) AS n FROM gemini_analysis WHERE created_at >= ?`)
    .get(midnight.toISOString()) as { n: number };
  return row.n;
}

/** 오늘(로컬 기준) 호출 수 — 1종목당 5회로 환산해 예산을 가늠한다 */
export function countToday(): number {
  return analysesToday() * 5;
}

// ── 설정 ────────────────────────────────────────────────

export function readSetting<T>(key: string, fallback: T): T {
  const row = db().prepare(`SELECT value FROM gemini_settings WHERE key = ?`).get(key) as
    | { value: string }
    | undefined;
  return row ? safeParse<T>(row.value, fallback) : fallback;
}

export function writeSetting(key: string, value: unknown): void {
  db()
    .prepare(
      `INSERT INTO gemini_settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(key, JSON.stringify(value));
}
