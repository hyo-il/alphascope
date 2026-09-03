/**
 * 급등 탐지 저장소 — 설정 · yfinance 일봉 캐시 · 탐지 결과.
 *
 * 테이블은 db/schema.sql 에 있다 (Gemini 와 달리 키 유무로 꺼지는 선택 기능이 아니라
 * 앱의 기본 메뉴이므로 스키마도 공용 자리에 둔다).
 */

import type { Candle } from '../src/types/toss';
import type {
  AnalysisPeriod,
  SurgeDetection,
  SurgeEvaluation,
  SurgeSettings,
  SurgeSignals,
} from '../src/types/surge';
import { getDb } from './db';
import { DEFAULT_SETTINGS } from './surgeDetector';

const HISTORY_TTL_MS = 24 * 60 * 60 * 1000;

function safeParse<T>(text: string | null, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

// ── 설정 ────────────────────────────────────────────────────────────────────

const SETTINGS_KEY = 'surge';

export function getSettings(): SurgeSettings {
  const row = getDb()
    .prepare(`SELECT value FROM surge_settings WHERE key = ?`)
    .get(SETTINGS_KEY) as { value: string } | undefined;
  return { ...DEFAULT_SETTINGS, ...safeParse<Partial<SurgeSettings>>(row?.value ?? null, {}) };
}

/** 값은 서버에서 한 번 더 조인다 — 화면 입력만 믿으면 0% 나 음수가 그대로 들어온다. */
export function saveSettings(patch: Partial<SurgeSettings>): SurgeSettings {
  const next: SurgeSettings = { ...getSettings(), ...patch };
  next.priceThreshold = clamp(next.priceThreshold, 0.5, 50);
  next.volumeThreshold = clamp(next.volumeThreshold, 100, 2000);
  next.minSurgeCount = Math.round(clamp(next.minSurgeCount, 2, 20));
  next.regularityThreshold = clamp(next.regularityThreshold, 0, 100);
  if (!['3mo', '6mo', '1y'].includes(next.analysisPeriod)) next.analysisPeriod = '6mo';

  getDb()
    .prepare(
      `INSERT INTO surge_settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run(SETTINGS_KEY, JSON.stringify(next));
  return next;
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

// ── yfinance 일봉 캐시 ───────────────────────────────────────────────────────

export function readHistoryCache(symbol: string, period: AnalysisPeriod): Candle[] | null {
  const row = getDb()
    .prepare(`SELECT data, updated_at FROM surge_history_cache WHERE symbol = ? AND period = ?`)
    .get(symbol, period) as { data: string; updated_at: string } | undefined;

  if (!row) return null;
  if (Date.now() - Date.parse(row.updated_at) > HISTORY_TTL_MS) return null;

  const candles = safeParse<Candle[]>(row.data, []);
  return candles.length ? candles : null;
}

export function writeHistoryCache(symbol: string, period: AnalysisPeriod, candles: Candle[]): void {
  getDb()
    .prepare(
      `INSERT INTO surge_history_cache (symbol, period, data, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(symbol, period) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
    )
    .run(symbol, period, JSON.stringify(candles), new Date().toISOString());
}

// ── 탐지 결과 ────────────────────────────────────────────────────────────────

interface Row {
  id: number;
  detected_at: string;
  symbol: string;
  name: string | null;
  surge_count: number;
  avg_interval: number | null;
  std_deviation: number | null;
  regularity: number | null;
  last_surge_date: string | null;
  next_estimated_date: string | null;
  days_until_next: number | null;
  surge_score: number;
  grade: string;
  reason: string | null;
  signals_snapshot: string | null;
  surge_history: string | null;
  price_at_detection: number | null;
  price_after_7d: number | null;
  price_after_14d: number | null;
  price_after_30d: number | null;
  actual_surged: number | null;
  actual_surge_date: string | null;
  actual_surge_percent: number | null;
}

function toRecord(row: Row): SurgeDetection {
  return {
    id: row.id,
    detectedAt: row.detected_at,
    symbol: row.symbol,
    name: row.name,
    surgeCount: row.surge_count,
    avgInterval: row.avg_interval,
    stdDeviation: row.std_deviation,
    regularity: row.regularity,
    lastSurgeDate: row.last_surge_date,
    nextEstimatedDate: row.next_estimated_date,
    daysUntilNext: row.days_until_next,
    surgeScore: row.surge_score,
    grade: row.grade as SurgeDetection['grade'],
    reason: row.reason,
    signals: safeParse<SurgeSignals | null>(row.signals_snapshot, null),
    surgeHistory: safeParse<{ date: string; changePercent: number }[]>(row.surge_history, []),
    priceAtDetection: row.price_at_detection,
    priceAfter7d: row.price_after_7d,
    priceAfter14d: row.price_after_14d,
    priceAfter30d: row.price_after_30d,
    actualSurged: row.actual_surged == null ? null : row.actual_surged === 1,
    actualSurgeDate: row.actual_surge_date,
    actualSurgePercent: row.actual_surge_percent,
  };
}

export function insertDetection(detectedAt: string, evaluation: SurgeEvaluation): number {
  const { periodicity: p } = evaluation;
  const result = getDb()
    .prepare(
      `INSERT INTO surge_detections
         (detected_at, symbol, name, surge_count, avg_interval, std_deviation, regularity,
          last_surge_date, next_estimated_date, days_until_next, surge_score, grade, reason,
          signals_snapshot, surge_history, price_at_detection)
       VALUES (@detectedAt, @symbol, @name, @surgeCount, @avgInterval, @stdDeviation, @regularity,
          @lastSurgeDate, @nextEstimatedDate, @daysUntilNext, @surgeScore, @grade, @reason,
          @signals, @history, @price)`,
    )
    .run({
      detectedAt,
      symbol: evaluation.symbol,
      name: evaluation.name,
      surgeCount: p.surgeCount,
      avgInterval: p.avgInterval,
      stdDeviation: p.stdDeviation,
      regularity: p.regularity,
      lastSurgeDate: p.lastSurgeDate,
      nextEstimatedDate: p.nextEstimatedDate,
      daysUntilNext: p.daysUntilNext,
      surgeScore: evaluation.surgeScore,
      grade: evaluation.grade,
      reason: evaluation.reason,
      signals: JSON.stringify(evaluation.currentSignals),
      history: JSON.stringify(evaluation.surgeHistory),
      price: evaluation.price,
    });
  return Number(result.lastInsertRowid);
}

/** 가장 최근 한 바퀴의 결과 (같은 detected_at 을 가진 행들) */
export function latestDetections(): { detectedAt: string | null; rows: SurgeDetection[] } {
  const db = getDb();
  const latest = db
    .prepare(`SELECT MAX(detected_at) AS at FROM surge_detections`)
    .get() as { at: string | null };

  if (!latest?.at) return { detectedAt: null, rows: [] };

  const rows = db
    .prepare(
      `SELECT * FROM surge_detections WHERE detected_at = ? ORDER BY surge_score DESC, symbol`,
    )
    .all(latest.at) as Row[];
  return { detectedAt: latest.at, rows: rows.map(toRecord) };
}

/** 이전 탐지 이력 (성과 추적용) */
export function listDetections(limit = 200): SurgeDetection[] {
  const rows = getDb()
    .prepare(`SELECT * FROM surge_detections ORDER BY detected_at DESC, surge_score DESC LIMIT ?`)
    .all(limit) as Row[];
  return rows.map(toRecord);
}

/** 성과가 아직 채워지지 않은 오래된 행 — 채점 대상 */
export function pendingOutcomes(): SurgeDetection[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM surge_detections
        WHERE actual_surged IS NULL OR price_after_30d IS NULL
        ORDER BY detected_at DESC LIMIT 300`,
    )
    .all() as Row[];
  return rows.map(toRecord);
}

export function updateOutcome(
  id: number,
  outcome: {
    priceAfter7d: number | null;
    priceAfter14d: number | null;
    priceAfter30d: number | null;
    actualSurged: boolean | null;
    actualSurgeDate: string | null;
    actualSurgePercent: number | null;
  },
): void {
  getDb()
    .prepare(
      `UPDATE surge_detections
          SET price_after_7d = @priceAfter7d,
              price_after_14d = @priceAfter14d,
              price_after_30d = @priceAfter30d,
              actual_surged = @actualSurged,
              actual_surge_date = @actualSurgeDate,
              actual_surge_percent = @actualSurgePercent
        WHERE id = @id`,
    )
    .run({
      id,
      ...outcome,
      actualSurged: outcome.actualSurged == null ? null : outcome.actualSurged ? 1 : 0,
    });
}
