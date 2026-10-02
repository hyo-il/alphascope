import { useEffect } from 'react';
import { useAppStore, type NavState, type NavSub } from '../store/appStore';
import { pageMeta, type NavPageId } from '../types/nav';

/**
 * 화면 주소(해시) — 브라우저 뒤로·앞으로 가기와 새로고침 (v2.26.0).
 *
 * 형식: `#/{pageId}` (예: `#/chart`, `#/heatmap`). 하위 위치는 `#/analysis/records` 하나뿐이다.
 * - **해시 방식인 이유**: history 방식(`/chart`)은 서버가 모르는 주소에도 앱을 돌려주도록 nginx 설정까지 바꿔야 한다.
 *   해시는 서버 설정 없이 맥·오라클에서 똑같이 동작한다. 라우터 라이브러리는 들이지 않았다 — 위치는 이미 `appStore.nav` 한 곳이다.
 * - ⚠️ page id 는 `types/nav.ts` 의 `NavPageId` 그대로다 — page id 를 바꾸면 저장된 주소(즐겨찾기)가 깨진다.
 * - 종목(symbol)은 주소에 넣지 않는다(새로고침하면 종목이 비는 것은 예전과 같다).
 *
 * 두 방향:
 * - 상태 → 주소: 메뉴 등으로 `nav` 가 바뀌면 `pushState` 로 한 칸 쌓는다. **지금 주소와 같으면 쌓지 않는다** —
 *   (대메뉴를 눌러 지나간 첫 화면은 같은 대메뉴의 다른 소메뉴로 곧 옮기면 `replaceState` 로 덮어쓴다 — `viaGroup`)
 *   같은 화면을 다시 누르거나, 아래처럼 주소에서 온 이동이면 결과 주소가 이미 같아서 반복이 생기지 않는다.
 * - 주소 → 상태: 뒤로·앞으로 가기(popstate·hashchange)면 그 화면으로 간다(기록은 쌓지 않는다 — 위 비교 덕분).
 * - 처음 열기·새로고침: 주소의 화면으로 연다. 없거나 모르는 값이면 `chart` 로 열고 `replaceState` 로 주소만 고친다.
 *
 * 로그인한 상태(`AppBody`)에서만 쓴다 — 로그인 화면에서는 주소를 건드리지 않는다.
 */

const SUBS: Record<string, NavSub> = { records: 'records' };

export function hashFor(nav: Pick<NavState, 'page' | 'sub'>): string {
  return `#/${nav.page}${nav.sub ? `/${nav.sub}` : ''}`;
}

/** `#/page[/sub]` 해석 — 모르는 page 면 null. 모르는 sub 는 버린다 */
export function parseHash(hash: string): { page: NavPageId; sub: NavSub | null } | null {
  const [page, sub] = hash.replace(/^#\/?/, '').split('/');
  if (!page || !pageMeta(page as NavPageId)) return null;
  const known = sub && page === 'analysis' ? (SUBS[sub] ?? null) : null;
  return { page: page as NavPageId, sub: known };
}

export function useHashRoute(): void {
  useEffect(() => {
    const { setPage } = useAppStore.getState();

    // 1) 처음 열기·새로고침 — 주소를 먼저 반영하고 나서 구독한다(기본값 chart 가 주소를 덮어쓰지 않게)
    const initial = parseHash(window.location.hash);
    if (initial) {
      setPage(initial.page, initial.sub);
      // 모르는 sub 를 버렸으면 주소도 정리한다 (기록은 쌓지 않는다)
      const clean = hashFor(initial);
      if (window.location.hash !== clean) history.replaceState(null, '', clean);
    } else {
      setPage('chart');
      history.replaceState(null, '', hashFor({ page: 'chart' }));
    }

    // 2) 상태 → 주소 (지금 주소와 다를 때만 한 칸 쌓는다)
    const unsubscribe = useAppStore.subscribe((state, prev) => {
      if (state.nav === prev.nav) return;
      const target = hashFor(state.nav);
      if (window.location.hash === target) return;
      // 대메뉴를 눌러 지나간 첫 화면에서 같은 대메뉴의 다른 소메뉴로 가면 그 칸을 덮어쓴다(지나가는 자리라 기록에 남기지 않는다)
      const passing = prev.nav.viaGroup && !state.nav.viaGroup && prev.nav.group === state.nav.group;
      if (passing) history.replaceState(null, '', target);
      else history.pushState(null, '', target);
    });

    // 3) 주소 → 상태 (뒤로·앞으로 가기, 주소창 직접 수정)
    const onAddress = () => {
      const parsed = parseHash(window.location.hash);
      if (!parsed) {
        // 모르는 주소 — 차트로, 주소만 고친다
        history.replaceState(null, '', hashFor({ page: 'chart' }));
        useAppStore.getState().setPage('chart');
        return;
      }
      const { nav } = useAppStore.getState();
      if (nav.page !== parsed.page || (nav.sub ?? null) !== parsed.sub) {
        useAppStore.getState().setPage(parsed.page, parsed.sub);
      }
    };
    window.addEventListener('popstate', onAddress);
    window.addEventListener('hashchange', onAddress);

    return () => {
      unsubscribe();
      window.removeEventListener('popstate', onAddress);
      window.removeEventListener('hashchange', onAddress);
    };
  }, []);
}
