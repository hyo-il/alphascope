/**
 * 평단 계산기 화면 시험(124차 · v2.68.0 · 125차 · v2.68.1) — `npm run assetavgui:test` · ⚠️ `DB_PATH=<사본>` 으로만 돈다(맨 첫 import · DB 는 쓰지 않는다).
 *
 * 124차 지시서 「꼭 지킬 동작」 4 · 5 · 125차 1 · 2 · 3 · 5 · 6 을 확인한다(시험 이름 앞의 [124-n] · [125-n]). Vite + Playwright, `/api` 는 모두 `page.route` 가짜(만든 값) —
 * 구글 · 토스 · 서버 호출 0. 계산기를 쓰는 동안 서버 쓰기 요청(POST · PUT · PATCH · DELETE)을 센다(잠금 시간 알림 `asset/touch` 는 화면 아무 곳을 눌러도 가는 것이라 뺀다).
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import 'dotenv/config';
import fs from 'node:fs';
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
const toTab = (page: Page, name: '더 사면 평단은?' | '목표 평단까지') => page.locator('[data-avgcalc]').getByRole('tab', { name }).click();
const selectedTab = async (page: Page) => ((await page.locator('[data-avgcalc] [role="tab"][aria-selected="true"]').textContent()) ?? '').trim();
/** 계산기 창(패널) 높이 */
const dialogHeight = (page: Page) => page.evaluate(() => (document.querySelector('[role="dialog"] > div') as HTMLElement).getBoundingClientRect().height);
const steps = (page: Page) => page.locator('[data-avgcalc-step]').allTextContents();
const addText = async (page: Page) => ((await page.locator('[data-avgcalc-add]').count()) ? ((await page.locator('[data-avgcalc-add]').textContent()) ?? '').trim() : null);
const removeNames = (page: Page) => page.locator('[data-avgcalc-panel="more"] button[aria-label$=" 삭제"]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
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

    // ── [평단 계산기] 버튼 — 종목 줄마다 · 회색 ──
    const rows = await page.locator('[data-account-cards] [data-trade-cell]').count();
    const calcs = await page.locator('[data-account-cards] [data-avgcalc-open]').count();
    check(`[124-5] ${w}px — [평단 계산기] 버튼이 종목 줄마다(${calcs}/${rows})`, rows === 10 && calcs === rows, `${calcs}/${rows}`);
    const btnTexts = await page.locator('[data-account-cards] [data-avgcalc-open]').allTextContents();
    check(`[125-1] ${w}px — 버튼 글자 「평단 계산기」 · aria-label 「<종목> 평단 계산기」`, btnTexts.every((t) => t.trim() === '평단 계산기') && (await page.locator('[data-avgcalc-open="6"]').getAttribute('aria-label'))?.endsWith(' 평단 계산기') === true, btnTexts.join(','));
    const nameCell = await page.evaluate(() => {
      const td = document.querySelector('[data-avgcalc-open="6"]')!.closest('tr')!.querySelector('td') as HTMLElement;
      return { w: Math.round(td.getBoundingClientRect().width * 10) / 10 };
    });
    console.log(`  (보고용) ${w}px 계좌별 표 이름 칸 폭 ${nameCell.w}px`);
    const look = await page.evaluate(() => {
      const [calc, plain, buy, sell] = ['[data-avgcalc-open="6"]', '[data-open-class-dialog]', '[data-trade-buy="6"]', '[data-trade-sell="6"]'].map((q) => getComputedStyle(document.querySelector(q) as Element).backgroundColor);
      return { calc, plain, buy, sell };
    });
    check(`[124-5] ${w}px — [평단 계산기] 는 회색 기본 버튼(「자산 분류 정하기」 와 같은 바탕 · 매수 · 매도 색 아님)`, look.calc === look.plain && look.calc !== look.buy && look.calc !== look.sell, JSON.stringify(look));
    check(`[124-5] ${w}px — [매수] 가 없는 줄(이을 수식 없는 줄)에도 [평단 계산기]`, (await page.locator('[data-trade-buy="14"]').count()) === 0 && (await page.locator('[data-avgcalc-open="14"]').count()) === 1);
    check(`[124-5] ${w}px — [평단 계산기] 가 [매수] [매도] 옆(같은 칸 · 오른쪽)`, await page.evaluate(() => {
      const s = document.querySelector('[data-trade-sell="6"]')!.getBoundingClientRect();
      const c = document.querySelector('[data-avgcalc-open="6"]')!.getBoundingClientRect();
      return c.left > s.right && Math.abs(c.top - s.top) < 1 && c.right <= innerWidth;
    }));

    // ── 국내 — 첫 줄 지금 가격 · 결과 바로 바뀜 ──
    await openCalc(page, 6);
    const titleText = await text(page, '[role="dialog"] h2');
    check(`[125-1] ${w}px — 창 제목 「평단 계산기」`, titleText === '평단 계산기', titleText);
    const bodyText = (await page.locator('body').textContent()) ?? '';
    check(`[125-1] ${w}px — 화면에 「물타기」 · 「계산」 만 쓴 버튼 0곳`, !bodyText.includes('물타기') && (await page.locator('button').filter({ hasText: /^\s*계산\s*$/ }).count()) === 0);
    check(`[125-2] ${w}px — 두 탭 「더 사면 평단은?」 | 「목표 평단까지」 · 처음 첫째 탭`, JSON.stringify((await page.locator('[data-avgcalc] [role="tab"]').allTextContents()).map((t) => t.trim())) === JSON.stringify(['더 사면 평단은?', '목표 평단까지']) && (await selectedTab(page)) === '더 사면 평단은?');
    const h1 = await dialogHeight(page);
    await toTab(page, '목표 평단까지');
    const h2 = await dialogHeight(page);
    await toTab(page, '더 사면 평단은?');
    check(`[125-2] ${w}px — 탭을 바꿔도 창 높이 같음(${h1} · ${h2})`, Math.abs(h1 - h2) < 0.5, `${h1} ${h2}`);
    check(`[125-3] ${w}px — 첫 줄 「1차 매수」 · 버튼 [+ 2차 매수]`, JSON.stringify(await steps(page)) === '["1차 매수"]' && (await addText(page)) === '2차 매수');
    check(`[124-5] ${w}px — 머리: 지금 수량 · 평균 단가 · 지금 가격(원)`, (await text(page, '[data-avgcalc-now-qty]')) === '30주' && (await text(page, '[data-avgcalc-now-avg]')) === '₩71,000' && (await text(page, '[data-avgcalc-now-price]')) === '₩65,000');
    check(`[124-5] ${w}px — 첫 줄 가격 = 지금 가격 · 수량 빈칸`, (await val(page, '[data-avgcalc-price]')) === '65,000' && (await val(page, '[data-avgcalc-qty]')) === '');
    check(`[125-3] ${w}px — 1차만 있으면 「삭제」 없음`, (await removeNames(page)).length === 0);
    await page.locator('[data-avgcalc-price]').fill('60000');
    await page.locator('[data-avgcalc-qty]').fill('10');
    const r1 = { avg: await text(page, '[data-avgcalc-new-avg]'), qty: await text(page, '[data-avgcalc-new-qty]'), cost: await text(page, '[data-avgcalc-cost]'), before: await text(page, '[data-avgcalc-return-before]'), after: await text(page, '[data-avgcalc-return-after]') };
    check(`[124-5] ${w}px — 결과 바로: ₩68,250 · 40주 · ₩600,000 · −8.5% → −4.8%`, r1.avg === '₩68,250' && r1.qty === '40주' && r1.cost === '₩600,000' && r1.before === '−8.5%' && r1.after === '−4.8%', JSON.stringify(r1));
    check(`[124-5] ${w}px — 수익률 오르내림 색(하락 = bearish)`, await page.evaluate(() => ['[data-avgcalc-return-before]', '[data-avgcalc-return-after]'].every((s) => document.querySelector(s)!.classList.contains('text-bearish'))));
    await page.locator('[data-avgcalc-add]').click();
    check(`[125-3] ${w}px — [+ 2차 매수] → 「1차 · 2차 매수」 · 2차 가격 빈칸 · 「삭제」 는 2차에만 · 버튼 [+ 3차 매수]`, JSON.stringify(await steps(page)) === '["1차 매수","2차 매수"]' && (await page.locator('[data-avgcalc-price]').nth(1).inputValue()) === '' && JSON.stringify(await removeNames(page)) === '["2차 매수 삭제"]' && (await addText(page)) === '3차 매수');
    await page.locator('[data-avgcalc-price]').nth(1).fill('55000');
    check(`[124-5] ${w}px — 빈 칸이 있는 차수는 빼고 계산(안내 「빈 차수 1개」)`, (await text(page, '[data-avgcalc-new-avg]')) === '₩68,250' && (await text(page, '[data-avgcalc-skipped]')) === '가격이나 수량이 빈 차수 1개는 빼고 계산했어요');
    await page.locator('[data-avgcalc-qty]').nth(1).fill('10');
    check(`[124-5] ${w}px — 두 줄 결과 ₩65,600 · 50주 · ₩1,150,000`, (await text(page, '[data-avgcalc-new-avg]')) === '₩65,600' && (await text(page, '[data-avgcalc-new-qty]')) === '50주' && (await text(page, '[data-avgcalc-cost]')) === '₩1,150,000');
    const lefts = await page.locator('[data-avgcalc] [data-formrow-value] input').evaluateAll((els) => els.map((e) => (e.parentElement as HTMLElement).getBoundingClientRect().left));
    check(`[124-5] ${w}px — 가격 · 수량 · 목표 칸 왼쪽 끝 차이 0px(${lefts.length}칸)`, lefts.length === 5 && Math.max(...lefts) === Math.min(...lefts), lefts.join(','));
    // ── 구매 단계 3 ~ 5차 · 마지막만 삭제 ──
    for (let n = 3; n <= 5; n++) {
      await page.locator('[data-avgcalc-add]').click();
      const names = await steps(page);
      const want = Array.from({ length: n }, (_, i) => `${i + 1}차 매수`);
      check(`[125-3] ${w}px — ${n}차까지: 이름 ${n}개 · 「삭제」 는 ${n}차에만 · 버튼 ${n < 5 ? `[+ ${n + 1}차 매수]` : '없음'}`, JSON.stringify(names) === JSON.stringify(want) && JSON.stringify(await removeNames(page)) === JSON.stringify([`${n}차 매수 삭제`]) && (await addText(page)) === (n < 5 ? `${n + 1}차 매수` : null), `${names.join(',')} · ${await addText(page)}`);
    }
    const h5a = await dialogHeight(page);
    await toTab(page, '목표 평단까지');
    const h5b = await dialogHeight(page);
    await toTab(page, '더 사면 평단은?');
    check(`[125-2] ${w}px — 5차까지 있어도 탭을 바꿔 창 높이 같음(${h5a} · ${h5b})`, Math.abs(h5a - h5b) < 0.5, `${h5a} ${h5b}`);
    check(`[125-6] ${w}px — 5차 · 가격 · 수량 칸 왼쪽 끝 차이 0px`, await page.locator('[data-avgcalc-panel="more"] [data-formrow-value] input').evaluateAll((els) => { const l = els.map((e) => (e.parentElement as HTMLElement).getBoundingClientRect().left); return l.length === 10 && Math.max(...l) === Math.min(...l); }));
    check(`[125-6] ${w}px — 5차 · 계산기 창 가로 넘침 없음`, !(await panelOverflow(page)));
    for (let n = 5; n >= 3; n--) await page.getByRole('button', { name: `${n}차 매수 삭제` }).click();
    check(`[125-3] ${w}px — 마지막부터 지우면 다시 [+ 3차 매수] · 결과 그대로(₩65,600)`, JSON.stringify(await steps(page)) === '["1차 매수","2차 매수"]' && (await addText(page)) === '3차 매수' && (await text(page, '[data-avgcalc-new-avg]')) === '₩65,600');
    await page.getByRole('button', { name: '2차 매수 삭제' }).click();
    check(`[124-5] ${w}px — 「삭제」 → 결과 바로 돌아옴(₩68,250) · 1차만 남으면 「삭제」 없음`, (await page.locator('[data-avgcalc-line]').count()) === 1 && (await text(page, '[data-avgcalc-new-avg]')) === '₩68,250' && (await removeNames(page)).length === 0);

    // ── 거꾸로 계산(「목표 평단까지」 탭) ──
    await toTab(page, '목표 평단까지');
    await page.locator('[data-avgcalc-target]').fill('68500');
    check(`[124-5] ${w}px — 목표 ₩68,500 → 「지금 가격 ₩65,000에 22주 더 사면 됩니다(₩1,430,000 필요)」`, (await text(page, '[data-avgcalc-reverse]')) === '지금 가격 ₩65,000에 22주 더 사면 됩니다(₩1,430,000 필요)', await text(page, '[data-avgcalc-reverse]'));
    await page.locator('[data-avgcalc-target]').fill('64000');
    check(`[124-5] ${w}px — 지금 가격 ≥ 목표 → 「지금 가격으로는 목표까지 낮출 수 없어요」`, (await text(page, '[data-avgcalc-reverse]')) === '지금 가격으로는 목표까지 낮출 수 없어요');
    await page.locator('[data-avgcalc-target]').fill('72000');
    check(`[124-5] ${w}px — 목표 ≥ 지금 평균 → 안내`, (await page.locator('[data-avgcalc-reverse="above-avg"]').count()) === 1);
    check(`[124-5] ${w}px — 맨 아래 「계산만 해요 — 시트에 쓰지 않습니다」(둘째 탭에도)`, (await text(page, '[data-avgcalc-note]')) === '계산만 해요 — 시트에 쓰지 않습니다' && (await page.locator('[data-avgcalc-note]').isVisible()) && (await page.locator('[data-avgcalc-now-price]').isVisible()));
    await toTab(page, '더 사면 평단은?');
    check(`[125-2] ${w}px — 탭을 바꿔도 값 유지(첫째 탭 60,000 · 10 · 결과 ₩68,250)`, (await val(page, '[data-avgcalc-price]')) === '60,000' && (await val(page, '[data-avgcalc-qty]')) === '10' && (await text(page, '[data-avgcalc-new-avg]')) === '₩68,250');
    await toTab(page, '목표 평단까지');
    check(`[125-2] ${w}px — 탭을 바꿔도 값 유지(둘째 탭 목표 72,000)`, (await val(page, '[data-avgcalc-target]')) === '72,000');
    check(`[124-5] ${w}px — 계산기 창 가로 넘침 없음`, !(await panelOverflow(page)));

    // ── 계산만 — 닫고 다시 열면 비어 있음 ──
    await closeCalc(page);
    await openCalc(page, 6);
    check(`[125-2] ${w}px — 닫고 다시 열면 첫째 탭`, (await selectedTab(page)) === '더 사면 평단은?');
    check(`[124-4] ${w}px — 닫고 다시 열면 두 탭 입력 비어 있음(첫 줄 지금 가격만 · 1차만 · 목표 빈칸)`, (await page.locator('[data-avgcalc-line]').count()) === 1 && (await val(page, '[data-avgcalc-price]')) === '65,000' && (await val(page, '[data-avgcalc-qty]')) === '' && (await val(page, '[data-avgcalc-target]')) === '' && (await page.locator('[data-avgcalc-new-avg]').count()) === 0);
    await page.keyboard.press('Escape');
    await page.locator('[data-avgcalc]').waitFor({ state: 'detached', timeout: 5000 });

    // ── 미국 — 달러 · 원화 환산 없음 ──
    await openCalc(page, 5);
    check(`[124-5] ${w}px — 미국: 지금 가격 $95.50 · 첫 줄 95.5`, (await text(page, '[data-avgcalc-now-price]')) === '$95.50' && (await val(page, '[data-avgcalc-price]')) === '95.5');
    await page.locator('[data-avgcalc-price]').fill('90');
    await page.locator('[data-avgcalc-qty]').fill('2.5');
    check(`[124-5] ${w}px — 미국 결과 $99.3621 · 15주 · $225.00`, (await text(page, '[data-avgcalc-new-avg]')) === '$99.3621' && (await text(page, '[data-avgcalc-new-qty]')) === '15주' && (await text(page, '[data-avgcalc-cost]')) === '$225.00');
    await toTab(page, '목표 평단까지');
    await page.locator('[data-avgcalc-target]').fill('100');
    check(`[124-5] ${w}px — 미국 거꾸로 계산 3.429167주 · $327.49(돈은 소수 2자리)`, (await text(page, '[data-avgcalc-reverse]')) === '지금 가격 $95.50에 3.429167주 더 사면 됩니다($327.49 필요)', await text(page, '[data-avgcalc-reverse]'));
    check(`[124-5] ${w}px — 미국은 원화(₩) 환산을 보이지 않음`, !(await text(page, '[data-avgcalc]')).includes('₩'));
    await closeCalc(page);

    // ── 지금 가격 없음 ──
    await openCalc(page, 16);
    check(`[124-5] ${w}px — 지금 가격 없음 안내 · 첫 줄 가격 빈칸`, (await page.locator('[data-avgcalc-no-price]').count()) === 1 && (await text(page, '[data-avgcalc-no-price]')) === '지금 가격 없음' && (await val(page, '[data-avgcalc-price]')) === '');
    await toTab(page, '목표 평단까지');
    await page.locator('[data-avgcalc-target]').fill('10');
    check(`[124-5] ${w}px — 가격 없으면 거꾸로 계산 안내`, (await page.locator('[data-avgcalc-reverse="no-price"]').count()) === 1);
    await closeCalc(page);

    check(`[124-4][125-5] ${w}px — 계산기에서 무엇을 해도(탭 · 차수 더하기 · 지우기 포함) 서버 쓰기 요청 0`, writes.length === 0, writes.join(','));
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

  // ── 긴 이름 — 이름만 말줄임 · 티커는 보임(계산기 · 매수 창) ──
  {
    const { page, ctx } = await open(browser, { size: { width: 1280, height: 1080 } });
    await openCalc(page, 7);
    const sym = await page.evaluate(() => {
      const s = document.querySelector('[data-avgcalc-symbol]') as HTMLElement;
      const dd = s.parentElement as HTMLElement;
      return { text: s.textContent, inside: s.getBoundingClientRect().right <= dd.getBoundingClientRect().right + 0.5, w: s.getBoundingClientRect().width, cut: s.scrollWidth > s.clientWidth };
    });
    check('[124-5] 긴 이름 — 계산기 머리 티커(BBBB)가 잘리지 않고 보임', sym.text === 'BBBB' && sym.inside && sym.w > 0 && !sym.cut, JSON.stringify(sym));
    await closeCalc(page);
    await page.locator('[data-trade-buy="7"]').click();
    const tsym = await page.evaluate(() => {
      const s = document.querySelector('[data-trade-symbol]') as HTMLElement;
      const dd = s.parentElement as HTMLElement;
      return { text: s.textContent, inside: s.getBoundingClientRect().right <= dd.getBoundingClientRect().right + 0.5, w: s.getBoundingClientRect().width };
    });
    check('[124-5] 긴 이름 — 매수 창 머리 티커도 보임(같은 모양)', tsym.text === 'BBBB' && tsym.inside && tsym.w > 0, JSON.stringify(tsym));
    await ctx.close();
  }

  // ── 760px 넘침 ──
  {
    const { page, ctx } = await open(browser, { size: { width: 760, height: 1080 } });
    await page.locator('[data-avgcalc-open="7"]').scrollIntoViewIfNeeded();
    await openCalc(page, 7);
    for (let n = 2; n <= 5; n++) await page.locator('[data-avgcalc-add]').click();
    check('[125-6] 760px — 계산기 창 가로 넘침 없음(긴 이름 · 5차)', !(await panelOverflow(page)));
    const l760 = await page.locator('[data-avgcalc] [data-formrow-value] input').evaluateAll((els) => els.map((e) => (e.parentElement as HTMLElement).getBoundingClientRect().left));
    check('[125-6] 760px — 칸 왼쪽 끝 차이 0px(5차 10칸 + 목표)', l760.length === 11 && Math.max(...l760) === Math.min(...l760), l760.join(','));
    await toTab(page, '목표 평단까지');
    await page.locator('[data-avgcalc-target]').fill('1000');
    check('[125-6] 760px — 「목표 평단까지」 탭 가로 넘침 없음(목표 안내)', !(await panelOverflow(page)) && (await page.locator('[data-avgcalc-reverse]').isVisible()));
    await ctx.close();
  }
  // ── 이름 — 화면 코드 · 시험에 옛 이름 0곳(지난 changelog 항목 · 이 시험 파일 · 계산 식 주석은 제외) ──
  {
    const old = ['물타기', '계산기'].join(' ');
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const f = path.join(dir, e.name);
        if (e.isDirectory()) walk(f);
        else if (/\.(tsx?|css)$/.test(e.name) && !f.endsWith('changelog.ts') && !f.endsWith('assetAverageUiSelfTest.ts') && !f.endsWith(path.join('utils', 'assetAverage.ts')) && fs.readFileSync(f, 'utf8').includes(old)) hits.push(path.relative(root, f));
      }
    };
    walk(path.join(root, 'src'));
    walk(path.join(root, 'scripts'));
    check(`[125-1] 화면 코드 · 시험에 「${old}」 0곳(지난 changelog 제외)`, hits.length === 0, hits.join(','));
  }
} finally {
  await guard.step('브라우저 닫기', () => browser.close());
  await guard.step('Vite 닫기', () => vite.close());
  guard.stop();
}
console.log(`\n결과: PASS ${pass} · FAIL ${fail}`);
process.exit(fail > 0 ? 1 : 0);
