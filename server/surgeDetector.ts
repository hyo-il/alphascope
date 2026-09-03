/**
 * 주기적 급등 종목 탐지 + 종목별 급등 가능성 평가 (Step 9).
 *
 * ⚠️ 여기서는 어떤 주문도 내지 않는다 — 탐지와 평가만 한다.
 *
 * 데이터원은 **yfinance** 다. 토스 /candles 는 200봉씩 페이지네이션이라
 * 50~100 종목 × 6개월을 받으려면 왕복이 수백 번이 되고, 급등 판정에 필요한 것은
 * 실시간성이 아니라 넉넉한 과거 구간이기 때문이다. 받은 일봉은 24시간 캐시한다.
 */

import type { Candle } from '../src/types/toss';
import type { IndicatorSeries } from '../src/types/chart';
import type {
  AnalysisPeriod,
  PeriodicityResult,
  SignalDetail,
  SurgeEvaluation,
  SurgeEvent,
  SurgeGrade,
  SurgeSettings,
  SurgeSignals,
} from '../src/types/surge';
import { computeIndicators } from './indicatorService';
import { findNames } from './stockCatalog';
import { readHistoryCache, writeHistoryCache } from './surgeStore';

const PYTHON_URL =
  process.env.INDICATORS_URL ?? `http://127.0.0.1:${process.env.INDICATORS_PORT ?? 5001}`;

/** 거래량 평균을 잡는 구간 (일) */
const VOLUME_WINDOW = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

// ── 1. 급등일 추출 ───────────────────────────────────────────────────────────

function toDate(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

/**
 * 급등일 = 전일 종가 대비 상승률과 거래량 조건을 **둘 다** 만족한 날.
 *
 * 변동률의 기준을 시가가 아니라 전일 종가로 잡는 이유: 갭 상승으로 시작해
 * 하루 종일 눌린 날이 "시가 대비 +0.5%" 로 빠져 버리기 때문이다.
 */
export function findSurgeEvents(
  candles: Candle[],
  priceThreshold: number,
  volumeThreshold: number,
): SurgeEvent[] {
  const events: SurgeEvent[] = [];

  // 평균 거래량을 계산할 수 있는 지점부터 본다 (앞의 20봉은 기준이 없다).
  for (let i = VOLUME_WINDOW; i < candles.length; i++) {
    const candle = candles[i];
    const previousClose = candles[i - 1].close;
    if (!previousClose) continue;

    const changePercent = ((candle.close - previousClose) / previousClose) * 100;
    if (changePercent < priceThreshold) continue;

    // 당일은 평균에 넣지 않는다 — 급등일의 거래량이 스스로 기준을 끌어올린다.
    const window = candles.slice(i - VOLUME_WINDOW, i);
    const avgVolume = window.reduce((sum, c) => sum + c.volume, 0) / window.length;
    if (!avgVolume) continue;

    const volumeRatio = (candle.volume / avgVolume) * 100;
    if (volumeRatio < volumeThreshold) continue;

    events.push({
      date: toDate(candle.timestamp),
      open: candle.open,
      close: candle.close,
      changePercent: round(changePercent, 2),
      volume: candle.volume,
      avgVolume: Math.round(avgVolume),
      volumeRatio: round(volumeRatio, 1),
    });
  }

  return events;
}

// ── 2. 주기성 분석 ───────────────────────────────────────────────────────────

function round(value: number, digits = 2): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

const EMPTY_PERIODICITY: PeriodicityResult = {
  isPeriodic: false,
  surgeCount: 0,
  intervals: [],
  avgInterval: 0,
  stdDeviation: 0,
  regularity: 0,
  avgSurgePercent: 0,
  lastSurgeDate: null,
  nextEstimatedDate: null,
  daysUntilNext: null,
  confidence: 0,
};

/**
 * 급등 간격이 얼마나 일정한지.
 *
 * 규칙성 = 100 × (1 − 표준편차/평균). 표준편차가 평균의 절반이면 50% 가 되어
 * 명세의 "표준편차 ≤ 평균의 50%" 기준과 같은 선이 된다.
 */
export function analyzePeriodicity(
  events: SurgeEvent[],
  minSurgeCount: number,
  regularityThreshold: number,
): PeriodicityResult {
  if (events.length < 2) {
    return {
      ...EMPTY_PERIODICITY,
      surgeCount: events.length,
      avgSurgePercent: events.length ? round(events[0].changePercent) : 0,
      lastSurgeDate: events.at(-1)?.date ?? null,
    };
  }

  const intervals: number[] = [];
  for (let i = 1; i < events.length; i++) {
    const days = Math.round(
      (Date.parse(events[i].date) - Date.parse(events[i - 1].date)) / DAY_MS,
    );
    intervals.push(days);
  }

  const avgInterval = intervals.reduce((sum, v) => sum + v, 0) / intervals.length;
  const variance =
    intervals.reduce((sum, v) => sum + (v - avgInterval) ** 2, 0) / intervals.length;
  const stdDeviation = Math.sqrt(variance);
  const regularity = avgInterval > 0 ? Math.max(0, 100 * (1 - stdDeviation / avgInterval)) : 0;

  const lastSurgeDate = events.at(-1)!.date;
  const nextMs = Date.parse(lastSurgeDate) + Math.round(avgInterval) * DAY_MS;
  const today = Date.parse(new Date().toISOString().slice(0, 10));

  const isPeriodic = events.length >= minSurgeCount && regularity >= regularityThreshold;

  /*
   * 신뢰도는 규칙성만으로 정하지 않는다. 급등이 두 번뿐이면 간격이 하나뿐이라
   * 표준편차가 0 — 규칙성 100% 가 나오지만 근거는 없다시피 하다.
   * 표본이 6회(간격 5개)에 이르면 규칙성을 그대로 쓴다.
   */
  const sampleWeight = Math.min(1, (events.length - 1) / 5);
  const confidence = Math.round(regularity * (0.4 + 0.6 * sampleWeight));

  return {
    isPeriodic,
    surgeCount: events.length,
    intervals,
    avgInterval: round(avgInterval, 1),
    stdDeviation: round(stdDeviation, 1),
    regularity: round(regularity),
    avgSurgePercent: round(
      events.reduce((sum, e) => sum + e.changePercent, 0) / events.length,
    ),
    lastSurgeDate,
    nextEstimatedDate: toDate(nextMs),
    daysUntilNext: Math.round((nextMs - today) / DAY_MS),
    confidence,
  };
}

// ── 3. 현재 신호 + 점수 ──────────────────────────────────────────────────────

/** 시리즈의 마지막 유효 값 */
function last(series: (number | null)[] | undefined, offset = 0): number | null {
  if (!series?.length) return null;
  let seen = 0;
  for (let i = series.length - 1; i >= 0; i--) {
    const value = series[i];
    if (value == null || !Number.isFinite(value)) continue;
    if (seen === offset) return value;
    seen++;
  }
  return null;
}

function mean(values: number[]): number {
  return values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;
}

/** 점수 배분 — 명세 그대로. 한 곳에 모아 두어야 화면 설명과 어긋나지 않는다. */
const SCORE: Record<keyof SurgeSignals | 'periodic', number> = {
  periodic: 30,
  nearCycleDate: 20,
  rsiOversold: 15,
  volumeIncreasing: 10,
  bollingerLower: 10,
  macdCrossing: 10,
  priceCompressed: 5,
  nearSupport: 0, // 지지선은 볼린저 하단과 겹쳐 이중 가산이 되므로 표시만 한다
};

export function gradeOf(score: number): SurgeGrade {
  if (score >= 80) return 'HIGH';
  if (score >= 60) return 'MEDIUM';
  if (score >= 40) return 'LOW';
  return 'NONE';
}

interface SignalOutcome {
  signals: SurgeSignals;
  details: SignalDetail[];
}

function evaluateSignals(
  candles: Candle[],
  indicators: IndicatorSeries | null,
  periodicity: PeriodicityResult,
): SignalOutcome {
  const price = candles.at(-1)?.close ?? null;
  const rsi = last(indicators?.rsi14);
  const bbLower = last(indicators?.bbLower);
  const bbMiddle = last(indicators?.bbMiddle);
  const histogram = last(indicators?.macdHistogram);
  const histogramPrev = last(indicators?.macdHistogram, 1);
  const atr = last(indicators?.atr14);
  const atrSeries = (indicators?.atr14 ?? []).filter(
    (v): v is number => v != null && Number.isFinite(v),
  );
  const atrAverage = mean(atrSeries.slice(-20));

  const recentVolume = mean(candles.slice(-5).map((c) => c.volume));
  const baseVolume = mean(candles.slice(-20).map((c) => c.volume));
  const support = candles.length ? Math.min(...candles.slice(-60).map((c) => c.low)) : null;

  const signals: SurgeSignals = {
    rsiOversold: rsi != null && rsi <= 35,
    volumeIncreasing: baseVolume > 0 && recentVolume > baseVolume * 1.2,
    nearSupport: price != null && support != null && price <= support * 1.03,
    bollingerLower:
      price != null && bbLower != null && bbMiddle != null
        ? price <= bbLower + (bbMiddle - bbLower) * 0.25
        : false,
    // 히스토그램이 음수에서 올라오는 중이거나 막 양전환한 상태
    macdCrossing:
      histogram != null && histogramPrev != null
        ? (histogram < 0 && histogram > histogramPrev) ||
          (histogram > 0 && histogramPrev <= 0)
        : false,
    priceCompressed: atr != null && atrAverage > 0 && atr < atrAverage * 0.9,
    nearCycleDate:
      periodicity.isPeriodic &&
      periodicity.daysUntilNext != null &&
      Math.abs(periodicity.daysUntilNext) <= 3,
  };

  const fmt = (value: number | null, digits = 1) =>
    value == null ? '데이터 없음' : value.toFixed(digits);

  const details: SignalDetail[] = [
    {
      key: 'rsiOversold',
      label: 'RSI(14)',
      value: fmt(rsi),
      verdict: rsi == null ? '—' : rsi <= 35 ? '과매도' : rsi >= 70 ? '과매수' : '중립',
      hit: signals.rsiOversold,
    },
    {
      key: 'volumeIncreasing',
      label: '거래량 추세',
      value: baseVolume ? `20일 평균 대비 ${Math.round((recentVolume / baseVolume) * 100)}%` : '—',
      verdict: signals.volumeIncreasing ? '증가 중' : '정상',
      hit: signals.volumeIncreasing,
    },
    {
      key: 'nearSupport',
      label: '지지선(60일 최저)',
      value: support == null ? '—' : support.toFixed(2),
      verdict: signals.nearSupport ? '근접' : '여유',
      hit: signals.nearSupport,
    },
    {
      key: 'bollingerLower',
      label: '볼린저밴드',
      value: bbLower == null ? '—' : `하단 ${bbLower.toFixed(2)}`,
      verdict: signals.bollingerLower ? '하단 근처' : '중단 이상',
      hit: signals.bollingerLower,
    },
    {
      key: 'macdCrossing',
      label: 'MACD',
      value: histogram == null ? '—' : `히스토그램 ${histogram.toFixed(3)}`,
      verdict: signals.macdCrossing ? '골든크로스 임박·양전환' : '변화 없음',
      hit: signals.macdCrossing,
    },
    {
      key: 'priceCompressed',
      label: '변동성(ATR)',
      value: atr == null ? '—' : atr.toFixed(2),
      verdict: signals.priceCompressed ? '축소 중 (스프링)' : '보통',
      hit: signals.priceCompressed,
    },
    {
      key: 'nearCycleDate',
      label: '예상 급등일',
      value:
        periodicity.daysUntilNext == null
          ? '패턴 없음'
          : periodicity.daysUntilNext >= 0
            ? `${periodicity.daysUntilNext}일 남음`
            : `${Math.abs(periodicity.daysUntilNext)}일 지남`,
      verdict: signals.nearCycleDate ? '근접(±3일)' : '거리 있음',
      hit: signals.nearCycleDate,
    },
  ];

  return { signals, details };
}

function scoreOf(signals: SurgeSignals, periodicity: PeriodicityResult): number {
  let score = periodicity.isPeriodic ? SCORE.periodic : 0;
  for (const [key, hit] of Object.entries(signals) as [keyof SurgeSignals, boolean][]) {
    if (hit) score += SCORE[key];
  }
  return Math.min(100, score);
}

/** 카드에 한 줄로 적을 평가 요약 */
function reasonOf(
  periodicity: PeriodicityResult,
  signals: SurgeSignals,
  grade: SurgeGrade,
): string {
  const parts: string[] = [];

  if (periodicity.isPeriodic) {
    parts.push(
      `평균 ${periodicity.avgInterval}일 간격으로 ${periodicity.surgeCount}회 급등 (규칙성 ${periodicity.regularity}%)`,
    );
  } else if (periodicity.surgeCount > 0) {
    parts.push(`급등 ${periodicity.surgeCount}회이나 간격이 불규칙합니다`);
  } else {
    parts.push('기준을 넘는 급등이 없었습니다');
  }

  const hits = [
    signals.nearCycleDate && '예상 급등일 근접',
    signals.rsiOversold && 'RSI 과매도',
    signals.volumeIncreasing && '거래량 증가',
    signals.bollingerLower && '볼린저 하단',
    signals.macdCrossing && 'MACD 양전환',
    signals.priceCompressed && '변동성 축소',
  ].filter(Boolean) as string[];

  parts.push(hits.length ? `현재 신호: ${hits.join(' · ')}` : '현재 급등 직전 신호는 없습니다');

  const closing =
    grade === 'HIGH'
      ? '진입 조건을 미리 정해 두고 관찰할 구간입니다.'
      : grade === 'MEDIUM'
        ? '즉시 진입보다 관찰이 적절합니다.'
        : '지금은 근거가 부족합니다.';

  return `${parts.join('. ')}. ${closing}`;
}

// ── 4. 데이터 수집 ───────────────────────────────────────────────────────────

/** yfinance 일봉 — 24시간 캐시. 캐시에서 나오면 호출 간격도 필요 없다. */
export async function getHistory(
  symbol: string,
  period: AnalysisPeriod,
): Promise<{ candles: Candle[]; cached: boolean }> {
  const cached = readHistoryCache(symbol, period);
  if (cached) return { candles: cached, cached: true };

  const url = new URL('/history', PYTHON_URL);
  url.searchParams.set('symbol', symbol);
  url.searchParams.set('period', period);

  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) }).catch((e) => {
    throw new Error(
      `과거 데이터 서비스에 연결하지 못했습니다 (${PYTHON_URL}). ` +
        `\`npm run dev\` 로 함께 띄우세요. 원인: ${e instanceof Error ? e.message : String(e)}`,
    );
  });

  const payload = (await response.json()) as { candles?: Candle[]; error?: string };
  if (!response.ok || payload.error) throw new Error(payload.error ?? `조회 실패 (${response.status})`);

  const candles = payload.candles ?? [];
  if (candles.length) writeHistoryCache(symbol, period, candles);
  return { candles, cached: false };
}

// ── 5. 종목 하나 평가 ────────────────────────────────────────────────────────

export const DEFAULT_SETTINGS: SurgeSettings = {
  priceThreshold: 3,
  volumeThreshold: 200,
  minSurgeCount: 3,
  analysisPeriod: '6mo',
  regularityThreshold: 50,
  usePreset: true,
  useWatchlist: true,
};

export async function evaluateSurgePotential(
  symbol: string,
  settings: SurgeSettings,
): Promise<SurgeEvaluation> {
  const upper = symbol.toUpperCase();
  const name = findNames([upper])[upper] ?? null;

  const { candles } = await getHistory(upper, settings.analysisPeriod);
  if (candles.length < VOLUME_WINDOW + 2) {
    return {
      symbol: upper,
      name,
      price: candles.at(-1)?.close ?? null,
      periodicity: EMPTY_PERIODICITY,
      currentSignals: {
        rsiOversold: false,
        volumeIncreasing: false,
        nearSupport: false,
        bollingerLower: false,
        macdCrossing: false,
        priceCompressed: false,
        nearCycleDate: false,
      },
      signalDetails: [],
      surgeScore: 0,
      grade: 'NONE',
      reason: '분석할 과거 데이터가 부족합니다.',
      surgeHistory: [],
      candleCount: candles.length,
      error: '과거 일봉이 부족합니다 (상장 직후이거나 심볼이 다를 수 있습니다).',
    };
  }

  const events = findSurgeEvents(candles, settings.priceThreshold, settings.volumeThreshold);
  const periodicity = analyzePeriodicity(events, settings.minSurgeCount, settings.regularityThreshold);

  // 지표 엔진이 꺼져 있어도 과거 패턴만은 보여 준다 — 여기서 던지면 화면이 통째로 빈다.
  const indicators = await computeIndicators(candles).catch(() => null);
  const { signals, details } = evaluateSignals(candles, indicators, periodicity);

  const surgeScore = scoreOf(signals, periodicity);
  const grade = gradeOf(surgeScore);

  return {
    symbol: upper,
    name,
    price: candles.at(-1)?.close ?? null,
    periodicity,
    currentSignals: signals,
    signalDetails: details,
    surgeScore,
    grade,
    reason: reasonOf(periodicity, signals, grade),
    surgeHistory: events.map((e) => ({ date: e.date, changePercent: e.changePercent })),
    candleCount: candles.length,
    error: indicators ? null : '지표 엔진이 꺼져 있어 현재 신호는 계산하지 못했습니다.',
  };
}
