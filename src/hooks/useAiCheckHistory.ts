import { useCallback, useEffect, useRef, useState } from 'react';
import type { AiCheckHistory } from '../types/aiCheck';

/**
 * 계좌 하나의 「AI 검증 기록」 (v2.46.0) — `GET /api/ai-check/records`. 폴링하지 않는다(판단은 종목마다 하루 한 번).
 * `accountId` 가 'all' 이면 모든 계좌(v2.47.0 「검증 기록 > AI 검증」 — 켬/끔은 읽지 않는다).
 * 탭을 보일지 정하려고 이 계좌의 AI 검증 켬/끔도 함께 읽는다(기록이 하나라도 있거나 켜져 있을 때만 탭을 보인다).
 * `version` 이 바뀌면(주문·탭 열기) 다시 받는다. `limit` 를 늘리면 [더 보기].
 */
export function useAiCheckHistory(accountId: number | 'all' | null, version = 0) {
  const [data, setData] = useState<AiCheckHistory | null>(null);
  const [aiCheckOn, setAiCheckOn] = useState(false);
  const [limit, setLimit] = useState(50);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  // 계좌가 바뀌면 처음부터
  useEffect(() => {
    setData(null);
    setLimit(50);
    setError(null);
  }, [accountId]);

  const load = useCallback(async () => {
    if (accountId == null) return;
    const mine = ++seq.current;
    setLoading(true);
    try {
      const query = accountId === 'all' ? `limit=${limit}` : `accountId=${accountId}&limit=${limit}`;
      const [records, strategy] = await Promise.all([
        fetch(`/api/ai-check/records?${query}`).then(async (r) => {
          const body = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error((body as { error?: string }).error ?? `기록을 불러오지 못했습니다 (${r.status})`);
          return body as AiCheckHistory;
        }),
        (accountId === 'all'
          ? Promise.resolve({})
          : fetch(`/api/auto-trading/strategies/${accountId}`)
              .then((r) => r.json())
              .catch(() => ({}))) as Promise<{ strategy?: { aiCheck?: boolean } }>,
      ]);
      if (mine !== seq.current) return;
      setData(records);
      setAiCheckOn(Boolean(strategy.strategy?.aiCheck));
      setError(null);
    } catch (e) {
      if (mine === seq.current) setError((e as Error).message);
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, [accountId, limit]);

  useEffect(() => {
    void load();
  }, [load, version]);

  return {
    data,
    loading,
    error,
    /** 탭을 보일지 — 기록이 있거나 AI 검증이 켜져 있으면 */
    visible: (data?.total ?? 0) > 0 || aiCheckOn,
    more: () => setLimit((n) => n + 50),
    reload: load,
  };
}
