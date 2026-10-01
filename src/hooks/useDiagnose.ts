import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  DiagnoseDetail,
  DiagnoseListItem,
  DiagnoseProgress,
} from '../types/diagnose';

/**
 * 진단 리포트 화면용 훅.
 *
 * 실행은 서버가 시작만 하고 돌려준다(오라클 52초). 실행 중일 때만 진행률을 폴링하고,
 * 끝나면 목록을 다시 읽어 새 리포트를 고른다 — 급등 탐지(`useSurge`)와 같은 방식이다.
 */

async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({}) as Record<string, unknown>);
  if (!response.ok) throw new Error((payload as { error?: string }).error ?? `요청 실패 (${response.status})`);
  return payload as T;
}

const PROGRESS_POLL_MS = 1500;

export function useDiagnoseReports() {
  const [reports, setReports] = useState<DiagnoseListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const data = await json<{ reports: DiagnoseListItem[] }>('/api/diagnose/reports');
      setReports(data.reports);
      setError(null);
      return data.reports;
    } catch (e) {
      setError((e as Error).message);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return { reports, loading, error, reload };
}

export function useDiagnose() {
  const { reports, loading, error: listError, reload } = useDiagnoseReports();
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<DiagnoseDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [progress, setProgress] = useState<DiagnoseProgress | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const wasRunning = useRef(false);

  // 처음에는 가장 최근 리포트
  const effectiveId = selectedId ?? reports[0]?.id ?? null;
  const selected = reports.find((r) => r.id === effectiveId) ?? null;

  // 상세는 고른 것만 받는다 (한 건에 100KB 안팎)
  useEffect(() => {
    if (effectiveId == null) {
      setDetail(null);
      return;
    }
    let alive = true;
    setDetail(null);
    setDetailError(null);
    json<{ detail: DiagnoseDetail }>(`/api/diagnose/reports/${effectiveId}`)
      .then((data) => alive && setDetail(data.detail))
      .catch((e: Error) => alive && setDetailError(e.message));
    return () => {
      alive = false;
    };
  }, [effectiveId]);

  // 다른 탭·기기에서 이미 돌고 있을 수 있다
  useEffect(() => {
    void json<{ progress: DiagnoseProgress }>('/api/diagnose/progress')
      .then((data) => setProgress(data.progress))
      .catch(() => undefined);
  }, []);

  // 실행 중일 때만 폴링한다
  useEffect(() => {
    if (!progress?.running) {
      if (wasRunning.current) {
        wasRunning.current = false;
        if (progress?.error) setRunError(progress.error);
        const finished = progress?.reportId ?? null;
        void reload().then(() => {
          if (finished != null) setSelectedId(finished);
        });
      }
      return;
    }
    wasRunning.current = true;
    const timer = setInterval(async () => {
      try {
        const data = await json<{ progress: DiagnoseProgress }>('/api/diagnose/progress');
        setProgress(data.progress);
      } catch {
        // 다음 주기에 다시 시도한다
      }
    }, PROGRESS_POLL_MS);
    return () => clearInterval(timer);
  }, [progress?.running, progress?.error, progress?.reportId, reload]);

  /**
   * 리포트 삭제 — 지운 뒤에는 남은 것 중 가장 최근 것을 보여 준다(없으면 빈 상태).
   * 실패는 throw 한다 — 화면이 토스트로 알린다.
   */
  const remove = useCallback(
    async (id: number) => {
      await json<{ ok: true }>(`/api/diagnose/reports/${id}`, { method: 'DELETE' });
      setSelectedId(null);
      await reload();
    },
    [reload],
  );

  const run = useCallback(async () => {
    setRunError(null);
    try {
      const data = await json<{ progress: DiagnoseProgress }>('/api/diagnose/run', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({}),
      });
      setProgress(data.progress);
    } catch (e) {
      setRunError((e as Error).message);
    }
  }, []);

  return {
    reports,
    loading,
    listError,
    selected,
    select: setSelectedId,
    detail,
    detailError,
    progress,
    runError,
    run,
    remove,
  };
}
