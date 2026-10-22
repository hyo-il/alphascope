/**
 * 「거래대금 $N 미만 숨기기」 기준 저장 — `app_settings` 'usHalts.minTurnoverUsd' 한 키, `GET|PUT /api/settings/us-halts-min-turnover`.
 *
 * - 기기가 달라도 같은 기준이어야 해서 서버에 둔다(사용자 결정 — 맥 · 윈도우). 홈 화면 · 시계 자리와 같은 방식.
 * - 값이 없으면(처음) null = 숨기지 않음. 검사는 `src/types/usHalts.parseMinTurnover` 한 곳. 숨기기는 화면이 한다(서버는 목록을 다 보낸다).
 */
import { getDb } from '../db';
import { parseMinTurnover } from '../../src/types/usHalts';

const KEY = 'usHalts.minTurnoverUsd';

export function getMinTurnover(): number | null {
  const row = getDb().prepare(`SELECT value FROM app_settings WHERE key = ?`).get(KEY) as { value: string } | undefined;
  if (!row) return null;
  try {
    return parseMinTurnover(JSON.parse(row.value)) ?? null;
  } catch {
    return null;
  }
}

export function setMinTurnover(value: number | null): void {
  getDb()
    .prepare(`INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .run(KEY, JSON.stringify(value));
}
