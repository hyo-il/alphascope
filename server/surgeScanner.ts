/**
 * 급등 탐지 한 바퀴 실행 + 진행률 + 성과 추적.
 *
 * 실행은 오래 걸린다(50종목 × yfinance 조회). 요청을 붙잡아 두면 브라우저가
 * 먼저 끊어 버리므로, POST 는 시작만 하고 화면은 진행률을 폴링한다.
 */

import type { SurgeEvaluation, SurgeProgress, SurgeSettings } from '../src/types/surge';
import { evaluateSurgePotential, findSurgeEvents, getHistory } from './surgeDetector';
import {
  getSettings,
  insertDetection,
  pendingOutcomes,
  updateOutcome,
} from './surgeStore';

/**
 * 사전 정의 종목 — S&P 500 시가총액 상위군.
 *
 * 토스 랭킹 API 로 후보를 넓히는 방법도 있지만, 랭킹은 Rate Limit 소모가 크고
 * 하루에도 여러 번 바뀐다. 주기성은 몇 달을 봐야 하는 성질이라 고정 종목군이 낫다.
 */
export const PRESET_UNIVERSE = [
  'AAPL', 'MSFT', 'NVDA', 'GOOGL', 'AMZN', 'META', 'AVGO', 'TSLA', 'BRK-B', 'LLY',
  'JPM', 'V', 'XOM', 'UNH', 'MA', 'COST', 'HD', 'PG', 'JNJ', 'WMT',
  'NFLX', 'ABBV', 'CRM', 'BAC', 'ORCL', 'MRK', 'CVX', 'KO', 'AMD', 'PEP',
  'ADBE', 'TMO', 'LIN', 'CSCO', 'ACN', 'MCD', 'ABT', 'PM', 'INTU', 'GE',
  'TXN', 'QCOM', 'DIS', 'CAT', 'VZ', 'INTC', 'AMAT', 'BKNG', 'NOW', 'UBER',
];

const DAY_MS = 24 * 60 * 60 * 1000;
/** yfinance 를 쉬지 않고 두드리면 차단된다. 캐시에서 나온 종목은 기다리지 않는다. */
const FETCH_DELAY_MS = 1000;

let progress: SurgeProgress = {
  running: false,
  total: 0,
  done: 0,
  current: null,
  startedAt: null,
  finishedAt: null,
  found: 0,
  error: null,
};

export function getProgress(): SurgeProgress {
  return progress;
}

/** 분석 대상 종목 — 설정에 따라 사전 정의 목록과 관심 목록을 합친다. */
export function resolveUniverse(settings: SurgeSettings, watchlist: string[]): string[] {
  const symbols: string[] = [];
  if (settings.usePreset) symbols.push(...PRESET_UNIVERSE);
  if (settings.useWatchlist) symbols.push(...watchlist);

  return [
    ...new Set(
      symbols
        .map((s) => s.trim().toUpperCase())
        .filter((s) => s && /^[A-Z0-9.\-]+$/.test(s)),
    ),
  ];
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * 한 바퀴 실행. 이미 돌고 있으면 두 번 돌리지 않는다 —
 * 버튼 연타로 yfinance 호출이 두 배가 되는 것을 막는다.
 */
export function startDetection(watchlist: string[]): SurgeProgress {
  if (progress.running) return progress;

  const settings = getSettings();
  const universe = resolveUniverse(settings, watchlist);

  progress = {
    running: true,
    total: universe.length,
    done: 0,
    current: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    found: 0,
    error: universe.length ? null : '분석 대상이 없습니다. 설정에서 대상을 선택하세요.',
  };

  if (!universe.length) {
    progress = { ...progress, running: false, finishedAt: new Date().toISOString() };
    return progress;
  }

  void run(universe, settings);
  return progress;
}

async function run(universe: string[], settings: SurgeSettings): Promise<void> {
  const detectedAt = new Date().toISOString();
  let found = 0;

  try {
    for (const symbol of universe) {
      progress = { ...progress, current: symbol };
      try {
        // 캐시에 있으면 딜레이 없이 지나간다 (재실행이 훨씬 빠르다).
        const { cached } = await getHistory(symbol, settings.analysisPeriod);
        const evaluation = await evaluateSurgePotential(symbol, settings);

        // 주기적인 종목만 남긴다 — 목록의 목적이 "반복되는 급등" 이다.
        if (evaluation.periodicity.isPeriodic) {
          insertDetection(detectedAt, evaluation);
          found++;
        }
        if (!cached) await sleep(FETCH_DELAY_MS);
      } catch (e) {
        // 한 종목이 실패해도 나머지는 계속 본다 (상장 폐지·심볼 불일치 등).
        console.error('[surge]', symbol, e instanceof Error ? e.message : e);
      }
      progress = { ...progress, done: progress.done + 1, found };
    }
  } catch (e) {
    progress = { ...progress, error: e instanceof Error ? e.message : String(e) };
  } finally {
    progress = {
      ...progress,
      running: false,
      current: null,
      found,
      finishedAt: new Date().toISOString(),
    };
  }
}

// ── 성과 추적 ────────────────────────────────────────────────────────────────

/** 그 시각 이하의 마지막 종가 */
function closeAt(candles: { timestamp: number; close: number }[], targetMs: number): number | null {
  let value: number | null = null;
  for (const candle of candles) {
    if (candle.timestamp > targetMs) break;
    value = candle.close;
  }
  return value;
}

/**
 * 탐지 후 실제로 급등했는지 채점한다.
 *
 * 결과를 저장하는 이유(Gemini 정확도와 반대): 탐지는 실행할 때마다 종목이 달라져
 * 나중에 다시 계산하려면 그 시점의 캔들을 종목마다 또 받아야 한다.
 */
export async function refreshOutcomes(): Promise<number> {
  const settings = getSettings();
  const rows = pendingOutcomes();
  let updated = 0;

  for (const row of rows) {
    const detectedMs = Date.parse(row.detectedAt);
    const ageDays = (Date.now() - detectedMs) / DAY_MS;
    if (ageDays < 7) continue; // 아직 볼 것이 없다

    let candles;
    try {
      // 캐시가 살아 있으면 그대로 쓴다 — 채점 때문에 yfinance 를 다시 두드리지 않는다.
      candles = (await getHistory(row.symbol, settings.analysisPeriod)).candles;
    } catch {
      continue;
    }
    if (!candles.length) continue;

    const after = candles.filter((c) => c.timestamp > detectedMs);
    const events = findSurgeEvents(candles, settings.priceThreshold, settings.volumeThreshold);
    const hit = events.find(
      (e) =>
        Date.parse(e.date) > detectedMs && Date.parse(e.date) <= detectedMs + 30 * DAY_MS,
    );

    updateOutcome(row.id, {
      priceAfter7d: ageDays >= 7 ? closeAt(after, detectedMs + 7 * DAY_MS) : null,
      priceAfter14d: ageDays >= 14 ? closeAt(after, detectedMs + 14 * DAY_MS) : null,
      priceAfter30d: ageDays >= 30 ? closeAt(after, detectedMs + 30 * DAY_MS) : null,
      // 급등이 나왔으면 30일을 기다릴 것 없이 확정, 아니면 30일이 지나야 '없었다' 가 된다.
      actualSurged: hit ? true : ageDays >= 30 ? false : null,
      actualSurgeDate: hit?.date ?? null,
      actualSurgePercent: hit?.changePercent ?? null,
    });
    updated++;
  }

  return updated;
}

/** 단일 종목 평가 — 검색 탭이 쓴다 (탐지 결과로 저장하지 않는다). */
export async function evaluateOne(symbol: string): Promise<SurgeEvaluation> {
  return evaluateSurgePotential(symbol, getSettings());
}
