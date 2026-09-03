/**
 * yfinance 기업 데이터 타입.
 *
 * 단위 주의: 비율 항목은 소수(0.2762 = 27.62%)로 오지만
 * **배당수익률(`dividend.yield`)만 이미 퍼센트 단위**다 (0.35 = 0.35%).
 */

export interface CompanyProfile {
  name: string | null;
  sector: string | null;
  industry: string | null;
  country: string | null;
  employees: number | null;
  marketCap: number | null;
  currency: string | null;
  summary: string | null;
  /** 다음 실적 발표일 (YYYY-MM-DD). 종목에 따라 없다. */
  earningsDate?: string | null;
}

export interface Valuation {
  per: number | null;
  forwardPer: number | null;
  pbr: number | null;
  eps: number | null;
  forwardEps: number | null;
  peg: number | null;
  priceToSales: number | null;
  evToEbitda: number | null;
}

export interface Profitability {
  revenue: number | null;
  revenueGrowth: number | null;
  earningsGrowth: number | null;
  grossMargin: number | null;
  operatingMargin: number | null;
  profitMargin: number | null;
  roe: number | null;
  roa: number | null;
}

export interface Stability {
  debtToEquity: number | null;
  currentRatio: number | null;
  quickRatio: number | null;
  totalCash: number | null;
  totalDebt: number | null;
  freeCashflow: number | null;
}

export interface DividendInfo {
  /** 이미 퍼센트 단위 */
  yield: number | null;
  rate: number | null;
  payoutRatio: number | null;
  recent: { date: string; amount: number | null }[];
}

export interface StatementRow {
  period: string;
  [label: string]: string | number | null;
}

export interface Fundamentals {
  symbol: string;
  profile: CompanyProfile;
  valuation: Valuation;
  profitability: Profitability;
  stability: Stability;
  dividend: DividendInfo;
  incomeStatement: StatementRow[];
  balanceSheet: StatementRow[];
}

export interface PeerSummary {
  symbol: string;
  name: string | null;
  sector: string | null;
  marketCap: number | null;
  per: number | null;
  pbr: number | null;
  dividendYield: number | null;
  profitMargin: number | null;
}
