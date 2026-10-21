import { useEffect } from 'react';
import { useAppStore } from '../store/appStore';
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

/** 로그인한 앱이 처음 뜰 때 한 번 받는다. 받기에 실패하면 종목 탐색으로 간다(앱이 멈추지 않게) */
export function useLoadHomePage(): void {
  useEffect(() => {
    json<{ homePage: HomePageId }>('/api/settings/home-page')
      .then((r) => useAppStore.getState().setHomePage(r.homePage))
      .catch((e) => {
        console.warn('[homePage] 홈 화면 설정을 받지 못해 종목 탐색으로 갑니다:', e instanceof Error ? e.message : e);
        useAppStore.getState().setHomePage(DEFAULT_HOME_PAGE);
      });
  }, []);
}
