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
import type { AgentOpinion } from '../../src/types/gemini';

/** 채점 기준: 스윙 트레이딩이므로 5 거래일 뒤를 본다 */
const HORIZON_DAYS = 5;
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
}

export interface ScoredAnalysis {
  id: number;
  source: 'claude' | 'gemini';
  symbol: string;
  analyzedAt: string;
  signal: string;
  confidence: number | null;
  priceAtAnalysis: number | null;
  priceAfter: number | null;
  changePercent: number | null;
  outcome: Outcome;
}

/** 분석 시점으로부터 HORIZON_DAYS 거래일 뒤 종가 */
function priceAfter(symbol: string, analyzedAt: string): number | null {
  const candles = loadCandles(symbol, '1d', 2000);
  const at = Date.parse(analyzedAt);
  if (!Number.isFinite(at)) return null;
  const index = candles.findIndex((candle) => candle.timestamp >= at);
  if (index < 0) return null;
  const target = candles[index + HORIZON_DAYS];
  return target ? target.close : null; // 아직 5봉이 안 쌓였으면 pending
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
  const db = getDb();

  const gemini = (
    db
      .prepare(
        `SELECT id, symbol, created_at, signal, confidence, price_at_analysis
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
      }),
    );

  return [...gemini, ...claude].sort((a, b) => b.analyzedAt.localeCompare(a.analyzedAt));
}

export interface AccuracyStats {
  total: number;
  scored: number;
  pending: number;
  accuracy: number | null;
  bySignal: Record<string, { scored: number; correct: number; accuracy: number | null }>;
}

function summarize(items: ScoredAnalysis[]): AccuracyStats {
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
  const db = getDb();
  const rows = db
    .prepare(`SELECT symbol, created_at, price_at_analysis, agents FROM gemini_analysis`)
    .all() as AgentsRow[];

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

export function accuracyReport() {
  const items = scoredAnalyses();
  return {
    horizonDays: HORIZON_DAYS,
    flatBandPercent: FLAT_BAND_PERCENT,
    claude: summarize(items.filter((item) => item.source === 'claude')),
    gemini: summarize(items.filter((item) => item.source === 'gemini')),
    agents: agentAccuracy(),
    paired: pairedComparison(items),
    items: items.slice(0, 200),
  };
}
