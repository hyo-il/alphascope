/**
 * yfinance 기업 데이터 타입.
 *
 * 단위 주의: 비율 항목은 소수(0.2762 = 27.62%)로 오지만
 * **배당수익률(`dividend.yield`)만 이미 퍼센트 단위**다 (0.35 = 0.35%).
 */
import { isKrSymbol } from '../utils/market';

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

/**
 * 보여 줄 PEG — **이 함수 한 곳**을 기업정보 · 기업 비교 · AI 분석 문장이 같이 쓴다(따로 `isKrSymbol` 을 검사하지 않는다).
 * 국내 종목은 null(「—」) — yfinance 가 국내 PER 은 주지 않으면서 PEG 만 주어(삼성전자 0.13 등) 같은 기준의 값인지 알 수 없다(사용자 결정 2026-10-21).
 * 미국 종목은 받은 값 그대로. 서버 · 파이썬이 받는 값은 그대로 둔다(표시 · 문장에서만 거른다).
 */
export function displayPeg(symbol: string, valuation: Pick<Valuation, 'peg'> | null | undefined): number | null {
  if (hidesPeg(symbol)) return null;
  return valuation?.peg ?? null;
}

/** PEG 를 숨기는 종목인가(지금은 국내 종목) — `displayPeg` 와 기업정보의 국내 안내가 같은 규칙을 쓰게 한 곳에 둔다 */
export const hidesPeg = (symbol: string): boolean => isKrSymbol(symbol);

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
  /** 이미 퍼센트 단위다 (145.0 = 145%) */
  debtToEquity: number | null;
  currentRatio: number | null;
  quickRatio: number | null;
  totalCash: number | null;
  totalDebt: number | null;
  freeCashflow: number | null;
  /** 시장 대비 변동성. 좋고 나쁨이 아니라 성향이라 비교 표에서 색을 칠하지 않는다. */
  beta?: number | null;
  /**
   * 이자보상배율 = 영업이익 / 이자비용.
   * yfinance `info` 에는 없어서 손익계산서에서 계산한다 — 이자비용이 없는 무차입 기업은 null 이다.
   */
  interestCoverage?: number | null;
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
  /** 시가총액의 통화 (국내 종목은 KRW) */
  currency?: string | null;
  marketCap: number | null;
  per: number | null;
  pbr: number | null;
  dividendYield: number | null;
  profitMargin: number | null;
  /** 고른 이유 — self = 이 종목, pair = 직접 정한 짝 표, industry = 같은 세부 업종, sector = 같은 섹터 */
  basis?: 'self' | 'pair' | 'industry' | 'sector';
}
