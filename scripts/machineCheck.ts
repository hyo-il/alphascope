/**
 * 기계 검사 한 명령 (`npm run check:all`) — `CLAUDE.md` 2-3 · 공통 일하는 법 ③ 의 「기계 검사 전부」 를 순서대로 하나씩 돌리고 시험마다 걸린 시간을 남긴다.
 *
 * 순서: ① 타입 검사 두 줄(`tsconfig.app.json` · `tsconfig.node.json`) ② `design:lint` ③ `package.json` 에서 이름이 `:test` 로 끝나는 것 전부(이름 순 —
 * 목록을 손으로 적지 않으므로 새 시험이 저절로 들어간다). 시험마다 **새 사본 DB** — 시험 명령 앞에는 손으로 돌릴 때와 같이 `DB_PATH=<사본>` ·
 * `INDICATORS_PORT=5002` 만 준다(시험 서버 스위치는 서버를 띄우는 시험이 `scripts/lib/testServerEnv.ts` 를 스스로 펼친다 — 시험 프로세스에
 * 스위치를 주면 `autotrade:test` 처럼 상태를 읽는 시험이 달라진다).
 *
 * - 사본: 사용자 DB(이 저장소 — worktree 면 본 저장소 — 의 `.env` `DB_PATH`, 기본 `./db/alphascope.db`)를 **읽기 전용으로 열어 SQLite 온라인 백업**
 *   (WAL 이라 `cp` 를 쓰지 않는다)으로 한 번 뜨고, 시험마다 그 백업을 새로 복사해 준다. 끝나면 사본을 지운다. 원본의 크기 · 수정 시각을 시작 · 끝에 견준다.
 * - 지표 엔진 5002: 떠 있지 않으면 띄우고, 끝나면(성공 · 실패 · Ctrl-C) **자기가 띄운 것만** 끈다. 이미 떠 있으면 그대로 쓴다.
 * - 시험마다 시간 제한(기본 9분 · `--timeout <분>`) — 넘으면 그 시험만 「시간 초과」 로 끝내고 다음으로.
 * - 출력은 `reports/machine-check/<날짜>/<이름>.log` (`reports/` 는 `.gitignore`) · 실패한 것만 끝 40줄을 화면에.
 * - 결과표(이름 · 결과 · 초 — 금액 · 비밀값은 싣지 않는다)는 화면 + 같은 폴더 `summary.md` · `last.json`. 같은 날 나눠 돌린 결과는 이어 쌓는다.
 * - 실패 · 시간 초과가 하나라도 있으면 종료 코드 1.
 *
 * 옵션: `--only a,b`(시험만 고름) · `--from 이름`(그 시험부터 끝까지) · `--skip-types` · `--skip-lint` · `--timeout <분>`
 *       `--plan <분>`(직전 `last.json` 시간으로 그 분 안에 끝나는 묶음 목록 — 돌리지 않음) · `--summary`(오늘 쌓인 결과를 합친 표 — 돌리지 않음)
 */
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { parse } from 'dotenv';
import Database from 'better-sqlite3';

const ROOT = path.resolve(import.meta.dirname, '..');
const REPORT_ROOT = path.join(ROOT, 'reports', 'machine-check');
const ENGINE_PORT = '5002';
const ENGINE_URL = `http://127.0.0.1:${ENGINE_PORT}/health`;
const TAIL_LINES = 40;

type Kind = 'types' | 'lint' | 'test';
type Outcome = 'pass' | 'fail' | 'timeout';
interface Entry { kind: Kind; result: Outcome; seconds: number; at: string }
interface Ledger { updatedAt: string; entries: Record<string, Entry> }
interface Step { name: string; kind: Kind; cmd: string; args: string[]; test: boolean }

const OUTCOME_TEXT: Record<Outcome, string> = { pass: '통과', fail: '실패', timeout: '시간 초과' };

// ───────── 옵션 ─────────
function parseArgs(argv: string[]) {
  const o = { only: null as string[] | null, from: null as string | null, skipTypes: false, skipLint: false, timeoutMin: 9, plan: null as number | null, summary: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => {
      const v = argv[++i];
      if (v === undefined) fail(`${a} 뒤에 값이 필요합니다`);
      return v;
    };
    if (a === '--only') o.only = next().split(',').map((s) => s.trim()).filter(Boolean);
    else if (a === '--from') o.from = next();
    else if (a === '--skip-types') o.skipTypes = true;
    else if (a === '--skip-lint') o.skipLint = true;
    else if (a === '--timeout') o.timeoutMin = positive(next(), a);
    else if (a === '--plan') o.plan = positive(next(), a);
    else if (a === '--summary') o.summary = true;
    else fail(`모르는 옵션: ${a}`);
  }
  return o;
}
function positive(v: string, flag: string): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) fail(`${flag} 는 0 보다 큰 수(분)여야 합니다: ${v}`);
  return n;
}
function fail(msg: string): never {
  console.error(`check:all — ${msg}`);
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
function table(ledger: Ledger, tests: string[]): { text: string; ok: boolean } {
  const order = [
    ...['tsc app', 'tsc node', 'design:lint'].filter((n) => ledger.entries[n]),
    ...tests,
  ];
  const lines = ['| 이름 | 결과 | 초 |', '|---|---|---:|'];
  let total = 0;
  let ok = true;
  for (const n of order) {
    const e = ledger.entries[n];
    if (!e) {
      lines.push(`| ${n} | 기록 없음 | - |`);
      ok = false;
      continue;
    }
    total += e.seconds;
    if (e.result !== 'pass') ok = false;
    lines.push(`| ${n} | ${OUTCOME_TEXT[e.result]} | ${fmtSec(e.seconds)} |`);
  }
  const done = tests.filter((t) => ledger.entries[t]).length;
  const passed = tests.filter((t) => ledger.entries[t]?.result === 'pass').length;
  lines.push('', `- 시험 ${done} / ${tests.length} 돌림 · 통과 ${passed} / ${tests.length} (package.json 의 \`:test\` ${allTests().length}개)`, `- 전체 시간 합 ${fmtTotal(total)}`);
  return { text: lines.join('\n'), ok };
}
function writeSummary(dir: string, ledger: Ledger, tests: string[], extra: string[] = []) {
  const { text } = table(ledger, tests);
  const body = [`# 기계 검사 결과 — ${path.basename(dir)}`, '', `마지막 갱신 ${ledger.updatedAt} KST`, '', text, ...(extra.length ? ['', ...extra] : []), ''].join('\n');
  fs.writeFileSync(path.join(dir, 'summary.md'), body);
}

// ───────── --plan ─────────
function plan(minutes: number, tests: string[]) {
  const dir = latestDayDir();
  const ledger = dir ? readLedger(dir) : null;
  const limit = minutes * 60;
  const sec = (n: string) => ledger?.entries[n]?.seconds;
  const base = dir && ledger ? `${path.relative(ROOT, ledgerPath(dir))} (${ledger.updatedAt} KST)` : '직전 기록 없음 — 시험 하나씩 한 묶음';
  console.log(`기준: ${base} · 묶음마다 ${minutes}분 이하\n`);
  type Batch = { tests: string[]; seconds: number; known: boolean; head: boolean };
  const batches: Batch[] = [];
  // 첫 묶음은 타입 검사 두 줄 + design:lint 를 함께 돈다
  const headSec = ['tsc app', 'tsc node', 'design:lint'].map(sec);
  const headKnown = headSec.every((s) => s !== undefined);
  let cur: Batch = { tests: [], seconds: headKnown ? headSec.reduce((a, b) => a + (b ?? 0), 0) : 0, known: headKnown, head: true };
  for (const t of tests) {
    const s = sec(t);
    if (cur.tests.length === 0 && cur.head) {
      // 첫 묶음에는 시험이 적어도 하나 들어간다
      cur.tests.push(t);
      cur.seconds += s ?? 0;
      cur.known = cur.known && s !== undefined;
      continue;
    }
    if (s !== undefined && cur.known && cur.seconds + s <= limit) {
      cur.tests.push(t);
      cur.seconds += s;
      continue;
    }
    batches.push(cur);
    cur = { tests: [t], seconds: s ?? 0, known: s !== undefined, head: false };
  }
  if (cur.tests.length) batches.push(cur);
  batches.forEach((b, i) => {
    const flags = b.head ? '' : '--skip-types --skip-lint ';
    const time = b.known ? `약 ${fmtSec(b.seconds)}초${b.seconds > limit ? ` ⚠️ ${minutes}분 넘음(시험 하나가 이미 넘음)` : ''}` : '시간 기록 없음';
    console.log(`${i + 1}. ${time}${b.head ? ' · 타입 검사 + design:lint 포함' : ''}`);
    console.log(`   npm run check:all -- ${flags}--only ${b.tests.join(',')}`);
  });
  console.log(`\n마지막에: npm run check:all -- --summary`);
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

  if (opt.plan !== null) return plan(opt.plan, tests);
  if (opt.summary) {
    const dir = latestDayDir();
    const ledger = dir ? readLedger(dir) : null;
    if (!dir || !ledger) fail('쌓인 결과가 없습니다');
    const { text, ok } = table(ledger, tests);
    writeSummary(dir, ledger, tests);
    console.log(`# 기계 검사 합친 결과 — ${path.relative(ROOT, dir)}\n\n${text}\n\n결과표: ${path.relative(ROOT, path.join(dir, 'summary.md'))}`);
    process.exit(ok ? 0 : 1);
  }

  // 고를 시험
  let chosen = tests;
  if (opt.only) {
    const unknown = opt.only.filter((n) => !tests.includes(n));
    if (unknown.length) fail(`package.json 에 없는 시험: ${unknown.join(', ')}`);
    chosen = tests.filter((t) => opt.only!.includes(t));
  }
  if (opt.from) {
    const i = chosen.indexOf(opt.from);
    if (i < 0) fail(`--from 의 시험이 목록에 없습니다: ${opt.from}`);
    chosen = chosen.slice(i);
  }
  const fullRun = !opt.only && !opt.from && !opt.skipTypes && !opt.skipLint;

  const steps: Step[] = [];
  if (!opt.skipTypes) {
    steps.push({ name: 'tsc app', kind: 'types', cmd: 'npx', args: ['tsc', '-p', 'tsconfig.app.json', '--noEmit'], test: false });
    steps.push({ name: 'tsc node', kind: 'types', cmd: 'npx', args: ['tsc', '-p', 'tsconfig.node.json', '--noEmit'], test: false });
  }
  if (!opt.skipLint) steps.push({ name: 'design:lint', kind: 'lint', cmd: 'npm', args: ['run', 'design:lint'], test: false });
  for (const t of chosen) steps.push({ name: t, kind: 'test', cmd: 'npm', args: ['run', t], test: true });

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
  console.log(`기계 검사 ${steps.length}단계 · 시험 ${chosen.length} / ${tests.length} · 시험마다 제한 ${opt.timeoutMin}분 · 로그 ${path.relative(ROOT, dir)}/`);
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
    ledger.entries[step.name] = { kind: step.kind, result: r.result, seconds: Math.round(r.seconds * 10) / 10, at: kstTime() };
    runResults.push({ name: step.name, ...r });
    save();
  }

  cleanupAll();
  const extra: string[] = [];
  // 전부 돌린 때는 돌린 시험 수 = package.json 의 `:test` 수인지 맞춰 본다
  if (!opt.only && !opt.from) {
    const ran = runResults.filter((r) => tests.includes(r.name)).length;
    extra.push(`- 돌린 시험 ${ran} / ${tests.length}${ran === tests.length ? '' : ' ⚠️ 빠진 시험 있음'}`);
    if (ran !== tests.length) runResults.push({ name: '시험 수', result: 'fail', seconds: 0 });
  }
  if (src && before) {
    const after = statOf(src);
    const same = after.size === before.size && after.mtimeMs === before.mtimeMs;
    extra.push(`- 사용자 DB 원본 크기 · 수정 시각 ${same ? '같음' : '⚠️ 바뀜'}`);
    if (!same) runResults.push({ name: '사용자 DB 원본', result: 'fail', seconds: 0 });
  }
  save();
  writeSummary(dir, ledger, tests, extra);

  const thisRun: Ledger = { updatedAt: ledger.updatedAt, entries: Object.fromEntries(runResults.filter((r) => ledger.entries[r.name]).map((r) => [r.name, ledger.entries[r.name]])) };
  const runTotal = runResults.reduce((a, r) => a + r.seconds, 0);
  const bad = runResults.filter((r) => r.result !== 'pass');
  console.log(`\n## 이번 결과\n\n${table(thisRun, chosen).text.replace(/- 전체 시간 합.*/, `- 전체 시간 합 ${fmtTotal(runTotal)}`)}`);
  for (const e of extra) console.log(e);
  if (!fullRun) console.log(`\n오늘 쌓인 결과를 합친 표: npm run check:all -- --summary`);
  console.log(`결과표: ${path.relative(ROOT, path.join(dir, 'summary.md'))} · ${path.relative(ROOT, ledgerPath(dir))}`);
  if (bad.length) console.log(`\n실패 · 시간 초과 ${bad.length}개: ${bad.map((b) => b.name).join(', ')}`);
  process.exit(bad.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  cleanupAll();
  process.exit(1);
});
