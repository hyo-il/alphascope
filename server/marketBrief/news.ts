/**
 * 오늘 시황 — 경제 뉴스 RSS (Stockproject `news_collector.py` 의 주소 · 개수 · 거르기 그대로).
 *
 * - 국내 4 + 해외 4. **(72시간 거르기 뒤) 국내가 한 건도 없을 때만** 국내 폴백 1(SBS 경제)을 부른다.
 * - 브리핑 만드는 시각 기준 72시간보다 오래된 글은 뺀다(`NEWS_MAX_AGE_MS` · 발행 시각을 못 읽은 글은 남긴다).
 * - 해외 4번째 자리는 후보를 차례로(`FOREIGN_SLOT_CANDIDATES` — 첫 성공을 쓴다). 원본의 Yahoo Finance(`/news/rssindex`)는 HTTP 404 라
 *   후보에서 뺐다(v2.59.6 — 죽은 소스를 매번 부르지 않는다). 오라클에서 열리는지는 `npm run -s marketbrief:sources` 로 본다.
 * - 소스마다 최대 20건 · 제목 · 출처 · 링크 · 시각만(본문을 긁지 않는다 — `server/news.ts` 와 같은 원칙).
 * - 한 곳이 죽어도 나머지로 간다. 소스마다 성공 · 실패를 돌려준다(화면 「수집 상태」 — RSS 는 예고 없이 죽는다).
 * - 파서를 들이지 않는다 — 거래정지 RSS(`usHalts/feed.ts`)처럼 정규식으로 `<item>`(RSS) · `<entry>`(Atom)만 읽는다.
 * - 원본은 지표 엔진에 없는 `feedparser`(파이썬)를 썼다. 서버(Node)에서 받아 새 의존성을 두지 않는다.
 */

import { kstDay } from '../../src/utils/marketBrief';

export interface RssSource {
  url: string;
  source: string;
  /** 출처 · 이용 조건 한 줄(점검 표 · 문서) */
  note?: string;
}

export interface BriefNewsItem {
  title: string;
  source: string;
  link: string;
  /** 발행 시각(ISO) — 모르면 null */
  publishedAt: string | null;
  foreign: boolean;
}

export interface RssResult {
  source: string;
  ok: boolean;
  /** 남긴 글 수(72시간 거르기 뒤) */
  count: number;
  error: string | null;
  /** 받은 글 수(거르기 전) · 72시간 넘어 뺀 수 · 발행 시각을 못 읽어 남긴 수 · 가장 최근 발행 시각(ISO) */
  total?: number;
  stale?: number;
  noDate?: number;
  newest?: string | null;
  /** 대체 소스 자리에서 받았지만 72시간 안 글이 0건이라 건너뛴 후보들의 받은 수 · 뺀 수 · 시각 없는 수(합계 줄에 더한다) */
  skippedTotal?: number;
  skippedStale?: number;
  skippedNoDate?: number;
}

/**
 * 뉴스 나이 한도 — 브리핑 만드는 시각 기준 72시간보다 오래된 글은 AI 입력에서 뺀다(v2.59.7 · 사용자 결정).
 * 72시간 = 월요일 아침판에도 금요일 미국 뉴스(미국 금요일 장 = 한국 토요일 새벽)는 남는 길이. 묵은 피드(CNBC Finance 최신 9일 전)가
 * 「오늘 뉴스」 로 들어가지 않게 한다. 발행 시각을 못 읽은 글은 빼지 않는다(나이를 모른다 — 수를 센다).
 */
export const NEWS_MAX_AGE_MS = 72 * 3_600_000;

/** 거르기 — 남길 글 · 뺀 수 · 시각 없는 수 · 가장 최근 발행 시각 */
export function freshNews(items: BriefNewsItem[], now: number): { kept: BriefNewsItem[]; stale: number; noDate: number; newest: string | null } {
  const kept: BriefNewsItem[] = [];
  let stale = 0;
  let noDate = 0;
  let newest: string | null = null;
  for (const it of items) {
    const ms = it.publishedAt ? Date.parse(it.publishedAt) : NaN;
    if (!Number.isFinite(ms)) {
      noDate++;
      kept.push(it);
      continue;
    }
    if (!newest || it.publishedAt! > newest) newest = it.publishedAt;
    if (now - ms > NEWS_MAX_AGE_MS) stale++;
    else kept.push(it);
  }
  return { kept, stale, noDate, newest };
}

/** 「MM-DD」(한국 날짜) — 수집 상태 · 점검 표의 「최신」 */
export const kstMonthDay = (iso: string) => kstDay(Date.parse(iso)).slice(5);

export const DOMESTIC_RSS: RssSource[] = [
  { url: 'https://www.yonhapnewstv.co.kr/category/news/economy/feed/', source: '연합뉴스' },
  { url: 'https://www.mk.co.kr/rss/30100041/', source: '매일경제' },
  { url: 'https://www.mk.co.kr/rss/50200011/', source: '매경 증권' },
  // etnews 는 rss.etnews.com 으로 옮겼다. Section903 = 증권 · 기업
  { url: 'https://rss.etnews.com/Section903.xml', source: '전자신문' },
];

export const FOREIGN_RSS: RssSource[] = [
  { url: 'https://www.cnbc.com/id/19854910/device/rss/rss.html', source: 'CNBC Tech' },
  { url: 'https://www.cnbc.com/id/20910258/device/rss/rss.html', source: 'CNBC Economy' },
  { url: 'https://www.cnbc.com/id/10000664/device/rss/rss.html', source: 'CNBC Finance' },
];

/**
 * 해외 4번째 자리 — 앞에서부터 차례로 시도해 첫 성공 하나만 쓴다(맥 2026-10-30 각 1번 열어 봄: 둘 다 200).
 * WSJ Markets(feeds.a.dj.com)는 열리지만 마지막 글이 2025-01 이라 넣지 않았다.
 */
export const FOREIGN_SLOT_CANDIDATES: RssSource[] = [
  // Dow Jones 공개 RSS(MarketWatch Top Stories) — Dow Jones 이용 조건: 개인 · 비상업 이용(제목 · 링크만 쓴다)
  { url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories', source: 'MarketWatch', note: 'Dow Jones 공개 RSS · 개인 · 비상업 이용' },
  // 미국 연준 보도자료 RSS — 미국 정부 공개 자료
  { url: 'https://www.federalreserve.gov/feeds/press_all.xml', source: '미국 연준 보도자료', note: '미국 연방준비제도 공식 RSS · 공개 자료' },
];

/** 72시간 거르기 뒤 국내 글이 0건일 때만(4곳 모두 실패 · 받았어도 모두 72시간 넘음) */
export const DOMESTIC_FALLBACK: RssSource = { url: 'https://news.sbs.co.kr/news/SectionRssFeed.do?sectionId=02', source: 'SBS 경제' };

export const PER_SOURCE = 20;
const TIMEOUT_MS = 15_000;

/** RSS 본문 받기 — 시험은 바꿔 끼운다(네트워크 0) */
export type RssFetcher = (url: string) => Promise<string>;

/** RSS 한 번 열기 — HTTP 코드와 본문(점검 명령 `marketbrief:sources` 도 이것으로 연다 — 같은 머리말 · 시간 제한 · 글자 인코딩) */
export async function fetchRssRaw(url: string): Promise<{ status: number; text: string }> {
  const response = await fetch(url, {
    headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml', 'User-Agent': 'Mozilla/5.0 (AlphaScope personal use)' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const bytes = new Uint8Array(await response.arrayBuffer());
  // 국내 피드 일부는 EUC-KR — XML 선언의 encoding 을 따른다
  const head = new TextDecoder('ascii').decode(bytes.slice(0, 200));
  const encoding = /encoding=["']([\w-]+)["']/i.exec(head)?.[1]?.toLowerCase() ?? 'utf-8';
  let text: string;
  try {
    text = new TextDecoder(encoding).decode(bytes);
  } catch {
    text = new TextDecoder('utf-8').decode(bytes);
  }
  return { status: response.status, text };
}

export const fetchRss: RssFetcher = async (url) => {
  const { status, text } = await fetchRssRaw(url);
  if (status < 200 || status >= 300) throw new Error(`HTTP ${status}`);
  return text;
};

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decodeText(raw: string): string {
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&#x([0-9a-f]+);/gi, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, name: string) => ENTITIES[name.toLowerCase()] ?? m)
    .replace(/\s+/g, ' ')
    .trim();
}

function tag(block: string, name: string): string | null {
  const m = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, 'i').exec(block);
  return m ? m[1] : null;
}

/** RSS `<item>` · Atom `<entry>` → 글 목록(앞에서 limit 개). 제목이 없으면 「제목 없음」(원본과 같음) */
export function parseFeed(xml: string, source: string, foreign: boolean, limit = PER_SOURCE): BriefNewsItem[] {
  const blocks = [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map((m) => m[1]);
  const entries = blocks.length ? blocks : [...xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)].map((m) => m[1]);
  const items: BriefNewsItem[] = [];
  for (const block of entries.slice(0, limit)) {
    const title = decodeText(tag(block, 'title') ?? '') || '제목 없음';
    const linkText = tag(block, 'link');
    const link = linkText ? decodeText(linkText) : (/<link\b[^>]*href=["']([^"']+)["']/i.exec(block)?.[1] ?? '');
    const when = tag(block, 'pubDate') ?? tag(block, 'published') ?? tag(block, 'updated') ?? tag(block, 'dc:date');
    const ms = when ? Date.parse(decodeText(when)) : NaN;
    items.push({ title, source, link, publishedAt: Number.isFinite(ms) ? new Date(ms).toISOString() : null, foreign });
  }
  return items;
}

async function fromSource(src: RssSource, foreign: boolean, fetcher: RssFetcher, now: number): Promise<{ items: BriefNewsItem[]; result: RssResult }> {
  try {
    const items = parseFeed(await fetcher(src.url), src.source, foreign);
    // 원본: 글이 0개인 피드는 죽은 것으로 본다(빈 응답으로 조용히 죽은 이력). 글은 있는데 모두 72시간 넘은 것은 실패가 아니다(소스가 묵었다는 신호)
    const f = freshNews(items, now);
    return {
      items: f.kept,
      result: { source: src.source, ok: items.length > 0, count: f.kept.length, error: items.length ? null : '글 0개', total: items.length, stale: f.stale, noDate: f.noDate, newest: f.newest },
    };
  } catch (error) {
    return { items: [], result: { source: src.source, ok: false, count: 0, error: (error as Error).message || '받기 실패' } };
  }
}

/** 수집 상태에 보일 실패 이유 — 받기 함수의 영어 원문 대신 짧은 한국어(원문은 점검 명령 표 · 서버 로그) */
export function shortReason(raw: string | null | undefined): string {
  const e = String(raw ?? '');
  const http = /HTTP(?:\s*Error)?\s*(\d{3})/i.exec(e);
  if (http) return `HTTP ${http[1]}`;
  if (/timed?\s*out|timeout|시간\s*초과|TimeoutError|aborted due to timeout/i.test(e)) return '시간 초과';
  if (/refused|reset|ECONN|EAI_AGAIN|ENOTFOUND|getaddrinfo|Remote end closed|EOF|connection|fetch failed|socket|끊/i.test(e)) return '연결 끊김';
  if (/두 날|값 없음|글 0개/.test(e)) return e;
  return e ? '받기 실패' : '이유 모름';
}

/**
 * 후보를 차례로 — 첫 성공의 글 · 결과(이름 = 쓴 후보). 모두 실패면 이름 「대체 소스」 · 후보마다 짧은 이유를 모아 한 줄.
 * 받았어도 72시간 안 글이 0건이면 다음 후보로 간다(대체 자리는 오늘 글을 채우려고 있다).
 */
async function fromCandidates(candidates: RssSource[], foreign: boolean, fetcher: RssFetcher, now: number): Promise<{ items: BriefNewsItem[]; result: RssResult & { slot: true } }> {
  const errors: string[] = [];
  const skipped = { skippedTotal: 0, skippedStale: 0, skippedNoDate: 0 };
  let stalest: RssResult | null = null; // 받았지만 모두 묵은 후보 가운데 가장 최근 글이 있는 것
  for (const c of candidates) {
    const got = await fromSource(c, foreign, fetcher, now);
    if (got.result.ok && got.result.count > 0) return { items: got.items, result: { ...got.result, ...skipped, slot: true, error: errors.length ? errors.join(' · ') : null } };
    if (got.result.ok) {
      skipped.skippedTotal += got.result.total ?? 0;
      skipped.skippedStale += got.result.stale ?? 0;
      skipped.skippedNoDate += got.result.noDate ?? 0;
      if (!stalest || (got.result.newest ?? '') > (stalest.newest ?? '')) stalest = got.result;
    }
    errors.push(`${c.source}(${got.result.ok ? '모두 72시간 넘음' : shortReason(got.result.error)})`);
  }
  // 받은 후보가 있으면 실패가 아니다 — 묵은 소스와 같이 「0건(모두 72시간 넘음 — 최신)」(그 후보의 수는 자기 줄에 · 나머지는 skipped)
  if (stalest) {
    const own = { skippedTotal: skipped.skippedTotal - (stalest.total ?? 0), skippedStale: skipped.skippedStale - (stalest.stale ?? 0), skippedNoDate: skipped.skippedNoDate - (stalest.noDate ?? 0) };
    return { items: [], result: { ...stalest, ...own, slot: true, error: errors.join(' · ') } };
  }
  return { items: [], result: { source: '대체 소스', ok: false, count: 0, error: `후보 모두 실패 — ${errors.join(' · ')}`, slot: true } };
}

/** 소스들을 나란히 받는다 — 결과 순서는 소스 순서 그대로 */
async function collect(sources: RssSource[], foreign: boolean, fetcher: RssFetcher, now: number) {
  const all = await Promise.all(sources.map((s) => fromSource(s, foreign, fetcher, now)));
  return { items: all.flatMap((a) => a.items), results: all.map((a) => a.result) };
}

export interface NewsCollection {
  domestic: BriefNewsItem[];
  foreign: BriefNewsItem[];
  /** slot = 후보 자리(해외 4번째) — 성공이면 error 에 앞 후보들의 실패 이유 */
  results: (RssResult & { foreign: boolean; fallback: boolean; slot?: boolean })[];
}

/**
 * 오전판 = 국내 + 해외 · 오후판 = 국내만(원본 오후 프롬프트는 국내 뉴스만 쓴다 — 쓰지 않는 해외는 받지 않는다).
 * now = 브리핑 만드는 시각(72시간 거르기 기준).
 */
export async function collectNews(withForeign: boolean, fetcher: RssFetcher = fetchRss, now = Date.now()): Promise<NewsCollection> {
  const [dom, fgn, slot] = await Promise.all([
    collect(DOMESTIC_RSS, false, fetcher, now),
    withForeign ? collect(FOREIGN_RSS, true, fetcher, now) : Promise.resolve({ items: [], results: [] as RssResult[] }),
    withForeign ? fromCandidates(FOREIGN_SLOT_CANDIDATES, true, fetcher, now) : Promise.resolve(null),
  ]);
  const results: NewsCollection['results'] = [
    ...dom.results.map((r) => ({ ...r, foreign: false, fallback: false })),
    ...fgn.results.map((r) => ({ ...r, foreign: true, fallback: false })),
    ...(slot ? [{ ...slot.result, foreign: true, fallback: false }] : []),
  ];
  let domestic = dom.items;
  // 폴백은 거르기 뒤 국내 글이 0건일 때 — 4곳이 모두 실패했거나, 받았어도 모두 72시간 넘었을 때(AI 에게 줄 국내 뉴스가 없다는 같은 뜻)
  if (!domestic.length) {
    const fb = await fromSource(DOMESTIC_FALLBACK, false, fetcher, now);
    domestic = fb.items;
    results.push({ ...fb.result, foreign: false, fallback: true });
  }
  return { domestic, foreign: [...fgn.items, ...(slot?.items ?? [])], results };
}
