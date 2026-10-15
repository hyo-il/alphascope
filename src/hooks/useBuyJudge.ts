import { useCallback, useEffect, useRef, useState } from 'react';
import type { BuyJudgeHistory, BuyJudgeState, JudgeDay, Retention } from '../types/buyJudge';

/**
 * 매수 판단 (v2.45.0) — 서버 `GET|POST|PUT /api/buy-judge*` 만 부른다(설정을 브라우저에 두지 않는다 — 기기가 달라도 같은 목록·규칙).
 * 폴링하지 않는다 — 처음 한 번, [다시 계산], 목록·규칙을 바꿀 때 다시 받는다. 판단은 하루 한 번(마감) 바뀐다.
 */
async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({}) as Record<string, unknown>);
  if (!response.ok) throw new Error((payload as { error?: string }).error ?? `요청 실패 (${response.status})`);
  return payload as T;
}
const put = (url: string, body: unknown) => json(url, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export function useBuyJudge() {
  const [state, setState] = useState<BuyJudgeState | null>(null);
  /** 무엇을 하는 중인지 — 로딩 표시 문구 */
  const [busy, setBusy] = useState<string | null>('판단을 계산하는 중…');
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);

  const run = useCallback(async (label: string, task: () => Promise<BuyJudgeState>) => {
    const mine = ++seq.current;
    setBusy(label);
    try {
      const next = await task();
      if (mine === seq.current) {
        setState(next);
        setError(null);
      }
    } catch (e) {
      if (mine === seq.current) setError((e as Error).message);
      throw e;
    } finally {
      if (mine === seq.current) setBusy(null);
    }
  }, []);

  const load = useCallback(() => run('판단을 계산하는 중…', () => json<BuyJudgeState>('/api/buy-judge')), [run]);
  useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  const recalc = useCallback(() => run('다시 계산하는 중…', () => json<BuyJudgeState>('/api/buy-judge/recalc', { method: 'POST' })), [run]);
  const setSymbols = useCallback(
    (symbols: string[]) =>
      run('종목을 바꾸고 다시 계산하는 중…', async () => {
        await put('/api/buy-judge/settings', { symbols });
        return json<BuyJudgeState>('/api/buy-judge');
      }),
    [run],
  );
  const setRule = useCallback(
    (ruleId: number | null) =>
      run('규칙을 바꾸고 다시 계산하는 중…', async () => {
        await put('/api/buy-judge/settings', { ruleId });
        return json<BuyJudgeState>('/api/buy-judge');
      }),
    [run],
  );

  return { state, busy, error, load, recalc, setSymbols, setRule };
}

export function useBuyJudgeHistory() {
  const [data, setData] = useState<BuyJudgeHistory | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    setLoading(true);
    try {
      setData(await json<BuyJudgeHistory>('/api/buy-judge/history'));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  const clear = useCallback(
    async (scope: 'all' | 'nonBuy') => {
      const r = await json<{ deleted: number }>(`/api/buy-judge/history?scope=${scope}`, { method: 'DELETE' });
      await reload();
      return r.deleted;
    },
    [reload],
  );
  return { data, loading, error, reload, clear };
}

export const fetchJudgeDays = (symbol: string) => json<{ days: JudgeDay[] }>(`/api/buy-judge/history/${encodeURIComponent(symbol)}`).then((r) => r.days);

/** 보관 기간 — `dryRun` 이면 지워질 줄 수만 */
export const retentionPreview = (r: Retention) =>
  json<{ willDelete: number }>(`/api/buy-judge/retention?dryRun=1`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ retention: r }) }).then((x) => x.willDelete);
export const applyRetention = (r: Retention) => put('/api/buy-judge/retention', { retention: r }).then((x) => (x as { deleted: number }).deleted);
export const fetchRetention = () => json<{ retention: Retention }>('/api/buy-judge/retention').then((s) => s.retention);
