/**
 * 떠 있는 한국 시간 시계의 자리 · 고정 상태 저장 — `app_settings` 'ui.clock' 한 키(JSON), `GET|PUT /api/settings/clock`.
 *
 * - 기기가 달라도 같은 자리여야 해서 서버에 둔다(사용자 결정 — 맥 · 윈도우 Chrome). 홈 화면(`homePage.ts`)과 같은 방식.
 * - 모양 · 검사는 `src/types/clock.ts` 한 곳. 없거나 읽을 수 없는 값이면 기본값(고정 풀림 · 기본 자리).
 */
import { getDb } from './db';
import { DEFAULT_CLOCK, parseClockSetting, type ClockSetting } from '../src/types/clock';

const KEY = 'ui.clock';

export function getClockSetting(): ClockSetting {
  const row = getDb().prepare(`SELECT value FROM app_settings WHERE key = ?`).get(KEY) as { value: string } | undefined;
  if (!row) return DEFAULT_CLOCK;
  try {
    return parseClockSetting(JSON.parse(row.value)) ?? DEFAULT_CLOCK;
  } catch {
    return DEFAULT_CLOCK;
  }
}

export function setClockSetting(setting: ClockSetting): void {
  getDb()
    .prepare(`INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .run(KEY, JSON.stringify(setting));
}
