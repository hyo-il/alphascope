/**
 * 자산 매수 · 매도 입력 화면 시험(118차 · v2.66.0) — `npm run assettradeui:test` · ⚠️ `DB_PATH=<사본>` 으로만 돈다(맨 첫 import).
 *
 * 118차 지시서 「꼭 지킬 동작」 7 을 확인한다(시험 이름 앞의 [118-7]). Vite + Playwright, `/api` 는 모두 `page.route` 가짜(만든 값) — 구글 · 토스 · 서버 호출 0.
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { assetHistorySample, assetNewPlanSample, assetSheetSample, assetStatusSample, assetSummarySample, assetTradesSample } from './fixtures/asset/screenSample';
import type { AssetSheetData } from '../src/types/asset';
import { createBrowserStepGuard } from './lib/browserStepGuard';

const root = path.resolve(import.meta.dirname, '..');
const PORT = 5188;
const WEB = `http://127.0.0.1:${PORT}`;

const guard = createBrowserStepGuard();
let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = '') {
  guard.mark(name);
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? ` — ${detail}` : ''}`);
}

interface Opts {
  writeEnabled?: boolean;
  sheet?: AssetSheetData;
  size?: { width: number; height: number };
  /** 화면 배율(픽셀 측정) */
  scale?: number;
  /** POST /api/asset/trade 응답 */
  trade?: { status: number; json: unknown };
  /** 응답을 늦춰 로딩을 본다 */
  holdTrade?: boolean;
  holdTrades?: boolean;
}

async function open(browser: Browser, o: Opts = {}) {
  const ctx = await browser.newContext({ viewport: o.size ?? { width: 1440, height: 900 }, deviceScaleFactor: o.scale ?? 1 });
  await ctx.addInitScript(() => localStorage.setItem('alphascope.asset.tab', 'status'));
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)));
  const seen = { sheet: 0, tradeBodies: [] as Record<string, unknown>[], tradesUrls: [] as string[] };
  const gates: { release: () => void } = { release: () => {} };
  const gate = new Promise<void>((ok) => (gates.release = ok));
  await page.route(/\/api\/(?!asset\/)/, (r) => (r.request().url().includes('/api/auth/me') ? r.fulfill({ json: { ok: true } }) : r.fulfill({ status: 503, json: { error: '시험 — 없음' } })));
  await page.route('**/api/asset/status', (r) => r.fulfill({ json: assetStatusSample(true) }));
  await page.route('**/api/asset/touch', (r) => r.fulfill({ json: { ok: true, lockMinutes: 30, remainingMs: 30 * 60_000 } }));
  await page.route('**/api/asset/sheet', (r) => {
    seen.sheet++;
    return r.fulfill({ json: o.sheet ?? assetSheetSample() });
  });
  await page.route('**/api/asset/summary**', (r) => r.fulfill({ json: assetSummarySample({ purchaseDone: true, writeEnabled: o.writeEnabled ?? true }) }));
  await page.route('**/api/asset/history**', (r) => r.fulfill({ json: assetHistorySample(5) }));
  await page.route('**/api/asset/trade', async (r) => {
    seen.tradeBodies.push(JSON.parse(r.request().postData() ?? '{}') as Record<string, unknown>);
    if (o.holdTrade) await gate;
    await r.fulfill(o.trade ?? { json: { id: 1 } });
  });
  await page.route('**/api/asset/trades**', async (r) => {
    seen.tradesUrls.push(r.request().url());
    if (o.holdTrades) await gate;
    const limit = Number(new URL(r.request().url()).searchParams.get('limit'));
    await r.fulfill({ json: assetTradesSample(limit, 120) });
  });
  await guard.step('페이지 열기(#/asset)', () => page.goto(`${WEB}/#/asset`));
  await guard.step('자산 화면 기다리기', () => page.locator('[data-account-cards]').waitFor({ timeout: 30_000 }));
  return { page, ctx, errors, seen, release: () => gates.release() };
}

const text = async (page: Page, sel: string) => (await page.locator(sel).textContent())?.trim() ?? '';
const count = (page: Page, sel: string) => page.locator(sel).count();
const fillTrade = async (page: Page, qty: string, price: string) => {
  await page.locator('[data-trade-qty]').fill(qty);
  await page.locator('[data-trade-price]').fill(price);
};
const panelOverflow = (page: Page) =>
  page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]') as HTMLElement | null;
    return d ? d.scrollWidth > d.clientWidth + 1 : true;
  });
const noPageOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

const { createServer } = await import('vite');
const vite = await guard.step('Vite 띄우기', async () => {
  const v = await createServer({ root, configFile: path.join(root, 'vite.config.ts'), logLevel: 'error', server: { host: '127.0.0.1', port: PORT, strictPort: true, hmr: false } });
  await v.listen();
  return v;
});
const browser = await guard.step('브라우저 띄우기', () => chromium.launch({ channel: 'chrome' }));
try {
  // ── 줄마다 버튼 ──
  {
    const sheet = assetSheetSample();
    // 수식 칸 줄(서버가 tradable false 로 준 줄)
    const formulaRow = sheet.sections[1].holdings.find((h) => h.row === 13)!;
    formulaRow.tradable = false;
    const { page, ctx, errors } = await open(browser, { sheet });
    const tradable = sheet.sections.filter((s) => !s.combined).flatMap((s) => s.holdings).filter((h) => h.tradable);
    check('[118-7] 줄마다 [매수] [매도] — tradable 줄 수만큼', (await count(page, '[data-trade-buy]')) === tradable.length && (await count(page, '[data-trade-sell]')) === tradable.length);
    check('[118-7] 수식 칸 줄(13) · 이을 수 없는 줄(14) 에는 버튼 없음', (await count(page, '[data-trade-buy="13"]')) === 0 && (await count(page, '[data-trade-buy="14"]')) === 0);
    check('[118-7] 합친 표는 그리지 않음(39행 버튼 없음)', (await count(page, '[data-trade-buy="39"]')) === 0);
    check('[120-7] [새 종목 매수] 열림(옛 막힘 · 툴팁 없음)', !(await page.locator('[data-trade-new]').isDisabled()) && (await count(page, '[data-trade-new-wrap]')) === 0);
    check('[118-7] [매수 · 매도 기록] 버튼이 보임', (await count(page, '[data-trade-history-open]')) === 1);
    check('[118-7] 종목별 보기에는 입력 버튼 없음(계좌별에서만)', await (async () => {
      await page.getByRole('radio', { name: '종목별' }).click();
      const n = await count(page, '[data-trade-buy]');
      await page.getByRole('radio', { name: '계좌별' }).click();
      return n === 0;
    })());
    check('[118-7] 화면 오류 0', errors.length === 0, errors.join(' / '));
    await ctx.close();
  }

  // ── 국내 매수 미리 보기 · 저장 · 다시 읽기 ──
  {
    const { page, ctx, seen, errors } = await open(browser);
    await page.locator('[data-trade-buy="6"]').click();
    check('[118-7] 매수 창 머리 — 지금 수량 · 지금 평균가', (await text(page, '[data-trade-now-qty]')) === '30주' && (await text(page, '[data-trade-now-avg]')) === '₩71,000');
    check('[118-7] 국내 매수 창에는 환율 칸 없음', (await count(page, '[data-trade-fx]')) === 0);
    check('[118-7] 수량 · 가격을 넣기 전 [저장] 막힘', await page.locator('[data-trade-save]').isDisabled());
    await fillTrade(page, '10', '70000');
    check('[118-7] 국내 미리 보기 「사고 나면 40주 · 평균 ₩70,750」', (await text(page, '[data-trade-preview-main]')) === '사고 나면 40주 · 평균 ₩70,750', await text(page, '[data-trade-preview-main]'));
    check('[118-7] 쉼표 — 가격 칸 70,000', (await page.locator('[data-trade-price]').inputValue()) === '70,000');
    const sheetBefore = seen.sheet;
    await page.locator('[data-trade-save]').click();
    await page.locator('[data-trade-dialog]').waitFor({ state: 'detached', timeout: 5000 });
    await page.waitForTimeout(300);
    const b = seen.tradeBodies[0] as { section: string; row: number; side: string; qty: number; price: number; fx?: unknown; expect: { quantity: number; avgPrice: number; name: string; code: string } };
    check('[118-7] 저장 요청 — 계좌 · 줄 · 수량 · 가격 · 화면이 본 값(expect) · 환율 키 없음', b.section === '개별 투자' && b.row === 6 && b.side === 'buy' && b.qty === 10 && b.price === 70000 && !('fx' in b) && b.expect.quantity === 30 && b.expect.avgPrice === 71000 && b.expect.code === '000001');
    check('[118-7] 성공하면 창 닫고 시트 다시 읽음', seen.sheet > sheetBefore);
    check('[118-7] 화면 오류 0(저장 흐름)', errors.length === 0, errors.join(' / '));
    await ctx.close();
  }

  // ── 미국 매수 — 환율 칸 없음(119차) ──
  {
    const { page, ctx, seen } = await open(browser);
    await page.locator('[data-trade-buy="5"]').click();
    check('[119-8] 미국 매수 창 — 환율 칸 0 · 안내 한 줄', (await count(page, '[data-trade-fx]')) === 0 && (await text(page, '[data-trade-fx-note]')) === '원화 매입 금액은 시트 「달러 환전」 탭의 구매 평균 환율로 계산돼요', await text(page, '[data-trade-fx-note]'));
    await fillTrade(page, '2.5', '110');
    check('[119-8] 미국 미리 보기 — 달러 평균 소수 4자리 · 구매 평균 환율 미리 보기 0', (await text(page, '[data-trade-preview-main]')) === '사고 나면 15주 · 평균 $102.6954' && (await count(page, '[data-trade-preview-fx]')) === 0, await text(page, '[data-trade-preview-main]'));
    await page.locator('[data-trade-save]').click();
    await page.locator('[data-trade-dialog]').waitFor({ state: 'detached', timeout: 5000 });
    check('[119-8] 미국 저장 요청에 환율 키 없음', !('fx' in (seen.tradeBodies[0] as object)));
    await ctx.close();
  }

  // ── 매도 ──
  {
    const { page, ctx } = await open(browser);
    await page.locator('[data-trade-sell="6"]').click();
    check('[118-7] 매도 창에는 환율 칸 없음', (await count(page, '[data-trade-fx]')) === 0);
    await fillTrade(page, '10', '72000');
    check('[118-7] 매도 미리 보기 「팔고 나면 20주 · 평균 그대로」', (await text(page, '[data-trade-preview-main]')) === '팔고 나면 20주 · 평균 그대로', await text(page, '[data-trade-preview-main]'));
    await page.locator('[data-trade-qty]').fill('31');
    check('[118-7] 보유보다 많으면 안내 + [저장] 막힘', (await page.locator('[data-trade-dialog]').textContent())?.includes('가진 수량보다 많아요') === true && (await page.locator('[data-trade-save]').isDisabled()));
    await page.locator('[data-trade-qty]').fill('30');
    await page.locator('[data-trade-price]').fill('72000');
    check('[120-5] 모두 매도 미리 보기 「팔고 나면 0주 — 시트에서 이 줄을 지웁니다(「티커」 줄은 남김)」 · [저장] 있음', (await text(page, '[data-trade-sell-all]')) === '팔고 나면 0주 — 시트에서 이 줄을 지웁니다(「티커」 줄은 남김)' && !(await page.locator('[data-trade-save]').isDisabled()), await text(page, '[data-trade-preview]'));
    await ctx.close();
  }

  // ── 모두 매도 — 확인 창 한 번 · 409 안내(120차) ──
  {
    const { page, ctx, seen } = await open(browser, { trade: { status: 409, json: { error: '「요약」 B5 칸이 이 종목을 써요. 그 칸을 먼저 정리한 뒤 다시 눌러 주세요.', kind: 'row-referenced' } } });
    await page.locator('[data-trade-sell="6"]').click();
    await fillTrade(page, '30', '72000');
    await page.locator('[data-trade-save]').click();
    await page.getByRole('button', { name: '지우기' }).waitFor({ timeout: 5000 });
    check('[120-5] 저장 → 확인 창 먼저(요청 0)', seen.tradeBodies.length === 0);
    await page.getByRole('button', { name: '지우기' }).click();
    await page.locator('[data-trade-error]').waitFor({ timeout: 5000 });
    const b = seen.tradeBodies[0] as { side: string; qty: number; expect: { quantity: number } };
    check('[120-5] 확인 → 요청 한 번(side sell · 수량 = 가진 수량) · 409 row-referenced 이유 한 줄 · 창 그대로', seen.tradeBodies.length === 1 && b.side === 'sell' && b.qty === 30 && b.expect.quantity === 30 && (await text(page, '[data-trade-error]')).startsWith('「요약」 B5 칸이 이 종목을 써요') && (await count(page, '[data-trade-dialog]')) === 1);
    await ctx.close();
  }
  {
    const { page, ctx } = await open(browser, { trade: { status: 409, json: { error: '마지막 종목은 시트에서 직접 정리해 주세요.', kind: 'last-row' } } });
    await page.locator('[data-trade-sell="6"]').click();
    await fillTrade(page, '30', '72000');
    await page.locator('[data-trade-save]').click();
    await page.getByRole('button', { name: '지우기' }).click();
    await page.locator('[data-trade-error]').waitFor({ timeout: 5000 });
    check('[120-5] 409 last-row 이유 한 줄', (await text(page, '[data-trade-error]')) === '마지막 종목은 시트에서 직접 정리해 주세요.');
    await ctx.close();
  }

  // ── 새 종목 매수 창(120차) ──
  const STOCKS: Record<string, { symbol: string; name: string; englishName: string; market: string }> = {
    FAKN: { symbol: 'FAKN', name: '가짜 새미국주', englishName: '', market: 'NASDAQ' },
    '999201': { symbol: '999201', name: '가짜 새국내주', englishName: '', market: 'KOSPI' },
  };
  async function openNewBuy(o: Opts & { plan: unknown; save?: { status: number; json: unknown } }) {
    const s = await open(browser, o);
    const newBodies: Record<string, unknown>[] = [];
    const planBodies: Record<string, unknown>[] = [];
    await s.page.route('**/api/stocks/search**', (r) => {
      const q = new URL(r.request().url()).searchParams.get('q') ?? '';
      return r.fulfill({ json: { results: Object.values(STOCKS).filter((x) => x.symbol.includes(q)), catalogSize: 2 } });
    });
    await s.page.route('**/api/stocks/info**', (r) => r.fulfill({ json: { stock: STOCKS[new URL(r.request().url()).searchParams.get('symbol') ?? ''] ?? null } }));
    await s.page.route('**/api/asset/trade/new/plan', (r) => {
      planBodies.push(JSON.parse(r.request().postData() ?? '{}') as Record<string, unknown>);
      return r.fulfill(typeof o.plan === 'object' && o.plan && 'status' in o.plan ? (o.plan as { status: number; json: unknown }) : { json: o.plan });
    });
    await s.page.route('**/api/asset/trade/new', (r) => {
      newBodies.push(JSON.parse(r.request().postData() ?? '{}') as Record<string, unknown>);
      return r.fulfill(o.save ?? { json: { id: 2, mode: 'new', notice: null } });
    });
    await s.page.locator('[data-trade-new]').click();
    await s.page.locator('[data-newbuy-form]').waitFor({ timeout: 5000 });
    return { ...s, newBodies, planBodies };
  }
  const pick = async (page: Page, symbol: string) => {
    await page.locator('[data-newbuy-search] input').fill(symbol);
    await page.locator('[data-newbuy-search] li button').first().click({ timeout: 5000 });
    await page.locator(`[data-newbuy-chosen]:has-text("${symbol}")`).waitFor({ timeout: 5000 });
  };
  const fillNew = async (page: Page, qty: string, price: string) => {
    await page.locator('[data-newbuy-qty]').fill(qty);
    await page.locator('[data-newbuy-price]').fill(price);
  };
  {
    const { page, ctx, planBodies, newBodies, seen, errors } = await openNewBuy({ plan: assetNewPlanSample() });
    check('[120-7] 새 종목 창 — 고르기 전 [다음] 막힘', await page.locator('[data-newbuy-next]').isDisabled());
    const accounts = await page.locator('[data-newbuy-section] option').allTextContents();
    check('[120-6] 계좌 목록에 합친 표 없음', accounts.length === 4 && !accounts.includes('적립식 주식'), accounts.join(','));
    await pick(page, 'FAKN');
    check('[120-7] 종목 표시 — 이름 · 코드 · 국내/미국', (await text(page, '[data-newbuy-chosen]')).includes('가짜 새미국주') && (await text(page, '[data-newbuy-chosen]')).includes('미국'));
    check('[120-7] [121-4] 미국 종목 — 칸 이름 「가격」 · 단위 $ 한 번', (await text(page, '[data-formrow]:has([data-newbuy-price]) label')) === '가격' && (await text(page, '[data-formrow]:has([data-newbuy-price]) [data-formrow-unit]')) === '$');
    await fillNew(page, '2.5', '110.25');
    await page.locator('[data-newbuy-class]').selectOption('금');
    await page.locator('[data-newbuy-next]').click();
    await page.locator('[data-newbuy-confirm]').waitFor({ timeout: 5000 });
    check('[120-7] 확인 화면 문장 — 어느 줄 · 코드 앞부분', (await text(page, '[data-newbuy-where]')) === '「개별 투자」 맨 아래에 줄을 넣고, 「티커」 「개별 투자」 묶음 22행(빈 줄)에 씁니다 · 코드 NASDAQ:FAKN', await text(page, '[data-newbuy-where]'));
    check('[120-7] plan 요청 — 계좌 · 코드', planBodies[0].section === '개별 투자' && planBodies[0].symbol === 'FAKN');
    const prefixOptions = await page.locator('[data-newbuy-prefix] option').allTextContents();
    check('[120-1-3] 앞부분 선택지 — NASDAQ · NYSE · NYSEARCA · NYSEAMERICAN · BATS', prefixOptions.join() === 'NASDAQ,NYSE,NYSEARCA,NYSEAMERICAN,BATS', prefixOptions.join());
    await page.locator('[data-newbuy-prefix]').selectOption('BATS');
    check('[120-1-3] BATS 를 고르면 확인 문장 코드가 BATS:종목', (await text(page, '[data-newbuy-where]')).endsWith('코드 BATS:FAKN'), await text(page, '[data-newbuy-where]'));
    await page.locator('[data-newbuy-prefix]').selectOption('NYSEARCA');
    check('[120-7] 앞부분을 바꾸면 확인 문장 코드도 바뀜', (await text(page, '[data-newbuy-where]')).endsWith('코드 NYSEARCA:FAKN'), await text(page, '[data-newbuy-where]'));
    const before = seen.sheet;
    await page.locator('[data-newbuy-save]').click();
    await page.locator('[data-newbuy-confirm]').waitFor({ state: 'detached', timeout: 5000 });
    await page.waitForTimeout(300);
    const b = newBodies[0];
    check('[120-7] 저장 요청 — 고른 앞부분 · 수량 · 가격 · 분류', b.exchange === 'NYSEARCA' && b.qty === 2.5 && b.price === 110.25 && b.assetClass === '금' && b.section === '개별 투자' && b.symbol === 'FAKN', JSON.stringify(b));
    check('[120-7] 저장 뒤 창 닫고 시트 다시 읽음 · 화면 오류 0', seen.sheet > before && errors.length === 0, errors.join(' / '));
    await ctx.close();
  }
  {
    const { page, ctx } = await openNewBuy({ plan: assetNewPlanSample({ market: 'KR', currency: 'KRW', symbol: '999201', code: '999201', prefix: null, prefixEditable: false, ticker: { group: '연금 저축 계좌', row: 40, status: 'insert' } }) });
    await pick(page, '999201');
    check('[120-7] [121-4] 국내 종목 — 칸 이름 「가격」 · 단위 원 한 번 · 국내 표시', (await text(page, '[data-formrow]:has([data-newbuy-price]) label')) === '가격' && (await text(page, '[data-formrow]:has([data-newbuy-price]) [data-formrow-unit]')) === '원' && (await text(page, '[data-newbuy-chosen]')).includes('국내'));
    await fillNew(page, '3', '12340');
    await page.locator('[data-newbuy-next]').click();
    await page.locator('[data-newbuy-confirm]').waitFor({ timeout: 5000 });
    check('[120-2] 「티커」 새 줄 문구 · 국내는 앞부분 칸 없음', (await text(page, '[data-newbuy-where]')).includes('40행(새 줄)') && (await count(page, '[data-newbuy-prefix]')) === 0, await text(page, '[data-newbuy-where]'));
    await page.locator('[data-newbuy-back]').click();
    check('[120-7] [뒤로] — 입력이 남음', (await page.locator('[data-newbuy-qty]').inputValue()) === '3');
    await ctx.close();
  }
  {
    const { page, ctx } = await openNewBuy({ plan: assetNewPlanSample({ section: '적립식 계좌', ticker: { group: '적립식 투자', row: 33, status: 'existing' }, prefixEditable: false, notice: '합친 표 「적립식 주식」 은 직접 고쳐 주세요.' }) });
    await pick(page, 'FAKN');
    await fillNew(page, '1', '10');
    await page.locator('[data-newbuy-next]').click();
    await page.locator('[data-newbuy-confirm]').waitFor({ timeout: 5000 });
    check('[120-6] 적립식 계좌 — 합친 표 안내 한 줄', (await text(page, '[data-newbuy-notice]')) === '합친 표 「적립식 주식」 은 직접 고쳐 주세요.');
    check('[120-2] 「티커」 에 이미 있음 — 앞부분 칸 없음 · 문구 이미 있음', (await count(page, '[data-newbuy-prefix]')) === 0 && (await text(page, '[data-newbuy-where]')).includes('33행(이미 있음)'));
    await ctx.close();
  }
  {
    const { page, ctx } = await openNewBuy({ plan: assetNewPlanSample({ existing: { row: 5, quantity: 10, avgPrice: 100 }, prefixEditable: false, ticker: { group: '개별 투자', row: 15, status: 'existing' } }) });
    await pick(page, 'FAKN');
    await fillNew(page, '10', '200');
    await page.locator('[data-newbuy-next]').click();
    await page.locator('[data-newbuy-confirm]').waitFor({ timeout: 5000 });
    check('[120-3] 이미 가진 종목 — 「매수로 더합니다」 · 사고 나면 미리 보기', (await text(page, '[data-newbuy-existing]')).startsWith('이미 가진 종목 — 매수로 더합니다') && (await text(page, '[data-newbuy-after]')) === '사고 나면 20주 · 평균 $150.00', await text(page, '[data-newbuy-existing]'));
    check('[120-3] 이미 가진 종목 — 줄 넣기 문장 · 안내 없음', (await count(page, '[data-newbuy-where]')) === 0);
    await ctx.close();
  }
  {
    const { page, ctx } = await openNewBuy({ plan: { status: 502, json: { error: '시트 모양이 바뀌었어요(「주식 투자 정리」 「개별 투자」 구간의 합계 줄을 찾지 못해 쓰지 않았습니다).', kind: 'shape' } } });
    await pick(page, 'FAKN');
    await fillNew(page, '1', '10');
    await page.locator('[data-newbuy-next]').click();
    await page.locator('[data-newbuy-error]').waitFor({ timeout: 5000 });
    check('[120-7] 확인 화면 실패 — 입력 화면에 이유 한 줄', (await text(page, '[data-newbuy-error]')).startsWith('시트 모양이 바뀌었어요') && (await count(page, '[data-newbuy-confirm]')) === 0);
    await ctx.close();
  }
  {
    const { page, ctx } = await openNewBuy({ plan: assetNewPlanSample(), save: { status: 502, json: { error: '구글 시트 응답이 올바르지 않습니다(500).', kind: 'network' } } });
    await pick(page, 'FAKN');
    await fillNew(page, '1', '10');
    await page.locator('[data-newbuy-next]').click();
    await page.locator('[data-newbuy-save]').click();
    await page.locator('[data-newbuy-error]').waitFor({ timeout: 5000 });
    check('[120-4] 저장 실패 — 이유 한 줄 · 확인 화면 그대로', (await count(page, '[data-newbuy-confirm]')) === 1);
    await ctx.close();
  }
  {
    const { page, ctx } = await openNewBuy({ plan: assetNewPlanSample(), writeEnabled: false });
    await pick(page, 'FAKN');
    await fillNew(page, '1', '10');
    check('[120-7] 쓰기 꺼짐 — 안내 + [다음] 막힘', (await count(page, '[data-newbuy-write-off]')) === 1 && (await page.locator('[data-newbuy-next]').isDisabled()));
    await ctx.close();
  }

  // ── 121차 — 새 종목 창 종목 칸 · 줄맞춤 · 칸 이름 · 안내 · 연금 포함 ──
  const PLACEHOLDER = '종목 이름이나 티커를 입력하세요';
  const RATIO = '「자산 투자 비율 관리」 탭에는 직접 더해 주세요.';
  for (const size of [{ width: 1280, height: 1080 }, { width: 1440, height: 900 }]) {
    const { page, ctx } = await openNewBuy({ plan: assetNewPlanSample(), size });
    const form = await page.evaluate(() => {
      const spots: Record<string, { left: number; width: number }> = {};
      for (const [key, sel, box] of [['account', '[data-newbuy-section]', false], ['search', '[data-newbuy-search] input', false], ['qty', '[data-newbuy-qty]', true], ['price', '[data-newbuy-price]', true], ['cls', '[data-newbuy-class]', false]] as const) {
        const el = document.querySelector(sel) as HTMLElement;
        const r = (box ? (el.parentElement as HTMLElement) : el).getBoundingClientRect();
        spots[key] = { left: r.left, width: r.width };
      }
      const input = document.querySelector('[data-newbuy-search] input') as HTMLInputElement;
      const cs = getComputedStyle(input);
      const canvas = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D;
      canvas.font = cs.font;
      const inner = input.getBoundingClientRect().width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth);
      return {
        spots,
        placeholder: input.placeholder, textWidth: canvas.measureText(input.placeholder).width, inner, buttons: document.querySelectorAll('[data-newbuy-search] button').length,
      };
    });
    check(`[121-1] ${size.width}px — 종목 칸 폭 = 계좌 칸 폭 · 버튼 0개`, form.spots.search.width === form.spots.account.width && form.spots.search.width > 0 && form.buttons === 0, JSON.stringify(form));
    check(`[121-1] ${size.width}px — 안내 글자 「${PLACEHOLDER}」 잘림 없음`, form.placeholder === PLACEHOLDER && form.textWidth <= form.inner, `${form.textWidth} / ${form.inner}`);
    const lefts = ['account', 'search', 'qty', 'price', 'cls'].map((k) => form.spots[k].left);
    check(`[121-3] ${size.width}px — 계좌 · 종목 · 수량 · 가격 · 자산 분류 왼쪽 끝 차이 0px`, Math.max(...lefts) === Math.min(...lefts), lefts.join(','));
    const hintBox = await page.locator('[data-newbuy-chosen]').evaluate((el) => ({ left: el.getBoundingClientRect().left, height: el.getBoundingClientRect().height, textRight: (el.firstElementChild as HTMLElement).getBoundingClientRect().right, formRight: (el.closest('[data-newbuy-form]') as HTMLElement).getBoundingClientRect().right }));
    check(`[122-3] ${size.width}px — 고르기 전 안내 줄 왼쪽 끝 = 입력칸 왼쪽 끝(0px) · 한 줄`, hintBox.left === form.spots.account.left && hintBox.height <= 24 && hintBox.textRight <= hintBox.formRight, JSON.stringify(hintBox));
    await pick(page, 'FAKN');
    const chosenBox = await page.locator('[data-newbuy-chosen]').evaluate((el) => ({ left: (el.firstElementChild as HTMLElement).getBoundingClientRect().left, text: el.textContent ?? '' }));
    check(`[122-3] ${size.width}px — 고른 종목 줄 왼쪽 끝 = 입력칸 왼쪽 끝(0px)`, chosenBox.left === form.spots.account.left && chosenBox.text.includes('FAKN'), JSON.stringify(chosenBox));
    await ctx.close();

    const pension = await open(browser, { size, scale: 2 });
    const label = pension.page.locator('label:has([data-asset-pension])');
    const split = await label.evaluate((l) => Math.ceil(((l.querySelector('input') as HTMLElement).getBoundingClientRect().right - l.getBoundingClientRect().left) * 2) + 1);
    const ink = await pension.page.evaluate(async ({ b64, split: at }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const g = canvas.getContext('2d') as CanvasRenderingContext2D;
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, img.width, img.height).data;
      const out: number[] = [];
      for (const [x0, x1] of [[0, at], [at + 2, Math.floor(img.width * 0.8)]]) {
        let top = 1e9;
        let bottom = -1;
        for (let y = 0; y < img.height; y++) for (let x = x0; x < x1; x++) {
          const i = (y * img.width + x) * 4;
          if (Math.abs(d[i] - d[0]) + Math.abs(d[i + 1] - d[1]) + Math.abs(d[i + 2] - d[2]) > 150) {
            top = Math.min(top, y);
            bottom = Math.max(bottom, y);
          }
        }
        out.push((top + bottom + 1) / 2 / 2);
      }
      return out;
    }, { b64: (await label.screenshot()).toString('base64'), split });
    check(`[121-7] ${size.width}px — 연금 포함 체크박스 ↔ 글자 세로 가운데 차이 ≤ 1px(실제 픽셀 · 0.5px 안)`, Math.abs(ink[0] - ink[1]) <= 0.5, ink.join(' / '));
    await pension.ctx.close();
  }
  {
    const { page, ctx } = await openNewBuy({ plan: assetNewPlanSample() });
    await page.route('**/api/stocks/search**', (r) => r.fulfill({ json: { results: [STOCKS['999201'], STOCKS.FAKN], catalogSize: 2 } }));
    const input = page.locator('[data-newbuy-search] input');
    await input.fill('가');
    await page.locator('[data-newbuy-search] li button').nth(1).waitFor({ timeout: 5000 });
    await input.press('Enter');
    await page.locator('[data-newbuy-chosen]:has-text("999201")').waitFor({ timeout: 5000 });
    check('[121-1] 글자 → 목록 → Enter = 맨 위 종목', (await text(page, '[data-newbuy-chosen]')).includes('가짜 새국내주'));
    await input.fill('가');
    await page.locator('[data-newbuy-search] li button').nth(1).click({ timeout: 5000 });
    await page.locator('[data-newbuy-chosen]:has-text("FAKN")').waitFor({ timeout: 5000 });
    check('[121-1] 글자 → 목록 → 누름 = 그 종목', (await text(page, '[data-newbuy-chosen]')).includes('가짜 새미국주'));
    await input.fill('FAK');
    await input.press('Enter');
    await page.locator('[data-newbuy-chosen]:has-text("999201")').waitFor({ timeout: 5000 });
    check('[121-1] 응답 전 Enter — 응답을 기다려 맨 위 종목(친 글자를 코드로 보지 않음)', (await text(page, '[data-newbuy-chosen]')).includes('999201') && (await count(page, '[data-newbuy-search] button[type="submit"]')) === 0);
    await ctx.close();
  }
  {
    const { page, ctx } = await openNewBuy({ plan: assetNewPlanSample() });
    await pick(page, 'FAKN');
    await fillNew(page, '1', '10');
    await page.locator('[data-newbuy-next]').click();
    await page.locator('[data-newbuy-confirm]').waitFor({ timeout: 5000 });
    check('[121-5] 확인 화면 — 비율 탭 안내 · 합친 표 안내 없음', (await text(page, '[data-newbuy-ratio-notice]')) === RATIO && (await count(page, '[data-newbuy-notice]')) === 0, await text(page, '[data-newbuy-confirm]'));
    await page.locator('[data-newbuy-save]').click();
    await page.locator('[data-newbuy-saved-notes]').waitFor({ timeout: 5000 });
    check('[121-5] 저장 성공 뒤 — 비율 탭 안내 한 줄', (await text(page, '[data-newbuy-saved-notes]')) === RATIO && (await count(page, '[data-newbuy-confirm]')) === 0, await text(page, '[data-newbuy-saved-notes]'));
    await page.locator('[data-trade-new]').click();
    await page.locator('[data-newbuy-form]').waitFor({ timeout: 5000 });
    check('[121-5] 새 종목 창을 다시 열면 지난 안내를 지움', (await count(page, '[data-newbuy-saved-notes]')) === 0);
    await ctx.close();
  }
  {
    const combined = '합친 표 「적립식 주식」 은 직접 고쳐 주세요.';
    const { page, ctx } = await openNewBuy({ plan: assetNewPlanSample({ section: '적립식 계좌', notice: combined }), save: { status: 200, json: { id: 3, mode: 'new', notice: combined } } });
    await pick(page, 'FAKN');
    await fillNew(page, '1', '10');
    await page.locator('[data-newbuy-next]').click();
    await page.locator('[data-newbuy-confirm]').waitFor({ timeout: 5000 });
    check('[121-5] 확인 화면 — 합친 표 · 비율 탭 안내 두 줄', (await text(page, '[data-newbuy-notice]')) === combined && (await text(page, '[data-newbuy-ratio-notice]')) === RATIO);
    await page.locator('[data-newbuy-save]').click();
    await page.locator('[data-newbuy-saved-notes]').waitFor({ timeout: 5000 });
    check('[121-5] 저장 뒤 — 합친 표 · 비율 탭 안내 두 줄', (await page.locator('[data-newbuy-saved-notes] p').allTextContents()).join('|') === `${combined}|${RATIO}`);
    await ctx.close();
  }
  {
    const { page, ctx } = await openNewBuy({ plan: assetNewPlanSample({ existing: { row: 5, quantity: 10, avgPrice: 100 }, prefixEditable: false, ticker: { group: '개별 투자', row: 15, status: 'existing' } }), save: { status: 200, json: { id: 4, mode: 'buy', notice: null } } });
    await pick(page, 'FAKN');
    await fillNew(page, '1', '10');
    await page.locator('[data-newbuy-next]').click();
    await page.locator('[data-newbuy-confirm]').waitFor({ timeout: 5000 });
    check('[121-5] 이미 가진 종목(새 줄 없음)은 비율 탭 안내 없음', (await count(page, '[data-newbuy-ratio-notice]')) === 0);
    await page.locator('[data-newbuy-save]').click();
    await page.locator('[data-newbuy-confirm]').waitFor({ state: 'detached', timeout: 5000 });
    await page.waitForTimeout(200);
    check('[121-5] 이미 가진 종목 저장 뒤에도 안내 없음', (await count(page, '[data-newbuy-saved-notes]')) === 0);
    await ctx.close();
  }
  {
    const { page, ctx } = await open(browser);
    const unitOf = (field: string) => text(page, `[data-formrow]:has(${field}) [data-formrow-unit]`);
    const labelOf = (field: string) => text(page, `[data-formrow]:has(${field}) label`);
    await page.locator('[data-trade-buy="6"]').click();
    check('[121-4] 국내 매수 창 — 칸 이름 「가격」 · 단위 원 한 번', (await labelOf('[data-trade-price]')) === '가격' && (await unitOf('[data-trade-price]')) === '원');
    await page.locator('[data-trade-cancel]').click();
    await page.locator('[data-trade-buy="5"]').click();
    check('[121-4] 미국 매수 창 — 칸 이름 「가격」 · 단위 $ 한 번', (await labelOf('[data-trade-price]')) === '가격' && (await unitOf('[data-trade-price]')) === '$');
    await ctx.close();
    const assetSrc = fs.readdirSync(path.join(root, 'src/components/asset')).filter((f) => f.endsWith('.tsx')).map((f) => fs.readFileSync(path.join(root, 'src/components/asset', f), 'utf8')).join('\n');
    check('[121-4] 자산 창 소스에 「가격(원)」 · 「가격(달러)」 0곳', !assetSrc.includes('가격(원)') && !assetSrc.includes('가격(달러)'));
  }

  // ── 121차 — 다른 자리 검색칸은 「종목 추가」 버튼 그대로 ──
  {
    const { page, ctx } = await open(browser);
    const addButton = (placeholder: string) => page.locator(`form:has(input[placeholder*="${placeholder}"]) button[type="submit"]`);
    const go = (hash: string) => page.evaluate((h) => { location.hash = h; }, hash);
    check('[121-2] 관심 목록 검색칸 — 「종목 추가」 버튼 그대로', (await addButton('종목 이름·티커').textContent())?.trim() === '종목 추가');
    await page.getByRole('button', { name: '관심 목록 관리 (폴더·순서)' }).click();
    await page.locator('button:not([type="submit"])', { hasText: '종목 추가' }).first().click({ timeout: 10_000 });
    await addButton('추가 (구글, 애플').waitFor({ timeout: 5000 });
    check('[121-2] 관심 목록 관리 검색칸 — 「종목 추가」 버튼 그대로', (await addButton('추가 (구글, 애플').textContent())?.trim() === '종목 추가');
    await page.reload();
    await guard.step('비교 화면 열기', () => go('#/compare'));
    await page.getByRole('button', { name: '종목 검색' }).first().click({ timeout: 10_000 });
    await addButton('종목 이름이나 티커').waitFor({ timeout: 5000 });
    check('[121-2] 비교 검색칸 — 「종목 추가」 버튼 그대로', (await addButton('종목 이름이나 티커').textContent())?.trim() === '종목 추가');
    await guard.step('백테스트 화면 열기', () => go('#/backtest'));
    await page.locator('button:not([type="submit"])', { hasText: '종목 추가' }).first().click({ timeout: 15_000 });
    await page.getByRole('tab', { name: '새 종목 검색' }).click({ timeout: 5000 });
    await addButton('목록에 없는 종목 검색').waitFor({ timeout: 5000 });
    check('[121-2] 종목 추가 창 검색칸 — 「종목 추가」 버튼 그대로', (await addButton('목록에 없는 종목 검색').textContent())?.trim() === '종목 추가');
    await ctx.close();
  }

  // ── 스위치 · 실패 · 로딩 ──
  {
    const { page, ctx } = await open(browser, { writeEnabled: false });
    await page.locator('[data-trade-buy="6"]').click();
    await fillTrade(page, '1', '1');
    check('[118-7] 스위치 꺼짐 — 안내 + [저장] 막음', (await text(page, '[data-trade-write-off]')) === '이 서버에서는 시트 쓰기가 꺼져 있습니다.' && (await page.locator('[data-trade-save]').isDisabled()));
    await ctx.close();
  }
  {
    const { page, ctx, seen } = await open(browser, { trade: { status: 409, json: { error: '시트가 바뀌었어요 — 다시 열어 주세요.', kind: 'sheet-changed' } } });
    await page.locator('[data-trade-buy="6"]').click();
    await fillTrade(page, '1', '1');
    const before = seen.sheet;
    await page.locator('[data-trade-save]').click();
    await page.locator('[data-trade-error]').waitFor({ timeout: 5000 });
    await page.waitForTimeout(300);
    check('[118-7] 저장 실패 — 이유 한 줄 · 창은 그대로 · 시트가 바뀌었으면 뒤에서 다시 읽음', (await text(page, '[data-trade-error]')) === '시트가 바뀌었어요 — 다시 열어 주세요.' && (await count(page, '[data-trade-dialog]')) === 1 && seen.sheet > before);
    await ctx.close();
  }
  {
    const { page, ctx, release } = await open(browser, { holdTrade: true });
    await page.locator('[data-trade-buy="6"]').click();
    await fillTrade(page, '1', '1');
    await page.locator('[data-trade-save]').click();
    await page.waitForTimeout(150);
    check('[118-7] 저장 중 로딩 — [저장] busy · [취소] 막힘', (await page.locator('[data-trade-save]').getAttribute('aria-busy')) === 'true' && (await page.locator('[data-trade-cancel]').isDisabled()));
    release();
    await page.locator('[data-trade-dialog]').waitFor({ state: 'detached', timeout: 5000 });
    await ctx.close();
  }

  // ── 기록 창 ──
  {
    const { page, ctx, seen, release } = await open(browser, { holdTrades: true });
    await page.locator('[data-trade-history-open]').click();
    await page.locator('[data-trade-history]').waitFor({ timeout: 5000 });
    check('[118-7] 기록 창 로딩 — 받기 전 스켈레톤(표 · 빈 목록을 그리지 않음)', (await count(page, '[data-trade-row]')) === 0 && (await count(page, '[data-trade-history-empty]')) === 0 && (await page.locator('[data-trade-history] .skeleton').count()) > 0);
    release();
    await page.locator('[data-trade-row]').first().waitFor({ timeout: 5000 });
    check('[118-7] 기록 창 — 처음 50줄 · limit=50', (await count(page, '[data-trade-row]')) === 50 && seen.tradesUrls[0].includes('limit=50'));
    const headers = await page.locator('[data-trade-history] thead th').allTextContents();
    check('[119-8] 옛 기록에 환율이 있으면 칸이 보임 — 날짜 · 계좌 · 종목 · 구분 · 수량 · 가격 · 환율 · 그 뒤 수량 · 그 뒤 평균가', headers.join(',') === '날짜,계좌,종목,구분,수량,가격,환율,그 뒤 수량,그 뒤 평균가', headers.join(','));
    await page.locator('[data-trade-history-more]').click();
    await page.locator('[data-trade-row]').nth(99).waitFor({ timeout: 5000 });
    check('[118-7] 50줄 더 보기 → 100줄 · limit=100', (await count(page, '[data-trade-row]')) === 100 && seen.tradesUrls.at(-1)!.includes('limit=100'));
    await ctx.close();
  }

  // ── 환율 값이 있는 기록이 없으면 칸 없음(119차) ──
  {
    const { page, ctx } = await open(browser);
    await page.route('**/api/asset/trades**', (r) => r.fulfill({ json: { trades: assetTradesSample(3, 3).trades.map((t) => ({ ...t, fx: null })), hasMore: false } }));
    await page.locator('[data-trade-history-open]').click();
    await page.locator('[data-trade-row]').first().waitFor({ timeout: 5000 });
    const heads = await page.locator('[data-trade-history] thead th').allTextContents();
    check('[119-8] 기록에 환율 값이 없으면 환율 칸 없음', !heads.includes('환율') && heads.length === 8, heads.join(','));
    await ctx.close();
  }

  // ── 760px · 1280px 넘침 ──
  for (const width of [760, 1280]) {
    const { page, ctx } = await open(browser, { size: { width, height: 1080 } });
    if (width === 1280) check('[118-7] 1280px — 자산 현황 페이지 가로 넘침 없음', await noPageOverflow(page));
    check(`[118-7] ${width}px — 계좌별 표 칸이 화면 밖으로 넘치지 않음(좁으면 표만 칸 안에서 가로로 움직임)`, await page.evaluate(() => {
      const w = document.querySelector('[data-account-cards-wrap]') as HTMLElement;
      return w.getBoundingClientRect().right <= (w.parentElement as HTMLElement).getBoundingClientRect().right + 1 && getComputedStyle(w).overflowX === 'auto';
    }));
    await page.locator('[data-trade-buy="5"]').click();
    await fillTrade(page, '2.5', '110');
    check(`[118-7] ${width}px — 매수 창 가로 넘침 없음`, !(await panelOverflow(page)));
    await page.locator('[data-trade-cancel]').click();
    await page.locator('[data-trade-new]').click();
    await page.locator('[data-newbuy-form]').waitFor({ timeout: 5000 });
    check(`[120-7] ${width}px — 새 종목 창 가로 넘침 없음`, !(await panelOverflow(page)));
    await page.locator('[data-newbuy-cancel]').click();
    await page.locator('[data-trade-history-open]').click();
    await page.locator('[data-trade-row]').first().waitFor({ timeout: 5000 });
    check(`[118-7] ${width}px — 기록 창 가로 넘침 없음(표는 창 안에서 스크롤)`, !(await panelOverflow(page)));
    await ctx.close();
  }
} finally {
  await guard.step('브라우저 닫기', () => browser.close());
  await guard.step('Vite 닫기', () => vite.close());
  guard.stop();
}
console.log(`\n결과: PASS ${pass} · FAIL ${fail}`);
process.exit(fail > 0 ? 1 : 0);
