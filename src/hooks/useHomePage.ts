import { useEffect } from 'react';
import { useAppStore } from '../store/appStore';
import { toast } from '../store/uiStore';
import { DEFAULT_HOME_PAGE, type HomePageId } from '../types/nav';

/**
 * 홈 화면 설정(`GET|PUT /api/settings/home-page`) — 서버 저장(기기가 달라도 같은 홈).
 * 받은 값은 `appStore.homePage` 한 곳에 둔다 — 홈 메뉴 · 로고 · 처음 열기가 `goHome()` 으로 읽는다.
 */
async function json<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const payload = await response.json().catch(() => ({}) as Record<string, unknown>);
  if (!response.ok) throw new Error((payload as { error?: string }).error ?? `요청 실패 (${response.status})`);
  return payload as T;
}

export const saveHomePage = (homePage: HomePageId) =>
  json<{ homePage: HomePageId }>('/api/settings/home-page', {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ homePage }),
  }).then((r) => r.homePage);

/** 받는 중인 요청 — 다시 마운트돼도(개발 StrictMode) 두 번 받거나 실패 토스트를 두 번 띄우지 않는다. 끝나면 비워 다음 로그인에서 다시 받는다 */
let inflight: Promise<void> | null = null;

/** 로그인한 앱이 처음 뜰 때 한 번 받는다. 받기에 실패하면 종목 탐색으로 간다(앱이 멈추지 않게) */
export function useLoadHomePage(): void {
  useEffect(() => {
    if (inflight) return;
    inflight = json<{ homePage: HomePageId }>('/api/settings/home-page')
      .then((r) => useAppStore.getState().setHomePage(r.homePage))
      .catch((e) => {
        // 조용히 넘어가면 설정 칸의 「종목 탐색」 이 저장된 값처럼 보인다 — 받지 못했다고 알린다(같은 화면의 보관 기간 칸과 같은 방식)
        toast.error('홈 화면 설정을 불러오지 못했습니다', `종목 탐색으로 엽니다 — ${e instanceof Error ? e.message : String(e)}`);
        useAppStore.getState().setHomePage(DEFAULT_HOME_PAGE);
      })
      .finally(() => {
        inflight = null;
      });
  }, []);
}
