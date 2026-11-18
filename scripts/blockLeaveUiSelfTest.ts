/**
 * 막는 로딩 · 저장하지 않고 나갈 때 묻기 시험(145차 · v2.72.2) — `npm run blockleaveui:test` · ⚠️ `DB_PATH=<사본>` 으로만 돈다(맨 첫 import).
 * 145차 「꼭 지킬 동작」 1~6 을 줄마다 확인한다(시험 이름 앞의 [145-n]).
 *   1 막는 로딩(1280 × 1080 · 1440 × 900) — 창 안 저장(자산 매수 창) · 자산 [다시 읽기] · 삭제 확인 뒤(모두 매도 확인 창)
 *   2 design:lint 「직접 덮개」 — 가짜 화면 파일(임시 폴더 · 커밋 안 함)이면 실패 · 지금 코드는 0
 *   3 나갈 때 묻기 — 자산 분류 정하기 · 자산 설정(목표 비율 · 현금 자동 반영) · 매수 창 · 규칙 편집 · 편집 화면(급등 탐지 설정 탭) — 다른 메뉴 · 뒤로 가기
 *   4 문구(소스 검사) · 5 바뀐 파일(주문 · 자동매매 · 서버 · 로그인 · 서버가 함께 쓰는 src · designCheck 판정) · 6 목록 문서 줄 수
 * Vite + Playwright, `/api` 는 모두 `page.route` 가짜(만든 값) — 구글 · 토스 · 서버 호출 0(모르는 `/api` 는 503). 요소는 역할 + 이름 · `data-testid` · data 속성으로 찾는다.
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import 'dotenv/config';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { chromium, type Browser, type Page } from 'playwright';
import { assetHistorySample, assetSheetSample, assetStatusSample, assetSummarySample, cashViewSample } from './fixtures/asset/screenSample';
import { createBrowserStepGuard } from './lib/browserStepGuard';

const root = path.resolve(import.meta.dirname, '..');
const PORT = 5193;
const WEB = `http://127.0.0.1:${PORT}`;
/** 이 일의 기준 커밋(v2.72.1) — 5 · 6 은 여기서부터 바뀐 것을 본다 */
const BASE = '9fe0139';

const guard = createBrowserStepGuard();
let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = '') {
  guard.mark(name);
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? ` — ${detail}` : ''}`);
}
/** 손으로 돌릴 때 묶음만 — `PART=3` 등(기계 검사는 늘 전부) */
const PART = process.env.PART ?? '';
const part = (n: string) => PART === '' || PART.split(',').includes(n);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Gate {
  wait: Promise<void>;
  open: () => void;
}
function gate(): Gate {
  let open = () => {};
  const wait = new Promise<void>((r) => (open = r));
  return { wait, open };
}

/** 가짜 응답을 늦추는 손잡이 — null 이면 바로 답한다 */
interface Ctl {
  summary: Gate | null;
  trade: Gate | null;
  tradeReply: { status: number; json: unknown };
  cashSettings: Gate | null;
  rules: Gate | null;
  surge: Gate | null;
  count: { summary: number; trade: number };
}

async function open(browser: Browser, size: { width: number; height: number }, hash: string, wait: (p: Page) => Promise<unknown>) {
  const ctx = await browser.newContext({ viewport: size });
  await ctx.addInitScript(() => {
    localStorage.setItem('alphascope.asset.tab', 'status');
    localStorage.setItem('alphascope.asset.statusView', 'account');
    localStorage.setItem('alphascope.asset.settingsMenu', 'target');
  });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)));
  const ctl: Ctl = { summary: null, trade: null, tradeReply: { status: 200, json: { id: 1 } }, cashSettings: null, rules: null, surge: null, count: { summary: 0, trade: 0 } };
  // 모르는 /api 는 모두 503(사용자 서버로 가지 않게 — 먼저 단 길이 가장 늦게 본다)
  await page.route('**/api/**', (r) => (r.request().url().includes('/api/auth/me') ? r.fulfill({ json: { ok: true } }) : r.fulfill({ status: 503, json: { error: '시험 — 없음' } })));
  await page.route('**/api/asset/status', (r) => r.fulfill({ json: assetStatusSample(true) }));
  await page.route('**/api/asset/touch', (r) => r.fulfill({ json: { ok: true, lockMinutes: 30, remainingMs: 30 * 60_000 } }));
  await page.route('**/api/asset/sheet', (r) => r.fulfill({ json: assetSheetSample() }));
  await page.route('**/api/asset/summary**', async (r) => {
    ctl.count.summary++;
    const g = ctl.summary;
    if (g) await g.wait;
    await r.fulfill({ json: assetSummarySample({ purchaseDone: true, writeEnabled: true }) }).catch(() => {});
  });
  await page.route('**/api/asset/history**', (r) => r.fulfill({ json: assetHistorySample(5) }));
  await page.route('**/api/asset/trade', async (r) => {
    ctl.count.trade++;
    const g = ctl.trade;
    if (g) await g.wait;
    await r.fulfill(ctl.tradeReply).catch(() => {});
  });
  await page.route('**/api/asset/cash', (r) => r.fulfill({ json: cashViewSample({ enabled: false }) }));
  await page.route('**/api/asset/cash/settings', async (r) => {
    const g = ctl.cashSettings;
    if (g) await g.wait;
    await r.fulfill({ json: cashViewSample({ enabled: true }) }).catch(() => {});
  });
  await page.route('**/api/rules', async (r) => {
    if (r.request().method() === 'GET') return r.fulfill({ json: { rules: [] } });
    const g = ctl.rules;
    if (g) await g.wait;
    await r.fulfill({ status: 400, json: { error: '시험 — 저장 안 함' } }).catch(() => {});
  });
  const surgeSettings = { priceThreshold: 10, thresholdMode: 'auto', volumeThreshold: 200, minSurgeCount: 3, analysisPeriod: '6mo', regularityThreshold: 50, usePreset: true, useWatchlist: true, useRanking: true };
  await page.route('**/api/surge/settings', async (r) => {
    if (r.request().method() === 'GET') return r.fulfill({ json: { settings: surgeSettings, rankingUpdatedAt: null } });
    const g = ctl.surge;
    if (g) await g.wait;
    await r.fulfill({ json: { settings: { ...surgeSettings, ...(JSON.parse(r.request().postData() ?? '{}') as object) } } }).catch(() => {});
  });
  await guard.step(`페이지 열기(${hash})`, () => page.goto(`${WEB}/${hash}`));
  await guard.step('화면 기다리기', () => wait(page));
  return { page, ctx, errors, ctl };
}

/** 막는 로딩 단계 — 없으면 off */
const phase = async (page: Page) => (await page.locator('[data-testid="blocking-loader"]').first().getAttribute('data-phase').catch(() => null)) ?? 'off';
const phaseCount = (page: Page) => page.locator('[data-testid="blocking-loader"]').count();
/** 초점이 막힌 곳(inert 아래)에 있나 */
const focusInInert = (page: Page) => page.evaluate(() => document.activeElement?.closest('[inert]') != null);
const dialogCount = (page: Page, name: string) => page.getByRole('dialog', { name }).count();
const ASK = '저장하지 않고 닫을까요?';
/** 앞에 다른 화면 기록을 하나 쌓는다(뒤로 가기 시험 — 처음 연 화면에서는 뒤로 갈 곳이 없다) */
async function withBackEntry(page: Page, wait: (p: Page) => Promise<unknown>) {
  const here = await page.evaluate(() => location.hash);
  await page.evaluate(() => {
    location.hash = '#/calendar';
  });
  await page.waitForFunction(() => location.hash.startsWith('#/calendar'));
  await page.evaluate((h) => {
    location.hash = h;
  }, here);
  await wait(page);
}
/** 묻는 확인 창 — 제목 · 내용 · 단추 순서(글 단추 — 제목 줄 × 는 글이 없어 빠짐) · 기본 초점 */
async function askShape(page: Page) {
  const d = page.getByRole('dialog', { name: ASK });
  await d.waitFor({ timeout: 5000 });
  const text = (await d.textContent()) ?? '';
  const buttons = (await d.getByRole('button').allTextContents()).map((t) => t.trim()).filter((t) => t !== '');
  const focused = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? '');
  return { text, buttons, focused };
}
const askOk = (s: { text: string; buttons: string[]; focused: string }) =>
  s.text.includes('바꾼 내용이 사라져요') && s.buttons.join('|') === '취소|저장하지 않고 닫기' && s.focused === '취소';

const { createServer } = await import('vite');
const vite = await guard.step('Vite 띄우기', async () => {
  const v = await createServer({ root, configFile: path.join(root, 'vite.config.ts'), logLevel: 'error', server: { host: '127.0.0.1', port: PORT, strictPort: true, hmr: false } });
  await v.listen();
  return v;
});
const browser = await guard.step('브라우저 띄우기', () => chromium.launch({ channel: 'chrome' }));
const waitAsset = (p: Page) => p.locator('[data-account-cards]').waitFor({ timeout: 30_000 });
try {
  // ───────── 1 막는 로딩 ─────────
  for (const size of part('1') ? [{ width: 1280, height: 1080 }, { width: 1440, height: 900 }] : []) {
    const w = size.width;
    const { page, ctx, errors, ctl } = await open(browser, size, '#/asset', waitAsset);

    // ① 자산 [다시 읽기] — 내용 칸만 막음 · 0.3초 뒤 표시 · 10초 뒤 안내 + [취소]
    {
      ctl.summary = gate();
      const before = ctl.count.summary;
      const t0 = Date.now();
      await page.getByRole('button', { name: '다시 읽기' }).click();
      const p0 = await phase(page);
      const shownEarly = await page.getByText('다시 읽는 중…').count();
      check(`[145-1] ${w} 다시 읽기 — 누른 순간 막음(투명 · 표시 없음)`, p0 === 'blocking' && shownEarly === 0, `${p0} · ${shownEarly}`);
      // 덮인 곳의 단추를 눌러도(마우스) 창이 뜨지 않는다 · 다시 읽기 단추는 돌고 있어 두 번째 요청 없음
      await page.locator('[data-trade-buy="6"]').click({ force: true, timeout: 2000 }).catch(() => {});
      await page.getByRole('button', { name: '다시 읽기' }).click({ timeout: 1000 }).catch(() => {});
      check(`[145-1] ${w} 다시 읽기 — 두 번째 누름 무시(요청 1번 · 덮인 [매수] 창 안 뜸)`, ctl.count.summary === before + 1 && (await page.locator('[data-trade-dialog]').count()) === 0, `${ctl.count.summary - before}`);
      // 키보드 — Tab 을 여러 번 눌러도 덮인 곳에 초점이 가지 않고 Enter 로 창이 뜨지 않는다
      let inert = false;
      for (let i = 0; i < 8; i++) {
        await page.keyboard.press('Tab');
        if (await focusInInert(page)) inert = true;
      }
      await page.keyboard.press('Enter');
      check(`[145-1] ${w} 다시 읽기 — Tab · Enter 가 덮인 곳에 닿지 않음`, !inert && (await page.locator('[data-trade-dialog]').count()) === 0);
      await sleep(Math.max(0, 450 - (Date.now() - t0)));
      check(`[145-1] ${w} 다시 읽기 — 0.3초 뒤 로딩 표시(도는 원 · 글)`, (await phase(page)) === 'shown' && (await page.getByText('다시 읽는 중…').count()) === 1);
      await page.keyboard.press('Escape');
      check(`[145-1] ${w} 다시 읽기 — Esc 로 풀리지 않음`, (await phase(page)) !== 'off');
      await sleep(Math.max(0, 10_300 - (Date.now() - t0)));
      const slow = page.getByTestId('blocking-slow');
      check(`[145-1] ${w} 다시 읽기 — 10초 뒤 「오래 걸리고 있어요」 + [취소](멈출 수 있는 일)`, (await slow.getByText('오래 걸리고 있어요').count()) === 1 && (await slow.getByRole('button', { name: '취소' }).count()) === 1);
      await slow.getByRole('button', { name: '취소' }).click();
      check(`[145-1] ${w} 다시 읽기 — [취소] 면 풀림 · 그린 값 그대로`, (await phaseCount(page)) === 0 && (await page.locator('[data-trade-buy="6"]').count()) === 1);
      ctl.summary.open();
      ctl.summary = null;
      // 빨리 끝나면 깜빡이지 않는다(0.3초 안 — 표시 없이 풀림)
      await page.getByRole('button', { name: '다시 읽기' }).click();
      let flashed = false;
      const t1 = Date.now();
      while (Date.now() - t1 < 600) {
        if ((await phase(page)) === 'shown') flashed = true;
        await sleep(30);
      }
      check(`[145-1] ${w} 다시 읽기 — 바로 끝나면 로딩 표시 없음(깜빡임 0)`, !flashed && (await phaseCount(page)) === 0);
    }

    // ② 창 안 저장(자산 매수 창) — 창 전체를 막음 · 닫히지 않음 · 실패면 풀고 이유 한 줄
    {
      await page.locator('[data-trade-buy="6"]').click();
      await page.locator('[data-trade-qty]').fill('10');
      await page.locator('[data-trade-price]').fill('70000');
      ctl.trade = gate();
      ctl.tradeReply = { status: 409, json: { error: '시험 — 시트가 바뀌었어요' } };
      const before = ctl.count.trade;
      const t0 = Date.now();
      await page.locator('[data-trade-save]').click();
      await page.locator('[data-trade-save]').click({ force: true, timeout: 1000 }).catch(() => {});
      check(`[145-1] ${w} 창 저장 — 누른 순간 막음 · 두 번째 누름 무시(요청 1번)`, (await phase(page)) === 'blocking' && ctl.count.trade === before + 1, `${await phase(page)} · ${ctl.count.trade - before}`);
      let inert = false;
      for (let i = 0; i < 6; i++) {
        await page.keyboard.press('Tab');
        if (await focusInInert(page)) inert = true;
      }
      check(`[145-1] ${w} 창 저장 — Tab 이 덮인 칸 · 단추에 닿지 않음`, !inert);
      await page.keyboard.press('Escape');
      await page.getByRole('button', { name: '닫기' }).first().click({ force: true, timeout: 1000 }).catch(() => {});
      await page.mouse.click(5, 5);
      check(`[145-1] ${w} 창 저장 — Esc · × · 바깥 누름으로 닫히지 않음(묻지도 않음)`, (await page.locator('[data-trade-dialog]').count()) === 1 && (await dialogCount(page, ASK)) === 0);
      await sleep(Math.max(0, 450 - (Date.now() - t0)));
      check(`[145-1] ${w} 창 저장 — 0.3초 뒤 「저장 중…」 표시`, (await phase(page)) === 'shown' && (await page.getByTestId('blocking-loader').getByText('저장 중…').count()) === 1);
      if (w === 1440) {
        await sleep(Math.max(0, 10_300 - (Date.now() - t0)));
        const slow = page.getByTestId('blocking-slow');
        check(`[145-1] ${w} 창 저장 — 10초 뒤 「오래 걸리고 있어요」 · 멈출 수 없는 일이라 [취소] 없음`, (await slow.getByText('오래 걸리고 있어요').count()) === 1 && (await slow.getByRole('button').count()) === 0);
      }
      ctl.trade.open();
      ctl.trade = null;
      await page.locator('[data-trade-error]').waitFor({ timeout: 5000 });
      check(`[145-1] ${w} 창 저장 — 실패면 풀고 이유 한 줄 · 창 그대로`, (await phaseCount(page)) === 0 && ((await page.locator('[data-trade-error]').textContent()) ?? '').includes('시트가 바뀌었어요') && (await page.locator('[data-trade-dialog]').count()) === 1);
      // 성공이면 풀리고 창이 닫힌다
      ctl.tradeReply = { status: 200, json: { id: 1 } };
      await page.locator('[data-trade-save]').click();
      await page.locator('[data-trade-dialog]').waitFor({ state: 'detached', timeout: 5000 });
      check(`[145-1] ${w} 창 저장 — 성공이면 풀리고 창 닫힘`, (await page.locator('[data-trade-dialog]').count()) === 0);
      await page.locator('[data-trade-buy="6"]').waitFor({ timeout: 10_000 });
      await sleep(400);
    }

    // ③ 삭제 확인 뒤(모두 매도 확인 창 [지우기]) — 확인 창을 막음 · Esc 로 닫히지 않음
    {
      await page.locator('[data-trade-sell="6"]').click();
      await page.locator('[data-trade-qty]').fill('30');
      await page.locator('[data-trade-price]').fill('72000');
      await page.locator('[data-trade-save]').click();
      const confirm = page.getByRole('dialog', { name: '모두 매도' });
      await confirm.waitFor({ timeout: 5000 });
      ctl.trade = gate();
      const t0 = Date.now();
      await confirm.getByRole('button', { name: '지우기' }).click();
      const p0 = await phase(page);
      await page.keyboard.press('Escape');
      check(`[145-1] ${w} 삭제 확인 뒤 — 누른 순간 막음 · Esc 로 확인 창이 닫히지 않음`, p0 === 'blocking' && (await confirm.count()) === 1, p0);
      let inert = false;
      for (let i = 0; i < 4; i++) {
        await page.keyboard.press('Tab');
        if (await focusInInert(page)) inert = true;
      }
      check(`[145-1] ${w} 삭제 확인 뒤 — Tab 이 덮인 단추에 닿지 않음`, !inert);
      await sleep(Math.max(0, 450 - (Date.now() - t0)));
      check(`[145-1] ${w} 삭제 확인 뒤 — 0.3초 뒤 「처리 중…」 표시`, (await confirm.getByTestId('blocking-loader').getAttribute('data-phase')) === 'shown');
      ctl.trade.open();
      ctl.trade = null;
      await confirm.waitFor({ state: 'detached', timeout: 5000 });
      check(`[145-1] ${w} 삭제 확인 뒤 — 끝나면 풀림(확인 창 닫힘)`, (await confirm.count()) === 0);
    }
    check(`[145-1] ${w} 페이지 오류 0`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ───────── 2 design:lint 직접 덮개 ─────────
  if (part('2')) {
    const tsx = path.join(root, 'node_modules/tsx/dist/cli.mjs');
    const lint = (env: Record<string, string>) => spawnSync(process.execPath, [tsx, 'scripts/designLint.ts'], { cwd: root, env: { ...process.env, ...env }, encoding: 'utf8' });
    const clean = lint({});
    check('[145-2] 지금 코드 — 직접 덮개 0 · lint 통과', clean.status === 0 && !clean.stdout.includes('[직접 덮개]'), clean.stdout.slice(-300));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alphascope-lint-145-'));
    try {
      const fake = path.join(dir, 'FakeOverlay.tsx');
      fs.writeFileSync(
        fake,
        [
          'export function Fake({ busy }: { busy: boolean }) {',
          '  return (',
          '    <div>',
          '      <div className="fixed inset-0 z-50 bg-black/70" />',
          '      <div className="absolute inset-0 bg-bg-primary/60" />',
          "      <div className={busy ? 'pointer-events-none opacity-60' : ''} />",
          '      <div className="absolute inset-0 bg-bg-primary" />',
          '    </div>',
          '  );',
          '}',
          '',
        ].join('\n'),
      );
      const r = lint({ DESIGN_LINT_EXTRA: fake });
      const hits = r.stdout.split('\n').filter((l) => l.includes('FakeOverlay.tsx') && l.includes('[직접 덮개]'));
      check('[145-2] 가짜 화면 — fixed 덮개 · 반투명 absolute 덮개 · busy 로 pointer-events 막기 = 3곳 실패(불투명 판은 통과)', r.status === 1 && hits.length === 3, `${r.status} · ${hits.length}`);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  // ───────── 3 나갈 때 묻기 ─────────
  if (part('3')) {
    const size = { width: 1440, height: 900 };
    // ① 자산 분류 정하기
    {
      const { page, ctx, errors } = await open(browser, size, '#/asset', waitAsset);
      const NAME = '자산 분류 정하기';
      const openClass = async () => {
        await page.getByRole('button', { name: NAME }).first().click();
        await page.locator('[data-class-dialog]').waitFor({ timeout: 5000 });
        await page.locator('[data-class-dialog] [role="radio"]').first().waitFor({ timeout: 5000 });
      };
      const radios = () => page.locator('[data-class-dialog] [role="radiogroup"]').first().getByRole('radio');
      const pickOther = async () => {
        const r = radios();
        const n = await r.count();
        for (let i = 0; i < n; i++) if ((await r.nth(i).getAttribute('aria-checked')) !== 'true') return void (await r.nth(i).click());
      };
      await openClass();
      await page.keyboard.press('Escape');
      check('[145-3] 분류 — 바꾸지 않았으면 Esc 로 바로 닫힘(묻지 않음)', (await dialogCount(page, NAME)) === 0 && (await dialogCount(page, ASK)) === 0);
      await openClass();
      const first = await radios().evaluateAll((els) => els.findIndex((e) => e.getAttribute('aria-checked') === 'true'));
      await pickOther();
      await page.keyboard.press('Escape');
      const s1 = await askShape(page);
      check('[145-3] 분류 — 바꾼 뒤 Esc → 확인 창(제목 · 「바꾼 내용이 사라져요」 · [취소] → [저장하지 않고 닫기] · 기본 초점 [취소])', askOk(s1), JSON.stringify(s1));
      await page.getByRole('dialog', { name: ASK }).getByRole('button', { name: '취소' }).click();
      check('[145-3] 분류 — 확인 창 [취소] = 창 그대로', (await dialogCount(page, NAME)) === 1 && (await dialogCount(page, ASK)) === 0);
      await page.getByRole('dialog', { name: NAME }).getByRole('button', { name: '닫기' }).click();
      await page.getByRole('dialog', { name: ASK }).waitFor({ timeout: 5000 });
      await page.keyboard.press('Escape');
      check('[145-3] 분류 — × → 확인 창 · 확인 창의 Esc = 취소(창 그대로)', (await dialogCount(page, NAME)) === 1 && (await dialogCount(page, ASK)) === 0);
      await page.mouse.click(5, 5);
      check('[145-3] 분류 — 바꾼 뒤 바깥 누름 = 닫히지 않고 묻지도 않음', (await dialogCount(page, NAME)) === 1 && (await dialogCount(page, ASK)) === 0);
      await page.locator('[data-class-cancel]').click();
      await page.getByRole('dialog', { name: ASK }).getByRole('button', { name: '저장하지 않고 닫기' }).click();
      check('[145-3] 분류 — 아래 [취소] → 확인 창 → [저장하지 않고 닫기] = 닫힘', (await dialogCount(page, NAME)) === 0 && (await dialogCount(page, ASK)) === 0);
      await openClass();
      await pickOther();
      await radios().nth(first).click();
      await page.keyboard.press('Escape');
      check('[145-3] 분류 — 바꿨다가 되돌리면 묻지 않음', (await dialogCount(page, NAME)) === 0 && (await dialogCount(page, ASK)) === 0);
      // 뒤로 가기
      await withBackEntry(page, waitAsset);
      await openClass();
      await pickOther();
      const hash0 = await page.evaluate(() => location.hash);
      await page.evaluate(() => history.back());
      await page.getByRole('dialog', { name: ASK }).waitFor({ timeout: 5000 });
      check('[145-3] 분류 — 바꾼 뒤 뒤로 가기 → 확인 창 · 주소 그대로', (await page.evaluate(() => location.hash)) === hash0 && (await dialogCount(page, NAME)) === 1);
      await page.getByRole('dialog', { name: ASK }).getByRole('button', { name: '취소' }).click();
      check('[145-3] 분류 — 뒤로 가기 확인 창 [취소] = 화면 · 창 그대로', (await dialogCount(page, NAME)) === 1 && (await page.evaluate(() => location.hash)) === hash0);
      check('[145-3] 분류 — 페이지 오류 0', errors.length === 0, errors.join(' | '));
      await ctx.close();
    }

    // ② 자산 설정 — 목표 비율(저장 단추 따로 · 묻기) · 현금 자동 반영(바로 저장 — 저장 중 닫히지 않음 · 물을 것 없음)
    {
      const { page, ctx, errors, ctl } = await open(browser, size, '#/asset', waitAsset);
      const NAME = '자산 관리 설정';
      await page.locator('[data-asset-settings]').click();
      const dlg = page.getByRole('dialog', { name: NAME });
      await dlg.waitFor({ timeout: 5000 });
      const field = dlg.locator('[data-setting="target-ratio"] input').first();
      const v0 = await field.inputValue();
      await field.fill(v0 === '10' ? '11' : '10');
      await page.keyboard.press('Escape');
      const s = await askShape(page);
      check('[145-3] 설정(목표 비율) — 바꾼 뒤 Esc → 확인 창(문구 · 단추 · 기본 초점)', askOk(s), JSON.stringify(s));
      await page.getByRole('dialog', { name: ASK }).getByRole('button', { name: '취소' }).click();
      await field.fill(v0);
      await dlg.getByRole('tab', { name: '현금 자동 반영' }).click();
      await dlg.getByTestId('asset-cash-salary').waitFor({ timeout: 10_000 });
      ctl.cashSettings = gate();
      const day = dlg.getByRole('combobox', { name: '월급 날짜' });
      await day.selectOption((await day.inputValue()) === '10' ? '11' : '10');
      await page.keyboard.press('Escape');
      await dlg.getByRole('button', { name: '닫기' }).first().click({ force: true, timeout: 1000 }).catch(() => {});
      check('[145-3] 설정(현금 자동 반영) — 저장 중에는 Esc · × 로 닫히지 않음 · 묻지도 않음', (await dialogCount(page, NAME)) === 1 && (await dialogCount(page, ASK)) === 0 && (await phase(page)) !== 'off');
      ctl.cashSettings.open();
      ctl.cashSettings = null;
      await page.waitForFunction(() => document.querySelector('[data-testid="blocking-loader"]') == null, null, { timeout: 5000 });
      await page.keyboard.press('Escape');
      check('[145-3] 설정(현금 자동 반영) — 바로 저장이라 끝난 뒤 Esc 는 묻지 않고 닫힘(되돌린 목표 비율도 묻지 않음)', (await dialogCount(page, NAME)) === 0 && (await dialogCount(page, ASK)) === 0);
      check('[145-3] 설정 — 페이지 오류 0', errors.length === 0, errors.join(' | '));
      await ctx.close();
    }

    // ③ 매수 창
    {
      const { page, ctx, errors } = await open(browser, size, '#/asset', waitAsset);
      const NAME = '매수 입력';
      await page.locator('[data-trade-buy="6"]').click();
      await page.keyboard.press('Escape');
      check('[145-3] 매수 — 바꾸지 않았으면 Esc 로 바로 닫힘', (await dialogCount(page, NAME)) === 0 && (await dialogCount(page, ASK)) === 0);
      await page.locator('[data-trade-buy="6"]').click();
      await page.locator('[data-trade-qty]').fill('3');
      await page.getByRole('dialog', { name: NAME }).getByRole('button', { name: '닫기' }).click();
      const s = await askShape(page);
      check('[145-3] 매수 — 바꾼 뒤 × → 확인 창(문구 · 단추 · 기본 초점)', askOk(s), JSON.stringify(s));
      await page.getByRole('dialog', { name: ASK }).getByRole('button', { name: '취소' }).click();
      await page.locator('[data-trade-cancel]').click();
      await page.getByRole('dialog', { name: ASK }).waitFor({ timeout: 5000 });
      await page.getByRole('dialog', { name: ASK }).getByRole('button', { name: '저장하지 않고 닫기' }).click();
      check('[145-3] 매수 — 아래 [취소] → 확인 창 → [저장하지 않고 닫기] = 닫힘', (await dialogCount(page, NAME)) === 0);
      await page.locator('[data-trade-buy="6"]').click();
      await page.locator('[data-trade-qty]').fill('3');
      await page.locator('[data-trade-qty]').fill('');
      await page.locator('[data-trade-cancel]').click();
      check('[145-3] 매수 — 넣었다가 지우면(되돌림) 묻지 않음', (await dialogCount(page, NAME)) === 0 && (await dialogCount(page, ASK)) === 0);
      // 다른 메뉴
      await page.locator('[data-trade-buy="6"]').click();
      await page.locator('[data-trade-price]').fill('1000');
      await page.evaluate(() => {
        location.hash = '#/calendar';
      });
      await page.getByRole('dialog', { name: ASK }).waitFor({ timeout: 5000 });
      check('[145-3] 매수 — 바꾼 뒤 다른 메뉴(주소) → 확인 창 · 화면 그대로', (await page.evaluate(() => location.hash)).startsWith('#/asset') && (await dialogCount(page, NAME)) === 1);
      await page.getByRole('dialog', { name: ASK }).getByRole('button', { name: '저장하지 않고 닫기' }).click();
      await page.waitForFunction(() => location.hash.startsWith('#/calendar'), null, { timeout: 5000 });
      check('[145-3] 매수 — [저장하지 않고 닫기] = 창 닫고 그 메뉴로', (await dialogCount(page, NAME)) === 0);
      check('[145-3] 매수 — 페이지 오류 0', errors.length === 0, errors.join(' | '));
      await ctx.close();
    }

    // ④ 규칙 편집(새 규칙) — 묻기 · 저장 중 닫히지 않음
    {
      const { page, ctx, errors, ctl } = await open(browser, size, '#/rules', (p) => p.getByRole('button', { name: '새 규칙 만들기' }).first().waitFor({ timeout: 30_000 }));
      const NAME = '새 규칙 만들기';
      await page.getByRole('button', { name: NAME }).first().click();
      const dlg = page.getByRole('dialog', { name: NAME });
      await dlg.waitFor({ timeout: 5000 });
      await page.keyboard.press('Escape');
      check('[145-3] 규칙 — 바꾸지 않았으면 Esc 로 바로 닫힘', (await dialogCount(page, NAME)) === 0 && (await dialogCount(page, ASK)) === 0);
      await page.getByRole('button', { name: NAME }).first().click();
      await dlg.getByRole('textbox').first().fill('시험 규칙');
      await page.keyboard.press('Escape');
      const s = await askShape(page);
      check('[145-3] 규칙 — 바꾼 뒤 Esc → 확인 창(문구 · 단추 · 기본 초점)', askOk(s), JSON.stringify(s));
      await page.getByRole('dialog', { name: ASK }).getByRole('button', { name: '취소' }).click();
      await dlg.getByRole('button', { name: '취소' }).click();
      await page.getByRole('dialog', { name: ASK }).waitFor({ timeout: 5000 });
      await page.getByRole('dialog', { name: ASK }).getByRole('button', { name: '취소' }).click();
      check('[145-3] 규칙 — 아래 [취소] → 확인 창 → [취소] = 창 그대로', (await dialogCount(page, NAME)) === 1);
      await page.mouse.click(5, 5);
      check('[145-3] 규칙 — 바꾼 뒤 바깥 누름 = 닫히지 않음', (await dialogCount(page, NAME)) === 1 && (await dialogCount(page, ASK)) === 0);
      // 저장 중
      ctl.rules = gate();
      await dlg.getByRole('button', { name: '저장' }).click();
      await page.keyboard.press('Escape');
      check('[145-3] 규칙 — 저장 중에는 Esc 로 닫히지 않음 · 묻지도 않음', (await dialogCount(page, NAME)) === 1 && (await dialogCount(page, ASK)) === 0);
      ctl.rules.open();
      ctl.rules = null;
      await page.waitForFunction(() => document.querySelector('[data-testid="blocking-loader"]') == null, null, { timeout: 5000 });
      // 뒤로 가기(앞에 기록을 쌓은 뒤 다시 열어 바꿈)
      await page.getByRole('dialog', { name: NAME }).getByRole('button', { name: '닫기' }).click();
      await page.getByRole('dialog', { name: ASK }).getByRole('button', { name: '저장하지 않고 닫기' }).click();
      await withBackEntry(page, (p) => p.getByRole('button', { name: NAME }).first().waitFor({ timeout: 10_000 }));
      await page.getByRole('button', { name: NAME }).first().click();
      await dlg.getByRole('textbox').first().fill('시험 규칙');
      const hash0 = await page.evaluate(() => location.hash);
      await page.evaluate(() => history.back());
      await page.getByRole('dialog', { name: ASK }).waitFor({ timeout: 5000 });
      check('[145-3] 규칙 — 바꾼 뒤 뒤로 가기 → 확인 창 · 주소 그대로', (await page.evaluate(() => location.hash)) === hash0 && (await dialogCount(page, NAME)) === 1);
      check('[145-3] 규칙 — 페이지 오류 0', errors.length === 0, errors.join(' | '));
      await ctx.close();
    }

    // ⑤ 편집 화면(급등 탐지 「설정」 탭) — 다른 메뉴 · 탭 · 뒤로 가기
    {
      const { page, ctx, errors, ctl } = await open(browser, size, '#/surge/settings', (p) => p.getByRole('button', { name: '설정 저장' }).waitFor({ timeout: 30_000 }));
      const menu = (name: string) => page.locator('nav').getByRole('button', { name, exact: true }).first();
      await menu('증시 일정').click();
      await page.waitForFunction(() => location.hash.startsWith('#/calendar'), null, { timeout: 5000 });
      check('[145-3] 편집 화면 — 바꾸지 않았으면 다른 메뉴로 바로 감', (await dialogCount(page, ASK)) === 0);
      await page.evaluate(() => history.back());
      await page.getByRole('button', { name: '설정 저장' }).waitFor({ timeout: 10_000 });
      const num = () => page.getByRole('spinbutton').and(page.locator(':enabled')).first();
      const orig = await num().inputValue();
      await num().fill('77');
      await menu('증시 일정').click();
      const s = await askShape(page);
      check('[145-3] 편집 화면 — 바꾼 뒤 다른 메뉴 → 확인 창(문구 · 단추 · 기본 초점) · 화면 그대로', askOk(s) && (await page.evaluate(() => location.hash)) === '#/surge/settings', JSON.stringify(s));
      await page.getByRole('dialog', { name: ASK }).getByRole('button', { name: '취소' }).click();
      check('[145-3] 편집 화면 — [취소] = 화면 그대로', (await page.evaluate(() => location.hash)) === '#/surge/settings' && (await page.getByRole('button', { name: '설정 저장' }).count()) === 1);
      await page.getByRole('tab', { name: '탐지 히스토리' }).first().click({ timeout: 5000 });
      const tabAsk = await dialogCount(page, ASK);
      if (tabAsk) await page.getByRole('dialog', { name: ASK }).getByRole('button', { name: '취소' }).click();
      check('[145-3] 편집 화면 — 바꾼 뒤 화면 안 탭 → 확인 창', tabAsk === 1);
      // 뒤로 가기 — 앞에 기록을 쌓고(바꾼 것이 있으니 묻는다 → 저장하지 않고 닫기) 다시 와서 바꾼 뒤
      await num().fill(orig);
      await withBackEntry(page, (p) => p.getByRole('button', { name: '설정 저장' }).waitFor({ timeout: 10_000 }));
      await num().fill('88');
      await page.evaluate(() => history.back());
      await page.getByRole('dialog', { name: ASK }).waitFor({ timeout: 5000 });
      check('[145-3] 편집 화면 — 바꾼 뒤 뒤로 가기 → 확인 창 · 주소 그대로', (await page.evaluate(() => location.hash)) === '#/surge/settings');
      await page.getByRole('dialog', { name: ASK }).getByRole('button', { name: '저장하지 않고 닫기' }).click();
      await page.waitForFunction(() => location.hash.startsWith('#/calendar'), null, { timeout: 5000 });
      check('[145-3] 편집 화면 — [저장하지 않고 닫기] = 가려던 곳으로', (await dialogCount(page, ASK)) === 0);
      // 저장 중에는 떠나지 않는다
      await page.evaluate(() => {
        location.hash = '#/surge/settings';
      });
      await page.getByRole('button', { name: '설정 저장' }).waitFor({ timeout: 10_000 });
      await num().fill('66');
      ctl.surge = gate();
      await page.getByRole('button', { name: '설정 저장' }).click();
      await page.evaluate(() => history.back());
      await sleep(300);
      check('[145-3] 편집 화면 — 저장 중 뒤로 가기 = 묻지도 떠나지도 않음', (await dialogCount(page, ASK)) === 0 && (await page.evaluate(() => location.hash)) === '#/surge/settings');
      ctl.surge.open();
      ctl.surge = null;
      check('[145-3] 편집 화면 — 페이지 오류 0', errors.length === 0, errors.join(' | '));
      await ctx.close();
    }
  }

  // ───────── 4 문구(소스 검사) ─────────
  {
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name)) files.push(p);
      }
    };
    walk(path.join(root, 'src'));
    const bad: string[] = [];
    let titles = 0;
    for (const f of files) {
      fs.readFileSync(f, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (/^\s*(\*|\/\/|\/\*)/.test(line)) return;
          const code = line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
          if (/계속 고르기|그냥 닫기|버리기/.test(code)) bad.push(`${path.relative(root, f)}:${i + 1}`);
          if (/title\s*[:=]\s*['"`{]*\s*['"`]저장하지 않고 닫기['"`]/.test(code)) bad.push(`${path.relative(root, f)}:${i + 1} (제목)`);
          // 업데이트 내역(`src/data/changelog.ts`)은 바뀐 것을 알리는 글이라 세지 않는다
          if (/저장하지 않고 닫을까요\?/.test(code) && !f.endsWith(path.join('src', 'data', 'changelog.ts'))) titles++;
        });
    }
    check('[145-4] 화면 글에 「계속 고르기」 · 「그냥 닫기」 · 「버리기」 · 제목 「저장하지 않고 닫기」 0', bad.length === 0, bad.join(', '));
    check('[145-4] 묻는 제목은 「저장하지 않고 닫을까요?」 한 곳(store/leaveGuard)', titles === 1, String(titles));
  }

  // ───────── 5 바뀐 파일 ─────────
  {
    const git = (...a: string[]) => execFileSync('git', a, { cwd: root, encoding: 'utf8' });
    const changed = git('diff', '--name-only', `${BASE}..HEAD`).split('\n').concat(git('diff', '--name-only').split('\n')).filter(Boolean);
    // 주문(차트 빠른 주문 · 모의 주문 훅) · 자동매매 실행(server/autoTrading) · 서버 · 로그인
    const forbidden = changed.filter((f) => f.startsWith('server/') || /^src\/(components\/chart\/QuickOrderPanel|hooks\/usePaperTrading|hooks\/usePaperQuickBuy|components\/auth\/|services\/toss\/|hooks\/useAuth)/.test(f));
    check('[145-5] 주문 · 자동매매 실행 · 서버 · 로그인 코드 바뀐 파일 0', forbidden.length === 0, forbidden.join(', '));
    // 자동매매 설정 창 · 처음 켜기 창은 창 막기 · 묻기만 — 서버로 보내는 줄(요청 주소 · 보내는 값)은 그대로
    const sendLines = ['src/components/paper-trading/AutoTradeSettings.tsx', 'src/components/paper-trading/AutoTradeWizard.tsx']
      .flatMap((f) => git('diff', `${BASE}..HEAD`, '--', f).split('\n').concat(git('diff', '--', f).split('\n')))
      .filter((l) => /^[-+](?![-+])/.test(l) && /\/api\/|json\(|fetch\(|onSave\(|body:/.test(l));
    check('[145-5] 자동매매 설정 · 처음 켜기 창 — 서버로 보내는 줄 바뀐 것 0(창 막기 · 묻기만)', sendLines.length === 0, sendLines.slice(0, 3).join(' | '));
    // 서버가 함께 쓰는 src — 서버 컴파일 목록(`tsconfig.node.json` 프로그램이 실제로 읽는 src 파일)과 겹치는 바뀐 파일 · 업데이트 내역 더하기 말고 0
    const nodeSrc = new Set(
      execFileSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.node.json', '--listFilesOnly'], { cwd: root, encoding: 'utf8' })
        .split('\n')
        .map((l) => path.relative(root, l.trim()))
        .filter((f) => f.startsWith('src/')),
    );
    const shared = changed.filter((f) => nodeSrc.has(f) && f !== 'src/data/changelog.ts');
    check('[145-5] 서버가 함께 쓰는 src 바뀐 줄 0', shared.length === 0, shared.join(', '));
    const dc = git('diff', `${BASE}..HEAD`, '--', 'scripts/designCheck.ts') + git('diff', '--', 'scripts/designCheck.ts');
    const removed = dc.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---'));
    check('[145-5] designCheck.ts 판정 부분 바뀐 줄 0(장면 더하기만 — 지운 줄 0)', removed.length === 0, removed.slice(0, 3).join(' | '));
  }

  // ───────── 6 목록 문서 줄 수 ─────────
  {
    const git = (...a: string[]) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();
    const common = git('rev-parse', '--path-format=absolute', '--git-common-dir');
    const doc = path.resolve(path.dirname(common), '../../docs/analysis/2026-11-18_막는로딩_나갈때묻기_목록.md');
    const at = (f: string) => git('show', `${BASE}:${f}`);
    const files = git('ls-tree', '-r', '--name-only', BASE, 'src').split('\n').filter((f) => f.endsWith('.tsx'));
    const overlayFiles = files.filter((f) => at(f).includes('LoadingOverlay'));
    const dialogFiles = files.filter((f) => /<Dialog\b/.test(at(f)));
    if (!fs.existsSync(doc)) {
      check('[145-6] 목록 문서가 있음', false, doc);
    } else {
      const text = fs.readFileSync(doc, 'utf8');
      const rows = (head: string) => {
        const part = text.split(/^## /m).find((s) => s.startsWith(head)) ?? '';
        return part.split('\n').filter((l) => /^\|\s*`src\//.test(l)).map((l) => l.split('|')[1].trim().replace(/`/g, ''));
      };
      const r1 = rows('1.');
      const r2 = rows('2.');
      const r3 = rows('3.');
      check(`[145-6] 목록 1 — LoadingOverlay 를 쓰던 ${overlayFiles.length}파일이 한 줄씩`, overlayFiles.every((f) => r1.includes(f)) && overlayFiles.length === 19, `${overlayFiles.length} · 빠짐 ${overlayFiles.filter((f) => !r1.includes(f)).join(',')}`);
      check(`[145-6] 목록 2 — <Dialog 를 쓰던 ${dialogFiles.length}파일이 한 줄씩`, dialogFiles.every((f) => r2.includes(f)) && dialogFiles.length === 22, `${dialogFiles.length} · 빠짐 ${dialogFiles.filter((f) => !r2.includes(f)).join(',')}`);
      check('[145-6] 목록 3 — 편집 화면 · 직접 덮개 줄이 있음(1 개 이상)', r3.length >= 1, String(r3.length));
    }
  }
} finally {
  await guard.step('브라우저 닫기', () => browser.close());
  await guard.step('Vite 닫기', () => vite.close());
  guard.stop();
}
console.log(`\n결과: PASS ${pass} · FAIL ${fail}`);
process.exit(fail > 0 ? 1 : 0);
