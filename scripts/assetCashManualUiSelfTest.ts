/**
 * 직접 입출금 화면 시험(143차 · v2.72.0) — `npm run assetcashmanualui:test` · ⚠️ `DB_PATH=<사본>` 으로만 돈다(맨 첫 import).
 * 143차 「꼭 지킬 동작」 6(화면 — 1280 × 1080 · 1440 × 900)을 줄마다 확인한다: 계좌 머리 · 「현금 합계」 상품 줄 [입출금] · 처음 계좌 ·
 * 세 가지 바꾸기 · 지금 → 바뀐 뒤 금액 · 마이너스 확인 창 · 잠김 · 쓰기 꺼짐 때 꺼짐 · 저장 뒤 금액 바로 바뀜 · 반영 기록 「이체 / 입금 / 출금 + 메모」 · 로딩 · 넘침 0 · 처음 빨간 표시 0.
 * 1 ~ 5 · 7 · 8(서버)은 `assetcashmanual:test`.
 * Vite + Playwright, `/api` 는 모두 `page.route` 가짜(만든 값) — 구글 · 토스 · 서버 호출 0. 요소는 역할 + 이름 · `data-testid` 로 찾는다.
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import 'dotenv/config';
import path from 'node:path';
import { chromium, type Browser, type Page, type Route } from 'playwright';
import { CASH_SAMPLE_KIWOOM as KIWOOM, assetHistorySample, assetSheetSample, assetStatusSample, assetSummarySample, cashViewManualSample, cashViewSample } from './fixtures/asset/screenSample';
import { createBrowserStepGuard } from './lib/browserStepGuard';
import type { AssetCashManualRequest, AssetCashManualResult, AssetSheetCashBanks, AssetSheetData } from '../src/types/asset';

const root = path.resolve(import.meta.dirname, '..');
const PORT = 5187;
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

/** 시트 응답 — 「현금」 탭에 키움 줄(9행)을 더하고 짝 설정(개별 투자 = 키움) */
function sheet(kiwoom = 694_000): AssetSheetData & AssetSheetCashBanks {
  const s = assetSheetSample();
  return { ...s, cashAccounts: [...s.cashAccounts, { row: 9, name: KIWOOM.name, amount: kiwoom }], cashDepositPairs: { '개별 투자': KIWOOM }, cashBankFix: { rows: {}, renames: {} } };
}

interface Opts {
  size: { width: number; height: number };
  writeEnabled?: boolean;
  /** 저장 응답 — 'ok' 기본 · 'fail' 409 · 'hold' 풀 때까지 기다림 · 'check' 다시 확인 필요 · 'abort' 연결 끊김 */
  save?: 'ok' | 'fail' | 'hold' | 'check' | 'abort';
  locked?: boolean;
  settingsMenu?: boolean;
}

const record = (req: AssetCashManualRequest, status: AssetCashManualResult['move']['status'] = 'applied'): AssetCashManualResult => ({
  move: { id: 41, at: '2026-11-17T01:00:00.000Z', kind: req.kind, label: req.memo ?? '', month: '2026-11', day: '2026-11-17', from: req.from, to: req.to, amount: req.amount, status, reason: status === 'check' ? 'write-failed' : null, undoneAt: null },
  after: { from: null, to: null },
  duplicate: false,
});

async function open(browser: Browser, o: Opts) {
  const ctx = await browser.newContext({ viewport: o.size });
  await ctx.addInitScript((menu) => {
    localStorage.setItem('alphascope.asset.tab', 'status');
    localStorage.setItem('alphascope.asset.statusView', 'account');
    if (menu) localStorage.setItem('alphascope.asset.settingsMenu', 'cash');
  }, o.settingsMenu ?? false);
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)));
  const seen = { posts: [] as AssetCashManualRequest[], sheetCalls: 0, undos: 0 };
  let release = () => {};
  const held = new Promise<void>((ok) => (release = ok));
  let kiwoomNow = 694_000;
  await page.route(/\/api\/(?!asset\/)/, (r) => (r.request().url().includes('/api/auth/me') ? r.fulfill({ json: { ok: true } }) : r.fulfill({ status: 503, json: { error: '시험 — 없음' } })));
  await page.route('**/api/asset/status', (r) => r.fulfill({ json: assetStatusSample(!o.locked) }));
  await page.route('**/api/asset/touch', (r) => r.fulfill({ json: { ok: true, lockMinutes: 30, remainingMs: 30 * 60_000 } }));
  await page.route('**/api/asset/sheet', (r) => {
    seen.sheetCalls++;
    return r.fulfill({ json: sheet(kiwoomNow) });
  });
  await page.route('**/api/asset/summary**', (r) => r.fulfill({ json: assetSummarySample({ purchaseDone: true, writeEnabled: o.writeEnabled ?? true }) }));
  await page.route('**/api/asset/history**', (r) => r.fulfill({ json: assetHistorySample(5) }));
  await page.route('**/api/asset/cash', (r) => r.fulfill({ json: cashViewManualSample() }));
  await page.route('**/api/asset/cash/undo', (r) => {
    seen.undos++;
    return r.fulfill({ json: cashViewSample({ enabled: false }) });
  });
  await page.route('**/api/asset/cash/manual', async (r: Route) => {
    const req = JSON.parse(r.request().postData() ?? '{}') as AssetCashManualRequest;
    seen.posts.push(req);
    if (o.save === 'hold') await held;
    if (o.save === 'abort' && seen.posts.length === 1) return r.abort('connectionreset');
    if (o.save === 'fail') return r.fulfill({ status: 409, json: { error: '쓰지 않았어요 — 「현금」 탭에서 계좌를 찾지 못함(시트 「현금」 탭을 확인한 뒤 다시 해 주세요).', kind: 'sheet-changed' } });
    if (o.save === 'check') return r.fulfill({ json: record(req, 'check') });
    if (req.to?.name === KIWOOM.name) kiwoomNow += req.amount;
    if (req.from?.name === KIWOOM.name) kiwoomNow -= req.amount;
    return r.fulfill({ json: record(req) });
  });
  await guard.step('페이지 열기(#/asset)', () => page.goto(`${WEB}/#/asset`));
  if (!o.locked) await guard.step('자산 화면 기다리기', () => page.locator('[data-account-cards]').waitFor({ timeout: 30_000 }));
  return { page, ctx, errors, seen, release };
}


const dialog = (page: Page) => page.getByRole('dialog', { name: '입출금' });
const noRed = async (page: Page) => (await page.locator('[data-field-error]').count()) === 0 && (await page.locator('[aria-invalid="true"]').count()) === 0;
const noOverflow = (page: Page) =>
  page.evaluate(() => {
    const d = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')];
    const inner = d.flatMap((x) => [...x.querySelectorAll<HTMLElement>('[data-testid="asset-cash-move-accounts"], [data-cash-move-change], table')]).filter((el) => el.scrollWidth > el.clientWidth + 1).length;
    return document.documentElement.scrollWidth <= window.innerWidth + 1 && d.every((x) => x.scrollWidth <= x.clientWidth + 1) && inner === 0;
  });
const textOf = async (page: Page, testid: string) => ((await page.locator(`[data-cash-move-change="${testid}"]`).textContent()) ?? '').replace(/\s+/g, ' ').trim();
const pickerValue = (page: Page, name: string) => dialog(page).getByRole('button', { name, exact: true }).getAttribute('data-picker-value');
async function pick(page: Page, picker: string, group: string, option: string) {
  await dialog(page).getByRole('button', { name: picker, exact: true }).click();
  const list = page.getByRole('listbox', { name: picker });
  await list.getByRole('group', { name: group }).getByRole('option', { name: option, exact: true }).click();
}
/** 계좌 머리 [입출금](개별 투자 예수금) */
const headButton = (page: Page) => page.getByRole('button', { name: '개별 투자 ( 2026.07 ) 예수금 입출금', exact: true });

const { createServer } = await import('vite');
const vite = await guard.step('Vite 띄우기', async () => {
  const v = await createServer({ root, configFile: path.join(root, 'vite.config.ts'), logLevel: 'error', server: { host: '127.0.0.1', port: PORT, strictPort: true, hmr: false } });
  await v.listen();
  return v;
});
const browser = await guard.step('브라우저 띄우기', () => chromium.launch({ channel: 'chrome' }));
try {
  for (const size of [{ width: 1280, height: 1080 }, { width: 1440, height: 900 }]) {
    const w = size.width;

    // ── 계좌 머리 [입출금] · 창 · 세 가지 · 금액 · 저장 뒤 바로 바뀜 ──
    {
      const { page, ctx, errors, seen } = await open(browser, { size });
      const head = page.locator('tbody[data-account="개별 투자"] th[data-account-head]');
      check(`[143-6] ${w}px 계좌 머리 「예수금 ₩694,000」 옆 [입출금] 하나(짝 있는 계좌만)`, (await headButton(page).count()) === 1 && (await page.locator('th[data-account-head]').getByTestId('asset-cash-move-open').count()) === 1 && ((await head.textContent()) ?? '').includes('예수금 ₩694,000'));
      const headOk = await head.evaluate((th) => th.scrollWidth <= th.clientWidth + 1);
      check(`[143-6] ${w}px 머리 넘침 0 · 화면 가로 넘침 0`, headOk && (await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)));
      const expanded = await head.getAttribute('aria-expanded');
      await headButton(page).click();
      await dialog(page).waitFor({ timeout: 5000 });
      check(`[143-6] ${w}px [입출금] 을 눌러도 계좌 카드는 접히지 않음(머리 줄 누름과 따로)`, (await head.getAttribute('aria-expanded')) === expanded);
      check(`[143-6] ${w}px 창 「입출금」 — 처음 = 이체 · 들어가는 계좌 처음 값 = 그 예수금(키움) · 빠지는 계좌 비어 있음`,
        (await dialog(page).getByRole('radio', { name: '이체' }).getAttribute('aria-checked')) === 'true' && (await pickerValue(page, '들어가는 계좌'))?.startsWith(KIWOOM.name) === true && (await pickerValue(page, '빠지는 계좌')) === '');
      check(`[143-6] ${w}px 처음 열 때 빨간 표시 0`, await noRed(page));
      check(`[143-6] ${w}px 들어가는 계좌 아래 지금 금액 「₩694,000」`, (await textOf(page, 'to')) === '₩694,000', await textOf(page, 'to'));
      await pick(page, '빠지는 계좌', '예시은행', '입출금 #1');
      await page.getByRole('textbox', { name: '금액' }).fill('500000');
      check(`[143-6] ${w}px 이체 — 「예시은행 ₩500,000,000 → ₩499,500,000」 · 「키움 ₩694,000 → ₩1,194,000」`,
        (await textOf(page, 'from')) === '₩500,000,000₩499,500,000' && (await textOf(page, 'to')) === '₩694,000₩1,194,000', `${await textOf(page, 'from')} / ${await textOf(page, 'to')}`);
      check(`[143-6] ${w}px 창 넘침 0(이체)`, await noOverflow(page));
      await dialog(page).getByRole('radio', { name: '입금' }).click();
      check(`[143-6] ${w}px 입금 — 「밖에서 → [들어가는 계좌]」 · 빠지는 계좌 칸 없음 · 키움 ₩694,000 → ₩1,194,000`,
        ((await dialog(page).locator('[data-cash-move-outside]').textContent()) ?? '') === '밖에서' && (await dialog(page).getByRole('button', { name: '빠지는 계좌', exact: true }).count()) === 0 && (await textOf(page, 'to')) === '₩694,000₩1,194,000');
      await dialog(page).getByRole('radio', { name: '출금' }).click();
      check(`[143-6] ${w}px 출금 — 「[빠지는 계좌] → 밖으로」 · 고른 계좌 그대로 · ₩500,000,000 → ₩499,500,000`,
        ((await dialog(page).locator('[data-cash-move-outside]').textContent()) ?? '') === '밖으로' && (await dialog(page).getByRole('button', { name: '들어가는 계좌', exact: true }).count()) === 0 && (await textOf(page, 'from')) === '₩500,000,000₩499,500,000');
      check(`[143-6] ${w}px 창 넘침 0(출금)`, await noOverflow(page), JSON.stringify(await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[role="dialog"] *')].filter((el) => el.scrollWidth > el.clientWidth + 1).slice(0, 4).map((el) => [el.tagName, el.className.slice(0, 80), el.scrollWidth, el.clientWidth, (el.textContent ?? '').slice(0, 30)]))));
      await dialog(page).getByRole('radio', { name: '이체' }).click();
      await page.getByRole('textbox', { name: '메모' }).fill('보너스');
      const sheetBefore = seen.sheetCalls;
      await dialog(page).getByRole('button', { name: '저장' }).click();
      await dialog(page).waitFor({ state: 'detached', timeout: 5000 });
      await page.waitForTimeout(300);
      const p = seen.posts[0];
      check(`[143-6] ${w}px [저장] → 요청 1번(이체 · 예시은행 #1 → 키움 · 500,000 · 메모 · 요청 번호 · 같은 이름 줄 수 of)`,
        seen.posts.length === 1 && p.kind === 'transfer' && p.from?.name === '예시은행' && p.from.nth === 1 && p.from.of === 2 && p.to?.name === KIWOOM.name && p.amount === 500_000 && p.memo === '보너스' && /^[A-Za-z0-9_-]{8,64}$/.test(p.requestId), JSON.stringify({ ...p, from: p?.from?.nth, to: null }));
      check(`[143-6] ${w}px 저장 뒤 시트 다시 읽기 1번 → 계좌 머리 예수금 바로 「₩1,194,000」`, seen.sheetCalls === sheetBefore + 1 && ((await page.locator('tbody[data-account="개별 투자"] [data-account-deposit-amount]').textContent()) ?? '') === '₩1,194,000', `${seen.sheetCalls}`);
      check(`[143-6] ${w}px 화면 오류 0`, errors.length === 0, errors.join(' / '));
      await ctx.close();
    }

    // ── 「현금 합계」 상품 줄 [입출금] · 처음 값 = 그 줄 ──
    {
      const { page, ctx } = await open(browser, { size });
      await page.getByTestId('asset-cash-toggle').click();
      await page.getByRole('button', { name: '예시은행 상품 펼치기' }).click();
      const rows = page.locator('[data-testid="asset-cash-bank"] tr[data-cash-row]');
      const count = await rows.count();
      const withButton = await rows.getByTestId('asset-cash-move-open').count();
      check(`[143-6] ${w}px 「현금 합계」 펼침 상품 줄마다 [입출금](예시은행 ${count}줄 · 은행 합계 줄에는 없음)`, count === 3 && withButton === 3 && (await page.locator('[data-testid="asset-cash-bank"] tr[data-cash-bank]').getByTestId('asset-cash-move-open').count()) === 0);
      const tableOk = await page.getByTestId('asset-cash-bank').evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
      check(`[143-6] ${w}px 상품 줄 넘침 0`, tableOk && (await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)));
      await page.getByRole('button', { name: '예시은행 · 청년 적금 26.11.16 ~ 29.11.16 입출금', exact: true }).click();
      await dialog(page).waitFor({ timeout: 5000 });
      check(`[143-6] ${w}px 상품 줄 [입출금] — 빠지는 계좌 처음 값 = 그 줄 · 들어가는 계좌 비어 있음 · 지금 금액 ₩34,567,890`,
        (await pickerValue(page, '빠지는 계좌'))?.startsWith('예시은행 (청년 적금') === true && (await pickerValue(page, '들어가는 계좌')) === '' && (await textOf(page, 'from')) === '₩34,567,890');
      // 입금으로 바꾸면 그 줄이 들어가는 계좌로
      await dialog(page).getByRole('radio', { name: '입금' }).click();
      check(`[143-6] ${w}px 상품 줄에서 입금으로 바꾸면 그 줄이 들어가는 계좌`, (await pickerValue(page, '들어가는 계좌'))?.startsWith('예시은행 (청년 적금') === true);
      // 빨간 표시 — [저장] 을 누른 뒤에만
      await dialog(page).getByRole('radio', { name: '이체' }).click();
      check(`[143-6] ${w}px 금액 · 계좌가 비어도 [저장] 전에는 빨간 표시 0 · [저장] 꺼짐`, (await noRed(page)) && (await dialog(page).getByRole('button', { name: '저장' }).isDisabled()));
      await dialog(page).getByRole('button', { name: '저장' }).click({ force: true });
      check(`[143-6] ${w}px [저장] 을 누른 뒤 빨간 표시(금액 · 계좌) — 메모는 선택 칸이라 없음`, (await dialog(page).locator('[data-field-error]').count()) === 2 && (await page.getByRole('textbox', { name: '메모' }).getAttribute('aria-invalid')) == null, `${await dialog(page).locator('[data-field-error]').count()}`);
      // 같은 계좌 이체
      await pick(page, '들어가는 계좌', '예시은행', '청년 적금 26.11.16 ~ 29.11.16');
      await page.getByRole('textbox', { name: '금액' }).fill('1000');
      check(`[143-6] ${w}px 같은 계좌 이체 → 「빠지는 계좌와 들어가는 계좌가 같아요」 · [저장] 꺼짐`, ((await dialog(page).locator('[data-field-error]').allTextContents()).join()).includes('빠지는 계좌와 들어가는 계좌가 같아요') && (await dialog(page).getByRole('button', { name: '저장' }).isDisabled()));
      await ctx.close();
    }

    // ── 마이너스 확인 창 ──
    {
      const { page, ctx, seen } = await open(browser, { size });
      await headButton(page).click();
      await dialog(page).getByRole('radio', { name: '출금' }).click();
      check(`[143-6] ${w}px 예수금 머리에서 출금으로 바꾸면 빠지는 계좌 = 그 예수금`, (await pickerValue(page, '빠지는 계좌'))?.startsWith(KIWOOM.name) === true);
      await page.getByRole('textbox', { name: '금액' }).fill('1000000');
      check(`[143-6] ${w}px 바뀐 뒤 마이너스는 하락 색 「−₩306,000」`, (await textOf(page, 'from')) === '₩694,000−₩306,000');
      await dialog(page).getByRole('button', { name: '저장' }).click();
      const confirm = page.getByRole('dialog', { name: '계좌 금액이 마이너스가 됩니다' });
      await confirm.waitFor({ timeout: 5000 });
      check(`[143-6] ${w}px [저장] → 확인 창 「저장하면 예시키움 · 투자 계좌 예수금이 −₩306,000 가 됩니다. 그래도 저장할까요?」 · 요청 아직 0`,
        ((await confirm.textContent()) ?? '').includes('저장하면 예시키움 · 투자 계좌 예수금이 −₩306,000 가 됩니다. 그래도 저장할까요?') && seen.posts.length === 0, (await confirm.textContent()) ?? '');
      check(`[143-6] ${w}px 확인 창 넘침 0`, await noOverflow(page));
      await confirm.getByRole('button', { name: '취소' }).click();
      await confirm.waitFor({ state: 'detached', timeout: 5000 });
      check(`[143-6] ${w}px [취소] → 요청 0 · 창 그대로`, seen.posts.length === 0 && (await dialog(page).count()) === 1 && (await page.getByRole('textbox', { name: '금액' }).inputValue()) === '1,000,000');
      await dialog(page).getByRole('button', { name: '저장' }).click();
      await confirm.waitFor({ timeout: 5000 });
      await confirm.getByRole('button', { name: '저장' }).click();
      await dialog(page).waitFor({ state: 'detached', timeout: 5000 });
      check(`[143-6] ${w}px 확인 창 [저장] → 요청 1번(출금 · 키움 · 1,000,000 · 들어가는 계좌 없음)`, seen.posts.length === 1 && seen.posts[0].kind === 'withdraw' && seen.posts[0].to === null && seen.posts[0].amount === 1_000_000);
      await ctx.close();
    }

    // ── 로딩 · 두 번 누름 · 실패 · 끊김 뒤 같은 번호 · 다시 확인 필요 ──
    {
      const { page, ctx, seen, release } = await open(browser, { size, save: 'hold' });
      await headButton(page).click();
      await dialog(page).getByRole('radio', { name: '입금' }).click();
      await page.getByRole('textbox', { name: '금액' }).fill('200000');
      const save = dialog(page).getByRole('button', { name: '저장' });
      await save.click();
      await page.waitForTimeout(200);
      check(`[143-6] ${w}px 저장 중 — [저장] 로딩(aria-busy) · 꺼짐 · 칸 꺼짐`, (await save.getAttribute('aria-busy')) === 'true' && (await save.isDisabled()) && (await page.getByRole('textbox', { name: '금액' }).isDisabled()));
      await save.click({ force: true });
      await save.dblclick({ force: true });
      release();
      await dialog(page).waitFor({ state: 'detached', timeout: 5000 });
      check(`[143-6] ${w}px 저장 중 두 번 · 세 번 눌러도 요청 1번`, seen.posts.length === 1);
      await ctx.close();
    }
    {
      const { page, ctx, seen } = await open(browser, { size, save: 'fail' });
      await headButton(page).click();
      await dialog(page).getByRole('radio', { name: '입금' }).click();
      await page.getByRole('textbox', { name: '금액' }).fill('200000');
      await dialog(page).getByRole('button', { name: '저장' }).click();
      await dialog(page).getByTestId('asset-cash-move-error').waitFor({ timeout: 5000 });
      check(`[143-6] ${w}px 실패 → 창 그대로 + 까닭(빨간 상자) · 입력 그대로`, (await dialog(page).count()) === 1 && ((await dialog(page).getByTestId('asset-cash-move-error').textContent()) ?? '').includes('찾지 못함') && (await page.getByRole('textbox', { name: '금액' }).inputValue()) === '200,000' && seen.posts.length === 1);
      check(`[143-6] ${w}px 실패 안내 넘침 0`, await noOverflow(page));
      await ctx.close();
    }
    {
      const { page, ctx, seen } = await open(browser, { size, save: 'abort' });
      await headButton(page).click();
      await dialog(page).getByRole('radio', { name: '입금' }).click();
      await page.getByRole('textbox', { name: '금액' }).fill('200000');
      await dialog(page).getByRole('button', { name: '저장' }).click();
      await dialog(page).getByTestId('asset-cash-move-error').waitFor({ timeout: 5000 });
      await dialog(page).getByRole('button', { name: '저장' }).click();
      await dialog(page).waitFor({ state: 'detached', timeout: 5000 });
      check(`[143-6] ${w}px 응답이 끊긴 뒤 같은 내용으로 다시 [저장] → 같은 요청 번호(서버가 한 번만 씀)`, seen.posts.length === 2 && seen.posts[0].requestId === seen.posts[1].requestId);
      await ctx.close();
    }
    {
      const { page, ctx, seen } = await open(browser, { size, save: 'abort' });
      await headButton(page).click();
      await dialog(page).getByRole('radio', { name: '입금' }).click();
      await page.getByRole('textbox', { name: '금액' }).fill('200000');
      await dialog(page).getByRole('button', { name: '저장' }).click();
      await dialog(page).getByTestId('asset-cash-move-error').waitFor({ timeout: 5000 });
      await page.getByRole('textbox', { name: '금액' }).fill('210000');
      await dialog(page).getByRole('button', { name: '저장' }).click();
      await dialog(page).waitFor({ state: 'detached', timeout: 5000 });
      check(`[143-6] ${w}px 금액을 바꿔 다시 [저장] → 새 요청 번호`, seen.posts.length === 2 && seen.posts[0].requestId !== seen.posts[1].requestId);
      await ctx.close();
    }
    {
      const { page, ctx, seen } = await open(browser, { size, save: 'check' });
      await headButton(page).click();
      await dialog(page).getByRole('radio', { name: '입금' }).click();
      await page.getByRole('textbox', { name: '금액' }).fill('200000');
      await dialog(page).getByRole('button', { name: '저장' }).click();
      await dialog(page).getByTestId('asset-cash-move-unsure').waitFor({ timeout: 5000 });
      check(`[143-6] ${w}px 「다시 확인 필요」 → 노란 안내 + [닫기] 만([저장] 없음)`, (await dialog(page).getByRole('button', { name: '저장' }).count()) === 0 && (await dialog(page).getByRole('button', { name: '닫기' }).count()) >= 1);
      const before = seen.sheetCalls;
      await dialog(page).getByTestId('asset-cash-move-close').click();
      await dialog(page).waitFor({ state: 'detached', timeout: 5000 });
      await page.waitForTimeout(300);
      check(`[143-6] ${w}px [닫기] → 시트 다시 읽기`, seen.sheetCalls === before + 1);
      await ctx.close();
    }

    // ── 시트 쓰기 꺼짐 · 잠김 ──
    {
      const { page, ctx } = await open(browser, { size, writeEnabled: false });
      await page.waitForTimeout(300);
      const off = page.locator('th[data-account-head] [data-testid="asset-cash-move-off"]');
      check(`[143-6] ${w}px 시트 쓰기 꺼짐 → [입출금] 꺼짐 + 툴팁 「이 서버에서는 시트 쓰기가 꺼져 있어요」`, (await headButton(page).isDisabled()) && (await off.getAttribute('data-tip')) === '이 서버에서는 시트 쓰기가 꺼져 있어요');
      await ctx.close();
    }
    {
      const { page, ctx } = await open(browser, { size, locked: true });
      await page.getByRole('heading', { name: /잠/ }).or(page.getByRole('textbox')).first().waitFor({ timeout: 30_000 });
      check(`[143-6] ${w}px 잠김 → 자산 화면 대신 잠금 화면 · 누를 수 있는 [입출금] 0`, (await page.getByTestId('asset-cash-move-open').count()) === 0 && (await page.locator('[data-account-cards]').count()) === 0);
      await ctx.close();
    }
    {
      // 잠금 시간이 지나 summary 가 잠김을 돌려준 순간(자산 화면이 아직 남은 사이) — 꺼짐 + 툴팁
      const src = (await import('node:fs')).readFileSync(path.join(root, 'src/components/asset/AssetSheetValues.tsx'), 'utf8');
      check('[143-6] 잠김 판단 → 꺼짐 + 툴팁 「잠금을 풀면 쓸 수 있어요」(화면 코드)', src.includes("g.locked ? '잠금을 풀면 쓸 수 있어요'") && src.includes('disabled={off != null}'));
    }

    // ── 반영 기록 ──
    {
      const { page, ctx, errors, seen } = await open(browser, { size, settingsMenu: true });
      await page.getByLabel('설정', { exact: true }).click();
      await page.getByTestId('asset-cash-settings').waitFor({ timeout: 10_000 });
      const rows = page.getByTestId('asset-cash-move-row');
      const text = async (i: number) => ((await rows.nth(i).textContent()) ?? '').replace(/\s+/g, ' ');
      const [t0, t1, t2] = [await text(0), await text(1), await text(2)];
      check(`[143-6] ${w}px 반영 기록 「무엇」 — 「이체 · 보너스」 · 「입금」(메모 없음) · 「출금 · 여행 경비」`, t0.includes('이체 · 보너스') && /입금(?! ·)/.test(t1) && t2.includes('출금 · 여행 경비'), `${t0} | ${t1} | ${t2}`);
      check(`[143-6] ${w}px 「어디서 → 어디로」 — 이체 은행 → 은행 · 입금 「밖에서 → …」 · 출금 「… → 밖으로」`, t0.includes('예시국민 → 예시키움') && t1.includes('밖에서 → 예시키움') && t2.includes('예시국민 → 밖으로'), `${t0} | ${t1} | ${t2}`);
      const undo = rows.nth(0).getByRole('button', { name: '되돌리기' });
      check(`[143-6] ${w}px 「현금 자동 반영」 이 꺼져 있어도 직접 입출금 [되돌리기] 켬 · 매수 줄은 지금처럼 꺼짐`, (await undo.isEnabled()) && (await rows.nth(3).getByRole('button', { name: '되돌리기' }).isDisabled()));
      await undo.click();
      const confirm = page.getByRole('dialog', { name: '되돌리기' });
      await confirm.waitFor({ timeout: 5000 });
      check(`[143-6] ${w}px [되돌리기] 확인 창 「「이체 · 보너스」 ₩500,000 반영을 되돌립니다 …」`, ((await confirm.textContent()) ?? '').includes('「이체 · 보너스」 ₩500,000 반영을 되돌립니다'));
      await confirm.getByRole('button', { name: '되돌리기' }).click();
      await page.waitForTimeout(300);
      check(`[143-6] ${w}px 되돌리기 요청 1번`, seen.undos === 1);
      check(`[143-6] ${w}px 반영 기록 넘침 0 · 화면 오류 0`, (await noOverflow(page)) && errors.length === 0, errors.join(' / '));
      await ctx.close();
    }
  }
} catch (e) {
  fail++;
  console.log(`FAIL  시험 중 예외 — ${(e as Error).message.split('\n')[0]}`);
} finally {
  await browser.close().catch(() => {});
  await vite.close().catch(() => {});
}
console.log(`\n${pass} 통과 · ${fail} 실패`);
process.exit(fail ? 1 : 0);
