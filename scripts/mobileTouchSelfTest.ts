/// <reference lib="dom" />
/**
 * 147차 폰 · 패드 2단계 시험(`npm run mobiletouch:test` · v2.74.0) — 지시서 「꼭 지킬 동작」 2 ~ 7 · 9 ~ 11 · 13 줄마다.
 * (1 은 `mobileframe:test` 「[146-1]」 · 8 은 `tooltip:test` · 12 는 `autotrade:test` 세 번 · 14 는 `design:lint`)
 *
 * 화면은 이 시험이 띄운 Vite(5196)에 열고, `/api` 는 모두 가짜 응답(만든 값 · 모르는 주소는 503 — 사용자 서버로 가지 않음).
 * 폰 · 패드는 `isMobile` · `hasTouch`(= 손가락 화면 `pointer: coarse`). 창은 `scripts/fixtures/mobileTouch/harness.js` 로 바로 띄운다(앱과 같은 모듈).
 * 손가락 누름 · 길게 누름은 크롬 개발 도구(CDP `Input.dispatchTouchEvent`)로 보낸다 — 진짜 손가락과 같은 pointer · click 순서.
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type CDPSession, type Page } from 'playwright';
import { createBrowserStepGuard } from './lib/browserStepGuard';
import { chasuDiff, type Chasu } from './lib/chasuRange';

const root = path.resolve(import.meta.dirname, '..');
const PORT = 5196;
const WEB = `http://127.0.0.1:${PORT}`;
/** 기준 커밋(v2.73.0) — 13 은 여기서부터 바뀐 것을 본다 */
const BASE = '2fe322c';
const CHASU: Chasu = { base: BASE, version: 'v2.74.0' }; // 그 차수 범위만(scripts/lib/chasuRange.ts)

const guard = createBrowserStepGuard();
let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = '') {
  guard.mark(name);
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? ` — ${detail}` : ''}`);
}

// ── 가짜 응답(만든 값) ──
const FOLDERS = [{ id: 'default', name: '미분류', collapsed: false, symbols: ['AAPL', 'NVDA'] }];
const NAMES: Record<string, string> = { AAPL: '애플', NVDA: '엔비디아' };
const spark = (base: number) => Array.from({ length: 24 }, (_, i) => base + (i % 5) - i * 0.2);
const OVERVIEW = {
  indices: [
    { symbol: '^KS11', label: '코스피', price: 4123.45, change: -56.78, changeRate: -1.36, sparkline: spark(4120) },
    { symbol: '^KQ11', label: '코스닥', price: 912.34, change: 8.12, changeRate: 0.9, sparkline: spark(910) },
    { symbol: '^GSPC', label: 'S&P 500', price: 6850.25, change: 123.45, changeRate: 1.84, sparkline: spark(6840) },
    { symbol: '^IXIC', label: '나스닥', price: 23500.12, change: -1234.56, changeRate: -4.99, sparkline: spark(23490) },
    { symbol: '^DJI', label: '다우존스', price: 47800.55, change: 1234.56, changeRate: 2.65, sparkline: spark(47790) },
  ],
  rate: { baseCurrency: 'USD', quoteCurrency: 'KRW', rate: 1456.78, sparkline: spark(1450) },
};

const PHONE = { width: 402, height: 874 };
const PAD = { width: 1133, height: 744 };

async function open(browser: Browser, size: { width: number; height: number }, hash: string, extraRoute?: (url: string) => unknown) {
  const mobile = size.width < 1280;
  const ctx = await browser.newContext(mobile ? { viewport: size, isMobile: true, hasTouch: true } : { viewport: size });
  await ctx.addInitScript('window.__name = (f) => f');
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)));
  await page.route(/\/api\//, (r) => {
    const url = r.request().url();
    const extra = extraRoute?.(url);
    if (extra) return r.fulfill({ json: extra });
    if (url.includes('/api/auth/me')) return r.fulfill({ json: { ok: true } });
    if (url.includes('/api/market-overview')) return r.fulfill({ json: OVERVIEW });
    if (url.includes('/api/user-data/watchlist')) return r.fulfill({ json: { folders: FOLDERS, recent: [], revision: 1, updatedAt: '2026-11-25T00:00:00.000Z' } });
    if (url.includes('/api/stocks/info')) {
      const symbol = new URL(url).searchParams.get('symbol') ?? '';
      return r.fulfill({ json: { stock: { symbol, name: NAMES[symbol] ?? symbol, englishName: '', market: 'NASDAQ' } } });
    }
    return r.fulfill({ status: 503, json: { error: '시험 — 없음' } });
  });
  await guard.step(`페이지 열기(${size.width}×${size.height} ${hash})`, () => page.goto(`${WEB}/${hash}`));
  await page.waitForTimeout(1500);
  const cdp = mobile ? await ctx.newCDPSession(page) : null;
  return { page, ctx, errors, cdp };
}

type Box = { x: number; y: number; w: number; h: number };
const docOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
const box = (page: Page, sel: string) =>
  page.evaluate((s) => {
    const el = document.querySelector(s);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
  }, sel) as Promise<Box | null>;

// ── 손가락(CDP) ──
async function touch(cdp: CDPSession, type: 'touchStart' | 'touchMove' | 'touchEnd', x: number, y: number) {
  await cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
}
async function tap(page: Page, cdp: CDPSession, x: number, y: number) {
  await touch(cdp, 'touchStart', x, y);
  await page.waitForTimeout(60);
  await touch(cdp, 'touchEnd', x, y);
  await page.waitForTimeout(250);
}
async function longPress(page: Page, cdp: CDPSession, x: number, y: number, ms: number, moveTo?: { x: number; y: number }) {
  await touch(cdp, 'touchStart', x, y);
  if (moveTo) {
    await page.waitForTimeout(100);
    await touch(cdp, 'touchMove', (x + moveTo.x) / 2, (y + moveTo.y) / 2);
    await touch(cdp, 'touchMove', moveTo.x, moveTo.y);
  }
  await page.waitForTimeout(ms);
  await touch(cdp, 'touchEnd', moveTo?.x ?? x, moveTo?.y ?? y);
  await page.waitForTimeout(300);
}
/** 요소의 가운데 */
async function centerOf(page: Page, sel: string) {
  const b = await box(page, sel);
  return b ? { x: b.x + b.w / 2, y: b.y + b.h / 2 } : null;
}
/** 합성 손가락 밀기(창 손잡이 · 머리 · 몸) — React 의 onTouch* 는 이 사건을 받는다 */
async function swipe(page: Page, sel: string, dy: number) {
  await page.evaluate(
    ({ s, d }) => {
      const el = document.querySelector(s)!;
      const r = el.getBoundingClientRect();
      const x = r.x + r.width / 2;
      const y0 = r.y + r.height / 2;
      const t = (y: number) => new Touch({ identifier: 7, target: el, clientX: x, clientY: y });
      el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [t(y0)], changedTouches: [t(y0)] }));
      el.dispatchEvent(new TouchEvent('touchmove', { bubbles: true, touches: [t(y0 + d / 2)], changedTouches: [t(y0 + d / 2)] }));
      el.dispatchEvent(new TouchEvent('touchmove', { bubbles: true, touches: [t(y0 + d)], changedTouches: [t(y0 + d)] }));
      el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, touches: [], changedTouches: [t(y0 + d)] }));
    },
    { s: sel, d: dy },
  );
  await page.waitForTimeout(350);
}

// ── 시험 창(harness) ──
const HARNESS = '/scripts/fixtures/mobileTouch/harness.js';
type HarnessOpts = { dirty?: boolean; busy?: boolean; closeOnBackdrop?: boolean; long?: boolean; size?: string };
async function mount(page: Page, o: HarnessOpts) {
  await page.evaluate(
    async ({ url, opts }) => {
      const m = await import(/* @vite-ignore */ url);
      m.mountDialog(opts);
    },
    { url: HARNESS, opts: o },
  );
  await page.waitForTimeout(400);
}
async function unmount(page: Page) {
  await page.evaluate(async (url) => {
    const m = await import(/* @vite-ignore */ url);
    m.unmount();
  }, HARNESS);
  await page.waitForTimeout(150);
}
async function mountParts(page: Page) {
  // 가짜 응답 503 의 오류 토스트가 오른쪽 위에 떠 부품을 가린다 — 이 시험에서는 감춘다
  await page.addStyleTag({ content: '[data-toast-host] { display: none !important; }' });
  await page.evaluate(async (url) => {
    const m = await import(/* @vite-ignore */ url);
    m.mountParts();
  }, HARNESS);
  await page.waitForTimeout(300);
}
/** 누르는 칸 — 가운데에서 위아래 · 양옆 21px(= 44 칸 안쪽 끝) 여덟 점을 누르면 그 요소(또는 그 안)가 맞나 · 누르는 칸 좌우 끝 */
const hitArea = (page: Page, sel: string) =>
  page.evaluate((s) => {
    const el = document.querySelector(s)!;
    const r = el.getBoundingClientRect();
    const cx = r.x + r.width / 2;
    const cy = r.y + r.height / 2;
    // ±20 — 44 칸 끝에서 2px 안쪽(밑줄 테두리가 있는 탭은 바깥 칸 가운데가 1px 위라 ±21 은 끝에 걸린다) · 바깥 칸 크기는 따로 44 이상인지 본다
    const pts = [[-20, -20], [20, -20], [-20, 20], [20, 20], [0, -20], [0, 20], [-20, 0], [20, 0]];
    const miss = pts.filter(([dx, dy]) => {
      const e = document.elementFromPoint(cx + dx, cy + dy);
      return !(e && (e === el || el.contains(e)));
    });
    const after = getComputedStyle(el, '::after');
    const w = Math.max(r.width, parseFloat(after.width) || 0);
    const h = Math.max(r.height, parseFloat(after.height) || 0);
    return { ok: miss.length === 0 && w >= 44 && h >= 44, miss: miss.length, w: Math.round(w), h: Math.round(h), left: Math.round(cx - w / 2), right: Math.round(cx + w / 2) };
  }, sel);
const harness = (page: Page) => page.evaluate(() => (window as unknown as { __harness: { open: boolean; closed: number; saved: number } }).__harness);
const PANEL = '[role="dialog"][aria-labelledby] > div';
const askShown = async (page: Page) => (await page.getByRole('dialog', { name: '저장하지 않고 닫을까요?' }).count()) === 1;
/** 묻는 창을 [취소] 로 닫는다(시험 창은 남음) */
async function dismissAsk(page: Page) {
  await page.getByRole('dialog', { name: '저장하지 않고 닫을까요?' }).getByRole('button', { name: '취소' }).click();
  await page.waitForTimeout(300);
}

const { createServer } = await import('vite');
const vite = await guard.step('Vite 띄우기', async () => {
  const v = await createServer({ root, configFile: path.join(root, 'vite.config.ts'), logLevel: 'error', server: { host: '127.0.0.1', port: PORT, strictPort: true, hmr: false } });
  await v.listen();
  return v;
});
const browser = await guard.step('브라우저 띄우기', () => chromium.launch({ channel: 'chrome' }));

/** 큰 화면 모양 — 고른 요소와 그 안의 보이는 요소마다 태그 · 클래스(손가락 이름은 뺌) · 자리 · 크기 */
const deskShape = (page: Page, sel: string) =>
  page.evaluate((s) => {
    const out: string[] = [];
    for (const top of document.querySelectorAll(s)) {
      for (const el of [top, ...top.querySelectorAll('*')]) {
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;
        const cls = (el.getAttribute('class') ?? '').replace(/(^|\s)(touch:\S+|touch-hit|touch-hit-gap)(?=\s|$)/g, '$1').replace(/\s+/g, ' ').trim();
        out.push(`${el.tagName}|${cls}|${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)}`);
      }
    }
    return out;
  }, sel);
/** 1 의 창 · 툴팁 · 떠 있는 시계(1280 × 1080 · 1440 × 900) — CAPTURE 면 기준 커밋 worktree 에서 정답 파일을 만든다 */
async function deskExtras(): Promise<Record<string, string[]>> {
  const shots: Record<string, string[]> = {};
  for (const size of [{ width: 1280, height: 1080 }, { width: 1440, height: 900 }]) {
    const { page, ctx } = await open(browser, size, '#/portfolio');
    await page.addStyleTag({ content: '*::-webkit-scrollbar { width: 0 !important; height: 0 !important; } * { scrollbar-width: none !important; }' });
    shots[`${size.width} 떠 있는 시계`] = await deskShape(page, '[data-kst-clock]');
    await mount(page, { dirty: false });
    shots[`${size.width} 창(md)`] = await deskShape(page, '[role="dialog"][aria-labelledby]');
    await unmount(page);
    await mountParts(page);
    await page.mouse.move(0, 0);
    await page.hover('[data-testid="btn-sm"]');
    await page.waitForTimeout(600);
    shots[`${size.width} 툴팁`] = await deskShape(page, '[role="tooltip"]');
    await ctx.close();
  }
  return shots;
}
const DESK_FIXTURE = path.join(root, 'scripts/fixtures/mobileTouch/desk.json');

try {
  if (process.env.CAPTURE) {
    fs.writeFileSync(process.env.CAPTURE, JSON.stringify(await deskExtras(), null, 0));
    console.log(`정답 파일 저장 — ${process.env.CAPTURE}`);
    process.exit(0);
  }
  // ───────── 1 큰 화면 + 마우스 — 창 · 툴팁 · 떠 있는 시계가 기준 커밋과 같음 ─────────
  {
    const want = JSON.parse(fs.readFileSync(DESK_FIXTURE, 'utf8')) as Record<string, string[]>;
    const got = await deskExtras();
    for (const key of Object.keys(want)) {
      const a = want[key];
      const b = got[key] ?? [];
      const i = a.findIndex((x, k) => x !== b[k]);
      const same = a.length > 0 && a.length === b.length && i < 0;
      check(`[147-1] ${key} — 기준 커밋(${BASE})과 요소 ${a.length}개 태그 · 클래스 · 자리 · 크기 같음`, same, same ? '' : `개수 ${a.length} → ${b.length} · 첫 차이 #${i}: ${a[i] ?? '-'} → ${b[i] ?? '-'}`);
    }
  }

  // ───────── 2 · 3 폰 창 ─────────
  {
    const { page, ctx, errors, cdp } = await open(browser, PHONE, '#/portfolio');
    check('[147-0] 402 손가락 화면 — pointer: coarse', await page.evaluate(() => matchMedia('(pointer: coarse)').matches));
    await mount(page, {});
    const p = await box(page, PANEL);
    check('[147-2] 폰 창 — 화면 아래에 붙음 · 폭 = 화면 폭', p != null && p.x === 0 && p.w === 402 && p.y + p.h === 874, JSON.stringify(p));
    const maxH = await page.evaluate((s) => getComputedStyle(document.querySelector(s)!).maxHeight, PANEL);
    check('[147-2] 최대 높이 = 보이는 높이 − 64(810px)', maxH === '810px', maxH);
    check('[147-2] 짧은 내용이면 판도 짧음(< 810)', (p?.h ?? 999) < 810, String(p?.h));
    const handle = await box(page, '[data-dialog-handle] > span');
    check('[147-2] 손잡이 36 × 4 · 위 여백 8 · 가운데', handle != null && handle.w === 36 && handle.h === 4 && handle.y - (p?.y ?? 0) === 8 && Math.abs(handle.x + 18 - 201) <= 1, JSON.stringify(handle));
    check('[147-2] 머리 높이 52', (await box(page, '[data-dialog-head]'))?.h === 52);
    const btnH = await page.evaluate(() => [...document.querySelectorAll('[data-dialog-foot] button')].map((b) => Math.round(b.getBoundingClientRect().height)));
    check('[147-2] 아래 단추 높이 44', btnH.length === 2 && btnH.every((h) => h === 44), btnH.join(','));
    const order = await page.evaluate(() => [...document.querySelectorAll('[data-dialog-foot] button')].map((b) => b.textContent));
    check('[147-2] 단추 차례 [취소] → [저장](오른쪽)', order.join('|') === '취소|저장', order.join('|'));
    await unmount(page);
    await mount(page, { long: true, size: 'full' });
    const pl = await box(page, PANEL);
    check('[147-2] 긴 내용(크기 full) — 높이 = 810 · 몸만 밀어 봄', pl?.h === 810 && pl.y === 64, JSON.stringify(pl));
    const bodyScroll = await page.evaluate(() => {
      const b = document.querySelector('[data-testid="harness-body"]')!.parentElement!;
      return b.scrollHeight > b.clientHeight && getComputedStyle(b).overflowY === 'auto';
    });
    check('[147-2] 넘치면 몸만 스크롤', bodyScroll);
    // 몸을 밀어 보는 중에는 아래로 밀어도 닫히지 않음
    await page.evaluate(() => (document.querySelector('[data-testid="harness-body"]')!.parentElement!.scrollTop = 400));
    await swipe(page, '[data-testid="harness-body"]', 200);
    check('[147-3] 몸에서 아래로 밀기 → 닫히지 않음', (await harness(page)).open);
    await unmount(page);

    // 닫기 길 다섯 — 보통 · dirty · busy
    const paths: { name: string; run: () => Promise<void> }[] = [
      { name: '[닫기]', run: () => page.getByRole('dialog', { name: '시험 창' }).getByRole('button', { name: '닫기' }).click() },
      { name: '[취소]', run: () => page.getByRole('dialog', { name: '시험 창' }).getByRole('button', { name: '취소' }).click() },
      { name: '덮개', run: () => tap(page, cdp!, 200, 30) },
      { name: 'Esc', run: () => page.keyboard.press('Escape') },
      { name: '손잡이 아래로 밀기', run: () => swipe(page, '[data-dialog-handle]', 150) },
      { name: '머리 아래로 밀기', run: () => swipe(page, '[data-dialog-head]', 150) },
    ];
    for (const how of paths) {
      await mount(page, {});
      const before = (await harness(page)).closed;
      await how.run();
      await page.waitForTimeout(300);
      check(`[147-3] ${how.name} → 닫힘`, (await harness(page)).closed === before + 1 && !(await harness(page)).open);
      await unmount(page);
    }
    for (const how of paths) {
      await mount(page, { dirty: true });
      await how.run();
      await page.waitForTimeout(300);
      const asked = await askShown(page);
      const stillOpen = (await harness(page)).open;
      if (how.name === '덮개') check('[147-3] dirty · 덮개 → 닫지도 묻지도 않음', !asked && stillOpen);
      else check(`[147-3] dirty · ${how.name} → 묻고 판은 제자리`, asked && stillOpen && (await page.evaluate((s) => getComputedStyle(document.querySelector(s)!).transform, PANEL)) === 'none');
      if (asked) await dismissAsk(page);
      await unmount(page);
    }
    for (const how of paths) {
      await mount(page, { busy: true });
      await page.waitForTimeout(400);
      if (how.name === '[닫기]' || how.name === '[취소]') {
        // 막는 로딩이 덮어 단추를 누를 수 없다 — 누르기 대신 그 단추에 click 을 보낸다(닫히지 않아야)
        await page.evaluate((n) => {
          const b = [...document.querySelectorAll<HTMLButtonElement>('[data-dialog-sheet] button')].find((x) => (x.getAttribute('aria-label') ?? x.textContent) === n);
          b?.click();
        }, how.name.slice(1, -1));
      } else await how.run();
      await page.waitForTimeout(300);
      check(`[147-3] busy · ${how.name} → 닫히지 않음`, (await harness(page)).open && !(await askShown(page)));
      await unmount(page);
    }
    await mount(page, { closeOnBackdrop: false });
    await tap(page, cdp!, 200, 30);
    check('[147-3] closeOnBackdrop={false} · 덮개 → 닫히지 않음', (await harness(page)).open);
    await unmount(page);
    // 시황 띠 → 시황 창도 아래 판
    await page.getByRole('button', { name: '시황 펼치기', exact: true }).click();
    await page.waitForTimeout(500);
    const mb = await box(page, PANEL);
    check('[147-2] 시황 띠 → 시황 창도 아래 판', mb != null && mb.w === 402 && mb.y + mb.h === 874, JSON.stringify(mb));
    await page.keyboard.press('Escape');
    check('[147-2] 콘솔 오류 0', errors.length === 0, errors.join(' / '));
    await ctx.close();
  }

  // ───────── 4 패드 창 ─────────
  {
    const { page, ctx } = await open(browser, PAD, '#/portfolio');
    for (const size of ['md', 'lg', 'xl', 'full']) {
      await mount(page, { size, long: true });
      const p = await box(page, PANEL);
      const ok = p != null && p.w <= 1133 - 48 && p.h <= 744 - 48 && Math.abs(p.x + p.w / 2 - 1133 / 2) <= 1 && Math.abs(p.y + p.h / 2 - 744 / 2) <= 1;
      check(`[147-4] 1133×744 창(${size}) — 가운데 · 폭 ≤ 화면 − 48 · 높이 ≤ 100dvh − 48`, ok, JSON.stringify(p));
      await unmount(page);
    }
    await mount(page, {});
    await page.mouse.click(30, 30);
    await page.waitForTimeout(300);
    check('[147-4] 패드 덮개 누름(click) → 닫힘', !(await harness(page)).open);
    await unmount(page);
    await ctx.close();
  }

  // ───────── 5 손가락 크기 ─────────
  for (const size of [PHONE, PAD]) {
    const { page, ctx } = await open(browser, size, '#/portfolio');
    await mountParts(page);
    const tag = `${size.width}`;
    for (const [id, name] of [
      ['btn-sm', '단추 sm'],
      ['btn-md', '단추 md'],
      ['icon-a', '아이콘 단추 md'],
      ['icon-sm', '아이콘 단추 sm'],
      ['parts"] [role="radio', '묶음 단추 칸'],
      ['parts"] [role="tab', '탭'],
      ['check', '체크'],
      ['parts"] [data-infotip]:not([x="', '[ⓘ]'],
    ] as const) {
      const r = await hitArea(page, `[data-testid="${id}"]`);
      check(`[147-5] ${tag} ${name} — 누르는 칸 ≥ 44 × 44(바깥 칸 크기 · 가운데 ± 20 을 누르면 그 요소)`, r.ok, JSON.stringify(r));
    }
    const vis = await page.evaluate(() => {
      const q = (id: string) => document.querySelector(`[data-testid="${id}"]`)!;
      const hh = (id: string) => Math.round(q(id).getBoundingClientRect().height);
      const ww = (id: string) => Math.round(q(id).getBoundingClientRect().width);
      const fs = (el: Element) => getComputedStyle(el).fontSize;
      return {
        btnSm: hh('btn-sm'),
        btnMd: hh('btn-md'),
        icon: `${ww('icon-a')}x${hh('icon-a')}`,
        iconSm: `${ww('icon-sm')}x${hh('icon-sm')}`,
        seg: Math.round(document.querySelector('[data-testid="parts"] [role="radiogroup"]')!.getBoundingClientRect().height),
        input: `${hh('input')}/${fs(q('input'))}`,
        number: `${Math.round(q('number').parentElement!.getBoundingClientRect().height)}/${fs(q('number'))}`,
        select: `${hh('select')}/${fs(q('select'))}`,
        listRow: hh('list-row'),
        tableRow: hh('table-row'),
        gap: Math.round(q('icon-b').getBoundingClientRect().left - q('icon-a').getBoundingClientRect().right),
      };
    });
    check(`[147-5] ${tag} 보이는 단추 크기 그대로(sm 28 · md 32 · 아이콘 28 · 24 · 묶음 32)`, vis.btnSm === 28 && vis.btnMd === 32 && vis.icon === '28x28' && vis.iconSm === '24x24' && vis.seg === 32, JSON.stringify(vis));
    check(`[147-5] ${tag} 입력 칸 · 숫자 칸 · 드롭다운 높이 44 · 글 16`, vis.input === '44/16px' && vis.number === '44/16px' && vis.select === '44/16px', JSON.stringify(vis));
    check(`[147-5] ${tag} 목록 줄 · 표 줄 높이 44`, vis.listRow === 44 && vis.tableRow === 44, JSON.stringify(vis));
    const a = await hitArea(page, '[data-testid="icon-a"]');
    const b = await hitArea(page, '[data-testid="icon-b"]');
    check(`[147-5] ${tag} 붙은 아이콘 단추 사이 ≥ 12 · 누르는 칸 겹침 없음`, vis.gap >= 12 && a.right <= b.left, `사이 ${vis.gap} · ${a.right} / ${b.left}`);
    await unmount(page);
    await ctx.close();
  }
  {
    // 1280 마우스 — 같은 부품 한 벌이 손가락 이름을 받아도 아무것도 바뀌지 않음(바깥 칸 없음 · 사이 0 · 높이 그대로)
    const { page, ctx } = await open(browser, { width: 1280, height: 1080 }, '#/portfolio');
    await mountParts(page);
    const desk = await page.evaluate(() => {
      const q = (id: string) => document.querySelector(`[data-testid="${id}"]`)!;
      return {
        after: getComputedStyle(q('btn-sm'), '::after').content,
        gap: Math.round(q('icon-b').getBoundingClientRect().left - q('icon-a').getBoundingClientRect().right),
        input: `${Math.round(q('input').getBoundingClientRect().height)}/${getComputedStyle(q('input')).fontSize}`,
        tableRow: Math.round(q('table-row').getBoundingClientRect().height),
        listRow: Math.round(q('list-row').getBoundingClientRect().height),
        pos: getComputedStyle(q('btn-sm')).position,
      };
    });
    check('[147-1] 1280 마우스 — 바깥 칸 없음 · 아이콘 사이 0 · 입력 32/14 · 표 줄 40 · 목록 줄 36 · position static', desk.after === 'none' && desk.gap === 0 && desk.input === '32/14px' && desk.tableRow === 40 && desk.listRow === 36 && desk.pos === 'static', JSON.stringify(desk));
    await unmount(page);
    await ctx.close();
  }

  // ───────── 6 · 7 툴팁 — 누르기 · 길게 누르기 ─────────
  for (const size of [PHONE, PAD]) {
    const { page, ctx, cdp } = await open(browser, size, '#/portfolio');
    await mountParts(page);
    const tag = `${size.width}`;
    const tip = () => page.evaluate(() => {
      const t = document.querySelector('[role="tooltip"]') as HTMLElement | null;
      if (!t || t.style.visibility === 'hidden') return null;
      const r = t.getBoundingClientRect();
      return { text: t.textContent, left: Math.round(r.left), right: Math.round(r.right) };
    });
    const saved = async () => (await harness(page)).saved;
    const info = (await centerOf(page, '[data-testid="parts"] [data-infotip]'))!;
    await tap(page, cdp!, info.x, info.y);
    const t1 = await tip();
    check(`[147-6] ${tag} [ⓘ] 을 누르면 열림`, t1?.text === '정보 설명 글', JSON.stringify(t1));
    check(`[147-6] ${tag} 툴팁이 화면 안(좌우 끝 8 안쪽)`, t1 != null && t1.left >= 8 && t1.right <= size.width - 8, JSON.stringify(t1));
    await tap(page, cdp!, 200, size.height - 60);
    check(`[147-6] ${tag} 다른 곳을 누르면 닫힘`, (await tip()) == null);
    await tap(page, cdp!, info.x, info.y);
    await tap(page, cdp!, info.x, info.y);
    check(`[147-6] ${tag} 같은 [ⓘ] 을 다시 누르면 닫힘`, (await tip()) == null);
    const plain = (await centerOf(page, '[data-testid="plain-tip"]'))!;
    await tap(page, cdp!, plain.x, plain.y);
    check(`[147-6] ${tag} 누름 동작 없는 글(data-tip)도 누르면 열림`, (await tip())?.text === '맨 글 설명');
    await tap(page, cdp!, 200, size.height - 60);

    const btn = (await centerOf(page, '[data-testid="btn-sm"]'))!;
    const s0 = await saved();
    await longPress(page, cdp!, btn.x, btn.y, 700);
    const t2 = await tip();
    check(`[147-7] ${tag} 툴팁 단추를 0.7초 길게 누르면 열림 · 손을 떼도 단추 동작 없음`, t2?.text === '단추 설명' && (await saved()) === s0, `${JSON.stringify(t2)} · 누름 ${(await saved()) - s0}`);
    await tap(page, cdp!, 200, size.height - 60);
    const s1 = await saved();
    await tap(page, cdp!, btn.x, btn.y);
    check(`[147-7] ${tag} 짧게 누르면 단추 동작만 · 툴팁 없음`, (await saved()) === s1 + 1 && (await tip()) == null, `누름 ${(await saved()) - s1}`);
    const s2 = await saved();
    await longPress(page, cdp!, btn.x, btn.y, 700, { x: btn.x + 30, y: btn.y });
    check(`[147-7] ${tag} 누른 채 밀면 열리지 않음`, (await tip()) == null && (await saved()) === s2);
    const icon = (await centerOf(page, '[data-testid="icon-a"]'))!;
    const s3 = await saved();
    await longPress(page, cdp!, icon.x, icon.y, 700);
    check(`[147-7] ${tag} 아이콘 단추 길게 누르기 → 이름(고치기) · 동작 없음`, (await tip())?.text === '고치기' && (await saved()) === s3);
    await tap(page, cdp!, 200, size.height - 60);
    // 길게 누른 다음 누름은 그대로(click 막기는 하나만)
    const s4 = await saved();
    await tap(page, cdp!, btn.x, btn.y);
    check(`[147-7] ${tag} 길게 누른 뒤 다음 짧은 누름은 동작함(막는 click 은 하나만)`, (await saved()) === s4 + 1);
    await unmount(page);
    await ctx.close();
  }

  // ───────── 9 폰 제목 숨김 ─────────
  {
    const PAGES: { hash: string; title: string }[] = [
      { hash: '#/portfolio', title: '계좌 관리' },
      { hash: '#/rules', title: '매매 규칙' },
      { hash: '#/swing', title: '매수 판단' },
      { hash: '#/heatmap', title: '종목 지도' },
      { hash: '#/ranking', title: '실시간 순위' },
      { hash: '#/calendar', title: '증시 일정' },
      { hash: '#/compare', title: '기업 비교' },
      { hash: '#/settings-account', title: '계좌 설정' },
      { hash: '#/settings-changelog', title: '업데이트 내역' },
    ];
    const titleState = (page: Page, title: string) =>
      page.evaluate((t) => {
        const h = [...document.querySelectorAll('h2')].find((x) => x.textContent?.trim() === t);
        if (!h) return 'none';
        const r = h.getBoundingClientRect();
        return r.width <= 1 && r.height <= 1 && getComputedStyle(h).position === 'absolute' ? 'sr-only' : 'visible';
      }, title);
    for (const size of [PHONE, PAD, { width: 1280, height: 1080 }]) {
      const { page, ctx } = await open(browser, size, '#/portfolio');
      const states: string[] = [];
      for (const p of PAGES) {
        await page.evaluate((h) => (location.hash = h), p.hash);
        await page.waitForTimeout(700);
        states.push(`${p.title}:${await titleState(page, p.title)}`);
      }
      const want = size === PHONE ? 'sr-only' : 'visible';
      check(`[147-9] ${size.width} 화면 제목 ${PAGES.length}곳(PageHeader · 직접 그린 제목) = ${size === PHONE ? '숨김(화면 읽기용으로는 있음)' : '보임'}`, states.every((x) => x.endsWith(`:${want}`)), states.join(' · '));
      if (size === PHONE) {
        await page.evaluate(() => (location.hash = '#/rules'));
        await page.waitForTimeout(700);
        const right = await page.getByRole('button', { name: '새 규칙 만들기' }).boundingBox();
        check('[147-9] 402 제목 옆 단추(매매 규칙 [새 규칙 만들기])는 본문 맨 위 한 줄에 보임', right != null && right.y < 160, JSON.stringify(right));
        await page.evaluate(() => (location.hash = '#/portfolio'));
        await page.waitForTimeout(700);
        const tabs = await page.getByRole('tablist', { name: '계좌 유형' }).boundingBox();
        check('[147-9] 402 탭 줄(계좌 유형)은 그대로 보임', tabs != null && tabs.height > 20, JSON.stringify(tabs));
      }
      await ctx.close();
    }
  }

  // ───────── 10 시계 = 시황 띠 맨 왼쪽 ─────────
  for (const size of [PHONE, PAD]) {
    const clockCalls: string[] = [];
    const { page, ctx, cdp } = await open(browser, size, '#/portfolio', (url) => {
      if (url.includes('/api/settings/clock')) clockCalls.push(url);
      return undefined;
    });
    page.on('request', (r) => r.url().includes('/api/settings/clock') && r.method() !== 'GET' && clockCalls.push(`${r.method()} ${r.url()}`));
    const tag = `${size.width}`;
    const strip = (await box(page, '[data-testid="market-strip"]'))!;
    const c0 = await box(page, '[data-strip-clock]');
    const text = await page.locator('[data-strip-clock]').innerText();
    check(`[147-10] ${tag} 시계가 시황 띠 맨 왼쪽 · 띠 높이 40 안 · 「한국 HH:MM:SS」`, c0 != null && c0.x === strip.x && c0.y >= strip.y && c0.y + c0.h <= strip.y + strip.h && /^한국\s*\d{2}:\d{2}:\d{2}$/.test(text.trim()), `${JSON.stringify(c0)} · ${JSON.stringify(strip)} · ${text}`);
    const font = await page.evaluate(() => {
      const t = document.querySelector('[data-strip-clock] time')!;
      return `${getComputedStyle(t).fontSize}|${getComputedStyle(t).fontVariantNumeric}`;
    });
    check(`[147-10] ${tag} 시계 글 13 · 숫자 폭 맞춤(tabular-nums)`, font === '13px|tabular-nums', font);
    check(`[147-10] ${tag} 떠 있는 시계 상자 · 끌기 · 핀 없음`, (await page.locator('[data-kst-clock]').count()) === 0 && (await page.locator('[data-strip-clock] button').count()) === 0);
    await page.evaluate(() => {
      const b = document.querySelector<HTMLElement>('[data-testid="market-strip"] button[aria-label="시황 펼치기"]')!;
      b.scrollLeft = b.scrollWidth;
    });
    await page.waitForTimeout(200);
    const c1 = await box(page, '[data-strip-clock]');
    const scrolled = await page.evaluate(() => document.querySelector<HTMLElement>('[data-testid="market-strip"] button[aria-label="시황 펼치기"]')!.scrollLeft);
    check(`[147-10] ${tag} 띠를 끝까지 밀어도 시계 자리 그대로`, JSON.stringify(c0) === JSON.stringify(c1) && (size === PAD || scrolled > 0), `${JSON.stringify(c0)} → ${JSON.stringify(c1)} · 민 거리 ${scrolled}`);
    const bar = await box(page, '[data-testid="top-bar"]');
    const body = await box(page, '[data-layout-body]');
    const apart = (a: Box | null, b: Box | null) => !a || !b || a.y + a.h <= b.y || b.y + b.h <= a.y || a.x + a.w <= b.x || b.x + b.w <= a.x;
    check(`[147-10] ${tag} 시계가 위쪽 막대 · 본문과 겹치지 않음`, apart(c1, bar) && apart(c1, body), `${JSON.stringify(c1)} · 막대 ${JSON.stringify(bar)} · 본문 ${JSON.stringify(body)}`);
    await tap(page, cdp!, c1!.x + c1!.w / 2, c1!.y + c1!.h / 2);
    await page.waitForTimeout(300);
    check(`[147-10] ${tag} 시계를 눌러도 시황 창이 열리지 않음`, (await page.getByRole('dialog', { name: '시황' }).count()) === 0);
    await tap(page, cdp!, strip.x + strip.w - 40, strip.y + strip.h / 2);
    await page.waitForTimeout(500);
    check(`[147-10] ${tag} 지수 쪽을 누르면 시황 창이 열림`, (await page.getByRole('dialog', { name: '시황' }).count()) === 1);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    // 토스트(가짜 503 오류)가 위쪽 막대 · 시황 띠를 가리지 않음
    await page.evaluate(async (url) => {
      const m = await import(/* @vite-ignore */ url);
      m.toast.error('시험 토스트', '가림 확인');
    }, '/src/store/uiStore.ts');
    await page.waitForTimeout(300);
    const toastTop = await page.evaluate(() => Math.round(document.querySelector('[data-toast-host] > *')!.getBoundingClientRect().top));
    check(`[147-10] ${tag} 토스트가 위쪽 막대 · 시황 띠 아래에 뜸`, toastTop >= strip.y + strip.h, `토스트 위 ${toastTop} · 띠 아래 ${strip.y + strip.h}`);
    check(`[147-10] ${tag} 저장한 시계 자리(ui.clock)를 읽지도 쓰지도 않음(요청 0)`, clockCalls.length === 0, clockCalls.join(' '));
    await ctx.close();
  }

  // ───────── 11 종목 지도 폰 ─────────
  {
    const SECTORS = ['기술', '금융', '헬스케어', '에너지', '소비재', '산업재', '통신', '유틸리티', '소재', '부동산', '필수소비재', '기타'];
    const cells = SECTORS.flatMap((sec, i) => Array.from({ length: 4 }, (_, k) => ({ symbol: `T${i}${k}`, name: `${sec} ${k + 1}`, sector: sec, marketCap: (50 - i * 3 - k) * 1e10, price: 100 + k, changeRate: ((i + k) % 5) - 2, currency: 'USD', watch: false })));
    const HEATMAP = {
      market: 'us', period: '1d', view: 'market', top: 50, cells,
      sectors: SECTORS.map((sec, i) => ({ sector: sec, capReturn: 2 - i * 0.3, equalReturn: 1, up: 2, counted: 4, excluded: 0, vsMarket: 0.1, top: [] })),
      marketReturn: 0.5, counted: cells.length, excluded: 0, asOf: '2026-11-25T06:00:00.000Z', marketOpen: false, session: null, sessionLabel: null,
      basis: 'prev', basisLabel: '전일 종가 대비', nextOpen: '2026-11-25T14:30:00.000Z', missingSectors: 0, missingCap: [],
    };
    const fake = (url: string) => (url.includes('/api/heatmap') ? HEATMAP : undefined);
    for (const size of [PHONE, PAD, { width: 1280, height: 1080 }]) {
      const { page, ctx, cdp } = await open(browser, size, '#/heatmap', fake);
      await page.waitForTimeout(800);
      const tag = `${size.width}`;
      const map = await box(page, '[data-tiles]');
      const aside = await box(page, '[data-tiles] ~ aside, aside:has(p)');
      if (size === PHONE) {
        const body = await page.evaluate(() => {
          const b = document.querySelector('[data-layout-body]')!;
          const cs = getComputedStyle(b);
          const r = b.getBoundingClientRect();
          return { x: Math.round(r.x + parseFloat(cs.paddingLeft)), w: Math.round(r.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)) };
        });
        const wantH = Math.max(320, Math.round((874 - 52 - 40) * 0.6));
        check('[147-11] 402 지도 폭 = 본문 폭', map != null && map.x === body.x && map.w === body.w, `${JSON.stringify(map)} · 본문 ${JSON.stringify(body)}`);
        check(`[147-11] 402 지도 높이 = (보이는 높이 − 52 − 40) × 0.6 = ${wantH} (≥ 320)`, map != null && Math.abs(map.h - wantH) <= 1, JSON.stringify(map));
        check('[147-11] 402 업종 칸이 지도 아래 · 폭 = 본문 폭(w-72 고정 아님)', aside != null && map != null && aside.y >= map.y + map.h && aside.w === body.w, `${JSON.stringify(aside)}`);
        check('[147-11] 402 화면 가로 넘침 0', (await docOverflow(page)) <= 0, String(await docOverflow(page)));
        const innerScroll = await page.evaluate(() => {
          const a = [...document.querySelectorAll('aside')].find((x) => x.textContent?.includes('섹터 강세 순위'))!;
          return [...a.querySelectorAll('*')].some((el) => el.scrollHeight > el.clientHeight + 1 && ['auto', 'scroll'].includes(getComputedStyle(el).overflowY));
        });
        check('[147-11] 402 업종 칸만의 따로 스크롤 없음', !innerScroll);
        // 아래로 밀어 지도가 화면 위로 지나간 뒤 업종을 누르면 강조 + 지도가 보이게 올라옴
        await page.evaluate(() => {
          const r = document.querySelector<HTMLElement>('[data-heatmap-root]')!;
          r.scrollTop = r.scrollHeight;
        });
        await page.waitForTimeout(300);
        const row = page.locator('aside').getByRole('button', { name: /에너지/ }).first();
        const rb = (await row.boundingBox())!;
        await tap(page, cdp!, rb.x + rb.width / 2, rb.y + rb.height / 2);
        await page.waitForTimeout(900);
        const focused = await page.evaluate(() => document.querySelectorAll('[data-tiles] .ring-accent').length);
        const m2 = await box(page, '[data-tiles]');
        const root = await box(page, '[data-heatmap-root]');
        check('[147-11] 402 업종을 누르면 지도에서 강조 · 지도가 보이게 올라옴', focused >= 1 && m2 != null && root != null && m2.y >= root.y - 1 && m2.y < root.y + root.h, `강조 ${focused} · 지도 ${JSON.stringify(m2)} · 칸 ${JSON.stringify(root)}`);
      } else {
        check(`[147-11] ${tag} 업종 칸은 지금처럼 지도 오른쪽(폭 288)`, aside != null && map != null && aside.x >= map.x + map.w && aside.w === 288 && Math.abs(aside.y - map.y) <= 1, `${JSON.stringify(map)} · ${JSON.stringify(aside)}`);
      }
      await ctx.close();
    }
  }

  // ───────── 13 바뀐 파일 ─────────
  {
    // 147차 범위만 본다(`lib/chasuRange` — 뒤 차수 변경은 그 차수 시험이 본다)
    const changed = chasuDiff(root, CHASU, ['--name-only'], ['server', 'deploy', 'python', 'db', 'src']).stdout.split('\n').filter(Boolean);
    const trade = changed.filter((f) => /^(server\/|deploy\/|python\/|db\/|src\/services\/toss\/|src\/components\/(paper-trading|portfolio|swing|rules|backtest|records|auth)\/|src\/hooks\/(useAuth|usePaperTrading|useAutoTrading|usePaperQuickBuy)\.ts|src\/components\/chart\/QuickOrderPanel\.tsx)/.test(f));
    check('[147-13] 매매 · 주문 · 로그인 · 서버 코드 바뀐 파일 0', trade.length === 0, trade.join(' '));
    const shared = ['src/services/analysis/horizons.ts', 'src/services/toss', 'src/types', 'src/utils', 'src/data/changelog.ts'];
    const diff = chasuDiff(root, CHASU, ['-U0'], [...shared]).stdout;
    const files = [...diff.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((m) => m[1]);
    const removed = diff.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---'));
    check('[147-13] 서버가 함께 쓰는 src 바뀐 줄 0(changelog 더하기 제외)', files.every((f) => f === 'src/data/changelog.ts') && removed.length === 0, `${files.join(' ')} · 지운 줄 ${removed.length}`);
    const dc = chasuDiff(root, CHASU, ['-U0'], ['scripts/designCheck.ts']).stdout;
    const dcRemoved = dc.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---'));
    check('[147-13] designCheck.ts 판정 부분 바뀐 줄 0 — 지운 줄 0(측정 항목 더하기만)', dcRemoved.length === 0, dcRemoved.join(' / '));
  }
} catch (e) {
  check('실패: 예외', false, String(e).slice(0, 300));
}

await guard.step('브라우저 닫기', () => browser.close());
await guard.step('Vite 닫기', () => vite.close());
console.log(`\n폰 · 패드 2단계 시험 — 통과 ${pass} · 실패 ${fail}`);
process.exit(fail ? 1 : 0);
