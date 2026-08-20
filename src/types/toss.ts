/** 앱 내부에서 쓰는 정규화된 타입 (토스 원본 응답 → 이 형태로 변환) */

export type Timeframe = '1m' | '5m' | '15m' | '30m' | '1d';

/** 토스 API가 실제로 지원하는 원본 캔들 주기. 그 외는 1m을 집계해서 만든다. */
export type BaseTimeframe = '1m' | '1d';

export interface Candle {
  /** epoch milliseconds (UTC) */
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Price {
  symbol: string;
  close: number;
  /** 전일 종가 대비 변동액 */
  change: number;
  /** 전일 종가 대비 변동률 (%) */
  changeRate: number;
  volume: number;
  /** 조회 시각 (epoch ms) */
  fetchedAt: number;
}

/** 종목 검색 결과 (전종목 카탈로그) */
export interface StockSearchResult {
  symbol: string;
  name: string;
  englishName: string | null;
  market: string;
}

/** 관심 목록·최근 조회용 경량 시세 */
export interface Quote {
  symbol: string;
  price: number | null;
  /** 전일 대비 변동률 (%) */
  changeRate: number | null;
  error: string | null;
}

export interface OrderbookLevel {
  price: number;
  quantity: number;
}

export interface Orderbook {
  symbol: string;
  /** 매도호가 — 낮은 가격부터 */
  asks: OrderbookLevel[];
  /** 매수호가 — 높은 가격부터 */
  bids: OrderbookLevel[];
  fetchedAt: number;
}

export interface TossAccount {
  accountNo: string;
  accountSeq: number;
  /** 예: 'BROKERAGE' */
  accountType: string;
}

export interface Holding {
  symbol: string;
  name: string;
  currency: string;
  quantity: number;
  /** 평균 매입 단가 */
  averagePrice: number;
  currentPrice: number;
  purchaseAmount: number;
  evaluationAmount: number;
  profitLoss: number;
  /** 퍼센트 단위 (응답의 소수를 100배 한 값) */
  profitLossRate: number;
  dailyProfitLoss: number;
  dailyProfitLossRate: number;
}

export interface PortfolioSummary {
  purchaseAmountUsd: number;
  evaluationAmountUsd: number;
  profitLossUsd: number;
  profitLossRate: number;
  dailyProfitLossUsd: number;
  dailyProfitLossRate: number;
}

export interface Portfolio {
  holdings: Holding[];
  summary: PortfolioSummary;
}

export interface ExchangeRate {
  baseCurrency: string;
  quoteCurrency: string;
  rate: number;
  fetchedAt: number;
  /** 시황 카드 미니 차트용 최근 30 거래일 종가 (서버가 yfinance 로 채운다) */
  sparkline?: number[];
}

export interface TossTokenResponse {
  access_token: string;
  token_type: string;
  /** 초 단위 만료 시간 */
  expires_in: number;
}
