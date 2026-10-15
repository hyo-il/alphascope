/**
 * 매수 판단 (v2.45.0 — 퀀트 다시 만들기 3단계). 서버 `server/buyJudge/*` 와 화면 `components/swing/BuyJudge*` 가 함께 쓴다.
 *
 * 화면 위에서 고른 「매매 규칙」 하나로 전용 목록의 종목을 판단한다 — 엔진 `evaluateRule`, 보유 없음(`held: false`).
 * 마감 판단은 계좌 자동매매와 **같은 함수**(`server/rules/judge.ts`)라 같은 종목·날·규칙이면 같은 답이다.
 * ⚠️ 주문을 내지 않는다(예전 [모의 매수] 는 없앴다 — 손으로 사는 것은 차트의 빠른주문).
 */

/** 진입 방식 — 참고만(엔진이 실행에 쓰지 않는다). 예전 `types/swing.ts` 에서 옮겼다 */
export type EntryType = 'NOW' | 'PULLBACK' | 'BREAKOUT';
export const ENTRY_LABEL: Record<EntryType, string> = { NOW: '지금 매수', PULLBACK: '눌림 대기', BREAKOUT: '돌파 대기' };

/** 판단 — 마감 기준 엔진 결과 */
export type Verdict = 'buy' | 'below' | 'rr_block';
export const VERDICT_LABEL: Record<Verdict, string> = { buy: '사도 됨', below: '기준 미달', rr_block: '손익비 부족' };
/** 엔진 판단 코드 → 판단 */
export const verdictOf = (code: string): Verdict => (code === 'score_buy' ? 'buy' : code === 'rr_block' ? 'rr_block' : 'below');

/** 판단 기록 보관 기간 — 「사도 됨」 은 기간과 상관없이 남는다 */
export type Retention = '6m' | '1y' | '2y' | 'forever';
export const RETENTIONS: { id: Retention; label: string; days: number | null }[] = [
  { id: '6m', label: '6개월', days: 183 },
  { id: '1y', label: '1년', days: 365 },
  { id: '2y', label: '2년', days: 730 },
  { id: 'forever', label: '계속 보관', days: null },
];
export const DEFAULT_RETENTION: Retention = '1y';
export const isRetention = (v: unknown): v is Retention => RETENTIONS.some((r) => r.id === v);

export interface JudgeCondition {
  key: string;
  name: string;
  score: number;
  max: number;
  checks: { label: string; passed: boolean }[];
}

export interface JudgeReference {
  entryType: EntryType;
  entryPrice: number;
  stop: number;
  target1: number;
  target2: number;
  ratio: number;
  sizePercent: number;
}

/** 표 한 줄 — 지금 계산한 판단 */
export interface BuyJudgeRow {
  symbol: string;
  /** 마감 판단의 기준 봉 날짜(그 종목 시장 날짜) */
  basisDate: string | null;
  verdict: Verdict | null;
  code: string | null;
  score: number | null;
  maxScore: number | null;
  minScore: number | null;
  /** 켠 조건만 */
  conditions: JudgeCondition[];
  reference: JudgeReference | null;
  reason: string | null;
  /** 참고 점수 — 진행 중 봉(장중) 또는 마지막 가격까지 넣고 같은 엔진으로 한 번 더. **확정 아님** */
  refScore: number | null;
  refLabel: '장중' | '장 마감 가격' | null;
  warnings: string[];
  /** 판단하지 못한 이유(캔들 부족 · 오류) — 있으면 나머지는 비어 있다 */
  error: string | null;
}

export interface BuyJudgeState {
  ruleId: number | null;
  ruleName: string | null;
  symbols: string[];
  retention: Retention;
  rows: BuyJudgeRow[];
  computedAt: string;
}

/** 히스토리 ① — 「사도 됨」 기록과 그 뒤 수익률 */
export interface BoughtRecord {
  id: number;
  marketDate: string;
  symbol: string;
  ruleName: string;
  score: number;
  maxScore: number;
  /** 다음 거래일 시가에 사서 N거래일 뒤 종가, 왕복 비용 0.30%p 뺌. 아직 날이 안 지났으면 null */
  r5: number | null;
  r10: number | null;
  r20: number | null;
}

export interface BoughtStats {
  /** 성과가 나온 건수 */
  n5: number;
  n10: number;
  n20: number;
  avg5: number | null;
  avg10: number | null;
  avg20: number | null;
  /** 30개 미만이면 「표본 적음」 */
  smallSample: boolean;
}

/** 히스토리 ② — 종목별 「사지 않은 이유」 한 줄(최근 20거래일) */
export interface ReasonSummary {
  symbol: string;
  days: number;
  below: number;
  rrBlock: number;
  buy: number;
  /** 기준 미달인 날 가장 자주 만점에 못 미친 조건 */
  mostMissing: string | null;
}

export interface JudgeDay {
  marketDate: string;
  ruleName: string;
  verdict: Verdict;
  score: number;
  maxScore: number;
  minScore: number;
  reason: string;
}

export interface BuyJudgeHistory {
  bought: BoughtRecord[];
  stats: BoughtStats;
  reasons: ReasonSummary[];
  counts: { all: number; nonBuy: number };
}

/** 성과 계산의 비용 — 백테스트와 같은 값(`autoTrading/ruleBacktest` 의 `ROUND_TRIP_COST`, %p) */
export const OUTCOME_DAYS = [5, 10, 20] as const;
export const SMALL_SAMPLE = 30;
/** 「사지 않은 이유」 요약 기간(거래일) */
export const REASON_DAYS = 20;
