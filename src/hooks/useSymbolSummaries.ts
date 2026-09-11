import { useEffect, useState } from 'react';
import type { SymbolSummary } from '../types/analysis';

/**
 * 여러 종목의 지표·재무 요약을 한 번에 가져온다 (`GET /api/summary`).
 * 보유 주식 분석과 종목 비교 모드·비교 화면에서 쓴다.
 * `nonce` 를 바꾸면 같은 종목이라도 다시 받는다 (비교 화면의 [새로고침]).
 */
export function useSymbolSummaries(symbols: string[], nonce = 0) {
  const [summaries, setSummaries] = useState<SymbolSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 배열은 매 렌더 새 참조라, 내용으로 의존성을 만든다.
  const key = symbols.join(',');

  useEffect(() => {
    if (!key) {
      setSummaries([]);
      setError(null);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setError(null);

    fetch(`/api/summary?symbols=${key}`, { signal: controller.signal })
      .then((res) => res.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setSummaries(data.summaries ?? []);
      })
      .catch((e: unknown) => {
        if (e instanceof DOMException && e.name === 'AbortError') return;
        setError(e instanceof Error ? e.message : String(e));
        setSummaries([]);
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, nonce]);

  return { summaries, loading, error };
}
