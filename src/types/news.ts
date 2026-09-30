/** 종목 뉴스 + AI 긍정/부정 (v2.18.0) — 서버 `server/news.ts` 와 차트 하단 「뉴스」 탭이 함께 쓴다 */

export interface NewsItem {
  title: string;
  publisher: string | null;
  link: string;
  publishedAt: string | null;
}

export interface NewsList {
  symbol: string;
  /** yfinance 경로 — ticker(종목 뉴스) / search(검색 + 관련 종목 필터) / none(없음) */
  source: 'ticker' | 'search' | 'none';
  items: NewsItem[];
  fetchedAt: string;
}

export type Sentiment = '긍정' | '부정' | '중립';
export type OverallSentiment = Sentiment | '판단 불가';

export interface NewsJudgment {
  /** index 는 1부터 — 목록의 [번호] */
  articles: { index: number; sentiment: Sentiment; reason: string }[];
  overall: OverallSentiment;
  summary: string;
  citedIndexes: number[];
  /** 입력 범위 밖이라 버린 항목 수 (기사 판정 + 근거 번호) */
  dropped: number;
}

export interface NewsAnalysis {
  news: NewsList;
  judgment: NewsJudgment;
  model: string;
  promptVersion: string;
}
