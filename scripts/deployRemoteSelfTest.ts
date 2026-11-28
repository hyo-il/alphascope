/**
 * 맥 배포 바로가기 점검 — `npm run deployremote:test`(156차 · 접속 · 네트워크 · DB 0).
 *
 * 1. 환경 변수(`ALPHASCOPE_DEPLOY_SSH_KEY` · `ALPHASCOPE_DEPLOY_HOST`)가 없으면 「환경 변수 ○ 가 없습니다」 로 멈춤 · ssh 0번
 * 2. 배포 시간대(KST 05:00 ~ 22:30 · 05:20 ~ 05:40 피함) 밖이면 까닭 한 줄로 멈춤 · `--force` 로만 넘김(시험 시계 — 시각을 넣어 줌)
 * 3. `--dry-run` 은 접속 0(PATH 앞 가짜 ssh 기록 0) · 부를 명령 한 줄
 * 4. 열쇠 경로 · 비밀값을 출력하지 않음(모든 출력에 열쇠 경로 글자 0)
 * 5. 받은 인자를 그대로 넘김(`npm run deploy` → 원격 deploy.sh · 맨 위 deploy.sh → npm run deploy)
 * 6. 맨 위 `Alphascope/deploy.sh`(가짜 npm) — 인자 없이는 검사 없이 `npm run deploy` 만 · `--check` 일 때만 검사(`npm run check:quick`)를 먼저 하고
 *    실패하면 `npm run deploy` 를 부르지 않음 · `--check` 는 `npm run deploy` 에 넘기지 않음
 * + 원격 자리 = `deploy/paths.sh` 의 SCRIPTS_DIR/deploy.sh
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다(DB 는 쓰지 않는다)
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { HOST_ENV, KEY_ENV, REMOTE_SCRIPT, planDeploy, runDeploy, shellQuote, windowProblem, type Plan, type Runner } from './deployRemote';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const tsx = path.join(root, 'node_modules', '.bin', 'tsx');
/** 맨 위 바로가기 — 관리 루트(git 밖) */
const TOP_DEPLOY = path.resolve(root, '../../deploy.sh');

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${!ok && detail ? `\n      ${detail}` : ''}`);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-deployremote-'));
/** 열쇠 경로 — 출력에 이 글자가 나오면 실패(가짜 파일 · 내용 없음) */
const KEY_MARK = 'KEYPATH-MUST-NOT-PRINT';
const KEY = path.join(tmp, `${KEY_MARK}.key`);
fs.writeFileSync(KEY, '');
const HOST = 'fake-user@192.0.2.1';
const ENV = { [KEY_ENV]: KEY, [HOST_ENV]: HOST };
/** KST 시각 → Date(그날은 아무 날) */
const kst = (h: number, m: number) => new Date(Date.UTC(2026, 10, 27, h - 9, m));

type Call = { cmd: string; args: string[] };
function inProcess(argv: string[], env: NodeJS.ProcessEnv, now: Date) {
  const calls: Call[] = [];
  const out: string[] = [];
  const run: Runner = (cmd, args) => {
    calls.push({ cmd, args });
    return 0;
  };
  const code = runDeploy(argv, env, now, run, (l) => out.push(l), (l) => out.push(l));
  return { code, calls, out: out.join('\n') };
}

try {
  console.log('━━━ 1. 환경 변수가 없으면 멈춤');
  {
    for (const missing of [KEY_ENV, HOST_ENV]) {
      const env = { ...ENV, [missing]: '' };
      const r = inProcess([], env, kst(12, 0));
      check(`${missing} 빈 값 → 종료 1 · 「환경 변수 ${missing} 가 없습니다」 · ssh 0번`, r.code === 1 && r.out.includes(`환경 변수 ${missing} 가 없습니다`) && r.calls.length === 0, r.out);
    }
    const none = inProcess(['--dry-run'], {}, kst(12, 0));
    check('둘 다 없음 + --dry-run 도 멈춤(첫 이름) · ssh 0번', none.code === 1 && none.out.includes(`환경 변수 ${KEY_ENV} 가 없습니다`) && none.calls.length === 0, none.out);
  }

  console.log('━━━ 2. 배포 시간대 밖이면 멈춤(시험 시계) · --force 로만 넘김');
  {
    const cases: [string, Date, boolean][] = [
      ['04:59', kst(4, 59), false], ['05:00', kst(5, 0), true], ['05:19', kst(5, 19), true], ['05:20', kst(5, 20), false],
      ['05:30', kst(5, 30), false], ['05:39', kst(5, 39), false], ['05:40', kst(5, 40), true], ['12:00', kst(12, 0), true],
      ['22:29', kst(22, 29), true], ['22:30', kst(22, 30), false], ['23:50', kst(23, 50), false],
    ];
    for (const [label, at, ok] of cases) {
      const r = inProcess([], ENV, at);
      const good = ok ? r.code === 0 && r.calls.length === 1 && windowProblem(at) === null : r.code === 1 && r.calls.length === 0 && /배포 시간대|05:30 전후/.test(r.out) && r.out.includes(`지금 KST ${label}`);
      check(`KST ${label} → ${ok ? '부름' : '멈춤 · 까닭 한 줄 · ssh 0번'}`, good, `${r.code} ${r.calls.length} ${r.out}`);
    }
    const forced = inProcess(['--force'], ENV, kst(23, 50));
    check('--force → 시간대 밖이어도 부름 · --force 는 원격에 넘기지 않음', forced.code === 0 && forced.calls.length === 1 && !forced.calls[0].args.join(' ').includes('--force') && forced.out.includes('--force — 시간대 밖'), forced.out);
    const noKeyFile = inProcess([], { ...ENV, [KEY_ENV]: path.join(tmp, `${KEY_MARK}-none.key`) }, kst(12, 0));
    check('열쇠 파일이 없으면 멈춤 · 경로는 적지 않음', noKeyFile.code === 1 && noKeyFile.calls.length === 0 && noKeyFile.out.includes('열쇠 파일이 없습니다') && !noKeyFile.out.includes(KEY_MARK), noKeyFile.out);
  }

  console.log('━━━ 3. --dry-run — 접속 0 · 부를 명령 한 줄(실제 프로세스 · PATH 앞 가짜 ssh)');
  {
    const bin = path.join(tmp, 'bin');
    fs.mkdirSync(bin);
    const log = path.join(tmp, 'ssh.log');
    fs.writeFileSync(path.join(bin, 'ssh'), `#!/bin/bash\necho "ssh $*" >> "${log}"\n`, { mode: 0o755 });
    const r = spawnSync(tsx, [path.join(here, 'deployRemote.ts'), '--dry-run', '--x'], {
      cwd: tmp, encoding: 'utf8', timeout: 60_000,
      env: { ...process.env, ...ENV, PATH: `${bin}:${process.env.PATH}` },
    });
    const lines = r.stdout.split('\n').filter((l) => l.trim());
    check('종료 0 · 가짜 ssh 기록 0(접속 안 함)', r.status === 0 && !fs.existsSync(log), `${r.status} ${r.stderr}`);
    check('출력 한 줄 · 원격 deploy.sh · 받은 인자 · 「접속 안 함」', lines.length === 1 && lines[0].includes(REMOTE_SCRIPT) && lines[0].includes('--x') && lines[0].includes('접속 안 함') && lines[0].includes(HOST), r.stdout);
    check('열쇠 경로 출력 0 · 환경 변수 이름만', !`${r.stdout}${r.stderr}`.includes(KEY_MARK) && lines[0]?.includes(`$${KEY_ENV}`), r.stdout);
    console.log(`    출력: ${lines[0] ?? '(없음)'}`);
  }

  console.log('━━━ 4. 열쇠 경로 · 비밀값을 출력하지 않음');
  {
    const outs = [inProcess([], ENV, kst(12, 0)), inProcess(['--dry-run'], ENV, kst(23, 0)), inProcess([], ENV, kst(23, 0))];
    check('부를 때 · --dry-run · 멈출 때 모든 출력에 열쇠 경로 0', outs.every((o) => !o.out.includes(KEY_MARK)), outs.map((o) => o.out).join(' | '));
    const real = outs[0].calls[0];
    check('열쇠는 ssh 인자로만 넘김(-i 열쇠 · 사용자@주소 · 원격 명령)', real?.cmd === 'ssh' && real.args[0] === '-i' && real.args[1] === KEY && real.args[2] === HOST && real.args[3] === REMOTE_SCRIPT, JSON.stringify(real));
    const src = fs.readFileSync(path.join(here, 'deployRemote.ts'), 'utf8');
    check('스크립트가 열쇠 파일을 읽지 않음(readFile 없음 · existsSync 만)', !/readFile/.test(src), '');
  }

  console.log('━━━ 5. 받은 인자를 그대로 넘김');
  {
    const r = inProcess(['--rollback', "a b'c", '--dry-run'], ENV, kst(12, 0));
    const p = planDeploy(['--rollback', "a b'c"], ENV) as Exclude<Plan, { stop: string }>;
    check('원격 명령 = deploy.sh + 인자(셸 따옴표) · --dry-run 은 빼고', p.remote === `${REMOTE_SCRIPT} --rollback 'a b'\\''c'` && r.out.includes(shellQuote(p.remote)), p.remote);
    const realRun = inProcess(['--rollback'], ENV, kst(12, 0));
    check('실제 부를 때도 같은 원격 명령', realRun.calls[0]?.args[3] === `${REMOTE_SCRIPT} --rollback`, JSON.stringify(realRun.calls));
    const ps = spawnSync('/bin/bash', ['-c', `. "${path.join(root, 'deploy', 'paths.sh')}"; echo "$SCRIPTS_DIR/deploy.sh"`], { encoding: 'utf8', env: { HOME: '~', PATH: '/usr/bin:/bin' } });
    check('원격 자리 = deploy/paths.sh SCRIPTS_DIR/deploy.sh', ps.stdout.trim() === REMOTE_SCRIPT, ps.stdout + ps.stderr);
  }

  console.log('━━━ 6. 맨 위 deploy.sh — 기본은 검사 없이 배포 · --check 일 때만 검사 → 배포(가짜 npm)');
  if (!fs.existsSync(TOP_DEPLOY)) {
    check(`맨 위 deploy.sh 없음 — 건너뜀(${TOP_DEPLOY})`, true);
  } else {
    // 가짜 관리 루트: <tmp>/Top/deploy.sh(맨 위 파일 사본) + workspace/alphascope/package.json
    const top = path.join(tmp, 'Top');
    const codeDir = path.join(top, 'workspace', 'alphascope');
    fs.mkdirSync(codeDir, { recursive: true });
    fs.writeFileSync(path.join(codeDir, 'package.json'), '{}');
    fs.copyFileSync(TOP_DEPLOY, path.join(top, 'deploy.sh'));
    const bin = path.join(tmp, 'npmbin');
    fs.mkdirSync(bin);
    const log = path.join(tmp, 'npm.log');
    fs.writeFileSync(path.join(bin, 'npm'), `#!/bin/bash\n{ printf 'npm'; printf ' [%s]' "$@"; echo " @ $(pwd -P)"; } >> "${log}"\nif [ "$2" = "check:quick" ] && [ -n "$FAKE_CHECK_FAIL" ]; then exit 3; fi\nexit 0\n`, { mode: 0o755 });
    const runTop = (args: string[], extra: Record<string, string>) => {
      fs.rmSync(log, { force: true });
      const r = spawnSync('/bin/bash', [path.join(top, 'deploy.sh'), ...args], { cwd: tmp, encoding: 'utf8', timeout: 30_000, env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, ...extra } });
      return { code: r.status, out: `${r.stdout}${r.stderr}`, log: fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : [] };
    };
    const codeReal = fs.realpathSync(codeDir);
    const isCheck = (l: string) => l.startsWith('npm [run] [check:quick]');
    const isDeploy = (l: string) => l.startsWith('npm [run] [-s] [deploy]');
    // 기본(인자 없음) — 검사 없이 배포만 · bash 3.2 set -u 에서도 멈추지 않음
    const noArgs = runTop([], { FAKE_CHECK_FAIL: '1' });
    check('[D-1] 인자 없음 → check:quick 0번 · npm run deploy 1번(검사가 실패할 환경이어도 부르지 않음) · bash 3.2 set -u 에서도 멈추지 않음', noArgs.code === 0 && noArgs.log.filter(isCheck).length === 0 && noArgs.log.length === 1 && noArgs.log[0] === `npm [run] [-s] [deploy] [--] @ ${codeReal}` && !noArgs.out.includes('① 검사'), JSON.stringify(noArgs));
    const plain = runTop(['--dry-run', 'x y'], {});
    check('인자만(--check 없음) → 검사 없이 deploy · 코드 폴더에서 · 인자 그대로(띄어쓰기 든 인자도 하나로)', plain.code === 0 && plain.log.length === 1 && plain.log[0] === `npm [run] [-s] [deploy] [--] [--dry-run] [x y] @ ${codeReal}`, JSON.stringify(plain));
    // --check — 검사가 실패하면 배포 0번
    const bad = runTop(['--check', '--dry-run'], { FAKE_CHECK_FAIL: '1' });
    check('[D-2] --check · 검사 실패 → 0 아닌 종료 · npm run deploy 0번(npm 기록은 check:quick 하나)', bad.code !== 0 && bad.log.length === 1 && isCheck(bad.log[0]) && bad.log.filter(isDeploy).length === 0, JSON.stringify(bad));
    // --check --dry-run — 검사 1번 → deploy -- --dry-run(--check 는 넘기지 않음)
    const good = runTop(['--check', '--dry-run'], {});
    check('[D-3] --check --dry-run → check:quick 1번 → npm run deploy -- --dry-run(--check 안 넘김) · 코드 폴더에서', good.code === 0 && good.log.length === 2 && good.log[0] === `npm [run] [check:quick] @ ${codeReal}` && good.log[1] === `npm [run] [-s] [deploy] [--] [--dry-run] @ ${codeReal}` && good.out.includes('① 검사'), JSON.stringify(good));
    const mid = runTop(['--dry-run', '--check', 'x y'], {});
    check('--check 는 어느 자리에 있어도 빼고 나머지 차례 그대로', mid.code === 0 && mid.log.length === 2 && isCheck(mid.log[0]) && mid.log[1] === `npm [run] [-s] [deploy] [--] [--dry-run] [x y] @ ${codeReal}`, JSON.stringify(mid));
    const text = fs.readFileSync(TOP_DEPLOY, 'utf8');
    check('맨 위 deploy.sh — set -euo pipefail · 접속 정보 · 열쇠 경로를 적지 않음', /^set -euo pipefail$/m.test(text) && !/\.key\b|secrets\/|161\.33\.|ubuntu@/.test(text), '');
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n결과: 통과 ${pass} · 실패 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
