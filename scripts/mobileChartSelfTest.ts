/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
/**
 * 157차 폰 차트 화면 시험(`npm run mobilechart:test` · v2.82.0) — 지시서 「꼭 지킬 동작」 1 ~ 13 줄마다 + 점검 목록 「차트」 · 「빠른 주문」 줄(50 ~ 75)마다 하나씩.
 *
 * 화면은 이 시험이 띄운 Vite(5184)에 열고, `/api` 는 모두 가짜 응답 — `scripts/fixtures/mobileChart/api.json`
 * (사본 DB 테스트 서버에서 한 번 기록한 응답 · 관심 목록은 만든 값 · 실제 계좌 보유 응답은 뺌). 모르는 주소는 503 · 쓰기는 주문(`POST /api/paper/orders`)만
 * 받아 몸을 적어 두고 가짜로 답한다(실제 주문 0 · 서버로 가지 않음). 시계는 고정.
 * 폰 · 패드는 `isMobile` · `hasTouch`(손가락 화면).
 * 1 은 기준 커밋(1989b23 · v2.81.0)에서 같은 가짜 응답 · 같은 시계로 잰 큰 화면 정답 파일(`desk.json`)과 견준다 —
 *   보이는 요소마다 「태그 · 클래스(낱말 순서 맞춤 · 폰 · 패드 · 손가락에서만 켜지는 이름 뺌) · 자리 · 크기」 가 같아야 한다(146 ~ 150 과 같음).
 *   정답 파일을 다시 만들 때: 기준 커밋 worktree 에 이 파일 · 견본을 넣고 `CAPTURE=<저장 경로> npx tsx scripts/mobileChartSelfTest.ts`.
 * 누르는 칸(44 미만 · 겹침)은 `design:check` 18 · 19 와 같은 셈을 **그 화면 본문 · 열린 창 안**으로만 잰다(위쪽 막대 · 시황 띠 · 패드 메뉴는 앱 틀 — 다른 차수).
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { chromium, type Browser, type Page } from 'playwright';
import { createBrowserStepGuard } from './lib/browserStepGuard';
import { chasuChanged, chasuPatch, type Chasu } from './lib/chasuRange';

const root = path.resolve(import.meta.dirname, '..');
const PORT = 5184;
const WEB = `http://127.0.0.1:${PORT}`;
/** 기준 커밋(v2.81.0) — 1 의 정답 파일 · 12 는 여기서부터 이번 차수 범위 */
const BASE = '1989b23';
const CHASU: Chasu = { base: BASE, version: 'v2.82.0' };
const FIX = path.join(root, 'scripts/fixtures/mobileChart');
const FIXTURE = path.join(FIX, 'desk.json');
const API: Record<string, unknown> = JSON.parse(fs.readFileSync(path.join(FIX, 'api.json'), 'utf8'));
const CAPTURE = process.env.CAPTURE ?? '';
const FIXED = new Date('2026-11-27T05:00:00.000Z');
const CLIENT_VERSION = /version: '(v[\d.]+)'/.exec(fs.readFileSync(path.join(root, 'src/data/changelog.ts'), 'utf8'))?.[1] ?? '';

const guard = createBrowserStepGuard();
let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = '') {
  guard.mark(name);
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? ` — ${detail}` : ''}`);
}

const PHONE = { width: 402, height: 874 };
const PHONE_WIDE = { width: 874, height: 402 };
const PAD = { width: 1133, height: 744 };
const DESK_SIZES = [{ width: 1280, height: 1080 }, { width: 1440, height: 900 }];
const DESK_TABS = ['기업정보', '투자자 동향', '뉴스', 'AI 분석'];

/** 가짜 응답 찾기 — 주소 그대로 → 같은 경로(쿼리 다름) 첫 것 */
function reply(u: string): unknown | undefined {
  if (u in API) return API[u];
  const p = u.split('?')[0];
  const k = Object.keys(API).find((x) => x.split('?')[0] === p);
  return k ? API[k] : undefined;
}

type Opened = { page: Page; ctx: Awaited<ReturnType<Browser['newContext']>>; errors: string[]; orders: string[] };
async function open(browser: Browser, size: { width: number; height: number }, hash = '#/home', init = ''): Promise<Opened> {
  const mobile = size.width < 1280;
  const ctx = await browser.newContext(mobile ? { viewport: size, isMobile: true, hasTouch: true } : { viewport: size });
  await ctx.addInitScript('window.__name = (f) => f');
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  await page.clock.setFixedTime(FIXED);
  const errors: string[] = [];
  const orders: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
  await page.route(/\/api\//, async (r) => {
    const req = r.request();
    const u = req.url().replace(WEB, '');
    if (u.startsWith('/api/auth/me')) return r.fulfill({ json: { ok: true } });
    if (u.startsWith('/api/version')) return r.fulfill({ json: { version: CLIENT_VERSION, startedAt: '2026-11-25T00:00:00.000Z' } });
    if (req.method() === 'POST' && u === '/api/paper/orders') {
      orders.push(`${u} ${req.postData()}`);
      return r.fulfill({ json: { pending: true, order: { id: 1 } } });
    }
    if (req.method() !== 'GET') return r.fulfill({ status: 503, json: { error: '시험 — 쓰지 않음' } });
    const j = reply(u);
    if (j !== undefined) return r.fulfill({ json: j });
    return r.fulfill({ status: 503, json: { error: '시험 — 없음' } });
  });
  await guard.step(`페이지 열기(${size.width}×${size.height} ${hash})`, () => page.goto(`${WEB}/${hash}`));
  await page.waitForTimeout(2500);
  await page.addStyleTag({ content: '*::-webkit-scrollbar { width: 0 !important; height: 0 !important; } * { scrollbar-width: none !important; }' });
  return { page, ctx, errors, orders };
}
/** 홈 카드 「애플」 → 차트 화면 */
async function openChart(browser: Browser, size: { width: number; height: number }, init = ''): Promise<Opened> {
  const o = await open(browser, size, '#/home', init);
  await guard.step('애플 고르기', () => o.page.getByRole('button', { name: /애플/ }).first().click({ timeout: 8000 }));
  await o.page.waitForTimeout(3500);
  return o;
}
const tab = async (page: Page, name: string) => {
  await guard.step(`탭 ${name}`, () => page.getByRole('tab', { name, exact: true }).first().click({ timeout: 5000 }));
  await page.waitForTimeout(1500);
};
const rect = (page: Page, sel: string) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height, b: r.bottom, r: r.right };
  }, sel);

/** 큰 화면 모양 — 보이는 요소마다 태그 · 클래스(낱말 순서 맞춤 · 폰 · 패드 · 손가락 이름 뺌) · 자리 · 크기(시계 · 토스트 뺌) */
async function deskSnapshot(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.body.querySelectorAll('*')) {
      if (el.closest('[data-kst-clock], [data-toast-host], script, style')) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const cls = (el.getAttribute('class') ?? '')
        .split(/\s+/)
        .filter((c) => c && !/^(touch:|phone:|pad:)/.test(c) && c !== 'touch-hit' && c !== 'touch-hit-gap')
        .sort()
        .join(' ');
      out.push(`${el.tagName}|${cls}|${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)}`);
    }
    return out;
  });
}

/**
 * 누르는 칸(design:check 18 · 19 와 같은 셈) · 같은 줄 높이 — 본문(`[data-layout-body]`) · 열린 창(`[role=dialog]`) 안만.
 * 같은 묶음 단추(radiogroup) 안끼리는 겹침을 세지 않는다. 화면 밖 캡처 차트(aria-hidden)는 뺀다.
 */
async function touchIssues(page: Page, scope = '[data-layout-body], [role="dialog"]') {
  return page.evaluate((scopeSel) => {
    const MIN = 44;
    const small: string[] = [];
    const overlap: string[] = [];
    const rows: string[] = [];
    const label = (el: Element) => ((el as HTMLElement).innerText || el.getAttribute('aria-label') || el.tagName).replace(/\s+/g, ' ').slice(0, 24);
    const dialogs = [...document.querySelectorAll('[role="dialog"]')];
    const inScope = (el: Element) => {
      const host = el.closest(scopeSel);
      if (!host) return false;
      // 창이 떠 있으면 창 안만(덮개 아래 뒤 화면은 고칠 것이 아님)
      return dialogs.length ? Boolean(el.closest('[role="dialog"]')) : true;
    };
    const hits: { el: Element; x: number; y: number; w: number; h: number }[] = [];
    const sel = 'button, a[href], [role="tab"], [role="radio"], [role="button"], [role="checkbox"], input:not([type="hidden"]), select, textarea';
    for (const el of document.querySelectorAll<HTMLElement>(sel)) {
      if ((el as HTMLButtonElement).disabled || el.closest('[inert], [aria-hidden="true"]') || !inScope(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1 || r.right <= 0 || r.left >= innerWidth || r.bottom <= 0 || r.top >= innerHeight || getComputedStyle(el).visibility === 'hidden') continue;
      const after = getComputedStyle(el, '::after');
      const on = after.content !== 'none' && after.content !== 'normal' && after.position === 'absolute';
      const w = Math.max(r.width, on ? parseFloat(after.width) || 0 : 0);
      const h = Math.max(r.height, on ? parseFloat(after.height) || 0 : 0);
      hits.push({ el, x: r.left + r.width / 2 - w / 2, y: r.top + r.height / 2 - h / 2, w, h });
      if (Math.min(w, h) < MIN - 0.5) small.push(`${label(el)} ${Math.round(w)}×${Math.round(h)}`);
    }
    for (let i = 0; i < hits.length; i++) {
      for (let j = i + 1; j < hits.length; j++) {
        const a = hits[i];
        const b = hits[j];
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const g = a.el.closest('[role="radiogroup"]');
        if (g && g === b.el.closest('[role="radiogroup"]')) continue;
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        if (ox > 2 && oy > 2) overlap.push(`${label(a.el)} ↔ ${label(b.el)} (${Math.round(ox)}×${Math.round(oy)})`);
      }
    }
    // 같은 줄 높이 — 같은 부모 줄(flex 가로)의 조작 요소(단추 · 입력 · 고르기 묶음)는 높이가 같다
    const ctrls = [...document.querySelectorAll<HTMLElement>('button, input:not([type=checkbox]):not([type=radio]), select, [role=radiogroup]')]
      // design:check 「같은 줄 높이」 와 같은 대상 — 단추는 높이 이름(h-7 · h-8)이 있는 공용 단추만 · 묶음 단추 안 칸은 묶음으로
      .filter((el) => inScope(el) && !el.closest('[aria-hidden="true"]') && (el.tagName !== 'BUTTON' || (/\bh-[78]\b/.test(el.className) && !el.closest('[role=radiogroup]'))))
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 1 && r.height > 1 && r.bottom > 0 && r.top < innerHeight;
      });
    const byRow = new Map<Element, HTMLElement[]>();
    for (const el of ctrls) {
      // 그 조작 요소를 품은 가로 줄(flex row) — 가장 가까운 것
      let row: Element | null = el.parentElement;
      for (let d = 0; row && d < 3; d++, row = row.parentElement) {
        const cs = getComputedStyle(row);
        if (cs.display.includes('flex') && !cs.flexDirection.startsWith('column')) break;
      }
      if (!row) continue;
      byRow.set(row, [...(byRow.get(row) ?? []), el]);
    }
    for (const [, els] of byRow) {
      const tops = els.map((e) => e.getBoundingClientRect());
      const sameLine = els.filter((_, i) => Math.abs(tops[i].top + tops[i].height / 2 - (tops[0].top + tops[0].height / 2)) < 4);
      const hs = [...new Set(sameLine.map((e) => Math.round(e.getBoundingClientRect().height)))];
      if (sameLine.length > 1 && hs.length > 1) rows.push(sameLine.map((e) => `${label(e)}=${Math.round(e.getBoundingClientRect().height)}`).join(' · '));
    }
    return { small, overlap, rows };
  }, scope);
}
const bgOf = (page: Page, sel: string) => page.evaluate((s) => {
  const el = document.querySelector(s);
  return el ? { bg: getComputedStyle(el).backgroundColor, fg: getComputedStyle(el).color } : null;
}, sel);
const cssColor = (page: Page, name: string) => page.evaluate((n) => {
  const d = document.createElement('div');
  d.className = n;
  document.body.appendChild(d);
  const c = getComputedStyle(d);
  const v = n.startsWith('text-') ? c.color : c.backgroundColor;
  d.remove();
  return v;
}, name);

const { createServer } = await import('vite');
const vite = await guard.step('Vite 띄우기', async () => {
  const v = await createServer({ root, configFile: path.join(root, 'vite.config.ts'), logLevel: 'error', server: { host: '127.0.0.1', port: PORT, strictPort: true, hmr: false } });
  await v.listen();
  return v;
});
const browser = await guard.step('브라우저 띄우기', () => chromium.launch({ channel: 'chrome' }));

/** 확인 창 글 + 확인 누름 → 나간 주문 몸 */
async function confirmOrder(o: Opened): Promise<{ text: string; body: string }> {
  const dlg = o.page.getByRole('dialog').last();
  await dlg.waitFor({ timeout: 5000 });
  const text = (await dlg.innerText()).replace(/\s+/g, ' ').trim();
  const before = o.orders.length;
  await guard.step('확인 창 주문', () => dlg.getByRole('button', { name: /주문$/ }).click({ timeout: 5000 }));
  await o.page.waitForTimeout(1200);
  return { text, body: o.orders.slice(before).join('\n') };
}

try {
  // ───────── 1 큰 화면 그대로 ─────────
  const deskOrders: Record<string, { text: string; body: string }> = {};
  let deskPrice = '';
  {
    const shots: Record<string, string[]> = {};
    for (const size of DESK_SIZES) {
      const o = await openChart(browser, size);
      const key = `${size.width}x${size.height}`;
      shots[`${key} 차트 처음`] = await guard.step('모양 재기', () => deskSnapshot(o.page));
      for (const t of DESK_TABS) {
        await tab(o.page, t);
        shots[`${key} 아래 탭 ${t}`] = await guard.step('모양 재기', () => deskSnapshot(o.page));
      }
      if (!CAPTURE && size.width === 1280) {
        deskPrice = await o.page.locator('header').first().innerText();
        // 5 — 1280 의 네 단추(지정가 매도 · 지정가 매수 · 시장가 매도 · 시장가 매수) 요청 · 확인 창 글
        for (const name of ['지정가 매도', '지정가 매수', '시장가 매도', '시장가 매수']) {
          await guard.step(`1280 ${name}`, () => o.page.getByRole('button', { name, exact: true }).click({ timeout: 5000 }));
          deskOrders[name] = await confirmOrder(o);
        }
      }
      await guard.step('기업 비교로', () => o.page.evaluate(() => (location.hash = '#/compare')));
      await o.page.waitForTimeout(2000);
      shots[`${key} 기업 비교`] = await guard.step('모양 재기', () => deskSnapshot(o.page));
      if (!CAPTURE && size.width === 1280) {
        const checked = await o.page.getByRole('radiogroup', { name: '보기' }).getByRole('radio', { checked: true }).innerText();
        const empty = await o.page.getByText('종목을 드래그하거나').count();
        check('[157-9] 1280 기업 비교 — 처음 4칸 · 안내 「종목을 드래그하거나 … 클릭하세요」 그대로', checked.trim() === '4개' && empty > 0, `${checked} · ${empty}`);
      }
      await o.ctx.close();
    }
    if (CAPTURE) {
      fs.mkdirSync(path.dirname(CAPTURE), { recursive: true });
      fs.writeFileSync(CAPTURE, JSON.stringify(shots, null, 0));
      console.log(`정답 파일 저장 — ${CAPTURE} (${Object.keys(shots).length}장면)`);
      await browser.close();
      await vite.close();
      process.exit(0);
    }
    const want = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) as Record<string, string[]>;
    const norm = (x: string) => x.replace(/\s+/g, ' ').replace(/ ?\| ?/g, '|');
    for (const key of Object.keys(want)) {
      const a = want[key].map(norm);
      const b = (shots[key] ?? []).map(norm);
      const i = a.findIndex((x, k) => x !== b[k]);
      const same = a.length === b.length && i < 0;
      check(`[157-1] ${key} — 기준 커밋(${BASE})과 요소 ${a.length}개 태그 · 클래스 · 자리 · 크기 같음`, same, same ? '' : `개수 ${a.length} → ${b.length} · 첫 차이 #${i}: ${a[i] ?? '-'} → ${b[i] ?? '-'}`);
    }
  }

  // ───────── 2 · 3 · 8 폰 틀 · 아래 탭 · 가격 줄 ─────────
  {
    const o = await openChart(browser, PHONE);
    const { page } = o;
    check('[157-2] 402 — 화면 모양 phone', (await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--layout-mode').trim())) === 'phone');
    const price = await rect(page, '[data-testid="phone-price-row"]');
    const chips = await rect(page, '[data-testid="phone-chip-row"]');
    const chart = await rect(page, '[data-phone-chart-box]');
    const tabs = await rect(page, '[data-testid="phone-tab-row"]');
    const order = price && chips && chart && tabs && price.y < chips.y && chips.y < chart.y && chart.y < tabs.y;
    check('[157-2] 위 → 아래 가격 줄 · 칩 줄 · 차트 · 아래 탭 차례', Boolean(order), JSON.stringify({ price, chips, chart, tabs }));
    check('[157-2] 가격 줄 56 · 칩 줄 44 · 아래 탭 줄 44', Math.round(price?.h ?? 0) === 56 && Math.round(chips?.h ?? 0) === 44 && Math.round(tabs?.h ?? 0) === 44, `${price?.h} · ${chips?.h} · ${tabs?.h}`);
    const expectH = await page.evaluate(() => {
      const top = document.querySelector('[data-testid="top-bar"]')!.getBoundingClientRect().height;
      return Math.max(240, Math.round((innerHeight - top - 56 - 44) * 0.55));
    });
    check(`[157-2] 차트 높이 = (보이는 높이 − 위쪽 막대 − 56 − 44) × 0.55 · 최소 240 (${expectH} ± 1)`, Math.abs((chart?.h ?? 0) - expectH) <= 1 && expectH >= 240, `${chart?.h}`);
    const bodyW = await page.evaluate(() => {
      const b = document.querySelector('[data-layout-body]') as HTMLElement;
      const cs = getComputedStyle(b);
      return b.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    });
    check('[157-2] 차트 폭 = 본문 폭 · 차트 오른쪽 호가 · 빠른 주문 열 없음 [점검 50]', Math.abs((chart?.w ?? 0) - bodyW) <= 1 && !(await page.evaluate(() => [...document.querySelectorAll('[data-testid="orderbook"]')].some((e) => e.getBoundingClientRect().top < document.querySelector('[data-phone-chart-box]')!.getBoundingClientRect().bottom))), `${chart?.w} vs ${bodyW}`);

    const names = await page.getByRole('tablist', { name: '차트 아래 탭' }).getByRole('tab').allInnerTexts();
    const tops = await page.getByRole('tablist', { name: '차트 아래 탭' }).getByRole('tab').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().top)));
    check('[157-3] 탭 일곱 한 줄 — 호가 · 빠른 주문 · 차트 지표 · 기업정보 · 투자자 동향 · 뉴스 · AI 분석', names.join('|') === '호가|빠른 주문|차트 지표|기업정보|투자자 동향|뉴스|AI 분석' && new Set(tops).size === 1, `${names.join('|')} · ${tops.join(',')}`);
    const selected = await page.getByRole('tablist', { name: '차트 아래 탭' }).getByRole('tab', { selected: true }).innerText();
    check('[157-3] 처음 탭 = 호가', selected.trim() === '호가', selected);
    const fade0 = await page.evaluate(() => (document.querySelector('[data-testid="phone-tab-row"]') as HTMLElement).dataset.fade ?? '');
    await page.evaluate(() => {
      const inner = document.querySelector('[data-testid="phone-tab-row"] > [data-scroll-row-inner]') as HTMLElement;
      inner.scrollLeft = inner.scrollWidth;
    });
    await page.waitForTimeout(400);
    const fade1 = await page.evaluate(() => (document.querySelector('[data-testid="phone-tab-row"]') as HTMLElement).dataset.fade ?? '');
    const fadeOpacity = await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="phone-tab-row"] > [data-scroll-fade="right"]')!).opacity);
    check('[157-3] 넘치면 오른쪽 끝 흐림 · 끝까지 밀면 오른쪽 흐림 사라짐 (R7)', fade0.includes('r') && !fade1.includes('r') && fadeOpacity === '0', `${fade0} → ${fade1} · ${fadeOpacity}`);
    const sticky = await page.evaluate(() => getComputedStyle(document.querySelector('[data-testid="phone-tab-row"]')!).position);
    check('[157-3] 탭 줄 위에 붙음(sticky)', sticky === 'sticky', sticky);

    // 51 — 아래 탭 · 값 칸이 빠른 주문 판에 가려지지 않음(탭 줄 아래에 탭 내용 · 빠른 주문은 탭 안)
    await tab(page, '차트 지표');
    const ohlc = await page.evaluate(() => (document.querySelector('[data-testid="phone-ohlc"]') as HTMLElement | null)?.innerText ?? '');
    check('[157-8] OHLC 묶음이 [차트 지표] 탭 맨 위(시 · 고 · 저 · 종)', /시 /.test(ohlc) && /고 /.test(ohlc) && /저 /.test(ohlc) && /종 /.test(ohlc), ohlc.slice(0, 80));
    const chartTop = await page.evaluate(() => Boolean(document.querySelector('[data-phone-chart-box] .tv-lightweight-charts')) && !document.querySelector('[data-phone-chart-box]')!.textContent!.includes('거래량'));
    check('[157-8] 차트 위에 OHLC 겹침 글 없음', chartTop);
    const rsiVisible = await page.getByText('RSI(14)').first().isVisible();
    const noQuick = (await page.getByRole('button', { name: '지정가 매수', exact: true }).count()) === 0;
    check('[157-51] 402 아래 탭 값 칸(RSI 등)이 보이고 빠른 주문 판이 겹치지 않음 [점검 51]', rsiVisible && noQuick);
    const pPrice = (await page.getByTestId('phone-price').innerText()).trim();
    const pChange = (await page.getByTestId('phone-change').innerText()).trim();
    check(`[157-8] 가격 줄 현재가 · 등락 = 1280 종목 머리 줄의 같은 값(${pPrice} ${pChange})`, deskPrice.includes(pPrice) && deskPrice.includes(pChange), deskPrice.replace(/\s+/g, ' ').slice(0, 120));

    // 3 — 고른 탭 기억(폰 따로)
    await tab(page, '뉴스');
    await page.reload();
    await page.waitForTimeout(2500);
    await page.getByRole('button', { name: /애플/ }).first().click().catch(() => {});
    await page.waitForTimeout(3000);
    const again = await page.getByRole('tablist', { name: '차트 아래 탭' }).getByRole('tab', { selected: true }).innerText();
    check('[157-3] 고른 탭은 다시 열어도 같음(뉴스)', again.trim() === '뉴스', again);
    await o.ctx.close();
  }

  // ───────── 3 · 4 · 53 · 74 패드 ─────────
  {
    const o = await openChart(browser, PAD);
    const { page } = o;
    const names = await page.getByRole('tablist', { name: '차트 아래 탭' }).getByRole('tab').allInnerTexts();
    const main = await rect(page, 'main');
    const book = await rect(page, '[data-testid="orderbook"]');
    check('[157-3] 패드(1133) — 탭 다섯 + 오른쪽 호가 · 빠른 주문 열 그대로', names.join('|') === '차트 지표|기업정보|투자자 동향|뉴스|AI 분석' && Boolean(book && main && book.x >= main.r - 1), `${names.join('|')} · ${JSON.stringify({ main, book })}`);
    check('[157-4] 1133 그리기 도구 줄 그대로(커서 · 수평선 · 추세선 · 자 · 피보나치 · 박스)', (await page.getByRole('radiogroup', { name: '그리기 도구' }).getByRole('radio').count()) === 6);
    const tabsH = await page.evaluate(() => {
      const tl = document.querySelector('[aria-label="차트 아래 탭"]')!;
      return (tl.closest('.border-t') as HTMLElement).getBoundingClientRect().height;
    });
    check(`[157-53] 패드 아래 탭 펼친 높이 최소 300(지금 ${Math.round(tabsH)}) [점검 53]`, tabsH >= 299, String(tabsH));
    const bb = await page.getByRole('button', { name: '시장가 매수', exact: true }).boundingBox();
    const btn = bb ? { y: bb.y, b: bb.y + bb.height } : null;
    check('[157-74] 패드 빠른 주문 주문 단추 줄이 화면 안(아래 붙음) [점검 74]', Boolean(btn && btn.b <= 744 + 0.5 && btn.y >= 0), JSON.stringify(btn));

    // 4 — 그린 선은 폰으로 바뀌어도 그대로(차트를 다시 만들지 않음)
    await guard.step('수평선 도구', () => page.getByRole('radiogroup', { name: '그리기 도구' }).getByRole('radio', { name: '수평선' }).click());
    const cb = await rect(page, 'main');
    await page.mouse.click(cb!.x + cb!.w / 3, cb!.y + cb!.h / 2);
    await page.waitForTimeout(800);
    const countOf = () => page.evaluate(() => {
      const c = [...document.querySelectorAll('main div')].find((d) => (d as unknown as { __chartProbe?: unknown }).__chartProbe) as unknown as { __chartProbe: { drawings: { getAllDrawings: () => unknown[] } } } | undefined;
      if (c) (c as unknown as HTMLElement).dataset.probeMark = 'same';
      return c ? c.__chartProbe.drawings.getAllDrawings().length : -1;
    });
    const n0 = await countOf();
    await page.setViewportSize(PHONE);
    await page.waitForTimeout(1500);
    const same = await page.evaluate(() => Boolean(document.querySelector('[data-probe-mark="same"]')));
    const n1 = await page.evaluate(() => {
      const c = document.querySelector('[data-probe-mark="same"]') as unknown as { __chartProbe?: { drawings: { getAllDrawings: () => unknown[] } } } | null;
      return c?.__chartProbe ? c.__chartProbe.drawings.getAllDrawings().length : -1;
    });
    check('[157-4] 1133 에서 그린 선 하나가 402(폰)로 바뀐 뒤에도 같은 차트에 그대로(다시 만들지 않음)', n0 === 1 && same && n1 === 1, `${n0} → ${n1} · 같은 차트 ${same}`);
    check('[157-4] 402 그리기 도구 단추 0개', (await page.getByRole('radiogroup', { name: '그리기 도구' }).count()) === 0);
    await o.ctx.close();
  }
  {
    const o = await openChart(browser, { width: 1280, height: 1080 });
    check('[157-4] 1280 그리기 도구 줄 그대로', (await o.page.getByRole('radiogroup', { name: '그리기 도구' }).getByRole('radio').count()) === 6);
    await o.ctx.close();
  }

  // ───────── 5 · 6 · 58 · 63 · 75 빠른 주문 폰 ─────────
  {
    const o = await openChart(browser, PHONE);
    const { page } = o;
    await tab(page, '빠른 주문');
    const buy = await cssColor(page, 'bg-bullish');
    const sell = await cssColor(page, 'bg-bearish');
    const fg = await cssColor(page, 'text-bg-primary');
    const pairs: [string, string, string][] = [['매도', '지정가', '지정가 매도'], ['매수', '지정가', '지정가 매수'], ['매도', '시장가', '시장가 매도'], ['매수', '시장가', '시장가 매수']];
    for (const [side, type, deskName] of pairs) {
      await page.getByRole('radiogroup', { name: '매수 · 매도' }).getByRole('radio', { name: side }).click();
      await page.getByRole('radiogroup', { name: '주문 종류' }).getByRole('radio', { name: type }).click();
      await page.waitForTimeout(400);
      const segColor = await bgOf(page, '[aria-label="매수 · 매도"] [aria-checked="true"]');
      const btn = page.getByRole('button', { name: `${type} ${side}`, exact: true });
      const btnColor = await btn.evaluate((e) => ({ bg: getComputedStyle(e).backgroundColor, fg: getComputedStyle(e).color, h: e.getBoundingClientRect().height }));
      const want = side === '매수' ? buy : sell;
      check(`[157-6] ${type} ${side} — 고른 쪽 · 주문 단추 바탕 = ${side === '매수' ? '초록' : '빨강'} · 글 bg-primary · 단추 글 「${type} ${side}」 · 높이 44`, segColor?.bg === want && segColor?.fg === fg && btnColor.bg === want && btnColor.fg === fg && Math.round(btnColor.h) === 44, JSON.stringify({ segColor, btnColor, want, fg }));
      await guard.step(`402 ${type} ${side}`, () => btn.click({ timeout: 5000 }));
      const got = await confirmOrder(o);
      const d = deskOrders[deskName];
      check(`[157-5] 402 ${type} ${side} = 1280 [${deskName}] — 나간 요청(주소 · 몸) · 확인 창 글 바이트까지 같음`, Boolean(d) && d.body.length > 0 && got.body === d.body && got.text === d.text, `402: ${got.body} | ${got.text.slice(0, 80)} ── 1280: ${d?.body} | ${d?.text.slice(0, 80)}`);
    }
    const heights = await page.evaluate(() => {
      const root = document.querySelector('[data-testid="quick-order"]')!;
      return [...root.querySelectorAll<HTMLElement>('select, input, [role="radiogroup"], button')]
        .filter((e) => !e.closest('[role="radiogroup"] button') && !(e.tagName === 'BUTTON' && e.closest('[role="radiogroup"]')))
        .map((e) => `${e.getAttribute('aria-label') ?? (e.innerText || e.tagName).slice(0, 10)}=${Math.round(e.getBoundingClientRect().height)}`);
    });
    check('[157-6] 빠른 주문 입력 칸 · 고르기 · 단추 모두 44', heights.every((h) => h.endsWith('=44')), heights.join(' '));
    const t = await touchIssues(page);
    check('[157-58] 402 차트(빠른 주문) 같은 줄 높이 섞임 0(「주 %」 · 「현재가」 = 입력 칸 44) [점검 58]', t.rows.length === 0, t.rows.join(' / '));
    check('[157-63] 402 차트 아래로 밀어 아래 탭 — 같은 줄 높이 섞임 0 [점검 63]', t.rows.length === 0, t.rows.join(' / '));
    check('[157-75] 폰 빠른 주문 수량 · 가격 줄 높이 같음 [점검 75]', t.rows.length === 0 && heights.every((h) => h.endsWith('=44')), heights.join(' '));
    await o.ctx.close();
  }
  {
    const o = await openChart(browser, PAD);
    const t = await touchIssues(o.page);
    check('[157-66] 패드 차트 같은 줄 높이 섞임 0 [점검 66]', t.rows.length === 0, t.rows.join(' / '));
    check('[157-71] 패드 차트 아래 탭 — 같은 줄 높이 섞임 0 [점검 71]', t.rows.length === 0, t.rows.join(' / '));
    check('[157-75] 패드 빠른 주문 수량 · 가격 줄 높이 같음(주 % · 현재가 = 44) [점검 75]', !t.rows.some((r) => /수량|현재가|주/.test(r)), t.rows.join(' / '));
    await o.ctx.close();
  }

  // ───────── 7 폰 가로 ─────────
  {
    const o = await openChart(browser, PHONE_WIDE);
    const { page } = o;
    const inside = await page.evaluate(() => Boolean(document.querySelector('[data-testid="phone-price-row"] [data-testid="phone-chip-row"]')));
    const pr = await rect(page, '[data-testid="phone-price-row"]');
    const cr = await rect(page, '[data-testid="phone-chip-row"]');
    check('[157-7] 874 × 402 — 칩 줄이 가격 줄 오른쪽(같은 줄)', inside && Boolean(pr && cr && cr.x > pr.x + 40 && Math.abs(cr.y + cr.h / 2 - (pr.y + pr.h / 2)) < 2), JSON.stringify({ pr, cr }));
    const ch = await rect(page, '[data-phone-chart-box]');
    check('[157-7] 차트 = 남는 높이(차트 아래 끝 = 화면 아래 끝 ± 1)', Boolean(ch && Math.abs(ch.b - 402) <= 1), JSON.stringify(ch));
    await o.ctx.close();
  }

  // ───────── 9 · 55 · 61 · 62 · 68 ~ 70 기업 비교 ─────────
  for (const size of [PHONE, PAD]) {
    const o = await open(browser, size, '#/compare');
    const { page } = o;
    await page.waitForTimeout(1000);
    const checked = await page.getByRole('radiogroup', { name: '보기' }).getByRole('radio', { checked: true }).innerText();
    const hint = await page.getByText('눌러서 종목을 고르세요').count();
    check(`[157-9] ${size.width} 기업 비교 — 처음 2칸 · 「눌러서 종목을 고르세요」 [점검 55]`, checked.trim() === '2개' && hint === 2, `${checked} · ${hint}`);
    const t = await touchIssues(page);
    const tag = size.width === 402 ? ['61', '62'] : ['68', '70'];
    check(`[157-${tag[0]}] ${size.width} 기업 비교 같은 줄 높이 섞임 0 [점검 ${tag[0]}]`, t.rows.length === 0, t.rows.join(' / '));
    check(`[157-${tag[1]}] ${size.width} 기업 비교 누르는 칸 겹침 0(「기업 비교 쓰는 법」 ↔ 「2개」) [점검 ${tag[1]}]`, t.overlap.length === 0, t.overlap.join(' / '));
    if (size.width === 1133) check('[157-69] 패드 기업 비교 누르는 칸 44 미만 0(본문) [점검 69]', t.small.length === 0, t.small.join(' / '));
    // 기억된 값이 있으면 그대로
    await page.getByRole('radiogroup', { name: '보기' }).getByRole('radio', { name: '4개' }).click();
    await page.reload();
    await page.waitForTimeout(2000);
    const kept = await page.getByRole('radiogroup', { name: '보기' }).getByRole('radio', { checked: true }).innerText();
    check(`[157-9] ${size.width} 이 기기에 기억된 값(4개)은 그대로`, kept.trim() === '4개', kept);
    await o.ctx.close();
  }

  // ───────── 11 · 59 · 60 · 64 · 65 · 67 · 72 · 73 · 54 · 56 · 57 · 52 손가락 크기 · 점검 줄 ─────────
  for (const size of [PHONE, PAD]) {
    const o = await openChart(browser, size);
    const { page } = o;
    const phone = size.width === 402;
    const all = { small: [] as string[], overlap: [] as string[] };
    const scenes = phone ? ['호가', '빠른 주문', '차트 지표', '기업정보', '투자자 동향', '뉴스', 'AI 분석'] : ['차트 지표', '기업정보', '투자자 동향', '뉴스', 'AI 분석'];
    const first = await touchIssues(page);
    all.small.push(...first.small);
    all.overlap.push(...first.overlap);
    for (const s of scenes) {
      await tab(page, s);
      if (phone) await page.evaluate(() => {
        const row = document.querySelector('[data-testid="phone-tab-row"]');
        row?.scrollIntoView({ block: 'start' });
      });
      await page.waitForTimeout(300);
      const t = await touchIssues(page);
      all.small.push(...t.small.map((x) => `${s}: ${x}`));
      all.overlap.push(...t.overlap.map((x) => `${s}: ${x}`));
    }
    const nm = phone ? ['59', '64', '60', '65'] : ['67', '72', '73', '73'];
    check(`[157-11] ${size.width} 차트 화면(탭마다 · 빠른 주문) 누르는 칸 44 미만 0`, all.small.length === 0, all.small.join(' / '));
    check(`[157-11] ${size.width} 차트 화면(탭마다 · 빠른 주문) 누르는 칸 겹침 0`, all.overlap.length === 0, all.overlap.join(' / '));
    check(`[157-${nm[0]}] ${size.width} 차트 — 직접 만든 단추 누르는 칸 44 미만 0(지표 · 그리기 도구 · 호가 가격 · 빠른 주문) [점검 ${nm[0]}]`, all.small.length === 0, all.small.join(' / '));
    check(`[157-${nm[1]}] ${size.width} 차트 아래로 밀어 아래 탭 — 누르는 칸 44 미만 0 [점검 ${nm[1]}]`, all.small.length === 0, all.small.join(' / '));
    check(`[157-${nm[2]}] ${size.width} 차트 — 누르는 칸 겹침 0 [점검 ${nm[2]}]`, all.overlap.length === 0, all.overlap.join(' / '));
    if (phone) check(`[157-${nm[3]}] ${size.width} 차트 아래로 밀어 아래 탭 — 누르는 칸 겹침 0 [점검 ${nm[3]}]`, all.overlap.length === 0, all.overlap.join(' / '));
    if (phone) {
      const chips = await rect(page, '[data-testid="phone-chip-row"]');
      const reset = await rect(page, '[data-testid="phone-chip-row"] button[aria-label="초기화"]');
      check('[157-52] 402 도구 줄이 꺾이지 않음 — 칩 줄 한 줄 44 · [초기화] 같은 줄 [점검 52]', Boolean(chips && Math.round(chips.h) === 44 && reset && reset.y >= chips.y && reset.b <= chips.b + 0.5), JSON.stringify({ chips, reset }));
      // 57 — 기업정보 재무제표 · 동종업계 표 상자가 폭 전체
      await tab(page, '기업정보');
      const widths: number[] = [];
      for (const st of ['재무제표', '동종업계']) {
        const s = page.getByRole('tab', { name: st, exact: true });
        if (await s.count()) {
          await s.first().click();
          await page.waitForTimeout(1500);
          widths.push(...(await page.evaluate(() => [...document.querySelectorAll('[data-phone-chart] [data-scroll-table]')].map((e) => Math.round(e.getBoundingClientRect().width)))));
        }
      }
      // 폭 전체 = 탭 내용 폭(본문 370 − 탭 안쪽 여백 PANEL_X 32)
      check(`[157-57] 402 기업정보 재무제표 · 동종업계 표 상자 폭 전체(${widths.join(', ')}) [점검 57]`, widths.length >= 2 && widths.every((w) => w >= 337), widths.join(', '));
      // 56 — AI 분석 붙여넣기 칸 폭 전체
      await tab(page, 'AI 분석');
      await guard.step('분석 방식 보기', () => page.getByRole('button', { name: '분석 방식·프롬프트 수정 보기' }).click({ timeout: 5000 }));
      await page.waitForTimeout(1500);
      const ta = await rect(page, '[data-phone-chart] textarea');
      check('[157-56] 402 AI 분석 붙여넣기 칸 폭 전체(탭 내용 폭 338 · 고정 폭 320 아님) [점검 56]', Boolean(ta && ta.w >= 337), JSON.stringify(ta));
    }
    // 54 — 캡처 창 = 공용 Dialog(폰 아래 판 · 패드 크기 제한) · 누르는 칸
    await tab(page, 'AI 분석');
    const detail = page.getByRole('button', { name: /상세 캡처/ });
    if (!(await detail.count())) await page.getByRole('button', { name: '분석 방식·프롬프트 수정 보기' }).click().catch(() => {});
    await page.waitForTimeout(1000);
    await guard.step('상세 캡처', () => page.getByRole('button', { name: /상세 캡처/ }).first().click({ timeout: 5000 }));
    await page.waitForTimeout(2500);
    const dlg = await rect(page, '[role="dialog"][aria-modal="true"] > div');
    const ok54 = phone ? Boolean(dlg && Math.abs(dlg.b - size.height) <= 1 && Math.round(dlg.w) === size.width) : Boolean(dlg && dlg.w <= size.width - 48 + 1 && dlg.h <= size.height - 48 + 1);
    check(`[157-54] ${size.width} 캡처 창 = 공용 Dialog(${phone ? '폰 아래 판' : '패드 크기 제한'}) [점검 54]`, ok54, JSON.stringify(dlg));
    const tc = await touchIssues(page);
    check(`[157-11] ${size.width} 캡처 창 누르는 칸 44 미만 · 겹침 0`, tc.small.length === 0 && tc.overlap.length === 0, [...tc.small, ...tc.overlap].join(' / '));
    await o.ctx.close();
  }

  // ───────── 12 · 13 바뀐 파일 · lint ─────────
  {
    const trade = chasuChanged(root, CHASU, ['server', 'deploy', 'python', 'db', 'src/services/toss', 'src/hooks/usePaperTrading.ts', 'src/hooks/useAutoTrading.ts']);
    check('[157-12] 모의 주문 서버 · 매매 판단 · 자동매매 · 서버 코드 바뀐 파일 0', trade.length === 0, trade.join(' '));
    const fit = chasuPatch(root, CHASU, ['src/components/chart/chartTheme.ts', 'src/components/chart/drawingSupport.ts']);
    check('[157-12] chartTheme.fitCandleScale · drawingSupport.prepareDrawing 몸통 0줄(두 파일 바뀐 줄 0)', fit.trim() === '', fit.slice(0, 200));
    const tsx = path.join(root, 'node_modules/tsx/dist/cli.mjs');
    const r = spawnSync(process.execPath, [tsx, 'scripts/designLint.ts'], { cwd: root, encoding: 'utf8' });
    check('[157-13] design:lint 통과', r.status === 0, r.stdout.slice(-300));
  }
} catch (e) {
  check('실패: 예외', false, String(e).slice(0, 400));
}

await guard.step('브라우저 닫기', () => browser.close());
await guard.step('Vite 닫기', () => vite.close());
console.log(`\n폰 차트 화면 시험 — 통과 ${pass} · 실패 ${fail}`);
process.exit(fail ? 1 : 0);
