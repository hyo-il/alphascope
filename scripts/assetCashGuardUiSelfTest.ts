/**
 * 예수금 보이기 · 경고 화면 시험(142차 · v2.71.3) — `npm run assetcashguardui:test` · ⚠️ `DB_PATH=<사본>` 으로만 돈다(맨 첫 import).
 * 142차 「꼭 지킬 동작」 2(계좌 머리 예수금 · 1280 × 1080 · 1440 × 900) · 3(노란 경고) · 4(마이너스 확인 창 · 실제 사례 재현) · 5 의 화면 몫(보내는 값 그대로)을 줄마다 확인한다.
 * 1 · 5 · 6(서버 · 바뀐 파일)은 `assetcashguard:test`.
 * Vite + Playwright, `/api` 는 모두 `page.route` 가짜(만든 값 — 실제 사례의 숫자만 지시서 그대로) — 구글 · 토스 · 서버 호출 0. 요소는 역할 + 이름 · `data-testid` 로 찾는다.
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { CASH_SAMPLE_KIWOOM as KIWOOM, assetHistorySample, assetSheetSample, assetStatusSample, assetSummarySample } from './fixtures/asset/screenSample';
import { createBrowserStepGuard } from './lib/browserStepGuard';
import type { AssetCashKey, AssetCashPairView, AssetSheetCashBanks, AssetSheetData } from '../src/types/asset';

const root = path.resolve(import.meta.dirname, '..');
const PORT = 5186;
const WEB = `http://127.0.0.1:${PORT}`;
/** 서버가 보내는 예수금 계좌 이름(은행 · 상품) */
const KIWOOM_LABEL = '예시키움 · 투자 계좌 예수금';
/** 실제 사례(142차 지시서) — 예수금 4,000,000 · 3주 × 1,102,000 · 금액을 4,018,329 로 고침 */
const REAL = { balance: 4_000_000, qty: '3', price: '1102000', auto: 3_306_000, typed: '4018329' };

const guard = createBrowserStepGuard();
let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = '') {
  guard.mark(name);
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? ` — ${detail}` : ''}`);
}

/** 시트 응답 — 「현금」 탭에 키움 줄을 더하고 짝 설정(개별 투자 = 키움)을 함께 */
function sheet(kiwoomAmount: number | null, pairs: Record<string, AssetCashKey> = { '개별 투자': KIWOOM }): AssetSheetData & AssetSheetCashBanks {
  const s = assetSheetSample();
  return { ...s, cashAccounts: [...s.cashAccounts, { row: 9, name: KIWOOM.name, amount: kiwoomAmount }], cashDepositPairs: pairs };
}

interface Opts {
  size: { width: number; height: number };
  sheet?: AssetSheetData & AssetSheetCashBanks;
  pair?: AssetCashPairView;
  view?: 'account' | 'symbol';
}

async function open(browser: Browser, o: Opts) {
  const ctx = await browser.newContext({ viewport: o.size });
  await ctx.addInitScript((view) => {
    localStorage.setItem('alphascope.asset.tab', 'status');
    localStorage.setItem('alphascope.asset.statusView', view);
  }, o.view ?? 'account');
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)));
  const seen = { trades: [] as Record<string, unknown>[], pairCalls: 0, sheetCalls: 0, paths: new Set<string>() };
  page.on('request', (q) => {
    const u = new URL(q.url());
    if (u.pathname.startsWith('/api/asset/')) seen.paths.add(u.pathname);
  });
  await page.route(/\/api\/(?!asset\/)/, (r) => (r.request().url().includes('/api/auth/me') ? r.fulfill({ json: { ok: true } }) : r.fulfill({ status: 503, json: { error: '시험 — 없음' } })));
  await page.route('**/api/asset/status', (r) => r.fulfill({ json: assetStatusSample(true) }));
  await page.route('**/api/asset/touch', (r) => r.fulfill({ json: { ok: true, lockMinutes: 30, remainingMs: 30 * 60_000 } }));
  await page.route('**/api/asset/sheet', (r) => {
    seen.sheetCalls++;
    return r.fulfill({ json: o.sheet ?? sheet(694_000) });
  });
  await page.route('**/api/asset/summary**', (r) => r.fulfill({ json: assetSummarySample({ purchaseDone: true }) }));
  await page.route('**/api/asset/history**', (r) => r.fulfill({ json: assetHistorySample(5) }));
  await page.route('**/api/asset/cash/pair**', (r) => {
    seen.pairCalls++;
    return r.fulfill({ json: o.pair ?? { enabled: true, pair: { key: KIWOOM, label: KIWOOM_LABEL }, usdKrw: 1380.5, balance: REAL.balance } });
  });
  await page.route('**/api/asset/trade', async (r) => {
    seen.trades.push(JSON.parse(r.request().postData() ?? '{}') as Record<string, unknown>);
    await r.fulfill({ json: { id: 9, cash: { status: 'applied', message: null } } });
  });
  await guard.step('페이지 열기(#/asset)', () => page.goto(`${WEB}/#/asset`));
  await guard.step('자산 화면 기다리기', () => page.locator(o.view === 'symbol' ? '[data-testid="asset-symbol-table"], table' : '[data-account-cards]').first().waitFor({ timeout: 30_000 }));
  return { page, ctx, errors, seen };
}

/** 색 토큰 값(rgb) — 글자 색 비교 */
const tokenColor = (page: Page, token: string) =>
  page.evaluate((t) => {
    const el = document.createElement('span');
    el.style.color = `var(${t})`;
    document.body.appendChild(el);
    const c = getComputedStyle(el).color;
    el.remove();
    return c;
  }, token);
const colorOf = (page: Page, testid: string) => page.getByTestId(testid).evaluate((el) => getComputedStyle(el).color);

const dialogNoOverflow = (page: Page) =>
  page.evaluate(() => {
    const d = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')];
    const inner = d.flatMap((x) => [...x.querySelectorAll<HTMLElement>('[data-testid="asset-cash-trade"], [data-testid="asset-cash-trade-preview-line"]')]).filter((el) => el.scrollWidth > el.clientWidth + 1).length;
    return document.documentElement.scrollWidth <= window.innerWidth + 1 && d.length > 0 && d.every((x) => x.scrollWidth <= x.clientWidth + 1) && inner === 0;
  });

const preview = async (page: Page) => ((await page.getByTestId('asset-cash-trade-preview-line').textContent()) ?? '').replace(/\s+/g, ' ').trim();
const noRed = async (page: Page) => (await page.locator('[data-field-error]').count()) === 0 && (await page.locator('[aria-invalid="true"]').count()) === 0;

/** 개별 투자 「예시 국내 대형주」 매수 창 — 수량 · 가격 넣기 */
async function buy(page: Page, qty = REAL.qty, price = REAL.price) {
  await page.getByRole('button', { name: '예시 국내 대형주 매수 입력' }).first().click();
  await page.getByTestId('asset-cash-trade').waitFor({ timeout: 5000 });
  await page.getByRole('textbox', { name: '수량' }).fill(qty);
  await page.getByRole('textbox', { name: '가격' }).fill(price);
  await page.getByTestId('asset-cash-trade-preview').waitFor({ timeout: 5000 });
}

const { createServer } = await import('vite');
const vite = await guard.step('Vite 띄우기', async () => {
  const v = await createServer({ root, configFile: path.join(root, 'vite.config.ts'), logLevel: 'error', server: { host: '127.0.0.1', port: PORT, strictPort: true, hmr: false } });
  await v.listen();
  return v;
});
let sheetCallsWithPair = -1;
const browser = await guard.step('브라우저 띄우기', () => chromium.launch({ channel: 'chrome' }));
try {
  for (const size of [{ width: 1280, height: 1080 }, { width: 1440, height: 900 }]) {
    const w = size.width;

    // ── 2. 계좌 머리 예수금 ──
    {
      const { page, ctx, errors, seen } = await open(browser, { size });
      const heads = page.locator('[data-account-deposit]');
      await heads.first().waitFor({ timeout: 5000 });
      const head = page.locator('tbody[data-account="개별 투자"] th[data-account-head]');
      const text = ((await head.textContent()) ?? '').replace(/\s+/g, ' ');
      check(`[142-2] ${w}px 짝 있는 계좌(개별 투자)만 머리에 「예수금 ₩694,000」 + 「${KIWOOM_LABEL}」 · 다른 계좌 0`,
        (await heads.count()) === 1 && text.includes('예수금 ₩694,000') && text.includes(KIWOOM_LABEL) && (await head.locator('[data-account-deposit]').count()) === 1, text);
      check(`[142-2] ${w}px 플러스 금액은 하락 색이 아님(기본 글자 색)`, (await head.locator('[data-account-deposit-amount]').evaluate((el) => getComputedStyle(el).color)) !== (await tokenColor(page, '--color-bearish')));
      const box = await head.evaluate((th) => {
        const dep = th.querySelector('[data-account-deposit]')!.getBoundingClientRect();
        const val = th.querySelector('[data-value]')!.getBoundingClientRect();
        const name = th.querySelector('[data-tip-clip]')!.getBoundingClientRect();
        return { thOk: th.scrollWidth <= th.clientWidth + 1, gapVal: val.left - dep.right, gapName: dep.left - name.right, top: Math.abs(dep.top + dep.height / 2 - (val.top + val.height / 2)) };
      });
      const wrapOk = await page.locator('[data-account-cards-wrap]').evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
      check(`[142-2] ${w}px 머리 넘침 0 · 이름 · 예수금 · 평가 금액이 겹치지 않음 · 한 줄 가운데`, box.thOk && wrapOk && box.gapVal >= 0 && box.gapName >= 0 && box.top <= 2 && (await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)), JSON.stringify({ ...box, wrapOk }));
      // 화면을 열 때 부르는 자산 주소는 141차와 같은 다섯 가지뿐(시트 읽기 횟수도 짝이 없는 화면과 같음 — 아래 [짝 설정이 비면])
      const KNOWN = ['/api/asset/status', '/api/asset/touch', '/api/asset/sheet', '/api/asset/summary', '/api/asset/history'];
      const extra = [...seen.paths].filter((p) => !KNOWN.includes(p));
      sheetCallsWithPair = seen.sheetCalls;
      check(`[142-2] ${w}px 새 요청 0 — 계좌 머리는 시트 응답만 쓰고 예수금 짝 주소 · 그 밖 새 주소를 부르지 않음`, seen.pairCalls === 0 && extra.length === 0, `pair ${seen.pairCalls} · ${extra.join(',')}`);
      check(`[142-2] ${w}px 화면 오류 0(계좌 머리)`, errors.length === 0, errors.join(' / '));
      await ctx.close();
    }
    {
      // 마이너스 · 긴 이름 말줄임
      const long = { name: `예시키움 (투자 계좌 예수금 이름이 아주 긴 상품 — ${'만기 자동 연장 특판 상품 2026년 11월 가입분 계좌 '.repeat(4).trim()})`, nth: 1 };
      const s = sheet(-18_329);
      const sl = { ...s, cashAccounts: [...s.cashAccounts, { row: 10, name: long.name, amount: 5 }], cashDepositPairs: { '개별 투자': KIWOOM, 'ISA 계좌': long } };
      const { page, ctx } = await open(browser, { size, sheet: sl });
      await page.locator('[data-account-deposit]').first().waitFor({ timeout: 5000 });
      const minus = page.locator('tbody[data-account="개별 투자"] [data-account-deposit]');
      check(`[142-2] ${w}px 마이너스 → 「예수금 −₩18,329」 하락 색 숫자(경고 표시 아님)`,
        (await minus.getAttribute('data-account-deposit')) === 'minus' && ((await minus.textContent()) ?? '').includes('예수금 −₩18,329') &&
        (await minus.locator('[data-account-deposit-amount]').evaluate((el) => getComputedStyle(el).color)) === (await tokenColor(page, '--color-bearish')) && (await minus.locator('.text-warning, .text-danger').count()) === 0);
      const lab = page.locator('tbody[data-account="ISA 계좌"] [data-account-deposit-label]');
      const clipped = await lab.evaluate((el) => el.scrollWidth > el.clientWidth);
      const th = page.locator('tbody[data-account="ISA 계좌"] th[data-account-head]');
      check(`[142-2] ${w}px 긴 예수금 이름은 말줄임(잘렸을 때만 툴팁 data-tip-clip) · 머리 넘침 0 · 평가 금액 보임`,
        clipped && (await lab.getAttribute('data-tip-clip')) != null && (await th.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)) && (await th.locator('[data-value]').isVisible()),
        JSON.stringify({ clipped, th: await th.evaluate((el) => [el.scrollWidth, el.clientWidth]), lab: await lab.evaluate((el) => [el.scrollWidth, el.clientWidth, el.textContent]) }));
      check(`[142-2] ${w}px 짝 둘 → 머리 예수금 둘(짝 없는 적립식 · 연금 저축은 없음)`, (await page.locator('[data-account-deposit]').count()) === 2 && (await page.locator('tbody[data-account="적립식 계좌"] [data-account-deposit]').count()) === 0);
      await ctx.close();
    }
    {
      // 짝이 없으면(빈 설정) 아무것도 없음 · 「종목별」 에는 없음
      const { page, ctx, seen } = await open(browser, { size, sheet: sheet(694_000, {}) });
      await page.waitForTimeout(150);
      check(`[142-2] ${w}px 짝 설정이 비면 계좌 머리 예수금 0 · 시트 읽기 횟수는 짝이 있을 때와 같음(${seen.sheetCalls})`, (await page.locator('[data-account-deposit]').count()) === 0 && (await page.locator('[data-account-head]').count()) >= 4 && seen.sheetCalls === sheetCallsWithPair);
      await ctx.close();
      const sym = await open(browser, { size, view: 'symbol' });
      await sym.page.waitForTimeout(300);
      check(`[142-2] ${w}px 「종목별」 보기에는 예수금 없음`, (await sym.page.locator('[data-account-deposit]').count()) === 0 && (await sym.page.getByText('예수금 ₩694,000').count()) === 0);
      await sym.ctx.close();
    }

    // ── 4. 실제 사례 재현 — 노란 경고 + 마이너스 확인 창 ──
    {
      const { page, ctx, errors, seen } = await open(browser, { size });
      await buy(page);
      check(`[142-4] ${w}px 한 줄 「${KIWOOM_LABEL}에서 ₩3,306,000 빠집니다 → 남는 예수금 ₩694,000」(하락 색 아님)`,
        (await preview(page)).startsWith(`${KIWOOM_LABEL}에서 ₩3,306,000 빠집니다 → 남는 예수금 ₩694,000`) && (await page.getByTestId('asset-cash-trade-left').getAttribute('data-cash-left')) === 'plus', await preview(page));
      check(`[142-3] ${w}px 고치기 전 — 노란 경고 0`, (await page.getByTestId('asset-cash-trade-gap').count()) === 0);
      await page.getByRole('button', { name: '금액 고치기' }).click();
      await page.getByRole('textbox', { name: '예수금에서 빠질 금액' }).fill(REAL.typed);
      const gap = page.getByTestId('asset-cash-trade-gap');
      check(`[142-3][142-4] ${w}px 4,018,329 로 고침 → 노란 글 「계산 값 ₩3,306,000 과 ₩712,329 차이 나요 — 수수료 · 환율 차이가 아니면 확인해 주세요」`,
        (await gap.textContent()) === '계산 값 ₩3,306,000 과 ₩712,329 차이 나요 — 수수료 · 환율 차이가 아니면 확인해 주세요' && (await colorOf(page, 'asset-cash-trade-gap')) === (await tokenColor(page, '--color-warning')), (await gap.textContent()) ?? '');
      check(`[142-3] ${w}px 노란 경고는 빨간 표시 아님(aria-invalid · 칸 오류 0) · [저장] 막지 않음`, (await noRed(page)) && (await page.getByRole('button', { name: '저장' }).isEnabled()));
      const left = page.getByTestId('asset-cash-trade-left');
      check(`[142-4] ${w}px 한 줄 「→ 남는 예수금 −₩18,329」 하락 색`,
        (await preview(page)).includes('에서 ₩4,018,329 빠집니다 → 남는 예수금 −₩18,329') && (await left.getAttribute('data-cash-left')) === 'minus' &&
        (await left.locator('span').evaluate((el) => getComputedStyle(el).color)) === (await tokenColor(page, '--color-bearish')), await preview(page));
      check(`[142-2] ${w}px 매수 창 넘침 0(경고 · 남는 예수금 함께)`, await dialogNoOverflow(page));
      await page.getByRole('button', { name: '저장' }).click();
      const confirm = page.getByRole('dialog', { name: '예수금이 마이너스가 됩니다' });
      await confirm.waitFor({ timeout: 5000 });
      check(`[142-4] ${w}px [저장] → 확인 창 「저장하면 ${KIWOOM_LABEL}이 −₩18,329 가 됩니다. 그래도 저장할까요?」 [저장] [취소] · 저장 요청 아직 0`,
        ((await confirm.textContent()) ?? '').includes(`저장하면 ${KIWOOM_LABEL}이 −₩18,329 가 됩니다. 그래도 저장할까요?`) && (await confirm.getByRole('button', { name: '저장' }).count()) === 1 && (await confirm.getByRole('button', { name: '취소' }).count()) === 1 && seen.trades.length === 0);
      check(`[142-4] ${w}px 확인 창 넘침 0`, await dialogNoOverflow(page));
      await confirm.getByRole('button', { name: '취소' }).click();
      await confirm.waitFor({ state: 'detached', timeout: 5000 });
      await page.waitForTimeout(200);
      check(`[142-4] ${w}px [취소] → 저장 요청 0 · 매수 창 그대로(고친 금액 그대로)`,
        seen.trades.length === 0 && (await page.getByRole('dialog', { name: '매수 입력' }).count()) === 1 && (await page.getByRole('textbox', { name: '예수금에서 빠질 금액' }).inputValue()) === '4,018,329');
      await page.getByRole('button', { name: '저장' }).click();
      await confirm.waitFor({ timeout: 5000 });
      await confirm.getByRole('button', { name: '저장' }).click();
      await page.getByRole('dialog', { name: '매수 입력' }).waitFor({ state: 'detached', timeout: 5000 });
      check(`[142-4][142-5] ${w}px 확인 창 [저장] → 지금처럼 저장(요청 1번 · cashAmount 4,018,329 · 수량 3 · 가격 1,102,000)`,
        seen.trades.length === 1 && seen.trades[0].cashAmount === 4_018_329 && seen.trades[0].qty === 3 && seen.trades[0].price === 1_102_000 && seen.trades[0].side === 'buy', JSON.stringify(seen.trades.map((t) => t.cashAmount)));
      check(`[142-4] ${w}px 화면 오류 0(매수 창)`, errors.length === 0, errors.join(' / '));
      await ctx.close();
    }

    // ── 3. 10% 안이면 경고 없음 · 경계 ──
    {
      const { page, ctx, seen } = await open(browser, { size });
      await buy(page);
      await page.getByRole('button', { name: '금액 고치기' }).click();
      const field = page.getByRole('textbox', { name: '예수금에서 빠질 금액' });
      const gapCount = () => page.getByTestId('asset-cash-trade-gap').count();
      await field.fill('3600000');
      const in1 = (await gapCount()) === 0;
      await field.fill('3636600'); // 정확히 10% — 넘지 않음
      const in2 = (await gapCount()) === 0;
      await field.fill('2975400'); // 아래로 정확히 10%
      const in3 = (await gapCount()) === 0;
      check(`[142-3] ${w}px 10% 안(3,600,000 · 정확히 +10% 3,636,600 · −10% 2,975,400)이면 노란 경고 없음`, in1 && in2 && in3);
      await field.fill('3636601');
      const over1 = (await gapCount()) === 1;
      await field.fill('2975399');
      const over2 = (await gapCount()) === 1 && ((await page.getByTestId('asset-cash-trade-gap').textContent()) ?? '').startsWith('계산 값 ₩3,306,000 과 ₩330,601 차이 나요');
      await field.fill('0');
      const zero = (await gapCount()) === 0;
      check(`[142-3] ${w}px 10% 넘으면(위 · 아래) 노란 경고 · 0(예수금 안 바꿈)은 경고 대신 안내`, over1 && over2 && zero);
      await page.getByRole('button', { name: '계산 값으로' }).click();
      check(`[142-3] ${w}px [계산 값으로] → 경고 사라짐`, (await gapCount()) === 0);
      // 계산 값 그대로 · 남는 예수금 플러스 → 확인 창 없이 바로 저장(141차와 같은 값)
      await page.getByRole('button', { name: '저장' }).click();
      await page.getByRole('dialog', { name: '매수 입력' }).waitFor({ state: 'detached', timeout: 5000 });
      check(`[142-4][142-5] ${w}px 마이너스가 아니면 확인 창 없이 지금처럼 저장(cashAmount = 계산 값 3,306,000)`,
        seen.trades.length === 1 && seen.trades[0].cashAmount === REAL.auto && (await page.getByRole('dialog', { name: '예수금이 마이너스가 됩니다' }).count()) === 0);
      await ctx.close();
    }

    // ── 4. balance null 이면 확인 창 없음 · 매도는 남는 예수금 · 확인 창 없음 ──
    {
      const { page, ctx, seen } = await open(browser, { size, pair: { enabled: true, pair: { key: KIWOOM, label: KIWOOM_LABEL }, usdKrw: 1380.5, balance: null } });
      await buy(page);
      check(`[142-4] ${w}px balance null → 한 줄에 남는 예수금 없음(141차 문장 그대로)`, (await preview(page)).startsWith(`${KIWOOM_LABEL}에서 ₩3,306,000 빠집니다`) && (await page.getByTestId('asset-cash-trade-left').count()) === 0, await preview(page));
      await page.getByRole('button', { name: '금액 고치기' }).click();
      await page.getByRole('textbox', { name: '예수금에서 빠질 금액' }).fill('9000000');
      await page.getByRole('button', { name: '저장' }).click();
      await page.getByRole('dialog', { name: '매수 입력' }).waitFor({ state: 'detached', timeout: 5000 });
      check(`[142-4] ${w}px balance null → 큰 금액이어도 확인 창 없이 지금처럼 저장(cashAmount 9,000,000)`, seen.trades.length === 1 && seen.trades[0].cashAmount === 9_000_000);
      await ctx.close();
    }
    {
      const { page, ctx, seen } = await open(browser, { size, pair: { enabled: true, pair: { key: KIWOOM, label: KIWOOM_LABEL }, usdKrw: 1380.5, balance: -50_000 } });
      await page.getByRole('button', { name: '예시 국내 대형주 매도 입력' }).first().click();
      await page.getByTestId('asset-cash-trade').waitFor({ timeout: 5000 });
      await page.getByRole('textbox', { name: '수량' }).fill('1');
      await page.getByRole('textbox', { name: '가격' }).fill('72000');
      await page.getByTestId('asset-cash-trade-preview').waitFor({ timeout: 5000 });
      check(`[142-4] ${w}px 매도 → 「…에 ₩72,000 들어갑니다」 그대로 · 남는 예수금 없음`, (await preview(page)).startsWith(`${KIWOOM_LABEL}에 ₩72,000 들어갑니다`) && (await page.getByTestId('asset-cash-trade-left').count()) === 0);
      await page.getByRole('button', { name: '저장' }).click();
      await page.getByRole('dialog', { name: '매도 입력' }).waitFor({ state: 'detached', timeout: 5000 });
      check(`[142-4] ${w}px 매도는 예수금이 마이너스여도 확인 창 없음 · 지금처럼 저장(cashAmount 72,000)`, seen.trades.length === 1 && seen.trades[0].cashAmount === 72_000);
      await ctx.close();
    }
  }

  // 새 종목 매수 창도 같은 확인 함수를 [저장] 앞에서 부른다(창 모양 · 검색 흐름은 assettradeui 시험)
  const nb = fs.readFileSync(path.join(root, 'src/components/asset/AssetNewBuyDialog.tsx'), 'utf8');
  const td = fs.readFileSync(path.join(root, 'src/components/asset/AssetTradeDialog.tsx'), 'utf8');
  check('[142-4] 새 종목 매수 · 매수 · 매도 창 [저장] 이 같은 askCashMinus 를 거침', /onClick=\{\(\) => askCashMinus\(cash, \(\) => void save\(\)\)\}/.test(nb) && /askCashMinus\(cash, \(\) => void save\(\)\)/.test(td));
} catch (e) {
  fail++;
  console.log(`FAIL  시험 중 예외 — ${(e as Error).message.split('\n')[0]}`);
} finally {
  await browser.close().catch(() => {});
  await vite.close().catch(() => {});
}
console.log(`\n${pass} 통과 · ${fail} 실패`);
process.exit(fail ? 1 : 0);
