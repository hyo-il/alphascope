/**
 * 백테스트 (「퀀트 > 백테스트」) — 서버 `server/autoTrading/ruleResearch.ts` 와 화면이 같은 모양을 쓴다.
 * 숫자는 모두 % (수수료 왕복 0.30%p 반영). "1년 전체" = 그 구간에서 이 방법으로 거래를 이어 붙인 복리 수익률.
 *
 * 방법 하나 = 「매매 규칙」 하나(`ruleId`). 판단은 계좌와 같은 엔진(`evaluateRule`).
 * 시험할 때의 규칙 이름·내용을 기록에 함께 남긴다(나중에 규칙을 고쳐도 그때 조건이 남는다).
 * 판정 배지 없음(거래가 적으면 「결론 내기 어려움」 만).
 */
import type { RuleBody } from './tradingRule';

export interface BacktestCustomSummary {
  kind: 'custom';
  createdAt: string;
  symbols: number;
  requested: number;
  years: BacktestYears;
  input: BacktestInput;
  inputKey: string;
  rule: number | null;
  hold: number | null;
}

export type BacktestSummary = BacktestCustomSummary;

export interface BacktestListItem {
  id: number;
  createdAt: string;
  server: string;
  summary: BacktestSummary;
}

/** 기간 — 1·2·3년(252 완성 거래일씩) */
export type BacktestYears = 1 | 2 | 3;
export const BACKTEST_YEARS: BacktestYears[] = [1, 2, 3];

/** 방법 이름표 — 최대 3개. 화면에는 「방법 1·2·3」(`methodName`), 저장·API 는 A·B·C 그대로 */
export type ConditionLabel = 'A' | 'B' | 'C';
export const CONDITION_LABELS: ConditionLabel[] = ['A', 'B', 'C'];
export const methodName = (label: ConditionLabel | string): string => `방법 ${({ A: 1, B: 2, C: 3 } as Record<string, number>)[label] ?? label}`;
/** AI 설명 문장 속 「조건 A」·「방법 A」 → 「방법 1」 */
export const fixMethodNames = (text: string): string => text.replace(/(조건|방법)\s?([ABC])(?![A-Za-z])/g, (_m, _w, l: string) => methodName(l));
export const MAX_CONDITIONS = 3;
/** 방법이 2개 이상이면 종목은 이만큼까지 (계산 시간) */
export const MAX_COMPARE_SYMBOLS = 20;

/** 화면이 보내는 방법 — 규칙 id 만 */
export interface BacktestConditionRequest {
  label: ConditionLabel;
  ruleId: number;
}

/** 저장되는 방법 — 시험할 때의 규칙 이름·내용 */
export interface BacktestCondition {
  label: ConditionLabel;
  ruleId: number;
  ruleName: string;
  rule: RuleBody;
}

export interface BacktestInput {
  symbols: string[];
  years: BacktestYears;
  conditions: BacktestCondition[];
}

export interface BacktestRequest {
  symbols: string[];
  years: BacktestYears;
  conditions: BacktestConditionRequest[];
}

/** 판 이유 — 신호 · 손절 · 익절 · 트레일링 · 기간 끝 정리 */
export type BacktestExitName = 'signal' | 'stop' | 'take_profit' | 'trailing' | 'end';

export interface WorstDrawdown {
  symbol: string;
  name: string | null;
  value: number;
}

/** 사용자 시험 숫자 묶음 — 종목 평균(동일 가중) */
export interface BacktestCustomStats {
  symbols: number;
  rule: number | null;
  hold: number | null;
  random: number | null;
  avgTradeReturn: number | null;
  winRate: number | null;
  avgTrades: number | null;
  weakSymbols: number;
  /** 최대 낙폭(%, 음수) — 종목마다 일별 자산 곡선의 고점 대비 최대 하락 → 종목 평균 */
  mdd?: number | null;
  mddWorst?: WorstDrawdown | null;
  /** Profit Factor = (+ 수익률 합) ÷ |− 합| — 모든 종목·모든 거래 */
  profitFactor?: number | null;
  profitFactorNote?: '손실 거래 없음' | '거래 없음' | null;
  /** 판 이유 비율(%) */
  exits?: Record<BacktestExitName, number> | null;
}

export interface BacktestCustomSymbol {
  symbol: string;
  name: string | null;
  sector: string | null;
  trades: number;
  winRate: number | null;
  avgReturn: number | null;
  stopRate: number | null;
  rule: number;
  hold: number | null;
  random: number | null;
  mdd?: number | null;
  holdMdd?: number | null;
}

/** 방법 하나의 결과 */
export interface BacktestConditionResult {
  label: ConditionLabel;
  condition: BacktestCondition;
  summary: BacktestCustomStats & {
    /** 거래 10회 미만 종목이 절반 이상 — 「결론 내기 어려움」 */
    hardToTell: boolean;
  };
  segmentRows: (BacktestCustomStats & { segment: number; from: string; to: string })[];
  symbols: BacktestCustomSymbol[];
}

/** 「AI에게 결과 설명 듣기」 — 그 기록에 저장된다 */
export interface BacktestExplain {
  summary: string[];
  byCondition: { label: ConditionLabel; good: string[]; bad: string[] }[];
  cautions: string[];
  /** 입력에 없는 숫자가 들어 있어 뺀 문장 수 */
  removed: number;
  promptVersion: string;
  model: string;
  createdAt: string;
}

export interface BacktestCustomReport {
  kind: 'custom';
  input: BacktestInput;
  segments: { segment: number; from: string; to: string }[];
  conditions: BacktestConditionResult[];
  hold: { rule: number | null; mdd: number | null; mddWorst: WorstDrawdown | null };
  excluded: { symbol: string; name: string | null; reason: string }[];
  leakCheck: { symbol: string; bars: number; ok: boolean };
  measure: { ms: number; indicatorCalls: number; rssMaxMb: number; symbols: number };
  computedAt: string;
  explain?: BacktestExplain;
  spy?: { hold: number; from: string; to: string } | { error: string };
  /** 시장 필터 — 시장 기준 데이터가 없어 「시장 데이터 없음」 으로 사지 않은 기간이 있으면 한 줄씩(없으면 칸이 없다) */
  marketWarnings?: string[];
}

/** ① 종목 추가 창의 묶음 — 시총 상위 100 중 7분야 + 내 관심 목록 */
export interface BacktestUniverse {
  asOf: string;
  sectors: { sector: string; symbols: { symbol: string; name: string | null }[] }[];
  watchlist: { symbol: string; name: string | null; sector: string | null }[];
}

export interface BacktestProgress {
  running: boolean;
  done: number;
  total: number;
  current: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  error: string | null;
  engineDown: boolean;
  reportId: number | null;
  /** 같은 날 같은 입력이라 계산하지 않고 저장된 결과를 돌려줬다 */
  reused?: boolean;
}

export const BACKTEST_SECTORS = ['기술', '금융', '헬스케어', '산업재', '경기소비재', '필수소비재', '에너지'] as const;
