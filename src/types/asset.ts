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
  | 'not-editable' // 쓸 수 없는 칸(「티커」 D14~D42 의 종목 줄이 아님) · 허용하지 않는 값
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
  | 'sell-all-later'; // 가진 수량을 모두 파는 입력 — 다음 업데이트에서 연다(119차)

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
  /** 이 서버에서 시트 쓰기가 켜져 있나(`ASSET_SYNC_ENABLED`) — 꺼져 있으면 설정 창 목표 비율 [저장] 을 막는다 */
  writeEnabled: boolean;
  /** 이번 달 구매(v2.64.0) — 월급 × 목표 비율 · 구매일 · 이번 차례 완료 여부 */
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
  /** 이번 차례에 「구매 완료」 를 눌렀나 · 누른 날(한국 날짜) */
  done: boolean;
  doneDay: string | null;
  /** 구매일 계산에 한국 휴장일 달력 범위 밖 날짜가 있었다(그 날짜들은 평일이면 거래일로 셈) */
  calendarUnchecked: boolean;
  /** 이 기능을 쓰기 시작한 날(v2.64.1 — `app_settings` 'asset.purchaseStartDay') */
  startDay: string;
  /** 이번 차례가 시작한 날보다 앞선 「시작 전 차례」 — 묻지 않음(팝업 · [구매 완료] 없음) */
  skipped: boolean;
  /** 미리 완료할 수 있는 첫날(다음 구매일 − 7일 · v2.65.4) */
  earlyFrom: string;
  /** 지금 미리 완료할 수 있는 차례(= 다음 구매일) — 지금 차례가 완료 · 시작 전이고 오늘 ≥ `earlyFrom` 이고 아직 안 눌렀을 때만 · 아니면 null */
  earlyCycle: string | null;
  /** 다음 차례를 미리 완료한 날(한국 날짜) — 안 했으면 null */
  nextDoneDay: string | null;
  /** [구매 완료] 때 시트 계좌 이름에 쓸 날짜 글자(누를 차례 — 미완료인 이번 차례 · 없으면 미리 완료할 차례 — 기준 · 칸마다 모양이 다르면 여럿 · 날짜가 든 칸이 없으면 빈 배열) */
  sheetDates: string[];
}

/** `POST /api/asset/purchase-done` 성공 */
export interface PurchaseDoneResult {
  cycleDay: string;
  doneDay: string;
  /** 날짜를 바꾼 계좌 이름 칸 수 */
  cells: number;
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
}
