/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
/**
 * 148차 옆으로 미는 표 시험(`npm run mobiletable:test` · v2.75.0) — 지시서 「꼭 지킬 동작」 1 ~ 12 줄마다.
 *
 * 화면은 이 시험이 띄운 Vite(5198)에 열고, `/api` 는 모두 가짜 응답 — `scripts/fixtures/mobileTable/api.json`
 * (사본 DB 테스트 서버에서 한 번 기록한 응답 · 실제 계좌 보유 · 로그인 기기 · 관심 목록 · 자산 관리는 만든 값) · 모르는 주소는 503(사용자 서버로 가지 않음).
 * 시계는 고정(`page.clock.setFixedTime`). 폰 · 패드는 `isMobile` · `hasTouch`(손가락 화면).
 * 1(1280 · 1440 아홉 화면 그대로 · 미는 표 상자 없음)은 v2.83.0 부터 `desktop:test`(`scripts/lib/desktopScenes.ts` 묶음 `table`)가 본다.
 * 3 ~ 5 · 7 · 8 은 시험 틀(`scripts/fixtures/mobileTable/harness.js` — 앱과 같은 부품 · CSS)로도 잰다.
 * 손가락 밀기는 크롬 개발 도구(CDP `Input.synthesizeScrollGesture` · 손가락)로, 누름은 `Input.dispatchTouchEvent` 로 보낸다.
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { chromium, type Browser, type CDPSession, type Page } from 'playwright';
import { createBrowserStepGuard } from './lib/browserStepGuard';
import { stockNamesReply } from './lib/stockNamesReply';
import { chasuDiff, type Chasu } from './lib/chasuRange';

const root = path.resolve(import.meta.dirname, '..');
const PORT = 5198;
const WEB = `http://127.0.0.1:${PORT}`;
/** 기준 커밋(v2.74.0) — 1 의 정답 파일 · 12 는 여기서부터 바뀐 것을 본다 */
const BASE = 'cb23013';
const CHASU: Chasu = { base: BASE, version: 'v2.75.0' }; // 그 차수 범위만(scripts/lib/chasuRange.ts)
const API: Record<string, unknown> = JSON.parse(fs.readFileSync(path.join(root, 'scripts/fixtures/mobileTable/api.json'), 'utf8'));
const FIXED = new Date('2026-11-25T06:00:00.000Z');
/** 화면이 들고 있는 버전과 같은 서버 버전(새 버전 띠가 뜨지 않게 — 기준 커밋 · 지금 모두) */
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

async function open(browser: Browser, size: { width: number; height: number }, hash: string, wait = 4000) {
  const mobile = size.width < 1280;
  const ctx = await browser.newContext(mobile ? { viewport: size, isMobile: true, hasTouch: true } : { viewport: size });
  await ctx.addInitScript('window.__name = (f) => f');
  const page = await ctx.newPage();
  await page.clock.setFixedTime(FIXED);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)));
  await page.route(/\/api\//, (r) => {
    const req = r.request();
    const u = req.url().replace(WEB, '');
    if (req.method() !== 'GET') return r.fulfill({ status: 503, json: { error: '시험 — 쓰지 않음' } });
    if (u.startsWith('/api/version')) return r.fulfill({ json: { version: CLIENT_VERSION, startedAt: '2026-11-25T00:00:00.000Z' } });
    const names = stockNamesReply(API, u); // 종목 이름은 물은 종목만(주소 글자가 흔들려도 같은 답 — lib/stockNamesReply)
    if (names) return r.fulfill(names);
    if (u in API) return r.fulfill({ json: API[u] });
    return r.fulfill({ status: 503, json: { error: '시험 — 없음' } });
  });
  await guard.step(`페이지 열기(${size.width}×${size.height} ${hash})`, () => page.goto(`${WEB}/${hash}`));
  await page.waitForTimeout(wait);
  const cdp = mobile ? await ctx.newCDPSession(page) : null;
  return { page, ctx, errors, cdp };
}

// ── 표 상자 재기 ──
type BoxInfo = { sw: number; cw: number; sl: number; pin: string; fade: string; stuck: boolean; x: number; right: number };
const boxInfo = (page: Page, sel: string) =>
  page.evaluate((s) => {
    const e = document.querySelector<HTMLElement>(s);
    if (!e) return null;
    const r = e.getBoundingClientRect();
    return { sw: e.scrollWidth, cw: e.clientWidth, sl: Math.round(e.scrollLeft), pin: e.dataset.pin ?? '', fade: e.dataset.fade ?? '', stuck: 'stuck' in e.dataset, x: Math.round(r.x), right: Math.round(r.right) };
  }, sel) as Promise<BoxInfo | null>;
async function scrollBox(page: Page, sel: string, to: 'start' | 'mid' | 'end' | number) {
  await page.evaluate(
    ({ s, t }) => {
      const e = document.querySelector<HTMLElement>(s)!;
      const max = e.scrollWidth - e.clientWidth;
      e.scrollLeft = t === 'start' ? 0 : t === 'mid' ? max / 2 : t === 'end' ? max : t;
    },
    { s: sel, t: to },
  );
  await page.waitForTimeout(250);
}
/** 요소가 상자 안에 다 보이나(가로) */
const insideBox = (page: Page, boxSel: string, target: string) =>
  page.evaluate(
    ({ b, t }) => {
      const box = document.querySelector(b)!.getBoundingClientRect();
      const el = [...document.querySelector(b)!.querySelectorAll<HTMLElement>('th, td, button')].find((x) => (x.textContent ?? '').trim() === t || x.getAttribute('aria-label') === t);
      if (!el) return { ok: false, why: `「${t}」 없음` };
      const r = el.getBoundingClientRect();
      return { ok: r.left >= box.left - 1 && r.right <= box.right + 1, why: `${Math.round(r.left)}~${Math.round(r.right)} / 상자 ${Math.round(box.left)}~${Math.round(box.right)}` };
    },
    { b: boxSel, t: target },
  );
/** 글이 한 줄인가(글 조각의 줄 수) */
const lineCount = (page: Page, sel: string, index = 0) =>
  page.evaluate(
    ({ s, i }) => {
      const el = document.querySelectorAll(s)[i];
      if (!el) return -1;
      const range = document.createRange();
      range.selectNodeContents(el);
      // 글자 크기가 다른 조각(이름 14 · 코드 13)은 위 끝이 1~2px 다르다 — 가운데 높이가 8px 안이면 같은 줄
      const mids = [...range.getClientRects()].filter((r) => r.width > 0).map((r) => r.top + r.height / 2).sort((a, b) => a - b);
      let lines = mids.length ? 1 : 0;
      for (let k = 1; k < mids.length; k++) if (mids[k] - mids[k - 1] > 8) lines++;
      return lines;
    },
    { s: sel, i: index },
  );
const docOverflow = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
/** 본문 가로 넘침 · 그중 표 상자 때문에 생긴 것(상자를 감추고 다시 잰 값과의 차) */
const bodyOverflow = (page: Page) =>
  page.evaluate(() => {
    const body = document.querySelector<HTMLElement>('[data-layout-body]');
    if (!body) return { all: -1, byTable: -1 };
    const all = body.scrollWidth - body.clientWidth;
    const boxes = [...document.querySelectorAll<HTMLElement>('[data-scroll-table]')];
    for (const b of boxes) b.style.display = 'none';
    const without = body.scrollWidth - body.clientWidth;
    for (const b of boxes) b.style.display = '';
    return { all, byTable: all - without };
  });

// ── 손가락(CDP) ──
async function swipe(cdp: CDPSession, x: number, y: number, dx: number, dy: number) {
  await cdp.send('Input.synthesizeScrollGesture', { x, y, xDistance: dx, yDistance: dy, gestureSourceType: 'touch', speed: 1200, preventFling: true });
}
async function tap(page: Page, cdp: CDPSession, x: number, y: number) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await page.waitForTimeout(60);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(300);
}
async function drag(page: Page, cdp: CDPSession, x: number, y: number, dx: number) {
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let k = 1; k <= 6; k++) {
    await page.waitForTimeout(16);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x + (dx * k) / 6, y }] });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForTimeout(400);
}

// ── 시험 틀(harness) ──
const HARNESS = '/scripts/fixtures/mobileTable/harness.js';
async function mount(page: Page, o: { wideFirst?: boolean; narrow?: boolean; pad?: boolean } = {}) {
  await page.evaluate(
    async ({ url, opts }) => {
      const m = await import(/* @vite-ignore */ url);
      m.mountTable(opts);
    },
    { url: HARNESS, opts: o },
  );
  await page.waitForTimeout(400);
}
const H_BOX = '[data-testid="table-harness"] [data-scroll-table]';
const fadeOpacity = (page: Page) =>
  page.evaluate((s) => {
    const box = document.querySelector(s)!;
    const o = (side: string) => getComputedStyle(box.querySelector(`[data-scroll-fade="${side}"]`)!).opacity;
    return `${o('left')}/${o('right')}`;
  }, H_BOX);
const firstCellX = (page: Page, boxSel: string) =>
  page.evaluate((s) => {
    const box = document.querySelector(s)!;
    const th = box.querySelector('thead tr > :first-child')!.getBoundingClientRect().x;
    // 합친 칸 줄(급등 「탐지 회차」 머리 등)은 빼고 첫 보통 줄
    const row = [...box.querySelectorAll<HTMLTableRowElement>('tbody tr')].find((tr) => tr.cells[0]?.colSpan === 1)!;
    const td = row.cells[0].getBoundingClientRect().x;
    return `${Math.round(th)}/${Math.round(td)}`;
  }, boxSel);

const { createServer } = await import('vite');
const vite = await guard.step('Vite 띄우기', async () => {
  const v = await createServer({ root, configFile: path.join(root, 'vite.config.ts'), logLevel: 'error', server: { host: '127.0.0.1', port: PORT, strictPort: true, hmr: false } });
  await v.listen();
  return v;
});
const browser = await guard.step('브라우저 띄우기', () => chromium.launch({ channel: 'chrome' }));

try {
  // ───────── 2 · 10 폰 7화면 — 표만 밀림 · 점검 7줄 ─────────
  {
    const SCREENS = [
      { line: 1, name: '자산 관리 일별 표', hash: '#/asset', box: '[data-testid="asset-daily-scroll"]', last: '메모' },
      { line: 2, name: '실시간 순위', hash: '#/ranking', box: '[data-scroll-table]', last: '거래대금' },
      { line: 3, name: '실제 계좌 보유', hash: '#/portfolio/real', box: '[data-scroll-table]', last: '당일손익' },
      { line: 4, name: '매매 규칙 목록', hash: '#/rules', box: '[data-scroll-table]', last: '' },
      { line: 5, name: '설정 로그인 기기', hash: '#/settings-app', box: '[data-scroll-table]', last: '마지막 사용' },
      { line: 6, name: '급등 탐지 기록', hash: '#/surge/history', box: '[data-scroll-table]', last: '실제 급등' },
      { line: 7, name: '기업 비교(두 종목)', hash: '#/compare', box: '[data-scroll-table]', last: '' },
    ];
    for (const s of SCREENS) {
      const { page, ctx, errors } = await open(browser, PHONE, s.hash);
      if (s.line === 7) {
        // 앱과 같은 모듈(같은 store) — 시험이 띄운 Vite 라 주소가 같다
        await page.evaluate(async (url) => {
          const m = (await import(/* @vite-ignore */ url)) as { useAppStore: { getState: () => { setCompareSlot: (i: number, s: string) => void } } };
          const st = m.useAppStore.getState();
          st.setCompareSlot(0, '005930');
          st.setCompareSlot(1, '000660');
        }, '/src/store/appStore.ts');
        await page.waitForTimeout(3000);
      }
      const info = await boxInfo(page, s.box);
      const body = await bodyOverflow(page);
      const doc = await docOverflow(page);
      // 3 — 149차(v2.76.0)부터 폰 실제 계좌 보유는 표 대신 카드(테마 4-1) — 넘침 0 과 카드만 본다(카드 글 · 말줄임은 mobileaccount:test 4)
      if (s.line === 3) {
        const cards = await page.locator('[data-card]').count();
        check('[148-2] 402×874 실제 계좌 보유 — 문서 · 본문 가로 넘침 0 · 149 부터 폰은 카드(미는 표 없음)', doc <= 0 && body.all === 0 && !info && cards > 0, `문서 ${doc} · 본문 ${JSON.stringify(body)} · 상자 ${JSON.stringify(info)} · 카드 ${cards}`);
        await ctx.close();
        continue;
      }
      // 급등 탐지는 화면 안 탭 줄(「설정」 탭)이 17px 넘친다 — 점검 102줄(실험실 차수) · 표 때문이 아니다
      const bodyOk = s.line === 6 ? body.byTable === 0 : body.all === 0;
      check(
        `[148-2] 402×874 ${s.name} — 문서 가로 넘침 0 · 본문 가로 스크롤 ${s.line === 6 ? '(표 때문) ' : ''}0 · 표 상자만 가로 스크롤(넘침 ${info ? info.sw - info.cw : '-'}px)`,
        doc <= 0 && bodyOk && !!info && info.sw > info.cw,
        `문서 ${doc} · 본문 ${JSON.stringify(body)} · 상자 ${JSON.stringify(info)}`,
      );
      if (!info) {
        await ctx.close();
        continue;
      }
      // 10 — 점검 줄마다
      if (s.line === 1) {
        await scrollBox(page, s.box, 'end');
        const r = await insideBox(page, s.box, s.last);
        check('[148-10-1] 자산 관리 일별 표 — 끝까지 밀면 「등락률 · 무엇 때문에 · 메모」 까지 보임', r.ok && (await insideBox(page, s.box, '무엇 때문에')).ok, r.why);
      }
      if (s.line === 2) {
        const name = await page.evaluate(() => {
          const th = [...document.querySelectorAll<HTMLElement>('[data-scroll-table] thead th')].find((x) => x.textContent?.trim() === '종목')!;
          const td = document.querySelector<HTMLElement>('[data-scroll-table] tbody tr td:nth-child(3)')!;
          return { w: Math.round(th.getBoundingClientRect().width), text: td.innerText.trim() };
        });
        check('[148-6] 실시간 순위 폰 — 종목 이름 칸 폭 ≥ 140 · 이름 글이 보임(코드만이 아님)', name.w >= 140 && /[가-힣A-Za-z]{2,}/.test(name.text.replace(/\d{6}/, '')), JSON.stringify(name));
        await scrollBox(page, s.box, 'end');
        const r = await insideBox(page, s.box, s.last);
        check('[148-10-2] 실시간 순위 — 이름이 보이고(위 148-6) 끝까지 밀면 「거래대금」 칸까지 보임', r.ok && name.w >= 140, r.why);
      }
      if (s.line === 4) {
        const usage = await lineCount(page, '[data-scroll-table] tbody tr td:nth-child(2)');
        await scrollBox(page, s.box, 'end');
        const del = await page.evaluate((b) => {
          const box = document.querySelector(b)!.getBoundingClientRect();
          return [...document.querySelector(b)!.querySelectorAll<HTMLElement>('button')]
            .filter((x) => x.textContent?.includes('삭제'))
            .map((x) => x.getBoundingClientRect())
            .every((r) => r.right <= box.right + 1 && r.left >= box.left - 1);
        }, s.box);
        check('[148-10-4] 매매 규칙 목록 — [삭제] 가 상자 밖으로 나가지 않음(끝까지 밀면 상자 안) · 「적용된 곳」 한 줄 · 문서 넘침 0', del && usage === 1 && doc <= 0, `삭제 안 ${del} · 적용된 곳 ${usage}줄`);
      }
      if (s.line === 5) {
        await scrollBox(page, s.box, 'end');
        const r = await insideBox(page, s.box, s.last);
        check('[148-10-5] 설정 로그인 기기 — 끝까지 밀면 「마지막 사용」 칸까지 보임', r.ok, r.why);
      }
      if (s.line === 6) {
        await scrollBox(page, s.box, 'end');
        const r = await insideBox(page, s.box, s.last);
        check('[148-10-6] 급등 탐지 기록(폰) — 끝까지 밀면 「실제 급등」 칸까지 보임', r.ok, r.why);
        // 3 — 첫 칸 고정(앱 화면): 끝까지 밀어도 머리 · 몸 첫 칸 자리 그대로
        await scrollBox(page, s.box, 'start');
        const x0 = await firstCellX(page, s.box);
        await scrollBox(page, s.box, 'end');
        const x1 = await firstCellX(page, s.box);
        check('[148-3] 급등 탐지 기록 — 끝까지 밀어도 첫 칸(탐지일) 머리 · 몸 자리 그대로', x0 === x1, `${x0} → ${x1}`);
      }
      if (s.line === 7) {
        await scrollBox(page, s.box, 'end');
        const after = await bodyOverflow(page);
        const scroll = await page.evaluate(() => document.querySelector<HTMLElement>('[data-layout-body]')!.scrollLeft);
        check('[148-10-7] 기업 비교 두 종목 — 표만 밀리고 본문은 밀리지 않음(본문 scrollLeft 0 · 넘침 0)', after.all === 0 && scroll === 0 && (info.sw > info.cw), `본문 ${JSON.stringify(after)} · scrollLeft ${scroll}`);
      }
      check(`[148-2] ${s.name} — 화면 오류 0`, errors.length === 0, errors.join(' | '));
      await ctx.close();
    }
  }

  // ───────── 10-6 패드 — 「(+6.2%)」 가 다음 줄로 꺾이지 않음 ─────────
  {
    const { page, ctx } = await open(browser, PAD, '#/surge/history');
    const r = await page.evaluate(() => {
      const cells = [...document.querySelectorAll<HTMLElement>('[data-scroll-table] tbody td')].filter((td) => /\(\+\d/.test(td.textContent ?? ''));
      return cells.map((td) => {
        const spans = td.querySelectorAll('span > span');
        return spans.length === 2 ? Math.round(spans[0].getBoundingClientRect().top) === Math.round(spans[1].getBoundingClientRect().top) : false;
      });
    });
    check(`[148-10-6] 급등 탐지 기록(패드 1133) — 「급등 날짜 (+x%)」 한 줄(${r.length}칸)`, r.length > 0 && r.every(Boolean), JSON.stringify(r));
    await ctx.close();
  }

  // ───────── 3 · 4 · 5 · 7 · 8 시험 틀 ─────────
  {
    const { page, ctx, cdp } = await open(browser, PHONE, '#/home', 2500);
    await mount(page);
    let box = await boxInfo(page, H_BOX);
    // 5 — 끝 흐림
    check('[148-5] 처음 — 오른쪽 흐림만(왼쪽 0 · 오른쪽 1)', box?.fade === 'r' && (await fadeOpacity(page)) === '0/1', `${box?.fade} ${await fadeOpacity(page)}`);
    // 4 — 그림자
    const shadow = () =>
      page.evaluate((s) => {
        const e = document.querySelector(s)!.querySelector<HTMLElement>('[data-scroll-pin-shadow]')!;
        const cs = getComputedStyle(e);
        return cs.display === 'none' ? 'none' : cs.boxShadow;
      }, H_BOX);
    check('[148-4] 가로 스크롤 0 — 고정 칸 그림자 없음', (await shadow()) === 'none', await shadow());
    // 3 — 첫 칸 고정(머리 · 몸)
    const x0 = await firstCellX(page, H_BOX);
    await scrollBox(page, H_BOX, 'mid');
    check('[148-5] 가운데 — 양쪽 흐림(1/1)', (await boxInfo(page, H_BOX))?.fade === 'l r' && (await fadeOpacity(page)) === '1/1', await fadeOpacity(page));
    check('[148-4] 밀면 — 고정 칸 그림자 6px 0 8px -4px rgb(0 0 0 / 0.6)', /rgba\(0, 0, 0, 0\.6\) 6px 0px 8px -4px/.test(await shadow()), await shadow());
    await scrollBox(page, H_BOX, 'end');
    check('[148-5] 끝까지 — 왼쪽 흐림만(1/0)', (await boxInfo(page, H_BOX))?.fade === 'l' && (await fadeOpacity(page)) === '1/0', await fadeOpacity(page));
    const x1 = await firstCellX(page, H_BOX);
    check('[148-3] 시험 표 — 끝까지 밀어도 첫 칸 머리 · 몸 자리 그대로', x0 === x1, `${x0} → ${x1}`);
    // 상자에 안쪽 여백이 있어도 첫 칸이 그 자리
    await mount(page, { pad: true });
    // 첫 칸 글자 왼쪽 끝이 덧칸(여백 덮개 · 흐림)에 덮이지 않음 — 그 자리를 누르면 그 칸이 잡힘
    const firstHit = () =>
      page.evaluate((s) => {
        const td = document.querySelector(s)!.querySelector<HTMLElement>('tbody tr:nth-child(2) > :first-child')!;
        const r = td.getBoundingClientRect();
        const x = r.x + parseFloat(getComputedStyle(td).paddingLeft) + 2;
        const hit = document.elementFromPoint(x, r.y + r.height / 2);
        return !!hit && (hit === td || td.contains(hit));
      }, H_BOX);
    const hit0 = await firstHit();
    const p0 = await firstCellX(page, H_BOX);
    await scrollBox(page, H_BOX, 'end');
    check('[148-3] 안쪽 여백 있는 상자 — 끝까지 밀어도 첫 칸 자리 그대로 · 첫 칸 글자가 덮이지 않음(처음 · 끝)', p0 === (await firstCellX(page, H_BOX)) && hit0 && (await firstHit()), `${p0} → ${await firstCellX(page, H_BOX)} · 덮이지 않음 ${hit0}/${await firstHit()}`);
    // 5 — 넘치지 않는 표
    await mount(page, { narrow: true });
    box = await boxInfo(page, H_BOX);
    check('[148-5] 넘치지 않는 표 — 흐림 없음(0/0)', box?.sw === box?.cw && box?.fade === '' && (await fadeOpacity(page)) === '0/0', `${JSON.stringify(box)} ${await fadeOpacity(page)}`);
    // 7 — 넓은 첫 칸
    await mount(page, { wideFirst: true });
    box = await boxInfo(page, H_BOX);
    const w0 = await firstCellX(page, H_BOX);
    await scrollBox(page, H_BOX, 150);
    const w1 = await firstCellX(page, H_BOX);
    check('[148-7] 첫 칸이 상자 폭 절반을 넘는 표 — 고정하지 않음(data-pin off · 밀면 첫 칸도 밀림)', box?.pin === 'off' && w0 !== w1, `${box?.pin} ${w0} → ${w1}`);

    // 8 — 손가락
    await mount(page);
    const clicks = () => page.evaluate(() => (window as unknown as { __tableHarness: { clicks: number } }).__tableHarness.clicks);
    const row = await page.evaluate((s) => {
      const box = document.querySelector(s)!.getBoundingClientRect();
      const r = document.querySelector(s)!.querySelector('tbody tr:nth-child(3)')!.getBoundingClientRect();
      return { x: Math.round(box.x + box.width * 0.6), y: Math.round(r.y + r.height / 2) };
    }, H_BOX);
    await swipe(cdp!, row.x, row.y, -220, 0);
    await page.waitForTimeout(500);
    const afterSwipe = await boxInfo(page, H_BOX);
    check('[148-8] 표 줄 위에서 가로로 밀기 — 표만 밀림 · 떼도 줄 누름 없음', (afterSwipe?.sl ?? 0) > 0 && (await clicks()) === 0, `scrollLeft ${afterSwipe?.sl} · 누름 ${await clicks()}`);
    await scrollBox(page, H_BOX, 'start');
    await drag(page, cdp!, row.x, row.y, -120);
    check('[148-8] 손가락 끌기(touchmove 120px) 뒤 떼도 줄 누름 없음', (await clicks()) === 0, `누름 ${await clicks()}`);
    await tap(page, cdp!, row.x, row.y);
    check('[148-8] 그냥 누르면 줄 누름 1번', (await clicks()) === 1, `누름 ${await clicks()}`);
    const hostTop0 = await page.evaluate(() => document.querySelector<HTMLElement>('[data-testid="table-harness"]')!.scrollTop);
    const sl0 = (await boxInfo(page, H_BOX))?.sl;
    await swipe(cdp!, row.x, row.y, 0, -300);
    await page.waitForTimeout(500);
    const hostTop1 = await page.evaluate(() => document.querySelector<HTMLElement>('[data-testid="table-harness"]')!.scrollTop);
    check('[148-8] 표 위에서 세로로 밀기 — 바깥이 밀림 · 표 가로는 그대로 · 줄 누름 없음', hostTop1 > hostTop0 && (await boxInfo(page, H_BOX))?.sl === sl0 && (await clicks()) === 1, `바깥 ${hostTop0} → ${hostTop1} · 표 ${sl0} → ${(await boxInfo(page, H_BOX))?.sl} · 누름 ${await clicks()}`);
    await ctx.close();
  }

  // ───────── 9 창 안 표(새 규칙 창 · 패드) ─────────
  // v2.84.0 — 폰 새 규칙 창은 조건 카드가 되어 표가 없다(지시서 159차 · 카드는 mobilequant:test [3]). 창 안 미는 표는 패드 새 규칙 창(손가락 화면)에서 본다
  {
    const { page, ctx, cdp } = await open(browser, PAD, '#/rules');
    await page.getByRole('button', { name: '새 규칙 만들기' }).first().click();
    const dialog = page.getByRole('dialog', { name: '새 규칙 만들기' });
    await dialog.waitFor({ timeout: 8000 });
    await page.waitForTimeout(600);
    const sel = '[role="dialog"] [data-scroll-table]';
    await page.locator(sel).first().evaluate((e) => e.scrollIntoView({ block: 'center' }));
    const natural = await boxInfo(page, sel);
    // 패드에서 이 표는 넘치지 않는다(넘침 0) — 밀기를 시험하려고 표만 1600px 로 넓힌다(앱 코드 아님 · 이 시험 안에서만)
    await page.locator(`${sel} table`).first().evaluate((t) => ((t as HTMLElement).style.minWidth = '1600px'));
    await page.waitForTimeout(400);
    const before = await dialog.boundingBox();
    const info0 = await boxInfo(page, sel);
    // 창 머리 · 아래 단추 줄에 가리지 않고 실제로 보이는 표 줄(그 자리 요소가 표 상자 안)
    const pt = await page.evaluate((s) => {
      const el = document.querySelector(s)!;
      const box = el.getBoundingClientRect();
      const x = Math.round(box.x + box.width * 0.6);
      for (const tr of el.querySelectorAll('tbody tr')) {
        const r = tr.getBoundingClientRect();
        const y = Math.round(r.y + r.height / 2);
        if (y > 0 && y < innerHeight && document.elementFromPoint(x, y)?.closest('[data-scroll-table]') === el) return { x, y };
      }
      return { x, y: Math.round(box.y + box.height / 2) };
    }, sel);
    await swipe(cdp!, pt.x, pt.y, -200, 0);
    await page.waitForTimeout(600);
    const after = await dialog.boundingBox();
    const info1 = await boxInfo(page, sel);
    const same = !!before && !!after && Math.abs(before.y - after.y) < 1 && Math.abs(before.x - after.x) < 1 && Math.abs(before.height - after.height) < 1;
    check(
      `[148-9] 패드 새 규칙 창 안 표(시험에서 1600px 로 넓힘 · 원래 넘침 ${natural ? natural.sw - natural.cw : '-'}px)를 가로로 밀면 표만 밀림(${info1?.sl ?? '-'}px) · 창이 닫히거나 움직이지 않음`,
      (await dialog.count()) === 1 && same && !!info0 && info0.sw > info0.cw && (info1?.sl ?? 0) > 0,
      `창 ${JSON.stringify(before)} → ${JSON.stringify(after)} · 표 ${JSON.stringify(info0)} → ${JSON.stringify(info1)}`,
    );
    await ctx.close();
  }

  // ───────── 11 맨 overflow-x-auto 0 · design:lint ─────────
  {
    const FILES = execFileSync('git', ['grep', '-l', '<table', '--', 'src/components'], { cwd: root, encoding: 'utf8' }).trim().split('\n').filter((f) => f && !f.endsWith('ui/ScrollTable.tsx'));
    const bare = FILES.filter((f) => /overflow-x-auto/.test(fs.readFileSync(path.join(root, f), 'utf8')));
    check(`[148-11] 표가 있는 파일 ${FILES.length}개에 맨 overflow-x-auto 0`, FILES.length >= 32 && bare.length === 0, bare.join(', '));
    const lint = spawnSync('npx', ['tsx', 'scripts/designLint.ts'], { cwd: root, encoding: 'utf8' });
    check('[148-11] design:lint 통과(「맨 overflow-x-auto 표」 · 「미는 표 아님」 0)', lint.status === 0 && !/맨 overflow-x-auto 표|미는 표 아님/.test(lint.stdout), lint.stdout.split('\n').slice(-3).join(' '));
  }

  // ───────── 12 매매 · 주문 · 로그인 · 서버 코드 · 서버가 함께 쓰는 src · designCheck 판정 ─────────
  {
    const changed = (paths: string[]) => chasuDiff(root, CHASU, ['--name-only'], [...paths]).stdout.trim().split('\n').filter(Boolean);
    const server = changed(['server', 'deploy', 'python', 'db']);
    check('[148-12] 매매 · 주문 · 로그인 · 서버 코드(server · deploy · python · db) 바뀐 파일 0', server.length === 0, server.join(', '));
    // ui/tokens.ts 는 서버 프로세스가 쓰지 않지만 시험(scripts)을 거쳐 서버 타입 검사에 들어간다 — 지시서가 값을 이름으로 두라고 한 곳이라 더하기만 허용
    const ADD_ONLY = ['src/data/changelog.ts', 'src/components/ui/tokens.ts'];
    const shared = changed(['src/types', 'src/utils', 'src/services', 'src/data']).filter((f) => !ADD_ONLY.includes(f));
    const log = chasuDiff(root, CHASU, ['-U0'], [...ADD_ONLY]).stdout;
    const removed = log.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---'));
    check('[148-12] 서버가 함께 쓰는 src(types · utils · services · data) 바뀐 줄 0 · changelog · ui/tokens.ts 는 더하기만(지운 줄 0)', shared.length === 0 && removed.length === 0, `${shared.join(', ')} · 지운 줄 ${removed.length}`);
    const dc = changed(['scripts/designCheck.ts']);
    check('[148-12] designCheck.ts 판정 부분 0(파일 그대로)', dc.length === 0, dc.join(', '));
  }
} catch (e) {
  check('실행 오류 없음', false, String(e).slice(0, 300));
} finally {
  await browser.close().catch(() => {});
  await vite.close().catch(() => {});
}
console.log(`\nmobiletable:test — 통과 ${pass} · 실패 ${fail}`);
process.exit(fail ? 1 : 0);
