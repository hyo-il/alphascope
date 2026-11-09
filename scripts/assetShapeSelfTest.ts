/**
 * 자산 시트 구간을 머리 글자로 찾기(v2.66.2 · 119차) — `npm run assetshape:test` · ⚠️ `DB_PATH=<사본>` 으로만 돈다(맨 첫 import).
 * 119차 「꼭 지킬 동작」 2(줄이 늘거나 줄어도 맞게 읽음) · 3(못 찾으면 멈춤) · 4(고정 숫자 0곳) · 5(구글 요청 수) · 6(쓰기 직전 다시 찾기 — 분류 · 매수 매도 · 계좌 이름 날짜)을 줄마다 확인한다.
 * 시트 가격 10초 쓰기 · 되돌리기(6 · 7)는 `assetprice:test` 의 [119-6] · [119-7].
 * 구글: 이 프로세스의 `fetch` 를 바꿔치기한 **가짜 시트**(원본 모양 — 118차 A-0 의 줄 구조 · 만든 값) · 실제 구글 호출 0.
 * ⚠️ 출력에 가짜 금액 · 코드 · 이름을 찍지 않는다.
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { AssetSheetError, resetTokenCache } from '../server/asset/google';
import { parseAssetSheet, readAssetSheet, resetSheetCache, resolveClassRows, sheetRanges, writeAccountDates, writeAssetClasses } from '../server/asset/sheet';
import { findHoldingSections, findTickerGroups, locateRow } from '../server/asset/sheetShape';
import { recordTrade } from '../server/asset/trade';
import type { AssetSheetData } from '../src/types/asset';

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? ` — ${detail}` : ''}`);
}

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-shape-'));
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const keyFile = path.join(tmp, 'sa.json');
fs.writeFileSync(keyFile, JSON.stringify({ client_email: 'selftest@example.invalid', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }));
process.env.ASSET_SHEET_ID = 'selftest-shape-sheet';
process.env.GOOGLE_SA_KEY_FILE = keyFile;
process.env.ASSET_SYNC_ENABLED = 'true';

type Cell = string | number;
type Model = { values: Record<string, Cell>; formulas: Record<string, Cell> };
const H = '주식 투자 정리';
const T = '티커';
const sectionsAt: [string, number, number][] = [['개별 투자 ( 2026.07 )', 5, 9], ['적립식 계좌 ( 2026.10 )', 13, 18], ['ISA 계좌 ( 2026.07 )', 22, 26], ['연금 저축 계좌 ( 2026.07 )', 30, 32]];

/** 원본과 같은 줄 모양 — 머리 13 · 23 · 32 · 39 / 종목 14~21 · 24~25 · 27~30 · 33~37 · 40~42 / 빈 줄 22 · 26 · 31 · 38 */
function model(): Model {
  const v: Record<string, Cell> = {
    [`${T}!B12`]: '구분', [`${T}!D12`]: '자산 분류', [`${T}!G9`]: 1300,
    [`${T}!B13`]: '개별 투자', [`${T}!B23`]: '적립식 투자', [`${T}!B32`]: 'ISA 계좌', [`${T}!B39`]: '연금 저축 계좌',
    '자산 투자 비율 관리!B18': '자산 배분 비율', '월 고정지출!B5': '현재 월 급여', '현금!B25': '은행 자산 총액', '현금!B30': '퇴직 연금 총액',
    [`${H}!B3`]: '내 계좌 정보', [`${H}!B38`]: '내 계좌 정보',
  };
  const tickerRows = [14, 15, 16, 17, 18, 19, 20, 21, 24, 25, 27, 28, 29, 30, 33, 34, 35, 36, 37, 40, 41, 42];
  tickerRows.forEach((row, i) => {
    v[`${T}!B${row}`] = `가짜종목${i}`;
    v[`${T}!C${row}`] = `9${String(i).padStart(5, '0')}`;
    v[`${T}!D${row}`] = '주식';
  });
  const f: Record<string, Cell> = {};
  let t = 0;
  for (const [name, first, last] of sectionsAt) {
    v[`${H}!B${first - 1}`] = name;
    for (let row = first; row <= last; row++, t++) {
      const code = tickerRows[t];
      v[`${H}!B${row}`] = `가짜종목${t}`;
      v[`${H}!C${row}`] = 1000 + t;
      v[`${H}!D${row}`] = 1 + t;
      f[`${H}!F${row}`] = `=D${row}*'티커'!$F$${code}`;
    }
    v[`${H}!C${last + 2}`] = 12345; // 빈 줄 다음 합계 줄(B 비어 있음)
    f[`${H}!C${last + 2}`] = `=SUM(C${first}:C${last})`;
  }
  // 합친 표 39~44
  for (let row = 39; row <= 44; row++) {
    v[`${H}!B${row}`] = `가짜합친${row}`;
    v[`${H}!C${row}`] = 500;
    v[`${H}!D${row}`] = 2;
    f[`${H}!F${row}`] = `=D${row}*'티커'!$F$14`;
  }
  return { values: v, formulas: { ...v, ...f } };
}

/** 사용자가 at 줄을 넣음(at 부터 아래로 한 칸) · `'티커'!$F$NN` 이음 수식도 시트처럼 따라 움직인다 */
function insertRow(m: Model, tab: string, at: number, set?: (row: number, v: Record<string, Cell>) => void): void {
  for (const dict of [m.values, m.formulas]) {
    const entries = Object.entries(dict).filter(([k]) => k.startsWith(`${tab}!`) && Number(/(\d+)$/.exec(k)?.[1]) >= at);
    for (const [k] of entries) delete dict[k];
    for (const [k, v] of entries) dict[k.replace(/(\d+)$/, (n) => String(Number(n) + 1))] = v;
    if (tab === T) {
      for (const [k, v] of Object.entries(dict)) {
        if (typeof v === 'string' && k.startsWith(`${H}!`)) dict[k] = v.replace(/'티커'!\$F\$(\d+)/, (s, n) => (Number(n) >= at ? `'티커'!$F$${Number(n) + 1}` : s));
      }
    }
    set?.(at, dict);
  }
}

/** 사용자가 at 줄을 지움 */
function deleteRow(m: Model, tab: string, at: number): void {
  for (const dict of [m.values, m.formulas]) {
    const inTab = Object.entries(dict).filter(([k]) => k.startsWith(`${tab}!`));
    for (const [k] of inTab) delete dict[k];
    for (const [k, v] of inTab) {
      const row = Number(/(\d+)$/.exec(k)?.[1]);
      if (row === at) continue;
      dict[row > at ? k.replace(/(\d+)$/, String(row - 1)) : k] = v;
    }
  }
}

// ── 가짜 구글 ──
let sheet = model();
const g = { reads: 0, values: 0, formulas: 0, writes: [] as { range: string; value: unknown }[] };
const colNum = (c: string) => c.charCodeAt(0) - 64;
const colChr = (n: number) => String.fromCharCode(64 + n);
function cut(m: Record<string, Cell>, range: string): Cell[][] {
  const r = range.match(/^'((?:[^']|'')+)'!([A-Z])(\d+)(?::([A-Z])(\d+)?)?$/);
  if (!r) throw new Error('범위 모양');
  const tab = r[1].replace(/''/g, "'");
  const [c1, r1] = [colNum(r[2]), Number(r[3])];
  const last = Math.max(r1, ...Object.keys(m).filter((k) => k.startsWith(`${tab}!`)).map((k) => Number(/(\d+)$/.exec(k)?.[1] ?? 0)));
  const [c2, r2] = r[4] ? [colNum(r[4]), r[5] ? Number(r[5]) : last] : [c1, r1];
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
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!/googleapis\.com/.test(url)) return realFetch(input, init);
  if (url.startsWith('https://oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'fake', expires_in: 3600 }), { status: 200 });
  if ((init?.method ?? 'GET') === 'POST') {
    const body = JSON.parse(String(init?.body ?? '{}')) as { data?: { range: string; values?: unknown[][] }[] };
    for (const d of body.data ?? []) {
      const value = d.values?.[0]?.[0];
      g.writes.push({ range: d.range, value });
      const m = d.range.match(/^'((?:[^']|'')+)'!([A-Z]\d+)$/);
      if (m) {
        const key = `${m[1]}!${m[2]}`;
        sheet.formulas[key] = value as Cell;
        // 미국 평균가처럼 수식이 아닌 값만 값 표에도
        sheet.values[key] = typeof value === 'string' && value.startsWith('=') ? 0 : (value as Cell);
      }
    }
    return new Response('{}', { status: 200 });
  }
  g.reads++;
  const params = new URL(url).searchParams;
  const render = params.get('valueRenderOption');
  if (render === 'FORMULA') g.formulas++;
  else g.values++;
  const m = render === 'FORMULA' ? sheet.formulas : sheet.values;
  return new Response(JSON.stringify({ valueRanges: params.getAll('ranges').map((r) => ({ range: r, values: cut(m, r) })) }), { status: 200 });
}) as typeof fetch;

function reset(change?: (m: Model) => void) {
  sheet = model();
  change?.(sheet);
  g.reads = g.values = g.formulas = 0;
  g.writes = [];
  resetSheetCache();
  resetTokenCache();
}
const kindOf = (p: Promise<unknown>) => p.then(() => 'ok', (e) => (e instanceof AssetSheetError ? e.kind : `other:${(e as Error).message}`));
const namesOf = (d: AssetSheetData) => d.sections.map((s) => s.holdings.map((h) => h.name));
const rowsOf = (d: AssetSheetData) => d.sections.map((s) => s.holdings.map((h) => h.row));

/** 옛 고정 줄(5~9 …)로 읽으면 나오는 이름 — 증거 비교용(앱 코드에는 이 숫자가 없다) */
const FIXED = [[5, 9], [13, 18], [22, 26], [30, 32], [39, 44]] as const;
const oldNames = (m: Model) => FIXED.map(([a, b]) => Array.from({ length: b - a + 1 }, (_, k) => m.values[`${H}!B${a + k}`]).filter((x) => x != null && x !== ''));

try {
  // ═══ 2 줄이 늘거나 줄어도 맞게 읽음 ═══
  reset();
  const base = await readAssetSheet();
  check('[119-5] 한 번 읽기 = 값 1번 + 수식 1번(구글 요청 2번 — 지금과 같음)', g.values === 1 && g.formulas === 1 && g.reads === 2);
  check('[119-2] 원본 모양 — 구간 다섯 · 종목 줄 5 · 6 · 5 · 3 · 합친 표 6', JSON.stringify(base.sections.map((s) => s.holdings.length)) === JSON.stringify([5, 6, 5, 3, 6]));
  check('[119-2] 원본 모양 — 첫 줄 번호 5 · 13 · 22 · 30 · 39', JSON.stringify(base.sections.map((s) => s.holdings[0].row)) === JSON.stringify([5, 13, 22, 30, 39]));
  check('[119-2] 원본 모양 — 합계 줄(이름 칸 빈 줄)은 종목이 아님', !base.sections.some((s) => s.holdings.some((h) => [11, 20, 28, 34].includes(h.row))));
  check('[119-2] 계좌 이름은 그 칸의 글자 그대로 · 합친 표는 정해 둔 이름', base.sections[0].name === '개별 투자 ( 2026.07 )' && base.sections[3].name === '연금 저축 계좌 ( 2026.07 )' && base.sections[4].name === '적립식 주식' && base.sections[4].combined);

  const NEW_NAME = '새로넣은종목';
  const grow = (m: Model) => {
    // 개별 투자 끝에 종목 한 줄 · 「티커」 개별 투자 묶음 끝에 한 줄
    insertRow(m, T, 22, (row, d) => {
      d[`${T}!B${row}`] = NEW_NAME;
      d[`${T}!C${row}`] = '777777';
      d[`${T}!D${row}`] = '금';
    });
    insertRow(m, H, 10, (row, d) => {
      d[`${H}!B${row}`] = NEW_NAME;
      d[`${H}!C${row}`] = 700;
      d[`${H}!D${row}`] = 7;
      if (d === m.formulas) d[`${H}!F${row}`] = `=D${row}*'티커'!$F$22`;
    });
  };
  reset(grow);
  const up = await readAssetSheet();
  check('[119-2] 줄이 늘어난 시트 — 개별 투자 6줄(새 줄 포함) · 다른 구간 줄 수 그대로', JSON.stringify(up.sections.map((s) => s.holdings.length)) === JSON.stringify([6, 6, 5, 3, 6]));
  check('[119-2] 줄이 늘어난 시트 — 밀린 줄 번호가 맞음(적립식 14 · ISA 23 · 연금 31 · 합친 표 40)', JSON.stringify(up.sections.map((s) => s.holdings[0].row)) === JSON.stringify([5, 14, 23, 31, 40]));
  const added = up.sections[0].holdings[5];
  check('[119-2] 줄이 늘어난 시트 — 새 줄이 「티커」 새 줄과 이어짐(코드 · 분류)', added.name === NEW_NAME && added.code === '777777' && added.assetClass === '금' && added.tickerRow === 22);
  const pushedT = up.sections[1].holdings[0];
  check('[119-2] 줄이 늘어난 시트 — 밀린 「티커」 줄 이음이 맞음(적립식 첫 줄 → 그 종목 코드)', pushedT.name === base.sections[1].holdings[0].name && pushedT.code === base.sections[1].holdings[0].code);
  check('[119-2] 줄이 늘어난 시트 — 계좌 이름 칸 그대로', JSON.stringify(up.sections.map((s) => s.name)) === JSON.stringify(base.sections.map((s) => s.name)));
  check('[119-2] 옛 고정 줄로 읽으면 틀림(개별 투자 새 줄을 놓침 · 합친 표 마지막 줄을 놓침)', oldNames(sheet)[0].length === 5 && !oldNames(sheet)[0].includes(NEW_NAME) && JSON.stringify(oldNames(sheet)) !== JSON.stringify(namesOf(up)));

  reset((m) => deleteRow(m, H, 7));
  const down = await readAssetSheet();
  check('[119-2] 줄이 줄어든 시트 — 개별 투자 4줄 · 아래 구간이 한 줄씩 올라옴(12 · 21 · 29 · 38)', JSON.stringify(down.sections.map((s) => s.holdings.length)) === JSON.stringify([4, 6, 5, 3, 6]) && JSON.stringify(rowsOf(down).map((r) => r[0])) === JSON.stringify([5, 12, 21, 29, 38]));
  check('[119-2] 옛 고정 줄로 읽으면 틀림(줄어든 시트)', JSON.stringify(oldNames(sheet)) !== JSON.stringify(namesOf(down)));

  // 빈 줄 하나 뒤 종목 줄 — 바꾸기 전 동작 그대로(그 아래 종목을 빼지 않는다)
  reset((m) => {
    delete m.values[`${H}!B7`];
    delete m.formulas[`${H}!B7`];
  });
  const gap = await readAssetSheet();
  check('[119-2] 구간 안 빈 줄 하나 뒤에 종목이 있어도 읽음(8 · 9행 그대로)', rowsOf(gap)[0].join(',') === '5,6,8,9');

  // ═══ 3 못 찾으면 멈춤 ═══
  const fails: [string, (m: Model) => void, RegExp][] = [
    ['계좌 머리 없음', (m) => delete m.values[`${H}!B12`], /적립식 계좌/],
    ['계좌 머리 두 번', (m) => { m.values[`${H}!B15`] = 'ISA 계좌 ( 2026.07 )'; }, /두 번/],
    ['종목 줄 0', (m) => { for (let r = 30; r <= 32; r++) delete m.values[`${H}!B${r}`]; }, /종목 줄이 없습니다/],
    ['「내 계좌 정보」 한 번뿐', (m) => delete m.values[`${H}!B38`], /두 번이어야/],
    ['「티커」 머리 순서 다름', (m) => { m.values[`${T}!B23`] = 'ISA 계좌'; m.values[`${T}!B32`] = '적립식 투자'; }, /순서가 다릅니다/],
    ['「티커」 머리 두 번', (m) => { m.values[`${T}!B23`] = '개별 투자'; }, /두 번입니다/],
    ['「티커」 머리 없음', (m) => { for (const r of [13, 23, 32, 39]) delete m.values[`${T}!B${r}`]; }, /머리/],
    ['「티커」 종목 줄 0', (m) => { for (let r = 14; r <= 42; r++) if (![23, 32, 39].includes(r)) { delete m.values[`${T}!B${r}`]; delete m.values[`${T}!C${r}`]; } }, /종목 줄이 없습니다/],
  ];
  for (const [label, change, msg] of fails) {
    reset(change);
    let err: AssetSheetError | null = null;
    await readAssetSheet().catch((e: unknown) => { err = e instanceof AssetSheetError ? e : null; });
    const got = err as AssetSheetError | null;
    check(`[119-3] ${label} → shape · 문구로 어디인지 · 값을 만들지 않음`, got?.kind === 'shape' && msg.test(got.message) && g.formulas === 0, got?.message ?? '오류 없음');
  }
  for (const [label, change] of fails.slice(0, 3)) {
    reset((m) => { change(m); Object.assign(m.formulas, m.values); for (const k of Object.keys(m.formulas)) if (!(k in m.values) && k.startsWith(`${H}!B`)) delete m.formulas[k]; });
    const before = g.writes.length;
    const k = await kindOf(writeAccountDates('2026-11-27'));
    check(`[119-3] 쓰기에서도 ${label} → shape · 쓰기 0`, k === 'shape' && g.writes.length === before, k);
  }
  for (const [label, change] of fails.slice(4, 6)) {
    reset((m) => { change(m); Object.assign(m.formulas, m.values); });
    const k = await kindOf(writeAssetClasses([14], '금'));
    check(`[119-3] 분류 쓰기에서도 ${label} → shape · 쓰기 0`, k === 'shape' && g.writes.length === 0, k);
  }

  // ═══ 4 고정 숫자 0곳 ═══
  const read = (f: string) => fs.readFileSync(path.join(root, f), 'utf8');
  const layout = read('server/asset/sheetLayout.ts');
  const files = ['server/asset/sheet.ts', 'server/asset/sheetLayout.ts', 'server/asset/priceSheet.ts', 'server/asset/priceWriter.ts', 'server/asset/trade.ts', 'server/asset/settings.ts', 'scripts/assetCheckSheet.ts'];
  const hits = files.filter((f) => /\bfirstRow:\s*\d|\blastRow:\s*\d|\bnameCell\b/.test(read(f)));
  check('[119-4] 고정 firstRow · lastRow · nameCell 숫자가 소스에 0곳', hits.length === 0, hits.join(','));
  check('[119-4] 칸 목록에 보유 탭 고정 머리(B3 · B4 · B12 · B21 · B29 · B38) 없음', !/HOLDINGS_TAB, cell/.test(layout));
  const uses = ['server/asset/sheet.ts', 'server/asset/priceSheet.ts', 'server/asset/priceWriter.ts', 'scripts/assetCheckSheet.ts'].filter((f) => !/sheetShape'/.test(read(f)));
  check('[119-4] 고정 줄을 쓰던 파일이 모두 머리 글자 찾기(sheetShape)를 씀 · trade.ts 는 readAssetSheet 로', uses.length === 0 && /readAssetSheet/.test(read('server/asset/trade.ts')) && !/firstRow|lastRow/.test(read('server/asset/trade.ts')), uses.join(','));
  check('[119-4] 「티커」 머리 줄(B12 · D12) · C9 · G9 등 고정 칸은 그대로', /cell: 'B12'/.test(layout) && /cell: 'D12'/.test(layout) && /fxCell: 'C9'/.test(layout) && /cell: 'G9'/.test(layout));

  // 순수 함수 — 찾는 규칙
  const ranges = sheetRanges();
  check('[119-5] 읽는 범위 수가 늘지 않음(값 — 머리 · 두 탭 · 값 칸 / 수식 — 보유 · 환율 · 티커)', ranges.formulas.length <= 3 && ranges.values.filter((r) => /B1:/.test(r)).length === 2);
  const holdings = findHoldingSections(cut(model().values, `'${H}'!B1:F`));
  check('[119-A] findHoldingSections — key · 머리 줄 · 첫 끝 줄', JSON.stringify(holdings.map((s) => [s.key, s.nameRow, s.firstRow, s.lastRow, s.combined])) === JSON.stringify([['개별 투자', 4, 5, 9, false], ['적립식 계좌', 12, 13, 18, false], ['ISA 계좌', 21, 22, 26, false], ['연금 저축 계좌', 29, 30, 32, false], ['적립식 주식', 38, 39, 44, true]]));
  const groups = findTickerGroups(cut(model().values, `'${T}'!B1:D`));
  check('[119-A] findTickerGroups — 묶음 · 머리 줄 · 종목 줄 수(빈 줄 22 · 26 · 31 · 38 건너뜀)', JSON.stringify(groups.map((x) => [x.group, x.headRow, x.rows.length])) === JSON.stringify([['개별 투자', 13, 8], ['적립식 투자', 23, 6], ['ISA 계좌', 32, 5], ['연금 저축 계좌', 39, 3]]) && !groups.flatMap((x) => x.rows).some((r) => [22, 26, 31, 38].includes(r)));
  const twoBlank = model();
  twoBlank.values[`${T}!B45`] = '메모'; // 43 · 44 빈 줄 두 줄 아래
  twoBlank.values[`${T}!C45`] = '메모칸';
  const noteGroups = findTickerGroups(cut(twoBlank.values, `'${T}'!B1:D`));
  check('[119-A] 빈 줄 두 줄 아래는 종목 줄이 아님(마지막 묶음)', !noteGroups.flatMap((x) => x.rows).includes(45));
  check('[119-7] locateRow — 그대로 · 옮김 · 없음 · 두 줄', locateRow({ row: 5, code: 'A' }, new Map([[5, 'A'], [9, 'A']])) === 5 && locateRow({ row: 5, code: 'A' }, new Map([[6, 'A']])) === 6 && locateRow({ row: 5, code: 'A' }, new Map([[6, 'B']])) === 'missing' && locateRow({ row: 5, code: 'A' }, new Map([[5, 'B'], [6, 'A'], [9, 'A']])) === 'duplicate');
  const asValues = () => ranges.values.map((r) => cut(model().values, r));
  check('[119-A] parseAssetSheet(수식 없음)은 모양 확인 단계로 그대로 돈다', parseAssetSheet(asValues(), [], '2026-01-01T00:00:00.000Z').sections.length === 5);

  // ═══ 6 쓰기 직전 구간을 다시 찾음 ═══
  // 분류 — 화면이 본 줄(14)의 코드로
  reset();
  const seenCode = (await readAssetSheet()).sections[0].holdings[0].code as string;
  insertRow(sheet, T, 14, (row, d) => { d[`${T}!B${row}`] = '끼어든종목'; d[`${T}!C${row}`] = '888888'; d[`${T}!D${row}`] = '채권'; });
  resetSheetCache();
  g.writes = [];
  await writeAssetClasses([14], '금', [seenCode]);
  check('[119-6] 분류 — 읽은 뒤 줄을 넣어도 그 코드의 지금 줄(D15)에 씀 · 끼어든 줄(D14)은 그대로', g.writes.length === 1 && g.writes[0].range === `'티커'!D15` && sheet.values[`${T}!D14`] === '채권' && sheet.values[`${T}!D15`] === '금', g.writes.map((w) => w.range).join(','));
  reset();
  await writeAssetClasses([14], '금');
  check('[119-6] 분류 — codes 를 안 보낸 요청은 줄 번호 그대로(옛 요청 모양)', g.writes.length === 1 && g.writes[0].range === `'티커'!D14`);
  reset();
  const keptKind = await kindOf(writeAssetClasses([14], '금', ['없는코드']));
  check('[119-6] 분류 — 그 코드를 못 찾으면 쓰지 않음(sheet-changed)', keptKind === 'sheet-changed' && g.writes.length === 0, keptKind);
  check('[119-6] 분류 — 같은 코드 줄 수가 같으면 지금 줄들로(묶음) · 수가 다르면 sheet-changed', resolveClassRows([16, 19], ['A', 'A'], new Map([[17, 'A'], [20, 'A'], [16, 'B']])).join(',') === '17,20' && (() => { try { resolveClassRows([16], ['A'], new Map([[17, 'A'], [20, 'A']])); return false; } catch (e) { return e instanceof AssetSheetError && e.kind === 'sheet-changed'; } })());
  reset();
  check('[119-6] 분류 — codes 길이가 다르면 not-editable · 시트를 읽지 않음', (await kindOf(writeAssetClasses([14, 15], '금', ['x']))) === 'not-editable' && g.reads === 0);

  // 매수 · 매도 — 화면이 본 값으로 지금 줄을 찾는다
  const linked = (m: Model) => {
    for (const [cell, v] of Object.entries(m.values)) if (/^주식 투자 정리!D\d+$/.test(cell)) m.formulas[cell] = v;
  };
  reset(linked);
  const seen = (await readAssetSheet()).sections[1].holdings[2]; // 적립식 셋째 줄
  check('[119-6] (준비) 매수 대상 줄이 입력 가능', seen.tradable === true && seen.row === 15);
  insertRow(sheet, H, 13, (row, d) => {
    d[`${H}!B${row}`] = '끼어든보유';
    d[`${H}!C${row}`] = 1;
    d[`${H}!D${row}`] = 1;
  });
  resetSheetCache();
  g.writes = [];
  await recordTrade({ section: '적립식 계좌', row: seen.row, side: 'buy', qty: 1, price: seen.avgPrice as number, expect: { name: seen.name, code: seen.code, quantity: seen.quantity, avgPrice: seen.avgPrice } });
  check('[119-6] 매수 — 읽은 뒤 줄을 넣어도 같은 종목의 지금 줄(16행)에 씀 · 옛 줄(15)에 안 씀', g.writes.length === 2 && g.writes.every((w) => /[CD]16$/.test(w.range)), g.writes.map((w) => w.range).join(','));
  reset(linked);
  const seen2 = (await readAssetSheet()).sections[1].holdings[2];
  const wrong = await kindOf(recordTrade({ section: '적립식 계좌', row: seen2.row, side: 'buy', qty: 1, price: 1000, expect: { name: seen2.name, code: seen2.code, quantity: 999, avgPrice: seen2.avgPrice } }));
  check('[119-6] 매수 — 화면이 본 수량과 달라 찾지 못하면 쓰지 않음(sheet-changed)', wrong === 'sheet-changed' && g.writes.length === 0, wrong);

  // 계좌 이름 날짜 — 줄을 넣은 뒤 찾은 머리 줄에 쓴다
  reset((m) => insertRow(m, H, 6, (row, d) => { d[`${H}!B${row}`] = '끼어든보유'; d[`${H}!C${row}`] = 1; d[`${H}!D${row}`] = 1; }));
  const dates = await writeAccountDates('2026-11-27');
  const written = g.writes.map((w) => w.range).sort().join(',');
  check('[119-6] 계좌 이름 날짜 — 줄을 넣어도 찾은 머리 줄(B4 · B13 · B22 · B30)에 씀', dates.cells === 4 && written === [`'${H}'!B13`, `'${H}'!B22`, `'${H}'!B30`, `'${H}'!B4`].sort().join(','), written);
} finally {
  globalThis.fetch = realFetch;
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n결과: ${pass}개 통과 / ${fail}개 실패`);
process.exit(fail ? 1 : 0);
