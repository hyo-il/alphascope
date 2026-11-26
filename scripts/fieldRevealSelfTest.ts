/**
 * 빨간 표시 규칙 · 바뀐 곳 시험(141차 · v2.71.2) — `npm run fieldreveal:test` · ⚠️ `DB_PATH=<사본>` 으로만 돈다(맨 첫 import · DB 는 쓰지 않는다).
 *
 * 141차 지시서 「꼭 지킬 동작」(시험 이름 앞의 [141-n]) 가운데 코드로 보는 것 — 화면 쪽(1 · 2 · 3)은 `uitidy:test` · `assetcashflowui:test` · `assettradeui:test`:
 *   1(소스) 입력 칸 빨간 테두리는 공용 부품 두 곳(`ui/Input` · `ui/NumberField`)만 · 보이는 때 판단은 `ui/fieldReveal` 한 곳
 *   4 화면 코드 입력 칸에 맨 `border-danger` 를 넣으면 `design:lint` 실패(가짜 파일 · 끝나면 지움 · 커밋 안 함)
 *   5 서버 · 매매 · 주문 · 로그인 코드 바뀐 파일 0 · 서버가 함께 쓰는 `src/` 54개 바뀐 줄 0(업데이트 내역 더하기 제외) · `designCheck.ts` 판정 부분 0(141차 동안만)
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { serverSharedSrc } from './lib/serverSharedSrc';
import { chasuDiff, type Chasu } from './lib/chasuRange';

const root = path.resolve(import.meta.dirname, '..');
const BASE = '536ac58'; // 141차 기준 커밋(v2.71.1)
const CHASU: Chasu = { base: BASE, version: 'v2.71.2' }; // 그 차수 범위만(scripts/lib/chasuRange.ts)

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? ` — ${detail}` : ''}`);
}
const code = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const tsx = path.join(root, 'node_modules/tsx/dist/cli.mjs');
const lint = (env: Record<string, string>) => spawnSync(process.execPath, [tsx, 'scripts/designLint.ts'], { cwd: root, env: { ...process.env, ...env }, encoding: 'utf8' });
const noComments = (t: string) => t.split('\n').filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join('\n');

// ── [141-1] 소스 — 빨간 테두리는 공용 부품만 · 보이는 때는 한 곳 ──
{
  const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.tsx$/.test(e.name) ? [path.join(d, e.name)] : []));
  const files = walk(path.join(root, 'src/components'));
  const plain = /(?<![\w:/-])border-danger(?![\w/-])/;
  const owners = files.filter((f) => plain.test(noComments(fs.readFileSync(f, 'utf8')))).map((f) => path.relative(root, f)).sort();
  check('[141-1] 맨 border-danger(입력 칸 빨간 테두리)를 그리는 곳 = ui/Input · ui/NumberField 둘뿐', owners.join('|') === 'src/components/ui/Input.tsx|src/components/ui/NumberField.tsx', owners.join('|'));
  const users = files.filter((f) => !f.endsWith('fieldReveal.tsx') && /useFieldInvalid\(/.test(fs.readFileSync(f, 'utf8'))).map((f) => path.basename(f)).sort();
  check('[141-1] 보이는 때 판단(useFieldInvalid)을 쓰는 곳 = Input · NumberField(공용 부품)', users.join('|') === 'Input.tsx|NumberField.tsx', users.join('|'));
  const form = code('src/components/ui/FormRow.tsx');
  check('[141-1] FormRow — 입력 틀림(error)은 건드림 · 저장 시도 뒤에만 · 서버 거절(rejected)은 바로', /revealed && has\(error\)/.test(form) && /has\(rejected\) \? rejected/.test(form) && /<FieldTouch>/.test(form));
  const dialog = code('src/components/ui/Dialog.tsx');
  check('[141-1] Dialog 판 하나가 폼 묶음(저장 시도) — Button submit 이 data-form-submit', /useFormScope\(\)/.test(dialog) && /data-form-submit=\{submit \|\| undefined\}/.test(code('src/components/ui/Button.tsx')));
}

// ── [141-4] design:lint — 지금 코드 0 · 화면 코드 입력 칸에 맨 border-danger 를 넣으면 실패 ──
{
  const now = lint({});
  check('[141-4] design:lint 지금 코드 0개', now.status === 0, (now.stdout ?? '').slice(-400));
  const fake = path.join(root, 'scripts', '.lint-fake-141', 'Red.tsx');
  try {
    fs.mkdirSync(path.dirname(fake), { recursive: true });
    // 글자를 이어 붙여 이 시험 파일 자체는 검사에 걸리지 않게(scripts/ 는 화면 검사 대상이 아니지만 같은 모양으로)
    const red = 'border-' + 'danger';
    fs.writeFileSync(
      fake,
      [
        "import { Input } from '../../src/components/ui';",
        'export function Red({ bad }: { bad: boolean }) {',
        '  return (',
        '    <div className="space-y-2">',
        `      <Input className="${red}" />`,
        `      <span className={\`rounded-md border \${bad ? '${red}' : 'border-transparent'}\`}>a</span>`,
        `      <div className="rounded-lg border ${red}/40 p-2">b</div>`,
        `      <button className="hover:${red}">c</button>`,
        '    </div>',
        '  );',
        '}',
        '',
      ].join('\n'),
    );
    const r = lint({ DESIGN_LINT_EXTRA: fake });
    const out = r.stdout ?? '';
    const hit = (n: number) => new RegExp(`Red\\.tsx:${n} {2}\\[입력 칸 빨간 테두리\\]`).test(out);
    check('[141-4] 화면 코드 입력 칸에 맨 border-danger(className · 조건 글) → lint 실패 2줄 · 옅은 테두리(/40) · hover: 줄은 통과', r.status === 1 && hit(5) && hit(6) && !hit(7) && !hit(8), out.slice(-600));
  } finally {
    fs.rmSync(path.dirname(fake), { recursive: true, force: true });
  }
  check('[141-4] 시험용 가짜 파일 지움', !fs.existsSync(path.dirname(fake)));
}

// ── [141-5] 서버 · 매매 · 주문 · 로그인 · 서버가 함께 쓰는 src · designCheck 판정 부분 바뀐 줄 0(141차 v2.71.2 동안만) ──
{
  const head = code('src/data/changelog.ts').match(/version: '(v[\d.]+)'/)?.[1];
  if (head !== 'v2.71.1' && head !== 'v2.71.2') console.log(`건너뜀  [141-5] 지금 버전 ${head} — 141차(v2.71.2) 범위 시험`);
  else {
    const git = (...a: string[]) => execFileSync('git', a, { cwd: root, encoding: 'utf8' });
    const diff = (...p: string[]) => chasuDiff(root, CHASU, ['--name-only'], [...p]).stdout.trim();
    check(`[141-5] git diff ${BASE} -- server python src/services(토스 · 주문 · 로그인 서버) = 0개`, diff('server', 'python', 'src/services') === '', diff('server', 'python', 'src/services'));
    const ui = diff('src/components/chart/QuickOrderPanel.tsx', 'src/components/paper-trading/AutoTradeSettings.tsx', 'src/components/paper-trading/AutoTradeWizard.tsx', 'src/components/auth');
    check('[141-5] 주문 화면(빠른 주문) · 계좌 자동매매 설정 · 로그인 화면 바뀐 파일 0', ui === '', ui);
    const shared = serverSharedSrc();
    const CHANGELOG = 'src/data/changelog.ts';
    const touched = diff(...shared.closure.filter((f) => f !== CHANGELOG));
    check(`[141-5] 서버가 함께 쓰는 src ${shared.direct.length}개 + 그 가져오기 파일(전체 ${shared.closure.length}개 · 업데이트 내역 밖) 바뀐 줄 0`, shared.direct.length === 54 && touched === '', `${shared.direct.length} · ${touched}`);
    const cl = chasuDiff(root, CHASU, ['-U0'], [CHANGELOG]).stdout.split('\n');
    check('[141-5] 업데이트 내역(changelog.ts)은 맨 앞 항목 더하기만(지운 · 바꾼 줄 0)', cl.filter((l) => /^-(?!--)/.test(l)).length === 0);
    const ops = diff('deploy', 'db', 'scripts/lib/testServerEnv.ts', 'scripts/lib/requireCopyDb.ts', 'scripts/lib/requireTossKeys.ts', '.env.example');
    check('[141-5] 배포 · DB 정의 · 시험 서버 스위치 · 사본 DB 막기 바뀐 파일 0', ops === '', ops);
    // designCheck — 바뀐 곳은 장면(targets() 안)뿐 · 측정 판정(targets() 밖) 바뀐 줄 0
    const baseDc = git('show', `${BASE}:scripts/designCheck.ts`).split('\n');
    const startT = baseDc.findIndex((l) => l.startsWith('function targets(): Target[] {')) + 1;
    const endT = baseDc.findIndex((l) => l === '  return list;') + 1;
    const hunks = [...chasuDiff(root, CHASU, ['-U0'], ['scripts/designCheck.ts']).stdout.matchAll(/^@@ -(\d+)(?:,(\d+))? /gm)].map((m) => ({ from: Number(m[1]), n: m[2] == null ? 1 : Number(m[2]) }));
    const outside = hunks.filter((h) => h.from <= startT || h.from + Math.max(h.n, 1) - 1 >= endT);
    check(`[141-5] designCheck.ts — 판정 부분(장면 목록 ${startT}~${endT}줄 밖) 바뀐 줄 0(바뀐 덩어리 ${hunks.length}개 모두 장면)`, startT > 0 && endT > startT && outside.length === 0, JSON.stringify(outside));
  }
}

console.log(`\n결과: PASS ${pass} · FAIL ${fail}`);
process.exit(fail ? 1 : 0);
