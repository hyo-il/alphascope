/**
 * 평단 계산기 화면 시험(124차 · v2.68.0 · 125차 · v2.68.1 · 126차 · v2.68.2) — `npm run assetavgui:test` · ⚠️ `DB_PATH=<사본>` 으로만 돈다(맨 첫 import · DB 는 쓰지 않는다).
 *
 * 124차 지시서 「꼭 지킬 동작」 4 · 5 · 125차 1 · 2 · 3 · 5 · 6 · 126차 1 · 2 · 3 · 5 · 6 을 확인한다(시험 이름 앞의 [124-n] · [125-n] · [126-n]). Vite + Playwright, `/api` 는 모두 `page.route` 가짜(만든 값) —
 * 구글 · 토스 · 서버 호출 0. 계산기를 쓰는 동안 서버 쓰기 요청(POST · PUT · PATCH · DELETE)을 센다(잠금 시간 알림 `asset/touch` 는 화면 아무 곳을 눌러도 가는 것이라 뺀다).
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { assetHistorySample, assetSheetSample, assetStatusSample, assetSummarySample, assetTradesSample } from './fixtures/asset/screenSample';
import { createBrowserStepGuard } from './lib/browserStepGuard';
import { formatAssetPrice, formatAssetQty } from '../src/utils/assetFormat';

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
  // tsx(esbuild) 가 함수에 넣는 __name 도우미 — 브라우저에는 없어서 측정 함수 안의 이름 붙은 함수가 깨진다
  await ctx.addInitScript('window.__name = (f) => f');
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
const removeNames = (page: Page) => page.locator('[data-avgcalc-panel="more"]').getByRole('button', { name: / 삭제$/ }).evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
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

    // ── 평단 계산기 아이콘 버튼 — 종목 줄마다 · 회색 ──
    const rows = await page.locator('[data-account-cards] [data-trade-cell]').count();
    const calcs = await page.locator('[data-account-cards] [data-avgcalc-open]').count();
    check(`[124-5] ${w}px — 평단 계산기 버튼이 종목 줄마다(${calcs}/${rows})`, rows === 10 && calcs === rows, `${calcs}/${rows}`);
    const icons = await page.locator('[data-account-cards] [data-avgcalc-open]').evaluateAll((els) => els.map((e) => ({ text: (e.textContent ?? '').trim(), svg: e.querySelector('svg.lucide-calculator') != null, title: e.getAttribute('title'), tip: e.getAttribute('data-tip'), label: e.getAttribute('aria-label') })));
    check(`[126-1] ${w}px — 종목 줄마다 계산기 아이콘만(글자 없음) · 툴팁 「평단 계산기」(128차부터 앱 툴팁 data-tip · title 없음) · aria-label 「<종목> 평단 계산기」`, icons.length === 10 && icons.every((b) => b.text === '' && b.svg && b.title == null && b.tip === '평단 계산기' && b.label?.endsWith(' 평단 계산기')), JSON.stringify(icons[0]));
    const nameCell = await page.evaluate(() => {
      const span = document.querySelector('[data-avgcalc-open="6"]')!.closest('tr')!.querySelector('td span.truncate') as HTMLElement;
      return Math.round(span.getBoundingClientRect().width * 10) / 10;
    });
    console.log(`  (보고용) ${w}px 계좌별 표 이름 칸 폭 ${nameCell}px`);
    if (w === 1280) check(`[126-1] 1280px — 이름 칸 폭이 148px 보다 넓음(${nameCell}px)`, nameCell > 148, String(nameCell));
    const look = await page.evaluate(() => {
      const calcEl = document.querySelector('[data-avgcalc-open="6"]') as HTMLElement;
      const buyEl = document.querySelector('[data-trade-buy="6"]') as HTMLElement;
      const calc = calcEl.getBoundingClientRect();
      const buy = buyEl.getBoundingClientRect();
      const muted = document.createElement('span');
      muted.className = 'text-text-muted';
      document.body.append(muted);
      const gray = getComputedStyle(muted).color;
      muted.remove();
      return { color: getComputedStyle(calcEl).color, gray, bg: getComputedStyle(calcEl).backgroundColor, buyBg: getComputedStyle(buyEl).backgroundColor, h: calc.height, buyH: buy.height };
    });
    check(`[126-1] ${w}px — 아이콘은 회색(text-muted) · 매수 · 매도 색 아님 · 높이 = [매수] sm 높이(${look.h}px)`, look.color === look.gray && look.bg !== look.buyBg && look.h === look.buyH, JSON.stringify(look));
    await page.locator('[data-avgcalc-open="6"]').focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    const ring = await page.evaluate(() => { const e = document.activeElement as HTMLElement; const cs = getComputedStyle(e); return { calc: e.hasAttribute('data-avgcalc-open'), visible: e.matches(':focus-visible'), outline: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0 }; });
    check(`[126-1] ${w}px — 키보드 초점 표시(:focus-visible 테두리)`, ring.calc && ring.visible && ring.outline, JSON.stringify(ring));
    check(`[124-5] ${w}px — [매수] 가 없는 줄(이을 수식 없는 줄)에도 평단 계산기 아이콘`, (await page.locator('[data-trade-buy="14"]').count()) === 0 && (await page.locator('[data-avgcalc-open="14"]').count()) === 1);
    check(`[124-5] ${w}px — 평단 계산기 아이콘이 [매수] [매도] 옆(같은 칸 · 오른쪽)`, await page.evaluate(() => {
      const s = document.querySelector('[data-trade-sell="6"]')!.getBoundingClientRect();
      const c = document.querySelector('[data-avgcalc-open="6"]')!.getBoundingClientRect();
      return c.left > s.right && Math.abs(c.top - s.top) < 1 && c.right <= innerWidth;
    }));

    // ── 표 숫자 표시 — 「$12.50 · 30주」 ──
    const cells = await page.evaluate(() => {
      const [us, kr, etf] = ['5', '6', '7'].map((r) => Array.from(document.querySelector(`[data-avgcalc-open="${r}"]`)!.closest('tr')!.querySelectorAll('td')).map((td) => (td.textContent ?? '').trim()));
      return { us, kr, etf };
    });
    check(`[126-3] ${w}px — 계좌별 표: 미국 「12.5주 · $101.23」 · 국내 「30주 · ₩71,000」 · ETF 「4주 · $1,250.50」`, cells.us[3] === '12.5주' && cells.us[4] === '$101.23' && cells.kr[3] === '30주' && cells.kr[4] === '₩71,000' && cells.etf[3] === '4주' && cells.etf[4] === '$1,250.50', JSON.stringify([cells.us.slice(3, 5), cells.kr.slice(3, 5), cells.etf.slice(3, 5)]));

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
    const above = await page.evaluate(() => {
      const box = (document.querySelector('[data-avgcalc-result]') as HTMLElement).getBoundingClientRect();
      const body = (document.querySelector('[data-avgcalc]') as HTMLElement).parentElement as HTMLElement; // Dialog 몸통(스크롤)
      const b = body.getBoundingClientRect();
      return { boxTop: box.top, boxBottom: box.bottom, firstInput: (document.querySelector('[data-avgcalc-price]') as HTMLElement).getBoundingClientRect().top, bodyTop: b.top, bodyBottom: b.bottom, scrollTop: body.scrollTop };
    });
    check(`[126-2] ${w}px — 「더 사면 평단은?」 5차 · 결과 상자가 창 안에 보임(5차 칸으로 스크롤한 채 · 위 끝 ${Math.round(above.boxTop - above.bodyTop)}px)`, above.boxTop >= above.bodyTop - 0.5 && above.boxBottom <= above.bodyBottom, JSON.stringify(above));
    const lastQty = await page.evaluate(() => {
      const body = (document.querySelector('[data-avgcalc]') as HTMLElement).parentElement as HTMLElement;
      body.scrollTop = body.scrollHeight;
      const box = (document.querySelector('[data-avgcalc-result]') as HTMLElement).getBoundingClientRect();
      const q = Array.from(document.querySelectorAll('[data-avgcalc-qty]')).pop() as HTMLElement;
      const b = body.getBoundingClientRect();
      const qr = q.getBoundingClientRect();
      return { boxTop: box.top, boxBottom: box.bottom, bodyTop: b.top, bodyBottom: b.bottom, qTop: qr.top, qBottom: qr.bottom, hit: document.elementFromPoint(qr.left + 5, qr.top + qr.height / 2) === q };
    });
    check(`[126-2] ${w}px — 5차 · 맨 아래까지 스크롤해도 결과 상자 보임 · 5차 수량 칸도 보이고 가려지지 않음`, lastQty.boxTop >= lastQty.bodyTop - 0.5 && lastQty.boxBottom <= lastQty.qTop && lastQty.qBottom <= lastQty.bodyBottom && lastQty.hit, JSON.stringify(lastQty));
    await page.evaluate(() => (((document.querySelector('[data-avgcalc]') as HTMLElement).parentElement as HTMLElement).scrollTop = 0));
    const firstBelow = await page.evaluate(() => (document.querySelector('[data-avgcalc-result]') as HTMLElement).getBoundingClientRect().bottom <= (document.querySelector('[data-avgcalc-price]') as HTMLElement).getBoundingClientRect().top);
    check(`[126-2] ${w}px — 맨 위에서 결과 상자가 첫 입력 칸보다 위`, firstBelow);
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
    check(`[126-2] ${w}px — 「목표 평단까지」 결과 상자가 입력 칸보다 위`, await page.evaluate(() => (document.querySelector('[data-avgcalc-target-result]') as HTMLElement).getBoundingClientRect().bottom <= (document.querySelector('[data-avgcalc-target]') as HTMLElement).getBoundingClientRect().top));
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
    check(`[124-5][126-3] ${w}px — 미국 결과 $99.36 · 15주 · $225.00(표시 소수 2자리)`, (await text(page, '[data-avgcalc-new-avg]')) === '$99.36' && (await text(page, '[data-avgcalc-new-qty]')) === '15주' && (await text(page, '[data-avgcalc-cost]')) === '$225.00', await text(page, '[data-avgcalc-new-avg]'));
    await toTab(page, '목표 평단까지');
    await page.locator('[data-avgcalc-target]').fill('100');
    check(`[126-3] ${w}px — 미국 목표 수량 3.429167 → 「3.43주」(소수 2자리 올림) · $327.49`, (await text(page, '[data-avgcalc-reverse]')) === '지금 가격 $95.50에 3.43주 더 사면 됩니다($327.49 필요)', await text(page, '[data-avgcalc-reverse]'));
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
  // ── 127차 — 자산 현황 「종목별」 표 이름 칸(「있는 계좌」 칸은 계좌 사이에서 줄바꿈 · 칸 폭 고정) ──
  for (const size of [{ width: 1280, height: 1080 }, { width: 1440, height: 900 }]) {
    const w = size.width;
    const { page, ctx } = await open(browser, { size });
    await page.getByRole('radio', { name: '종목별' }).click();
    await page.locator('[data-symbol-table]').waitFor({ timeout: 5000 });
    const m = await page.evaluate(() => {
      const table = document.querySelector('[data-symbol-table]') as HTMLElement;
      const ths = [...table.querySelectorAll('thead th')].map((th) => Math.round(th.getBoundingClientRect().width * 10) / 10);
      const names = [...table.querySelectorAll('tbody tr[data-symbol-row] td:first-child span')] as HTMLElement[];
      const nameW = Math.round(names[0].getBoundingClientRect().width * 10) / 10;
      // 짧은 이름(한글 6자 · 영문 10자) — 같은 글꼴로 잰 글자 폭이 이름 칸에 들어가는지
      const probe = (t: string) => {
        const s = document.createElement('span');
        s.style.cssText = `font:${getComputedStyle(names[0]).font};white-space:nowrap;position:absolute;visibility:hidden`;
        s.textContent = t;
        document.body.appendChild(s);
        const x = s.getBoundingClientRect().width;
        s.remove();
        return x;
      };
      const cut = names.filter((n) => n.scrollWidth > n.clientWidth + 0.5).map((n) => n.textContent);
      const right = [...table.querySelectorAll('tbody tr[data-symbol-row]')].map((tr) => [...tr.querySelectorAll('td')].slice(5).map((td) => getComputedStyle(td).textAlign).join('/'));
      const nums = [...table.querySelectorAll('tbody tr[data-symbol-row="0072R0"], tbody tr[data-symbol-row="AAAA"]')].map((tr) => [...tr.querySelectorAll('td')].slice(5).map((td) => (td.textContent ?? '').trim()).join('|'));
      return { ths, nameW, ko6: probe('가나다라마바'), en10: probe('ABCDEFGHIJ'), cut, right, nums, overflow: table.scrollWidth > (table.parentElement as HTMLElement).clientWidth + 0.5 };
    });
    console.log(`  (보고용) ${w}px 종목별 표 이름 칸 폭 ${m.nameW}px · 칸 폭 ${m.ths.join(' / ')}`);
    if (w === 1280) check(`[127-1] 1280px — 종목별 표 이름 칸이 계좌별 표와 비슷하게 넓음(전 96px → ${m.nameW}px · 180px 이상)`, m.nameW >= 180, JSON.stringify(m.ths));
    check(`[127-1] ${w}px — 짧은 이름(한글 6자 ${Math.round(m.ko6)}px · 영문 10자 ${Math.round(m.en10)}px)이 이름 칸에 들어감 · 가짜 값의 긴 이름 하나만 말줄임 · 표 가로 넘침 없음`, m.ko6 <= m.nameW && m.en10 <= m.nameW && m.cut.length === 1 && /아주 긴/.test(String(m.cut[0])) && !m.overflow, JSON.stringify({ cut: m.cut, nameW: m.nameW }));
    check(`[127-1] ${w}px — 수량 · 평가 금액 · 비중 칸 오른쪽 정렬 · 표시 그대로(formatAssetQty · 원 · 소수 1자리 %)`, m.right.every((r) => r === 'right/right/right') && m.nums.length === 2 && m.nums.every((t) => /^[\d,.]+주\|₩[\d,]+\|\d+\.\d%$/.test(t)) && m.nums.some((t) => t.startsWith(`${formatAssetQty(1500.25)}|₩2,765,431,209|`)) && m.nums.some((t) => t.startsWith(`${formatAssetQty(12.5)}|₩691,357,803|`)), JSON.stringify(m.nums));
    await ctx.close();
  }

  // ── 탭 줄 비침 — 1440 · 스크롤해 도구 줄 끝이 3px 남을 때 가림 띠가 그 자리를 덮는다 ──
  {
    const { page, ctx } = await open(browser, { size: { width: 1440, height: 900 } });
    const tabsBox = (await page.getByRole('tablist', { name: '자산 관리 보기' }).boundingBox())!;
    const m = await page.evaluate((tabsBottom) => {
      const sc = document.querySelector('[data-asset-scroll]') as HTMLElement;
      const tool = document.querySelector('[data-open-class-dialog]') as HTMLElement;
      sc.scrollTop = tool.getBoundingClientRect().bottom - sc.getBoundingClientRect().top - 3;
      const s = sc.getBoundingClientRect();
      // 127차 — 가림 띠는 공용 `ui/ScrollTopShade`(띠 = `[data-scroll-shade]` · 앞에 그리는 z 는 높이 0 sticky 틀)
      const band = sc.querySelector('[data-scroll-shade]') as HTMLElement;
      const c = band.getBoundingClientRect();
      const t = tool.getBoundingClientRect();
      const cs = { zIndex: getComputedStyle(band.parentElement as HTMLElement).zIndex, backgroundImage: getComputedStyle(band).backgroundImage };
      const content = sc.clientWidth - parseFloat(getComputedStyle(sc).paddingLeft) - parseFloat(getComputedStyle(sc).paddingRight);
      return { scrollTop: sc.scrollTop, coverTop: c.top - s.top, coverH: c.height, coverW: c.width, scrollW: content, toolLeft: t.left, coverLeft: c.left, sliver: t.bottom - s.top, z: cs.zIndex, bg: cs.backgroundImage, tabsBottom, scrollTopEdge: s.top };
    }, tabsBox.y + tabsBox.height);
    check('[126-5] 1440px 스크롤 — 탭 줄 바로 밑 가림 띠가 스크롤 영역 위 끝에 붙고(0px) · 내용 폭 전체 · 잘린 도구 줄 끝(3px)보다 높고 · 앞에 그려짐', m.scrollTop > 0 && Math.abs(m.coverTop) < 0.5 && m.coverH >= 12 && m.sliver > 0 && m.sliver < m.coverH && m.z === '10' && m.bg.startsWith('linear-gradient') && Math.abs(m.coverW - m.scrollW) < 0.5 && m.coverLeft <= m.toolLeft + 0.5 && m.scrollTopEdge >= m.tabsBottom - 0.5, JSON.stringify(m));
    await page.evaluate(() => ((document.querySelector('[data-asset-scroll]') as HTMLElement).scrollTop = 0));
    const top0 = await page.evaluate(() => {
      const sc = document.querySelector('[data-asset-scroll]') as HTMLElement;
      const c = (sc.querySelector('[data-scroll-shade]') as HTMLElement).getBoundingClientRect();
      const first = (document.querySelector('[data-open-class-dialog]') as HTMLElement).getBoundingClientRect();
      // 가림 띠 틀 다음의 첫 내용 상자 — 위 여백 12px 아래 그대로(띠가 자리를 차지하거나 내용을 끌어올리지 않음)
      const box = (sc.children[1] as HTMLElement).getBoundingClientRect();
      return { coverBottom: c.bottom, firstTop: first.top, boxTop: box.top - sc.getBoundingClientRect().top, pad: parseFloat(getComputedStyle(sc).paddingTop) };
    });
    check('[126-5] 1440px 맨 위 — 가림 띠는 빈 위 여백 위에만(내용과 겹침 0)', top0.coverBottom <= top0.firstTop + 0.5, JSON.stringify(top0));
    check('[127-2] 1440px 맨 위 — 첫 내용 상자가 위 여백(12px) 아래 그대로 · 가림 띠 아래 끝 = 첫 내용 위 끝(겹침 0)', top0.pad === 12 && Math.abs(top0.boxTop - 12) < 0.5 && top0.coverBottom <= top0.firstTop + 0.5, JSON.stringify(top0));
    await ctx.close();
  }
  // ── 127차 — 총 자산 탭도 맨 위 첫 카드가 띠 밑에 깔리지 않음(126차에는 위 여백이 사라져 카드 위 12px 가 덮였다) ──
  for (const size of [{ width: 1280, height: 1080 }, { width: 1440, height: 900 }]) {
    const { page, ctx } = await open(browser, { size });
    await page.getByRole('tab', { name: '총 자산' }).click();
    await page.waitForTimeout(400);
    const g = await page.evaluate(() => {
      const sc = document.querySelector('[data-asset-scroll]') as HTMLElement;
      const band = (sc.querySelector('[data-scroll-shade]') as HTMLElement).getBoundingClientRect();
      const box = (sc.children[1] as HTMLElement).getBoundingClientRect();
      return { boxTop: box.top - sc.getBoundingClientRect().top, bandBottom: band.bottom - sc.getBoundingClientRect().top };
    });
    check(`[127-2] ${size.width}px 총 자산 맨 위 — 첫 카드 위 끝 12px · 가림 띠와 겹침 0`, Math.abs(g.boxTop - 12) < 0.5 && g.bandBottom <= g.boxTop + 0.5, JSON.stringify(g));
    await ctx.close();
  }

  // ── 127차 — 가림 띠 공용 부품 하나(소스 검사) ──
  {
    const read = (f: string) => fs.readFileSync(path.join(root, f), 'utf8');
    const screens = ['src/components/asset/AssetDashboard.tsx', 'src/components/swing/BuyJudgeView.tsx', 'src/components/surge/SurgeDashboard.tsx', 'src/components/records/RecordsView.tsx'];
    const notUsing = screens.filter((f) => !/<ScrollTopShade \/>/.test(read(f)));
    const oldLeft: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const f = path.join(dir, e.name);
        if (e.isDirectory()) walk(f);
        else if (/\.tsx?$/.test(e.name) && !f.endsWith(path.join('ui', 'ScrollTopShade.tsx')) && /data-asset-scroll-cover|from-bg-primary from-50% to-transparent/.test(read(path.relative(root, f)))) oldLeft.push(path.relative(root, f));
      }
    };
    walk(path.join(root, 'src'));
    check('[127-2] 가림 띠는 공용 부품 하나(ui/ScrollTopShade) — 자산 · 매수 판단 · 급등 탐지 · 검증 기록이 같이 씀 · 자산 화면 옛 코드 · 다른 곳의 같은 띠 0곳', notUsing.length === 0 && oldLeft.length === 0, JSON.stringify({ notUsing, oldLeft }));
  }

  // ── 숫자 표시 함수 한 곳 ──
  {
    const cases: [string, string][] = [
      [formatAssetQty(30), '30주'], [formatAssetQty(0.5), '0.5주'], [formatAssetQty(12.5), '12.5주'], [formatAssetQty(2.0), '2주'], [formatAssetQty(1234.567), '1,234.57주'], [formatAssetQty(0.1 + 0.2), '0.3주'],
      [formatAssetQty(3.429167, { ceil: true }), '3.43주'], [formatAssetQty(3.43, { ceil: true }), '3.43주'], [formatAssetQty(22, { ceil: true }), '22주'], [formatAssetQty(null), '—'],
      [formatAssetPrice(71000.4, 'KRW'), '₩71,000'], [formatAssetPrice(12.5, 'USD'), '$12.50'], [formatAssetPrice(1250.5, 'USD'), '$1,250.50'], [formatAssetPrice(101.2345, 'USD'), '$101.23'],
    ];
    const bad = cases.filter(([a, b]) => a !== b);
    check(`[126-3] formatAssetQty · formatAssetPrice — 「30주」 · 「0.5주」 · 올림 「3.43주」 · 원 정수 · $ 소수 2자리(${cases.length}가지)`, bad.length === 0, JSON.stringify(bad));
    const files = ['AssetSheetValues', 'AssetSymbolTable', 'AssetAverageCalculator', 'AssetTradeDialog', 'AssetNewBuyDialog', 'AssetTradeHistoryDialog'];
    const notUsing = files.filter((f) => !/from '\.\.\/\.\.\/utils\/assetFormat'/.test(fs.readFileSync(path.join(root, 'src/components/asset', `${f}.tsx`), 'utf8')));
    const oldLeft: string[] = [];
    const walkOld = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const f = path.join(dir, e.name);
        if (e.isDirectory()) walkOld(f);
        else if (/\.tsx?$/.test(e.name) && /\b(tradeQtyText|tradeMoneyText|costText|decimalsOf|avgText|qtyDigits)\b/.test(fs.readFileSync(f, 'utf8'))) oldLeft.push(path.relative(root, f));
      }
    };
    walkOld(path.join(root, 'src'));
    check('[126-3] 표 · 종목별 표 · 계산기 · 매수/매도 창 · 새 종목 창 · 기록 창이 같은 표시 함수(assetFormat) · 옛 표시 함수 0곳', notUsing.length === 0 && oldLeft.length === 0, JSON.stringify({ notUsing, oldLeft }));
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
