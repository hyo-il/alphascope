/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
/**
 * 149차 계좌 · 자동매매 화면 폰 · 패드 시험(`npm run mobileaccount:test` · v2.76.0) — 지시서 「꼭 지킬 동작」 1 ~ 11 줄마다.
 *
 * 화면은 이 시험이 띄운 Vite(5196)에 열고, `/api` 는 모두 가짜 응답 — `scripts/fixtures/mobileAccount/api.json`
 * (사본 DB 테스트 서버에서 한 번 기록한 응답 + 보유 3종목 · 자동매매 켜짐 · 최근 판단 3줄로 고친 값 · 실제 계좌 보유는 만든 값 · 쓰기는 모두 503).
 * 모르는 주소는 503(사용자 서버로 가지 않음). 시계는 고정(`page.clock.setFixedTime`). 폰 · 패드는 `isMobile` · `hasTouch`(손가락 화면).
 * 1(1280 · 1440 여섯 화면 그대로)은 v2.83.0 부터 `desktop:test`(`scripts/lib/desktopScenes.ts` 묶음 `account`)가 본다.
 *   2 ~ 4 의 카드 글은 기준 커밋(0cdb48a) 1280 의 보유 표 글(모의 · 실제 · 합계 — `scripts/fixtures/mobileAccount/table1280.json`)과 견준다.
 * 8 · 9 의 누르는 칸은 `design:check` 18 · 19 와 같은 셈(요소 + 보이지 않는 바깥 칸 · 같은 묶음 단추 안은 겹침으로 세지 않음)을 **그 화면 본문 · 열린 창 안**으로만 잰다
 *   (앱 틀 · 창 뒤 화면은 다른 차수 몫 · 스크롤로 가려진 요소는 뺌).
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { chromium, type Browser, type Page } from 'playwright';
import { createBrowserStepGuard } from './lib/browserStepGuard';
import { chasuDiff, type Chasu } from './lib/chasuRange';

const root = path.resolve(import.meta.dirname, '..');
const PORT = 5196;
const WEB = `http://127.0.0.1:${PORT}`;
/** 기준 커밋(v2.75.0) — 2 ~ 4 의 1280 표 글 · 10 은 여기서부터 바뀐 것을 본다 */
const BASE = '0cdb48a';
const CHASU: Chasu = { base: BASE, version: 'v2.76.0' }; // 그 차수 범위만(scripts/lib/chasuRange.ts)
const TABLE_1280 = path.join(root, 'scripts/fixtures/mobileAccount/table1280.json');
const API: Record<string, unknown> = JSON.parse(fs.readFileSync(path.join(root, 'scripts/fixtures/mobileAccount/api.json'), 'utf8'));
const FIXED = new Date('2026-11-26T05:00:00.000Z');
const CLIENT_VERSION = /version: '(v[\d.]+)'/.exec(fs.readFileSync(path.join(root, 'src/data/changelog.ts'), 'utf8'))?.[1] ?? '';
const DETAIL = '/api/paper/accounts/8?settle=1';

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
const PAD = { width: 1133, height: 744 };

type Override = (url: string) => { status?: number; json?: unknown; delayMs?: number } | undefined;

async function open(browser: Browser, size: { width: number; height: number }, hash: string, o: { override?: Override; wait?: number } = {}) {
  const mobile = size.width < 1280;
  const ctx = await browser.newContext(mobile ? { viewport: size, isMobile: true, hasTouch: true } : { viewport: size });
  await ctx.addInitScript('window.__name = (f) => f');
  const page = await ctx.newPage();
  await page.clock.setFixedTime(FIXED);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)));
  await page.route(/\/api\//, async (r) => {
    const req = r.request();
    const u = req.url().replace(WEB, '');
    const ov = o.override?.(u);
    if (ov) {
      if (ov.delayMs) await new Promise((res) => setTimeout(res, ov.delayMs));
      return r.fulfill({ status: ov.status ?? 200, json: ov.json ?? {} }).catch(() => {});
    }
    if (req.method() !== 'GET') return r.fulfill({ status: 503, json: { error: '시험 — 쓰지 않음' } });
    if (u.startsWith('/api/version')) return r.fulfill({ json: { version: CLIENT_VERSION, startedAt: '2026-11-25T00:00:00.000Z' } });
    if (u in API) return r.fulfill({ json: API[u] });
    return r.fulfill({ status: 503, json: { error: '시험 — 없음' } });
  });
  await guard.step(`페이지 열기(${size.width}×${size.height} ${hash})`, () => page.goto(`${WEB}/${hash}`));
  await page.waitForTimeout(o.wait ?? 3500);
  return { page, ctx, errors };
}

const tapName = async (page: Page, name: string | RegExp, role: 'button' | 'radio' = 'button') => {
  await guard.step(`누르기 ${String(name)}`, () => page.getByRole(role, { name }).first().click({ timeout: 5000 }));
  await page.waitForTimeout(900);
};
const openAccount = async (page: Page) => {
  await guard.step('계좌 열기', () => page.locator('article[role="button"]').first().click({ timeout: 5000 }));
  await page.waitForTimeout(1800);
};
const openWizard = async (page: Page, step: 'new' | 'existing' | 2 | 3 | 4) => {
  await tapName(page, '자동매매 처음 켜기');
  if (step === 'new') return;
  await tapName(page, /있는 계좌 고르기/);
  await tapName(page, '이 계좌로 계속');
  if (step === 'existing') return;
  for (let i = 1; i < step; i++) await tapName(page, '다음');
};

/** 글 견주기 — 빈칸은 모두 뺀다(표 칸은 여백(margin)으로 띄우고 카드는 빈칸으로 띄운다 — 보이는 글자는 같음) */
const strip = (v: unknown) => JSON.stringify(v).replace(/\s+/g, '');
/** 카드 글 — 카드마다 줄(DataCardRow)마다 [왼쪽, 오른쪽] */
async function cardTexts(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-card]')].map((c) =>
      [...c.children].map((row) => [...row.children].map((x) => (x as HTMLElement).innerText.replace(/\s+/g, ' ').trim())),
    ),
  );
}

/** 누르는 칸(design:check 18 · 19 와 같은 셈) — 범위(scope) 안 · 스크롤로 가려지지 않은 것만 */
async function touchIssues(page: Page, scope: string) {
  return page.evaluate((sel) => {
    const scopes = [...document.querySelectorAll(sel)];
    const area = scopes[scopes.length - 1];
    if (!area) return { small: ['범위 없음'], overlap: [] as string[] };
    const label = (el: Element) => ((el as HTMLElement).innerText || el.getAttribute('aria-label') || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 24);
    // 스크롤 상자 끝에 걸쳐 일부가 가려진 요소는 뺀다(밀면 자리가 바뀌는 · 보이지 않는 자리)
    const shown = (el: Element, r: DOMRect) => {
      let x0 = r.left;
      let y0 = r.top;
      let x1 = r.right;
      let y1 = r.bottom;
      for (let p = el.parentElement; p; p = p.parentElement) {
        const cs = getComputedStyle(p);
        if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
        const pr = p.getBoundingClientRect();
        x0 = Math.max(x0, pr.left);
        y0 = Math.max(y0, pr.top);
        x1 = Math.min(x1, pr.right);
        y1 = Math.min(y1, pr.bottom);
      }
      x1 = Math.min(x1, innerWidth);
      y1 = Math.min(y1, innerHeight);
      return x1 > x0 && y1 > y0 && (x1 - x0) * (y1 - y0) >= 0.95 * r.width * r.height;
    };
    const MIN = 44;
    const small: string[] = [];
    const overlap: string[] = [];
    const hits: { el: Element; x: number; y: number; w: number; h: number }[] = [];
    const q = 'button, a[href], [role="tab"], [role="radio"], [role="button"], [role="checkbox"], input:not([type="hidden"]), select, textarea';
    for (const el of area.querySelectorAll<HTMLElement>(q)) {
      if ((el as HTMLButtonElement).disabled || el.closest('[inert], [aria-hidden="true"]')) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1 || getComputedStyle(el).visibility === 'hidden' || !shown(el, r)) continue;
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
    return { small, overlap };
  }, scope);
}
const BODY = '[data-layout-body]';
const DIALOG = '[role="dialog"]';

/** 앱 상태(고른 종목 · 화면) — 앱이 쓰는 그 모듈을 Vite 에서 불러 읽는다 */
const storeOf = (page: Page) =>
  page.evaluate(async (url) => {
    const m = (await import(/* @vite-ignore */ url)) as { useAppStore: { getState: () => { symbol: string | null; nav: { page: string } } } };
    const s = m.useAppStore.getState();
    return { symbol: s.symbol, page: s.nav.page };
  }, '/src/store/appStore.ts');
/** 세로 가운데 — 같은 줄인지 */
const midY = (page: Page, sel: string) => page.locator(sel).first().evaluate((e) => { const r = e.getBoundingClientRect(); return r.top + r.height / 2; });

const { createServer } = await import('vite');
const vite = await guard.step('Vite 띄우기', async () => {
  const v = await createServer({ root, configFile: path.join(root, 'vite.config.ts'), logLevel: 'error', server: { host: '127.0.0.1', port: PORT, strictPort: true, hmr: false } });
  await v.listen();
  return v;
});
const browser = await guard.step('브라우저 띄우기', () => chromium.launch({ channel: 'chrome' }));

try {
  // 2 ~ 4 가 견줄 기준 커밋 1280 표 글(1 의 1280 · 1440 그대로는 desktop:test)
  const want: { tables: Record<string, { rows: string[][]; foot: string[] } | null> } = JSON.parse(fs.readFileSync(TABLE_1280, 'utf8'));

  // ───────── 2 · 3 · 5 · 7 모의 보유 카드 ─────────
  {
    const t = want.tables['모의 계좌를 연 화면']!;
    const { page, ctx, errors } = await open(browser, PHONE, '#/portfolio/paper');
    await openAccount(page);
    const inPanel = await page.locator('[data-testid="position-cards"]').count();
    const tablesInPanel = await page.locator('[data-testid="position-cards"] table').count();
    const cards = await cardTexts(page);
    check(`[149-2] 402 모의 보유 — 표 없이 카드 ${cards.length}장(= 종목 ${t.rows.length}개)`, inPanel === 1 && tablesInPanel === 0 && (await page.locator('table').count()) === 0 && cards.length === t.rows.length, `카드 ${cards.length} · 표 ${await page.locator('table').count()}`);
    const bad: string[] = [];
    t.rows.forEach((r, i) => {
      const [name, qty, avg, cur, value, pnl, pct] = r;
      const c = cards[i];
      const want3 = [
        [name.replace(/\s+/g, ' '), value],
        [`${qty}주 · 평균 ${avg}`, `${pnl} (${pct})`],
        [`현재가 ${cur}`],
      ];
      if (strip(c) !== strip(want3)) bad.push(`${i}: ${JSON.stringify(c)} ≠ ${JSON.stringify(want3)}`);
    });
    check('[149-2] 카드 줄 1 ~ 3 글 = 기준 커밋 1280 표 같은 종목 값(이름 · 평가금액 / 수량 · 평균 / 평가손익 (수익률) / 현재가 · 값 없음 「—」)', bad.length === 0 && t.rows.length === 3, bad.join(' | '));
    // 3 합계(한 통화)
    const total = await page.locator('[data-testid="position-cards-total"]').evaluate((e) => (e as HTMLElement).innerText.split('\n').map((s) => s.trim()).filter(Boolean)).catch(() => [] as string[]);
    const [, footValue, footPnl, footPct] = t.foot;
    const [fv, fcost] = footValue.split('\n').map((s) => s.trim());
    const wantTotal = ['합계', fcost, fv, `${footPnl} (${footPct})`];
    check('[149-3] 한 통화 — 목록 아래 합계 줄 평가금액 · 평가손익 · 수익률 · 매수 금액 = 1280 표 합계', strip(total) === strip(wantTotal), `${JSON.stringify(total)} ≠ ${JSON.stringify(wantTotal)}`);
    // 5 카드 누름 — 손가락 누름 · Enter 가 그 종목 차트로(종목 칸 누름과 같은 일)
    const appStore = async () => storeOf(page);
    await guard.step('카드 누르기', () => page.locator('[data-card]').nth(1).tap());
    await page.waitForTimeout(800);
    const tapped = await appStore();
    check('[149-5] 카드를 손가락으로 누르면 그 종목(NVDA) 차트로', tapped.page === 'chart' && tapped.symbol === 'NVDA', JSON.stringify(tapped));
    check('[149-2] 화면 오류 0', errors.length === 0, errors.join(' | '));
    await ctx.close();
    {
      const { page: p2, ctx: c2 } = await open(browser, PHONE, '#/portfolio/paper');
      await openAccount(p2);
      const role = await p2.getByRole('button', { name: '애플 차트로 이동' }).count();
      await p2.locator('[data-card]').first().focus();
      await p2.keyboard.press('Enter');
      await p2.waitForTimeout(800);
      const s = await storeOf(p2);
      check('[149-5] 카드 키보드 — 역할 button · 이름 「애플 차트로 이동」 · Enter 로 그 종목(AAPL) 차트', role === 1 && s.page === 'chart' && s.symbol === 'AAPL', `${role} ${JSON.stringify(s)}`);
      await c2.close();
    }
    // 3 통화가 섞이면 합계 줄 없음
    {
      const mixed = JSON.parse(JSON.stringify(API[DETAIL])) as { positions: { currency: string }[] };
      mixed.positions[1].currency = 'KRW';
      const { page: p3, ctx: c3 } = await open(browser, PHONE, '#/portfolio/paper', { override: (u) => (u === DETAIL ? { json: mixed } : undefined) });
      await openAccount(p3);
      const n = await p3.locator('[data-card]').count();
      const totals = await p3.locator('[data-testid="position-cards-total"]').count();
      check('[149-3] 통화가 섞이면 합계 줄 없음(카드는 그대로)', n === 3 && totals === 0, `카드 ${n} · 합계 ${totals}`);
      await c3.close();
    }
    // 7 로딩 — 받기 전 카드 스켈레톤 · 「없음」 글 없음 / 실패 → 오류 + [다시 시도] → 다시 받으면 카드
    {
      let mode: 'slow' | 'fail' | 'ok' = 'slow';
      const { page: p4, ctx: c4 } = await open(browser, PHONE, '#/portfolio/paper', {
        override: (u) => (u === DETAIL ? (mode === 'slow' ? { delayMs: 6000, json: API[DETAIL] } : mode === 'fail' ? { status: 500, json: { error: '시험 — 실패' } } : undefined) : undefined),
      });
      await guard.step('계좌 열기', () => p4.locator('article[role="button"]').first().click({ timeout: 5000 }));
      await p4.waitForTimeout(700);
      const sk = await p4.locator('[data-card-skeleton]').count();
      const none = await p4.getByText('보유 중인 종목이 없습니다').count();
      check('[149-7] 모의 보유 받기 전 — 카드 스켈레톤 · 「보유 중인 종목이 없습니다」 없음', sk === 1 && none === 0, `스켈레톤 ${sk} · 없음 ${none}`);
      await c4.close();
      mode = 'fail';
      const { page: p5, ctx: c5 } = await open(browser, PHONE, '#/portfolio/paper', {
        override: (u) => (u === DETAIL ? (mode === 'fail' ? { status: 500, json: { error: '시험 — 실패' } } : undefined) : undefined),
      });
      await openAccount(p5);
      const err = await p5.getByText('보유 종목을 불러오지 못했습니다').count();
      const retry = p5.getByRole('button', { name: '다시 시도' });
      const none2 = await p5.getByText('보유 중인 종목이 없습니다').count();
      mode = 'ok';
      if (await retry.count()) await retry.first().click();
      await p5.waitForTimeout(1500);
      const after = await p5.locator('[data-card]').count();
      check('[149-7] 모의 보유 받기 실패 — 오류 + [다시 시도](「없음」 아님) · 누르면 다시 받아 카드', err === 1 && none2 === 0 && after === 3, `오류 ${err} · 없음 ${none2} · 다시 받은 뒤 카드 ${after}`);
      await c5.close();
    }
  }

  // ───────── 4 · 7 실제 계좌 보유 카드 ─────────
  {
    const t = want.tables['실제 계좌']!;
    const { page, ctx } = await open(browser, PHONE, '#/portfolio/real');
    const cards = await cardTexts(page);
    const bad: string[] = [];
    t.rows.forEach((r, i) => {
      const [name, qty, avg, cur, value, pnl, daily] = r;
      const want3 = [
        [name.replace(/\s+/g, ' '), value],
        [`${qty}주 · 평균 ${avg}`, pnl.replace(/\s+/g, ' ')],
        [`현재가 ${cur}`, `당일 ${daily.split('(')[0].trim()}`],
      ];
      if (strip(cards[i]) !== strip(want3)) bad.push(`${i}: ${JSON.stringify(cards[i])} ≠ ${JSON.stringify(want3)}`);
    });
    check(`[149-4] 402 실제 보유(가짜 응답) — 표 없이 카드 ${cards.length}장 · 3줄 오른쪽 「당일 …」 · 글 = 1280 표 값`, (await page.locator('table').count()) === 0 && cards.length === t.rows.length && t.rows.length === 2 && bad.length === 0, bad.join(' | '));
    const clip = await page.locator('[data-card] [data-tip-clip]').first().evaluate((e) => e.scrollWidth > e.clientWidth);
    check('[149-4] 긴 종목 이름 — 카드 한 줄 말줄임(data-tip-clip)', clip);
    await ctx.close();
    let mode: 'slow' | 'fail' | 'ok' = 'slow';
    const ov: Override = (u) => (u === '/api/holdings' ? (mode === 'slow' ? { delayMs: 6000, json: API['/api/holdings'] } : mode === 'fail' ? { status: 500, json: { error: '시험 — 실패' } } : undefined) : undefined);
    const { page: p2, ctx: c2 } = await open(browser, PHONE, '#/portfolio/real', { override: ov, wait: 1200 });
    const sk = await p2.locator('[data-card-skeleton]').count();
    const none = await p2.getByText('보유 중인 해외주식이 없습니다').count();
    check('[149-7] 실제 보유 받기 전 — 카드 스켈레톤 · 「없음」 글 없음', sk === 1 && none === 0, `스켈레톤 ${sk} · 없음 ${none}`);
    await c2.close();
    mode = 'fail';
    const { page: p3, ctx: c3 } = await open(browser, PHONE, '#/portfolio/real', { override: ov });
    const err = await p3.getByText('보유 주식을 불러오지 못했습니다').count();
    mode = 'ok';
    await p3.getByRole('button', { name: '다시 시도' }).first().click().catch(() => {});
    await p3.waitForTimeout(1500);
    check('[149-7] 실제 보유 받기 실패 — 오류 + [다시 시도] · 누르면 다시 받아 카드', err === 1 && (await p3.locator('[data-card]').count()) === 2, `오류 ${err} · 카드 ${await p3.locator('[data-card]').count()}`);
    await c3.close();
  }

  // ───────── 6 패드는 표 ─────────
  {
    const { page, ctx } = await open(browser, PAD, '#/portfolio/paper');
    await openAccount(page);
    const paper = await page.locator('[data-scroll-table] table').count();
    const cards1 = await page.locator('[data-card]').count();
    await ctx.close();
    const { page: p2, ctx: c2 } = await open(browser, PAD, '#/portfolio/real');
    const real = await p2.locator('[data-scroll-table] table').count();
    const cards2 = await p2.locator('[data-card]').count();
    check('[149-6] 1133 — 모의 보유 · 실제 보유 모두 표(148차 미는 표 상자) · 카드 0', paper === 1 && real === 1 && cards1 + cards2 === 0, `모의 표 ${paper} · 실제 표 ${real} · 카드 ${cards1 + cards2}`);
    check('[149-16] 패드 실제 계좌 고정 폭 표(min-w-[592px]) — 148 미는 표 상자 안(148 로 해결)', real === 1);
    await c2.close();
  }

  // ───────── 8 · 9 점검 줄 · 손가락 크기 ─────────
  for (const size of [PHONE, PAD]) {
    const S = size.width;
    const phone = S === PHONE.width;
    const touch = async (page: Page, scope: string, what: string, rows: string) => {
      const r = await touchIssues(page, scope);
      check(`[149-9]${rows} ${S} ${what} — 누르는 칸 44 미만 0`, r.small.length === 0, r.small.join(' · '));
      check(`[149-9]${rows} ${S} ${what} — 누르는 칸 겹침 0`, r.overlap.length === 0, r.overlap.join(' · '));
    };
    // 계좌 모아보기(카드 · 목록)
    {
      const { page, ctx } = await open(browser, size, '#/portfolio/paper');
      if (phone) {
        const badge = await page.locator('[data-testid="paper-badge"]').evaluate((e) => {
          const b = e.children[0].getBoundingClientRect();
          const i = e.children[1].getBoundingClientRect();
          // 넘침은 보이는 모양으로 잰다(배지 · [ⓘ] 오른쪽 끝이 탭 줄 안) — [ⓘ] 의 보이지 않는 누르는 칸(::after)은 넘침이 아니다
          const row = (e.closest('.border-b') as HTMLElement).getBoundingClientRect();
          return { same: i.top + i.height / 2 > b.top && i.top + i.height / 2 < b.bottom && i.left >= b.right, over: Math.max(b.right, i.right) - row.right };
        });
        check('[149-8] 8줄 — 폰 모의 배지와 [ⓘ] 이 한 덩어리로 같은 줄(ⓘ 은 배지 오른쪽) · 탭 줄 넘침 0', badge.same && badge.over <= 0, JSON.stringify(badge));
        const h = await midY(page, 'h2:text("계좌 모아보기")');
        const i = await midY(page, '[aria-label="모아보기 쓰는 법"]');
        check('[149-8] 9줄 — 폰 「계좌 모아보기」 [ⓘ] 이 제목과 같은 줄(혼자 떨어지지 않음)', Math.abs(h - i) < 6, `${h} / ${i}`);
      }
      await touch(page, BODY, '계좌 모아보기 카드', phone ? '[9 · 11줄]' : '');
      await ctx.close();
      const { page: p2, ctx: c2 } = await open(browser, size, '#/portfolio/paper', { override: (u) => (u === '/api/paper/accounts-view' ? { json: { view: 'list' } } : undefined) });
      await touch(p2, BODY, '계좌 모아보기 목록', '');
      await c2.close();
    }
    // 새 계좌(모아보기 줄)
    {
      const { page, ctx } = await open(browser, size, '#/portfolio/paper');
      await tapName(page, '+ 새 계좌');
      const yField = await midY(page, '[aria-label="초기 자금"]');
      const yMake = await midY(page, 'button:text-is("만들기")');
      check(`[149-8] ${phone ? '13' : '17'}줄 — ${S} 새 계좌: [만들기] · [취소] 가 높이 44 입력 칸과 다른 줄(같은 줄 높이 섞임 없음)`, Math.abs(yField - yMake) >= 6, `${yField} / ${yMake}`);
      const r = await touchIssues(page, BODY);
      check(`[149-8] ${phone ? '14' : '18'}줄 — ${S} 새 계좌: 「100만」 · 「1,000만」 · 「10,000만」 · 「초기 자금」 누르는 칸 44 이상`, !r.small.some((s) => /만 |초기 자금/.test(s)), r.small.join(' · '));
      await touch(page, BODY, '새 계좌 줄', phone ? '[15줄]' : '');
      await ctx.close();
    }
    // 자동매매 처음 켜기 창 — 단계 1(새 · 있는 계좌) · 2 · 3 · 4
    {
      const { page, ctx } = await open(browser, size, '#/portfolio/paper');
      await openWizard(page, 'new');
      if (phone) {
        const head = await page.locator(`${DIALOG} h2`).last().evaluate((e) => ({ h: e.getBoundingClientRect().height, clip: e.getAttribute('data-tip-clip') === '자동매매 처음 켜기' && getComputedStyle(e).textOverflow === 'ellipsis' }));
        const steps = await page.locator('[data-testid="wizard-steps"]').evaluate((e) => ({ text: (e as HTMLElement).innerText.trim(), dots: e.querySelectorAll('.rounded-full').length, h: e.getBoundingClientRect().height }));
        check('[149-8] 19줄 — 폰 자동매매 설정 창 제목 한 줄(말줄임 + data-tip-clip — 폰 창 ui/Dialog) · 단계 「1/4 · 계좌」 + 점 4개 한 줄', head.h <= 24 && head.clip && steps.text === '1/4 · 계좌' && steps.dots === 4 && steps.h <= 22, `${JSON.stringify(head)} ${JSON.stringify(steps)}`);
      }
      const yField = await midY(page, `${DIALOG} [aria-label="초기 자금"]`);
      const yMake = await midY(page, `${DIALOG} button:text-is("만들기")`);
      check(`[149-8] ${phone ? '20' : '23'}줄 — ${S} 자동매매 설정 창 새 계좌: [만들기] 가 입력 칸과 다른 줄`, Math.abs(yField - yMake) >= 6, `${yField} / ${yMake}`);
      await touch(page, DIALOG, '자동매매 설정 창 1단계(새 계좌)', phone ? '[21 · 22줄]' : '[24 · 25줄]');
      await ctx.close();
      for (const st of ['existing', 2, 3, 4] as const) {
        const { page: p, ctx: c } = await open(browser, size, '#/portfolio/paper');
        await openWizard(p, st);
        if (st === 'existing') {
          const radio = await p.locator(`${DIALOG} input[type="radio"]`).evaluateAll((els) => els.map((e) => ({ cls: e.className, h: parseFloat(getComputedStyle(e, '::after').height) || 0 })));
          check(`[149-8] 154줄 — ${S} 있는 계좌 동그라미 = 공용 Radio(손가락 누르는 칸 44)`, radio.length >= 1 && radio.every((r) => /touch-hit/.test(r.cls) && r.h >= 44), JSON.stringify(radio));
        }
        await touch(p, DIALOG, `자동매매 설정 창 ${st === 'existing' ? '1단계(있는 계좌)' : `${st}단계`}`, phone ? '[21 · 22 · 154줄]' : '[24 · 25 · 154줄]');
        await c.close();
      }
    }
    // 있는 계좌를 고른 뒤 [이 계좌로 계속] 이 공용 단추(누르기 전) — 위 openWizard 가 눌러 사라지므로 따로
    {
      const { page, ctx } = await open(browser, size, '#/portfolio/paper');
      await tapName(page, '자동매매 처음 켜기');
      await tapName(page, /있는 계좌 고르기/);
      const btn = await page.locator(`${DIALOG} button`).filter({ hasText: '이 계좌로 계속' }).first().evaluate((e) => ({ cls: e.className, h: e.getBoundingClientRect().height }));
      check(`[149-8] 154줄 — ${S} [이 계좌로 계속] = 공용 단추(Button sm · 높이 28 · 손가락 누르는 칸 touch-hit)`, /\bh-7\b/.test(btn.cls) && /touch-hit/.test(btn.cls) && Math.round(btn.h) === 28, JSON.stringify(btn));
      await touch(page, DIALOG, '자동매매 설정 창 1단계(돌고 있는 계좌 경고)', '[154줄]');
      await ctx.close();
    }
    // 계좌를 연 화면 — 아래 탭 · 거래내역 · 성과분석 · AI 검증 기록 · 최근 판단 · 자동매매 설정 · 입출금
    {
      const { page, ctx } = await open(browser, size, '#/portfolio/paper');
      await openAccount(page);
      const back = await page.getByRole('button', { name: '← 계좌 모아보기' }).evaluate((e) => {
        const b = e.getBoundingClientRect();
        const tabs = [...document.querySelectorAll('[role="tab"]')].map((t) => t.getBoundingClientRect());
        const tabBottom = Math.max(...tabs.map((t) => t.top + t.height / 2 + Math.max(t.height, 44) / 2));
        return { gap: b.top + b.height / 2 - 22 - tabBottom };
      });
      check(`[149-8] 148줄 — ${S} [← 계좌 모아보기] 누르는 칸이 위 탭(모의투자 · 실제 계좌)과 겹치지 않음`, back.gap >= -2, JSON.stringify(back));
      await touch(page, BODY, '계좌를 연 화면(보유 종목)', '[144 · 147줄]');
      const tabsOk = await page.locator('button[aria-pressed]').filter({ hasText: /^(보유 종목|거래내역|성과분석|AI 검증 기록)$/ }).count();
      check(`[149-8] 144줄 — ${S} 아래 탭 4개가 공용 고르기 칩(ui/Chip)`, tabsOk === 4, String(tabsOk));
      if (!phone) {
        const link = await page.locator('table tbody tr td:first-child button').first().evaluate((e) => parseFloat(getComputedStyle(e, '::after').height) || 0);
        check(`[149-8] 147줄 — ${S} 보유 표 종목 이름 단추 누르는 칸 44`, link >= 44, String(link));
      }
      // 최근 판단
      await tapName(page, /최근 판단 보기/);
      if (phone) {
        const g = await page.locator('[data-notes-group]').first().evaluate((e) => {
          const b = e.querySelector('button')!.getBoundingClientRect();
          const box = e.closest('[id^="autotrade-notes-"]')!.getBoundingClientRect();
          return { fits: b.right <= box.right + 0.5, head: (e.querySelector('button') as HTMLElement).innerText.trim(), counts: (e.querySelector('[data-testid="notes-group-counts"]') as HTMLElement | null)?.innerText.trim() ?? '' };
        });
        check('[149-8] 149줄 — 폰 판단 묶음 머리 단추가 상자 안(잘리지 않음) · 매수 · 매도 · 그대로 · 못 산 수는 아래 글', g.fits && /^\d\d:\d\d (미국|국내|US|KR) 판단 · 3종목$/.test(g.head) && g.counts === '매수 1 · 매도 0 · 그대로 2 · 못 산 0', JSON.stringify(g));
      }
      await touch(page, BODY, '최근 판단 펼침', '[149줄]');
      for (const [tab, row] of [['거래내역', '145'], ['성과분석', '146'], ['AI 검증 기록', '']] as const) {
        await tapName(page, tab);
        await touch(page, BODY, `계좌를 연 화면(${tab})`, row ? `[${row}${tab === '거래내역' ? ' · 147' : ''}줄]` : '');
      }
      await ctx.close();
    }
    // 자동매매 설정 창(계좌 막대) — 150 · 151 · 152 · 153
    {
      const { page, ctx } = await open(browser, size, '#/portfolio/paper');
      await openAccount(page);
      await tapName(page, '자동매매 설정');
      if (phone) {
        const hints = await page.locator(`${DIALOG} [data-formrow-hint]`).evaluateAll((els) => {
          const d = document.querySelectorAll('[role="dialog"]');
          const box = d[d.length - 1].getBoundingClientRect();
          return els.map((e) => ({ w: Math.round(e.getBoundingClientRect().width), out: e.getBoundingClientRect().right > box.right + 0.5 }));
        });
        check('[149-8] 150줄 — 폰 자동매매 설정 창 ③ · ④ 설명 글이 다음 줄 폭 전체(폭 ≥ 250 · 창 밖으로 안 나감)', hints.length === 4 && hints.every((h) => h.w >= 250 && !h.out), JSON.stringify(hints));
      }
      const ai = await touchIssues(page, DIALOG);
      check(`[149-8] 151줄 — ${S} 「AI 검증 [끔 · 켬]」 과 [ⓘ] 누르는 칸 겹침 없음`, !ai.overlap.some((s) => /AI 검증/.test(s)), ai.overlap.join(' · '));
      const inputH = await page.locator(`${DIALOG} [data-formrow-value] input`).first().evaluate((e) => Math.round(e.getBoundingClientRect().height));
      check(`[149-8] 153줄 — ${S} 숫자 칸(NumberField) 입력 높이 44`, inputH === 44, String(inputH));
      await touch(page, DIALOG, '자동매매 설정 창(계좌 막대)', '[150 · 151 · 153줄]');
      await page.locator(`${DIALOG} select`).first().selectOption('');
      await page.waitForTimeout(400);
      const link = await page.locator(DIALOG).getByRole('button', { name: '매매 규칙으로 가기' }).evaluate((e) => parseFloat(getComputedStyle(e, '::after').height) || 0);
      check(`[149-8] 152줄 — ${S} 「매매 규칙으로 가기」 글자 단추 누르는 칸 44`, link >= 44, String(link));
      await ctx.close();
    }
    // 입금 · 출금 · 계좌 복사 창
    for (const name of ['입금', '출금', '계좌 복사']) {
      const { page, ctx } = await open(browser, size, '#/portfolio/paper');
      await openAccount(page);
      await tapName(page, name);
      if (name !== '계좌 복사') {
        const h = await page.locator(`${DIALOG} input`).first().evaluate((e) => Math.round(e.getBoundingClientRect().height));
        check(`[149-8] 153줄 — ${S} ${name} 창 금액 칸 입력 높이 44`, h === 44, String(h));
      }
      await touch(page, DIALOG, `${name} 창`, name === '계좌 복사' ? '' : '[153줄]');
      await ctx.close();
    }
    // 10줄 — 자동매매 막대 로딩 스켈레톤(폰 폭 전체 · 최대 288)
    if (phone) {
      const { page, ctx } = await open(browser, size, '#/portfolio/paper', { override: (u) => (u === '/api/auto-trading/strategies/8' ? { delayMs: 8000, json: API[u] } : undefined) });
      await openAccount(page);
      const w = await page.locator(`${BODY} .skeleton.h-7`).first().evaluate((e) => ({ w: e.getBoundingClientRect().width, pw: (e.parentElement as HTMLElement).clientWidth - 32 }));
      check('[149-8] 10줄 — 폰 자동매매 막대 로딩 스켈레톤 폭 = min(줄 폭, 288)', Math.abs(w.w - Math.min(w.pw, 288)) <= 1, JSON.stringify(w));
      await ctx.close();
    }
    // 12줄 — 폰 실제 계좌는 카드(고정 폭 592 표 없음)
    if (phone) {
      const { page, ctx } = await open(browser, size, '#/portfolio/real');
      check('[149-8] 12줄 — 폰 실제 계좌 고정 폭 표(min-w-[592px]) 없음 · 카드', (await page.locator('table').count()) === 0 && (await page.locator('[data-card]').count()) === 2);
      await touch(page, BODY, '실제 계좌', '');
      await ctx.close();
    }
  }

  // ───────── 10 매매 · 서버 코드 · 서버가 함께 쓰는 src · designCheck 판정 ─────────
  {
    const changed = (paths: string[]) => chasuDiff(root, CHASU, ['--name-only'], [...paths]).stdout.trim().split('\n').filter(Boolean);
    const server = changed(['server', 'deploy', 'python', 'db']);
    check('[149-10] 매매 · 주문 · 계좌 계산 · 자동매매 판단 · 로그인 · 서버 코드(server · deploy · python · db) 바뀐 파일 0', server.length === 0, server.join(', '));
    // ui/tokens.ts 는 서버 프로세스가 쓰지 않지만 시험(scripts)을 거쳐 서버 타입 검사에 들어간다 — 지시서가 값을 이름으로 두라고 한 곳이라 더하기만 허용
    const ADD_ONLY = ['src/data/changelog.ts', 'src/components/ui/tokens.ts'];
    const shared = changed(['src/types', 'src/utils', 'src/services', 'src/data']).filter((f) => !ADD_ONLY.includes(f));
    const log = chasuDiff(root, CHASU, ['-U0'], [...ADD_ONLY]).stdout;
    const removed = log.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---'));
    check('[149-10] 서버가 함께 쓰는 src(types · utils · services · data) 바뀐 줄 0 · changelog · ui/tokens.ts 는 더하기만(지운 줄 0)', shared.length === 0 && removed.length === 0, `${shared.join(', ')} · 지운 줄 ${removed.length}`);
    const dc = changed(['scripts/designCheck.ts']);
    check('[149-10] designCheck.ts 판정 부분 0(파일 그대로)', dc.length === 0, dc.join(', '));
  }

  // ───────── 11 design:lint ─────────
  {
    const lint = spawnSync('npx', ['tsx', 'scripts/designLint.ts'], { cwd: root, encoding: 'utf8' });
    check('[149-11] design:lint 통과', lint.status === 0, lint.stdout.split('\n').slice(-3).join(' '));
  }
} catch (e) {
  check('실행 오류 없음', false, String(e).slice(0, 300));
} finally {
  await browser.close().catch(() => {});
  await vite.close().catch(() => {});
}
console.log(`\nmobileaccount:test — 통과 ${pass} · 실패 ${fail}`);
process.exit(fail ? 1 : 0);
