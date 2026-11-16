/**
 * 현금 자동 반영 화면 시험(139차 · v2.71.0) — `npm run assetcashflowui:test` · ⚠️ `DB_PATH=<사본>` 으로만 돈다(맨 첫 import).
 * 139차 「꼭 지킬 동작」 8(1280 × 1080 · 1440 × 900): 설정 「현금 자동 반영」 표 · 고정 흐름 표 · 반영 기록 · 되돌리기 확인 창 · 매수 창 예수금 줄 · 잠금 때 꺼짐 · 로딩 · 넘침 0
 * + 6 의 화면 몫(미리 보기 금액 · 고친 금액이 요청에 · 미국 = 환율 계산 · 예수금 실패 안내 · 짝 없음 = 지금과 같음).
 * Vite + Playwright, `/api` 는 모두 `page.route` 가짜(만든 값) — 구글 · 토스 · 서버 호출 0. 요소는 역할 + 이름 · `data-testid` 로 찾는다.
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import 'dotenv/config';
import path from 'node:path';
import { chromium, type Browser, type Page, type Route } from 'playwright';
import { CASH_SAMPLE_KIWOOM as KIWOOM, CASH_SAMPLE_LONG as LONG, assetHistorySample, assetSheetSample, assetStatusSample, assetSummarySample, cashViewSample } from './fixtures/asset/screenSample';
import { createBrowserStepGuard } from './lib/browserStepGuard';
import type { AssetCashPairView } from '../src/types/asset';

const root = path.resolve(import.meta.dirname, '..');
const PORT = 5192;
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
  holdCash?: boolean;
  /** PUT 설정 → 403 잠김 */
  lockOnSave?: boolean;
  pair?: AssetCashPairView;
  holdPair?: boolean;
  tradeCash?: { status: 'applied' | 'skipped' | 'none'; message: string | null };
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
  const seen = { puts: [] as Record<string, unknown>[], undos: [] as Record<string, unknown>[], trades: [] as Record<string, unknown>[], locked: false };
  const gates = { cash: () => {}, pair: () => {}, undo: () => {} };
  const cashGate = new Promise<void>((ok) => (gates.cash = ok));
  const pairGate = new Promise<void>((ok) => (gates.pair = ok));
  const undoGate = new Promise<void>((ok) => (gates.undo = ok));
  await page.route(/\/api\/(?!asset\/)/, (r) => (r.request().url().includes('/api/auth/me') ? r.fulfill({ json: { ok: true } }) : r.fulfill({ status: 503, json: { error: '시험 — 없음' } })));
  await page.route('**/api/asset/status', (r) => r.fulfill({ json: assetStatusSample(!seen.locked) }));
  await page.route('**/api/asset/touch', (r) => r.fulfill({ json: { ok: true, lockMinutes: 30, remainingMs: 30 * 60_000 } }));
  await page.route('**/api/asset/sheet', (r) => r.fulfill({ json: assetSheetSample() }));
  await page.route('**/api/asset/summary**', (r) => r.fulfill({ json: assetSummarySample({ purchaseDone: true }) }));
  await page.route('**/api/asset/history**', (r) => r.fulfill({ json: assetHistorySample(5) }));
  await page.route('**/api/asset/cash', async (r) => {
    if (o.holdCash) await cashGate;
    await r.fulfill({ json: cashViewSample() });
  });
  await page.route('**/api/asset/cash/settings', async (r: Route) => {
    seen.puts.push(JSON.parse(r.request().postData() ?? '{}') as Record<string, unknown>);
    if (o.lockOnSave) {
      seen.locked = true;
      return r.fulfill({ status: 403, json: { error: '자산 관리가 잠겨 있습니다.', code: 'asset-locked' } });
    }
    return r.fulfill({ json: cashViewSample() });
  });
  await page.route('**/api/asset/cash/undo', async (r: Route) => {
    seen.undos.push(JSON.parse(r.request().postData() ?? '{}') as Record<string, unknown>);
    await undoGate;
    await r.fulfill({ json: cashViewSample({ undone: true }) });
  });
  await page.route('**/api/asset/cash/pair**', async (r) => {
    if (o.holdPair) await pairGate;
    await r.fulfill({ json: o.pair ?? { enabled: true, pair: { key: KIWOOM, label: KIWOOM.name }, usdKrw: 1380.5 } });
  });
  await page.route('**/api/asset/trade', async (r) => {
    seen.trades.push(JSON.parse(r.request().postData() ?? '{}') as Record<string, unknown>);
    await r.fulfill({ json: { id: 9, cash: o.tradeCash ?? { status: 'applied', message: null } } });
  });
  await guard.step('페이지 열기(#/asset)', () => page.goto(`${WEB}/#/asset`));
  await guard.step('자산 화면 기다리기', () => page.locator('[data-account-cards]').waitFor({ timeout: 30_000 }));
  return { page, ctx, errors, seen, gates };
}

const noOverflow = (page: Page) =>
  page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]') as HTMLElement | null;
    const inner = d ? [...d.querySelectorAll<HTMLElement>('table, [data-testid="asset-cash-trade"]')].filter((el) => el.scrollWidth > el.clientWidth + 1).length : 1;
    return document.documentElement.scrollWidth <= window.innerWidth + 1 && (d ? d.scrollWidth <= d.clientWidth + 1 : false) && inner === 0;
  });

const openSettings = async (page: Page) => {
  // 사이드 메뉴에도 「설정」 이 있다 — 자산 화면 머리의 아이콘 버튼(aria-label)
  await page.getByLabel('설정', { exact: true }).click();
  await page.getByRole('dialog', { name: '자산 관리 설정' }).waitFor({ timeout: 5000 });
};

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
    // ── 설정 「현금 자동 반영」 — 로딩 · 표 · 넘침 ──
    {
      const { page, ctx, errors, seen, gates } = await open(browser, { size, holdCash: true });
      await openSettings(page);
      await page.getByTestId('asset-cash-settings-loading').waitFor({ timeout: 5000 });
      check(`[139-8] ${w}px 받기 전 — 뼈대(로딩) · 표 · 「없음」 을 그리지 않음`, (await page.getByTestId('asset-cash-settings').count()) === 0 && (await page.getByTestId('asset-cash-flows').count()) === 0);
      gates.cash();
      await page.getByTestId('asset-cash-settings').waitFor({ timeout: 5000 });
      const pairs = page.getByTestId('asset-cash-pairs');
      check(`[139-8] ${w}px 예수금 줄 짝 — 계좌 4줄 · 개별 투자 = 키움`, (await pairs.locator('tbody tr').count()) === 4 && (await page.getByRole('combobox', { name: '개별 투자 예수금 줄' }).locator('option:checked').textContent()) === KIWOOM.name);
      const flows = page.getByTestId('asset-cash-flows');
      const rowsText = await flows.locator('tbody tr').allTextContents();
      check(`[139-8] ${w}px 고정 흐름 — 분류 묶음 머리 줄(저축 및 투자 · 월세 · 고정 지출 · 변동 지출) · 같은 사유 「#1」 · 「#2」 · 변동 지출은 회색 「반영 안 함」 · ₩0 「반영 안 함」`,
        (await flows.getByTestId('asset-cash-flow-category').allTextContents()).join('|') === '저축 및 투자|월세|고정 지출|변동 지출|시트에서 찾지 못한 줄' &&
        rowsText.some((t) => t.includes('#1')) && rowsText.some((t) => t.includes('#2')) && (await flows.locator('[data-flow-reflect="no"]').textContent())?.includes('반영 안 함') === true
        && rowsText.some((t) => t.includes('ISA') && t.includes('₩0') && t.includes('반영 안 함')));
      check(`[139-8] ${w}px 다시 확인 필요한 줄은 빨간 글(「현금」 줄을 찾지 못함 · 「월 고정지출」 줄을 찾지 못함) + 지운 줄은 [설정 지우기]`,
        (await flows.locator('.text-danger', { hasText: '「현금」 줄을 찾지 못함' }).count()) >= 1 && (await flows.locator('.text-danger', { hasText: '「월 고정지출」 줄을 찾지 못함' }).count()) >= 1
        && (await flows.getByRole('button', { name: '설정 지우기' }).count()) === 1);
      check(`[139-8] ${w}px 다음 반영 날 · 월급 금액 · 다음 날`, rowsText.some((t) => t.includes('2026-12-10')) && ((await page.getByTestId('asset-cash-salary-next').textContent()) ?? '').includes('2026-11-25'));
      const moves = page.getByTestId('asset-cash-moves');
      check(`[139-8] ${w}px 반영 기록 — 최신 위 · 상태(반영 · 건너뜀 · 서버 꺼짐 · 다시 확인 필요) · [되돌리기] 는 「반영」 줄만`,
        (await moves.locator('[data-testid="asset-cash-move-row"]').count()) === 3 && (await moves.getByRole('button', { name: '되돌리기' }).count()) === 1
        && ((await moves.locator('[data-move-status="skipped"]').textContent()) ?? '').includes('서버 꺼짐') && (await moves.locator('[data-move-status="check"] .text-danger').count()) >= 1);
      check(`[139-8] ${w}px 넘침 0(창 · 표 · 화면 가로)`, await noOverflow(page));
      // 긴 이름은 말줄임 + data-tip-clip
      check(`[139-8] ${w}px 긴 줄 이름은 말줄임(data-tip-clip 에 전체 글)`, await moves.evaluate((el, long) => [...el.querySelectorAll<HTMLElement>('span.truncate')].some((sp) => sp.scrollWidth > sp.clientWidth && (sp.getAttribute('data-tip-clip') ?? '').includes(long)), LONG));

      // 고정 흐름 날짜 고치기 → 그 줄 설정 한 번 저장
      await flows.getByRole('combobox', { name: '통신비 날짜' }).selectOption('5');
      await page.waitForTimeout(300);
      const put = seen.puts.at(-1) as { flow?: { day: number; from: unknown; to: unknown; item: { reason: string } } } | undefined;
      check(`[139-8] ${w}px 날짜를 고르면 그 줄만 저장(flow · 날짜 5 · 출금 · 입금은 아직 비어 있음)`, put?.flow?.day === 5 && put.flow.item.reason === '통신비' && put.flow.from === null && put.flow.to === null);

      // 되돌리기 — 확인 창 · 처리 중 로딩 · 결과
      await moves.getByRole('button', { name: '되돌리기' }).click();
      const confirm = page.getByRole('dialog', { name: '되돌리기' });
      await confirm.waitFor({ timeout: 5000 });
      check(`[139-8] ${w}px [되돌리기] → 확인 창(무엇 · 금액 · 지금 숫자에서 반대로)`, ((await confirm.textContent()) ?? '').includes('1,234,000') && ((await confirm.textContent()) ?? '').includes('지금 시트 숫자'));
      await confirm.getByRole('button', { name: '되돌리기' }).click();
      await page.waitForTimeout(200);
      check(`[139-8] ${w}px 되돌리는 중 — 버튼 로딩(aria-busy) · 요청 한 번(id 3)`, (await moves.getByRole('button', { name: '되돌리기' }).getAttribute('aria-busy')) === 'true' && seen.undos.length === 1 && seen.undos[0].id === 3);
      gates.undo();
      await moves.locator('[data-move-status="undone"]').waitFor({ timeout: 5000 });
      check(`[139-8] ${w}px 되돌린 뒤 상태 「되돌림」 · [되돌리기] 없음`, (await moves.getByRole('button', { name: '되돌리기' }).count()) === 0 && ((await moves.locator('[data-move-status="undone"]').textContent()) ?? '').includes('되돌림'));
      check(`[139-8] ${w}px 화면 오류 0`, errors.length === 0, errors.join(' / '));
      await ctx.close();
    }

    // ── 켜기 전 확인 창 · 잠금 때 꺼짐 ──
    {
      const { page, ctx, seen } = await open(browser, { size, lockOnSave: true });
      await page.route('**/api/asset/cash', (r) => r.fulfill({ json: cashViewSample({ enabled: false }) }));
      await openSettings(page);
      await page.getByTestId('asset-cash-settings').waitFor({ timeout: 5000 });
      check(`[139-8] ${w}px 꺼짐 — 「예수금 · 은행 잔액을 시트에서 먼저 맞춰 주세요」`, ((await page.getByTestId('asset-cash-enabled-note').textContent()) ?? '').includes('먼저 맞춰'));
      await page.getByRole('radiogroup', { name: '현금 자동 반영' }).getByRole('radio', { name: '켬' }).click();
      const confirm = page.getByRole('dialog', { name: '현금 자동 반영 켜기' });
      await confirm.waitFor({ timeout: 5000 });
      check(`[139-8] ${w}px [켬] → 확인 창(시트에서 먼저 맞춤 · 켠 오늘부터) · 확인 전 저장 0`, ((await confirm.textContent()) ?? '').includes('먼저 맞춰') && seen.puts.length === 0);
      await confirm.getByRole('button', { name: '켜기' }).click();
      await page.waitForTimeout(500);
      check(`[139-8] ${w}px 잠긴 뒤 저장(403) → 설정 창이 닫히고 잠금 화면(고치기 · 켜기 · 되돌리기 못 함)`, seen.puts.length === 1 && (seen.puts[0] as { enabled?: boolean }).enabled === true
        && (await page.getByRole('dialog', { name: '자산 관리 설정' }).count()) === 0 && (await page.getByTestId('asset-cash-settings').count()) === 0);
      await ctx.close();
    }

    // ── 매수 창 예수금 줄 — 국내 ──
    {
      const { page, ctx, seen, gates, errors } = await open(browser, { size, holdPair: true });
      await page.getByRole('button', { name: '예시 국내 대형주 매수 입력' }).first().click();
      await page.getByTestId('asset-cash-trade').waitFor({ timeout: 5000 });
      await page.getByRole('textbox', { name: '수량' }).fill('10');
      await page.getByRole('textbox', { name: '가격' }).fill('70000');
      check(`[139-8] ${w}px 짝을 받기 전 — 「확인 중」 · [저장] 막힘(짝 없음을 먼저 그리지 않음)`, (await page.getByTestId('asset-cash-trade').getAttribute('data-cash-state')) === 'loading' && (await page.getByRole('button', { name: '저장' }).isDisabled()));
      gates.pair();
      await page.getByTestId('asset-cash-trade-preview').waitFor({ timeout: 5000 });
      check(`[139-6] ${w}px 미리 보기 「예시키움 (투자 계좌 예수금) ₩700,000 줄어듭니다」 · 금액 칸 = 수량 × 가격`, ((await page.getByTestId('asset-cash-trade-preview').textContent()) ?? '').replace(/\s+/g, ' ') === `${KIWOOM.name}₩700,000 줄어듭니다` && (await page.getByTestId('asset-cash-trade-amount').inputValue()) === '700,000',
        (await page.getByTestId('asset-cash-trade-preview').textContent()) ?? '');
      await page.getByTestId('asset-cash-trade-amount').fill('701500');
      check(`[139-6] ${w}px 금액을 고치면 미리 보기도 그 금액`, ((await page.getByTestId('asset-cash-trade-preview').textContent()) ?? '').includes('₩701,500 줄어듭니다'));
      await page.getByRole('textbox', { name: '수량' }).fill('11');
      check(`[139-6] ${w}px 고친 뒤에는 수량을 바꿔도 고친 금액 그대로`, (await page.getByTestId('asset-cash-trade-amount').inputValue()) === '701,500');
      check(`[139-8] ${w}px 매수 창 넘침 0`, await noOverflow(page));
      await page.getByRole('button', { name: '저장' }).click();
      await page.getByRole('dialog', { name: '매수 입력' }).waitFor({ state: 'detached', timeout: 5000 });
      check(`[139-6] ${w}px 고친 금액이 그대로 요청에(cashAmount 701,500)`, seen.trades.length === 1 && seen.trades[0].cashAmount === 701_500);
      check(`[139-8] ${w}px 화면 오류 0(매수 창)`, errors.length === 0, errors.join(' / '));
      await ctx.close();
    }

    // ── 매수 창 — 미국(환율) · 예수금 실패 안내 ──
    {
      const { page, ctx, seen } = await open(browser, { size, tradeCash: { status: 'skipped', message: '예수금 줄은 바꾸지 못했어요 — 시트에서 고쳐 주세요(「현금」 줄을 찾지 못함).' } });
      await page.getByRole('button', { name: '예시 미국 기술주 매수 입력' }).click();
      await page.getByTestId('asset-cash-trade-preview').waitFor({ timeout: 5000 });
      await page.getByRole('textbox', { name: '수량' }).fill('2');
      await page.getByRole('textbox', { name: '가격' }).fill('100.25');
      const want = Math.round(2 * 100.25 * 1380.5); // 276,790
      check(`[139-6] ${w}px 미국 = 수량 × 가격 × 지금 환율(반올림 ${want.toLocaleString('en-US')}) · 「환율 1,380.5 기준」`, (await page.getByTestId('asset-cash-trade-amount').inputValue()) === want.toLocaleString('en-US') && ((await page.getByTestId('asset-cash-trade-fx').textContent()) ?? '').includes('환율 1,380.5 기준'));
      await page.getByRole('button', { name: '저장' }).click();
      await page.getByTestId('asset-cash-trade-failed').waitFor({ timeout: 5000 });
      check(`[139-6] ${w}px 예수금 쓰기만 실패 → 창에 「매수는 저장했어요. 예수금 줄은 바꾸지 못했어요 — 시트에서 고쳐 주세요(까닭)」 + [닫기] 만([저장] 없음)`,
        ((await page.getByTestId('asset-cash-trade-failed').textContent()) ?? '').startsWith('매수는 저장했어요. 예수금 줄은 바꾸지 못했어요') && (await page.getByRole('button', { name: '저장' }).count()) === 0 && seen.trades[0].cashAmount === want);
      await page.getByRole('button', { name: '닫기' }).last().click();
      await page.getByRole('dialog', { name: '매수 입력' }).waitFor({ state: 'detached', timeout: 5000 });
      check(`[139-6] ${w}px [닫기] 로 창이 닫힘(보유는 이미 저장 — 다시 저장 0)`, seen.trades.length === 1);
      await ctx.close();
    }

    // ── 짝 없음 · 꺼짐 = 지금과 같음 ──
    for (const pair of [{ enabled: true, pair: null, usdKrw: null }, { enabled: false, pair: null, usdKrw: null }] as AssetCashPairView[]) {
      const { page, ctx, seen } = await open(browser, { size, pair });
      await page.getByRole('button', { name: '예시 국내 대형주 매도 입력' }).first().click();
      await page.getByTestId('asset-cash-trade').waitFor({ timeout: 5000 });
      await page.waitForTimeout(200);
      const line = (await page.getByTestId('asset-cash-trade').textContent()) ?? '';
      await page.getByRole('textbox', { name: '수량' }).fill('1');
      await page.getByRole('textbox', { name: '가격' }).fill('72000');
      await page.getByRole('button', { name: '저장' }).click();
      await page.getByRole('dialog', { name: '매도 입력' }).waitFor({ state: 'detached', timeout: 5000 });
      check(`[139-6] ${w}px ${pair.enabled ? '짝 없음' : '꺼짐'} → 안내 한 줄(「예수금 줄 짝을 정하면 … 함께 바뀝니다」) · 금액 칸 없음 · 요청에 cashAmount 없음(지금과 같음)`,
        line.includes('예수금 줄 짝을 정하면') && line.includes('함께 바뀝니다') && (await page.getByTestId('asset-cash-trade-amount').count()) === 0 && seen.trades.length === 1 && !('cashAmount' in seen.trades[0]));
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
