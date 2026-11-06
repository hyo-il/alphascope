/**
 * 자산 시트에서 **읽을 칸 목록 — 이 파일 한 곳**(v2.61.0 · 자산 관리 1단계). 칸 주소를 다른 파일에 박지 않는다.
 *
 * 사용자 시트(2026-11-06 엑셀로 확인한 칸 — 101차 지시서 B 표). 시트에서 줄 · 칸이 옮겨지면 여기만 고친다.
 * - `headers`: 읽기 전에 확인하는 머리 글자. 하나라도 다르면 **값을 쓰지 않고** 「시트 모양이 바뀌었어요(탭 · 칸)」 오류(엉뚱한 칸을 읽지 않게).
 *   비교는 공백을 모두 빼고 한다(띄어쓰기만 다른 것은 같은 모양) · `prefix` 는 앞부분만(구간 이름 뒤의 「( 2026.07 )」 같은 날짜는 바뀐다).
 * - 보유 줄 ↔ 종목 줄은 이름 글자가 아니라 F열 수식 `'티커'!$E$NN` 의 NN(「티커」 줄 번호)으로 잇는다(`linkFormula`).
 * - 평균 매입가: C열 수식이 `=(달러값)*('티커'!$F$9)` 이면 달러 원래 값 · USD, 숫자면 원화 KRW(`usdFormula`).
 */

export interface HeaderCheck {
  tab: string;
  cell: string;
  expect: string;
  /** 앞부분만 맞으면 된다 */
  prefix?: boolean;
}

export interface HoldingSection {
  /** 구간 이름이 적힌 칸(같은 탭) — 화면에 그 글자 그대로 보인다. 없으면 `label` */
  nameCell?: string;
  label?: string;
  /** 이름 · 평균 매입가 · 수량 · (E) · 이을 수식(F) 칸 — B~F, 첫 줄 번호와 끝 줄 번호 */
  firstRow: number;
  lastRow: number;
  /** 계좌를 합친 표 — 위 구간과 같은 종목이 겹친다(화면에 「합계 표」 로 따로 표시) */
  combined?: boolean;
}

export const HOLDINGS_TAB = '주식 투자 정리';
export const TICKER_TAB = '티커';

export const SHEET_LAYOUT = {
  headers: [
    { tab: TICKER_TAB, cell: 'B12', expect: '구분' },
    { tab: HOLDINGS_TAB, cell: 'B3', expect: '내 계좌 정보' },
    { tab: HOLDINGS_TAB, cell: 'B38', expect: '내 계좌 정보' },
    { tab: HOLDINGS_TAB, cell: 'B4', expect: '개별 투자', prefix: true },
    { tab: HOLDINGS_TAB, cell: 'B12', expect: '적립식 계좌', prefix: true },
    { tab: HOLDINGS_TAB, cell: 'B21', expect: 'ISA 계좌', prefix: true },
    { tab: HOLDINGS_TAB, cell: 'B29', expect: '연금 저축 계좌', prefix: true },
    { tab: '자산 투자 비율 관리', cell: 'B18', expect: '자산 배분 비율' },
    { tab: '월 고정지출', cell: 'B5', expect: '현재 월 급여' },
    { tab: '현금', cell: 'B25', expect: '은행 자산 총액' },
    { tab: '현금', cell: 'B30', expect: '퇴직 연금 총액' },
  ] satisfies HeaderCheck[],

  /** 「티커」 종목 이름(B) · 코드(C) — 빈 줄 · 구분 줄은 건너뛴다 */
  tickers: { firstRow: 14, lastRow: 42, skipNames: ['개별 투자', '적립식 투자', 'ISA 계좌', '연금 저축 계좌'] },

  /** 「주식 투자 정리」 계좌별 보유 */
  sections: [
    { nameCell: 'B4', firstRow: 5, lastRow: 9 },
    { nameCell: 'B12', firstRow: 13, lastRow: 18 },
    { nameCell: 'B21', firstRow: 22, lastRow: 26 },
    { nameCell: 'B29', firstRow: 30, lastRow: 32 },
    { label: '적립식 주식', firstRow: 39, lastRow: 44, combined: true },
  ] satisfies HoldingSection[],

  /** 값 한 칸씩 */
  cells: {
    cashTotal: { tab: '현금', cell: 'C25' },
    retirement: { tab: '현금', cell: 'C30' },
    salary: { tab: '월 고정지출', cell: 'C5' },
    avgFxRate: { tab: TICKER_TAB, cell: 'F9' },
  },

  /** 목표 비율 — 「자산 투자 비율 관리」 */
  targetRatio: {
    tab: '자산 투자 비율 관리',
    /** 현금 · 금 · 채권 · 투자 */
    assets: ['C18', 'D18', 'E18', 'F18'],
    /** 코어 · 위성 */
    coreSatellite: ['G23', 'G24'],
  },

  /** F열 수식에서 「티커」 줄 번호 NN — `'티커'!$E$NN` */
  linkFormula: /'?티커'?!\$?E\$?(\d+)/,
  /** C열 수식 `=(119.2338)*('티커'!$F$9)` — 달러 원래 값 */
  usdFormula: /^=\s*\(?\s*(-?[0-9]+(?:\.[0-9]+)?)\s*\)?\s*\*\s*\(?\s*'?티커'?!\$?F\$?9\s*\)?\s*$/,
} as const;
