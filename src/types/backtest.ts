/**
 * 백테스트 (「실험실 > 백테스트」) — 서버 `server/autoTrading/ruleResearch.ts` 와 화면이 같은 모양을 쓴다.
 * 숫자는 모두 % (수수료 왕복 0.30%p 반영). "1년 전체" = 그 구간에서 이 방법으로 거래를 이어 붙인 복리 수익률.
 *
 * 기록은 두 종류다 (v2.38.0, `kind`):
 * - `fixed` — v2.37.0 「미리 정한 시험」(사전 등록 3년, `npm run research:rule`). 화면에서는 **읽기만** 한다. 옛 행(kind 없음)도 이것.
 * - `custom` — 사용자가 고른 종목·조건의 시험. **판정 배지 없음**(조건을 바꿔 보는 화면이라), 거래가 적으면 「결론 내기 어려움」 만.
 */
import type { RuleChoice } from './ruleChoices';
import type { RuleConfig } from './autoTrading';

export type BacktestMethodId = RuleChoice['id'];
export type BacktestVerdictKind = 'good' | 'bad' | 'hold';

/** 구간 하나(1년) × 방법 하나의 종목 평균(동일 가중) */
export interface BacktestSegmentRow {
  segment: number; // 1·2·3
  from: string;
  to: string;
  symbols: number;
  /** 이 방법 1년 전체 */
  avgRule: number | null;
  /** 그냥 들고 있기 1년(구간 첫날 시가 → 마지막 종가) */
  avgHold: number | null;
  /** 아무 날이나 사고팔기(같은 횟수·같은 보유일, 200번 평균) */
  avgRandom: number | null;
  /** 한 번 사고팔 때 평균 */
  avgTradeReturn: number | null;
  /** 이긴 거래 비율 */
  avgWinRate: number | null;
  avgTrades: number | null;
  /** 이 구간 거래 10회 미만 종목 수 */
  weakSymbols: number;
  /** 종목 평균 (이 방법 − 들고 있기), (이 방법 − 아무 날이나) */
  diffHold: number | null;
  diffRandom: number | null;
}

export interface BacktestCheck {
  /** ① 3구간 중 차이 > 0 인 구간 수 */
  positiveSegments: number;
  /** ② 3구간을 복리로 이은 종목별 차이의 평균과 부트스트랩 95% 구간 */
  mean: number | null;
  ciLow: number | null;
  ciHigh: number | null;
  /** ③ 3년 합계 거래 10회 이상 종목 / 전체 */
  enoughSymbols: number;
  symbols: number;
  verdict: BacktestVerdictKind;
  /** 판정과 같은 값에서 만든 비교식(툴팁) */
  why: string;
}

export interface BacktestMethodResult {
  id: BacktestMethodId;
  title: string;
  segments: BacktestSegmentRow[];
  vsHold: BacktestCheck;
  vsRandom: BacktestCheck;
  /** 두 기준선 모두 「좋음」 일 때만 좋음 · 어느 하나라도 「기준선 이하」 면 기준선 이하 · 그 밖 판단 보류 */
  verdict: BacktestVerdictKind;
  why: string;
}

export interface BacktestSectorRow {
  sector: string;
  symbols: number;
  /** 5종목 미만 — 숫자에 색을 칠하지 않는다 */
  weak: boolean;
  /** 방법별: 3년(복리로 이은 3구간) 이 방법 − 들고 있기 의 종목 평균 */
  byMethod: Record<BacktestMethodId, number | null>;
}

export interface BacktestSymbolRow {
  symbol: string;
  name: string | null;
  sector: string;
  error?: string;
  byMethod: Partial<Record<BacktestMethodId, { rule3y: number; hold3y: number | null; random3y: number | null; trades: number }>>;
}

export interface BacktestReport {
  /** v2.38.0 부터 적는다 — 없으면 fixed */
  kind?: 'fixed';
  version: string; // 사전 등록 판
  universeAsOf: string;
  segments: { segment: number; from: string; to: string }[];
  conditions: { stopLossPercent: number; trailing: false; costPct: number; fill: string; days: number; segmentDays: number };
  targets: {
    included: { symbol: string; name: string | null; sector: string }[];
    outOfSector: { symbol: string; name: string | null; sector: string }[];
    unknown: { symbol: string; name: string | null }[];
  };
  methods: BacktestMethodResult[];
  sectors: BacktestSectorRow[];
  symbols: BacktestSymbolRow[];
  leakCheck: { symbol: string; bars: number; ok: boolean };
  measure: { ms: number; indicatorCalls: number; rssMaxMb: number; symbols: number };
  computedAt: string;
}

export interface BacktestFixedSummary {
  /** 옛 행에는 없다 — 없으면 fixed 로 읽는다 */
  kind?: 'fixed';
  createdAt: string;
  universeAsOf: string;
  symbols: number;
  methods: { id: BacktestMethodId; title: string; verdict: BacktestVerdictKind }[];
}

export interface BacktestCustomSummary {
  kind: 'custom';
  createdAt: string;
  /** 계산한 종목 수(뺀 종목 제외) / 고른 종목 수 */
  symbols: number;
  requested: number;
  years: BacktestYears;
  /** v2.39.0 부터 조건 배열. 옛 행(조건 하나를 펼친 모양)은 읽을 때 `normalizeBacktestInput` 이 조건 A 하나로 바꾼다 */
  input: BacktestInput;
  /** 같은 날 같은 입력이면 다시 계산하지 않는다 — 그 비교 키 */
  inputKey: string;
  /** 조건 A 의 기간 전체 종목 평균 · 들고 있기 */
  rule: number | null;
  hold: number | null;
}

export type BacktestSummary = BacktestFixedSummary | BacktestCustomSummary;

export const isCustomSummary = (s: BacktestSummary): s is BacktestCustomSummary => s.kind === 'custom';

export interface BacktestListItem {
  id: number;
  createdAt: string;
  server: string;
  summary: BacktestSummary;
}

// ── 내가 고른 종목 · 내가 정한 조건 (v2.38.0) · 조건 비교·MDD·Profit Factor·익절 (v2.39.0) ──────────

export type BacktestYears = 1 | 2 | 3;
export const BACKTEST_YEARS: BacktestYears[] = [1, 2, 3];

export type ConditionLabel = 'A' | 'B' | 'C';
export const CONDITION_LABELS: ConditionLabel[] = ['A', 'B', 'C'];
/**
 * 화면 이름 (v2.40.0) — 저장 데이터의 `label: 'A'|'B'|'C'` 는 그대로 두고 **화면에서만** 「방법 1·2·3」 으로 보인다(옛 히스토리도 같다).
 * AI 설명이 돌려주는 이름(A·B·C)도 이 함수로 바꿔 보인다.
 */
export const methodName = (label: ConditionLabel | string): string => `방법 ${({ A: 1, B: 2, C: 3 } as Record<string, number>)[label] ?? label}`;
/** 한 번에 비교할 수 있는 조건 수 */
export const MAX_CONDITIONS = 3;
/** 조건이 2개 이상일 때 고를 수 있는 종목 수 (조건 1개면 제한 없음) */
export const MAX_COMPARE_SYMBOLS = 20;

/** 조건 하나 — 자동매매 규칙형이 실제로 쓰는 것만(+ 익절, v2.39.0) */
export interface BacktestCondition {
  label: ConditionLabel;
  rule: RuleConfig;
  hardStopLossPercent: number;
  trailingStopEnabled: boolean;
  trailingStopPercent: number;
  takeProfitEnabled: boolean;
  takeProfitPercent: number;
}

/** 시험 입력 — 같은 종목·같은 기간에 조건 1~3개 */
export interface BacktestInput {
  symbols: string[];
  years: BacktestYears;
  conditions: BacktestCondition[];
}

export type BacktestExitName = 'signal' | 'stop' | 'take_profit' | 'trailing' | 'end';

/** MDD 가 가장 나쁜 종목 */
export interface WorstDrawdown {
  symbol: string;
  name: string | null;
  value: number;
}

/** 묶음 하나의 숫자(종목 평균, 동일 가중) — 요약과 구간 표가 같은 모양 */
export interface BacktestCustomStats {
  symbols: number;
  /** 이 방법 · 그냥 들고 있기 · 아무 날이나 사고팔기 (그 기간 전체) */
  rule: number | null;
  hold: number | null;
  random: number | null;
  /** 한 번 사고팔 때 평균 · 이긴 거래 % · 종목당 거래 횟수 */
  avgTradeReturn: number | null;
  winRate: number | null;
  avgTrades: number | null;
  /** 거래 10회 미만 종목 수 */
  weakSymbols: number;
  /**
   * MDD(최대 낙폭, %, 0 이하, v2.39.0) — 종목마다 일별 자산 곡선(들고 있는 날 종가 평가 · 안 들고 있는 날 현금 · 비용 반영 · 구간 복리)의 고점 대비 최대 하락, 그 종목 평균.
   * 20차 기록에는 없다(null).
   */
  mdd?: number | null;
  mddWorst?: WorstDrawdown | null;
  /**
   * Profit Factor(v2.39.0) = 모든 종목·모든 거래의 (+ 수익률 합) ÷ |− 수익률 합|. 손실 거래가 없거나 거래가 없으면 null(`profitFactorNote`).
   * ⚠️ 모의 계좌 성적의 「손익비」(평균수익 ÷ 평균손실)와 **다른 지표**다.
   */
  profitFactor?: number | null;
  profitFactorNote?: '손실 거래 없음' | '거래 없음' | null;
  /** 청산 이유 비율(%) — 신호·손절·익절·트레일링·기간 끝 */
  exits?: Record<BacktestExitName, number> | null;
}

export interface BacktestCustomSymbol {
  symbol: string;
  name: string | null;
  /** 모르면 null → 화면 「분야 미확인」 */
  sector: string | null;
  trades: number;
  winRate: number | null;
  avgReturn: number | null;
  /** 손절로 판 거래 비율 */
  stopRate: number | null;
  /** 기간 전체(구간 복리) */
  rule: number;
  hold: number | null;
  random: number | null;
  /** MDD(v2.39.0) — 이 조건 · 그냥 들고 있기 */
  mdd?: number | null;
  holdMdd?: number | null;
}

/** 조건 하나의 결과 */
export interface BacktestConditionResult {
  label: ConditionLabel;
  condition: BacktestCondition;
  summary: BacktestCustomStats & {
    /** 거래 10회 미만 종목이 절반 이상 — 숫자를 색칠하지 않는다 */
    hardToTell: boolean;
  };
  /** 구간별(2·3년일 때) */
  segmentRows: (BacktestCustomStats & { segment: number; from: string; to: string })[];
  symbols: BacktestCustomSymbol[];
}

/**
 * 「AI에게 결과 설명 듣기」·「AI에게 비교 설명 듣기」(v2.39.0 한 모양). 20차 설명(good/bad 한 벌)은 읽을 때 조건 A 로 바꾼다.
 */
export interface BacktestExplain {
  summary: string[];
  byCondition: { label: ConditionLabel; good: string[]; bad: string[] }[];
  cautions: string[];
  /** 입력에 없는 숫자를 써서 뺀 문장 수 */
  removed: number;
  promptVersion: string;
  model: string;
  createdAt: string;
}

export interface BacktestCustomReport {
  kind: 'custom';
  input: BacktestInput;
  /** 첫 종목의 구간 날짜(시장이 섞이면 종목마다 하루쯤 다를 수 있다) */
  segments: { segment: number; from: string; to: string }[];
  /** 조건마다 하나(입력 순서 A·B·C) */
  conditions: BacktestConditionResult[];
  /** 그냥 들고 있기(조건과 무관) — 기간 전체 평균·MDD */
  hold: { rule: number | null; mdd: number | null; mddWorst: WorstDrawdown | null };
  /** 계산하지 못한 종목과 이유 — 조용히 빼지 않는다 */
  excluded: { symbol: string; name: string | null; reason: string }[];
  leakCheck: { symbol: string; bars: number; ok: boolean };
  measure: { ms: number; indicatorCalls: number; rssMaxMb: number; symbols: number };
  computedAt: string;
  /** 한 번 받으면 기록에 함께 둔다(다시 열 때 Gemini 를 부르지 않는다) */
  explain?: BacktestExplain;
}

export type BacktestAnyReport = BacktestReport | BacktestCustomReport;
export const isCustomReport = (r: BacktestAnyReport): r is BacktestCustomReport => r.kind === 'custom';

/** `GET /api/backtest/universe` — ① 종목 고르기의 묶음 */
export interface BacktestUniverse {
  asOf: string;
  sectors: { sector: string; symbols: { symbol: string; name: string | null }[] }[];
  watchlist: { symbol: string; name: string | null; sector: string | null }[];
}

/** 「AI에게 조건 물어보기」 응답 — 범위 밖 값은 서버가 **버린다**(고치지 않는다) */
export interface BacktestAdvice {
  method: 'trend' | 'dip' | 'both' | 'custom' | null;
  /** 남은(범위 안) 제안 값만 */
  values: Partial<Pick<RuleConfig, 'maShort' | 'maLong' | 'rsiBuyBelow' | 'rsiSellAbove' | 'useMaCross' | 'useRsi'>> &
    Partial<Pick<BacktestCondition, 'hardStopLossPercent' | 'trailingStopEnabled' | 'trailingStopPercent' | 'takeProfitEnabled' | 'takeProfitPercent'>>;
  reasons: string[];
  cautions: string[];
  /** 범위 밖이라 뺀 값의 수와 그 이름 */
  dropped: string[];
  /** 종목이 30개를 넘어 분야별 평균으로 줄여 보냈는지 */
  summarized: boolean;
  /** 앞 1년 봉이 모자라 보내지 못한 종목 */
  excluded: { symbol: string; reason: string }[];
  /** 보낸 종목 수 */
  sent: number;
  promptVersion: string;
  model: string;
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
  /** 같은 날 같은 입력이라 계산하지 않고 저장된 결과를 돌려줬다 (v2.38.0) */
  reused?: boolean;
}

export const BACKTEST_SECTORS = ['기술', '금융', '헬스케어', '산업재', '경기소비재', '필수소비재', '에너지'] as const;
