/**
 * 자산 관리(v2.61.0 · v2.62.0 총 자산 · 하루 기록 · 자산 분류) — 서버(`server/asset/`)와 화면(`src/components/asset/`)이 같이 쓰는 모양.
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
  | 'network'
  // ── 쓰기(자산 분류)만 ──
  | 'disabled' // 이 서버에서 시트 쓰기 · 하루 기록이 꺼짐(ASSET_SYNC_ENABLED=false)
  | 'not-editable' // 쓸 수 없는 칸(「티커」 D14~D42 의 종목 줄이 아님) · 허용하지 않는 값
  | 'formula-cell'; // 그 칸이 수식(`=` 로 시작) — 덮어쓰지 않는다

/** 자산 분류 — 「티커」 D열에 적는 글자 넷(사용자 결정 2026-11-07). 빈칸 = 「분류 없음」 */
export const ASSET_CLASSES = ['현금', '채권', '금', '주식'] as const;
export type AssetClass = (typeof ASSET_CLASSES)[number];
export const isAssetClass = (v: unknown): v is AssetClass => typeof v === 'string' && (ASSET_CLASSES as readonly string[]).includes(v);

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
  /** 이어진 「티커」 줄 번호 — 자산 분류를 쓸 칸(D열)의 줄. 이을 수 없으면 null(분류를 고를 수 없다) */
  tickerRow: number | null;
  /** 「티커」 D열 자산 분류 — 빈칸 · 알 수 없는 글자 · 이을 수 없음은 null(계산에서 「분류 없음」) */
  assetClass: AssetClass | null;
  /** D열에 네 글자가 아닌 글자가 있다(「알 수 없는 분류」 — 화면에 그 글자를 보인다) */
  assetClassUnknown: string | null;
}

export interface AssetSection {
  /** 설정(연금 · 위성 구간)이 가리키는 이름(`개별 투자` 등) — 합친 표는 null */
  key: string | null;
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

/** 계좌 구간 설정 — `app_settings` 'asset.pensionSections' · 'asset.satelliteSections'(구간 key 목록) */
export interface AssetSectionSettings {
  /** 「연금 포함」 이 꺼지면 빼는 구간(기본 `['연금 저축 계좌']`) — 퇴직 연금(「현금」 C30)도 함께 빠진다 */
  pensionSections: string[];
  /** 분류 「주식」 종목 중 위성으로 보는 구간(기본 `['개별 투자']`) — 그 밖 구간의 「주식」 은 코어 */
  satelliteSections: string[];
}

/** 분류별 묶음 — 네 분류 + 퇴직 연금(연금 포함일 때만 · 분류가 없는 한 칸) + 분류 없음 */
export type AssetGroupKey = 'cash' | 'bond' | 'gold' | 'stock' | 'retirement' | 'none';

export interface AssetGroup {
  key: AssetGroupKey;
  label: string;
  /** 원 */
  amount: number;
  /** 총 자산에서 차지하는 비율(0~1) — 총 자산이 0 이면 null */
  ratio: number | null;
}

/** 총 자산 계산 한 번 — 하루 기록에도 같은 모양으로 남는다 */
export interface AssetTotals {
  /** 원 — 가격 못 받은 줄은 빠진 값 */
  total: number;
  groups: AssetGroup[];
  /** 분류 「주식」 의 코어 · 위성(원) */
  core: number;
  satellite: number;
  /** 가격 못 받은 보유 줄 수(총 자산에서 빠짐) */
  missing: number;
}

/** `GET /api/asset/summary?pension=0|1` */
export interface AssetSummary {
  /** 시트를 읽은 시각(ISO) · 가격을 계산한 시각(ISO) */
  readAt: string;
  pricedAt: string;
  includePension: boolean;
  totals: AssetTotals;
  /** 평가 손익 — 매입 금액을 아는 줄만(원 · 비율 0~1). 셀 수 있는 줄이 없으면 null */
  profit: { amount: number; ratio: number | null } | null;
  /** 어제보다 — 가장 최근 하루 기록과 견줌. 기록이 없으면 null(「기록 없음」) */
  vsLast: { day: string; amount: number; ratio: number | null } | null;
  /** 가격 못 받은 줄의 이름(화면에 「가격 못 받음」 표시) */
  missingNames: string[];
  /** 자산 분류가 「알 수 없는 분류」 인 줄 수 */
  unknownClassCount: number;
  settings: AssetSectionSettings;
  /** 설정에서 고를 수 있는 구간 key(합친 표 제외) */
  sectionKeys: string[];
}

/** 하루 기록 한 점 — `GET /api/asset/history?range=1m|3m|1y|all&pension=0|1` */
export interface AssetHistoryPoint {
  /** 미국 거래일(YYYY-MM-DD) */
  day: string;
  total: number;
}

export type AssetHistoryRange = '1m' | '3m' | '1y' | 'all';
