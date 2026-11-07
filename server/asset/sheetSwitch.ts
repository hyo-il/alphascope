/**
 * 시트가 바뀌었을 때(v2.65.1 · 114차 C) — `.env` 의 `ASSET_SHEET_ID` 가 바뀐 것을 알아채고 **해시마다 딱 한 번** 정리한다.
 *
 * - `app_settings` 'asset.sheetKey' = 연결된 시트 ID 의 sha256 앞 12자(ID 자체는 저장하지 않는다) · 'asset.sheetHint' = ID 앞 4글자(화면 「○… 시트」) ·
 *   'asset.sheetSwitchedAt' = 마지막으로 바뀜 처리를 한 시각(ISO — 총 자산 빈 차트 「원본 시트 연결 뒤 ○부터」).
 * - 부르는 곳: 서버가 켜질 때(예약보다 먼저 — `server/index.ts`)와 자산 요청마다(`routes.ts` 맨 앞 — 같은 해시면 설정 한 줄 읽기뿐).
 * - 저장값이 없으면(처음) 지금 해시만 저장한다. 다르면 한 트랜잭션으로:
 *   ① 하루 기록 `asset_daily` → `asset_daily_archive`(지우지 않고 옮김 · 줄 수 확인) ② 옛 시트 백업 `asset_sheet_backup` → `asset_sheet_backup_archive`
 *   ③ 시트 가격 상태를 처음으로(`google` · 바꾼 줄 · 바꾸지 않은 줄 · 옮겨진 줄 비움) ④ 새 해시 저장. 그 뒤 10초 쓰기를 멈추고 시트 캐시를 비운다.
 *   **새 시트에는 쓰지 않는다**(구글 호출 0).
 * - 그대로 두는 것: 위성 종목 · 연금 계좌 · 분류 색 · 비율 조정 범위 · 'asset.purchaseStartDay' · `asset_purchase`(손대지 않음).
 * ⚠️ 시트 ID 전체를 저장 · 로그 · 응답에 싣지 않는다(해시 · 앞 4글자만).
 */
import crypto from 'node:crypto';
import { getDb } from '../db';
import { assetSheetConfig } from './config';
import { savePriceState } from './priceState';
import { syncPriceWriter } from './priceWriter';
import { resetSheetCache } from './sheet';
import { archiveForSheetSwitch } from './store';

const KEY = 'asset.sheetKey';
const HINT = 'asset.sheetHint';
const AT = 'asset.sheetSwitchedAt';

/** 시트 ID → sha256 앞 12자 */
export const sheetKeyOf = (sheetId: string): string => crypto.createHash('sha256').update(sheetId).digest('hex').slice(0, 12);
/** 시트 ID → 앞 4글자 */
const hintOf = (sheetId: string): string => sheetId.slice(0, 4);

function get(key: string): string | null {
  return (getDb().prepare(`SELECT value FROM app_settings WHERE key = ?`).get(key) as { value: string } | undefined)?.value ?? null;
}
function put(key: string, value: string): void {
  getDb().prepare(`INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, value);
}

export type SheetSwitchResult = 'none' | 'same' | 'saved' | 'switched';

/** 지금 시트 해시와 저장값을 견주어 필요하면 한 번 정리한다 */
export function checkSheetSwitch(now = new Date()): SheetSwitchResult {
  const config = assetSheetConfig();
  if (!config) return 'none';
  const key = sheetKeyOf(config.sheetId);
  const stored = get(KEY);
  if (stored === key) return 'same';
  const db = getDb();
  if (stored == null) {
    db.transaction(() => {
      put(KEY, key);
      put(HINT, hintOf(config.sheetId));
    })();
    return 'saved';
  }
  const at = now.toISOString();
  let moved = { daily: 0, backup: 0 };
  db.transaction(() => {
    moved = archiveForSheetSwitch(stored, get(HINT) ?? '', at);
    savePriceState({ source: 'google', rows: [], skipped: [], moved: [] });
    put(KEY, key);
    put(HINT, hintOf(config.sheetId));
    put(AT, at);
  })();
  syncPriceWriter();
  resetSheetCache();
  console.log(`[asset] 시트가 바뀜 — 하루 기록 ${moved.daily}줄 보관 · 옛 시트 백업 ${moved.backup}칸 보관`);
  return 'switched';
}

/** 서버 시작 · 자산 요청에서 부른다 — 실패해도 서버 · 요청은 그대로(이유 한 줄 · 트랜잭션이라 바뀐 것 없음 · 다음 요청에 다시) */
export function checkSheetSwitchSafe(): void {
  try {
    checkSheetSwitch();
  } catch (e) {
    console.warn('[asset] 시트 바뀜 처리 실패:', e instanceof Error ? e.message : '알 수 없음');
  }
}

/** 마지막으로 시트가 바뀐 시각(ISO) — 없으면 null */
export const sheetSwitchedAt = (): string | null => get(AT);

/** 시험이 세 키를 지운다(사본 DB) · 저장값을 본다 */
export function clearSheetKeyForTest(): void {
  for (const k of [KEY, HINT, AT]) getDb().prepare(`DELETE FROM app_settings WHERE key = ?`).run(k);
}
export const storedSheetKeyForTest = (): { key: string | null; hint: string | null; at: string | null } => ({ key: get(KEY), hint: get(HINT), at: get(AT) });
