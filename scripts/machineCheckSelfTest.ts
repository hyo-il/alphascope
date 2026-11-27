/**
 * 기계 검사 나누기 시험(154차 · 버전 그대로 v2.80.0) — `npm run machinecheck:test` · ⚠️ `DB_PATH=<사본>` 으로만 돈다(맨 첫 import · 시험 DB 는 쓰지 않는다).
 * 브라우저 시험이 아니다(Playwright 를 쓰지 않는다).
 *
 * 1. [154-1] 가르기: 브라우저 시험 + 아닌 시험 = `:test` 전부(빠진 것 · 겹친 것 0) · 가짜 파일로 「몇 단계 건너 Playwright」 도 브라우저
 * 2. [154-2] `--quick` 은 브라우저 시험을 하나도 부르지 않는다 — 가짜 시험 목록(임시 폴더)으로 실제로 돌려 부른 표시 파일을 센다 ·
 *    결과표 · `last.json` 에 「브라우저」 칸
 * 3. [154-3] `--plan`: 5분 넘는 시험은 혼자 묶음 · 묶음마다 합이 그 분 안(가짜 시간) · 시험마다 한 번
 * 4. [154-4] `--changed`: 자산 화면 파일 하나 → 자산 브라우저 시험만(차트 · 매수 판단 시험 없음) · `src/components/ui/` 파일 → 「전부」 안내 ·
 *    package.json `scripts` 줄만 바뀐 것은 전부가 아님
 * 5. [154-7] 관리 루트 `CLAUDE.md` 25,000바이트 아래 · 2-4 새 규칙 줄
 * 6. [154-8] 154차 커밋(메시지 「154차」) · 작업 트리의 앱 코드(`src` · `server` · `python`) 바뀐 줄 0
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { LONG_SEC, packageJsonScriptsOnly, planBatches, selectChanged, splitTests, testFiles, usesBrowser } from './lib/checkScope';

const root = path.resolve(import.meta.dirname, '..');
let pass = 0;
let failCount = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) pass++;
  else failCount++;
  console.log(`${ok ? '통과' : '실패'}  ${name}${!ok && detail ? ` — ${detail}` : ''}`);
}
const git = (args: string[]) => spawnSync('git', args, { cwd: root, encoding: 'utf8' }).stdout.split('\n').filter(Boolean);

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
  check('[154-3] 시간 기록 없는 시험은 혼자 묶음', noRecord.length === 2 && noRecord.every((b) => b.alone && !b.known));
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
  const ui = selectChanged(root, ['src/components/ui/Button.tsx'], bt);
  check('[154-4] src/components/ui/ 파일 → 「전부」 안내', ui.full.length === 1 && /공용 부품/.test(ui.full[0].why), JSON.stringify(ui.full));
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
    const rules = [/`npm run check:quick`/, /전부\(`check:all`\)를 돌리는 때/, /Bash 한 번에 묶음 하나/, /5분 넘는 시험은 혼자/];
    const miss = rules.filter((re) => !re.test(text)).map(String);
    check(`[154-7] CLAUDE.md ${bytes}바이트 < 25,000 · 2-4 새 규칙 줄`, bytes < 25_000 && miss.length === 0, miss.join(' · '));
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

console.log(`\n결과: 통과 ${pass} · 실패 ${failCount}`);
process.exit(failCount ? 1 : 0);
