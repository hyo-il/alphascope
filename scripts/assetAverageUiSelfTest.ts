/**
 * 물타기 계산기 화면 시험(124차 · v2.68.0) — `npm run assetavgui:test` · ⚠️ `DB_PATH=<사본>` 으로만 돈다(맨 첫 import · DB 는 쓰지 않는다).
 *
 * 124차 지시서 「꼭 지킬 동작」 4 · 5 를 확인한다(시험 이름 앞의 [124-n]). Vite + Playwright, `/api` 는 모두 `page.route` 가짜(만든 값) —
 * 구글 · 토스 · 서버 호출 0. 계산기를 쓰는 동안 서버 쓰기 요청(POST · PUT · PATCH · DELETE)을 센다(잠금 시간 알림 `asset/touch` 는 화면 아무 곳을 눌러도 가는 것이라 뺀다).
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import 'dotenv/config';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { assetHistorySample, assetSheetSample, assetStatusSample, assetSummarySample, assetTradesSample } from './fixtures/asset/screenSample';
import { createBrowserStepGuard } from './lib/browserStepGuard';

const root = path.resolve(import.meta.dirname, '..');
const PORT = 5195;
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

async function open(browser: Browser, o: { size?: { width: number; height: number }; holdSummary?: boolean } = {}) {
  const ctx = await browser.newContext({ viewport: o.size ?? { width: 1440, height: 900 } });
  await ctx.addInitScript(() => localStorage.setItem('alphascope.asset.tab', 'status'));
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)));
  const writes: string[] = [];
  page.on('request', (r) => {
    const u = new URL(r.url());
    if (u.pathname.startsWith('/api/') && r.method() !== 'GET' && u.pathname !== '/api/asset/touch') writes.push(`${r.method()} ${u.pathname}`);
  });
  const gates: { release: () => void } = { release: () => {} };
  const gate = new Promise<void>((ok) => (gates.release = ok));
  await page.route(/\/api\/(?!asset\/)/, (r) => (r.request().url().includes('/api/auth/me') ? r.fulfill({ json: { ok: true } }) : r.fulfill({ status: 503, json: { error: '시험 — 없음' } })));
  await page.route('**/api/asset/status', (r) => r.fulfill({ json: assetStatusSample(true) }));
  await page.route('**/api/asset/touch', (r) => r.fulfill({ json: { ok: true, lockMinutes: 30, remainingMs: 30 * 60_000 } }));
  await page.route('**/api/asset/sheet', (r) => r.fulfill({ json: assetSheetSample() }));
  await page.route('**/api/asset/summary**', async (r) => {
    if (o.holdSummary) await gate;
    await r.fulfill({ json: assetSummarySample({ purchaseDone: true }) });
  });
  await page.route('**/api/asset/history**', (r) => r.fulfill({ json: assetHistorySample(5) }));
  await page.route('**/api/asset/trades**', (r) => r.fulfill({ json: assetTradesSample(20, 20) }));
  await page.route('**/api/asset/trade**', (r) => r.fulfill({ json: { id: 1 } }));
  await guard.step('페이지 열기(#/asset)', () => page.goto(`${WEB}/#/asset`));
  await guard.step('자산 화면 기다리기', () => page.locator('[data-account-cards]').waitFor({ timeout: 30_000 }));
  return { page, ctx, errors, writes, release: () => gates.release() };
}

const text = async (page: Page, sel: string) => ((await page.locator(sel).first().textContent()) ?? '').trim();
const val = (page: Page, sel: string) => page.locator(sel).inputValue();
const openCalc = async (page: Page, row: number) => {
  await page.locator(`[data-avgcalc-open="${row}"]`).click();
  await page.locator('[data-avgcalc]').waitFor({ timeout: 5000 });
};
const closeCalc = async (page: Page) => {
  await page.locator('[data-avgcalc-close]').click();
  await page.locator('[data-avgcalc]').waitFor({ state: 'detached', timeout: 5000 });
};
const panelOverflow = (page: Page) =>
  page.evaluate(() => {
    const d = document.querySelector('[role="dialog"] > div') as HTMLElement | null;
    if (!d) return true;
    const body = d.children[1] as HTMLElement;
    return d.scrollWidth > d.clientWidth + 1 || body.scrollWidth > body.clientWidth + 1 || d.getBoundingClientRect().right > innerWidth;
  });

const { createServer } = await import('vite');
const vite = await guard.step('Vite 띄우기', async () => {
  const v = await createServer({ root, configFile: path.join(root, 'vite.config.ts'), logLevel: 'error', server: { host: '127.0.0.1', port: PORT, strictPort: true, hmr: false } });
  await v.listen();
  return v;
});
const browser = await guard.step('브라우저 띄우기', () => chromium.launch({ channel: 'chrome' }));
try {
  for (const size of [{ width: 1440, height: 900 }, { width: 1280, height: 1080 }]) {
    const w = size.width;
    const { page, ctx, errors, writes } = await open(browser, { size });

    // ── [계산] 버튼 — 종목 줄마다 · 회색 ──
    const rows = await page.locator('[data-account-cards] [data-trade-cell]').count();
    const calcs = await page.locator('[data-account-cards] [data-avgcalc-open]').count();
    check(`[124-5] ${w}px — [계산] 버튼이 종목 줄마다(${calcs}/${rows})`, rows === 10 && calcs === rows, `${calcs}/${rows}`);
    const look = await page.evaluate(() => {
      const [calc, plain, buy, sell] = ['[data-avgcalc-open="6"]', '[data-open-class-dialog]', '[data-trade-buy="6"]', '[data-trade-sell="6"]'].map((q) => getComputedStyle(document.querySelector(q) as Element).backgroundColor);
      return { calc, plain, buy, sell };
    });
    check(`[124-5] ${w}px — [계산] 은 회색 기본 버튼(「자산 분류 정하기」 와 같은 바탕 · 매수 · 매도 색 아님)`, look.calc === look.plain && look.calc !== look.buy && look.calc !== look.sell, JSON.stringify(look));
    check(`[124-5] ${w}px — [매수] 가 없는 줄(이을 수식 없는 줄)에도 [계산]`, (await page.locator('[data-trade-buy="14"]').count()) === 0 && (await page.locator('[data-avgcalc-open="14"]').count()) === 1);
    check(`[124-5] ${w}px — [계산] 이 [매수] [매도] 옆(같은 칸 · 오른쪽)`, await page.evaluate(() => {
      const s = document.querySelector('[data-trade-sell="6"]')!.getBoundingClientRect();
      const c = document.querySelector('[data-avgcalc-open="6"]')!.getBoundingClientRect();
      return c.left > s.right && Math.abs(c.top - s.top) < 1 && c.right <= innerWidth;
    }));

    // ── 국내 — 첫 줄 지금 가격 · 결과 바로 바뀜 ──
    await openCalc(page, 6);
    check(`[124-5] ${w}px — 머리: 지금 수량 · 평균 단가 · 지금 가격(원)`, (await text(page, '[data-avgcalc-now-qty]')) === '30주' && (await text(page, '[data-avgcalc-now-avg]')) === '₩71,000' && (await text(page, '[data-avgcalc-now-price]')) === '₩65,000');
    check(`[124-5] ${w}px — 첫 줄 가격 = 지금 가격 · 수량 빈칸`, (await val(page, '[data-avgcalc-price]')) === '65,000' && (await val(page, '[data-avgcalc-qty]')) === '');
    check(`[124-5] ${w}px — 줄이 하나면 「삭제」 없음`, (await page.getByRole('button', { name: '1번째 줄 삭제' }).count()) === 0);
    await page.locator('[data-avgcalc-price]').fill('60000');
    await page.locator('[data-avgcalc-qty]').fill('10');
    const r1 = { avg: await text(page, '[data-avgcalc-new-avg]'), qty: await text(page, '[data-avgcalc-new-qty]'), cost: await text(page, '[data-avgcalc-cost]'), before: await text(page, '[data-avgcalc-return-before]'), after: await text(page, '[data-avgcalc-return-after]') };
    check(`[124-5] ${w}px — 결과 바로: ₩68,250 · 40주 · ₩600,000 · −8.5% → −4.8%`, r1.avg === '₩68,250' && r1.qty === '40주' && r1.cost === '₩600,000' && r1.before === '−8.5%' && r1.after === '−4.8%', JSON.stringify(r1));
    check(`[124-5] ${w}px — 수익률 오르내림 색(하락 = bearish)`, await page.evaluate(() => ['[data-avgcalc-return-before]', '[data-avgcalc-return-after]'].every((s) => document.querySelector(s)!.classList.contains('text-bearish'))));
    await page.locator('[data-avgcalc-add]').click();
    check(`[124-5] ${w}px — [줄 추가] → 두 줄 · 둘째 줄 가격 빈칸 · 「삭제」 둘`, (await page.locator('[data-avgcalc-line]').count()) === 2 && (await page.locator('[data-avgcalc-price]').nth(1).inputValue()) === '' && (await page.getByRole('button', { name: /번째 줄 삭제/ }).count()) === 2);
    await page.locator('[data-avgcalc-price]').nth(1).fill('55000');
    check(`[124-5] ${w}px — 빈 칸이 있는 줄은 빼고 계산(안내)`, (await text(page, '[data-avgcalc-new-avg]')) === '₩68,250' && (await page.locator('[data-avgcalc-skipped]').count()) === 1);
    await page.locator('[data-avgcalc-qty]').nth(1).fill('10');
    check(`[124-5] ${w}px — 두 줄 결과 ₩65,600 · 50주 · ₩1,150,000`, (await text(page, '[data-avgcalc-new-avg]')) === '₩65,600' && (await text(page, '[data-avgcalc-new-qty]')) === '50주' && (await text(page, '[data-avgcalc-cost]')) === '₩1,150,000');
    const lefts = await page.locator('[data-avgcalc] [data-formrow-value] input').evaluateAll((els) => els.map((e) => (e.parentElement as HTMLElement).getBoundingClientRect().left));
    check(`[124-5] ${w}px — 가격 · 수량 · 목표 칸 왼쪽 끝 차이 0px(${lefts.length}칸)`, lefts.length === 5 && Math.max(...lefts) === Math.min(...lefts), lefts.join(','));
    await page.getByRole('button', { name: '2번째 줄 삭제' }).click();
    check(`[124-5] ${w}px — 줄 「삭제」 → 결과 바로 돌아옴(₩68,250) · 한 줄 남으면 「삭제」 없음`, (await page.locator('[data-avgcalc-line]').count()) === 1 && (await text(page, '[data-avgcalc-new-avg]')) === '₩68,250' && (await page.getByRole('button', { name: /번째 줄 삭제/ }).count()) === 0);

    // ── 거꾸로 계산 ──
    await page.locator('[data-avgcalc-target]').fill('68500');
    check(`[124-5] ${w}px — 목표 ₩68,500 → 「지금 가격 ₩65,000에 22주 더 사면 됩니다(₩1,430,000 필요)」`, (await text(page, '[data-avgcalc-reverse]')) === '지금 가격 ₩65,000에 22주 더 사면 됩니다(₩1,430,000 필요)', await text(page, '[data-avgcalc-reverse]'));
    await page.locator('[data-avgcalc-target]').fill('64000');
    check(`[124-5] ${w}px — 지금 가격 ≥ 목표 → 「지금 가격으로는 목표까지 낮출 수 없어요」`, (await text(page, '[data-avgcalc-reverse]')) === '지금 가격으로는 목표까지 낮출 수 없어요');
    await page.locator('[data-avgcalc-target]').fill('72000');
    check(`[124-5] ${w}px — 목표 ≥ 지금 평균 → 안내`, (await page.locator('[data-avgcalc-reverse="above-avg"]').count()) === 1);
    check(`[124-5] ${w}px — 맨 아래 「계산만 해요 — 시트에 쓰지 않습니다」`, (await text(page, '[data-avgcalc-note]')) === '계산만 해요 — 시트에 쓰지 않습니다');
    check(`[124-5] ${w}px — 계산기 창 가로 넘침 없음`, !(await panelOverflow(page)));

    // ── 계산만 — 닫고 다시 열면 비어 있음 ──
    await closeCalc(page);
    await openCalc(page, 6);
    check(`[124-4] ${w}px — 닫고 다시 열면 입력 비어 있음(첫 줄 지금 가격만 · 한 줄 · 목표 빈칸)`, (await page.locator('[data-avgcalc-line]').count()) === 1 && (await val(page, '[data-avgcalc-price]')) === '65,000' && (await val(page, '[data-avgcalc-qty]')) === '' && (await val(page, '[data-avgcalc-target]')) === '' && (await page.locator('[data-avgcalc-new-avg]').count()) === 0);
    await page.keyboard.press('Escape');
    await page.locator('[data-avgcalc]').waitFor({ state: 'detached', timeout: 5000 });

    // ── 미국 — 달러 · 원화 환산 없음 ──
    await openCalc(page, 5);
    check(`[124-5] ${w}px — 미국: 지금 가격 $95.50 · 첫 줄 95.5`, (await text(page, '[data-avgcalc-now-price]')) === '$95.50' && (await val(page, '[data-avgcalc-price]')) === '95.5');
    await page.locator('[data-avgcalc-price]').fill('90');
    await page.locator('[data-avgcalc-qty]').fill('2.5');
    check(`[124-5] ${w}px — 미국 결과 $99.3621 · 15주 · $225.00`, (await text(page, '[data-avgcalc-new-avg]')) === '$99.3621' && (await text(page, '[data-avgcalc-new-qty]')) === '15주' && (await text(page, '[data-avgcalc-cost]')) === '$225.00');
    await page.locator('[data-avgcalc-target]').fill('100');
    check(`[124-5] ${w}px — 미국 거꾸로 계산 3.429167주 · $327.4854`, (await text(page, '[data-avgcalc-reverse]')) === '지금 가격 $95.50에 3.429167주 더 사면 됩니다($327.4854 필요)', await text(page, '[data-avgcalc-reverse]'));
    check(`[124-5] ${w}px — 미국은 원화(₩) 환산을 보이지 않음`, !(await text(page, '[data-avgcalc]')).includes('₩'));
    await closeCalc(page);

    // ── 지금 가격 없음 ──
    await openCalc(page, 16);
    check(`[124-5] ${w}px — 지금 가격 없음 안내 · 첫 줄 가격 빈칸`, (await page.locator('[data-avgcalc-no-price]').count()) === 1 && (await text(page, '[data-avgcalc-no-price]')) === '지금 가격 없음' && (await val(page, '[data-avgcalc-price]')) === '');
    await page.locator('[data-avgcalc-target]').fill('10');
    check(`[124-5] ${w}px — 가격 없으면 거꾸로 계산 안내`, (await page.locator('[data-avgcalc-reverse="no-price"]').count()) === 1);
    await closeCalc(page);

    check(`[124-4] ${w}px — 계산기에서 무엇을 해도 서버 쓰기 요청 0`, writes.length === 0, writes.join(','));
    check(`[124-5] ${w}px — 페이지 오류 0`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ── 로딩 — summary 를 받기 전 뼈대 → 받으면 첫 줄에 지금 가격 ──
  {
    const { page, ctx, release } = await open(browser, { holdSummary: true });
    await openCalc(page, 6);
    const loading = await page.evaluate(() => {
      const dd = document.querySelector('[data-avgcalc-now-price]')!;
      return { skeleton: dd.querySelector('.skeleton') != null, text: dd.textContent?.trim() ?? '' };
    });
    check('[124-5] 로딩 — 지금 가격을 받기 전 뼈대(「없음」 · 0 을 그리지 않음) · 첫 줄 빈칸', loading.skeleton && loading.text === '' && (await val(page, '[data-avgcalc-price]')) === '', JSON.stringify(loading));
    release();
    await page.locator('[data-avgcalc-now-price]').filter({ hasText: '₩65,000' }).waitFor({ timeout: 5000 });
    check('[124-5] 로딩 — 받으면 첫 줄에 지금 가격이 들어감', (await val(page, '[data-avgcalc-price]')) === '65,000');
    await ctx.close();
  }
  {
    // 사용자가 먼저 첫 줄 가격을 고쳤으면 늦게 온 가격으로 덮지 않는다
    const { page, ctx, release } = await open(browser, { holdSummary: true });
    await openCalc(page, 6);
    await page.locator('[data-avgcalc-price]').fill('61000');
    release();
    await page.locator('[data-avgcalc-now-price]').filter({ hasText: '₩65,000' }).waitFor({ timeout: 5000 });
    check('[124-5] 로딩 — 첫 줄을 먼저 고쳤으면 늦게 온 가격으로 덮지 않음', (await val(page, '[data-avgcalc-price]')) === '61,000');
    await ctx.close();
  }

  // ── 760px 넘침 ──
  {
    const { page, ctx } = await open(browser, { size: { width: 760, height: 1080 } });
    await page.locator('[data-avgcalc-open="7"]').scrollIntoViewIfNeeded();
    await openCalc(page, 7);
    await page.locator('[data-avgcalc-add]').click();
    await page.locator('[data-avgcalc-target]').fill('1000');
    check('[124-5] 760px — 계산기 창 가로 넘침 없음(긴 이름 · 두 줄 · 목표 안내)', !(await panelOverflow(page)));
    const l760 = await page.locator('[data-avgcalc] [data-formrow-value] input').evaluateAll((els) => els.map((e) => (e.parentElement as HTMLElement).getBoundingClientRect().left));
    check('[124-5] 760px — 칸 왼쪽 끝 차이 0px', l760.length === 5 && Math.max(...l760) === Math.min(...l760), l760.join(','));
    await ctx.close();
  }
} finally {
  await guard.step('브라우저 닫기', () => browser.close());
  await guard.step('Vite 닫기', () => vite.close());
  guard.stop();
}
console.log(`\n결과: PASS ${pass} · FAIL ${fail}`);
process.exit(fail > 0 ? 1 : 0);
