import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BaseTimeframe, Candle } from '../src/types/toss';

const here = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(here, '..');

let db: Database.Database | null = null;

/** DB 파일 경로 (`DB_PATH`, 기본 ./db/alphascope.db) — 데이터 정리의 백업 위치가 이 폴더 아래 `backup/` 이다 */
export function dbFilePath(): string {
  return path.resolve(projectRoot, process.env.DB_PATH ?? './db/alphascope.db');
}

export function getDb(): Database.Database {
  if (db) return db;

  const dbPath = dbFilePath();
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });

  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec(fs.readFileSync(path.join(projectRoot, 'db/schema.sql'), 'utf8'));
  migrate(db);
  return db;
}

/**
 * CREATE TABLE IF NOT EXISTS 는 이미 있는 테이블을 바꾸지 않는다.
 * 나중에 추가된 컬럼은 여기서 채워 넣는다 (이미 있으면 조용히 넘어간다).
 */
function migrate(database: Database.Database): void {
  // 캔들을 받은 시각 — 장중에 받아 저장된 일봉을 끝난 봉으로 쓰지 않으려고. 옛 줄은 NULL(알 수 없음 — 끝난 것으로 본다)
  const candleColumns = database.prepare(`PRAGMA table_info(candles)`).all() as { name: string }[];
  if (candleColumns.length && !candleColumns.some((c) => c.name === 'fetched_at')) {
    database.exec(`ALTER TABLE candles ADD COLUMN fetched_at INTEGER`);
  }

  const columns = database
    .prepare(`PRAGMA table_info(analysis_history)`)
    .all() as { name: string }[];
  const names = new Set(columns.map((c) => c.name));

  if (!names.has('mode')) database.exec(`ALTER TABLE analysis_history ADD COLUMN mode TEXT`);
  if (!names.has('prompt')) database.exec(`ALTER TABLE analysis_history ADD COLUMN prompt TEXT`);

  // 계좌 화면 순서 — 옛 DB 는 지금 보이던 순서(id 순) 그대로 채운다
  const accountColumns = database.prepare(`PRAGMA table_info(paper_accounts)`).all() as { name: string }[];
  if (accountColumns.length && !accountColumns.some((c) => c.name === 'sort_order')) {
    database.exec(`ALTER TABLE paper_accounts ADD COLUMN sort_order INTEGER`);
  }
  if (accountColumns.length) database.exec(`UPDATE paper_accounts SET sort_order = id WHERE sort_order IS NULL`);

  // 매수 판단 「거름망에 걸림」 이유 — 옛 줄은 NULL(화면은 「거름망에 걸림」 만)
  const judgmentColumns = database.prepare(`PRAGMA table_info(buy_judgments)`).all() as { name: string }[];
  if (judgmentColumns.length && !judgmentColumns.some((c) => c.name === 'gate_reason')) {
    database.exec(`ALTER TABLE buy_judgments ADD COLUMN gate_reason TEXT`);
  }

  // 종목 프로필의 세부 업종 — 동종업계 자동 고르기. 실적일 하루 1회 갱신이 같은 yfinance info 로 채운다
  const profileColumns = database.prepare(`PRAGMA table_info(stock_profiles)`).all() as { name: string }[];
  if (profileColumns.length && !profileColumns.some((c) => c.name === 'industry')) {
    database.exec(`ALTER TABLE stock_profiles ADD COLUMN industry TEXT`);
  }
}

const upsertCandle = () =>
  getDb().prepare(`
    INSERT INTO candles (symbol, timeframe, timestamp, open, high, low, close, volume, fetched_at)
    VALUES (@symbol, @timeframe, @timestamp, @open, @high, @low, @close, @volume, @fetchedAt)
    ON CONFLICT(symbol, timeframe, timestamp) DO UPDATE SET
      open = excluded.open,
      high = excluded.high,
      low = excluded.low,
      close = excluded.close,
      volume = excluded.volume,
      fetched_at = excluded.fetched_at
  `);

/** `fetchedAt` = 받은 시각(끝나지 않은 일봉 판별). 시험이 장중 저장을 흉내 낼 때만 넘긴다 */
export function saveCandles(symbol: string, timeframe: BaseTimeframe, candles: Candle[], fetchedAt = Date.now()): void {
  if (!candles.length) return;
  const stmt = upsertCandle();
  const insertMany = getDb().transaction((rows: Candle[]) => {
    for (const row of rows) stmt.run({ symbol, timeframe, ...row, fetchedAt });
  });
  insertMany(candles);
}

/**
 * 일봉 중 **그 시장 마감 전에 받은 값**(끝나지 않은 채 저장됨)의 timestamp 들.
 * 받기가 성공하면 그 봉은 마감 뒤 값으로 덮인다 — 받기가 실패해 장중 값이 남았을 때만 걸린다.
 * `closeOffsetMs` = 봉 timestamp(그 시장 자정) → 그날 일봉이 끝나는 시각. fetched_at 이 NULL 인 옛 줄은 알 수 없어 끝난 것으로 본다.
 */
export function unconfirmedDailyTimestamps(symbol: string, fromTs: number, closeOffsetMs: number): number[] {
  const rows = getDb()
    .prepare(`SELECT timestamp FROM candles WHERE symbol = ? AND timeframe = '1d' AND timestamp >= ? AND fetched_at IS NOT NULL AND fetched_at < timestamp + ?`)
    .all(symbol, fromTs, closeOffsetMs + CONFIRM_MARGIN_MS) as { timestamp: number }[];
  return rows.map((r) => r.timestamp);
}

/**
 * 그 종목 **최근** 일봉을 마지막으로 받은(받기 성공) 시각 — 최근 받기는 겹치는 봉도 다시 저장하므로 `fromTs`(마지막 끝난 봉) 이후 줄의 가장 늦은 fetched_at 이다.
 * ⚠️ `fromTs` 로 좁힌다 — 차트를 과거로 스크롤하면(`getCandlesBefore`) 옛 봉도 지금 시각으로 저장되어, 최근 받기가 실패했는데도 「받기 성공」 으로 보일 수 있다. 모르면 null
 */
export function lastDailyFetchedAt(symbol: string, fromTs: number): number | null {
  const row = getDb().prepare(`SELECT MAX(fetched_at) AS f FROM candles WHERE symbol = ? AND timeframe = '1d' AND timestamp >= ?`).get(symbol, fromTs) as { f: number | null } | undefined;
  return row?.f ?? null;
}

/** 마감 직후 받은 값에는 마지막 체결이 아직 덜 들어왔을 수 있다 — 마감 뒤 10분부터 받은 값을 끝난 값으로 본다 */
export const CONFIRM_MARGIN_MS = 10 * 60_000;

/**
 * 받기가 **성공한 뒤** — 받은 범위(첫 봉~마지막 봉) 안에 있는데 토스가 다시 주지 않은 「끝나지 않은 채 저장된」 일봉을 지운다.
 * 장중에만 잠깐 보였거나 날짜가 바뀐 봉이 남으면 영영 「확정 못 함」 이 되어 그 종목을 판단하지 못한다. 끝난 줄(fetched_at 이 마감 뒤 · NULL)은 건드리지 않는다.
 */
export function pruneUnconfirmedMissing(symbol: string, page: Candle[], closeOffsetMs: number): number {
  if (!page.length) return 0;
  const ts = page.map((c) => c.timestamp);
  const lo = Math.min(...ts);
  const hi = Math.max(...ts);
  const keep = new Set(ts);
  const stale = unconfirmedDailyTimestamps(symbol, lo, closeOffsetMs).filter((t) => t <= hi && !keep.has(t));
  const del = getDb().prepare(`DELETE FROM candles WHERE symbol = ? AND timeframe = '1d' AND timestamp = ?`);
  for (const t of stale) del.run(symbol, t);
  return stale.length;
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

/**
 * 캐시에서 특정 시각 이전의 과거 캔들을 읽는다 (무한 스크롤 폴백).
 * 실시간 조회가 막혔을 때 candleService 가 쓴다.
 */
export function loadCandlesBefore(
  symbol: string,
  timeframe: BaseTimeframe,
  beforeMs: number,
  limit: number,
): Candle[] {
  const rows = getDb()
    .prepare(
      `SELECT timestamp, open, high, low, close, volume
         FROM candles
        WHERE symbol = ? AND timeframe = ? AND timestamp < ?
        ORDER BY timestamp DESC
        LIMIT ?`,
    )
    .all(symbol, timeframe, beforeMs, limit) as Candle[];
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
  /** 어떤 모드로 분석했는지 */
  mode?: string | null;
  /** 분석에 사용한 프롬프트 원문 */
  prompt?: string | null;
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
         (symbol, timeframe, analyzed_at, price_at_analysis, synthesis, verdict, confidence, mode, prompt, actual_result)
       VALUES (@symbol, @timeframe, @analyzed_at, @price_at_analysis, @synthesis, @verdict, @confidence, @mode, @prompt, 'pending')`,
    )
    .run({ mode: null, prompt: null, ...record });
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

/** Claude 분석 기록 일괄 삭제 — 지운 건수를 돌려준다 */
export function deleteAllAnalyses(symbol?: string): number {
  const result = symbol
    ? getDb().prepare(`DELETE FROM analysis_history WHERE symbol = ?`).run(symbol.toUpperCase())
    : getDb().prepare(`DELETE FROM analysis_history`).run();
  return result.changes;
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
