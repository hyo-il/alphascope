/**
 * 현금 자동 반영 시험(`assetcashflow:test` · v2.71.0)의 가짜 시트 — 만든 값만(실제 금액 · 계좌 이름 아님).
 * - 「현금」 탭: 은행 머리 B4 · 계좌 B5~B12(같은 이름 「가짜국민 (가짜 예금)」 세 줄 · 두 줄 이름 하나) · 총액 B13(수식) · 퇴직 연금 머리 B15 · B16 · 총액 B17.
 * - 「월 고정지출」 탭: B5 「현재 월 급여」 · C5 월급 · 표 머리는 **C10 · D10 · E10**(분류 · 지출 사유 · 비용 — 열을 머리로 찾는지 보려고 B 가 아님) ·
 *   분류는 합쳐진 칸(첫 줄에만 글자) · 같은 사유 네 줄(금액이 다름) · ₩0 줄 · 빈 비용 줄 · 변동 지출.
 * - 가짜 구글(`fakeGoogleFetch`)은 읽기(`values:batchGet`) · 쓰기(`values:batchUpdate`)를 이 책에 그대로 반영하고 쓴 범위를 모두 남긴다.
 */
import { cut, type Cell } from './cashSheetBook';

export type FlowBook = { values: Record<string, Cell>; formulas: Record<string, Cell> };

const C = '현금';
const F = '월 고정지출';

/** 가짜 금액 */
export const SALARY = 3_210_000;
export const BANK: [string, number | string][] = [
  ['가짜키움 (가짜 예수금)', 1_000_000],
  ['가짜국민 (가짜 예금)', 2_000_000],
  ['가짜국민 (가짜 예금)', 2_100_000],
  ['가짜신한', 3_000_000],
  ['가짜국민 (가짜 예금)', 2_200_000],
  ['가짜적금\n(가짜 26.11.16 ~ 29.11.16)', 4_000_000],
  ['가짜토스', 5_000_000],
  ['가짜카카오', 6_000_000],
];
/** [분류(빈칸 = 위 줄 이어받기) · 사유 · 비용] */
export const FIXED: [string, string, number | string][] = [
  ['저축 및 투자', '가짜 투자 비용(가짜국민 -> 가짜키움)', 1_500_000],
  ['', '가짜 투자 비용(가짜국민 -> 가짜키움)', 1_000_000],
  ['', '가짜 투자 비용(가짜국민 -> 가짜키움)', 300_000],
  ['', '가짜 투자 비용(가짜국민 -> 가짜키움)', 300_000],
  ['', '가짜 ISA', 0],
  ['', '가짜 연금저축', ''],
  ['월세', '가짜 월세', 700_000],
  ['고정 지출', '가짜 통신비', 55_000],
  ['', '가짜 보험', 120_000],
  ['변동 지출', '가짜 식비', 400_000],
];

export function flowBook(): FlowBook {
  const v: Record<string, Cell> = {};
  const f: Record<string, Cell> = {};
  v[`${C}!B2`] = '갱신일자 : 2026.11.16';
  v[`${C}!B4`] = '은행 자산';
  BANK.forEach(([name, amount], i) => {
    v[`${C}!B${5 + i}`] = name;
    v[`${C}!C${5 + i}`] = amount;
  });
  const total = 5 + BANK.length;
  v[`${C}!B${total}`] = '은행 자산 총액';
  v[`${C}!C${total}`] = 0;
  f[`${C}!C${total}`] = `=SUM(C5:C${total - 1})`;
  v[`${C}!B${total + 2}`] = '퇴직 연금';
  v[`${C}!B${total + 3}`] = '가짜연금';
  v[`${C}!C${total + 3}`] = 9_000_000;
  v[`${C}!B${total + 4}`] = '퇴직 연금 총액';
  v[`${C}!C${total + 4}`] = 9_000_000;

  v[`${F}!B3`] = '2026.09 갱신';
  v[`${F}!B5`] = '현재 월 급여';
  v[`${F}!C5`] = SALARY;
  v[`${F}!C10`] = '분류';
  v[`${F}!D10`] = '지출 사유';
  v[`${F}!E10`] = '비용';
  FIXED.forEach(([cat, reason, amount], i) => {
    if (cat) v[`${F}!C${11 + i}`] = cat;
    v[`${F}!D${11 + i}`] = reason;
    if (amount !== '') v[`${F}!E${11 + i}`] = amount;
  });
  v[`${F}!D${11 + FIXED.length + 2}`] = '표 밖 메모';
  return { values: v, formulas: { ...v, ...f } };
}

/** 그 칸 값 바꾸기(사용자가 시트에서 고침) — 값 · 수식 둘 다 */
export function setCell(b: FlowBook, tabCell: string, value: Cell): void {
  b.values[tabCell] = value;
  b.formulas[tabCell] = value;
}

/** 탭의 at 줄에 줄 넣기(at 부터 아래로 한 칸) */
export function insertRow(b: FlowBook, tab: string, at: number, set?: Record<string, Cell>): void {
  for (const dict of [b.values, b.formulas]) {
    const entries = Object.entries(dict).filter(([k]) => k.startsWith(`${tab}!`) && Number(/(\d+)$/.exec(k)?.[1]) >= at);
    for (const [k] of entries) delete dict[k];
    for (const [k, val] of entries) dict[k.replace(/(\d+)$/, (n) => String(Number(n) + 1))] = val;
    for (const [col, val] of Object.entries(set ?? {})) dict[`${tab}!${col}${at}`] = val;
  }
}

/** 탭의 at 줄 지우기 */
export function deleteRow(b: FlowBook, tab: string, at: number): void {
  for (const dict of [b.values, b.formulas]) {
    const inTab = Object.entries(dict).filter(([k]) => k.startsWith(`${tab}!`));
    for (const [k] of inTab) delete dict[k];
    for (const [k, val] of inTab) {
      const row = Number(/(\d+)$/.exec(k)?.[1]);
      if (row !== at) dict[row > at ? k.replace(/(\d+)$/, String(row - 1)) : k] = val;
    }
  }
}

/** 가짜 구글 상태 — 쓴 요청마다 범위 목록 · 읽기 수 · `tamper` 면 쓴 값에 1 을 더해 남긴다(다시 읽어 확인 시험) · `failWrite` 면 쓰기 500 */
export interface FakeGoogle {
  book: FlowBook;
  reads: number;
  writes: string[][];
  tamper: boolean;
  failWrite: boolean;
  /** 이 탭 이름을 읽으면 500(「월 고정지출」 읽기 실패) */
  failReadTab: string | null;
}

export function fakeGoogleFetch(g: FakeGoogle, realFetch: typeof fetch): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (!/googleapis\.com/.test(url)) return realFetch(input, init);
    if (url.startsWith('https://oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'fake', expires_in: 3600 }), { status: 200 });
    if ((init?.method ?? 'GET') !== 'GET') {
      if (g.failWrite) return new Response('{}', { status: 500 });
      const body = JSON.parse(String(init?.body)) as { data: { range: string; values: Cell[][] }[] };
      g.writes.push(body.data.map((d) => d.range));
      for (const d of body.data) {
        const m = /^'((?:[^']|'')+)'!([A-Z]\d+)$/.exec(d.range);
        if (!m) continue;
        const key = `${m[1].replace(/''/g, "'")}!${m[2]}`;
        const val = d.values[0][0];
        const stored = g.tamper && typeof val === 'number' ? val + 1 : val;
        g.book.values[key] = stored;
        g.book.formulas[key] = stored;
      }
      return new Response('{}', { status: 200 });
    }
    g.reads++;
    const params = new URL(url).searchParams;
    const ranges = params.getAll('ranges');
    if (g.failReadTab && ranges.some((r) => r.includes(g.failReadTab as string))) return new Response('{}', { status: 500 });
    const m = params.get('valueRenderOption') === 'FORMULA' ? g.book.formulas : g.book.values;
    return new Response(JSON.stringify({ valueRanges: ranges.map((r) => ({ range: r, values: cut(m, r) })) }), { status: 200 });
  }) as typeof fetch;
}
