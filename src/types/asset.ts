/**
 * 자산 관리(v2.61.0) — 서버(`server/asset/`)와 화면(`src/components/asset/`)이 같이 쓰는 모양.
 * ⚠️ 자산 값(금액 · 수량 · 종목)은 이 앱 밖으로 내보내지 않는다 — 로그 · 시험 출력에 찍지 않는다.
 */

/** `GET /api/asset/status` — 값 없이 참/거짓만 */
export interface AssetStatus {
  /** 자산 비밀번호가 정해져 있는가(`npm run asset:set-password`) */
  passwordSet: boolean;
  /** 이 로그인 세션이 잠금을 풀었는가 */
  unlocked: boolean;
  /** `.env` 에 시트 연결 정보(`ASSET_SHEET_ID` · `GOOGLE_SA_KEY_FILE`)가 둘 다 있는가 */
  sheetConfigured: boolean;
}
