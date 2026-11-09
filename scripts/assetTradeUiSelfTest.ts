/**
 * 자산 매수 · 매도 입력 화면 시험(118차 · v2.66.0) — `npm run assettradeui:test` · ⚠️ `DB_PATH=<사본>` 으로만 돈다(맨 첫 import).
 *
 * 118차 지시서 「꼭 지킬 동작」 7 을 확인한다(시험 이름 앞의 [118-7]). Vite + Playwright, `/api` 는 모두 `page.route` 가짜(만든 값) — 구글 · 토스 · 서버 호출 0.
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import 'dotenv/config';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { assetHistorySample, assetSheetSample, assetStatusSample, assetSummarySample, assetTradesSample } from './fixtures/asset/screenSample';
import type { AssetSheetData } from '../src/types/asset';

const root = path.resolve(import.meta.dirname, '..');
const PORT = 5188;
const WEB = `http://127.0.0.1:${PORT}`;

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? ` — ${detail}` : ''}`);
}

interface Opts {
  writeEnabled?: boolean;
  sheet?: AssetSheetData;
  size?: { width: number; height: number };
  /** POST /api/asset/trade 응답 */
  trade?: { status: number; json: unknown };
  /** 응답을 늦춰 로딩을 본다 */
  holdTrade?: boolean;
  holdTrades?: boolean;
}

async function open(browser: Browser, o: Opts = {}) {
  const ctx = await browser.newContext({ viewport: o.size ?? { width: 1440, height: 900 } });
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
  await page.goto(`${WEB}/#/asset`);
  await page.locator('[data-account-cards]').waitFor({ timeout: 30_000 });
  return { page, ctx, errors, seen, release: () => gates.release() };
}

const text = async (page: Page, sel: string) => (await page.locator(sel).textContent())?.trim() ?? '';
const count = (page: Page, sel: string) => page.locator(sel).count();
const fillTrade = async (page: Page, qty: string, price: string, fx?: string) => {
  await page.locator('[data-trade-qty]').fill(qty);
  await page.locator('[data-trade-price]').fill(price);
  if (fx != null) await page.locator('[data-trade-fx]').fill(fx);
};
const panelOverflow = (page: Page) =>
  page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]') as HTMLElement | null;
    return d ? d.scrollWidth > d.clientWidth + 1 : true;
  });
const noPageOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

const { createServer } = await import('vite');
const vite = await createServer({ root, configFile: path.join(root, 'vite.config.ts'), logLevel: 'error', server: { host: '127.0.0.1', port: PORT, strictPort: true, hmr: false } });
await vite.listen();
const browser = await chromium.launch({ channel: 'chrome' });
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
    const newBtn = page.locator('[data-trade-new]');
    check('[118-7] [새 종목 매수] 막힘 · 툴팁 「다음 업데이트에서 열려요」', (await newBtn.isDisabled()) && (await page.locator('[data-trade-new-wrap]').getAttribute('title')) === '다음 업데이트에서 열려요');
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

  // ── 미국 매수 · 환율 ──
  {
    const { page, ctx, seen } = await open(browser);
    await page.locator('[data-trade-buy="5"]').click();
    check('[118-7] 미국 매수 — 환율 안내 문구', (await page.locator('[data-trade-dialog]').textContent())?.includes('모르면 비워 두세요 — 구매 평균 환율은 그대로 둡니다') === true);
    await fillTrade(page, '2.5', '110');
    check('[118-7] 미국 미리 보기(환율 없음) — 달러 평균 소수 4자리 · 구매 평균 환율 줄 없음', (await text(page, '[data-trade-preview-main]')) === '사고 나면 15주 · 평균 $102.6954' && (await count(page, '[data-trade-preview-fx]')) === 0, await text(page, '[data-trade-preview-main]'));
    await page.locator('[data-trade-fx]').fill('1400');
    check('[118-7] 환율 넣으면 「구매 평균 환율 ₩1,350.25 → ₩1,352.31」(합친 표 제외)', (await text(page, '[data-trade-preview-fx]')) === '구매 평균 환율 ₩1,350.25 → ₩1,352.31', await text(page, '[data-trade-preview-fx]'));
    await page.locator('[data-trade-save]').click();
    await page.locator('[data-trade-dialog]').waitFor({ state: 'detached', timeout: 5000 });
    check('[118-7] 미국 저장 요청에 환율', (seen.tradeBodies[0] as { fx?: number }).fx === 1400);
    await ctx.close();
  }

  // ── G9 수식 ──
  {
    const sheet = assetSheetSample();
    sheet.avgFxFormula = true;
    const { page, ctx } = await open(browser, { sheet });
    await page.locator('[data-trade-buy="5"]').click();
    check('[118-7] G9 이 수식이면 환율 칸 대신 안내(저장은 됨)', (await count(page, '[data-trade-fx]')) === 0 && (await count(page, '[data-trade-fx-locked]')) === 1);
    await fillTrade(page, '1', '100');
    check('[118-7] G9 수식 — [저장] 눌림 · 구매 평균 환율 미리 보기 없음', !(await page.locator('[data-trade-save]').isDisabled()) && (await count(page, '[data-trade-preview-fx]')) === 0);
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
    check('[118-7] 모두 매도 → [저장] 대신 「모두 파는 것은 다음 업데이트에서 돼요」', (await count(page, '[data-trade-save]')) === 0 && (await text(page, '[data-trade-sell-all]')) === '모두 파는 것은 다음 업데이트에서 돼요');
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
    check('[118-7] 칸 — 날짜 · 계좌 · 종목 · 구분 · 수량 · 가격 · 환율 · 그 뒤 수량 · 그 뒤 평균가', headers.join(',') === '날짜,계좌,종목,구분,수량,가격,환율,그 뒤 수량,그 뒤 평균가', headers.join(','));
    await page.locator('[data-trade-history-more]').click();
    await page.locator('[data-trade-row]').nth(99).waitFor({ timeout: 5000 });
    check('[118-7] 50줄 더 보기 → 100줄 · limit=100', (await count(page, '[data-trade-row]')) === 100 && seen.tradesUrls.at(-1)!.includes('limit=100'));
    await ctx.close();
  }

  // ── 760px · 1280px 넘침 ──
  for (const width of [760, 1280]) {
    const { page, ctx } = await open(browser, { size: { width, height: 1080 } });
    if (width === 1280) check('[118-7] 1280px — 자산 현황 페이지 가로 넘침 없음', await noPageOverflow(page));
    await page.locator('[data-trade-buy="5"]').click();
    await fillTrade(page, '2.5', '110', '1400');
    check(`[118-7] ${width}px — 매수 창 가로 넘침 없음`, !(await panelOverflow(page)));
    await page.locator('[data-trade-cancel]').click();
    await page.locator('[data-trade-history-open]').click();
    await page.locator('[data-trade-row]').first().waitFor({ timeout: 5000 });
    check(`[118-7] ${width}px — 기록 창 가로 넘침 없음(표는 창 안에서 스크롤)`, !(await panelOverflow(page)));
    await ctx.close();
  }
} finally {
  await browser.close();
  await vite.close();
}
console.log(`\n결과: PASS ${pass} · FAIL ${fail}`);
process.exit(fail > 0 ? 1 : 0);
