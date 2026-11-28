/**
 * 이번 달 구매 살 종목 [매수 입력] · 손가락 화면 툴팁(153차 · v2.80.0) — `npm run assetplanbuy:test` · ⚠️ `DB_PATH=<사본>` 으로만 돈다(맨 첫 import).
 * 153차 「꼭 지킬 동작」 1 ~ 13 을 줄마다 확인한다(시험 이름 앞 [153-n]).
 * - 서버: 이 프로세스 안 Express(로그인 문지기 + 자산 라우터) · 가짜 구글(`fetch` 바꿔치기 — 만든 값) · 가짜 가격 · 시험 시계(`setPurchaseClockForTest`) ·
 *   매수 기록은 사본 DB `asset_trades` 에 만든 줄을 넣고 끝에 그 줄만 지운다. 실제 구글 · 토스 호출 0 · 시트 쓰기 0.
 * - 화면: Vite(5201) + Playwright · `/api` 는 모두 `page.route` 가짜(만든 값 — `fixtures/asset/screenSample.ts`) · 요소는 역할 + 이름 · `data-testid` 로 찾는다.
 * - [153-6] 정답 파일 `fixtures/asset/tradeDialogBefore.json` — 기준 커밋(ba656c6) worktree 를 `CAPTURE_ROOT=<그 폴더>` 로 주면 그 코드로 만든다.
 * ⚠️ 출력에 가짜 금액 · 이름을 찍지 않는다(개수 · 맞음 / 아님만 — [153-13] 이 출력 전체를 다시 본다).
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import { noColorClass } from './lib/noColorClass';
import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { chromium, type Browser, type BrowserContext, type CDPSession, type Page } from 'playwright';
import { getDb } from '../server/db';
import { createSession } from '../server/auth';
import { authGuard } from '../server/authGuard';
import { setAssetPassword, unlockSession } from '../server/asset/lock';
import { assetRouter } from '../server/asset/routes';
import { resetTokenCache } from '../server/asset/google';
import { readAssetSheet, resetSheetCache } from '../server/asset/sheet';
import { setAssetPriceSourceForTest } from '../server/asset/summary';
import { cycleBuysOf, holdingOf, withCycleBuys, type CycleTrade } from '../server/asset/savingPlan';
import { setPurchaseClockForTest } from '../server/asset/purchase';
import { clearPlanLinksForTest, clearPurchasesForTest } from '../server/asset/store';
import { tradesForChange } from '../server/asset/trade';
import { chasuDiff, chasuLabel, type Chasu } from './lib/chasuRange';
import { createBrowserStepGuard } from './lib/browserStepGuard';
import { SAVING_SECRET, savingTabBook } from './fixtures/asset/savingTabBook';
import { CASH_SAMPLE_KIWOOM, assetHistorySample, assetSheetSample, assetStatusSample, assetSummarySample, cashViewSample, planSheetSample } from './fixtures/asset/screenSample';
import { PLAN_BUY_TIP } from '../src/components/asset/assetPlanBuy';
import type { AssetSheetData, AssetSummary, MonthlyPlan, MonthlyPlanRow } from '../src/types/asset';

const root = path.resolve(import.meta.dirname, '..');
/** 화면을 그리는 코드 — 보통 이 저장소 · 정답 파일을 만들 때만 기준 커밋 worktree */
const webRoot = process.env.CAPTURE_ROOT ? path.resolve(process.env.CAPTURE_ROOT) : root;
const FIXTURE = path.join(root, 'scripts/fixtures/asset/tradeDialogBefore.json');
const BASE = 'ba656c6';
const guard = createBrowserStepGuard();
let pass = 0;
let fail = 0;
const printed: string[] = [];
function say(line: string) {
  printed.push(line);
  console.log(line);
}
function check(name: string, ok: boolean, detail = '') {
  guard.mark(name);
  if (ok) pass++;
  else fail++;
  say(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? ` — ${detail}` : ''}`);
}
const warned: string[] = [];
const realWarn = console.warn;
console.warn = (...a: unknown[]) => {
  warned.push(a.map(String).join(' '));
  realWarn(...a);
};

// ═══════════════ 서버(정답 파일을 만들 때는 건너뜀) ═══════════════
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-planbuy-'));
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const keyFile = path.join(tmp, 'sa.json');
fs.writeFileSync(keyFile, JSON.stringify({ client_email: 'selftest@example.invalid', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }));
process.env.ASSET_SHEET_ID = 'selftest-planbuy-sheet';
process.env.GOOGLE_SA_KEY_FILE = keyFile;
process.env.ASSET_SYNC_ENABLED = 'false';

// 가짜 시트(152차 시험과 같은 줄 모양 · 만든 값)
type Cell = string | number;
type Model = { values: Record<string, Cell>; formulas: Record<string, Cell> };
const H = '주식 투자 정리';
const T = '티커';
const S = '적립식 투자';
const SECTIONS: [string, number, number][] = [['개별 투자 ( 2026.07 )', 5, 9], ['적립식 계좌 ( 2026.07 )', 13, 18], ['ISA 계좌 ( 2026.07 )', 22, 26], ['연금 저축 계좌 ( 2026.07 )', 30, 32]];
const TICKER_ROWS = [14, 15, 16, 17, 18, 19, 20, 21, 24, 25, 27, 28, 29, 30, 33, 34, 35, 36, 37, 40, 41, 42];
const codeOf = (t: number) => (t === 5 ? 'NASDAQ:FAKU' : `9${String(t).padStart(5, '0')}`);
const symOf = (t: number) => (t === 5 ? 'FAKU' : codeOf(t));
function model(change?: (v: Record<string, Cell>, f: Record<string, Cell>) => void): Model {
  const v: Record<string, Cell> = {
    [`${T}!B12`]: '구분', [`${T}!D12`]: '자산 분류', [`${T}!G9`]: 1300,
    [`${T}!B13`]: '개별 투자', [`${T}!B23`]: '적립식 투자', [`${T}!B32`]: 'ISA 계좌', [`${T}!B39`]: '연금 저축 계좌',
    '자산 투자 비율 관리!B18': '자산 배분 비율', '월 고정지출!B5': '현재 월 급여', '월 고정지출!C5': 5_000_000, '현금!B4': '은행 자산', '현금!B25': '은행 자산 총액', '현금!C25': 1_000_000, '현금!B28': '퇴직 연금', '현금!B30': '퇴직 연금 총액',
    '자산 투자 비율 관리!C18': 0.1, '자산 투자 비율 관리!D18': 0.05, '자산 투자 비율 관리!E18': 0.15, '자산 투자 비율 관리!F18': 0.7, '자산 투자 비율 관리!G23': 0.7, '자산 투자 비율 관리!G24': 0.3,
    [`${H}!B3`]: '내 계좌 정보', [`${H}!B38`]: '내 계좌 정보',
  };
  TICKER_ROWS.forEach((row, i) => {
    v[`${T}!B${row}`] = `가짜종목${i}`;
    v[`${T}!C${row}`] = codeOf(i);
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
      f[`${H}!F${row}`] = `=D${row}*'티커'!$F$${TICKER_ROWS[t]}`;
      if (t === 5) f[`${H}!C${row}`] = `=(12.5)*('티커'!$G$9)`;
    }
  }
  for (let row = 39; row <= 44; row++) {
    v[`${H}!B${row}`] = `가짜합친${row}`;
    v[`${H}!C${row}`] = 500;
    v[`${H}!D${row}`] = 2;
    f[`${H}!F${row}`] = `=D${row}*'티커'!$F$14`;
  }
  change?.(v, f);
  return { values: v, formulas: { ...v, ...f } };
}
let sheet = model();
const g = { writes: 0 };
let realGoogle = 0;
const colNum = (c: string) => c.charCodeAt(0) - 64;
const colChr = (n: number) => String.fromCharCode(64 + n);
function cut(m: Record<string, Cell>, tab: string, range: string): Cell[][] {
  const r = range.match(/^([A-Z])(\d+)(?::([A-Z])(\d+)?)?$/);
  if (!r) throw new Error('범위 모양');
  const [c1, r1] = [colNum(r[1]), Number(r[2])];
  const last = Math.max(r1, ...Object.keys(m).filter((k) => k.startsWith(`${tab}!`)).map((k) => Number(/(\d+)$/.exec(k)?.[1] ?? 0)));
  const [c2, r2] = r[3] ? [colNum(r[3]), r[4] ? Math.min(Number(r[4]), last) : last] : [c1, r1];
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
const saving = savingTabBook();
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!/googleapis\.com/.test(url)) {
    if (/google/.test(url)) realGoogle++;
    return realFetch(input, init);
  }
  if (url.startsWith('https://oauth2.googleapis.com/token')) return new Response(JSON.stringify({ access_token: 'fake', expires_in: 3600 }), { status: 200 });
  if ((init?.method ?? 'GET') !== 'GET') {
    g.writes++;
    return new Response('{}', { status: 200 });
  }
  if (!url.includes('/values:batchGet')) return new Response(JSON.stringify({ sheets: [] }), { status: 200 });
  const params = new URL(url).searchParams;
  const formula = params.get('valueRenderOption') === 'FORMULA';
  const valueRanges: { range: string; values: Cell[][] }[] = [];
  for (const raw of params.getAll('ranges')) {
    const m = raw.match(/^'((?:[^']|'')+)'!(.+)$/);
    if (!m) throw new Error('범위 모양');
    const tab = m[1].replace(/''/g, "'");
    if (tab === S) {
      const book = Object.fromEntries(Object.entries(formula ? saving.formulas : saving.values).map(([k, x]) => [`${S}!${k}`, x]));
      valueRanges.push({ range: raw, values: cut(book, S, m[2]) });
      continue;
    }
    valueRanges.push({ range: raw, values: cut(formula ? sheet.formulas : sheet.values, tab, m[2]) });
  }
  return new Response(JSON.stringify({ valueRanges }), { status: 200 });
}) as typeof fetch;
setAssetPriceSourceForTest(async (data) => {
  const prices = new Map<string, number>();
  for (const s of data.sections) for (const h of s.holdings) if (h.symbol) prices.set(h.symbol, h.market === 'US' ? 40 : 50_000);
  return { prices, usdKrw: 1400 };
});
function fresh(change?: (v: Record<string, Cell>, f: Record<string, Cell>) => void) {
  sheet = model(change);
  resetSheetCache();
  resetTokenCache();
}

const PEN = '연금 저축 계좌';
const N = SAVING_SECRET.names;
/** 연금 저축 첫 보유 줄(30행 · 「티커」 TICKER_ROWS[16]) — 152차 시험과 같은 잇기 */
const PEN_SYM = symOf(16);
const insertedIds: number[] = [];
if (!process.env.CAPTURE_ROOT) {
  const app = express();
  app.use(express.json());
  app.use(authGuard);
  app.use(assetRouter);
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((ok) => srv.once('listening', ok));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  await setAssetPassword(`selftest-asset-${crypto.randomBytes(4).toString('hex')}`);
  const token = createSession('selftest-planbuy');
  unlockSession(token);
  const ck = { cookie: `as_session=${encodeURIComponent(token)}` };
  const summary = async () => {
    const r = await fetch(`${base}/api/asset/summary?pension=0`, { headers: ck });
    const body = (await r.json()) as AssetSummary & { kind?: string; error?: string };
    if (r.status !== 200) throw new Error(`summary ${r.status} ${body.kind ?? ''} ${(body.error ?? '').replace(/[\d,]{4,}/g, '…')}`);
    return body;
  };
  const link = (section: string, name: string, symbol: string | null) =>
    fetch(`${base}/api/asset/purchase/plan-link`, { method: 'PUT', headers: { ...ck, 'content-type': 'application/json' }, body: JSON.stringify({ section, name, symbol }) });
  const penRow = (s: AssetSummary) => (s.monthlyBuy.accounts.find((a) => a.section === PEN)?.plan as MonthlyPlan | null)?.rows.find((r) => r.name === N[0][0]) ?? null;
  const addTrade = (at: string, section: string, symbol: string, side: 'buy' | 'sell', qty: number) => {
    const r = getDb()
      .prepare(`INSERT INTO asset_trades (at, section, holding_row, symbol, name, side, qty, price, currency, before_qty, before_avg, after_qty, after_avg) VALUES (?, ?, 30, ?, 'selftest', ?, ?, 1, 'KRW', 1, 1, 1, 1)`)
      .run(at, section, symbol, side, qty);
    insertedIds.push(Number(r.lastInsertRowid));
  };

  setPurchaseClockForTest(() => Date.parse('2026-11-27T03:00:00Z'), () => ({ isClosed: () => false, isChecked: () => true }));
  clearPurchasesForTest({ keepMigrated: true });
  clearPlanLinksForTest();
  try {
    // ── 4 — 이번 차례 입력(순수) ──
    const T0: CycleTrade[] = [
      { at: '2026-11-27T01:00:00.000Z', section: 'A', symbol: 'X', side: 'buy', qty: 2 }, // 한국 11-27 10:00
      { at: '2026-11-26T16:00:00.000Z', section: 'A', symbol: 'X', side: 'buy', qty: 3 }, // 한국 11-27 01:00 — 한국 날짜로 셈
      { at: '2026-11-26T14:00:00.000Z', section: 'A', symbol: 'X', side: 'buy', qty: 5 }, // 한국 11-26 23:00 — 지난 차례
      { at: '2026-11-27T02:00:00.000Z', section: 'A', symbol: 'X', side: 'sell', qty: 1 }, // 매도
      { at: '2026-11-27T02:00:00.000Z', section: 'B', symbol: 'X', side: 'buy', qty: 7 }, // 다른 계좌
    ];
    const m0 = cycleBuysOf(T0, '2026-11-27');
    const plan0 = { rows: [{ symbol: 'X' }, { symbol: 'Y' }, { symbol: null }] } as unknown as MonthlyPlan;
    const w0 = withCycleBuys(plan0, 'A', m0).rows.map((r) => r.boughtThisCycle);
    check('[153-4] 이번 차례 입력(순수) — 같은 계좌 · 같은 종목 · 매수 · 이번 차례 구매일(한국 날짜) 이후만 합(2 + 3) · 매도 · 다른 계좌 · 지난 차례는 안 셈 · 입력 없는 종목 0 · 잇지 않은 줄 null',
      JSON.stringify(w0) === JSON.stringify([5, 0, null]), JSON.stringify(w0));
    check('[153-4] 다음 차례 구매일이 오면 0 부터(같은 기록 · 다음 구매일 기준)', withCycleBuys(plan0, 'A', cycleBuysOf(T0, '2026-12-24')).rows[0].boughtThisCycle === 0);

    // ── 4 — summary(사본 DB 기록 · 시험 시계) ──
    fresh();
    tradesForChange(); // 표 만들기(선택 기능 표)
    const ok = await link(PEN, N[0][0], PEN_SYM);
    const s0 = await summary();
    const r0 = penRow(s0);
    check('[153-B] 이은 줄 — holdingRow = 그 계좌 보유 줄(30) · 까닭 없음 · 입력 없으면 boughtThisCycle 0 · 잇지 않은 줄은 셋 다 null',
      ok.status === 200 && r0 != null && r0.holdingRow === 30 && r0.holdingProblem == null && r0.boughtThisCycle === 0 &&
        ((s0.monthlyBuy.accounts.find((a) => a.section === PEN)?.plan as MonthlyPlan).rows.filter((r) => r.symbol == null).every((r) => r.holdingRow == null && r.holdingProblem == null && r.boughtThisCycle == null)),
      JSON.stringify({ status: ok.status, row: r0?.holdingRow, p: r0?.holdingProblem, b: r0?.boughtThisCycle }));
    addTrade('2026-11-27T01:00:00.000Z', PEN, PEN_SYM, 'buy', 2);
    addTrade('2026-11-26T16:00:00.000Z', PEN, PEN_SYM, 'buy', 3);
    addTrade('2026-11-26T14:00:00.000Z', PEN, PEN_SYM, 'buy', 5);
    addTrade('2026-11-27T02:00:00.000Z', PEN, PEN_SYM, 'sell', 1);
    addTrade('2026-11-27T02:00:00.000Z', 'ISA 계좌', PEN_SYM, 'buy', 7);
    resetSheetCache();
    const s1 = await summary();
    check('[153-4] summary — 두 번 입력하면 합(2 + 3 = 5) · 다른 계좌 · 매도 · 지난 차례 기록은 안 셈', penRow(s1)?.boughtThisCycle === 5, String(penRow(s1)?.boughtThisCycle));
    check('[153-7] 매수 기록이 있어도 [구매 완료] 는 저절로 되지 않음(연금 저축 이번 차례 그대로 「아직」)', s1.monthlyBuy.accounts.find((a) => a.section === PEN)?.status === 'todo');
    setPurchaseClockForTest(() => Date.parse('2027-01-05T03:00:00Z'), () => ({ isClosed: () => false, isChecked: () => true }));
    resetSheetCache();
    const s2 = await summary();
    check('[153-4] 다음 차례(시험 시계 2027-01-05)로 넘어가면 0', penRow(s2)?.boughtThisCycle === 0 && s2.monthlyBuy.cycleDay > '2026-11-27', `${penRow(s2)?.boughtThisCycle}`);
    setPurchaseClockForTest(() => Date.parse('2026-11-27T03:00:00Z'), () => ({ isClosed: () => false, isChecked: () => true }));

    // ── 5 — 같은 코드 두 줄 · 입력 못 받는 줄 ──
    fresh((_v, f) => {
      f[`${H}!F31`] = `=D31*'티커'!$F$${TICKER_ROWS[16]}`; // 31행도 30행과 같은 종목
    });
    const s5 = await summary();
    check('[153-5] 그 계좌에 같은 코드 보유 줄 둘 → holdingRow null · 까닭 many', penRow(s5)?.holdingRow == null && penRow(s5)?.holdingProblem === 'many', JSON.stringify({ row: penRow(s5)?.holdingRow, p: penRow(s5)?.holdingProblem }));
    fresh((v) => {
      v[`${H}!D30`] = ''; // 수량 칸 빈칸 → 입력을 받지 않는 줄
    });
    const s5b = await summary();
    check('[153-5] 한 줄인데 입력을 받지 않는 줄(수량 칸 빈칸) → holdingRow null · 까닭 not-tradable', penRow(s5b)?.holdingRow == null && penRow(s5b)?.holdingProblem === 'not-tradable');
    fresh();
    const data = await readAssetSheet();
    check('[153-A3] 보유 줄 찾기 한 곳(holdingOf) — 하나 = 줄 번호 · 없는 종목 = not-tradable', holdingOf(data, PEN, PEN_SYM).holdingRow === 30 && holdingOf(data, PEN, 'NOPE').holdingProblem === 'not-tradable');
    check('[153-B] 이 시험 서버 절에서 가짜 구글 쓰기 0번', g.writes === 0, String(g.writes));
  } catch (e) {
    fail++;
    say(`FAIL  서버 시험 중 오류 — ${(e as Error).message}`);
  } finally {
    if (insertedIds.length) getDb().prepare(`DELETE FROM asset_trades WHERE id IN (${insertedIds.map(() => '?').join(',')})`).run(...insertedIds);
    setPurchaseClockForTest(null);
    setAssetPriceSourceForTest(null);
    clearPlanLinksForTest();
    clearPurchasesForTest({ keepMigrated: true });
    srv.close();
  }

  // ── 12 — 바뀐 파일(ba656c6 → 지금) ──
  const CHASU: Chasu = { base: BASE, version: 'v2.80.0' };
  const trading = chasuDiff(root, CHASU, ['--name-only'], ['server/autoTrading', 'server/buyJudge', 'server/rules', 'server/paperTradingService.ts', 'server/paperPerformanceService.ts', 'server/paperSnapshotScheduler.ts', 'server/aiCheck', 'server/marketBrief', 'server/usHalts', 'server/quoteService.ts', 'server/heatmapSession.ts', 'server/marketCalendar.ts', 'server/auth.ts', 'server/authGuard.ts', 'src/services', 'python']);
  check(`[153-12] 매매 · 시황 · 주문 · 자동매매 · 로그인 코드 바뀐 파일 0(${chasuLabel(root, CHASU)})`, trading.status === 0 && trading.stdout.trim() === '', trading.stdout.trim() || trading.stderr.trim());
  const writes = chasuDiff(root, CHASU, ['--name-only'], ['server/asset/trade.ts', 'server/asset/cashMoves.ts', 'server/asset/google.ts', 'server/asset/rowOps.ts']);
  check('[153-12] server/asset/trade.ts(쓰기 함수) · cashMoves.ts(applyCashMove) · google.ts · rowOps.ts 바뀐 줄 0 — 시트 쓰기 경로를 새로 만들지 않음', writes.status === 0 && writes.stdout.trim() === '', writes.stdout.trim());
  const planSrc = fs.readFileSync(path.join(root, 'server/asset/savingPlan.ts'), 'utf8');
  check('[153-12] savingPlan.ts 에 시트 쓰기 함수(valuesWrite · structureWrite) 0', !/valuesWrite|structureWrite/.test(planSrc));
  const show = (f: string) => spawnSync('git', ['show', `${BASE}:${f}`], { cwd: root, encoding: 'utf8' }).stdout;
  const sendTradeOf = (src: string) => src.split('const sendTrade = async')[1]?.split('\n  };\n')[0] ?? '';
  const dash = fs.readFileSync(path.join(root, 'src/components/asset/AssetDashboard.tsx'), 'utf8');
  check('[153-3] 저장은 지금 [매수] 와 같은 함수(sendTrade — 바뀐 줄 0) · 매수 창을 여는 곳은 openTrade 한 곳(setTrade({ 는 그 안 하나)',
    sendTradeOf(show('src/components/asset/AssetDashboard.tsx')).length > 50 && sendTradeOf(show('src/components/asset/AssetDashboard.tsx')) === sendTradeOf(dash) && (dash.match(/setTrade\(\{/g) ?? []).length === 1);
}

// ═══════════════ 화면 ═══════════════
const PORT = 5201;
const WEB = `http://127.0.0.1:${PORT}`;
type Size = { width: number; height: number };
interface Seen {
  trades: Record<string, unknown>[];
  purchase: string[];
  settingsOpened: number;
}
interface Opts {
  summary: () => AssetSummary;
  sheet?: () => AssetSheetData;
  tab?: 'status' | 'rebalance';
  touch?: boolean;
}
async function openAsset(browser: Browser, size: Size, o: Opts): Promise<{ page: Page; ctx: BrowserContext; errors: string[]; seen: Seen; cdp: CDPSession | null }> {
  const touch = o.touch ?? size.width < 1280;
  const ctx = await browser.newContext({ viewport: size, ...(touch ? { isMobile: true, hasTouch: true } : {}) });
  await ctx.addInitScript('window.__name = (f) => f');
  await ctx.addInitScript((tab) => {
    try {
      localStorage.setItem('alphascope.asset.tab', tab);
    } catch {
      /* 없어도 됨 */
    }
  }, o.tab ?? 'rebalance');
  const page = await ctx.newPage();
  const errors: string[] = [];
  const seen: Seen = { trades: [], purchase: [], settingsOpened: 0 };
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)));
  await page.route(/\/api\/(?!asset\/)/, (r) => {
    const url = r.request().url();
    if (url.includes('/api/auth/me')) return r.fulfill({ json: { ok: true } });
    // 관심 목록 · 홈 화면 설정 — 실패하면 알림(토스트)이 떠 폰에서 창의 × 를 덮는다(시험 환경만)
    if (url.includes('/api/settings/home-page')) return r.fulfill({ json: { homePage: 'asset' } });
    if (url.includes('/api/user-data/watchlist')) return r.fulfill({ json: { folders: [{ id: 'default', name: '미분류', collapsed: false, symbols: [] }], recent: [], revision: 1, updatedAt: '2026-11-25T00:00:00.000Z' } });
    return r.fulfill({ status: 503, json: { error: '시험 — 없음' } });
  });
  await page.route('**/api/asset/status', (r) => r.fulfill({ json: assetStatusSample(true) }));
  await page.route('**/api/asset/touch', (r) => r.fulfill({ json: { ok: true, lockMinutes: 30, remainingMs: 30 * 60_000 } }));
  await page.route('**/api/asset/sheet', (r) => r.fulfill({ json: (o.sheet ?? planSheetSample)() }));
  await page.route('**/api/asset/history**', (r) => r.fulfill({ json: assetHistorySample(5) }));
  await page.route('**/api/asset/cash', (r) => r.fulfill({ json: cashViewSample() }));
  await page.route('**/api/asset/cash/pair**', (r) => r.fulfill({ json: { enabled: true, pair: { key: CASH_SAMPLE_KIWOOM, label: CASH_SAMPLE_KIWOOM.name }, usdKrw: 1380.5, balance: 900_000_000 } }));
  await page.route('**/api/asset/summary**', (r) => r.fulfill({ json: o.summary() }).catch(() => {}));
  await page.route('**/api/asset/trade', (r) => {
    seen.trades.push(JSON.parse(r.request().postData() ?? '{}') as Record<string, unknown>);
    return r.fulfill({ json: { id: 1, cash: { status: 'applied', message: null } } });
  });
  await page.route('**/api/asset/purchase/**', (r) => {
    seen.purchase.push(r.request().url().replace(/^.*\/api\//, '/api/'));
    return r.fulfill({ json: JSON.parse(r.request().postData() || '{}') });
  });
  await guard.step(`페이지 열기(${size.width}×${size.height})`, () => page.goto(`${WEB}/#/asset`));
  const cdp = touch ? await ctx.newCDPSession(page) : null;
  return { page, ctx, errors, seen, cdp };
}

/** 살 종목 가짜 summary(152차 'mixed' — 적립식 = 국내 이음 0072R0 · 미국 이음 DDDD · 안 이음 / ISA = 가격 없는 CCCC · 국내 000002) */
function planSummary(o: { writeEnabled?: boolean; popup?: boolean; mutate?: (rows: (section: string, symbol: string) => MonthlyPlanRow) => void } = {}): AssetSummary {
  const s = assetSummarySample({ ...(o.popup ? { purchaseDone: false } : { purchase: 'mixed' }), plan: 'mixed', writeEnabled: o.writeEnabled ?? true });
  const rowOf = (section: string, symbol: string) => {
    const r = s.monthlyBuy.accounts.find((a) => a.section === section)?.plan?.rows.find((x) => x.symbol === symbol);
    if (!r) throw new Error('가짜 줄 없음');
    return r;
  };
  o.mutate?.(rowOf);
  return s;
}
const SAV = '적립식 계좌';
const ISA = 'ISA 계좌';
const planSec = (page: Page, section: string) => page.locator(`#as-asset-monthly-buy [data-testid="plan"][data-section="${section}"]`);
const tradeDlg = (page: Page) => page.getByRole('dialog', { name: '매수 입력' });
const numOf = (s: string) => s.replace(/,/g, '');
async function laterPopup(page: Page) {
  const dlg = page.getByRole('dialog', { name: '이번 달 구매일입니다' });
  await dlg.waitFor({ timeout: 15_000 }).catch(() => {});
  if (await dlg.count()) await dlg.getByRole('button', { name: '나중에' }).click();
  await planSec(page, SAV).getByTestId('plan-row').first().waitFor({ timeout: 10_000 });
}
/** 보이는 툴팁(자리를 잡아 보이게 된 것)의 글 */
const visibleTips = (page: Page) =>
  page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[role="tooltip"]')].filter((e) => getComputedStyle(e).visibility === 'visible').map((e) => e.textContent ?? ''));
async function touchAt(cdp: CDPSession, type: 'touchStart' | 'touchEnd', x: number, y: number) {
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
}
async function longPress(page: Page, cdp: CDPSession, x: number, y: number) {
  await touchAt(cdp, 'touchStart', x, y);
  await page.waitForTimeout(800);
  await touchAt(cdp, 'touchEnd', x, y);
  await page.waitForTimeout(300);
}
/** 누르는 칸 — 가운데에서 ±20 여덟 점이 그 요소(안)인가 · 바깥 칸(::after) 44 이상(147차 `mobiletouch:test` 와 같은 재기) */
const hitArea = (page: Page, sel: string) =>
  page.evaluate((s) => {
    const el = document.querySelector(s)!;
    const r = el.getBoundingClientRect();
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    const pts = [[-20, -20], [20, -20], [-20, 20], [20, 20], [0, -20], [0, 20], [-20, 0], [20, 0]];
    const miss = pts.filter(([dx, dy]) => {
      const e = document.elementFromPoint(cx + dx, cy + dy);
      return !(e && (e === el || el.contains(e)));
    });
    const after = getComputedStyle(el, '::after');
    const w = Math.max(r.width, parseFloat(after.width) || 0);
    const h = Math.max(r.height, parseFloat(after.height) || 0);
    return { ok: miss.length === 0 && w >= 44 && h >= 44, miss: miss.length, w: Math.round(w), h: Math.round(h) };
  }, sel);

/** [153-6] 자산 현황 [매수] · [매도] 창(처음 값 없음) — 연 때 DOM · 넣은 뒤 미리 보기 · 저장 막힘 · 나갈 때 묻기 */
async function plainDialogShape(browser: Browser, size: Size, side: 'buy' | 'sell') {
  const { page, ctx } = await openAsset(browser, size, { summary: () => assetSummarySample({ purchaseDone: true }), sheet: assetSheetSample, tab: 'status' });
  const out: Record<string, unknown> = {};
  try {
    await page.locator(`[data-trade-${side}="6"]`).first().waitFor({ timeout: 20_000 });
    await page.locator(`[data-trade-${side}="6"]`).first().click();
    const dlg = page.getByRole('dialog', { name: side === 'buy' ? '매수 입력' : '매도 입력' });
    await dlg.waitFor({ timeout: 10_000 });
    await page.waitForTimeout(600);
    const html = () => dlg.evaluate((el) => el.outerHTML.replace(/:r[0-9a-z]+:/g, ':id:').replace(/\s?aria-describedby="[^"]*"/g, ''));
    out.open = await html();
    const esc = async () => {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
      const ask = page.getByRole('dialog', { name: '저장하지 않고 닫을까요?' });
      const shown = (await ask.count()) === 1;
      if (shown) await ask.getByRole('button', { name: '취소' }).click();
      await page.waitForTimeout(200);
      return shown;
    };
    out.askEmpty = await esc();
    // 닫혔으면 다시 연다(빈 창은 묻지 않고 닫힘)
    if ((await dlg.count()) === 0) {
      await page.locator(`[data-trade-${side}="6"]`).first().click();
      await dlg.waitFor({ timeout: 10_000 });
      await page.waitForTimeout(600);
    }
    await dlg.locator('[data-trade-qty]').fill('3');
    await dlg.locator('[data-trade-price]').fill('70000');
    await page.waitForTimeout(400);
    out.filled = await html();
    out.saveDisabled = await dlg.locator('[data-trade-save]').isDisabled();
    out.askFilled = await esc();
  } finally {
    await ctx.close();
  }
  return out;
}
/** [153-11] 1280 마우스 · 키보드 — 툴팁이 뜨는가(구매일 팝업 × · 마우스 올림 · Tab 초점) */
async function deskTips(browser: Browser) {
  const out: Record<string, unknown> = {};
  const { page, ctx } = await openAsset(browser, { width: 1280, height: 1080 }, { summary: () => assetSummarySample({ purchaseDone: false }), sheet: assetSheetSample });
  try {
    const dlg = page.getByRole('dialog', { name: '이번 달 구매일입니다' });
    await dlg.waitFor({ timeout: 15_000 });
    await page.waitForTimeout(800);
    out.popupAuto = await visibleTips(page);
    await page.mouse.move(5, 5);
    await page.waitForTimeout(400);
    await dlg.getByRole('button', { name: '닫기', exact: true }).hover();
    await page.waitForTimeout(700);
    out.hover = await visibleTips(page);
    await page.mouse.move(5, 5);
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(400);
    out.keyboard = await page.evaluate(() => (document.activeElement?.getAttribute('aria-label') ?? '') + '|' + (document.activeElement?.getAttribute('data-tip') ?? ''));
    out.keyboardTips = await visibleTips(page);
  } finally {
    await ctx.close();
  }
  return out;
}
async function baseShapes(browser: Browser) {
  const shapes: Record<string, unknown> = {};
  for (const size of [{ width: 1280, height: 1080 }, { width: 402, height: 874 }]) {
    for (const side of ['buy', 'sell'] as const) shapes[`${size.width} ${side}`] = await plainDialogShape(browser, size, side);
  }
  shapes['1280 tips'] = await deskTips(browser);
  return shapes;
}

const { createServer } = await import('vite');
const vite = await guard.step('Vite 띄우기', async () => {
  const v = await createServer({ root: webRoot, configFile: path.join(webRoot, 'vite.config.ts'), logLevel: 'error', server: { host: '127.0.0.1', port: PORT, strictPort: true, hmr: false } });
  await v.listen();
  return v;
});
const browser = await guard.step('브라우저 띄우기', () => chromium.launch({ channel: 'chrome' }));
try {
  if (process.env.CAPTURE_ROOT) {
    fs.writeFileSync(FIXTURE, `${JSON.stringify(await baseShapes(browser), null, 1)}\n`);
    say(`정답 파일 저장 — ${path.relative(root, FIXTURE)}`);
  } else {
    // ── 1 · 2 · 3 · 4 · 7 — 1280: [매수 입력] → 채운 매수 창 → 저장 → 지금 [매수] 와 같은 요청 ──
    {
      let bought = 0;
      const summary = () =>
        planSummary({
          mutate: (rowOf) => {
            rowOf(SAV, '0072R0').boughtThisCycle = bought;
            rowOf(ISA, '000002').shares = 0;
          },
        });
      const { page, ctx, errors, seen } = await openAsset(browser, { width: 1280, height: 1080 }, { summary, sheet: planSheetSample });
      await laterPopup(page);
      const s = summary();
      const kr = s.monthlyBuy.accounts.find((a) => a.section === SAV)!.plan!.rows.find((r) => r.symbol === '0072R0')!;
      const us = s.monthlyBuy.accounts.find((a) => a.section === SAV)!.plan!.rows.find((r) => r.symbol === 'DDDD')!;
      const sav = planSec(page, SAV);
      check('[153-5] 잇지 않은 줄에는 [매수 입력] 없음(적립식 3줄 · 단추 2)', (await sav.getByTestId('plan-row').count()) === 3 && (await sav.getByTestId('plan-buy').count()) === 2);
      check('[153-4] 이번 차례 입력 0 이면 「이번 차례 입력」 글 없음', (await page.getByTestId('plan-bought').count()) === 0);
      await sav.getByRole('button', { name: `${kr.stockName} 매수 입력` }).click();
      const dlg = tradeDlg(page);
      await dlg.waitFor({ timeout: 10_000 });
      await page.waitForTimeout(500);
      const qty = numOf(await dlg.locator('[data-trade-qty]').inputValue());
      const price = numOf(await dlg.locator('[data-trade-price]').inputValue());
      const note = (await dlg.locator('[data-trade-plan-note]').innerText()).trim();
      const acct = await dlg.innerText();
      check('[153-1] 국내 이은 줄 [매수 입력] → 매수 창이 그 계좌 · 그 종목으로 열림 · 수량 = 살 주 · 가격 = 지금 가격(원)',
        acct.includes('적립식 계좌 ( 2026.07 )') && (await dlg.locator('[data-trade-symbol]').innerText()) === '0072R0' && qty === String(kr.shares) && price === String(kr.price), `${qty === String(kr.shares)}/${price === String(kr.price)}`);
      check('[153-1] 창 머리 아래 「이번 달 구매(○ 차례) — 계획 N주 · ₩…」', /^이번 달 구매\(\d{4}-\d{2}-\d{2}\(.\) 차례\) — 계획 [\d,.]+주 · ₩[\d,]+$/.test(note) && note.includes(`${kr.shares}주`), String(note.length));
      // 고쳐서 저장
      await dlg.locator('[data-trade-qty]').fill('7');
      await dlg.locator('[data-trade-price]').fill('16000');
      await page.waitForTimeout(500);
      bought = 7;
      await dlg.locator('[data-trade-save]').click();
      await dlg.waitFor({ state: 'detached', timeout: 10_000 });
      await sav.getByTestId('plan-bought').first().waitFor({ timeout: 10_000 });
      const boughtText = (await sav.getByTestId('plan-bought').first().innerText()).trim();
      check('[153-4] 저장 뒤 창이 닫히고 다시 읽음 → 그 줄 「이번 차례 입력: 7주」', boughtText === '이번 차례 입력: 7주', boughtText);
      check('[153-7] 저장해도 [구매 완료] 요청 없음(purchase 주소 0)', seen.purchase.length === 0, seen.purchase.join(','));
      // 미국 줄 — 가격 $ · ISA 가격 없음 · 살 주 0 → 빈칸
      await sav.getByRole('button', { name: `${us.stockName} 매수 입력` }).click();
      await dlg.waitFor({ timeout: 10_000 });
      const usPrice = numOf(await dlg.locator('[data-trade-price]').inputValue());
      const usQty = numOf(await dlg.locator('[data-trade-qty]').inputValue());
      check('[153-1] 미국 이은 줄 — 가격 = 지금 가격($ · 입력 자릿수) · 수량 = 살 주', usPrice === String(us.price) && usQty === (us.shares ? String(us.shares) : ''), `${usPrice === String(us.price)}/${usQty}`);
      await dlg.getByRole('button', { name: '닫기', exact: true }).click();
      await dlg.waitFor({ state: 'detached', timeout: 5_000 });
      const isa = planSec(page, ISA);
      const isaQty: string[] = [];
      for (const name of ['예시 미국 반도체주', '예시 국내 금 ETF']) {
        await isa.getByRole('button', { name: `${name} 매수 입력` }).click();
        await dlg.waitFor({ timeout: 10_000 });
        isaQty.push(await dlg.locator('[data-trade-qty]').inputValue());
        await dlg.getByRole('button', { name: '닫기', exact: true }).click();
        await dlg.waitFor({ state: 'detached', timeout: 5_000 });
      }
      check('[153-2] 살 주가 「—」(가격 없음) · 0 → 수량 빈칸', isaQty.join('|') === '|', JSON.stringify(isaQty.map((x) => x.length)));
      // 같은 값을 자산 현황 [매수] 로 — 같은 요청
      await page.getByRole('tab', { name: '자산 현황' }).click();
      await page.locator('[data-trade-buy="13"]').first().waitFor({ timeout: 10_000 });
      await page.locator('[data-trade-buy="13"]').first().click();
      await dlg.waitFor({ timeout: 10_000 });
      await dlg.locator('[data-trade-qty]').fill('7');
      await dlg.locator('[data-trade-price]').fill('16000');
      await page.waitForTimeout(500);
      await dlg.locator('[data-trade-save]').click();
      await dlg.waitFor({ state: 'detached', timeout: 10_000 });
      const [a, b] = seen.trades;
      check('[153-3] [매수 입력] 저장 요청 = 자산 현황 [매수] 저장 요청(같은 주소 · 계좌 · 줄 · 수량 · 가격 · 확인 값 · 예수금 금액)',
        seen.trades.length === 2 && JSON.stringify(a) === JSON.stringify(b) && typeof a.cashAmount === 'number' && a.row === 13 && a.side === 'buy', `${seen.trades.length} · ${Object.keys(a ?? {}).join(',')}`);
      check('[153-1] 1280 페이지 오류 0', errors.length === 0, errors.join(' | '));
      await ctx.close();
    }

    // ── 5 — 같은 코드 두 줄(막힘 + 툴팁) · 쓰기 꺼짐 ──
    {
      const { page, ctx } = await openAsset(browser, { width: 1280, height: 1080 }, {
        summary: () =>
          planSummary({
            mutate: (rowOf) => {
              const r = rowOf(ISA, '000002');
              r.holdingRow = null;
              r.holdingProblem = 'many';
            },
          }),
      });
      await laterPopup(page);
      const btn = planSec(page, ISA).getByRole('button', { name: '예시 국내 금 ETF 매수 입력' });
      await btn.waitFor({ timeout: 10_000 });
      const disabled = await btn.isDisabled();
      const tip = await btn.getAttribute('data-tip');
      // 먼저 보이게 밀고(스크롤은 툴팁을 닫는다) 잠시 뒤 마우스를 올린다
      await btn.scrollIntoViewIfNeeded();
      await page.waitForTimeout(400);
      const bb = (await btn.boundingBox())!;
      await page.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
      await page.waitForTimeout(700);
      const tips = await visibleTips(page);
      const okOther = !(await planSec(page, SAV).getByTestId('plan-buy').first().isDisabled());
      check('[153-5] 같은 코드 두 줄 → [매수 입력] 막힘 + 툴팁 「이 계좌에 같은 종목이 두 줄 — 자산 현황에서 줄을 골라 입력」(마우스 올리면 보임) · 다른 줄은 그대로',
        disabled && tip === PLAN_BUY_TIP.many && tips.includes(PLAN_BUY_TIP.many) && okOther, JSON.stringify({ disabled, tip: tip === PLAN_BUY_TIP.many, tips: tips.length, okOther }));
      await ctx.close();
      const off = await openAsset(browser, { width: 1280, height: 1080 }, { summary: () => planSummary({ writeEnabled: false }) });
      await laterPopup(off.page);
      const all = off.page.locator('#as-asset-monthly-buy').getByTestId('plan-buy');
      const n = await all.count();
      const states = await all.evaluateAll((els) => els.map((e) => [(e as HTMLButtonElement).disabled, e.getAttribute('data-tip')]));
      check('[153-5] 쓰기 꺼진 서버 → [매수 입력] 모두 막힘 · 「이 서버에서는 시트 쓰기가 꺼져 있습니다」', n === 4 && states.every(([d, t]) => d === true && t === PLAN_BUY_TIP.writeOff), `${n}`);
      await off.ctx.close();
    }

    // ── 6 · 11 — 처음 값 없는 창 · 1280 툴팁이 기준 커밋과 같음 ──
    {
      const want = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) as Record<string, Record<string, unknown>>;
      const now = await baseShapes(browser);
      // 155차 — 창 DOM 의 class 는 색 이름만 빼고 견준다(앱 전체 색 규칙 · [저장] = 주 단추 · noColorClass)
      const noColor = (v: unknown) =>
        Object.fromEntries(Object.entries((v ?? {}) as Record<string, unknown>).map(([key, x]) => [key, typeof x === 'string' ? x.replace(/class="([^"]*)"/g, (_m, c: string) => `class="${noColorClass(c)}"`) : x]));
      // 158차(v2.83.0 · 테마 9-1 R8) — 폰 아래 판 머리는 제목 한 줄 · 옆 도움 글은 머리 아래 몸 맨 위. 402 정답은 그 옮김만 적용해 견준다(나머지는 바이트 그대로)
      const phoneHeadR8 = (v: unknown) =>
        Object.fromEntries(Object.entries((v ?? {}) as Record<string, unknown>).map(([key, x]) => [key, typeof x !== 'string' ? x : x.replace(
          /<h2 id=":id:" class="min-w-0 text-sm font-semibold text-text-primary">([^<]*)<\/h2><span class="min-w-0 text-caption text-text-muted">([^<]*)<\/span>(<div class="ml-auto flex shrink-0 items-center gap-2">[\s\S]*?<\/button><\/div><\/div>)/,
          (_m, t: string, aside: string, rest: string) => `<h2 id=":id:" class="min-w-0 truncate text-sm font-semibold text-text-primary" data-tip-clip="${t}">${t}</h2>${rest}<div data-dialog-aside="true" class="shrink-0 px-4 pt-3 text-caption text-text-secondary keep-all">${aside}</div>`,
        )]));
      for (const k of ['1280 buy', '1280 sell', '402 buy', '402 sell']) {
        const wantK = k.startsWith('402') ? phoneHeadR8(want[k]) : want[k];
        const same = JSON.stringify(noColor(now[k])) === JSON.stringify(noColor(wantK));
        const w = noColor(wantK);
        const n = noColor(now[k]);
        check(`[153-6] ${k} — 자산 현황 [${k.endsWith('buy') ? '매수' : '매도'}] 창(처음 값 없음)이 ${BASE} 와 같음(연 때 DOM · 넣은 뒤 DOM · 저장 막힘 · 나갈 때 묻기)`,
          same, ['open', 'filled', 'saveDisabled', 'askEmpty', 'askFilled'].filter((x) => JSON.stringify(n[x]) !== JSON.stringify(w[x])).join(','));
      }
      const t = now['1280 tips'] as Record<string, string[] | string>;
      check(`[153-11] 1280 마우스 올림 · 키보드 Tab 초점 · 창이 열릴 때 툴팁이 ${BASE} 와 같음(올림 · Tab 에 「닫기」 보임)`,
        JSON.stringify(t) === JSON.stringify(want['1280 tips']) && (t.hover as string[]).includes('닫기') && (t.keyboardTips as string[]).length === 1, JSON.stringify({ now: t, want: want['1280 tips'] }).replace(/₩[\d,]+/g, '₩…'));
    }

    // ── 9 — 1440: [매수 입력] 칸이 화면 안 ──
    {
      const { page, ctx } = await openAsset(browser, { width: 1440, height: 900 }, { summary: () => planSummary() });
      await laterPopup(page);
      const secBox = await page.locator('#as-asset-monthly-buy').boundingBox();
      const boxes = await page.locator('#as-asset-monthly-buy').getByTestId('plan-buy').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().right));
      const restR = await planSec(page, SAV).getByTestId('plan-rest').first().evaluate((e) => e.getBoundingClientRect().right);
      const btnL = await planSec(page, SAV).getByTestId('plan-buy').first().evaluate((e) => e.getBoundingClientRect().left);
      check('[153-9] 1440 — 살 종목 표 [매수 입력] 칸이 구역 · 화면 안(긴 이름에도 밀리지 않음) · 남는 돈 칸 오른쪽',
        secBox != null && boxes.length === 4 && boxes.every((r) => r <= secBox.x + secBox.width && r <= 1440) && btnL >= restR, JSON.stringify({ secBox, boxes, restR, btnL }));
      await ctx.close();
    }

    // ── 8 · 10 — 손가락 화면(402 · 1133) ──
    for (const size of [{ width: 402, height: 874 }, { width: 1133, height: 744 }]) {
      const w = size.width;
      const phone = w < 768;
      const { page, ctx, cdp, errors } = await openAsset(browser, size, { summary: () => planSummary({ popup: true }) });
      const coarse = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
      const pop = page.getByRole('dialog', { name: '이번 달 구매일입니다' });
      await pop.waitFor({ timeout: 15_000 });
      await page.waitForTimeout(900);
      const popTips = await visibleTips(page);
      const x = await pop.getByRole('button', { name: '닫기', exact: true }).boundingBox();
      await longPress(page, cdp!, x!.x + x!.width / 2, x!.y + x!.height / 2);
      const pressTips = await visibleTips(page);
      const stillOpen = (await pop.count()) === 1;
      check(`[153-10] ${w} 손가락 화면(pointer: coarse ${coarse}) — 구매일 팝업을 열면 툴팁 0개 · × 를 길게 누르면 「닫기」 보임(창은 그대로)`,
        coarse && popTips.length === 0 && pressTips.includes('닫기') && stillOpen, JSON.stringify({ popTips, pressTips, stillOpen }));
      await pop.getByRole('button', { name: '나중에' }).tap();
      await planSec(page, SAV).getByTestId('plan-row').first().waitFor({ timeout: 10_000 });
      // 매수 창
      const buy = planSec(page, SAV).getByTestId('plan-buy').first();
      await buy.scrollIntoViewIfNeeded();
      if (phone) {
        const hit = await hitArea(page, '#as-asset-monthly-buy [data-section="적립식 계좌"] [data-testid="plan-buy"]');
        check('[153-8] 402 폰 카드 [매수 입력] 누르는 칸 44 이상(가운데 ±20 이 그 단추)', hit.ok, JSON.stringify(hit));
      }
      await buy.tap();
      const dlg = tradeDlg(page);
      await dlg.waitFor({ timeout: 10_000 });
      await page.waitForTimeout(900);
      const tradeTips = await visibleTips(page);
      const settingsWhile = await page.getByRole('dialog', { name: '자산 관리 설정' }).count();
      await dlg.getByRole('button', { name: '닫기', exact: true }).tap();
      await dlg.waitFor({ state: 'detached', timeout: 5_000 });
      if (phone) {
        // 카드 누름(단추 밖) = 설정에서 잇기
        const card = planSec(page, SAV).locator('[data-card]').first();
        await card.locator('[data-testid="plan-amount"]').tap();
        const sd = page.getByRole('dialog', { name: '자산 관리 설정' });
        await sd.waitFor({ timeout: 5_000 });
        const tradeAfterCard = await tradeDlg(page).count();
        check('[153-8] 402 [매수 입력] 누르면 매수 창만(설정 창 안 열림) · 카드 몸(단추 밖)을 누르면 설정 창만', settingsWhile === 0 && tradeAfterCard === 0);
        await page.waitForTimeout(900);
        const setTips = await visibleTips(page);
        check(`[153-10] ${w} 매수 창 · 설정 창을 열면 툴팁 0개`, tradeTips.length === 0 && setTips.length === 0, JSON.stringify({ tradeTips, setTips }));
      } else {
        await page.locator('[data-asset-settings]').tap();
        const sd = page.getByRole('dialog', { name: '자산 관리 설정' });
        await sd.waitFor({ timeout: 5_000 });
        await page.waitForTimeout(900);
        const setTips = await visibleTips(page);
        check(`[153-10] ${w} 매수 창 · 설정 창을 열면 툴팁 0개`, settingsWhile === 0 && tradeTips.length === 0 && setTips.length === 0, JSON.stringify({ tradeTips, setTips }));
      }
      check(`[153-10] ${w} 페이지 오류 0`, errors.length === 0, errors.join(' | '));
      await ctx.close();
    }
  }
} catch (e) {
  fail++;
  say(`FAIL  화면 시험 중 오류 — ${(e as Error).message.split('\n')[0]}`);
} finally {
  await guard.step('브라우저 닫기', () => browser.close());
  await guard.step('Vite 닫기', () => vite.close());
}

check('[153] 실제 구글 호출 0', realGoogle === 0);
// ── 13 — 출력 · 로그에 가짜 금액 · 이름이 나오지 않음 ──
{
  const secrets = [...SAVING_SECRET.totals.flatMap((n) => [String(n), n.toLocaleString('ko-KR')]), ...SAVING_SECRET.names.flat(), '34,567,890', '23,456,789', 'KODEX 예시', '예시 국내 금 ETF', '예시 미국'];
  const text = [...printed, ...warned].join('\n');
  const hits = secrets.filter((x) => text.includes(x));
  check(`[153-13] 시험 출력 ${printed.length}줄 · 서버 경고 ${warned.length}줄에 가짜 금액 · 이름 0번(개수만)`, hits.length === 0 && !/₩[\d,]{4,}/.test(text), String(hits.length));
}
globalThis.fetch = realFetch;
console.warn = realWarn;
fs.rmSync(tmp, { recursive: true, force: true });
getDb().prepare(`DELETE FROM auth_sessions WHERE user_agent = ?`).run('selftest-planbuy');
console.log(`\n결과: ${pass}개 통과 / ${fail}개 실패`);
process.exit(fail ? 1 : 0);
