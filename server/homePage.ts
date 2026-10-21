/**
 * 홈 화면 설정 저장 — `app_settings` 'ui.homePage' 한 키, `GET|PUT /api/settings/home-page`.
 *
 * - 기기가 달라도 같은 홈이어야 해서 서버에 둔다(사용자 결정 — 맥 · 윈도우 Chrome).
 * - 고를 수 있는 값은 `src/types/nav.ts` 의 `HOME_PAGES` 한 곳(화면 고르기와 같은 목록).
 * - 없거나 목록 밖 값이면 종목 탐색(`home`) — 이 설정이 생기기 전과 같은 동작.
 */
import { getDb } from './db';
import { DEFAULT_HOME_PAGE, isHomePage, type HomePageId } from '../src/types/nav';

const KEY = 'ui.homePage';

export function getHomePage(): HomePageId {
  const row = getDb().prepare(`SELECT value FROM app_settings WHERE key = ?`).get(KEY) as { value: string } | undefined;
  return isHomePage(row?.value) ? row.value : DEFAULT_HOME_PAGE;
}

export function setHomePage(page: HomePageId): void {
  getDb()
    .prepare(`INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .run(KEY, page);
}
