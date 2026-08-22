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

export interface PaperSnapshot {
  date: string;
  totalValue: number;
  cash: number;
  stockValue: number;
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
  /** USD → 계좌 통화 환율 (계좌가 USD 면 1) */
  fxRate: number;
  pendingOrders: number;
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
  profitFactor: number | null;
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
