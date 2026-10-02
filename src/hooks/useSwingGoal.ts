import { useCallback, useEffect, useState } from 'react';
import { DEFAULT_SWING_GOAL, type SwingGoal } from '../types/swingGoal';

/**
 * 초보자 목표 설정 (v2.29.0) — 서버 `GET|PUT /api/swing/goal` 이 단일 출처다(기기 간에 같아야 하는 분석 조건).
 * 스윙 화면 도구줄·기준 편집 창·추천 카드·종목 검색이 같은 값을 보므로 **모듈 변수 + 리스너**로 한 벌만 둔다
 * (`usePaperAccounts` 와 같은 패턴 — 화면마다 따로 들고 있으면 저장한 값이 다른 곳에 안 보인다).
 * 폴링하지 않는다 — 스윙 화면을 열 때 한 번 받는다.
 */
let current: SwingGoal | null = null;
let loading: Promise<void> | null = null;
const listeners = new Set<(goal: SwingGoal) => void>();

function publish(goal: SwingGoal) {
  current = goal;
  listeners.forEach((l) => l(goal));
}

async function load(): Promise<void> {
  const res = await fetch('/api/swing/goal');
  const body = (await res.json().catch(() => ({}))) as SwingGoal & { error?: string };
  if (!res.ok || body.error) throw new Error(body.error ?? `목표 설정을 불러오지 못했습니다 (${res.status})`);
  publish(body);
}

export function useSwingGoal() {
  const [goal, setGoal] = useState<SwingGoal | null>(current);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    listeners.add(setGoal);
    if (!current && !loading) {
      loading = load()
        .catch((e) => setError((e as Error).message))
        .finally(() => {
          loading = null;
        });
    }
    return () => {
      listeners.delete(setGoal);
    };
  }, []);

  const save = useCallback(async (next: SwingGoal): Promise<SwingGoal> => {
    const res = await fetch('/api/swing/goal', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(next),
    });
    const body = (await res.json().catch(() => ({}))) as SwingGoal & { error?: string };
    if (!res.ok || body.error) throw new Error(body.error ?? `저장 실패 (${res.status})`);
    publish(body);
    setError(null);
    return body;
  }, []);

  /** 받기 전에는 기본값을 쓴다 — 서버 기본값도 같다 */
  return { goal: goal ?? DEFAULT_SWING_GOAL, loaded: goal !== null, error, save };
}
