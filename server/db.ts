import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BaseTimeframe, Candle } from '../src/types/toss';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  const dbPath = path.resolve(projectRoot, process.env.DB_PATH ?? './db/alphascope.db');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(fs.readFileSync(path.join(projectRoot, 'db/schema.sql'), 'utf8'));
  return db;
}

const upsertCandle = () =>
  getDb().prepare(`
    INSERT INTO candles (symbol, timeframe, timestamp, open, high, low, close, volume)
    VALUES (@symbol, @timeframe, @timestamp, @open, @high, @low, @close, @volume)
    ON CONFLICT(symbol, timeframe, timestamp) DO UPDATE SET
      open = excluded.open,
      high = excluded.high,
      low = excluded.low,
      close = excluded.close,
      volume = excluded.volume
  `);

export function saveCandles(symbol: string, timeframe: BaseTimeframe, candles: Candle[]): void {
  if (!candles.length) return;
  const stmt = upsertCandle();
  const insertMany = getDb().transaction((rows: Candle[]) => {
    for (const row of rows) stmt.run({ symbol, timeframe, ...row });
  });
  insertMany(candles);
}

export function loadCandles(
  symbol: string,
  timeframe: BaseTimeframe,
  limit: number,
): Candle[] {
  const rows = getDb()
    .prepare(
      `SELECT timestamp, open, high, low, close, volume
         FROM candles
        WHERE symbol = ? AND timeframe = ?
        ORDER BY timestamp DESC
        LIMIT ?`,
    )
    .all(symbol, timeframe, limit) as Candle[];
  return rows.reverse();
}

export interface AnalysisRecord {
  id?: number;
  symbol: string;
  timeframe: string;
  analyzed_at: string;
  price_at_analysis: number;
  /** Claude 대화에서 받은 분석 원문 */
  synthesis: string;
  verdict: string;
  confidence: string;
  price_after_1d?: number | null;
  price_after_3d?: number | null;
  price_after_7d?: number | null;
  actual_result?: string | null;
}

/**
 * 분석 기록 저장.
 * 방식 B 에서는 Claude 대화의 답변을 사용자가 붙여넣어 저장한다.
 * (에이전트별 컬럼은 앱이 개별 응답을 받지 않으므로 비워 두고 synthesis 에 원문을 담는다.)
 */
export function saveAnalysis(record: AnalysisRecord): number {
  const result = getDb()
    .prepare(
      `INSERT INTO analysis_history
         (symbol, timeframe, analyzed_at, price_at_analysis, synthesis, verdict, confidence, actual_result)
       VALUES (@symbol, @timeframe, @analyzed_at, @price_at_analysis, @synthesis, @verdict, @confidence, 'pending')`,
    )
    .run(record);
  return Number(result.lastInsertRowid);
}

/** 분석 기록 목록 (최신순). symbol 을 주면 그 종목만. */
export function loadAnalyses(symbol?: string, limit = 50): AnalysisRecord[] {
  const db = getDb();
  return symbol
    ? (db
        .prepare(
          `SELECT * FROM analysis_history WHERE symbol = ? ORDER BY analyzed_at DESC LIMIT ?`,
        )
        .all(symbol, limit) as AnalysisRecord[])
    : (db
        .prepare(`SELECT * FROM analysis_history ORDER BY analyzed_at DESC LIMIT ?`)
        .all(limit) as AnalysisRecord[]);
}

export function deleteAnalysis(id: number): void {
  getDb().prepare('DELETE FROM analysis_history WHERE id = ?').run(id);
}

/** 캐시된 가장 최근 캔들 시각 (없으면 null) */
export function latestCandleTimestamp(
  symbol: string,
  timeframe: BaseTimeframe,
): number | null {
  const row = getDb()
    .prepare(`SELECT MAX(timestamp) AS ts FROM candles WHERE symbol = ? AND timeframe = ?`)
    .get(symbol, timeframe) as { ts: number | null } | undefined;
  return row?.ts ?? null;
}
