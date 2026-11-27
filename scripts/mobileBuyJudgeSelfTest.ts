/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
/**
 * 150차 매수 판단 화면 폰 · 패드 시험(`npm run mobilebuyjudge:test` · v2.77.0) — 지시서 「꼭 지킬 동작」 1 ~ 12 줄마다.
 *
 * 화면은 이 시험이 띄운 Vite(5197)에 열고, `/api` 는 모두 가짜 응답 — `scripts/fixtures/mobileBuyJudge/`
 * (`api.json` = 사본 DB 테스트 서버에서 한 번 기록한 응답 · `state.json` = 판단 목록(사도 됨 · 손익비 부족 · 거름망 · 기준 미달 · 판단 못 함) ·
 *  `history.json` = 히스토리 가짜 값). 모르는 주소는 503(사용자 서버로 가지 않음) · 쓰기는 시험이 바꿔치기한 것만 200. 시계는 고정.
 * 폰 · 패드는 `isMobile` · `hasTouch`(손가락 화면). [목표 수익 가능성] 은 바꿔치기 응답으로만 누른다(Gemini 호출 0).
 * 1 은 기준 커밋(c0e8845 · v2.76.0)에서 같은 가짜 응답 · 같은 시계로 잰 큰 화면 정답 파일(`desk.json`)과 견준다 —
 *   보이는 요소마다 「태그 · 클래스(낱말 순서 맞춤 · 폰 · 패드 · 손가락에서만 켜지는 이름 뺌) · 자리 · 크기」 가 같아야 한다(146 ~ 149 와 같음).
 *   같은 파일에 기준 커밋 1280 의 판단 표 글도 담아 2 · 3 의 카드 글과 견준다.
 *   정답 파일을 다시 만들 때: 기준 커밋 worktree 에 이 파일 · 견본을 넣고 `CAPTURE=<저장 경로> npx tsx scripts/mobileBuyJudgeSelfTest.ts`.
 * 8 · 9 의 누르는 칸은 `design:check` 18 · 19 와 같은 셈을 **그 화면 본문 · 열린 창 안**으로만 잰다(앱 틀 · 창 뒤 화면은 다른 차수 몫).
 * 11 은 150차 A 정답(`scripts/fixtures/chasuRange/before.json`)과 견준다 — 브라우저 없는 옛 시험은 여기서 하나씩 다시 돌리고(새 사본 DB),
 *   브라우저 옛 시험은 가장 최근 기계 검사 로그(`reports/machine-check/<날짜>/<이름>_test.log`)의 PASS · FAIL 줄 수를 본다.
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import Database from 'better-sqlite3';
import { chromium, type Browser, type Page } from 'playwright';
import { createBrowserStepGuard } from './lib/browserStepGuard';
import { chasuChanged, chasuDeleted, chasuEnd, chasuLabel, chasuUntracked, type Chasu } from './lib/chasuRange';

const root = path.resolve(import.meta.dirname, '..');
const PORT = 5197;
const WEB = `http://127.0.0.1:${PORT}`;
/** 기준 커밋(v2.76.0) — 1 의 정답 파일 · 10 은 여기서부터 이번 차수 범위 */
const BASE = 'c0e8845';
const CHASU: Chasu = { base: BASE, version: 'v2.77.0' }; // 지금 하는 차수 — 끝 커밋이 생기면 그 커밋까지(scripts/lib/chasuRange.ts)
const FIX = path.join(root, 'scripts/fixtures/mobileBuyJudge');
const FIXTURE = path.join(FIX, 'desk.json');
const API: Record<string, unknown> = JSON.parse(fs.readFileSync(path.join(FIX, 'api.json'), 'utf8'));
const STATE = JSON.parse(fs.readFileSync(path.join(FIX, 'state.json'), 'utf8')).state as { symbols: string[]; rows: { symbol: string; error: string | null }[] };
const HIST = JSON.parse(fs.readFileSync(path.join(FIX, 'history.json'), 'utf8'));
const CAPTURE = process.env.CAPTURE ?? '';
const FIXED = new Date('2026-11-26T08:00:00.000Z');
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
const DESK_SIZES = [{ width: 1280, height: 1080 }, { width: 1440, height: 900 }];

type Reply = { status?: number; json?: unknown; delayMs?: number };
type Override = (url: string, method: string, body: string | null) => Reply | undefined;

/** 목표 수익 가능성 결과 하나(가짜 — 「근거·위험 보기」 를 보이려고) */
const TARGET_RECORD = (() => {
  const goal = API['/api/swing/goal'] as { targetPct: number; stopPct: number; days: number };
  return {
    id: 9001, symbol: 'AAPL', createdAt: '2026-11-26T07:00:00.000Z', baseDate: '2026-10-14', entryPrice: 100,
    targetPct: goal.targetPct, stopPct: goal.stopPct, days: goal.days, pTarget: 42, pStop: 35, pNeither: 23, normalized: false,
    summary: '시험용 결과입니다.', reasons: ['20일선 위에서 움직입니다'], risks: ['실적 발표가 기간 안에 있습니다'],
    agents: [], base: { target: 31, stop: 38, neither: 31, expectancy: -0.12, samples: 250 },
    promptVersion: 't1', model: 'test', tokens: 0, outcome: null, outcomeDate: null, dueDate: '2026-11-12',
  };
})();
const withRecord: Override = (u) =>
  u === '/api/target-analysis?limit=200' ? { json: { ...(API[u] as object), records: [TARGET_RECORD] } } : undefined;

async function open(browser: Browser, size: { width: number; height: number }, hash: string, o: { override?: Override; wait?: number } = {}) {
  const mobile = size.width < 1280;
  const ctx = await browser.newContext(mobile ? { viewport: size, isMobile: true, hasTouch: true } : { viewport: size });
  await ctx.addInitScript('window.__name = (f) => f');
  const page = await ctx.newPage();
  await page.clock.setFixedTime(FIXED);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)));
  await page.route(/\/api\//, async (r) => {
    const req = r.request();
    const u = req.url().replace(WEB, '');
    const ov = o.override?.(u, req.method(), req.postData());
    if (ov) {
      if (ov.delayMs) await new Promise((res) => setTimeout(res, ov.delayMs));
      return r.fulfill({ status: ov.status ?? 200, json: ov.json ?? {} }).catch(() => {});
    }
    if (req.method() !== 'GET') return r.fulfill({ status: 503, json: { error: '시험 — 쓰지 않음' } });
    if (u.startsWith('/api/version')) return r.fulfill({ json: { version: CLIENT_VERSION, startedAt: '2026-11-25T00:00:00.000Z' } });
    if (u === '/api/buy-judge') return r.fulfill({ json: STATE });
    if (u === '/api/buy-judge/history') return r.fulfill({ json: HIST.history });
    if (u.startsWith('/api/buy-judge/days?')) return r.fulfill({ json: HIST.days });
    if (/^\/api\/buy-judge\/history\/[^/?]+$/.test(u)) return r.fulfill({ json: HIST.symbolDays });
    if (u in API) return r.fulfill({ json: API[u] });
    return r.fulfill({ status: 503, json: { error: '시험 — 없음' } });
  });
  await guard.step(`페이지 열기(${size.width}×${size.height} ${hash})`, () => page.goto(`${WEB}/${hash}`));
  await page.waitForTimeout(o.wait ?? 3500);
  return { page, ctx, errors };
}

const tapName = async (page: Page, name: string | RegExp) => {
  await guard.step(`누르기 ${String(name)}`, () => page.getByRole('button', { name }).first().click({ timeout: 5000 }));
  await page.waitForTimeout(900);
};
const openFirstRow = async (page: Page) => {
  await guard.step('첫 줄 펼치기', () => page.locator('[data-buy-judge-table] tbody tr').first().click({ timeout: 5000 }));
  await page.waitForTimeout(900);
};
const openHistory = async (page: Page) => {
  await guard.step('첫 날짜 펼치기', () => page.locator('[data-date-group] > button').first().click({ timeout: 5000 }));
  await page.waitForTimeout(600);
  await guard.step('종목별 이유 펼치기', () => page.locator('[aria-controls="buy-judge-reasons"]').first().click({ timeout: 5000 }));
  await page.waitForTimeout(600);
  await guard.step('첫 종목 펼치기', () => page.locator('#buy-judge-reasons button[aria-expanded]').first().click({ timeout: 5000 }));
  await page.waitForTimeout(1200);
};

/** 큰 화면 모양 — 보이는 요소마다 태그 · 클래스(낱말 순서 맞춤 · 폰 · 패드 · 손가락 이름 뺌) · 자리 · 크기(시계 · 토스트 뺌) */
async function deskSnapshot(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.body.querySelectorAll('*')) {
      if (el.closest('[data-kst-clock], [data-toast-host], script, style')) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const cls = (el.getAttribute('class') ?? '')
        .split(/\s+/)
        .filter((c) => c && !/^(touch:|phone:|pad:)/.test(c) && c !== 'touch-hit' && c !== 'touch-hit-gap')
        .sort()
        .join(' ');
      out.push(`${el.tagName}|${cls}|${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)}`);
    }
    return out;
  });
}

/** 1280 판단 표 글 — 줄마다 칸 글(종목 · 판단 · 참고 점수 · 손절가 · 목표가 · 손익비 · 비중) */
async function tableTexts(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-buy-judge-table] tbody tr[aria-expanded]')].map((tr) =>
      [...tr.querySelectorAll('td')].slice(0, 7).map((td) => (td as HTMLElement).innerText.trim()),
    ),
  );
}
/** 폰 카드 글 — 카드마다 [이름, 판단, 손절가, 목표가, 손익비, 비중, 참고 점수 줄] */
async function cardTexts(page: Page) {
  return page.evaluate(() =>
    [...document.querySelectorAll('[data-card]')].map((c) => {
      const press = c.querySelector('[role="button"]') ?? c;
      const rows = [...press.children] as HTMLElement[];
      const first = [...rows[0].children].map((x) => (x as HTMLElement).innerText.trim());
      const values = [...rows[1].children].map((x) => ((x as HTMLElement).lastElementChild as HTMLElement).innerText.trim());
      const ref = (rows[2].firstElementChild as HTMLElement).innerText.trim();
      return [first[0], first[1], ...values, ref];
    }),
  );
}
const strip = (v: unknown) => String(v).replace(/\s+/g, '');

/** 누르는 칸(design:check 18 · 19 와 같은 셈) — 범위(scope) 안 · 스크롤로 가려지지 않은 것만 */
async function touchIssues(page: Page, scope: string) {
  return page.evaluate((sel) => {
    const scopes = [...document.querySelectorAll(sel)];
    const area = scopes[scopes.length - 1];
    if (!area) return { small: ['범위 없음'], overlap: [] as string[] };
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
    return { small, overlap };
  }, scope);
}
const BODY = '[data-layout-body]';
const DIALOG = '[role="dialog"]';
/** 요소 상자(보이는 것) */
const box = (page: Page, sel: string) => page.locator(sel).first().evaluate((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
/** 누르는 칸 — 요소 + 보이지 않는 바깥 칸(::after) */
const hitOf = (page: Page, sel: string) =>
  page.locator(sel).first().evaluate((e) => {
    const r = e.getBoundingClientRect();
    const a = getComputedStyle(e, '::after');
    const on = a.content !== 'none' && a.content !== 'normal' && a.position === 'absolute';
    return { w: Math.max(r.width, on ? parseFloat(a.width) || 0 : 0), h: Math.max(r.height, on ? parseFloat(a.height) || 0 : 0) };
  });

const { createServer } = await import('vite');
const vite = await guard.step('Vite 띄우기', async () => {
  const v = await createServer({ root, configFile: path.join(root, 'vite.config.ts'), logLevel: 'error', server: { host: '127.0.0.1', port: PORT, strictPort: true, hmr: false } });
  await v.listen();
  return v;
});
const browser = await guard.step('브라우저 띄우기', () => chromium.launch({ channel: 'chrome' }));

try {
  // ───────── 1 1280 이상 그대로 (+ 2 · 3 이 견줄 1280 표 글) ─────────
  let want: { shots: Record<string, string[]>; table: string[][] };
  {
    const shots: Record<string, string[]> = {};
    let table: string[][] = [];
    const SCREENS: { name: string; hash: string; act?: (p: Page) => Promise<void> }[] = [
      { name: '판단 처음', hash: '#/swing/list' },
      { name: '판단 줄 펼침', hash: '#/swing/list', act: openFirstRow },
      { name: '판단 기록 펼침', hash: '#/swing/history', act: openHistory },
    ];
    for (const size of DESK_SIZES) {
      for (const s of SCREENS) {
        const { page, ctx } = await open(browser, size, s.hash);
        // 세로 스크롤 막대는 화면 글에 따라 생겼다 없어져 폭이 갈린다 — 두 쪽 모두 감추고 견준다(146 ~ 149 와 같음)
        await page.addStyleTag({ content: '*::-webkit-scrollbar { width: 0 !important; height: 0 !important; } * { scrollbar-width: none !important; }' });
        if (s.act) await s.act(page);
        await page.waitForTimeout(1200);
        shots[`${size.width}x${size.height} ${s.name}`] = await guard.step('모양 재기', () => deskSnapshot(page));
        if (size.width === 1280 && s.name === '판단 처음') table = await tableTexts(page);
        await ctx.close();
      }
    }
    if (CAPTURE) {
      fs.mkdirSync(path.dirname(CAPTURE), { recursive: true });
      fs.writeFileSync(CAPTURE, JSON.stringify({ shots, table }, null, 0));
      console.log(`정답 파일 저장 — ${CAPTURE} (${Object.keys(shots).length}장면)`);
      process.exit(0);
    }
    want = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
    for (const key of Object.keys(want.shots)) {
      const a = want.shots[key];
      const b = shots[key] ?? [];
      let i = 0;
      while (i < Math.max(a.length, b.length) && a[i] === b[i]) i++;
      const same = a.length === b.length && i === a.length;
      check(`[150-1] ${key} — 기준 커밋(${BASE})과 요소 ${a.length}개 태그 · 클래스 · 자리 · 크기 같음`, same, same ? '' : `개수 ${a.length} → ${b.length} · 첫 차이 #${i}: ${a[i] ?? '-'} → ${b[i] ?? '-'}`);
    }
  }

  // ───────── 2 · 3 판단 카드 · 판단 못 함 ─────────
  {
    const { page, ctx } = await open(browser, PHONE, '#/swing/list');
    const tables = await page.locator(`${BODY} table`).count();
    const cards = await cardTexts(page);
    check(`[150-2] 402 판단 표 없음 · 카드 ${STATE.rows.length}장(종목 수)`, tables === 0 && cards.length === STATE.rows.length, `표 ${tables} · 카드 ${cards.length}`);
    const T = want.table;
    check('[150-2] 기준 커밋 1280 표 글을 읽음(종목 수만큼)', T.length === STATE.rows.length, String(T.length));
    STATE.rows.forEach((row, i) => {
      const c = cards[i] ?? [];
      const t = T[i] ?? [];
      // 표: 종목 · 판단 · 참고 점수 · 손절가 · 목표가 · 손익비 · 비중 / 카드: 이름 · 판단 · 손절가 · 목표가 · 손익비 · 비중 · 참고 점수 줄
      const refCard = strip(c[6]).replace(/^참고점수/, '');
      const ok = strip(c[0]) === strip(t[0]) && strip(c[1]) === strip(t[1]) && [2, 3, 4, 5].every((k) => strip(c[k]) === strip(t[k + 1])) && refCard === strip(t[2]);
      check(`[150-2] ${row.symbol} 카드 줄 1 ~ 3 글 = 기준 커밋 1280 표 글(이름 · 판단 · 손절가 · 목표가 · 손익비 · 비중 · 참고 점수)`, ok, `카드 ${JSON.stringify(c)} · 표 ${JSON.stringify(t)}`);
    });
    const failed = STATE.rows.findIndex((r) => r.error);
    const fc = cards[failed] ?? [];
    check('[150-3] 판단 못 한 종목(QQQ) 카드 — 「판단 못 함」 · 줄 2 값 넷 모두 「—」', failed >= 0 && fc[1] === '판단 못 함' && [2, 3, 4, 5].every((k) => fc[k] === '—'), JSON.stringify(fc));
    // 카드 위 작은 글은 secondary(테마 1-1) — 이름표 · 참고 점수 줄 · 판단 못 함
    const muted = await page.evaluate(() =>
      [...document.querySelectorAll('[data-card] [data-card-values] span span:first-child, [data-card] [role="button"] > div:last-child > span:first-child')].filter((e) => /text-text-muted/.test(e.className)).length,
    );
    check('[150-2] 카드 이름표 · 참고 점수 글 text-muted 0(테마 1-1 — secondary)', muted === 0, String(muted));
    await ctx.close();
  }

  // ───────── 4 카드 누름 · 키보드 ─────────
  {
    const { page, ctx } = await open(browser, PHONE, '#/swing/list');
    const card = page.getByRole('button', { name: 'AAPL 판단 자세히' });
    const exp = () => card.getAttribute('aria-expanded');
    const detailIn = () => page.locator('[data-card]').first().locator('[data-card-detail]').count();
    const before = await exp();
    await card.click();
    await page.waitForTimeout(500);
    const opened = await exp();
    const inside = await detailIn();
    const detailText = inside ? await page.locator('[data-card]').first().locator('[data-card-detail]').innerText() : '';
    await card.click();
    await page.waitForTimeout(500);
    const closed = await exp();
    check('[150-4] 카드를 누르면 펼쳐져(aria-expanded true) 조건별 점수 · 가격 계획이 카드 안에 · 다시 누르면 접힘', before === 'false' && opened === 'true' && inside === 1 && /조건별 점수/.test(detailText) && /가격 계획/.test(detailText) && closed === 'false' && (await detailIn()) === 0, `${before} → ${opened}(안 ${inside}) → ${closed}`);
    await card.focus();
    await page.keyboard.press('Enter');
    await page.waitForTimeout(400);
    const k1 = await exp();
    await page.keyboard.press(' ');
    await page.waitForTimeout(400);
    const k2 = await exp();
    check('[150-4] 키보드 — 역할 button · 이름 「AAPL 판단 자세히」 · Enter 로 펼침 · Space 로 접힘', k1 === 'true' && k2 === 'false', `${k1} · ${k2}`);
    // 펼친 내용을 눌러도 접히지 않는다(표의 펼친 줄과 같음)
    await card.click();
    await page.waitForTimeout(400);
    await page.locator('[data-card]').first().locator('[data-card-detail] p').first().click();
    await page.waitForTimeout(400);
    check('[150-4] 카드 안 펼친 내용을 눌러도 접히지 않음', (await exp()) === 'true', String(await exp()));
    await ctx.close();
  }

  // ───────── 5 단추는 따로 ─────────
  {
    const posts: string[] = [];
    const puts: string[] = [];
    const override: Override = (u, m, body) => {
      if (u === '/api/gemini/status') return { json: { ...(API[u] as object), enabled: true, reason: null } };
      if (u === '/api/target-analysis' && m === 'POST') {
        posts.push(body ?? '');
        return { json: { progress: { running: true, total: 1, done: 0, current: 'AAPL', startedAt: FIXED.toISOString(), finishedAt: null, results: [] } } };
      }
      if (u === '/api/target-analysis/progress') return { json: { progress: { running: true, total: 1, done: 0, current: 'AAPL', startedAt: FIXED.toISOString(), finishedAt: null, results: [] } } };
      if (u === '/api/buy-judge/settings' && m === 'PUT') {
        puts.push(body ?? '');
        return { json: { ok: true } };
      }
      return undefined;
    };
    const { page, ctx } = await open(browser, PHONE, '#/swing/list', { override });
    const card = (s: string) => page.getByRole('button', { name: `${s} 판단 자세히` });
    const cardBox = (s: string) => page.locator('[data-card]').filter({ has: card(s) });
    // 펼친 카드에서 [목표 수익 가능성] — 접히지 않고 표와 같은 일(그 종목 분석 시작 · 진행 글)
    await card('AAPL').click();
    await page.waitForTimeout(400);
    await cardBox('AAPL').getByRole('button', { name: '목표 수익 가능성' }).click();
    await page.waitForTimeout(800);
    const afterTarget = await card('AAPL').getAttribute('aria-expanded');
    const progressText = await cardBox('AAPL').locator('[data-card-detail]').innerText().catch(() => '');
    check('[150-5] 펼친 카드의 [목표 수익 가능성](바꿔치기 응답) — 카드가 접히지 않음 · 그 종목 하나로 분석 시작(POST 1번 · 표와 같은 몸통) · 진행 글',
      afterTarget === 'true' && posts.length === 1 && JSON.parse(posts[0]).symbols?.[0] === 'AAPL' && /분석하는 중/.test(progressText), `${afterTarget} · POST ${posts.length} ${posts[0] ?? ''}`);
    // 접힌 카드의 삭제 — 펼쳐지지 않고 표와 같은 일(목록에서 그 종목만 빼고 저장)
    const nvBefore = await card('NVDA').getAttribute('aria-expanded');
    await cardBox('NVDA').getByRole('button', { name: 'NVDA 목록에서 삭제' }).click();
    await page.waitForTimeout(1200);
    const sent = puts[0] ? (JSON.parse(puts[0]) as { symbols: string[] }).symbols : [];
    check('[150-5] 접힌 카드의 삭제 — 카드가 펼쳐지지 않음 · 목록에서 그 종목만 뺀 저장(PUT 1번)',
      nvBefore === 'false' && (await page.locator('[data-card-detail]').count()) <= 1 && puts.length === 1 && JSON.stringify(sent) === JSON.stringify(STATE.symbols.filter((s) => s !== 'NVDA')), `${nvBefore} · PUT ${puts.length} ${JSON.stringify(sent)}`);
    // 접힌 카드의 [목표 수익 가능성] 은 표와 같이 그 종목을 펼쳐 진행을 보인다(표 줄의 같은 단추와 같은 일) — 접히는 일은 없다
    await ctx.close();
    const t2 = await open(browser, PHONE, '#/swing/list', { override: (u, m, b) => (u === '/api/target-analysis' && m === 'POST' ? { json: { progress: { running: true, total: 1, done: 0, current: 'TSLA', startedAt: FIXED.toISOString(), finishedAt: null, results: [] } } } : override(u, m, b)) });
    await t2.page.locator('[data-card]').filter({ has: t2.page.getByRole('button', { name: 'TSLA 판단 자세히' }) }).getByRole('button', { name: '목표 수익 가능성' }).click();
    await t2.page.waitForTimeout(800);
    check('[150-5] 접힌 카드의 [목표 수익 가능성] — 표와 같은 일(그 종목을 펼쳐 진행을 보임 · 카드 누름으로 번지지 않음)', (await t2.page.getByRole('button', { name: 'TSLA 판단 자세히' }).getAttribute('aria-expanded')) === 'true');
    await t2.ctx.close();
  }

  // ───────── 6 패드는 표 ─────────
  {
    const { page, ctx } = await open(browser, PAD, '#/swing/list');
    const t = await page.locator('[data-buy-judge-table] table').count();
    const c = await page.locator('[data-card]').count();
    const scroll = await page.locator('[data-buy-judge-table][data-scroll-table]').count();
    check('[150-6] 1133 판단 목록 = 표(148차 미는 표 — 공용 ScrollTable 폰 · 패드 모양) · 카드 0', t === 1 && c === 0 && scroll === 1, `표 ${t} · 카드 ${c} · 미는 표 ${scroll}`);
    await ctx.close();
  }

  // ───────── 7 로딩 · 실패 ─────────
  {
    const { page, ctx } = await open(browser, PHONE, '#/swing/list', { override: (u) => (u === '/api/buy-judge' ? { delayMs: 6000, json: STATE } : undefined), wait: 1500 });
    const sk = await page.locator('[data-card-skeleton]').count();
    const body = await page.locator(BODY).innerText();
    check('[150-7] 응답 전 — 카드 스켈레톤(3장) · 「없습니다」 · 「0종목」 글 없음', sk === 1 && (await page.locator('[data-card-skeleton] > div').count()) === 3 && !/없습니다|0종목/.test(body), `스켈레톤 ${sk} · ${body.slice(0, 80)}`);
    await ctx.close();
    let failNow = true;
    const f = await open(browser, PHONE, '#/swing/list', { override: (u) => (u === '/api/buy-judge' && failNow ? { status: 500, json: { error: '시험 — 실패' } } : undefined) });
    const err = await f.page.locator(BODY).innerText();
    const retry = f.page.getByRole('button', { name: '다시 시도' });
    const hasRetry = await retry.count();
    check('[150-7] 실패 — 오류 글 + [다시 시도](빈 목록 · 스켈레톤으로 두지 않음)', /시험 — 실패/.test(err) && hasRetry === 1 && (await f.page.locator('[data-card-skeleton]').count()) === 0, `${hasRetry} · ${err.slice(0, 80)}`);
    failNow = false;
    await retry.click();
    await f.page.waitForTimeout(1500);
    check('[150-7] [다시 시도] → 다시 받아 카드가 그려짐', (await f.page.locator('[data-card]').count()) === STATE.rows.length);
    await f.ctx.close();
  }

  // ───────── 8 점검 줄(26 ~ 29 · 155 ~ 164) ─────────
  for (const [size, S] of [[PHONE, '402'], [PAD, '1133']] as const) {
    const phone = size === PHONE;
    {
      const { page, ctx } = await open(browser, size, '#/swing/list');
      const sel = await box(page, `${BODY} select[aria-label="매매 규칙"]`);
      const eye = await box(page, `${BODY} button[aria-label="조건 보기"]`);
      check(`[150-8] ${phone ? '26' : '28'}줄 — ${S} 규칙 고르기 줄 높이 하나(드롭박스 ${Math.round(sel.h)} = [조건 보기] ${Math.round(eye.h)} = 44)`, Math.round(sel.h) === 44 && Math.round(eye.h) === 44, `${sel.h} · ${eye.h}`);
      const help = await hitOf(page, `${BODY} section > button[aria-expanded]`);
      check(`[150-8] ${phone ? '27' : '29'}줄 — ${S} 「매수 판단은 무엇을 하나요?」 누르는 칸 44 이상`, help.h >= 44 && help.w >= 44, JSON.stringify(help));
      const run = await box(page, `${BODY} button:has-text("실행")`);
      check(`[150-8] 167줄 — ${S} [실행] 높이 = 드롭박스 44(규칙 고르기 줄 높이 하나)`, Math.round(run.h) === 44, String(run.h));
      await ctx.close();
    }
    {
      const { page, ctx } = await open(browser, size, '#/swing/list', { override: withRecord });
      if (phone) await page.getByRole('button', { name: 'AAPL 판단 자세히' }).click();
      else await openFirstRow(page);
      await page.waitForTimeout(600);
      const edit = await hitOf(page, `${BODY} button:has-text("조건 바꾸기")`);
      check(`[150-8] 155줄 — ${S} 「조건 바꾸기」 글자 단추(공용 LinkButton) 누르는 칸 44`, edit.h >= 44 && edit.w >= 44, JSON.stringify(edit));
      const why = await hitOf(page, `${BODY} button:has-text("근거·위험 보기")`);
      check(`[150-8] 156줄 — ${S} 「근거·위험 보기」 글자 단추(공용 LinkButton) 누르는 칸 44`, why.h >= 44 && why.w >= 44, JSON.stringify(why));
      await tapName(page, '조건 바꾸기');
      const cb = await page.locator(`${DIALOG} input[type="checkbox"]`).first().evaluate((e) => ({ cls: e.className, w: e.getBoundingClientRect().width }));
      const cbHit = await hitOf(page, `${DIALOG} input[type="checkbox"]`);
      check(`[150-8] 157줄 — ${S} 목표 창 「목표의 절반으로 자동」 = 공용 Checkbox(touch-hit) · 누르는 칸 44`, /touch-hit/.test(cb.cls) && cbHit.h >= 44 && cbHit.w >= 44, `${cb.cls} · ${JSON.stringify(cbHit)}`);
      await ctx.close();
    }
    {
      const { page, ctx } = await open(browser, size, '#/swing/history');
      await openHistory(page);
      const row = page.locator('#buy-judge-reasons button[aria-expanded]').first();
      const r = await row.evaluate((b) => {
        const name = b.children[1].getBoundingClientRect();
        const text = b.children[2].getBoundingClientRect();
        return { h: b.getBoundingClientRect().height, nameBottom: name.bottom, textTop: text.top, textW: text.width, lines: Math.round(text.height / parseFloat(getComputedStyle(b.children[2]).lineHeight)) };
      });
      if (phone) check('[150-8] 158줄 — 402 종목별 이유 줄: 글이 이름 아래 한 줄 전체(폭 250 이상 · 5줄 이하 — 예전 100 폭 9줄)', r.textTop >= r.nameBottom - 1 && r.textW >= 250 && r.lines <= 5, JSON.stringify(r));
      else check('[150-8] 159줄 — 1133 종목별 이유 줄 누르는 칸 44 이상', r.h >= 44, JSON.stringify(r));
      if (!phone) {
        const t = await touchIssues(page, BODY);
        const hit = t.overlap.filter((o) => /수익 계산/.test(o));
        check('[150-8] 160줄 — 1133 「날짜별 판단」 [ⓘ 수익 계산] ↔ 첫 날짜 줄 누르는 칸 겹침 0', hit.length === 0, hit.join(' · '));
      } else {
        const d = await page.locator('[data-date-group] > button').first().evaluate((b) => {
          const title = b.children[1] as HTMLElement;
          const sum = b.children[2].getBoundingClientRect();
          return { titleLines: Math.round(title.getBoundingClientRect().height / parseFloat(getComputedStyle(title).lineHeight)), sumTop: sum.top, titleBottom: title.getBoundingClientRect().bottom };
        });
        check('[150-8] 161줄 — 402 날짜 줄 제목(「애플 외 3개」) 한 줄 · 요약은 다음 줄', d.titleLines === 1 && d.sumTop >= d.titleBottom - 1, JSON.stringify(d));
        // 166줄 — 펼친 날짜 표 · 종목별 날짜 표: 칸이 겹치지 않음(종목 칸 · 이유 칸이 제 폭 — 상자 안에서 밀기)
        const cols = await page.locator('[data-date-group] table').first().evaluate((t) => ({ name: (t.querySelector('tbody td') as HTMLElement).getBoundingClientRect().width, w: t.getBoundingClientRect().width }));
        const why = await page.locator('#buy-judge-reasons table td:last-child').first().evaluate((td) => td.getBoundingClientRect().width);
        check('[150-8] 166줄 — 402 펼친 날짜 표 종목 칸 120 이상(칸 겹침 0) · 종목별 날짜 표 이유 칸 250 이상', cols.name >= 120 && why >= 250, `${JSON.stringify(cols)} · 이유 ${why}`);
      }
      await ctx.close();
    }
    {
      const { page, ctx } = await open(browser, size, '#/swing/list', { wait: 3000 });
      await tapName(page, /종목 추가/);
      await page.waitForTimeout(2500);
      const dlg = page.locator(DIALOG).last();
      if (phone) {
        const g = await dlg.evaluate((d) => {
          const right = [...d.querySelectorAll('div')].find((e) => /^고른 종목/.test((e.firstElementChild as HTMLElement | null)?.innerText ?? '') && e.className.includes('w-[300px]'));
          const search = d.querySelector('input[aria-label="목록 안에서 찾기"]');
          const body = right?.parentElement?.getBoundingClientRect();
          return { rightW: right?.getBoundingClientRect().width ?? 0, bodyW: body?.width ?? 0, leftW: (right?.previousElementSibling as HTMLElement | null)?.getBoundingClientRect().width ?? 0, searchH: search?.getBoundingClientRect().height ?? 0 };
        });
        check('[150-8] 162줄 — 402 종목 추가 창: 위아래로(고른 종목 칸 = 창 폭 전체 · 목록 칸 폭 300 이상) · 검색칸 44', g.rightW > 0 && Math.abs(g.rightW - g.bodyW) <= 1 && g.leftW >= 300 && Math.round(g.searchH) >= 44, JSON.stringify(g));
      }
      const heads = await dlg.locator('button[aria-controls^="sp-group-"]').evaluateAll((bs) => bs.filter((b) => b.getBoundingClientRect().height > 0).map((b) => Math.round(b.getBoundingClientRect().height)));
      const t = await touchIssues(page, DIALOG);
      const allOverlap = t.overlap.filter((o) => /전부 선택|선택 해제/.test(o));
      check(`[150-8] 163줄 — ${S} 종목 추가 창 묶음 머리 누르는 칸 44(${heads.length}개) · 「전부 선택」 끼리 겹침 0`, heads.length > 0 && heads.every((h) => h >= 44) && allOverlap.length === 0, `${JSON.stringify(heads)} · ${allOverlap.join(' · ')}`);
      const hasAdded = await dlg.getByRole('button', { name: /직접 추가한 종목에서 삭제/ }).count();
      if (hasAdded) await dlg.getByRole('button', { name: /직접 추가한 종목에서 삭제/ }).first().scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      const rm = (await touchIssues(page, DIALOG)).overlap.filter((o) => /직접 추가한 종목에서 삭제/.test(o));
      check(`[150-8] 164줄 — ${S} 「직접 추가한 종목」 줄 ↔ 옆 [×] 누르는 칸 겹침 0(줄 ${hasAdded}개)`, hasAdded > 0 && rm.length === 0, rm.join(' · '));
      await ctx.close();
    }
  }

  // ───────── 9 손가락 크기(매수 판단 화면 · 목표 바꾸기 창) ─────────
  for (const [size, S] of [[PHONE, '402'], [PAD, '1133']] as const) {
    const phone = size === PHONE;
    const scenes: { name: string; hash: string; scope: string; act?: (p: Page) => Promise<void>; override?: Override }[] = [
      { name: '판단 처음', hash: '#/swing/list', scope: BODY },
      { name: '판단 펼침(결과 있음)', hash: '#/swing/list', scope: BODY, override: withRecord, act: async (p) => { if (phone) await p.getByRole('button', { name: 'AAPL 판단 자세히' }).click(); else await openFirstRow(p); await p.waitForTimeout(600); } },
      { name: '판단 기록 펼침', hash: '#/swing/history', scope: BODY, act: openHistory },
      { name: '목표 바꾸기 창', hash: '#/swing/list', scope: DIALOG, act: async (p) => { if (phone) await p.getByRole('button', { name: 'AAPL 판단 자세히' }).click(); else await openFirstRow(p); await tapName(p, '조건 바꾸기'); } },
    ];
    for (const s of scenes) {
      const { page, ctx } = await open(browser, size, s.hash, { override: s.override });
      if (s.act) await s.act(page);
      const t = await touchIssues(page, s.scope);
      check(`[150-9] ${S} ${s.name} — 누르는 칸 44 미만 0 · 누르는 칸 겹침 0`, t.small.length === 0 && t.overlap.length === 0, `${t.small.join(' · ')} / ${t.overlap.join(' · ')}`);
      await ctx.close();
    }
  }

  // ───────── 10 이번 차수 바뀐 파일(c0e8845 → 지금) ─────────
  {
    const changed = (paths: string[]) => chasuChanged(root, CHASU, paths);
    check(`[150-10] 범위 = ${chasuLabel(root, CHASU)}(이번 차수 — scripts/lib/chasuRange.ts)`, chasuEnd(root, { base: '0cdb48a', version: 'v2.76.0' }) === 'c0e8845');
    const server = [...changed(['server', 'deploy', 'python', 'db']), ...chasuUntracked(root, CHASU, ['server', 'deploy', 'python', 'db'])];
    check('[150-10] 매매 · 주문 · 계좌 계산 · 자동매매 판단 · 로그인 · 서버 코드(server · deploy · python · db) 바뀐 파일 0', server.length === 0, server.join(', '));
    // 서버 컴파일 목록(tsconfig.node.json 이 실제로 읽는 src)과 겹치는 파일 — changelog · ui/tokens.ts 는 더하기만
    const list = spawnSync(process.execPath, [path.join(root, 'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.node.json', '--listFilesOnly'], { cwd: root, encoding: 'utf8' });
    const nodeSrc = list.stdout.split('\n').map((l) => path.relative(root, l.trim())).filter((f) => f.startsWith('src/'));
    const ADD_ONLY = ['src/data/changelog.ts', 'src/components/ui/tokens.ts'];
    const shared = changed(nodeSrc).filter((f) => !ADD_ONLY.includes(f));
    const removed = chasuDeleted(root, CHASU, ADD_ONLY);
    check(`[150-10] 서버가 함께 쓰는 src ${nodeSrc.length}개 바뀐 줄 0 · changelog · ui/tokens.ts 는 더하기만(지운 줄 0)`, nodeSrc.length > 30 && shared.length === 0 && removed.length === 0, `${shared.join(', ')} · 지운 줄 ${removed.length}`);
    const dc = changed(['scripts/designCheck.ts']);
    const dcDel = chasuDeleted(root, CHASU, ['scripts/designCheck.ts']);
    check('[150-10] designCheck.ts 판정 부분 0(지운 · 바꾼 줄 0 — 장면 더하기만)', dc.length === 0 || dcDel.length === 0, dcDel.slice(0, 3).join(' | '));
  }

  // ───────── 11 A 절 — 옛 시험 확인 항목 수 · 통과 = 정답 · 옛 목록 이름 0 ─────────
  {
    const names = spawnSync('grep', ['-rln', '-e', 'LATER_COMMITS', '-e', 'LATER_CHANGES', 'scripts'], { cwd: root, encoding: 'utf8' }).stdout.split('\n').filter((f) => f && f !== 'scripts/mobileBuyJudgeSelfTest.ts');
    check('[150-11] LATER_COMMITS · LATER_CHANGES 이름 scripts/ 에 0곳 · scripts/lib/tradingDiff.ts 없음', names.length === 0 && !fs.existsSync(path.join(root, 'scripts/lib/tradingDiff.ts')), names.join(', '));
    const before = JSON.parse(fs.readFileSync(path.join(root, 'scripts/fixtures/chasuRange/before.json'), 'utf8')).tests as Record<string, { checks: number; pass: number; fail: number }>;
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts as Record<string, string>;
    const count = (text: string) => {
      const lines = text.split('\n');
      const p = lines.filter((l) => /^PASS|^ {2}✅/.test(l)).length;
      const f = lines.filter((l) => /^FAIL|^ {2}❌/.test(l)).length;
      return { checks: p + f, pass: p, fail: f };
    };
    const BROWSER = new Set(['blockleaveui:test', 'chartview:test', 'toolbutton:test', 'mobileframe:test', 'mobiletable:test', 'mobileaccount:test', 'mobiletouch:test']);
    const db = process.env.DB_PATH!;
    for (const [name, want] of Object.entries(before)) {
      const file = /tsx (scripts\/\S+)/.exec(pkg[name] ?? '')?.[1];
      const src = file ? fs.readFileSync(path.join(root, file), 'utf8') : '';
      const uses = /from '\.\/lib\/chasuRange'/.test(src) && !/'diff'/.test(src);
      let got: { checks: number; pass: number; fail: number } | null = null;
      let from = '';
      if (!BROWSER.has(name)) {
        // 새 사본(사본 DB 에서 온라인 백업)으로 하나씩
        const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mbj-'));
        const copy = path.join(tmp, 'copy.db');
        const src2 = new Database(db, { readonly: true, fileMustExist: true });
        await src2.backup(copy);
        src2.close();
        const r = spawnSync(process.execPath, [path.join(root, 'node_modules/tsx/dist/cli.mjs'), file!], { cwd: root, encoding: 'utf8', env: { ...process.env, DB_PATH: copy }, timeout: 300_000 });
        got = count(`${r.stdout}\n${r.stderr}`);
        fs.rmSync(tmp, { recursive: true, force: true });
        from = '다시 돌림';
      } else {
        const dir = path.join(root, 'reports/machine-check');
        const logs = fs.existsSync(dir)
          ? fs.readdirSync(dir).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).map((d) => path.join(dir, d, `${name.replace(/:test$/, '')}_test.log`)).filter((f) => fs.existsSync(f))
          : [];
        const latest = logs.sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0];
        if (latest) got = count(fs.readFileSync(latest, 'utf8'));
        from = latest ? `로그 ${path.relative(root, latest)}` : '로그 없음 — check:all 로 먼저 돌린다';
      }
      // 151차: 지금 코드로 다시 돌린 개수라 뒤 차수가 확인을 더하면 늘어난다(asset:test 299 → 301) — 150차 정답 이상 · 실패 0 이면 맞음(줄어들면 실패)
      check(`[150-11] ${name} — chasuRange 를 씀 · 확인 항목 ${want.checks} 이상 · 통과 ${want.pass} 이상 · 실패 0 = 정답(${from})`, uses && got != null && got.checks >= want.checks && got.pass >= want.pass && got.fail === 0, `${uses ? '' : '옛 비교가 남음 · '}${JSON.stringify(got)}`);
    }
  }

  // ───────── 12 design:lint ─────────
  {
    const lint = spawnSync('npx', ['tsx', 'scripts/designLint.ts'], { cwd: root, encoding: 'utf8' });
    check('[150-12] design:lint 통과', lint.status === 0, lint.stdout.split('\n').slice(-3).join(' '));
  }
} catch (e) {
  check('실행 오류 없음', false, String(e).slice(0, 300));
} finally {
  await browser.close().catch(() => {});
  await vite.close().catch(() => {});
}
console.log(`\nmobilebuyjudge:test — 통과 ${pass} · 실패 ${fail}`);
process.exit(fail ? 1 : 0);
