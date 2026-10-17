import { useCallback, useEffect, useState } from 'react';
import type { RuleBody, TradingRule } from '../types/tradingRule';

/**
 * 매매 규칙 목록 (「퀀트 > 매매 규칙」). 서버 `/api/rules` 만 부른다 — 화면에 저장소를 두지 않는다.
 * 폴링하지 않는다(이 화면에서만 바뀐다). 실패는 던진다 — 호출한 쪽이 서버 문구 그대로 알린다.
 */
async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `요청 실패 (${res.status})`);
  return data;
}

const json = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export function useTradingRules() {
  const [rules, setRules] = useState<TradingRule[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const data = await call<{ rules: TradingRule[] }>('/api/rules');
      setRules(data.rules);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const create = useCallback(
    async (name: string, rule: RuleBody) => {
      const data = await call<{ rule: TradingRule }>('/api/rules', json('POST', { name, rule }));
      await reload();
      return data.rule;
    },
    [reload],
  );

  const update = useCallback(
    async (id: number, name: string, rule: RuleBody) => {
      const data = await call<{ rule: TradingRule }>(`/api/rules/${id}`, json('PUT', { name, rule }));
      await reload();
      return data.rule;
    },
    [reload],
  );

  const remove = useCallback(
    async (id: number) => {
      await call(`/api/rules/${id}`, { method: 'DELETE' });
      await reload();
    },
    [reload],
  );

  const copy = useCallback(
    async (id: number) => {
      const data = await call<{ rule: TradingRule }>(`/api/rules/${id}/copy`, { method: 'POST' });
      await reload();
      return data.rule;
    },
    [reload],
  );

  return { rules, error, reload, create, update, remove, copy };
}
