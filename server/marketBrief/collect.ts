/**
 * 오늘 시황 — 수집 한 번(시장 데이터 · 뉴스 · 실적 일정)을 모아 수집 상태와 함께 돌려준다.
 *
 * - 시장 데이터: 지표 엔진 `/market-brief-data`(13종 + VIX — 엔진이 10분 캐시)
 * - 뉴스: `news.ts`(RSS — 서버에서 직접)
 * - 실적: `earnings.ts`(실적일은 `getEarningsDate` · 전망치는 엔진)
 * 셋은 나란히 받는다. 하나가 실패해도 나머지로 간다 — 실패는 수집 상태 줄로 남는다.
 * 받기 함수는 모두 바꿔 끼울 수 있다(시험은 네트워크 0).
 */

import { BRIEF_SECTORS, collectEarnings, type EarningsCollection } from './earnings';
import { collectNews, fetchRss, type BriefNewsItem, type RssFetcher } from './news';
import { ASSET_LABEL } from '../../src/utils/marketBrief';
import type { BriefAsset, BriefAssetKey, BriefEdition, BriefSourceStatus } from '../../src/types/marketBrief';

const ENGINE_URL = process.env.INDICATORS_URL ?? `http://127.0.0.1:${process.env.INDICATORS_PORT ?? 5001}`;

export interface MarketData {
  assets: Partial<Record<BriefAssetKey, BriefAsset>>;
  failed: BriefAssetKey[];
  /** 지표 엔진이 실제로 받은 시각(ms, 엔진 10분 캐시면 그때) — 장중/종가 판단은 이 시각 하나로 한다 */
  fetchedAt?: number;
}

export type MarketDataFetcher = (edition: BriefEdition) => Promise<MarketData>;

export const fetchMarketData: MarketDataFetcher = async (edition) => {
  const response = await fetch(`${ENGINE_URL}/market-brief-data?edition=${edition}`, { signal: AbortSignal.timeout(120_000) });
  const payload = (await response.json().catch(() => ({}))) as Partial<MarketData> & { error?: string };
  if (!response.ok || !payload.assets) throw new Error(payload.error ?? `지표 엔진 응답 ${response.status}`);
  return { assets: payload.assets, failed: payload.failed ?? [], fetchedAt: payload.fetchedAt };
};

export interface CollectDeps {
  market: MarketDataFetcher;
  rss: RssFetcher;
  /** now = 그 순간(ms) — 실적 날수는 종목마다 그 시장 날짜로 */
  earnings: (now: number) => Promise<EarningsCollection>;
}

export const defaultCollectDeps: CollectDeps = {
  market: fetchMarketData,
  rss: fetchRss,
  earnings: (now) => collectEarnings(now),
};

export interface Collected {
  market: MarketData;
  domestic: BriefNewsItem[];
  foreign: BriefNewsItem[];
  earnings: EarningsCollection;
  sources: BriefSourceStatus[];
}

export async function collectAll(edition: BriefEdition, now: number, deps: CollectDeps = defaultCollectDeps): Promise<Collected> {
  const [market, news, earnings] = await Promise.all([
    deps.market(edition).catch((e: Error): MarketData & { error: string } => ({ assets: {}, failed: [], error: e.message })),
    collectNews(edition === 'morning', deps.rss),
    deps.earnings(now).catch((e: Error): EarningsCollection => ({ earnings: [], estimatesOk: 0, estimatesTried: 0, error: e.message })),
  ]);

  const sources: BriefSourceStatus[] = [];
  const marketError = (market as { error?: string }).error;
  const got = Object.keys(market.assets).length;
  sources.push({
    group: 'market',
    label: '시장 데이터',
    ok: !marketError && market.failed.length === 0 && got > 0,
    detail: marketError
      ? `지표 엔진 실패 — ${marketError}`
      : `${got}개 받음` + (market.failed.length ? ` · 못 받음: ${market.failed.map((k) => ASSET_LABEL[k] ?? k).join(', ')}` : ''),
  });
  for (const r of news.results) {
    sources.push({
      group: 'news',
      label: `${r.foreign ? '해외' : '국내'} 뉴스 · ${r.source}${r.fallback ? '(국내 전부 실패 → 대신)' : ''}`,
      ok: r.ok,
      detail: r.ok ? `${r.count}건` : (r.error ?? '받기 실패'),
    });
  }
  const unknownSector = earnings.earnings.filter((e) => !BRIEF_SECTORS.includes(e.sector)).length;
  sources.push({
    group: 'earnings',
    label: '실적 일정(60일)',
    ok: !earnings.error,
    detail:
      `${earnings.earnings.length}종목 · 전망치 ${earnings.estimatesOk}/${earnings.estimatesTried}` +
      (unknownSector ? ` · 섹터 모름 ${unknownSector}종목(주도 섹터와 맞지 않아 일정에서 빠짐 — 국내 종목은 남음)` : '') +
      (earnings.error ? ` · ${earnings.error}` : ''),
  });
  return { market: { assets: market.assets, failed: market.failed, fetchedAt: market.fetchedAt }, domestic: news.domestic, foreign: news.foreign, earnings, sources };
}
