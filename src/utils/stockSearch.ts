import type { StockSearchResult } from '../types/toss';

/**
 * 종목 검색 API 호출 — 자동완성과 "즉시 확정"이 같은 경로를 쓰게 모아 둔다.
 *
 * ⚠️ 자동완성은 입력이 멎기를 180ms 기다렸다가 검색한다. 그래서 사용자가 "구글" 을
 * 치고 **곧바로** Enter(또는 [추가])를 누르면 결과가 아직 없어, 예전에는 아무 일도
 * 일어나지 않았다 — 화면에는 "한글 검색이 안 된다" 로 보인다.
 * 확정 시점에는 이 함수로 직접 한 번 더 물어 결과를 기다린다.
 */
export async function searchStocksApi(query: string): Promise<StockSearchResult[]> {
  const q = query.trim();
  if (!q) return [];

  const response = await fetch(`/api/stocks/search?q=${encodeURIComponent(q)}`);
  if (!response.ok) return [];

  const payload = (await response.json()) as { results?: StockSearchResult[] };
  return Array.isArray(payload.results) ? payload.results : [];
}

/** 한글이 섞여 있으면 심볼일 수 없다 — 검색으로 심볼을 찾아야 한다. */
export function hasHangul(text: string): boolean {
  return /[가-힣]/.test(text);
}
