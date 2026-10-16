import { useCallback, useEffect, useRef, useState } from 'react';
import { HISTORY_DAYS_PAGE, type BuyJudgeDays, type BuyJudgeHistory, type BuyJudgeState, type HistoryDay, type JudgeDay, type Retention } from '../types/buyJudge';

/**
 * 매수 판단 (v2.45.0) — 서버 `GET|POST|PUT /api/buy-judge*` 만 부른다(설정을 브라우저에 두지 않는다 — 기기가 달라도 같은 목록·규칙).
 * 폴링하지 않는다 — 처음 한 번, [실행], 목록·규칙을 바꿀 때 다시 받는다. 판단은 하루 한 번(마감) 바뀐다.
 * `recalc`·`setSymbols`·`setRule` 은 새 상태를 돌려준다(화면이 완료 알림에 종목 수를 적는다).
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

  const run = useCallback(async (label: string, task: () => Promise<BuyJudgeState>): Promise<BuyJudgeState> => {
    const mine = ++seq.current;
    setBusy(label);
    try {
      const next = await task();
      if (mine === seq.current) {
        setState(next);
        setError(null);
      }
      return next;
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

  const recalc = useCallback(() => run('실행 중…', () => json<BuyJudgeState>('/api/buy-judge/recalc', { method: 'POST' })), [run]);
  const setSymbols = useCallback(
    (symbols: string[]) =>
      run('종목을 바꾸고 실행 중…', async () => {
        await put('/api/buy-judge/settings', { symbols });
        return json<BuyJudgeState>('/api/buy-judge');
      }),
    [run],
  );
  const setRule = useCallback(
    (ruleId: number | null) =>
      run('규칙을 바꾸고 실행 중…', async () => {
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

/** 날짜별 히스토리 (v2.48.0) — 30일씩, [더 보기] 로 이어 받는다. `reload` 는 처음 30일부터 다시 */
export function useBuyJudgeDays() {
  const [days, setDays] = useState<HistoryDay[] | null>(null);
  const [totalDays, setTotalDays] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(async () => {
    try {
      const r = await json<BuyJudgeDays>(`/api/buy-judge/days?offset=0&limit=${HISTORY_DAYS_PAGE}`);
      setDays(r.days);
      setTotalDays(r.totalDays);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void reload();
  }, [reload]);
  const more = useCallback(async () => {
    setLoadingMore(true);
    try {
      const r = await json<BuyJudgeDays>(`/api/buy-judge/days?offset=${days?.length ?? 0}&limit=${HISTORY_DAYS_PAGE}`);
      setDays((prev) => [...(prev ?? []), ...r.days]);
      setTotalDays(r.totalDays);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }, [days]);
  return { days, totalDays, loadingMore, error, reload, more };
}

export const fetchJudgeDays = (symbol: string) => json<{ days: JudgeDay[] }>(`/api/buy-judge/history/${encodeURIComponent(symbol)}`).then((r) => r.days);

/** 보관 기간 — `dryRun` 이면 지워질 줄 수만 */
export const retentionPreview = (r: Retention) =>
  json<{ willDelete: number }>(`/api/buy-judge/retention?dryRun=1`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ retention: r }) }).then((x) => x.willDelete);
export const applyRetention = (r: Retention) => put('/api/buy-judge/retention', { retention: r }).then((x) => (x as { deleted: number }).deleted);
export const fetchRetention = () => json<{ retention: Retention }>('/api/buy-judge/retention').then((s) => s.retention);
