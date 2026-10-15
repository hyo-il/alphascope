/**
 * 계좌별 자동매매 (v2.44.0 — 퀀트 다시 만들기 2단계).
 *
 * 계좌는 「퀀트 > 매매 규칙」 에서 **규칙 하나를 골라** 쓴다(`ruleId`). 판단은 엔진 `server/rules/engine.ts` 의 `evaluateRule` 한 곳.
 * 손절 · 익절 · 트레일링은 **규칙의 매도 조건에만** 있다(예전 계좌의 「④ 청산」 은 없앴다).
 * 매수·매도 신호는 종목마다 **그 시장이 열린 뒤 첫 판단에서 하루 한 번**(어제까지 끝난 봉 기준), 손절·익절·트레일링은 1분마다.
 * AI형 계좌·판단 방식·분석 주기·「미국 정규장만」 은 v2.44.0 에 없앴다.
 *
 * ⚠️ 모의 계좌(SQLite)만 건드린다. 실제 주문은 어떤 경로로도 나가지 않는다.
 */

/** 계좌 하나의 자동매매 설정 */
export interface AccountStrategy {
  accountId: number;
  enabled: boolean;
  /** 쓰는 매매 규칙 — null 이거나 지워진 규칙이면 자동매매를 켤 수 없다 */
  ruleId: number | null;
  /** 자동매매 대상 종목 */
  symbols: string[];

  // ── 계좌 운용 ──────────────────────────────────
  /** 한 종목에 넣을 총자산 비중(%) */
  positionSizePercent: number;
  /** 동시에 보유할 최대 종목 수 (이미 보유한 종목의 추가 매수는 막지 않는다) */
  maxPositions: number;

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

  // ── AI 검증 (v2.46.0, 퀀트 4단계) ──────────────────
  /**
   * 규칙이 「사도 됨」 을 낸 종목을 사기 직전에 AI(Gemini)에게 한 번 묻고, 「위험」 이면 사지 않는다. 기본 끔.
   * 매도(점수 매도 · 반대 신호 · 손절 · 익절 · 트레일링)에는 쓰지 않는다. 꺼진 계좌는 판단·주문이 예전과 같다(바이트 비교).
   */
  aiCheck: boolean;
}

/**
 * 판단 **종류 코드** (v2.32.0) — 엔진이 판단할 때 이미 아는 것만 담는다.
 *
 * ⚠️ 화면은 사유 **문장**이 아니라 이 값으로 쉬운 말을 고른다(`utils/autoTradeExplain.ts` 한 곳).
 * - 매매 규칙 엔진(v2.43.0): score_buy · score_sell · rr_block · reentry_wait · dead · rsi_hot(반대 신호) · no_signal_buy · no_signal_hold
 * - 공통: hard_stop · take_profit · trailing · earnings_blackout · max_positions · daily_loss · not_enough_candles · error
 * - other: 위에 없는 경로(예산·현금 부족 등)
 * v2.44.0 에 AI형(ai_*)과 예전 교차 계산기 전용 코드(golden · rsi_rebound)를 지웠다 — 그 기록(「최근 판단」)은 데이터 정리 때 지웠다.
 */
export type DecisionCode =
  | 'score_buy'
  | 'score_sell'
  | 'rr_block'
  | 'reentry_wait'
  | 'dead'
  | 'rsi_hot'
  | 'no_signal_buy'
  | 'no_signal_hold'
  | 'hard_stop'
  | 'take_profit'
  | 'trailing'
  | 'earnings_blackout'
  | 'max_positions'
  | 'daily_loss'
  | 'not_enough_candles'
  | 'error'
  | 'other'
  // AI 검증(v2.46.0) — 규칙 「사도 됨」 → 안전장치·현금 통과 뒤 AI 에게 물은 결과
  | 'ai_pass'
  | 'ai_risk'
  | 'ai_unavailable';

/** 「최근 판단」 한 줄 */
export interface DecisionNote {
  symbol: string;
  action: 'BUY' | 'SELL' | 'HOLD';
  reason: string;
  code?: DecisionCode;
  /** AI 검증 이유(최대 3줄) 또는 못 한 까닭 — 「최근 판단」 줄을 펼치면 보인다(v2.46.0). AI 검증 줄에만 붙는다 */
  detail?: string[];
}

/**
 * 자동매매가 멈춘 **종류**. 화면은 문구가 아니라 이 값으로 분기한다 —
 * 문구를 다듬을 때마다 화면 분기가 깨지면 안 된다.
 * - `market_closed` = 정상 대기 (대상 종목의 시장이 모두 닫혀 있다 — 열리면 저절로 돈다)
 * - `config` = 사람이 고쳐야 하는 설정 문제 (규칙 없음 · 종목 0개)
 */
export type BlockedKind = 'market_closed' | 'config' | 'server_off' | 'daily_loss' | null;

/** 계좌별 실행 상태 — 화면이 "지금 돌고 있나" 를 보여 주는 데 쓴다 */
export interface AccountStrategyStatus {
  accountId: number;
  enabled: boolean;
  /** 지금 이 계좌를 처리 중인지 */
  running: boolean;
  lastRunAt: string | null;
  lastError: string | null;
  /** 지금 돌 수 없는 이유 — 화면이 그대로 띄운다 */
  blockedReason: string | null;
  /** 멈춤의 종류 — 화면 분기는 문구가 아니라 **이 값**으로 한다 */
  blockedKind: BlockedKind;
  /**
   * 이 서버에서 자동매매 스케줄러가 도는가 (`AUTO_TRADING_ENABLED`, v2.16.0).
   * false 면 설정이 켜져 있어도 돌지 않는다 — 화면이 계좌 설정과 무관하게 알린다.
   */
  serverEnabled: boolean;
  /** 대상 종목 중 오늘(그 종목 시장 날짜) 이미 신호를 본 수 (v2.44.0) */
  judgedToday: number;
  /**
   * 대상 종목 시장별 **다음 개장 시각**(ISO, v2.44.1) — 서버가 휴장일까지 보고 계산한다(`marketHours.nextMarketOpen`).
   * 화면은 시각을 따로 계산하지 않고 이것을 한국 시간으로 보이기만 한다. 대상 종목의 시장만 들어 있다.
   */
  nextOpen: Partial<Record<'US' | 'KR', string>>;
  /** 마지막 한 바퀴의 판단 — 매수·매도뿐 아니라 **건너뛴 이유**도 담는다 (v2.16.0) */
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
 * 매매 규칙의 이동평균 교차는 이 넷 중에서만 고른다(`utils/ruleInput.ts`).
 */
export const ENGINE_MA_PERIODS = [5, 20, 60, 120] as const;
export type EngineMaPeriod = (typeof ENGINE_MA_PERIODS)[number];

/** 엔진이 실제로 쓰는 이동평균 일수 — 가장 가까운 값(같은 거리면 짧은 쪽) */
export function nearestEngineMa(period: number): EngineMaPeriod {
  let best: EngineMaPeriod = ENGINE_MA_PERIODS[0];
  for (const p of ENGINE_MA_PERIODS) if (Math.abs(p - period) < Math.abs(best - period)) best = p;
  return best;
}

/** 매매 규칙의 RSI·손절·익절·트레일링 범위 (`utils/ruleInput.ts` 가 쓴다) */
export const RULE_LIMITS = {
  rsiBuyBelow: { min: 5, max: 50 },
  rsiSellAbove: { min: 50, max: 95 },
  hardStopLossPercent: { min: 1, max: 50 },
  trailingStopPercent: { min: 1, max: 50 },
  takeProfitPercent: { min: 1, max: 100 },
} as const;

/** 계좌를 새로 잡을 때의 기본값 — 규칙은 비어 있다(고르기 전에는 켤 수 없다) */
export function defaultStrategy(accountId: number): AccountStrategy {
  return {
    accountId,
    enabled: false,
    ruleId: null,
    symbols: [],
    positionSizePercent: 10,
    maxPositions: 5,
    earningsBlackoutDays: 3,
    dailyLossLimitPercent: 0,
    aiCheck: false,
  };
}
