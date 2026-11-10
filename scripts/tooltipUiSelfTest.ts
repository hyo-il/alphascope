/**
 * 앱 툴팁 화면 시험(128차 · v2.69.0) — `npm run tooltipui:test` · ⚠️ `DB_PATH=<사본>` 으로만 돈다(맨 첫 import · DB 는 쓰지 않는다).
 *
 * 128차 지시서 「꼭 지킬 동작」 3 · 4 · 5 의 화면 쪽(시험 이름 앞의 [128-n]) — 1280 × 1080 · 1440 × 900.
 * Vite + Playwright, `/api` 는 모두 `page.route` 가짜(만든 값) — 구글 · 토스 · 서버 호출 0.
 * 시각은 페이지 안에서 잰다(마우스가 대상에 들어간 때 → 툴팁이 보인 때).
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { assetHistorySample, assetSheetSample, assetStatusSample, assetSummarySample, assetTradesSample } from './fixtures/asset/screenSample';
import { createBrowserStepGuard } from './lib/browserStepGuard';

const root = path.resolve(import.meta.dirname, '..');
const PORT = 5196;
const WEB = `http://127.0.0.1:${PORT}`;
const SIZES = [{ width: 1280, height: 1080 }, { width: 1440, height: 900 }];

const guard = createBrowserStepGuard();
let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = '') {
  guard.mark(name);
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? ` — ${detail}` : ''}`);
}

/** 페이지 안 시계 — 마우스가 들어간 때 · 툴팁이 보인 때 · 사라진 때 */
const TIMING = `
  window.__tip = { enter: 0, shown: 0, hidden: 0 };
  document.addEventListener('pointerover', () => { window.__tip.enter = performance.now(); }, true);
  new MutationObserver(() => {
    const t = document.querySelector('[role="tooltip"]');
    const vis = t && t.style.visibility !== 'hidden';
    if (vis && !window.__tip.shown) window.__tip.shown = performance.now();
    if (!vis && window.__tip.shown && !window.__tip.hidden) window.__tip.hidden = performance.now();
  }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['style'] });
`;

async function open(browser: Browser, size: { width: number; height: number }, hash: string, ready: string) {
  const ctx = await browser.newContext({ viewport: size });
  await ctx.addInitScript(() => localStorage.setItem('alphascope.asset.tab', 'status'));
  await ctx.addInitScript('window.__name = (f) => f');
  await ctx.addInitScript(TIMING);
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)));
  const gates: { release: () => void } = { release: () => {} };
  const gate = new Promise<void>((ok) => (gates.release = ok));
  // 붙잡기는 시험이 켤 때만(개발 모드 StrictMode 는 처음 요약을 두 번 받는다 — 화면이 다 뜬 뒤 「다시 읽기」 부터)
  const hold = { on: false };
  await page.route(/\/api\/(?!asset\/)/, (r) => (r.request().url().includes('/api/auth/me') ? r.fulfill({ json: { ok: true } }) : r.fulfill({ status: 503, json: { error: '시험 — 없음' } })));
  await page.route('**/api/asset/status', (r) => r.fulfill({ json: assetStatusSample(true) }));
  await page.route('**/api/asset/touch', (r) => r.fulfill({ json: { ok: true, lockMinutes: 30, remainingMs: 30 * 60_000 } }));
  await page.route('**/api/asset/sheet', (r) => r.fulfill({ json: assetSheetSample() }));
  await page.route('**/api/asset/summary**', async (r) => {
    if (hold.on) await gate;
    await r.fulfill({ json: assetSummarySample({ purchaseDone: true }) });
  });
  await page.route('**/api/asset/history**', (r) => r.fulfill({ json: assetHistorySample(5) }));
  await page.route('**/api/asset/trades**', (r) => r.fulfill({ json: assetTradesSample(20, 20) }));
  await guard.step(`페이지 열기(${hash})`, () => page.goto(`${WEB}/${hash}`));
  await guard.step('화면 기다리기', () => page.locator(ready).first().waitFor({ timeout: 30_000 }));
  return { page, ctx, errors, hold, release: () => gates.release() };
}

const resetTiming = (page: Page) => page.evaluate(() => Object.assign((window as unknown as { __tip: object }).__tip, { enter: 0, shown: 0, hidden: 0 }));
const timing = (page: Page) => page.evaluate(() => (window as unknown as { __tip: { enter: number; shown: number; hidden: number } }).__tip);
/** 지금 보이는 툴팁(없으면 null) — 글 · 글자 크기 · 자리 · 상자 모양 */
const tip = (page: Page) =>
  page.evaluate(() => {
    const all = [...document.querySelectorAll<HTMLElement>('[role="tooltip"]')];
    const t = all[0];
    if (!t || t.style.visibility === 'hidden') return null;
    const r = t.getBoundingClientRect();
    const s = getComputedStyle(t);
    return { count: all.length, text: (t.textContent ?? '').trim(), font: s.fontSize, line: s.lineHeight, radius: s.borderTopLeftRadius, border: s.borderTopWidth, pad: `${s.paddingLeft} ${s.paddingTop}`, bg: s.backgroundColor, left: r.left, right: r.right, top: r.top, bottom: r.bottom, w: r.width, className: t.className };
  });
const away = async (page: Page) => {
  await page.mouse.move(2, 2);
  await page.waitForTimeout(300);
};
/** 대상 가운데로 마우스를 옮기고 툴팁이 뜰 때까지(최대 1.5초) */
async function hover(page: Page, sel: string) {
  await away(page);
  await resetTiming(page);
  const b = (await page.locator(sel).first().boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.waitForFunction(() => (window as unknown as { __tip: { shown: number } }).__tip.shown > 0, null, { timeout: 1500 }).catch(() => {});
  const t = await timing(page);
  return { box: b, tip: await tip(page), delay: t.shown ? Math.round(t.shown - t.enter) : -1 };
}

const { createServer } = await import('vite');
const vite = await guard.step('Vite 띄우기', async () => {
  const v = await createServer({ root, configFile: path.join(root, 'vite.config.ts'), logLevel: 'error', server: { host: '127.0.0.1', port: PORT, strictPort: true, hmr: false } });
  await v.listen();
  return v;
});
const browser = await guard.step('브라우저 띄우기', () => chromium.launch({ channel: 'chrome' }));
try {
  for (const size of SIZES) {
    const w = size.width;
    // ── 자산 관리 ──
    {
      const { page, ctx, errors, hold, release } = await open(browser, size, '#/asset', '[data-account-cards]');
      await page.waitForFunction(() => !(document.querySelector('[data-asset-reload]') as HTMLButtonElement | null)?.disabled, null, { timeout: 10_000 });

      // [128-5] 위 줄 세 버튼 — 아이콘만 · aria-label · 툴팁 글 = 옛 글자 · 28/16
      const top = await page.evaluate(() =>
        ['[data-asset-settings]', '[data-asset-reload]', '[data-asset-lock]'].map((s) => {
          const b = document.querySelector(s) as HTMLElement;
          const r = b.getBoundingClientRect();
          const svg = b.querySelector('svg')!.getBoundingClientRect();
          return { text: (b.textContent ?? '').trim(), label: b.getAttribute('aria-label'), tip: b.getAttribute('data-tip'), title: b.getAttribute('title'), w: r.width, h: r.height, svg: svg.width };
        }),
      );
      check(
        `[128-5] ${w}px — 자산 위 줄 [설정] [다시 읽기] [잠그기] 아이콘만(글자 0) · aria-label · 툴팁 글 = 옛 글자 · 28px 상자 · 16px 아이콘`,
        JSON.stringify(top.map((t) => [t.text, t.label, t.tip, t.title, t.w, t.h, t.svg])) === JSON.stringify([['', '설정', '설정', null, 28, 28, 16], ['', '다시 읽기', '다시 읽기', null, 28, 28, 16], ['', '잠그기', '잠그기', null, 28, 28, 16]]),
        JSON.stringify(top),
      );
      const tools = await page.evaluate(() =>
        ['[data-open-class-dialog]', '[data-trade-history-open]'].map((s) => {
          const b = document.querySelector(s) as HTMLElement;
          return { text: (b.textContent ?? '').trim(), label: b.getAttribute('aria-label'), tip: b.getAttribute('data-tip'), h: b.getBoundingClientRect().height };
        }),
      );
      check(`[128-5] ${w}px — 자산 현황 [자산 분류 정하기] · [매수 · 매도 기록] 아이콘만 · 툴팁 글 = 옛 글자 · [새 종목 매수] 글자 그대로`,
        JSON.stringify(tools) === JSON.stringify([{ text: '', label: '자산 분류 정하기', tip: '자산 분류 정하기', h: 28 }, { text: '', label: '매수 · 매도 기록', tip: '매수 · 매도 기록', h: 28 }]) && (await page.locator('[data-trade-new]').textContent())?.trim() === '새 종목 매수',
        JSON.stringify(tools));
      const tradeText = await page.evaluate(() => [...document.querySelectorAll('[data-trade-buy], [data-trade-sell]')].map((b) => (b.textContent ?? '').trim()));
      check(`[128-5] ${w}px — 종목 줄 [매수] [매도] 글자 그대로`, tradeText.length > 0 && tradeText.every((t) => t === '매수' || t === '매도') && tradeText.includes('매수') && tradeText.includes('매도'), JSON.stringify(tradeText.slice(0, 4)));

      // [128-3] 브라우저 기본 툴팁 0 — 자산 화면 title 속성 0
      const titles = await page.evaluate(() => document.querySelectorAll('[data-asset-dashboard] [title]').length);
      check(`[128-3] ${w}px — 자산 화면에 title 속성 0(브라우저 기본 툴팁이 같이 뜨지 않음)`, titles === 0, String(titles));

      // [128-3] 마우스 → 0.3초 뒤 · 14px · 아래 4px
      {
        const h = await hover(page, '[data-asset-settings]');
        check(`[128-3] ${w}px — [설정] 에 마우스 → 0.3초 뒤 툴팁 「설정」(${h.delay}ms) · 14px · 줄 높이 1.625`,
          h.tip?.text === '설정' && h.delay >= 280 && h.delay <= 600 && h.tip.font === '14px' && Math.abs(parseFloat(h.tip.line) - 14 * 1.625) < 0.6, JSON.stringify({ d: h.delay, t: h.tip }));
        check(`[128-3] ${w}px — 상자 모양 둥글기 8 · 테두리 1 · 여백 10/6 · 대상 아래 4px · 하나만`,
          h.tip?.radius === '8px' && h.tip.border === '1px' && h.tip.pad === '10px 6px' && Math.abs(h.tip.top - (h.box.y + h.box.height + 4)) < 1 && h.tip.count === 1, JSON.stringify(h.tip));
        // 대상 → 상자로 옮기면 열린 채 · 둘 다 벗어나면 0.2초 뒤 닫힘
        await page.mouse.move(h.tip!.left + h.tip!.w / 2, h.tip!.top + 2, { steps: 4 });
        await page.waitForTimeout(450);
        const onBox = await tip(page);
        await resetTiming(page);
        await page.evaluate(() => Object.assign((window as unknown as { __tip: { shown: number } }).__tip, { shown: 1 }));
        await page.mouse.move(2, 2);
        const leftAt = await page.evaluate(() => performance.now());
        await page.waitForFunction(() => (window as unknown as { __tip: { hidden: number } }).__tip.hidden > 0, null, { timeout: 1500 }).catch(() => {});
        const t = await timing(page);
        const closeMs = Math.round(t.hidden - leftAt);
        check(`[128-3] ${w}px — 상자 위로 옮기면 열린 채 · 벗어나고 0.2초 뒤 닫힘(${closeMs}ms)`, onBox?.text === '설정' && closeMs >= 150 && closeMs <= 450, JSON.stringify({ onBox, closeMs }));
      }
      // 0.3초 전에 지나가기 = 안 열림
      {
        await away(page);
        await resetTiming(page);
        const b = (await page.locator('[data-asset-lock]').boundingBox())!;
        await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
        await page.waitForTimeout(150);
        await page.mouse.move(2, 2);
        await page.waitForTimeout(500);
        check(`[128-3] ${w}px — 0.3초 전에 지나가기만 하면 안 열림`, (await timing(page)).shown === 0 && (await tip(page)) == null);
      }
      // 화면 오른쪽 끝 — [잠그기] 툴팁이 화면 안 8px
      {
        const h = await hover(page, '[data-asset-lock]');
        check(`[128-3] ${w}px — 오른쪽 끝 [잠그기] 툴팁 화면 안(오른쪽 ${Math.round(h.tip?.right ?? -1)} ≤ ${w - 8})`, h.tip?.text === '잠그기' && h.tip.right <= w - 8 + 0.5 && h.tip.left >= 8, JSON.stringify(h.tip));
      }
      // 열린 채 다른 대상으로 옮기면 바로 바뀜
      {
        await hover(page, '[data-asset-settings]');
        const b = (await page.locator('[data-asset-lock]').boundingBox())!;
        await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 3 });
        await page.waitForTimeout(80);
        check(`[128-1] ${w}px — 열린 채 [설정] → [잠그기] 로 옮기면 기다리지 않고 바로 바뀜`, (await tip(page))?.text === '잠그기', JSON.stringify(await tip(page)));
      }
      // 누르면 닫힘(고정 안 함) — [다시 읽기] 를 눌러 보며 로딩 표시도 확인
      {
        const h = await hover(page, '[data-asset-reload]');
        hold.on = true;
        await page.mouse.down();
        await page.mouse.up();
        await page.waitForTimeout(400);
        const after = await tip(page);
        const busy = await page.evaluate(() => {
          const b = document.querySelector('[data-asset-reload]') as HTMLButtonElement;
          return { busy: b.getAttribute('aria-busy'), spin: b.querySelector('svg.animate-spin') != null, disabled: b.disabled, label: b.getAttribute('aria-label') };
        });
        check(`[128-1] ${w}px — 누르면 닫힘(그대로 머물러도 다시 안 열림)`, h.tip?.text === '다시 읽기' && after == null, JSON.stringify({ h: h.tip, after }));
        check(`[128-5] ${w}px — 「다시 읽기」 중 아이콘 버튼에 돌아가는 표시(aria-busy · 회전 아이콘 · 누를 수 없음)`, busy.busy === 'true' && busy.spin && busy.disabled && busy.label === '다시 읽기', JSON.stringify(busy));
        hold.on = false;
        release();
        await page.waitForFunction(() => document.querySelector('[data-asset-reload]')?.getAttribute('aria-busy') == null, null, { timeout: 5000 }).catch(() => {});
      }
      // 키보드 Tab — 바로 열림 · Esc 닫힘
      {
        await away(page);
        await page.locator('[data-asset-pension]').focus();
        await resetTiming(page);
        await page.keyboard.press('Tab');
        await page.waitForTimeout(60);
        const t = await tip(page);
        const focused = await page.evaluate(() => document.activeElement?.getAttribute('aria-label'));
        const described = await page.evaluate(() => document.activeElement?.getAttribute('aria-describedby'));
        check(`[128-3] ${w}px — 키보드 Tab 으로 [설정] 에 오면 바로 툴팁(aria-describedby)`, focused === '설정' && t?.text === '설정' && described === 'as-tooltip', JSON.stringify({ focused, t, described }));
        await page.keyboard.press('Escape');
        await page.waitForTimeout(60);
        check(`[128-1] ${w}px — Esc 에 닫힘`, (await tip(page)) == null);
        await page.keyboard.press('Tab');
        await page.waitForTimeout(60);
        const next = await tip(page);
        await page.locator('body').click({ position: { x: 2, y: 2 } }).catch(() => {});
        check(`[128-1] ${w}px — 초점이 다음 대상으로 옮겨 가면 그 툴팁으로(「다시 읽기」)`, next?.text === '다시 읽기', JSON.stringify(next));
      }
      // 긴 이름 — 잘렸을 때만
      {
        const marks = await page.evaluate(() => {
          const spans = [...document.querySelectorAll<HTMLElement>('[data-account-cards] [data-tip-clip]')];
          const free = spans.find((s) => s.scrollWidth <= s.clientWidth);
          const cut = spans.find((s) => s !== free);
          free?.setAttribute('data-test-free', '');
          if (cut) {
            cut.style.maxWidth = '24px';
            cut.setAttribute('data-test-cut', '');
          }
          return { n: spans.length, free: !!free, cut: cut ? cut.scrollWidth > cut.clientWidth : false, text: cut?.getAttribute('data-tip-clip') };
        });
        const hc = await hover(page, '[data-test-cut]');
        const hf = await hover(page, '[data-test-free]');
        check(`[128-3] ${w}px — 긴 이름은 잘렸을 때만 툴팁(전체 이름) · 안 잘린 이름은 툴팁 없음`, marks.n > 0 && marks.free && marks.cut && hc.tip?.text === marks.text && hf.tip == null, JSON.stringify({ marks, cut: hc.tip?.text, free: hf.tip }));
      }
      // 아래 끝 — 위로 뒤집힘(시험용 대상 하나를 화면 아래 끝에 붙인다 · 같은 담당이 그림)
      {
        await page.evaluate(() => {
          const b = document.createElement('button');
          b.textContent = '아래 끝';
          b.setAttribute('data-tip', '화면 아래 끝 — 위로 뒤집혀야 합니다');
          b.setAttribute('data-test-bottom', '');
          Object.assign(b.style, { position: 'fixed', left: '600px', bottom: '2px', height: '20px' });
          document.body.append(b);
        });
        const h = await hover(page, '[data-test-bottom]');
        check(`[128-3] ${w}px — 아래 자리가 모자라면 위로(대상 위 4px)`, h.tip != null && Math.abs(h.tip.bottom - (h.box.y - 4)) < 1, JSON.stringify({ tip: h.tip, box: h.box }));
        await page.evaluate(() => document.querySelector('[data-test-bottom]')?.remove());
      }
      // 꺼진 버튼(예: 쓰기 꺼짐 「구매 완료」) — 예전 title 처럼 툴팁이 뜬다
      {
        await page.evaluate(() => {
          const b = document.createElement('button');
          b.textContent = '꺼진 버튼';
          b.disabled = true;
          b.setAttribute('data-tip', '이 서버에서는 시트 쓰기가 꺼져 있습니다');
          b.setAttribute('data-test-disabled', '');
          Object.assign(b.style, { position: 'fixed', left: '600px', top: '300px', height: '28px' });
          document.body.append(b);
        });
        const h = await hover(page, '[data-test-disabled]');
        check(`[128-3] ${w}px — 꺼진(disabled) 버튼에도 툴팁`, h.tip?.text === '이 서버에서는 시트 쓰기가 꺼져 있습니다', JSON.stringify(h.tip));
        await page.evaluate(() => document.querySelector('[data-test-disabled]')?.remove());
      }
      // 평단 계산기 아이콘 — 같은 툴팁
      {
        const h = await hover(page, '[data-avgcalc-open]');
        check(`[128-5] ${w}px — 평단 계산기 아이콘 툴팁 「평단 계산기」 · 같은 모양(14px)`, h.tip?.text === '평단 계산기' && h.tip.font === '14px', JSON.stringify(h.tip));
      }
      // 스크롤 · 창 크기에 닫힘
      {
        await hover(page, '[data-asset-settings]');
        await page.evaluate(() => window.dispatchEvent(new Event('scroll')));
        await page.waitForTimeout(50);
        const afterScroll = await tip(page);
        await hover(page, '[data-asset-settings]');
        await page.setViewportSize({ width: w - 10, height: size.height });
        await page.waitForTimeout(80);
        const afterResize = await tip(page);
        await page.setViewportSize(size);
        check(`[128-1] ${w}px — 스크롤 · 창 크기 바꿈에 닫힘`, afterScroll == null && afterResize == null, JSON.stringify({ afterScroll, afterResize }));
      }
      // 터치 누름 — 열지 않음
      {
        await away(page);
        await resetTiming(page);
        await page.evaluate(() => {
          const b = document.querySelector('[data-asset-lock]')!;
          b.dispatchEvent(new PointerEvent('pointerover', { bubbles: true, pointerType: 'touch' }));
        });
        await page.waitForTimeout(500);
        check(`[128-1] ${w}px — 터치(마우스 아닌 포인터)에는 열지 않음`, (await tip(page)) == null);
      }
      // [128-5] 표 안 · 창 닫기 sm = 24/14
      {
        await page.locator('[data-asset-settings]').click();
        await page.locator('[role="dialog"]').first().waitFor({ timeout: 5000 });
        const x = await page.evaluate(() => {
          const b = document.querySelector('[role="dialog"] button[aria-label="닫기"]') as HTMLElement;
          return { w: b.getBoundingClientRect().width, h: b.getBoundingClientRect().height, svg: b.querySelector('svg')!.getBoundingClientRect().width, tip: b.getAttribute('data-tip'), title: b.getAttribute('title') };
        });
        check(`[128-5] ${w}px — sm 아이콘 버튼(창 닫기) 24px 상자 · 14px 아이콘 · 툴팁 「닫기」 · title 없음`, x.w === 24 && x.h === 24 && x.svg === 14 && x.tip === '닫기' && x.title == null, JSON.stringify(x));
        await page.keyboard.press('Escape');
      }
      check(`[128-3] ${w}px — 자산 화면 페이지 오류 0`, errors.length === 0, errors.join(' | '));
      await ctx.close();
    }

    // ── [ⓘ] — 증시 일정 「데이터 출처」 ──
    {
      const { page, ctx, errors } = await open(browser, size, '#/calendar', 'button[aria-label="데이터 출처"]');
      const info = 'button[aria-label="데이터 출처"]';
      const h = await hover(page, info);
      const ib = await hover(page, 'button[aria-label="이전 달"]');
      check(`[128-4] ${w}px — [ⓘ] 도 0.3초 뒤(${h.delay}ms) · 같은 상자(같은 클래스 · 14px · 둥글기 8 · 테두리 1)`,
        h.tip != null && h.delay >= 280 && h.delay <= 600 && h.tip.className === ib.tip?.className && h.tip.font === '14px' && h.tip.radius === '8px' && h.tip.border === '1px' && h.tip.text.length > 10,
        JSON.stringify({ d: h.delay, info: h.tip?.className, tip: ib.tip?.className }));
      // 툴팁이 열린 채 [ⓘ] 로 → 툴팁이 닫히고 [ⓘ] 하나만(바로 바뀜)
      const b = (await page.locator(info).boundingBox())!;
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 3 });
      await page.waitForTimeout(80);
      const sw = await tip(page);
      check(`[128-4] ${w}px — 열려 있는 툴팁(「이전 달」)을 닫고 [ⓘ] 하나만`, sw != null && sw.count === 1 && sw.text !== '이전 달' && sw.text.length > 10, JSON.stringify(sw));
      // [ⓘ] 상자 위로 옮기면 열린 채(긴 설명을 읽게)
      await page.mouse.move(sw!.left + 10, sw!.top + 6, { steps: 4 });
      await page.waitForTimeout(450);
      check(`[128-4] ${w}px — [ⓘ] 상자 위로 옮기면 열린 채`, (await tip(page))?.text === sw!.text);
      // 키보드 Tab 으로도 바로
      await away(page);
      await page.locator(info).focus();
      await page.keyboard.press('Shift+Tab');
      await page.keyboard.press('Tab');
      await page.waitForTimeout(60);
      const kb = await tip(page);
      check(`[128-4] ${w}px — [ⓘ] 키보드 Tab 으로 바로 열림`, kb != null && kb.text === sw!.text, JSON.stringify(kb));
      check(`[128-4] ${w}px — 증시 일정 페이지 오류 0`, errors.length === 0, errors.join(' | '));
      await ctx.close();
    }
  }
} finally {
  await guard.step('브라우저 닫기', () => browser.close());
  await guard.step('Vite 닫기', () => vite.close());
  guard.stop();
}
console.log(`\n결과: PASS ${pass} · FAIL ${fail}`);
process.exit(fail > 0 ? 1 : 0);
