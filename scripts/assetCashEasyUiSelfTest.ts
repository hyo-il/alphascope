/**
 * 현금 자동 반영 설정 쉽게 화면 시험(140차 · v2.71.1) — `npm run assetcasheasyui:test` · ⚠️ `DB_PATH=<사본>` 으로만 돈다(맨 첫 import).
 * 140차 「꼭 지킬 동작」 3(설정 화면 1280 × 1080 · 1440 × 900 — 월급 카드 맨 위 · 출처 글 · 퍼지는 모양 · 화살표 문장 · 빠지는 계좌 기본 · 「모두 적용」 ·
 * 고르는 칸 은행별 묶음 · 「줄」 · 「출금」 · 「입금」 0 · 넘침 0 · 로딩) · 7(매수 창 · 「현금 합계」 — 은행 · 상품 이름 · 은행별 합 = 상품 합).
 * Vite + Playwright, `/api` 는 모두 `page.route` 가짜(만든 값 — `fixtures/asset/screenSample.ts`) — 구글 · 토스 · 서버 호출 0. 요소는 역할 + 이름 · `data-testid` 로 찾는다.
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import 'dotenv/config';
import path from 'node:path';
import { chromium, type Browser, type Page, type Route } from 'playwright';
import { CASH_SAMPLE_KIWOOM as KIWOOM, assetHistorySample, assetSheetSample, assetStatusSample, assetSummarySample, cashViewSample } from './fixtures/asset/screenSample';
import { createBrowserStepGuard } from './lib/browserStepGuard';
import { formatAssetPrice } from '../src/utils/assetFormat';
import type { AssetCashBankFix } from '../src/types/asset';

const root = path.resolve(import.meta.dirname, '..');
const PORT = 5194;
const WEB = `http://127.0.0.1:${PORT}`;
const CASH_KB = '예시국민 (정기 예금 25.12.29 ~ 26.12.29)';

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
  holdCash?: boolean;
  emptyPreview?: boolean;
  bankFix?: AssetCashBankFix;
}

async function open(browser: Browser, o: Opts) {
  const ctx = await browser.newContext({ viewport: o.size });
  await ctx.addInitScript(() => {
    localStorage.setItem('alphascope.asset.tab', 'status');
    localStorage.setItem('alphascope.asset.statusView', 'account');
    localStorage.setItem('alphascope.asset.settingsMenu', 'cash');
  });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)));
  const seen = { puts: [] as Record<string, unknown>[], banks: [] as Record<string, unknown>[], trades: [] as Record<string, unknown>[] };
  let release = () => {};
  const gate = new Promise<void>((ok) => (release = ok));
  await page.route(/\/api\/(?!asset\/)/, (r) => (r.request().url().includes('/api/auth/me') ? r.fulfill({ json: { ok: true } }) : r.fulfill({ status: 503, json: { error: '시험 — 없음' } })));
  await page.route('**/api/asset/status', (r) => r.fulfill({ json: assetStatusSample(true) }));
  await page.route('**/api/asset/touch', (r) => r.fulfill({ json: { ok: true, lockMinutes: 30, remainingMs: 30 * 60_000 } }));
  await page.route('**/api/asset/sheet', (r) => r.fulfill({ json: { ...assetSheetSample(), cashBankFix: o.bankFix ?? { rows: {}, renames: {} } } }));
  await page.route('**/api/asset/summary**', (r) => r.fulfill({ json: assetSummarySample({ purchaseDone: true }) }));
  await page.route('**/api/asset/history**', (r) => r.fulfill({ json: assetHistorySample(5) }));
  await page.route('**/api/asset/cash', async (r) => {
    if (o.holdCash) await gate;
    await r.fulfill({ json: cashViewSample({ emptyPreview: o.emptyPreview }) });
  });
  await page.route('**/api/asset/cash/settings', async (r: Route) => {
    seen.puts.push(JSON.parse(r.request().postData() ?? '{}') as Record<string, unknown>);
    return r.fulfill({ json: cashViewSample() });
  });
  await page.route('**/api/asset/cash/banks', async (r: Route) => {
    seen.banks.push(JSON.parse(r.request().postData() ?? '{}') as Record<string, unknown>);
    return r.fulfill({ json: { ...cashViewSample(), bankFix: { rows: {}, renames: { 예시키움: '키움' } } } });
  });
  await page.route('**/api/asset/cash/pair**', (r) => r.fulfill({ json: { enabled: true, pair: { key: KIWOOM, label: '예시키움 · 투자 계좌 예수금' }, usdKrw: 1380.5 } }));
  await page.route('**/api/asset/trade', async (r) => {
    seen.trades.push(JSON.parse(r.request().postData() ?? '{}') as Record<string, unknown>);
    await r.fulfill({ json: { id: 9, cash: { status: 'applied', message: null } } });
  });
  await guard.step('페이지 열기(#/asset)', () => page.goto(`${WEB}/#/asset`));
  await guard.step('자산 화면 기다리기', () => page.locator('[data-account-cards]').waitFor({ timeout: 30_000 }));
  return { page, ctx, errors, seen, release };
}

const openSettings = async (page: Page) => {
  await page.getByLabel('설정', { exact: true }).click();
  await page.getByRole('dialog', { name: '자산 관리 설정' }).waitFor({ timeout: 5000 });
};
const noOverflow = (page: Page) =>
  page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]') as HTMLElement | null;
    const inner = d ? [...d.querySelectorAll<HTMLElement>('table, [data-testid="asset-cash-flows"], [data-testid="asset-cash-salary"]')].filter((el) => el.scrollWidth > el.clientWidth + 1).length : 1;
    return document.documentElement.scrollWidth <= window.innerWidth + 1 && (d ? d.scrollWidth <= d.clientWidth + 1 : false) && inner === 0;
  });
/** 화면 글에 「줄」 · 「출금」 · 「입금」 이 있나(입출금은 상품 이름이라 뺀다) */
const badWords = (text: string) => (text.replace(/입출금/g, '').match(/줄|출금|입금/g) ?? []);

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
    // ── 설정 화면 ──
    {
      const { page, ctx, errors, seen, release } = await open(browser, { size, holdCash: true });
      await openSettings(page);
      await page.getByTestId('asset-cash-settings-loading').waitFor({ timeout: 5000 });
      check(`[140-3] ${w}px 받기 전 — 뼈대(로딩) · 월급 카드 · 미리 보기 · 「없음」 을 그리지 않음`, (await page.getByTestId('asset-cash-salary').count()) === 0 && (await page.getByTestId('asset-cash-preview').count()) === 0);
      release();
      await page.getByTestId('asset-cash-settings').waitFor({ timeout: 5000 });
      const salary = page.getByTestId('asset-cash-salary');
      const order = await page.getByTestId('asset-cash-settings').evaluate((el) => {
        const ids = [...el.querySelectorAll<HTMLElement>('[data-testid]')].map((x) => x.dataset.testid);
        return { salary: ids.indexOf('asset-cash-salary'), flows: ids.indexOf('asset-cash-flows'), preview: ids.indexOf('asset-cash-preview'), pairs: ids.indexOf('asset-cash-pairs'), moves: ids.indexOf('asset-cash-moves'), enabled: ids.indexOf('asset-cash-enabled-note') };
      });
      check(`[140-3] ${w}px 구역 순서 — 켜기 · 끄기 → 월급 카드(맨 위) → 고정 흐름 → 미리 보기 → 예수금 계좌 짝 → 반영 기록`,
        order.enabled < order.salary && order.salary < order.flows && order.flows < order.preview && order.preview < order.pairs && order.pairs < order.moves, JSON.stringify(order));
      check(`[140-3] ${w}px 월급 카드 — 「월급 ₩3,456,789」 · 출처 「「월 고정지출」 탭 「현재 월 급여」 에서 읽음」 · → 받는 계좌 · 매달 25일 · 다음 11-25(수)`,
        (await page.getByTestId('asset-cash-salary-amount').textContent()) === '₩3,456,789' && ((await page.getByTestId('asset-cash-salary-source').textContent()) ?? '').includes('「월 고정지출」 탭 「현재 월 급여」 에서 읽음')
        && (await salary.getByRole('button', { name: '월급 받는 계좌' }).textContent()) === '예시국민' && (await salary.getByRole('combobox', { name: '월급 날짜' }).inputValue()) === '25'
        && ((await page.getByTestId('asset-cash-salary-next').textContent()) ?? '').includes('11-25(수)'));
      const flows = page.getByTestId('asset-cash-flows');
      const geo = await page.evaluate(() => {
        const s = document.querySelector('[data-testid="asset-cash-salary"]')!.getBoundingClientRect();
        const f = document.querySelector<HTMLElement>('[data-testid="asset-cash-flows"]')!;
        const b = f.getBoundingClientRect();
        return { indent: b.left - s.left, line: parseFloat(getComputedStyle(f).borderLeftWidth), below: b.top >= s.bottom - 1 };
      });
      check(`[140-3] ${w}px 퍼지는 모양 — 고정 흐름이 월급 카드 바로 아래 · 들여쓰기 · 왼쪽 이어지는 선`, geo.indent > 8 && geo.line >= 1 && geo.below, JSON.stringify(geo));
      const btn = (name: string) => flows.getByRole('button', { name, exact: true });
      const INV = '투자 비용(국민 -> 키움 증권 (적립식계좌))';
      check(`[140-3] ${w}px 화살표 문장 — 「[빠지는 계좌] → [들어가는 계좌] ₩ [날]일」 · 빠지는 계좌 기본 = 월급 받는 계좌(예시국민)`,
        (await btn(`${INV} #1 빠지는 계좌`).textContent()) === '예시국민' && (await btn(`${INV} #2 빠지는 계좌`).textContent()) === '예시국민' && (await btn(`${INV} #2 들어가는 계좌`).textContent()) === '예시키움 · 투자 계좌 예수금'
        && (await flows.getByRole('combobox', { name: `${INV} #2 날짜` }).inputValue()) === '10' && (await flows.getByTestId('asset-cash-flow-row').filter({ hasText: `${INV} #2` }).locator('svg').count()) >= 1);
      check(`[140-3] ${w}px 쓰기만 하는 것(고정 지출)의 들어가는 계좌 기본 = 「쓴 돈(밖으로)」 · 저축은 정하지 않음`,
        (await btn('통신비 들어가는 계좌').textContent()) === '쓴 돈(밖으로)' && (await btn(`${INV} #1 들어가는 계좌`).textContent()) === '정하지 않음');
      const changed = await flows.getByTestId('asset-cash-flow-row').filter({ has: page.getByTestId('asset-cash-flow-changed') }).allTextContents();
      check(`[140-3] ${w}px 빠지는 계좌를 바꾼 것만 굵게 「바꿈」(보험 · 월세 — 따라가는 투자 #2 는 없음)`, changed.length === 2 && changed.some((t) => t.startsWith('보험')) && changed.some((t) => t.startsWith('월세')));
      // 「모두 적용」
      await page.getByRole('combobox', { name: '모두 같은 날' }).selectOption('20');
      await page.getByRole('button', { name: '모두 적용' }).click();
      await page.waitForTimeout(300);
      check(`[140-3] ${w}px 「모두 같은 날 [20]일 [모두 적용]」 → 한 번 저장(flowDayAll 20)`, seen.puts.length === 1 && seen.puts[0].flowDayAll === 20 && Object.keys(seen.puts[0]).length === 1);
      // 고르는 칸 — 은행별 묶음
      await btn(`${INV} #2 빠지는 계좌`).click();
      const list = page.getByRole('listbox', { name: `${INV} #2 빠지는 계좌` });
      await list.waitFor({ timeout: 3000 });
      const banks = await list.getByRole('group').evaluateAll((gs) => gs.map((g) => g.getAttribute('aria-label')));
      const kb = await list.getByRole('group', { name: '예시국민' }).getByRole('option').allTextContents();
      check(`[140-3] ${w}px 고르는 칸 — 맨 위 「월급 받는 계좌(예시국민)」 · 은행 묶음 머리(시트 순서) 아래 상품(입출금 · 정기 예금 #1~#3)`,
        banks.join('|') === `기본|예시키움|예시국민|${'예시 저축은행 정기예금 이름이 아주 긴 계좌 — 만기 자동 연장 특판 상품 2026년 11월 가입분'}`
        && kb.join('|') === ['정기 예금 25.12.29 ~ 26.12.29 #1', '정기 예금 25.12.29 ~ 26.12.29 #2', '정기 예금 25.12.29 ~ 26.12.29 #3', '입출금'].join('|')
        && ((await list.getByRole('option', { selected: true }).textContent()) ?? '').includes('월급 받는 계좌 (예시국민)'), `${banks.join('|')} / ${kb.join('|')}`);
      const longOpt = await page.evaluate(() => [...document.querySelectorAll<HTMLElement>('[data-testid="asset-cash-picker-list"] span.truncate')].filter((sp) => sp.scrollWidth > sp.clientWidth).every((sp) => (sp.getAttribute('data-tip-clip') ?? '') === sp.textContent));
      check(`[140-3] ${w}px 긴 이름은 말줄임 + 툴팁(data-tip-clip)`, longOpt);
      await list.getByRole('option', { name: '정기 예금 25.12.29 ~ 26.12.29 #2' }).click();
      await page.waitForTimeout(300);
      const fe = (seen.puts.at(-1) as { flowEdit?: { from: { name: string; nth: number }; to: unknown; day: number } }).flowEdit;
      check(`[140-3] ${w}px 다른 계좌를 고르면 그 한 줄 저장 — 빠지는 계좌 = 고른 상품(이름 · 몇 번째) · 들어가는 계좌 · 날짜 그대로`, fe?.from?.name === CASH_KB && fe.from.nth === 2 && (fe.to as { name: string }).name === KIWOOM.name && fe.day === 10);
      // 미리 보기
      const pv = page.getByTestId('asset-cash-preview');
      const pvRows = await pv.getByTestId('asset-cash-preview-row').allTextContents();
      check(`[140-3] ${w}px 다음 한 달 미리 보기 — 날짜순 「11-25(수) 월급 → 예시국민 ₩3,456,789 반영 예정」 · 반영 안 함은 까닭과 함께 아래`,
        pvRows[0].includes('11-25(수)') && pvRows[0].includes('월급 → 예시국민') && pvRows[0].includes('₩3,456,789') && pvRows[0].includes('반영 예정')
        && pvRows[2].includes('쓴 돈(밖으로)') && pvRows.at(-1)!.includes('변동 지출') && pvRows.some((t) => t.includes('날짜 없음')) && (await page.getByTestId('asset-cash-preview-empty').count()) === 0);
      // 은행 묶음 고치기
      check(`[140-3] ${w}px 「은행 묶음 고치기」 는 접혀 있음`, (await page.getByTestId('asset-cash-banks').count()) === 0);
      await page.getByRole('button', { name: '은행 묶음 고치기' }).click();
      await page.getByTestId('asset-cash-banks').waitFor({ timeout: 3000 });
      const rename = page.getByRole('textbox', { name: '예시키움 은행 이름' });
      await rename.fill('키움');
      await rename.press('Enter');
      await page.waitForTimeout(300);
      check(`[140-3] ${w}px 은행 이름 바꾸기 → PUT /api/asset/cash/banks { rename: 예시키움 → 키움 } · 바뀐 묶음 이름이 고르는 칸에`,
        JSON.stringify(seen.banks.at(-1)) === JSON.stringify({ rename: { from: '예시키움', to: '키움' } }) && (await page.getByRole('button', { name: '개별 투자 예수금 계좌' }).textContent()) === '키움 · 투자 계좌 예수금');
      const text = await page.getByRole('dialog', { name: '자산 관리 설정' }).innerText();
      check(`[140-3] ${w}px 화면 글에 「줄」 · 「출금」 · 「입금」 0(입출금 상품 이름 빼고)`, badWords(text).length === 0, badWords(text).join(','));
      check(`[140-3] ${w}px 넘침 0(창 · 표 · 월급 카드 · 고정 흐름 · 화면 가로)`, await noOverflow(page));
      check(`[140-3] ${w}px 화면 오류 0`, errors.length === 0, errors.join(' / '));
      await ctx.close();
    }
    // ── 미리 보기 비었을 때 ──
    {
      const { page, ctx } = await open(browser, { size, emptyPreview: true });
      await openSettings(page);
      await page.getByTestId('asset-cash-settings').waitFor({ timeout: 5000 });
      check(`[140-3] ${w}px 반영할 것이 없으면 「반영할 것이 없어요 — 날짜 · 계좌를 정해 주세요」`, ((await page.getByTestId('asset-cash-preview-empty').textContent()) ?? '').includes('반영할 것이 없어요 — 날짜 · 계좌를 정해 주세요'));
      await ctx.close();
    }
    // ── 7. 「현금 합계」 은행별 · 매수 · 매도 창 ──
    {
      const { page, ctx, errors } = await open(browser, { size, bankFix: { rows: {}, renames: {} } });
      const sample = assetSheetSample();
      await page.getByRole('button', { name: /^현금 합계/ }).click();
      const bank = page.getByTestId('asset-cash-bank');
      await bank.waitFor({ timeout: 5000 });
      const heads = await bank.locator('tr[data-cash-bank]').evaluateAll((trs) => trs.map((tr) => ({ bank: tr.getAttribute('data-cash-bank'), sum: tr.querySelector('[data-cash-bank-sum]')?.textContent })));
      const kbSum = sample.cashAccounts.filter((r) => r.name.startsWith('예시은행')).reduce((a, r) => a + (r.amount ?? 0), 0);
      check(`[140-7] ${w}px 「현금 합계」 펼침 = 은행별 합계 먼저(시트에서 처음 나온 순서 · 상품은 접힘)`,
        heads.length === 2 && heads[0].bank === '예시은행' && heads[0].sum === formatAssetPrice(kbSum, 'KRW') && (await bank.locator('tr[data-cash-row]').count()) === 0, JSON.stringify(heads));
      await bank.getByRole('button', { name: '예시은행 상품 펼치기' }).click();
      const items = await bank.locator('tr[data-cash-row]').evaluateAll((trs) => trs.map((tr) => ({ label: tr.querySelector('td span')?.textContent, amount: tr.querySelectorAll('td')[1]?.textContent })));
      const parse = (t: string | null | undefined) => (t && t !== '—' ? Number(t.replace(/[^0-9-]/g, '')) : 0);
      check(`[140-7] ${w}px 은행을 누르면 상품(입출금 #1 · 청년 적금 … · 입출금 #2) · 은행 합 = 상품 합(원)`,
        items.map((i) => i.label).join('|') === '입출금 #1|청년 적금 26.11.16 ~ 29.11.16|입출금 #2' && items.reduce((a, i) => a + parse(i.amount), 0) === parse(heads[0].sum), JSON.stringify(items));
      check(`[140-7] ${w}px 펼친 뒤 넘침 0`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
      // 매도 창 문장
      await page.getByRole('button', { name: '예시 국내 대형주 매도 입력' }).first().click();
      await page.getByTestId('asset-cash-trade-preview').waitFor({ timeout: 5000 });
      await page.getByRole('textbox', { name: '수량' }).fill('2');
      await page.getByRole('textbox', { name: '가격' }).fill('70000');
      check(`[140-7] ${w}px 매도 창 — 「예시키움 · 투자 계좌 예수금에 ₩140,000 들어갑니다」(은행 · 상품 이름)`, ((await page.getByTestId('asset-cash-trade-preview').textContent()) ?? '').replace(/\s+/g, ' ') === '예시키움 · 투자 계좌 예수금에 ₩140,000 들어갑니다');
      await page.getByRole('button', { name: '금액 고치기' }).click();
      await page.getByTestId('asset-cash-trade-amount').fill('0');
      check(`[140-7] ${w}px 금액 0 → 「… — 바꾸지 않습니다」`, ((await page.getByTestId('asset-cash-trade-preview').textContent()) ?? '').replace(/\s+/g, ' ').includes('예수금 — 바꾸지 않습니다'));
      check(`[140-7] ${w}px 매도 창 글에 「줄」 0(예수금 계좌)`, badWords((await page.getByTestId('asset-cash-trade').innerText()) ?? '').length === 0);
      check(`[140-7] ${w}px 화면 오류 0`, errors.length === 0, errors.join(' / '));
      await ctx.close();
    }
    // ── 7. 은행 묶음 고치기가 「현금 합계」 에도 ──
    {
      const { page, ctx } = await open(browser, { size, bankFix: { rows: {}, renames: { 예시은행: '예시뱅크' } } });
      await page.getByRole('button', { name: /^현금 합계/ }).click();
      await page.getByTestId('asset-cash-bank').waitFor({ timeout: 5000 });
      check(`[140-7] ${w}px 「은행 묶음 고치기」(이름 바꾸기)가 「현금 합계」 에도 같게(설정 화면과 같은 함수)`, (await page.locator('tr[data-cash-bank]').first().getAttribute('data-cash-bank')) === '예시뱅크');
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
