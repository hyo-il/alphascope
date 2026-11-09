/**
 * 자산 시트에서 **읽고 쓰는 칸 목록 — 이 파일 한 곳**(v2.61.0 · v2.62.0 「티커」 D열 자산 분류). 칸 주소를 다른 파일에 박지 않는다.
 *
 * 사용자 시트(2026-11-06 엑셀로 확인한 칸 — 101차 지시서 B 표 · 106차에 「티커」 D열 「자산 분류」 를 넣어 D열부터 한 칸씩 오른쪽으로).
 * 시트에서 줄 · 칸이 옮겨지면 여기만 고친다.
 * - `headers`: 읽기 전에 확인하는 **고정 칸** 머리 글자. 하나라도 다르면 **값을 쓰지 않고** 「시트 모양이 바뀌었어요(탭 · 칸)」 오류(엉뚱한 칸을 읽지 않게).
 *   비교는 공백을 모두 빼고 한다(띄어쓰기만 다른 것은 같은 모양) · `prefix` 는 앞부분만.
 * - 보유 구간 · 「티커」 묶음은 고정 줄 번호가 없다 — `holdingsMark` · `sections` 의 계좌 이름 · `tickers.skipNames` 머리 글자로 `sheetShape.ts` 가 찾는다(v2.66.2 · 줄이 늘거나 줄어도 맞게 읽는다).
 * - 보유 줄 ↔ 종목 줄은 이름 글자가 아니라 F열 수식 `'티커'!$F$NN` 의 NN(「티커」 줄 번호)으로 잇는다(`linkFormula`).
 * - 평균 매입가: C열 수식이 `=(달러값)*('티커'!$G$9)` 이면 달러 원래 값 · USD, 숫자면 원화 KRW(`usdFormula`).
 * - **쓰는 칸은 다음뿐**: 「티커」 종목 줄 D열 자산 분류(`assetClass` — `server/asset/sheet.ts` `writeAssetClasses` — 여러 줄 한 요청) ·
 *   「자산 투자 비율 관리」 목표 비율 여섯 칸(`targetRatio` — 설정 창에서 저장할 때만 · `writeTargetRatio` · v2.63.0) ·
 *   「주식 투자 정리」 계좌 이름 칸(찾은 머리 줄의 B열)의 「( 날짜 )」 — 「구매 완료」 때만 · `writeAccountDates` · v2.64.0 ·
 *   「티커」 시트 가격(`prices` — C9 환율 · 종목 줄 E 가격 · F 원화 표기 수식 · v2.65.0 · `priceSheet.ts` · `priceWriter.ts`) ·
 *   ⑥ 「주식 투자 정리」 보유 줄 평균가(C) · 수량(D)(매수 · 매도 입력 — `trade.ts` `recordTrade` · v2.66.0). 「티커」 G9 구매 평균 환율은 읽기만(시트 「달러 환전」 탭이 계산).
 */

import { ASSET_CLASSES } from '../../src/types/asset';

export interface HeaderCheck {
  tab: string;
  cell: string;
  expect: string;
  /** 앞부분만 맞으면 된다 */
  prefix?: boolean;
}

export interface HoldingSection {
  /** 계좌 key(「연금으로 볼 계좌」 가 가리키는 이름) — 머리 줄 B열은 이 글자로 시작한다. 합친 표는 없음(설정 대상이 아니다) */
  key?: string;
  /** 합친 표의 화면 이름(머리 줄이 「내 계좌 정보」 라 시트 글자를 쓰지 않는다) */
  label?: string;
  /** 계좌를 합친 표 — 위 구간과 같은 종목이 겹친다(화면에 「합계 표」 로 따로 표시) · 둘째 「내 계좌 정보」 바로 아래 */
  combined?: boolean;
}

export const HOLDINGS_TAB = '주식 투자 정리';
export const TICKER_TAB = '티커';

export const SHEET_LAYOUT = {
  headers: [
    { tab: TICKER_TAB, cell: 'B12', expect: '구분' },
    { tab: TICKER_TAB, cell: 'D12', expect: '자산 분류' },
    { tab: '자산 투자 비율 관리', cell: 'B18', expect: '자산 배분 비율' },
    { tab: '월 고정지출', cell: 'B5', expect: '현재 월 급여' },
    { tab: '현금', cell: 'B25', expect: '은행 자산 총액' },
    { tab: '현금', cell: 'B30', expect: '퇴직 연금 총액' },
  ] satisfies HeaderCheck[],

  /**
   * 「티커」 종목 이름(B) · 코드(C) · 자산 분류(D). 머리 줄(`headRow` — B12 · D12)보다 아래에서 B열이 `skipNames` 인 줄 = 묶음 머리(이 순서 · 한 번씩).
   * 종목 줄 = 묶음 머리 다음 줄부터 다음 머리 앞 또는 B · C 가 모두 빈 줄이 두 줄 이어지는 곳 앞까지(빈 줄 하나는 건너뛴다 — `sheetShape.ts`).
   */
  tickers: { headRow: 12, skipNames: ['개별 투자', '적립식 투자', 'ISA 계좌', '연금 저축 계좌'] },

  /**
   * 자산 분류 — 「티커」 D열(종목 줄). 읽기 · 쓰기 모두 이 칸. 값은 `values` 셋(채권 · 금 · 주식) 중 하나 또는 빈칸(미지정 — 세 글자가 아닌 글자 · 옛 「현금」 도 읽을 때 미지정 · v2.65.2).
   * 쓰기는 이 열의 종목 줄만(구분 줄 · 빈 줄 · 그 밖 모든 칸 거절) · 그 칸이 `=` 로 시작하면(수식) 쓰지 않는다.
   */
  assetClass: { tab: TICKER_TAB, column: 'D', values: ASSET_CLASSES },

  /** 「주식 투자 정리」 B열에 두 번 나오는 글자 — 첫째 아래 = 계좌 머리들 · 둘째 바로 아래 = 합친 표 */
  holdingsMark: '내 계좌 정보',

  /**
   * 「주식 투자 정리」 계좌별 보유(순서 = 화면 순서 · 칸 = B 이름 · C 평균 매입가 · D 수량 · F 이을 수식).
   * ⚠️ 마지막 「적립식 주식」 은 계좌를 합친 표 — 위 구간과 같은 종목이 겹치므로 **총 자산 · 분류별 합에 더하지 않는다**(`summary.ts` · 이중 계산).
   */
  sections: [
    { key: '개별 투자' },
    { key: '적립식 계좌' },
    { key: 'ISA 계좌' },
    { key: '연금 저축 계좌' },
    { label: '적립식 주식', combined: true },
  ] satisfies HoldingSection[],

  /** 값 한 칸씩 */
  cells: {
    cashTotal: { tab: '현금', cell: 'C25' },
    retirement: { tab: '현금', cell: 'C30' },
    salary: { tab: '월 고정지출', cell: 'C5' },
    avgFxRate: { tab: TICKER_TAB, cell: 'G9' },
  },

  /**
   * 목표 비율 — 「자산 투자 비율 관리」. 읽기 · 쓰기(v2.63.0) 모두 이 여섯 칸.
   * ⚠️ 시트 칸 순서는 **현금 · 금 · 채권 · 투자**(금이 채권보다 앞) — 화면 순서(현금 · 채권 · 금 · 주식)와 다르다. 칸을 섞지 않는다.
   * `headers` 는 쓰기 직전에만 확인하는 머리 글자(열 순서가 바뀌었으면 쓰지 않는다 — 2026-11-07 시험용 시트로 확인한 글자).
   */
  targetRatio: {
    tab: '자산 투자 비율 관리',
    /** 현금 · 금 · 채권 · 투자 */
    assets: ['C18', 'D18', 'E18', 'F18'],
    /** 코어 · 위성 */
    coreSatellite: ['G23', 'G24'],
    headers: [
      { tab: '자산 투자 비율 관리', cell: 'B18', expect: '자산 배분 비율' },
      { tab: '자산 투자 비율 관리', cell: 'C17', expect: '현금', prefix: true },
      { tab: '자산 투자 비율 관리', cell: 'D17', expect: '금' },
      { tab: '자산 투자 비율 관리', cell: 'E17', expect: '채권' },
      { tab: '자산 투자 비율 관리', cell: 'F17', expect: '투자', prefix: true },
      { tab: '자산 투자 비율 관리', cell: 'F23', expect: '코어' },
      { tab: '자산 투자 비율 관리', cell: 'F24', expect: '위성' },
    ] satisfies HeaderCheck[],
  },

  /**
   * 시트 가격(v2.65.0) — 「티커」 환율 칸 · 종목 줄(`tickers`)의 가격 칸(E) · 원화 표기 칸(F). 종목 코드는 C열(`tickers` 와 같은 줄).
   * - 바꾸기 전 모양(2026-11-07 시험용 시트 A-0 확인): C9 `=GOOGLEFINANCE("…USDKRW")` · E `=GOOGLEFINANCE(C행,"price")` ·
   *   F 국내 `=GOOGLEFINANCE(C행,"price")` / 미국 `=GOOGLEFINANCE($C행,"price")*$C$9` (E 와 같은 값 — `=E행` · `=E행*$C$9` 도 받는다).
   * - 바꾼 뒤: C9 = 토스 환율 숫자 · E = 토스 가격 숫자 · F = 국내 `=E행` / 미국 `=E행*$C$9`(다른 탭 「주식 투자 정리」 F열이 `'티커'!$F$NN` 으로 읽는다).
   * - G · H · I열(등락 · 백분율 · 거래량)과 그 밖 칸은 쓰지 않는다.
   */
  prices: {
    tab: TICKER_TAB,
    fxCell: 'C9',
    codeColumn: 'C',
    priceColumn: 'E',
    wonColumn: 'F',
    /** C9 바꾸기 전 모양 */
    fxFormula: /^=\s*GOOGLEFINANCE\s*\(\s*"(?:CURRENCY:)?USDKRW"/i,
    /** E 바꾸기 전 모양 — 첫 인자(코드 칸 또는 글자)를 꺼낸다 */
    priceFormula: /^=\s*GOOGLEFINANCE\s*\(\s*([^,()]+?)\s*,\s*"price"\s*\)\s*$/i,
  },

  /** 칸 모양 점검(`asset:check-sheet` 7번 · 읽기만)이 보는 마지막 열 — B 부터 여기까지 */
  shapeLastColumn: 'I',

  /** F열 수식에서 「티커」 줄 번호 NN — `'티커'!$F$NN`(「티커」 F열 = 원화 표기) */
  linkFormula: /'?티커'?!\$?F\$?(\d+)/,
  /** C열 수식 `=(119.2338)*('티커'!$G$9)` — 달러 원래 값(「티커」 G9 = 구매 평균 환율) */
  usdFormula: /^=\s*\(?\s*(-?[0-9]+(?:\.[0-9]+)?)\s*\)?\s*\*\s*\(?\s*'?티커'?!\$?G\$?9\s*\)?\s*$/,
} as const;
