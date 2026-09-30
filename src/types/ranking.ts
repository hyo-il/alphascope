/** 실시간 순위 (v2.20.0) — 서버 `server/liveRanking.ts` 와 화면 `components/ranking` 이 함께 쓴다 */

export type LiveRankingMarket = 'us' | 'kr';
export type LiveRankingKind = 'amount' | 'volume' | 'gainers' | 'losers';

export const LIVE_RANKING_KINDS: { id: LiveRankingKind; label: string }[] = [
  { id: 'amount', label: '거래대금' },
  { id: 'volume', label: '거래량' },
  { id: 'gainers', label: '상승률' },
  { id: 'losers', label: '하락률' },
];

export interface LiveRankingRow {
  rank: number;
  symbol: string;
  name: string | null;
  currency: 'KRW' | 'USD';
  price: number | null;
  /** 전일 대비 등락률(%) */
  changeRate: number | null;
  tradingVolume: number;
  tradingAmount: number;
}

export interface LiveRankingResponse {
  market: LiveRankingMarket;
  kind: LiveRankingKind;
  /** 토스에 보낸 기간 — 상승률·하락률은 realtime 을 받지 않아 1d(오늘 등락)다 */
  duration: 'realtime' | '1d';
  /** 토스가 순위를 매긴 시각 */
  rankedAt: string | null;
  /** 서버가 받아 온 시각 (30초 캐시) */
  fetchedAt: string;
  rows: LiveRankingRow[];
  mock?: boolean;
}
