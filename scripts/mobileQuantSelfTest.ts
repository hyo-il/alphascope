/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
/**
 * 159차 퀀트 화면(매매 규칙 · 백테스트 · 검증 기록) 폰 · 패드 시험(`npm run mobilequant:test` · v2.84.0) — 지시서 「꼭 지킬 동작」 1 ~ 7 줄마다.
 *
 * 화면은 이 시험이 띄운 Vite(5202)에 열고, `/api` 는 모두 가짜 응답 — `scripts/fixtures/mobileQuant/api.json`(사본 DB 테스트 서버에서 한 번 기록한 응답 ·
 * 자산 · 실제 계좌 · 토스 주소 없음 · 분석 기록 3건만) · 매수 판단은 `scripts/fixtures/mobileBuyJudge/`(150차 견본). 모르는 주소는 503(사용자 서버로 가지 않음) ·
 * 쓰기는 시험이 바꿔치기한 것만 200. 시계는 고정. 폰 · 패드는 `isMobile` · `hasTouch`(손가락 화면).
 * 누르는 칸 · 겹침은 `design:check` 18 · 19 와 같은 셈을 **그 화면 본문 · 열린 창 안**으로만 잰다(앱 틀 · 창 뒤 화면은 다른 차수 몫).
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { createBrowserStepGuard } from './lib/browserStepGuard';
import { chasuChanged, chasuLabel, chasuUntracked, type Chasu } from './lib/chasuRange';
import { stockNamesReply } from './lib/stockNamesReply';

const root = path.resolve(import.meta.dirname, '..');
const PORT = 5202;
const WEB = `http://127.0.0.1:${PORT}`;
/** 기준 커밋(v2.83.0 끝) — 7 은 여기서부터 이번 차수 범위 */
const CHASU: Chasu = { base: '7fc026c', version: 'v2.84.0' };
const API: Record<string, unknown> = JSON.parse(fs.readFileSync(path.join(root, 'scripts/fixtures/mobileQuant/api.json'), 'utf8'));
const BJ = path.join(root, 'scripts/fixtures/mobileBuyJudge');
const BJ_API: Record<string, unknown> = JSON.parse(fs.readFileSync(path.join(BJ, 'api.json'), 'utf8'));
const BJ_STATE = JSON.parse(fs.readFileSync(path.join(BJ, 'state.json'), 'utf8')).state;
const BJ_HIST = JSON.parse(fs.readFileSync(path.join(BJ, 'history.json'), 'utf8'));
const FIXED = new Date('2026-11-28T08:00:00.000Z');
/** 매수 판단 견본(150차)의 시계 */
const BJ_FIXED = new Date('2026-11-26T08:00:00.000Z');
const CLIENT_VERSION = /version: '(v[\d.]+)'/.exec(fs.readFileSync(path.join(root, 'src/data/changelog.ts'), 'utf8'))?.[1] ?? '';

const guard = createBrowserStepGuard();
let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = '') {
  guard.mark(name);
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? ` — ${detail}` : ''}`);
}

const PHONE = { width: 402, height: 874 };
const PAD = { width: 1133, height: 744 };
const PAD_NARROW = { width: 768, height: 1024 };
const DESK = { width: 1280, height: 1080 };
const WIDE = { width: 1440, height: 900 };

type Reply = { status?: number; json?: unknown };
type Override = (url: string, method: string, body: string | null) => Reply | undefined;

async function open(browser: Browser, size: { width: number; height: number }, hash: string, o: { override?: Override; buyJudge?: boolean; wait?: number } = {}) {
  const mobile = size.width < 1280;
  const ctx = await browser.newContext(mobile ? { viewport: size, isMobile: true, hasTouch: true } : { viewport: size });
  await ctx.addInitScript('window.__name = (f) => f');
  const page = await ctx.newPage();
  await page.clock.setFixedTime(o.buyJudge ? BJ_FIXED : FIXED);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)));
  const api = o.buyJudge ? BJ_API : API;
  await page.route(/\/api\//, async (r) => {
    const req = r.request();
    const u = req.url().replace(WEB, '');
    const ov = o.override?.(u, req.method(), req.postData());
    if (ov) return r.fulfill({ status: ov.status ?? 200, json: ov.json ?? {} }).catch(() => {});
    if (req.method() !== 'GET') return r.fulfill({ status: 503, json: { error: '시험 — 쓰지 않음' } });
    if (u.startsWith('/api/version')) return r.fulfill({ json: { version: CLIENT_VERSION, startedAt: '2026-11-25T00:00:00.000Z' } });
    if (u === '/api/auth/me') return r.fulfill({ json: { loggedIn: true } });
    if (o.buyJudge) {
      if (u === '/api/buy-judge') return r.fulfill({ json: BJ_STATE });
      if (u === '/api/buy-judge/history') return r.fulfill({ json: BJ_HIST.history });
      if (u.startsWith('/api/buy-judge/days?')) return r.fulfill({ json: BJ_HIST.days });
      if (/^\/api\/buy-judge\/history\/[^/?]+$/.test(u)) return r.fulfill({ json: BJ_HIST.symbolDays });
    }
    const names = stockNamesReply(api, u);
    if (names) return r.fulfill(names);
    if (u in api) return r.fulfill({ json: api[u] });
    return r.fulfill({ status: 503, json: { error: '시험 — 없음' } });
  });
  await guard.step(`페이지 열기(${size.width}×${size.height} ${hash})`, () => page.goto(`${WEB}/${hash}`));
  await page.waitForTimeout(o.wait ?? 3000);
  return { page, ctx, errors };
}

const tap = async (page: Page, name: string | RegExp) => {
  await guard.step(`누르기 ${String(name)}`, () => page.getByRole('button', { name, exact: typeof name === 'string' }).first().click({ timeout: 5000 }));
  await page.waitForTimeout(900);
};

/** 누르는 칸(design:check 18 · 19 와 같은 셈) — 범위(scope) 안 · 스크롤로 가려지지 않은 것만 */
async function touchIssues(page: Page, scope: string) {
  return page.evaluate((sel) => {
    const scopes = [...document.querySelectorAll(sel)];
    const area = scopes[scopes.length - 1];
    if (!area) return { small: ['범위 없음'], overlap: [] as string[], count: 0 };
    const label = (el: Element) => ((el as HTMLElement).innerText || el.getAttribute('aria-label') || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 24);
    const shown = (el: Element, r: DOMRect) => {
      let x0 = r.left;
      let y0 = r.top;
      let x1 = r.right;
      let y1 = r.bottom;
      for (let p = el.parentElement; p; p = p.parentElement) {
        const cs = getComputedStyle(p);
        if (cs.overflowX === 'visible' && cs.overflowY === 'visible') continue;
        const pr = p.getBoundingClientRect();
        x0 = Math.max(x0, pr.left);
        y0 = Math.max(y0, pr.top);
        x1 = Math.min(x1, pr.right);
        y1 = Math.min(y1, pr.bottom);
      }
      x1 = Math.min(x1, innerWidth);
      y1 = Math.min(y1, innerHeight);
      return x1 > x0 && y1 > y0 && (x1 - x0) * (y1 - y0) >= 0.95 * r.width * r.height;
    };
    const MIN = 44;
    const small: string[] = [];
    const overlap: string[] = [];
    const hits: { el: Element; x: number; y: number; w: number; h: number }[] = [];
    const q = 'button, a[href], [role="tab"], [role="radio"], [role="button"], [role="checkbox"], input:not([type="hidden"]), select, textarea';
    for (const el of area.querySelectorAll<HTMLElement>(q)) {
      if ((el as HTMLButtonElement).disabled || el.closest('[inert], [aria-hidden="true"]')) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1 || getComputedStyle(el).visibility === 'hidden' || !shown(el, r)) continue;
      const after = getComputedStyle(el, '::after');
      const on = after.content !== 'none' && after.content !== 'normal' && after.position === 'absolute';
      const w = Math.max(r.width, on ? parseFloat(after.width) || 0 : 0);
      const h = Math.max(r.height, on ? parseFloat(after.height) || 0 : 0);
      hits.push({ el, x: r.left + r.width / 2 - w / 2, y: r.top + r.height / 2 - h / 2, w, h });
      if (Math.min(w, h) < MIN - 0.5) small.push(`${label(el)} ${Math.round(w)}×${Math.round(h)}`);
    }
    for (let i = 0; i < hits.length; i++) {
      for (let j = i + 1; j < hits.length; j++) {
        const a = hits[i];
        const b = hits[j];
        if (a.el.contains(b.el) || b.el.contains(a.el)) continue;
        const g = a.el.closest('[role="radiogroup"]');
        if (g && g === b.el.closest('[role="radiogroup"]')) continue;
        const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
        const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
        if (ox > 2 && oy > 2) overlap.push(`${label(a.el)} ↔ ${label(b.el)} (${Math.round(ox)}×${Math.round(oy)})`);
      }
    }
    return { small, overlap, count: hits.length };
  }, scope);
}

/** 누르는 칸 하나(요소 + 보이지 않는 바깥 칸 ::after) */
const hitOf = (page: Page, sel: string, nth = 0) =>
  page.locator(sel).nth(nth).evaluate((e) => {
    const r = e.getBoundingClientRect();
    const a = getComputedStyle(e, '::after');
    const on = a.content !== 'none' && a.content !== 'normal' && a.position === 'absolute';
    const w = Math.max(r.width, on ? parseFloat(a.width) || 0 : 0);
    const h = Math.max(r.height, on ? parseFloat(a.height) || 0 : 0);
    return { x: r.left + r.width / 2 - w / 2, y: r.top + r.height / 2 - h / 2, w, h };
  });
const overlaps = (a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) =>
  Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 2 && Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 2;

/** 한 단어 폭으로 접힌 글 — 범위 안 글 조각(낱말 3개 이상)마다 줄 수를 세어 「줄 수 ≥ 낱말 수」 면 접힘 */
async function foldedTexts(page: Page, scope: string) {
  return page.evaluate((sel) => {
    const out: string[] = [];
    let seen = 0;
    for (const area of document.querySelectorAll(sel)) {
      const walk = document.createTreeWalker(area, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        const text = (n.textContent ?? '').trim();
        const words = text.split(/\s+/).filter((w) => w.length > 0 && w !== '·');
        if (words.length < 3) continue;
        const range = document.createRange();
        range.selectNodeContents(n);
        const tops = new Set([...range.getClientRects()].filter((r) => r.width > 0).map((r) => Math.round(r.top)));
        if (!tops.size) continue;
        seen++;
        if (tops.size >= 3 && tops.size >= words.length) out.push(`${text.slice(0, 30)}(${words.length}낱말 · ${tops.size}줄)`);
      }
    }
    return { folded: out, seen };
  }, scope);
}

/** 가로 넘침 — 문서 · 범위 상자 */
const sideOverflow = (page: Page, sel: string) =>
  page.evaluate((s) => {
    const el = [...document.querySelectorAll<HTMLElement>(s)].pop();
    return { doc: document.documentElement.scrollWidth - innerWidth, box: el ? el.scrollWidth - el.clientWidth : -1 };
  }, sel);

const BODY = '[data-layout-body]';
const DIALOG = '[role="dialog"]';
const FIXED5 = [
  '과거 결과이며 앞으로를 보장하지 않습니다.',
  '여러 조건을 바꿔 보며 가장 좋은 숫자를 고르면 우연에 속기 쉽습니다.',
  '종목마다 따로 계산했습니다 — 실제 계좌의 비중·동시 보유 한도는 반영하지 않았습니다.',
  '오늘의 시가총액 상위 종목으로 과거를 시험하면 그동안 사라진 종목이 빠져 실제보다 좋게 보일 수 있습니다(생존 편향).',
  '어느 방법도 이 앱에서 돈을 번다고 확인된 적은 없습니다.',
];

/** 새 규칙 창에 같은 값을 넣고 [저장] — 저장 요청 몸(문자열) */
async function saveNewRule(page: Page): Promise<string | null> {
  await tap(page, '새 규칙 만들기');
  const dlg = page.getByRole('dialog', { name: '새 규칙 만들기' });
  await guard.step('이름 넣기', () => dlg.getByPlaceholder('예: 눌림 매수').fill('시험 규칙'));
  await guard.step('추세 켜기', () => dlg.getByRole('checkbox', { name: '추세 사용' }).check({ timeout: 5000 }));
  await guard.step('이동평균 교차 켜기', () => dlg.getByRole('checkbox', { name: '이동평균 교차 사용' }).check({ timeout: 5000 }));
  await guard.step('추세 점수', () => dlg.getByLabel('추세 점수').first().fill('28'));
  await guard.step('매수 기준', () => dlg.getByLabel('매수 기준 점수').first().fill('60'));
  await guard.step('거름망 켜기', () => dlg.getByRole('checkbox', { name: '주가가 200일선 위일 때만 매수 사용' }).check({ timeout: 5000 }));
  await guard.step('익절 켜기', () => dlg.getByRole('checkbox', { name: '익절 사용' }).check({ timeout: 5000 }));
  await page.waitForTimeout(300);
  await guard.step('저장', () => dlg.getByRole('button', { name: '저장', exact: true }).click({ timeout: 5000 }));
  await page.waitForTimeout(1200);
  return lastPost;
}
let lastPost: string | null = null;
const rulePost: Override = (u, method, body) => {
  if (u === '/api/rules' && method === 'POST') {
    lastPost = body;
    const rules = (API['/api/rules'] as { rules: unknown[] }).rules;
    return { json: { rule: { ...(rules[0] as object), id: 99, name: '시험 규칙' } } };
  }
  return undefined;
};

/** 시험 묶음 하나 — 예외가 나도 다음 묶음은 돈다 */
async function part(name: string, fn: () => Promise<void>) {
  try {
    await fn();
  } catch (e) {
    check(`실패: 예외(${name})`, false, String(e).slice(0, 300));
  }
}

const { createServer } = await import('vite');
const vite = await guard.step('Vite 띄우기', async () => {
  const v = await createServer({ root, configFile: path.join(root, 'vite.config.ts'), logLevel: 'error', server: { host: '127.0.0.1', port: PORT, strictPort: true, hmr: false } });
  await v.listen();
  return v;
});
const browser = await guard.step('브라우저 띄우기', () => chromium.launch({ channel: 'chrome' }));

await part('1. 1280 그대로 — 1280 · 1440 은 de', async () => {
  // ── 1. 1280 그대로 — 1280 · 1440 은 desktop:test 가 본다. 여기서는 이번 차수가 다시 뜬 정답이 목표 바꾸기 창 하나뿐인지 · 그 체크가 1px 내림 없이 맨 체크박스 자리인지 ──
  {
    const changed = [...chasuChanged(root, CHASU, ['scripts/fixtures/desktop']), ...chasuUntracked(root, CHASU, ['scripts/fixtures/desktop'])];
    const want = ['scripts/fixtures/desktop/1280x1080/buyjudge__목표_바꾸기_창.json', 'scripts/fixtures/desktop/1440x900/buyjudge__목표_바꾸기_창.json'];
    check(`[1] 1280 그대로 — 이번 차수(${chasuLabel(root, CHASU)})에 바뀐 1280 · 1440 정답 = 목표 바꾸기 창 두 크기뿐`, changed.length === 2 && want.every((w) => changed.includes(w)), changed.join(', '));
    const { page, ctx } = await open(browser, DESK, '#/swing/list', { buyJudge: true, wait: 3500 });
    await guard.step('첫 줄 펼치기', () => page.locator('[data-buy-judge-table] tbody tr').first().click({ timeout: 5000 }));
    await page.waitForTimeout(900);
    await tap(page, '조건 바꾸기');
    const cb = await page.getByRole('dialog').locator('input[type="checkbox"]').first().evaluate((e) => ({ pos: getComputedStyle(e).position, top: getComputedStyle(e).top, cls: e.className }));
    check('[1] 1280 목표 바꾸기 창 「목표의 절반으로 자동」 체크 — 1px 내림 없음(position static · top-px 없음 = 150차 전 맨 체크박스 자리)', cb.pos === 'static' && !/top-px/.test(cb.cls), JSON.stringify(cb));
    await ctx.close();
  }
});
await part('2. 규칙 저장 같음 — 402 와 1280 에서 같은', async () => {
  // ── 2. 규칙 저장 같음 — 402 와 1280 에서 같은 값을 넣어 저장한 요청 몸이 바이트까지 같음 ──
  {
    const bodies: (string | null)[] = [];
    for (const size of [PHONE, DESK]) {
      lastPost = null;
      const { page, ctx } = await open(browser, size, '#/rules', { override: rulePost });
      bodies.push(await saveNewRule(page));
      await ctx.close();
    }
    check('[2] 규칙 저장 같음 — 402 · 1280 저장 요청 몸 바이트까지 같음', bodies[0] != null && bodies[0] === bodies[1], `${bodies[0]?.slice(0, 120)} / ${bodies[1]?.slice(0, 120)}`);
    check('[2] 저장 요청 몸에 넣은 값이 들어감(이름 · 교차 켬 · 추세 28 · 기준 60 · 거름망 · 익절)', !!bodies[0] && (() => {
      const b = JSON.parse(bodies[0]!) as { name: string; rule: { buy: { maCross: { on: boolean }; trend: { points: number }; minScore: number; gates?: { above200?: { on: boolean } } }; sell: { takeProfit: { on: boolean } } } };
      return b.name === '시험 규칙' && b.rule.buy.maCross.on && (b.rule.buy as { trend: { on?: boolean } }).trend.on === true && b.rule.buy.trend.points === 28 && b.rule.buy.minScore === 60 && !!b.rule.buy.gates?.above200?.on && b.rule.sell.takeProfit.on;
    })(), bodies[0] ?? '');
  }
});
await part('3 · 점검 30 ~ 39 — 새 규칙 창(폰 · 패드', async () => {
  // ── 3 · 점검 30 ~ 39 — 새 규칙 창(폰 · 패드) ──
  for (const size of [PHONE, PAD]) {
    const phone = size === PHONE;
    const tag = phone ? '402' : '1133';
    const { page, ctx, errors } = await open(browser, size, '#/rules');
    if (phone) {
      const nameMax = await page.locator('[data-tip-clip]').first().evaluate((e) => getComputedStyle(e).maxWidth);
      check('[점검 33] 402 매매 규칙 목록 — 규칙 이름 칸 폭 제한 없음(폰은 전체 폭 · max-w-64 풀림)', nameMax === 'none', nameMax);
      const note = await page.locator('[data-short-note]').count();
      const tip = await page.locator('[data-short-note] [data-infotip]').count();
      check('[A · R5] 402 매매 규칙 화면 설명 — 첫 문장 한 줄 + [?](나머지 문장은 [?] 안)', note === 1 && tip === 1, `${note} · ${tip}`);
    }
    await tap(page, '새 규칙 만들기');
    const dlg = `${DIALOG}[aria-modal="true"]`;
    if (phone) {
      const cards = await page.locator('[data-rule-card]').count();
      check('[3] 402 조건 카드 — 조건마다 카드 하나(7) + 매수 기준 카드', cards === 8, String(cards));
      const hits = await page.locator('[data-rule-card] input[type="checkbox"]').evaluateAll((els) => els.map((e) => { const a = getComputedStyle(e, '::after'); return Math.min(parseFloat(a.width) || 0, parseFloat(a.height) || 0); }));
      check('[3] 402 「사용」 체크 7개 누르는 칸 44', hits.length === 7 && hits.every((h) => h >= 44), hits.join(','));
      const ov = await sideOverflow(page, `${dlg} .overflow-y-auto, ${dlg}`);
      check('[3] 402 새 규칙 창 가로 넘침 0(문서 · 창)', ov.doc <= 0 && ov.box <= 0, JSON.stringify(ov));
      const nameBox = await page.getByPlaceholder('예: 눌림 매수').evaluate((e) => { const r = e.getBoundingClientRect(); const d = e.closest('[role="dialog"]')!.getBoundingClientRect(); return { right: r.right, dright: d.right, w: r.width }; });
      check('[점검 30] 402 「이름」 칸이 판 안(오른쪽 끝 ≤ 창 오른쪽) · 폭 전체(≥ 300)', nameBox.right <= nameBox.dright && nameBox.w >= 300, JSON.stringify(nameBox));
      const desc = await page.locator('[data-rule-card] p').evaluateAll((ps) => ps.map((p) => Math.round(p.getBoundingClientRect().height / parseFloat(getComputedStyle(p).lineHeight))));
      check('[점검 31] 402 조건 설명이 카드 폭 전체 — 2줄 이하(4 ~ 6줄로 꺾이던 것)', desc.length >= 7 && desc.every((n) => n <= 2), desc.join(','));
    }
    const t = await touchIssues(page, dlg);
    const boxes = await page.locator(`${dlg} input[type="checkbox"]`).count();
    check(`[점검 ${phone ? '32 · 34' : '32 · 37'}] ${tag} 새 규칙 창 체크 ${boxes}개(사용 · 거름망 · 매도) — 누르는 칸 44 미만 0`, boxes === 14 && t.small.length === 0, `${boxes} · ${t.small.join(' | ')}`);
    check(`[점검 ${phone ? '35' : '38'}] ${tag} 새 규칙 창 안 누르는 칸 겹침 0`, t.overlap.length === 0, t.overlap.join(' | '));
    const fixedW = await page.evaluate((s) => [...document.querySelector(s)!.querySelectorAll<HTMLElement>('*')].filter((e) => /(?:^|\s)(?:min-)?w-(?:6[4-9]|7\d|8\d|9\d|\[(?:2[5-9]\d|[3-9]\d\d)px\])(?=\s|$)/.test(e.getAttribute('class') ?? '') && e.getBoundingClientRect().width >= 256).map((e) => e.getAttribute('class')!.slice(0, 40)), dlg);
    check(`[점검 ${phone ? '36' : '39'}] ${tag} 새 규칙 창 고정 폭 칸(256 이상 · w-80) 0`, fixedW.length === 0, fixedW.join(' | '));
    check(`[3] ${tag} 새 규칙 창 화면 오류 0`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }
});
await part('4 · 5 · 점검 165 · 패드 47 — 백테스트 ', async () => {
  // ── 4 · 5 · 점검 165 · 패드 47 — 백테스트 ──
  for (const size of [PHONE, PAD, WIDE]) {
    const tag = String(size.width);
    const { page, ctx } = await open(browser, size, '#/backtest', { wait: 3500 });
    const fixedShown = await page.evaluate((list) => list.map((t) => {
      const el = [...document.querySelectorAll<HTMLElement>('p')].find((p) => p.textContent?.trim() === t);
      if (!el) return `${t.slice(0, 12)}: 없음`;
      const r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && !el.closest('[data-infotip], [role="tooltip"]') ? '' : `${t.slice(0, 12)}: 안 보임`;
    }).filter(Boolean), FIXED5);
    check(`[5] ${tag} 백테스트 고정 문구 5개 — 화면 글자로 그대로([?] 안 아님)`, fixedShown.length === 0, fixedShown.join(' | '));
    if (size === PHONE) {
      const f = await foldedTexts(page, '[data-compare-list], [data-backtest-history-row]');
      check(`[4] 402 백테스트 결과 비교(위 이름 · 아래 값) — 한 단어 폭으로 접힌 글 0(글 조각 ${f.seen}개 잼)`, f.seen >= 5 && f.folded.length === 0, f.folded.join(' | '));
      const stack = await page.locator('[data-compare-list] [data-stack-row]').count();
      check('[4] 402 결과 비교는 줄마다 쌓은 줄(9줄 · 표 아님)', stack === 9 && (await page.locator('[data-compare-list] table').count()) === 0, String(stack));
      // 히스토리 줄 — 날짜 펼치고 잼
      await guard.step('히스토리 날짜 펼치기', () => page.locator('[data-date-group] > button').first().click({ timeout: 5000 }));
      await page.waitForTimeout(900);
      const h = await foldedTexts(page, '[data-backtest-history-row]');
      check(`[4] 402 백테스트 히스토리 줄 — 한 단어 폭으로 접힌 글 0(글 조각 ${h.seen}개)`, h.seen >= 1 && h.folded.length === 0, h.folded.join(' | '));
      const link = await hitOf(page, 'button:has-text("매매 규칙으로 가기")');
      const plus = await hitOf(page, 'button:has-text("비교할 방법 추가")');
      check('[점검 165] 402 「매매 규칙으로 가기」 ↔ [비교할 방법 추가] 누르는 칸 겹침 없음', !overlaps(link, plus), `${JSON.stringify(link)} · ${JSON.stringify(plus)}`);
      await tap(page, '비교할 방법 추가');
      const t = await touchIssues(page, BODY);
      check('[점검 165] 402 방법 2개 — 백테스트 본문 누르는 칸 44 미만 · 겹침 0(방법 줄 · [방법 N 삭제])', t.small.length === 0 && t.overlap.length === 0, [...t.small, ...t.overlap].join(' | '));
      const ov = await sideOverflow(page, BODY);
      check('[4] 402 백테스트 가로 넘침 0', ov.doc <= 0, JSON.stringify(ov));
    }
    if (size === PAD) {
      const w = await page.evaluate(() => {
        const t = [...document.querySelectorAll('table')].find((x) => x.querySelector('th')?.textContent?.includes('평균'));
        const panel = t?.closest('[data-scroll-table]') ?? t?.parentElement;
        return t && panel ? { t: t.getBoundingClientRect().width, p: panel.getBoundingClientRect().width, last: t.querySelector('thead tr')!.lastElementChild!.textContent } : null;
      });
      check('[패드 47] 1133 백테스트 결과 표 — 전체 너비(표 폭 = 상자 폭 · 마지막 칸 = 들고 있기 · 빈 칸 없음)', !!w && Math.abs(w.t - w.p) <= 2 && w.last === '들고 있기', JSON.stringify(w));
      const t = await touchIssues(page, BODY);
      check('[B] 1133 백테스트 결과 누르는 칸 44 미만 · 겹침 0(정렬 머리 · [ⓘ])', t.small.length === 0 && t.overlap.length === 0, [...t.small, ...t.overlap].join(' | '));
    }
    await ctx.close();
  }
});
await part('점검 40 · 43 · 44 · 48 · 49 · 4(', async () => {
  // ── 점검 40 · 43 · 44 · 48 · 49 · 4(검증 기록 분석) · R7 탭 줄 ──
  for (const size of [PHONE, PAD]) {
    const phone = size === PHONE;
    const tag = String(size.width);
    {
      const { page, ctx } = await open(browser, size, '#/records/analysis', { wait: 3500 });
      const t = await touchIssues(page, BODY);
      const cb = await page.getByRole('checkbox', { name: /현재 종목만/ }).count();
      check(`[점검 ${phone ? '44' : '48'}] ${tag} 검증 기록 › AI 분석 — 「현재 종목만」 체크 · 「새로고침」 등 누르는 칸 44 미만 0 · 겹침 0`, cb >= 0 && t.small.length === 0 && t.overlap.length === 0, [...t.small, ...t.overlap].join(' | '));
      if (phone) {
        // 본문 스크롤 상자(data-page-scroll)의 안쪽 오른쪽 끝(여백 안) 넘어가는 요소 · 본문 가로 넘침
        const edge = await page.evaluate(() => {
          const sc = document.querySelector<HTMLElement>('[data-page-scroll]');
          if (!sc) return { over: ['본문 없음'], side: -1 };
          const right = sc.getBoundingClientRect().left + sc.clientWidth - parseFloat(getComputedStyle(sc).paddingRight);
          const over = [...sc.querySelectorAll<HTMLElement>('*')]
            .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.right > right + 1 && !e.closest('[data-scroll-table], [data-scroll-row], [aria-hidden="true"]'); })
            .map((e) => `${(e.innerText || e.tagName).slice(0, 16)}(${Math.round(e.getBoundingClientRect().right)}>${Math.round(right)})`);
          return { over, side: sc.scrollWidth - sc.clientWidth };
        });
        check('[점검 40] 402 검증 기록 › AI 분석 — 카드 · 글 오른쪽 끝이 본문 여백 안(넘는 요소 0 · 본문 가로 넘침 0)', edge.over.length === 0 && edge.side <= 0, `${edge.side} · ${edge.over.slice(0, 5).join(' | ')}`);
        const f = await foldedTexts(page, BODY);
        check(`[4] 402 검증 기록 › AI 분석 — 한 단어 폭으로 접힌 글 0(글 조각 ${f.seen}개)`, f.folded.length === 0, f.folded.join(' | '));
        await guard.step('성적표', () => page.getByRole('radio', { name: '성적표' }).click({ timeout: 5000 }));
        await page.waitForTimeout(1500);
        const g = await foldedTexts(page, BODY);
        const lines = await page.locator('[data-version-lines] p').count();
        check(`[4] 402 성적표 — 프롬프트 버전별 줄이 이름 위 · 버전마다 한 줄(${lines}) · 접힌 글 0`, lines >= 2 && g.folded.length === 0, g.folded.join(' | '));
        const explain = await page.locator('[data-short-note]').filter({ hasText: 'AI 분석이 실제로 맞았는지' }).count();
        check('[B · R5] 402 성적표 맨 위 채점 설명 — 제목 한 줄 + [?](설명 문단은 [?] 안)', explain === 1, String(explain));
        const tabs = await page.locator('[data-testid="page-tab-row"]').count();
        check('[R7] 402 검증 기록 탭 줄 — 옆으로 미는 줄(끝 흐림 · ScrollRow)', tabs === 1, String(tabs));
      }
      await ctx.close();
    }
    if (phone) {
      const { page, ctx } = await open(browser, size, '#/records/target', { wait: 3000 });
      const r = await page.evaluate(() => {
        const b = [...document.querySelectorAll('b')].find((x) => x.textContent === '판단 보류');
        const s = [...document.querySelectorAll('span')].find((x) => x.textContent?.startsWith('· 같은 종목·같은 날'));
        if (!b || !s) return null;
        const A = b.getBoundingClientRect();
        const rects = [...s.getClientRects()];
        return rects.some((B) => Math.min(A.right, B.right) - Math.max(A.left, B.left) > 1 && Math.min(A.bottom, B.bottom) - Math.max(A.top, B.top) > 1);
      });
      check('[점검 43] 402 검증 기록 › 목표 — 「판단 보류」 와 옆 글 겹침 0', r === false, String(r));
      await ctx.close();
    } else {
      const { page, ctx } = await open(browser, size, '#/records/diagnose', { wait: 3000 });
      const help = await hitOf(page, 'button:has-text("이 화면은 무엇인가요?")');
      check('[점검 49] 1133 검증 기록 › 진단 — 「이 화면은 무엇인가요?」 누르는 칸 44', help.h >= 44 && help.w >= 44, JSON.stringify(help));
      const note = await page.locator('[data-short-note]').count();
      const warn = await page.locator('[data-short-note]').first().innerText().catch(() => '');
      check('[B · R5] 1133 진단 아래 안내 — 한 줄 + [?] · 주의 두 문장(예측이 아님 · 투자 조언이 아님)은 화면에', note === 1 && warn.includes('예측이 아닙니다') && warn.includes('투자 조언이 아닙니다'), warn);
      await ctx.close();
    }
  }
});
await part('C. 패드 매수 판단 단추 한 줄(9-2 10 · 11', async () => {
  // ── C. 패드 매수 판단 단추 한 줄(9-2 10 · 11) ──
  for (const size of [PAD_NARROW, PAD]) {
    for (const hash of ['#/swing/list', '#/swing/history']) {
      const { page, ctx } = await open(browser, size, hash, { buyJudge: true, wait: 3500 });
      const two = await page.evaluate(() =>
        [...document.querySelectorAll<HTMLElement>('[data-layout-body] button')].filter((b) => {
          const r = b.getBoundingClientRect();
          if (r.width < 1 || !b.innerText.trim() || b.closest('[data-date-group] > button, [data-buy-judge-table] tbody tr')) return false;
          // 글 조각만(아이콘 svg 는 빼고) — 줄 윗선이 둘 이상이면 두 줄
          const tops = new Set<number>();
          const walk = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
          for (let n = walk.nextNode(); n; n = walk.nextNode()) {
            if (!n.textContent?.trim()) continue;
            const range = document.createRange();
            range.selectNodeContents(n);
            for (const x of range.getClientRects()) if (x.width > 0) tops.add(Math.round(x.top + x.height / 2));
          }
          return tops.size > 1;
        }).map((b) => b.innerText.slice(0, 20)),
      );
      check(`[C · 10 · 11] ${size.width} 매수 판단 ${hash} — 단추 글 두 줄 0`, two.length === 0, two.join(' | '));
      await ctx.close();
    }
  }
});
await part('7. 바뀐 파일 — 매매 판단 · 백테스트 계산 · 서', async () => {
  // ── 7. 바뀐 파일 — 매매 판단 · 백테스트 계산 · 서버 코드 0줄 ──
  {
    const paths = ['server', 'python', 'db', 'src/services/toss', 'src/types/tradingRule.ts', 'src/utils/ruleInput.ts', 'src/hooks/useTradingRules.ts', 'src/hooks/useBacktest.ts', 'src/types/backtest.ts'];
    const changed = [...chasuChanged(root, CHASU, paths), ...chasuUntracked(root, CHASU, paths)];
    check(`[7] 이번 차수(${chasuLabel(root, CHASU)}) — server(rules · buyJudge · autoTrading · ruleBacktest) · python · 규칙 저장 · 백테스트 요청 코드 바뀐 파일 0`, changed.length === 0, changed.join(', '));
  }
});

await guard.step('브라우저 닫기', () => browser.close());
await guard.step('Vite 닫기', () => vite.close());
console.log(`\nmobilequant — 통과 ${pass} · 실패 ${fail}`);
process.exit(fail ? 1 : 0);
