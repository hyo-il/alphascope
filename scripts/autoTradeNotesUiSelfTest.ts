/**
 * 자동매매 「최근 판단」 이름 · 보기 버튼 · 실적 회피 「미국 날짜」 시험(136차 · v2.70.2) — `npm run autotradenotes:test`
 * ⚠️ `DB_PATH=<사본>` 으로만 돈다(맨 첫 import · DB 는 쓰지 않는다).
 *
 * 136차 지시서 「꼭 지킬 동작」 1 · 2 · 3(화면)을 확인한다(시험 이름 앞의 [판단-n]). 137차 [137-5]: 주문 실패 — 매수 쪽만 「건너뜀」(「못 산 N」) · 매도 주문 실패는 「그대로」. 소스 검사 + Vite + Playwright(1280 × 1080 · 1440 × 900).
 * 화면은 `scripts/fixtures/autoTradeNotes.html`(자동매매 바만 그림) · `/api` 는 모두 `page.route` 가짜(만든 값) — 토스 · 구글 · Gemini · 서버 호출 0 · 주문 0.
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { createBrowserStepGuard } from './lib/browserStepGuard';
import { defaultRuleBody } from '../src/types/tradingRule';
import { defaultStrategy, type DecisionNote } from '../src/types/autoTrading';

const root = path.resolve(import.meta.dirname, '..');
const PORT = 5191;
const WEB = `http://127.0.0.1:${PORT}`;
const PAGE = `${WEB}/scripts/fixtures/autoTradeNotes.html`;

const guard = createBrowserStepGuard();
let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = '') {
  guard.mark(name);
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? ` — ${detail}` : ''}`);
}
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

// ── 소스 검사 ──
const bar = read('src/components/paper-trading/AutoTradeBar.tsx');
check('[판단-1] 줄 글자는 NOTE_KIND_LABEL[noteKind] 한 곳(화면에 「건너뜀」 · 「그대로」 글자를 따로 쓰지 않음)', bar.includes('{NOTE_KIND_LABEL[kind]}') && !/'건너뜀'|'그대로'/.test(bar));
check('[판단-1] 줄 종류는 action · code 로(noteKind) — 사유 글자로 가르지 않음', bar.includes('const kind = noteKind(n)') && !/n\.reason\.(includes|startsWith)/.test(bar));

// ── 화면 ──
const at = (h: number, m: number) => {
  const d = new Date('2026-11-13T00:00:00');
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};
const US = { at: at(22, 31), market: 'US' as const };
const KR2 = { at: at(9, 30), market: 'KR' as const };
const KR1 = { at: at(9, 5), market: 'KR' as const };
const EARNINGS = 'TSLA 실적 발표 11/19(예정 · 미국 날짜) 2거래일 전 — 신규 매수 건너뜀';
/** 묶음 셋(최근이 위): 미국 = 매수 1 · 건너뜀 2 · 그대로 1 / 국내 09:30 = 그대로만(「매수·매도」 · 「못 산 이유」 에서 감춤) / 국내 09:05 = 매도 1 · 건너뜀 2(거름망 · 매수 실패) · 그대로 2(신호 없음 · 매도 실패) */
const NOTES: DecisionNote[] = [
  { symbol: 'MSFT', action: 'BUY', reason: '점수 5/7 ≥ 기준 4점 — 매수 → 10주', code: 'score_buy', ...US },
  { symbol: 'NVDA', action: 'HOLD', reason: '보유 종목이 한도(5종목)에 도달해 신규 매수를 건너뜁니다', code: 'max_positions', ...US },
  { symbol: 'TSLA', action: 'HOLD', reason: EARNINGS, code: 'earnings_blackout', ...US },
  { symbol: 'AMZN', action: 'HOLD', reason: '점수 2/7 — 기준 4점 미만', code: 'no_signal_buy', ...US },
  { symbol: '000660', action: 'HOLD', reason: '점수 1/7 — 기준 4점 미만', code: 'no_signal_buy', ...KR2 },
  { symbol: '005930', action: 'HOLD', reason: '점수 5/7 — 매도 조건 없음, 보유 유지', code: 'no_signal_hold', ...KR2 },
  { symbol: '035420', action: 'SELL', reason: '점수 1/7 — 2점 아래로 떨어져 매도', code: 'score_sell', ...KR1 },
  { symbol: '035720', action: 'HOLD', reason: '점수 5/7 — 200일선 아래라 사지 않습니다', code: 'gate_block', gateReason: 'below200', ...KR1 },
  { symbol: '051910', action: 'HOLD', reason: '점수 1/7 — 기준 4점 미만', code: 'no_signal_buy', ...KR1 },
  // 137차 — 주문 실패 두 줄(서버 엔진이 만드는 사유 머리 그대로): 매도 실패는 「그대로」 · 매수 실패는 「건너뜀」
  { symbol: '005380', action: 'HOLD', reason: '매도 실패: 시세를 받지 못했습니다', code: 'error', ...KR1 },
  { symbol: '000270', action: 'HOLD', reason: '매수 실패: 주문 가능 금액이 부족합니다', code: 'error', ...KR1 },
];
const rule = { ...defaultRuleBody(), id: 1, name: '시험 규칙', createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z', usedBy: { buyJudge: false, accounts: [1], backtest: false } };
const strategy = { ...defaultStrategy(1), enabled: true, ruleId: 1, symbols: [...new Set(NOTES.map((n) => n.symbol))] };
const status = {
  accountId: 1, enabled: true, running: false, lastRunAt: US.at, lastError: null, blockedReason: null, blockedKind: null, serverEnabled: true,
  judgedToday: strategy.symbols.length, nextOpen: {}, lastNotes: NOTES, lastNotesAt: US.at,
};

async function open(browser: Browser, width: number, height: number) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  await page.route(/\/api\//, (r) => {
    const url = r.request().url();
    if (url.includes('/api/auth/me')) return r.fulfill({ json: { ok: true } });
    if (url.includes('/api/auto-trading/strategies/1')) return r.fulfill({ json: { strategy, status } });
    if (url.includes('/api/auto-trading/status/1')) return r.fulfill({ json: { status } });
    if (url.endsWith('/api/rules')) return r.fulfill({ json: { rules: [rule] } });
    return r.fulfill({ status: 503, json: { error: '시험 — 없음' } });
  });
  await guard.step(`페이지 열기(${width})`, () => page.goto(PAGE));
  await guard.step('최근 판단 펼치기', async () => {
    const b = page.getByRole('button', { name: /최근 판단 보기/ });
    await b.waitFor({ timeout: 30_000 });
    await b.click();
  });
  return { page, ctx };
}

/** 보이는 묶음 머리(접기 버튼 글자) · 모두 펼친 뒤 줄 종류 */
async function snapshot(page: Page) {
  const groups = page.locator('[data-notes-group]');
  const n = await groups.count();
  for (let k = 0; k < n; k++) {
    const btn = groups.nth(k).getByRole('button').first();
    if ((await btn.getAttribute('aria-expanded')) === 'false') await btn.click();
  }
  await page.waitForTimeout(100);
  const heads: string[] = [];
  for (let k = 0; k < n; k++) heads.push(((await groups.nth(k).getByRole('button').first().textContent()) ?? '').trim());
  const kinds = await page.locator('li[data-note-kind]').evaluateAll((els) => els.map((e) => `${e.getAttribute('data-note-kind')}:${e.querySelector('span')?.textContent ?? ''}`));
  return { heads, kinds };
}
const view = (page: Page, name: string) => page.getByRole('radio', { name, exact: true });

const { createServer } = await import('vite');
const vite = await guard.step('Vite 띄우기', async () => {
  const v = await createServer({ root, configFile: path.join(root, 'vite.config.ts'), logLevel: 'error', server: { host: '127.0.0.1', port: PORT, strictPort: true, hmr: false } });
  await v.listen();
  return v;
});
const browser = await guard.step('브라우저 띄우기', () => chromium.launch({ channel: 'chrome' }));
try {
  for (const [w, h] of [[1280, 1080], [1440, 900]] as const) {
    const size = `${w}`;
    const { page, ctx } = await open(browser, w, h);

    // 보기 버튼 세 칸 · 처음 「전체」
    const radios = await page.getByRole('radiogroup', { name: '최근 판단 보기 범위' }).getByRole('radio').allTextContents();
    check(`[판단-2] ${size} 보기 버튼 「전체 | 매수·매도 | 못 산 이유」`, radios.join('|') === '전체|매수·매도|못 산 이유', radios.join('|'));
    check(`[판단-2] ${size} 처음은 「전체」`, (await view(page, '전체').getAttribute('aria-checked')) === 'true');

    // 전체 — 묶음 셋 · 머리 수 = 줄 수
    const all = await snapshot(page);
    const tail = (h: string) => h.replace(/^\S+ /, '');
    check(`[판단-1] ${size} 묶음 머리 「매수 · 매도 · 그대로 · 못 산」(0 도 적음)`, JSON.stringify(all.heads.map(tail)) === JSON.stringify([
      '미국 판단 · 4종목 · 매수 1 · 매도 0 · 그대로 1 · 못 산 2',
      '국내 판단 · 2종목 · 매수 0 · 매도 0 · 그대로 2 · 못 산 0',
      '국내 판단 · 5종목 · 매수 0 · 매도 1 · 그대로 2 · 못 산 2',
    ]), all.heads.join(' / '));
    const count = (k: string) => all.kinds.filter((x) => x.startsWith(`${k}:`)).length;
    check(`[판단-1] ${size} 머리 수 합 = 보이는 줄 수(매수 1 · 매도 1 · 그대로 5 · 건너뜀 4)`, all.kinds.length === NOTES.length && count('buy') === 1 && count('sell') === 1 && count('hold') === 5 && count('skip') === 4, all.kinds.join(' '));
    // [137-5] 매도 주문 실패 = 「그대로」(아직 들고 있음 · 사유 「매도 실패: …」 가 줄에 보임) · 매수 주문 실패 = 「건너뜀」
    const sellFail = page.locator('li[data-note-kind]').filter({ hasText: '매도 실패:' });
    const buyFail = page.locator('li[data-note-kind]').filter({ hasText: '매수 실패:' });
    const sellFailText = (await sellFail.textContent()) ?? '';
    check(`[137-5] ${size} 매도 주문 실패 줄 = 「그대로」 · 「매도 주문을 내지 못해 그대로 들고 있습니다」 · 사유 「매도 실패: …」 보임`,
      (await sellFail.count()) === 1 && (await sellFail.getAttribute('data-note-kind')) === 'hold' && sellFailText.startsWith('그대로') && sellFailText.includes('매도 주문을 내지 못해 그대로 들고 있습니다') && sellFailText.includes('005380 · 매도 실패: 시세를 받지 못했습니다'), sellFailText);
    check(`[137-5] ${size} 매수 주문 실패 줄 = 「건너뜀」(그대로 「못 산」 에 셈)`, (await buyFail.count()) === 1 && (await buyFail.getAttribute('data-note-kind')) === 'skip' && ((await buyFail.textContent()) ?? '').startsWith('건너뜀'));
    check(`[판단-1] ${size} 줄 글자 — 신호 없음 「그대로」 · 막힌 매수 「건너뜀」`, all.kinds.every((x) => ({ buy: '매수', sell: '매도', hold: '그대로', skip: '건너뜀' } as Record<string, string>)[x.split(':')[0]] === x.split(':')[1]), all.kinds.join(' '));

    // 실적 회피 줄 — 「미국 날짜」 는 공용 표시 하나(글자 중복 없음)
    const tsla = page.locator('li[data-note-kind="skip"]').filter({ hasText: 'TSLA 실적 발표' });
    const tslaText = (await tsla.textContent()) ?? '';
    check(`[판단-3] ${size} 실적 회피 사유 「11/19(예정 · 미국 날짜)」 · 미국 날짜 표시(UsDateTag) 하나 · 글자 한 번`, (await tsla.locator('[data-us-date]').count()) === 1 && tslaText.split('미국 날짜').length === 2 && tslaText.includes('11/19(예정 · '), tslaText);

    // 매수·매도 — 그대로 · 건너뜀 줄 숨김 · 빈 묶음(국내 09:30) 감춤
    await view(page, '매수·매도').click();
    const trades = await snapshot(page);
    check(`[판단-2] ${size} 「매수·매도」 — 매수 1 · 매도 1 줄만 · 빈 묶음 감춤(묶음 2)`, trades.heads.length === 2 && trades.kinds.join(' ') === 'buy:매수 sell:매도', `${trades.heads.length} · ${trades.kinds.join(' ')}`);

    // 못 산 이유 — 건너뜀 줄만(이유 글 그대로)
    await view(page, '못 산 이유').click();
    const skips = await snapshot(page);
    const skipText = await page.locator('li[data-note-kind]').allTextContents();
    check(`[판단-2] ${size} 「못 산 이유」 — 건너뜀 4줄만 · 빈 묶음 감춤(묶음 2)`, skips.heads.length === 2 && skips.kinds.length === 4 && skips.kinds.every((k) => k === 'skip:건너뜀'), `${skips.heads.length} · ${skips.kinds.join(' ')}`);
    check(`[137-5] ${size} 「못 산 이유」 에 매도 실패 줄 없음 · 매수 실패 줄 있음`, !skipText.some((t) => t.includes('매도 실패:')) && skipText.some((t) => t.includes('매수 실패:')), skipText.join(' | ').slice(0, 300));
    check(`[판단-2] ${size} 「못 산 이유」 — 이유 글 그대로(보유 가득 · 실적 · 거름망)`, ['보유 종목이 한도', 'TSLA 실적 발표 11/19', '200일선 아래라 사지 않습니다'].every((s) => skipText.some((t) => t.includes(s))), skipText.join(' | ').slice(0, 300));

    // 새로고침하면 「전체」
    await page.reload();
    await page.getByRole('button', { name: /최근 판단 보기/ }).click();
    check(`[판단-2] ${size} 새로고침하면 「전체」`, (await view(page, '전체').getAttribute('aria-checked')) === 'true' && (await page.locator('[data-notes-group]').count()) === 3);

    // 가로로 넘치지 않음
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(`[판단-2] ${size} 가로 넘침 없음`, overflow <= 0, String(overflow));
    await ctx.close();
  }
} finally {
  await guard.step('브라우저 닫기', () => browser.close());
  await guard.step('Vite 닫기', () => vite.close());
  guard.stop();
}
console.log(`\n결과: PASS ${pass} · FAIL ${fail}`);
process.exit(fail > 0 ? 1 : 0);
