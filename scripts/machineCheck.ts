/**
 * 기계 검사 한 명령 — `npm run check:quick`(차수마다) · `npm run check:all`(전부 — `CLAUDE.md` 2-4 ①②③ 때만). 순서대로 하나씩 돌리고 시험마다 걸린 시간을 남긴다.
 *
 * 순서: ① 타입 검사 두 줄(`tsconfig.app.json` · `tsconfig.node.json`) ② `design:lint` ③ 빌드(`npm run build`) ④ `package.json` 에서 이름이 `:test` 로
 * 끝나는 것(이름 순 — 목록을 손으로 적지 않으므로 새 시험이 저절로 들어간다). 시험마다 **새 사본 DB** — 시험 명령 앞에는 손으로 돌릴 때와 같이
 * `DB_PATH=<사본>` · `INDICATORS_PORT=5002` 만 준다(시험 서버 스위치는 서버를 띄우는 시험이 `scripts/lib/testServerEnv.ts` 를 스스로 펼친다 — 시험
 * 프로세스에 스위치를 주면 `autotrade:test` 처럼 상태를 읽는 시험이 달라진다).
 *
 * - 브라우저 시험 / 아님: `scripts/lib/checkScope.ts` `splitTests`(시험 파일이 — 몇 단계 import 를 건너도 — Playwright 를 쓰면 브라우저 시험).
 * - 사본: 사용자 DB(이 저장소 — worktree 면 본 저장소 — 의 `.env` `DB_PATH`, 기본 `./db/alphascope.db`)를 **읽기 전용으로 열어 SQLite 온라인 백업**
 *   (WAL 이라 `cp` 를 쓰지 않는다)으로 한 번 뜨고, 시험마다 그 백업을 새로 복사해 준다. 끝나면 사본을 지운다. 원본의 크기 · 수정 시각을 시작 · 끝에 견준다.
 * - 지표 엔진 5002: 떠 있지 않으면 띄우고, 끝나면(성공 · 실패 · Ctrl-C) **자기가 띄운 것만** 끈다. 이미 떠 있으면 그대로 쓴다.
 * - 시험마다 시간 제한(기본 9분 · `--timeout <분>`) — 넘으면 그 시험만 「시간 초과」 로 끝내고 다음으로.
 * - 출력은 `reports/machine-check/<날짜>/<이름>.log` (`reports/` 는 `.gitignore`) · 실패한 것만 끝 40줄을 화면에.
 * - 결과표(이름 · 브라우저 · 결과 · 초 — 금액 · 비밀값은 싣지 않는다)는 화면 + 같은 폴더 `summary.md` · `last.json`. 같은 날 나눠 돌린 결과는 이어 쌓는다
 *   (아무 옵션 없는 전부만 그날 기록을 새로 시작한다).
 * - 실패 · 시간 초과가 하나라도 있으면 종료 코드 1.
 *
 * 범위: `--quick`(타입 · 린트 · 빌드 · 브라우저 아닌 시험 전부) · `--browser-only`(브라우저 시험만 — 타입 · 린트 · 빌드 없음 · `--only` 와 함께 씀)
 *       `--changed <기준 해시>`(기준 → 작업 트리의 바뀐 파일 → 그 파일을 쓰는 화면의 브라우저 시험 + `desktop:test` — 고른 까닭 한 줄씩 · 「전부」 안내.
 *       `--run` 이 없으면 목록만 · `--run` 이면 바로 돈다)
 *       `--failed`(오늘 `last.json` 의 실패 · 시간 초과만 다시 — 타입 · 린트 · 빌드도 실패한 것만)
 * 옵션: `--only a,b`(시험만 고름) · `--from 이름`(그 시험부터 끝까지) · `--also a,b`(`--changed` · `--failed` 에 고친 시험을 더함)
 *       `--skip-types` · `--skip-lint` · `--skip-build` · `--timeout <분>`
 *       `--plan <분>`(직전 `last.json` 시간으로 그 분 안에 끝나는 묶음 목록 — 돌리지 않음 · 이름 순 · 5분 넘는 시험 · 기록 없는 시험은 혼자 묶음 ·
 *       짠 묶음은 오늘 폴더 `plan.json` 에 범위 옵션별로 얼려 둔다) · `--batch <n>`(같은 범위 옵션의 n 번째 묶음만 돈다 — 얼려 둔 묶음 그대로 ·
 *       없으면 8분으로 짜서 얼림) · `--summary`(오늘 쌓인 결과를 합친 표 — 돌리지 않음 · 범위 옵션과 함께 쓰면 그 범위만)
 * `--run` · `--failed` 는 고른 것이 8분 묶음 하나에 들지 않으면 돌리지 않고 `--batch <n>` 명령을 낸다(Bash 한 번 10분 안 — `CLAUDE.md` 2-4).
 */
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'dotenv';
import Database from 'better-sqlite3';
import { ALWAYS, DEFAULT_BROWSER_SEC, DEFAULT_PLAIN_SEC, LONG_SEC, estimateSec, packageJsonScriptsOnly, planBatches, selectChanged, splitTests, type Batch } from './lib/checkScope';

const ROOT = path.resolve(import.meta.dirname, '..');
const REPORT_ROOT = path.join(ROOT, 'reports', 'machine-check');
const ENGINE_PORT = '5002';
const ENGINE_URL = `http://127.0.0.1:${ENGINE_PORT}/health`;
const TAIL_LINES = 40;

type Kind = 'types' | 'lint' | 'build' | 'test';
type Outcome = 'pass' | 'fail' | 'timeout';
interface Entry { kind: Kind; browser?: boolean; result: Outcome; seconds: number; at: string }
interface Ledger { updatedAt: string; entries: Record<string, Entry> }
interface Step { name: string; kind: Kind; cmd: string; args: string[]; test: boolean; browser: boolean }

/** 타입 · 린트 · 빌드 — 첫 묶음에 함께 돈다 */
const HEAD_STEPS = ['tsc app', 'tsc node', 'design:lint', 'build'];

const OUTCOME_TEXT: Record<Outcome, string> = { pass: '통과', fail: '실패', timeout: '시간 초과' };

// ───────── 옵션 ─────────
function parseArgs(argv: string[]) {
  const o = {
    only: null as string[] | null, from: null as string | null, skipTypes: false, skipLint: false, skipBuild: false, timeoutMin: 9, plan: null as number | null,
    summary: false, quick: false, browserOnly: false, changed: null as string | null, run: false, failed: false, also: [] as string[], batch: null as number | null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) fail(`${a} 뒤에 값이 필요합니다`);
      return v;
    };
    const list = () => next().split(',').map((s) => s.trim()).filter(Boolean);
    if (a === '--only') o.only = list();
    else if (a === '--from') o.from = next();
    else if (a === '--skip-types') o.skipTypes = true;
    else if (a === '--skip-lint') o.skipLint = true;
    else if (a === '--skip-build') o.skipBuild = true;
    else if (a === '--quick') o.quick = true;
    else if (a === '--browser-only') o.browserOnly = true;
    else if (a === '--changed') o.changed = next();
    else if (a === '--run') o.run = true;
    else if (a === '--failed') o.failed = true;
    else if (a === '--also') o.also = list();
    else if (a === '--batch') {
      const n = Number(next());
      if (!Number.isInteger(n) || n < 1) fail(`--batch 는 1 이상 정수(묶음 번호)여야 합니다`);
      o.batch = n;
    } else if (a === '--timeout') o.timeoutMin = positive(next(), a);
    else if (a === '--plan') o.plan = positive(next(), a);
    else if (a === '--summary') o.summary = true;
    else fail(`모르는 옵션: ${a}`);
  }
  if (o.quick && o.browserOnly) fail('--quick 과 --browser-only 는 함께 쓰지 않습니다');
  if (o.changed !== null && o.failed) fail('--changed 와 --failed 는 함께 쓰지 않습니다');
  if ((o.changed !== null || o.failed) && (o.only || o.from || o.quick || o.browserOnly)) fail('--changed · --failed 는 --only · --from · --quick · --browser-only 와 함께 쓰지 않습니다(--also 로 더함)');
  if (o.also.length && o.changed === null && !o.failed) fail('--also 는 --changed · --failed 와 함께 씁니다');
  if (o.run && o.changed === null) fail('--run 은 --changed 와 함께 씁니다');
  if (o.batch !== null && o.plan !== null) fail('--batch 와 --plan 은 함께 쓰지 않습니다');
  // 브라우저 시험만 · 바뀐 곳 · 실패만 = 타입 · 린트 · 빌드 없음(실패만은 실패한 머리 단계를 따로 넣는다)
  if (o.browserOnly || o.changed !== null || o.failed) Object.assign(o, { skipTypes: true, skipLint: true, skipBuild: true });
  return o;
}
function positive(v: string, flag: string): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) fail(`${flag} 는 0 보다 큰 수(분)여야 합니다: ${v}`);
  return n;
}
function fail(msg: string): never {
  console.error(`machineCheck — ${msg}`);
  process.exit(2);
}

// ───────── 목록 · 기록 ─────────
/** `package.json` 의 `:test` 로 끝나는 이름 전부(이름 순) */
function allTests(): string[] {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
  return Object.keys(pkg.scripts).filter((n) => n.endsWith(':test')).sort();
}
function kstDate(d = new Date()): string {
  return new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 10);
}
function kstTime(d = new Date()): string {
  return new Date(d.getTime() + 9 * 3600_000).toISOString().slice(0, 19).replace('T', ' ');
}
function ledgerPath(dir: string) {
  return path.join(dir, 'last.json');
}
function readLedger(dir: string): Ledger | null {
  try {
    return JSON.parse(fs.readFileSync(ledgerPath(dir), 'utf8')) as Ledger;
  } catch {
    return null;
  }
}
/** 기록이 있는 가장 최근 날짜 폴더 */
function latestDayDir(): string | null {
  if (!fs.existsSync(REPORT_ROOT)) return null;
  const days = fs.readdirSync(REPORT_ROOT).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d) && fs.existsSync(ledgerPath(path.join(REPORT_ROOT, d)))).sort();
  return days.length ? path.join(REPORT_ROOT, days[days.length - 1]) : null;
}
/** 시험마다 가장 최근 시간 — 날짜 폴더를 새것부터(오늘 일부만 돌렸어도 다른 시험은 지난 날 시간) */
function lastSeconds(): (n: string) => number | undefined {
  const days = fs.existsSync(REPORT_ROOT) ? fs.readdirSync(REPORT_ROOT).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse() : [];
  const ledgers = days.map((d) => readLedger(path.join(REPORT_ROOT, d))).filter((l): l is Ledger => !!l);
  return (n) => ledgers.find((l) => l.entries[n])?.entries[n].seconds;
}
function fileName(name: string) {
  return name.replace(/[^A-Za-z0-9._-]/g, '_');
}

// ───────── 결과표 ─────────
function fmtSec(s: number) {
  return s.toFixed(1);
}
function fmtTotal(s: number) {
  const m = Math.floor(s / 60);
  return `${fmtSec(s)}초 (${m}분 ${Math.round(s - m * 60)}초)`;
}
/** 결과표 글(화면 · summary.md 같은 글) — 이름 · 결과 · 초만 */
function table(ledger: Ledger, tests: string[], browser: Set<string>): { text: string; ok: boolean } {
  const order = [
    ...HEAD_STEPS.filter((n) => ledger.entries[n]),
    ...tests,
  ];
  const isBrowser = (n: string) => (ledger.entries[n]?.kind === 'test' || tests.includes(n) ? (browser.has(n) ? '예' : '아니요') : '-');
  const lines = ['| 이름 | 브라우저 | 결과 | 초 |', '|---|---|---|---:|'];
  let total = 0;
  let ok = true;
  for (const n of order) {
    const e = ledger.entries[n];
    if (!e) {
      lines.push(`| ${n} | ${isBrowser(n)} | 기록 없음 | - |`);
      ok = false;
      continue;
    }
    total += e.seconds;
    if (e.result !== 'pass') ok = false;
    lines.push(`| ${n} | ${isBrowser(n)} | ${OUTCOME_TEXT[e.result]} | ${fmtSec(e.seconds)} |`);
  }
  const done = tests.filter((t) => ledger.entries[t]).length;
  const passed = tests.filter((t) => ledger.entries[t]?.result === 'pass').length;
  const nb = tests.filter((t) => browser.has(t)).length;
  lines.push('', `- 시험 ${done} / ${tests.length} 돌림 · 통과 ${passed} / ${tests.length} (브라우저 ${nb} · 아님 ${tests.length - nb} · package.json 의 \`:test\` ${allTests().length}개)`, `- 전체 시간 합 ${fmtTotal(total)}`);
  return { text: lines.join('\n'), ok };
}
function writeSummary(dir: string, ledger: Ledger, tests: string[], browser: Set<string>, extra: string[] = []) {
  const { text } = table(ledger, tests, browser);
  const body = [`# 기계 검사 결과 — ${path.basename(dir)}`, '', `마지막 갱신 ${ledger.updatedAt} KST`, '', text, ...(extra.length ? ['', ...extra] : []), ''].join('\n');
  fs.writeFileSync(path.join(dir, 'summary.md'), body);
}

// ───────── --plan · --batch ─────────
/** 묶음 한 칸 — 8분(`CLAUDE.md` 2-4 `--plan 8`) */
const RUN_LIMIT_MIN = 8;
interface FrozenPlan { minutes: number; at: string; guessed?: string[]; batches: { tests: string[]; head: boolean; seconds: number; known: boolean; alone: boolean }[] }
/** 범위 옵션(묶음 번호 · 계획 · 시간 제한 · 요약 빼고) — 같은 범위면 같은 얼린 묶음 */
function scopeArgs(argv: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--plan' || argv[i] === '--batch' || argv[i] === '--timeout') {
      i++;
      continue;
    }
    if (argv[i] === '--summary' || argv[i] === '--run') continue;
    out.push(argv[i]);
  }
  return out;
}
function planPath(dir: string) {
  return path.join(dir, 'plan.json');
}
function readPlans(dir: string): Record<string, FrozenPlan> {
  try {
    return JSON.parse(fs.readFileSync(planPath(dir), 'utf8')) as Record<string, FrozenPlan>;
  } catch {
    return {};
  }
}
/** 직전 시간 기록으로 묶음을 짠다(이름 순 · 머리 = 타입 · 린트 · 빌드 단계가 있으면 첫 묶음 · 기록 없는 시험은 기본 예상 시간 `estimateSec`) */
function makePlan(minutes: number, tests: string[], head: string[], browser: Set<string>): FrozenPlan {
  const sec = lastSeconds();
  const guessed = tests.filter((t) => estimateSec(sec(t), browser.has(t)).guessed).sort();
  const testSec = (t: string) => estimateSec(sec(t), browser.has(t)).seconds;
  let headSec: number | undefined | null = null;
  if (head.length) {
    const hs = head.map(sec);
    headSec = hs.every((x) => x !== undefined) ? hs.reduce((a, b) => a + (b ?? 0), 0) : undefined;
  }
  const batches = planBatches([...tests].sort(), testSec, minutes * 60, headSec);
  return { minutes, at: kstTime(), ...(guessed.length ? { guessed } : {}), batches: batches.map((b: Batch) => ({ tests: b.tests, head: b.head, seconds: b.seconds, known: b.known, alone: b.alone })) };
}
function freeze(dir: string, key: string, p: FrozenPlan) {
  fs.mkdirSync(dir, { recursive: true });
  const all = readPlans(dir);
  all[key] = p;
  fs.writeFileSync(planPath(dir), JSON.stringify(all, null, 2));
}
function printPlan(p: FrozenPlan, scope: string[]) {
  const dir = latestDayDir();
  const ledger = dir ? readLedger(dir) : null;
  const base = dir && ledger ? `${path.relative(ROOT, REPORT_ROOT)}/<날짜>/last.json 시험마다 가장 최근(마지막 ${ledger.updatedAt} KST)` : '직전 기록 없음 — 시험 하나씩 한 묶음';
  const limit = p.minutes * 60;
  console.log(`기준: ${base} · 묶음마다 ${p.minutes}분 이하 · 이름 순 · ${LONG_SEC / 60}분 넘는 시험은 혼자 · Bash 한 번에 묶음 하나`);
  if (p.guessed?.length) console.log(`시간 기록이 없는 시험 ${p.guessed.length}개는 기본 예상 시간(브라우저 ${DEFAULT_BROWSER_SEC}초 · 아님 ${DEFAULT_PLAIN_SEC}초)으로 짬 — ${p.guessed.join(', ')}`);
  console.log('');
  const args = scope.length ? `${scope.join(' ')} ` : '';
  p.batches.forEach((b, i) => {
    const time = b.known ? `약 ${fmtSec(b.seconds)}초${b.seconds > limit ? ` ⚠️ ${p.minutes}분 넘음(시험 하나가 이미 넘음)` : ''}` : '시간 기록 없음';
    console.log(`${i + 1}. ${time}${b.head ? ' · 타입 검사 + design:lint + 빌드 포함' : ''}${b.alone ? ' · 혼자' : ''} — ${b.tests.length ? b.tests.join(', ') : '(시험 없음)'}`);
    console.log(`   npm run check:all -- ${args}--batch ${i + 1}`);
  });
  console.log(`\n묶음 ${p.batches.length}개 — 오늘 ${path.relative(ROOT, planPath(path.join(REPORT_ROOT, kstDate())))} 에 얼려 둠(같은 범위 옵션의 --batch 가 그대로 부름)`);
  console.log(`마지막에: npm run check:all -- ${args}--summary`);
}

// ───────── --changed ─────────
function changedFiles(base: string): string[] {
  const out = (args: string[]) => execFileSync('git', ['-c', 'core.quotePath=false', ...args], { cwd: ROOT, encoding: 'utf8' }).split('\n').map((l) => l.trim()).filter(Boolean);
  try {
    return [...new Set([...out(['diff', '--name-only', base]), ...out(['ls-files', '--others', '--exclude-standard']).filter((f) => !fs.lstatSync(path.join(ROOT, f)).isSymbolicLink())])].sort(); // 링크(worktree 의 python/.venv)는 코드가 아니다
  } catch {
    fail(`git diff 를 못 했습니다 — 기준 해시를 확인하세요: ${base}`);
  }
}
/** 바뀐 파일 → 고른 브라우저 시험(+ 늘 넣는 시험) — 까닭을 찍고 이름 순 목록을 낸다 */
function changedSelection(base: string, browserTests: Record<string, string>, also: string[]): string[] {
  let files = changedFiles(base);
  console.log(`기준 ${base} → 작업 트리 · 바뀐 파일 ${files.length}개\n`);
  if (files.includes('package.json')) {
    let before = '';
    try {
      before = execFileSync('git', ['show', `${base}:package.json`], { cwd: ROOT, encoding: 'utf8' });
    } catch {
      before = '';
    }
    if (packageJsonScriptsOnly(before, fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))) {
      files = files.filter((f) => f !== 'package.json');
      console.log('  · package.json: scripts 줄만 바뀜(새 시험 등) — 전부가 아님\n');
    }
  }
  const r = selectChanged(ROOT, files, browserTests);
  if (r.full.length) {
    console.log(`⚠️ 전부 — 브라우저 시험 전부를 돌리는 때입니다(\`npm run check:all\` · CLAUDE.md 2-4):`);
    for (const f of r.full) console.log(`  - ${f.file}: ${f.why}`);
    console.log('');
  }
  console.log(`바뀐 부품을 쓰는 화면의 브라우저 시험 ${r.picks.length}개${r.picks.length ? '' : ' — 고른 것 없음'}:`);
  for (const p of r.picks) console.log(`  - ${p.why}`);
  if (r.nearFull) console.log(`  ⚠️ 전체에 가까움 — 브라우저 시험 ${Object.keys(browserTests).length}개 중 ${r.picks.length}개(2/3 넘음)`);
  for (const n of r.notes) console.log(`  · ${n}`);
  const always = ALWAYS.filter((n) => browserTests[n]);
  for (const n of always) console.log(`  + ${n}: 1280 그대로 — 차수마다 늘`);
  for (const n of also) console.log(`  + ${n}: --also`);
  return [...new Set([...r.picks.map((p) => p.test), ...always, ...also])].sort();
}

// ───────── 프로세스 ─────────
let current: ChildProcess | null = null;
let engine: ChildProcess | null = null;
let engineLog: number | null = null;
const cleanups: (() => void)[] = [];

function killGroup(p: ChildProcess | null, signal: NodeJS.Signals = 'SIGTERM') {
  if (!p?.pid || p.exitCode !== null || p.signalCode !== null) return;
  try {
    process.kill(-p.pid, signal); // detached 로 띄워 이 PID 가 무리의 우두머리 — 내가 띄운 것과 그 자식만
  } catch {
    /* 이미 끝남 */
  }
}
function stopEngine() {
  if (!engine) return;
  killGroup(engine);
  console.log(`지표 엔진 5002 끔(이 스크립트가 띄운 PID ${engine.pid})`);
  engine = null;
  if (engineLog !== null) fs.closeSync(engineLog);
  engineLog = null;
}
function cleanupAll() {
  killGroup(current);
  stopEngine();
  for (const c of cleanups.splice(0)) c();
}

async function engineUp(): Promise<boolean> {
  try {
    const r = await fetch(ENGINE_URL, { signal: AbortSignal.timeout(1500) });
    return r.ok;
  } catch {
    return false;
  }
}
async function ensureEngine(dir: string) {
  if (await engineUp()) {
    console.log('지표 엔진 5002 이미 떠 있음 — 그대로 쓰고 끄지 않음');
    return;
  }
  const py = path.join(ROOT, 'python/.venv/bin/python');
  if (!fs.existsSync(py)) fail(`지표 엔진 파이썬이 없습니다: ${path.relative(ROOT, py)} (worktree 면 python/.venv 링크)`);
  engineLog = fs.openSync(path.join(dir, 'indicators-5002.log'), 'a');
  engine = spawn(py, ['python/indicators.py'], { cwd: ROOT, env: { ...process.env, INDICATORS_PORT: ENGINE_PORT }, stdio: ['ignore', engineLog, engineLog], detached: true });
  for (let i = 0; i < 120; i++) {
    await new Promise((r) => setTimeout(r, 500));
    if (await engineUp()) {
      console.log(`지표 엔진 5002 띄움(PID ${engine.pid})`);
      return;
    }
    if (engine.exitCode !== null) break;
  }
  cleanupAll();
  fail('지표 엔진 5002 가 뜨지 않았습니다 — indicators-5002.log 를 보세요');
}

// ───────── 사본 DB ─────────
/** 사용자 DB — 본 저장소(worktree 면 git 공용 폴더의 부모)의 `.env` `DB_PATH`, 기본 `./db/alphascope.db` */
function userDbPath(): string {
  let main = ROOT;
  try {
    const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: ROOT, encoding: 'utf8' }).trim();
    main = path.dirname(common);
  } catch {
    /* git 이 아니면 이 폴더 */
  }
  let rel: string | undefined;
  try {
    rel = parse(fs.readFileSync(path.join(main, '.env')))['DB_PATH'];
  } catch {
    rel = undefined;
  }
  return path.resolve(main, rel?.trim() || './db/alphascope.db');
}
function statOf(p: string) {
  const s = fs.statSync(p);
  return { size: s.size, mtimeMs: s.mtimeMs };
}
/** 읽기 전용으로 열어 온라인 백업 한 번 — 시험마다 이것을 복사한다 */
async function makeMaster(src: string, dest: string) {
  const db = new Database(src, { readonly: true, fileMustExist: true });
  try {
    await db.backup(dest);
  } finally {
    db.close();
  }
}
function removeDb(p: string) {
  for (const f of [p, `${p}-wal`, `${p}-shm`, `${p}-journal`]) fs.rmSync(f, { force: true });
}

// ───────── 한 단계 돌리기 ─────────
function runStep(step: Step, dir: string, env: NodeJS.ProcessEnv, timeoutMs: number): Promise<{ result: Outcome; seconds: number; log: string }> {
  const log = path.join(dir, `${fileName(step.name)}.log`);
  const fd = fs.openSync(log, 'w');
  const started = Date.now();
  return new Promise((resolve) => {
    const child = spawn(step.cmd, step.args, { cwd: ROOT, env, stdio: ['ignore', fd, fd], detached: true });
    current = child;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killGroup(child, 'SIGTERM');
      setTimeout(() => killGroup(child, 'SIGKILL'), 5000).unref();
    }, timeoutMs);
    const done = (code: number | null) => {
      clearTimeout(timer);
      current = null;
      fs.closeSync(fd);
      // 시험이 띄운 손자 프로세스가 남지 않게 무리째 한 번 더
      try {
        if (child.pid) process.kill(-child.pid, 'SIGKILL');
      } catch {
        /* 남은 것 없음 */
      }
      const seconds = (Date.now() - started) / 1000;
      resolve({ result: timedOut ? 'timeout' : code === 0 ? 'pass' : 'fail', seconds, log });
    };
    child.on('exit', (code) => done(code));
    child.on('error', (err) => {
      fs.appendFileSync(log, `\n[check:all] 실행 실패: ${err.message}\n`);
      done(1);
    });
  });
}
function tail(file: string, n: number): string {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  return lines.slice(Math.max(0, lines.length - n - 1)).join('\n');
}

// ───────── 본문 ─────────
async function main() {
  const opt = parseArgs(process.argv.slice(2));
  const tests = allTests();
  const split = splitTests(ROOT, tests);
  const browser = new Set(split.browser);
  const scoped = opt.quick ? split.plain : opt.browserOnly ? split.browser : tests;
  const scopeFlag = opt.quick ? '--quick' : opt.browserOnly ? '--browser-only' : '';

  const unknownAlso = opt.also.filter((n) => !tests.includes(n));
  if (unknownAlso.length) fail(`package.json 에 없는 시험(--also): ${unknownAlso.join(', ')}`);

  // 고를 시험 · 머리 단계(타입 · 린트 · 빌드)
  let chosen = scoped;
  let head = HEAD_STEPS.filter((n) => (n.startsWith('tsc') ? !opt.skipTypes : n === 'design:lint' ? !opt.skipLint : !opt.skipBuild));
  if (opt.changed !== null) {
    chosen = changedSelection(opt.changed, Object.fromEntries(split.browser.map((n) => [n, split.files[n]])), opt.also);
    if (!opt.run && opt.plan === null && opt.batch === null && !opt.summary) {
      console.log(`\n돌리기: npm run check:all -- --changed ${opt.changed}${opt.also.length ? ` --also ${opt.also.join(',')}` : ''} --run`);
      return;
    }
  } else if (opt.failed) {
    const today = path.join(REPORT_ROOT, kstDate());
    const ledger = readLedger(today);
    if (!ledger) fail(`오늘 결과가 없습니다(${path.relative(ROOT, ledgerPath(today))})`);
    const bad = Object.entries(ledger.entries).filter(([, e]) => e.result !== 'pass').map(([n]) => n);
    head = HEAD_STEPS.filter((n) => bad.includes(n));
    chosen = [...new Set([...bad.filter((n) => tests.includes(n)), ...opt.also])].sort();
    console.log(`오늘 실패 · 시간 초과 ${bad.length}개${bad.length ? `: ${bad.join(', ')}` : ''}${opt.also.length ? ` · --also ${opt.also.join(', ')}` : ''}`);
    if (!head.length && !chosen.length) {
      console.log('다시 돌릴 것이 없습니다');
      return;
    }
  } else {
    if (opt.only) {
      const unknown = opt.only.filter((n) => !tests.includes(n));
      if (unknown.length) fail(`package.json 에 없는 시험: ${unknown.join(', ')}`);
      const outside = opt.only.filter((n) => !scoped.includes(n));
      if (outside.length) fail(`${scopeFlag} 범위 밖 시험: ${outside.join(', ')}`);
      chosen = scoped.filter((t) => opt.only!.includes(t));
    }
    if (opt.from) {
      const i = chosen.indexOf(opt.from);
      if (i < 0) fail(`--from 의 시험이 목록에 없습니다: ${opt.from}`);
      chosen = chosen.slice(i);
    }
  }

  if (opt.summary) {
    const dir = latestDayDir();
    const ledger = dir ? readLedger(dir) : null;
    if (!dir || !ledger) fail('쌓인 결과가 없습니다');
    // 범위 = 고른 것(--changed · --failed · --only) — 머리 단계는 기록이 있으면 표에 함께
    const { text, ok } = table(ledger, chosen, browser);
    writeSummary(dir, ledger, chosen, browser);
    console.log(`# 기계 검사 합친 결과 — ${path.relative(ROOT, dir)}\n\n${text}\n\n결과표: ${path.relative(ROOT, path.join(dir, 'summary.md'))}`);
    process.exit(ok ? 0 : 1);
  }

  // 묶음 — 계획(얼림) · 번호로 돌기 · 한 묶음에 들지 않으면 멈춤
  const scope = scopeArgs(process.argv.slice(2));
  const key = scope.join(' ') || '(전부)';
  const today = path.join(REPORT_ROOT, kstDate());
  if (opt.plan !== null) {
    const p = makePlan(opt.plan, chosen, head, browser);
    freeze(today, key, p);
    return printPlan(p, scope);
  }
  if (opt.batch !== null) {
    let p = readPlans(today)[key];
    if (!p) {
      p = makePlan(RUN_LIMIT_MIN, chosen, head, browser);
      freeze(today, key, p);
      console.log(`얼려 둔 묶음이 없어 ${RUN_LIMIT_MIN}분으로 짜서 얼림 — 묶음 ${p.batches.length}개`);
    }
    const b = p.batches[opt.batch - 1];
    if (!b) fail(`묶음 ${opt.batch} 이 없습니다(이 범위의 묶음은 ${p.batches.length}개 — ${p.at} 에 짬)`);
    console.log(`묶음 ${opt.batch} / ${p.batches.length}(${p.at} 에 짬 · ${p.minutes}분)${b.head ? ' · 타입 검사 + design:lint + 빌드 포함' : ''} — ${b.tests.join(', ') || '(시험 없음)'}`);
    chosen = b.tests;
    if (!b.head) head = [];
  } else if (opt.run || opt.failed) {
    const p = makePlan(RUN_LIMIT_MIN, chosen, head, browser);
    if (p.batches.length > 1) {
      freeze(today, key, p);
      console.log(`\n고른 것이 ${RUN_LIMIT_MIN}분 묶음 하나에 들지 않습니다 — 돌리지 않고 묶음을 냅니다(Bash 한 번 10분 안):\n`);
      printPlan(p, scope);
      process.exit(2);
    }
  }
  const partial = opt.only || opt.from || opt.batch !== null || opt.changed !== null || opt.failed;
  const fullRun = !partial && !opt.quick && !opt.browserOnly && head.length === HEAD_STEPS.length;

  const steps: Step[] = [];
  if (head.includes('tsc app')) steps.push({ name: 'tsc app', kind: 'types', cmd: 'npx', args: ['tsc', '-p', 'tsconfig.app.json', '--noEmit'], test: false, browser: false });
  if (head.includes('tsc node')) steps.push({ name: 'tsc node', kind: 'types', cmd: 'npx', args: ['tsc', '-p', 'tsconfig.node.json', '--noEmit'], test: false, browser: false });
  if (head.includes('design:lint')) steps.push({ name: 'design:lint', kind: 'lint', cmd: 'npm', args: ['run', 'design:lint'], test: false, browser: false });
  if (head.includes('build')) steps.push({ name: 'build', kind: 'build', cmd: 'npm', args: ['run', 'build'], test: false, browser: false });
  for (const t of chosen) steps.push({ name: t, kind: 'test', cmd: 'npm', args: ['run', t], test: true, browser: browser.has(t) });

  const dir = path.join(REPORT_ROOT, kstDate());
  fs.mkdirSync(dir, { recursive: true });
  const ledger: Ledger = (!fullRun && readLedger(dir)) || { updatedAt: kstTime(), entries: {} };
  const save = () => {
    ledger.updatedAt = kstTime();
    fs.writeFileSync(ledgerPath(dir), JSON.stringify(ledger, null, 2));
  };

  process.on('SIGINT', () => {
    console.log('\n중단(Ctrl-C) — 돌던 시험과 이 스크립트가 띄운 것을 끕니다');
    cleanupAll();
    save();
    process.exit(130);
  });
  process.on('SIGTERM', () => {
    cleanupAll();
    save();
    process.exit(143);
  });

  // 사본 DB · 지표 엔진은 시험이 있을 때만
  const dbDir = path.join(dir, 'db');
  const master = path.join(dbDir, 'master.db');
  let src: string | null = null;
  let before: { size: number; mtimeMs: number } | null = null;
  if (chosen.length) {
    src = userDbPath();
    if (!fs.existsSync(src)) fail(`사용자 DB 가 없습니다: ${src}`);
    before = statOf(src);
    fs.mkdirSync(dbDir, { recursive: true });
    removeDb(master);
    await makeMaster(src, master);
    cleanups.push(() => removeDb(master));
    await ensureEngine(dir);
  }

  const timeoutMs = opt.timeoutMin * 60_000;
  const runResults: { name: string; result: Outcome; seconds: number }[] = [];
  console.log(`기계 검사${scopeFlag ? ` ${scopeFlag}` : ''} ${steps.length}단계 · 시험 ${chosen.length} / ${tests.length}(브라우저 ${chosen.filter((t) => browser.has(t)).length}) · 시험마다 제한 ${opt.timeoutMin}분 · 로그 ${path.relative(ROOT, dir)}/`);
  for (const step of steps) {
    const env: NodeJS.ProcessEnv = { ...process.env };
    let copy: string | null = null;
    if (step.test) {
      copy = path.join(dbDir, `${fileName(step.name)}.db`);
      removeDb(copy);
      fs.copyFileSync(master, copy);
      Object.assign(env, { DB_PATH: copy, INDICATORS_PORT: ENGINE_PORT });
      delete env.INDICATORS_URL;
    }
    process.stdout.write(`- ${step.name} … `);
    const r = await runStep(step, dir, env, timeoutMs);
    if (copy) removeDb(copy);
    console.log(`${OUTCOME_TEXT[r.result]} ${fmtSec(r.seconds)}초`);
    if (r.result !== 'pass') {
      console.log(`  ── ${path.relative(ROOT, r.log)} 끝 ${TAIL_LINES}줄 ──`);
      console.log(tail(r.log, TAIL_LINES).replace(/^/gm, '  | '));
    }
    ledger.entries[step.name] = { kind: step.kind, ...(step.test ? { browser: step.browser } : {}), result: r.result, seconds: Math.round(r.seconds * 10) / 10, at: kstTime() };
    runResults.push({ name: step.name, ...r });
    save();
  }

  cleanupAll();
  const extra: string[] = [];
  // 범위를 다 돌린 때는 돌린 시험 수 = 그 범위(전부면 package.json 의 `:test`) 수인지 맞춰 본다
  if (!partial) {
    const ran = runResults.filter((r) => scoped.includes(r.name)).length;
    extra.push(`- 돌린 시험 ${ran} / ${scoped.length}${scopeFlag ? `(${scopeFlag} 범위)` : ''}${ran === scoped.length ? '' : ' ⚠️ 빠진 시험 있음'}`);
    if (ran !== scoped.length) runResults.push({ name: '시험 수', result: 'fail', seconds: 0 });
  }
  if (src && before) {
    const after = statOf(src);
    const same = after.size === before.size && after.mtimeMs === before.mtimeMs;
    extra.push(`- 사용자 DB 원본 크기 · 수정 시각 ${same ? '같음' : '⚠️ 바뀜'}`);
    if (!same) runResults.push({ name: '사용자 DB 원본', result: 'fail', seconds: 0 });
  }
  save();
  writeSummary(dir, ledger, tests, browser, extra);

  const thisRun: Ledger = { updatedAt: ledger.updatedAt, entries: Object.fromEntries(runResults.filter((r) => ledger.entries[r.name]).map((r) => [r.name, ledger.entries[r.name]])) };
  const runTotal = runResults.reduce((a, r) => a + r.seconds, 0);
  const bad = runResults.filter((r) => r.result !== 'pass');
  console.log(`\n## 이번 결과\n\n${table(thisRun, chosen, browser).text.replace(/- 전체 시간 합.*/, `- 전체 시간 합 ${fmtTotal(runTotal)}`)}`);
  for (const e of extra) console.log(e);
  if (!fullRun) console.log(`\n오늘 쌓인 결과를 합친 표: npm run check:all -- ${scopeFlag ? `${scopeFlag} ` : ''}--summary`);
  console.log(`결과표: ${path.relative(ROOT, path.join(dir, 'summary.md'))} · ${path.relative(ROOT, ledgerPath(dir))}`);
  if (bad.length) console.log(`\n실패 · 시간 초과 ${bad.length}개: ${bad.map((b) => b.name).join(', ')}`);
  process.exit(bad.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  cleanupAll();
  process.exit(1);
});
