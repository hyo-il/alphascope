/**
 * 오늘 시황 — 경제 뉴스 RSS (Stockproject `news_collector.py` 의 주소 · 개수 · 거르기 그대로).
 *
 * - 국내 4 + 해외 4. **국내가 한 건도 없을 때만** 국내 폴백 1(SBS 경제)을 부른다.
 * - 소스마다 최대 20건 · 제목 · 출처 · 링크 · 시각만(본문을 긁지 않는다 — `server/news.ts` 와 같은 원칙).
 * - 한 곳이 죽어도 나머지로 간다. 소스마다 성공 · 실패를 돌려준다(화면 「수집 상태」 — RSS 는 예고 없이 죽는다).
 * - 파서를 들이지 않는다 — 거래정지 RSS(`usHalts/feed.ts`)처럼 정규식으로 `<item>`(RSS) · `<entry>`(Atom)만 읽는다.
 * - 원본은 지표 엔진에 없는 `feedparser`(파이썬)를 썼다. 서버(Node)에서 받아 새 의존성을 두지 않는다.
 */

export interface RssSource {
  url: string;
  source: string;
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
  count: number;
  error: string | null;
}

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
  { url: 'https://finance.yahoo.com/news/rssindex', source: 'Yahoo Finance' },
];

/** 국내 RSS 가 전부 실패했을 때만 */
export const DOMESTIC_FALLBACK: RssSource = { url: 'https://news.sbs.co.kr/news/SectionRssFeed.do?sectionId=02', source: 'SBS 경제' };

export const PER_SOURCE = 20;
const TIMEOUT_MS = 15_000;

/** RSS 본문 받기 — 시험은 바꿔 끼운다(네트워크 0) */
export type RssFetcher = (url: string) => Promise<string>;

export const fetchRss: RssFetcher = async (url) => {
  const response = await fetch(url, {
    headers: { Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml', 'User-Agent': 'Mozilla/5.0 (AlphaScope personal use)' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  // 국내 피드 일부는 EUC-KR — XML 선언의 encoding 을 따른다
  const head = new TextDecoder('ascii').decode(bytes.slice(0, 200));
  const encoding = /encoding=["']([\w-]+)["']/i.exec(head)?.[1]?.toLowerCase() ?? 'utf-8';
  try {
    return new TextDecoder(encoding).decode(bytes);
  } catch {
    return new TextDecoder('utf-8').decode(bytes);
  }
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

async function fromSource(src: RssSource, foreign: boolean, fetcher: RssFetcher): Promise<{ items: BriefNewsItem[]; result: RssResult }> {
  try {
    const items = parseFeed(await fetcher(src.url), src.source, foreign);
    // 원본: 글이 0개인 피드는 죽은 것으로 본다(빈 응답으로 조용히 죽은 이력)
    return { items, result: { source: src.source, ok: items.length > 0, count: items.length, error: items.length ? null : '글 0개' } };
  } catch (error) {
    return { items: [], result: { source: src.source, ok: false, count: 0, error: (error as Error).message || '받기 실패' } };
  }
}

/** 소스들을 나란히 받는다 — 결과 순서는 소스 순서 그대로 */
async function collect(sources: RssSource[], foreign: boolean, fetcher: RssFetcher) {
  const all = await Promise.all(sources.map((s) => fromSource(s, foreign, fetcher)));
  return { items: all.flatMap((a) => a.items), results: all.map((a) => a.result) };
}

export interface NewsCollection {
  domestic: BriefNewsItem[];
  foreign: BriefNewsItem[];
  results: (RssResult & { foreign: boolean; fallback: boolean })[];
}

/** 오전판 = 국내 + 해외 · 오후판 = 국내만(원본 오후 프롬프트는 국내 뉴스만 쓴다 — 쓰지 않는 해외는 받지 않는다) */
export async function collectNews(withForeign: boolean, fetcher: RssFetcher = fetchRss): Promise<NewsCollection> {
  const [dom, fgn] = await Promise.all([
    collect(DOMESTIC_RSS, false, fetcher),
    withForeign ? collect(FOREIGN_RSS, true, fetcher) : Promise.resolve({ items: [], results: [] as RssResult[] }),
  ]);
  const results: NewsCollection['results'] = [
    ...dom.results.map((r) => ({ ...r, foreign: false, fallback: false })),
    ...fgn.results.map((r) => ({ ...r, foreign: true, fallback: false })),
  ];
  let domestic = dom.items;
  if (!domestic.length) {
    const fb = await fromSource(DOMESTIC_FALLBACK, false, fetcher);
    domestic = fb.items;
    results.push({ ...fb.result, foreign: false, fallback: true });
  }
  return { domestic, foreign: fgn.items, results };
}
