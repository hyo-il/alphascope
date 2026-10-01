import { useCallback, useEffect, useState } from 'react';

/**
 * 내가 지정한 종목 — 하루 1번 Gemini 분석 (v2.23.0, `server/gemini/scheduled.ts`).
 *
 * 폴링하지 않는다 — 상태는 하루 한 번 바뀐다. 화면을 열 때 한 번 받고, 저장·실행 뒤 다시 받는다.
 * 「지금 한 번 실행」 중에만 5초마다 끝났는지 본다.
 */

export interface ScheduledRun {
  baseDate: string;
  startedAt: string;
  finishedAt: string | null;
  trigger: 'schedule' | 'manual';
  done: { symbol: string; signal: string; confidence: number }[];
  failed: { symbol: string; error: string }[];
  skipped: string[];
  rateLimited: boolean;
}

export interface ScheduledStatus {
  symbols: string[];
  max: number;
  running: boolean;
  disabledReason: string | null;
  lastBaseDate: string | null;
  last: ScheduledRun | null;
  nextRunAt: string | null;
}

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({}) as Record<string, unknown>);
  if (!response.ok) throw new Error((payload as { error?: string }).error ?? `요청 실패 (${response.status})`);
  return payload as T;
}

export function useScheduledSymbols() {
  const [status, setStatus] = useState<ScheduledStatus | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setStatus(await json<ScheduledStatus>('/api/gemini/scheduled'));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // 즉시 실행 중일 때만 끝났는지 본다
  useEffect(() => {
    if (!status?.running) return;
    const timer = setInterval(() => void reload(), 5000);
    return () => clearInterval(timer);
  }, [status?.running, reload]);

  /** 실패는 throw — 화면이 서버 문구를 그대로 보여 준다 */
  const save = useCallback(async (symbols: string[]) => {
    const next = await json<ScheduledStatus>('/api/gemini/scheduled', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ symbols }),
    });
    setStatus(next);
    return next;
  }, []);

  const runNow = useCallback(async () => {
    const next = await json<ScheduledStatus>('/api/gemini/scheduled/run', { method: 'POST' });
    setStatus(next);
  }, []);

  return { status, error, reload, save, runNow };
}
