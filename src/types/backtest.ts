/**
 * 3년 백테스트 (v2.37.0, 「실험실 > 백테스트」) — 서버 `server/autoTrading/ruleResearch.ts` 와 화면이 같은 모양을 쓴다.
 * 숫자는 모두 % (수수료 왕복 0.30%p 반영). "1년 전체" = 그 구간에서 이 방법으로 거래를 이어 붙인 복리 수익률.
 */
import type { RuleChoice } from './ruleChoices';

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

export interface BacktestSummary {
  createdAt: string;
  universeAsOf: string;
  symbols: number;
  methods: { id: BacktestMethodId; title: string; verdict: BacktestVerdictKind }[];
}

export interface BacktestListItem {
  id: number;
  createdAt: string;
  server: string;
  summary: BacktestSummary;
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
}

export const BACKTEST_SECTORS = ['기술', '금융', '헬스케어', '산업재', '경기소비재', '필수소비재', '에너지'] as const;
