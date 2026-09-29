/**
 * 목표 수익률별 "먼저 닿을 확률" — 스윙 화면의 「목표 수익률」 탭과 `npm run diagnose` 가 함께 쓴다.
 *
 * ⚠️ **계산은 여기 한 곳이다.** 진단 스크립트에 있던 것을 옮겼다 (v2.14.0). 두 벌이면
 * 웹 화면과 리포트의 숫자가 달라진다.
 * ⚠️ 이것은 **예측이 아니라 과거 빈도**다. 아무 조건 없이 매일 샀을 때의 숫자이므로
 * 매매 신호는 이 기준선보다 나아야 의미가 있다. 스윙 등급·추천·자동매매에는 쓰지 않는다.
 */

import type { Candle } from '../../src/types/toss';
import { getCandles } from '../candleService';
import { loadCandles } from '../db';
import { getWatchlist } from '../userData';
import { findStock } from '../stockCatalog';

/** 판정 구간 — 최근 250 거래일(약 1년) */
export const FREQ_DAYS = 250;

/** 모의계좌 기본값 — 왕복으로 뺀다 (수수료 0.1% + 슬리피지 0.05%) × 2 = 0.30%p */
const COMMISSION = 0.001;
const SLIPPAGE = 0.0005;
export const ROUND_TRIP_COST = (COMMISSION + SLIPPAGE) * 2 * 100;

const round2 = (v: number) => Math.round(v * 100) / 100;

export interface FreqRow {
  target: number;
  stop: number;
  horizon: number;
  samples: number;
  hitTarget: number;
  hitStop: number;
  neither: number;
  expectancy: number;
}

export type TouchOutcome = 'target' | 'stop' | 'neither';

/**
 * i 번째 봉 종가에 샀을 때, 다음 N 봉 안에 목표(+X%)와 손절(−Y%) 중 **어느 쪽에 먼저** 닿았나.
 * 뒤에 N 봉이 없으면 null (아직 결과가 확정되지 않았다).
 *
 * ⚠️ 같은 날 둘 다 닿으면 **손절로 센다**(보수적). 일봉만으로는 장중 순서를 알 수 없어서,
 * 유리한 쪽으로 가정하면 실제보다 좋아 보인다.
 * ⚠️ 이 결과는 **i+1 ~ i+N 봉**을 본다 — 과거 표본으로 쓸 때는 i+N 봉이 판단 시점보다 앞서야 한다.
 */
export function touchOutcome(candles: Candle[], i: number, X: number, Y: number, N: number): TouchOutcome | null {
  if (i + N >= candles.length) return null;
  const buy = candles[i].close;
  const tp = buy * (1 + X / 100);
  const sl = buy * (1 - Y / 100);
  for (let k = 1; k <= N; k += 1) {
    const bar = candles[i + k];
    if (bar.low <= sl) return 'stop'; // 같은 날 둘 다면 손절 (보수적)
    if (bar.high >= tp) return 'target';
  }
  return 'neither';
}

/** 매일 종가에 샀다고 가정한 빈도 — 최근 `days` 봉에서 `touchOutcome` 을 센다 */
export function firstTouch(candles: Candle[], X: number, Y: number, N: number, days = FREQ_DAYS): FreqRow {
  const usable = candles.slice(-days);
  let samples = 0;
  let hitTarget = 0;
  let hitStop = 0;

  for (let i = 0; i < usable.length - N; i += 1) {
    samples += 1;
    const outcome = touchOutcome(usable, i, X, Y, N);
    if (outcome === 'stop') hitStop += 1;
    else if (outcome === 'target') hitTarget += 1;
  }

  const neither = samples - hitTarget - hitStop;
  const tRate = samples ? (hitTarget / samples) * 100 : 0;
  const sRate = samples ? (hitStop / samples) * 100 : 0;
  return {
    target: X,
    stop: Y,
    horizon: N,
    samples,
    hitTarget: round2(tRate),
    hitStop: round2(sRate),
    neither: round2(samples ? (neither / samples) * 100 : 0),
    // 기대값 = 도달률×X − 손절률×Y − 왕복 비용
    expectancy: round2((tRate / 100) * X - (sRate / 100) * Y - ROUND_TRIP_COST),
  };
}

/** 목표 × (2:1, 1:1) × 기간 전 조합 — 진단 리포트용 */
export function firstTouchFrequency(
  candles: Candle[],
  targets: number[],
  horizons: number[],
  days = FREQ_DAYS,
): FreqRow[] {
  const rows: FreqRow[] = [];
  for (const X of targets) {
    for (const Y of [X / 2, X]) {
      for (const N of horizons) rows.push(firstTouch(candles, X, Y, N, days));
    }
  }
  return rows;
}

/** ATR(14) 가격 단위 — 마지막 period 개 True Range 의 단순 평균. 봉이 모자라면 null */
export function atr(candles: Candle[], period = 14): number | null {
  const c = candles.slice(-(period + 1));
  if (c.length < period + 1) return null;
  let sum = 0;
  for (let i = 1; i < c.length; i += 1) {
    sum += Math.max(
      c[i].high - c[i].low,
      Math.abs(c[i].high - c[i - 1].close),
      Math.abs(c[i].low - c[i - 1].close),
    );
  }
  return sum / period;
}

/** 하루 평균 변동폭(ATR 14, 종가 대비 %) — "목표 3% 는 이 종목의 며칠치인가" */
export function atrPercent(candles: Candle[], period = 14): number | null {
  const value = atr(candles, period);
  return value === null ? null : round2((value / candles.at(-1)!.close) * 100);
}

/** 캔들 확보 — 실시간이 막히면 SQLite 캐시로 내려간다 (엔진과 같은 방침) */
export async function dailyCandles(symbol: string, limit = FREQ_DAYS + 30): Promise<Candle[]> {
  return getCandles(symbol, '1d', limit).catch(() => loadCandles(symbol, '1d', limit));
}

// ── 화면용 표 (`GET /api/swing/target-hit`) ──────────────────────────────────

export const TARGET_CHOICES = [3, 5, 10, 15];
/** 손절 = 목표 × 비율 — 0.5 는 2:1, 1 은 1:1 */
export const STOP_RATIO_CHOICES = [0.5, 1];
export const HORIZON_CHOICES = [5, 10, 20];

export interface TargetHitRow extends Partial<FreqRow> {
  symbol: string;
  name: string | null;
  atr: number | null;
  error?: string;
}

export interface TargetHitResult {
  target: number;
  stop: number;
  days: number;
  rows: TargetHitRow[];
  spy: TargetHitRow | null;
  asOf: string;
  computedAt: string;
}

/** 관심 목록 전체 (폴더를 풀어서, 중복 제거) — 스윙 분석과 같은 대상 */
export function watchlistSymbols(): string[] {
  const folders = getWatchlist().folders ?? [];
  return [...new Set(folders.flatMap((f) => f.symbols ?? []))];
}

/*
  (목표, 손절, 기간, 날짜) 단위로 하루 캐시한다. 과거 250일 빈도라 장중에 새로 받아도
  숫자가 거의 움직이지 않고, 버튼을 누를 때마다 관심 종목 전체 캔들을 다시 읽을 이유가 없다.
  관심 목록이 바뀌면 키가 달라지게 종목 목록도 넣는다.
*/
const cache = new Map<string, TargetHitResult>();

export async function targetHitTable(target: number, stopRatio: number, days: number): Promise<TargetHitResult> {
  const symbols = watchlistSymbols();
  const today = new Date().toISOString().slice(0, 10);
  const key = `${target}|${stopRatio}|${days}|${today}|${symbols.join(',')}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const stop = target * stopRatio;
  let lastBar = 0;

  const rowOf = async (symbol: string): Promise<TargetHitRow> => {
    const name = findStock(symbol)?.name ?? null;
    try {
      const candles = await dailyCandles(symbol);
      if (candles.length < 60) return { symbol, name, atr: null, error: '일봉이 부족합니다' };
      lastBar = Math.max(lastBar, candles.at(-1)!.timestamp);
      return { symbol, name, atr: atrPercent(candles), ...firstTouch(candles, target, stop, days) };
    } catch (e) {
      return { symbol, name, atr: null, error: e instanceof Error ? e.message : String(e) };
    }
  };

  // 순차 — 관심 종목 십여 개는 캐시를 타서 금방이고, 한꺼번에 보내면 Rate Limit 만 먹는다
  const rows: TargetHitRow[] = [];
  for (const symbol of symbols) rows.push(await rowOf(symbol));
  const spy = await rowOf('SPY');

  const result: TargetHitResult = {
    target,
    stop,
    days,
    rows,
    spy: spy.error ? null : { ...spy, name: 'S&P 500 (시장 전체)' },
    asOf: lastBar ? new Date(lastBar).toISOString() : today,
    computedAt: new Date().toISOString(),
  };
  // 날짜가 바뀐 옛 항목은 버린다 — 하루 캐시라 쌓아 둘 이유가 없다
  for (const k of cache.keys()) if (!k.includes(`|${today}|`)) cache.delete(k);
  cache.set(key, result);
  return result;
}
