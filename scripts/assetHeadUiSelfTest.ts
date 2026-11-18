/**
 * 계좌 머리 줄 맞춤 · 글자 맞춤 화면 시험(144차 · v2.72.1) — `npm run assetheadui:test` · ⚠️ `DB_PATH=<사본>` 으로만 돈다(맨 첫 import).
 * 144차 「꼭 지킬 동작」 1(정렬 — 1280 × 1080 · 1440 × 900 · 계좌 4개) · 2(글자 · `items-baseline` 0)를 줄마다 확인한다.
 * 3(캐시)은 `assetcashmanual:test` · 4(바뀐 파일)는 `assetcashmanual:test` 끝.
 * Vite + Playwright, `/api` 는 모두 `page.route` 가짜(만든 값) — 구글 · 토스 · 서버 호출 0. 요소는 역할 + 이름 · `data-testid` · data 속성으로 찾는다.
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser } from 'playwright';
import { CASH_SAMPLE_KIWOOM as KIWOOM, CASH_SAMPLE_LONG, assetHistorySample, assetSheetSample, assetStatusSample, assetSummarySample, cashViewManualSample } from './fixtures/asset/screenSample';
import { createBrowserStepGuard } from './lib/browserStepGuard';
import type { AssetCashKey, AssetSheetCashBanks, AssetSheetData } from '../src/types/asset';

const root = path.resolve(import.meta.dirname, '..');
const PORT = 5190;
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

/** 짝 셋(이름 길이 · 금액 길이 · 부호가 다름) + 짝 없는 계좌 하나(연금 저축) — 적립식은 「1줄 빠짐」 도 있다 */
const SAVING: AssetCashKey = { name: '예시키움 (적립식)', nth: 1 };
const LONG: AssetCashKey = { name: CASH_SAMPLE_LONG, nth: 1 };
function sheet(): AssetSheetData & AssetSheetCashBanks {
  const s = assetSheetSample();
  return {
    ...s,
    cashAccounts: [...s.cashAccounts, { row: 9, name: KIWOOM.name, amount: 711_839 }, { row: 10, name: SAVING.name, amount: 3_000_000 }],
    cashDepositPairs: { '개별 투자': KIWOOM, '적립식 계좌': SAVING, 'ISA 계좌': LONG },
    cashBankFix: { rows: {}, renames: {} },
  };
}

async function open(browser: Browser, size: { width: number; height: number }) {
  const ctx = await browser.newContext({ viewport: size });
  // tsx(esbuild) 가 함수에 넣는 __name 도우미 — 브라우저에는 없어서 측정 함수 안의 이름 붙은 함수가 깨진다
  await ctx.addInitScript('window.__name = (f) => f');
  await ctx.addInitScript(() => {
    localStorage.setItem('alphascope.asset.tab', 'status');
    localStorage.setItem('alphascope.asset.statusView', 'account');
  });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)));
  await page.route(/\/api\/(?!asset\/)/, (r) => (r.request().url().includes('/api/auth/me') ? r.fulfill({ json: { ok: true } }) : r.fulfill({ status: 503, json: { error: '시험 — 없음' } })));
  await page.route('**/api/asset/status', (r) => r.fulfill({ json: assetStatusSample(true) }));
  await page.route('**/api/asset/touch', (r) => r.fulfill({ json: { ok: true, lockMinutes: 30, remainingMs: 30 * 60_000 } }));
  await page.route('**/api/asset/sheet', (r) => r.fulfill({ json: sheet() }));
  await page.route('**/api/asset/summary**', (r) => r.fulfill({ json: assetSummarySample({ purchaseDone: true, writeEnabled: true }) }));
  await page.route('**/api/asset/history**', (r) => r.fulfill({ json: assetHistorySample(5) }));
  await page.route('**/api/asset/cash', (r) => r.fulfill({ json: cashViewManualSample() }));
  await guard.step('페이지 열기(#/asset)', () => page.goto(`${WEB}/#/asset`));
  await guard.step('자산 화면 기다리기', () => page.locator('[data-account-deposit]').first().waitFor({ timeout: 30_000 }));
  return { page, ctx, errors };
}

/** 계좌 머리마다 — 칸별 세로 가운데 · [입출금] x · 머리 높이 · 글자 계산 style */
interface HeadBox {
  key: string;
  centers: Record<string, number>;
  spread: number;
  buttonX: number | null;
  height: number;
  overflow: boolean;
  sub: string[];
  amount: string[];
  baseline: number;
}

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
    {
      const { page, ctx, errors } = await open(browser, size);
      const boxes = await page.locator('tbody[data-account]').evaluateAll((bodies): HeadBox[] =>
        bodies
          .map((b) => ({ b, th: b.querySelector<HTMLElement>('th[data-account-head]') }))
          .filter((x) => x.th && x.b.getAttribute('data-account'))
          .map(({ b, th }) => {
            const head = th as HTMLElement;
            const mid = (el: Element | null) => {
              if (!el) return null;
              const r = el.getBoundingClientRect();
              return r.top + r.height / 2;
            };
            const sel: Record<string, string> = {
              name: '[data-account-name]',
              count: '[data-count]',
              word: '[data-account-deposit-word]',
              depositAmount: '[data-account-deposit-amount]',
              label: '[data-account-deposit-label]',
              button: '[data-testid="asset-cash-move-open"]',
              value: '[data-value]',
              arrow: '[data-account-arrow]',
            };
            const centers: Record<string, number> = {};
            for (const [k, s] of Object.entries(sel)) {
              const c = mid(head.querySelector(s));
              if (c != null) centers[k] = c;
            }
            const all = Object.values(centers);
            const btn = head.querySelector('[data-testid="asset-cash-move-open"]');
            const style = (s: string) => {
              const el = head.querySelector(s);
              if (!el) return null;
              const cs = getComputedStyle(el);
              return `${cs.fontSize}/${cs.fontWeight}/${cs.color}`;
            };
            const amountStyle = (s: string) => {
              const el = head.querySelector(s);
              if (!el) return null;
              const cs = getComputedStyle(el);
              return `${cs.fontSize}/${cs.fontWeight}/${cs.fontVariantNumeric}`;
            };
            return {
              key: b.getAttribute('data-account') ?? '',
              centers,
              spread: Math.max(...all) - Math.min(...all),
              buttonX: btn ? btn.getBoundingClientRect().left : null,
              height: head.getBoundingClientRect().height,
              overflow: head.scrollWidth > head.clientWidth + 1,
              sub: ['[data-count]', '[data-account-deposit-word]', '[data-account-deposit-label]'].map(style).filter((x): x is string => x != null),
              amount: ['[data-account-deposit-amount]', '[data-value]'].map(amountStyle).filter((x): x is string => x != null),
              baseline: [head, ...head.querySelectorAll<HTMLElement>('*')].filter((el) => getComputedStyle(el).display.includes('flex') && getComputedStyle(el).alignItems === 'baseline').length,
            };
          }),
      );
      const paired = boxes.filter((b) => b.buttonX != null);
      check(`[144-1] ${w}px 계좌 4개 · 짝 있는 3개 · 없는 1개(연금 저축)`, boxes.length === 4 && paired.length === 3 && boxes.find((b) => b.key === '연금 저축 계좌')?.buttonX === null, JSON.stringify(boxes.map((b) => [b.key, b.buttonX])));
      const worst = Math.max(...boxes.map((b) => b.spread));
      check(`[144-1] ${w}px 이름 · 「n종목」 · 「예수금」 · 금액 · 예수금 이름 · [입출금] · 계좌 금액 · 화살표 세로 가운데 ±1px(가장 큰 차이 ${worst.toFixed(2)}px)`,
        worst <= 1 && paired.every((b) => Object.keys(b.centers).length === 8), JSON.stringify(boxes.map((b) => [b.key, b.centers])));
      const xs = paired.map((b) => b.buttonX as number);
      check(`[144-1] ${w}px [입출금] 이 계좌마다 같은 x ±1px(${xs.map((x) => x.toFixed(1)).join(' · ')})`, Math.max(...xs) - Math.min(...xs) <= 1);
      const hs = boxes.map((b) => b.height);
      check(`[144-1] ${w}px 짝 있는 계좌 · 없는 계좌 머리 높이 같음(${[...new Set(hs)].join(' · ')}px)`, Math.max(...hs) - Math.min(...hs) <= 0.5);
      check(`[144-1] ${w}px 머리 넘침 0 · 화면 가로 넘침 0`, boxes.every((b) => !b.overflow) && (await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)));
      const subs = new Set(boxes.flatMap((b) => b.sub));
      check(`[144-2] ${w}px 보조 글(「n종목」 · 「예수금」 · 예수금 이름) 글자 크기 · 굵기 · 색 하나(${[...subs].join(' | ')})`, subs.size === 1 && [...subs][0].startsWith('13px/'));
      const amts = new Set(boxes.flatMap((b) => b.amount));
      check(`[144-2] ${w}px 금액 둘(예수금 · 계좌 금액) 글자 크기 · 굵기 · 숫자 폭 하나(${[...amts].join(' | ')})`, amts.size === 1 && /^14px\/600\/tabular-nums/.test([...amts][0]));
      check(`[144-2] ${w}px 계좌 머리 안 items-baseline 0(계산된 style)`, boxes.every((b) => b.baseline === 0));
      // 마이너스 예수금(ISA — 긴 이름 줄은 표본에서 −가 아님)도 같은 크기 · 굵기 · 하락 색은 142차 시험(assetcashguardui)
      check(`[144-1] ${w}px 화면 오류 0`, errors.length === 0, errors.join(' / '));

      // 「현금 합계」 펼침 상품 줄 — 이름 · 금액 · [입출금] 세로 가운데 · 이름과 금액 같은 글자 크기
      await page.getByTestId('asset-cash-toggle').click();
      await page.getByRole('button', { name: '예시은행 상품 펼치기' }).click();
      const rows = await page.locator('[data-testid="asset-cash-bank"] tr[data-cash-row]').evaluateAll((trs) =>
        trs.map((tr) => {
          const tds = [...tr.querySelectorAll('td')];
          const name = tds[0]?.querySelector('span');
          const btn = tr.querySelector('[data-testid="asset-cash-move-open"]');
          const mid = (el: Element | null | undefined) => {
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return r.top + r.height / 2;
          };
          const cs = (el: Element | null | undefined) => (el ? `${getComputedStyle(el).fontSize}/${getComputedStyle(el).fontWeight}/${getComputedStyle(el).color}` : '');
          const c = [mid(name), mid(tds[1]), mid(btn)].filter((x): x is number => x != null);
          return { n: c.length, spread: Math.max(...c) - Math.min(...c), name: cs(name), amount: cs(tds[1]), btnX: btn ? btn.getBoundingClientRect().left : null };
        }),
      );
      const rWorst = Math.max(...rows.map((r) => r.spread));
      check(`[144-1] ${w}px 「현금 합계」 상품 줄 이름 · 금액 · [입출금] 세로 가운데 ±1px(${rows.length}줄 · 가장 큰 차이 ${rWorst.toFixed(2)}px)`, rows.length === 3 && rows.every((r) => r.n === 3) && rWorst <= 1, JSON.stringify(rows));
      const rx = rows.map((r) => r.btnX as number);
      check(`[144-2] ${w}px 「현금 합계」 상품 줄 이름 · 금액 글자 하나 · [입출금] 같은 x`, rows.every((r) => r.name === r.amount && r.name === rows[0].name) && Math.max(...rx) - Math.min(...rx) <= 1, JSON.stringify(rows));
      await ctx.close();
    }
  }

  // 소스 — 계좌 머리(th[data-account-head] ~ </th>)에 items-baseline · self-center 0 · 글자는 ACCOUNT_HEAD_TEXT 세 가지
  const src = fs.readFileSync(path.join(root, 'src/components/asset/AssetSheetValues.tsx'), 'utf8');
  const head = src.slice(src.indexOf('data-account-head'), src.indexOf('</th>', src.indexOf('data-account-head')));
  check('[144-2] 계좌 머리 소스에 items-baseline · self-center 0 · 글자 크기 클래스는 ACCOUNT_HEAD_TEXT 만(경고 「N줄 빠짐」 제외)',
    head.length > 0 && !/items-baseline|self-center/.test(head) && (head.match(/text-(xs|sm|caption)\b/g) ?? []).length === 1 && /ACCOUNT_HEAD_TEXT\.name/.test(head) && (head.match(/ACCOUNT_HEAD_TEXT\.sub/g) ?? []).length === 3 && (head.match(/ACCOUNT_HEAD_TEXT\.amount/g) ?? []).length === 2);
} catch (e) {
  fail++;
  console.log(`FAIL  시험 중 예외 — ${(e as Error).message.split('\n')[0]}`);
} finally {
  await browser.close().catch(() => {});
  await vite.close().catch(() => {});
}
console.log(`\n${pass} 통과 · ${fail} 실패`);
process.exit(fail ? 1 : 0);
