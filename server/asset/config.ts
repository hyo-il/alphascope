/**
 * 자산 시트 연결 정보 — `.env` 의 `ASSET_SHEET_ID`(시트 ID) · `GOOGLE_SA_KEY_FILE`(서비스 계정 열쇠 JSON 의 절대 경로).
 * 둘 중 하나라도 없으면 「연결 정보 없음」(`sheetConfigured: false`) — 서버는 정상으로 뜨고 다른 기능에 영향이 없다.
 * ⚠️ 값(시트 ID · 경로 · 열쇠 내용)은 로그 · 응답에 싣지 않는다.
 */
export interface AssetSheetConfig {
  sheetId: string;
  keyFile: string;
}

/** 부를 때마다 읽는다(시험이 env 를 바꿔 띄운다) */
export function assetSheetConfig(): AssetSheetConfig | null {
  const sheetId = process.env.ASSET_SHEET_ID?.trim() ?? '';
  const keyFile = process.env.GOOGLE_SA_KEY_FILE?.trim() ?? '';
  if (!sheetId || !keyFile) return null;
  return { sheetId, keyFile };
}

export const isSheetConfigured = () => assetSheetConfig() !== null;

/**
 * 7번째 시험 서버 스위치 `ASSET_SYNC_ENABLED`(기본 켬 · v2.62.0) — `false` 면 시트 쓰기(자산 분류)와 하루 기록 예약을 하지 않는다
 * (쓰기 API 는 「꺼짐」 오류). 사본 DB 로 띄운 시험 서버는 끈다(`scripts/lib/testServerEnv.ts`).
 */
export const isAssetSyncEnabled = (): boolean => process.env.ASSET_SYNC_ENABLED?.trim().toLowerCase() !== 'false';
