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

/** 시트 읽기 실패 이유 — 화면에는 서버가 준 쉬운 말 문구를 그대로 보인다 */
export type AssetSheetErrorKind =
  | 'not-configured' // `.env` 연결 정보 없음
  | 'key-file' // 열쇠 파일 없음 · 모양이 틀림
  | 'auth' // 구글 인증 실패(열쇠가 지워짐 등)
  | 'api-disabled' // 403 — 구글 클라우드 프로젝트에서 Sheets API 가 꺼져 있음
  | 'not-shared' // 403 — 시트를 서비스 계정에 공유하지 않음
  | 'not-found' // 404 — 시트 ID 가 틀림
  | 'shape' // 머리 글자가 다름 · 탭이 없음 — 값을 쓰지 않는다
  | 'network';

export type AssetCurrency = 'USD' | 'KRW';

/** 보유 한 줄(「주식 투자 정리」) — 종목 코드는 F열 수식이 가리키는 「티커」 줄에서 */
export interface AssetHolding {
  /** 시트 줄 번호(「주식 투자 정리」) */
  row: number;
  /** 보유 줄의 이름 그대로 */
  name: string;
  /** 「티커」 코드 원문(`NASDAQ:NVDA` · `005930`) — 이을 수 없으면 null */
  code: string | null;
  market: 'US' | 'KR' | null;
  /** 미국만 — `NASDAQ` */
  exchange: string | null;
  /** 미국은 `NVDA`, 국내는 코드 그대로 */
  symbol: string | null;
  quantity: number | null;
  /** 평균 매입가 원래 값 — USD 면 달러, KRW 면 원 */
  avgPrice: number | null;
  currency: AssetCurrency;
}

export interface AssetSection {
  name: string;
  /** 계좌를 합친 표(위 구간과 종목이 겹친다) */
  combined: boolean;
  holdings: AssetHolding[];
}

/** 목표 비율 — 백분율(30 = 30%) */
export interface AssetTargetRatio {
  cash: number | null;
  gold: number | null;
  bond: number | null;
  invest: number | null;
  core: number | null;
  satellite: number | null;
}

/** `GET /api/asset/sheet` 성공 */
export interface AssetSheetData {
  /** 시트에서 읽은 시각(ISO) */
  readAt: string;
  sections: AssetSection[];
  /** 현금 합계(원) */
  cashTotal: number | null;
  /** 퇴직 연금(원) */
  retirement: number | null;
  targetRatio: AssetTargetRatio;
  /** 월급(원) */
  salary: number | null;
  /** 구매 평균 환율(원/달러) */
  avgFxRate: number | null;
}

/** `GET /api/asset/sheet` 실패 */
export interface AssetSheetFailure {
  error: string;
  kind: AssetSheetErrorKind;
}
