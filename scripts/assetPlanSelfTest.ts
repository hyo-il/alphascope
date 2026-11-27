/**
 * 이번 달 구매 — 계좌 · 종목별 목록(152차 · v2.79.0) — `npm run assetplan:test` · ⚠️ `DB_PATH=<사본>` 으로만 돈다(맨 첫 import).
 * 152차 「꼭 지킬 동작」 1 ~ 15 를 줄마다 확인한다(시험 이름 앞 [152-n]).
 * - 서버: 이 프로세스 안 Express(로그인 문지기 + 자산 라우터) · 가짜 구글(`fetch` 바꿔치기 — 만든 값 · 「적립식 투자」 탭은 `fixtures/asset/savingTabBook.ts`) ·
 *   가짜 가격(`setAssetPriceSourceForTest`) · 실제 구글 · 토스 호출 0.
 * - 화면: Vite(5187) + Playwright · `/api` 는 모두 `page.route` 가짜(만든 값) — 요소는 역할 + 이름 · `data-testid` 로 찾는다.
 * ⚠️ 출력에 가짜 금액 · 비율 · 줄 이름을 찍지 않는다(개수 · 맞음 / 아님만 — [152-15] 가 출력 전체를 다시 본다).
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
import { chromium, type Browser } from 'playwright';
import { getDb } from '../server/db';
import { createSession } from '../server/auth';
import { authGuard } from '../server/authGuard';
import { setAssetPassword, unlockSession } from '../server/asset/lock';
import { assetRouter } from '../server/asset/routes';
import { resetTokenCache } from '../server/asset/google';
import { readAssetSheet, resetSheetCache } from '../server/asset/sheet';
import { setAssetPriceSourceForTest, type PriceBook } from '../server/asset/summary';
import { computeSavingPlans, planOfGroup, readSavingTab, savingShapeOf, sharesOf } from '../server/asset/savingPlan';
import { setPurchaseClockForTest } from '../server/asset/purchase';
import { clearPlanLinksForTest, clearPurchasesForTest, planLinks } from '../server/asset/store';
import { savingTabLines, savingTabShape } from './assetCheckSheet';
import { chasuDiff, chasuLabel, type Chasu } from './lib/chasuRange';
import { createBrowserStepGuard } from './lib/browserStepGuard';
import { SAVING_SECRET, savingTabBook, setSavingCell, type SavingBook } from './fixtures/asset/savingTabBook';
import { assetHistorySample, assetSheetSample, assetStatusSample, assetSummarySample, cashViewSample } from './fixtures/asset/screenSample';
import type { AssetSummary, MonthlyPlan } from '../src/types/asset';

const root = path.resolve(import.meta.dirname, '..');
const guard = createBrowserStepGuard();
let pass = 0;
let fail = 0;
/** 이 시험이 찍은 줄 전부 · 서버 경고 — [152-15] 가 값이 없는지 본다 */
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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-plan-'));
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const keyFile = path.join(tmp, 'sa.json');
fs.writeFileSync(keyFile, JSON.stringify({ client_email: 'selftest@example.invalid', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }));
process.env.ASSET_SHEET_ID = 'selftest-plan-sheet';
process.env.GOOGLE_SA_KEY_FILE = keyFile;
process.env.ASSET_SYNC_ENABLED = 'false';

// ── 가짜 시트(151차 시험과 같은 줄 모양 · 만든 값) — 적립식 첫 종목만 미국(NASDAQ:FAKU) ──
type Cell = string | number;
type Model = { values: Record<string, Cell>; formulas: Record<string, Cell> };
const H = '주식 투자 정리';
const T = '티커';
const S = '적립식 투자';
const SECTIONS: [string, number, number][] = [['개별 투자 ( 2026.07 )', 5, 9], ['적립식 계좌 ( 2026.07 )', 13, 18], ['ISA 계좌 ( 2026.07 )', 22, 26], ['연금 저축 계좌 ( 2026.07 )', 30, 32]];
const TICKER_ROWS = [14, 15, 16, 17, 18, 19, 20, 21, 24, 25, 27, 28, 29, 30, 33, 34, 35, 36, 37, 40, 41, 42];
/** 보유 줄 t 의 코드 — 5 = 적립식 첫 종목(미국) */
const codeOf = (t: number) => (t === 5 ? 'NASDAQ:FAKU' : `9${String(t).padStart(5, '0')}`);
const symOf = (t: number) => (t === 5 ? 'FAKU' : codeOf(t));
function model(): Model {
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
  return { values: v, formulas: { ...v, ...f } };
}
let sheet = model();
/** 가짜 「적립식 투자」 탭 — null 이면 탭이 없음(구글 400) */
let saving: SavingBook | null = savingTabBook();
const g = { reads: 0, savingReads: 0, writes: 0, token: 0 };
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
  if ((init?.method ?? 'GET') !== 'GET') {
    g.writes++;
    return new Response('{}', { status: 200 });
  }
  if (!url.includes('/values:batchGet')) return new Response(JSON.stringify({ sheets: [] }), { status: 200 });
  const params = new URL(url).searchParams;
  const formula = params.get('valueRenderOption') === 'FORMULA';
  const ranges = params.getAll('ranges');
  const valueRanges: { range: string; values: Cell[][] }[] = [];
  for (const raw of ranges) {
    const m = raw.match(/^'((?:[^']|'')+)'!(.+)$/);
    if (!m) throw new Error('범위 모양');
    const tab = m[1].replace(/''/g, "'");
    if (tab === S) {
      g.savingReads++;
      if (!saving) return new Response(JSON.stringify({ error: { message: `Unable to parse range: '${S}'!${m[2]}` } }), { status: 400 });
      const book = Object.fromEntries(Object.entries(formula ? saving.formulas : saving.values).map(([k, x]) => [`${S}!${k}`, x]));
      valueRanges.push({ range: raw, values: cut(book, S, m[2]) });
      continue;
    }
    g.reads++;
    valueRanges.push({ range: raw, values: cut(formula ? sheet.formulas : sheet.values, tab, m[2]) });
  }
  return new Response(JSON.stringify({ valueRanges }), { status: 200 });
}) as typeof fetch;

// 가짜 가격 — 국내 50,000 · 미국 $40(환율 1,400) · `noPrice` 에 든 종목은 가격 없음
const noPrice = new Set<string>();
const PRICE_KR = 50_000;
const PRICE_US = 40;
const FX = 1400;
setAssetPriceSourceForTest(async (data) => {
  const prices = new Map<string, number>();
  for (const s of data.sections) for (const h of s.holdings) if (h.symbol && !noPrice.has(h.symbol)) prices.set(h.symbol, h.market === 'US' ? PRICE_US : PRICE_KR);
  return { prices, usdKrw: FX };
});

function fresh(change?: (b: SavingBook) => void, opts: { noTab?: boolean } = {}) {
  sheet = model();
  saving = opts.noTab ? null : savingTabBook(change);
  g.reads = g.savingReads = g.token = 0;
  resetSheetCache();
  resetTokenCache();
}

// ── 안쪽 서버(로그인 문지기 + 자산 라우터) ──
const app = express();
app.use(express.json());
app.use(authGuard);
app.use(assetRouter);
const srv = app.listen(0, '127.0.0.1');
await new Promise((ok) => srv.once('listening', ok));
const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
await setAssetPassword(`selftest-asset-${crypto.randomBytes(4).toString('hex')}`);
const token = createSession('selftest-plan');
unlockSession(token);
const ck = { cookie: `as_session=${encodeURIComponent(token)}` };
const summary = async () => {
  const r = await fetch(`${base}/api/asset/summary?pension=0`, { headers: ck });
  return { status: r.status, body: (await r.json()) as AssetSummary };
};
const link = async (section: string, name: string, symbol: string | null) => {
  const r = await fetch(`${base}/api/asset/purchase/plan-link`, { method: 'PUT', headers: { ...ck, 'content-type': 'application/json' }, body: JSON.stringify({ section, name, symbol }) });
  return { status: r.status, body: (await r.json()) as { kind?: string } };
};
const planOf = (s: AssetSummary, section: string) => s.monthlyBuy.accounts.find((a) => a.section === section)?.plan ?? null;
const N = SAVING_SECRET.names;
const KEYS = ['개별 투자', '적립식 계좌', 'ISA 계좌', '연금 저축 계좌'];

setPurchaseClockForTest(() => Date.parse('2026-11-27T03:00:00Z'), () => ({ isClosed: () => false, isChecked: () => true }));
clearPurchasesForTest({ keepMigrated: true });
clearPlanLinksForTest();
try {
  // ═══ 1 — 가짜 탭(원본과 같은 모양 · 묶음 4개) ═══
  fresh();
  const data = await readAssetSheet();
  const shape = savingShapeOf(await readSavingTab(), data);
  check('[152-1] 묶음 1 ~ 3 이 세 계좌(연금 저축 · ISA · 적립식)로 맞음 · 머리 3 · 10 · 20행',
    JSON.stringify(shape.groups.map((x) => [x.headRow, x.account])) === JSON.stringify([[3, '연금 저축 계좌'], [10, 'ISA 계좌'], [20, '적립식 계좌']]));
  check('[152-1] 묶음 4(28행)는 「모양이 달라 읽지 않은 묶음」 하나', JSON.stringify(shape.skipped) === JSON.stringify([{ row: 28, kind: 'shape' }]));
  check('[152-1] 줄 수 3 · 6 · 4(D 수식 = 합계 줄 앞에서 멈춤 · 옆 표 G ~ J 안 읽음)', shape.groups.map((x) => x.lines.length).join() === '3,6,4' && shape.groups.every((x) => x.problem == null));
  const s1 = await summary();
  const plans1 = Object.fromEntries(KEYS.map((k) => [k, planOf(s1.body, k)]));
  check('[152-1] summary — 계좌마다 plan(개별 투자는 묶음 없음 null) · 0% 줄은 목록에서 빠짐(3 · 5 · 3줄) · planError 없음',
    s1.status === 200 && plans1['개별 투자'] === null && plans1['연금 저축 계좌']?.rows.length === 3 && plans1['ISA 계좌']?.rows.length === 5 && plans1['적립식 계좌']?.rows.length === 3 &&
      s1.body.monthlyBuy.planError == null && s1.body.monthlyBuy.planSkipped?.length === 1,
    KEYS.map((k) => plans1[k]?.rows.length ?? 'null').join(','));

  // ═══ 2 — 한 달 금액 · 줄 금액 합 ═══
  const monthlyOk = shape.groups.every((gr) => {
    const p = plans1[gr.account as string] as MonthlyPlan;
    return p.monthly === Math.round((gr.total as number) / (gr.months as number)) && p.sum === p.monthly && p.rows.reduce((a, r) => a + r.amount, 0) === p.monthly;
  });
  check('[152-2] 한 달 금액 = 반올림(총 ÷ 개월) · 줄 금액 합 = 한 달 금액(세 계좌)', monthlyOk);
  const book0: PriceBook = { prices: new Map(), usdKrw: null };
  const diffPlan = planOfGroup({ headRow: 1, account: '연금 저축 계좌', total: 1003, months: 1, problem: null, lines: [{ row: 2, name: 'a', ratio: 0.55 }, { row: 3, name: 'b', ratio: 0.25 }, { row: 4, name: 'c', ratio: 0.2 }] }, data, book0, {});
  check('[152-2] 반올림 차이는 금액이 가장 큰 줄에(1003 × 55 · 25 · 20% → 552 · 251 · 201 = 1004 → 큰 줄 −1 → 551 · 251 · 201)',
    diffPlan.rows.map((r) => r.amount).join() === '551,251,201' && diffPlan.sum === 1003);

  // ═══ 3 — 비율 합이 100% 아님 → 그 계좌만 ═══
  fresh((b) => setSavingCell(b, 'D12', 0.45)); // ISA 첫 줄 50% → 45%
  const s3 = await summary();
  const isa3 = planOf(s3.body, 'ISA 계좌');
  check('[152-3] ISA 비율 합 95% → ISA 만 「ratio-sum」(목록 없음 · 한 달 금액은 있음) · 연금 · 적립식 목록 그대로',
    isa3?.problem === 'ratio-sum' && isa3.rows.length === 0 && isa3.monthly != null && planOf(s3.body, '연금 저축 계좌')?.rows.length === 3 && planOf(s3.body, '적립식 계좌')?.rows.length === 3 &&
      JSON.stringify(planOf(s3.body, '연금 저축 계좌')) === JSON.stringify(plans1['연금 저축 계좌']));
  fresh((b) => setSavingCell(b, 'D12', 0.50005)); // ±0.01%p 안
  check('[152-3] 비율 합이 100% ± 0.01%p 안이면 그대로 그림', planOf((await summary()).body, 'ISA 계좌')?.problem == null);

  // ═══ 4 — 개월 수 0 · 빈칸 · 글자 / 총 금액 없음 → 「시트 값 확인」 ═══
  const valueCases: [string, (b: SavingBook) => void][] = [
    ['개월 수 0', (b) => setSavingCell(b, 'D4', 0)],
    ['개월 수 빈칸', (b) => setSavingCell(b, 'D4', null)],
    ['개월 수 글자', (b) => setSavingCell(b, 'D4', '열두')],
    ['총 금액 없음', (b) => setSavingCell(b, 'C4', null)],
  ];
  const v4: string[] = [];
  for (const [label, change] of valueCases) {
    fresh(change);
    const s = await summary();
    const p = planOf(s.body, '연금 저축 계좌');
    v4.push(`${label}:${p?.problem}:${p?.rows.length}:${p?.monthly == null ? 'null' : 'num'}:${planOf(s.body, 'ISA 계좌')?.rows.length}`);
  }
  check('[152-4] 개월 수 0 · 빈칸 · 글자 / 총 금액 없음 → 그 계좌만 「values」(목록 · 한 달 금액 없음) · ISA 목록 그대로', v4.every((x) => /:values:0:null:5$/.test(x)), v4.map((x) => x.split(':').slice(1).join(':')).join(' / '));

  // ═══ 5 — 맞는 계좌 없음 · 두 묶음이 같은 계좌 ═══
  fresh((b) => setSavingCell(b, 'B3', '없는계좌 적립'));
  const s5a = await summary();
  fresh((b) => setSavingCell(b, 'B10', '연금 다른 묶음'));
  const s5b = await summary();
  check('[152-5] 첫 낱말이 맞는 계좌 없음 → 그 묶음 안 씀(연금 저축 plan 없음) · 안내 「no-account 3행」 · 다른 계좌 그대로',
    planOf(s5a.body, '연금 저축 계좌') === null && (s5a.body.monthlyBuy.planSkipped ?? []).some((x) => x.row === 3 && x.kind === 'no-account') && planOf(s5a.body, 'ISA 계좌')?.rows.length === 5);
  check('[152-5] 두 묶음이 같은 계좌 → 그 계좌 묶음 둘 다 안 씀 · 안내 「same-account 3 · 10행」 · 적립식 그대로',
    planOf(s5b.body, '연금 저축 계좌') === null && planOf(s5b.body, 'ISA 계좌') === null &&
      (s5b.body.monthlyBuy.planSkipped ?? []).filter((x) => x.kind === 'same-account').map((x) => x.row).join() === '3,10' && planOf(s5b.body, '적립식 계좌')?.rows.length === 3);

  // ═══ 6 — 몇 주(순수 함수) ═══
  const kr = sharesOf(1_000_000, 70_000, 'KR', null);
  const us = sharesOf(1_000_000, 123.45, 'US', 1387.5);
  const exact = sharesOf(300_000, 100_000, 'KR', null);
  const none = sharesOf(1_000_000, null, 'KR', null);
  const usNoFx = sharesOf(1_000_000, 100, 'US', null);
  check('[152-6] 국내: 내림(금액 ÷ 가격) 14주 · 남는 돈 = 금액 − 주 × 가격(20,000)', kr.shares === 14 && kr.rest === 20_000 && kr.priceKrw === 70_000);
  check('[152-6] 미국: 내림(금액 ÷ (가격 × 환율)) 5주 · 남는 돈 ≥ 0(원 반올림)', us.shares === Math.floor(1_000_000 / (123.45 * 1387.5)) && us.rest === Math.round(1_000_000 - 5 * 123.45 * 1387.5) && (us.rest ?? -1) >= 0);
  check('[152-6] 나누어떨어짐 3주 · 남는 돈 0 / 가격 없음 · 미국 환율 없음 → 주 · 남는 돈 · 원 가격 null(「—」)',
    exact.shares === 3 && exact.rest === 0 && none.shares == null && none.rest == null && none.priceKrw == null && usNoFx.shares == null);

  // ═══ 7 — 잇지 않은 줄 · 잇기(주소 B) · 400 ═══
  fresh();
  const s7 = await summary();
  const pen7 = planOf(s7.body, '연금 저축 계좌') as MonthlyPlan;
  check('[152-7] 잇지 않은 줄 — 금액은 있고 종목 · 가격 · 주 · 남는 돈 null · 고를 종목 = 그 계좌 보유 3개',
    pen7.rows.every((r) => r.amount > 0 && r.symbol == null && r.price == null && r.shares == null && r.rest == null) && pen7.choices.length === 3 && pen7.links.every((l) => l.symbol == null));
  const ok7 = await link('연금 저축 계좌', N[0][0], symOf(16));
  const ok7us = await link('적립식 계좌', N[2][0], symOf(5));
  const bad7a = await link('연금 저축 계좌', N[0][1], symOf(0)); // 다른 계좌(개별 투자) 종목
  const bad7b = await link('연금 저축 계좌', N[0][1], '999999');
  const bad7c = await link('연금 저축 계좌', '없는 줄 이름', symOf(16));
  const bad7d = await link('적립식 계좌', N[2][3], symOf(6)); // 0% 줄
  const bad7e = await link('없는 계좌', N[0][0], symOf(16));
  check('[152-7] PUT plan-link — 그 계좌 보유 종목 200 · 다른 계좌 종목 · 없는 코드 · 없는 줄 · 0% 줄 · 없는 계좌 400(not-editable)',
    ok7.status === 200 && ok7us.status === 200 && [bad7a, bad7b, bad7c, bad7d, bad7e].every((x) => x.status === 400 && x.body.kind === 'not-editable'),
    [ok7, ok7us, bad7a, bad7b, bad7c, bad7d, bad7e].map((x) => x.status).join(','));
  const s7b = await summary();
  const pen7b = planOf(s7b.body, '연금 저축 계좌') as MonthlyPlan;
  const r0 = pen7b.rows.find((r) => r.name === N[0][0]);
  const sav7 = planOf(s7b.body, '적립식 계좌') as MonthlyPlan;
  const u0 = sav7.rows.find((r) => r.name === N[2][0]);
  check('[152-7] 이은 뒤 summary — 국내 줄 살 주 = 내림(금액 ÷ 가격) · 남는 돈 · 나머지 줄은 그대로 「—」',
    r0 != null && r0.symbol === symOf(16) && r0.market === 'KR' && r0.price === PRICE_KR && r0.shares === Math.floor(r0.amount / PRICE_KR) && r0.rest === r0.amount - (r0.shares ?? 0) * PRICE_KR &&
      pen7b.rows.filter((r) => r.name !== N[0][0]).every((r) => r.shares == null));
  check('[152-7] 미국 줄 — 원 가격 = $ × 환율 · 살 주 = 내림(금액 ÷ 원 가격) · 「약 $」 = 금액 ÷ 환율',
    u0 != null && u0.market === 'US' && u0.priceKrw === PRICE_US * FX && u0.shares === Math.floor(u0.amount / (PRICE_US * FX)) && u0.usdKrw === FX && Math.abs((u0.amountUsd ?? 0) - u0.amount / FX) < 1e-9);
  noPrice.add(symOf(16));
  resetSheetCache();
  const s7c = await summary();
  const r0c = (planOf(s7c.body, '연금 저축 계좌') as MonthlyPlan).rows.find((r) => r.name === N[0][0]);
  check('[152-6] 이었는데 가격이 없음 → 가격 · 주 · 남는 돈 null(화면 「가격 없음」 · 「—」)', r0c != null && r0c.symbol === symOf(16) && r0c.price == null && r0c.shares == null && r0c.rest == null);
  noPrice.clear();
  const unlink = await link('연금 저축 계좌', N[0][0], null);
  resetSheetCache();
  check('[152-7] symbol null = 끊기 → 다시 「이어 주세요」', unlink.status === 200 && (planOf((await summary()).body, '연금 저축 계좌') as MonthlyPlan).rows.every((r) => r.symbol == null) && planLinks()['연금 저축 계좌'] == null);

  // ═══ 8 — 시트 줄 이름이 바뀌면 옛 연결 무시 ═══
  await link('연금 저축 계좌', N[0][1], symOf(17));
  fresh((b) => setSavingCell(b, 'B6', '이름바뀐줄'));
  const p8 = planOf((await summary()).body, '연금 저축 계좌') as MonthlyPlan;
  check('[152-8] 시트에서 줄 이름이 바뀜 → 옛 연결 무시(새 이름 줄은 「이어 주세요」 · 저장값은 남음)',
    p8.rows.some((r) => r.name === '이름바뀐줄' && r.symbol == null) && !p8.rows.some((r) => r.symbol != null) && planLinks()['연금 저축 계좌']?.[N[0][1]] === symOf(17));
  const pStale = computeSavingPlans(shape, data, { prices: new Map(), usdKrw: null }, { '연금 저축 계좌': { [N[0][0]]: symOf(0) } });
  check('[152-8] 이은 종목이 그 계좌 보유 종목이 아니게 됨 → 무시(「이어 주세요」)', pStale.get('연금 저축 계좌')?.rows.every((r) => r.symbol == null) === true);
  clearPlanLinksForTest();

  // ═══ 9 — 탭이 없음 · 읽기 실패 · 모양 바뀜 → 나머지 그대로 · planError 만 ═══
  fresh();
  const okS = (await summary()).body;
  fresh(undefined, { noTab: true });
  const s9 = await summary();
  fresh((b) => {
    for (const k of Object.keys(b.values)) if (b.values[k] === '분할 개월 수') setSavingCell(b, k, '개월');
  });
  const s9b = await summary();
  const core = (s: AssetSummary) => JSON.stringify({ totals: s.totals, profit: s.profit, accounts: s.accounts, rows: s.monthlyBuy.rows, total: s.monthlyBuy.total, acc: s.monthlyBuy.accounts.map(({ plan: _p, ...rest }) => rest), bySymbol: s.bySymbol, rebalance: s.rebalance });
  check('[152-9] 「적립식 투자」 탭 없음(구글 400) → summary 200 · 총 자산 · 분류별 표 · 계좌 줄 그대로 · planError read 하나 · plan 모두 null',
    s9.status === 200 && core(s9.body) === core(okS) && s9.body.monthlyBuy.planError?.kind === 'read' && s9.body.monthlyBuy.accounts.every((a) => a.plan === null) && (s9.body.monthlyBuy.planSkipped ?? []).length === 0);
  check('[152-9] 머리 글자(「분할 개월 수」)를 못 찾음 → summary 200 · 나머지 그대로 · planError shape(「시트 모양이 바뀌었어요(적립식 투자)」)',
    s9b.status === 200 && core(s9b.body) === core(okS) && s9b.body.monthlyBuy.planError?.kind === 'shape' && /시트 모양이 바뀌었어요\(적립식 투자\)/.test(s9b.body.monthlyBuy.planError?.message ?? ''));
  fresh();
  await summary();
  const reads1 = g.savingReads;
  await summary();
  check('[152-9] 「적립식 투자」 탭은 따로 읽음 — 값 1번 + D열 수식 1번 · 30초 캐시(두 번째 summary 는 0번)', reads1 === 2 && g.savingReads === 2, `${reads1}/${g.savingReads}`);

  // ═══ 10 — 시트 쓰기 0 ═══
  check('[152-10] 이 시험 전체에서 가짜 구글 쓰기 0번', g.writes === 0, String(g.writes));
  const planSrc = fs.readFileSync(path.join(root, 'server/asset/savingPlan.ts'), 'utf8');
  const routeSrc = fs.readFileSync(path.join(root, 'server/asset/routes.ts'), 'utf8');
  const linkRoute = routeSrc.split("assetRouter.put('/api/asset/purchase/plan-link'")[1]?.split('\n});\n')[0] ?? '';
  check('[152-10] savingPlan.ts · plan-link 주소에 시트 쓰기 함수(valuesWrite · structureWrite) 0', linkRoute.length > 200 && !/valuesWrite|structureWrite/.test(planSrc) && !/valuesWrite|structureWrite/.test(linkRoute));

  // ═══ 11 — 151차 점검(8번) 출력이 지금과 같음 ═══
  {
    const grid = (m: Record<string, Cell>) => {
      const rows: Cell[][] = [];
      for (const [k, val] of Object.entries(m)) {
        const r = Number(k.slice(1)) - 1;
        (rows[r] ??= [])[k.charCodeAt(0) - 65] = val;
      }
      return Array.from({ length: rows.length }, (_, i) => Array.from({ length: (rows[i] ?? []).length }, (_, j) => rows[i]?.[j] ?? ''));
    };
    const b = savingTabBook();
    const now = savingTabLines('exact', savingTabShape(grid(b.values), grid(b.formulas))).join('\n');
    const before = fs.readFileSync(path.join(root, 'scripts/fixtures/asset/savingCheckBefore.txt'), 'utf8').trimEnd();
    check('[152-11] asset:check-sheet 8번 출력 = 44efd7e 정답(같은 가짜 탭 · 값 없음)', now === before);
  }

  // ═══ 14 — 바뀐 파일(44efd7e → 지금) ═══
  {
    const CHASU: Chasu = { base: '44efd7e', version: 'v2.79.0' };
    const trading = chasuDiff(root, CHASU, ['--name-only'], ['server/autoTrading', 'server/buyJudge', 'server/rules', 'server/paperTradingService.ts', 'server/paperPerformanceService.ts', 'server/paperSnapshotScheduler.ts', 'server/aiCheck', 'server/marketBrief', 'server/usHalts', 'server/quoteService.ts', 'server/heatmapSession.ts', 'server/marketCalendar.ts', 'server/auth.ts', 'server/authGuard.ts', 'src/services', 'python']);
    check(`[152-14] 매매 · 시황 · 주문 · 자동매매 · 로그인 코드 바뀐 파일 0(${chasuLabel(root, CHASU)})`, trading.status === 0 && trading.stdout.trim() === '', trading.stdout.trim() || trading.stderr.trim());
    const show = spawnSync('git', ['show', '44efd7e:server/asset/purchase.ts'], { cwd: root, encoding: 'utf8' }).stdout;
    const body = (src: string) => src.split('export function computeMonthlyBuy(')[1]?.split('\n}\n')[0] ?? '';
    const nowSrc = fs.readFileSync(path.join(root, 'server/asset/purchase.ts'), 'utf8');
    check('[152-14] computeMonthlyBuy 몸통 바뀐 줄 0', body(show).length > 500 && body(show) === body(nowSrc));
  }
} catch (e) {
  fail++;
  say(`FAIL  서버 시험 중 오류 — ${(e as Error).message}`);
} finally {
  setPurchaseClockForTest(null);
  setAssetPriceSourceForTest(null);
  clearPlanLinksForTest();
  clearPurchasesForTest({ keepMigrated: true });
  srv.close();
}

// ═══ 12 · 13 — 화면(Vite + Playwright · 가짜 응답) ═══
const PORT = 5187;
const WEB = `http://127.0.0.1:${PORT}`;
type Fake = { summary: () => AssetSummary | { status: number; json: unknown }; delayMs?: number };
async function openAsset(browser: Browser, size: { width: number; height: number }, fake: Fake, puts: { url: string; body: string }[], keyboardFirst = false) {
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
    puts.push({ url: req.url().replace(/^.*\/api\//, '/api/'), body: req.postData() ?? '' });
    return r.fulfill({ json: JSON.parse(req.postData() || '{}') });
  });
  await guard.step('페이지 열기(#/asset)', () => page.goto(`${WEB}/#/asset`));
  if (keyboardFirst) await page.keyboard.press('Shift');
  return { page, ctx, errors };
}

const { createServer } = await import('vite');
const vite = await guard.step('Vite 띄우기', async () => {
  const v = await createServer({ root, configFile: path.join(root, 'vite.config.ts'), logLevel: 'error', server: { host: '127.0.0.1', port: PORT, strictPort: true, hmr: false } });
  await v.listen();
  return v;
});
const browser = await guard.step('브라우저 띄우기', () => chromium.launch({ channel: 'chrome' }));
try {
  // 12. 1280 · 1133 · 402 — 목록 · 합계 · 안내 · 표 / 카드
  for (const size of [{ width: 1280, height: 1080 }, { width: 1133, height: 744 }, { width: 402, height: 874 }]) {
    const w = size.width;
    const phone = w < 768;
    const puts: { url: string; body: string }[] = [];
    const sample = assetSummarySample({ purchase: 'mixed', plan: 'mixed' });
    const { page, ctx, errors } = await openAsset(browser, size, { summary: () => sample }, puts);
    const dlg = page.getByRole('dialog', { name: '이번 달 구매일입니다' });
    await dlg.waitFor({ timeout: 15_000 });
    await dlg.getByRole('button', { name: '나중에' }).click();
    const sec = page.locator('#as-asset-monthly-buy');
    await sec.getByTestId('plan').first().waitFor({ timeout: 10_000 });
    const plansShown = await sec.getByTestId('plan').evaluateAll((els) => els.map((e) => e.getAttribute('data-section')));
    const sav = sec.locator('[data-testid="plan"][data-section="적립식 계좌"]');
    const rowsN = await sav.getByTestId('plan-row').count();
    const linkedN = await sav.locator('[data-testid="plan-row"][data-linked="true"]').count();
    const tableN = await sec.getByTestId('plan-table').count();
    const cardN = await sav.locator('[data-card]').count();
    const unlinked = await sav.getByTestId('plan-unlinked').count();
    const sumText = (await sav.getByTestId('plan-sum').innerText()).replace(/\s+/g, ' ');
    const expectSum = (sample.monthlyBuy.accounts.find((a) => a.section === '적립식 계좌')?.plan?.sum ?? 0).toLocaleString('ko-KR');
    check(`[152-12] ${w} 계좌 줄 아래 목록 — 묶음이 있는 매달 계좌만(적립식 · ISA — 개별 투자 · 매달 아닌 연금 저축 없음) · 적립식 3줄(이음 2 · 안 이음 1) · 계좌 합계 = 한 달 금액`,
      JSON.stringify(plansShown) === JSON.stringify(['적립식 계좌', 'ISA 계좌']) && rowsN === 3 && linkedN === 2 && unlinked === 1 && sumText.includes(expectSum), `${plansShown.join(',')} ${rowsN}/${linkedN}/${unlinked}`);
    check(`[152-12] ${w} 모양 — ${phone ? '폰 = 카드(DataCard) · 표 0' : '표(ScrollTable) · 카드 0'}`, phone ? tableN === 0 && cardN === 3 : tableN === 2 && cardN === 0, `${tableN}/${cardN}`);
    const head = await sav.getByTestId('plan-head').innerText();
    check(`[152-12] ${w} 머리 「한 달 ₩… (총 ₩… ÷ N개월)」`, /^한 달 ₩[\d,]+ \(총 ₩[\d,]+ ÷ \d+개월\)$/.test(head.replace(/\s+/g, ' ').trim()));
    const isaText = await sec.locator('[data-testid="plan"][data-section="ISA 계좌"]').innerText();
    check(`[152-12] ${w} 이었는데 가격 없음 → 「가격 없음」 · 주 「—」 / 안내 「모양이 달라 읽지 않은 묶음 1개(28행)」`, isaText.includes('가격 없음') && (await sec.getByTestId('plan-skipped').allInnerTexts()).some((t) => t.includes('모양이 달라 읽지 않은 묶음 1개(28행)')));
    // ▸ / ▾ — 접으면 목록이 숨고 이 기기에 기억
    await sav.getByTestId('plan-toggle').click();
    const hidden = (await sav.getByTestId('plan-row').count()) === 0 && (await sav.getByTestId('plan-toggle').getAttribute('aria-expanded')) === 'false';
    const stored = await page.evaluate(() => localStorage.getItem('alphascope.asset.planClosed'));
    await sav.getByTestId('plan-toggle').click();
    check(`[152-12] ${w} [살 종목] 펼침 단추 — 접으면 숨김 · 이 기기에 기억 · 다시 펼침`, hidden && stored === JSON.stringify(['적립식 계좌']) && (await sav.getByTestId('plan-row').count()) === 3);
    // 「종목을 이어 주세요」 → 설정 「이번 달 구매」 그 계좌 잇기 표
    if (phone) await sav.locator('[data-card]').filter({ has: page.locator('[data-testid="plan-unlinked"]') }).click();
    else await sav.getByRole('button', { name: '설정에서 잇기' }).click();
    const sd = page.getByRole('dialog', { name: '자산 관리 설정' });
    await sd.waitFor({ timeout: 5_000 });
    const tabSel = await sd.getByRole('tab', { name: '이번 달 구매' }).getAttribute('aria-selected');
    const linkRows = await sd.locator('[data-plan-links="적립식 계좌"]').getByTestId('plan-link-row').count();
    const choices = await sd.locator('[data-plan-links="적립식 계좌"]').getByTestId('plan-link-select').first().locator('option').count();
    check(`[152-12] ${w} 「종목을 이어 주세요」 → 설정 「이번 달 구매」 · 적립식 잇기 줄 3(0% 빠짐) · 고르기 = 「이어 주세요」 + 보유 종목 2`, tabSel === 'true' && linkRows === 3 && choices === 3, `${tabSel}/${linkRows}/${choices}`);
    if (!phone) {
      const sel = sd.locator('[data-plan-links="적립식 계좌"] [data-testid="plan-link-row"]').nth(2).getByTestId('plan-link-select');
      const p0 = puts.length;
      await sel.selectOption({ index: 1 });
      await page.waitForTimeout(400);
      const put = puts.slice(p0).find((p) => p.url === '/api/asset/purchase/plan-link');
      const b = put ? (JSON.parse(put.body) as { section?: string; name?: string; symbol?: string | null }) : null;
      check(`[152-B] ${w} 설정 잇기 Select — 고르면 바로 PUT plan-link { section, name, symbol }`, b != null && b.section === '적립식 계좌' && typeof b.name === 'string' && typeof b.symbol === 'string');
    }
    check(`[152-12] ${w} 페이지 오류 0`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // 12. 안내 — 탭 못 읽음([다시 시도]) · 모양 바뀜 · 시트 값 확인 · 비율 합 · 계좌 못 맞춘 묶음
  {
    const puts: { url: string; body: string }[] = [];
    let kind: 'error-read' | 'values' = 'error-read';
    let calls = 0;
    const { page, ctx } = await openAsset(browser, { width: 1280, height: 1080 }, { summary: () => (calls++, assetSummarySample({ purchaseDone: true, plan: kind })) }, puts);
    const sec = page.locator('#as-asset-monthly-buy');
    await sec.getByTestId('plan-error').waitFor({ timeout: 10_000 });
    const errText = await sec.getByTestId('plan-error').innerText();
    const accountsStill = await sec.getByTestId('purchase-account').count();
    const before = calls;
    kind = 'values';
    await sec.getByTestId('plan-error').getByRole('button', { name: '다시 시도' }).click();
    await sec.getByTestId('plan-problem').first().waitFor({ timeout: 10_000 });
    const problems = await sec.getByTestId('plan-problem').allInnerTexts();
    const skipped = await sec.getByTestId('plan-skipped').allInnerTexts();
    check('[152-12] 탭 못 읽음 → 오류 「적립식 투자 탭을 읽지 못함」 + [다시 시도](summary 다시 받음) · 계좌 줄은 그대로(4)',
      errText.includes('「적립식 투자」 탭을 읽지 못함') && accountsStill === 4 && calls > before);
    check('[152-12] 다시 받은 뒤 안내 — 시트 값 확인(적립식) · 비율 합 100% 아님(연금 저축) · 읽지 않은 묶음 · 계좌 못 맞춘 묶음 · 같은 계좌 묶음',
      problems.some((t) => t.startsWith('시트 값 확인')) && problems.some((t) => t.startsWith('비율 합이 100% 가 아님')) && skipped.length === 3, `${problems.length}/${skipped.length}`);
    await ctx.close();
  }

  // 12. 응답 전 스켈레톤(「없음 · 0」 을 그리지 않음)
  {
    const puts: { url: string; body: string }[] = [];
    const { page, ctx } = await openAsset(browser, { width: 1280, height: 1080 }, { summary: () => assetSummarySample({ purchaseDone: true, plan: 'mixed' }), delayMs: 1500 }, puts);
    await page.waitForTimeout(500);
    const planBefore = await page.getByTestId('plan').count();
    const errBefore = await page.getByTestId('plan-error').count();
    const skeleton = await page.locator('[aria-busy="true"]').count();
    await page.getByTestId('plan').first().waitFor({ timeout: 10_000 });
    check('[152-12] 응답 전(1.5초 늦춤) 목록 · 안내 0 · 스켈레톤(aria-busy) 있음 → 응답 뒤 목록', planBefore === 0 && errBefore === 0 && skeleton > 0, `${planBefore}/${errBefore}/${skeleton}`);
    await ctx.close();
  }

  // 12 · C4. 팝업 「계좌별 살 종목 보기」 → 비율 조정 구역 · 팝업 닫힘
  {
    const puts: { url: string; body: string }[] = [];
    const { page, ctx } = await openAsset(browser, { width: 1280, height: 1080 }, { summary: () => assetSummarySample({ purchaseDone: false, plan: 'mixed' }) }, puts);
    const dlg = page.getByRole('dialog', { name: '이번 달 구매일입니다' });
    await dlg.waitFor({ timeout: 15_000 });
    const planInPopup = await dlg.getByTestId('plan').count();
    await dlg.getByRole('button', { name: '계좌별 살 종목 보기' }).click();
    await page.waitForTimeout(400);
    const closed = (await page.getByRole('dialog', { name: '이번 달 구매일입니다' }).count()) === 0;
    const inView = await page.locator('#as-asset-monthly-buy').evaluate((el) => {
      const r = el.getBoundingClientRect();
      return r.top < window.innerHeight && r.bottom > 0;
    });
    check('[152-C4] 팝업 — 목록은 넣지 않음 · 「계좌별 살 종목 보기」 → 팝업 닫힘 · 이번 달 구매 구역이 보임', planInPopup === 0 && closed && inView);
    await ctx.close();
  }

  // 13. 폰 402 × 874 — 구매일 팝업 [닫기](×) · [나중에] 가 화면 안 · 누를 수 있음 · × 툴팁이 화면 아래 끝에 남지 않음
  {
    const puts: { url: string; body: string }[] = [];
    const { page, ctx } = await openAsset(browser, { width: 402, height: 874 }, { summary: () => assetSummarySample({ purchaseDone: false, plan: 'mixed' }), delayMs: 600 }, puts, true);
    const dlg = page.getByRole('dialog', { name: '이번 달 구매일입니다' });
    await dlg.waitFor({ timeout: 15_000 });
    await page.waitForTimeout(700);
    const box = async (name: string) => dlg.getByRole('button', { name, exact: true }).boundingBox();
    const x = await box('닫기');
    const later = await box('나중에');
    const inside = (b: { x: number; y: number; width: number; height: number } | null) => b != null && b.y >= 0 && b.y + b.height <= 874 && b.x >= 0 && b.x + b.width <= 402;
    const tip = await page.locator('[role="tooltip"]').boundingBox().catch(() => null);
    // 키보드로 연 뒤(초점 표시 켜짐)라 창이 열리며 × 에 초점 → 툴팁 「닫기」 가 뜬다 — 판이 다 올라온 뒤 × 바로 아래여야 한다(151차 캡처: 화면 아래 끝)
    const tipOk = tip != null && x != null && tip.y + tip.height <= 874 && Math.abs(tip.y - (x.y + x.height)) < 40;
    check('[152-13] 402 × 874 — [닫기](×) · [나중에] 가 화면 안 · × 툴팁 「닫기」 는 × 바로 아래(화면 아래 끝에 남지 않음)', inside(x) && inside(later) && tipOk, JSON.stringify({ x, later, tip }));
    await dlg.getByRole('button', { name: '나중에', exact: true }).click();
    const closedLater = (await page.getByRole('dialog', { name: '이번 달 구매일입니다' }).count()) === 0;
    await ctx.close();
    const again = await openAsset(browser, { width: 402, height: 874 }, { summary: () => assetSummarySample({ purchaseDone: false, plan: 'mixed' }) }, puts);
    const dlg2 = again.page.getByRole('dialog', { name: '이번 달 구매일입니다' });
    await dlg2.waitFor({ timeout: 15_000 });
    await again.page.waitForTimeout(400);
    await dlg2.getByRole('button', { name: '닫기', exact: true }).click();
    const closedX = (await again.page.getByRole('dialog', { name: '이번 달 구매일입니다' }).count()) === 0;
    check('[152-13] 402 — [나중에] · [닫기] 를 누르면 팝업이 닫힘(누를 수 있음)', closedLater && closedX);
    await again.ctx.close();
  }
} catch (e) {
  fail++;
  say(`FAIL  화면 시험 중 오류 — ${(e as Error).message}`);
} finally {
  await guard.step('브라우저 닫기', () => browser.close());
  await guard.step('Vite 닫기', () => vite.close());
}

check('[152] 실제 구글 호출 0', realGoogle === 0);
// ═══ 15 — 출력 · 로그에 가짜 금액 · 줄 이름이 나오지 않음 ═══
{
  const secrets = [...SAVING_SECRET.totals.flatMap((n) => [String(n), n.toLocaleString('ko-KR')]), ...SAVING_SECRET.names.flat(), ...SAVING_SECRET.heads, '이름바뀐줄'];
  const text = [...printed, ...warned].join('\n');
  const hits = secrets.filter((x) => text.includes(x));
  check(`[152-15] 시험 출력 ${printed.length}줄 · 서버 경고 ${warned.length}줄에 가짜 금액 · 줄 이름 · 묶음 이름 0번(개수만)`, hits.length === 0 && !/₩[\d,]{4,}/.test(text), String(hits.length));
}
globalThis.fetch = realFetch;
console.warn = realWarn;
fs.rmSync(tmp, { recursive: true, force: true });
getDb().prepare(`DELETE FROM auth_sessions WHERE user_agent = ?`).run('selftest-plan');
console.log(`\n결과: ${pass}개 통과 / ${fail}개 실패`);
process.exit(fail ? 1 : 0);
