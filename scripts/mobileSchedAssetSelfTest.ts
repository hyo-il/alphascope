/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
/**
 * 158차 폰 증시 일정 · 폰 자산 관리 시험(`npm run mobileschedasset:test` · v2.83.0) — 지시서 「꼭 지킬 동작」 1 ~ 13 줄마다 +
 * 점검 목록 「일정」 · 「자산 관리」 줄(117 ~ 122 · 135 ~ 143)마다 하나씩.
 *
 * 화면은 이 시험이 띄운 Vite(5185)에 열고, `/api` 는 모두 가짜 응답 — 앱 틀은 157차 견본(`scripts/fixtures/mobileChart/api.json`),
 * 일정은 만든 값(`fixtures/mobileSchedAsset/calendarSample.ts` — 받은 범위의 일정만), 자산 관리는 `designReviewShots.fakeContext` +
 * 장면마다 `designCheck` 의 자산 장면(`targets()` 이름 그대로 — 여는 코드 · 가짜 응답)을 다시 쓴다(실제 시트 0 · 쓰기는 가짜로 막음). 시계는 고정.
 * 폰 · 패드는 `isMobile` · `hasTouch`(손가락 화면).
 * 1 은 기준 커밋(d428185 · v2.82.0)에서 같은 가짜 응답 · 같은 시계로 잰 큰 화면 정답 파일(`desk.json`)과 견준다 —
 *   보이는 요소마다 「태그 · 클래스(낱말 순서 맞춤 · 폰 · 패드 · 손가락에서만 켜지는 이름 뺌) · 자리 · 크기」 가 같아야 한다(157차와 같음).
 *   정답 파일을 다시 만들 때: 기준 커밋 worktree 에 이 파일 · 견본을 넣고 `CAPTURE=<저장 경로> npx tsx scripts/mobileSchedAssetSelfTest.ts`.
 * 누르는 칸(44 미만 · 겹침)은 `design:check` 18 · 19 와 같은 셈을 **그 화면 본문 · 열린 창 안**으로만 잰다(위쪽 막대 · 시황 띠 · 패드 메뉴는 앱 틀 — 다른 차수).
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { createBrowserStepGuard } from './lib/browserStepGuard';
import { chasuChanged, type Chasu } from './lib/chasuRange';
import { closeLeftovers, targets } from './designCheck';
import { fakeContext } from './designReviewShots';
import { calendarSample } from './fixtures/mobileSchedAsset/calendarSample';

const root = path.resolve(import.meta.dirname, '..');
const PORT = 5185;
const WEB = `http://127.0.0.1:${PORT}`;
/** 기준 커밋(v2.82.0) — 1 의 정답 파일 · 12 는 여기서부터 이번 차수 범위 */
const BASE = 'd428185';
const CHASU: Chasu = { base: BASE, version: 'v2.83.0' };
const FIX = path.join(root, 'scripts/fixtures/mobileSchedAsset');
const FIXTURE = path.join(FIX, 'desk.json');
const API: Record<string, unknown> = JSON.parse(fs.readFileSync(path.join(root, 'scripts/fixtures/mobileChart/api.json'), 'utf8'));
const CAPTURE = process.env.CAPTURE ?? '';
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
/** `SHOTS=<폴더>` 면 폰 · 패드 장면 사진을 남긴다(점검 목록 사진 바꿔 넣기 · 눈으로 보기 — 판정과 상관없음) */
const SHOTS = process.env.SHOTS ?? '';
const QUIET = process.argv.includes('--summary') || process.env.QUIET === '1';
const FIXED = new Date('2026-11-27T05:00:00.000Z');
const CLIENT_VERSION = /version: '(v[\d.]+)'/.exec(fs.readFileSync(path.join(root, 'src/data/changelog.ts'), 'utf8'))?.[1] ?? '';

const guard = createBrowserStepGuard();
let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = '') {
  guard.mark(name);
  if (ok) pass++;
  else fail++;
  // `--summary`(또는 QUIET=1) — 통과 줄은 찍지 않는다(실패 줄 · 끝 요약만 — 출력을 파이프로 자르지 않게)
  if (!ok || !QUIET) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? ` — ${detail}` : ''}`);
}
const want = (part: string) => !ONLY || ONLY.test(part);

const PHONE = { width: 402, height: 874 };
const PAD = { width: 1133, height: 744 };
const DESK_SIZES = [{ width: 1280, height: 1080 }, { width: 1440, height: 900 }];
/** 1 · 비교하는 자산 장면(`designCheck` 이름) — 총 자산 · 자산 현황 · 비율 조정 · 이번 달 구매 · 설정 창 메뉴마다 · 매수 / 매도 · 새 종목 창 */
const ASSET_SCENES = [
  'asset-기록여러개-미지정',
  'asset-일별변화-표',
  'asset-자산현황-계좌카드',
  'asset-자산현황-종목별-전체',
  'asset-비율조정',
  'asset-이번달구매',
  'asset-이번달구매-살종목',
  'asset-설정창-메뉴-목표비율',
  'asset-설정창-메뉴-코어위성',
  'asset-설정창-메뉴-연금',
  'asset-설정창-메뉴-이번달구매',
  'asset-설정창-메뉴-자산분류색',
  'asset-설정창-메뉴-시트가격',
  'asset-설정창-메뉴-잠금',
  'asset-설정창-현금자동반영',
  'asset-매수창-국내',
  'asset-매도창-처음',
  'asset-새종목-입력창',
];
const TARGETS = new Map(targets().map((t) => [t.name, t]));

/** 가짜 응답 찾기 — 주소 그대로 → 같은 경로(쿼리 다름) 첫 것 */
function reply(u: string): unknown | undefined {
  if (u in API) return API[u];
  const p = u.split('?')[0];
  const k = Object.keys(API).find((x) => x.split('?')[0] === p);
  return k ? API[k] : undefined;
}

type Opened = { page: Page; ctx: BrowserContext; errors: string[]; calendar: string[] };
async function open(browser: Browser, size: { width: number; height: number }, hash = '#/home', init = '', settle = 2500): Promise<Opened> {
  const mobile = size.width < 1280;
  const ctx = await browser.newContext(mobile ? { viewport: size, isMobile: true, hasTouch: true } : { viewport: size });
  await ctx.addInitScript('window.__name = (f) => f');
  if (init) await ctx.addInitScript(init);
  const errors: string[] = [];
  const calendar: string[] = [];
  // 맥락 전체 — 모르는 주소 503 · 쓰기 503(자산 쓰기는 아래 fakeContext · 장면 route 가 먼저)
  await ctx.route(/\/api\//, async (r) => {
    const req = r.request();
    const u = req.url().replace(WEB, '');
    if (u.startsWith('/api/auth/me')) return r.fulfill({ json: { ok: true } });
    if (u.startsWith('/api/version')) return r.fulfill({ json: { version: CLIENT_VERSION, startedAt: '2026-11-25T00:00:00.000Z' } });
    if (u.startsWith('/api/calendar?')) {
      calendar.push(u);
      return r.fulfill({ json: calendarSample(u) });
    }
    if (req.method() !== 'GET') return r.fulfill({ status: 503, json: { error: '시험 — 쓰지 않음' } });
    const j = reply(u);
    if (j !== undefined) return r.fulfill({ json: j });
    return r.fulfill({ status: 503, json: { error: '시험 — 없음' } });
  });
  await fakeContext(ctx);
  const page = await ctx.newPage();
  // 장면 여는 코드의 `click().catch()` 가 30초씩 기다리지 않게(없는 요소는 8초 안에 넘어감)
  page.setDefaultTimeout(8000);
  await page.clock.setFixedTime(FIXED);
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
  await guard.step(`페이지 열기(${size.width}×${size.height} ${hash})`, () => page.goto(`${WEB}/${hash}`));
  await page.waitForTimeout(settle);
  await page.addStyleTag({ content: '*::-webkit-scrollbar { width: 0 !important; height: 0 !important; } * { scrollbar-width: none !important; }' });
  return { page, ctx, errors, calendar };
}
/** 새 페이지에서 자산 장면 하나(폰 · 패드 — 앞 장면 창 · 확인 창이 남지 않게 장면마다 새로) */
async function fresh(browser: Browser, size: { width: number; height: number }, name: string): Promise<Opened> {
  const o = await open(browser, size, '#/home', '', 1000);
  await scene(o.page, name);
  return o;
}
/** designCheck 자산 장면 하나를 연다(홈을 거쳐 · before → 주소 → open) */
async function scene(page: Page, name: string) {
  const t = TARGETS.get(name);
  if (!t) throw new Error(`장면 없음: ${name}`);
  await closeLeftovers(page);
  await page.mouse.move(0, 0);
  if ((await page.evaluate(() => location.hash)) !== '#/home') {
    await page.evaluate(() => (location.hash = '#/home'));
    await page.waitForTimeout(500);
  }
  if (t.before) await t.before(page);
  await page.evaluate((h) => (location.hash = h), t.hash);
  await page.waitForTimeout(2200);
  if (t.open) await guard.step(`장면 ${name}`, () => t.open!(page));
  await page.waitForTimeout(400);
  return t;
}
async function leave(page: Page, name: string) {
  const t = TARGETS.get(name)!;
  await page.keyboard.press('Escape').catch(() => {});
  if (t.after) await t.after(page).catch(() => {});
  await closeLeftovers(page);
}
async function shot(page: Page, name: string, full = true) {
  if (!SHOTS) return;
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage: full });
}
/** 자산 설정 창 왼쪽(폰은 위) 메뉴 고르기 */
async function settingsMenu(page: Page, name: string) {
  await guard.step(`설정 메뉴 ${name}`, () => page.getByRole('dialog').getByRole('tab', { name, exact: true }).click({ timeout: 5000 }));
  await page.waitForTimeout(400);
}
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
 * 누르는 칸(design:check 18 · 19 와 같은 셈) — 본문(`[data-layout-body]`) · 열린 창(`[role=dialog]`) 안만.
 * 같은 묶음 단추(radiogroup) 안끼리는 겹침을 세지 않는다.
 */
async function touchIssues(page: Page, scope = '[data-layout-body], [role="dialog"]') {
  return page.evaluate((scopeSel) => {
    const MIN = 44;
    const small: string[] = [];
    const overlap: string[] = [];
    const label = (el: Element) => ((el as HTMLElement).innerText || el.getAttribute('aria-label') || el.tagName).replace(/\s+/g, ' ').slice(0, 24);
    const dialogs = [...document.querySelectorAll('[role="dialog"]')];
    const inScope = (el: Element) => {
      const host = el.closest(scopeSel);
      if (!host) return false;
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
    return { small, overlap };
  }, scope);
}
/** 본문 · 창 안 겹친 글 · 말줄임(글자 잘림) — design:check 「겹침」 · 「말줄임」 과 같은 뜻(잎 글 요소끼리) */
async function textIssues(page: Page, scope = '[data-layout-body], [role="dialog"]') {
  return page.evaluate((scopeSel) => {
    const dialogs = [...document.querySelectorAll('[role="dialog"]')];
    const leaves = [...document.querySelectorAll<HTMLElement>('body *')].filter((el) => {
      if (!el.closest(scopeSel) || (dialogs.length && !el.closest('[role="dialog"]'))) return false;
      if (el.closest('[aria-hidden="true"], .sr-only, svg, canvas, [data-scroll-table], [data-scroll-row]')) return false;
      if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim())) return false;
      const r = el.getBoundingClientRect();
      return r.width > 1 && r.height > 1 && r.bottom > 0 && r.top < innerHeight && getComputedStyle(el).visibility !== 'hidden';
    });
    const clipped = leaves
      .filter((el) => {
        const cs = getComputedStyle(el);
        return (cs.textOverflow === 'ellipsis' || cs.overflow === 'hidden') && el.scrollWidth > el.clientWidth + 1;
      })
      .map((el) => el.innerText.slice(0, 30));
    const overlap: string[] = [];
    const rs = leaves.map((el) => el.getBoundingClientRect());
    for (let i = 0; i < leaves.length; i++)
      for (let j = i + 1; j < leaves.length; j++) {
        if (leaves[i].contains(leaves[j]) || leaves[j].contains(leaves[i])) continue;
        const ox = Math.min(rs[i].right, rs[j].right) - Math.max(rs[i].left, rs[j].left);
        const oy = Math.min(rs[i].bottom, rs[j].bottom) - Math.max(rs[i].top, rs[j].top);
        if (ox > 2 && oy > 2) overlap.push(`${leaves[i].innerText.slice(0, 12)} ↔ ${leaves[j].innerText.slice(0, 12)}`);
      }
    return { clipped, overlap };
  }, scope);
}

const { createServer } = await import('vite');
const vite = await guard.step('Vite 띄우기', async () => {
  const v = await createServer({ root, configFile: path.join(root, 'vite.config.ts'), logLevel: 'error', server: { host: '127.0.0.1', port: PORT, strictPort: true, hmr: false } });
  await v.listen();
  return v;
});
const browser = await guard.step('브라우저 띄우기', () => chromium.launch({ channel: 'chrome' }));

/** 1280 — 7일(11/22 ~ 11/28)마다 그날 목록 글(줄마다) */
const deskDays: Record<string, string[]> = {};
let deskDecUrl = '';
const WEEK = ['2026-11-22', '2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27', '2026-11-28'];
const lines = (page: Page, sel: string) => page.locator(sel).evaluateAll((els) => els.map((e) => (e as HTMLElement).innerText.replace(/\s+/g, ' ').trim()));

try {
  // ───────── 1 큰 화면 그대로 ─────────
  if (want('desk')) {
    const shots: Record<string, string[]> = {};
    for (const size of DESK_SIZES) {
      const key = `${size.width}x${size.height}`;
      const o = await open(browser, size, '#/calendar');
      shots[`${key} 증시 일정`] = await guard.step('모양 재기', () => deskSnapshot(o.page));
      await guard.step('날짜 고르기 열기', () => o.page.getByRole('button', { name: '2026년 11월', exact: true }).click({ timeout: 5000 }));
      await o.page.waitForTimeout(600);
      shots[`${key} 증시 일정 날짜 고르기`] = await guard.step('모양 재기', () => deskSnapshot(o.page));
      await o.page.keyboard.press('Escape');
      for (const name of ASSET_SCENES) {
        await scene(o.page, name);
        shots[`${key} ${name}`] = await guard.step('모양 재기', () => deskSnapshot(o.page));
        await leave(o.page, name);
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
    const wantShots = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')) as Record<string, string[]>;
    const norm = (x: string) => x.replace(/\s+/g, ' ').replace(/ ?\| ?/g, '|');
    for (const key of Object.keys(wantShots)) {
      const a = wantShots[key].map(norm);
      const b = (shots[key] ?? []).map(norm);
      const i = a.findIndex((x, k) => x !== b[k]);
      const same = a.length === b.length && i < 0;
      check(`[158-1] ${key} — 기준 커밋(${BASE})과 요소 ${a.length}개 태그 · 클래스 · 자리 · 크기 같음`, same, same ? '' : `개수 ${a.length} → ${b.length} · 첫 차이 #${i}: ${a[i] ?? '-'} → ${b[i] ?? '-'}`);
    }
  }

  // ───────── 2 · 3 의 1280 기준 — 7일마다 그날 목록 · [다음 달] 요청 주소 ─────────
  if (want('cal')) {
    const o = await open(browser, DESK_SIZES[0], '#/calendar');
    for (const d of WEEK) {
      await o.page.locator(`[data-month-grid] [data-day="${d}"]`).click();
      await o.page.waitForTimeout(150);
      deskDays[d] = await lines(o.page, '[data-day-panel] li');
    }
    const before = o.calendar.length;
    await o.page.getByRole('button', { name: '다음 달', exact: true }).click();
    await o.page.waitForTimeout(1200);
    deskDecUrl = o.calendar.slice(before).join(' ');
    await o.ctx.close();
  }

  // ───────── 2 · 117 · 118 폰 일정 모양 · 7일 칸 건수 · 그날 카드 ─────────
  if (want('cal')) {
    const o = await open(browser, PHONE, '#/calendar');
    const { page } = o;
    check('[158-2] 402 — 화면 모양 phone', (await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--layout-mode').trim())) === 'phone');
    await shot(page, '402-calendar');
    const grid = await page.locator('[data-month-grid]').count();
    const nav = await rect(page, '[data-testid="phone-week-nav"]');
    const days = await rect(page, '[data-testid="phone-week-days"]');
    const cards = await rect(page, '[data-testid="phone-day-events"]');
    check('[158-2] 402 달력 격자 없음 · 주 이동 줄 → 7일 칸 → 그날 일정 카드 차례', grid === 0 && Boolean(nav && days && cards && nav.b <= days.y && days.b <= cards.y), JSON.stringify({ grid, nav, days, cards }));
    const navNames = await page.getByTestId('phone-week-nav').getByRole('button').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label') ?? (e as HTMLElement).innerText));
    check('[158-2] 주 이동 줄 = [이전 주] 「2026년 11월 4주」 [다음 주] [오늘]', navNames.join('|') === '이전 주|2026년 11월 4주 — 날짜 고르기|다음 주|오늘', navNames.join('|'));
    const dayBtns = page.getByTestId('phone-week-days').getByRole('button');
    const dayList = await dayBtns.evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.day ?? ''));
    check('[158-2] 7일 칸 = 11/22(일) ~ 11/28(토) · 처음 고른 날 = 오늘(11/27 · aria-current · aria-pressed)', dayList.join(',') === WEEK.join(',') && (await page.locator('[data-testid="phone-week-days"] [aria-current="date"]').getAttribute('data-day')) === '2026-11-27' && (await page.locator('[data-testid="phone-week-days"] [aria-pressed="true"]').getAttribute('data-day')) === '2026-11-27', dayList.join(','));
    const counts = await page.locator('[data-testid="phone-week-days"] [data-day-count]').allInnerTexts();
    const deskCounts = WEEK.map((d) => (deskDays[d]?.length ? `${deskDays[d].length}건` : ''));
    check(`[158-2] 7일 칸 「N건」 = 1280 같은 날 목록 건수(${deskCounts.join(',')})`, Object.keys(deskDays).length === 7 && counts.map((c) => c.trim()).join(',') === deskCounts.join(','), counts.join(','));
    let sameAll = true;
    const diffs: string[] = [];
    for (const d of WEEK) {
      await page.locator(`[data-testid="phone-week-days"] [data-day="${d}"]`).click();
      await page.waitForTimeout(150);
      const got = await lines(page, '[data-testid="phone-day-events"] [data-event-card]');
      if (got.join('\n') !== (deskDays[d] ?? []).join('\n')) {
        sameAll = false;
        diffs.push(`${d}: ${got.join(' / ')} ≠ ${(deskDays[d] ?? []).join(' / ')}`);
      }
    }
    check('[158-2] 날을 누르면 그날 일정 카드 = 1280 오른쪽 판 같은 날 목록(글 · 차례 · 7일 모두)', sameAll, diffs.join(' ; '));
    const st = await page.evaluate(() => {
      const sel = document.querySelector('[data-testid="phone-week-days"] [aria-pressed="true"]') as HTMLElement;
      const cs = getComputedStyle(sel);
      const probe = document.createElement('div');
      probe.className = 'bg-bg-elevated';
      document.body.appendChild(probe);
      const want = getComputedStyle(probe).backgroundColor;
      probe.remove();
      const [w, d, n] = [...sel.children].filter((c) => !c.hasAttribute('aria-hidden')).map((c) => parseFloat(getComputedStyle(c).fontSize));
      return { bg: cs.backgroundColor === want, line: cs.textDecorationLine.includes('underline'), w, d, n };
    });
    check('[158-2] 고른 날 = 바탕 bg-elevated + 밑줄 · 요일 13 · 날짜 16 · 「N건」 13', st.bg && st.line && st.w === 13 && st.d === 16 && st.n === 13, JSON.stringify(st));
    const t = await textIssues(page);
    check('[158-117] 402 날짜 숫자가 읽힘 — 7일 칸 폭 44 이상 · 글 겹침 0 [점검 117]', (days?.w ?? 0) / 7 >= 44 && t.overlap.length === 0, `${days?.w} · ${t.overlap.join(' / ')}`);
    check('[158-118] 402 일정 화면 요소 겹침 0 [점검 118]', t.overlap.length === 0, t.overlap.join(' / '));
    // 거르기 칩 — 7일 칸 위 한 줄(32 · 넘치면 밀기 + 끝 흐림)
    const fr = await rect(page, '[data-testid="phone-calendar-filters"]');
    const chipH = await page.getByTestId('phone-calendar-filters').getByRole('button').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
    check('[158-2] 거르기 칩 = 7일 칸 위 한 줄(44) · 칩 32', Boolean(fr && days && fr.b <= days.y && Math.round(fr.h) === 44) && chipH.length === 4 && chipH.every((h) => h === 32), `${JSON.stringify(fr)} · ${chipH.join(',')}`);
    // 거르기 칩을 끄면 7일 칸 건수 · 카드가 같이 줄어든다(같은 거르기)
    await page.locator('[data-testid="phone-week-days"] [data-day="2026-11-27"]').click();
    await page.getByTestId('phone-calendar-filters').getByRole('button', { name: /실적/ }).click();
    await page.waitForTimeout(200);
    const after = (await page.locator('[data-testid="phone-week-days"] [data-day="2026-11-27"] [data-day-count]').innerText()).trim();
    const cardsAfter = await page.locator('[data-testid="phone-day-events"] [data-event-card]').count();
    check('[158-2] [실적] 끄면 11/27 = 1건(FOMC) · 카드 1장', after === '1건' && cardsAfter === 1, `${after} · ${cardsAfter}`);
    await o.ctx.close();
  }

  // ───────── 3 주 이동 · 받는 범위 ─────────
  if (want('cal')) {
    const o = await open(browser, PHONE, '#/calendar');
    const { page } = o;
    const n0 = o.calendar.length;
    const title = () => page.getByTestId('phone-week-nav').getByRole('button', { name: /날짜 고르기$/ }).innerText();
    await page.getByRole('button', { name: '이전 주', exact: true }).click();
    await page.waitForTimeout(800);
    const n1 = o.calendar.length;
    const t1 = (await title()).trim();
    check(`[158-3] 같은 달 안 [이전 주](11/27 → 11/20) — 요청 0 · 「2026년 11월 3주」(${t1})`, n1 === n0 && t1 === '2026년 11월 3주', `${n0} → ${n1}`);
    await page.getByRole('button', { name: '다음 주', exact: true }).click();
    await page.waitForTimeout(600);
    await page.getByRole('button', { name: '다음 주', exact: true }).click(); // 11/27 → 12/4
    await page.waitForTimeout(1500);
    const decReq = o.calendar.slice(n1);
    const sel = await page.locator('[data-testid="phone-week-days"] [aria-pressed="true"]').getAttribute('data-day');
    check(`[158-3] [다음 주]로 12월이 되면 요청 한 번(1280 [다음 달] 과 같은 주소 ${deskDecUrl})`, decReq.length === 1 && decReq[0] === deskDecUrl && sel === '2026-12-04', `${decReq.join(' ')} · ${sel}`);
    const decCount = (await page.locator('[data-testid="phone-week-days"] [data-day="2026-12-04"] [data-day-count]').innerText()).trim();
    check('[158-3] 12/4 「1건」 · 카드 = 브로드컴(12월 응답)', decCount === '1건' && /브로드컴/.test(await page.getByTestId('phone-day-events').innerText()), decCount);
    // 주가 달 경계에 걸쳐도(11/29 ~ 12/5) 앞 달 날 건수가 보인다(받는 범위 ± 7일)
    const n2 = o.calendar.length;
    await page.locator('[data-testid="phone-week-days"] [data-day="2026-12-02"]').click();
    await page.waitForTimeout(500);
    check('[158-3] 같은 달 안 날 누름 — 요청 0', o.calendar.length === n2);
    await page.getByRole('button', { name: '오늘', exact: true }).click();
    await page.waitForTimeout(1500);
    const todaySel = await page.locator('[data-testid="phone-week-days"] [aria-pressed="true"]').getAttribute('data-day');
    const t2 = (await title()).trim();
    check(`[158-3] [오늘] = 이번 주 · 오늘(11/27 · 시험 시계) 고름 · 11월을 다시 받음(${t2})`, todaySel === '2026-11-27' && t2 === '2026년 11월 4주' && o.calendar.length === n2 + 1, `${todaySel} · ${o.calendar.length - n2}`);
    // 받는 동안 — 7일 칸을 두고 인라인 스피너만(없음 · 0 을 그리지 않음)
    await page.route(/\/api\/calendar\?/, async (r) => {
      await new Promise((res) => setTimeout(res, 1500));
      await r.fulfill({ json: calendarSample(r.request().url()) }).catch(() => {});
    });
    await page.getByRole('button', { name: '다음 주', exact: true }).click();
    await page.getByRole('button', { name: '다음 주', exact: true }).click();
    await page.waitForTimeout(300);
    const mid = await page.evaluate(() => ({
      days: document.querySelectorAll('[data-testid="phone-week-days"] button').length,
      spin: Boolean(document.querySelector('[data-testid="phone-week-nav"] .animate-spin, [data-testid="phone-week-nav"] [role="status"]')),
      skel: document.querySelectorAll('[data-card-skeleton]').length,
    }));
    check('[158-3] 받는 동안 7일 칸 그대로 · 주 이동 줄 인라인 스피너 · 스켈레톤 없음', mid.days === 7 && mid.spin && mid.skel === 0, JSON.stringify(mid));
    await page.waitForTimeout(2500);
    await page.unroute(/\/api\/calendar\?/);
    await o.ctx.close();
  }

  // ───────── 11 · 119 ~ 122 손가락 크기 ─────────
  if (want('cal')) {
    for (const size of [PHONE, PAD]) {
      const o = await open(browser, size, '#/calendar');
      const { page } = o;
      const phone = size.width === 402;
      const t = await touchIssues(page);
      if (!phone) await shot(page, '1133-calendar');
      await page.getByRole('button', { name: phone ? /날짜 고르기$/ : '2026년 11월' }).first().click();
      await page.waitForTimeout(600);
      await shot(page, `${size.width}-calendar-picker`, false);
      const tp = await touchIssues(page);
      await page.keyboard.press('Escape');
      const small = [...t.small, ...tp.small.map((x) => `날짜 고르기: ${x}`)];
      const overlap = [...t.overlap, ...tp.overlap.map((x) => `날짜 고르기: ${x}`)];
      check(`[158-11] ${size.width} 증시 일정(날짜 고르기 판 포함) 누르는 칸 44 미만 0`, small.length === 0, small.join(' / '));
      check(`[158-11] ${size.width} 증시 일정(날짜 고르기 판 포함) 누르는 칸 겹침 0`, overlap.length === 0, overlap.join(' / '));
      if (phone) {
        check('[158-119] 402 누르는 칸 44 미만 0(거르기 칩 · 날짜 칸) [점검 119]', small.length === 0, small.join(' / '));
        check('[158-120] 402 누르는 칸 겹침 0(주 이동 · 날짜 고르기 판) [점검 120]', overlap.length === 0, overlap.join(' / '));
      } else {
        check('[158-121] 1133 누르는 칸 44 미만 0(실적 · 거시 · 만기 · 휴장 · 관심 종목만) [점검 121]', small.length === 0, small.join(' / '));
        check('[158-122] 1133 누르는 칸 겹침 0(이전 달 ↔ 2026년 11월) [점검 122]', overlap.length === 0, overlap.join(' / '));
        check('[158-122] 1133 = 달력 격자 그대로(패드는 지금 모양)', (await page.locator('[data-month-grid]').count()) === 1 && (await page.getByTestId('phone-week-days').count()) === 0);
      }
      await o.ctx.close();
    }
  }

  // ───────── 4 · 5 · 135 · 136 · 140 · 142 폰 자산 머리 · 숫자 카드 · 원형 차트 ─────────
  /** 1280 분류별 표 줄 — [분류, 금액, 비율] */
  let deskGroups: string[][] = [];
  if (want('asset-head')) {
    const o = await open(browser, DESK_SIZES[0], '#/home');
    await scene(o.page, 'asset-기록여러개-미지정');
    deskGroups = await o.page.locator('[data-testid="asset-group-table"] tbody tr').evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => (td as HTMLElement).innerText.replace(/\s+/g, ' ').trim())));
    const checked = await o.page.locator('[data-asset-pension]').isChecked();
    check('[158-4] 1280 머리 = 「연금 포함」 체크박스 그대로(처음 끔)', !checked);
    await o.ctx.close();
  }
  if (want('asset-head')) {
    const o = await open(browser, PHONE, '#/home');
    const { page } = o;
    await scene(page, 'asset-기록여러개-미지정');
    await shot(page, '402-asset-total');
    const head = await rect(page, '[data-testid="asset-phone-head"]');
    const btns = await page.getByTestId('asset-phone-head').getByRole('button').evaluateAll((els) =>
      els.map((e) => {
        const r = e.getBoundingClientRect();
        const a = getComputedStyle(e, '::after');
        return { name: e.getAttribute('aria-label'), top: Math.round(r.top), hit: Math.min(Math.max(r.width, parseFloat(a.width) || 0), Math.max(r.height, parseFloat(a.height) || 0)) };
      }),
    );
    const time = (await page.getByTestId('asset-phone-head').innerText()).trim();
    check('[158-4] 402 머리 한 줄 — 왼쪽 「읽은 시각」 · 오른쪽 [연금 포함] [다시 읽기] [잠그기] [설정] · 같은 줄 · 누르는 칸 44', btns.map((b) => b.name).join('|') === '연금 포함|다시 읽기|잠그기|설정' && new Set(btns.map((b) => b.top)).size === 1 && btns.every((b) => b.hit >= 44) && /^읽은 시각 /.test(time) && Boolean(head && head.h <= 44), JSON.stringify({ btns, time, head }));
    check('[158-136] 402 「연금 포함 · 읽은 시각」 줄 한 줄 · 아이콘이 다음 줄로 내려가지 않음 [점검 136]', new Set(btns.map((b) => b.top)).size === 1 && Boolean(head && head.h <= 44), JSON.stringify(head));
    const pen = page.getByTestId('asset-phone-head').getByRole('button', { name: '연금 포함' });
    const before = await pen.getAttribute('aria-pressed');
    await pen.click();
    await page.waitForTimeout(1500);
    const after = await pen.getAttribute('aria-pressed');
    const stored = await page.evaluate(() => localStorage.getItem('alphascope.asset.includePension'));
    check('[158-4] [연금 포함] 누르면 누름 상태(aria-pressed) 켜짐 · 1280 체크박스와 같은 기억(alphascope.asset.includePension = 1)', before === 'false' && after === 'true' && stored === '1', `${before} → ${after} · ${stored}`);
    const cards = await page.locator('[data-asset-card]').evaluateAll((els) => els.map((e) => {
      const r = e.getBoundingClientRect();
      const v = e.querySelector('[data-asset-card-value]') as HTMLElement;
      const sub = e.querySelector('[data-asset-card-sub]') as HTMLElement;
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), vClip: v.scrollWidth > v.clientWidth + 1, sClip: sub.scrollWidth > sub.clientWidth + 1, vSize: parseFloat(getComputedStyle(v).fontSize) };
    }));
    const stacked = cards.length === 3 && new Set(cards.map((c) => c.x)).size === 1 && cards[0].y < cards[1].y && cards[1].y < cards[2].y;
    check('[158-5] 402 숫자 카드 셋이 세로로 쌓임 · 값 18 · 금액 · 변화 줄 말줄임 0', stacked && cards.every((c) => !c.vClip && !c.sClip && c.vSize === 18), JSON.stringify(cards));
    check('[158-135] 402 요약 카드 금액이 잘리지 않음 [점검 135]', stacked && cards.every((c) => !c.vClip), JSON.stringify(cards));
    check('[158-140] 402 카드 변화 줄 말줄임 0(「+0.43% · 2026-11-0…」 · 「−2.34% · 평균 매입가 대비」) [점검 140]', cards.every((c) => !c.sClip), JSON.stringify(cards));
    const subColor = await page.locator('[data-asset-card-sub] span').first().evaluate((e) => getComputedStyle(e).color).catch(() => '');
    check('[158-5] 402 변화 줄 % 는 등락 색', subColor !== '' && subColor !== (await page.locator('[data-asset-card-sub]').first().evaluate((e) => getComputedStyle(e).color)), subColor);
    const donut = await rect(page, '[data-testid="asset-donut-row"] figure');
    const panel = await rect(page, '[data-testid="asset-donut-row"] > div');
    const table = await rect(page, '[data-testid="asset-group-table"]');
    const row = await rect(page, '[data-testid="asset-donut-row"]');
    check('[158-5] 402 원형 차트 160 · 위 가운데 · 분류별 표(범례)는 아래 폭 전체', Boolean(donut && panel && table && row && Math.round(donut.w) === 160 && Math.abs(donut.x + donut.w / 2 - (panel.x + panel.w / 2)) <= 1 && table.y >= panel.b && Math.abs(table.w - row.w) <= 1), JSON.stringify({ donut, panel, table, row }));
    // 연금 포함을 켠 뒤라 1280 표(끔)와 견주려면 되돌린다
    await pen.click();
    await page.waitForTimeout(1500);
    const phoneGroups = await page.locator('[data-testid="asset-group-table"] tbody tr').evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => (td as HTMLElement).innerText.replace(/\s+/g, ' ').trim())));
    const reordered = deskGroups.map((r) => [r[0], r[2], r[1]].join(' | '));
    check(`[158-5] 범례 줄(이름 · % · 금액) = 1280 분류별 표 줄 ${deskGroups.length}개(칸 차례만 다름)`, deskGroups.length > 0 && phoneGroups.map((r) => r.join(' | ')).join('\n') === reordered.join('\n'), `${phoneGroups.map((r) => r.join(' | ')).join(' / ')} ≠ ${reordered.join(' / ')}`);
    const t = await touchIssues(page);
    check('[158-142] 402 자산 관리 누르는 칸 겹침 0(설정 ↔ 설명) [점검 142]', t.overlap.length === 0, t.overlap.join(' / '));
    await o.ctx.close();
  }

  // ───────── 6 · 137 총 자산 추이 누르기 ─────────
  if (want('asset-tap')) {
    for (const size of [PHONE, PAD]) {
      const o = await open(browser, size, '#/home');
      const { page } = o;
      await scene(page, 'asset-기록여러개-미지정');
      const box = await page.getByTestId('asset-history-chart').boundingBox();
      await page.getByTestId('asset-history-chart').scrollIntoViewIfNeeded();
      const b = (await page.getByTestId('asset-history-chart').boundingBox()) ?? box;
      await page.touchscreen.tap(b!.x + b!.width * 0.5, b!.y + b!.height * 0.5);
      await page.waitForTimeout(500);
      const tip = page.getByTestId('asset-history-tip');
      const shown = (await tip.count()) > 0 ? (await tip.innerText()).replace(/\s+/g, ' ') : '';
      const visible = (await tip.count()) > 0 && (await tip.evaluate((e) => !e.className.includes('invisible')));
      check(`[158-6] ${size.width} 점을 누르면 날짜 · 금액 · 전날 대비가 뜸(${shown.slice(0, 60)})`, visible && /\d{4}-\d{2}-\d{2}/.test(shown) && /₩/.test(shown) && /(전날|대비)/.test(shown), shown);
      await page.locator('[data-asset-card]').first().tap();
      await page.waitForTimeout(400);
      const gone = (await tip.count()) === 0;
      check(`[158-6] ${size.width} 다른 곳을 누르면 닫힘`, gone);
      check(`[158-137] ${size.width} 총 자산 추이 날짜별 금액이 손가락 누르기로 보임 [점검 137]`, visible && gone);
      await o.ctx.close();
    }
    const o = await open(browser, DESK_SIZES[0], '#/home');
    await scene(o.page, 'asset-기록여러개-미지정');
    const box = (await o.page.getByTestId('asset-history-chart').boundingBox())!;
    await o.page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await o.page.waitForTimeout(500);
    const tip = (await o.page.getByTestId('asset-history-tip').count()) > 0 ? await o.page.getByTestId('asset-history-tip').innerText() : '';
    await o.page.mouse.move(box.x + box.width * 0.5, box.y + box.height + 120);
    await o.page.waitForTimeout(400);
    check('[158-6] 1280 마우스 올림 그대로(올리면 뜸 · 벗어나면 닫힘)', /₩/.test(tip) && (await o.page.getByTestId('asset-history-tip').count()) === 0, tip);
    await o.ctx.close();
  }

  // ───────── 7 · 비율 조정 · 이번 달 구매 ─────────
  if (want('asset-buy')) {
    const o = await open(browser, PHONE, '#/home');
    const { page } = o;
    await scene(page, 'asset-이번달구매-계좌별');
    await shot(page, '402-asset-rebalance');
    const groups = await page.locator('[data-purchase-actions]').evaluateAll((els) => els.map((g) => {
      const bs = [...g.querySelectorAll('button')].map((b) => b.getBoundingClientRect());
      const gaps = bs.slice(1).map((r, i) => Math.round(r.left - bs[i].right));
      return { n: bs.length, tops: [...new Set(bs.map((r) => Math.round(r.top)))].length, gaps };
    }));
    const two = groups.filter((g) => g.n >= 2);
    check(`[158-7] 402 계좌 줄 단추가 한 줄에 나란히 · 사이 12 이상(${two.length}묶음)`, two.length > 0 && two.every((g) => g.tops === 1 && g.gaps.every((x) => x >= 12)), JSON.stringify(groups));
    const base = await rect(page, '[data-testid="rebalance-base-card"]');
    const edit = await rect(page, '[data-testid="rebalance-base-card"] [data-edit-target]');
    const tip = await page.getByTestId('rebalance-base-card').getByRole('button', { name: '기준 금액' }).count();
    const word = await textIssues(page);
    check('[158-7] 402 「기준 금액」 카드 — 설명은 [?] · [목표 비율 바꾸기] 는 카드 아래 줄 · 잘림 0', Boolean(base && edit && edit.b <= base.b && edit.r <= base.r) && tip === 1 && word.clipped.length === 0, JSON.stringify({ base, edit, tip, clip: word.clipped }));
    await o.ctx.close();
  }

  // ───────── 141 · 143 일별 자산 변화 표 · 138 · 139 고정 폭 칸 ─────────
  if (want('asset-fixed')) {
    for (const size of [PHONE, PAD]) {
      const o = await open(browser, size, '#/home');
      const { page } = o;
      await scene(page, 'asset-일별변화-표');
      const t = await touchIssues(page, '[data-testid="asset-daily-table"]');
      const tag = size.width === 402 ? '141' : '143';
      check(`[158-${tag}] ${size.width} 일별 자산 변화 표 — 날짜 줄 · 메모 누르는 칸 44 미만 0 · 겹침 0 [점검 ${tag}]`, t.small.length === 0 && t.overlap.length === 0, [...t.small, ...t.overlap].join(' / '));
      await o.ctx.close();
    }
    const o = await open(browser, PHONE, '#/home');
    const { page } = o;
    await scene(page, 'asset-설정창-현금자동반영');
    await shot(page, '402-asset-cash-settings', false);
    const fixed = await page.evaluate(() => {
      const dlg = document.querySelector('[role="dialog"]');
      if (!dlg) return ['창 없음'];
      const dw = dlg.getBoundingClientRect();
      return [...dlg.querySelectorAll<HTMLElement>('[data-testid="asset-cash-pair-row"] > *, [data-testid="asset-cash-banks"] li > *')]
        .filter((e) => e.getBoundingClientRect().width > 0)
        .filter((e) => e.getBoundingClientRect().right > dw.right + 0.5 || e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflow === 'visible')
        .map((e) => `${e.tagName} ${Math.round(e.getBoundingClientRect().width)}`);
    });
    const pairW = await page.locator('[data-testid="asset-cash-pair-row"]').first().evaluate((li) => {
      const picker = li.querySelector('button[aria-haspopup="listbox"]') as HTMLElement | null;
      if (!picker) return 999;
      const cs = getComputedStyle(li);
      return Math.round(picker.getBoundingClientRect().width) - Math.round(li.getBoundingClientRect().width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
    });
    check('[158-138] 402 현금 자동 반영 w-64 · w-72 칸 = 폭 전체(위 이름 · 아래 값) · 판 밖으로 넘침 0 [점검 138]', fixed.length === 0 && Math.abs(pairW) <= 1, `${fixed.join(' / ')} · 차이 ${pairW}`);
    await o.ctx.close();
    const o2 = await fresh(browser, PHONE, 'asset-설정창');
    const page2 = o2.page;
    await settingsMenu(page2, '연금');
    await guard.step('계좌 추가', () => page2.getByRole('dialog').getByRole('button', { name: '계좌 추가', exact: true }).click({ timeout: 5000 }));
    await page2.waitForTimeout(600);
    await shot(page2, '402-asset-account-add', false);
    const col = await page2.evaluate(() => {
      const dlg = [...document.querySelectorAll('[role="dialog"]')].pop();
      if (!dlg?.querySelector('[data-account-picker]')) return { pickW: 0, rightW: -1, stacked: false, none: true };
      const pick = dlg.querySelector('[data-account-picker]')!.getBoundingClientRect();
      const right = (dlg.querySelector('[data-account-picker]')!.nextElementSibling as HTMLElement).getBoundingClientRect();
      return { pickW: Math.round(pick.width), rightW: Math.round(right.width), stacked: right.top >= pick.bottom - 1 };
    });
    check('[158-139] 402 계좌 추가 창 w-[300px] 칸 = 폭 전체(목록 아래로) [점검 139]', col.stacked && Math.abs(col.pickW - col.rightW) <= 1, JSON.stringify(col));
    await o2.ctx.close();
  }

  // ───────── 8 설정 창 — 탭 줄 끝 흐림 · [저장] 단추 줄 · 코어 · 위성 위 이름 / 아래 안내 · 드롭다운 44 ─────────
  if (want('asset-settings')) {
    for (const size of [PHONE, PAD]) {
      const o = await open(browser, size, '#/home');
      const { page } = o;
      const phone = size.width === 402;
      await scene(page, 'asset-설정창');
      await settingsMenu(page, '목표 비율');
      if (phone) {
        const fade0 = await page.evaluate(() => (document.querySelector('[data-side-nav]')?.closest('[data-scroll-row]') as HTMLElement | null)?.dataset.fade ?? 'none');
        await page.evaluate(() => {
          const inner = document.querySelector('[data-side-nav]')!.closest('[data-scroll-row-inner]') as HTMLElement;
          inner.scrollLeft = inner.scrollWidth;
        });
        await page.waitForTimeout(400);
        const fade1 = await page.evaluate(() => (document.querySelector('[data-side-nav]')?.closest('[data-scroll-row]') as HTMLElement | null)?.dataset.fade ?? 'none');
        check('[158-8] 402 설정 창 메뉴 줄 — 넘치면 오른쪽 끝 흐림 · 끝까지 밀면 오른쪽 흐림 사라짐(R7)', fade0.includes('r') && !fade1.includes('r') && fade1 !== 'none', `${fade0} → ${fade1}`);
        await page.evaluate(() => {
          const inner = document.querySelector('[data-side-nav]')!.closest('[data-scroll-row-inner]') as HTMLElement;
          inner.scrollLeft = 0;
        });
      } else {
        const nav = await page.evaluate(() => {
          const n = document.querySelector('[data-side-nav]') as HTMLElement;
          return { vertical: getComputedStyle(n).flexDirection === 'column', over: n.scrollHeight > n.clientHeight + 1 || n.scrollWidth > n.clientWidth + 1 };
        });
        check('[158-8] 1133 설정 창 메뉴 = 왼쪽 세로 줄 · 넘침 없음(잘린 메뉴 글 없음)', nav.vertical && !nav.over, JSON.stringify(nav));
      }
      const tabH = await page.getByRole('dialog').getByRole('tab').evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
      check(`[158-8] ${size.width} 설정 창 메뉴 칸 높이 44`, tabH.length === 8 && tabH.every((h) => h >= 44), tabH.join(','));
      const save = await page.evaluate(() => {
        const dlg = document.querySelector('[role="dialog"] > div') as HTMLElement;
        const foot = dlg.querySelector('[data-dialog-foot]') as HTMLElement | null;
        const btn = [...dlg.querySelectorAll('button')].find((b) => b.innerText.trim() === '저장') as HTMLElement | undefined;
        const inForm = Boolean(btn?.closest('[data-setting="target-ratio"]'));
        const d = dlg.getBoundingClientRect();
        const f = foot?.getBoundingClientRect();
        return { inForm, btn: Boolean(btn), inFoot: Boolean(btn && foot?.contains(btn)), footBottom: f ? Math.round(d.bottom - f.bottom) : -1, h: btn ? Math.round(btn.getBoundingClientRect().height) : 0 };
      });
      check(`[158-8] ${size.width} 「목표 비율」 [저장] = 창 아래 단추 줄(판 아래 붙음 · 몸 안에 없음)`, save.btn && !save.inForm && save.inFoot && save.footBottom === 0 && (!phone || save.h === 44), JSON.stringify(save));
      // 목표 비율 칸 — 판 밖으로 넘치지 않음(금 칸이 잘리던 것)
      const over = await page.evaluate(() => {
        const dlg = (document.querySelector('[role="dialog"] > div') as HTMLElement).getBoundingClientRect();
        return [...document.querySelectorAll<HTMLElement>('[data-ratio]')].filter((e) => e.getBoundingClientRect().right > dlg.right + 0.5).map((e) => e.dataset.ratio);
      });
      check(`[158-8] ${size.width} 목표 비율 칸이 판 밖으로 넘치지 않음`, over.length === 0, over.join(','));
      await settingsMenu(page, '코어 · 위성');
      const note = await page.evaluate(() => {
        const n = document.querySelector('[role="dialog"] [data-row-note-text]') as HTMLElement | null;
        if (!n) return null;
        const name = n.previousElementSibling!.getBoundingClientRect();
        const r = n.getBoundingClientRect();
        const td = n.closest('td')!.getBoundingClientRect();
        return { below: r.top >= name.bottom - 0.5, inCell: r.right <= td.right + 0.5, size: parseFloat(getComputedStyle(n).fontSize) };
      });
      check(`[158-8] ${size.width} 코어 · 위성 — 빠진 종목 안내가 이름 아래 줄(13 · 옆 칸과 겹치지 않음 · R10)`, Boolean(note && note.below && note.inCell && note.size === 13), JSON.stringify(note));
      await settingsMenu(page, '현금 자동 반영');
      await page.getByTestId('asset-cash-settings').waitFor({ timeout: 5000 }).catch(() => {});
      const drops = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('[role="dialog"] [data-testid="asset-cash-settings"] select, [role="dialog"] [data-testid="asset-cash-settings"] button[aria-haspopup="listbox"]')]
          .filter((e) => e.getBoundingClientRect().width > 0)
          .map((e) => ({ h: Math.round(e.getBoundingClientRect().height), clip: e.tagName === 'BUTTON' ? (e.querySelector('[data-tip-clip]') as HTMLElement | null)?.scrollWidth! > (e.querySelector('[data-tip-clip]') as HTMLElement | null)?.clientWidth! + 1 : false, t: e.innerText.slice(0, 12) })),
      );
      check(`[158-8] ${size.width} 현금 자동 반영 고르기 칸 높이 44(${drops.length}개)`, drops.length > 0 && drops.every((d) => d.h === 44), JSON.stringify(drops.filter((d) => d.h !== 44)));
      if (phone) {
        await page.getByTestId('asset-cash-flows').scrollIntoViewIfNeeded().catch(() => {});
        const flow = await page.evaluate(() =>
          [...document.querySelectorAll<HTMLElement>('[data-testid="asset-cash-flow-row"][data-flow-reflect="yes"] button[aria-haspopup="listbox"]')].map((b) => Math.round(b.getBoundingClientRect().width)),
        );
        check('[158-8] 402 고정 흐름 계좌 고르기 칸 폭 = 글이 보이는 폭(100 이상 · 잘린 「(」 · 「3」 없음)', flow.length > 0 && flow.every((w) => w >= 100), flow.join(','));
        await shot(page, '402-asset-cash-flows', false);
      }
      await o.ctx.close();
    }
  }

  // ───────── 9 아래 판 머리 — 제목 한 줄 · 도움 글은 몸 맨 위 ─────────
  if (want('asset-dialog')) {
    let page: Page;
    const head = async (label: string, aside: boolean) => {
      const h = await page.evaluate(() => {
        const dlg = [...document.querySelectorAll('[role="dialog"]')].pop()!;
        const hd = dlg.querySelector('[data-dialog-head]') as HTMLElement;
        const h2 = hd?.querySelector('h2') as HTMLElement;
        const lh = h2 ? parseFloat(getComputedStyle(h2).lineHeight) : 0;
        const as = dlg.querySelector('[data-dialog-aside]') as HTMLElement | null;
        return {
          headH: hd ? Math.round(hd.getBoundingClientRect().height) : 0,
          titleH: h2 ? Math.round(h2.getBoundingClientRect().height) : 0,
          lh: Math.round(lh),
          fs: h2 ? parseFloat(getComputedStyle(h2).fontSize) : 0,
          asideInHead: Boolean(hd?.querySelector('.text-caption')),
          aside: as ? { top: Math.round(as.getBoundingClientRect().top - hd.getBoundingClientRect().bottom), fs: parseFloat(getComputedStyle(as).fontSize), text: as.innerText.slice(0, 30) } : null,
        };
      });
      check(`[158-9] 402 ${label} — 머리 52 · 제목 16 한 줄(높이 = 한 줄) · 도움 글 ${aside ? '몸 맨 위 13' : '없음'}`, h.headH === 52 && h.fs === 16 && h.titleH <= h.lh + 1 && !h.asideInHead && (aside ? Boolean(h.aside && h.aside.top >= 0 && h.aside.top <= 16 && h.aside.fs === 13) : h.aside == null), JSON.stringify(h));
    };
    let o = await fresh(browser, PHONE, 'asset-매수창-국내');
    page = o.page;
    await shot(page, '402-asset-buy-dialog', false);
    await head('자산 매수 창', true);
    await o.ctx.close();
    o = await fresh(browser, PHONE, 'asset-매도창-처음');
    page = o.page;
    await head('자산 매도 창', true);
    await o.ctx.close();
    o = await fresh(browser, PHONE, 'asset-설정창');
    page = o.page;
    await settingsMenu(page, '코어 · 위성');
    await guard.step('종목 추가', () => page.getByRole('dialog').getByRole('button', { name: '종목 추가', exact: true }).click({ timeout: 5000 }));
    await page.waitForTimeout(600);
    await head('종목 추가 창', true);
    await o.ctx.close();
    o = await open(browser, PHONE, '#/home');
    page = o.page;
    await guard.step('종목 찾기', () => page.getByRole('button', { name: '종목 찾기', exact: true }).first().click({ timeout: 5000 }));
    await page.waitForTimeout(600);
    await head('종목 찾기 창', false);
    await o.ctx.close();
  }

  // ───────── 11 손가락 크기 — 자산 관리(탭마다) · 설정 창(메뉴마다) ─────────
  if (want('asset-touch')) {
    for (const size of [PHONE, PAD]) {
      const all = { small: [] as string[], overlap: [] as string[] };
      for (const name of ['asset-기록여러개-미지정', 'asset-자산현황-계좌카드', 'asset-이번달구매', 'asset-설정창-메뉴-목표비율', 'asset-설정창-메뉴-코어위성', 'asset-설정창-메뉴-연금', 'asset-설정창-메뉴-이번달구매', 'asset-설정창-메뉴-자산분류색', 'asset-설정창-메뉴-시트가격', 'asset-설정창-메뉴-잠금', 'asset-설정창-현금자동반영']) {
        const o = await fresh(browser, size, name);
        const { page } = o;
        if (size.width === 402) await shot(page, `402-${name}`, !name.includes('설정창'));
        const t = await touchIssues(page);
        all.small.push(...t.small.map((x) => `${name}: ${x}`));
        all.overlap.push(...t.overlap.map((x) => `${name}: ${x}`));
        await o.ctx.close();
      }
      check(`[158-11] ${size.width} 자산 관리(총 자산 · 자산 현황 · 비율 조정) · 설정 창(메뉴마다) 누르는 칸 44 미만 0`, all.small.length === 0, all.small.join(' / '));
      check(`[158-11] ${size.width} 자산 관리 · 설정 창 누르는 칸 겹침 0`, all.overlap.length === 0, all.overlap.join(' / '));
    }
  }

  // ───────── 12 · 13 바뀐 파일 · lint ─────────
  if (want('files')) {
    const keep = chasuChanged(root, CHASU, ['server', 'deploy', 'python', 'db', 'src/services/toss', 'src/hooks/usePaperTrading.ts', 'src/hooks/useAutoTrading.ts']);
    check('[158-12] 일정 서버 · 자산 서버(server/asset — google.ts valuesWrite · structureWrite 포함) · 매매 · 자동매매 · 로그인 코드 바뀐 파일 0', keep.length === 0, keep.join(' '));
    const tsx = path.join(root, 'node_modules/tsx/dist/cli.mjs');
    const r = spawnSync(process.execPath, [tsx, 'scripts/designLint.ts'], { cwd: root, encoding: 'utf8' });
    check('[158-13] design:lint 통과', r.status === 0, r.stdout.slice(-300));
  }
} catch (e) {
  check('실패: 예외', false, String(e).slice(0, 400));
}

await guard.step('브라우저 닫기', () => browser.close());
await guard.step('Vite 닫기', () => vite.close());
console.log(`\n폰 증시 일정 · 자산 관리 시험 — 통과 ${pass} · 실패 ${fail}`);
process.exit(fail ? 1 : 0);
