import { useCallback, useEffect, useRef, useState } from 'react';
import type { BacktestListItem, BacktestProgress, BacktestReport } from '../types/backtest';

/**
 * 3년 백테스트 화면의 데이터 (v2.37.0) — 진단 리포트(`useDiagnose`)와 같은 방식:
 * 실행은 시작만 하고 **실행 중일 때만** 진행률을 1.5초마다 본다. 끝나면 목록을 다시 읽고 새 결과를 연다.
 */
async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const error = new Error((payload.error as string) ?? `요청 실패 (${response.status})`) as Error & { engineDown?: boolean };
    error.engineDown = payload.engineDown === true;
    throw error;
  }
  return payload as T;
}

export function useBacktest() {
  const [reports, setReports] = useState<BacktestListItem[] | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<(BacktestListItem & { detail: BacktestReport }) | null>(null);
  const [progress, setProgress] = useState<BacktestProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [engineDown, setEngineDown] = useState(false);
  const wasRunning = useRef(false);

  const loadList = useCallback(async (select?: number | null) => {
    try {
      const data = await json<{ reports: BacktestListItem[] }>('/api/backtest/reports');
      setReports(data.reports);
      setSelectedId((cur) => select ?? cur ?? data.reports[0]?.id ?? null);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void loadList();
    void json<{ progress: BacktestProgress }>('/api/backtest/progress')
      .then((d) => setProgress(d.progress))
      .catch(() => undefined);
  }, [loadList]);

  useEffect(() => {
    if (selectedId == null) {
      setDetail(null);
      return;
    }
    let alive = true;
    json<BacktestListItem & { detail: BacktestReport }>(`/api/backtest/reports/${selectedId}`)
      .then((d) => alive && setDetail(d))
      .catch((e) => alive && setError((e as Error).message));
    return () => {
      alive = false;
    };
  }, [selectedId]);

  // 실행 중일 때만 진행률을 본다
  useEffect(() => {
    if (!progress?.running) {
      if (wasRunning.current) {
        wasRunning.current = false;
        if (progress?.error) {
          setError(progress.error);
          setEngineDown(progress.engineDown);
        } else void loadList(progress?.reportId ?? null);
      }
      return;
    }
    wasRunning.current = true;
    const timer = setInterval(async () => {
      try {
        const d = await json<{ progress: BacktestProgress }>('/api/backtest/progress');
        setProgress(d.progress);
      } catch {
        /* 다음 주기에 다시 본다 */
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [progress?.running, progress?.error, progress?.engineDown, progress?.reportId, loadList]);

  /** 실패는 throw — 화면이 서버 문구 그대로 알린다 */
  const start = useCallback(
    async (force: boolean) => {
      setError(null);
      setEngineDown(false);
      try {
        const d = await json<{ progress: BacktestProgress }>(`/api/backtest/run${force ? '?force=1' : ''}`, { method: 'POST' });
        setProgress(d.progress);
        // 같은 날 결과가 있으면 서버가 계산 없이 그 결과 id 를 돌려준다
        if (!d.progress.running && d.progress.reportId != null) await loadList(d.progress.reportId);
      } catch (e) {
        setEngineDown(Boolean((e as { engineDown?: boolean }).engineDown));
        throw e;
      }
    },
    [loadList],
  );

  const remove = useCallback(
    async (id: number) => {
      await json(`/api/backtest/reports/${id}`, { method: 'DELETE' });
      if (selectedId === id) setSelectedId(null);
      await loadList(null);
    },
    [loadList, selectedId],
  );

  return { reports, selectedId, setSelectedId, detail, progress, error, engineDown, start, remove };
}
