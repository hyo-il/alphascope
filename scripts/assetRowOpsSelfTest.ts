/**
 * 자산 줄 넣기 · 지우기 서버 시험(120차 · v2.67.0) — `npm run assetrowops:test` · ⚠️ `DB_PATH=<사본>` 으로만 돈다(맨 첫 import).
 *
 * 120차 지시서 「꼭 지킬 동작」 1~8 · 11 · 12 를 줄마다 확인한다(시험 이름 앞의 [120-n] 이 그 줄 번호 · 9 는 시험용 시트 실제 확인 · 10 은 옛 시험 · 7 의 화면은 `assettradeui:test`).
 * 구글: 이 프로세스의 `fetch` 를 바꿔치기한 가짜 시트(만든 값 · 줄을 넣고 지우면 구글처럼 모든 탭의 수식 줄 번호를 옮긴다) — 실제 구글 호출 0.
 * ⚠️ 출력에 가짜 금액 · 수량 · 이름 · 코드를 찍지 않는다(끝에서 검사).
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { getDb } from '../server/db';
import { createSession, setPassword } from '../server/auth';
import { setAssetPassword } from '../server/asset/lock';
import { ACTIVE, assetRouter } from '../server/asset/routes';
import { authGuard } from '../server/authGuard';
import { AssetSheetError, resetTokenCache, structureWrite, type StructureRequest } from '../server/asset/google';
import { assetSheetConfig } from '../server/asset/config';
import { resetSheetCache } from '../server/asset/sheet';
import { clearTradesForTest } from '../server/asset/trade';
import { clearSheetKeyForTest } from '../server/asset/sheetSwitch';
import { clearPriceStateForTest, priceRows, savePriceState, setPriceToolsForTest } from '../server/asset/priceState';
import { clearSheetBackup, saveSheetBackup, sheetBackup } from '../server/asset/store';
import { defaultPrefix, findRowRefs, linkFormulaFor, parseRefs } from '../server/asset/rowOps';

const root = path.resolve(import.meta.dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-rowops-'));
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const keyFile = path.join(tmp, 'sa.json');
fs.writeFileSync(keyFile, JSON.stringify({ client_email: 'selftest-sa@selftest.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }));
process.env.ASSET_SHEET_ID = 'SelfTestRowOpsSheetIdNotReal0123456789';
process.env.GOOGLE_SA_KEY_FILE = keyFile;
process.env.ASSET_SYNC_ENABLED = 'true';
process.env.ASSET_PRICE_WRITE_ENABLED = 'false';

let pass = 0;
let fail = 0;
const printed: string[] = [];
const realLog = console.log;
const realWarn = console.warn;
console.log = (...a: unknown[]) => {
  printed.push(a.join(' '));
  realLog(...a);
};
console.warn = (...a: unknown[]) => {
  printed.push(a.join(' '));
  realWarn(...a);
};
function check(name: string, ok: boolean, detail = '') {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? ` — ${detail}` : ''}`);
}

type Cell = string | number;
type Book = Record<string, Record<string, Cell>>; // 탭 → 「B5」 → 값(수식은 = 로 시작)
const H = '주식 투자 정리';
const T = '티커';
const OTHER = '요약';
const NAME = { a: '가짜 미국하나', b: '가짜 국내하나', c: '가짜 국내둘', d: '가짜 적립하나', e: '가짜 적립둘', f: '가짜 아이하나', g: '가짜 아이둘', h: '가짜 연금하나', i: '가짜 연금둘', nk: '가짜 새국내', nu: '가짜 새나스닥', ny: '가짜 새뉴욕', am: '가짜 새아멕스' };
const CODE = { a: 'NASDAQ:FAKA', b: '999101', c: '999102', d: '999103', e: 'NYSEARCA:FAKE', f: '999105', g: '999106', h: '999107', i: 'NYSE:FAKI' };
const NEW = { nk: '999201', nu: 'FAKNU', ny: 'FAKNY', am: 'FAKAM' };
const usd = (d: number | string) => `=(${d})*('티커'!$G$9)`;
const gf = (r: number) => `=GOOGLEFINANCE(C${r},"price")`;
const gfUs = (r: number) => `=GOOGLEFINANCE($C${r},"price")*$C$9`;

function tickerLine(b: Book, r: number, name: string, code: string, cls: string): void {
  const us = code.includes(':');
  Object.assign(b[T], { [`B${r}`]: name, [`C${r}`]: code, [`D${r}`]: cls, [`E${r}`]: gf(r), [`F${r}`]: us ? gfUs(r) : gf(r), [`G${r}`]: `=GOOGLEFINANCE(C${r},"change")`, [`H${r}`]: `=G${r}/E${r}`, [`I${r}`]: `=GOOGLEFINANCE(C${r},"volume")` });
}
function holdingLine(b: Book, r: number, name: string, avg: Cell, qty: number, link: number): void {
  Object.assign(b[H], { [`B${r}`]: name, [`C${r}`]: avg, [`D${r}`]: qty, [`E${r}`]: `=C${r}*D${r}`, [`F${r}`]: `=D${r}*'티커'!$F$${link}`, [`G${r}`]: `=F${r}-E${r}`, [`H${r}`]: `=G${r}/E${r}` });
}

/** 만든 시트 — 보유 구간 아래 = 빈 줄 하나 + 합계 줄(B열 글자 없음 — 원본 모양) · 「티커」 묶음 뒤 빈 줄(마지막 묶음은 없음) */
function sheet(): Book {
  const b: Book = { [H]: {}, [T]: {}, [OTHER]: {}, '자산 투자 비율 관리': { B18: '자산 배분 비율' }, '월 고정지출': { B5: '현재 월 급여' }, 현금: { B25: '은행 자산 총액', B30: '퇴직 연금 총액' } };
  Object.assign(b[T], { B12: '구분', D12: '자산 분류', G9: 1300, C9: 1300, B14: '개별 투자', B19: '적립식 투자', B23: 'ISA 계좌', B27: '연금 저축 계좌' });
  tickerLine(b, 15, NAME.a, CODE.a, '주식');
  tickerLine(b, 16, NAME.b, CODE.b, '주식');
  tickerLine(b, 17, NAME.c, CODE.c, '채권');
  // 18 빈 줄
  tickerLine(b, 20, NAME.d, CODE.d, '주식');
  tickerLine(b, 21, NAME.e, CODE.e, '금');
  // 22 빈 줄
  tickerLine(b, 24, NAME.f, CODE.f, '주식');
  tickerLine(b, 25, NAME.g, CODE.g, '주식');
  // 26 빈 줄
  tickerLine(b, 28, NAME.h, CODE.h, '주식');
  tickerLine(b, 29, NAME.i, CODE.i, '주식');
  Object.assign(b[H], { B3: '내 계좌 정보', B4: '개별 투자 ( 2026.07 )', B11: '적립식 계좌 ( 2026.10 )', B17: 'ISA 계좌 ( 2026.07 )', B23: '연금 저축 계좌 ( 2026.07 )', B29: '내 계좌 정보' });
  holdingLine(b, 5, NAME.a, usd(100.5), 10, 15);
  holdingLine(b, 6, NAME.b, 70000, 3, 16);
  holdingLine(b, 7, NAME.c, 60000, 2, 17);
  b[H].E9 = '=SUM(E5:E7)';
  b[H].G9 = '=SUM(G5:G7)';
  holdingLine(b, 12, NAME.d, 1000, 1, 20);
  holdingLine(b, 13, NAME.e, usd(50), 1, 21);
  b[H].E15 = '=SUM(E12:E13)';
  holdingLine(b, 18, NAME.f, 1000, 1, 24);
  holdingLine(b, 19, NAME.g, 1000, 1, 25);
  b[H].E21 = '=SUM(E18:E19)';
  holdingLine(b, 24, NAME.h, 1000, 1, 28);
  holdingLine(b, 25, NAME.i, usd(70), 1, 29);
  b[H].E27 = '=SUM(E24:E25)';
  holdingLine(b, 30, NAME.d, 1000, 1, 20); // 합친 표
  b[OTHER].B2 = `='주식 투자 정리'!E9`; // 합계 칸을 가리키는 다른 탭
  b[OTHER].B3 = `='티커'!$F$29`;
  b[OTHER].B4 = `=SUM('주식 투자 정리'!E5:E7)`; // 범위 — 지워도 구글이 줄인다
  return b;
}

// ── 가짜 구글 ──
let model = sheet();
const g = { reads: 0, writes: 0, structure: [] as StructureRequest[][], valueBatches: [] as { input: string; ranges: string[] }[], failAt: 0, lie: false, autoExpand: false, realCalls: 0, computed: {} as Record<string, Cell> };
const IDS: Record<string, number> = { [H]: 101, [T]: 102, [OTHER]: 103, '자산 투자 비율 관리': 104, '월 고정지출': 105, 현금: 106 };
const tabOf = (id: number) => Object.keys(IDS).find((k) => IDS[k] === id) as string;
const colN = (c: string) => [...c].reduce((a, x) => a * 26 + x.charCodeAt(0) - 64, 0);
const colC = (n: number) => {
  let s = '';
  for (let v = n; v > 0; v = Math.floor((v - 1) / 26)) s = String.fromCharCode(65 + ((v - 1) % 26)) + s;
  return s;
};
const splitKey = (k: string) => {
  const m = /^([A-Z]+)(\d+)$/.exec(k) as RegExpExecArray;
  return { col: m[1], row: Number(m[2]) };
};

function reset(change?: (m: Book) => void) {
  model = sheet();
  change?.(model);
  Object.assign(g, { reads: 0, writes: 0, structure: [], valueBatches: [], failAt: 0, lie: false, autoExpand: false, computed: {} });
  resetSheetCache();
  resetTokenCache();
}

/** 수식 속 주소를 구글처럼 옮긴다 — 시험 쪽 독립 구현(앱의 해석기를 쓰지 않는다) */
const FORMULA_REF = /((?:'[^']+'|[A-Za-z가-힣0-9_]+)!)?(\$?[A-Z]{1,3}\$?)(\d+)(?::(\$?[A-Z]{1,3}\$?)(\d+))?(?![A-Za-z0-9(])/g;
function adjust(formula: string, formulaTab: string, tab: string, at: number, kind: 'insert' | 'delete'): string {
  if (!formula.startsWith('=')) return formula;
  return formula.split('"').map((part, i) => i % 2 === 1 ? part : part.replace(FORMULA_REF, (all, pfx: string | undefined, c1: string, r1: string, c2: string | undefined, r2: string | undefined) => {
    const target = pfx ? pfx.slice(0, -1).replace(/^'|'$/g, '') : formulaTab;
    if (target !== tab) return all;
    const a = Number(r1);
    const b = r2 == null ? null : Number(r2);
    if (kind === 'insert') {
      if (b == null) return `${pfx ?? ''}${c1}${a >= at ? a + 1 : a}`;
      const end = b >= at || (g.autoExpand && b === at - 1) ? b + 1 : b;
      return `${pfx ?? ''}${c1}${a >= at ? a + 1 : a}:${c2}${end}`;
    }
    if (b == null) return a === at ? '#REF!' : `${pfx ?? ''}${c1}${a > at ? a - 1 : a}`;
    if (a === at && b === at) return '#REF!';
    return `${pfx ?? ''}${c1}${a > at ? a - 1 : a}:${c2}${b >= at ? b - 1 : b}`;
  })).join('"');
}
function shiftBook(tab: string, at: number, kind: 'insert' | 'delete') {
  const moved: Record<string, Cell> = {};
  for (const [k, v] of Object.entries(model[tab])) {
    const { col, row } = splitKey(k);
    if (kind === 'delete' && row === at) continue;
    moved[`${col}${row >= at ? (kind === 'insert' ? row + 1 : row > at ? row - 1 : row) : row}`] = v;
  }
  model[tab] = moved;
  for (const [t, cells] of Object.entries(model)) for (const k of Object.keys(cells)) if (typeof cells[k] === 'string') cells[k] = adjust(cells[k] as string, t, tab, at, kind);
}
function relative(formula: string, delta: number): string {
  if (!formula.startsWith('=')) return formula;
  return formula.split('"').map((p, i) => i % 2 === 1 ? p : p.replace(/(?<![!$A-Za-z가-힣'])(\$?[A-Z]{1,3})(\$?)(\d+)(?![A-Za-z0-9(])/g, (all, c: string, abs: string, r: string) => (abs ? all : `${c}${Number(r) + delta}`))).join('"');
}
function applyStructure(reqs: StructureRequest[]) {
  for (const r of reqs) {
    if ('insertDimension' in r) shiftBook(tabOf(r.insertDimension.range.sheetId), r.insertDimension.range.startIndex + 1, 'insert');
    else if ('deleteDimension' in r) shiftBook(tabOf(r.deleteDimension.range.sheetId), r.deleteDimension.range.startIndex + 1, 'delete');
    else {
      const { source: s, destination: d } = r.copyPaste;
      const tab = tabOf(s.sheetId);
      const from = s.startRowIndex + 1;
      const to = d.startRowIndex + 1;
      const c0 = (s.startColumnIndex ?? 0) + 1;
      const c1 = s.endColumnIndex ?? 40;
      for (let c = c0; c <= c1; c++) {
        const v = model[tab][`${colC(c)}${from}`];
        if (v === undefined) delete model[tab][`${colC(c)}${to}`];
        else model[tab][`${colC(c)}${to}`] = typeof v === 'string' ? relative(v, to - from) : v;
      }
    }
  }
}
function parseRange(range: string) {
  const m = /^'((?:[^']|'')+)'(?:!([A-Z]+)(\d+)(?::([A-Z]+)(\d+)?)?)?$/.exec(range);
  if (!m) throw new Error('범위 모양');
  const tab = m[1].replace(/''/g, "'");
  const keys = Object.keys(model[tab] ?? {}).map(splitKey);
  const lastRow = Math.max(1, ...keys.map((k) => k.row));
  const lastCol = Math.max(1, ...keys.map((k) => colN(k.col)));
  if (!m[2]) return { tab, c1: 1, r1: 1, c2: lastCol, r2: lastRow };
  return { tab, c1: colN(m[2]), r1: Number(m[3]), c2: m[4] ? colN(m[4]) : colN(m[2]), r2: m[5] ? Number(m[5]) : m[4] ? lastRow : Number(m[3]) };
}
function cut(range: string, formula: boolean): Cell[][] {
  const { tab, c1, r1, c2, r2 } = parseRange(range);
  const rows: Cell[][] = [];
  for (let y = r1; y <= r2; y++) {
    const row: Cell[] = [];
    for (let x = c1; x <= c2; x++) {
      const v = model[tab]?.[`${colC(x)}${y}`] ?? '';
      row.push(!formula && typeof v === 'string' && v.startsWith('=') ? (g.computed[`${tab}!${colC(x)}${y}`] ?? 0) : v);
    }
    while (row.length && row[row.length - 1] === '') row.pop();
    rows.push(row);
  }
  while (rows.length && rows[rows.length - 1].length === 0) rows.pop();
  return rows;
}
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (/^http:\/\/127\.0\.0\.1:\d+\//.test(url)) return realFetch(input, init);
  if (!/googleapis\.com/.test(url)) {
    g.realCalls++;
    throw new Error('시험 — 바깥 주소 호출 막음');
  }
  if (url.startsWith('https://oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'fake', expires_in: 3600 }), { status: 200 });
  if ((init?.method ?? 'GET') !== 'GET') {
    g.writes++;
    if (g.failAt === g.writes) return new Response('{}', { status: 500 });
    const body = JSON.parse(String(init?.body)) as { requests?: StructureRequest[]; valueInputOption?: string; data?: { range: string; values: Cell[][] }[] };
    if (url.endsWith(':batchUpdate') && !url.includes('values:')) {
      g.structure.push(body.requests as StructureRequest[]);
      applyStructure(body.requests as StructureRequest[]);
    } else {
      const data = body.data as { range: string; values: Cell[][] }[];
      g.valueBatches.push({ input: body.valueInputOption as string, ranges: data.map((d) => d.range) });
      for (const d of data) {
        const { tab, c1, r1 } = parseRange(d.range);
        const key = `${colC(c1)}${r1}`;
        if (d.values[0][0] === '') delete model[tab][key];
        else model[tab][key] = g.lie ? 1 : d.values[0][0];
      }
    }
    return new Response('{}', { status: 200 });
  }
  g.reads++;
  const u = new URL(url);
  if (u.searchParams.has('fields')) return new Response(JSON.stringify({ sheets: [...Object.keys(IDS).map((title) => ({ properties: { sheetId: IDS[title], title, sheetType: 'GRID' } })), { properties: { sheetId: 900, title: '차트', sheetType: 'OBJECT' } }] }), { status: 200 });
  const asFormula = u.searchParams.get('valueRenderOption') === 'FORMULA';
  return new Response(JSON.stringify({ valueRanges: u.searchParams.getAll('ranges').map((r) => ({ range: r, values: cut(r, asFormula) })) }), { status: 200 });
}) as typeof fetch;

await setPassword('selftest-assetrowops-login-0001');
await setAssetPassword('selftest-assetrowops-lock-0002');
clearSheetKeyForTest();
clearTradesForTest();
clearPriceStateForTest();
clearSheetBackup();
const upsert = getDb().prepare(`INSERT INTO stock_catalog (symbol, name, english_name, market, updated_at) VALUES (?, ?, '', ?, ?) ON CONFLICT(symbol) DO UPDATE SET name = excluded.name, market = excluded.market`);
const STAMP = new Date().toISOString();
for (const [s, n, m] of [[NEW.nk, NAME.nk, 'KOSPI'], [NEW.nu, NAME.nu, 'NASDAQ'], [NEW.ny, NAME.ny, 'NYSE'], [NEW.am, NAME.am, 'AMEX'], ['FAKA', NAME.a, 'NASDAQ'], [CODE.b, NAME.b, 'KOSPI'], ['FAKE', NAME.e, 'AMEX'], ['FAKI', NAME.i, 'NYSE']] as const) upsert.run(s, n, m, STAMP);

const app = express();
app.use(express.json());
app.use(authGuard);
app.use(assetRouter);
const srv = app.listen(0, '127.0.0.1');
await new Promise((ok) => srv.once('listening', ok));
const API = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
const token = createSession('assetrowops-selftest');
const ck = { cookie: `as_session=${encodeURIComponent(token)}` };
async function call(method: string, p: string, body?: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${API}${p}`, { method, headers: { ...ck, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}
await call('POST', '/api/asset/unlock', { password: 'selftest-assetrowops-lock-0002' });

const SEC = { a: '개별 투자', b: '적립식 계좌', c: 'ISA 계좌', d: '연금 저축 계좌' };
const buyNew = (b: Record<string, unknown>) => call('POST', '/api/asset/trade/new', b);
const krNew = { section: SEC.a, symbol: NEW.nk, exchange: null, qty: 7, price: 12340, assetClass: '채권' };
const usNew = { section: SEC.d, symbol: NEW.nu, exchange: null, qty: 1.5, price: 55.25, assetClass: '주식' };
const sell = (b: Record<string, unknown>) => call('POST', '/api/asset/trade', { side: 'sell', ...b });
const rows = () => (getDb().prepare(`SELECT COUNT(*) AS n FROM asset_trades`).get() as { n: number }).n;
const last = () => getDb().prepare(`SELECT * FROM asset_trades ORDER BY id DESC LIMIT 1`).get() as Record<string, unknown>;
const snapshot = () => JSON.stringify(model);
const kindsOf = () => g.structure.flat().map((r) => Object.keys(r)[0]);
const rangesWritten = () => g.valueBatches.flatMap((b) => b.ranges);
const combinedKeys = (m: Book) => Object.keys(m[H]).filter((k) => splitKey(k).row >= 29);

try {
  // ═══ 수식 해석 ═══
  {
    const refs = parseRefs(`=SUM(E5:E7)+LOG10(A1)+'티커'!$F$15&"B9"+D5`);
    check('[120-5] 수식 해석 — 범위 · 함수 이름 제외 · 따옴표 글자 제외 · 탭 이름', refs.length === 4 && refs[0].range && refs[0].endRow === 7 && refs[2].tab === '티커' && refs[2].row === 15 && refs[3].row === 5, JSON.stringify(refs.map((r) => r.row)));
    check('[120-1] 이음 수식 — 상대 줄만 옮기고 「티커」 줄 번호만 바꿈', linkFormulaFor(`=D7*'티커'!$F$17`, 1, 42) === `=D8*'티커'!$F$42` && linkFormulaFor(`='티커'!$F$9`, 1, 30) === `='티커'!$F$30`);
    const tabs = new Map([['가', [[], ['', `='나'!C5`, '=SUM(C1:C9)']]], ['나', [[], [], [], [], ['', '', '=C4'], [`=A5`, `=SUM(C5:C5)`]]]]);
    check('[120-5] 가리킴 찾기 — 한 칸 · 한 줄짜리 범위만 · 여러 줄 범위와 그 줄 자신은 뺌', JSON.stringify(findRowRefs(tabs as never, '나', 5)) === JSON.stringify(['「가」 B2', '「나」 A6', '「나」 B6']), JSON.stringify(findRowRefs(tabs as never, '나', 5)));
  }

  // ═══ 1. 새 종목 · 보유 줄 ═══
  {
    reset();
    const before = rows();
    const r = await buyNew(krNew);
    check('[120-1] 국내 새 종목 — 200 · mode new · 기록 new_row=1', r.status === 200 && r.body.mode === 'new' && rows() === before + 1 && last().new_row === 1 && last().deleted_row === 0, JSON.stringify(r.body));
    const h = model[H];
    check('[120-1] 보유 줄이 구간 맨 아래 다음(8행) · 다음 구간은 한 줄 밀림', h.B8 === NAME.nk && h.B5 === NAME.a && h.B9 === undefined && h.B12 === '적립식 계좌 ( 2026.10 )' && h.B13 === NAME.d);
    check('[120-1] 이름 · 평균가(숫자) · 수량 값', h.C8 === 12340 && h.D8 === 7);
    check('[120-1] 위 줄 수식 복사(E · G · H 상대 줄 번호 옮김)', h.E8 === '=C8*D8' && h.G8 === '=F8-E8' && h.H8 === '=G8/E8', String(h.E8));
    check('[120-1] F 는 「티커」 새 줄(18행)을 이음', h.F8 === `=D8*'티커'!$F$18`, String(h.F8));
    check('[120-1] 줄 넣기 + 위 줄 복사(요청에 insertDimension · copyPaste)', g.structure.some((x) => x.length === 2 && 'insertDimension' in x[0] && x[0].insertDimension.range.startIndex === 7 && x[0].insertDimension.inheritFromBefore === true && 'copyPaste' in x[1] && x[1].copyPaste.source.startRowIndex === 6 && x[1].copyPaste.destination.startRowIndex === 7));
    check('[120-1] 합계 범위가 새 줄 포함(안 늘어나 범위 끝만 늘림 — E · G 합계 둘 다)', h.E10 === '=SUM(E5:E8)' && h.G10 === '=SUM(G5:G8)', `${h.E10} ${h.G10}`);
    check('[120-1] 합계를 고친 쓰기는 그 칸뿐(수식 USER_ENTERED)', g.valueBatches.some((b) => b.input === 'USER_ENTERED' && b.ranges.join() === `'${H}'!E10,'${H}'!G10`), JSON.stringify(g.valueBatches.at(-1)));
    check('[120-1] 다른 탭 수식 — 합계 칸을 가리키는 수식은 구글이 옮긴 그대로(앱이 쓰지 않음)', model[OTHER].B2 === `='주식 투자 정리'!E10` && !rangesWritten().some((x) => x.includes(OTHER)));
    // 합계 범위가 빈 줄까지 들어 있으면 늘어난다 — 범위 끝 늘리기 없음
    reset((m) => { m[H].E9 = '=SUM(E5:E8)'; m[H].G9 = '=SUM(G5:G8)'; });
    await buyNew(krNew);
    check('[120-1] 합계 범위가 빈 줄까지면 저절로 늘어남 · 합계 칸 쓰기 0', model[H].E10 === '=SUM(E5:E9)' && !rangesWritten().some((x) => x.endsWith('E10') || x.endsWith('G10')), String(model[H].E10));
    // 구글이 저절로 늘리는 경우
    reset();
    g.autoExpand = true;
    await buyNew(krNew);
    check('[120-1] 구글이 범위를 늘렸으면 합계 칸 쓰기 0', model[H].E10 === '=SUM(E5:E8)' && !rangesWritten().some((x) => x.endsWith('E10')), String(model[H].E10));
    reset((m) => { delete m[H].E9; delete m[H].G9; });
    const n = rows();
    const noSum = await buyNew(krNew);
    check('[120-1] 합계 줄을 못 찾으면 쓰지 않음(shape · 쓰기 0 · 기록 0)', noSum.body.kind === 'shape' && g.writes === 0 && rows() === n, String(noSum.body.kind));
    reset();
    const us = await buyNew(usNew);
    check('[120-1] 미국 새 종목 — 평균가 수식 `=(달러)*(티커 G9)` · 수량 소수 · 연금 구간 맨 아래(26행)', us.status === 200 && model[H].C26 === usd(55.25) && model[H].D26 === 1.5 && model[H].B26 === NAME.nu, String(model[H].C26));
    check('[120-1] 기록 — 앞 수량 0 · 뒤 수량 · 원래 통화', last().before_qty === 0 && last().after_qty === 1.5 && last().after_avg === 55.25 && last().currency === 'USD' && last().symbol === NEW.nu);
  }

  // ═══ 2. 「티커」 ═══
  {
    reset();
    await buyNew(krNew);
    check('[120-2] 빈 줄 먼저 — 「티커」 18행(줄 넣기 0 · 복사 1)', model[T].B18 === NAME.nk && model[T].C18 === NEW.nk && model[T].D18 === '채권' && g.structure[0].length === 1 && 'copyPaste' in g.structure[0][0]);
    check('[120-2] 빈 줄 칸 — G · H · I 는 위 종목 줄 모양 복사', model[T].G18 === '=GOOGLEFINANCE(C18,"change")' && model[T].H18 === '=G18/E18', String(model[T].G18));
    check('[120-2] 코드는 RAW 로 글자 그대로(국내 6자리)', g.valueBatches[0].input === 'RAW' && g.valueBatches[0].ranges.includes(`'${T}'!C18`));
    check('[120-2] 가격 칸 — GOOGLEFINANCE 시트면 같은 모양(국내)', model[T].E18 === gf(18) && model[T].F18 === gf(18), `${model[T].E18} ${model[T].F18}`);
    check('[120-2] 시트 가격 google 이면 priceRows 에 더하지 않음', priceRows().length === 0);
    reset();
    await buyNew(usNew);
    check('[120-2] 빈 줄 없음(연금 묶음) → 줄 넣기 + 복사 + 값 · 묶음 마지막 다음(30행)', model[T].B30 === NAME.nu && model[T].C30 === `NASDAQ:${NEW.nu}` && 'insertDimension' in g.structure[0][0] && g.structure[0][0].insertDimension.range.startIndex === 29 && 'copyPaste' in g.structure[0][1]);
    check('[120-2] 가격 칸 — GOOGLEFINANCE 시트면 같은 모양(미국 환율 곱)', model[T].E30 === gf(30) && model[T].F30 === gfUs(30), `${model[T].F30}`);
    check('[120-2] 보유 줄 F 가 그 줄을 이음', String(model[H].F26).includes('$F$30'));
    const krInUsGroup = await (async () => {
      reset();
      await buyNew({ ...krNew, section: SEC.d });
      return model[T].F30 === gf(30);
    })();
    check('[120-2] 미국 묶음에 국내 종목 — 위 줄이 달라도 F 는 환율 곱 없는 국내 모양', krInUsGroup, String(model[T].F30));
    // 코드가 이미 있음 — 다른 계좌
    reset();
    const shared = await buyNew({ section: SEC.c, symbol: 'FAKA', exchange: null, qty: 2, price: 100, assetClass: '' });
    check('[120-2] 코드가 이미 있으면 「티커」 새 줄 0(다른 묶음의 줄을 같이 씀) · 앞부분은 시트 코드', shared.status === 200 && g.structure.length === 1 && String(model[H].F20).includes('$F$15') && !rangesWritten().some((x) => x.startsWith(`'${T}'`)), JSON.stringify(g.valueBatches));
    // 코드 칸이 수식인 줄(시험용 시트에서 찾음) — 계산된 값으로 알아본다
    reset((m) => { m[T].C25 = '=IMPORTXML("https://example.invalid","//x")'; });
    g.computed[`${T}!C25`] = NEW.nk;
    const viaFormula = await buyNew(krNew);
    check('[120-2] 코드 칸이 수식인 줄도 계산된 코드로 알아봄 — 「티커」 새 줄 0 · 그 줄을 이음', viaFormula.status === 200 && g.structure.length === 1 && String(model[H].F8).includes('$F$25') && model[T].B18 === undefined, JSON.stringify(viaFormula.body));
    // 토스 시트
    reset();
    savePriceState({ source: 'toss', rows: [{ row: 15, code: CODE.a, market: 'US', name: NAME.a }] });
    setPriceToolsForTest({ quotes: async (s) => new Map(s.map((x) => [x, 4321])), rate: async () => 1300 });
    await buyNew(krNew);
    check('[120-2] 토스 시트 — 가격 칸 숫자 · F = `=E행` · priceRows 에 더함', model[T].E18 === 4321 && model[T].F18 === '=E18' && priceRows().some((r) => r.row === 18 && r.code === NEW.nk && r.market === 'KR'), String(model[T].F18));
    check('[120-2] 토스 시트 — [되돌리기] 때 넣을 GOOGLEFINANCE 수식을 백업에 둠', sheetBackup().some((b) => b.cell === 'E18' && b.formula === gf(18)));
    // 토스 가격을 못 받으면 아무것도 쓰지 않음
    reset();
    savePriceState({ source: 'toss', rows: [] });
    setPriceToolsForTest({ quotes: async () => new Map(), rate: async () => 1300 });
    const noPrice = await buyNew(krNew);
    check('[120-2] 토스 가격 못 받음 — 쓰기 0 · 502 network', noPrice.status === 502 && g.writes === 0, String(noPrice.body.kind));
    // 줄을 넣으면 앱의 줄 기록도 옮김
    reset((m) => { tickerLine(m, 18, '가짜 빈줄없앰', '999301', ''); });
    clearSheetBackup();
    savePriceState({ source: 'toss', rows: [{ row: 15, code: CODE.a, market: 'US' }, { row: 20, code: CODE.d, market: 'KR' }], skipped: [], moved: [] });
    saveSheetBackup([{ cell: 'E20', formula: gf(20) }, { cell: 'F20', formula: gf(20) }, { cell: 'E15', formula: gf(15) }], STAMP);
    setPriceToolsForTest({ quotes: async (s) => new Map(s.map((x) => [x, 4321])), rate: async () => 1300 });
    await buyNew(krNew);
    const shiftedOk = priceRows().some((r) => r.row === 21 && r.code === CODE.d) && priceRows().some((r) => r.row === 15) && sheetBackup().some((b) => b.cell === 'E21' && b.formula === gf(21)) && sheetBackup().some((b) => b.cell === 'E15');
    check('[120-2] 묶음 중간에 줄을 넣으면 그 아래 priceRows · 백업 칸 · 수식 줄 번호도 한 줄 내림', shiftedOk, JSON.stringify(priceRows().map((r) => r.row)));
    savePriceState({ source: 'google', rows: [], skipped: [], moved: [] });
    clearSheetBackup();
    setPriceToolsForTest(null);
  }

  // ═══ 3. 이미 가진 종목 ═══
  {
    reset();
    const n = rows();
    const plan = await call('POST', '/api/asset/trade/new/plan', { section: SEC.a, symbol: CODE.b, exchange: null });
    check('[120-3] 확인 화면 — 이미 있음 · 줄 번호 · 쓰기 0', plan.status === 200 && (plan.body.existing as { row: number }).row === 6 && g.writes === 0, JSON.stringify(plan.body.existing));
    const r = await buyNew({ section: SEC.a, symbol: CODE.b, exchange: null, qty: 2, price: 71001, assetClass: '금' });
    check('[120-3] 이미 가진 종목 → 매수로 처리(줄 넣기 0 · 수량 합 · 평균 원 단위)', r.status === 200 && r.body.mode === 'buy' && g.structure.length === 0 && model[H].D6 === 5 && model[H].C6 === 70400 && rows() === n + 1 && last().new_row === 0, JSON.stringify(r.body));
    check('[120-3] 매수로 처리하면 「티커」 분류를 건드리지 않음', model[T].D16 === '주식');
  }

  // ═══ 4. 중간 실패 ═══
  {
    for (const [label, body, total] of [['「티커」 빈 줄 경로', krNew, 6], ['「티커」 줄 넣기 경로', usNew, 6]] as const) {
      for (let at = 1; at <= total; at++) {
        reset();
        const start = snapshot();
        const n = rows();
        g.failAt = at;
        const r = await buyNew(body);
        const same = snapshot() === start;
        check(`[120-4] ${label} — ${at}번째 쓰기 실패 → 앞에서 넣은 줄 되돌림 · 시트 처음과 같음 · 기록 0`, r.status === 502 && same && rows() === n, `${r.status} ${same}`);
      }
    }
    // 쓴 값이 다르게 읽힘
    reset();
    const start = snapshot();
    const n = rows();
    g.lie = true;
    const lied = await buyNew(krNew);
    g.lie = false;
    check('[120-4] 쓴 값이 다르게 읽히면 mismatch — 넣은 줄 지움 · 기록 0', lied.body.kind === 'mismatch' && model[H].B8 === undefined && rows() === n && snapshot().length <= start.length + 2000, String(lied.body.kind));
    // 되돌리기까지 실패하면 알린다
    reset();
    g.failAt = 3;
    const realFailAt = g;
    const wrapped = (globalThis.fetch);
    let writes = 0;
    globalThis.fetch = (async (i: Parameters<typeof fetch>[0], init?: RequestInit) => {
      if ((init?.method ?? 'GET') !== 'GET' && String(typeof i === 'string' ? i : '').includes('sheets.googleapis')) {
        writes++;
        if (writes >= 3) return new Response('{}', { status: 500 });
      }
      return wrapped(i, init);
    }) as typeof fetch;
    realFailAt.failAt = 0;
    const undoFail = await buyNew(krNew);
    globalThis.fetch = wrapped;
    check('[120-4] 되돌리기까지 실패하면 mismatch — 시트를 직접 보라는 문구', undoFail.body.kind === 'mismatch' && String(undoFail.body.error).includes('되돌리지도 못했습니다'), String(undoFail.body.kind));
  }

  // ═══ 5. 모두 매도 ═══
  {
    const seenKr = { section: SEC.a, row: 6, qty: 3, price: 72000, expect: { name: NAME.b, code: CODE.b, quantity: 3, avgPrice: 70000 } };
    reset();
    const n = rows();
    const r = await sell(seenKr);
    check('[120-5] 모두 매도 — 200 · 보유 줄만 지움(6행 자리에 다음 종목)', r.status === 200 && model[H].B6 === NAME.c && model[H].B5 === NAME.a, JSON.stringify(r.body));
    check('[120-5] 「티커」 줄 남음', model[T].B16 === NAME.b && model[T].C16 === CODE.b);
    check('[120-5] deleteDimension 한 번뿐 · 값 쓰기 0', kindsOf().join() === 'deleteDimension' && g.valueBatches.length === 0);
    check('[120-5] 합계 범위 줄어듦', model[H].E8 === '=SUM(E5:E6)' && model[H].G8 === '=SUM(G5:G6)', String(model[H].E8));
    check('[120-5] 기록 — deleted_row=1 · 뒤 수량 0 · 평균 그대로', rows() === n + 1 && last().deleted_row === 1 && last().after_qty === 0 && last().after_avg === 70000 && last().side === 'sell');
    check('[120-5] 다른 탭의 여러 줄 범위는 구글이 줄임(지우는 것을 막지 않음)', model[OTHER].B4 === `=SUM('주식 투자 정리'!E5:E6)`, String(model[OTHER].B4));
    // 다른 칸이 가리킴
    reset((m) => { m[OTHER].B5 = `='주식 투자 정리'!D6*2`; });
    const other = await sell(seenKr);
    check('[120-5] 다른 탭이 가리키면 409 row-referenced · 어디인지 칸 주소 · 쓰기 0', other.status === 409 && other.body.kind === 'row-referenced' && String(other.body.error).includes(`「${OTHER}」 B5`) && g.writes === 0, String(other.body.error));
    reset((m) => { m[H].J6 = '=C6+1'; m[H].J7 = '=C6+1'; });
    const same = await sell(seenKr);
    check('[120-5] 같은 탭 다른 줄이 가리키면 409 · 그 줄 자신의 수식은 뺌', same.body.kind === 'row-referenced' && String(same.body.error).includes('J7') && !String(same.body.error).includes('J6'), String(same.body.error));
    // 마지막 줄
    reset((m) => { for (const k of Object.keys(m[H])) if (splitKey(k).row === 13) delete m[H][k]; m[H].E15 = '=SUM(E12:E12)'; m[H].J99 = 'x'; });
    const lastOne = await sell({ section: SEC.b, row: 12, qty: 1, price: 1000, expect: { name: NAME.d, code: CODE.d, quantity: 1, avgPrice: 1000 } });
    check('[120-5] 구간 마지막 한 줄이면 409 last-row(문구) · 쓰기 0', lastOne.status === 409 && lastOne.body.kind === 'last-row' && lastOne.body.error === '마지막 종목은 시트에서 직접 정리해 주세요.' && g.writes === 0, `${lastOne.status} ${lastOne.body.kind}`);
    // 맨 아래 줄 지우기
    reset();
    await sell({ section: SEC.a, row: 7, qty: 2, price: 1, expect: { name: NAME.c, code: CODE.c, quantity: 2, avgPrice: 60000 } });
    check('[120-5] 구간 맨 아래 줄을 지워도 합계 범위 줄어듦', model[H].E8 === '=SUM(E5:E6)', String(model[H].E8));
    reset();
    const part = await sell({ ...seenKr, qty: 1 });
    check('[120-5] 일부 매도는 그대로 수량만(줄 지우기 0 · 읽기 3번)', part.status === 200 && g.structure.length === 0 && model[H].D6 === 2 && g.reads === 3);
    reset();
    const stale = await sell({ ...seenKr, expect: { ...seenKr.expect, quantity: 4 }, qty: 4 });
    check('[120-5] 화면이 본 수량과 다르면 409 sheet-changed · 지우기 0', stale.body.kind === 'sheet-changed' && g.writes === 0);
    const src = [fs.readFileSync(path.join(root, 'server/asset/trade.ts'), 'utf8'), fs.readFileSync(path.join(root, 'server/asset/routes.ts'), 'utf8'), fs.readFileSync(path.join(root, 'src/types/asset.ts'), 'utf8'), fs.readFileSync(path.join(root, 'src/components/asset/AssetTradeDialog.tsx'), 'utf8')].join('\n');
    check('[120-5] sell-all-later 코드 0', !src.includes('sell-all-later'));
  }

  // ═══ 6. 합친 표 ═══
  {
    reset();
    const keys = combinedKeys(model).map((k) => model[H][k]).join();
    const r = await buyNew({ ...krNew, section: SEC.b });
    const after = Object.keys(model[H]).filter((k) => splitKey(k).row >= 30).map((k) => model[H][k]).join();
    check('[120-6] 적립식 계좌 새 종목 — 응답에 합친 표 안내 · 합친 표 쓰기 0', r.status === 200 && r.body.notice === '합친 표 「적립식 주식」 은 직접 고쳐 주세요.' && !rangesWritten().some((x) => /'!\w(3[0-9])$/.test(x)) && after.length > 0 && keys.length > 0, String(r.body.notice));
    reset();
    const plain = await buyNew(krNew);
    check('[120-6] 다른 계좌는 안내 없음', plain.body.notice === null);
    reset();
    const combined = await buyNew({ ...krNew, section: '적립식 주식' });
    check('[120-6] 합친 표에는 새 종목을 넣을 수 없음(400 · 쓰기 0)', combined.status === 400 && g.writes === 0);
  }

  // ═══ 7. 미국 코드 앞부분 ═══
  {
    const inSheet = new Set(['NASDAQ', 'NYSE', 'NYSEARCA']);
    check('[120-7] 기본 앞부분 — NASDAQ · NYSE 그대로 · AMEX 는 시트에 있는 NYSEARCA', defaultPrefix('NASDAQ', inSheet) === 'NASDAQ' && defaultPrefix('NYSE', inSheet) === 'NYSE' && defaultPrefix('AMEX', inSheet) === 'NYSEARCA');
    check('[120-7] AMEX — 시트에 NYSEAMERICAN 만 있으면 그것', defaultPrefix('AMEX', new Set(['NYSEAMERICAN'])) === 'NYSEAMERICAN');
    reset();
    const plan = async (symbol: string, exchange: string | null) => (await call('POST', '/api/asset/trade/new/plan', { section: SEC.a, symbol, exchange })).body;
    const nu = await plan(NEW.nu, null);
    check('[120-7] 확인 화면 코드 — NASDAQ · 바꿀 수 있음 · 「티커」 빈 줄 18행', nu.code === `NASDAQ:${NEW.nu}` && nu.prefixEditable === true && JSON.stringify(nu.ticker) === JSON.stringify({ group: '개별 투자', row: 18, status: 'blank' }), JSON.stringify(nu));
    check('[120-7] NYSE', (await plan(NEW.ny, null)).code === `NYSE:${NEW.ny}`);
    check('[120-7] AMEX → 시트에 쓰인 NYSEARCA', (await plan(NEW.am, null)).code === `NYSEARCA:${NEW.am}`);
    check('[120-7] 고른 앞부분이 코드에 들어감', (await plan(NEW.am, 'NYSEAMERICAN')).code === `NYSEAMERICAN:${NEW.am}`);
    const kr = await plan(NEW.nk, null);
    check('[120-7] 국내는 코드 그대로 · 앞부분 없음', kr.code === NEW.nk && kr.prefix === null && kr.prefixEditable === false);
    const shared = await plan('FAKE', 'NYSE');
    check('[120-7] 「티커」 에 이미 있는 종목은 그 코드 그대로 · 바꿀 수 없음(앞부분이 달라도 같은 종목)', shared.code === CODE.e && shared.prefixEditable === false && (shared.ticker as { status: string }).status === 'existing', JSON.stringify(shared));
    reset();
    await buyNew({ ...usNew, symbol: NEW.am, exchange: 'NYSEAMERICAN' });
    check('[120-7] 저장 — 고른 앞부분으로 「티커」 C열', model[T].C30 === `NYSEAMERICAN:${NEW.am}`, String(model[T].C30));
    reset();
    const badEx = await buyNew({ ...usNew, exchange: 'TSE' });
    check('[120-7] 받지 않는 앞부분 400 · 쓰기 0', badEx.status === 400 && g.writes === 0);
  }

  // ═══ 입력 검사 ═══
  {
    const bad: [string, Record<string, unknown>][] = [
      ['수량 0', { ...krNew, qty: 0 }],
      ['가격 음수', { ...krNew, price: -1 }],
      ['국내 소수 수량', { ...krNew, qty: 1.5 }],
      ['국내 소수 가격', { ...krNew, price: 1000.5 }],
      ['미국 수량 소수 7자리', { ...usNew, qty: 1.1234567 }],
      ['미국 가격 소수 5자리', { ...usNew, price: 1.12345 }],
      ['없는 계좌', { ...krNew, section: '없는 계좌' }],
      ['목록에 없는 종목', { ...krNew, symbol: 'NOSUCH1' }],
      ['주소에 못 쓰는 글자', { ...krNew, symbol: "A'!B" }],
      ['분류 현금', { ...krNew, assetClass: '현금' }],
      ['환율 키', { ...usNew, fx: 1400 }],
      ['글자 수량', { ...krNew, qty: '2' }],
    ];
    for (const [label, body] of bad) {
      reset();
      const r = await buyNew(body);
      check(`[120-1] ${label} → 400 not-editable · 쓰기 0`, r.status === 400 && r.body.kind === 'not-editable' && g.writes === 0, `${r.status} ${r.body.kind}`);
    }
    process.env.ASSET_SYNC_ENABLED = 'false';
    reset();
    const off = await buyNew(krNew);
    process.env.ASSET_SYNC_ENABLED = 'true';
    check('[120-1] 스위치 꺼짐 → 503 disabled · 읽기 0 · 쓰기 0', off.status === 503 && off.body.kind === 'disabled' && g.reads === 0 && g.writes === 0);
    check('[120-1] 잠금 시간: 새 종목 저장 · 확인 화면은 「화면을 쓴 것」', ACTIVE.has('POST /api/asset/trade/new') && ACTIVE.has('POST /api/asset/trade/new/plan'));
  }

  // ═══ 8. 구글 쓰는 함수 ═══
  {
    const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : /\.(ts|tsx)$/.test(d.name) ? [path.join(dir, d.name)] : []));
    const files = [...walk(path.join(root, 'server')), ...walk(path.join(root, 'src'))].map((f) => ({ f: path.relative(root, f), src: fs.readFileSync(f, 'utf8') }));
    const google = fs.readFileSync(path.join(root, 'server/asset/google.ts'), 'utf8');
    const writers = [...google.matchAll(/export async function (\w+)/g)].map((m) => m[1]).filter((n) => /write|update|append|clear/i.test(n));
    check('[120-8] 구글에 쓰는 함수 = valuesWrite · structureWrite 둘', writers.join() === 'valuesWrite,structureWrite', writers.join());
    const callers = (name: string) => files.flatMap(({ f, src }) => [...src.matchAll(new RegExp(`(?<![\\w.'])${name}\\(`, 'g'))].map(() => f)).filter((f) => f !== 'server/asset/google.ts').sort();
    check('[120-8] structureWrite 를 부르는 곳 = rowOps.ts 뿐', [...new Set(callers('structureWrite'))].join() === 'server/asset/rowOps.ts', callers('structureWrite').join());
    check('[120-8] valuesWrite 를 부르는 곳 = 정해진 다섯 파일', [...new Set(callers('valuesWrite'))].join() === 'server/asset/priceSheet.ts,server/asset/priceWriter.ts,server/asset/rowOps.ts,server/asset/sheet.ts,server/asset/trade.ts', [...new Set(callers('valuesWrite'))].join());
    const config = assetSheetConfig();
    if (!config) throw new Error('시험 설정 없음');
    reset();
    let refused = 0;
    for (const bad of [[{ repeatCell: {} }], [{ updateCells: {} }], [{ insertDimension: { range: { sheetId: 1, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 }, inheritFromBefore: true } }], [{ deleteDimension: { range: { sheetId: 1, dimension: 'COLUMNS', startIndex: 0, endIndex: 1 } } }], [{ insertDimension: {}, copyPaste: {} }], [] ]) {
      await structureWrite(config, bad as unknown as StructureRequest[]).catch((e: AssetSheetError) => {
        if (e.kind === 'not-editable') refused++;
      });
    }
    check('[120-8] 요청 종류 셋 밖(서식 · 열 넣기 · 둘 섞기 · 빈 요청)은 구글에 보내지 않고 거절', refused === 6 && g.writes === 0, `${refused} ${g.writes}`);
    const usedKinds = fs.readFileSync(path.join(root, 'server/asset/rowOps.ts'), 'utf8');
    check('[120-8] rowOps 가 만드는 요청 — 셋뿐', !/repeatCell|updateCells|updateSheetProperties|deleteSheet|addSheet/.test(usedKinds));
    check('[120-8] 실제 구글 · 바깥 호출 0', g.realCalls === 0);
  }

  // ═══ 11 · 12 ═══
  {
    const out = printed.join('\n');
    const leaks = [...Object.values(NAME), ...Object.values(CODE), ...Object.values(NEW), '12340', '55.25', '4321', '71001', process.env.ASSET_SHEET_ID as string].filter((s) => out.includes(s));
    check('[120-11] 시험 · 서버 출력에 금액 · 이름 · 코드 · 시트 ID 없음', leaks.length === 0, `${leaks.length}개`);
    const logs = ['server/asset/rowOps.ts', 'server/asset/trade.ts'].map((f) => fs.readFileSync(path.join(root, f), 'utf8'));
    check('[120-11] rowOps.ts 는 로그를 쓰지 않음 · trade.ts 는 기록 id 한 줄', !/console\./.test(logs[0]) && [...logs[1].matchAll(/console\.\w+\(/g)].length === 1);
    const changed = spawnSync('git', ['diff', '--name-only', 'a44b171', '--', 'server/autoTrading', 'server/buyJudge', 'server/marketBrief', 'server/rules', 'server/paperTradingService.ts', 'server/usHalts', 'server/marketCalendar.ts', 'server/heatmapSession.ts', 'server/quoteService.ts', 'src/services/toss', 'server/auth.ts', 'server/authGuard.ts', 'python'], { cwd: root, encoding: 'utf8' });
    check('[120-12] 매매 · 주문 · 시황 · 자동매매 · 거래정지 · 휴장 달력 · 시세 · 장 시간 · 로그인 코드 바뀐 파일 0(a44b171 와 지금 작업 트리)', changed.status === 0 && changed.stdout.trim() === '', changed.stdout.trim() || changed.stderr.trim());
  }
} finally {
  srv.close();
  globalThis.fetch = realFetch;
  fs.rmSync(tmp, { recursive: true, force: true });
}
console.log(`\n결과: PASS ${pass} · FAIL ${fail}`);
process.exit(fail > 0 ? 1 : 0);
