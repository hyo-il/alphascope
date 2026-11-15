/**
 * 코드 정리 시험(137차 · v2.70.3) — `npm run tidy:test` · ⚠️ `DB_PATH=<사본>` 으로만 돈다(맨 첫 import · DB 는 쓰지 않는다).
 *
 * 1. [137-2] 서버 · 서버가 함께 쓰는 src 파일(`serverSharedSrc` 닫힘)의 export 가운데 **밖에서 쓰지 않는 것 0**
 *    (밖에서 쓰지 않으면 `export` 를 떼고, 아무 데서도 안 쓰면 지운다). 「씀」 = 다른 파일에 이름이 있음 또는 같은 파일의 **다른 export 선언 안**에
 *    이름이 있음(예: `export type ClockCorner = (typeof CLOCK_CORNERS)[number]` — 밖에서 그 타입을 쓰려면 함께 export 해야 한다 · knip 과 같은 기준).
 *    이름 찾기라 knip 보다 느슨하다(다른 파일에 같은 이름이 있으면 「씀」).
 *    · 지운 4개(FOMC_CHECKED_AT · NYSE_CHECKED_AT · BRIEF_AUTO_TIME · AssetDailyNoteRequest)를 쓰는 곳 0
 * 2. [137-3] `UNGROUPED_ID` 쓰는 곳 0(관심 목록 기본 폴더는 `DEFAULT_FOLDER_ID` 하나 · 값 'default')
 * 3. [137-4] 지운 파일(배포 스크립트 4 · `server/dataReset/v2_44_0.ts` · 저장소 옛 조사 문서)이 없고, 이름으로 찾는 곳 0
 *    (`src` · `server` · `scripts` · `deploy` · `python` · `package.json` — 옛 정답 파일 `scripts/fixtures` 와
 *    `deploy/README.md` 의 「git 기록」 줄은 지난 일 기록이라 뺌) · 저장소 `docs/` 를 훑는 `deploy:test` 는 폴더가 없어도 건너뜀
 * 4. [137-6] `swing` 폴더(매수 판단 화면) · `scripts/designCheck.ts` 바뀐 줄 0(57b989f 와 지금 — 뒤 지시서는 `tradingDiff` 로 나눠 견줌)
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import fs from 'node:fs';
import path from 'node:path';
import { serverSharedSrc } from './lib/serverSharedSrc';
import { laterAwarePatch } from './lib/tradingDiff';

const root = path.resolve(import.meta.dirname, '..');
const SELF = path.relative(root, import.meta.filename);
let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? '✅' : '❌'} ${name}${detail ? ` — ${detail}` : ''}`);
}

function walk(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name === '.venv' || e.name === '__pycache__') continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(path.relative(root, p));
  }
  return out;
}
const read = (f: string) => fs.readFileSync(path.join(root, f), 'utf8');
const CODE = /\.(ts|tsx|mts|cjs|js|py|sh|json|conf)$/;
/** 이름 찾기 대상 — src · server · scripts · deploy · python · package.json (옛 정답 파일 · 이 시험 자신은 뺌) */
const searchFiles = [...['src', 'server', 'scripts', 'deploy', 'python'].flatMap((d) => walk(path.join(root, d))), 'package.json']
  .filter((f) => f !== SELF && !f.startsWith('scripts/fixtures/') && (CODE.test(f) || f === 'deploy/README.md'));
const texts = new Map(searchFiles.map((f) => [f, read(f)]));
/** 이름이 나오는 파일들(`deploy/README.md` 의 「git 기록」 줄은 지난 일 기록이라 뺌) */
function whereUsed(name: string, re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`)): string[] {
  return [...texts].filter(([f, t]) => {
    const lines = f === 'deploy/README.md' ? t.split('\n').filter((l) => !l.includes('git 기록')) : t.split('\n');
    return lines.some((l) => re.test(l));
  }).map(([f]) => f);
}

console.log('━━━ [137-2] 서버 · 공유 파일 export — 밖에서 안 쓰는 것 0 · 지운 4개 쓰는 곳 0');
{
  const tsTexts = new Map([...texts].filter(([f]) => /\.(ts|tsx|mts)$/.test(f)));
  const files = [...new Set([...walk(path.join(root, 'server')).filter((f) => /\.ts$/.test(f)), ...serverSharedSrc().closure])];
  const DECL = /^export\s+(?:declare\s+)?(?:async\s+)?(?:function\*?|const|let|var|interface|type|class|abstract\s+class|enum)\s+([A-Za-z_$][\w$]*)/gm;
  const LIST = /^export\s+(?:type\s+)?\{([^}]*)\}\s*;?\s*$/gm;
  const lonely: string[] = [];
  let total = 0;
  /** 맨 바깥 선언 덩어리(줄 첫 글자부터 시작하는 선언 · 주석 · import 에서 끊음) 가운데 export 로 시작하는 것 */
  const exportChunks = (t: string) => {
    const out: string[] = [];
    let cur: string[] | null = null;
    for (const l of t.split('\n')) {
      if (/^(export\s|const\s|let\s|var\s|function\s|async\s|interface\s|type\s|class\s|enum\s|import\s|\/\*\*|\/\/|declare\s)/.test(l)) {
        if (cur) out.push(cur.join('\n'));
        cur = l.startsWith('export') ? [l] : null;
      } else if (cur) cur.push(l);
    }
    if (cur) out.push(cur.join('\n'));
    return out;
  };
  for (const f of files) {
    const t = read(f);
    const chunks = exportChunks(t);
    const names = [...t.matchAll(DECL)].map((m) => m[1]).concat([...t.matchAll(LIST)].flatMap((m) => m[1].split(',').map((x) => x.trim().split(/\s+as\s+/).pop()!.replace(/^type\s+/, '')).filter(Boolean)));
    for (const n of names) {
      total++;
      const re = new RegExp(`\\b${n.replace(/\$/g, '\\$')}\\b`);
      const outside = [...tsTexts].some(([g, u]) => g !== f && re.test(u));
      const ownDecl = new RegExp(`^export\\s+(?:declare\\s+)?(?:async\\s+)?(?:function\\*?|const|let|var|interface|type|class|abstract\\s+class|enum)\\s+${n.replace(/\$/g, '\\$')}\\b`);
      const inOtherExport = chunks.some((c) => !ownDecl.test(c) && re.test(c));
      if (!outside && !inOtherExport) lonely.push(`${f}:${n}`);
    }
  }
  check(`서버 · 공유 파일 ${files.length}개의 export ${total}개 가운데 밖에서 쓰지 않는 것 0(다른 파일 · 같은 파일의 다른 export 선언 안 어디에도 없음)`, files.length > 150 && total > 300 && lonely.length === 0, lonely.slice(0, 20).join(', '));
  for (const n of ['FOMC_CHECKED_AT', 'NYSE_CHECKED_AT', 'BRIEF_AUTO_TIME', 'AssetDailyNoteRequest']) {
    const w = whereUsed(n);
    check(`지운 ${n} 을 쓰는 곳 0`, w.length === 0, w.join(', '));
  }
  check('확인일은 파일 머리 주석에 그대로(fomc.ts 2026-09-29 · nyseHolidays.ts 2026-09-30)', read('src/data/fomc.ts').includes('확인일: 2026-09-29') && read('src/data/nyseHolidays.ts').includes('확인일: 2026-09-30'));
}

console.log('━━━ [137-3] UNGROUPED_ID → DEFAULT_FOLDER_ID 하나');
{
  const w = whereUsed('UNGROUPED_ID');
  check('UNGROUPED_ID 쓰는 곳 0', w.length === 0, w.join(', '));
  check("DEFAULT_FOLDER_ID 값 'default' 그대로 · 관심 패널이 같은 이름으로 기본 폴더를 가름", /export const DEFAULT_FOLDER_ID = 'default';/.test(read('src/types/watchlist.ts')) && read('src/components/layout/WatchPanel.tsx').includes('bare={folder.id === DEFAULT_FOLDER_ID}'));
}

console.log('━━━ [137-4] 지운 파일 — 없음 · 이름으로 찾는 곳 0 · 폴더 훑기');
{
  const GONE = ['deploy/move-to-projects.sh', 'deploy/rollback-to-vite.sh', 'deploy/switch-to-static.sh', 'deploy/upgrade-node24.sh', 'server/dataReset/v2_44_0.ts', 'docs/조사_2026-10-23_업무시간_종목지도.md'];
  const still = GONE.filter((f) => fs.existsSync(path.join(root, f)));
  check(`지운 파일 ${GONE.length}개 없음`, still.length === 0, still.join(', '));
  for (const f of GONE) {
    const base = path.basename(f);
    const stem = base.replace(/\.[^.]+$/, '');
    const w = whereUsed(stem, new RegExp(stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    check(`「${base}」 이름(${stem})으로 찾는 곳 0`, w.length === 0, w.join(', '));
  }
  check('서버가 데이터 정리 폴더를 부르지 않음(dataReset · runDataReset 0)', whereUsed('dataReset', /dataReset|runDataReset/).length === 0, whereUsed('dataReset', /dataReset|runDataReset/).join(', '));
  check('저장소 docs/ 를 훑는 deploy:test 는 폴더가 없으면 건너뜀(있을 때만 walk)', /const docsThere = fs\.existsSync\(DOCS_DIR\);\s*\n\s*if \(docsThere\) walk\(DOCS_DIR\);/.test(read('scripts/deploySelfTest.ts')));
  const deployList = [...read('scripts/deploySelfTest.ts').matchAll(/for \(const f of \[([^\]]*)\]\)/g)].flatMap((m) => [...m[1].matchAll(/'([^']+\.sh)'/g)].map((x) => x[1]));
  const missing = [...new Set(deployList)].filter((f) => !fs.existsSync(path.join(root, 'deploy', f)));
  check(`deploy:test 가 이름으로 읽는 배포 스크립트(${new Set(deployList).size}개)가 모두 있음`, deployList.length > 5 && missing.length === 0, missing.join(', '));
}

console.log('━━━ [137-6] swing 폴더 · designCheck.ts 바뀐 줄 0');
{
  check('swing 폴더 그대로 있음(매수 판단 화면 — 이름 바꾸지 않음)', fs.existsSync(path.join(root, 'src/components/swing')) && walk(path.join(root, 'src/components/swing')).length > 0);
  const d = laterAwarePatch(root, '57b989f', ['src/components/swing', 'scripts/designCheck.ts']);
  check('src/components/swing · scripts/designCheck.ts 바뀐 줄 0(57b989f 와 지금 작업 트리)', d.status === 0 && d.stdout.trim() === '', d.stdout.slice(0, 300) || d.stderr.trim());
}

console.log(`\n결과: ${pass}개 통과 / ${fail}개 실패`);
process.exit(fail === 0 ? 0 : 1);
