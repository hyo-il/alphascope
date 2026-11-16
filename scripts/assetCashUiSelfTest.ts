/**
 * 「현금 합계」 계좌별 펼침 화면 시험(138차 · v2.70.4) — `npm run assetcashui:test` · ⚠️ `DB_PATH=<사본>` 으로만 돈다(맨 첫 import).
 * 138차 「꼭 지킬 동작」 6(1280 × 1080 · 1440 × 900) — 펼침 · 계좌 줄(시트 순서 · 원 · 오른쪽 정렬 · 빈 금액 「—」 · 긴 이름 말줄임 + `data-tip-clip`) ·
 * 「연금 포함」 때만 퇴직 연금 · 합이 총액과 다르면 안내 · 넘침 0 · 로딩 표시 · 시트 오류 안내 그대로 · 펼침은 기억하지 않음.
 * Vite + Playwright, `/api` 는 모두 `page.route` 가짜(만든 값 — `fixtures/asset/screenSample.ts`) — 구글 · 토스 · 서버 호출 0. 요소는 역할 + 이름 · `data-testid` 로 찾는다.
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import 'dotenv/config';
import path from 'node:path';
import { chromium, type Browser } from 'playwright';
import { assetHistorySample, assetSheetFailureSample, assetSheetSample, assetStatusSample, assetSummarySample } from './fixtures/asset/screenSample';
import { formatAssetPrice } from '../src/utils/assetFormat';
import { createBrowserStepGuard } from './lib/browserStepGuard';

const root = path.resolve(import.meta.dirname, '..');
const PORT = 5193;
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

interface Opts {
  size: { width: number; height: number };
  pension: boolean;
  mismatch?: boolean;
  /** 시트 응답을 막아 두었다가 푼다(로딩 표시) */
  holdSheet?: boolean;
  sheetFail?: boolean;
}

async function open(browser: Browser, o: Opts) {
  const ctx = await browser.newContext({ viewport: o.size });
  await ctx.addInitScript((pension: boolean) => {
    localStorage.setItem('alphascope.asset.tab', 'status');
    localStorage.setItem('alphascope.asset.statusView', 'account');
    localStorage.setItem('alphascope.asset.includePension', pension ? '1' : '0');
  }, o.pension);
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)));
  let release = () => {};
  const gate = new Promise<void>((ok) => (release = ok));
  await page.route(/\/api\/(?!asset\/)/, (r) => (r.request().url().includes('/api/auth/me') ? r.fulfill({ json: { ok: true } }) : r.fulfill({ status: 503, json: { error: '시험 — 없음' } })));
  await page.route('**/api/asset/status', (r) => r.fulfill({ json: assetStatusSample(true) }));
  await page.route('**/api/asset/touch', (r) => r.fulfill({ json: { ok: true, lockMinutes: 30, remainingMs: 30 * 60_000 } }));
  await page.route('**/api/asset/sheet', async (r) => {
    if (o.holdSheet) await gate;
    await r.fulfill(o.sheetFail ? { status: 409, json: assetSheetFailureSample } : { json: assetSheetSample({ cashMismatch: o.mismatch }) });
  });
  await page.route('**/api/asset/summary**', (r) => r.fulfill({ json: assetSummarySample({ pension: o.pension }) }));
  await page.route('**/api/asset/history**', (r) => r.fulfill({ json: assetHistorySample(30) }));
  await guard.step('페이지 열기(#/asset)', () => page.goto(`${WEB}/#/asset`));
  return { page, ctx, errors, release };
}

const { createServer } = await import('vite');
const vite = await guard.step('Vite 띄우기', async () => {
  const v = await createServer({ root, configFile: path.join(root, 'vite.config.ts'), logLevel: 'error', server: { host: '127.0.0.1', port: PORT, strictPort: true, hmr: false } });
  await v.listen();
  return v;
});
const browser = await guard.step('브라우저 띄우기', () => chromium.launch({ channel: 'chrome' }));
const sample = assetSheetSample();
try {
  for (const size of [{ width: 1280, height: 1080 }, { width: 1440, height: 900 }]) {
    const w = size.width;
    // ── 로딩 → 펼침 · 계좌 줄 · 연금 포함 ──
    {
      const { page, ctx, errors, release } = await open(browser, { size, pension: true, holdSheet: true });
      const toggle = page.getByRole('button', { name: /^현금 합계/ });
      await page.getByRole('tab', { name: '자산 현황' }).waitFor({ timeout: 30_000 }).catch(() => {});
      await page.waitForTimeout(400);
      const skeleton = await page.locator('#as-asset-status [aria-hidden="true"]').count();
      check(`[138-6] ${w}px 시트를 받기 전 — 뼈대(로딩 표시) · 「현금 합계」 칸 · 0 · 빈 목록을 그리지 않음`, skeleton > 0 && (await toggle.count()) === 0 && (await page.getByTestId('asset-cash-accounts').count()) === 0);
      release();
      await guard.step('현금 합계 기다리기', () => toggle.waitFor({ timeout: 30_000 }));
      check(`[138-6] ${w}px 처음은 접힘(aria-expanded=false · 계좌 줄 없음)`, (await toggle.getAttribute('aria-expanded')) === 'false' && (await page.getByTestId('asset-cash-accounts').count()) === 0);
      await toggle.click();
      const list = page.getByTestId('asset-cash-accounts');
      await list.waitFor({ timeout: 5000 });
      check(`[138-6] ${w}px 누르면 펼침(aria-expanded=true · aria-controls 가 목록)`, (await toggle.getAttribute('aria-expanded')) === 'true' && (await toggle.getAttribute('aria-controls')) === (await list.getAttribute('id')));
      const bank = page.getByTestId('asset-cash-bank');
      const rows = await bank.locator('tr[data-cash-row]').evaluateAll((trs) => trs.map((tr) => ({ row: Number(tr.getAttribute('data-cash-row')), name: tr.querySelector('td span')?.textContent ?? '', amount: tr.querySelectorAll('td')[1]?.textContent ?? '' })));
      check(`[138-6] ${w}px 은행 계좌 줄 — 시트 순서 · 이름 · 금액(원 · formatAssetPrice) · 빈 금액은 「—」`,
        JSON.stringify(rows) === JSON.stringify(sample.cashAccounts.map((r) => ({ row: r.row, name: r.name, amount: formatAssetPrice(r.amount, 'KRW') }))) && rows.at(-1)?.amount === '—', JSON.stringify(rows.map((r) => r.amount)));
      const layout = await list.evaluate((el) => {
        const nums = [...el.querySelectorAll('tr[data-cash-row] td:nth-child(2)')] as HTMLElement[];
        const names = [...el.querySelectorAll('tr[data-cash-row] td:first-child span')] as HTMLElement[];
        const panel = el.closest('section,div[class*="rounded"]') as HTMLElement | null;
        const rights = nums.map((n) => Math.round(n.getBoundingClientRect().right));
        const clipped = names.filter((n) => n.scrollWidth > n.clientWidth + 1);
        const box = el.getBoundingClientRect();
        const pb = panel?.getBoundingClientRect();
        return {
          align: nums.every((n) => getComputedStyle(n).textAlign === 'right'),
          sameRight: new Set(rights).size === 1,
          clipped: clipped.length,
          clipTip: clipped.every((n) => (n.getAttribute('data-tip-clip') ?? '') === n.textContent),
          numFits: nums.every((n) => n.scrollWidth <= n.clientWidth + 1),
          inPanel: pb == null || (box.left >= pb.left - 0.5 && box.right <= pb.right + 0.5),
          pageX: document.documentElement.scrollWidth <= document.documentElement.clientWidth,
        };
      });
      check(`[138-6] ${w}px 금액 오른쪽 정렬 · 오른쪽 끝이 한 줄로 맞음`, layout.align && layout.sameRight, JSON.stringify(layout));
      check(`[138-6] ${w}px 긴 이름은 말줄임 + data-tip-clip(잘린 글 전체) · 금액 칸은 잘리지 않음`, layout.clipped >= 1 && layout.clipTip && layout.numFits, JSON.stringify(layout));
      check(`[138-6] ${w}px 넘침 0(목록이 카드 안 · 페이지 가로 스크롤 없음)`, layout.inPanel && layout.pageX, JSON.stringify(layout));
      const retire = page.getByTestId('asset-cash-retirement');
      check(`[138-6] ${w}px 「연금 포함」 켬 → 「퇴직 연금」 소제목 · 퇴직 연금 줄`, (await retire.count()) === 1 && (await retire.getByText('퇴직 연금', { exact: true }).count()) === 1
        && (await retire.locator('tr[data-cash-row]').count()) === sample.retirementAccounts.length);
      check(`[138-6] ${w}px 합이 총액과 같으면 안내 없음`, (await page.getByTestId('asset-cash-bank-mismatch').count()) === 0 && (await page.getByTestId('asset-cash-retirement-mismatch').count()) === 0);
      await toggle.click();
      check(`[138-6] ${w}px 다시 누르면 접힘`, (await toggle.getAttribute('aria-expanded')) === 'false' && (await list.count()) === 0);
      await toggle.click();
      await page.reload();
      await guard.step('다시 열기', () => toggle.waitFor({ timeout: 30_000 }));
      check(`[138-6] ${w}px 펼침은 기억하지 않음(새로 열면 접힘)`, (await toggle.getAttribute('aria-expanded')) === 'false');
      check(`[138-6] ${w}px 페이지 오류 0`, errors.length === 0, errors.join(' | '));
      await ctx.close();
    }
    // ── 연금 포함 끔 · 합 다름 ──
    {
      const { page, ctx } = await open(browser, { size, pension: false, mismatch: true });
      const toggle = page.getByRole('button', { name: /^현금 합계/ });
      await guard.step('현금 합계 기다리기', () => toggle.waitFor({ timeout: 30_000 }));
      await toggle.click();
      await page.getByTestId('asset-cash-accounts').waitFor({ timeout: 5000 });
      check(`[138-6] ${w}px 「연금 포함」 끔 → 퇴직 연금 줄 없음 · 은행 계좌는 그대로`, (await page.getByTestId('asset-cash-retirement').count()) === 0 && (await page.getByTestId('asset-cash-bank').locator('tr[data-cash-row]').count()) === sample.cashAccounts.length);
      const note = page.getByTestId('asset-cash-bank-mismatch');
      check(`[138-6] ${w}px 계좌 합이 총액과 다르면 작은 안내 「계좌 합이 총액과 달라요 — 시트 합계 식을 확인해 주세요」`, (await note.count()) === 1 && ((await note.textContent()) ?? '').includes('계좌 합이 총액과 달라요 — 시트 합계 식을 확인해 주세요'));
      check(`[138-6] ${w}px 합이 달라도 「현금 합계」 숫자는 시트 총액 그대로`, ((await toggle.textContent()) ?? '').includes(formatAssetPrice(sample.cashTotal, 'KRW')));
      await ctx.close();
    }
    // ── 시트 오류 — 지금 오류 안내 그대로 ──
    {
      const { page, ctx } = await open(browser, { size, pension: true, sheetFail: true });
      const alert = page.getByRole('alert').filter({ hasText: '시트 모양이 바뀌었어요' });
      await guard.step('오류 기다리기', () => alert.waitFor({ timeout: 30_000 }));
      check(`[138-6] ${w}px 시트 오류 → 오류 안내 + [다시 시도] · 「현금 합계」 칸 없음`, (await alert.getByRole('button', { name: '다시 시도' }).count()) === 1 && (await page.getByRole('button', { name: /^현금 합계/ }).count()) === 0);
      await ctx.close();
    }
  }
} finally {
  await guard.step('브라우저 닫기', () => browser.close());
  await guard.step('Vite 닫기', () => vite.close());
  guard.stop();
}

console.log(`\n「현금 합계」 펼침 화면 시험 — ${pass} 통과 · ${fail} 실패`);
process.exit(fail ? 1 : 0);
