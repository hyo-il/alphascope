/// <reference lib="dom" />
/**
 * 도구 버튼 · 시험 찾는 방법 · 같은 줄 높이 시험(130차 · v2.69.2) — `npm run toolbutton:test` · ⚠️ `DB_PATH=<사본>` 으로만 돈다(맨 첫 import · DB 는 쓰지 않는다).
 *
 * 130차 지시서 「꼭 지킬 동작」(시험 이름 앞의 [130-n]):
 *   1 시험 · 점검이 툴팁 글로 찾는 곳 0(허용 목록 밖) · 가짜로 넣으면 `design:lint` 실패
 *   2 조작 부품 높이 = `tokens.CONTROL_H` 하나(소스) · 아이콘 버튼과 글자 버튼이 같이 있는 대표 3줄 높이 같음(1280 · 1440)
 *   3 음수 여백 — 새로 넣으면 lint 실패 · 남은 곳은 허용 목록 · 주석
 *   4 `deploy:test` 는 저장소 `docs/` 가 없어도 멈추지 않고 「건너뜀」 을 적음(docs 를 뺀 임시 사본에서 돌림 · 원래 확인 줄 그대로)
 *   5 아이콘 버튼(`IconButton`) · 「조건 보기」 아이콘만 · 글자 그대로 둘 곳
 *   6 접힌 왼쪽 메뉴 — 펼침 메뉴가 열린 동안 그 대메뉴 툴팁 없음 · 닫히면 0.3초 뒤 뜸 · 넓은 메뉴 그대로
 *   7 서버 · 매매 · 주문 · 로그인 코드 · 서버가 함께 쓰는 src · designCheck 판정 부분 바뀐 줄 0(130차 v2.69.2 동안만)
 * 화면은 Vite + Playwright, `/api` 는 모두 `page.route` 가짜(만든 값) — 구글 · 토스 · 서버 호출 0.
 * **요소는 역할 + 이름(`getByRole`) 또는 `data-testid` 로 찾는다**(툴팁 글 · 클래스 · 순서로 찾지 않는다 — 130차 규칙).
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, type Browser, type Locator, type Page } from 'playwright';
import { CONTROL_H, ICON_BUTTON_BOX, SEGMENT_H } from '../src/components/ui/tokens';
import { defaultRuleBody, EMPTY_USAGE } from '../src/types/tradingRule';
import { assetHistorySample, assetSheetSample, assetStatusSample, assetSummarySample, assetTradesSample } from './fixtures/asset/screenSample';
import { createBrowserStepGuard } from './lib/browserStepGuard';
import { serverSharedSrc } from './lib/serverSharedSrc';

const root = path.resolve(import.meta.dirname, '..');
const PORT = 5197;
const WEB = `http://127.0.0.1:${PORT}`;
const SIZES = [{ width: 1280, height: 1080 }, { width: 1440, height: 900 }];
const BASE = '72679bb'; // 130차 기준 커밋(v2.69.1)

const guard = createBrowserStepGuard();
let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = '') {
  guard.mark(name);
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? ` — ${detail}` : ''}`);
}
const code = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const tsx = path.join(root, 'node_modules/tsx/dist/cli.mjs');
const lint = (env: Record<string, string>) => spawnSync(process.execPath, [tsx, 'scripts/designLint.ts'], { cwd: root, env: { ...process.env, ...env }, encoding: 'utf8' });

// ── [130-1] [130-3] design:lint — 지금 코드 0 · 시험이 툴팁 글로 찾으면 실패 · 음수 여백을 새로 넣으면 실패(가짜 파일 · 끝나면 지움 · 커밋 안 함) ──
{
  const now = lint({});
  check('[130-1] [130-3] design:lint 지금 코드 0개(시험 찾는 방법 · 음수 여백 포함)', now.status === 0, (now.stdout ?? '').slice(-500));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'alphascope-lint-130-'));
  const fakeScript = path.join(dir, 'fakeFind.ts');
  const fakeScreen = path.join(root, 'scripts', '.lint-fake-130', 'Neg.tsx');
  try {
    // 툴팁 글로 찾는 줄 셋(속성 · 다른 속성 · getByTitle) — 글자를 이어 붙여 이 파일 자체는 검사에 걸리지 않게
    const q = (attr: string) => `await page.locator('[${attr}` + `="설정"]').click();`;
    fs.writeFileSync(fakeScript, [q('data-tip'), q('title'), q('data-tip-clip'), "await page.getBy" + "Title('설정').click();", "await page.getByRole('button', { name: '설정' }).click();", ''].join('\n'));
    const r = lint({ DESIGN_LINT_SCRIPTS_EXTRA: fakeScript });
    const out = r.stdout ?? '';
    const hits = out.split('\n').filter((l) => l.includes('fakeFind.ts') && l.includes('[툴팁 글로 찾기]'));
    check('[130-1] 시험에 툴팁 속성(data-tip · title · data-tip-clip) 값 · getBy-Title 로 찾는 줄을 넣으면 lint 실패(4줄 모두 · 역할 + 이름 줄은 통과)', r.status === 1 && hits.length === 4 && !/fakeFind\.ts:5 /.test(out), out.slice(-600));

    fs.mkdirSync(path.dirname(fakeScreen), { recursive: true });
    fs.writeFileSync(fakeScreen, "export function Neg() {\n  return (\n    <div className=\"space-y-3\">\n      <p className=\"-mt-2 text-xs\">a</p>\n      <p className=\"mt-2 -mx-4\">b</p>\n      <p className=\"mt-2 px-4\">c</p>\n    </div>\n  );\n}\n");
    const n = lint({ DESIGN_LINT_EXTRA: fakeScreen });
    const nOut = n.stdout ?? '';
    check('[130-3] 화면 코드에 음수 여백(-mt- · -mx-)을 새로 넣으면 lint 실패(2줄 · 양수 여백 줄은 통과)', n.status === 1 && /Neg\.tsx:4 {2}\[음수 여백\]/.test(nOut) && /Neg\.tsx:5 {2}\[음수 여백\]/.test(nOut) && !/Neg\.tsx:6 /.test(nOut), nOut.slice(-600));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(path.dirname(fakeScreen), { recursive: true, force: true });
  }
  check('[130-1] [130-3] 시험용 가짜 파일 지움', !fs.existsSync(dir) && !fs.existsSync(path.dirname(fakeScreen)));
  // 허용 목록 — 이름 붙은 목록 · 지금 있는 곳만(시험 찾기 1 · 음수 여백 12 — 14줄) · 음수 여백 자리마다 그 줄(또는 위 세 줄 안) 주석
  const lintSrc = code('scripts/designLint.ts');
  const findOk = (lintSrc.match(/export const SCRIPT_FIND_OK[\s\S]*?\n\];/)?.[0].match(/\{ file: '/g) ?? []).length;
  const negBlock = lintSrc.match(/export const NEGATIVE_MARGIN_OK[\s\S]*?\n\];/)?.[0] ?? '';
  const negRows = [...negBlock.matchAll(/\{ file: '([^']+)', has: '([^']+)'/g)].map((m) => ({ file: m[1], has: m[2] }));
  const noNote = negRows.filter((r) => {
    const lines = code(r.file).split('\n');
    return lines.some((l, i) => l.includes(r.has) && !/음수 여백/.test(lines.slice(Math.max(0, i - 3), i + 1).join('\n')));
  });
  check(`[130-1] [130-3] 허용 목록 — 시험 찾기 ${findOk}곳 · 음수 여백 ${negRows.length}곳 · 음수 여백 자리마다 까닭 주석`, findOk === 1 && negRows.length === 12 && noNote.length === 0, noNote.map((r) => `${r.file} ${r.has}`).join(', '));
}

// ── [130-2] 조작 부품 높이 — 이름 하나(CONTROL_H) ──
{
  const ui = (f: string) => code(`src/components/ui/${f}`);
  // 주석 줄은 빼고 센다
  const heightNums = (t: string) => (t.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n').match(/\bh-(?:6|7|8)\b/g) ?? []).length;
  check('[130-2] CONTROL_H = md 32(h-8) · sm 28(h-7 · 도구 줄) · xs 24(h-6 · 표 안)', JSON.stringify(CONTROL_H) === JSON.stringify({ md: 'h-8', sm: 'h-7', xs: 'h-6' }));
  check('[130-2] 아이콘 버튼 · 묶음 버튼 칸 높이는 CONTROL_H 에서(값 그대로 — md 28 · sm 24)', JSON.stringify(ICON_BUTTON_BOX) === JSON.stringify({ md: 'h-7 w-7', sm: 'h-6 w-6' }) && JSON.stringify(SEGMENT_H) === JSON.stringify({ md: 'h-7', sm: 'h-6' }) && /ICON_BUTTON_BOX = \{ md: `\$\{CONTROL_H\.sm\} w-7`, sm: `\$\{CONTROL_H\.xs\} w-6` \}/.test(ui('tokens.ts')) && /SEGMENT_H = \{ md: CONTROL_H\.sm, sm: CONTROL_H\.xs \}/.test(ui('tokens.ts')));
  const tokensRest = ui('tokens.ts').replace(/export const CONTROL_H = \{[^}]*\}/, '');
  check('[130-2] tokens.ts 안에 높이 숫자(h-6 · h-7 · h-8)는 CONTROL_H 한 줄에만', heightNums(tokensRest) === 0, String(heightNums(tokensRest)));
  const users = ['Button.tsx', 'Segmented.tsx', 'IconButton.tsx', 'Input.tsx', 'Select.tsx', 'NumberField.tsx'];
  const own = users.filter((f) => heightNums(ui(f)) > 0);
  check(`[130-2] Button · Segmented · IconButton · Input · Select · NumberField 에 따로 적은 높이 숫자 0(${users.length}파일)`, own.length === 0, own.join(', '));
  check('[130-2] Button sm = CONTROL_H.sm · Segmented 틀 = CONTROL_H · IconButton = ICON_BUTTON_BOX(← CONTROL_H)', /sm: `\$\{CONTROL_H\.sm\}/.test(ui('Button.tsx')) && /\$\{CONTROL_H\[size\]\}/.test(ui('Segmented.tsx')) && /ICON_BUTTON_BOX\[size\]/.test(ui('IconButton.tsx')) && /\$\{CONTROL_H\[size\]\}/.test(ui('Input.tsx')) && /\$\{CONTROL_H\[size\]\}/.test(ui('Select.tsx')));
}

// ── [130-4] deploy:test — docs/ 없는 사본에서 멈추지 않고 「건너뜀」 ──
{
  check('[130-4] deploySelfTest 의 docs 훑기 — 폴더가 없으면 건너뜀(있을 때만 walk)', /const docsThere = fs\.existsSync\(DOCS_DIR\);\s*\n\s*if \(docsThere\) walk\(DOCS_DIR\);/.test(code('scripts/deploySelfTest.ts')));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alphascope-nodocs-130-'));
  try {
    const skip = new Set(['node_modules', '.git', 'docs', 'reports', 'db', 'dist', '.env', 'python']);
    fs.cpSync(root, tmp, { recursive: true, filter: (src) => !skip.has(path.relative(root, src).split(path.sep)[0]) });
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(tmp, 'node_modules'));
    fs.mkdirSync(path.join(tmp, 'python'));
    for (const f of fs.readdirSync(path.join(root, 'python'))) if (f !== '.venv' && f !== '__pycache__') fs.cpSync(path.join(root, 'python', f), path.join(tmp, 'python', f), { recursive: true });
    const r = spawnSync(process.execPath, [path.join(tmp, 'node_modules/tsx/dist/cli.mjs'), 'scripts/deploySelfTest.ts'], { cwd: tmp, env: process.env, encoding: 'utf8', timeout: 300_000 });
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    const line = out.split('\n').find((l) => l.includes('맥에 없는 접속 이름')) ?? '';
    check('[130-4] docs/ 를 뺀 사본에서 deploy:test 가 그 확인 줄까지 멈추지 않고 「docs(폴더 없음 — 건너뜀)」 · 통과(✓)', !fs.existsSync(path.join(tmp, 'docs')) && /✓/.test(line) && line.includes('docs(폴더 없음 — 건너뜀)'), line || out.slice(-600));
    check('[130-4] docs/ 를 뺀 사본에서 deploy:test 끝까지 통과(종료 코드 0)', r.status === 0, out.slice(-600));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  check('[130-4] 임시 사본 지움(저장소 docs/ 는 그대로)', !fs.existsSync(tmp) && fs.existsSync(path.join(root, 'docs')));
}

// ── [130-7] 서버 · 매매 · 주문 · 로그인 · 서버가 함께 쓰는 src · designCheck 판정 부분 바뀐 줄 0(130차 v2.69.2 동안만) ──
{
  const head = code('src/data/changelog.ts').match(/version: '(v[\d.]+)'/)?.[1];
  if (head !== 'v2.69.1' && head !== 'v2.69.2') console.log(`건너뜀  [130-7] 지금 버전 ${head} — 130차(v2.69.2) 범위 시험`);
  else {
    const git = (...a: string[]) => execFileSync('git', a, { cwd: root, encoding: 'utf8' });
    const diff = (...p: string[]) => git('diff', '--name-only', BASE, '--', ...p).trim();
    check(`[130-7] git diff ${BASE} -- server python src/services = 0개`, diff('server', 'python', 'src/services') === '', diff('server', 'python', 'src/services'));
    const shared = serverSharedSrc();
    const CHANGELOG = 'src/data/changelog.ts';
    const touched = diff(...shared.closure.filter((f) => f !== CHANGELOG));
    check(`[130-7] 서버가 함께 쓰는 src ${shared.direct.length}개 + 그 가져오기 파일(전체 ${shared.closure.length}개 · 업데이트 내역 밖) 바뀐 줄 0`, shared.direct.length === 54 && touched === '', `${shared.direct.length} · ${touched}`);
    const cl = git('diff', '-U0', BASE, '--', CHANGELOG).split('\n');
    check('[130-7] 업데이트 내역(changelog.ts)은 맨 앞 항목 더하기만(지운 · 바꾼 줄 0)', cl.filter((l) => /^-(?!--)/.test(l)).length === 0);
    const ops = diff('deploy', 'db', 'scripts/lib/testServerEnv.ts', 'scripts/lib/requireCopyDb.ts', 'scripts/lib/requireTossKeys.ts', '.env.example');
    check('[130-7] 배포 · DB 정의 · 시험 서버 스위치 · 사본 DB 막기 바뀐 파일 0', ops === '', ops);
    // designCheck — 바뀐 곳은 장면(targets() 안)과 맨 위 import 한 줄뿐 · 측정 판정(targets() 뒤) 바뀐 줄 0
    const baseDc = git('show', `${BASE}:scripts/designCheck.ts`).split('\n');
    const startT = baseDc.findIndex((l) => l.startsWith('function targets(): Target[] {')) + 1;
    const endT = baseDc.findIndex((l) => l === '  return list;') + 1;
    const hunks = [...git('diff', '-U0', BASE, '--', 'scripts/designCheck.ts').matchAll(/^@@ -(\d+)(?:,(\d+))? /gm)].map((m) => ({ from: Number(m[1]), n: m[2] == null ? 1 : Number(m[2]) }));
    const outside = hunks.filter((h) => {
      const last = h.from + Math.max(h.n, 1) - 1;
      const isImport = h.n <= 1 && /^import \{ chromium/.test(baseDc[h.from - 1] ?? '');
      return !isImport && (h.from <= startT || last >= endT);
    });
    check(`[130-7] designCheck.ts — 판정 부분(장면 목록 ${startT}~${endT}줄 밖) 바뀐 줄 0(바뀐 덩어리 ${hunks.length}개 모두 장면 찾기 · import)`, startT > 0 && endT > startT && outside.length === 0, JSON.stringify(outside));
  }
}

// ── 화면 ──
const RULE = { id: 1, name: '기본 규칙', createdAt: '2026-11-01T00:00:00.000Z', updatedAt: '2026-11-01T00:00:00.000Z', usedBy: { ...EMPTY_USAGE, buyJudge: true }, ...defaultRuleBody() };
const JUDGE = { ruleId: 1, ruleName: '기본 규칙', symbols: ['AAPL'], retention: '6m', rows: [], computedAt: '2026-11-10T07:00:00.000Z' };

async function open(browser: Browser, size: { width: number; height: number }, hash: string, ready: (p: Page) => Locator) {
  const ctx = await browser.newContext({ viewport: size });
  await ctx.addInitScript(() => localStorage.setItem('alphascope.asset.tab', 'status'));
  await ctx.addInitScript('window.__name = (f) => f');
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)));
  await page.route(/\/api\//, (r) => {
    const url = r.request().url();
    if (url.includes('/api/auth/me')) return r.fulfill({ json: { ok: true } });
    if (/\/api\/rules(\?|$)/.test(url)) return r.fulfill({ json: { rules: [RULE] } });
    if (/\/api\/buy-judge(\?|$)/.test(url)) return r.fulfill({ json: JUDGE });
    if (url.includes('/api/asset/status')) return r.fulfill({ json: assetStatusSample(true) });
    if (url.includes('/api/asset/touch')) return r.fulfill({ json: { ok: true, lockMinutes: 30, remainingMs: 30 * 60_000 } });
    if (url.includes('/api/asset/sheet')) return r.fulfill({ json: assetSheetSample() });
    if (url.includes('/api/asset/summary')) return r.fulfill({ json: assetSummarySample({ purchaseDone: true }) });
    if (url.includes('/api/asset/history')) return r.fulfill({ json: assetHistorySample(5) });
    if (url.includes('/api/asset/trades')) return r.fulfill({ json: assetTradesSample(20, 20) });
    return r.fulfill({ status: 503, json: { error: '시험 — 없음' } });
  });
  await guard.step(`페이지 열기(${hash})`, () => page.goto(`${WEB}/${hash}`));
  await guard.step('화면 기다리기', () => ready(page).first().waitFor({ timeout: 30_000 }));
  await page.waitForTimeout(300);
  return { page, ctx, errors };
}

/**
 * 한 줄의 조작 부품 높이 — `anchor`(아이콘 버튼) 가운데 높이를 지나는, `row` 안의 버튼 · 묶음 버튼 · 입력칸 · 드롭박스.
 * 묶음 버튼 안 칸은 틀(radiogroup)로 센다.
 */
const rowControls = async (anchor: Locator, row: Locator) =>
  row.evaluate((box, a) => {
    const ar = a.getBoundingClientRect();
    const mid = ar.top + ar.height / 2;
    const els = [...box.querySelectorAll<HTMLElement>('button, select, input:not([type="checkbox"]):not([type="radio"]), [role="radiogroup"]')].filter((e) => !e.closest('[role="radiogroup"]') || e.getAttribute('role') === 'radiogroup');
    return els
      .map((e) => ({ e, r: e.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && r.top < mid && r.bottom > mid)
      .map(({ e, r }) => ({
        kind: e.getAttribute('role') === 'radiogroup' ? '묶음 버튼' : e.tagName === 'SELECT' ? '드롭박스' : e.tagName === 'INPUT' ? '입력칸' : (e.textContent ?? '').trim() ? '글자 버튼' : '아이콘 버튼',
        name: e.getAttribute('aria-label') ?? (e.textContent ?? '').trim().slice(0, 12),
        h: Math.round(r.height * 10) / 10,
      }));
  }, (await anchor.elementHandle())!);

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
    // [130-2] 대표 3줄 — 아이콘 버튼과 글자 버튼(· 묶음 버튼 · 드롭박스)이 같이 있는 줄
    const rows: { name: string; hash: string; anchor: (p: Page) => Locator; row: (p: Page, a: Locator) => Locator }[] = [
      { name: '자산 현황 도구 줄', hash: '#/asset', anchor: (p) => p.getByRole('button', { name: '자산 분류 정하기', exact: true }), row: (_p, a) => a.locator('xpath=..') },
    ];
    for (const r of rows) {
      const { page, ctx, errors } = await open(browser, size, r.hash, r.anchor);
      const anchor = r.anchor(page);
      const ctrls = await rowControls(anchor, r.row(page, anchor));
      const hs = [...new Set(ctrls.map((c) => c.h))];
      const kinds = new Set(ctrls.map((c) => c.kind));
      check(`[130-2] ${w}px — ${r.name} 높이 하나(${hs.join(' · ')}px · ${ctrls.length}개 — ${[...kinds].join(' · ')})`, hs.length === 1 && hs[0] === 28 && kinds.has('아이콘 버튼') && kinds.size >= 2, JSON.stringify(ctrls));
      check(`[130-2] ${w}px — ${r.name} 화면 페이지 오류 0`, errors.length === 0, errors.join(' | '));
      await ctx.close();
    }
  }
} finally {
  await guard.step('브라우저 닫기', () => browser.close());
  await guard.step('Vite 닫기', () => vite.close());
  guard.stop();
}
console.log(`\n도구 버튼 시험 — 통과 ${pass} · 실패 ${fail}`);
process.exit(fail ? 1 : 0);
