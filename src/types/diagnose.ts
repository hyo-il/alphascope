/**
 * 진단 리포트 — 서버(`server/diagnose`)와 화면(`components/diagnose`)이 함께 쓰는 형태.
 * 요약(`summary`)은 카드 네 장, 상세(`detail`)는 접이식 표로 그린다.
 * 화면은 **JSON 에서** 표를 그린다 — 마크다운을 HTML 로 바꾸지 않는다.
 */

export interface DiagnoseSummary {
  server: string;
  stamp: string;
  createdAt: string;
  elapsed: number;
  quick: boolean;
  symbols: string[];
  source: string;
  profile: string;
  swing: {
    /** 평가한 날 수 (종목 × 일) */
    replayDays: number;
    /** 되돌려 본 거래일 수 (120, --quick 은 60) */
    window: number;
    buyTotal: number;
    buyRate: number;
    errors: number;
    /** BUY 날 뒤 평균 수익률(전 종목 합산) */
    forward: { d5: number | null; d10: number | null; d20: number | null };
    positive20: number;
    withBuy: number;
    weak: boolean;
    conclusion: string;
  };
  target: {
    avgHit: number | null;
    avgExp: number | null;
    spyHit: number | null;
    spyExp: number | null;
    n: number;
    weak: boolean;
    conclusion: string;
  };
  surge: {
    cases: number;
    hitRate: number;
    baseline: number;
    edge: number;
    chase: { n: number; d1: number; d3: number; d5: number; d10: number; up5: number; down5: number };
    weak: boolean;
    conclusion: string;
  };
  ai: {
    /** 묶기 전 원본 분석 수 */
    raw: number;
    /** 같은 종목·같은 날을 1건으로 묶은 뒤 */
    total: number;
    judged: number;
    rate: number;
    baseline: number;
    trades: { n: number; winRate: number; avgPnl: number };
    weak: boolean;
    conclusion: string;
  };
}

export interface DiagnoseListItem {
  id: number;
  createdAt: string;
  server: string;
  summary: DiagnoseSummary;
}

export interface DiagnoseProgress {
  running: boolean;
  step: number;
  total: number;
  label: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  /** 끝났으면 저장된 리포트 id */
  reportId: number | null;
}

// ── 상세 (서버 `report.ts` 의 JSON 그대로 — 화면이 쓰는 칸만 적는다) ──

export interface DiagnoseFreqRow {
  target: number;
  stop: number;
  horizon: number;
  samples: number;
  hitTarget: number;
  hitStop: number;
  neither: number;
  expectancy: number;
}

export interface DiagnoseDetail {
  today: {
    symbol: string;
    grade: string;
    score: number;
    conditions: Record<string, { score: number; max: number; checks: string[] }>;
    numbers: Record<string, string>;
    rejection: string | null;
    missing: string[];
    error?: string;
  }[];
  replay: {
    symbol: string;
    days: number;
    grades: Record<string, number>;
    buyDates: string[];
    rrDemoted: number;
    forward: { d5: number[]; d10: number[]; d20: number[] };
    lastBarChecked: string | null;
  }[];
  freq: Record<string, { rows: DiagnoseFreqRow[]; atr: number | null }>;
  surge: {
    cases: {
      symbol: string;
      asOf: string;
      surgeCount: number;
      regularity: number;
      avgInterval: number;
      predicted: string;
      hit: boolean;
      stale: boolean;
    }[];
    hitRate: number;
    baseline: number;
    edge: number;
    byRegularity: { band: string; n: number; hit: number; base: number }[];
    chase: DiagnoseSummary['surge']['chase'];
    staleCount: number;
  };
  gemini: {
    /** 채점 규칙 문구 — v2.15.0 이전 리포트에는 없다 */
    rule?: string;
    /** 프롬프트 버전별 (Gemini) — v2.15.0 이전 리포트에는 없다 */
    byVersion?: { version: string; total: number; judged: number; rate: number | null }[];
    raw: number;
    total: number;
    judged: number;
    correct: number;
    rate: number;
    bySignal: { signal: string; n: number; correct: number; rate: number }[];
    byConfidence: { band: string; n: number; rate: number }[];
    baselineUp5: number;
  };
}
