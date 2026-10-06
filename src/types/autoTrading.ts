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

  // ── 신규 매수 안전장치 (v2.16.0) — 둘 다 새로 사는 것만 막는다. 손절·청산은 그대로 ──
  /**
   * 실적 발표 N 거래일 전부터 발표일까지 새로 사지 않는다. 0 = 끔. 기본 3 (앱의 출발값 — 검증 전).
   * 실적일은 `server/earningsCalendar.ts` 한 곳에서 읽는다.
   */
  earningsBlackoutDays: number;
  /**
   * 하루 동안 계좌 평가액이 N% 넘게 줄면 그 거래일은 새로 사지 않는다(킬 스위치). 0 = 끔(기본).
   * 기본을 끔으로 둔 이유: 사용자 모르게 기존 계좌 동작을 바꾸지 않는다. 권장값은 없다(근거 없음).
   */
  dailyLossLimitPercent: number;

  // ── AI형 ───────────────────────────────────────
  buySignal: 'BUY' | 'STRONG_BUY';
  buyMinConfidence: number;
  sellSignal: 'SELL' | 'STRONG_SELL';
  sellMinConfidence: number;
  horizon: InvestmentHorizon;

  // ── 규칙형 ─────────────────────────────────────
  rule: RuleConfig;
}

/**
 * 판단 **종류 코드** (v2.32.0) — 엔진이 판단할 때 이미 아는 것만 담는다.
 *
 * ⚠️ 화면은 사유 **문장**이 아니라 이 값으로 쉬운 말을 고른다(`utils/autoTradeExplain.ts` 한 곳).
 * 문장을 읽어 분기하면 문구를 다듬을 때마다 조용히 깨진다. 사유 문장은 그대로 남는다(거래내역·로그).
 * 옛 기록(v2.31.0 이전)에는 코드가 없다 — 그때는 문장만 보인다.
 * - 규칙형: golden · dead · rsi_rebound · rsi_hot · no_signal_buy(매수 조건 없음) · no_signal_hold(보유 유지)
 * - 공통: hard_stop · trailing · earnings_blackout · max_positions · daily_loss · not_enough_candles · error
 * - AI형: ai_buy · ai_sell · ai_hold · ai_low_confidence
 * - other: 위에 없는 경로(예산·현금 부족, "강력 신호만" 조건으로 건너뜀)
 */
export type DecisionCode =
  | 'golden'
  | 'dead'
  | 'rsi_rebound'
  | 'rsi_hot'
  | 'no_signal_buy'
  | 'no_signal_hold'
  | 'hard_stop'
  | 'trailing'
  | 'earnings_blackout'
  | 'max_positions'
  | 'daily_loss'
  | 'not_enough_candles'
  | 'error'
  | 'ai_buy'
  | 'ai_sell'
  | 'ai_hold'
  | 'ai_low_confidence'
  | 'other';

/** 「최근 판단」 한 줄 — `code` 는 v2.32.0 부터(옛 기록에는 없다) */
export interface DecisionNote {
  symbol: string;
  action: 'BUY' | 'SELL' | 'HOLD';
  reason: string;
  code?: DecisionCode;
}

/** 계좌별 실행 상태 — 화면(2단계)이 "지금 돌고 있나" 를 보여 주는 데 쓴다 */
/**
 * 자동매매가 멈춘 **종류**. 화면은 문구가 아니라 이 값으로 분기한다 —
 * 문구를 다듬을 때마다 화면 분기가 깨지면 안 된다.
 * - `market_closed` = 정상 대기 (장이 열리면 저절로 돈다)
 * - `config` = 사람이 고쳐야 하는 설정 문제
 */
export type BlockedKind = 'market_closed' | 'config' | 'server_off' | 'daily_loss' | null;

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
   * 예: "Gemini 키가 설정되지 않았습니다 — 규칙형으로 바꾸면 키 없이 동작합니다"
   */
  blockedReason: string | null;
  /** 멈춤의 종류 — 화면 분기는 문구가 아니라 **이 값**으로 한다 */
  blockedKind: BlockedKind;
  /**
   * 이 서버에서 자동매매 스케줄러가 도는가 (`AUTO_TRADING_ENABLED`, v2.16.0).
   * false 면 설정이 켜져 있어도 돌지 않는다 — 화면이 계좌 설정과 무관하게 알린다.
   */
  serverEnabled: boolean;
  /**
   * 마지막 한 바퀴의 판단 — 매수·매도뿐 아니라 **건너뛴 이유**도 담는다 (v2.16.0).
   * 예전에는 스케줄러가 돌린 바퀴의 "건너뜀" 사유가 어디에도 남지 않았다(거래내역은 체결만 보인다).
   */
  lastNotes: DecisionNote[];
  lastNotesAt: string | null;
}

/** 자동매매가 한 바퀴 돈 결과 (수동 실행 응답) */
export interface AutoTradeRunResult {
  accountId: number;
  /** 판단한 종목 수 */
  evaluated: number;
  /** 실제로 낸 주문 수 */
  ordered: number;
  /** 종목별 판단 근거 — 주문이 안 나간 이유도 포함한다 */
  notes: (DecisionNote & { orderId: number | null })[];
  errors: string[];
  skipped: string | null;
}

/**
 * 지표 엔진(Python 5001)이 계산하는 이동평균 일수 — **이 넷뿐이다** (v2.38.0 에 한 곳으로 모았다).
 * 다른 값은 판정할 때 가장 가까운 값으로 바뀐다(`nearestEngineMa` — 같은 거리면 짧은 쪽). 13일 → 20일.
 * 백테스트 화면은 이 넷 중에서만 고르게 하고, 계좌 설정은 예전 저장값 때문에 아무 숫자나 받는다.
 */
export const ENGINE_MA_PERIODS = [5, 20, 60, 120] as const;
export type EngineMaPeriod = (typeof ENGINE_MA_PERIODS)[number];

/** 판정(`ruleEngine.pickMa`)이 실제로 쓰는 이동평균 일수 — 화면의 「13일 → 20일로 계산」 도 이 함수 */
export function nearestEngineMa(period: number): EngineMaPeriod {
  let best: EngineMaPeriod = ENGINE_MA_PERIODS[0];
  for (const p of ENGINE_MA_PERIODS) if (Math.abs(p - period) < Math.abs(best - period)) best = p;
  return best;
}

/**
 * 규칙형 숫자 범위 — 계좌 설정 저장(`server/autoTrading/store.ts`)과 백테스트 입력 검사가 **같은 값**을 쓴다 (v2.38.0).
 * 범위를 따로 정하면 백테스트에서 시험한 조건을 계좌에 넣을 때 조용히 잘린다.
 */
export const RULE_LIMITS = {
  rsiBuyBelow: { min: 5, max: 50 },
  rsiSellAbove: { min: 50, max: 95 },
  hardStopLossPercent: { min: 1, max: 50 },
  trailingStopPercent: { min: 1, max: 50 },
} as const;

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

    earningsBlackoutDays: 3,
    dailyLossLimitPercent: 0,

    buySignal: 'BUY',
    buyMinConfidence: 0.7,
    sellSignal: 'SELL',
    sellMinConfidence: 0.7,
    horizon: 'swing',

    rule: { ...DEFAULT_RULE },
  };
}
