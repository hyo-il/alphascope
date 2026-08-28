import { useCallback, useEffect, useState } from 'react';
import type { AutoAnalysisSettings, AutoAnalysisStatus } from '../types/gemini';

/**
 * 설정이 바뀌었음을 앱 안의 다른 화면에 알린다.
 *
 * 자동 분석 탭에서 대상 종목을 지웠는데 차트 헤더의 [+분석] 버튼이 "분석중" 그대로
 * 남아 있으면, 사용자는 어느 쪽을 믿어야 할지 알 수 없다. 두 곳이 같은 설정을
 * 보므로 저장 시점에 서로에게 알린다 (서버를 다시 폴링하는 것보다 즉각적이다).
 */
const listeners = new Set<() => void>();

function notifySettingsChanged() {
  for (const listener of listeners) listener();
}

interface GeminiState {
  /** 키가 있어 기능을 쓸 수 있는지 */
  enabled: boolean;
  model: string;
  settings: AutoAnalysisSettings | null;
  status: AutoAnalysisStatus | null;
}

/** 자동 분석 설정·상태. 상태는 실행 중일 때만 짧게 폴링한다. */
export function useGeminiStatus(pollMs = 15_000) {
  const [state, setState] = useState<GeminiState | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch('/api/gemini/status');
      if (!response.ok) throw new Error(`상태 조회 실패 (${response.status})`);
      setState(await response.json());
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), pollMs);
    return () => clearInterval(timer);
  }, [refresh, pollMs]);

  const save = useCallback(
    async (patch: Partial<AutoAnalysisSettings>) => {
      const response = await fetch('/api/gemini/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(patch),
      });
      if (!response.ok) {
        throw new Error((await response.json().catch(() => ({}))).error ?? '설정 저장 실패');
      }
      await refresh();
      notifySettingsChanged();
    },
    [refresh],
  );

  return { state, error, refresh, save };
}

/**
 * 차트에서 보고 있는 종목을 분석 대상에 담는다.
 *
 * 헤더에서 쓰려고 만든 얇은 훅이다 — 설정 전체를 App 이 알 필요는 없고,
 * "지금 이 종목이 분석 대상인가 / 담기" 두 가지만 필요하다.
 */
export function useAnalysisTargets() {
  const [symbols, setSymbols] = useState<string[] | null>(null);
  const [enabled, setEnabled] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/gemini/status');
      if (!response.ok) return;
      const data = (await response.json()) as {
        enabled: boolean;
        settings: AutoAnalysisSettings | null;
      };
      setEnabled(data.enabled);
      setSymbols(data.settings?.symbols ?? []);
    } catch {
      // 헤더의 보조 기능이라 실패해도 조용히 넘어간다 (버튼이 뜨지 않을 뿐이다).
    }
  }, []);

  useEffect(() => {
    void load();
    // 다른 화면(자동 분석 탭)에서 대상이 바뀌면 헤더 표시도 따라간다.
    listeners.add(load);
    return () => {
      listeners.delete(load);
    };
  }, [load]);

  /** 담기 — 성공하면 true */
  const add = useCallback(
    async (symbol: string) => {
      const next = [...(symbols ?? []), symbol.toUpperCase()];
      const response = await fetch('/api/gemini/settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ symbols: next }),
      });
      if (!response.ok) {
        throw new Error((await response.json().catch(() => ({}))).error ?? '추가에 실패했습니다.');
      }
      const saved = (await response.json()) as AutoAnalysisSettings;
      setSymbols(saved.symbols);
      notifySettingsChanged();
      return true;
    },
    [symbols],
  );

  return { enabled, symbols: symbols ?? [], add, reload: load };
}
