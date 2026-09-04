/** 급등 탐지 (Step 9) — 서버와 화면이 함께 쓰는 타입 */

/** 급등일 하나 */
export interface SurgeEvent {
  /** YYYY-MM-DD */
  date: string;
  open: number;
  close: number;
  /** 전일 종가 대비 변동률 (%) */
  changePercent: number;
  volume: number;
  /** 직전 20 거래일 평균 거래량 */
  avgVolume: number;
  /** 평균 대비 거래량 (%) */
  volumeRatio: number;
}

/** 급등 간격의 규칙성 */
export interface PeriodicityResult {
  isPeriodic: boolean;
  surgeCount: number;
  /** 급등일 사이의 간격(일) */
  intervals: number[];
  avgInterval: number;
  stdDeviation: number;
  /** 규칙성 점수 0~100 (표준편차가 평균 대비 작을수록 높다) */
  regularity: number;
  /** 급등 폭 평균 (%) */
  avgSurgePercent: number;
  lastSurgeDate: string | null;
  nextEstimatedDate: string | null;
  /** 다음 예상일까지 남은 일수 — 음수면 이미 지났다 */
  daysUntilNext: number | null;
  /** 예측 신뢰도 0~100 (규칙성 × 표본 수) */
  confidence: number;
}

/** 지금 급등 직전 신호가 있는지 */
export interface SurgeSignals {
  rsiOversold: boolean;
  volumeIncreasing: boolean;
  nearSupport: boolean;
  bollingerLower: boolean;
  macdCrossing: boolean;
  priceCompressed: boolean;
  nearCycleDate: boolean;
}

/** 화면에 그대로 적을 수 있는 신호별 설명 */
export interface SignalDetail {
  key: keyof SurgeSignals;
  label: string;
  /** 실제 수치 ("RSI(14): 42.3") */
  value: string;
  /** 판정 ("과매도" / "중립") */
  verdict: string;
  hit: boolean;
}

export type SurgeGrade = 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';

export interface SurgeEvaluation {
  symbol: string;
  name: string | null;
  price: number | null;
  periodicity: PeriodicityResult;
  currentSignals: SurgeSignals;
  signalDetails: SignalDetail[];
  /** 0~100 */
  surgeScore: number;
  grade: SurgeGrade;
  reason: string;
  surgeHistory: { date: string; changePercent: number }[];
  /** 분석에 쓴 일봉 수 — 표본이 적으면 화면에서 알린다 */
  candleCount: number;
  /** 이 종목에 실제로 적용한 급등 기준(%) 과 그 근거 */
  appliedThreshold: number;
  thresholdReason: string;
  marketCap: number | null;
  error?: string | null;
}

export type AnalysisPeriod = '3mo' | '6mo' | '1y';

/**
 * 급등 기준을 시가총액에 맞춰 자동으로 바꿀지.
 *
 * 대형주는 하루 3% 도 드물고 소형주는 5% 가 예사라, 하나의 기준으로 재면
 * 대형주는 급등이 아예 안 잡히고 소형주는 잡음이 쏟아진다.
 */
export type ThresholdMode = 'auto' | 'manual';

export interface SurgeSettings {
  /** 급등 판정: 하루 변동률(%) — thresholdMode 가 manual 일 때만 쓴다 */
  priceThreshold: number;
  thresholdMode: ThresholdMode;
  /** 급등 판정: 20일 평균 대비 거래량(%) */
  volumeThreshold: number;
  /** 주기적으로 보려면 최소 몇 번 급등해야 하는지 */
  minSurgeCount: number;
  analysisPeriod: AnalysisPeriod;
  /** 규칙성 하한 (%) — 표준편차가 평균의 (100-이 값)% 이하 */
  regularityThreshold: number;
  usePreset: boolean;
  useWatchlist: boolean;
  /** 토스 랭킹(거래량·등락률 상위)에서 종목 풀을 모을지 */
  useRanking: boolean;
}

/** 시가총액 구간별 급등 기준 (%) — 화면 설명과 서버 판정이 같은 표를 본다 */
export const MARKET_CAP_TIERS = [
  { label: '대형주', minCap: 100_000_000_000, threshold: 2 },
  { label: '중형주', minCap: 10_000_000_000, threshold: 3 },
  { label: '소형주', minCap: 0, threshold: 5 },
] as const;

/** 저장된 탐지 결과 한 줄 */
export interface SurgeDetection {
  id: number;
  detectedAt: string;
  symbol: string;
  name: string | null;
  surgeCount: number;
  avgInterval: number | null;
  stdDeviation: number | null;
  regularity: number | null;
  lastSurgeDate: string | null;
  nextEstimatedDate: string | null;
  daysUntilNext: number | null;
  surgeScore: number;
  grade: SurgeGrade;
  reason: string | null;
  signals: SurgeSignals | null;
  surgeHistory: { date: string; changePercent: number }[];
  priceAtDetection: number | null;
  priceAfter7d: number | null;
  priceAfter14d: number | null;
  priceAfter30d: number | null;
  actualSurged: boolean | null;
  actualSurgeDate: string | null;
  actualSurgePercent: number | null;
}

/** 탐지 진행 상황 — 화면이 "분석 중… 23/50" 으로 보여 준다 */
export interface SurgeProgress {
  running: boolean;
  total: number;
  done: number;
  /** 지금 조회 중인 종목 */
  current: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  found: number;
  error: string | null;
}
