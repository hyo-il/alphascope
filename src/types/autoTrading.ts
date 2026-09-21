/**
 * 계좌별 자동매매 (1단계 — 백엔드).
 *
 * 전역 설정 하나로 돌던 자동매매를 **계좌마다 독립**으로 바꾼다.
 * 단기 계좌와 스윙 계좌에 서로 다른 전략을 동시에 걸 수 있어야 하기 때문이다.
 *
 * ⚠️ 모의 계좌(SQLite)만 건드린다. 실제 주문은 어떤 경로로도 나가지 않는다.
 */

import type { InvestmentHorizon } from '../services/analysis/horizons';

/** ai = Gemini 신호로 판단 / rule = 지표 규칙으로 판단 */
export type StrategyMode = 'ai' | 'rule';

/**
 * 규칙형 전략 파라미터.
 *
 * 기본값은 "골든크로스 또는 과매도 반등에 사고, 데드크로스 또는 과열에 판다" 이다.
 * 지표를 늘리기보다 **두 축(추세 전환 · 과열/과매도)** 으로 좁혀 둔다 — 조건이 많아질수록
 * 어떤 이유로 샀는지 설명하기 어려워지고, 거래내역의 사유 문자열도 읽히지 않는다.
 */
export interface RuleConfig {
  /** 단기 이동평균 (기본 5) */
  maShort: number;
  /** 장기 이동평균 (기본 20) */
  maLong: number;
  /** 이 값 이하에서 반등하면 매수 (기본 30) */
  rsiBuyBelow: number;
  /** 이 값 이상이면 매도 (기본 70) */
  rsiSellAbove: number;
  /** 이동평균 교차를 매수 조건으로 쓸지 */
  useMaCross: boolean;
  /** RSI 를 매수·매도 조건으로 쓸지 */
  useRsi: boolean;
}

/** 계좌 하나의 자동매매 설정 */
export interface AccountStrategy {
  accountId: number;
  enabled: boolean;
  mode: StrategyMode;
  /** 자동매매 대상 종목 */
  symbols: string[];

  // ── 공통 리스크 ────────────────────────────────
  /** 한 종목에 넣을 총자산 비중(%) */
  positionSizePercent: number;
  /** 동시에 보유할 최대 종목 수 (이미 보유한 종목의 추가 매수는 막지 않는다) */
  maxPositions: number;
  /** 매수 판단 주기(분). 청산 검사는 이 주기와 무관하게 매 틱 돈다 */
  intervalMinutes: number;
  /** 미국 정규장에만 돌릴지 */
  marketHoursOnly: boolean;

  /**
   * 하드 손절(%, 양수). 평균 매수가 대비 이만큼 빠지면 **즉시 전량 청산**한다.
   * AI·규칙 판단보다 먼저 검사하는 안전망이라 분석 주기를 기다리지 않는다.
   */
  hardStopLossPercent: number;
  /** 트레일링 스톱 사용 여부 */
  trailingStopEnabled: boolean;
  /** 보유 중 고점 대비 이만큼 하락하면 청산(%, 양수) */
  trailingStopPercent: number;

  // ── AI형 ───────────────────────────────────────
  buySignal: 'BUY' | 'STRONG_BUY';
  buyMinConfidence: number;
  sellSignal: 'SELL' | 'STRONG_SELL';
  sellMinConfidence: number;
  horizon: InvestmentHorizon;

  // ── 규칙형 ─────────────────────────────────────
  rule: RuleConfig;
}

/** 계좌별 실행 상태 — 화면(2단계)이 "지금 돌고 있나" 를 보여 주는 데 쓴다 */
export interface AccountStrategyStatus {
  accountId: number;
  enabled: boolean;
  mode: StrategyMode;
  /** 지금 이 계좌를 처리 중인지 */
  running: boolean;
  lastRunAt: string | null;
  /** 다음 매수 판단 시각 (청산 검사는 이와 무관하게 매 틱 돈다) */
  nextRunAt: string | null;
  lastError: string | null;
  /** 이 계좌가 오늘 쓴 Gemini 호출 수 (규칙형은 0) */
  callsToday: number;
  /**
   * 지금 돌 수 없는 이유 — 화면이 그대로 띄운다.
   * 예: "GEMINI_API_KEY 가 없어 AI형을 쓸 수 없습니다"
   */
  blockedReason: string | null;
}

/** 자동매매가 한 바퀴 돈 결과 (수동 실행 응답) */
export interface AutoTradeRunResult {
  accountId: number;
  /** 판단한 종목 수 */
  evaluated: number;
  /** 실제로 낸 주문 수 */
  ordered: number;
  /** 종목별 판단 근거 — 주문이 안 나간 이유도 포함한다 */
  notes: { symbol: string; action: 'BUY' | 'SELL' | 'HOLD'; reason: string; orderId: number | null }[];
  errors: string[];
  skipped: string | null;
}

export const DEFAULT_RULE: RuleConfig = {
  maShort: 5,
  maLong: 20,
  rsiBuyBelow: 30,
  rsiSellAbove: 70,
  useMaCross: true,
  useRsi: true,
};

/**
 * 계좌를 새로 잡을 때의 기본값.
 *
 * 하드 손절 -7% 는 **안전망이지 전략이 아니다** — 한 종목이 총자산의 10%(기본 비중)이므로
 * 한 번 걸려도 전체 손실은 0.7% 선이다. 최대 5종목이면 동시에 다 걸려도 3.5% 다.
 */
export function defaultStrategy(accountId: number): AccountStrategy {
  return {
    accountId,
    enabled: false,
    mode: 'ai',
    symbols: [],

    positionSizePercent: 10,
    maxPositions: 5,
    intervalMinutes: 60,
    marketHoursOnly: true,

    hardStopLossPercent: 7,
    trailingStopEnabled: false,
    trailingStopPercent: 8,

    buySignal: 'BUY',
    buyMinConfidence: 0.7,
    sellSignal: 'SELL',
    sellMinConfidence: 0.7,
    horizon: 'swing',

    rule: { ...DEFAULT_RULE },
  };
}
