/**
 * Gemini 분석 결과 저장소.
 *
 * 테이블 생성을 db/schema.sql 이 아니라 여기서 하는 이유:
 * Gemini 모듈은 키가 없으면 통째로 꺼지는 선택 기능이라,
 * 스키마도 이 폴더 안에 두어야 폴더째 들어내도 나머지가 멀쩡하다.
 */

import { getDb } from '../db';
import type { AgentOpinion, GeminiAnalysis, ModeratorVerdict } from '../../src/types/gemini';

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
    ready = true;
  }
  return database;
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
};

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
    trigger: (row.trigger === 'manual' ? 'manual' : 'auto') as 'auto' | 'manual',
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
          agents, verdict, paper_order_id, trade_note, tokens, elapsed_ms, trigger)
       VALUES (@symbol, @createdAt, @model, @signal, @confidence, @summary, @priceAtAnalysis,
          @agents, @verdict, @paperOrderId, @tradeNote, @tokens, @elapsedMs, @trigger)`,
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

/** 오늘(로컬 기준) 호출 수 — 1종목당 5회로 환산해 예산을 가늠한다 */
export function countToday(): number {
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const row = db()
    .prepare(`SELECT COUNT(*) AS n FROM gemini_analysis WHERE created_at >= ?`)
    .get(midnight.toISOString()) as { n: number };
  return row.n * 5;
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
