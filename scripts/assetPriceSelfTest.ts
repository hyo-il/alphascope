/**
 * 시트 가격 점검(v2.65.0 · 113차) — `npm run assetprice:test` · ⚠️ `DB_PATH=<사본>` 으로만 돈다(맨 첫 import).
 *
 * 113차 지시서 「꼭 지킬 동작」 1~10 을 줄마다 확인한다(시험 이름 앞의 [113-n] 이 그 줄 번호).
 * 114차(v2.65.1) 「꼭 지킬 동작」 1 — [되돌리기] 줄마다 코드 확인([114-1]).
 * - 구글: 이 프로세스의 `fetch` 를 바꿔치기한 **가짜 시트**(만든 값 · 시험용 RSA 열쇠) — 실제 구글 호출 0.
 * - 토스: `setPriceToolsForTest` 로 **가짜 시세 · 환율** — 실제 토스 호출 0.
 * - 시계 · 장 달력: `priceTick(now)` 의 가짜 시각 · `setSessionHooksForTest` 의 **가짜 토스 달력**(서머타임 · 휴장일 모양).
 * ⚠️ 출력 · 서버 로그에 가짜 가격 · 종목 코드 · 이름을 찍지 않는다(10 — 끝에서 검사).
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import { TEST_SERVER_SWITCHES } from './lib/testServerEnv';
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
import { setAssetPassword, unlockSession } from '../server/asset/lock';
import { authGuard } from '../server/authGuard';
import { assetRouter } from '../server/asset/routes';
import { AssetSheetError, resetTokenCache } from '../server/asset/google';
import { resetSheetCache } from '../server/asset/sheet';
import { sheetBackup, clearSheetBackup } from '../server/asset/store';
import { classifyLine, convertSheetPrices, planRestore, priceSheetStatus, restoreSheetPrices } from '../server/asset/priceSheet';
import { clearPriceStateForTest, priceRows, priceSource, setPriceToolsForTest } from '../server/asset/priceState';
import { priceTick, resetPriceWriterForTest, setPriceTimerForTest } from '../server/asset/priceWriter';
import { setSessionHooksForTest, type TossCalendarResponse } from '../server/heatmapSession';
import type { AssetPriceSheetStatus } from '../src/types/asset';

let pass = 0;
let fail = 0;
const printed: string[] = [];
function say(line: string) {
  printed.push(line);
  console.log(line);
}
function check(name: string, ok: boolean, detail = '') {
  if (ok) pass++;
  else fail++;
  say(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? ` — ${detail}` : ''}`);
}

// ── 가짜 구글 ─────────────────────────────────────────────────────────────
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-price-'));
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const keyFile = path.join(tmp, 'sa.json');
fs.writeFileSync(keyFile, JSON.stringify({ client_email: 'selftest@example.invalid', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }));
process.env.ASSET_SHEET_ID = 'selftest-fake-sheet';
process.env.GOOGLE_SA_KEY_FILE = keyFile;
process.env.ASSET_SYNC_ENABLED = 'true';
process.env.ASSET_PRICE_WRITE_ENABLED = 'true';

type Cell = string | number;
const K = '티커';
/** 가짜 가격 · 환율 — 일부러 눈에 띄는 숫자(10: 출력 · 로그에 나오면 안 된다) */
const PX = { us1: 187.6543, kr1: 71234, mixed: 45678, us2: 432.1987, rate: 1391.27, late: 12987 };
const SECRET = ['187.6543', '71234', '45678', '432.1987', '1391.27', '12987', 'NVDA', '005930', '0072R0', '0091A0', 'MSFT', '가짜 미국주', '가짜 국내주', '가짜 영문 코드주'];

/** 「티커」 가짜 시트 — 원래 GOOGLEFINANCE 모양(2026-11-07 시험용 시트 A-0 와 같은 모양) */
function fakeSheet(): Record<string, Cell> {
  const gf = (r: number) => `=GOOGLEFINANCE(C${r},"price")`;
  return {
    [`${K}!B12`]: '구분',
    [`${K}!D12`]: '자산 분류',
    [`${K}!C9`]: '=GOOGLEFINANCE("CURRENCY:USDKRW")',
    [`${K}!G9`]: 1300.5,
    [`${K}!B14`]: '개별 투자', // 구분 줄
    // 15: 미국 · F = GOOGLEFINANCE($C행)*$C$9
    [`${K}!B15`]: '가짜 미국주', [`${K}!C15`]: 'NASDAQ:NVDA', [`${K}!D15`]: '주식', [`${K}!E15`]: gf(15), [`${K}!F15`]: '=GOOGLEFINANCE($C15,"price")*$C$9',
    [`${K}!G15`]: '=GOOGLEFINANCE(C15,"change")', [`${K}!H15`]: '=GOOGLEFINANCE(C15,"changepct")/100', [`${K}!I15`]: '=GOOGLEFINANCE(C15,"volume")',
    // 16: 국내 · F = GOOGLEFINANCE(C행)
    [`${K}!B16`]: '가짜 국내주', [`${K}!C16`]: '005930', [`${K}!D16`]: '채권', [`${K}!E16`]: gf(16), [`${K}!F16`]: '=GOOGLEFINANCE(C16,"price")',
    [`${K}!G16`]: '=GOOGLEFINANCE(C16,"change")',
    // 17: 영문 섞인 국내 코드 · 토스 가격 없음(처음)
    [`${K}!B17`]: 'KODEX 가짜 S&P500', [`${K}!C17`]: '0072R0', [`${K}!D17`]: '주식', [`${K}!E17`]: gf(17), [`${K}!F17`]: '=GOOGLEFINANCE(C17,"price")',
    // 18: 영문 섞인 국내 코드 · 토스 가격 있음 · F = E행
    [`${K}!B18`]: '가짜 영문 코드주', [`${K}!C18`]: '0091A0', [`${K}!D18`]: '금', [`${K}!E18`]: gf(18), [`${K}!F18`]: '=E18',
    // 19: E 가 다른 모양(close)
    [`${K}!B19`]: '다른 모양 가격', [`${K}!C19`]: '000660', [`${K}!E19`]: '=GOOGLEFINANCE(C19,"close")', [`${K}!F19`]: '=E19',
    // 20: F 가 다른 모양
    [`${K}!B20`]: '다른 모양 원화', [`${K}!C20`]: '035420', [`${K}!E20`]: gf(20), [`${K}!F20`]: '=E20*2',
    // 21: 미국 · F = E행*$C$9
    [`${K}!B21`]: '가짜 미국 둘째', [`${K}!C21`]: 'NASDAQ:MSFT', [`${K}!E21`]: gf(21), [`${K}!F21`]: '=E21*$C$9',
    [`${K}!B22`]: '적립식 투자', // 구분 줄
  };
}
const ORIGINAL = fakeSheet();
let sheet = fakeSheet();

const colNum = (c: string) => c.charCodeAt(0) - 64;
const colChr = (n: number) => String.fromCharCode(64 + n);
function cut(range: string): Cell[][] {
  const m = range.match(/^'((?:[^']|'')+)'!([A-Z])(\d+)(?::([A-Z])(\d+))?$/);
  if (!m) throw new Error('범위 모양');
  const tab = m[1].replace(/''/g, "'");
  const [c1, r1] = [colNum(m[2]), Number(m[3])];
  const [c2, r2] = m[4] ? [colNum(m[4]), Number(m[5])] : [c1, r1];
  const rows: Cell[][] = [];
  for (let r = r1; r <= r2; r++) {
    const row: Cell[] = [];
    for (let c = c1; c <= c2; c++) row.push(sheet[`${tab}!${colChr(c)}${r}`] ?? '');
    while (row.length && row[row.length - 1] === '') row.pop();
    rows.push(row);
  }
  while (rows.length && rows[rows.length - 1].length === 0) rows.pop();
  return rows;
}

const g = { reads: 0, writes: 0, real: 0 };
/** 받은 쓰기 요청 — 칸 · 값 · 쓰는 방식 · 그때 앱 DB 백업 칸 */
let requests: { input: string; cells: { range: string; value: unknown }[]; backupAt: string[] }[] = [];
let writeFail: number | null = null;
let afterWrite: (() => void) | null = null;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!/googleapis\.com/.test(url)) {
    if (/google/.test(url)) g.real++;
    return realFetch(input, init);
  }
  if (url.startsWith('https://oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'fake', expires_in: 3600 }), { status: 200 });
  if ((init?.method ?? 'GET') === 'POST' && /\/values:batchUpdate$/.test(url)) {
    g.writes++;
    const body = JSON.parse(String(init?.body ?? '{}')) as { valueInputOption: string; data: { range: string; values: unknown[][] }[] };
    requests.push({ input: body.valueInputOption, cells: body.data.map((d) => ({ range: d.range, value: d.values[0][0] })), backupAt: sheetBackup().map((b) => b.cell) });
    if (writeFail) return new Response('{}', { status: writeFail });
    for (const d of body.data) {
      const m = d.range.match(/^'((?:[^']|'')+)'!([A-Z]\d+)$/);
      if (m) sheet[`${m[1]}!${m[2]}`] = d.values[0][0] as Cell;
    }
    if (afterWrite) afterWrite();
    return new Response('{}', { status: 200 });
  }
  if (!url.includes('/values:batchGet?')) return new Response('{}', { status: 400 });
  g.reads++;
  const params = new URL(url).searchParams;
  return new Response(JSON.stringify({ valueRanges: params.getAll('ranges').map((r) => ({ range: r, values: cut(r) })) }), { status: 200 });
}) as typeof fetch;

// 10초 예약(실제 시계)은 켜지 않는다 — 회차는 이 시험이 가짜 시각으로 부른다
setPriceTimerForTest(false);

// ── 가짜 토스 ─────────────────────────────────────────────────────────────
const toss = { quotes: 0, rates: 0, asked: [] as string[][] };
let book = new Map<string, number>([['NVDA', PX.us1], ['005930', PX.kr1], ['0091A0', PX.mixed], ['MSFT', PX.us2]]);
let rate: number | null = PX.rate;
setPriceToolsForTest({
  quotes: async (symbols) => {
    toss.quotes++;
    toss.asked.push([...symbols]);
    return new Map(symbols.flatMap((s) => (book.has(s) ? [[s, book.get(s)!] as [string, number]] : [])));
  },
  rate: async () => {
    toss.rates++;
    return rate;
  },
});

// ── 가짜 달력 ─────────────────────────────────────────────────────────────
type R = { startTime: string; endTime: string };
const k = (d: string, hm: string) => `${d}T${hm}:00+09:00`;
const r = (d1: string, h1: string, d2: string, h2: string): R => ({ startTime: k(d1, h1), endTime: k(d2, h2) });
const next = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
/** 미국 거래일 하루(한국 시각) — 겨울(EST): 주간 10:00~18:00 · 프리 ~23:30 · 정규 ~06:00 · 애프터 ~10:00 / 여름(EDT): 한 시간씩 앞 */
function usDay(date: string, summer: boolean) {
  const h = (w: number) => `${String(summer ? w - 1 : w).padStart(2, '0')}:00`;
  const half = summer ? '22:30' : '23:30';
  return {
    date,
    dayMarket: r(date, h(10), date, h(18)),
    preMarket: r(date, h(18), date, half),
    regularMarket: r(date, half, next(date), h(6)),
    afterMarket: r(next(date), h(6), next(date), h(10)),
  };
}
const krDay = (date: string) => ({ date, integrated: { preMarket: r(date, '08:00', date, '09:00'), regularMarket: r(date, '09:00', date, '15:30'), afterMarket: r(date, '15:30', date, '20:00') } });
function useCalendar(us: object[], kr: object[]) {
  const res = (days: object[]): TossCalendarResponse => ({ result: { previousBusinessDay: days[0] as never, today: days[1] as never, nextBusinessDay: days[2] as never } });
  setSessionHooksForTest({ calendar: async (market) => res(market === 'US' ? us : kr) });
}
const at = (d: string, hm: string, s = 0) => Date.parse(k(d, hm)) + s * 1000;
// 겨울 · 금요일(11-06) 뒤 주말 — 미국 금요일 애프터 끝 = 토 10:00 KST, 다음은 월(11-09)
const WINTER_US = [usDay('2026-11-05', false), usDay('2026-11-06', false), usDay('2026-11-09', false)];
const KR3 = [krDay('2026-11-05'), krDay('2026-11-06'), krDay('2026-11-09')];

// ── 출력 잡기(10) ─────────────────────────────────────────────────────────
const captured: string[] = [];
const orig = { log: console.log, warn: console.warn, error: console.error };
for (const kk of ['warn', 'error'] as const) console[kk] = (...a: unknown[]) => { captured.push(a.map(String).join(' ')); orig[kk](...a); };
console.log = (...a: unknown[]) => { const s = a.map(String).join(' '); if (!/^(PASS|FAIL) /.test(s)) captured.push(s); orig.log(...a); };

function fresh() {
  sheet = fakeSheet();
  requests = [];
  writeFail = null;
  afterWrite = null;
  g.reads = 0;
  g.writes = 0;
  toss.quotes = 0;
  toss.rates = 0;
  toss.asked = [];
  book = new Map([['NVDA', PX.us1], ['005930', PX.kr1], ['0091A0', PX.mixed], ['MSFT', PX.us2]]);
  rate = PX.rate;
  clearPriceStateForTest();
  clearSheetBackup();
  resetPriceWriterForTest();
  resetSheetCache();
  resetTokenCache();
}
const kindOf = async (p: Promise<unknown>) => p.then(() => 'ok', (e: unknown) => (e instanceof AssetSheetError ? e.kind : 'other'));
const cellOf = (range: string) => range.replace(/^'티커'!/, '');
const wroteCells = (i: number) => requests[i]?.cells.map((c) => cellOf(c.range)).sort() ?? [];

try {
  // ═══ [113-1] 바꾸기 ═══
  fresh();
  const st = await convertSheetPrices();
  const req = requests[0];
  const v = (cell: string) => req?.cells.find((c) => cellOf(c.range) === cell)?.value;
  const expectCells = ['C9', 'E15', 'F15', 'E16', 'F16', 'E18', 'F18', 'E21', 'F21'].sort();
  check('[113-1] 바꾸기 — 쓰기 요청 1번 · USER_ENTERED · C9 와 바꿀 줄 E · F 만', g.writes === 1 && req.input === 'USER_ENTERED' && JSON.stringify(wroteCells(0)) === JSON.stringify(expectCells), wroteCells(0).join(','));
  check('[113-1] F 는 국내 =E행 · 미국 =E행*$C$9', v('F15') === '=E15*$C$9' && v('F21') === '=E21*$C$9' && v('F16') === '=E16' && v('F18') === '=E18');
  check('[113-1] C9 = 토스 환율 숫자 · E = 토스 가격 숫자', v('C9') === PX.rate && v('E15') === PX.us1 && v('E16') === PX.kr1 && v('E18') === PX.mixed && v('E21') === PX.us2);
  check('[113-1] G · H · I · 그 밖 칸에 쓰기 0', req.cells.every((c) => /^'티커'!(C9|[EF](1[4-9]|2\d|3\d|4[0-2]))$/.test(c.range)) && sheet[`${K}!G15`] === ORIGINAL[`${K}!G15`] && sheet[`${K}!H15`] === ORIGINAL[`${K}!H15`] && sheet[`${K}!I15`] === ORIGINAL[`${K}!I15`]);
  const backupNow = new Map(sheetBackup().map((b) => [b.cell, b.formula]));
  check('[113-1] 원래 수식이 쓰기 **전에** 백업에 있음(쓰기 요청을 받은 순간 앱 DB 에 C9 · E · F 칸 전부)', expectCells.every((c) => req.backupAt.includes(c)));
  check('[113-1] 백업 = 원래 수식 글자 그대로', expectCells.every((c) => backupNow.get(c) === ORIGINAL[`${K}!${c}`]));
  check('[113-1] 출처 = 토스 · 바꾼 줄 4개(줄 번호 · 코드 · 시장)', priceSource() === 'toss' && st.source === 'toss' && st.rows === 4 && JSON.stringify(priceRows().map((x) => [x.row, x.market])) === JSON.stringify([[15, 'US'], [16, 'KR'], [18, 'KR'], [21, 'US']]));
  {
    fresh();
    getDb().exec(`CREATE TEMP TRIGGER selftest_no_backup BEFORE INSERT ON asset_sheet_backup BEGIN SELECT RAISE(ABORT, 'selftest'); END;`);
    const kind = await kindOf(convertSheetPrices());
    getDb().exec(`DROP TRIGGER selftest_no_backup`);
    check('[113-1] 백업 저장 실패 → 시트에 쓰지 않음(no-backup · 쓰기 0 · 출처 그대로 google)', kind === 'no-backup' && g.writes === 0 && priceSource() === 'google');
  }

  // ═══ [113-2] 토스 가격 없는 줄 · 다른 모양 줄 ═══
  fresh();
  const st2 = await convertSheetPrices();
  const reasons = Object.fromEntries(st2.skipped.map((s) => [s.row, s.reason]));
  check('[113-2] 토스 가격 없는 줄(영문 섞인 코드) · E 다른 모양 · F 다른 모양 → 손대지 않음(쓰기 칸에 없음 · 시트 그대로)',
    !wroteCells(0).some((c) => /^[EF](17|19|20)$/.test(c)) && ['E17', 'F17', 'E19', 'F19', 'E20', 'F20'].every((c) => sheet[`${K}!${c}`] === ORIGINAL[`${K}!${c}`]));
  check('[113-2] 「토스 가격 없음 — 시트 값 그대로」 목록 = 17 토스 가격 없음 · 19 가격 칸 모양 · 20 원화 칸 모양(이름 · 코드는 화면용으로 들어 있음)',
    JSON.stringify(reasons) === JSON.stringify({ 17: 'no-toss-price', 19: 'price-shape', 20: 'won-shape' }) && st2.skipped.every((s) => s.name !== '' && s.code !== ''));
  check('[113-2] 영문 섞인 코드도 같은 규칙 — 가격 있으면 바꿈(18) · 없으면 그대로(17) · classifyLine 이 시장을 국내로',
    classifyLine({ row: 18, name: 'x', code: '0091A0', e: '=GOOGLEFINANCE(C18,"price")', f: '=E18' }, true) === 'convert' &&
    classifyLine({ row: 17, name: 'x', code: '0072R0', e: '=GOOGLEFINANCE(C17,"price")', f: '=GOOGLEFINANCE(C17,"price")' }, false) === 'no-toss-price' &&
    classifyLine({ row: 17, name: 'x', code: '0072R0', e: '=GOOGLEFINANCE(C17,"price")', f: '=GOOGLEFINANCE(C17,"price")*$C$9' }, true) === 'won-shape');
  check('[113-2] E 가 숫자 · 글자 · 다른 칸을 가리키는 GOOGLEFINANCE 면 바꾸지 않음(price-shape)',
    classifyLine({ row: 16, name: 'x', code: '005930', e: 12345, f: '=E16*3' }, true) === 'price-shape' &&
    classifyLine({ row: 16, name: 'x', code: '005930', e: '=GOOGLEFINANCE(C15,"price")', f: '=E16' }, true) === 'price-shape' &&
    classifyLine({ row: 16, name: 'x', code: '005930', e: '=GOOGLEFINANCE("005930","price")', f: '=E16' }, true) === 'convert');
  // 남은 종목 — 토스 가격이 생기면 그 줄만 더 바꾼다 · 원래 C9 백업은 그대로
  book.set('0072R0', PX.late);
  requests = [];
  const st3 = await convertSheetPrices();
  check('[113-2] 남은 종목도 토스로 바꾸기 — 그 줄 E · F + C9 만 한 요청 · C9 백업은 처음 GOOGLEFINANCE 그대로',
    JSON.stringify(wroteCells(0)) === JSON.stringify(['C9', 'E17', 'F17']) && sheetBackup().find((b) => b.cell === 'C9')?.formula === ORIGINAL[`${K}!C9`] && sheetBackup().find((b) => b.cell === 'E17')?.formula === ORIGINAL[`${K}!E17`] && st3.rows === 5);
  requests = [];
  check('[113-2] 바꿀 줄이 없으면 no-rows · 쓰기 0', (await kindOf(convertSheetPrices())) === 'no-rows' && requests.length === 0);

  // ═══ [113-3] 되돌리기 ═══
  requests = [];
  const backupCells = sheetBackup().map((b) => b.cell);
  const rs = await restoreSheetPrices();
  check('[113-3] 되돌리기 — 백업 칸 전부를 원래 글자 그대로 한 요청(USER_ENTERED)',
    requests.length === 1 && requests[0].input === 'USER_ENTERED' && requests[0].cells.length === backupCells.length && requests[0].cells.every((c) => c.value === ORIGINAL[`${K}!${cellOf(c.range)}`]));
  check('[113-3] 다시 읽어 같으면 백업 지움 · 출처 google · 시트가 처음 모양으로', sheetBackup().length === 0 && rs.source === 'google' && !rs.hasBackup && Object.keys(ORIGINAL).every((c) => sheet[c] === ORIGINAL[c]));
  fresh();
  await convertSheetPrices();
  afterWrite = () => {
    if (requests.at(-1)?.input === 'USER_ENTERED' && requests.length === 2) sheet[`${K}!E15`] = '=GOOGLEFINANCE(C15,"close")';
  };
  const mm = await kindOf(restoreSheetPrices());
  const st4 = priceSheetStatus();
  check('[113-3] 다시 읽은 값이 다르면 오류(mismatch) · 백업 남음(다시 되돌리기 가능)', mm === 'mismatch' && sheetBackup().length > 0 && st4.hasBackup);
  afterWrite = null;

  // ═══ [114-1] 되돌리기 — 줄마다 코드 확인(v2.65.1) ═══
  {
    fresh();
    useCalendar(WINTER_US, KR3);
    await convertSheetPrices();
    const swap = (a: number, b: number) => {
      for (const c of ['B', 'C', 'D', 'E', 'F', 'G', 'H', 'I']) {
        const [x, y] = [sheet[`${K}!${c}${a}`], sheet[`${K}!${c}${b}`]];
        if (y === undefined) delete sheet[`${K}!${c}${a}`];
        else sheet[`${K}!${c}${a}`] = y;
        if (x === undefined) delete sheet[`${K}!${c}${b}`];
        else sheet[`${K}!${c}${b}`] = x;
      }
    };
    // 사용자가 15 ↔ 21 줄을 바꾸고 16 줄을 비움(23 빈 줄과 바꿈)
    swap(15, 21);
    swap(16, 23);
    const movedSheet = { ...sheet };
    requests = [];
    const r1 = await restoreSheetPrices();
    const left = sheetBackup().map((b) => b.cell).sort();
    check('[114-1] 되돌리기 — 코드가 같은 줄(18)과 C9 만 씀 · 옮겨진 줄(15 · 21) · 빈 줄(16)은 쓰지 않음(한 요청)',
      requests.length === 1 && JSON.stringify(wroteCells(0)) === JSON.stringify(['C9', 'E18', 'F18']) && ['E15', 'F15', 'E16', 'F16', 'E21', 'F21', 'E23', 'F23'].every((c) => sheet[`${K}!${c}`] === movedSheet[`${K}!${c}`]),
      wroteCells(0).join(','));
    check('[114-1] 옮겨진 줄의 백업은 남음 · 쓴 칸(C9 · E18 · F18) 백업만 지움', JSON.stringify(left) === JSON.stringify(['E15', 'E16', 'E21', 'F15', 'F16', 'F21']), left.join(','));
    check('[114-1] 「줄이 옮겨짐 — 직접 확인」 목록 = 15 · 16 · 21(그때 코드 · 지금 코드 · 빈 줄은 null)',
      JSON.stringify(r1.moved.map((m) => [m.row, m.wasCode === ORIGINAL[`${K}!C${m.row}`], m.nowCode === (movedSheet[`${K}!C${m.row}`] ?? null)])) === JSON.stringify([[15, true, true], [16, true, true], [21, true, true]]) &&
      r1.moved.find((m) => m.row === 16)?.nowCode === null && r1.moved.find((m) => m.row === 15)?.wasName === ORIGINAL[`${K}!B15`]);
    check('[114-1] C9 은 줄과 상관없이 늘 되돌림(원래 GOOGLEFINANCE)', sheet[`${K}!C9`] === ORIGINAL[`${K}!C9`]);
    const tk = await priceTick(at('2026-11-09', '12:00'));
    check('[114-1] 남은 백업이 있어도 출처 google · [되돌리기] 보임(hasBackup) · 10초 쓰기 멈춤(쓰기 0)',
      priceSource() === 'google' && r1.source === 'google' && r1.hasBackup && tk === 'off' && requests.length === 1 && priceSheetStatus().moved.length === 3, `${tk}`);
    // 사용자가 줄을 원래대로 돌린 뒤 다시 누름 — 그 줄만 씀
    swap(15, 21);
    swap(16, 23);
    requests = [];
    const r2 = await restoreSheetPrices();
    check('[114-1] 줄을 원래대로 돌린 뒤 다시 누르면 그 줄(15 · 16 · 21)만 씀 · C9 · 18 은 다시 쓰지 않음',
      requests.length === 1 && JSON.stringify(wroteCells(0)) === JSON.stringify(['E15', 'E16', 'E21', 'F15', 'F16', 'F21']), wroteCells(0).join(','));
    check('[114-1] 모두 되돌리면 백업 0 · 목록 비움 · 시트가 처음 모양', sheetBackup().length === 0 && r2.moved.length === 0 && !r2.hasBackup && Object.keys(ORIGINAL).every((c) => sheet[c] === ORIGINAL[c]));
    // 바꾼 줄 기록이 없는 백업 줄(옛 상태)은 쓰지 않고 목록에
    const plan = planRestore([{ cell: 'C9', formula: 'x' }, { cell: 'E30', formula: 'y' }], [], [{ row: 30, name: 'n', code: 'c', e: 1, f: '=E30' }]);
    check('[114-1] 바꾼 줄 기록이 없는 백업 줄은 쓰지 않음(목록 · 그때 코드 빈 글자) · C9 은 씀', JSON.stringify(plan.write.map((w) => w.cell)) === JSON.stringify(['C9']) && plan.moved.length === 1 && plan.moved[0].wasCode === '');
  }

  // ═══ [113-4] 10초 쓰기 ═══
  fresh();
  useCalendar(WINTER_US, KR3);
  await convertSheetPrices();
  requests = [];
  toss.quotes = 0;
  toss.rates = 0;
  toss.asked = [];
  // 토 09:00 KST — 미국 금요일 애프터 열림 · 국내 닫힘(금 애프터 끝 20:00)
  const sat9 = at('2026-11-07', '09:00');
  const t0 = await priceTick(sat9);
  check('[113-4] 바뀐 칸 없음 → 쓰기 요청 0(시세 1번)', t0 === 'unchanged' && requests.length === 0 && toss.quotes === 1);
  check('[113-4] 닫힌 시장(국내) 줄은 시세도 받지 않음 — 미국 줄만', JSON.stringify(toss.asked[0]?.slice().sort()) === JSON.stringify(['MSFT', 'NVDA']));
  book.set('NVDA', PX.us1 + 1);
  book.set('005930', PX.kr1 + 100);
  const t1 = await priceTick(sat9 + 10_000);
  check('[113-4] 바뀐 칸만 · 한 요청(RAW) — 미국 E15 만(닫힌 국내 E16 은 안 씀)', t1 === 'written' && requests.length === 1 && requests[0].input === 'RAW' && JSON.stringify(wroteCells(0)) === JSON.stringify(['E15']) && requests[0].cells[0].value === PX.us1 + 1);
  rate = PX.rate + 2;
  const t2 = await priceTick(sat9 + 20_000);
  check('[113-4] 환율은 60초 캐시 — 20초 뒤 바뀐 환율은 아직 안 씀', t2 === 'unchanged' && requests.length === 1 && toss.rates === 1);
  const t3 = await priceTick(sat9 + 60_000);
  check('[113-4] 60초 뒤 환율 다시 받아 C9 만 씀', t3 === 'written' && JSON.stringify(wroteCells(1)) === JSON.stringify(['C9']) && toss.rates === 2);
  // 애프터 끝(토 10:00) — 마지막 1번 뒤 멈춤
  book.set('MSFT', PX.us2 + 1);
  const end = at('2026-11-07', '10:00');
  const before = requests.length;
  const tEnd = await priceTick(end);
  const q1 = toss.quotes;
  const tAfter = await priceTick(end + 10_000);
  const tLater = await priceTick(end + 3600_000);
  check('[113-4] 애프터 끝 — 마지막 1번 쓰기(E21) 뒤 멈춤: 다음 회차부터 시세 · 쓰기 0', tEnd === 'written' && requests.length === before + 1 && wroteCells(before).includes('E21') && tAfter === 'closed' && tLater === 'closed' && toss.quotes === q1 && requests.length === before + 1);
  check('[113-4] 두 시장이 다 닫히면 상태 「장 닫힘」', priceSheetStatus().state === 'closed');
  // 서머타임 — 여름 달력은 애프터가 한 시간 앞(토 09:00 끝): 09:30 은 닫힘 · 겨울은 열림
  const SUMMER_US = [usDay('2026-10-15', true), usDay('2026-10-16', true), usDay('2026-10-19', true)];
  resetPriceWriterForTest();
  useCalendar(SUMMER_US, [krDay('2026-10-15'), krDay('2026-10-16'), krDay('2026-10-19')]);
  toss.quotes = 0;
  const sSummer = await priceTick(at('2026-10-17', '09:30'));
  resetPriceWriterForTest();
  useCalendar(WINTER_US, KR3);
  const sWinter = await priceTick(at('2026-11-07', '09:30'));
  check('[113-4] 서머타임은 장 달력을 따름 — 여름 09:30 KST 닫힘(시세 0) · 겨울 09:30 KST 열림(쓰는 중)', sSummer === 'closed' && toss.quotes === 1 && sWinter !== 'closed' && priceSheetStatus().state === 'writing');
  // 휴장일 — 미국 월(11-09)이 달력에 없음(다음 거래일 화) → 월 15:00 KST 미국 닫힘 · 국내 정규장만
  resetPriceWriterForTest();
  useCalendar([usDay('2026-11-06', false), usDay('2026-11-10', false), usDay('2026-11-11', false)], KR3);
  toss.asked = [];
  requests = [];
  book.set('005930', PX.kr1 + 200);
  book.set('NVDA', PX.us1 + 5);
  await priceTick(at('2026-11-09', '15:00'));
  check('[113-4] 휴장일은 장 달력을 따름 — 미국 휴장 월요일엔 국내 줄(+ 토스 가격 없어 남은 국내 줄)만 시세 · 국내 칸만 쓰기', JSON.stringify(toss.asked[0]?.slice().sort()) === JSON.stringify(['005930', '0072R0', '0091A0']) && wroteCells(0).every((c) => c === 'E16' || c === 'E18') && wroteCells(0).includes('E16'));

  // ═══ [113-5] 줄 코드가 바뀐 줄 ═══
  fresh();
  useCalendar(WINTER_US, KR3);
  await convertSheetPrices();
  requests = [];
  sheet[`${K}!C15`] = 'NASDAQ:AMD'; // 사용자가 줄을 옮김
  book.set('NVDA', PX.us1 + 9);
  book.set('MSFT', PX.us2 + 9);
  await priceTick(at('2026-11-09', '12:00'));
  const st5 = priceSheetStatus();
  check('[113-5] 줄 코드가 바뀐 줄(15)에는 쓰지 않음 · 다른 줄(21)은 씀', requests.length === 1 && !wroteCells(0).includes('E15') && wroteCells(0).includes('E21') && sheet[`${K}!E15`] === PX.us1);
  check('[113-5] 상태 목록에 「줄 코드가 바뀜」(15행)', st5.skipped.some((s) => s.row === 15 && s.reason === 'code-changed'));

  // ═══ [113-6] 스위치 ═══
  for (const [val, sync, label] of [[undefined, 'true', '없음'], ['false', 'true', 'false'], ['1', 'true', '1'], ['TRUE', 'true', 'TRUE'], ['yes', 'true', 'yes'], ['true', 'false', 'true 이지만 ASSET_SYNC_ENABLED=false']] as const) {
    fresh();
    useCalendar(WINTER_US, KR3);
    await convertSheetPrices(); // 켠 채로 바꿔 둔 상태에서
    requests = [];
    g.reads = 0;
    toss.quotes = 0;
    if (val === undefined) delete process.env.ASSET_PRICE_WRITE_ENABLED;
    else process.env.ASSET_PRICE_WRITE_ENABLED = val;
    process.env.ASSET_SYNC_ENABLED = sync;
    book.set('NVDA', PX.us1 + 3);
    const tk = await priceTick(at('2026-11-09', '12:00'));
    const cv = await kindOf(convertSheetPrices());
    const rv = await kindOf(restoreSheetPrices());
    const status: AssetPriceSheetStatus = priceSheetStatus();
    check(`[113-6] ASSET_PRICE_WRITE_ENABLED=${label} → 예약 · 바꾸기 · 되돌리기 모두 안 함(구글 · 토스 호출 0 · 상태 꺼짐)`, tk === 'off' && cv === 'disabled' && rv === 'disabled' && requests.length === 0 && g.reads === 0 && toss.quotes === 0 && !status.enabled && status.state === 'off');
    process.env.ASSET_PRICE_WRITE_ENABLED = 'true';
    process.env.ASSET_SYNC_ENABLED = 'true';
  }
  check('[113-6] 시험 서버 스위치 8개 · ASSET_PRICE_WRITE_ENABLED=false 포함', Object.keys(TEST_SERVER_SWITCHES).length === 8 && TEST_SERVER_SWITCHES.ASSET_PRICE_WRITE_ENABLED === 'false');
  // 주소 그대로 — 로그인 문지기 + 자산 문지기 + 라우트
  {
    fresh();
    const app = express();
    app.use(express.json());
    app.use(authGuard);
    app.use(assetRouter);
    const srv = app.listen(0, '127.0.0.1');
    await new Promise((ok) => srv.once('listening', ok));
    const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
    // 로그인 · 자산 비밀번호가 없으면 두 문지기가 모두 막는다(사본 DB · 시험용 값 — 실제 비밀번호 아님)
    await setPassword('selftest-price-login-0001');
    await setAssetPassword('selftest-price-lock-0002');
    const token = createSession('selftest-price');
    const ck = { cookie: `as_session=${encodeURIComponent(token)}` };
    const post = (p: string) => fetch(`${base}/api/asset/price-source/${p}`, { method: 'POST', headers: ck });
    const locked = await post('convert');
    check('[113-6] (안쪽 서버) 잠김 → POST convert 403 asset-locked · 구글 호출 0', locked.status === 403 && g.writes === 0 && g.reads === 0);
    unlockSession(token);
    delete process.env.ASSET_PRICE_WRITE_ENABLED;
    const off = await post('convert');
    const offBody = (await off.json()) as { kind?: string };
    const offR = await post('restore');
    check('[113-6] (안쪽 서버) 스위치 없음 → convert · restore 503 disabled · 구글 호출 0', off.status === 503 && offBody.kind === 'disabled' && offR.status === 503 && g.writes === 0 && g.reads === 0, `${off.status} ${offBody.kind} ${offR.status} w${g.writes} r${g.reads}`);
    process.env.ASSET_PRICE_WRITE_ENABLED = 'true';
    const on = await post('convert');
    const onBody = (await on.json()) as AssetPriceSheetStatus;
    const back = await post('restore');
    check('[113-6] (안쪽 서버) 스위치 켬 → convert 200(토스) · restore 200(google)', on.status === 200 && onBody.source === 'toss' && back.status === 200 && ((await back.json()) as AssetPriceSheetStatus).source === 'google', `${on.status} ${JSON.stringify(onBody).slice(0, 120)} ${back.status}`);
    srv.close();
  }

  // ═══ [113-8] 부담 — 가짜 시계 1시간 ═══
  fresh();
  useCalendar(WINTER_US, KR3);
  await convertSheetPrices();
  requests = [];
  g.writes = 0;
  toss.quotes = 0;
  toss.rates = 0;
  const start = at('2026-11-09', '10:00');
  let n = 0;
  for (let t = start; t < start + 3600_000; t += 10_000) {
    n++;
    book.set('NVDA', PX.us1 + n / 100);
    book.set('005930', PX.kr1 + n);
    rate = PX.rate + n / 1000;
    await priceTick(t);
  }
  check(`[113-8] 1시간(10초 × ${n}) — 구글 쓰기 ≤ 360(${g.writes}) · 토스 시세 ≤ 360(${toss.quotes}) · 환율 ≤ 60(${toss.rates})`, n === 360 && g.writes <= 360 && g.writes > 300 && toss.quotes <= 360 && toss.rates <= 60 && toss.rates >= 59);
  // 429 가 이어지면 60초 쉰다
  writeFail = 429;
  const bt = start + 3600_000;
  book.set('NVDA', 1);
  const f1 = await priceTick(bt);
  book.set('NVDA', 2);
  const f2 = await priceTick(bt + 10_000);
  const w0 = g.writes;
  const f3 = await priceTick(bt + 20_000);
  const f4 = await priceTick(bt + 69_000);
  const w1 = g.writes;
  writeFail = null;
  const f5 = await priceTick(bt + 81_000);
  check('[113-8] 구글 429 가 두 번 이어지면 60초 쉼(그동안 요청 0) → 그 뒤 다시 씀', f1 === 'failed' && f2 === 'failed' && f3 === 'backoff' && f4 === 'backoff' && w1 === w0 && f5 === 'written' && g.writes === w1 + 1, [f1, f2, f3, f4, f5, w1 - w0].join(','));
} finally {
  globalThis.fetch = realFetch;
  setPriceToolsForTest(null);
  setSessionHooksForTest({ calendar: null });
  clearPriceStateForTest();
  clearSheetBackup();
  resetPriceWriterForTest();
  console.log = orig.log;
  console.warn = orig.warn;
  console.error = orig.error;
  fs.rmSync(tmp, { recursive: true, force: true });
  getDb().prepare(`DELETE FROM auth_sessions`).run();
}

// ═══ [113-7] 쓰는 함수 하나 · 옛 세 곳 RAW ═══
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : /\.(ts|tsx)$/.test(d.name) ? [path.join(dir, d.name)] : []));
const files = [...walk(path.join(root, 'server')), ...walk(path.join(root, 'src'))].map((f) => ({ f: path.relative(root, f), src: fs.readFileSync(f, 'utf8') }));
const calls = files.flatMap(({ f, src }) => [...src.matchAll(/\bvaluesWrite\(([^;]*?)\);/gs)].map((m) => ({ f, args: m[1] })));
const defs = files.filter(({ src }) => /export async function valuesWrite\(/.test(src)).map((x) => x.f);
const sheetCalls = calls.filter((c) => c.f === 'server/asset/sheet.ts');
check('[113-7] 구글 쓰는 함수는 valuesWrite 하나(google.ts) · values:batchUpdate 주소도 google.ts 한 곳', JSON.stringify(defs) === JSON.stringify(['server/asset/google.ts']) && files.filter(({ src }) => /values:batchUpdate/.test(src)).map((x) => x.f).join(',') === 'server/asset/google.ts');
check('[113-7] 옛 세 곳(sheet.ts 자산 분류 · 목표 비율 · 계좌 이름 날짜)은 쓰는 방식 인자 없음 = RAW 그대로', sheetCalls.length === 3 && sheetCalls.every((c) => !/USER_ENTERED/.test(c.args)));
check('[113-7] USER_ENTERED 는 priceSheet.ts 바꾸기 · 되돌리기 두 곳뿐 · 10초 쓰기(priceWriter.ts)는 RAW', JSON.stringify(calls.filter((c) => /USER_ENTERED/.test(c.args)).map((c) => c.f)) === JSON.stringify(['server/asset/priceSheet.ts', 'server/asset/priceSheet.ts']) && calls.filter((c) => c.f === 'server/asset/priceWriter.ts').length === 1);
const assetTest = spawnSync(path.join(root, 'node_modules/.bin/tsx'), [path.join(root, 'scripts/assetSelfTest.ts')], { cwd: root, encoding: 'utf8', env: process.env, timeout: 300_000 });
const res = assetTest.stdout.match(/결과: (\d+)개 통과 \/ (\d+)개 실패/);
check('[113-7] [115-9] [116-8] asset:test 264개 그대로 통과(115차에 20개 · 116차 A 에 4개 더함)', assetTest.status === 0 && res?.[1] === '264' && res?.[2] === '0', res?.[0] ?? assetTest.stderr.slice(-300));

// ═══ [113-9] 매매 · 시황 · 자동매매 · 거래정지 · 휴장 달력 · 시세 · 장 시간 코드 바뀐 파일 0 ═══
const diff = spawnSync('git', ['diff', '--name-only', '9597bae', '--', 'server/autoTrading', 'server/buyJudge', 'server/marketBrief', 'server/rules', 'server/paperTradingService.ts', 'server/usHalts', 'server/marketCalendar.ts', 'server/heatmapSession.ts', 'server/quoteService.ts', 'src/services/toss', 'python'], { cwd: root, encoding: 'utf8' });
check('[113-9] 매매 · 시황 · 자동매매 · 거래정지 · 휴장 달력 · 시세 · 장 시간 코드 바뀐 파일 0(9597bae 와 지금 작업 트리)', diff.status === 0 && diff.stdout.trim() === '', diff.stdout.trim() || diff.stderr.trim());

// ═══ [113-10] 로그 · 시험 출력 ═══
const leaked = (text: string) => SECRET.filter((x) => text.includes(x));
check('[113-10] 서버 코드 로그(바꾸기 · 되돌리기 · 10초 쓰기 · 실패)에 가격 · 종목 코드 · 이름 없음 — 줄 번호 · 이유 종류만', captured.length > 0 && leaked(captured.join('\n')).length === 0 && captured.some((l) => /시트 가격 쓰기 실패: network 429/.test(l)) && captured.some((l) => /15행 줄 코드가 바뀜/.test(l)), leaked(captured.join('\n')).join(','));
check('[113-10] 이 시험의 출력에 가격 · 종목 코드 · 이름 없음', leaked(printed.join('\n')).length === 0, leaked(printed.join('\n')).join(','));
check('[113-1] [113-6] 실제 구글 호출 0(가짜가 모두 받음)', g.real === 0);

console.log(`\n결과: ${pass}개 통과 / ${fail}개 실패`);
process.exit(fail ? 1 : 0);
