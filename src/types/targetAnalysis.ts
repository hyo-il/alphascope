/** 목표 도달 가능성 분석 (v2.24.0) — 서버 `server/gemini/targetAnalysis.ts` 의 응답 모양 */

export type TargetOutcome = 'target' | 'stop' | 'neither';

export interface TargetAnalysisRecord {
  id: number;
  symbol: string;
  createdAt: string;
  /** 분석 기준이 된 마지막 확정 종가일 */
  baseDate: string;
  entryPrice: number;
  targetPct: number;
  stopPct: number;
  days: number;
  pTarget: number;
  pStop: number;
  pNeither: number;
  normalized: boolean;
  summary: string;
  reasons: string[];
  risks: string[];
  agents: { role: string; label: string; pTarget: number; pStop: number; pNeither: number; summary: string; error: string | null }[];
  base: { target: number; stop: number; neither: number; expectancy: number; samples: number } | null;
  promptVersion: string;
  model: string;
  tokens: number;
  outcome: TargetOutcome | null;
  outcomeDate: string | null;
  dueDate: string;
}

export interface TargetStats {
  scored: number;
  aiHit: number;
  baseHit: number;
  aiRate: number | null;
  baseRate: number | null;
  weak: boolean;
  /** 묶기 전 채점된 원본 수 (v2.30.0 — 옛 서버면 없다) */
  rawScored?: number;
}

export interface TargetProgress {
  running: boolean;
  total: number;
  done: number;
  current: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  input: { targetPct: number; stopPct: number; days: number } | null;
  results: { symbol: string; id: number | null; error: string | null }[];
  rateLimited: boolean;
  skipped: string[];
}

/** 입력 범위 — 서버 검사(`TARGET_LIMITS`)와 같아야 한다 */
export const TARGET_INPUT_LIMITS = { targetPct: [0.5, 50], stopPct: [0.5, 30], days: [2, 120] } as const;
export const TARGET_MAX_SYMBOLS = 5;
/** 종목당 Gemini 호출 수 (에이전트 4 + 의장 1) */
export const CALLS_PER_SYMBOL = 5;
