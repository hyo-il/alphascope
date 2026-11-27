/**
 * 자산 관리(v2.61.0 · v2.62.0 총 자산 · 하루 기록 · 자산 분류) — 서버(`server/asset/`)와 화면(`src/components/asset/`)이 같이 쓰는 모양.
 * ⚠️ 자산 값(금액 · 수량 · 종목)은 이 앱 밖으로 내보내지 않는다 — 로그 · 시험 출력에 찍지 않는다.
 */

/** `GET /api/asset/status` — 값 없이 참/거짓 · 잠금 시간만 */
export interface AssetStatus {
  /** 자산 비밀번호가 정해져 있는가(`npm run asset:set-password`) */
  passwordSet: boolean;
  /** 이 로그인 세션이 잠금을 풀었는가 */
  unlocked: boolean;
  /** `.env` 에 시트 연결 정보(`ASSET_SHEET_ID` · `GOOGLE_SA_KEY_FILE`)가 둘 다 있는가 */
  sheetConfigured: boolean;
  /** 잠금 시간(분 — 10 · 30 · 60 · 0 = 끄기 · v2.65.4) */
  lockMinutes: number;
  /** 풀려 있고 잠금 시간이 켜져 있으면 저절로 잠길 때까지 남은 ms(서버 시각 기준) · 아니면 null */
  remainingMs: number | null;
  /** 이 세션이 「쓰지 않아」 저절로 잠겼고 아직 다시 풀지 않았다(잠금 화면 안내 한 줄) */
  idleLocked: boolean;
}

/** `POST /api/asset/touch` — 화면을 쓴 것으로 셈(v2.65.4) */
export interface AssetTouchResult {
  ok: true;
  lockMinutes: number;
  remainingMs: number | null;
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
  // ── 쓰기(자산 분류 · 목표 비율)만 ──
  | 'disabled' // 이 서버에서 시트 쓰기 · 하루 기록이 꺼짐(ASSET_SYNC_ENABLED=false)
  | 'not-editable' // 쓸 수 없는 칸(「티커」 종목 줄이 아님) · 허용하지 않는 값
  | 'formula-cell' // 그 칸이 수식(`=` 로 시작) — 덮어쓰지 않는다
  | 'mismatch' // 쓴 뒤 다시 읽은 값이 보낸 값과 다름(목표 비율 — v2.63.0 · 계좌 이름 날짜 — v2.64.0)
  | 'no-date' // 「( 날짜 )」 가 든 계좌 이름 칸이 없음(구매 완료 — v2.64.0)
  | 'already-done' // 이번 구매 차례(미리 완료할 다음 차례도)는 이미 「구매 완료」 를 눌렀음(v2.64.0)
  | 'not-yet' // 누를 차례가 없음 — 지금 차례가 완료 · 시작 전이고 다음 구매일 7일 전이 아직(v2.65.4)
  // ── 시트 가격(v2.65.0) ──
  | 'busy' // 시트 가격 바꾸기 · 되돌리기가 이미 도는 중
  | 'no-rows' // 바꿀 줄이 없음(모두 이미 토스 · 토스 가격 없음 · 모양이 다름)
  | 'no-backup' // 되돌릴 원래 수식이 앱 DB 에 없음
  // ── 매수 · 매도 입력(v2.66.0) ──
  | 'sheet-changed' // 화면을 연 뒤 시트의 그 줄(이름 · 코드 · 수량 · 평균가)이 바뀜
  | 'row-referenced' // 모두 매도 — 다른 칸이 지울 줄을 가리킴(v2.67.0)
  | 'last-row'; // 모두 매도 — 그 계좌 구간의 마지막 종목 줄(지우면 구간이 사라진다 · v2.67.0)

/**
 * 자산 분류 — 「티커」 D열에 적는 글자 셋(v2.65.2 — 사용자 결정 2026-11-08: 「현금」 을 뺐다).
 * 빈칸 · 세 글자가 아닌 글자(옛 글자 「현금」 포함) · 이을 수 없는 줄은 모두 하나의 값 「미지정」(v2.62.2) — 계산에서 `none` 묶음.
 * ⚠️ 분류 값 목록과 「현금」 묶음(`AssetGroupKey` 'cash' — 「현금」 탭 C25 금액만)은 다른 것이다 — 섞지 않는다.
 */
export const ASSET_CLASSES = ['채권', '금', '주식'] as const;
/** 시트에 남아 있을 수 있는 옛 분류 글자 — 읽으면 「미지정」 · 쓰기는 거절(점검 명령 `asset:check-sheet` 가 따로 센다) */
export const LEGACY_CASH_CLASS = '현금';
export type AssetClass = (typeof ASSET_CLASSES)[number];
export const isAssetClass = (v: unknown): v is AssetClass => typeof v === 'string' && (ASSET_CLASSES as readonly string[]).includes(v);
/** 「미지정」 글자 — 모든 칸(계좌 카드 · 종목별 표 · 분류별 표 · 원형 범례 · 「자산 분류 정하기」 창)이 이 하나를 쓴다(v2.65.3 — 좁은 칸의 「-」 를 없앴다) */
export const UNASSIGNED_LABEL = '미지정';

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
  /** 「티커」 D열 자산 분류 — 빈칸 · 세 글자가 아닌 글자(옛 「현금」 포함) · 이을 수 없음은 null(「미지정」) */
  assetClass: AssetClass | null;
  /** 「티커」 D칸(자산 분류)이 수식(`=`)인가 — 앱은 수식을 덮어쓰지 않는다(「자산 분류 정하기」 창은 그 줄에 버튼 대신 안내 · v2.65.3). 이을 수 없는 줄은 false */
  classFormula: boolean;
  /**
   * 매수 · 매도 입력을 받는 줄인가(v2.66.0) — 합친 표가 아니고 · 「티커」 와 이어지고 · 수량 칸이 0 보다 큰 숫자이고 ·
   * 평균가 칸이 시장에 맞는 모양(국내 = 숫자 · 미국 = `=(달러)*('티커'!$G$9)` 수식)인 줄만.
   */
  tradable: boolean;
  /** 미국 줄 평균가 칸의 수식 원문(숫자만 바꿔 다시 쓴다 · v2.66.0) — 그 밖의 줄은 null */
  avgFormula: string | null;
}

/**
 * 종목 묶음 열쇠(v2.65.4) — **같은 종목 코드 = 한 종목**. 「자산 현황」 종목별 보기(`server/asset/summary.ts` `holdingsBySymbol`)와
 * 「자산 분류 정하기」 창(`src/utils/assetClassPlan.ts` `classRowsOf`)이 같은 함수를 쓴다(묶는 규칙을 따로 만들지 않는다).
 * 코드가 없는 줄은 부르는 곳이 준 열쇠(종목별 보기 `name:<이름>` · 분류 창 `row:<「티커」 줄 번호>`).
 */
export function holdingGroupKey(h: Pick<AssetHolding, 'symbol'>, fallback: string): string {
  return h.symbol ?? fallback;
}

export interface AssetSection {
  /** 계좌 이름 key(`개별 투자` 등 — 「연금으로 볼 계좌」 가 가리킨다) — 합친 표는 null */
  key: string | null;
  name: string;
  /** 계좌를 합친 표(위 구간과 종목이 겹친다) */
  combined: boolean;
  holdings: AssetHolding[];
}

/** 목표 비율 — 백분율(30 = 30%) · 저장(`PUT /api/asset/target-ratio`)은 여섯 칸 모두 정수 0~100 · 네 칸 합 100 · 코어 + 위성 100 */
export interface AssetTargetRatio {
  cash: number | null;
  gold: number | null;
  bond: number | null;
  invest: number | null;
  core: number | null;
  satellite: number | null;
}

/** 「현금」 탭 계좌 한 줄(v2.70.4) — 이름(두 줄 이름은 한 줄로) · 금액(빈칸 · 숫자 아님은 null → 화면 「—」) */
export interface AssetCashRow {
  /** 시트 줄 번호 */
  row: number;
  name: string;
  amount: number | null;
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
  /** 「현금」 탭 은행 계좌 줄(시트 순서 · 읽기만 · v2.70.4) — 「현금 합계」 펼침 */
  cashAccounts: AssetCashRow[];
  /** 「현금」 탭 퇴직 연금 줄(시트 순서 · 읽기만 · v2.70.4) — 「연금 포함」 일 때 펼침에 */
  retirementAccounts: AssetCashRow[];
  targetRatio: AssetTargetRatio;
  /** 월급(원) */
  salary: number | null;
  /** 구매 평균 환율(원/달러) */
  avgFxRate: number | null;
  }

export type AssetTradeSide = 'buy' | 'sell';

/** `POST /api/asset/trade` 요청(v2.66.0) — `expect` 는 화면이 본 값(시트가 그 뒤 바뀌었으면 409 `sheet-changed`) */
export interface AssetTradeRequest {
  section: string;
  row: number;
  side: AssetTradeSide;
  qty: number;
  price: number;
  expect: { name: string; code: string; quantity: number; avgPrice: number };
}

/** `POST /api/asset/trade` 성공 — 기록 id 만(값은 시트를 다시 읽어 본다) */
export interface AssetTradeResult {
  id: number;
}

/** 미국 코드 앞부분 — 시트 「티커」 코드 `앞부분:종목`(v2.67.0) */
export const US_CODE_PREFIXES = ['NASDAQ', 'NYSE', 'NYSEARCA', 'NYSEAMERICAN', 'BATS'] as const;
export type AssetUsPrefix = (typeof US_CODE_PREFIXES)[number];
export const isUsPrefix = (v: unknown): v is AssetUsPrefix => typeof v === 'string' && (US_CODE_PREFIXES as readonly string[]).includes(v);

/** `POST /api/asset/trade/new/plan` 요청 — 계좌 · 종목 목록의 코드 · 미국 앞부분(없으면 시장에 맞춘 기본) */
export interface AssetNewHoldingTarget {
  section: string;
  symbol: string;
  exchange: AssetUsPrefix | null;
}

/** `POST /api/asset/trade/new` 요청(v2.67.0) — `assetClass` 빈 글자 = 미지정 */
export interface AssetNewHoldingRequest extends AssetNewHoldingTarget {
  qty: number;
  price: number;
  assetClass: AssetClass | '';
}

/** 새 종목을 어디에 쓸지(저장 전 확인 화면 · 시트를 바꾸지 않는다) */
export interface AssetNewHoldingPlan {
  section: string;
  name: string;
  symbol: string;
  market: 'KR' | 'US';
  currency: AssetCurrency;
  /** 시트에 쓸 코드(「티커」 에 이미 있으면 그 줄의 코드) */
  code: string;
  /** 미국 앞부분 — 국내는 null */
  prefix: AssetUsPrefix | null;
  /** 확인 화면에서 앞부분을 바꿀 수 있나(미국 + 「티커」 에 새로 쓸 때) */
  prefixEditable: boolean;
  ticker: { group: string; row: number; status: 'blank' | 'insert' | 'existing' };
  /** 그 계좌에 이미 있는 종목이면 그 줄(새 줄 없이 매수로 더한다) */
  existing: { row: number; quantity: number | null; avgPrice: number | null } | null;
  /** 합친 표를 직접 고쳐야 할 때 한 줄 */
  notice: string | null;
}

/** 새 종목을 줄로 넣을 때 안내 한 줄 — 「자산 투자 비율 관리」 탭은 종목 줄을 한 칸씩 가리켜 새 종목이 저절로 들어가지 않는다 */
export const RATIO_TAB_NOTICE = '「자산 투자 비율 관리」 탭에는 직접 더해 주세요.';

/** `POST /api/asset/trade/new` 성공 — `mode: 'buy'` 는 이미 가진 종목이라 매수로 더함 */
export interface AssetNewHoldingResult {
  id: number;
  mode: 'new' | 'buy';
  notice: string | null;
}

/** 매수 · 매도 기록 한 줄(`asset_trades` · v2.66.0) */
export interface AssetTradeRecord {
  id: number;
  at: string;
  section: string;
  holdingRow: number;
  symbol: string;
  name: string;
  side: AssetTradeSide;
  qty: number;
  price: number;
  currency: AssetCurrency;
  fx: number | null;
  beforeQty: number;
  beforeAvg: number;
  afterQty: number;
  afterAvg: number;
  fxBefore: number | null;
  fxAfter: number | null;
}

/** `GET /api/asset/trades` — 최근 순 · `hasMore` = 더 오래된 줄이 있다 */
export interface AssetTradesResponse {
  trades: AssetTradeRecord[];
  hasMore: boolean;
}

/** `GET /api/asset/sheet` 실패 */
export interface AssetSheetFailure {
  error: string;
  kind: AssetSheetErrorKind;
}

/**
 * 자산 분류 색 팔레트(v2.62.1) — 색 이름(id)만 저장한다(값은 `src/index.css` `--color-swatch-*` 한 곳 · 화면은 `assetColors.ts` 가 이름 → 클래스).
 * 어두운 바탕(#1e1e1e)에서 밝기 · 채도 · 대비 3:1 을 통과한 열 색. 회색은 「미지정」 고정이라 고를 수 없다.
 */
export const ASSET_COLOR_IDS = ['yellow', 'orange', 'red', 'pink', 'purple', 'blue', 'teal', 'green', 'lime', 'brown'] as const;
export type AssetColorId = (typeof ASSET_COLOR_IDS)[number];
export const ASSET_COLOR_LABEL: Record<AssetColorId, string> = {
  yellow: '노랑',
  orange: '주황',
  red: '빨강',
  pink: '분홍',
  purple: '보라',
  blue: '파랑',
  teal: '청록',
  green: '초록',
  lime: '연두',
  brown: '갈색',
};
export const isAssetColorId = (v: unknown): v is AssetColorId => typeof v === 'string' && (ASSET_COLOR_IDS as readonly string[]).includes(v);

/** 색을 고르는 분류 — 「미지정」 은 회색 고정 */
export type ColoredGroupKey = 'cash' | 'bond' | 'gold' | 'stock' | 'retirement';
export const COLORED_GROUP_KEYS: readonly ColoredGroupKey[] = ['cash', 'bond', 'gold', 'stock', 'retirement'];
export type AssetClassColors = Record<ColoredGroupKey, AssetColorId>;
/** 기본 색 — 금 노랑 · 현금 주황(사용자 결정 2026-11-07) · 나머지는 106차 색에 가장 가까운 팔레트 색 */
export const DEFAULT_CLASS_COLORS: AssetClassColors = { cash: 'orange', bond: 'purple', gold: 'yellow', stock: 'blue', retirement: 'pink' };

/** 「비율 조정 범위」 — 목표와의 차이가 ±이 %p 안이면 「괜찮음」(정수 · v2.63.0 · 사용자 결정 2026-11-07 처음 값 5) */
export const REBALANCE_BAND_MIN = 1;
export const REBALANCE_BAND_MAX = 20;
export const DEFAULT_REBALANCE_BAND = 5;
export const isRebalanceBand = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= REBALANCE_BAND_MIN && v <= REBALANCE_BAND_MAX;

/** 「잠금 시간」(v2.65.4 · 사용자 결정 2026-11-08) — 마지막으로 화면을 쓴 뒤 이 분 동안 아무것도 안 하면 저절로 잠김 · 0 = 끄기 · 처음 값 30 */
export const LOCK_MINUTES_CHOICES = [10, 30, 60, 0] as const;
export const DEFAULT_LOCK_MINUTES = 30;
export const isLockMinutes = (v: unknown): v is number => typeof v === 'number' && (LOCK_MINUTES_CHOICES as readonly number[]).includes(v);

/** 자산 관리 설정 — `app_settings` 'asset.pensionSections' · 'asset.satelliteSymbols' · 'asset.classColors' · 'asset.rebalanceBand' · 'asset.lockMinutes' */
export interface AssetSettings {
  /** 연금으로 볼 계좌(구간 key — 기본 `['연금 저축 계좌']`) — 「연금 포함」 이 꺼지면 빠진다. 퇴직 연금(「현금」 C30)도 함께 빠진다 */
  pensionSections: string[];
  /** 위성으로 선택한 종목(종목 코드 `symbol`) — 분류 「주식」 이면서 여기 있으면 위성 · 그 밖 「주식」 은 코어(계좌와 상관없이 같은 코드는 같은 쪽) */
  satelliteSymbols: string[];
  /** 분류마다 팔레트 색 이름 */
  classColors: AssetClassColors;
  /** 「비율 조정 범위」 ±%p(정수 1~20 · 처음 값 5) */
  rebalanceBand: number;
  /** 「잠금 시간」 분(10 · 30 · 60 · 0 = 끄기 · 처음 값 30) */
  lockMinutes: number;
}

/** 설정 창 「위성으로 선택한 종목」 의 한 줄 — 분류 「주식」 종목 + 위성 목록에 남아 있는 종목(합친 표 제외) */
export interface AssetStockChoice {
  symbol: string;
  name: string;
  /** 그 종목이 있는 계좌(구간 key — 시트 순서) */
  sections: string[];
  /** 지금 분류가 「주식」 인가 — 아니면 계산에서 빠진다(목록에는 남는다) */
  isStock: boolean;
}

/** 분류별 묶음 — 현금(「현금」 탭 금액만 · 분류 값이 아니다) + 세 분류 + 퇴직 연금(연금 포함일 때만 · 분류가 없는 한 칸) + 미지정(`none`) */
export type AssetGroupKey = 'cash' | 'bond' | 'gold' | 'stock' | 'retirement' | 'none';
/** 분류별 묶음 이름 — 서버 계산 · 옛 하루 기록 읽기가 이 표 하나를 쓴다(옛 기록에 저장된 옛 이름도 읽을 때 「미지정」) */
export const ASSET_GROUP_LABEL: Record<AssetGroupKey, string> = { cash: '현금', bond: '채권', gold: '금', stock: '주식', retirement: '퇴직 연금', none: UNASSIGNED_LABEL };

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

/** 비율 조정 한 줄 — 금액은 원 · %는 백분율(30 = 30%) */
export interface RebalanceRow {
  key: 'cash' | 'bond' | 'gold' | 'stock' | 'core' | 'satellite';
  label: string;
  /** 목표 % — 시트 칸이 비면 null(목표 「—」 · 상태 없음) */
  targetPct: number | null;
  /** 지금 %(기준 금액 대비) — 기준이 0 이면 null */
  nowPct: number | null;
  targetAmount: number | null;
  nowAmount: number;
  /** 목표 − 지금(원 · 반올림 정수) — +면 더 사야 함, −면 줄여야 함, 0 이면 맞음 */
  diffAmount: number | null;
  /** 목표 − 지금(%p) */
  diffPp: number | null;
  /** |차이 %p| ≤ 비율 조정 범위 → ok(경계값 포함) · 아니면 adjust · 목표나 기준이 없으면 null */
  status: 'ok' | 'adjust' | null;
}

/** 비율 조정 표 하나(자산 · 주식 안) */
export interface RebalanceTable {
  /** 기준 금액(원) — 자산 표 = 현금 + 채권 + 금 + 주식 · 주식 안 표 = 주식 */
  base: number;
  rows: RebalanceRow[];
  /** 아는 목표의 합(%) — 하나도 없으면 null. 100 이 아니면 화면이 「목표 비율 합이 ○%입니다」 */
  targetSum: number | null;
  /** 목표가 빈 칸이 있다(「시트에 목표 비율이 없습니다」) */
  targetMissing: boolean;
}

/** 기준 금액에서 빠진 것 — 0원 · 0줄이면 없음 */
export interface RebalanceExcluded {
  key: 'none' | 'retirement' | 'missing';
  label: string;
  /** 원 — 가격 못 받은 종목은 금액을 모른다(null) */
  amount: number | null;
  /** 가격 못 받은 종목 줄 수 */
  count: number | null;
}

/** `GET /api/asset/summary` 의 비율 조정(v2.63.0) — 금액은 `computeAssetTotals` 결과 그대로(총 자산 탭과 같은 숫자) */
export interface AssetRebalance {
  band: number;
  assets: RebalanceTable;
  stocks: RebalanceTable;
  excluded: RebalanceExcluded[];
}

/** 「자산 현황」 종목별 한 줄(v2.63.0) — 같은 종목 코드를 계좌와 상관없이 합친 것(합친 표 제외 · 「연금 포함」 을 따름) */
export interface AssetSymbolRow {
  /** 합치는 열쇠 — 종목 코드(`symbol`), 이을 수 없는 줄은 `name:이름` */
  id: string;
  name: string;
  /** 종목 코드(`NVDA` · `005930`) — 이을 수 없으면 null */
  symbol: string | null;
  exchange: string | null;
  assetClass: AssetClass | null;
  /** 분류 「주식」 만 코어 / 위성 — 그 밖 null(「—」) */
  side: 'core' | 'satellite' | null;
  /** 있는 계좌(계좌 key — 시트 순서) */
  sections: string[];
  /** 수량 합 — 아는 줄만(하나도 모르면 null) */
  quantity: number | null;
  /** 평가 금액 합(원) — 총 자산과 같은 값 계산 · 가격 못 받은 줄은 빠짐 · 하나도 못 받으면 null(「—」 흐리게) */
  value: number | null;
  /** 가격 못 받은 줄 수 */
  missing: number;
  /** 비중(0~1) — 기준 = 「연금 포함」 을 따른 총 자산 · 금액 없음이나 총 자산 0 이면 null */
  ratio: number | null;
}

/** `GET /api/asset/summary?pension=0|1` */
/** 시트 가격 출처(v2.65.0) — google: 시트의 GOOGLEFINANCE 수식 · toss: 앱이 토스 가격 · 환율 숫자를 씀 */
export type AssetPriceSource = 'google' | 'toss';

/** 바꾸지 않은 줄의 이유 — 화면 「토스 가격 없음 — 시트 값 그대로」 목록 */
export type AssetPriceSkipReason =
  | 'no-toss-price' // 토스가 가격을 주지 않음
  | 'price-shape' // 가격 칸(E)이 GOOGLEFINANCE 가격 수식이 아님
  | 'won-shape' // 원화 표기 칸(F)이 E행 · E행 × 환율로 읽히지 않음
  | 'code-changed' // 바꾼 뒤 그 코드를 시트에서 찾지 못함 — 쓰지 않음 · 되돌린 뒤 다시 바꾸기 필요
  | 'duplicate-code'; // 줄이 옮겨졌는데 같은 코드가 두 줄이라 어느 줄인지 정할 수 없음 — 쓰지 않음

export const PRICE_SKIP_LABEL: Record<AssetPriceSkipReason, string> = {
  'no-toss-price': '토스 가격 없음',
  'price-shape': '가격 칸이 GOOGLEFINANCE 가 아님',
  'won-shape': '원화 표기 칸 모양이 다름',
  'code-changed': '줄 코드가 바뀜 — 되돌린 뒤 다시 바꾸기 필요',
  'duplicate-code': '같은 코드 두 줄 — 쓰지 않음',
};

export interface AssetPriceSkip {
  /** 「티커」 줄 번호 */
  row: number;
  name: string;
  code: string;
  reason: AssetPriceSkipReason;
}

/**
 * [되돌리기] 때 줄이 옮겨져 쓰지 않은 줄(v2.65.1) — 「줄이 옮겨짐 — 직접 확인」 목록. 원래 수식 백업은 앱 DB 에 남는다.
 * 시트 줄을 원래대로 돌린 뒤 [되돌리기] 를 다시 누르면 그 줄만 되돌린다.
 */
export interface AssetPriceMoved {
  /** 「티커」 줄 번호 */
  row: number;
  /** 토스로 바꿀 때 그 줄의 종목 이름 · 코드(이름은 v2.65.1 부터 바꾼 줄만 — 없으면 빈 글자) */
  wasName: string;
  wasCode: string;
  /** 지금 그 줄의 종목 이름 · 코드 — 빈 줄 · 구분 줄이면 null */
  nowName: string | null;
  nowCode: string | null;
  /** 같은 코드가 두 줄이라 어느 줄인지 정할 수 없어 쓰지 않음(v2.66.2) */
  duplicate?: boolean;
}

/** 설정 창 「시트 가격」(v2.65.0) — summary 응답에 같이 온다 */
export interface AssetPriceSheetStatus {
  /** 이 서버에서 시트 가격 쓰기가 켜져 있나(`ASSET_PRICE_WRITE_ENABLED` 와 `ASSET_SYNC_ENABLED` 둘 다) */
  enabled: boolean;
  source: AssetPriceSource;
  /** 마지막으로 시트에 가격을 쓴 시각(ISO) — 이 서버가 켜진 뒤 */
  lastWrittenAt: string | null;
  /** off: 스위치 꺼짐 · idle: Google(쓰지 않음) · writing: 장이 열려 쓰는 중 · closed: 두 시장 닫힘 */
  state: 'off' | 'idle' | 'writing' | 'closed';
  /** 토스로 바꾼 줄 수 */
  rows: number;
  /** 지금 토스 가격이 생겨 더 바꿀 수 있는 줄 수(「남은 종목도 토스로 바꾸기」 — 0 이면 숨김) */
  remaining: number;
  /** 되돌릴 원래 수식이 앱 DB 에 남아 있나 */
  hasBackup: boolean;
  skipped: AssetPriceSkip[];
  /** [되돌리기] 때 줄이 옮겨져 쓰지 않은 줄(v2.65.1) — 비어 있으면 숨김 */
  moved: AssetPriceMoved[];
  /** 이전 시트를 되돌리지 않고 바꿔 보관 중인 옛 시트 백업(v2.65.1) — 칸 수 · 시트 ID 앞 4글자. 없으면 null */
  archived: { cells: number; sheets: string[] } | null;
}

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
  settings: AssetSettings;
  /** 계좌(시트 순서 · 합친 표 제외) — 「연금으로 볼 계좌」 고르기 · 「자산 현황」 계좌 카드 머리 */
  accounts: AssetAccount[];
  /** 「위성으로 선택한 종목」 에서 고를 수 있는 종목 */
  stockChoices: AssetStockChoice[];
  /** 비율 조정(v2.63.0) */
  rebalance: AssetRebalance;
  /** 시트의 목표 비율(설정 창 「목표 비율」 처음 값 — 백분율) */
  targetRatio: AssetTargetRatio;
  /** 「자산 현황」 종목별(v2.63.0) — 평가 금액 큰 순 */
  bySymbol: AssetSymbolRow[];
  /**
   * 종목 코드 → 지금 가격(원래 통화 — 미국은 달러 · v2.68.0 평단 계산기). 총 자산 · 계좌 카드가 계산에 쓴 **같은 가격 표**를 그대로 보낸다(새 가격 요청 없음).
   * 가격을 못 받은 종목은 빠진다.
   */
  prices: Record<string, number>;
  /** 이 서버에서 시트 쓰기가 켜져 있나(`ASSET_SYNC_ENABLED`) — 꺼져 있으면 설정 창 목표 비율 [저장] 을 막는다 */
  writeEnabled: boolean;
  /** 이번 달 구매(v2.64.0 · v2.78.0 계좌마다) — 월급 × 목표 비율 · 구매일 · 계좌마다 완료 · 건너뜀 */
  monthlyBuy: MonthlyBuy;
  /** 시트 가격(v2.65.0) — 설정 창 「시트 가격」 */
  priceSheet: AssetPriceSheetStatus;
}

/** 이번 달 구매 한 줄(v2.64.0) — 금액은 원(반올림 정수) · 목표나 월급이 없으면 null(「—」) */
export interface MonthlyBuyRow {
  key: 'cash' | 'bond' | 'gold' | 'stock' | 'core' | 'satellite';
  label: string;
  /** 목표 %(코어 · 위성은 주식 안의 %) — 시트 칸이 비면 null */
  targetPct: number | null;
  amount: number | null;
}

/**
 * `GET /api/asset/summary` 의 이번 달 구매(v2.64.0 · 보여 주기만 — 주문 없음).
 * 살 금액 = 월급(「월 고정지출」 C5) × 목표 비율 · 주식은 코어 · 위성으로 한 번 더 나눔 · 반올림 차이는 코어에(합 = 월급).
 * 구매일 = 26일이 든 주의 금요일(26일이 토 · 일이면 바로 앞 금요일) · 그날이 한국 휴장일이면 그 전 거래일.
 */
export interface MonthlyBuy {
  /** 현금 · 채권 · 금 · 주식 · 코어 · 위성(이 순서) */
  rows: MonthlyBuyRow[];
  /** 살 금액 합(원) — 월급이 없으면 null */
  total: number | null;
  /** 시트에 월급이 없음(빈칸 · 0 · 글자) */
  noSalary: boolean;
  /** 아는 목표의 합(%) — 현금 · 채권 · 금 · 주식 / 코어 · 위성. 하나도 없으면 null */
  assetTargetSum: number | null;
  stockTargetSum: number | null;
  /** 목표가 빈 칸이 있다 */
  targetMissing: boolean;
  /** 오늘(한국 날짜 YYYY-MM-DD) */
  today: string;
  /** 이번 구매 차례 = 오늘 기준 가장 최근에 지난(오늘 포함) 구매일 */
  cycleDay: string;
  /** 다음 구매일 */
  nextDay: string;
  /** 구매일 계산에 한국 휴장일 달력 범위 밖 날짜가 있었다(그 날짜들은 평일이면 거래일로 셈) */
  calendarUnchecked: boolean;
  /** 이 기능을 쓰기 시작한 날(v2.64.1 — `app_settings` 'asset.purchaseStartDay') */
  startDay: string;
  /** 이번 차례가 시작한 날보다 앞선 「시작 전 차례」 — 묻지 않음(팝업 · [구매 완료] 없음) */
  skipped: boolean;
  /** 다음 차례를 미리 [구매 완료] 할 수 있는 첫날(다음 구매일 − 7일 · v2.65.4) — [건너뛰기] 는 날짜 제한 없음 */
  earlyFrom: string;
  /** 계좌마다(v2.78.0 — 「주식 투자 정리」 계좌 구간 · 합친 표 제외 · 시트 순서 · 매달 사지 않는 계좌도 들어 있다 — 화면이 거른다) */
  accounts: MonthlyBuyAccount[];
  /** 구매일 팝업을 띄울까 — 이번 차례(시작 전 아님)에 「아직」 인 매달 사는 계좌가 하나라도 있으면 */
  needsPopup: boolean;
  /** 「적립식 투자」 탭을 못 씀(v2.79.0 — summary 만 채운다 · 나머지 summary 는 그대로) */
  planError?: MonthlyPlanError | null;
  /** 쓰지 않은 묶음(v2.79.0 — 줄 번호 · 까닭 종류) */
  planSkipped?: MonthlyPlanSkip[];
}

/** 이번 달 구매 상태(v2.78.0) — 「아직」 은 기록이 없는 상태 · 완료 · 건너뜀 */
export type PurchaseStatus = 'todo' | 'done' | 'skip';

/** 이번 달 구매 계좌 한 줄(v2.78.0 — 판단은 서버 `purchase.ts` `purchaseAccountsOf` 한 곳) */
export interface MonthlyBuyAccount {
  /** 계좌 key(`개별 투자` 등) */
  section: string;
  /** 시트의 이름 그대로(「( 날짜 )」 포함) */
  name: string;
  /** 매달 사는 계좌(자산 관리 설정 › 이번 달 구매) — 꺼지면 팝업 · 목록에 나오지 않는다 */
  buysMonthly: boolean;
  /** 이번 차례 — 시작 전 차례면 `before-start`(묻지 않음) */
  status: PurchaseStatus | 'before-start';
  /** 이번 차례를 누른 날(한국 날짜) */
  at: string | null;
  /** 이번 차례 [되돌리기] 가 되나(완료 · 건너뜀 · 다음 차례가 「아직」) */
  canUndo: boolean;
  /** 지금 [구매 완료] 를 누르면 쓰는 차례(이번 차례가 「아직」 이면 이번 · 아니면 다음) */
  doneCycle: string;
  /** 그 차례로 시트 계좌 이름에 쓸 날짜 글자(확인 창) — 이름에 날짜가 없으면 null */
  sheetDateText: string | null;
  /** 지금 시트 이름 속 날짜 글자(「2026.07」 — 읽을 수 없으면 null) */
  sheetDateNow: string | null;
  /** 시트 날짜가 이미 그 차례 달이거나 더 뒤(쓰지 않고 완료로만 기록 — 서버는 쓰기 직전에 다시 읽어 판단) */
  sheetAlready: boolean;
  /** 계좌 · 종목별 목록(v2.79.0 — summary 만 채운다 · 이 계좌의 「적립식 투자」 묶음이 없거나 탭을 못 읽으면 null) */
  plan?: MonthlyPlan | null;
  /** 다음 차례 — 이번 차례가 끝났을 때만 처리할 수 있다 */
  next: {
    status: PurchaseStatus;
    at: string | null;
    /** [미리 구매 완료] — 다음 구매일 7일 전부터 */
    canDone: boolean;
    /** [건너뛰기] — 날짜 제한 없음 */
    canSkip: boolean;
  };
}

/**
 * 이번 달 구매 — 계좌 · 종목별 목록 한 줄(v2.79.0 · 「적립식 투자」 탭 · 계산은 서버 `savingPlan.ts` 한 곳 · 0% 줄은 빠짐).
 * 금액 · 남는 돈은 원(정수). 잇지 않은 줄 · 가격이 없는 줄은 주 · 남는 돈이 null(「—」).
 */
export interface MonthlyPlanRow {
  /** 시트 줄 이름(「S&P500」 같은 지수 이름) */
  name: string;
  /** 이은 종목(그 계좌 보유 종목) — 잇지 않았거나 이은 종목이 그 계좌에 없으면 null(「종목을 이어 주세요」) */
  symbol: string | null;
  /** 이은 종목의 시트 이름 */
  stockName: string | null;
  market: 'US' | 'KR' | null;
  /** 비율(0 ~ 1) */
  ratio: number;
  /** 이 줄에 쓸 돈(원) — 한 달 금액 × 비율(반올림 차이는 금액이 가장 큰 줄에) */
  amount: number;
  /** 지금 가격(원래 통화 — 미국은 달러 · summary 가격 그대로) */
  price: number | null;
  /** 원 가격(미국은 가격 × 지금 환율) */
  priceKrw: number | null;
  /** 미국 줄만 — 지금 환율 · 금액의 달러 값(「약 $… · 환율 ○」) */
  usdKrw: number | null;
  amountUsd: number | null;
  /** 살 주(내림) · 남는 돈(원) */
  shares: number | null;
  rest: number | null;
  /**
   * [매수 입력] 이 열 보유 줄(v2.80.0 · 「주식 투자 정리」 줄 번호) — 그 계좌에 이 종목 보유 줄이 **하나**이고 입력을 받는 줄일 때만.
   * 아니면 null + `holdingProblem`(`many` 같은 코드 두 줄 이상 · `not-tradable` 평균가 · 수량 칸 모양이 달라 입력 못 함) · 잇지 않은 줄은 둘 다 null.
   */
  holdingRow: number | null;
  holdingProblem: 'many' | 'not-tradable' | null;
  /** 이번 차례 입력(v2.80.0) — 같은 계좌 · 같은 종목 · 매수 · 이번 차례 구매일(한국 날짜) 이후 기록의 수량 합(없으면 0) · 잇지 않은 줄은 null */
  boughtThisCycle: number | null;
}

/** 계좌 하나의 「적립식 투자」 묶음 계산(v2.79.0) */
export interface MonthlyPlan {
  /** 시트 머리 줄 번호(「분할 개월 수」 줄) */
  headRow: number;
  total: number | null;
  months: number | null;
  /** 한 달 금액 = 반올림(총 금액 ÷ 개월 수) — `values` 문제면 null */
  monthly: number | null;
  /** 목록 줄(0% 줄 빠짐) — 문제가 있으면 비어 있다(목록을 그리지 않는다) */
  rows: MonthlyPlanRow[];
  /** 줄 금액 합(= 한 달 금액) · 아는 남는 돈 합 */
  sum: number | null;
  restSum: number | null;
  /** `values` = 시트 값 확인(총 금액 없음 · 개월 수 0 이하 · 빈칸 · 글자) · `ratio-sum` = 비율 합이 100% 가 아님 */
  problem: 'values' | 'ratio-sum' | null;
  /** 비율 합(%) — 비율을 읽지 못하면 null */
  ratioSum: number | null;
  /** 설정 「잇기」 표 — 0% 가 아닌 줄 이름마다 지금 이은 종목(그 계좌 보유 종목이 아니면 null) */
  links: { name: string; symbol: string | null }[];
  /** 고를 수 있는 종목 = 그 계좌 보유 종목(코드가 있는 줄 · 시트 순서 · 같은 코드는 한 번) */
  choices: { symbol: string; name: string }[];
}

/** 쓰지 않은 묶음(v2.79.0) — `shape` 모양이 달라 읽지 않음 · `no-account` 맞는 계좌 없음 · `same-account` 두 묶음이 같은 계좌 */
export interface MonthlyPlanSkip {
  row: number;
  kind: 'shape' | 'no-account' | 'same-account';
}

/** 「적립식 투자」 탭을 못 씀 — `read` 탭이 없거나 읽기 실패 · `shape` 머리 글자를 못 찾음 */
export interface MonthlyPlanError {
  kind: 'read' | 'shape';
  message: string;
}

/** `PUT /api/asset/purchase/plan-link` 요청 몸 — 계좌 하나의 줄 이름 하나를 그 계좌 보유 종목과 잇는다(null = 끊기) */
export interface PlanLinkRequest {
  section: string;
  name: string;
  symbol: string | null;
}

/** `POST /api/asset/purchase/done` · `skip` · `undo` 요청 몸 */
export interface PurchaseActionRequest {
  cycleDay: string;
  section: string;
}

/** `POST /api/asset/purchase/done` · `skip` · `undo` 성공 */
export interface PurchaseActionResult {
  cycleDay: string;
  section: string;
  /** 되돌린 뒤는 `todo` */
  status: PurchaseStatus;
  /** 누른 날(한국 날짜) */
  at: string;
  /** [구매 완료] 만 — 시트에 썼나(false = 시트 날짜가 이미 그 차례 이후라 그대로 둠) · 시트 날짜 글자 */
  written?: boolean;
  sheetDate?: string;
}

/** `PUT /api/asset/purchase/monthly-accounts` 요청 몸 — 계좌 하나를 켜고 끈다 */
export interface PurchaseMonthlyRequest {
  section: string;
  monthly: boolean;
}

/** 계좌 하나 — 「연금 포함」 과 상관없이 늘 그 계좌 전체 */
export interface AssetAccount {
  /** 계좌 key(`개별 투자` 등) */
  key: string;
  /** 시트의 이름 그대로(「( 날짜 )」 포함) */
  name: string;
  /** 보유 줄 수 */
  holdings: number;
  /** 평가 금액 합(원) — 가격 못 받은 줄은 빠진 값 */
  value: number;
  /** 가격 못 받은 줄 수 */
  missing: number;
}

/** 하루 기록 한 점 — `GET /api/asset/history?range=1m|3m|1y|all&pension=0|1` */
export interface AssetHistoryPoint {
  /** 미국 거래일(YYYY-MM-DD) */
  day: string;
  total: number;
}

export type AssetHistoryRange = '1m' | '3m' | '1y' | 'all';

/** `GET /api/asset/history` 응답 */
export interface AssetHistoryResponse {
  range: AssetHistoryRange;
  points: AssetHistoryPoint[];
  /** 마지막으로 시트가 바뀐 시각(ISO · v2.65.1) — 빈 차트 「원본 시트 연결 뒤 ○부터 쌓입니다」. 바뀐 적 없으면 null */
  since: string | null;
  /** 일별 변화 표(v2.70.0) — `points` 와 같은 날짜 · 같은 순서(날짜 순 — 화면이 거꾸로 보인다) */
  rows: AssetDailyChange[];
}

/**
 * 하루 기록의 보유 줄 하나(v2.70.0 · `asset_daily.holdings_json`) — 그날 총 자산을 계산할 때 쓴 **같은 값**(합친 표 제외 · 모든 계좌).
 * 연금 뺌 총 자산 = `pension` 이 아닌 줄의 `krw` 합 + 현금 · 연금 포함 = 모든 줄의 `krw` 합 + 현금 + 퇴직 연금(가격 못 받은 줄은 빠짐).
 */
export interface AssetDailyHolding {
  /** 계좌 key */
  section: string;
  /** 「연금으로 볼 계좌」 인가(기록할 때 설정) */
  pension: boolean;
  /** 종목 코드(`NVDA` · `005930`) — 이을 수 없으면 null */
  symbol: string | null;
  name: string;
  market: 'US' | 'KR' | null;
  /** 묶음(채권 · 금 · 주식 · 미지정) — 「무엇 때문에」 가 사고판 금액을 묶음에 나눌 때 쓴다 */
  group: AssetGroupKey;
  quantity: number | null;
  /** 가격(원래 통화) — 못 받았으면 null */
  price: number | null;
  currency: AssetCurrency;
  /** 원화 금액 = 수량 × 가격(× 환율) — 못 받았으면 null */
  krw: number | null;
  /** 가격 못 받음(총 자산에서 빠짐) */
  missing: boolean;
}

/** 「무엇 때문에」 몫 이름 — 주가 · 환율은 두 날 모두 종목별 기록이 있을 때만(그 밖은 「주식 값」 으로 묶음) */
export type AssetDailyShareKey = 'price' | 'fx' | 'stock' | 'flow' | 'bond' | 'gold' | 'retirement' | 'none' | 'other';
export const ASSET_DAILY_SHARE_LABEL: Record<AssetDailyShareKey, string> = {
  price: '주가',
  fx: '환율',
  stock: '주식 값',
  flow: '입금 · 출금',
  bond: '채권',
  gold: '금',
  retirement: '퇴직 연금',
  none: UNASSIGNED_LABEL,
  other: '기타',
};

/** 몫 하나(원 · 정수) */
export interface AssetDailyShare {
  key: AssetDailyShareKey;
  label: string;
  amount: number;
}

/** 많이 바뀐 종목(같은 코드는 계좌를 합침 · 주가 + 환율 몫 · 원 정수) */
export interface AssetDailyMover {
  symbol: string;
  name: string;
  amount: number;
}

/** 비교하지 않는 까닭 — 첫 기록 · 시트를 바꾼 뒤 첫 기록 */
export type AssetDailySkip = 'first' | 'sheet-switched';

/** 일별 변화 한 줄(v2.70.0) — 그날(D)과 바로 앞 기록(P) */
export interface AssetDailyChange {
  /** 미국 거래일(YYYY-MM-DD) */
  day: string;
  /** 총 자산(원 · 정수) */
  total: number;
  /** 앞 기록 날짜 — 비교하지 않으면 null */
  prevDay: string | null;
  /** 전날 대비(원 · 정수 = 반올림한 D − 반올림한 P) — 비교하지 않으면 null */
  change: number | null;
  /** 전날 대비 비율(0~1) — 앞 기록이 0 이하이거나 비교하지 않으면 null */
  ratio: number | null;
  /** 몫(0 은 뺌 · 금액 순서는 화면이 정한다) — 합 = `change` */
  shares: AssetDailyShare[];
  /** 사고판 금액(순매수 · 원) — 현금 → 종목으로 옮긴 돈이라 몫의 합에는 0(현금 −, 종목 +) · 매매 기록이 없으면 null */
  traded: number | null;
  /** 많이 바뀐 종목 3개(두 날 모두 종목별 기록이 있을 때만) */
  movers: AssetDailyMover[];
  /** 주가 · 환율로 나눴나(두 날 모두 환율 · 종목별 기록) */
  split: boolean;
  /** 대략 — 미국 매매를 원화로 바꿀 환율을 기록에서 찾지 못함(그 매매는 빼고 셈) */
  approx: boolean;
  /** 가격 못 받은 줄 수(두 날 중 큰 쪽) — 0 이 아니면 「정확하지 않음」 */
  missing: number;
  skip: AssetDailySkip | null;
  /** 사용자 메모(최대 40자) — 없으면 null */
  note: string | null;
}

/** 메모 최대 글자 수 */
export const ASSET_DAILY_NOTE_MAX = 40;

// ── 현금 자동 반영(v2.71.0) — 「현금」 탭 은행 계좌 줄 C열만 앱이 바꾼다 · 서버 `server/asset/cashMoves.ts` · `cashSchedule.ts` ──

/** 「현금」 탭 은행 계좌 줄 알아보기 — 이름(두 줄 이름은 한 줄 · 공백 하나) + 같은 이름 가운데 몇 번째(1부터) */
export interface AssetCashKey {
  name: string;
  nth: number;
  /** 저장할 때 같은 이름 줄이 몇 개였나 — 지금 개수가 다르면(#n 이 밀렸을 수 있음) 찾지 못함으로 본다(설정에 저장한 열쇠만) */
  of?: number;
}

/** 「월 고정지출」 표 한 줄 알아보기 — 분류(합쳐진 칸은 위 줄 이어받기) + 지출 사유 + 같은 분류 · 사유 가운데 몇 번째(1부터) */
export interface AssetFixedKey {
  category: string;
  reason: string;
  nth: number;
  /** 저장할 때 같은 분류 · 사유 줄이 몇 개였나 — 지금 개수가 다르면 찾지 못함으로 본다(설정에 저장한 열쇠만) */
  of?: number;
}

/** 휴일이면 앞 영업일 / 다음 영업일 */
export type AssetCashShift = 'prev' | 'next';
/** 고정 흐름 입금 쪽 — 「현금」 줄 또는 밖으로(출금만) */
export type AssetCashTarget = AssetCashKey | 'out';

/** 고정 흐름 한 줄 설정 — 날짜가 비면(null) 반영하지 않는다 */
export interface AssetCashFlowSetting {
  item: AssetFixedKey;
  /** 매달 며칠(1~31 · 그 달에 없는 날은 말일) */
  day: number | null;
  from: AssetCashKey | null;
  to: AssetCashTarget | null;
}

/** 설정(`app_settings` 'asset.cash') — 처음 값: 꺼짐 · 짝 없음 · 월급 25일 앞 영업일 · 고정 흐름 다음 영업일 */
export interface AssetCashSettings {
  enabled: boolean;
  /** 켠 날(한국 날짜) — 이 날보다 앞선 날짜는 반영하지 않는다 */
  enabledDay: string | null;
  /** 계좌 key → 예수금 줄(없으면 짝 없음) */
  depositPairs: Record<string, AssetCashKey>;
  salary: { to: AssetCashKey | null; day: number; shift: AssetCashShift };
  flowShift: AssetCashShift;
  flows: AssetCashFlowSetting[];
}

export const ASSET_CASH_DEFAULT_SALARY_DAY = 25;

/** 고칠 칸만 — `flow` 는 한 줄(같은 `item` 줄을 바꾼다 · 날짜 · 출금 · 입금이 모두 null 이면 지운다) */
export interface AssetCashSettingsPatch {
  enabled?: boolean;
  depositPair?: { section: string; key: AssetCashKey | null };
  salary?: Partial<AssetCashSettings['salary']>;
  flowShift?: AssetCashShift;
  flow?: AssetCashFlowSetting;
}

/** 반영 기록 종류 */
export type AssetCashMoveKind = 'salary' | 'fixed' | 'buy' | 'sell';
export const ASSET_CASH_KIND_LABEL: Record<AssetCashMoveKind, string> = { salary: '월급', fixed: '고정 흐름', buy: '매수', sell: '매도' };

/** 반영 기록 상태 — 쓰는 중 · 반영 · 되돌리는 중 · 되돌림 · 건너뜀(까닭) · 다시 확인 필요(쓴 뒤 다시 읽은 값이 다름 · 쓰는 중 멈춤) */
export type AssetCashMoveStatus = 'pending' | 'applied' | 'undoing' | 'undone' | 'skipped' | 'check';
export const ASSET_CASH_STATUS_LABEL: Record<AssetCashMoveStatus, string> = {
  pending: '쓰는 중',
  applied: '반영',
  undoing: '되돌리는 중',
  undone: '되돌림',
  skipped: '건너뜀',
  check: '다시 확인 필요',
};

/** 건너뜀 · 다시 확인 필요 까닭 */
export type AssetCashReason =
  | 'server-off' // 서버가 꺼져 있다가 다음 달로 넘어감
  | 'missing-row' // 「현금」 줄을 찾지 못함
  | 'missing-item' // 「월 고정지출」 줄을 찾지 못함
  | 'zero' // 비용 ₩0 · 빈칸
  | 'not-number' // 「현금」 금액 칸이 숫자가 아님(빈칸 · 글자)
  | 'formula-cell' // 「현금」 금액 칸이 수식
  | 'no-salary' // 「현재 월 급여」 가 비었거나 숫자가 아님
  | 'mismatch' // 쓴 뒤 다시 읽은 값이 다름
  | 'stopped' // 쓰는 중에 멈춤(서버가 꺼짐 등) — 시트를 직접 확인
  | 'write-failed'; // 시트를 읽거나 쓰지 못함(까닭 종류는 `detail`)

export const ASSET_CASH_REASON_LABEL: Record<AssetCashReason, string> = {
  'server-off': '서버 꺼짐',
  'missing-row': '「현금」 줄을 찾지 못함',
  'missing-item': '「월 고정지출」 줄을 찾지 못함',
  zero: '비용이 ₩0 · 빈칸',
  'not-number': '금액 칸이 숫자가 아님',
  'formula-cell': '금액 칸이 수식',
  'no-salary': '「현재 월 급여」 가 비었음',
  mismatch: '쓴 뒤 다시 읽은 값이 다름',
  stopped: '쓰는 중에 멈춤',
  'write-failed': '시트를 읽거나 쓰지 못함',
};

/** 반영 기록 한 줄(화면) — 금액은 원 */
export interface AssetCashMoveRecord {
  id: number;
  /** 기록 시각(ISO) */
  at: string;
  kind: AssetCashMoveKind;
  /** 무엇 — 월급 · 고정 흐름 사유(#n) · 매수 · 매도 종목 */
  label: string;
  /** 그 달(YYYY-MM) */
  month: string;
  /** 반영 날(한국 날짜) — 매수 · 매도는 입력한 날 */
  day: string;
  from: AssetCashKey | null;
  to: AssetCashKey | null;
  amount: number;
  status: AssetCashMoveStatus;
  reason: AssetCashReason | null;
  /** 되돌린 때(ISO) */
  undoneAt: string | null;
}

/** 「현금」 줄 고르기 한 칸 */
export interface AssetCashRowOption {
  key: AssetCashKey;
  /** 화면 이름 — 같은 이름이 여럿이면 「#n」 */
  label: string;
  amount: number | null;
}

/** 「월 고정지출」 한 줄(화면) */
export interface AssetFixedItemView {
  key: AssetFixedKey;
  /** 같은 분류 · 사유가 여럿이면 「사유 #n」 */
  label: string;
  /** 비용(원) — 빈칸 · 글자는 null */
  amount: number | null;
  /** 반영할 수 있는 분류(저축 및 투자 · 월세 · 고정 지출) — 변동 지출 · 그 밖은 false(회색 「반영 안 함」) */
  reflect: boolean;
}

/** 고정 흐름 줄(화면) — 시트 줄 + 설정 + 다음 반영 날 + 문제 */
export interface AssetCashFlowView {
  /** 시트에서 찾은 줄 — 설정만 남고 시트에서 사라진 줄은 null */
  item: AssetFixedItemView | null;
  setting: AssetCashFlowSetting | null;
  /** 다음 반영 날(한국 날짜) — 날짜 · 줄이 정해지지 않았거나 켜지 않았으면 null */
  nextDay: string | null;
  /** 다시 확인 필요 — 줄 · 「현금」 줄을 찾지 못함 */
  problem: AssetCashReason | null;
}

/** `GET /api/asset/cash` — 설정 창 「현금 자동 반영」 */
export interface AssetCashView {
  settings: AssetCashSettings;
  /** 이 서버에서 시트 쓰기가 켜져 있나(`ASSET_SYNC_ENABLED`) */
  writeEnabled: boolean;
  /** 오늘(한국 날짜) */
  today: string;
  /** 계좌(합친 표 제외 · 시트 순서) — 예수금 줄 짝 */
  sections: { key: string; name: string }[];
  rows: AssetCashRowOption[];
  /** 「월 고정지출」 을 읽지 못하면 이유(고정 흐름 · 월급 금액만 비운다) */
  fixedError: string | null;
  salary: { amount: number | null; nextDay: string | null; problem: AssetCashReason | null };
  flows: AssetCashFlowView[];
  /** 최근 50 · 최신 위 */
  moves: AssetCashMoveRecord[];
}

/** `GET /api/asset/cash/pair?section=` — 매수 · 매도 창 예수금 줄 */
export interface AssetCashPairView {
  /** 「현금 자동 반영」 켬 · 시트 쓰기 켬 */
  enabled: boolean;
  /** 짝 — 없으면 null */
  pair: { key: AssetCashKey; label: string } | null;
  /** 지금 환율(원/달러) — 못 받으면 null */
  usdKrw: number | null;
  /** 지금 예수금(원 · v2.71.3) — 짝 줄 C열 · 짝 없음 · 꺼짐 · 줄 못 찾음 · 숫자 아님이면 null */
  balance: number | null;
}

/** 매수 · 매도 요청에 더하는 예수금 금액(원 · 0 이상 정수 · 0 이면 예수금은 안 바꿈 · 없으면 안 바꿈) */
export interface AssetCashTradeExtra {
  cashAmount?: number;
}

/** 매수 · 매도 응답에 더하는 예수금 결과 — none = 짝 없음 · 꺼짐 · 0 */
export interface AssetCashTradeOutcome {
  cash: { status: 'applied' | 'skipped' | 'none'; message: string | null };
}

/** 금액 상한(원) — 잘못 친 큰 수를 막는다 */
export const ASSET_CASH_MAX = 10_000_000_000;

/** 매수 · 매도 창 예수금 금액을 고쳤을 때 계산 값과 이만큼(비율) 넘게 다르면 노란 주의 글(v2.71.3 · 저장은 막지 않는다) */
export const ASSET_CASH_WARN_RATIO = 0.1;

// ── 현금 자동 반영 쉽게(v2.71.1) — 은행 묶기 · 빠지는 계좌 기본값 · 다음 한 달 미리 보기 ──

/** 빠지는 계좌 = 「월급 받는 계좌」 를 따라감(저장값 — 월급 받는 계좌를 바꾸면 함께 바뀐다) */
export const ASSET_CASH_FROM_SALARY = 'salary';
/** 고정 흐름 빠지는 계좌(저장값) — 「현금」 줄 또는 월급 받는 계좌 따라감 */
export type AssetCashFrom = AssetCashKey | typeof ASSET_CASH_FROM_SALARY;

/** 고정 흐름 한 줄 고치기(v2.71.1 · `PUT /api/asset/cash/settings` 의 `flowEdit`) — 날짜 · 빠지는 계좌 · 들어가는 계좌가 모두 null 이면 지운다 */
export interface AssetCashFlowEdit {
  item: AssetFixedKey;
  day: number | null;
  from: AssetCashFrom | null;
  to: AssetCashTarget | null;
}

/** 설정 고치기 더한 칸(v2.71.1) — `flowEdit` 한 줄 · `flowDayAll` 모든 줄 같은 날(₩0 · 변동 지출 줄 빼고) */
export interface AssetCashSettingsPatchV2 extends AssetCashSettingsPatch {
  flowEdit?: AssetCashFlowEdit;
  flowDayAll?: number;
}

/** 쓰기만 하는 분류 — 들어가는 계좌 기본 = 쓴 돈(밖으로) */
export const ASSET_CASH_SPEND_CATEGORIES = ['월세', '고정 지출'];
const squashName = (v: string) => v.replace(/\s+/g, '');
/** 그 분류의 들어가는 계좌 기본값 — 월세 · 고정 지출 = 쓴 돈(밖으로) · 그 밖은 정하지 않음 */
export const assetCashDefaultTo = (category: string): AssetCashTarget | null => (ASSET_CASH_SPEND_CATEGORIES.some((c) => squashName(c) === squashName(category)) ? 'out' : null);

/** 은행 묶음 고치기(앱에만 · `app_settings` 'asset.cashBanks' — 시트는 그대로) */
export interface AssetCashBankFix {
  /** 계좌 이름(한 줄로 고친 이름) → 옮길 은행 */
  rows: Record<string, string>;
  /** 은행 이름(괄호 앞 글자) → 바꾼 이름 */
  renames: Record<string, string>;
}
export const ASSET_CASH_BANK_FIX_EMPTY: AssetCashBankFix = { rows: {}, renames: {} };
/** 은행 이름 최대 글자 수 */
export const ASSET_CASH_BANK_NAME_MAX = 20;

/** 괄호가 없는 계좌의 상품 이름 */
export const ASSET_CASH_PLAIN_PRODUCT = '입출금';

/** 「현금」 탭 계좌 이름 → 은행(괄호 앞 글자) · 상품(괄호 안 · 없으면 입출금). 고치기 = 은행 이름 바꾸기 → 줄 옮기기 순 */
export function cashBankName(name: string, fix: AssetCashBankFix = ASSET_CASH_BANK_FIX_EMPTY): { raw: string; bank: string; product: string } {
  const full = name.trim().replace(/\s+/g, ' ');
  const open = full.search(/[(（]/);
  let raw = full;
  let product = ASSET_CASH_PLAIN_PRODUCT;
  if (open > 0) {
    raw = full.slice(0, open).trim();
    const inner = full.slice(open + 1).replace(/[)）]\s*$/, '').trim();
    if (inner) product = inner;
  }
  const moved = fix.rows[full];
  const bank = moved && moved.trim() ? moved.trim() : fix.renames[raw]?.trim() || raw;
  return { raw, bank, product };
}

/** 은행 묶음 한 칸 — 상품 이름(같은 은행 같은 상품이 여럿이면 「#n」 · 시트 순서) · 은행까지 붙인 이름(입출금 하나면 은행만) */
export interface AssetCashBankItem<T> {
  row: T;
  product: string;
  label: string;
  full: string;
}
export interface AssetCashBankGroup<T> {
  bank: string;
  items: AssetCashBankItem<T>[];
}

/** 계좌 줄 → 은행 묶음(은행 순서 = 시트에서 처음 나온 순서 · 묶음 안은 시트 순서) — 서버 · 화면이 함께 쓰는 한 곳 */
export function cashBankGroups<T>(rows: T[], nameOf: (r: T) => string, fix: AssetCashBankFix = ASSET_CASH_BANK_FIX_EMPTY): AssetCashBankGroup<T>[] {
  const named = rows.map((row) => ({ row, ...cashBankName(nameOf(row), fix) }));
  const count = new Map<string, number>();
  for (const n of named) count.set(`${n.bank}\u0000${n.product}`, (count.get(`${n.bank}\u0000${n.product}`) ?? 0) + 1);
  const seen = new Map<string, number>();
  const groups: AssetCashBankGroup<T>[] = [];
  for (const n of named) {
    const id = `${n.bank}\u0000${n.product}`;
    const nth = (seen.get(id) ?? 0) + 1;
    seen.set(id, nth);
    const label = (count.get(id) ?? 0) > 1 ? `${n.product} #${nth}` : n.product;
    const full = label === ASSET_CASH_PLAIN_PRODUCT ? n.bank : `${n.bank} · ${label}`;
    let g = groups.find((x) => x.bank === n.bank);
    if (!g) groups.push((g = { bank: n.bank, items: [] }));
    g.items.push({ row: n.row, product: n.product, label, full });
  }
  return groups;
}

/** 「현금」 줄 열쇠(이름 · 몇 번째) → 은행까지 붙인 이름. 시트에 없으면 null */
export function cashBankLabelOf(key: AssetCashKey, names: string[], fix: AssetCashBankFix = ASSET_CASH_BANK_FIX_EMPTY): string | null {
  const keyed = names.map((name, i) => ({ name: name.trim().replace(/\s+/g, ' '), i }));
  const nths = new Map<string, number>();
  const withNth = keyed.map((k) => {
    const nth = (nths.get(k.name) ?? 0) + 1;
    nths.set(k.name, nth);
    return { ...k, nth };
  });
  const hit = withNth.find((k) => k.name === key.name && k.nth === key.nth);
  if (!hit) return null;
  for (const g of cashBankGroups(withNth, (k) => k.name, fix)) for (const it of g.items) if (it.row === hit) return it.full;
  return null;
}

/** 다음 한 달 미리 보기 한 칸 상태 — 반영 예정 · 이미 기록 있음 · 반영 안 함(까닭) */
export type AssetCashPreviewStatus = 'planned' | 'recorded' | 'not';
/** 반영 안 함 까닭 */
export type AssetCashPreviewWhy = 'no-day' | 'no-from' | 'no-to' | 'same-row' | 'missing-row' | 'missing-item' | 'zero' | 'no-salary' | 'variable';
export const ASSET_CASH_PREVIEW_WHY_LABEL: Record<AssetCashPreviewWhy, string> = {
  'no-day': '날짜 없음',
  'no-from': '빠지는 계좌 없음',
  'no-to': '들어가는 계좌 없음',
  'same-row': '빠지는 계좌와 들어가는 계좌가 같음',
  'missing-row': '「현금」 탭에서 계좌를 찾지 못함 — 다시 확인 필요',
  'missing-item': '「월 고정지출」 에서 찾지 못함 — 다시 확인 필요',
  zero: '금액이 0 · 빈칸',
  'no-salary': '「현재 월 급여」 가 비었음',
  variable: '변동 지출',
};

/** 미리 보기 한 칸 — 계좌 이름은 은행까지 붙인 이름 · 쓴 돈(밖으로)은 `out` */
export interface AssetCashPreviewItem {
  /** 반영 날(한국 날짜) — 반영 안 함(날짜 없음 등)은 null */
  day: string | null;
  kind: 'salary' | 'fixed';
  /** 월급 · 사유(#n) */
  label: string;
  /** 분류(고정 흐름) */
  category: string | null;
  /** 빠지는 계좌 — 월급은 null(밖에서 들어옴) */
  from: string | null;
  /** 들어가는 계좌 — 쓴 돈(밖으로)이면 null + out */
  to: string | null;
  out: boolean;
  amount: number | null;
  status: AssetCashPreviewStatus;
  /** 이미 기록 있음이면 그 기록 상태 */
  record: AssetCashMoveStatus | null;
  why: AssetCashPreviewWhy | null;
}

/** `GET /api/asset/cash/preview` — 오늘부터 다음 한 달(`from` ~ `until`) · 꺼져 있어도 「켜면 이렇게」 */
export interface AssetCashPreview {
  from: string;
  until: string;
  enabled: boolean;
  items: AssetCashPreviewItem[];
}

/** 고정 흐름 줄(화면 · v2.71.1) — 빠지는 계좌가 「월급 받는 계좌」 를 따라가나 */
export interface AssetCashFlowViewV2 extends AssetCashFlowView {
  fromSalary: boolean;
}

/** 설정 화면 더한 값(v2.71.1) — `GET /api/asset/cash` 응답에 함께 */
export interface AssetCashViewV2 extends AssetCashView {
  flows: AssetCashFlowViewV2[];
  bankFix: AssetCashBankFix;
  preview: AssetCashPreview;
}

/** 은행 묶음 고치기 요청(`PUT /api/asset/cash/banks`) — 줄 하나 옮기기(bank null = 처음대로) 또는 은행 이름 바꾸기(to null = 처음대로) */
export interface AssetCashBankPatch {
  row?: { name: string; bank: string | null };
  rename?: { from: string; to: string | null };
}

/** `GET /api/asset/sheet` 에 더한 값(v2.71.1) — 「현금 합계」 은행별 묶음의 고치기 */
export interface AssetSheetCashBanks {
  cashBankFix?: AssetCashBankFix;
  /** 계좌 key → 예수금 줄(v2.71.3 — 계좌 머리 예수금 · 「현금 자동 반영」 이 꺼져 있어도) */
  cashDepositPairs?: Record<string, AssetCashKey>;
}

/**
 * 「현금」 탭 은행 계좌 줄 목록에서 저장한 열쇠의 줄(v2.71.3 · 화면용 — 서버 `findCashLine` 과 같은 뜻) — 없으면 null.
 * 열쇠에 저장 때 같은 이름 줄 수(`of`)가 있고 지금 수가 다르면 null(「#n」 이 밀렸을 수 있음).
 */
export function cashRowOfKey<T extends { name: string }>(rows: T[], key: AssetCashKey): T | null {
  const same = rows.filter((r) => r.name.trim().replace(/\s+/g, ' ') === key.name);
  if (key.of != null && same.length !== key.of) return null;
  return same[key.nth - 1] ?? null;
}

/** 건너뜀 · 다시 확인 필요 까닭 — 설정 화면 글(v2.71.1 · 「줄」 · 「출금」 · 「입금」 을 쓰지 않는 말) */
export const ASSET_CASH_REASON_TEXT: Record<AssetCashReason, string> = {
  'server-off': '서버 꺼짐',
  'missing-row': '「현금」 탭에서 계좌를 찾지 못함',
  'missing-item': '「월 고정지출」 에서 찾지 못함',
  zero: '비용이 ₩0 · 빈칸',
  'not-number': '금액 칸이 숫자가 아님',
  'formula-cell': '금액 칸이 수식',
  'no-salary': '「현재 월 급여」 가 비었음',
  mismatch: '쓴 뒤 다시 읽은 값이 다름',
  stopped: '쓰는 중에 멈춤',
  'write-failed': '시트를 읽거나 쓰지 못함',
};

// ── 직접 입출금(v2.72.0 · 143차) — 예수금 · 현금 [입출금] 창의 이체 · 입금 · 출금(쓰기는 현금 자동 반영과 같은 `server/asset/cashMoves.ts`) ──

/** 직접 입출금 종류 — 이체(계좌 → 계좌 · 총 자산 그대로) · 입금(밖에서 들어옴) · 출금(밖으로 나감) */
export type AssetCashManualKind = 'transfer' | 'deposit' | 'withdraw';
export const ASSET_CASH_MANUAL_KINDS: readonly AssetCashManualKind[] = ['transfer', 'deposit', 'withdraw'];
/** 화면 이름 — 계좌 관리(모의투자) 「입금 · 출금」 과 같은 말 */
export const ASSET_CASH_MANUAL_LABEL: Record<AssetCashManualKind, string> = { transfer: '이체', deposit: '입금', withdraw: '출금' };
/** 반영 기록 종류 전부(자동 반영 + 직접 입출금) */
export type AssetCashMoveKindAll = AssetCashMoveKind | AssetCashManualKind;
export const isAssetCashManualKind = (v: unknown): v is AssetCashManualKind => typeof v === 'string' && (ASSET_CASH_MANUAL_KINDS as readonly string[]).includes(v);
/** 반영 기록 종류 화면 이름 */
export const assetCashKindLabel = (k: AssetCashMoveKindAll): string => (isAssetCashManualKind(k) ? ASSET_CASH_MANUAL_LABEL[k] : ASSET_CASH_KIND_LABEL[k]);
/** 메모 최대 글자 수 */
export const ASSET_CASH_MEMO_MAX = 40;

/** 반영 기록 한 줄(직접 입출금 포함) — 직접 입출금의 `label` 은 메모(없으면 빈 글자) */
export interface AssetCashMoveRecordAll extends Omit<AssetCashMoveRecord, 'kind'> {
  kind: AssetCashMoveKindAll;
}

/** `GET /api/asset/cash` 응답(v2.72.0) — 반영 기록에 직접 입출금 줄도 */
export interface AssetCashViewV3 extends Omit<AssetCashViewV2, 'moves'> {
  moves: AssetCashMoveRecordAll[];
}

/** `POST /api/asset/cash/manual` 요청 — 이체 = 빠지는 · 들어가는 계좌 둘 · 입금 = 들어가는 계좌만 · 출금 = 빠지는 계좌만 */
export interface AssetCashManualRequest {
  kind: AssetCashManualKind;
  from: AssetCashKey | null;
  to: AssetCashKey | null;
  /** 원 · 양의 정수 */
  amount: number;
  /** 선택 · 40자까지 */
  memo?: string;
  /** 화면이 만든 한 번용 id — 같은 번호는 한 번만 쓴다(두 번 눌러도 · 다시 보내도 같은 기록) */
  requestId: string;
}

/** `POST /api/asset/cash/manual` 응답 — 기록 한 줄 + 쓴 뒤 그 계좌들의 금액(원 · 그 쪽이 없거나 쓰지 않았으면 null) */
export interface AssetCashManualResult {
  move: AssetCashMoveRecordAll;
  after: { from: number | null; to: number | null };
  /** 같은 요청 번호가 이미 있어 쓰지 않고 그 기록을 돌려줌 */
  duplicate: boolean;
}

/** 「현금」 탭 은행 계좌 줄 → 열쇠(이름 · 같은 이름 가운데 몇 번째 · 같은 이름 줄 수) — 화면 [입출금] 창(서버 `cashLines` · `storedCashKey` 와 같은 뜻) */
export function cashKeysOfRows<T extends { name: string }>(rows: T[]): { row: T; key: AssetCashKey }[] {
  const nameOf = (r: T) => r.name.trim().replace(/\s+/g, ' ');
  const count = new Map<string, number>();
  for (const r of rows) count.set(nameOf(r), (count.get(nameOf(r)) ?? 0) + 1);
  const seen = new Map<string, number>();
  return rows.map((row) => {
    const name = nameOf(row);
    const nth = (seen.get(name) ?? 0) + 1;
    seen.set(name, nth);
    return { row, key: { name, nth, of: count.get(name) ?? 1 } };
  });
}
