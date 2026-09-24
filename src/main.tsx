import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { AUTH_REQUIRED_EVENT } from './hooks/useAuth';
import './index.css';

/*
 * ⚠️ **세션이 끊긴 것을 한 곳에서 알아챈다.**
 *
 * 컴포넌트마다 `fetch` 를 직접 쓰고 있어(폴링·저장·조회가 수십 곳이다) 401 처리를 하나씩
 * 넣는 것은 현실적이지 않고, 새로 만든 곳에서 빠뜨리면 그 화면만 조용히 빈 값이 된다.
 * 그래서 `window.fetch` 를 한 번 감싸 `/api/` 응답이 `authRequired` 로 401 을 내면
 * 전역 이벤트를 쏜다. App 이 그것을 받아 로그인 화면으로 바꾼다.
 *
 * 응답 자체는 **그대로 흘려보낸다** — 부르는 쪽의 에러 처리를 바꾸지 않기 위해서다.
 */
const originalFetch = window.fetch.bind(window);
window.fetch = async (...args: Parameters<typeof fetch>) => {
  const response = await originalFetch(...args);
  if (response.status !== 401) return response;

  const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request).url ?? '';
  if (!url.includes('/api/')) return response;

  // 본문을 읽어 버리면 부르는 쪽이 다시 읽지 못한다 — 복제해서 확인한다.
  try {
    const body = (await response.clone().json()) as { authRequired?: boolean };
    if (body?.authRequired) window.dispatchEvent(new Event(AUTH_REQUIRED_EVENT));
  } catch {
    /* JSON 이 아니면 우리 쪽 401 이 아니다 */
  }
  return response;
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
