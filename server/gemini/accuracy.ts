/**
 * AI 정확도 추적.
 *
 * 채점은 저장해 두지 않고 매번 캔들에서 다시 계산한다 — 채점 기준(보유 기간·임계값)이
 * 바뀔 여지가 크고, 분석 건수는 많아야 수천 건이라 비용이 무시할 만하다.
 *
 * ⚠️ Claude 와 Gemini 의 전체 정확도를 나란히 놓고 비교하면 안 된다.
 * Claude 는 사용자가 "볼 만하다" 고 고른 종목만 분석하므로 선택 편향이 있고
 * 표본 수도 자릿수가 다르다. 그래서 "같은 종목·같은 날 둘 다 분석한 쌍" 만
 * 따로 뽑는 pairedComparison 을 함께 제공한다.
 */

import { getDb, loadCandles } from '../db';
import type { AgentOpinion, GeminiTrigger } from '../../src/types/gemini';
import type { Candle } from '../../src/types/toss';
import { marketCloseMinutes, marketDate, marketMinutes } from '../../src/utils/marketDate';
import { LEGACY_PROMPT_VERSION, ensureGeminiSchema, triggerOf } from './store';

/** 채점 기준: 스윙 트레이딩이므로 5 거래일 뒤를 본다 */
const HORIZON_DAYS = 5;
/** 화면·진단에 그대로 적는 채점 규칙 */
export const SCORING_RULE = '5거래일(v2.15.0) — 기준 거래일 D(마감 전 분석이면 그날, 마감 후·휴장일이면 다음 거래일)의 5거래일 뒤 종가';
/** HOLD 를 맞다고 볼 변동 범위 */
const FLAT_BAND_PERCENT = 2;

export type Outcome = 'correct' | 'incorrect' | 'pending';

/** SQLite 행 — 두 테이블에서 채점에 필요한 열만 뽑는다 */
interface GeminiRow {
  id: number;
  symbol: string;
  created_at: string;
  signal: string;
  confidence: number;
  price_at_analysis: number | null;
  prompt_version: string | null;
  trigger: string | null;
}

interface ClaudeRow {
  id: number;
  symbol: string;
  analyzed_at: string;
  verdict: string | null;
  confidence: string | null;
  price_at_analysis: number | null;
}

interface AgentsRow {
  symbol: string;
  created_at: string;
  price_at_analysis: number | null;
  agents: string;
  prompt_version: string | null;
}

export interface ScoredAnalysis {
  id: number;
  source: 'claude' | 'gemini';
  symbol: string;
  analyzedAt: string;
  signal: string;
  confidence: number | null;
  priceAtAnalysis: number | null;
  /** 프롬프트 버전 — Gemini 만 (Claude 는 사람이 붙여 넣은 답이라 null) */
  promptVersion: string | null;
  /**
   * 출처(v2.30.0) — Gemini 만: auto(계좌 자동)·scheduled(지정 종목)·manual(바로 분석), 옛 값 해석은 `store.triggerOf` 그대로.
   * ⚠️ **채점은 이 값을 보지 않는다** — 출처별 표(`byTrigger`)를 나눌 때만 쓴다.
   */
  trigger?: GeminiTrigger;
  priceAfter: number | null;
  changePercent: number | null;
  outcome: Outcome;
}

/**
 * ⚠️ **채점 기준 거래일 D** — 이 함수 한 곳에서 정한다 (v2.15.0).
 *
 * - 분석 시각이 그 시장의 **거래일 정규장 마감 전**(장전·장중)이면 D = 그날
 * - **마감 후**이거나 **휴장일**(그 날짜의 봉이 없음)이면 D = 다음 거래일
 *
 * 예전에는 "분석 시각 이후 첫 봉" 이었다. 일봉 timestamp 가 그날 0시라 장중 분석은 **다음 날 봉이 1번**이
 * 되어 실제로 6거래일 뒤로 채점됐다. 시장 날짜·마감 시각은 `marketDate.ts`(미국 16:00 ET · 국내 15:30 KST).
 * D 의 봉이 아직 캐시에 없으면 -1 (대기).
 */
export function scoringBaseIndex(candles: Candle[], analyzedAtMs: number, symbol: string, dates?: string[]): number {
  const day = marketDate(analyzedAtMs, symbol);
  const beforeClose = marketMinutes(analyzedAtMs, symbol) < marketCloseMinutes(symbol);
  const ds = dates ?? candles.map((c) => marketDate(c.timestamp, symbol));
  if (beforeClose) {
    const same = ds.indexOf(day);
    if (same >= 0) return same;
  }
  return ds.findIndex((d) => d > day);
}

/*
  종목별 캔들·날짜 문자열 캐시 — 분석 수백 건이 같은 종목을 보므로 매번 2,000봉을 읽고
  날짜를 다시 만들지 않는다. 캐시의 마지막 봉이 바뀌면 다시 읽는다.
*/
const candleMemo = new Map<string, { last: number; length: number; candles: Candle[]; dates: string[] }>();

export function dailyWithDates(symbol: string) {
  const candles = loadCandles(symbol, '1d', 2000);
  const last = candles.at(-1)?.timestamp ?? 0;
  const hit = candleMemo.get(symbol);
  if (hit && hit.last === last && hit.length === candles.length) return hit;
  const entry = { last, length: candles.length, candles, dates: candles.map((c) => marketDate(c.timestamp, symbol)) };
  candleMemo.set(symbol, entry);
  return entry;
}

/** 기준 거래일 D 로부터 HORIZON_DAYS 거래일 뒤 종가 — 아직 없으면 null(대기) */
function priceAfter(symbol: string, analyzedAt: string): number | null {
  const at = Date.parse(analyzedAt);
  if (!Number.isFinite(at)) return null;
  const { candles, dates } = dailyWithDates(symbol);
  const base = scoringBaseIndex(candles, at, symbol, dates);
  if (base < 0) return null;
  const target = candles[base + HORIZON_DAYS];
  return target ? target.close : null;
}

/**
 * ⚠️ **같은 출처·같은 종목·같은 날(시장 날짜)의 반복 분석은 통계에서 1건으로 묶는다** —
 * 그날 **마지막** 분석만 남긴다 (v2.14.0).
 *
 * 계좌별 AI형 자동매매는 주기마다 같은 종목을 다시 분석한다(오라클: 3일에 166건, 11종목).
 * 그대로 세면 한 종목·한 날의 결과가 적중률을 지배한다 — 같은 5일 뒤 종가로 여러 번 채점되기
 * 때문이다. 원본 행은 지우지 않는다. 통계를 낼 때만 묶는다.
 * 진단 리포트(`server/diagnose`)와 「분석 성적표」가 **이 함수 하나**를 쓴다.
 *
 * 날짜는 시장 시간대다 — 미국 정규장(13:30~20:00 UTC)은 KST 로 자르면 이틀에 걸친다.
 */
export function onePerDay<T extends { source?: string; promptVersion?: string | null; symbol: string; analyzedAt: string }>(
  items: T[],
): T[] {
  const latest = new Map<string, T>();
  for (const item of items) {
    const at = Date.parse(item.analyzedAt);
    const day = Number.isFinite(at) ? marketDate(at, item.symbol) : item.analyzedAt.slice(0, 10);
    // 버전별로 묶는다 — v1 과 v2 가 같은 날 분석했으면 둘 다 남아야 비교할 수 있다
    const key = `${item.source ?? ''}|${item.promptVersion ?? ''}|${item.symbol}|${day}`;
    const kept = latest.get(key);
    if (!kept || item.analyzedAt > kept.analyzedAt) latest.set(key, item);
  }
  return [...latest.values()].sort((a, b) => b.analyzedAt.localeCompare(a.analyzedAt));
}

/** 통계용 채점 목록 — `scoredAnalyses` 를 하루 1건으로 묶은 것 */
export function dailyScoredAnalyses(limit = 500): ScoredAnalysis[] {
  return onePerDay(scoredAnalyses(limit));
}

function direction(signal: string): 'up' | 'down' | 'flat' {
  const upper = signal.toUpperCase();
  if (upper.includes('BUY')) return 'up';
  if (upper.includes('SELL')) return 'down';
  return 'flat';
}

function score(signal: string, changePercent: number): Outcome {
  const want = direction(signal);
  if (want === 'up') return changePercent > 0 ? 'correct' : 'incorrect';
  if (want === 'down') return changePercent < 0 ? 'correct' : 'incorrect';
  return Math.abs(changePercent) <= FLAT_BAND_PERCENT ? 'correct' : 'incorrect';
}

function scoreOne(base: Omit<ScoredAnalysis, 'priceAfter' | 'changePercent' | 'outcome'>): ScoredAnalysis {
  const after = base.priceAtAnalysis ? priceAfter(base.symbol, base.analyzedAt) : null;
  if (!after || !base.priceAtAnalysis) {
    return { ...base, priceAfter: null, changePercent: null, outcome: 'pending' };
  }
  const changePercent = ((after - base.priceAtAnalysis) / base.priceAtAnalysis) * 100;
  return { ...base, priceAfter: after, changePercent, outcome: score(base.signal, changePercent) };
}

/** Claude(수동)와 Gemini(자동) 분석을 하나의 채점된 목록으로 */
export function scoredAnalyses(limit = 500): ScoredAnalysis[] {
  ensureGeminiSchema(); // prompt_version 칼럼이 없는 옛 DB 에서도 SELECT 가 깨지지 않게
  const db = getDb();

  const gemini = (
    db
      .prepare(
        `SELECT id, symbol, created_at, signal, confidence, price_at_analysis, prompt_version, trigger
           FROM gemini_analysis ORDER BY created_at DESC LIMIT ?`,
      )
      .all(limit) as GeminiRow[]
  ).map((row) =>
    scoreOne({
      id: row.id,
      source: 'gemini',
      symbol: row.symbol,
      analyzedAt: row.created_at,
      signal: row.signal,
      confidence: row.confidence,
      priceAtAnalysis: row.price_at_analysis,
      promptVersion: row.prompt_version ?? LEGACY_PROMPT_VERSION,
      trigger: triggerOf(row.trigger ?? ''),
    }),
  );

  const claude = (
    db
      .prepare(
        `SELECT id, symbol, analyzed_at, verdict, confidence, price_at_analysis
           FROM analysis_history ORDER BY analyzed_at DESC LIMIT ?`,
      )
      .all(limit) as ClaudeRow[]
  )
    .filter((row) => row.verdict)
    .map((row) =>
      scoreOne({
        id: row.id,
        source: 'claude',
        symbol: row.symbol,
        analyzedAt: row.analyzed_at,
        signal: String(row.verdict).toUpperCase(),
        // Claude 쪽 신뢰도는 high/medium/low 텍스트라 대략의 수치로 옮긴다
        confidence:
          row.confidence === 'high' ? 0.8 : row.confidence === 'medium' ? 0.6 : row.confidence === 'low' ? 0.4 : null,
        priceAtAnalysis: row.price_at_analysis,
        promptVersion: null,
      }),
    );

  return [...gemini, ...claude].sort((a, b) => b.analyzedAt.localeCompare(a.analyzedAt));
}

export interface AccuracyStats {
  /** 묶기 전 원본 분석 수 */
  rawTotal: number;
  /** 하루 1건으로 묶은 뒤의 수 — 아래 숫자는 전부 이것 기준이다 */
  total: number;
  scored: number;
  pending: number;
  accuracy: number | null;
  bySignal: Record<string, { scored: number; correct: number; accuracy: number | null }>;
}

function summarize(raw: ScoredAnalysis[]): AccuracyStats {
  const items = onePerDay(raw);
  const scored = items.filter((item) => item.outcome !== 'pending');
  const correct = scored.filter((item) => item.outcome === 'correct').length;
  const bySignal: AccuracyStats['bySignal'] = {};

  for (const item of scored) {
    const bucket = (bySignal[item.signal] ??= { scored: 0, correct: 0, accuracy: null });
    bucket.scored++;
    if (item.outcome === 'correct') bucket.correct++;
  }
  for (const bucket of Object.values(bySignal)) {
    bucket.accuracy = bucket.scored ? (bucket.correct / bucket.scored) * 100 : null;
  }

  return {
    rawTotal: raw.length,
    total: items.length,
    scored: scored.length,
    pending: items.length - scored.length,
    accuracy: scored.length ? (correct / scored.length) * 100 : null,
    bySignal,
  };
}

/** 에이전트 개인별 적중률 — 누가 쓸모 있는지 본다 */
export interface AgentAccuracy {
  role: string;
  label: string;
  scored: number;
  correct: number;
  accuracy: number | null;
}

function agentAccuracy(): AgentAccuracy[] {
  ensureGeminiSchema();
  const db = getDb();
  const rows = onePerDay(
    (
      db
        .prepare(`SELECT symbol, created_at, price_at_analysis, agents, prompt_version FROM gemini_analysis`)
        .all() as AgentsRow[]
    ).map((row) => ({ ...row, analyzedAt: row.created_at, promptVersion: row.prompt_version ?? LEGACY_PROMPT_VERSION })),
  );

  const table = new Map<string, AgentAccuracy>();

  for (const row of rows) {
    if (!row.price_at_analysis) continue;
    const after = priceAfter(row.symbol, row.created_at);
    if (!after) continue;
    const changePercent = ((after - row.price_at_analysis) / row.price_at_analysis) * 100;

    let agents: Partial<AgentOpinion>[] = [];
    try {
      agents = JSON.parse(row.agents) as Partial<AgentOpinion>[];
    } catch {
      continue;
    }
    for (const agent of agents) {
      if (!agent?.role || agent.error) continue;
      const entry = table.get(agent.role) ?? {
        role: agent.role,
        label: agent.label ?? agent.role,
        scored: 0,
        correct: 0,
        accuracy: null,
      };
      entry.scored++;
      if (agent.vote && score(agent.vote, changePercent) === 'correct') entry.correct++;
      table.set(agent.role, entry);
    }
  }

  return [...table.values()].map((entry) => ({
    ...entry,
    accuracy: entry.scored ? (entry.correct / entry.scored) * 100 : null,
  }));
}

/** 같은 종목·같은 날 두 AI 가 모두 분석한 건만 짝지어 비교한다 */
export interface PairedItem {
  symbol: string;
  date: string;
  claude: ScoredAnalysis;
  gemini: ScoredAnalysis;
  /** 방향이 같은지 */
  agreed: boolean;
}

function pairedComparison(items: ScoredAnalysis[]): {
  pairs: PairedItem[];
  agreementRate: number | null;
  claudeAccuracy: number | null;
  geminiAccuracy: number | null;
} {
  const key = (item: ScoredAnalysis) => `${item.symbol}|${item.analyzedAt.slice(0, 10)}`;
  const claudeByKey = new Map<string, ScoredAnalysis>();
  for (const item of items) if (item.source === 'claude') claudeByKey.set(key(item), item);

  const pairs: PairedItem[] = [];
  for (const item of items) {
    if (item.source !== 'gemini') continue;
    const claude = claudeByKey.get(key(item));
    if (!claude) continue;
    pairs.push({
      symbol: item.symbol,
      date: item.analyzedAt.slice(0, 10),
      claude,
      gemini: item,
      agreed: direction(claude.signal) === direction(item.signal),
    });
  }

  const rate = (list: ScoredAnalysis[]) => {
    const scored = list.filter((item) => item.outcome !== 'pending');
    return scored.length
      ? (scored.filter((item) => item.outcome === 'correct').length / scored.length) * 100
      : null;
  };

  return {
    pairs,
    agreementRate: pairs.length ? (pairs.filter((p) => p.agreed).length / pairs.length) * 100 : null,
    claudeAccuracy: rate(pairs.map((p) => p.claude)),
    geminiAccuracy: rate(pairs.map((p) => p.gemini)),
  };
}

/** Gemini 프롬프트 버전별 통계 — 버전을 바꾸면 "좋아졌나" 를 이 줄로 비교한다 */
export function byPromptVersion(items: ScoredAnalysis[]): Record<string, AccuracyStats> {
  const out: Record<string, AccuracyStats> = {};
  const versions = [...new Set(items.filter((i) => i.source === 'gemini').map((i) => i.promptVersion ?? LEGACY_PROMPT_VERSION))].sort();
  for (const v of versions) {
    out[v] = summarize(items.filter((i) => i.source === 'gemini' && (i.promptVersion ?? LEGACY_PROMPT_VERSION) === v));
  }
  return out;
}

/**
 * 출처별 (v2.30.0, Gemini 만) — 같은 종목·같은 날 묶기도 **출처별로** 한다(버전별과 같은 방식: 그 출처의 행만 모아 `summarize`).
 * 한 출처의 하루 묶기가 다른 출처의 기록을 덮지 않게 하려는 것이다. 채점·전체·버전별 숫자는 바뀌지 않는다.
 */
export function byTrigger(items: ScoredAnalysis[]): Partial<Record<GeminiTrigger, AccuracyStats>> {
  const out: Partial<Record<GeminiTrigger, AccuracyStats>> = {};
  for (const t of ['auto', 'scheduled', 'manual'] as const) {
    const subset = items.filter((i) => i.source === 'gemini' && i.trigger === t);
    if (subset.length) out[t] = summarize(subset);
  }
  return out;
}

export function accuracyReport() {
  const items = scoredAnalyses();
  return {
    horizonDays: HORIZON_DAYS,
    scoringRule: SCORING_RULE,
    flatBandPercent: FLAT_BAND_PERCENT,
    geminiByVersion: byPromptVersion(items),
    claude: summarize(items.filter((item) => item.source === 'claude')),
    gemini: summarize(items.filter((item) => item.source === 'gemini')),
    agents: agentAccuracy(),
    paired: pairedComparison(onePerDay(items)),
    // 목록은 원본 그대로 보여 준다 — 묶는 것은 통계뿐이다
    items: items.slice(0, 200),
  };
}
