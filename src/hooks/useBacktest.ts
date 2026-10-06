import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  BacktestAdvice,
  BacktestAnyReport,
  BacktestExplain,
  BacktestInput,
  BacktestListItem,
  BacktestProgress,
  BacktestUniverse,
} from '../types/backtest';

/**
 * 「실험실 > 백테스트」 데이터 (v2.38.0) — 진단 리포트(`useDiagnose`)와 같은 방식:
 * 실행은 시작만 하고 **실행 중일 때만** 진행률을 1초마다 본다. 화면을 떠났다 와도 서버 진행률을 읽어 이어 보인다.
 * 끝나면 목록을 다시 읽고 새 결과를 연다(`finished` 로 화면이 알림·스크롤).
 */
export async function backtestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    const error = new Error((payload.error as string) ?? `요청 실패 (${response.status})`) as Error & { engineDown?: boolean };
    error.engineDown = payload.engineDown === true;
    throw error;
  }
  return payload as T;
}

const post = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export type BacktestDetail = BacktestListItem & { detail: BacktestAnyReport };

export function useBacktest() {
  const [reports, setReports] = useState<BacktestListItem[] | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [detail, setDetail] = useState<BacktestDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [progress, setProgress] = useState<BacktestProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [engineDown, setEngineDown] = useState(false);
  /** 이 화면에서 지켜본 실행이 끝났을 때 한 번 — { id, symbols } */
  const [finished, setFinished] = useState<{ id: number; at: number } | null>(null);
  const wasRunning = useRef(false);

  const loadList = useCallback(async (select?: number | null) => {
    try {
      const data = await backtestJson<{ reports: BacktestListItem[] }>('/api/backtest/reports');
      setReports(data.reports);
      setSelectedId((cur) => select ?? cur ?? data.reports[0]?.id ?? null);
      setError(null);
    } catch (e) {
      setReports((r) => r ?? []);
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void loadList();
    void backtestJson<{ progress: BacktestProgress }>('/api/backtest/progress')
      .then((d) => setProgress(d.progress))
      .catch(() => undefined);
  }, [loadList]);

  useEffect(() => {
    if (selectedId == null) {
      setDetail(null);
      return;
    }
    let alive = true;
    setDetailLoading(true);
    backtestJson<BacktestDetail>(`/api/backtest/reports/${selectedId}`)
      .then((d) => alive && setDetail(d))
      .catch((e) => alive && setError((e as Error).message))
      .finally(() => alive && setDetailLoading(false));
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
        } else if (progress?.reportId != null) {
          const id = progress.reportId;
          void loadList(id).then(() => setFinished({ id, at: Date.now() }));
        }
      }
      return;
    }
    wasRunning.current = true;
    const timer = setInterval(async () => {
      try {
        const d = await backtestJson<{ progress: BacktestProgress }>('/api/backtest/progress');
        setProgress(d.progress);
      } catch {
        /* 다음 주기에 다시 본다 */
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [progress?.running, progress?.error, progress?.engineDown, progress?.reportId, loadList]);

  /** 실패는 throw — 화면이 서버 문구 그대로 알린다. 같은 날 같은 입력이면 계산 없이 그 결과를 연다(reused) */
  const start = useCallback(
    async (input: BacktestInput, force = false): Promise<BacktestProgress> => {
      setError(null);
      setEngineDown(false);
      try {
        const d = await backtestJson<{ progress: BacktestProgress }>(`/api/backtest/run${force ? '?force=1' : ''}`, post(input));
        setProgress(d.progress);
        if (!d.progress.running && d.progress.reportId != null) await loadList(d.progress.reportId);
        return d.progress;
      } catch (e) {
        setEngineDown(Boolean((e as { engineDown?: boolean }).engineDown));
        throw e;
      }
    },
    [loadList],
  );

  const remove = useCallback(
    async (id: number) => {
      await backtestJson(`/api/backtest/reports/${id}`, { method: 'DELETE' });
      if (selectedId === id) setSelectedId(null);
      await loadList(null);
    },
    [loadList, selectedId],
  );

  /** 결과 설명 — 서버가 그 기록에 저장한다. 받은 설명을 지금 보는 결과에도 넣는다 */
  const explain = useCallback(async (id: number): Promise<BacktestExplain> => {
    const d = await backtestJson<{ explain: BacktestExplain }>('/api/backtest/explain', post({ id }));
    setDetail((cur) => (cur && cur.id === id && cur.detail.kind === 'custom' ? { ...cur, detail: { ...cur.detail, explain: d.explain } } : cur));
    return d.explain;
  }, []);

  return { reports, selectedId, setSelectedId, detail, detailLoading, progress, error, engineDown, finished, start, remove, explain };
}

export async function fetchAdvice(input: BacktestInput): Promise<BacktestAdvice> {
  return (await backtestJson<{ advice: BacktestAdvice }>('/api/backtest/advice', post(input))).advice;
}

/** ① 종목 묶음 — 화면을 열 때 한 번 */
export function useBacktestUniverse() {
  const [data, setData] = useState<BacktestUniverse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    backtestJson<BacktestUniverse>('/api/backtest/universe')
      .then(setData)
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);
  useEffect(load, [load]);
  return { data, error, loading, reload: load };
}

/** Gemini 를 부를 수 있는지 — 버튼을 끄고 이유를 보인다 (`/api/gemini/status`) */
export function useGeminiStatus() {
  const [status, setStatus] = useState<{ enabled: boolean; reason: string | null } | null>(null);
  useEffect(() => {
    backtestJson<{ enabled: boolean; reason: string | null }>('/api/gemini/status')
      .then((d) => setStatus({ enabled: d.enabled, reason: d.reason }))
      .catch(() => setStatus({ enabled: false, reason: 'Gemini 상태를 확인하지 못했습니다' }));
  }, []);
  return status;
}
