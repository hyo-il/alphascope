/**
 * 기계 검사 나누기 시험(154차 · 버전 그대로 v2.80.0) — `npm run machinecheck:test` · ⚠️ `DB_PATH=<사본>` 으로만 돈다(맨 첫 import · 시험 DB 는 쓰지 않는다).
 * 브라우저 시험이 아니다(Playwright 를 쓰지 않는다).
 *
 * 1. [154-1] 가르기: 브라우저 시험 + 아닌 시험 = `:test` 전부(빠진 것 · 겹친 것 0) · 가짜 파일로 「몇 단계 건너 Playwright」 도 브라우저
 * 2. [154-2] `--quick` 은 브라우저 시험을 하나도 부르지 않는다 — 가짜 시험 목록(임시 폴더)으로 실제로 돌려 부른 표시 파일을 센다 ·
 *    결과표 · `last.json` 에 「브라우저」 칸
 * 3. [154-3] `--plan`: 5분 넘는 시험은 혼자 묶음 · 묶음마다 합이 그 분 안(가짜 시간) · 시험마다 한 번
 * 4. [154-4] `--changed`: 자산 화면 파일 하나 → 자산 브라우저 시험만(차트 · 매수 판단 시험 없음) · `src/components/ui/` 파일 → 쓰는 화면 시험(v2.83.0) ·
 *    package.json `scripts` 줄만 바뀐 것은 전부가 아님
 * 5. [154-7] 관리 루트 `CLAUDE.md` 25,000바이트 아래 · 2-4 새 규칙 줄
 * 6. [154-8] 154차 커밋(메시지 「154차」) · 작업 트리의 앱 코드(`src` · `server` · `python`) 바뀐 줄 0
 * v2.83.0 검사 줄이기 「꼭 지킬 동작」(가짜 저장소 — 임시 폴더 · git · 시험이 부른 표시 파일을 센다):
 * E1 빠짐 0 — 옛 시험 7개의 1280 · 1440 장면(`fixtures/desktop/legacyScenes.json`) ⊂ `desktopScenes.ts` · 장면마다 두 크기 정답 파일 · 이 목록 파일은 Playwright 를 쓰지 않음
 * E2 `--changed` — 가짜 `src/components/ui/Button.tsx` 를 바꾸면 그것을 쓰는 화면의 시험만(까닭 줄) · 안 쓰는 화면 시험은 안 고름 · `desktop:test` 는 늘 · `--run` 이 그것만 부름
 * E3 `--failed` — 가짜 `last.json`(실패 2 · 통과 5) → 실패 2 + `--also` 1 만 부름
 * E4 `--batch` — `--plan 8` 묶음 n 번만 부름(시간 기록이 바뀌어도 얼린 묶음 그대로) · 5분 넘는 시험 혼자 · 같은 시간이면 묶음 목록이 같음 · 이름 순
 * E5 훅 — `hooks:test`(막을 명령 5 · 막지 않을 명령 5 이상) 통과
 * E6 앱 코드 — 이 차수 커밋(메시지 「v2.83.0 검사 줄이기」) · 작업 트리의 `src` · `server` · `python` 바뀐 파일 0
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { ALWAYS, DEFAULT_BROWSER_SEC, DEFAULT_PLAIN_SEC, LONG_SEC, estimateSec, packageJsonScriptsOnly, planBatches, selectChanged, splitTests, testFiles, usesBrowser } from './lib/checkScope';
import { allScenes, DESKTOP_GROUPS, DESKTOP_SIZES, fixtureFile, sizeKey } from './lib/desktopScenes';

const root = path.resolve(import.meta.dirname, '..');
let pass = 0;
let failCount = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) pass++;
  else failCount++;
  console.log(`${ok ? '통과' : '실패'}  ${name}${!ok && detail ? ` — ${detail}` : ''}`);
}
const git = (args: string[]) => spawnSync('git', ['-c', 'core.quotePath=false', ...args], { cwd: root, encoding: 'utf8' }).stdout.split('\n').filter(Boolean);

// ── [154-1] 가르기 ──
const names = Object.keys(testFiles(root));
const split = splitTests(root, names);
{
  const both = split.browser.filter((n) => split.plain.includes(n));
  const missing = names.filter((n) => !split.browser.includes(n) && !split.plain.includes(n));
  check(`[154-1] 브라우저 ${split.browser.length} + 아님 ${split.plain.length} = :test ${names.length} · 겹침 0 · 빠짐 0`, both.length === 0 && missing.length === 0 && split.browser.length + split.plain.length === names.length, `겹침 ${both} · 빠짐 ${missing}`);
  console.log(`  브라우저 시험: ${split.browser.join(' ')}`);
  check('[154-1] 이 시험(machinecheck:test)은 브라우저 아님', split.plain.includes('machinecheck:test'));
  // 브라우저로 가른 시험 파일은 실제로 playwright 를 (직접 또는 건너) 쓰고, 아닌 것은 그 글이 직접 없다
  const directPw = (n: string) => /^\s*import\s[^'"]*from\s+['"](playwright|@playwright\/test)['"]/m.test(fs.readFileSync(split.files[n], 'utf8'));
  check('[154-1] 브라우저 아님으로 가른 시험 파일에 playwright import 0', split.plain.every((n) => !directPw(n)), split.plain.filter(directPw).join(', '));

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-mc-split-'));
  try {
    fs.mkdirSync(path.join(tmp, 'lib'));
    fs.writeFileSync(path.join(tmp, 'lib', 'deep.ts'), "import { chromium } from 'playwright';\nexport const x = chromium;\n");
    fs.writeFileSync(path.join(tmp, 'lib', 'mid.ts'), "export { x } from './deep';\n");
    fs.writeFileSync(path.join(tmp, 'a.ts'), "import { x } from './lib/mid';\nconsole.log(x);\n");
    fs.writeFileSync(path.join(tmp, 'b.ts'), "import fs from 'node:fs';\n// playwright 라는 글자만 있음 — chromium.launch()\nconsole.log(fs);\n");
    // 이 파일 글이 동적 import 로 읽히지 않게 이름을 나눠 적는다
    fs.writeFileSync(path.join(tmp, 'c.ts'), `const m = await import('@play${'wright'}/test');\nconsole.log(m);\n`);
    check('[154-1] 가짜: 두 단계 건너 Playwright = 브라우저', usesBrowser(tmp, path.join(tmp, 'a.ts')));
    check('[154-1] 가짜: 글자만 있고 import 없음 = 아님', !usesBrowser(tmp, path.join(tmp, 'b.ts')));
    check('[154-1] 가짜: 동적 import(@playwright/test) = 브라우저', usesBrowser(tmp, path.join(tmp, 'c.ts')));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ── [154-2] --quick 은 브라우저 시험을 부르지 않는다(가짜 시험 목록으로 실제로 돌림) ──
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-mc-quick-'));
  try {
    fs.mkdirSync(path.join(tmp, 'scripts', 'lib'), { recursive: true });
    fs.copyFileSync(path.join(root, 'scripts', 'machineCheck.ts'), path.join(tmp, 'scripts', 'machineCheck.ts'));
    fs.copyFileSync(path.join(root, 'scripts', 'lib', 'checkScope.ts'), path.join(tmp, 'scripts', 'lib', 'checkScope.ts'));
    fs.symlinkSync(path.join(root, 'node_modules'), path.join(tmp, 'node_modules'));
    fs.symlinkSync(path.join(root, 'python'), path.join(tmp, 'python')); // 지표 엔진 5002 가 없으면 띄운다(끝나면 스스로 끔)
    const mark = (n: string) => `import fs from 'node:fs';\nfs.writeFileSync(${JSON.stringify(path.join(tmp, 'ran'))} + '/${n}', '');\n`;
    fs.mkdirSync(path.join(tmp, 'ran'));
    fs.writeFileSync(path.join(tmp, 'scripts', 'lib', 'browserHelper.ts'), "import { chromium } from 'playwright';\nexport const launch = () => chromium;\n");
    fs.writeFileSync(path.join(tmp, 'scripts', 'plainA.ts'), mark('plainA'));
    fs.writeFileSync(path.join(tmp, 'scripts', 'plainB.ts'), mark('plainB'));
    fs.writeFileSync(path.join(tmp, 'scripts', 'browserA.ts'), "import { chromium } from 'playwright';\n" + mark('browserA') + 'void chromium;\n');
    fs.writeFileSync(path.join(tmp, 'scripts', 'browserB.ts'), "import { launch } from './lib/browserHelper';\n" + mark('browserB') + 'void launch;\n');
    const tsx = 'tsx';
    fs.writeFileSync(path.join(tmp, 'package.json'), JSON.stringify({ name: 'fake', private: true, type: 'module', scripts: {
      'plaina:test': `${tsx} scripts/plainA.ts`, 'plainb:test': `${tsx} scripts/plainB.ts`, 'browsera:test': `${tsx} scripts/browserA.ts`, 'browserb:test': `${tsx} scripts/browserB.ts`,
    } }, null, 2));
    fs.mkdirSync(path.join(tmp, 'db'));
    const db = new Database(path.join(tmp, 'db', 'alphascope.db'));
    db.exec('CREATE TABLE t (a)');
    db.close();
    const cli = path.join(root, 'node_modules/tsx/dist/cli.mjs');
    const env = { ...process.env };
    delete env.DB_PATH;
    const plan = spawnSync(process.execPath, [cli, 'scripts/machineCheck.ts', '--quick', '--plan', '8'], { cwd: tmp, encoding: 'utf8', env });
    check('[154-2] --quick --plan 목록에 가짜 브라우저 시험 0 · 아닌 시험 둘', plan.status === 0 && !/browser[ab]:test/.test(plan.stdout) && /plaina:test/.test(plan.stdout) && /plainb:test/.test(plan.stdout), plan.stdout + plan.stderr);
    const r = spawnSync(process.execPath, [cli, 'scripts/machineCheck.ts', '--quick', '--skip-types', '--skip-lint', '--skip-build'], { cwd: tmp, encoding: 'utf8', env, timeout: 180_000 });
    const ran = fs.readdirSync(path.join(tmp, 'ran')).sort();
    check('[154-2] --quick 을 실제로 돌림 — 부른 것 = plainA · plainB(브라우저 0)', r.status === 0 && ran.join(',') === 'plainA,plainB', `종료 ${r.status} · 부름 ${ran} · ${r.stdout.slice(-600)}${r.stderr.slice(-300)}`);
    const day = fs.readdirSync(path.join(tmp, 'reports', 'machine-check'))[0];
    const ledger = JSON.parse(fs.readFileSync(path.join(tmp, 'reports', 'machine-check', day, 'last.json'), 'utf8')) as { entries: Record<string, { browser?: boolean }> };
    const summary = fs.readFileSync(path.join(tmp, 'reports', 'machine-check', day, 'summary.md'), 'utf8');
    check('[154-2] last.json 시험마다 browser 칸(아니요) · summary.md 「브라우저」 칸', ledger.entries['plaina:test']?.browser === false && /\| 이름 \| 브라우저 \| 결과 \| 초 \|/.test(summary) && /\| browsera:test \| 예 \| 기록 없음/.test(summary), summary);
    check('[154-2] --quick 범위를 다 돌림(2 / 2)', /돌린 시험 2 \/ 2\(--quick 범위\)/.test(r.stdout), r.stdout.slice(-400));
    const b = spawnSync(process.execPath, [cli, 'scripts/machineCheck.ts', '--browser-only', '--plan', '8'], { cwd: tmp, encoding: 'utf8', env });
    check('[154-2] --browser-only --plan 은 가짜 브라우저 시험 둘만 · 타입 · 린트 · 빌드 없음', b.status === 0 && /browsera:test/.test(b.stdout) && /browserb:test/.test(b.stdout) && !/plain[ab]:test/.test(b.stdout) && !/빌드 포함/.test(b.stdout), b.stdout + b.stderr);
    const bad = spawnSync(process.execPath, [cli, 'scripts/machineCheck.ts', '--quick', '--only', 'browsera:test'], { cwd: tmp, encoding: 'utf8', env });
    check('[154-2] --quick 에 브라우저 시험을 --only 로 주면 멈춤(범위 밖)', bad.status === 2 && /범위 밖/.test(bad.stderr), bad.stderr);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ── [154-3] --plan 묶음(가짜 시간) ──
{
  const sec: Record<string, number> = { a: 400, b: 100, c: 200, d: 250, e: 30, f: 600, g: 120, h: 470 };
  const tests = Object.keys(sec);
  const limit = 8 * 60;
  const head = 60;
  const batches = planBatches(tests, (n) => sec[n], limit, head);
  const flat = batches.flatMap((b) => b.tests);
  check('[154-3] 시험마다 한 번(빠짐 · 겹침 0)', flat.length === tests.length && tests.every((t) => flat.filter((x) => x === t).length === 1), flat.join(','));
  const longs = tests.filter((t) => sec[t] > LONG_SEC);
  check(`[154-3] ${LONG_SEC / 60}분 넘는 시험(${longs})은 혼자 묶음`, longs.every((t) => batches.some((b) => b.tests.length === 1 && b.tests[0] === t && b.alone)));
  check('[154-3] 묶음마다 합 8분 안(혼자 묶음 빼고 · 머리 포함)', batches.filter((b) => !b.alone).every((b) => b.seconds <= limit), batches.map((b) => `${b.tests}:${b.seconds}`).join(' | '));
  check('[154-3] 첫 묶음 = 타입 · 린트 · 빌드(머리)', batches[0].head && batches.filter((b) => b.head).length === 1);
  const noRecord = planBatches(['x', 'y'], () => undefined, limit, null);
  check('[154-3] 시간 기록 없는 시험은 혼자 묶음(planBatches 에 시간을 주지 않을 때)', noRecord.length === 2 && noRecord.every((b) => b.alone && !b.known));
  // 기본 예상 시간 — 기록 없는 브라우저 시험 120초 · 아닌 시험 10초(새 worktree 첫 실행에서 시험마다 혼자 묶음이 되지 않게)
  const isBrowser = new Set(['b1', 'b2', 'b3']);
  const guess = (t: string) => estimateSec(undefined, isBrowser.has(t));
  check(`[v2.83.0] 기록 없음 → 브라우저 ${DEFAULT_BROWSER_SEC}초 · 아님 ${DEFAULT_PLAIN_SEC}초(guessed) · 기록이 있으면 그 값`, DEFAULT_BROWSER_SEC === 120 && DEFAULT_PLAIN_SEC === 10 && guess('b1').seconds === 120 && guess('p1').seconds === 10 && guess('b1').guessed && estimateSec(7, true).seconds === 7 && !estimateSec(7, true).guessed);
  const fresh = ['b1', 'b2', 'b3', 'p1', 'p2', 'p3', 'p4', 'p5'];
  const freshBatches = planBatches(fresh, (t) => guess(t).seconds, limit, null);
  check('[v2.83.0] 기록 없는 시험 8개(브라우저 3 · 아님 5) → 8분 묶음 하나(혼자 묶음 0)', freshBatches.length === 1 && freshBatches[0].tests.length === 8 && !freshBatches[0].alone && freshBatches[0].seconds === 410, freshBatches.map((b) => `${b.tests}:${b.seconds}`).join(' | '));
}

// ── [154-4] --changed ──
{
  const bt = Object.fromEntries(split.browser.map((n) => [n, split.files[n]]));
  const assetFile = 'src/components/asset/AssetMonthlyPlan.tsx';
  const r = selectChanged(root, [assetFile], bt);
  const picked = r.picks.map((p) => p.test);
  const hasAsset = (n: string) => /#\/asset(?![\w-])|AssetMonthlyPlan/.test(fs.readFileSync(bt[n], 'utf8'));
  check(`[154-4] 자산 화면 파일 → 전부 아님 · 고른 ${picked.length}개 모두 자산 화면을 엶(#/asset)`, r.full.length === 0 && picked.length > 0 && picked.every(hasAsset), JSON.stringify(r));
  check('[154-4] 자산 브라우저 시험(asset*ui · assetlock · assetplan · assetplanbuy · assetpurchase)은 모두 고름', split.browser.filter((n) => /^asset/.test(n)).every((n) => picked.includes(n)), split.browser.filter((n) => /^asset/.test(n) && !picked.includes(n)).join(', '));
  const notWanted = ['chartview:test', 'mobilebuyjudge:test', 'mobileaccount:test', 'autotradenotes:test'];
  check(`[154-4] 차트 · 매수 판단 · 계좌 시험은 고르지 않음(${notWanted.join(' · ')})`, notWanted.every((n) => !picked.includes(n)), picked.join(', '));
  // v2.83.0 — 공용 부품도 「전부」 가 아니라 그 부품을 쓰는 화면 시험(사용자 결정 1) · 자세한 확인은 아래 [v2.83.0-E2]
  const ui = selectChanged(root, ['src/components/ui/Button.tsx'], bt);
  check('[154-4] src/components/ui/ 파일 → 「전부」 아님 · 쓰는 화면 시험을 까닭 길과 함께 고름', ui.full.length === 0 && ui.picks.length > 0 && ui.picks.every((p) => p.why.startsWith('바뀐 `ui/Button.tsx`')), JSON.stringify(ui.full));
  const trade = selectChanged(root, ['server/autoTrading/sizing.ts', 'server/db.ts'], bt);
  check('[154-4] 매매 판단 · 서버 공통 파일 → 「전부」 안내', trade.full.length === 2);
  const swing = selectChanged(root, ['src/components/swing/BuyJudgeView.tsx'], bt);
  check('[154-4] 매수 판단 화면 파일 → mobilebuyjudge 고름 · 자산 전용 시험(assetplanbuy) 안 고름', swing.picks.some((p) => p.test === 'mobilebuyjudge:test') && !swing.picks.some((p) => p.test === 'assetplanbuy:test'));
  const pkg = fs.readFileSync(path.join(root, 'package.json'), 'utf8');
  const obj = JSON.parse(pkg) as { scripts: Record<string, string>; dependencies: Record<string, string> };
  const onlyScripts = JSON.stringify({ ...obj, scripts: { ...obj.scripts, 'new:test': 'tsx scripts/x.ts' } });
  const depChange = JSON.stringify({ ...obj, dependencies: { ...obj.dependencies, 'left-pad': '1.0.0' } });
  check('[154-4] package.json scripts 줄만 바뀜 = 전부 아님 · 의존성 바뀜 = 전부', packageJsonScriptsOnly(pkg, onlyScripts) && !packageJsonScriptsOnly(pkg, depChange));
}

// ── [154-7] CLAUDE.md(관리 루트 · git 밖) ──
{
  const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: root, encoding: 'utf8' }).trim();
  const md = path.resolve(common, '../../../CLAUDE.md');
  if (!fs.existsSync(md)) console.log(`건너뜀  [154-7] CLAUDE.md 없음(관리 루트 — ${md})`);
  else {
    const text = fs.readFileSync(md, 'utf8');
    const bytes = fs.statSync(md).size;
    // v2.83.0 — 2-4 기계 검사 순서(제자리 수정) · 1280 그대로 = desktop:test
    const rules = [/`npm run check:quick`/, /--changed <기준> --run/, /--failed --also/, /전부는 배포 전 차수 한 번/, /--plan 8` → `--batch 1 … n`/, /Bash 한 번에 묶음 하나/, /5분 넘는 시험은 혼자/, /1280 그대로 = `desktop:test`/];
    const miss = rules.filter((re) => !re.test(text)).map(String);
    check(`[154-7] CLAUDE.md ${bytes}바이트 < 25,000 · 2-4 규칙 줄(v2.83.0 순서)`, bytes < 25_000 && miss.length === 0, miss.join(' · '));
  }
}

// ── [154-8] 앱 코드 바뀐 줄 0 — 154차 커밋(메시지 「154차」) · (지금 하는 중이면) 작업 트리 ──
{
  const APP = ['src', 'server', 'python'];
  const commits = git(['log', '--format=%h', '--grep=^154차', '69dd7e0..HEAD']);
  const touched = commits.flatMap((c) => git(['show', '--format=', '--name-only', c, '--', ...APP]).map((f) => `${c}:${f}`));
  const headIs154 = commits.length > 0 && git(['rev-parse', '--short', 'HEAD'])[0] === git(['rev-parse', '--short', commits[0]])[0];
  const work = headIs154 ? [...git(['diff', '--name-only', 'HEAD', '--', ...APP]), ...git(['ls-files', '--others', '--exclude-standard', '--', ...APP]).filter((f) => !fs.lstatSync(path.join(root, f)).isSymbolicLink())] : [];
  check(`[154-8] 154차 커밋 ${commits.length}개${headIs154 ? ' + 작업 트리' : ''} — 앱 코드(src · server · python) 바뀐 파일 0`, commits.length > 0 && touched.length === 0 && work.length === 0, [...touched, ...work].join(', '));
}

// ── v2.83.0 검사 줄이기 E1 ~ E6 ──
const cli = path.join(root, 'node_modules/tsx/dist/cli.mjs');
const kstDay = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
/** 가짜 저장소 — machineCheck · checkScope 사본 + 가짜 시험(부르면 ran/<이름> 표시) + 사본 DB 자리 */
function fakeRepo(tag: string, tests: Record<string, { browser?: boolean; file?: string }>, extra: (dir: string) => void = () => {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `as-mc-${tag}-`));
  fs.mkdirSync(path.join(dir, 'scripts', 'lib'), { recursive: true });
  fs.copyFileSync(path.join(root, 'scripts', 'machineCheck.ts'), path.join(dir, 'scripts', 'machineCheck.ts'));
  fs.copyFileSync(path.join(root, 'scripts', 'lib', 'checkScope.ts'), path.join(dir, 'scripts', 'lib', 'checkScope.ts'));
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(dir, 'node_modules'));
  fs.symlinkSync(path.join(root, 'python'), path.join(dir, 'python'));
  fs.mkdirSync(path.join(dir, 'ran'));
  const scripts: Record<string, string> = {};
  for (const [name, t] of Object.entries(tests)) {
    const file = t.file ?? `scripts/${name.replace(/:test$/, '').replace(/\W/g, '_')}.ts`;
    const mark = `import fs from 'node:fs';\nfs.writeFileSync(${JSON.stringify(path.join(dir, 'ran'))} + '/${name.replace(/:test$/, '')}', '');\n`;
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    if (!fs.existsSync(path.join(dir, file))) fs.writeFileSync(path.join(dir, file), (t.browser ? "import { chromium } from 'playwright';\nvoid chromium;\n" : '') + mark);
    scripts[name] = `tsx ${file}`;
  }
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'fake', private: true, type: 'module', scripts }, null, 2));
  fs.mkdirSync(path.join(dir, 'db'));
  const db = new Database(path.join(dir, 'db', 'alphascope.db'));
  db.exec('CREATE TABLE t (a)');
  db.close();
  extra(dir);
  return dir;
}
const mc = (dir: string, args: string[]) => {
  const env = { ...process.env };
  delete env.DB_PATH;
  return spawnSync(process.execPath, [cli, 'scripts/machineCheck.ts', ...args], { cwd: dir, encoding: 'utf8', env, timeout: 240_000 });
};
const ranOf = (dir: string) => fs.readdirSync(path.join(dir, 'ran')).sort();
const clearRan = (dir: string) => {
  for (const f of fs.readdirSync(path.join(dir, 'ran'))) fs.rmSync(path.join(dir, 'ran', f));
};
const writeLedger = (dir: string, entries: Record<string, { result: string; seconds: number; browser?: boolean }>) => {
  const day = path.join(dir, 'reports', 'machine-check', kstDay());
  fs.mkdirSync(day, { recursive: true });
  const e = Object.fromEntries(Object.entries(entries).map(([n, v]) => [n, { kind: 'test', browser: v.browser ?? false, result: v.result, seconds: v.seconds, at: '2026-11-28 00:00:00' }]));
  fs.writeFileSync(path.join(day, 'last.json'), JSON.stringify({ updatedAt: '2026-11-28 00:00:00', entries: e }, null, 2));
};

// E1 빠짐 0
{
  const legacy = JSON.parse(fs.readFileSync(path.join(root, 'scripts/fixtures/desktop/legacyScenes.json'), 'utf8')).scenes as { test: string; check: string; size: string; name: string }[];
  const sizes = new Set(DESKTOP_SIZES.map(sizeKey));
  const missing = legacy.filter((l) => {
    const g = DESKTOP_GROUPS.find((x) => x.from.test === l.test);
    return !g || !sizes.has(l.size) || !g.runs.some((r) => r.steps.some((st) => st.name === l.name));
  });
  const tests = [...new Set(legacy.map((l) => l.test))].sort();
  check(`[v2.83.0-E1] 빠짐 0 — 옛 시험 ${tests.length}개(${tests.join(' · ')})의 1280 · 1440 장면 ${legacy.length}개 ⊂ desktopScenes.ts`, legacy.length === 104 && missing.length === 0, missing.map((m) => `${m.test} ${m.size} ${m.name}`).join(' | '));
  const scenes = allScenes();
  const noFile = scenes.flatMap((sc) => DESKTOP_SIZES.filter((sz) => !fs.existsSync(fixtureFile(sz, sc.group, sc.name))).map((sz) => `${sizeKey(sz)} ${sc.id}`));
  check(`[v2.83.0-E1] 장면 ${scenes.length}개 × 두 크기 정답 파일 있음 · 장면 이름 겹침 0`, noFile.length === 0 && new Set(scenes.map((x) => x.id)).size === scenes.length, noFile.join(' | '));
  check('[v2.83.0-E1] desktopScenes.ts 는 Playwright 를 쓰지 않음(브라우저 없는 시험이 읽음) · desktop:test 는 브라우저 시험', !usesBrowser(root, path.join(root, 'scripts/lib/desktopScenes.ts')) && split.browser.includes('desktop:test'));
  const oldFixtures = ['mobileAccount', 'mobileBuyJudge', 'mobileChart', 'mobileFrame', 'mobileSchedAsset', 'mobileTable', 'mobileTouch'].filter((d) => fs.existsSync(path.join(root, 'scripts/fixtures', d, 'desk.json')));
  const oldCode = Object.entries(split.files).filter(([n, f]) => /^mobile/.test(n) && /deskSnapshot|desk\.json/.test(fs.readFileSync(f, 'utf8'))).map(([n]) => n);
  check('[v2.83.0-E1] 옛 시험의 desk.json 0개 · 1280 비교 코드(deskSnapshot) 0곳', oldFixtures.length === 0 && oldCode.length === 0, [...oldFixtures, ...oldCode].join(' '));
}

// E2 --changed — 가짜 src(화면 a 는 Button 을 씀 · 화면 b 는 안 씀)
{
  const dir = fakeRepo('changed', { 'ta:test': { browser: true }, 'tb:test': { browser: true }, 'desktop:test': { browser: true }, 'plain:test': {} }, (d) => {
    const w = (f: string, t: string) => {
      fs.mkdirSync(path.dirname(path.join(d, f)), { recursive: true });
      fs.writeFileSync(path.join(d, f), t);
    };
    w('src/App.tsx', "import PageA from './components/a/PageA';\nimport PageB from './components/b/PageB';\nexport function App(p: string) {\n  switch (p) {\n    case 'pagea':\n      return <PageA />;\n    case 'pageb':\n      return <PageB />;\n  }\n}\n");
    w('src/components/ui/Button.tsx', 'export const Button = () => null;\n');
    w('src/components/a/Panel.tsx', "import { Button } from '../ui/Button';\nexport const Panel = Button;\n");
    w('src/components/a/PageA.tsx', "import { Panel } from './Panel';\nexport default Panel;\n");
    w('src/components/b/PageB.tsx', 'export default () => null;\n');
    // 시험 글 — ta 는 #/pagea 를 엶 · tb 는 #/pageb
    fs.appendFileSync(path.join(d, 'scripts/ta.ts'), "const HASH = '#/pagea';\nvoid HASH;\n");
    fs.appendFileSync(path.join(d, 'scripts/tb.ts'), "const HASH = '#/pageb';\nvoid HASH;\n");
  });
  try {
    const g = (args: string[]) => spawnSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...args], { cwd: dir, encoding: 'utf8' });
    fs.writeFileSync(path.join(dir, '.gitignore'), 'node_modules\npython\nran\nreports\ndb\n');
    g(['init', '-q']);
    g(['add', '-A']);
    g(['commit', '-q', '-m', 'base']);
    fs.appendFileSync(path.join(dir, 'src/components/ui/Button.tsx'), '// 바꿈\n');
    const bt = { 'ta:test': path.join(dir, 'scripts/ta.ts'), 'tb:test': path.join(dir, 'scripts/tb.ts'), 'desktop:test': path.join(dir, 'scripts/desktop.ts') };
    const r = selectChanged(dir, ['src/components/ui/Button.tsx'], bt);
    check('[v2.83.0-E2] 가짜 ui/Button.tsx → 쓰는 화면 시험 ta 만 고름(안 쓰는 화면 tb 안 고름) · 「전부」 아님', r.full.length === 0 && r.picks.map((p) => p.test).join(',') === 'ta:test', JSON.stringify(r));
    check('[v2.83.0-E2] 까닭 줄 = 바뀐 파일 → 쓰는 파일 → 화면 폴더 → #/page → 시험', r.picks[0]?.why === '바뀐 `ui/Button.tsx` → `a/Panel.tsx` → `#/pagea` → ta:test', r.picks[0]?.why);
    const list = mc(dir, ['--changed', 'HEAD']);
    check('[v2.83.0-E2] --changed 목록 = ta + desktop:test(늘) · tb · 브라우저 아닌 시험 없음 · 돌리지 않음', list.status === 0 && /ta:test/.test(list.stdout) && /\+ desktop:test: 1280 그대로/.test(list.stdout) && !/tb:test/.test(list.stdout) && ranOf(dir).length === 0 && ALWAYS.includes('desktop:test'), list.stdout + list.stderr);
    writeLedger(dir, { 'ta:test': { result: 'pass', seconds: 3, browser: true }, 'desktop:test': { result: 'pass', seconds: 3, browser: true } });
    const run = mc(dir, ['--changed', 'HEAD', '--run']);
    check('[v2.83.0-E2] --changed --run 이 부른 것 = desktop · ta(tb · plain 0)', run.status === 0 && ranOf(dir).join(',') === 'desktop,ta', `종료 ${run.status} · 부름 ${ranOf(dir)} · ${run.stdout.slice(-500)}${run.stderr.slice(-300)}`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// E3 --failed — 실패 2 · 통과 5 + --also 1
{
  const names = ['t1', 't2', 't3', 't4', 't5', 't6', 't7'].map((n) => `${n}:test`);
  const dir = fakeRepo('failed', Object.fromEntries(names.map((n) => [n, {}])));
  try {
    writeLedger(dir, Object.fromEntries(names.map((n) => [n, { result: n === 't2:test' ? 'fail' : n === 't6:test' ? 'timeout' : 'pass', seconds: 2 }])));
    const r = mc(dir, ['--failed', '--also', 't4:test']);
    check('[v2.83.0-E3] --failed --also t4 → 부른 것 = 실패 t2 · 시간 초과 t6 + t4(통과 5개 중 다른 것 0)', r.status === 0 && ranOf(dir).join(',') === 't2,t4,t6', `종료 ${r.status} · 부름 ${ranOf(dir)} · ${r.stdout.slice(-400)}${r.stderr.slice(-300)}`);
    const bad = mc(dir, ['--failed', '--only', 't1:test']);
    check('[v2.83.0-E3] --failed 에 --only 를 함께 주면 멈춤(종료 2)', bad.status === 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// E4 --batch — 얼린 묶음 · 5분 넘는 시험 혼자 · 같은 시간이면 같은 목록 · 이름 순
{
  const sec: Record<string, number> = { t1: 100, t2: 400, t3: 200, t4: 250, t5: 30, t6: 120, t7: 470 };
  const names = Object.keys(sec).map((n) => `${n}:test`);
  const dir = fakeRepo('batch', Object.fromEntries(names.map((n) => [n, {}])));
  try {
    writeLedger(dir, Object.fromEntries(names.map((n) => [n, { result: 'pass', seconds: sec[n.replace(':test', '')] }])));
    const scope = ['--skip-types', '--skip-lint', '--skip-build'];
    const p1 = mc(dir, [...scope, '--plan', '8']);
    const lines = (o: string) => o.split('\n').filter((l) => /^\d+\. /.test(l)).map((l) => l.replace(/^\d+\. [^—]*— /, ''));
    const want = ['t1:test', 't2:test', 't3:test, t4:test, t5:test', 't6:test', 't7:test'];
    check('[v2.83.0-E4] --plan 8 묶음 = 이름 순 · 5분 넘는 t2 · t7 혼자 · 묶음마다 8분 안', p1.status === 0 && JSON.stringify(lines(p1.stdout)) === JSON.stringify(want), lines(p1.stdout).join(' | '));
    const p2 = mc(dir, [...scope, '--plan', '8']);
    check('[v2.83.0-E4] 같은 시간이면 묶음 목록이 같음(두 번 짬)', JSON.stringify(lines(p2.stdout)) === JSON.stringify(lines(p1.stdout)));
    // 시간 기록을 바꿔도(t3 → 10초 · t6 → 400초) 얼린 묶음 3 은 그대로
    writeLedger(dir, Object.fromEntries(names.map((n) => [n, { result: 'pass', seconds: ({ t3: 10, t6: 400 } as Record<string, number>)[n.replace(':test', '')] ?? sec[n.replace(':test', '')] }])));
    const b3 = mc(dir, [...scope, '--batch', '3']);
    check('[v2.83.0-E4] --batch 3 → 얼린 묶음 3(t3 · t4 · t5)만 부름 — 시간 기록이 바뀌어도 같음', b3.status === 0 && ranOf(dir).join(',') === 't3,t4,t5', `종료 ${b3.status} · 부름 ${ranOf(dir)} · ${b3.stdout.slice(-400)}${b3.stderr.slice(-300)}`);
    clearRan(dir);
    const b2 = mc(dir, [...scope, '--batch', '2']);
    check('[v2.83.0-E4] --batch 2 → 5분 넘는 t2 혼자', b2.status === 0 && ranOf(dir).join(',') === 't2');
    const none = mc(dir, [...scope, '--batch', '9']);
    check('[v2.83.0-E4] 없는 묶음 번호 → 멈춤(종료 2)', none.status === 2 && /묶음 9 이 없습니다/.test(none.stderr), none.stderr);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

// E5 훅
{
  const r = spawnSync(process.execPath, [cli, 'scripts/hooksSelfTest.ts'], { cwd: root, encoding: 'utf8', env: process.env, timeout: 60_000 });
  const blocked = (r.stdout.match(/^PASS {2}\[C-훅\] 막음/gm) ?? []).length;
  const allowed = (r.stdout.match(/^PASS {2}\[C-훅\] 통과/gm) ?? []).length;
  check(`[v2.83.0-E5] 훅 — 막을 명령 ${blocked}개 종료 2 · 막지 않을 명령 ${allowed}개 통과(hooks:test)`, r.status === 0 && blocked >= 5 && allowed >= 5, r.stdout.slice(-600));
}

// E6 앱 코드 바뀐 파일 0 — 이 차수 중(HEAD 가 기준 2c3265d 이거나 이 차수 커밋)이면 기준 → 작업 트리를 git diff 로 직접 ·
//    뒤 차수에서는 이 차수 커밋(메시지 「v2.83.0 검사 줄이기」)만 본다(뒤 차수의 정당한 변경을 세지 않게)
{
  const APP = ['src', 'server', 'python'];
  const BASE_COMMIT = '2c3265d';
  const commits = git(['log', '--format=%h', '--grep=^v2.83.0 검사 줄이기', `${BASE_COMMIT}..HEAD`]);
  const headShort = git(['rev-parse', '--short=7', 'HEAD'])[0];
  const headMsg = git(['log', '-1', '--format=%s'])[0] ?? '';
  const during = headShort === BASE_COMMIT || /^v2\.83\.0 검사 줄이기/.test(headMsg);
  const files = during
    ? [...git(['diff', '--name-only', BASE_COMMIT, '--', ...APP]), ...git(['ls-files', '--others', '--exclude-standard', '--', ...APP]).filter((f) => !fs.lstatSync(path.join(root, f)).isSymbolicLink())]
    : commits.flatMap((c) => git(['show', '--format=', '--name-only', c, '--', ...APP]).map((f) => `${c}:${f}`));
  check(`[v2.83.0-E6] 앱 코드(src · server · python) 바뀐 파일 0 — ${during ? `${BASE_COMMIT} → 작업 트리(git diff 직접)` : `이 차수 커밋 ${commits.length}개`}`, (during || commits.length > 0) && files.length === 0, files.join(', '));
}

console.log(`\n결과: 통과 ${pass} · 실패 ${failCount}`);
process.exit(failCount ? 1 : 0);
