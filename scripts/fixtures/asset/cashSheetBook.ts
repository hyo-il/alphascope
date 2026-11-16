/**
 * 「현금」 탭 머리 글자 찾기 시험(`assetcash:test` · v2.70.4)의 가짜 시트 — 만든 값만(실제 금액 · 계좌 이름 아님).
 * - `book('old')` = 옛 모양(은행 머리 B4 · 계좌 B5~B24 · 총액 B25 · 퇴직 연금 머리 B28 · B29 · 총액 B30)
 * - `book('user')` = 2026-11-16 사용자 캡처 모양(은행 계좌 21줄 B5~B25 · 총액 B26 · 퇴직 연금 머리 B28 · B29 + 빈 줄 B30 · 총액 B31 · 두 줄 이름 · 같은 이름 여러 줄)
 * - `cutRanges` = 구글 `values:batchGet` 처럼 범위 목록 → 칸 배열(`'탭'!B1:F` 끝 없는 범위 포함 · 줄 끝 빈칸은 뺀다).
 * 이 파일은 바꾸기 전 코드(`69624a7`)에서도 돌아 `cashBaseline.json`(총 자산 · 비율 조정 · 하루 기록 정답)을 만들었다 — 새 코드에 기대지 않는다.
 */

import { computeRebalance } from '../../../server/asset/rebalance';
import { accountValues, computeAssetTotals, dailyHoldings, holdingsBySymbol, type PriceBook } from '../../../server/asset/summary';
import type { AssetSheetData } from '../../../src/types/asset';

export type Cell = string | number;
export type Book = { values: Record<string, Cell>; formulas: Record<string, Cell> };

const H = '주식 투자 정리';
const T = '티커';
const C = '현금';

/** 가짜 금액 — 은행 계좌 줄 n(0부터) */
export const bankAmount = (n: number) => 1_000_000 + n * 111_111;
export const RETIRE_AMOUNT = 33_333_333;

export function book(kind: 'old' | 'user'): Book {
  const v: Record<string, Cell> = {
    [`${T}!B12`]: '구분', [`${T}!D12`]: '자산 분류', [`${T}!G9`]: 1350,
    [`${T}!B13`]: '개별 투자', [`${T}!B18`]: '적립식 투자', [`${T}!B22`]: 'ISA 계좌', [`${T}!B26`]: '연금 저축 계좌',
    '자산 투자 비율 관리!B18': '자산 배분 비율', '자산 투자 비율 관리!C18': 0.2, '자산 투자 비율 관리!D18': 0.1, '자산 투자 비율 관리!E18': 0.2, '자산 투자 비율 관리!F18': 0.5,
    '자산 투자 비율 관리!G23': 0.7, '자산 투자 비율 관리!G24': 0.3,
    '월 고정지출!B5': '현재 월 급여', '월 고정지출!C5': 3_210_000,
    [`${H}!B3`]: '내 계좌 정보', [`${H}!B30`]: '내 계좌 정보',
  };
  const f: Record<string, Cell> = {};
  // 「티커」 종목 줄 — 묶음마다 국내 · 미국 · 채권 · 금이 섞이게
  const tickers: [number, string, string, string][] = [
    [14, '가짜A', '900001', '주식'], [15, '가짜B', 'NASDAQ:FAKB', '주식'], [16, '가짜C', '900003', '채권'],
    [19, '가짜D', '900004', '주식'], [20, '가짜E', 'NYSEARCA:FAKE', '금'],
    [23, '가짜F', '900006', '주식'], [24, '가짜G', '900007', ''],
    [27, '가짜H', '900008', '주식'], [28, '가짜I', 'NASDAQ:FAKI', '채권'],
  ];
  for (const [row, name, code, cls] of tickers) Object.assign(v, { [`${T}!B${row}`]: name, [`${T}!C${row}`]: code, [`${T}!D${row}`]: cls });
  // 보유 — [머리 줄, 이름, [줄, 「티커」 줄, 평균가(국내 숫자 · 미국 달러), 수량]]
  const sections: [number, string, [number, number, number, number][]][] = [
    [4, '개별 투자 ( 2026.07 )', [[5, 14, 71_000, 10], [6, 15, 120.5, 3], [7, 16, 98_000, 5]]],
    [10, '적립식 계좌 ( 2026.10 )', [[11, 19, 15_000, 40], [12, 20, 210.25, 2]]],
    [15, 'ISA 계좌 ( 2026.07 )', [[16, 23, 9_000, 100], [17, 24, 12_000, 7]]],
    [20, '연금 저축 계좌 ( 2026.07 )', [[21, 27, 20_000, 30], [22, 28, 88.75, 4]]],
  ];
  for (const [head, name, rows] of sections) {
    v[`${H}!B${head}`] = name;
    for (const [row, tRow, avg, qty] of rows) {
      const us = String(v[`${T}!C${tRow}`]).includes(':');
      v[`${H}!B${row}`] = String(v[`${T}!B${tRow}`]);
      v[`${H}!C${row}`] = us ? avg * 1350 : avg;
      v[`${H}!D${row}`] = qty;
      if (us) f[`${H}!C${row}`] = `=(${avg})*('티커'!$G$9)`;
      f[`${H}!F${row}`] = `=D${row}*'티커'!$F$${tRow}`;
    }
  }
  // 합친 표 31~32
  v[`${H}!B31`] = '가짜D';
  v[`${H}!C31`] = 15_000;
  v[`${H}!D31`] = 40;
  f[`${H}!F31`] = `=D31*'티커'!$F$19`;

  // 「현금」 탭
  v[`${C}!B2`] = '갱신일자 : 2026.10.15';
  v[`${C}!B4`] = '은행 자산';
  const bankRows = kind === 'user' ? 21 : 20;
  let sum = 0;
  for (let n = 0; n < bankRows; n++) {
    const row = 5 + n;
    // 같은 이름 줄 여러 개 · 두 줄 이름 하나(사용자 캡처처럼)
    v[`${C}!B${row}`] = n === bankRows - 1 && kind === 'user' ? '가짜은행\n(가짜 적금 26.11.16 ~ 29.11.16)' : `가짜은행${n % 4}`;
    v[`${C}!C${row}`] = bankAmount(n);
    sum += bankAmount(n);
  }
  const bankTotalRow = 5 + bankRows;
  v[`${C}!B${bankTotalRow}`] = '은행 자산 총액';
  v[`${C}!C${bankTotalRow}`] = sum;
  f[`${C}!C${bankTotalRow}`] = `=SUM(C5:C${bankTotalRow - 1})`;
  v[`${C}!B28`] = '퇴직 연금';
  v[`${C}!B29`] = '가짜연금 확정기여(DC)';
  v[`${C}!C29`] = RETIRE_AMOUNT;
  const retireTotalRow = kind === 'user' ? 31 : 30;
  v[`${C}!B${retireTotalRow}`] = '퇴직 연금 총액';
  v[`${C}!C${retireTotalRow}`] = RETIRE_AMOUNT;
  f[`${C}!C${retireTotalRow}`] = `=SUM(C29:C${retireTotalRow - 1})`;
  return { values: v, formulas: { ...v, ...f } };
}

/** 가짜 가격(토스 대신) — 종목 → 원래 통화 값 */
export const PRICES: [string, number][] = [
  ['900001', 72_500], ['FAKB', 125.25], ['900003', 97_000], ['900004', 15_500], ['FAKE', 215],
  ['900006', 9_300], ['900007', 12_100], ['900008', 21_000], ['FAKI', 90.5],
];
export const USD_KRW = 1388.5;

const colNum = (c: string) => c.charCodeAt(0) - 64;
const colChr = (n: number) => String.fromCharCode(64 + n);

/** 한 범위 → 칸 배열(`'탭'!B1:F` 처럼 끝 줄이 없으면 그 탭의 마지막 줄까지) */
export function cut(m: Record<string, Cell>, range: string): Cell[][] {
  const r = range.match(/^'((?:[^']|'')+)'(?:!([A-Z])(\d+)(?::([A-Z])(\d+)?)?)?$/);
  if (!r) throw new Error('범위 모양');
  const tab = r[1].replace(/''/g, "'");
  const [c1, r1] = r[2] ? [colNum(r[2]), Number(r[3])] : [1, 1];
  const last = Math.max(r1, ...Object.keys(m).filter((k) => k.startsWith(`${tab}!`)).map((k) => Number(/(\d+)$/.exec(k)?.[1] ?? 0)));
  const [c2, r2] = r[4] ? [colNum(r[4]), r[5] ? Number(r[5]) : last] : r[2] ? [c1, r1] : [26, last];
  const rows: Cell[][] = [];
  for (let y = r1; y <= r2; y++) {
    const row: Cell[] = [];
    for (let x = c1; x <= c2; x++) row.push(m[`${tab}!${colChr(x)}${y}`] ?? '');
    while (row.length && row[row.length - 1] === '') row.pop();
    rows.push(row);
  }
  while (rows.length && rows[rows.length - 1].length === 0) rows.pop();
  return rows;
}

export const cutRanges = (m: Record<string, Cell>, ranges: string[]) => ranges.map((r) => cut(m, r));

/**
 * 총 자산 · 비율 조정 · 하루 기록(종목별) · 계좌 카드 · 종목별 — 「꼭 지킬 동작 4」 의 바이트 비교 대상(시트 값에서 「현금」 계좌 줄은 빼고 · 읽은 시각 제외).
 * 바꾸기 전(`69624a7`)과 같은 함수만 부른다.
 */
export function snapshotOf(data: AssetSheetData): string {
  const priceBook: PriceBook = { prices: new Map(PRICES), usdKrw: USD_KRW };
  const settings = { pensionSections: ['연금 저축 계좌'], satelliteSymbols: ['900006'] };
  const { readAt: _readAt, ...rest } = data;
  const sheet = { sections: rest.sections, cashTotal: rest.cashTotal, retirement: rest.retirement, targetRatio: rest.targetRatio, salary: rest.salary, avgFxRate: rest.avgFxRate };
  const out = [false, true].map((pension) => {
    const t = computeAssetTotals(data, priceBook, settings, pension);
    return { pension, totals: t, rebalance: computeRebalance(t.totals, data.targetRatio, 5), bySymbol: holdingsBySymbol(data, priceBook, settings, pension, t.totals.total) };
  });
  return JSON.stringify({ sheet, out, accounts: accountValues(data, priceBook), daily: dailyHoldings(data, priceBook, settings) }, null, 1);
}
