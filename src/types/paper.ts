/**
 * 모의투자(페이퍼 트레이딩) 타입.
 *
 * 시세는 실제 토스 API 를 쓰지만 주문·체결·잔고는 전부 앱 내부 SQLite 에만 있다.
 * 토스 주문 API 는 호출하지 않는다.
 */

export type OrderSide = 'BUY' | 'SELL';
export type OrderType = 'MARKET' | 'LIMIT';
export type OrderStatus = 'PENDING' | 'FILLED' | 'CANCELLED';
export type Currency = 'KRW' | 'USD';

/** 계좌 모아보기의 보기 — 서버(`app_settings` 'paper.accountsView')에 두어 모든 기기에서 같다. 없으면 카드 */
export type AccountsView = 'card' | 'list';
export const DEFAULT_ACCOUNTS_VIEW: AccountsView = 'card';
export const isAccountsView = (v: unknown): v is AccountsView => v === 'card' || v === 'list';

export interface PaperAccount {
  id: number;
  name: string;
  initialBalance: number;
  currentCash: number;
  currency: Currency;
  commissionRate: number;
  slippageRate: number;
  createdAt: string;
  isActive: boolean;
}

export interface PaperOrder {
  id: number;
  accountId: number;
  symbol: string;
  name: string | null;
  side: OrderSide;
  orderType: OrderType;
  requestedPrice: number | null;
  executedPrice: number | null;
  quantity: number;
  amount: number | null;
  commission: number;
  slippage: number;
  currency: Currency;
  fxRate: number;
  status: OrderStatus;
  reason: string | null;
  orderedAt: string;
  filledAt: string | null;
}

export interface PaperPosition {
  id: number;
  accountId: number;
  symbol: string;
  name: string | null;
  quantity: number;
  avgPrice: number;
  totalCost: number;
  currency: Currency;
  openedAt: string;
  updatedAt: string;
}

/** 포지션 + 실시간 시세로 계산한 평가손익 */
export interface PaperPositionValued extends PaperPosition {
  currentPrice: number | null;
  marketValue: number | null;
  unrealizedPnl: number | null;
  unrealizedPnlPercent: number | null;
  /** 계좌 통화로 환산한 평가액 */
  marketValueInAccount: number | null;
}

export interface PaperTrade {
  id: number;
  accountId: number;
  orderId: number;
  symbol: string;
  name: string | null;
  side: OrderSide;
  price: number;
  quantity: number;
  commission: number;
  slippage: number;
  currency: Currency;
  fxRate: number;
  cashDelta: number;
  pnl: number | null;
  pnlPercent: number | null;
  reason: string | null;
  tradedAt: string;
}

/** 입금 · 출금 한 줄 — 금액은 계좌 통화 양수. 넣고 뺀 만큼 원금(initialBalance)도 함께 바뀐다 */
export type CashFlowType = 'deposit' | 'withdraw';
export interface PaperCashFlow {
  id: number;
  accountId: number;
  type: CashFlowType;
  amount: number;
  createdAt: string;
}

/** 계좌 통화의 소수 자리 — 원화 정수 · 달러 2자리(입출금 금액 검사 · 출금할 수 있는 돈 표시) */
export const CURRENCY_DECIMALS: Record<Currency, number> = { KRW: 0, USD: 2 };

/**
 * 한 번에 넣을 수 있는 금액 상한 — 입금 · 출금 · 초기 자금(새 계좌 · 초기화). 서버 검사(`parseCashAmount`)와 화면 금액 칸(`NumberField max`)이 **이 값 하나**를 쓴다.
 * 소수 자리 정밀도가 깨지지 않는 범위(원화 1조 · 달러 10억).
 */
export const CASH_MAX: Record<Currency, number> = { KRW: 1_000_000_000_000, USD: 1_000_000_000 };

export interface PaperSnapshot {
  date: string;
  totalValue: number;
  cash: number;
  stockValue: number;
  /** 앞 점 이후 이 점까지의 입출금 합(계좌 통화, 입금 +) — 손익이 아니다. 첫 점은 0 */
  cashFlow: number;
  dailyPnl: number | null;
  dailyReturn: number | null;
  cumulativeReturn: number | null;
}

/** 계좌 상세 — 잔고 + 포지션 평가 요약 */
export interface PaperAccountDetail {
  account: PaperAccount;
  positions: PaperPositionValued[];
  /** 주식 평가액 (계좌 통화) */
  stockValue: number;
  /** 현금 + 주식 (계좌 통화) */
  totalValue: number;
  totalPnl: number;
  totalReturn: number;
  /** 1달러 = N원. 환산은 `utils/fx.convertAmount`. 조회에 실패하면 null */
  usdKrw: number | null;
  pendingOrders: number;
  /** 주문 가능 금액(쓸 수 있는 현금) — 현금에서 걸려 있는 지정가 매수에 묶인 돈을 뺀 것(계좌 통화, `availableCash`) */
  orderable: number;
  /** 출금할 수 있는 돈 — min(주문 가능 금액, 원금 − 최소 단위), 통화 소수 자리 내림(계좌 통화) */
  withdrawable: number;
}

export interface PaperPerformance {
  /** 기본 성과 (계좌 통화) */
  initialBalance: number;
  totalValue: number;
  cash: number;
  stockValue: number;
  totalPnl: number;
  totalReturn: number;
  dailyPnl: number | null;
  dailyReturn: number | null;

  /** 리스크 */
  mdd: number | null;
  volatility: number | null;

  /** 매매 통계 */
  tradeCount: number;
  closedCount: number;
  winCount: number;
  lossCount: number;
  winRate: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  /** 손익비 = 평균 수익 ÷ 평균 손실 */
  payoffRatio: number | null;
  /** Profit Factor = 청산 거래 실현손익 (+ 합) ÷ |− 합| (백테스트와 같은 함수) */
  profitFactor: number | null;
  profitFactorNote: '손실 거래 없음' | '거래 없음' | '청산 거래 없음' | null;
  maxWinStreak: number;
  maxLossStreak: number;

  /** 종목별 (실현 + 평가) */
  bySymbol: {
    symbol: string;
    name: string | null;
    realizedPnl: number;
    unrealizedPnl: number | null;
    returnPercent: number | null;
    weight: number | null;
  }[];
}

export interface CreateOrderInput {
  accountId: number;
  symbol: string;
  side: OrderSide;
  orderType: OrderType;
  quantity: number;
  requestedPrice?: number | null;
  reason?: string | null;
}

export interface CreateOrderResult {
  order: PaperOrder;
  trade: PaperTrade | null;
  /** PENDING 으로 접수됐는지 */
  pending: boolean;
}
