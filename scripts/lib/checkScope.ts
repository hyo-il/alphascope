/**
 * 기계 검사 범위 한 곳 — `scripts/machineCheck.ts`(`check:quick` · `check:all`)와 `machinecheck:test` 가 함께 쓴다.
 *
 * 1. **브라우저 시험 가르기**(`splitTests`): 시험 파일이 Playwright(`playwright` · `@playwright/test` · `playwright-core`)를 import 하거나,
 *    import 하는 저장소 안 파일(`scripts/lib/` 등 — 몇 단계 건너도)이 그러면 「브라우저 시험」. 목록을 손으로 적지 않는다(새 시험이 저절로 들어간다).
 * 2. **묶음 짜기**(`planBatches`): 이름 순으로 차례대로 담아 묶음마다 `limit` 초 안 · `LONG_SEC`(5분)을 넘는 시험은 혼자 묶음 · 시간 기록이 없는 시험은 부르는 쪽이 `estimateSec` 기본 예상 시간을 준다.
 *    묶음 차례는 늘 이름 순이다(혼자 묶음도 제자리) — `--plan` 이 짠 묶음은 그날 `plan.json` 에 얼려 두고 `--batch <n>` 이 그것을 그대로 부른다
 *    (묶음을 돌리면 시간 기록이 바뀌어도 n 번 묶음은 같다). Bash 한 번에 묶음 하나(`CLAUDE.md` 2-4).
 * 3. **바뀐 부품을 쓰는 화면 시험 고르기**(`selectChanged`): 바뀐 파일 → 그 파일을 (정적 · 동적) import 하는 `src` 파일을 거꾸로 따라 올라가
 *    `src/components/<폴더>` 에 닿으면, `src/App.tsx` 의 `case '<page>'` 가 그리는 부품이 import 된 폴더로 page id 를 정하고,
 *    시험 파일 안에 그 화면 주소 해시 `#/<page>` 나 바뀐 파일 이름(컴포넌트 이름)이 있는 브라우저 시험을 고른다(까닭 줄 = 따라간 길).
 *    - 공용 부품(`ui/` 등)도 같다 — 그 부품을 쓰는 화면의 시험만 고른다. 고른 것이 브라우저 시험의 2/3 를 넘으면 「전체에 가까움」 한 줄.
 *    - **전부**(`FULL_RULES`): 앱 틀(어느 화면에도 닿지 않는 화면 파일 · `App.tsx` · 전역 CSS) · 매매 · 서버 공통 · 빌드 설정을 건드렸을 때
 *      「전부」 안내(`CLAUDE.md` 2-4 ② — 「배포 전」 은 지시서 머리가 정한다).
 *    - `ALWAYS`(`desktop:test` — 1280 그대로)는 늘 넣는다.
 */
import fs from 'node:fs';
import path from 'node:path';

// ───────── 1. 브라우저 시험 가르기 ─────────
const BROWSER_MODULES = /^(playwright|playwright-core|@playwright\/test)(\/|$)/;
// 정적 import · export … from · 맨 import 는 줄 맨 앞만(글 안에 적은 import 글자를 세지 않는다) · 동적 import() · require() 는 어디서나
const IMPORT_RE = /^\s*(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|^\s*import\s+['"]([^'"]+)['"]|require\(\s*['"]([^'"]+)['"]\s*\)/gm;
const EXTS = ['', '.ts', '.tsx', '.mts', '.js', '.mjs', '/index.ts', '/index.tsx'];

/** 파일 글에서 import 하는 이름 전부 */
export function importsOf(text: string): string[] {
  return [...text.matchAll(IMPORT_RE)].map((m) => m[1] ?? m[2] ?? m[3] ?? m[4]).filter((s): s is string => !!s);
}
/** 저장소 안 상대 · `@/` 경로를 실제 파일로(없으면 null) */
export function resolveLocal(root: string, from: string, spec: string): string | null {
  let base: string;
  if (spec.startsWith('.')) base = path.resolve(path.dirname(from), spec);
  else if (spec.startsWith('@/')) base = path.join(root, 'src', spec.slice(2));
  else return null;
  // `.js` 로 적은 TS 파일(ESM 모양)도 찾는다
  const bases = /\.(m?js)$/.test(base) ? [base, base.replace(/\.m?js$/, '')] : [base];
  for (const b of bases) for (const e of EXTS) {
    const p = b + e;
    if (fs.existsSync(p) && fs.statSync(p).isFile()) return p;
  }
  return null;
}

/** 이 파일(또는 이 파일이 import 하는 저장소 안 파일)이 Playwright 를 쓰는가 */
export function usesBrowser(root: string, file: string, read: (f: string) => string = (f) => fs.readFileSync(f, 'utf8'), seen = new Set<string>()): boolean {
  if (seen.has(file)) return false;
  seen.add(file);
  for (const spec of importsOf(read(file))) {
    if (BROWSER_MODULES.test(spec)) return true;
    const local = resolveLocal(root, file, spec);
    if (local && !local.includes(`${path.sep}node_modules${path.sep}`) && usesBrowser(root, local, read, seen)) return true;
  }
  return false;
}

/** `package.json` 의 `:test` 이름 → 시험 파일(절대 경로 · `tsx <파일>` 모양) */
export function testFiles(root: string): Record<string, string> {
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> };
  const out: Record<string, string> = {};
  for (const [name, cmd] of Object.entries(pkg.scripts)) {
    if (!name.endsWith(':test')) continue;
    const m = cmd.match(/(?:^|\s)(scripts\/\S+\.(?:ts|mts|js|mjs))/);
    if (m) out[name] = path.join(root, m[1]);
  }
  return out;
}

export interface Split { browser: string[]; plain: string[]; files: Record<string, string> }
/** `:test` 전부를 브라우저 / 아님으로(이름 순) — 파일을 못 찾은 시험은 브라우저 아님(빌드 도구 명령 등) */
export function splitTests(root: string, names: string[]): Split {
  const files = testFiles(root);
  const browser: string[] = [];
  const plain: string[] = [];
  for (const n of [...names].sort()) {
    const f = files[n];
    (f && fs.existsSync(f) && usesBrowser(root, f) ? browser : plain).push(n);
  }
  return { browser, plain, files };
}

// ───────── 2. 묶음 짜기 ─────────
/** 혼자 묶음으로 낼 시험 — 지난 시간이 이 초를 넘으면 */
export const LONG_SEC = 300;
/** 시간 기록이 없는 시험의 기본 예상 시간(초) — 새 worktree 의 첫 실행에서 `--plan` 이 시험마다 혼자 묶음으로 잘게 쪼개지 않게 */
export const DEFAULT_BROWSER_SEC = 120;
export const DEFAULT_PLAIN_SEC = 10;
/** 시험 하나의 예상 시간 — 기록이 있으면 그 값, 없으면 기본 예상 시간(브라우저 `DEFAULT_BROWSER_SEC` · 아님 `DEFAULT_PLAIN_SEC`) */
export function estimateSec(recorded: number | undefined, browser: boolean): { seconds: number; guessed: boolean } {
  if (recorded !== undefined) return { seconds: recorded, guessed: false };
  return { seconds: browser ? DEFAULT_BROWSER_SEC : DEFAULT_PLAIN_SEC, guessed: true };
}

export interface Batch { tests: string[]; seconds: number; known: boolean; head: boolean; alone: boolean }

/**
 * 시험을 묶음으로(받은 차례 그대로 — 부르는 쪽이 이름 순으로 준다). `head` 초(타입 · 린트 · 빌드)가 있으면 첫 묶음에 함께 돈다.
 * 시간 기록이 없는 시험 · `LONG_SEC` 를 넘는 시험은 혼자 묶음 — 그 자리에서 열려 있던 묶음을 닫고 혼자 묶음을 넣는다(차례가 바뀌지 않게).
 */
export function planBatches(tests: string[], secOf: (n: string) => number | undefined, limitSec: number, head: number | undefined | null): Batch[] {
  const batches: Batch[] = [];
  let cur: Batch | null = head !== null ? { tests: [], seconds: head ?? 0, known: head !== undefined, head: true, alone: false } : null;
  const close = () => {
    if (cur && (cur.tests.length || cur.head)) batches.push(cur);
    cur = null;
  };
  for (const t of tests) {
    const s = secOf(t);
    if (s === undefined || s > LONG_SEC) {
      // 머리(타입 · 린트 · 빌드)만 있는 첫 묶음은 혼자 시험을 기다리지 않고 그대로 닫는다
      close();
      batches.push({ tests: [t], seconds: s ?? 0, known: s !== undefined, head: false, alone: true });
      continue;
    }
    if (cur && cur.known && cur.seconds + s <= limitSec) {
      cur.tests.push(t);
      cur.seconds += s;
      continue;
    }
    close();
    cur = { tests: [t], seconds: s, known: true, head: false, alone: false };
  }
  close();
  return batches;
}

// ───────── 3. 그 영역 브라우저 시험 고르기 ─────────
/** 「전부」 를 돌릴 파일 — `CLAUDE.md` 2-4 ② 매매 · 서버 공통 · 앱 틀(모든 화면을 감싸는 파일) · 빌드 · 의존성 설정. 공용 부품(`ui/` 등)은 여기 없다(쓰는 화면만) */
export const FULL_RULES: { re: RegExp; why: string }[] = [
  { re: /^src\/(index\.css|fonts\.css|App\.tsx|main\.tsx)$/, why: '앱 틀 · 전역 스타일' },
  { re: /^server\/(rules|autoTrading|buyJudge|aiCheck)\//, why: '매매 판단(등급 3)' },
  { re: /^server\/(paperTradingService|paperPerformanceService)\.ts$/, why: '계좌 계산(등급 3)' },
  { re: /^server\/(index|db|auth|authGuard|apiError|quoteService|candleService|previousClose|marketHours|marketCalendar|indicatorService)\.ts$/, why: '서버 공통(시작 · DB · 인증 · 시세)' },
  { re: /^server\/(lib|data)\//, why: '서버 공통 lib' },
  { re: /^src\/services\/toss\//, why: '토스 호출(서버 공통)' },
  { re: /^db\/schema\.sql$/, why: 'DB 표' },
  // package.json 은 `scripts` 밖이 바뀐 때만(새 시험 한 줄은 전부가 아니다 — `packageJsonScriptsOnly`)
  { re: /^(package\.json|package-lock\.json|vite\.config\.ts|tsconfig[^/]*\.json)$/, why: '빌드 · 의존성 설정' },
];
/** `--changed` 가 늘 넣는 시험 — 1280 그대로(차수마다) */
export const ALWAYS = ['desktop:test'];
/** 고른 것이 브라우저 시험의 이만큼을 넘으면 「전체에 가까움」 */
export const NEAR_FULL = 2 / 3;

/** 두 package.json 글이 `scripts` 밖에서는 같은가(새 시험 이름만 더한 차수 — 전부가 아님) */
export function packageJsonScriptsOnly(before: string, after: string): boolean {
  try {
    const strip = (t: string) => {
      const o = JSON.parse(t) as Record<string, unknown>;
      delete o.scripts;
      return JSON.stringify(o);
    };
    return strip(before) === strip(after);
  } catch {
    return false;
  }
}

export interface ChangedPick { test: string; why: string }
export interface ChangedResult { full: { file: string; why: string }[]; picks: ChangedPick[]; notes: string[]; nearFull: boolean }

interface SrcGraph { importers: Map<string, Set<string>>; folderPages: Map<string, string[]> }

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(e.name)) out.push(p);
  }
  return out;
}

/** `src` import 거꾸로 표 + `App.tsx` 의 `case` → 부품 폴더 → page id */
export function buildSrcGraph(root: string): SrcGraph {
  const importers = new Map<string, Set<string>>();
  for (const f of walk(path.join(root, 'src'))) {
    for (const spec of importsOf(fs.readFileSync(f, 'utf8'))) {
      const to = resolveLocal(root, f, spec);
      if (!to) continue;
      const rel = path.relative(root, to);
      if (!importers.has(rel)) importers.set(rel, new Set());
      importers.get(rel)!.add(path.relative(root, f));
    }
  }
  const app = fs.readFileSync(path.join(root, 'src/App.tsx'), 'utf8');
  const compFolder = new Map<string, string>();
  for (const m of app.matchAll(/import\s+(?:(\w+)|\{[^}]*\})[^'"]*from\s+['"]\.\/components\/([^/'"]+)\/[^'"]+['"]/g)) if (m[1]) compFolder.set(m[1], m[2]);
  const folderPages = new Map<string, string[]>();
  const add = (folder: string, page: string) => {
    const list = folderPages.get(folder) ?? [];
    if (!list.includes(page)) list.push(page);
    folderPages.set(folder, list);
  };
  // switch 의 case 하나씩 — 다음 case 까지 처음 그리는 부품
  const parts = app.split(/\n\s*case '/).slice(1);
  for (const part of parts) {
    const id = part.slice(0, part.indexOf("'"));
    const comp = part.match(/<([A-Z]\w+)/)?.[1];
    const folder = comp ? compFolder.get(comp) : undefined;
    if (folder && !/^(ui|layout|common)$/.test(folder)) add(folder, id);
  }
  // 차트는 `case 'chart'` 가 아무것도 그리지 않는다(늘 마운트) — chart 폴더 = chart 화면
  add('chart', 'chart');
  return { importers, folderPages };
}

/**
 * 이 src 파일이 닿는 화면(page id) → 따라간 길(바뀐 파일부터 그 화면 폴더의 첫 파일까지) — import 를 거꾸로 너비 우선으로(가장 짧은 길).
 * 자기 폴더가 화면 폴더면 그 자리에서 닿는다.
 */
export function reachOf(graph: SrcGraph, file: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const prev = new Map<string, string | null>([[file, null]]);
  const queue = [file];
  while (queue.length) {
    const f = queue.shift()!;
    const m = f.match(/^src\/components\/([^/]+)\//);
    if (m) {
      for (const p of graph.folderPages.get(m[1]) ?? []) {
        if (out.has(p)) continue;
        const chain: string[] = [];
        for (let x: string | null = f; x; x = prev.get(x) ?? null) chain.unshift(x);
        out.set(p, chain);
      }
    }
    for (const by of [...(graph.importers.get(f) ?? [])].sort()) {
      if (prev.has(by)) continue;
      prev.set(by, f);
      queue.push(by);
    }
  }
  return new Map([...out.entries()].sort(([a], [b]) => a.localeCompare(b)));
}
function hashRe(page: string) {
  return new RegExp(`#/${page.replace(/[-]/g, '\\-')}(?![\\w-])`);
}

/**
 * 바뀐 파일(저장소 기준 상대 경로) → 「전부」 까닭 또는 고른 브라우저 시험.
 * `browserTests` = 브라우저 시험 이름 → 파일(절대 경로).
 */
export function selectChanged(root: string, changed: string[], browserTests: Record<string, string>, graph: SrcGraph = buildSrcGraph(root)): ChangedResult {
  const full: { file: string; why: string }[] = [];
  const notes: string[] = [];
  const reasons = new Map<string, string[]>();
  const pick = (t: string, why: string) => {
    const list = reasons.get(t) ?? [];
    if (!list.includes(why)) list.push(why);
    reasons.set(t, list);
  };
  const texts = Object.fromEntries(Object.entries(browserTests).map(([n, f]) => [n, fs.readFileSync(f, 'utf8')]));
  const testRel = Object.fromEntries(Object.entries(browserTests).map(([n, f]) => [path.relative(root, f), n]));

  for (const file of changed) {
    const rule = FULL_RULES.find((r) => r.re.test(file));
    if (rule) {
      full.push({ file, why: rule.why });
      continue;
    }
    // 브라우저 시험 파일 자체 · 그 시험이 쓰는 scripts 파일
    if (file.startsWith('scripts/')) {
      if (testRel[file]) pick(testRel[file], `바뀐 시험 파일 \`${file}\` → ${testRel[file]}`);
      const abs = path.join(root, file);
      for (const [n, f] of Object.entries(browserTests)) {
        if (f === abs) continue;
        const deps = new Set<string>();
        usesBrowserDeps(root, f, deps);
        if (deps.has(abs)) pick(n, `바뀐 \`${file}\` → 시험이 import → ${n}`);
      }
      continue;
    }
    const base = path.basename(file).replace(/\.[^.]+$/, '');
    const nameRe = base.length >= 4 ? new RegExp(`\\b${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`) : null;
    const reach = file.startsWith('src/') ? reachOf(graph, file) : file.startsWith('python/') ? new Map([['chart', [file]]]) : new Map<string, string[]>();
    if (file.startsWith('src/components/') && reach.size === 0) {
      full.push({ file, why: '어느 화면에도 닿지 않는 화면 파일(앱 틀로 봄)' });
      continue;
    }
    const short = (f: string) => `\`${f.replace(/^src\/components\//, '').replace(/^src\//, '')}\``;
    for (const [n, text] of Object.entries(texts)) {
      for (const [p, chain] of reach) {
        if (hashRe(p).test(text)) pick(n, `바뀐 ${chain.map(short).join(' → ')} → \`#/${p}\` → ${n}`);
      }
      if (nameRe?.test(text)) pick(n, `바뀐 ${short(file)} → 시험 글에 이름 ${base} → ${n}`);
    }
    if (file.startsWith('server/')) notes.push(`${file}: 서버 파일 — 브라우저 없는 시험(check:quick)이 덮음 · 이름이 적힌 브라우저 시험만 더함`);
    else if (!reach.size && !file.startsWith('src/')) notes.push(`${file}: 앱 화면과 이어지지 않음`);
  }
  const picks = [...reasons.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([test, why]) => ({ test, why: why[0] + (why.length > 1 ? ` (외 ${why.length - 1}길)` : '') }));
  const nearFull = Object.keys(browserTests).length > 0 && picks.length > Object.keys(browserTests).length * NEAR_FULL;
  return { full, picks, notes, nearFull };
}

/** 이 시험 파일이 import 하는 저장소 안 파일 전부(몇 단계 건너도) */
function usesBrowserDeps(root: string, file: string, out: Set<string>) {
  for (const spec of importsOf(fs.readFileSync(file, 'utf8'))) {
    const local = resolveLocal(root, file, spec);
    if (!local || out.has(local) || local.includes(`${path.sep}node_modules${path.sep}`)) continue;
    out.add(local);
    usesBrowserDeps(root, local, out);
  }
}
