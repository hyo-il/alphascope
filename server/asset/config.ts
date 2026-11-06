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
