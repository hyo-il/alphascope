/**
 * 이번 달 구매 계좌마다(151차 · v2.78.0) — `npm run assetpurchase:test` · ⚠️ `DB_PATH=<사본>` 으로만 돈다(맨 첫 import).
 * 151차 「꼭 지킬 동작」 1 ~ 17 을 줄마다 확인한다(시험 이름 앞 [151-n]).
 * - 서버: 이 프로세스 안 Express(로그인 문지기 + 자산 라우터) · 가짜 시계(`setPurchaseClockForTest`) · 가짜 구글(`fetch` 바꿔치기 — 만든 값) · 실제 구글 호출 0.
 * - 화면: Vite(5185) + Playwright · `/api` 는 모두 `page.route` 가짜(만든 값) — 요소는 역할 + 이름 · `data-testid` 로 찾는다.
 * - A-11: 옛 차례 단위 코드(3b11085)의 결과 정답 파일 `scripts/fixtures/asset/purchaseBefore.json` 과 새 계좌 단위 결과를 견준다.
 * ⚠️ 출력에 가짜 금액 · 이름을 찍지 않는다(칸 주소 · 개수 · 맞음 / 아님만).
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { chromium, type Browser, type Page } from 'playwright';
import { getDb } from '../server/db';
import { createSession } from '../server/auth';
import { authGuard } from '../server/authGuard';
import { setAssetPassword, unlockSession } from '../server/asset/lock';
import { assetRouter } from '../server/asset/routes';
import { resetTokenCache } from '../server/asset/google';
import { readAssetSheet, resetSheetCache, writeAccountDate } from '../server/asset/sheet';
import { purchaseAccountsInput, purchaseStateOf, setPurchaseClockForTest } from '../server/asset/purchase';
import { PURCHASE_ACCOUNT_KEYS, clearPurchasesForTest, migrateOldPurchasesForTest, purchaseCountForTest, recordPurchase } from '../server/asset/store';
import { SAVING_TAB, runSavingTabCheck, savingTabLines, savingTabShape } from './assetCheckSheet';
import { chasuDiff, chasuLabel, type Chasu } from './lib/chasuRange';
import { createBrowserStepGuard } from './lib/browserStepGuard';
import { assetStatusSample, assetSummarySample, assetSheetSample, assetHistorySample, cashViewSample } from './fixtures/asset/screenSample';
import type { AssetSummary, MonthlyBuy } from '../src/types/asset';

const root = path.resolve(import.meta.dirname, '..');
const guard = createBrowserStepGuard();
let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = '') {
  guard.mark(name);
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? ` — ${detail}` : ''}`);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-purchase-'));
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const keyFile = path.join(tmp, 'sa.json');
fs.writeFileSync(keyFile, JSON.stringify({ client_email: 'selftest@example.invalid', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }));
process.env.ASSET_SHEET_ID = 'selftest-purchase-sheet';
process.env.GOOGLE_SA_KEY_FILE = keyFile;
process.env.ASSET_SYNC_ENABLED = 'true';

// ── 가짜 시트(118차 원본과 같은 줄 모양 · 만든 값) ──
type Cell = string | number;
type Model = { values: Record<string, Cell>; formulas: Record<string, Cell> };
const H = '주식 투자 정리';
const T = '티커';
const NAME_CELL: Record<string, string> = { '개별 투자': 'B4', '적립식 계좌': 'B12', 'ISA 계좌': 'B21', '연금 저축 계좌': 'B29' };
const SECTIONS: [string, number, number][] = [['개별 투자 ( 2026.07 )', 5, 9], ['적립식 계좌 ( 2026.07 )', 13, 18], ['ISA 계좌 ( 2026.07 )', 22, 26], ['연금 저축 계좌 ( 2026.07 )', 30, 32]];
function model(): Model {
  const v: Record<string, Cell> = {
    [`${T}!B12`]: '구분', [`${T}!D12`]: '자산 분류', [`${T}!G9`]: 1300,
    [`${T}!B13`]: '개별 투자', [`${T}!B23`]: '적립식 투자', [`${T}!B32`]: 'ISA 계좌', [`${T}!B39`]: '연금 저축 계좌',
    '자산 투자 비율 관리!B18': '자산 배분 비율', '월 고정지출!B5': '현재 월 급여', '현금!B4': '은행 자산', '현금!B25': '은행 자산 총액', '현금!B28': '퇴직 연금', '현금!B30': '퇴직 연금 총액',
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
  for (const [name, first, last] of SECTIONS) {
    v[`${H}!B${first - 1}`] = name;
    for (let row = first; row <= last; row++, t++) {
      v[`${H}!B${row}`] = `가짜종목${t}`;
      v[`${H}!C${row}`] = 1000 + t;
      v[`${H}!D${row}`] = 1 + t;
      f[`${H}!F${row}`] = `=D${row}*'티커'!$F$${tickerRows[t]}`;
    }
  }
  for (let row = 39; row <= 44; row++) {
    v[`${H}!B${row}`] = `가짜합친${row}`;
    v[`${H}!C${row}`] = 500;
    v[`${H}!D${row}`] = 2;
    f[`${H}!F${row}`] = `=D${row}*'티커'!$F$14`;
  }
  return { values: v, formulas: { ...v, ...f } };
}
let sheet = model();
const setName = (section: string, name: string) => {
  sheet.values[`${H}!${NAME_CELL[section]}`] = name;
  sheet.formulas[`${H}!${NAME_CELL[section]}`] = name;
};
/** 가짜 「적립식 투자」 탭(D 점검) — 'A1' → 값 / 수식 */
let savingTab: { values: Record<string, Cell>; formulas: Record<string, Cell> } | null = null;
const g = { reads: 0, tabs: 0, writes: [] as { range: string; value: unknown }[], token: 0 };
let writeDelayMs = 0;
const colNum = (c: string) => c.charCodeAt(0) - 64;
const colChr = (n: number) => String.fromCharCode(64 + n);
function cut(m: Record<string, Cell>, range: string): Cell[][] {
  const r = range.match(/^'((?:[^']|'')+)'!([A-Z])(\d+)(?::([A-Z])(\d+)?)?$/);
  if (!r) throw new Error('범위 모양');
  const tab = r[1].replace(/''/g, "'");
  const [c1, r1] = [colNum(r[2]), Number(r[3])];
  const last = Math.max(r1, ...Object.keys(m).filter((k) => k.startsWith(`${tab}!`)).map((k) => Number(/(\d+)$/.exec(k)?.[1] ?? 0)));
  const [c2, r2] = r[4] ? [colNum(r[4]), r[5] ? Math.min(Number(r[5]), last) : last] : [c1, r1];
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
let realGoogle = 0;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!/googleapis\.com/.test(url)) {
    if (/google/.test(url)) realGoogle++;
    return realFetch(input, init);
  }
  if (url.startsWith('https://oauth2.googleapis.com/token')) {
    g.token++;
    return new Response(JSON.stringify({ access_token: 'fake', expires_in: 3600 }), { status: 200 });
  }
  if ((init?.method ?? 'GET') === 'POST') {
    const body = JSON.parse(String(init?.body ?? '{}')) as { data?: { range: string; values?: unknown[][] }[] };
    if (writeDelayMs) await new Promise((ok) => setTimeout(ok, writeDelayMs));
    for (const d of body.data ?? []) {
      const value = d.values?.[0]?.[0];
      g.writes.push({ range: d.range, value });
      const m = d.range.match(/^'((?:[^']|'')+)'!([A-Z]\d+)$/);
      if (m) {
        sheet.values[`${m[1]}!${m[2]}`] = value as Cell;
        sheet.formulas[`${m[1]}!${m[2]}`] = value as Cell;
      }
    }
    return new Response('{}', { status: 200 });
  }
  if (!url.includes('/values:batchGet')) {
    // 탭 목록(D 점검)
    g.tabs++;
    const titles = ['주식 투자 정리', '티커', ...(savingTab ? [savingTabTitle] : [])];
    return new Response(JSON.stringify({ sheets: titles.map((title, i) => ({ properties: { sheetId: i + 1, title, sheetType: 'GRID' } })) }), { status: 200 });
  }
  g.reads++;
  const params = new URL(url).searchParams;
  const formula = params.get('valueRenderOption') === 'FORMULA';
  const valueRanges = params.getAll('ranges').map((r) => {
    if (savingTab && r.startsWith(`'${savingTabTitle}'!`)) return { range: r, values: cut(formula ? savingTab.formulas : savingTab.values, r.replace(savingTabTitle, '탭')) };
    return { range: r, values: cut(formula ? sheet.formulas : sheet.values, r) };
  });
  return new Response(JSON.stringify({ valueRanges }), { status: 200 });
}) as typeof fetch;
let savingTabTitle = SAVING_TAB;

function fresh(change?: () => void) {
  sheet = model();
  change?.();
  g.reads = g.tabs = g.token = 0;
  g.writes = [];
  writeDelayMs = 0;
  resetSheetCache();
  resetTokenCache();
}

const cal = () => ({ isClosed: (d: string) => d === '2026-12-25', isChecked: () => true });
const at = (day: string) => setPurchaseClockForTest(() => Date.parse(`${day}T03:00:00Z`), cal);
const ALL = [...PURCHASE_ACCOUNT_KEYS];
const recCount = (cycle: string, section?: string) =>
  (getDb().prepare(`SELECT COUNT(*) AS n FROM asset_purchase_account WHERE cycle_date = ?${section ? ' AND section = ?' : ''}`).get(...(section ? [cycle, section] : [cycle])) as { n: number }).n;
const recOf = (cycle: string, section: string) =>
  (getDb().prepare(`SELECT status, at FROM asset_purchase_account WHERE cycle_date = ? AND section = ?`).get(cycle, section) as { status: string; at: string } | undefined) ?? null;
const state = async () => purchaseStateOf(purchaseAccountsInput(await readAssetSheet()));
const accOf = (s: { accounts: MonthlyBuy['accounts'] }, sec: string) => s.accounts.find((a) => a.section === sec)!;

// ── 안쪽 서버(로그인 문지기 + 자산 라우터) ──
const app = express();
app.use(express.json());
app.use(authGuard);
app.use(assetRouter);
const srv = app.listen(0, '127.0.0.1');
await new Promise((ok) => srv.once('listening', ok));
const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
await setAssetPassword(`selftest-asset-${crypto.randomBytes(4).toString('hex')}`);
const token = createSession('selftest-purchase');
unlockSession(token);
const ck = { cookie: `as_session=${encodeURIComponent(token)}` };
const act = async (action: 'done' | 'skip' | 'undo', cycleDay: string, section: string) => {
  const r = await fetch(`${base}/api/asset/purchase/${action}`, { method: 'POST', headers: { ...ck, 'content-type': 'application/json' }, body: JSON.stringify({ cycleDay, section }) });
  return { status: r.status, body: (await r.json()) as { kind?: string; error?: string; status?: string; written?: boolean; sheetDate?: string } };
};
const setMonthly = async (section: string, monthly: boolean) =>
  (await fetch(`${base}/api/asset/purchase/monthly-accounts`, { method: 'PUT', headers: { ...ck, 'content-type': 'application/json' }, body: JSON.stringify({ section, monthly }) })).status;

try {
  // ═══ 1 · 2 · 3 — [구매 완료] 는 그 계좌 칸 하나만 ═══
  fresh();
  clearPurchasesForTest();
  at('2026-11-27');
  const before = { ...sheet.values };
  const r1 = await act('done', '2026-11-27', '적립식 계좌');
  const others = ALL.filter((k) => k !== '적립식 계좌').every((k) => sheet.values[`${H}!${NAME_CELL[k]}`] === before[`${H}!${NAME_CELL[k]}`]);
  check('[151-1] 계좌 A [구매 완료] → 쓰기 요청 1번 · 범위 = A 이름 칸 하나(B12) · 날짜만 2026.11 · 다른 계좌 칸 그대로 · 기록 그 계좌만 done',
    r1.status === 200 && r1.body.written === true && g.writes.length === 1 && g.writes[0].range === `'${H}'!B12` && g.writes[0].value === '적립식 계좌 ( 2026.11 )' && others &&
      recOf('2026-11-27', '적립식 계좌')?.status === 'done' && recCount('2026-11-27') === 1, JSON.stringify(g.writes.map((w) => w.range)));

  fresh();
  clearPurchasesForTest();
  at('2026-11-27');
  const s2 = await state(); // 캐시에는 2026.07
  setName('개별 투자', '개별 투자 ( 2026.12 )'); // 사용자가 시트에서 직접 고침 — 캐시는 아직 옛 값
  const r2 = await act('done', '2026-11-27', '개별 투자');
  check('[151-2] 시트 A 날짜가 이미 그 차례 이후(쓰기 직전에 다시 읽은 값 2026.12 · 캐시는 2026.07) → 쓰기 0번 · 기록 done · 응답 written false · sheetDate 2026.12(화면 안내 한 줄은 [151-14])',
    !accOf(s2, '개별 투자').sheetAlready && r2.status === 200 && r2.body.written === false && r2.body.sheetDate === '2026.12' && g.writes.length === 0 && recOf('2026-11-27', '개별 투자')?.status === 'done' && sheet.values[`${H}!B4`] === '개별 투자 ( 2026.12 )');
  resetSheetCache();
  const s2b = await state();
  check('[151-2] 다시 읽은 summary — 그 계좌 sheetAlready(다음 차례 12-24 기준 2026.12) · sheetDateNow 2026.12 · 같은 달 다른 계좌는 아님',
    accOf(s2b, '개별 투자').sheetAlready && accOf(s2b, '개별 투자').sheetDateNow === '2026.12' && !accOf(s2b, 'ISA 계좌').sheetAlready);

  fresh(() => { sheet.formulas[`${H}!B21`] = '="ISA 계좌 ( "&TEXT(TODAY(),"yyyy.mm")&" )"'; });
  clearPurchasesForTest();
  at('2026-11-27');
  const r3 = await act('done', '2026-11-27', 'ISA 계좌');
  check('[151-3] A 칸이 수식 → 쓰기 0번 · 409 formula-cell · 기록 없음', r3.status === 409 && r3.body.kind === 'formula-cell' && g.writes.length === 0 && purchaseCountForTest() === 0);

  // ═══ 4 · 5 — 건너뛰기 · 되돌리기 ═══
  fresh();
  clearPurchasesForTest();
  at('2026-11-27');
  const r4 = await act('skip', '2026-11-27', 'ISA 계좌');
  check('[151-4] [건너뛰기] → 쓰기 0번 · 기록 skip · 그 계좌만(1줄)', r4.status === 200 && r4.body.status === 'skip' && g.writes.length === 0 && recOf('2026-11-27', 'ISA 계좌')?.status === 'skip' && purchaseCountForTest() === 1);
  await act('done', '2026-11-27', '개별 투자');
  const w5 = g.writes.length;
  const u1 = await act('undo', '2026-11-27', '개별 투자');
  const u2 = await act('undo', '2026-11-27', 'ISA 계좌');
  const s5 = await state();
  check('[151-5] [되돌리기](완료 · 건너뜀) → 기록 「아직」(줄 지움) · 쓰기 0번 · 시트 날짜는 그대로(완료 때 쓴 2026.11)',
    u1.status === 200 && u2.status === 200 && u1.body.status === 'todo' && g.writes.length === w5 && purchaseCountForTest() === 0 &&
      accOf(s5, '개별 투자').status === 'todo' && accOf(s5, 'ISA 계좌').status === 'todo' && sheet.values[`${H}!B4`] === '개별 투자 ( 2026.11 )');
  const u3 = await act('undo', '2026-11-27', '개별 투자');
  check('[151-5] 기록이 없는 차례 [되돌리기] → 409 「되돌릴 기록이 없습니다.」', u3.status === 409 && u3.body.error === '되돌릴 기록이 없습니다.');

  // ═══ 6 — 다음 차례 ═══
  fresh();
  clearPurchasesForTest();
  at('2026-11-27');
  const n1 = await act('skip', '2026-12-24', '개별 투자');
  const n2 = await act('done', '2026-12-24', '개별 투자');
  check('[151-6] 이번 차례 「아직」 계좌는 다음 차례 [건너뛰기] · [구매 완료] 409 「이번 차례(2026-11-27)를 먼저 끝내 주세요.」',
    n1.status === 409 && n2.status === 409 && n1.body.error === '이번 차례(2026-11-27)를 먼저 끝내 주세요.' && purchaseCountForTest() === 0);
  await act('done', '2026-11-27', '개별 투자');
  const n3 = await act('skip', '2026-12-24', '개별 투자'); // 오늘 11-27 — 다음 구매일 27일 전
  const s6 = await state();
  check('[151-6] 이번 차례를 끝낸 계좌는 다음 차례 [건너뛰기] 날짜 제한 없이 됨(오늘 11-27 · 다음 12-24) · 12월 「건너뜀」',
    n3.status === 200 && recOf('2026-12-24', '개별 투자')?.status === 'skip' && accOf(s6, '개별 투자').next.status === 'skip' && accOf(s6, '개별 투자').next.at === '2026-11-27');
  await act('done', '2026-11-27', 'ISA 계좌');
  at('2026-12-16');
  const n4 = await act('done', '2026-12-24', 'ISA 계좌');
  at('2026-12-17');
  const n5 = await act('done', '2026-12-24', 'ISA 계좌');
  check('[151-6] 다음 차례 [구매 완료] 는 7일 전부터 — 12-16 409 「다음 구매일 2026-12-24 7일 전부터 누를 수 있습니다.」 · 12-17 200(시트 2026.12)',
    n4.status === 409 && n4.body.error === '다음 구매일 2026-12-24 7일 전부터 누를 수 있습니다.' && n5.status === 200 && sheet.values[`${H}!B21`] === 'ISA 계좌 ( 2026.12 )');
  const n6 = await act('undo', '2026-11-27', 'ISA 계좌');
  check('[151-6] 다음 차례 기록이 남은 계좌의 이번 차례 [되돌리기] → 409 「다음 차례 기록을 먼저 되돌려 주세요.」(늦은 차례가 「아직」 인데 다음 차례만 남지 않게)',
    n6.status === 409 && n6.body.error === '다음 차례 기록을 먼저 되돌려 주세요.' && recOf('2026-11-27', 'ISA 계좌')?.status === 'done');
  const n7 = await act('done', '2026-01-30', '개별 투자');
  check('[151-6] 이번 · 다음 차례가 아닌 날짜 → 409 「처리할 수 있는 차례가 아닙니다(…)」', n7.status === 409 && /^처리할 수 있는 차례가 아닙니다/.test(n7.body.error ?? ''));

  // ═══ 7 · 8 — 팝업 ═══
  fresh();
  clearPurchasesForTest();
  at('2026-11-27');
  const p0 = await state();
  for (const k of ['개별 투자', '적립식 계좌', 'ISA 계좌']) await act(k === 'ISA 계좌' ? 'skip' : 'done', '2026-11-27', k);
  const p1 = await state();
  const offStatus = await setMonthly('연금 저축 계좌', false);
  const p2 = await state();
  check('[151-7] 팝업 — 매달 사는 계좌에 「아직」 이 있으면 뜸 · 셋 완료 · 건너뜀 + 남은 하나가 「아직」 이면 뜸 · 그 계좌를 매달 아님으로 끄면 안 뜸(세지 않음)',
    p0.needsPopup && p1.needsPopup && offStatus === 200 && !p2.needsPopup && accOf(p2, '연금 저축 계좌').buysMonthly === false && accOf(p2, '연금 저축 계좌').status === 'todo');
  await setMonthly('연금 저축 계좌', true);
  await act('done', '2026-11-27', '연금 저축 계좌');
  const p3 = await state();
  check('[151-7] 모두 완료 · 건너뜀이면 안 뜸', !p3.needsPopup);
  const offOdd = await setMonthly('없는 계좌', false);
  check('[151-7] 매달 사는 계좌 — 시트에 없는 계좌는 400 · 시트에서 없어진 key 는 무시(새 계좌는 켬)', offOdd === 400);
  // 8. 12월을 건너뛴 계좌는 12월 구매일에 팝업 대상이 아님
  for (const k of ALL) await act('skip', '2026-12-24', k);
  at('2026-12-24');
  const p4 = await state();
  check('[151-8] 다음 차례(12월)를 건너뛴 계좌는 그 구매일(12-24 · 시험 시계)에 팝업 대상이 아님 — 네 계좌 모두 건너뜀이면 needsPopup 거짓 · 상태 skip',
    p4.cycleDay === '2026-12-24' && p4.accounts.every((a) => a.status === 'skip') && !p4.needsPopup);
  await act('undo', '2026-12-24', '적립식 계좌');
  const p5 = await state();
  check('[151-8] 그중 하나를 되돌리면(아직) 그 구매일에 팝업이 뜸', p5.needsPopup && accOf(p5, '적립식 계좌').status === 'todo');

  // ═══ 9 — 옛 기록 옮기기 ═══
  fresh();
  clearPurchasesForTest(); // 옮김 표시도 지움
  const db = getDb();
  db.exec(`CREATE TABLE IF NOT EXISTS asset_purchase (cycle_date TEXT PRIMARY KEY, done_at TEXT)`);
  const oldBackup = db.prepare(`SELECT cycle_date, done_at FROM asset_purchase`).all() as { cycle_date: string; done_at: string | null }[];
  db.prepare(`DELETE FROM asset_purchase`).run();
  db.prepare(`INSERT INTO asset_purchase (cycle_date, done_at) VALUES (?, ?), (?, ?)`).run('2026-10-30', '2026-11-02', '2026-11-27', null);
  migrateOldPurchasesForTest();
  const m1 = purchaseCountForTest();
  const atRows = db.prepare(`SELECT DISTINCT cycle_date, status, at FROM asset_purchase_account ORDER BY cycle_date`).all() as { cycle_date: string; status: string; at: string }[];
  migrateOldPurchasesForTest();
  const m2 = purchaseCountForTest();
  const oldStill = db.prepare(`SELECT COUNT(*) AS n FROM asset_purchase`).get() as { n: number };
  const dropSrc = ['server/asset/store.ts', 'server/db.ts', 'db/schema.sql'].map((f) => fs.readFileSync(path.join(root, f), 'utf8')).join('\n');
  check(`[151-9] 옛 줄 2개 → 새 줄 = 2 × 계좌 수(${ALL.length}) = ${2 * ALL.length} · 모두 done · at = 옛 done_at(없으면 차례 날짜) · 두 번 불러도 같음 · 옛 표 남음(줄 2) · DROP 0`,
    m1 === 2 * ALL.length && m2 === m1 && JSON.stringify(atRows) === JSON.stringify([{ cycle_date: '2026-10-30', status: 'done', at: '2026-11-02' }, { cycle_date: '2026-11-27', status: 'done', at: '2026-11-27' }]) &&
      oldStill.n === 2 && !/DROP\s+TABLE[^;]*asset_purchase\b/i.test(dropSrc), `${m1}/${m2}/${oldStill.n}`);
  db.prepare(`DELETE FROM asset_purchase`).run();
  for (const r of oldBackup) db.prepare(`INSERT INTO asset_purchase (cycle_date, done_at) VALUES (?, ?)`).run(r.cycle_date, r.done_at);

  // ═══ A-11 — 옛 차례 단위 결과(정답 파일)와 같은지 ═══
  const golden = JSON.parse(fs.readFileSync(path.join(root, 'scripts/fixtures/asset/purchaseBefore.json'), 'utf8')) as {
    cycles: { name: string; today: string; records: [string, string][]; cycle: { cycleDay: string; nextDay: string; skipped: boolean; done: boolean; earlyFrom: string; earlyCycle: string | null }; target: { cycleDay?: string; early?: boolean; kind?: string } }[];
    writes: { day: string; cells: number; writes: { range: string; value: string }[] }[];
  };
  const startOf: Record<string, string> = {};
  const diffs: string[] = [];
  for (const sc of golden.cycles) {
    fresh();
    clearPurchasesForTest({ keepMigrated: true });
    const startAt = sc.name.startsWith('11-27 미완료') ? '2026-11-27' : '2026-11-07';
    startOf[sc.name] = startAt;
    at(startAt);
    await state(); // 시작한 날 저장
    for (const [c, d] of sc.records) for (const k of ALL) recordPurchase(c, k, 'done', d);
    at(sc.today);
    const s = await state();
    const same = s.cycleDay === sc.cycle.cycleDay && s.nextDay === sc.cycle.nextDay && s.skipped === sc.cycle.skipped && s.earlyFrom === sc.cycle.earlyFrom &&
      s.accounts.every((a) => (a.status === 'done') === sc.cycle.done);
    // 옛 [구매 완료] 대상 ↔ 계좌마다: 이번 차례 「아직」 이면 이번 차례 · 아니면 다음 차례를 미리(canDone) · 대상 없음이면 아무 계좌도 누를 수 없음
    const t = sc.target;
    const sameTarget = t.kind
      ? s.accounts.every((a) => a.status !== 'todo' && !a.next.canDone)
      : s.accounts.every((a) => a.doneCycle === t.cycleDay && (t.early ? a.status !== 'todo' && a.next.canDone : a.status === 'todo'));
    if (!same || !sameTarget) diffs.push(sc.name);
  }
  check(`[151-A11] 옛 차례 판단 ${golden.cycles.length}가지(정답 파일) = 새 계좌 판단(네 계좌 모두 같은 기록일 때 — 이번 차례 · 다음 · 시작 전 · 미리 완료 대상)`, diffs.length === 0, diffs.join(' | '));
  const writeDiffs: string[] = [];
  for (const wv of golden.writes) {
    fresh(() => {
      setName('개별 투자', '개별 투자 ( 2026.07 )');
      setName('적립식 계좌', '적립식 계좌 (2026.10.24)');
      setName('ISA 계좌', 'ISA 계좌 ( 2026-07 ) 메모');
      setName('연금 저축 계좌', '연금 저축 계좌 ( 2026.7)');
    });
    for (const k of ALL) await writeAccountDate(wv.day, k);
    const got = g.writes.map((w) => ({ range: w.range, value: w.value })).sort((a, b) => a.range.localeCompare(b.range));
    if (JSON.stringify(got) !== JSON.stringify(wv.writes)) writeDiffs.push(wv.day);
  }
  check('[151-A11] 옛 「날짜가 든 칸 전부」 쓰기(정답 파일 — 11-27 · 12-24) = 새 계좌마다 쓰기를 네 번 한 결과(같은 칸 · 같은 글자 · 모양 그대로)', writeDiffs.length === 0, writeDiffs.join(','));

  // ═══ 10 — 시작 전 차례 ═══
  fresh();
  clearPurchasesForTest({ keepMigrated: true });
  at('2026-11-07');
  const b0 = await state();
  const b1 = await act('done', '2026-10-30', '개별 투자');
  const b2 = await act('skip', '2026-10-30', '개별 투자');
  check('[151-10] 시작 전 차례(10-30 · 시작한 날 11-07)는 묻지 않음 — 네 계좌 before-start · 팝업 없음 · [구매 완료] · [건너뛰기] 409 「시작 전 차례는 묻지 않습니다.」 · 쓰기 0',
    b0.skipped && b0.accounts.every((a) => a.status === 'before-start') && !b0.needsPopup && b1.status === 409 && b2.status === 409 && b1.body.error === '시작 전 차례는 묻지 않습니다.' && g.writes.length === 0);
  const b3 = await act('skip', '2026-11-27', '개별 투자');
  check('[151-10] 시작 전 차례 다음 차례(11-27)는 [건너뛰기] 됨(이번 차례가 끝난 것과 같음)', b3.status === 200);

  // ═══ 11 — 쓰기 스위치 꺼짐 ═══
  fresh();
  clearPurchasesForTest({ keepMigrated: true });
  at('2026-11-27');
  process.env.ASSET_SYNC_ENABLED = 'false';
  const o1 = await act('done', '2026-11-27', '개별 투자');
  const o2 = await act('skip', '2026-11-27', '개별 투자');
  const o3 = await act('undo', '2026-11-27', '개별 투자');
  process.env.ASSET_SYNC_ENABLED = 'true';
  check('[151-11] 쓰기 스위치 꺼짐 → [구매 완료] 만 503 disabled(구글 토큰 0) · [건너뛰기] · [되돌리기] 는 200 · 쓰기 0',
    o1.status === 503 && o1.body.kind === 'disabled' && o2.status === 200 && o3.status === 200 && g.writes.length === 0, `${o1.status}/${o2.status}/${o3.status}`);

  // ═══ 12 — 같은 계좌 동시에 두 번 ═══
  fresh();
  clearPurchasesForTest({ keepMigrated: true });
  at('2026-11-27');
  await readAssetSheet();
  writeDelayMs = 150;
  const [c1, c2] = await Promise.all([act('done', '2026-11-27', '개별 투자'), act('done', '2026-11-27', '개별 투자')]);
  writeDelayMs = 0;
  const statuses = [c1.status, c2.status].sort();
  check('[151-12] 같은 계좌를 동시에 두 번 → 쓰기 1번 · 하나 200 · 뒤의 것 409(busy 또는 already-done) · 기록 1줄',
    JSON.stringify(statuses) === JSON.stringify([200, 409]) && g.writes.length === 1 && recCount('2026-11-27', '개별 투자') === 1, `${statuses.join(',')} · 쓰기 ${g.writes.length}`);

  // ═══ 15 — D 점검(가짜 「적립식 투자」 탭) ═══
  {
    // 만든 값 — 묶음 3개(A · B · C) · 0% 줄 · 합계 줄 · 계좌 이름은 둘만 시트 계좌와 맞음(셋째는 못 찾음)
    const SECRET = { amounts: [7654321, 8765432, 9876543], months: [6, 7, 9], names: ['가짜지수가', '가짜지수나', '가짜지수다', '가짜채권라', '가짜금마'], ratios: [0.37, 0.43, 0.2] };
    const v: Record<string, Cell> = {};
    const put = (cell: string, x: Cell) => { v[`탭!${cell}`] = x; };
    // 묶음 1 — 위에 「적립식 계좌」 · 머리 B3 · 개월 C3 · 총 금액 E3(왼쪽 D3 글자 「총 구매할 금액」)
    put('B2', '적립식 계좌 묶음'); put('B3', '분할 개월 수'); put('C3', SECRET.months[0]); put('D3', '총 구매할 금액'); put('E3', SECRET.amounts[0]);
    put('B4', '이름'); put('C4', '비율');
    put('B5', SECRET.names[0]); put('C5', SECRET.ratios[0]);
    put('B6', SECRET.names[1]); put('C6', SECRET.ratios[1]);
    put('B7', SECRET.names[2]); put('C7', SECRET.ratios[2]);
    put('B8', SECRET.names[3]); put('C8', 0);
    put('B9', '합계'); put('C9', 1);
    // 묶음 2 — 위에 「ISA」 · 합계가 100% 아님
    put('B12', 'ISA 계좌'); put('B13', '분할 개월 수'); put('C13', SECRET.months[1]); put('D13', '금액'); put('E13', SECRET.amounts[1]);
    put('B15', SECRET.names[0]); put('C15', 0.5);
    put('B16', SECRET.names[4]); put('C16', 0.4);
    put('B17', '합계'); put('C17', 0.9);
    // 묶음 3 — 계좌 이름 없음 · 총 금액은 아래 칸
    put('B21', '메모'); put('B22', '분할 개월 수'); put('C22', SECRET.months[2]); put('C23', SECRET.amounts[2]);
    put('B24', SECRET.names[1]); put('C24', 1);
    put('B25', '합계'); put('C25', 1);
    const f: Record<string, Cell> = { ...v, '탭!C9': '=SUM(C5:C8)', '탭!C17': '=SUM(C15:C16)' };
    savingTab = { values: v, formulas: f };
    savingTabTitle = SAVING_TAB;
    g.reads = g.tabs = 0;
    g.writes = [];
    const lines: string[] = [];
    const run = await runSavingTabCheck({ sheetId: 'selftest-purchase-sheet', keyFile }, (l) => lines.push(l));
    const text = lines.join('\n');
    const secretHits = [...SECRET.amounts.map(String), ...SECRET.amounts.map((n) => n.toLocaleString('en-US')), ...SECRET.names, '0.37', '0.43', '37%', '43%']
      .filter((x) => text.includes(x));
    check('[151-15] D 점검 출력에 가짜 금액 · 비율 · 이름 글자 0번(개월 수 값도 「C3 (숫자 맞음)」 처럼 주소만)', secretHits.length === 0 && !/개월 수 칸 — C3 \(6/.test(text), secretHits.join(','));
    const shape = savingTabShape(cut(v, "'탭'!A1:Z300"), cut(f, "'탭'!A1:Z300"));
    check('[151-15] 묶음 3개 · 머리 B3 · B13 · B22 · 개월 수 칸 C3 · C13 · C22(숫자 맞음) · 계좌 「적립식 계좌」 · 「ISA 계좌」 · 못 찾음',
      shape.length === 3 && shape.map((x) => x.anchor).join() === 'B3,B13,B22' && shape.map((x) => x.months?.cell).join() === 'C3,C13,C22' && shape.every((x) => x.months?.isNumber) &&
        shape[0].account === '적립식 계좌' && shape[1].account === 'ISA 계좌' && shape[2].account == null && /계좌 못 찾음/.test(text), JSON.stringify(shape.map((x) => [x.anchor, x.months?.cell, x.account])));
    check('[151-15] 총 금액 후보 E3(옆 글자 낱말 있음) · E13 · C23 · 비율 줄 C5 ~ C8 4줄 · 0% 1줄 · 이름 열 B · 합계 C9 100% 맞음 · C17 100% 아님 · 수식 칸 1 · 1 · 0',
      shape[0].amountCandidates.some((a) => a.cell === 'E3' && a.label?.words) && shape[1].amountCandidates.some((a) => a.cell === 'E13') && shape[2].amountCandidates.some((a) => a.cell === 'C23') &&
        shape[0].ratio?.column === 'C' && shape[0].ratio.firstRow === 5 && shape[0].ratio.lastRow === 8 && shape[0].ratio.rows === 4 && shape[0].ratio.zeroRows === 1 && shape[0].nameColumns.join() === 'B' &&
        shape[0].sum?.cell === 'C9' && shape[0].sum.is100 && shape[1].sum?.cell === 'C17' && !shape[1].sum.is100 && shape.map((x) => x.formulaCells).join() === '1,1,0',
      JSON.stringify(shape.map((x) => ({ a: x.amountCandidates, r: x.ratio, s: x.sum, f: x.formulaCells }))));
    check('[151-15] 읽기만 — 탭 목록 1번 + 값 1번 + 수식 1번 · 쓰기 0', run.reads === 3 && g.tabs === 1 && g.reads === 2 && g.writes.length === 0, `${run.reads}/${g.tabs}/${g.reads}/${g.writes.length}`);
    savingTabTitle = '적립식  투자'; // 공백만 다름
    const spaced: string[] = [];
    await runSavingTabCheck({ sheetId: 'selftest-purchase-sheet-2', keyFile }, (l) => spaced.push(l));
    savingTab = null;
    const none: string[] = [];
    await runSavingTabCheck({ sheetId: 'selftest-purchase-sheet-3', keyFile }, (l) => none.push(l));
    check('[151-15] 탭 이름 — 공백만 다름이면 「있음(공백만 다름)」 · 없으면 「없음」(값 읽기 안 함)',
      /있음\(공백만 다름\)/.test(spaced[0] ?? '') && /— 없음/.test(none[0] ?? '') && none.length === 1 && savingTabLines('none', []).length === 1);
  }

  // ═══ 16 — 바뀐 파일(3b11085 → 지금) ═══
  {
    const CHASU: Chasu = { base: '3b11085', version: 'v2.78.0' };
    const trading = chasuDiff(root, CHASU, ['--name-only'], ['server/autoTrading', 'server/buyJudge', 'server/rules', 'server/paperTradingService.ts', 'server/paperPerformanceService.ts', 'server/paperSnapshotScheduler.ts', 'server/aiCheck', 'server/marketBrief', 'server/usHalts', 'server/quoteService.ts', 'server/heatmapSession.ts', 'server/marketCalendar.ts', 'server/auth.ts', 'server/authGuard.ts', 'src/services', 'python']);
    check(`[151-16] 매매 · 시황 · 주문 · 자동매매 · 로그인 코드 바뀐 파일 0(${chasuLabel(root, CHASU)})`, trading.status === 0 && trading.stdout.trim() === '', trading.stdout.trim() || trading.stderr.trim());
    const show = spawnSync('git', ['show', '3b11085:server/asset/purchase.ts'], { cwd: root, encoding: 'utf8' }).stdout;
    const body = (src: string) => src.split('export function computeMonthlyBuy(')[1]?.split('\n}\n')[0] ?? '';
    const nowSrc = fs.readFileSync(path.join(root, 'server/asset/purchase.ts'), 'utf8');
    check('[151-16] computeMonthlyBuy 몸통 바뀐 줄 0', body(show).length > 500 && body(show) === body(nowSrc));
  }

  // ═══ 17 — 옛 자산 시험이 지운 주소 · 함수를 쓰지 않음(통과 여부는 check:all 의 asset*:test) ═══
  {
    const scripts = fs.readdirSync(path.join(root, 'scripts')).filter((f) => /^asset.*\.ts$/.test(f) && f !== 'assetPurchaseSelfTest.ts');
    // 「없어야 한다」 는 확인(assetlock:test 의 !ACTIVE.has(옛 주소))은 쓰는 곳이 아니다
    const hits = scripts.filter((f) => /api\/asset\/purchase-done|writeAccountDates\(|purchaseTargetOf|purchaseDoneDay|markPurchaseDone/.test(fs.readFileSync(path.join(root, 'scripts', f), 'utf8').replaceAll("!ACTIVE.has('POST /api/asset/purchase-done')", '')));
    const appHits = ['src', 'server'].flatMap((d) => spawnSync('grep', ['-rlE', 'api/asset/purchase-done|writeAccountDates|purchaseTargetOf|purchaseDoneDay|markPurchaseDone|accountDateTexts', d], { cwd: root, encoding: 'utf8' }).stdout.split('\n').filter(Boolean));
    check(`[151-17] 옛 자산 시험 ${scripts.length}개 · src · server 에 지운 주소(purchase-done) · 함수(writeAccountDates · purchaseTargetOf · purchaseDoneDay · accountDateTexts) 0곳`, hits.length === 0 && appHits.length === 0, [...hits, ...appHits].join(','));
  }
} catch (e) {
  fail++;
  console.log(`FAIL  서버 시험 중 오류 — ${(e as Error).message}`);
} finally {
  setPurchaseClockForTest(null);
  clearPurchasesForTest({ keepMigrated: true });
  srv.close();
}

// ═══ 13 · 14 — 화면(Vite + Playwright · 가짜 응답) ═══
const PORT = 5185;
const WEB = `http://127.0.0.1:${PORT}`;
type Fake = { summary: () => AssetSummary | { status: number; json: unknown }; delayMs?: number };
async function openAsset(browser: Browser, size: { width: number; height: number }, fake: Fake, posts: { url: string; body: string }[]) {
  const phone = size.width < 768;
  const ctx = await browser.newContext({ viewport: size, ...(phone ? { isMobile: true, hasTouch: true } : {}) });
  await ctx.addInitScript('window.__name = (f) => f');
  await ctx.addInitScript(() => {
    try {
      localStorage.setItem('alphascope.asset.tab', 'rebalance');
    } catch {
      /* 없어도 됨 */
    }
  });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)));
  await page.route(/\/api\/(?!asset\/)/, (r) => (r.request().url().includes('/api/auth/me') ? r.fulfill({ json: { ok: true } }) : r.fulfill({ status: 503, json: { error: '시험 — 없음' } })));
  await page.route('**/api/asset/status', (r) => r.fulfill({ json: assetStatusSample(true) }));
  await page.route('**/api/asset/touch', (r) => r.fulfill({ json: { ok: true, lockMinutes: 30, remainingMs: 30 * 60_000 } }));
  await page.route('**/api/asset/sheet', (r) => r.fulfill({ json: assetSheetSample() }));
  await page.route('**/api/asset/history**', (r) => r.fulfill({ json: assetHistorySample(5) }));
  await page.route('**/api/asset/cash', (r) => r.fulfill({ json: cashViewSample() }));
  await page.route('**/api/asset/summary**', async (r) => {
    if (fake.delayMs) await new Promise((ok) => setTimeout(ok, fake.delayMs));
    const s = fake.summary();
    await r.fulfill('status' in s && 'json' in s ? { status: s.status, json: s.json } : { json: s }).catch(() => {});
  });
  await page.route('**/api/asset/purchase/**', (r) => {
    const req = r.request();
    posts.push({ url: req.url().replace(/^.*\/api\//, '/api/'), body: req.postData() ?? '' });
    const action = req.url().split('/').pop();
    const b = JSON.parse(req.postData() || '{}') as { cycleDay?: string; section?: string };
    if (action === 'monthly-accounts') return r.fulfill({ json: b });
    return r.fulfill({ json: { cycleDay: b.cycleDay, section: b.section, status: action === 'undo' ? 'todo' : action, at: '2026-11-27', ...(action === 'done' ? { written: false, sheetDate: '2026.12' } : {}) } });
  });
  await guard.step('페이지 열기(#/asset)', () => page.goto(`${WEB}/#/asset`));
  return { page, ctx, errors };
}
const dialogText = async (page: Page) => (await page.getByRole('dialog').last().innerText()).replace(/⁠/g, '');

const { createServer } = await import('vite');
const vite = await guard.step('Vite 띄우기', async () => {
  const v = await createServer({ root, configFile: path.join(root, 'vite.config.ts'), logLevel: 'error', server: { host: '127.0.0.1', port: PORT, strictPort: true, hmr: false } });
  await v.listen();
  return v;
});
const browser = await guard.step('브라우저 띄우기', () => chromium.launch({ channel: 'chrome' }));
try {
  // 13. 응답 전 「아직」 을 그리지 않음 · 실패면 오류 + [다시 시도]
  {
    const posts: { url: string; body: string }[] = [];
    let failNow = false;
    const { page, ctx } = await openAsset(browser, { width: 1280, height: 1080 }, { summary: () => (failNow ? { status: 502, json: { error: '시험 — 시트를 읽지 못했습니다.', kind: 'network' } } : assetSummarySample({ purchaseDone: false })), delayMs: 1500 }, posts);
    await page.waitForTimeout(500);
    const todoBefore = await page.getByText('아직', { exact: true }).count();
    const accountsBefore = await page.getByTestId('purchase-account').count();
    const skeleton = await page.locator('[aria-busy="true"]').count();
    await page.getByTestId('purchase-account').first().waitFor({ timeout: 10_000 });
    check('[151-13] 응답 전(1.5초 늦춤) 「아직」 0 · 계좌 줄 0 · 스켈레톤(aria-busy) 있음 → 응답 뒤 계좌 줄', todoBefore === 0 && accountsBefore === 0 && skeleton > 0, `${todoBefore}/${accountsBefore}/${skeleton}`);
    await ctx.close();
    failNow = true;
    const f = await openAsset(browser, { width: 1280, height: 1080 }, { summary: () => ({ status: 502, json: { error: '시험 — 시트를 읽지 못했습니다.', kind: 'network' } }) }, posts);
    await f.page.getByRole('button', { name: '다시 시도' }).first().waitFor({ timeout: 10_000 });
    check('[151-13] summary 실패 → 오류 글 + [다시 시도] · 계좌 줄 · 「아직」 0(빈 목록으로 바꾸지 않음)',
      (await f.page.getByText('시험 — 시트를 읽지 못했습니다.').count()) > 0 && (await f.page.getByTestId('purchase-account').count()) === 0 && (await f.page.getByText('아직', { exact: true }).count()) === 0);
    await f.ctx.close();
  }

  // 14. 1280 · 402 — 계좌별 줄 · 단추 · 확인 창 글
  for (const size of [{ width: 1280, height: 1080 }, { width: 402, height: 874 }]) {
    const w = size.width;
    const posts: { url: string; body: string }[] = [];
    let writeEnabled = true;
    const { page, ctx, errors } = await openAsset(browser, size, { summary: () => assetSummarySample({ purchase: 'mixed', writeEnabled }) }, posts);
    // 팝업(「아직」 인 매달 계좌가 있음) — 계좌마다 한 줄 · [나중에]
    const dlg = page.getByRole('dialog', { name: '이번 달 구매일입니다' });
    await dlg.waitFor({ timeout: 15_000 });
    const popupRows = await dlg.getByTestId('purchase-account').count();
    const popupSections = await dlg.getByTestId('purchase-account').evaluateAll((els) => els.map((e) => e.getAttribute('data-section')));
    check(`[151-14] ${w} 구매일 팝업 — 매달 사는 계좌만 계좌마다 한 줄(3 · 연금 저축 빠짐) · [나중에]`,
      popupRows === 3 && !popupSections.includes('연금 저축 계좌') && (await dlg.getByRole('button', { name: '나중에' }).count()) === 1, popupSections.join(','));
    await dlg.getByRole('button', { name: '나중에' }).click();
    const sec = page.locator('#as-asset-monthly-buy');
    await sec.scrollIntoViewIfNeeded();
    const row = (s: string) => sec.locator(`[data-testid="purchase-account"][data-section="${s}"]`);
    const btns = async (s: string) => (await row(s).getByRole('button').allInnerTexts()).map((t) => t.trim());
    const a = await btns('개별 투자');
    const b = await btns('적립식 계좌');
    const c = await btns('ISA 계좌');
    check(`[151-14] ${w} 구역 — 완료 줄 [되돌리기](다음 차례 건너뜀이 있어 막힘) + 다음 차례 줄 「건너뜀」 + [되돌리기] · 아직 줄 [구매 완료] [건너뛰기] · 건너뜀 줄 [되돌리기] + 다음 차례 [건너뛰기]`,
      JSON.stringify(a) === JSON.stringify(['되돌리기', '되돌리기']) && (await row('개별 투자').getByRole('button', { name: '되돌리기' }).first().isDisabled()) &&
        (await row('개별 투자').getByTestId('purchase-next').getByText(/건너뜀/).count()) === 1 &&
        JSON.stringify(b) === JSON.stringify(['구매 완료', '건너뛰기']) && JSON.stringify(c) === JSON.stringify(['되돌리기', '건너뛰기']) && (await sec.getByTestId('purchase-account').count()) === 3,
      `${a.join('|')} / ${b.join('|')} / ${c.join('|')}`);
    // 확인 창 — 이미 이후
    await row('적립식 계좌').getByRole('button', { name: '구매 완료' }).click();
    const t1 = await dialogText(page);
    check(`[151-14] ${w} [구매 완료] 확인 창 — 시트 날짜가 이미 이후면 「「적립식 계좌」 시트 날짜는 이미 2026.12 — 그대로 두고 완료로 기록합니다.」`, t1.includes('「적립식 계좌」 시트 날짜는 이미 2026.12 — 그대로 두고 완료로 기록합니다.'), t1);
    await page.getByRole('dialog').last().getByRole('button', { name: '구매 완료' }).click();
    await sec.getByTestId('purchase-note').waitFor({ timeout: 5_000 });
    const note = (await sec.getByTestId('purchase-note').innerText()).trim();
    check(`[151-14] ${w} 그대로 둔 [구매 완료] 뒤 그 계좌 아래 안내 한 줄 「시트 날짜는 이미 2026.12 — 그대로 둠」 · POST done { cycleDay, section } 한 번`,
      note === '시트 날짜는 이미 2026.12 — 그대로 둠' && posts.filter((p) => p.url === '/api/asset/purchase/done').length === 1 && JSON.parse(posts[0].body).section === '적립식 계좌' && JSON.parse(posts[0].body).cycleDay === '2026-11-27', note);
    // 되돌리기 확인 창
    await row('ISA 계좌').getByRole('button', { name: '되돌리기' }).click();
    const t2 = await dialogText(page);
    check(`[151-14] ${w} [되돌리기] 확인 창 — 「「ISA 계좌」 이번 구매 차례(2026-11-27(금)) 기록만 되돌립니다 — 시트 날짜는 그대로입니다.」`, t2.includes('「ISA 계좌」 이번 구매 차례(2026-11-27(금)) 기록만 되돌립니다 — 시트 날짜는 그대로입니다.'), t2);
    await page.getByRole('dialog').last().getByRole('button', { name: '취소' }).click();
    // 건너뛰기 — 확인 창 없이 바로
    const n0 = posts.length;
    await row('ISA 계좌').getByTestId('purchase-next').getByRole('button', { name: '건너뛰기' }).click();
    await page.waitForTimeout(400);
    const skipPost = posts.slice(n0).find((p) => p.url === '/api/asset/purchase/skip');
    check(`[151-14] ${w} 다음 차례 [건너뛰기] — 확인 창 없이 POST skip { cycleDay 2026-12-24 · section ISA 계좌 }`,
      skipPost != null && JSON.parse(skipPost.body).cycleDay === '2026-12-24' && JSON.parse(skipPost.body).section === 'ISA 계좌' && (await page.getByRole('dialog').count()) === 0);
    // 쓰기 꺼짐 — [구매 완료] 만 막힘
    writeEnabled = false;
    await page.locator('[data-asset-dashboard]').getByRole('button', { name: '다시 읽기', exact: true }).click();
    await page.waitForTimeout(800);
    const doneBtn = row('적립식 계좌').getByRole('button', { name: '구매 완료' });
    const skipBtn = row('적립식 계좌').getByRole('button', { name: '건너뛰기' });
    check(`[151-11] [151-14] ${w} 쓰기 꺼진 서버 — [구매 완료] 만 막힘 · [건너뛰기] · [되돌리기] 됨 · 안내 한 줄`,
      (await doneBtn.isDisabled()) && !(await skipBtn.isDisabled()) && !(await row('ISA 계좌').getByRole('button', { name: '되돌리기' }).isDisabled()) && (await sec.getByTestId('purchase-write-off').count()) === 1);
    check(`[151-14] ${w} 화면 오류(pageerror) 0`, errors.length === 0, errors.join(' | '));
    if (w < 1280) {
      await ctx.close();
      continue;
    }
    // 설정 「이번 달 구매」 — 매달 사는 계좌 체크 · 바로 저장(1280 만 — 폰 설정 창 모양은 디자인 점검 장면)
    await page.locator('[data-asset-dashboard]').getByRole('button', { name: '설정', exact: true }).click();
    const sd = page.getByRole('dialog', { name: '자산 관리 설정' });
    await sd.waitFor({ timeout: 5_000 });
    await sd.getByRole('tab', { name: '이번 달 구매' }).click();
    const rows = sd.getByTestId('purchase-monthly-row');
    const checks = await sd.getByTestId('purchase-monthly-check').evaluateAll((els) => els.map((e) => (e as HTMLInputElement).checked));
    const m0 = posts.length;
    await sd.locator('[data-section="개별 투자"]').getByTestId('purchase-monthly-check').click();
    await page.waitForTimeout(400);
    const mPost = posts.slice(m0).find((p) => p.url === '/api/asset/purchase/monthly-accounts');
    check(`[151-C4] ${w} 설정 「이번 달 구매」 — 계좌 넷 · 매달 사는 계좌 체크(연금 저축만 꺼짐) · 누르면 바로 PUT monthly-accounts { section, monthly }`,
      (await rows.count()) === 4 && JSON.stringify(checks) === JSON.stringify([true, true, true, false]) && mPost != null && JSON.parse(mPost.body).section === '개별 투자' && typeof JSON.parse(mPost.body).monthly === 'boolean', JSON.stringify(checks));
    await ctx.close();
  }
} catch (e) {
  fail++;
  console.log(`FAIL  화면 시험 중 오류 — ${(e as Error).message}`);
} finally {
  await guard.step('브라우저 닫기', () => browser.close());
  await guard.step('Vite 닫기', () => vite.close());
}

check('[151] 실제 구글 호출 0', realGoogle === 0);
globalThis.fetch = realFetch;
fs.rmSync(tmp, { recursive: true, force: true });
getDb().prepare(`DELETE FROM auth_sessions WHERE user_agent = ?`).run('selftest-purchase');
console.log(`\n결과: ${pass}개 통과 / ${fail}개 실패`);
process.exit(fail ? 1 : 0);
