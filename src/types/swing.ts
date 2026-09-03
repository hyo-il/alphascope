/** 스윙 투자 추천 (Step 10) — 서버와 화면이 함께 쓰는 타입 */

export type SwingGrade = 'STRONG' | 'BUY' | 'WATCH' | 'HOLD' | 'AVOID';
export type EntryType = 'NOW' | 'PULLBACK' | 'BREAKOUT';

/** 조건 하나의 채점 결과 */
export interface ConditionScore {
  score: number;
  max: number;
  /** 화면에 그대로 적는 근거 */
  details: string;
  /** 세부 체크 항목 (게이지 툴팁) */
  checks: { label: string; passed: boolean }[];
}

export interface SwingConditions {
  trend: ConditionScore;
  timing: ConditionScore;
  momentum: ConditionScore;
  volume: ConditionScore;
  riskReward: ConditionScore & { ratio: number };
}

export interface SwingRecommendation {
  symbol: string;
  name: string | null;
  currentPrice: number;

  score: number;
  grade: SwingGrade;
  conditions: SwingConditions;

  entry: {
    price: number;
    type: EntryType;
    reason: string;
    detailedReason: string;
  };

  targets: {
    target1: { price: number; percent: number; reason: string };
    target2: { price: number; percent: number; reason: string };
  };

  stopLoss: {
    price: number;
    reason: string;
    /** 매수가 대비 최대 손실률 (음수) */
    maxLossPercent: number;
  };

  position: {
    recommendedPercent: number;
    reason: string;
  };

  holdingPeriod: {
    min: number;
    max: number;
    reason: string;
  };

  warnings: string[];
  /** 이 조건이 깨지면 전략을 재검토한다 */
  invalidation: string;

  /** 추천하지 않는 종목의 한 줄 이유 (WATCH 이하) */
  rejection: string | null;
  /** 계산에 쓴 지표 스냅샷 — 나중에 "왜 이렇게 판단했나" 를 되짚기 위해 남긴다 */
  indicators: Record<string, number | null>;
  error?: string | null;
}

/** 저장된 추천 + 성과 */
export interface SwingRecord {
  id: number;
  analyzedAt: string;
  symbol: string;
  name: string | null;
  priceAtAnalysis: number;
  score: number;
  grade: SwingGrade;
  entryPrice: number | null;
  entryType: EntryType | null;
  entryReason: string | null;
  target1Price: number | null;
  target2Price: number | null;
  stopLossPrice: number | null;
  riskRewardRatio: number | null;
  recommendedPercent: number | null;
  priceAfter7d: number | null;
  priceAfter14d: number | null;
  priceAfter30d: number | null;
  target1Hit: boolean;
  target2Hit: boolean;
  stopLossHit: boolean;
  /** 'target1' | 'target2' | 'stop_loss' | 'open' | 'pending' */
  actualResult: string;
  actualReturn: number | null;
}

export interface SwingRunResult {
  analyzedAt: string;
  recommendations: SwingRecommendation[];
  /** 분석하지 못한 종목 (심볼 오류·데이터 부족 등) */
  failures: { symbol: string; error: string }[];
}
