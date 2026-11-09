/// <reference lib="dom" />
/**
 * 화면 정리 시험(122차 · v2.67.3) — `npm run uitidy:test` · ⚠️ `DB_PATH=<사본>` 으로만 돈다(맨 첫 import).
 *
 * 지시서 「꼭 지킬 동작」(시험 이름 앞의 [122-n]): 비교 검색칸 안내 글자 잘림 · 관심 목록 말 「폴더」 · 저장 값 그대로 · 체크박스 세로 가운데 · 규칙 · 급등 설정 칸 왼쪽 끝.
 * Vite + Playwright, `/api` 는 모두 `page.route` 가짜(만든 값) — 구글 · 토스 · 서버 호출 0. 새 종목 창 줄([122-3])은 `assettradeui:test`.
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { chromium, type Browser, type Locator, type Page } from 'playwright';
import { DEFAULT_FOLDER_ID, DEFAULT_FOLDER_NAME } from '../src/types/watchlist';
import { createBrowserStepGuard } from './lib/browserStepGuard';

const root = path.resolve(import.meta.dirname, '..');
const PORT = 5194;
const WEB = `http://127.0.0.1:${PORT}`;
const SIZES = [{ width: 1280, height: 1080 }, { width: 1440, height: 900 }];
const SCALE = 2;
const BANNED = /그룹|미분류/;

const guard = createBrowserStepGuard();
let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = '') {
  guard.mark(name);
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? ` — ${detail}` : ''}`);
}

// ── 소스의 화면 글자(주석 제외 — 문자열 · JSX 글자) ──
function screenWords(file: string): { text: string; line: number }[] {
  const src = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const out: { text: string; line: number }[] = [];
  const visit = (n: ts.Node) => {
    if (ts.isStringLiteralLike(n) || ts.isJsxText(n) || ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) {
      if (BANNED.test(n.text)) out.push({ text: n.text.trim().slice(0, 40), line: src.getLineAndCharacterOfPosition(n.getStart()).line + 1 });
    }
    ts.forEachChild(n, visit);
  };
  visit(src);
  return out;
}
{
  const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.tsx?$/.test(e.name) ? [path.join(d, e.name)] : []));
  // 저장 값(기본 폴더 이름)은 화면에 그리지 않는다 — 이 두 곳만 남고, 지난 업데이트 내역은 기록이라 그대로
  const allowed = new Set(['src/types/watchlist.ts', 'src/services/watchlistSync.ts', 'src/data/changelog.ts']);
  const hits = walk(path.join(root, 'src')).flatMap((f) => {
    const rel = path.relative(root, f);
    return allowed.has(rel) ? [] : screenWords(f).map((h) => `${rel}:${h.line} ${h.text}`);
  });
  check('[122-2] 소스의 화면 글자에 「그룹」 · 「미분류」 0곳(주석 · 저장 값 · 지난 changelog 제외)', hits.length === 0, hits.join(' / '));
  const keep = (rel: string) => screenWords(path.join(root, rel)).filter((h) => h.text.includes('미분류')).length;
  check('[122-2] 저장 값 그대로 — 기본 폴더 id · 이름', DEFAULT_FOLDER_ID === 'default' && DEFAULT_FOLDER_NAME === '미분류' && keep('src/types/watchlist.ts') === 1 && keep('src/services/watchlistSync.ts') === 1);
}

// ── 화면 ──
const FOLDERS = [
  { id: 'default', name: '미분류', collapsed: false, symbols: ['AAPL', 'MSFT'] },
  { id: 'f1', name: '반도체', collapsed: false, symbols: ['NVDA'] },
];
const NAMES: Record<string, string> = { AAPL: '애플', MSFT: '마이크로소프트', NVDA: '엔비디아' };
const SURGE = { priceThreshold: 5, thresholdMode: 'manual', volumeThreshold: 200, minSurgeCount: 3, analysisPeriod: '6m', regularityThreshold: 50, usePreset: false, useWatchlist: true, useRanking: true };

async function open(browser: Browser, hash: string, size = SIZES[1]) {
  const ctx = await browser.newContext({ viewport: size, deviceScaleFactor: SCALE });
  await ctx.addInitScript('window.__name = (f) => f');
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)));
  const seen = { watchPuts: [] as { folders: { id: string; name: string; symbols: string[] }[] }[], surgePuts: [] as Record<string, unknown>[] };
  await page.route(/\/api\//, (r) => {
    const url = r.request().url();
    const method = r.request().method();
    if (url.includes('/api/auth/me')) return r.fulfill({ json: { ok: true } });
    if (url.includes('/api/user-data/watchlist')) {
      if (method === 'PUT') {
        seen.watchPuts.push(JSON.parse(r.request().postData() ?? '{}'));
        return r.fulfill({ json: { folders: seen.watchPuts.at(-1)!.folders, recent: [], revision: 1 + seen.watchPuts.length, updatedAt: '2026-11-09T00:00:00.000Z' } });
      }
      return r.fulfill({ json: { folders: FOLDERS, recent: [], revision: 1, updatedAt: '2026-11-09T00:00:00.000Z' } });
    }
    if (url.includes('/api/stocks/info')) {
      const symbol = new URL(url).searchParams.get('symbol') ?? '';
      return r.fulfill({ json: { stock: { symbol, name: NAMES[symbol] ?? symbol, englishName: '', market: 'NASDAQ' } } });
    }
    if (url.includes('/api/rules')) return r.fulfill({ json: { rules: [] } });
    if (url.includes('/api/surge/settings')) {
      if (method === 'PUT') {
        seen.surgePuts.push(JSON.parse(r.request().postData() ?? '{}'));
        return r.fulfill({ json: { settings: { ...SURGE, ...seen.surgePuts.at(-1) } } });
      }
      return r.fulfill({ json: { settings: SURGE, rankingUpdatedAt: null } });
    }
    return r.fulfill({ status: 503, json: { error: '시험 — 없음' } });
  });
  await guard.step(`페이지 열기(${hash})`, () => page.goto(`${WEB}/${hash}`));
  await page.waitForTimeout(1200);
  return { page, ctx, errors, seen };
}

/** 체크박스 ↔ 글자의 세로 가운데 차이(실제 픽셀 · 2배 화면) — 글자는 라벨이면 체크박스 뒤 전부, 아니면 같은 줄의 다음 글자 */
async function inkDiff(page: Page, input: Locator) {
  await input.scrollIntoViewIfNeeded({ timeout: 5000 });
  await page.waitForTimeout(150);
  const m = await input.evaluate((el) => {
    const host = el.closest('label,tr') ?? (el.parentElement as HTMLElement);
    const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT);
    let node: Node | null;
    let found: Node | null = null;
    while ((node = walker.nextNode())) {
      if ((node.textContent ?? '').trim() && el.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) {
        found = node;
        break;
      }
    }
    const range = document.createRange();
    range.selectNodeContents(found as Node);
    if (host.tagName === 'LABEL') {
      range.setStartAfter(el);
      range.setEnd(host, host.childNodes.length);
    }
    const box = (r: DOMRect) => ({ x: r.x, y: r.y, width: r.width, height: r.height });
    return { a: box(el.getBoundingClientRect()), b: box(range.getBoundingClientRect()) };
  });
  const center = async (r: { x: number; y: number; width: number; height: number }) => {
    const x = Math.floor(r.x) - 2;
    const y = Math.floor(r.y) - 2;
    const clip = { x, y, width: Math.ceil(r.x + r.width) + 2 - x, height: Math.ceil(r.y + r.height) + 2 - y };
    const b64 = (await page.screenshot({ clip })).toString('base64');
    const v = await page.evaluate(async (data) => {
      const img = new Image();
      img.src = `data:image/png;base64,${data}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext('2d') as CanvasRenderingContext2D;
      g.drawImage(img, 0, 0);
      const d = g.getImageData(0, 0, img.width, img.height).data;
      const diff = (i: number) => Math.abs(d[i] - d[0]) + Math.abs(d[i + 1] - d[1]) + Math.abs(d[i + 2] - d[2]);
      let max = 0;
      for (let i = 0; i < d.length; i += 4) max = Math.max(max, diff(i));
      let top = 1e9;
      let bottom = -1;
      for (let py = 0; py < img.height; py++) for (let px = 0; px < img.width; px++) {
        if (diff((py * img.width + px) * 4) > max * 0.4) {
          top = Math.min(top, py);
          bottom = Math.max(bottom, py);
        }
      }
      return (top + bottom + 1) / 2;
    }, b64);
    return clip.y + v / SCALE;
  };
  return (await center(m.a)) - (await center(m.b));
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
    // 비교 검색칸
    {
      const { page, ctx } = await open(browser, '#/compare', size);
      await page.getByRole('button', { name: '종목 검색' }).first().click({ timeout: 10_000 });
      const m = await page.locator('input:focus').evaluate((el) => {
        const input = el as HTMLInputElement;
        const cs = getComputedStyle(input);
        const c = document.createElement('canvas').getContext('2d') as CanvasRenderingContext2D;
        c.font = cs.font;
        return { text: input.placeholder, width: c.measureText(input.placeholder).width, inner: input.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) };
      });
      check(`[122-1] ${size.width}px — 비교 검색칸 안내 글자 잘림 없음`, m.text === '종목 이름이나 티커' && m.width <= m.inner, JSON.stringify(m));
      await ctx.close();
    }

    // 관심 목록 관리
    {
      const { page, ctx, errors, seen } = await open(browser, '#/chart', size);
      await page.getByRole('button', { name: '관심 목록 관리 (폴더·순서)' }).click({ timeout: 10_000 });
      await page.locator('input[aria-label="AAPL 선택"]').waitFor({ timeout: 5000 });
      const words = () => page.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
        const attrs = [...dialog.querySelectorAll('[title],[aria-label],[placeholder]')].flatMap((e) => ['title', 'aria-label', 'placeholder'].map((a) => e.getAttribute(a) ?? ''));
        return `${dialog.innerText} ${attrs.join(' ')}`;
      });
      const shown = await words();
      check(`[122-2] ${size.width}px — 관심 목록 관리 글자에 「그룹」 · 「미분류」 0 · 「폴더 없음」 · 「폴더 추가」 있음`, !BANNED.test(shown) && shown.includes('폴더 없음') && shown.includes('폴더 추가'), shown.slice(0, 300));
      const row = page.locator('input[aria-label="AAPL 선택"]');
      const rowDiff = await inkDiff(page, row);
      check(`[122-4] ${size.width}px — 관심 목록 줄 체크박스 ↔ 글자 세로 가운데 ≤ 1px`, Math.abs(rowDiff) <= 1, String(rowDiff));
      await row.click();
      check(`[122-4] ${size.width}px — 관심 목록 줄 체크 동작 그대로`, await row.isChecked());
      await row.click();
      check(`[122-4] ${size.width}px — 관심 목록 줄 체크 풀림 그대로`, !(await row.isChecked()));

      await page.locator('[aria-label="반도체 폴더 삭제"]').click({ force: true });
      const title = page.getByText("'반도체' 폴더 삭제", { exact: true });
      await title.waitFor({ timeout: 5000 });
      const box = await page.locator('body').innerText();
      check(`[122-2] ${size.width}px — 삭제 확인 창 「폴더 삭제」 · 안내에 「그룹」 0`, (await title.count()) === 1 && !BANNED.test(box), box.slice(0, 300));
      await page.getByRole('button', { name: '취소' }).last().click();

      await page.getByRole('button', { name: '+ 폴더 추가' }).click();
      await page.getByPlaceholder('폴더 이름').fill('시험 폴더');
      await page.keyboard.press('Enter');
      await page.waitForTimeout(1200);
      const sent = seen.watchPuts.at(-1);
      const def = sent?.folders.find((f) => f.id === 'default');
      check(`[122-2] ${size.width}px — 서버로 보내는 값 그대로(기본 폴더 id · 이름 · 종목 · 새 폴더)`, def?.name === '미분류' && def.symbols.join() === 'AAPL,MSFT' && sent?.folders.some((f) => f.name === '시험 폴더') === true, JSON.stringify(sent));
      check(`[122-2] ${size.width}px — 화면 오류 0`, errors.length === 0, errors.join(' / '));
      await ctx.close();
    }

    // 매매 규칙 창
    {
      const { page, ctx } = await open(browser, '#/rules', size);
      await page.getByRole('button', { name: '새 규칙 만들기' }).first().click({ timeout: 10_000 });
      const table = page.locator('[role="dialog"] td input[type="checkbox"]');
      await table.first().waitFor({ timeout: 5000 });
      const diff = await inkDiff(page, table.first());
      check(`[122-4] ${size.width}px — 규칙 창 표 체크박스 ↔ 이름 세로 가운데 ≤ 1px`, Math.abs(diff) <= 1, String(diff));
      const centered = await table.first().evaluate((el) => {
        const a = el.getBoundingClientRect();
        const b = (el.parentElement as HTMLElement).getBoundingClientRect();
        return Math.abs(a.left + a.width / 2 - (b.left + b.width / 2));
      });
      check(`[122-4] ${size.width}px — 규칙 창 표 체크박스 가로 칸 가운데`, centered <= 0.5, String(centered));
      const before = await table.first().isChecked();
      await table.first().click();
      check(`[122-4] ${size.width}px — 규칙 창 표 체크 동작 그대로`, (await table.first().isChecked()) !== before);
      const lefts = await page.locator('[role="dialog"] section [data-formrow-value] input').evaluateAll((els) => els.map((e) => (e.parentElement as HTMLElement).getBoundingClientRect().left));
      check(`[122-5] ${size.width}px — 규칙 창 칸 왼쪽 끝 차이 0px`, lefts.length >= 6 && Math.max(...lefts) === Math.min(...lefts), lefts.join(','));
      await ctx.close();
    }

    // 급등 설정
    {
      const { page, ctx, seen } = await open(browser, '#/surge/settings', size);
      await page.locator('[data-formrow-value] select').waitFor({ timeout: 10_000 });
      const boxes = await page.locator('[data-formrow-value]').evaluateAll((els) => els.map((v) => {
        const select = v.querySelector('select');
        const box = select ?? (v.querySelector('input') as HTMLElement).parentElement as HTMLElement;
        return { tag: select ? 'select' : 'input', left: box.getBoundingClientRect().left };
      }));
      const lefts = boxes.map((b) => b.left);
      check(`[122-5] ${size.width}px — 급등 설정 드롭박스 · 숫자 칸 왼쪽 끝 차이 0px`, boxes.length === 5 && boxes.filter((b) => b.tag === 'select').length === 1 && Math.max(...lefts) === Math.min(...lefts), JSON.stringify(boxes));
      if (size.width === 1440) {
        const select = page.locator('[data-formrow-value] select');
        const other = await select.locator('option').evaluateAll((o) => (o as HTMLOptionElement[]).map((x) => x.value).find((v) => v !== '6m') as string);
        await select.selectOption(other);
        await page.getByRole('button', { name: /저장/ }).first().click();
        await page.waitForTimeout(400);
        const sent = seen.surgePuts.at(-1) as typeof SURGE | undefined;
        check('[122-5] 급등 설정 저장 값 그대로(숫자 네 칸 · 고른 기간)', sent?.priceThreshold === 5 && sent.volumeThreshold === 200 && sent.minSurgeCount === 3 && sent.regularityThreshold === 50 && sent.analysisPeriod === other, JSON.stringify(sent));
      }
      await ctx.close();
    }
  }
} finally {
  await browser.close().catch(() => {});
  await vite.close().catch(() => {});
}
console.log(`\n결과: 통과 ${pass} · 실패 ${fail}`);
process.exit(fail ? 1 : 0);
