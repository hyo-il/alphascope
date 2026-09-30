/**
 * 종목 뉴스 + AI 긍정/부정 (v2.18.0) — 차트 하단 「뉴스」 탭.
 *
 * - 목록: 지표 엔진 `/news?symbol=`(yfinance — 제목·발행처·링크·시각만), 서버 **30분 캐시**.
 * - AI 판정: **사용자가 버튼을 눌렀을 때만** Gemini 를 부른다(무료 한도를 자동매매와 공유한다 — 자동 호출 금지).
 *   ⚠️ 입력은 **제목·발행처·시각·링크만**이다. 본문을 긁어 오지 않는다.
 *   ⚠️ 응답은 `responseSchema` 로 강제하고, 서버가 **인용 번호를 검증**한다 — 입력 범위(1..N) 밖의 기사 번호·근거 번호는
 *   버리고 "검증 실패 항목 N개 제외" 로 알린다. 모델이 없는 기사를 지어내도 화면에 실리지 않는다.
 *   ⚠️ **자동매매에 연결하지 않는다**(검증 전). 판정은 `news_sentiment` 에 저장해 두고 나중에 적중을 잰다.
 */

import { getDb } from './db';
import type { NewsAnalysis, NewsItem, NewsJudgment, NewsList, Sentiment } from '../src/types/news';
import { callGemini, type GeminiCallOptions, type GeminiCallResult } from './gemini/client';

const ENGINE_URL = process.env.INDICATORS_URL ?? `http://127.0.0.1:${process.env.INDICATORS_PORT ?? 5001}`;
const CACHE_MS = 30 * 60_000;
/** 뉴스 판정 프롬프트 버전 — 프롬프트·스키마를 고치면 올린다 */
export const NEWS_PROMPT_VERSION = 'news-v1';

const cache = new Map<string, { at: number; data: NewsList }>();

export async function getNews(symbol: string): Promise<NewsList> {
  const hit = cache.get(symbol);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;
  const response = await fetch(`${ENGINE_URL}/news?symbol=${encodeURIComponent(symbol)}`, {
    signal: AbortSignal.timeout(60_000),
  });
  const payload = (await response.json().catch(() => ({}))) as {
    items?: NewsItem[];
    source?: NewsList['source'];
    error?: string;
  };
  if (!response.ok || !payload.items) throw new Error(payload.error ?? `지표 엔진 응답 ${response.status}`);
  const data: NewsList = {
    symbol,
    source: payload.source ?? 'none',
    items: payload.items.slice(0, 10),
    fetchedAt: new Date().toISOString(),
  };
  cache.set(symbol, { at: Date.now(), data });
  return data;
}

// ── AI 판정 ─────────────────────────────────────────────────────────────────

const SENTIMENTS: Sentiment[] = ['긍정', '부정', '중립'];
const OVERALLS = ['긍정', '부정', '중립', '판단 불가'] as const;

interface RawJudgment {
  articles?: { index?: number; sentiment?: string; reason?: string }[];
  overall?: string;
  summary?: string;
  citedIndexes?: number[];
}

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    articles: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          index: { type: 'INTEGER', description: '기사 번호 (입력의 [번호])' },
          sentiment: { type: 'STRING', enum: SENTIMENTS },
          reason: { type: 'STRING', description: '한 문장. 제목에 있는 말만으로' },
        },
        required: ['index', 'sentiment', 'reason'],
      },
    },
    overall: { type: 'STRING', enum: [...OVERALLS] },
    summary: { type: 'STRING', description: '두세 문장 한국어 요약. 제목에 있는 사실만' },
    citedIndexes: { type: 'ARRAY', items: { type: 'INTEGER' }, description: '종합 판정의 근거가 된 기사 번호' },
  },
  required: ['articles', 'overall', 'summary', 'citedIndexes'],
};

const SYSTEM = [
  '너는 주식 뉴스 제목을 읽고 이 종목에 긍정적인지 부정적인지 분류하는 보조자다.',
  '- 입력은 기사 **제목·발행처·시각·링크뿐**이다. 본문은 없다.',
  '- 주어진 제목에 없는 사실·숫자·사건을 쓰지 말 것. 모르면 reason 을 "제목만으로 판단 불가" 로 쓰고 sentiment 는 "중립".',
  '- 이 종목과 관계가 약한 기사는 "중립".',
  '- 기사마다 index 는 입력의 [번호] 그대로 쓴다. 없는 번호를 만들지 않는다.',
  '- 종합 판정(overall)은 근거 기사 번호(citedIndexes)를 반드시 적는다. 근거가 부족하면 "판단 불가".',
  '- 한국어로 쓴다. 매수·매도 권유를 하지 않는다(투자 조언이 아니다).',
].join('\n');

/** 인용 검증 — 입력 범위 밖이거나 중복·형식 오류인 항목을 버린다 */
export function validateJudgment(raw: RawJudgment, count: number): NewsJudgment {
  let dropped = 0;
  const seen = new Set<number>();
  const articles: NewsJudgment['articles'] = [];
  for (const a of raw.articles ?? []) {
    const index = Number(a.index);
    const valid =
      Number.isInteger(index) && index >= 1 && index <= count && !seen.has(index) && SENTIMENTS.includes(a.sentiment as Sentiment);
    if (!valid) {
      dropped += 1;
      continue;
    }
    seen.add(index);
    articles.push({ index, sentiment: a.sentiment as Sentiment, reason: String(a.reason ?? '').slice(0, 300) });
  }
  const cited: number[] = [];
  for (const i of raw.citedIndexes ?? []) {
    const n = Number(i);
    if (Number.isInteger(n) && n >= 1 && n <= count && !cited.includes(n)) cited.push(n);
    else dropped += 1;
  }
  let overall = (OVERALLS as readonly string[]).includes(String(raw.overall)) ? (raw.overall as NewsJudgment['overall']) : '판단 불가';
  // 근거가 하나도 남지 않은 종합 판정은 믿지 않는다
  if (overall !== '판단 불가' && cited.length === 0) overall = '판단 불가';
  articles.sort((a, b) => a.index - b.index);
  return { articles, overall, summary: String(raw.summary ?? '').slice(0, 600), citedIndexes: cited, dropped };
}

type Caller = (options: GeminiCallOptions) => Promise<GeminiCallResult<RawJudgment>>;

/**
 * 버튼을 눌렀을 때만 부른다(라우트가 먼저 GEMINI 가용성을 확인한다).
 * `caller` 는 점검용으로 바꿔 끼울 수 있다(실제 호출 없이 인용 검증 확인).
 */
export async function analyzeNews(
  symbol: string,
  caller: Caller = (o) => callGemini<RawJudgment>(o),
): Promise<NewsAnalysis> {
  const news = await getNews(symbol);
  if (!news.items.length) throw new Error('판정할 뉴스가 없습니다.');
  const lines = news.items.map(
    (n, i) => `[${i + 1}] ${n.title} — ${n.publisher ?? '발행처 미상'} · ${n.publishedAt ?? '시각 미상'} · ${n.link}`,
  );
  const result = await caller({
    system: SYSTEM,
    parts: [{ text: `종목: ${symbol}\n기사 ${news.items.length}건 (제목만):\n${lines.join('\n')}` }],
    schema: SCHEMA,
    temperature: 0.2,
  });
  const judgment = validateJudgment(result.data, news.items.length);
  getDb()
    .prepare(
      `INSERT INTO news_sentiment (symbol, created_at, input_json, output_json, prompt_version) VALUES (?, ?, ?, ?, ?)`,
    )
    .run(symbol, new Date().toISOString(), JSON.stringify(news.items), JSON.stringify({ raw: result.data, judgment }), NEWS_PROMPT_VERSION);
  return { news, judgment, model: result.model, promptVersion: NEWS_PROMPT_VERSION };
}
