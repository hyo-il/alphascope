/**
 * 출력 자르기 막는 훅 시험(`npm run hooks:test` · v2.83.0 검사 줄이기) — `scripts/hooks/blockTrimmedChecks.sh` 에 Claude Code 와 같은 모양의
 * 입력(`{"tool_input":{"command":"…"}}`)을 넣어 막을 명령은 종료 코드 2 · 막지 않을 명령은 0 인지 본다. 브라우저 · DB 를 쓰지 않는다.
 * 관리 루트 `.claude/settings.json` 이 보이는 자리(본 저장소)에서는 그 설정이 이 훅을 부르는지도 본다(scratch worktree 는 건너뜀).
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const HOOK = path.join(root, 'scripts/hooks/blockTrimmedChecks.sh');
let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? ` — ${detail}` : ''}`);
}
const run = (command: string) => spawnSync('bash', [HOOK], { input: JSON.stringify({ tool_name: 'Bash', tool_input: { command } }), encoding: 'utf8' });

/** 막을 명령 — 검사 · 시험 · 빌드 출력을 파이프로 자름 */
const BLOCK = [
  'npm run check:quick 2>&1 | tail -40',
  'cd workspace/alphascope && npm run check:all -- --browser-only --only desktop:test | grep FAIL',
  'npx tsc -p tsconfig.app.json --noEmit | head -20',
  'DB_PATH=/tmp/x.db npx tsx scripts/buyJudgeSelfTest.ts 2>&1 |& sed -n 1,30p',
  'npx vite build | awk "/error/"',
];
/** 막지 않을 명령 */
const ALLOW = [
  'npm run check:quick',
  'git log --oneline | head -5',
  'npm run check:all -- --summary > /tmp/s.md; tail -5 /tmp/s.md',
  'grep -n "npm run check:all | tail" docs/rules/workflow.md',
  'npx tsx scripts/machineCheck.ts --plan 8 || echo "계획 실패"',
  // heredoc 본문(커밋 메시지)에 적은 글은 명령이 아니다
  "git add -A && git commit -q -F - <<'EOF'\n검사 줄이기 — npm run check:quick 출력을 | tail 로 자르면 막음\nEOF\ngit log -1 --oneline",
];

for (const c of BLOCK) {
  const r = run(c);
  check(`[C-훅] 막음(종료 2 · 안내 글): ${c}`, r.status === 2 && r.stderr.includes('검사 출력은 자르지 않습니다'), `종료 ${r.status} · ${r.stderr}`);
}
for (const c of ALLOW) {
  const r = run(c);
  check(`[C-훅] 통과(종료 0): ${c}`, r.status === 0 && r.stderr === '', `종료 ${r.status} · ${r.stderr}`);
}
{
  const r = spawnSync('bash', [HOOK], { input: 'not json', encoding: 'utf8' });
  check('[C-훅] 읽지 못한 입력은 막지 않음(종료 0)', r.status === 0, `종료 ${r.status}`);
}

// 관리 루트 설정(git 밖) — 본 저장소에서만 보인다
{
  const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: root, encoding: 'utf8' }).trim();
  const settings = path.resolve(common, '../../../.claude/settings.json');
  const mine = path.resolve(path.dirname(common)) === path.resolve(root);
  if (!mine || !fs.existsSync(settings)) console.log(`SKIP  [C-훅] 관리 루트 설정이 보이지 않는 자리(scratch worktree) — 본 저장소에서 잰다`);
  else {
    const cfg = JSON.parse(fs.readFileSync(settings, 'utf8')) as { hooks?: { PreToolUse?: { matcher?: string; hooks?: { type: string; command: string }[] }[] } };
    const entry = cfg.hooks?.PreToolUse?.find((e) => e.matcher === 'Bash' && e.hooks?.some((h) => h.type === 'command' && h.command.includes('scripts/hooks/blockTrimmedChecks.sh')));
    check('[C-훅] 관리 루트 .claude/settings.json — PreToolUse(Bash) 가 이 훅을 부름', !!entry, JSON.stringify(cfg.hooks ?? null));
  }
}

console.log(`\n출력 자르기 훅 시험 — 통과 ${pass} · 실패 ${fail}`);
process.exit(fail ? 1 : 0);
