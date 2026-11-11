/**
 * 자산 화면 잠금 시간 점검(117차 · v2.65.4) — `npm run assetlock:test` · ⚠️ `DB_PATH=<사본>` 으로만 돈다(맨 첫 import).
 *
 * 117차 지시서 「꼭 지킬 동작」 3 · 4 를 줄마다 확인한다(시험 이름 앞의 [117-n] 이 그 줄 번호).
 * - [117-3] 서버(가짜 시계 `setLockClockForTest`): 이 프로세스 안에 로그인 문지기 + 자산 라우터만 띄워 실제 HTTP 로 —
 *   30분 넘게 touch 없음 → asset-locked · summary 폴링만으로는 늘지 않음 · touch · 쓰기 요청은 늘림 · 0(끄기) · 10 · 60 · 잘못된 값 거절.
 * - [117-4] 화면(Playwright 가짜 시계 `page.clock`): 같은 안쪽 서버 + Vite(프록시만 안쪽 서버로) — 입력이 있으면 touch 1분에 1번 이하 ·
 *   시간이 지나면 서버를 기다리지 않고 잠금 화면 + 안내 한 줄 · 서버가 asset-locked 를 돌려줘도 같은 화면 · 다른 메뉴에 갔다 와도 서버 시각 기준 ·
 *   설정 메뉴 6개 · 「잠금」 바로 저장 · 로딩 표시.
 * 시트 연결 정보를 비우고 돈다 — 실제 구글 · 토스 호출 0(이 프로세스의 바깥 주소 fetch 는 막고 센다).
 * ⚠️ 자산 값은 다루지 않는다(가짜 요약 값만 · 출력에 금액 없음).
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import 'dotenv/config';
import path from 'node:path';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { chromium } from 'playwright';
import { getDb } from '../server/db';
import { createSession, setPassword } from '../server/auth';
import { lockStateOf, setAssetPassword, setLockClockForTest } from '../server/asset/lock';
import { ACTIVE, assetRouter } from '../server/asset/routes';
import { authGuard } from '../server/authGuard';
import { readLockMinutes, writeAssetSettings } from '../server/asset/settings';
import { assetSheetSample, assetSummarySample } from './fixtures/asset/screenSample';
import { createBrowserStepGuard } from './lib/browserStepGuard';

// 시트 · 쓰기 스위치 끔 — 시트를 읽거나 쓰는 길은 모두 설정 없음 · 꺼짐에서 멈춘다
process.env.ASSET_SHEET_ID = '';
process.env.GOOGLE_SA_KEY_FILE = '';
process.env.ASSET_SYNC_ENABLED = 'false';
process.env.ASSET_PRICE_WRITE_ENABLED = 'false';

const root = path.resolve(import.meta.dirname, '..');
const LOGIN_PW = 'selftest-assetlock-login-0001';
const ASSET_PW = 'selftest-assetlock-lock-0002';
const MIN = 60_000;

const guard = createBrowserStepGuard();
let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = '') {
  guard.mark(name);
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? ` — ${detail}` : ''}`);
}

// 바깥 주소 호출 막기(실제 구글 · 토스 0) — 안쪽 서버(127.0.0.1)만 통과
const realFetch = globalThis.fetch;
let outside = 0;
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!/^http:\/\/127\.0\.0\.1:\d+\//.test(url)) {
    outside++;
    throw new Error('시험 — 바깥 주소 호출 막음');
  }
  return realFetch(input, init);
}) as typeof fetch;

// 시트 연결이 없어 summary · sheet 가 매번 남기는 경고 한 줄(이유 종류만)은 세기만 한다 — 다른 경고는 그대로
const origWarn = console.warn;
let sheetWarns = 0;
console.warn = (...args: unknown[]) => {
  if (String(args[0]).startsWith('[asset] 시트 읽기 실패: not-configured')) sheetWarns++;
  else origWarn(...args);
};

const LOCK_KEY = 'asset.lockMinutes';
const clearLockSetting = () => getDb().prepare(`DELETE FROM app_settings WHERE key = ?`).run(LOCK_KEY);

await setPassword(LOGIN_PW);
await setAssetPassword(ASSET_PW);
clearLockSetting();

const app = express();
app.use(express.json());
app.use(authGuard);
app.use(assetRouter);
const srv = app.listen(0, '127.0.0.1');
await new Promise((ok) => srv.once('listening', ok));
const API = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
const token = createSession('assetlock-selftest');
const ck = { cookie: `as_session=${encodeURIComponent(token)}` };

async function call(method: string, p: string, body?: unknown): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`${API}${p}`, { method, headers: { ...ck, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}
const isLocked = (r: { status: number; body: Record<string, unknown> }) => r.status === 403 && r.body.code === 'asset-locked' && r.body.error === '자산 관리가 잠겨 있습니다.';

let viteClose: (() => Promise<void>) | null = null;
try {
  // ── [117-3] 서버 — 가짜 시계 ──────────────────────────────────────────────
  let now = Date.parse('2026-11-08T00:00:00Z');
  setLockClockForTest(() => now);
  const unlock = async () => (await call('POST', '/api/asset/unlock', { password: ASSET_PW })).status === 200;
  const T0 = now;

  {
    check('[117-3] 처음 값 30분 — 설정이 없으면 readLockMinutes() = 30', readLockMinutes() === 30);
    const ok = await unlock();
    const st = await call('GET', '/api/asset/status');
    check('[117-3] 풀기 → status unlocked · lockMinutes 30 · remainingMs 30분 · idleLocked false', ok && st.body.unlocked === true && st.body.lockMinutes === 30 && st.body.remainingMs === 30 * MIN && st.body.idleLocked === false);
    // summary 폴링만 30분 — 시간을 늘리지 않는다
    let polledOk = true;
    for (let t = 0; t <= 30 * MIN; t += MIN) {
      now = T0 + t;
      const r = await call('GET', '/api/asset/summary?pension=0');
      if (isLocked(r)) polledOk = false;
    }
    const st29 = await call('GET', '/api/asset/status');
    now = T0 + 30 * MIN + 1;
    const after = await call('GET', '/api/asset/summary?pension=0');
    const stAfter = await call('GET', '/api/asset/status');
    check('[117-3] summary 폴링만 1분마다 30분 동안 → 그동안 잠기지 않음(정확히 30분까지) · 30분 넘으면 다음 요청 403 asset-locked(지금 잠김 응답과 같은 모양)',
      polledOk && st29.body.unlocked === true && st29.body.remainingMs === 0 && isLocked(after), JSON.stringify(after.body));
    now = T0;
    const rewound = lockStateOf(token).unlocked;
    check('[117-3] 잠긴 뒤 status — unlocked false · idleLocked true(잠금 화면 안내) · 세션이 실제로 잠김(시계를 되돌려도 풀리지 않음)',
      stAfter.body.unlocked === false && stAfter.body.idleLocked === true && !rewound);
    const t2 = await call('POST', '/api/asset/touch');
    check('[117-3] 잠긴 세션의 touch → 403 asset-locked(늘리지 않음)', isLocked(t2));
  }

  {
    // touch 가 시간을 늘림 · 읽기는 늘리지 않음
    now = T0;
    await unlock();
    now = T0 + 10 * MIN;
    await call('GET', '/api/asset/sheet');
    await call('GET', '/api/asset/history?range=1m');
    await call('GET', '/api/asset/status');
    now = T0 + 20 * MIN;
    const touch = await call('POST', '/api/asset/touch');
    now = T0 + 49 * MIN;
    const mid = await call('GET', '/api/asset/summary?pension=0');
    now = T0 + 50 * MIN;
    const edge = await call('GET', '/api/asset/summary?pension=0');
    now = T0 + 50 * MIN + 1;
    const late = await call('GET', '/api/asset/summary?pension=0');
    check('[117-3] touch(20분) → 200 · 남은 시간 30분 · 49분 · 50분 그대로 풀림 · 50분 넘으면 asset-locked(sheet · history · status 읽기는 늘리지 않음 — 늘렸으면 10분부터 셈)',
      touch.status === 200 && touch.body.remainingMs === 30 * MIN && touch.body.lockMinutes === 30 && !isLocked(mid) && !isLocked(edge) && isLocked(late));
    now = T0;
    await unlock();
    now = T0 + 10 * MIN;
    await call('GET', '/api/asset/sheet');
    now = T0 + 30 * MIN + 1;
    check('[117-3] 읽기(sheet 10분)만 있고 touch 없음 → 30분 넘으면 asset-locked', isLocked(await call('GET', '/api/asset/sheet')));
  }

  {
    // 쓰기 요청은 시간을 늘림(분류 · 설정 · 목표 비율 · 구매 완료 · 시트 가격 둘) — 실패하는 쓰기도 「화면을 쓴 것」
    const writes = [...ACTIVE].filter((r) => r !== 'POST /api/asset/touch');
    const results: string[] = [];
    for (const r of writes) {
      const [method, p] = r.split(' ');
      now = T0;
      await unlock();
      now = T0 + 20 * MIN;
      const w = await call(method, p, {});
      now = T0 + 45 * MIN;
      const still = await call('GET', '/api/asset/summary?pension=0');
      now = T0 + 50 * MIN + 1;
      const late = await call('GET', '/api/asset/summary?pension=0');
      results.push(`${r}:${w.status}:${isLocked(still) ? 'locked' : 'open'}:${isLocked(late) ? 'locked' : 'open'}`);
    }
    check('[117-3] [120-1] [134-4] 쓰기 요청 10가지(PUT class · settings · target-ratio · POST purchase-done · price-source convert · restore · trade · 120차 새 종목 trade/new · 확인 화면 trade/new/plan · 134차 메모 daily-note) 각각 20분에 → 45분 풀림 · 50분 넘으면 잠김',
      writes.length === 10 && results.every((x) => x.endsWith(':open:locked') && !x.includes(':403:')), results.join(' '));
    check('[117-3] [120-1] [134-4] ACTIVE = touch + 쓰기 10가지뿐(118차 매수 · 매도 입력 · 120차 새 종목 · 134차 메모 포함) · summary · sheet · history · status 는 없음',
      ACTIVE.size === 11 && ACTIVE.has('PUT /api/asset/daily-note') && ![...ACTIVE].some((r) => r.startsWith('GET ')) && ACTIVE.has('POST /api/asset/touch'));
  }

  {
    // 0(끄기) · 10 · 60 · 잘못된 값
    const data = assetSheetSample();
    const off = writeAssetSettings({ lockMinutes: 0 }, data);
    now = T0;
    await unlock();
    now = T0 + 10 * 60 * MIN;
    const offRes = await call('GET', '/api/asset/summary?pension=0');
    const offSt = await call('GET', '/api/asset/status');
    check('[117-3] 0(끄기) 저장 → 10시간 뒤에도 잠기지 않음 · status remainingMs null · lockMinutes 0', off?.lockMinutes === 0 && !isLocked(offRes) && offSt.body.unlocked === true && offSt.body.remainingMs === null && offSt.body.lockMinutes === 0);

    const ten = writeAssetSettings({ lockMinutes: 10 }, data);
    now = T0;
    await unlock();
    now = T0 + 10 * MIN;
    const t10 = await call('GET', '/api/asset/summary?pension=0');
    now = T0 + 10 * MIN + 1;
    const t10b = await call('GET', '/api/asset/summary?pension=0');
    check('[117-3] 10 저장 → 10분까지 풀림 · 10분 넘으면 asset-locked', ten?.lockMinutes === 10 && !isLocked(t10) && isLocked(t10b));

    const sixty = writeAssetSettings({ lockMinutes: 60 }, data);
    now = T0;
    await unlock();
    now = T0 + 59 * MIN;
    const t59 = await call('GET', '/api/asset/summary?pension=0');
    now = T0 + 60 * MIN + 1;
    const t60 = await call('GET', '/api/asset/summary?pension=0');
    check('[117-3] 60 저장 → 59분 풀림 · 60분 넘으면 asset-locked', sixty?.lockMinutes === 60 && !isLocked(t59) && isLocked(t60));

    const bad = [15, -1, '30', 30.5, null, true].map((v) => writeAssetSettings({ lockMinutes: v }, data));
    check('[117-3] 잘못된 값(15 · -1 · \'30\' · 30.5 · null · true) 저장 거절(null) · 저장값 그대로 60',
      bad.every((x) => x === null) && readLockMinutes() === 60);
    // 틀린 저장값이 DB 에 들어 있어도 30 으로 읽음
    getDb().prepare(`INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(LOCK_KEY, JSON.stringify('30'));
    check('[117-3] DB 저장값이 틀린 모양(\'30\' 글자)이면 처음 값 30 으로 읽음', readLockMinutes() === 30);
    clearLockSetting();
  }

  {
    // 「잠그기」 · 다시 풀기는 안내를 지움
    now = T0;
    await unlock();
    now = T0 + 31 * MIN;
    await call('GET', '/api/asset/summary?pension=0');
    const idle = await call('GET', '/api/asset/status');
    await call('POST', '/api/asset/lock');
    const manual = await call('GET', '/api/asset/status');
    check('[117-3] 쓰지 않아 잠김 → idleLocked true · 「잠그기」 뒤에는 idleLocked false(안내 없음)', idle.body.idleLocked === true && manual.body.idleLocked === false && manual.body.unlocked === false);
  }
  setLockClockForTest(null);

  // ── [117-4] 화면 — Vite + Playwright 가짜 시계 ──────────────────────────────
  const { createServer } = await import('vite');
  const vite = await createServer({
    root,
    configFile: path.join(root, 'vite.config.ts'),
    logLevel: 'error',
    server: { host: '127.0.0.1', port: 5187, strictPort: true, hmr: false, proxy: { '/api': { target: API, changeOrigin: false } } },
  });
  await guard.step('Vite 띄우기', () => vite.listen());
  viteClose = () => vite.close();
  const WEB = 'http://127.0.0.1:5187';

  const browser = await guard.step('브라우저 띄우기', () => chromium.launch({ channel: 'chrome' }));
  try {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addCookies([{ name: 'as_session', value: token, url: WEB }]);
    // touch 를 보낸 시각(가짜 시계) 기록 — 앱의 fetch 보다 먼저 감싼다
    await ctx.addInitScript(() => {
      const w = window as unknown as { __touches: number[]; fetch: typeof fetch };
      w.__touches = [];
      const of = window.fetch.bind(window);
      w.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
        const u = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        if (u.includes('/api/asset/touch')) w.__touches.push(Date.now());
        return of(input, init);
      }) as typeof fetch;
    });
    const page = await ctx.newPage();
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
    // 자산 밖 API 는 가짜(로그인 확인만 통과) — 시세 · 계좌 등은 부르지 않게
    await page.route(/\/api\/(?!asset\/)/, (r) => (r.request().url().includes('/api/auth/me') ? r.fulfill({ json: { ok: true } }) : r.fulfill({ status: 503, json: { error: '시험 — 없음' } })));
    await page.clock.install({ time: new Date('2026-11-08T01:00:00Z') });

    const pw = page.locator('#as-asset-password');
    const dash = page.locator('[data-asset-dashboard]');
    const note = page.locator('[data-asset-idle-note]');
    const unlockUi = async () => {
      await pw.waitFor({ timeout: 20_000 });
      await pw.fill(ASSET_PW);
      await page.getByRole('button', { name: '잠금 풀기' }).click();
      await dash.waitFor({ timeout: 10_000 });
    };
    const touches = () => page.evaluate(() => (window as unknown as { __touches: number[] }).__touches.slice());

    await guard.step('페이지 열기(#/asset)', () => page.goto(`${WEB}/#/asset`));
    await guard.step('잠금 풀기', () => unlockUi());

    // 입력 3분(5초마다 클릭 · 키 · 휠을 돌아가며) → touch 1분에 1번 이하
    const kinds = ['pointerdown', 'keydown', 'wheel'] as const;
    for (let i = 0; i < 36; i++) {
      await dash.dispatchEvent(kinds[i % 3]);
      await page.clock.fastForward(5_000);
    }
    await page.clock.fastForward(61_000); // 마지막 입력 뒤 1분이 차면 한 번(마지막 입력을 놓치지 않음)
    const ts = await touches();
    const gaps = ts.slice(1).map((t, i) => t - ts[i]);
    check('[117-4] 입력 3분(5초마다 클릭 · 키 · 휠 36번) → touch 4~5번 · 사이 간격 모두 60초 이상(1분에 1번 이하)',
      ts.length >= 4 && ts.length <= 5 && gaps.every((g) => g >= 60_000), `${ts.length}번 · 간격 ${gaps.join(',')}`);

    // 마지막 touch 뒤 29분 — 그대로 · 31분 — 서버를 기다리지 않고 잠금 화면 + 안내
    const lastTouch = ts[ts.length - 1];
    const fakeNow = await page.evaluate(() => Date.now());
    await page.clock.fastForward(lastTouch + 29 * MIN - fakeNow);
    const stillDash = (await dash.count()) === 1 && (await pw.count()) === 0;
    await page.clock.fastForward(2 * MIN);
    await note.waitFor({ timeout: 5_000 }).catch(() => {});
    const noteText = (await note.textContent().catch(() => null)) ?? '';
    check('[117-4] 마지막 touch 뒤 29분은 화면 그대로 · 31분 → 잠금 화면(비밀번호 칸) + 「30분 동안 쓰지 않아 잠갔어요」',
      stillDash && (await pw.count()) === 1 && noteText === '30분 동안 쓰지 않아 잠갔어요', noteText);
    check('[117-4] 화면 타이머가 먼저 잠금 — 그때 서버 세션은 아직 풀림(실제 시각 몇 초 — 서버 응답을 기다리지 않았다)', lockStateOf(token).unlocked);

    // 서버가 asset-locked(서버 시각으로 지남) → 같은 잠금 화면 + 안내
    await unlockUi();
    const noNoteAfterUnlock = (await note.count()) === 0;
    setLockClockForTest(() => Date.now() + 31 * MIN);
    await page.clock.fastForward(10_500); // 10초 폴링 한 번 → 403 asset-locked → status(idleLocked)
    await note.waitFor({ timeout: 5_000 }).catch(() => {});
    const noteText2 = (await note.textContent().catch(() => null)) ?? '';
    check('[117-4] 다시 풀면 안내 없음 · 서버가 summary 에 asset-locked → 같은 잠금 화면 + 「30분 동안 쓰지 않아 잠갔어요」',
      noNoteAfterUnlock && (await pw.count()) === 1 && noteText2 === '30분 동안 쓰지 않아 잠갔어요', noteText2);
    setLockClockForTest(null);

    // 다른 메뉴로 갔다가 돌아옴 — 서버 시각 기준
    await unlockUi();
    await page.evaluate(() => (location.hash = '#/home'));
    await page.waitForTimeout(300);
    setLockClockForTest(() => Date.now() + 31 * MIN);
    await page.evaluate(() => (location.hash = '#/asset'));
    await note.waitFor({ timeout: 5_000 }).catch(() => {});
    check('[117-4] 다른 메뉴로 갔다가 31분(서버 시각) 뒤 돌아옴 → 잠금 화면 + 안내(서버 status 기준)', (await pw.count()) === 1 && (await note.count()) === 1);
    setLockClockForTest(null);
    await unlockUi();
    await page.evaluate(() => (location.hash = '#/home'));
    await page.waitForTimeout(300);
    await page.evaluate(() => (location.hash = '#/asset'));
    await dash.waitFor({ timeout: 5_000 }).catch(() => {});
    check('[117-4] 시간 안에 돌아오면 그대로 풀린 화면(다시 비밀번호 없음)', (await dash.count()) === 1 && (await pw.count()) === 0);

    // 10분으로 바꾼 설정(요약)을 따름 — 서버가 준 요약의 lockMinutes 로 화면 타이머
    await page.route('**/api/asset/summary**', (r) => r.fulfill({ json: assetSummarySample({ lockMinutes: 10, writeEnabled: false }) }));
    await page.evaluate(() => (location.hash = '#/home'));
    await page.waitForTimeout(300);
    await page.evaluate(() => (location.hash = '#/asset'));
    await dash.waitFor({ timeout: 5_000 });
    await page.locator('[data-asset-settings]').waitFor({ timeout: 5_000 });
    await dash.dispatchEvent('pointerdown');
    await page.clock.fastForward(9 * MIN);
    const still10 = (await pw.count()) === 0;
    await page.clock.fastForward(2 * MIN);
    await note.waitFor({ timeout: 5_000 }).catch(() => {});
    const noteText3 = (await note.textContent().catch(() => null)) ?? '';
    // 안내의 시간 = 화면 타이머가 쓴 값(요약의 10분 — 잠금 상태가 처음 준 30분이 아님)
    check('[117-4] 요약의 잠금 시간 10분 → 9분 그대로 · 11분 잠금 화면 + 「10분 동안 쓰지 않아 잠갔어요」', still10 && (await pw.count()) === 1 && noteText3 === '10분 동안 쓰지 않아 잠갔어요', noteText3);

    // 설정 창 — 메뉴 6개 · 「잠금」 바로 저장 · 로딩 표시
    await unlockUi();
    await page.locator('[data-asset-settings]').click();
    const dialog = page.getByRole('dialog');
    const tabs = dialog.getByRole('tab');
    await tabs.first().waitFor({ timeout: 5_000 });
    const tabNames = (await tabs.allTextContents()).map((t) => t.trim());
    let release: (() => void) | null = null;
    const putBodies: string[] = [];
    await page.route('**/api/asset/settings', async (r) => {
      putBodies.push(r.request().postData() ?? '');
      await new Promise<void>((ok) => (release = ok));
      await r.fulfill({ json: { ...assetSummarySample({ lockMinutes: 10 }).settings, lockMinutes: 60 } });
    });
    await dialog.getByRole('tab', { name: '잠금' }).click();
    const group = dialog.getByRole('radiogroup', { name: '쓰지 않으면 잠그는 시간' });
    await group.waitFor({ timeout: 5_000 });
    const radios = (await group.getByRole('radio').allTextContents()).map((t) => t.trim());
    const checked0 = await group.getByRole('radio', { name: '10분' }).getAttribute('aria-checked');
    await group.getByRole('radio', { name: '60분' }).click();
    await page.waitForTimeout(200);
    const spinner = await dialog.getByLabel('저장하는 중').count();
    const disabledWhileBusy = await group.getByRole('radio', { name: '30분' }).isDisabled();
    const checkedBusy = await group.getByRole('radio', { name: '60분' }).getAttribute('aria-checked');
    for (let i = 0; i < 20 && !release; i++) await page.waitForTimeout(50);
    (release as (() => void) | null)?.();
    await page.waitForTimeout(400);
    const spinnerAfter = await dialog.getByLabel('저장하는 중').count();
    const checkedAfter = await group.getByRole('radio', { name: '60분' }).getAttribute('aria-checked');
    check('[117-4] 설정 메뉴 6개(… 시트 가격 · 잠금 — 잠금이 맨 아래) · 「잠금」 = [10분 | 30분 | 60분 | 끄기] · 지금 값(10분) 눌림',
      tabNames.length === 6 && tabNames[5] === '잠금' && JSON.stringify(radios) === JSON.stringify(['10분', '30분', '60분', '끄기']) && checked0 === 'true', `${tabNames.join('|')} / ${radios.join('|')} / ${checked0}`);
    check('[117-4] 「60분」 누름 → 바로 저장(PUT /api/asset/settings { lockMinutes: 60 } 한 번) · 저장 중 로딩(「저장하는 중」) · 그 칸 막힘 · 끝나면 로딩 사라지고 60분 눌림',
      putBodies.length === 1 && JSON.parse(putBodies[0] || '{}').lockMinutes === 60 && Object.keys(JSON.parse(putBodies[0] || '{}')).length === 1 &&
        spinner >= 1 && disabledWhileBusy && checkedBusy === 'true' && spinnerAfter === 0 && checkedAfter === 'true', `${putBodies.join('|')} 로딩 ${spinner}→${spinnerAfter} 막힘 ${disabledWhileBusy}`);
    check('[117-4] 화면 오류(pageerror) 0', errors.length === 0, errors.join(' | '));
    await ctx.close();
  } finally {
    await guard.step('브라우저 닫기', () => browser.close());
  }
  check('[117-3] [117-4] 바깥 주소 호출 0(실제 구글 · 토스 0)', outside === 0, String(outside));
} catch (e) {
  fail++;
  console.log(`FAIL  시험 중 오류 — ${(e as Error).message}`);
} finally {
  setLockClockForTest(null);
  clearLockSetting();
  getDb().prepare(`DELETE FROM auth_sessions`).run();
  if (viteClose) await guard.step('Vite 닫기', () => (viteClose as () => Promise<void>)().catch(() => {}));
  srv.close();
  guard.stop();
}
console.warn = origWarn;
console.log(`(시트 연결 없음 경고 ${sheetWarns}줄 — 이유 종류만)`);
console.log(`결과: ${pass}개 통과 / ${fail}개 실패`);
process.exit(fail === 0 ? 0 : 1);
