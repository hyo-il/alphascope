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
import { collectNews, fetchRss, kstMonthDay, NEWS_MAX_AGE_MS, shortReason, type BriefNewsItem, type RssFetcher, type RssResult } from './news';
import { sectorStockPool, type SectorStockPool } from './sectorStocks';
import { ASSET_LABEL } from '../../src/utils/marketBrief';
import type { BriefAsset, BriefAssetKey, BriefEdition, BriefSourceStatus } from '../../src/types/marketBrief';

const ENGINE_URL = process.env.INDICATORS_URL ?? `http://127.0.0.1:${process.env.INDICATORS_PORT ?? 5001}`;
/**
 * 지표 엔진 시장 데이터 전체 제한 — 오전판 yfinance 12항목(차례로 · 각 10초 = 120초) + 미2년물 재무부(이번 달 + 지난달 · 각 15초 = 30초) = 150초가
 * 모두 늦어도 들어오게 15초를 더한 값. 넘기면 시장 데이터가 통째로 실패해 AI 도 부르지 않는다.
 */
const MARKET_DATA_TIMEOUT_MS = 165_000;


export interface MarketData {
  assets: Partial<Record<BriefAssetKey, BriefAsset>>;
  failed: BriefAssetKey[];
  /** 지표 엔진이 실제로 받은 시각(ms, 엔진 10분 캐시면 그때) — 장중/종가 판단은 이 시각 하나로 한다 */
  fetchedAt?: number;
  /** 후보를 차례로 시도한 값(미2년물 — `python/market_brief.py` `US2Y_SOURCES`) — 쓴 후보 · 시도마다 성공/실패 */
  sources?: Partial<Record<BriefAssetKey, { used: string | null; tried: { source: string; ok: boolean; error: string | null }[] }>>;
}

export type MarketDataFetcher = (edition: BriefEdition) => Promise<MarketData>;

export const fetchMarketData: MarketDataFetcher = async (edition) => {
  const response = await fetch(`${ENGINE_URL}/market-brief-data?edition=${edition}`, { signal: AbortSignal.timeout(MARKET_DATA_TIMEOUT_MS) });
  const payload = (await response.json().catch(() => ({}))) as Partial<MarketData> & { error?: string };
  if (!response.ok || !payload.assets) throw new Error(payload.error ?? `지표 엔진 응답 ${response.status}`);
  return { assets: payload.assets, failed: payload.failed ?? [], fetchedAt: payload.fetchedAt, sources: payload.sources };
};

/** 받은 소스 한 줄의 건수 — 「12건」 · 「8건(72시간 넘은 4건 뺌)」 · 「0건(모두 72시간 넘음 — 최신 10-21)」 */
function newsCount(r: RssResult): string {
  const hours = NEWS_MAX_AGE_MS / 3_600_000;
  if (r.count === 0 && (r.stale ?? 0) > 0) return `0건(모두 ${hours}시간 넘음${r.newest ? ` — 최신 ${kstMonthDay(r.newest)}` : ''})`;
  return `${r.count}건${r.stale ? `(${hours}시간 넘은 ${r.stale}건 뺌)` : ''}`;
}

export interface CollectDeps {
  market: MarketDataFetcher;
  rss: RssFetcher;
  /** now = 그 순간(ms) — 실적 날수는 종목마다 그 시장 날짜로 */
  earnings: (now: number) => Promise<EarningsCollection>;
  /** ③ 대표 종목 후보(DB · 유니버스 파일 — 네트워크 없음) */
  sectorStocks: () => SectorStockPool;
}

export const defaultCollectDeps: CollectDeps = {
  market: fetchMarketData,
  rss: fetchRss,
  earnings: (now) => collectEarnings(now),
  sectorStocks: () => sectorStockPool(),
};

export interface Collected {
  market: MarketData;
  domestic: BriefNewsItem[];
  foreign: BriefNewsItem[];
  earnings: EarningsCollection;
  sectorStocks: SectorStockPool;
  sources: BriefSourceStatus[];
}

export async function collectAll(edition: BriefEdition, now: number, deps: CollectDeps = defaultCollectDeps): Promise<Collected> {
  const [market, news, earnings] = await Promise.all([
    deps.market(edition).catch((e: Error): MarketData & { error: string } => ({ assets: {}, failed: [], error: e.message })),
    collectNews(edition === 'morning', deps.rss, now),
    deps.earnings(now).catch((e: Error): EarningsCollection => ({ earnings: [], estimatesOk: 0, estimatesTried: 0, error: e.message })),
  ]);

  const sources: BriefSourceStatus[] = [];
  const marketError = (market as { error?: string }).error;
  const got = Object.keys(market.assets).length;
  // 후보를 차례로 시도한 값(미2년물)은 따로 한 줄 — 쓴 후보 이름 · 앞 후보 실패 이유
  const tried = Object.entries(market.sources ?? {}) as [BriefAssetKey, NonNullable<MarketData['sources']>[BriefAssetKey]][];
  const ownLine = new Set(tried.map(([k]) => k));
  const failedRest = market.failed.filter((k) => !ownLine.has(k));
  sources.push({
    group: 'market',
    label: '시장 데이터',
    ok: !marketError && failedRest.length === 0 && got > 0,
    detail: marketError
      ? `지표 엔진 실패 — ${marketError}`
      : `${got}개 받음` + (failedRest.length ? ` · 못 받음: ${failedRest.map((k) => ASSET_LABEL[k] ?? k).join(', ')}` : ''),
  });
  for (const [key, info] of tried) {
    if (!info) continue;
    const misses = info.tried.filter((t) => !t.ok).map((t) => `${t.source} 실패(${shortReason(t.error)})`);
    sources.push({
      group: 'market',
      label: `시장 데이터 · ${ASSET_LABEL[key] ?? key}`,
      ok: Boolean(info.used),
      detail: info.used ? `${info.used}${misses.length ? ` · ${misses.join(' · ')}` : ''}` : `받지 못함 — ${misses.join(' · ') || '시도 없음'}`,
    });
  }
  for (const r of news.results) {
    sources.push({
      group: 'news',
      label: `${r.foreign ? '해외' : '국내'} 뉴스 · ${r.source}${r.fallback ? '(국내 0건 → 대신)' : ''}${r.slot && r.ok ? '(대체 소스)' : ''}`,
      ok: r.ok,
      // 대체 소스 줄의 error = 앞 후보(성공 때) · 모든 후보(실패 때)의 이유 — news.ts 가 이미 짧은 한국어로 만든다
      detail: r.ok ? `${newsCount(r)}${r.slot && r.error ? ` · 앞 후보 실패: ${r.error}` : ''}` : r.slot ? (r.error ?? '받기 실패') : shortReason(r.error),
    });
  }
  // 72시간 거르기 한 줄 — 받은 글 전부(거르기 전) 중 뺀 수 · 발행 시각을 못 읽어 남긴 수
  const received = news.results.filter((r) => r.ok);
  const total = received.reduce((n, r) => n + (r.total ?? r.count), 0);
  if (total) {
    const stale = received.reduce((n, r) => n + (r.stale ?? 0), 0);
    const noDate = received.reduce((n, r) => n + (r.noDate ?? 0), 0);
    sources.push({
      group: 'news',
      label: `뉴스 ${NEWS_MAX_AGE_MS / 3_600_000}시간 거르기`,
      ok: true,
      detail: `뉴스 ${total}건 중 ${stale}건 뺌(${NEWS_MAX_AGE_MS / 3_600_000}시간 넘음)${noDate ? ` · 발행 시각 모르는 ${noDate}건은 남김` : ''}`,
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
  let sectorStocks: SectorStockPool = {};
  try {
    sectorStocks = deps.sectorStocks();
  } catch (e) {
    console.warn('[market-brief] 대표 종목 후보 읽기 실패 — 빈 목록:', (e as Error).message);
  }
  return { market: { assets: market.assets, failed: market.failed, fetchedAt: market.fetchedAt }, domestic: news.domestic, foreign: news.foreign, earnings, sectorStocks, sources };
}
