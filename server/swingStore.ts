/**
 * 스윙 추천 저장소 — 추천 기록과 성과 채점.
 *
 * 추천을 저장하는 이유는 하나다: **시스템 자체의 정확도를 검증**하기 위해서다.
 * 목표가·손절가를 사후에 다시 만들 수는 없으므로 추천 시점 그대로 남긴다.
 */

import type { Candle } from '../src/types/toss';
import type { SwingGrade, SwingRecommendation, SwingRecord } from '../src/types/swing';
import { getCandles } from './candleService';
import { getDb, loadCandles } from './db';

const DAY_MS = 24 * 60 * 60 * 1000;

function safeParse<T>(text: string | null, fallback: T): T {
  if (!text) return fallback;
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

interface Row {
  id: number;
  analyzed_at: string;
  symbol: string;
  name: string | null;
  price_at_analysis: number;
  score: number;
  grade: string;
  entry_price: number | null;
  entry_type: string | null;
  entry_reason: string | null;
  target1_price: number | null;
  target2_price: number | null;
  stop_loss_price: number | null;
  risk_reward_ratio: number | null;
  recommended_percent: number | null;
  price_after_7d: number | null;
  price_after_14d: number | null;
  price_after_30d: number | null;
  target1_hit: number;
  target2_hit: number;
  stop_loss_hit: number;
  actual_result: string;
  actual_return: number | null;
}

function toRecord(row: Row): SwingRecord {
  return {
    id: row.id,
    analyzedAt: row.analyzed_at,
    symbol: row.symbol,
    name: row.name,
    priceAtAnalysis: row.price_at_analysis,
    score: row.score,
    grade: row.grade as SwingGrade,
    entryPrice: row.entry_price,
    entryType: row.entry_type as SwingRecord['entryType'],
    entryReason: row.entry_reason,
    target1Price: row.target1_price,
    target2Price: row.target2_price,
    stopLossPrice: row.stop_loss_price,
    riskRewardRatio: row.risk_reward_ratio,
    recommendedPercent: row.recommended_percent,
    priceAfter7d: row.price_after_7d,
    priceAfter14d: row.price_after_14d,
    priceAfter30d: row.price_after_30d,
    target1Hit: row.target1_hit === 1,
    target2Hit: row.target2_hit === 1,
    stopLossHit: row.stop_loss_hit === 1,
    actualResult: row.actual_result,
    actualReturn: row.actual_return,
  };
}

export function insertRecommendation(analyzedAt: string, r: SwingRecommendation): number {
  const result = getDb()
    .prepare(
      `INSERT INTO swing_recommendations
         (analyzed_at, symbol, name, price_at_analysis, score, grade,
          trend_score, timing_score, momentum_score, volume_score, risk_reward_score,
          entry_price, entry_type, entry_reason, target1_price, target2_price, stop_loss_price,
          risk_reward_ratio, recommended_percent, holding_period_min, holding_period_max,
          warnings, invalidation, conditions_detail, indicators_snapshot)
       VALUES (@analyzedAt, @symbol, @name, @price, @score, @grade,
          @trend, @timing, @momentum, @volume, @riskReward,
          @entryPrice, @entryType, @entryReason, @target1, @target2, @stop,
          @ratio, @percent, @holdMin, @holdMax,
          @warnings, @invalidation, @conditions, @indicators)`,
    )
    .run({
      analyzedAt,
      symbol: r.symbol,
      name: r.name,
      price: r.currentPrice,
      score: r.score,
      grade: r.grade,
      trend: r.conditions.trend.score,
      timing: r.conditions.timing.score,
      momentum: r.conditions.momentum.score,
      volume: r.conditions.volume.score,
      riskReward: r.conditions.riskReward.score,
      entryPrice: r.entry.price,
      entryType: r.entry.type,
      entryReason: r.entry.reason,
      target1: r.targets.target1.price,
      target2: r.targets.target2.price,
      stop: r.stopLoss.price,
      ratio: r.conditions.riskReward.ratio,
      percent: r.position.recommendedPercent,
      holdMin: r.holdingPeriod.min,
      holdMax: r.holdingPeriod.max,
      warnings: JSON.stringify(r.warnings),
      invalidation: r.invalidation,
      conditions: JSON.stringify(r.conditions),
      indicators: JSON.stringify(r.indicators),
    });
  return Number(result.lastInsertRowid);
}

/**
 * 같은 종목을 짧은 사이에 다시 기록하지 않는다.
 *
 * 화면에서 [다시 분석] 을 몇 번 누르면 같은 추천이 그만큼 쌓여, 성과 표본이
 * "자주 누른 종목" 쪽으로 기운다. 12시간 안의 같은 종목은 이미 기록된 것으로 본다.
 */
export function recordedRecently(symbol: string, hours = 12): boolean {
  const since = new Date(Date.now() - hours * 60 * 60 * 1000).toISOString();
  const row = getDb()
    .prepare(
      `SELECT 1 AS hit FROM swing_recommendations WHERE symbol = ? AND analyzed_at >= ? LIMIT 1`,
    )
    .get(symbol, since) as { hit: number } | undefined;
  return Boolean(row);
}

export function latestRun(): { analyzedAt: string | null; rows: SwingRecord[] } {
  const db = getDb();
  const latest = db
    .prepare(`SELECT MAX(analyzed_at) AS at FROM swing_recommendations`)
    .get() as { at: string | null };
  if (!latest?.at) return { analyzedAt: null, rows: [] };

  const rows = db
    .prepare(`SELECT * FROM swing_recommendations WHERE analyzed_at = ? ORDER BY score DESC`)
    .all(latest.at) as Row[];
  return { analyzedAt: latest.at, rows: rows.map(toRecord) };
}

export function listRecommendations(limit = 200): SwingRecord[] {
  const rows = getDb()
    .prepare(`SELECT * FROM swing_recommendations ORDER BY analyzed_at DESC, score DESC LIMIT ?`)
    .all(limit) as Row[];
  return rows.map(toRecord);
}

/** 전체 추천 세부(조건·경고)까지 필요한 화면을 위한 단건 조회 */
export function recommendationDetail(id: number): (SwingRecord & {
  conditions: unknown;
  warnings: string[];
  invalidation: string | null;
}) | null {
  const row = getDb()
    .prepare(`SELECT * FROM swing_recommendations WHERE id = ?`)
    .get(id) as (Row & { conditions_detail: string; warnings: string; invalidation: string }) | undefined;
  if (!row) return null;
  return {
    ...toRecord(row),
    conditions: safeParse(row.conditions_detail, null),
    warnings: safeParse<string[]>(row.warnings, []),
    invalidation: row.invalidation,
  };
}

// ── 성과 채점 ────────────────────────────────────────────────────────────────

/**
 * 추천대로 따라 갔다면 어떻게 됐는지 채점한다.
 *
 * 계획이 "1차에서 절반, 2차에서 나머지" 이므로 수익률도 그렇게 계산한다.
 * 진입 자체가 조건부(PULLBACK·BREAKOUT)인 추천은 **체결되지 않았을 수 있어**
 * `not_triggered` 를 따로 둔다 — 체결되지도 않은 추천을 실패로 세면 정확도가 왜곡된다.
 */
function judge(
  record: SwingRecord,
  after: Candle[],
): {
  target1Hit: boolean;
  target2Hit: boolean;
  stopHit: boolean;
  result: string;
  ret: number | null;
} {
  const entry = record.entryPrice ?? record.priceAtAnalysis;
  const t1 = record.target1Price ?? 0;
  const t2 = record.target2Price ?? 0;
  const stop = record.stopLossPrice ?? 0;

  let triggered = record.entryType === 'NOW';
  let t1Hit = false;
  let closed: string | null = null;

  for (const candle of after) {
    if (!triggered) {
      // 눌림은 아래로, 돌파는 위로 닿아야 체결된 것으로 본다.
      if (record.entryType === 'PULLBACK' && candle.low <= entry) triggered = true;
      else if (record.entryType === 'BREAKOUT' && candle.high >= entry) triggered = true;
      if (!triggered) continue;
    }

    // 같은 봉에서 손절과 목표가 함께 닿으면 보수적으로 손절을 먼저 본다.
    if (stop > 0 && candle.low <= stop && !t1Hit) {
      closed = 'stop_loss';
      break;
    }
    if (t1 > 0 && candle.high >= t1) t1Hit = true;
    if (t2 > 0 && candle.high >= t2) {
      closed = 'target2';
      break;
    }
  }

  if (!triggered) return { target1Hit: false, target2Hit: false, stopHit: false, result: 'not_triggered', ret: null };

  const pct = (price: number) => ((price - entry) / entry) * 100;
  const lastClose = after.at(-1)?.close ?? entry;

  if (closed === 'stop_loss') {
    return { target1Hit: t1Hit, target2Hit: false, stopHit: true, result: 'stop_loss', ret: pct(stop) };
  }
  if (closed === 'target2') {
    return {
      target1Hit: true,
      target2Hit: true,
      stopHit: false,
      result: 'target2',
      ret: pct(t1) * 0.5 + pct(t2) * 0.5,
    };
  }
  if (t1Hit) {
    // 1차만 닿았다 — 절반은 실현, 나머지는 현재가로 평가한다.
    return {
      target1Hit: true,
      target2Hit: false,
      stopHit: false,
      result: 'target1',
      ret: pct(t1) * 0.5 + pct(lastClose) * 0.5,
    };
  }
  return { target1Hit: false, target2Hit: false, stopHit: false, result: 'open', ret: pct(lastClose) };
}

function closeAt(candles: Candle[], targetMs: number): number | null {
  let value: number | null = null;
  for (const candle of candles) {
    if (candle.timestamp > targetMs) break;
    value = candle.close;
  }
  return value;
}

/** 채점이 끝나지 않은 추천을 갱신한다. 이력 화면을 읽을 때 함께 돈다. */
export async function refreshSwingOutcomes(): Promise<number> {
  const rows = getDb()
    .prepare(
      `SELECT * FROM swing_recommendations
        WHERE actual_result IN ('pending', 'open') OR price_after_30d IS NULL
        ORDER BY analyzed_at DESC LIMIT 300`,
    )
    .all() as Row[];

  const update = getDb().prepare(
    `UPDATE swing_recommendations
        SET price_after_7d = @p7, price_after_14d = @p14, price_after_30d = @p30,
            target1_hit = @t1, target2_hit = @t2, stop_loss_hit = @stop,
            actual_result = @result, actual_return = @ret
      WHERE id = @id`,
  );

  let updated = 0;
  const bySymbol = new Map<string, Candle[]>();

  for (const row of rows) {
    const record = toRecord(row);
    const analyzedMs = Date.parse(record.analyzedAt);
    const ageDays = (Date.now() - analyzedMs) / DAY_MS;
    if (ageDays < 1) continue; // 하루도 지나지 않았으면 볼 것이 없다

    let candles = bySymbol.get(record.symbol);
    if (!candles) {
      // 캐시 우선 — 채점 때문에 종목마다 API 를 새로 두드리지 않는다.
      candles = await getCandles(record.symbol, '1d', 300).catch(() =>
        loadCandles(record.symbol, '1d', 300),
      );
      bySymbol.set(record.symbol, candles);
    }
    if (!candles.length) continue;

    const after = candles.filter((c) => c.timestamp > analyzedMs);
    if (!after.length) continue;

    const verdict = judge(record, after);
    update.run({
      id: record.id,
      p7: ageDays >= 7 ? closeAt(after, analyzedMs + 7 * DAY_MS) : null,
      p14: ageDays >= 14 ? closeAt(after, analyzedMs + 14 * DAY_MS) : null,
      p30: ageDays >= 30 ? closeAt(after, analyzedMs + 30 * DAY_MS) : null,
      t1: verdict.target1Hit ? 1 : 0,
      t2: verdict.target2Hit ? 1 : 0,
      stop: verdict.stopHit ? 1 : 0,
      // 30일이 지나도 결판이 안 났으면 열린 채로 종료한다 (스윙은 수주 단위다).
      result: verdict.result,
      ret: verdict.ret,
    });
    updated++;
  }

  return updated;
}
