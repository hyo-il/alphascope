/// <reference lib="dom" />
/**
 * 146차 폰 · 패드 앱 틀 시험(`npm run mobileframe:test` · v2.73.0) — 지시서 「꼭 지킬 동작」 1 ~ 11 줄마다.
 *
 * 화면은 이 시험이 띄운 Vite(5195)에 열고, `/api` 는 모두 가짜 응답(만든 값 · 모르는 주소는 503 — 사용자 서버로 가지 않음).
 * 1(1280 · 1440 큰 화면 그대로 · 화면 모양 desk)은 v2.83.0 부터 `desktop:test`(`scripts/lib/desktopScenes.ts` 묶음 `frame`)가 본다.
 * 11 은 관리 루트 `docs/design-check` 가 보이는 자리(본 저장소)에서만 잰다 — scratch worktree 에서는 건너뜀을 적는다.
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { chromium, type Browser, type Page } from 'playwright';
import { createBrowserStepGuard } from './lib/browserStepGuard';
import { chasuDiff, type Chasu } from './lib/chasuRange';

const root = path.resolve(import.meta.dirname, '..');
const PORT = 5195;
const WEB = `http://127.0.0.1:${PORT}`;
/** 기준 커밋(v2.72.2) — 10 은 여기서부터 바뀐 것을 본다 */
const BASE = 'd44bfcf';
const CHASU: Chasu = { base: BASE, version: 'v2.73.0' }; // 그 차수 범위만(scripts/lib/chasuRange.ts)

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

async function open(browser: Browser, size: { width: number; height: number }, hash: string) {
  const mobile = size.width < 1280;
  const ctx = await browser.newContext(mobile ? { viewport: size, isMobile: true, hasTouch: true } : { viewport: size });
  await ctx.addInitScript('window.__name = (f) => f');
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)));
  await page.route(/\/api\//, (r) => {
    const url = r.request().url();
    if (url.includes('/api/auth/me')) return r.fulfill({ json: { ok: true } });
    if (url.includes('/api/market-overview')) return r.fulfill({ json: OVERVIEW });
    if (url.includes('/api/user-data/watchlist')) {
      if (r.request().method() === 'PUT') return r.fulfill({ json: { folders: FOLDERS, recent: [], revision: 2, updatedAt: '2026-11-25T00:00:00.000Z' } });
      return r.fulfill({ json: { folders: FOLDERS, recent: [], revision: 1, updatedAt: '2026-11-25T00:00:00.000Z' } });
    }
    if (url.includes('/api/stocks/info')) {
      const symbol = new URL(url).searchParams.get('symbol') ?? '';
      return r.fulfill({ json: { stock: { symbol, name: NAMES[symbol] ?? symbol, englishName: '', market: 'NASDAQ' } } });
    }
    return r.fulfill({ status: 503, json: { error: '시험 — 없음' } });
  });
  await guard.step(`페이지 열기(${size.width}×${size.height} ${hash})`, () => page.goto(`${WEB}/${hash}`));
  await page.waitForTimeout(1500);
  return { page, ctx, errors };
}

/** 지금 화면 모양(`--layout-mode` — index.css 한 곳) */
const modeOf = (page: Page) => page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--layout-mode').trim());
const box = (page: Page, sel: string) => page.evaluate((s) => {
  const el = document.querySelector(s);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
}, sel);
const docOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
const focusedLabel = (page: Page) => page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? '');
const focusedDesc = (page: Page) => page.evaluate(() => (document.activeElement?.outerHTML ?? '').slice(0, 160));

const { createServer } = await import('vite');
const vite = await guard.step('Vite 띄우기', async () => {
  const v = await createServer({ root, configFile: path.join(root, 'vite.config.ts'), logLevel: 'error', server: { host: '127.0.0.1', port: PORT, strictPort: true, hmr: false } });
  await v.listen();
  return v;
});
const browser = await guard.step('브라우저 띄우기', () => chromium.launch({ channel: 'chrome' }));

try {
  // ───────── 2 폰 402 × 874 ─────────
  {
    const { page, ctx, errors } = await open(browser, { width: 402, height: 874 }, '#/portfolio');
    check('[146-2] 402×874 — 화면 모양 phone', (await modeOf(page)) === 'phone');
    const body = await box(page, '[data-layout-body]');
    check('[146-2] 본문 폭 ≥ 370', (body?.w ?? 0) >= 370, JSON.stringify(body));
    check('[146-2] 화면 가로 넘침 0', (await docOverflow(page)) <= 0, String(await docOverflow(page)));
    check('[146-2] 위쪽 막대 높이 52(+ 위 안전 여백 0)', (await box(page, '[data-testid="top-bar"]'))?.h === 52);
    check('[146-2] 오른쪽 250 패널 없음 · 왼쪽 메뉴 없음', (await page.getByTestId('watch-panel').count()) === 0 && (await page.locator('nav').count()) === 0);
    check('[146-2] 시황 띠 높이 40', (await box(page, '[data-testid="market-strip"]'))?.h === 40);
    check('[146-2] 시황 띠가 넘치면 오른쪽 끝 흐림 32', (await box(page, '[data-testid="market-strip"] > span[aria-hidden="true"]'))?.w === 32);

    const menuBtn = page.getByRole('button', { name: '메뉴', exact: true });
    const drawer = page.getByRole('dialog', { name: '메뉴' });
    await menuBtn.click();
    await drawer.waitFor({ timeout: 5000 });
    check('[146-2] [메뉴] → 서랍 열림 · 폭 300 · 초점 [닫기]', (await drawer.boundingBox())?.width === 300 && (await focusedLabel(page)) === '닫기');
    check('[146-2] 지금 화면 줄 aria-current="page"(계좌 관리)', (await drawer.locator('[aria-current="page"]').innerText()).includes('계좌 관리'));
    // 퀀트 펼치기 → 매수 판단
    await drawer.getByRole('button', { name: '퀀트' }).click();
    await drawer.getByRole('button', { name: '매수 판단' }).click();
    await page.waitForTimeout(600);
    check('[146-2] 소메뉴 → 그 화면(#/swing) · 서랍 닫힘', page.url().includes('#/swing') && (await drawer.count()) === 0, page.url());
    check('[146-2] 닫으면 초점이 [메뉴] 로', (await focusedLabel(page)) === '메뉴');

    for (const how of ['덮개', 'Esc', '닫기'] as const) {
      await menuBtn.click();
      await drawer.waitFor({ timeout: 5000 });
      if (how === '덮개') await page.mouse.click(390, 400);
      else if (how === 'Esc') await page.keyboard.press('Escape');
      else await drawer.getByRole('button', { name: '닫기' }).click();
      await page.waitForTimeout(600);
      check(`[146-2] ${how}로 닫힘 · 초점 [메뉴]`, (await drawer.count()) === 0 && (await focusedLabel(page)) === '메뉴', `서랍 ${await drawer.count()} · 초점 ${await focusedDesc(page)}`);
    }
    // 왼쪽으로 밀기
    await menuBtn.click();
    await drawer.waitFor({ timeout: 5000 });
    await page.evaluate(() => {
      const el = document.querySelector('[role="dialog"][aria-label="메뉴"]')!;
      const t = (x: number) => new Touch({ identifier: 1, target: el, clientX: x, clientY: 300 });
      el.dispatchEvent(new TouchEvent('touchstart', { bubbles: true, touches: [t(250)], changedTouches: [t(250)] }));
      el.dispatchEvent(new TouchEvent('touchend', { bubbles: true, touches: [], changedTouches: [t(120)] }));
    });
    await page.waitForTimeout(600);
    check('[146-2] 왼쪽으로 밀면 닫힘', (await drawer.count()) === 0);
    check('[146-2] 콘솔 오류 0', errors.length === 0, errors.join(' / '));
    await ctx.close();
  }

  // ───────── 3 폰 가로 874 × 402 ─────────
  {
    const { page, ctx } = await open(browser, { width: 874, height: 402 }, '#/portfolio');
    check('[146-3] 874×402(높이 < 500) — 화면 모양 phone · 위쪽 막대 있음', (await modeOf(page)) === 'phone' && (await page.getByTestId('top-bar').count()) === 1);
    check('[146-3] 화면 가로 넘침 0', (await docOverflow(page)) <= 0);
    await ctx.close();
  }

  // ───────── 4 패드 가로 1133 × 744 ─────────
  {
    const { page, ctx } = await open(browser, { width: 1133, height: 744 }, '#/portfolio');
    check('[146-4] 1133×744 — 화면 모양 pad', (await modeOf(page)) === 'pad');
    check('[146-4] 접힌 메뉴 52 보임 · 오른쪽 250 패널 없음 · 위쪽 막대 없음', (await box(page, 'nav'))?.w === 52 && (await page.getByTestId('watch-panel').count()) === 0 && (await page.getByTestId('top-bar').count()) === 0);
    check('[146-4] 시황 띠 40 · 화면 가로 넘침 0', (await box(page, '[data-testid="market-strip"]'))?.h === 40 && (await docOverflow(page)) <= 0);
    const before = await box(page, '[data-layout-body]');
    await page.getByRole('button', { name: '관심 목록', exact: true }).click();
    const sheet = page.getByRole('dialog', { name: '관심 목록' });
    await sheet.waitFor({ timeout: 5000 });
    await page.waitForTimeout(300);
    check('[146-4] [관심 목록] → 오른쪽 판 320', (await sheet.boundingBox())?.width === 320 && Math.round((await sheet.boundingBox())!.x + 320) === 1133);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: '메뉴 펼치기', exact: true }).click();
    const overlay = page.getByRole('dialog', { name: '메뉴' });
    await overlay.waitFor({ timeout: 5000 });
    await page.waitForTimeout(300);
    const after = await box(page, '[data-layout-body]');
    check('[146-4] [메뉴 펼치기] → 덮개 메뉴 156 · 본문 폭 · 자리 그대로', (await overlay.boundingBox())?.width === 156 && JSON.stringify(before) === JSON.stringify(after), `${JSON.stringify(before)} → ${JSON.stringify(after)}`);
    // 큰 화면 펼친 메뉴와 같은 동작 — 다른 대메뉴를 누르면 그 묶음의 화면으로 바로 간다(같은 이동 함수)
    await overlay.getByRole('button', { name: '퀀트' }).click();
    await page.waitForTimeout(600);
    check('[146-4] 덮개 메뉴에서 고르면 그 화면 · 판 닫힘', /#\/(rules|swing|backtest|records)/.test(page.url()) && (await overlay.count()) === 0, page.url());
    await ctx.close();
  }

  // ───────── 5 패드 세로 744 × 1133 = 폰 모양 ─────────
  {
    const { page, ctx } = await open(browser, { width: 744, height: 1133 }, '#/portfolio');
    const body = await box(page, '[data-layout-body]');
    check('[146-5] 744×1133 — 화면 모양 phone(테마 2절 ⚠)', (await modeOf(page)) === 'phone');
    check('[146-5] 본문 최대 폭 600 가운데', body?.w === 600 && body?.x === 72, JSON.stringify(body));
    await ctx.close();
  }

  // ───────── 6 관심 목록 판 ─────────
  {
    const { page, ctx } = await open(browser, { width: 402, height: 874 }, '#/portfolio');
    const sheet = page.getByRole('dialog', { name: '관심 목록' });
    await page.getByRole('button', { name: '관심 목록', exact: true }).click();
    await sheet.waitFor({ timeout: 5000 });
    await page.waitForTimeout(300);
    check('[146-6] 폰 판 폭 = 화면 85%(342)', Math.round((await sheet.boundingBox())?.width ?? 0) === Math.round(402 * 0.85));
    await sheet.getByRole('button', { name: /AAPL/ }).first().click();
    await page.waitForTimeout(700);
    check('[146-6] 종목을 누르면 판이 닫히고 차트로', (await sheet.count()) === 0 && page.url().includes('#/chart'), page.url());
    check('[146-6] 위쪽 막대 = 「차트」 + 종목 코드', (await page.getByTestId('top-bar').innerText()).replace(/\s+/g, ' ').includes('차트 AAPL'));
    await page.evaluate(() => (location.hash = '#/compare'));
    await page.waitForTimeout(1000);
    // 화면 밖에 살려 둔 차트(캡처용)가 폰 화면 왼쪽에 비치지 않음(−200vw 는 402 폭에서 −804px 뿐이라 960 차트 끝이 보였다 — 캡처 검토)
    const hidden = await page.evaluate(() => {
      const el = [...document.querySelectorAll<HTMLElement>('[aria-hidden="true"]')].find((x) => String(x.getAttribute('class')).includes('w-[960px]'));
      return el ? Math.round(el.getBoundingClientRect().right) : null;
    });
    check('[146-6] 화면 밖 차트가 화면 안에 걸치지 않음(오른쪽 끝 ≤ 0)', hidden != null && hidden <= 0, String(hidden));
    await page.getByRole('button', { name: '관심 목록', exact: true }).click();
    await sheet.waitFor({ timeout: 5000 });
    await sheet.getByRole('button', { name: /NVDA/ }).first().click();
    await page.waitForTimeout(700);
    check('[146-6] 비교 화면 — 담기만 하고 판은 열려 있음', (await sheet.count()) === 1 && page.url().includes('#/compare'), page.url());
    await ctx.close();
  }

  // ───────── 7 시황 띠 · 8 색 ─────────
  for (const size of [{ width: 402, height: 874 }, { width: 1440, height: 900 }]) {
    const { page, ctx } = await open(browser, size, '#/portfolio');
    const accent = await page.evaluate(() => {
      const b = document.createElement('button');
      b.className = 'bg-accent-button';
      document.body.append(b);
      const c = getComputedStyle(b).backgroundColor;
      b.remove();
      return c;
    });
    check(`[146-8] ${size.width} — 주 단추 바탕 이름 = #1b64da`, accent === 'rgb(27, 100, 218)', accent);
    if (size.width < 1280) {
      await page.getByRole('button', { name: '시황 펼치기', exact: true }).click();
      const dlg = page.getByRole('dialog', { name: '시황' });
      await dlg.waitFor({ timeout: 5000 });
      check('[146-7] 시황 띠를 누르면 펼친 시황 창(카드 6장)', (await dlg.getByText('코스피').count()) >= 1 && (await dlg.getByText('USD/KRW').count()) === 1);
      const bg = await page.evaluate(() => {
        const d = document.querySelector('[role="dialog"][aria-labelledby]') as HTMLElement | null;
        return d ? `${getComputedStyle(d).backgroundColor}|${d.className.includes('bg-overlay')}` : '';
      });
      check('[146-8] 창 덮개 = bg-overlay(검정 70%)', bg === 'rgba(0, 0, 0, 0.7)|true', bg);
    }
    await ctx.close();
  }
  {
    const btn = fs.readFileSync(path.join(root, 'src/components/ui/Button.tsx'), 'utf8');
    const old = execFileSync('git', ['show', `${BASE}:src/components/ui/Button.tsx`], { cwd: root, encoding: 'utf8' });
    const line = (src: string, v: string) => src.split('\n').find((l) => l.trim().startsWith(`${v}:`)) ?? '';
    // 155차 — 주 단추 색 이름을 tokens.PRIMARY_BUTTON_COLOR 한 곳으로(값 그대로)
    const tokSrc = fs.readFileSync(path.join(root, 'src/components/ui/tokens.ts'), 'utf8');
    check('[146-8] Button primary 바탕 = accent-button · 올림 · 누름 = accent-button-hover', /primary: PRIMARY_BUTTON_COLOR,/.test(btn) && /PRIMARY_BUTTON_COLOR = 'bg-accent-button text-white hover:bg-accent-button-hover active:bg-accent-button-hover'/.test(tokSrc));
    // 주문 색 정의 두 줄(`tokens.ts` — 147차부터 이 파일에 손가락 크기 이름이 더해져 파일 전체 대신 두 줄을 견준다)
    const tok = fs.readFileSync(path.join(root, 'src/components/ui/tokens.ts'), 'utf8');
    const oldTok = execFileSync('git', ['show', `${BASE}:src/components/ui/tokens.ts`], { cwd: root, encoding: 'utf8' });
    const color = (src: string) => src.split('\n').filter((l) => /^export const ORDER_(BUY|SELL)_COLOR /.test(l)).join('\n');
    // 155차(v2.81.0 · 사용자 결정 2) — 주문 색은 미국 증권 기준(매수 초록 · 매도 빨강)으로 바뀜: 146차 몫(단추 줄 그대로)만 보고, 색 값은 155차 정의와 견준다
    const want155 = "export const ORDER_BUY_COLOR = 'bg-bullish text-bg-primary hover:brightness-110';\nexport const ORDER_SELL_COLOR = 'bg-bearish text-bg-primary hover:brightness-110';";
    check('[146-8] 매수 · 매도 단추 줄 그대로 · 주문 색 = 155차 정의(매수 초록 · 매도 빨강)', line(btn, 'buy') === line(old, 'buy') && line(btn, 'sell') === line(old, 'sell') && color(oldTok) !== '' && color(tok) === want155, color(tok));
  }

  // ───────── 9 lint ─────────
  {
    const tsx = path.join(root, 'node_modules/tsx/dist/cli.mjs');
    const r = spawnSync(process.execPath, [tsx, 'scripts/designLint.ts'], { cwd: root, encoding: 'utf8' });
    check('[146-9] design:lint 통과', r.status === 0, r.stdout.slice(-300));
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(d, e.name)] : []));
    const black = walk(path.join(root, 'src')).filter((f) => /\bbg-black\/\d+/.test(fs.readFileSync(f, 'utf8')));
    check('[146-9] 맨 bg-black/ 덮개 0곳', black.length === 0, black.join(' '));
    const fake = path.join(root, 'scripts/.mobileframe-fake.tsx');
    fs.writeFileSync(fake, 'export const F = () => <span className="bg-black/40" />;\n');
    try {
      const f = spawnSync(process.execPath, [tsx, 'scripts/designLint.ts'], { cwd: root, encoding: 'utf8', env: { ...process.env, DESIGN_LINT_EXTRA: fake } });
      check('[146-9] 가짜 화면의 bg-black/40 → lint 「맨 검정 덮개」 실패', f.status === 1 && f.stdout.includes('[맨 검정 덮개]'));
    } finally {
      fs.rmSync(fake, { force: true });
    }
  }

  // ───────── 10 바뀐 파일 ─────────
  {
    // 146차 범위만 본다(`lib/chasuRange` — 뒤 차수 변경은 그 차수 시험이 본다)
    const changed = chasuDiff(root, CHASU, ['--name-only'], ['server', 'deploy', 'python', 'db', 'src']).stdout.split('\n').filter(Boolean);
    const trade = changed.filter((f) => /^(server\/|deploy\/|python\/|db\/|src\/services\/toss\/|src\/components\/(paper-trading|portfolio|swing|rules|backtest|records|auth)\/|src\/hooks\/(useAuth|usePaperTrading|useAutoTrading|usePaperQuickBuy)\.ts|src\/components\/chart\/QuickOrderPanel\.tsx)/.test(f));
    check('[146-10] 매매 · 주문 · 로그인 · 서버 코드 바뀐 파일 0', trade.length === 0, trade.join(' '));
    // 서버가 함께 컴파일하는 src(tsconfig.node.json include) — changelog 맨 앞 더하기 말고 바뀐 줄 0
    const shared = ['src/services/analysis/horizons.ts', 'src/services/toss', 'src/types', 'src/utils', 'src/data/changelog.ts'];
    const diff = chasuDiff(root, CHASU, ['-U0'], [...shared]).stdout;
    const files = [...diff.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((m) => m[1]);
    const removed = diff.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---'));
    check('[146-10] 서버가 함께 쓰는 src 바뀐 줄 0(changelog 더하기 제외)', files.every((f) => f === 'src/data/changelog.ts') && removed.length === 0, `${files.join(' ')} · 지운 줄 ${removed.length}`);
    // designCheck.ts — 지운 줄 0(장면 · 1280 밑 창 열기 · 가로 넘침 항목 더하기만)
    const dc = chasuDiff(root, CHASU, ['-U0'], ['scripts/designCheck.ts']).stdout;
    const dcRemoved = dc.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---'));
    check('[146-10] designCheck.ts 판정 부분 바뀐 줄 0 — 지운 줄 0(장면 · 크기 · 가로 넘침 항목 더하기만)', dcRemoved.length === 0 && dc.includes('화면 가로 넘침'), dcRemoved.join(' / '));
  }

  // ───────── 11 design-check 폴더 ─────────
  {
    const dir = path.resolve(root, '../../docs/design-check');
    if (!fs.existsSync(dir)) console.log('SKIP  [146-11] 관리 루트 docs/design-check 가 보이지 않는 자리(scratch worktree) — 본 저장소에서 잰다');
    else {
      const dirs = fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name);
      // 최근 버전 = `changelog.ts` 맨 앞(버전이 오르면 폴더도 그 버전 하나)
      const latest = /version: '(v[\d.]+)'/.exec(fs.readFileSync(path.join(root, 'src/data/changelog.ts'), 'utf8'))?.[1] ?? '';
      check(`[146-11] docs/design-check 안 폴더 = 최근 버전 하나(${latest})`, dirs.length === 1 && dirs[0] === latest, dirs.join(' '));
    }
  }
} catch (e) {
  check('실패: 예외', false, String(e).slice(0, 300));
}

await guard.step('브라우저 닫기', () => browser.close());
await guard.step('Vite 닫기', () => vite.close());
console.log(`\n폰 · 패드 앱 틀 시험 — 통과 ${pass} · 실패 ${fail}`);
process.exit(fail ? 1 : 0);
