/**
 * 매수 · 매도 버튼 색 시험(118-1차 · v2.66.1) — `npm run ordercolor:test` · ⚠️ `DB_PATH=<사본>` 으로만 돈다(맨 첫 import · DB 는 쓰지 않는다).
 *
 * 118-1차 지시서 「꼭 지킬 동작」 1 ~ 4 를 확인한다(시험 이름 앞의 [색-n]). 소스 검사 + Vite + Playwright, `/api` 는 모두 `page.route` 가짜(만든 값) — 구글 · 토스 · 서버 호출 0 · 주문 0.
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type Locator, type Page } from 'playwright';
import { assetHistorySample, assetSheetSample, assetStatusSample, assetSummarySample, assetTradesSample } from './fixtures/asset/screenSample';

const root = path.resolve(import.meta.dirname, '..');
const PORT = 5189;
const WEB = `http://127.0.0.1:${PORT}`;
const WHITE = 'rgb(255, 255, 255)';

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? ` — ${detail}` : ''}`);
}

const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

/** 소스 폴더의 파일 전부(상대 경로 · 내용) */
function sources(dir: string): { file: string; text: string }[] {
  return fs.readdirSync(path.join(root, dir), { recursive: true, encoding: 'utf8' })
    .filter((f) => /\.tsx?$/.test(f))
    .map((f) => ({ file: `${dir}/${f}`, text: read(`${dir}/${f}`) }));
}

// ── 소스 검사 ──
const panel = read('src/components/chart/QuickOrderPanel.tsx');
const buttonBlock = (label: string) => {
  const end = panel.indexOf(`${label}\n          </button>`);
  return panel.slice(panel.lastIndexOf('<button', end), end);
};
const colorOf = (block: string) => /\$\{(ORDER_(?:BUY|SELL)_COLOR)\}/.exec(block)?.[1] ?? '';

check('[색-1] 지정가 매도 · 시장가 매도가 같은 색 정의(ORDER_SELL_COLOR)', colorOf(buttonBlock('지정가 매도')) === 'ORDER_SELL_COLOR' && colorOf(buttonBlock('시장가 매도')) === 'ORDER_SELL_COLOR');
check('[색-1] 지정가 매수 · 시장가 매수가 같은 색 정의(ORDER_BUY_COLOR)', colorOf(buttonBlock('지정가 매수')) === 'ORDER_BUY_COLOR' && colorOf(buttonBlock('시장가 매수')) === 'ORDER_BUY_COLOR');
check('[색-1] 네 버튼 모두 disabled:opacity-40', ['지정가 매도', '지정가 매수', '시장가 매도', '시장가 매수'].every((l) => buttonBlock(l).includes('disabled:opacity-40')));

/** 118-1차 전(9f64c61)의 주문 호출 · 막힘 조건 줄 — 색만 바꾸는 일이라 한 글자도 달라지면 안 된다 */
const ORDER_LINES = [
  `onClick={() => order('SELL', 'LIMIT')}`,
  `disabled={busy || !price || !limitPrice || sellQuantity <= 0}`,
  `onClick={() => order('BUY', 'LIMIT')}`,
  `disabled={busy || !price || !limitPrice || buyQuantity <= 0}`,
  `onClick={() => order('SELL', 'MARKET')}`,
  `disabled={busy || !price || marketSellQuantity <= 0}`,
  `onClick={() => order('BUY', 'MARKET')}`,
  `disabled={busy || !price || marketBuyQuantity <= 0}`,
];
const orderBlocks = ['지정가 매도', '지정가 매수', '시장가 매도', '시장가 매수'].map(buttonBlock).join('\n');
const panelLines = orderBlocks.split('\n').map((l) => l.trim()).filter((l) => /^(onClick|disabled)=/.test(l));
check('[색-2] 빠른 주문 네 버튼의 order( · disabled= 줄이 9f64c61 과 같음', panelLines.join('\n') === ORDER_LINES.join('\n'), panelLines.join(' / '));

const allSrc = sources('src');
const defined = (needle: string) => allSrc.filter((s) => s.text.includes(needle)).map((s) => s.file);
check('[색-4] 빠른 주문 색 글자 bg-bearish/80 은 tokens.ts 한 곳', defined('bg-bearish/80').join() === 'src/components/ui/tokens.ts', defined('bg-bearish/80').join());
check('[색-4] 빠른 주문 색 글자 bg-accent/80 은 tokens.ts 한 곳', defined('bg-accent/80').join() === 'src/components/ui/tokens.ts', defined('bg-accent/80').join());
const orderFiles = [panel, read('src/components/asset/AssetSheetValues.tsx'), read('src/components/asset/AssetTradeDialog.tsx')].join('\n');
check('[색-4] 주문 버튼에 bg-bearish/15 · bg-accent/15 글자 0곳', !orderFiles.includes('bg-bearish/15') && !orderFiles.includes('bg-accent/15'));
const button = read('src/components/ui/Button.tsx');
check('[색-4] 공용 Button 의 buy · sell 이 같은 정의를 씀', button.includes('buy: ORDER_BUY_COLOR') && button.includes('sell: ORDER_SELL_COLOR'));

// ── 화면 ──
const look = (l: Locator) => l.evaluate((el) => {
  const s = getComputedStyle(el);
  return { bg: s.backgroundColor, color: s.color, opacity: s.opacity, height: el.getBoundingClientRect().height };
});

async function newPage(browser: Browser) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => localStorage.setItem('alphascope.asset.tab', 'status'));
  const page = await ctx.newPage();
  await page.route(/\/api\//, (r) => (r.request().url().includes('/api/auth/me') ? r.fulfill({ json: { ok: true } }) : r.fulfill({ status: 503, json: { error: '시험 — 없음' } })));
  return { page, ctx };
}

/** 차트 화면의 빠른 주문 — `held` 주를 가진 계좌 · 현재가 `price`(null = 시세 없음 → 네 버튼 꺼짐) */
async function openQuickOrder(browser: Browser, price: number | null, held: number) {
  const { page, ctx } = await newPage(browser);
  const account = { id: 1, name: '시험 계좌', initialBalance: 100_000, currentCash: 100_000, currency: 'USD', commissionRate: 0.001, slippageRate: 0.001, createdAt: '2026-11-01T00:00:00.000Z', isActive: true };
  const position = { symbol: 'AAPL', name: 'Apple', quantity: held, averagePrice: 90, currency: 'USD', currentPrice: price ?? 90 };
  await page.route('**/api/paper/accounts', (r) => r.fulfill({ json: { accounts: [account] } }));
  await page.route('**/api/paper/accounts/1**', (r) => r.fulfill({ json: { account, positions: held > 0 ? [position] : [], orderable: 100_000, usdKrw: 1400 } }));
  await page.route('**/api/paper/orders**', (r) => r.fulfill({ json: { orders: [] } }));
  if (price != null) await page.route('**/api/prices?**', (r) => r.fulfill({ json: { price: { close: price } } }));
  await page.goto(`${WEB}/#/chart`);
  const storeUrl = '/src/store/appStore.ts';
  await page.evaluate(async (url) => {
    const m = (await import(/* @vite-ignore */ url)) as { useAppStore: { getState: () => { setSymbol: (s: string) => void } } };
    m.useAppStore.getState().setSymbol('AAPL');
  }, storeUrl);
  await page.getByRole('button', { name: '시장가 매수', exact: true }).waitFor({ timeout: 30_000 });
  return { page, ctx };
}

const orderButton = (page: Page, label: string) => page.getByRole('button', { name: label, exact: true });
/** 시세 · 보유를 받아 버튼 상태가 정해질 때까지 기다린다 */
async function waitEnabled(l: Locator) {
  const t0 = Date.now();
  while (await l.isDisabled()) {
    if (Date.now() - t0 > 15_000) throw new Error('버튼이 켜지지 않음');
    await new Promise((ok) => setTimeout(ok, 100));
  }
}

async function openAsset(browser: Browser) {
  const { page, ctx } = await newPage(browser);
  await page.route('**/api/asset/status', (r) => r.fulfill({ json: assetStatusSample(true) }));
  await page.route('**/api/asset/touch', (r) => r.fulfill({ json: { ok: true, lockMinutes: 30, remainingMs: 30 * 60_000 } }));
  await page.route('**/api/asset/sheet', (r) => r.fulfill({ json: assetSheetSample() }));
  await page.route('**/api/asset/summary**', (r) => r.fulfill({ json: assetSummarySample({ purchaseDone: true, writeEnabled: true }) }));
  await page.route('**/api/asset/history**', (r) => r.fulfill({ json: assetHistorySample(5) }));
  await page.route('**/api/asset/trades**', (r) => r.fulfill({ json: assetTradesSample(50, 50) }));
  await page.goto(`${WEB}/#/asset`);
  await page.locator('[data-account-cards]').waitFor({ timeout: 30_000 });
  return { page, ctx };
}

const { createServer } = await import('vite');
const vite = await createServer({ root, configFile: path.join(root, 'vite.config.ts'), logLevel: 'error', server: { host: '127.0.0.1', port: PORT, strictPort: true, hmr: false } });
await vite.listen();
const browser = await chromium.launch({ channel: 'chrome' });
try {
  // ── 빠른 주문 — 켜진 버튼 ──
  const on = await openQuickOrder(browser, 100, 3);
  for (const l of ['지정가 매도', '지정가 매수', '시장가 매도', '시장가 매수']) await waitEnabled(orderButton(on.page, l));
  await on.page.waitForTimeout(300); // transition-colors 가 끝나게
  const limitSell = await look(orderButton(on.page, '지정가 매도'));
  const marketSell = await look(orderButton(on.page, '시장가 매도'));
  const limitBuy = await look(orderButton(on.page, '지정가 매수'));
  const marketBuy = await look(orderButton(on.page, '시장가 매수'));
  check('[색-1] 지정가 매도 · 시장가 매도 계산된 배경 같음', limitSell.bg === marketSell.bg, `${limitSell.bg} / ${marketSell.bg}`);
  check('[색-1] 지정가 매수 · 시장가 매수 계산된 배경 같음', limitBuy.bg === marketBuy.bg, `${limitBuy.bg} / ${marketBuy.bg}`);
  check('[색-1] 매수 · 매도 배경은 서로 다름', limitBuy.bg !== limitSell.bg);
  check('[색-1] 네 버튼 모두 흰 글자', [limitSell, marketSell, limitBuy, marketBuy].every((s) => s.color === WHITE));
  check('[색-1] 켜진 버튼은 옅지 않음(opacity 1)', [limitSell, marketSell, limitBuy, marketBuy].every((s) => s.opacity === '1'));
  await on.ctx.close();

  // ── 빠른 주문 — 꺼진 버튼(시세 없음) ──
  const off = await openQuickOrder(browser, null, 0);
  await off.page.waitForTimeout(800);
  const offButtons = await Promise.all(['지정가 매도', '지정가 매수', '시장가 매도', '시장가 매수'].map((l) => orderButton(off.page, l)).map(async (b) => ({ disabled: await b.isDisabled(), ...(await look(b)) })));
  check('[색-1] 꺼진 버튼만 옅음(opacity 0.4)', offButtons.every((s) => s.disabled && s.opacity === '0.4'), JSON.stringify(offButtons.map((s) => s.opacity)));
  await off.ctx.close();

  // ── 자산 현황 ──
  const asset = await openAsset(browser);
  const firstBuy = asset.page.locator('[data-trade-buy]').first();
  const firstSell = asset.page.locator('[data-trade-sell]').first();
  await firstBuy.scrollIntoViewIfNeeded();
  await asset.page.waitForTimeout(300);
  const buy = await look(firstBuy);
  const sell = await look(firstSell);
  check('[색-3] 자산 [매수] 배경 = 빠른 주문 매수 배경', buy.bg === limitBuy.bg, `${buy.bg} / ${limitBuy.bg}`);
  check('[색-3] 자산 [매도] 배경 = 빠른 주문 매도 배경', sell.bg === limitSell.bg, `${sell.bg} / ${limitSell.bg}`);
  check('[색-3] 자산 [매수] [매도] 흰 글자 · 크기 sm(28px)', buy.color === WHITE && sell.color === WHITE && buy.height === 28 && sell.height === 28, JSON.stringify([buy, sell]));

  const secondary = await look(asset.page.locator('[data-trade-history-open]'));
  const newBuy = await look(asset.page.locator('[data-trade-new]'));
  check('[색-3] [새 종목 매수] 는 회색(공용 secondary 배경)', newBuy.bg === secondary.bg && newBuy.bg !== buy.bg && newBuy.bg !== sell.bg, `${newBuy.bg} / ${secondary.bg}`);

  const saveLook = async (locator: Locator) => {
    await locator.click();
    await asset.page.locator('[data-trade-dialog]').waitFor({ timeout: 5000 });
    await asset.page.waitForTimeout(300);
    const before = await look(asset.page.locator('[data-trade-save]'));
    await asset.page.locator('[data-trade-qty]').fill('1');
    await asset.page.locator('[data-trade-price]').fill('100');
    await asset.page.waitForTimeout(300);
    const after = await look(asset.page.locator('[data-trade-save]'));
    await asset.page.locator('[data-trade-cancel]').click();
    await asset.page.locator('[data-trade-dialog]').waitFor({ state: 'detached', timeout: 5000 });
    return { before, after };
  };
  const buySave = await saveLook(firstBuy);
  check('[색-3] 매수 창 [저장] = 매수 색 · 흰 글자', buySave.after.bg === limitBuy.bg && buySave.after.color === WHITE && buySave.after.opacity === '1', JSON.stringify(buySave.after));
  check('[색-3] 매수 창 [저장] 은 꺼졌을 때만 옅음', buySave.before.opacity === '0.4');
  const sellSave = await saveLook(firstSell);
  check('[색-3] 매도 창 [저장] = 매도 색 · 흰 글자', sellSave.after.bg === limitSell.bg && sellSave.after.color === WHITE && sellSave.after.opacity === '1', JSON.stringify(sellSave.after));
  await asset.ctx.close();
} finally {
  await browser.close();
  await vite.close();
}
console.log(`\n결과: PASS ${pass} · FAIL ${fail}`);
process.exit(fail > 0 ? 1 : 0);
