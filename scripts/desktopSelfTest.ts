/// <reference lib="dom" />
/**
 * 「1280 이상 그대로」 시험 하나(`npm run desktop:test` · v2.83.0 검사 줄이기) — 장면 목록 `scripts/lib/desktopScenes.ts` 를
 * 서버(Vite) 하나 · 브라우저 하나로 1280 × 1080 · 1440 × 900 에서 돌며, 장면마다 보이는 요소의 「태그 · 클래스 · 자리 · 크기」 를
 * 정답 파일 `scripts/fixtures/desktop/<크기>/<묶음>__<장면>.json` 과 견준다(옛 시험의 재는 함수 · 맞춤 그대로).
 *
 * - `/api` 는 모두 가짜 응답(묶음마다 — 모르는 주소 503 · 사용자 서버로 가지 않음). 시계는 묶음마다 고정.
 * - 정답 다시 뜨기는 `npm run desktop:test -- --update <장면 정규식>` **뿐**이다 — 맞는 장면만 다시 쓰고(다른 장면은 그대로 견줌)
 *   다시 뜬 장면 목록을 끝에 적는다. 지시서가 「1280 이 바뀌는 장면」 으로 적은 것만 다시 뜬다(`CLAUDE.md` 2-4).
 *   장면 이름 = `<묶음>/<장면>`(예 `account/새 계좌 창` · 모두 `--update .`).
 * - 정답 파일이 없는 장면은 실패(다시 뜨지 않은 새 장면).
 * - `--summary` 면 통과 줄은 찍지 않는다(실패 줄 · 끝 요약만).
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { createBrowserStepGuard } from './lib/browserStepGuard';
import { DESKTOP_GROUPS, DESKTOP_SIZES, fixtureFile, sceneId, setCalendarSample, sizeKey, type DesktopGroup, type Helpers, type Reply, type Run } from './lib/desktopScenes';
import { closeLeftovers, targets } from './designCheck';
import { fakeContext } from './designReviewShots';
import { calendarSample } from './fixtures/mobileSchedAsset/calendarSample';

const root = path.resolve(import.meta.dirname, '..');
const PORT = 5181;
const WEB = `http://127.0.0.1:${PORT}`;
const argv = process.argv.slice(2);
const QUIET = argv.includes('--summary');
const updateAt = argv.indexOf('--update');
const UPDATE = updateAt >= 0 ? new RegExp(argv[updateAt + 1] ?? '(?!)') : null;
if (updateAt >= 0 && !argv[updateAt + 1]) {
  console.error('--update 뒤에 장면 정규식이 필요합니다(예 --update "^account/")');
  process.exit(2);
}
setCalendarSample(calendarSample);

const guard = createBrowserStepGuard();
let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = '') {
  guard.mark(name);
  if (ok) pass++;
  else fail++;
  if (!ok || !QUIET) console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? ` — ${detail}` : ''}`);
}

const TARGETS = new Map(targets().map((t) => [t.name, t]));
const helpers: Helpers = {
  step: (label, fn) => guard.step(label, fn),
  async assetScene(page: Page, name: string) {
    const t = TARGETS.get(name);
    if (!t) throw new Error(`장면 없음: ${name}`);
    await closeLeftovers(page);
    await page.mouse.move(0, 0);
    if ((await page.evaluate(() => location.hash)) !== '#/home') {
      await page.evaluate(() => (location.hash = '#/home'));
      await page.waitForTimeout(500);
    }
    if (t.before) await t.before(page);
    await page.evaluate((h) => (location.hash = h), t.hash);
    await page.waitForTimeout(2200);
    if (t.open) await guard.step(`장면 ${name}`, () => t.open!(page));
    await page.waitForTimeout(400);
  },
  async assetLeave(page: Page, name: string) {
    const t = TARGETS.get(name)!;
    await page.keyboard.press('Escape').catch(() => {});
    if (t.after) await t.after(page).catch(() => {});
    await closeLeftovers(page);
  },
};

const NO_SCROLLBAR = '*::-webkit-scrollbar { width: 0 !important; height: 0 !important; } * { scrollbar-width: none !important; }';

async function openRun(ctxOf: () => Promise<BrowserContext>, g: DesktopGroup, run: Run, size: { width: number; height: number }) {
  const ctx = await ctxOf();
  await ctx.addInitScript('window.__name = (f) => f');
  await ctx.route(/\/api\//, async (r) => {
    const req = r.request();
    const u = req.url().replace(WEB, '');
    let reply: Reply;
    try {
      reply = run.override?.(u, req.method()) ?? g.api(u, req.method());
    } catch (e) {
      reply = { status: 500, json: { error: String(e) } };
    }
    if (reply) return r.fulfill({ status: reply.status ?? 200, json: reply.json ?? {} }).catch(() => {});
    return r.fulfill({ status: 503, json: { error: '시험 — 없음' } }).catch(() => {});
  });
  if (g.assetContext) await fakeContext(ctx);
  const page = await ctx.newPage();
  if (g.assetContext) page.setDefaultTimeout(8000);
  if (g.fixed) await page.clock.setFixedTime(new Date(g.fixed));
  await guard.step(`페이지 열기(${sizeKey(size)} ${g.id} ${run.hash})`, () => page.goto(`${WEB}/${run.hash}`));
  await page.waitForTimeout(g.settle);
  await page.addStyleTag({ content: NO_SCROLLBAR });
  if (g.afterStyle) await page.waitForTimeout(g.afterStyle);
  return { ctx, page };
}

const { createServer } = await import('vite');
const vite = await guard.step('Vite 띄우기', async () => {
  const v = await createServer({ root, configFile: path.join(root, 'vite.config.ts'), logLevel: 'error', server: { host: '127.0.0.1', port: PORT, strictPort: true, hmr: false } });
  await v.listen();
  return v;
});
const browser = await guard.step('브라우저 띄우기', () => chromium.launch({ channel: 'chrome' }));
const started = Date.now();
const updated: string[] = [];
let scenes = 0;

/** 한 크기의 모든 장면 — 두 크기는 맥락을 따로 두고 함께 돈다(기다림 값은 옛 시험 그대로 · 서버 · 브라우저 하나) */
async function runSize(size: (typeof DESKTOP_SIZES)[number]) {
  for (const g of DESKTOP_GROUPS) {
    for (const run of g.runs) {
      const { ctx, page } = await openRun(() => browser.newContext({ viewport: { ...size } }), g, run, size);
      for (const step of run.steps) {
        const id = sceneId(g.id, step.name);
        const label = `${sizeKey(size)} ${id}`;
        if (step.act) await step.act(page, helpers);
        if (g.stepWait) await page.waitForTimeout(g.stepWait);
        for (const c of (await g.checks?.(page, size, id)) ?? []) check(`[desk] ${label} — ${c.label}(${g.from.test} ${g.from.check})`, c.ok, c.detail);
        const shot = await guard.step(`모양 재기 ${label}`, () => (step.snap ?? g.snap)(page));
        scenes++;
        const file = fixtureFile(size, g.id, step.name);
        if (UPDATE?.test(id)) {
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.writeFileSync(file, `${JSON.stringify(shot, null, 0)}\n`);
          updated.push(label);
          check(`[desk] ${label} — 정답 다시 뜸(요소 ${shot.length}개)`, shot.length > 0);
        } else if (!fs.existsSync(file)) {
          check(`[desk] ${label} — 정답 파일 있음`, false, `${path.relative(root, file)} 없음 — 지시서가 적은 장면이면 --update`);
        } else {
          const want = (JSON.parse(fs.readFileSync(file, 'utf8')) as string[]).map(g.norm);
          const got = shot.map(g.norm);
          const i = want.findIndex((x, k) => x !== got[k]);
          const same = want.length > 0 && want.length === got.length && i < 0;
          check(`[desk] ${label} — 정답과 요소 ${want.length}개 태그 · 클래스 · 자리 · 크기 같음(${g.from.test} ${g.from.check})`, same, same ? '' : `개수 ${want.length} → ${got.length} · 첫 차이 #${i}: ${want[i] ?? '-'} → ${got[i] ?? '-'}`);
        }
        if (step.leave) await step.leave(page, helpers);
      }
      await ctx.close();
    }
  }
}

try {
  await Promise.all(DESKTOP_SIZES.map((size) => runSize(size)));
} catch (e) {
  check('실패: 예외', false, String(e).slice(0, 300));
}

await guard.step('브라우저 닫기', () => browser.close());
await guard.step('Vite 닫기', () => vite.close());
if (updated.length) console.log(`\n정답 다시 뜬 장면 ${updated.length}개:\n${updated.map((u) => `  - ${u}`).join('\n')}`);
console.log(`\n1280 이상 그대로 — 장면 ${scenes}개(${DESKTOP_SIZES.map(sizeKey).join(' · ')}) · ${Math.round((Date.now() - started) / 1000)}초 · 통과 ${pass} · 실패 ${fail}`);
process.exit(fail ? 1 : 0);
