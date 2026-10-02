import { useCallback } from 'react';
import { useAppStore } from '../store/appStore';
import { normalizeTab, type PageTab, type TabbedPageId } from '../types/nav';

/**
 * 화면 안 탭 (v2.28.0) — 값은 `appStore.nav.sub` 한 곳에 있고 주소(`#/{page}/{탭}`)와 짝이다.
 * 화면은 `useState` 대신 이 훅을 쓴다 — 탭을 바꾸면 주소가 한 칸 쌓여 뒤로 가기로 앞 탭에 돌아간다.
 */
export function usePageTab<P extends TabbedPageId>(page: P): [PageTab<P>, (tab: PageTab<P>) => void] {
  const sub = useAppStore((s) => (s.nav.page === page ? s.nav.sub : null));
  const setPage = useAppStore((s) => s.setPage);
  const tab = normalizeTab(page, sub) as PageTab<P>;
  const setTab = useCallback((next: PageTab<P>) => setPage(page, next), [page, setPage]);
  return [tab, setTab];
}
