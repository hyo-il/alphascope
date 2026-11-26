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
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium, type Browser, type CDPSession, type Page } from 'playwright';
import { createBrowserStepGuard } from './lib/browserStepGuard';

const root = path.resolve(import.meta.dirname, '..');
const PORT = 5196;
const WEB = `http://127.0.0.1:${PORT}`;
/** 기준 커밋(v2.73.0) — 13 은 여기서부터 바뀐 것을 본다 */
const BASE = '2fe322c';

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
const harness = (page: Page) => page.evaluate(() => (window as unknown as { __harness: { open: boolean; closed: number } }).__harness);
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

try {
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

  // ───────── 13 바뀐 파일 ─────────
  {
    const changed = execFileSync('git', ['diff', '--name-only', BASE], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean);
    const trade = changed.filter((f) => /^(server\/|deploy\/|python\/|db\/|src\/services\/toss\/|src\/components\/(paper-trading|portfolio|swing|rules|backtest|records|auth)\/|src\/hooks\/(useAuth|usePaperTrading|useAutoTrading|usePaperQuickBuy)\.ts|src\/components\/chart\/QuickOrderPanel\.tsx)/.test(f));
    check('[147-13] 매매 · 주문 · 로그인 · 서버 코드 바뀐 파일 0', trade.length === 0, trade.join(' '));
    const shared = ['src/services/analysis/horizons.ts', 'src/services/toss', 'src/types', 'src/utils', 'src/data/changelog.ts'];
    const diff = execFileSync('git', ['diff', '-U0', BASE, '--', ...shared], { cwd: root, encoding: 'utf8' });
    const files = [...diff.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((m) => m[1]);
    const removed = diff.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---'));
    check('[147-13] 서버가 함께 쓰는 src 바뀐 줄 0(changelog 더하기 제외)', files.every((f) => f === 'src/data/changelog.ts') && removed.length === 0, `${files.join(' ')} · 지운 줄 ${removed.length}`);
    const dc = execFileSync('git', ['diff', '-U0', BASE, '--', 'scripts/designCheck.ts'], { cwd: root, encoding: 'utf8' });
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
