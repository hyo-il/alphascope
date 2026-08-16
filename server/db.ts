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
