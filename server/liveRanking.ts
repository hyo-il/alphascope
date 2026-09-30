/**
 * 실시간 순위 — `GET /api/rankings/live?market=us|kr&kind=amount|volume|gainers|losers` (v2.20.0).
 *
 * 토스 `/api/v1/rankings`(`duration=realtime`)를 **30초 캐시**로 감싼다(RANKING 5/s — 화면도 30초마다 부른다).
 * ⚠️ 급등 탐지의 랭킹 캐시(`surge_ranking_cache`, 8시간, `duration=1d`)와 **다른 캐시**다 — 키가 `live|…` 라 서로 덮지 않는다.
 * 보기 전용이다. 순위를 매수 신호로 쓰지 않는다(급등 다음 날 추격은 진단에서 불리했다).
 */

import { fetchRanking, type RankingType } from '../src/services/toss/market';
import { findStock } from './stockCatalog';
import { isMockMode } from './mockData';
import { currencyOfSymbol } from '../src/utils/market';
import type { LiveRankingKind, LiveRankingMarket, LiveRankingResponse } from '../src/types/ranking';

const CACHE_MS = 30_000;

const TOSS_TYPE: Record<LiveRankingKind, RankingType> = {
  amount: 'MARKET_TRADING_AMOUNT',
  volume: 'MARKET_TRADING_VOLUME',
  gainers: 'TOP_GAINERS',
  losers: 'TOP_LOSERS',
};

/**
 * ⚠️ 토스는 상승률·하락률에 `realtime` 을 받지 않는다(400 `unsupported-ranking-duration`, allowedValues `1d…1y` — 2026-09-30 확인).
 * 그래서 그 둘은 `1d`(오늘 등락)로, 거래대금·거래량만 `realtime` 으로 받는다. 화면이 이 차이를 적는다(`duration`).
 */
const DURATION: Record<LiveRankingKind, 'realtime' | '1d'> = {
  amount: 'realtime',
  volume: 'realtime',
  gainers: '1d',
  losers: '1d',
};

const cache = new Map<string, { at: number; data: LiveRankingResponse }>();
const inflight = new Map<string, Promise<LiveRankingResponse>>();

async function build(market: LiveRankingMarket, kind: LiveRankingKind): Promise<LiveRankingResponse> {
  const fetchedAt = new Date().toISOString();
  if (isMockMode()) return { market, kind, duration: DURATION[kind], rankedAt: null, fetchedAt, rows: [], mock: true };
  const { rankedAt, entries } = await fetchRanking(TOSS_TYPE[kind], market === 'us' ? 'US' : 'KR', DURATION[kind]);
  return {
    market,
    kind,
    duration: DURATION[kind],
    rankedAt,
    fetchedAt,
    rows: entries.map((e) => {
      const stock = findStock(e.symbol);
      return {
        rank: e.rank,
        symbol: e.symbol,
        name: stock?.name ?? null,
        currency: currencyOfSymbol(e.symbol, stock?.market),
        price: Number.isFinite(e.lastPrice) ? e.lastPrice : null,
        changeRate: Number.isFinite(e.changeRate) ? e.changeRate : null,
        tradingVolume: e.tradingVolume,
        tradingAmount: e.tradingAmount,
      };
    }),
  };
}

export async function liveRanking(market: LiveRankingMarket, kind: LiveRankingKind): Promise<LiveRankingResponse> {
  const key = `live|${market}|${kind}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;
  let pending = inflight.get(key);
  if (!pending) {
    pending = build(market, kind)
      .then((data) => {
        cache.set(key, { at: Date.now(), data });
        return data;
      })
      .finally(() => inflight.delete(key));
    inflight.set(key, pending);
  }
  return pending;
}
