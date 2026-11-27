/**
 * 오라클 배포 부르기 — `npm run deploy`(맥에서 · 구조 문서 1-1 「배포」 · 156차).
 *
 * 손으로 치던 `ssh -i <열쇠> <사용자@주소> '~/projects/alphascope/scripts/deploy.sh'` 한 줄과 같은 일을 한다.
 * 오라클 쪽 일(받기 · 설치 · 빌드 · 화면 복사 · pm2 두 이름만 다시 켜기)은 오라클 `scripts/deploy.sh`(저장소 `deploy/deploy.sh` 의 사본)가 한다.
 *
 * - 접속 정보는 **셸 환경 변수로만** 받는다: `ALPHASCOPE_DEPLOY_SSH_KEY`(열쇠 파일 경로) · `ALPHASCOPE_DEPLOY_HOST`(사용자@주소).
 *   없으면 「환경 변수 ○ 가 없습니다」 로 멈춘다. 열쇠 파일은 열지 않고, 그 경로도 화면에 적지 않는다(ssh 에만 넘김).
 * - 배포 시간대(KST 05:00 ~ 22:30 · 05:20 ~ 05:40 피함 — `CLAUDE.md` 2-1) 밖이면 까닭 한 줄로 멈춘다. `--force` 로만 넘긴다.
 * - `--dry-run`: 접속하지 않고 부를 명령 한 줄만 보여 준다(시간대 · 열쇠 파일 확인 없음).
 * - 그 밖의 인자는 오라클 `deploy.sh` 에 그대로 넘긴다(셸 따옴표로 감쌈).
 * 맨 위 `Alphascope/deploy.sh`(맥 바로가기)가 검사(`npm run check:quick`) 뒤에 이 명령을 부른다. 시험: `npm run deployremote:test`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const KEY_ENV = 'ALPHASCOPE_DEPLOY_SSH_KEY';
export const HOST_ENV = 'ALPHASCOPE_DEPLOY_HOST';
/** 오라클 배포 스크립트 자리 — `deploy/paths.sh` 의 `SCRIPTS_DIR`(~/projects/alphascope/scripts) + deploy.sh(원격 셸이 ~ 를 푼다) */
export const REMOTE_SCRIPT = '~/projects/alphascope/scripts/deploy.sh';

/** 배포 시간대(KST 분) — 05:00 ~ 22:30 · 05:30 전후(05:20 ~ 05:40)는 피한다 */
const OPEN_MIN = 5 * 60;
const CLOSE_MIN = 22 * 60 + 30;
const AVOID_FROM = 5 * 60 + 20;
const AVOID_TO = 5 * 60 + 40;

const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** 배포해도 되는 때면 null, 아니면 까닭 한 줄 */
export function windowProblem(now: Date): string | null {
  const kst = new Date(now.getTime() + 9 * 3600_000);
  const m = kst.getUTCHours() * 60 + kst.getUTCMinutes();
  const at = `지금 KST ${hhmm(m)}`;
  if (m < OPEN_MIN || m >= CLOSE_MIN) return `배포 시간대(KST ${hhmm(OPEN_MIN)} ~ ${hhmm(CLOSE_MIN)}) 밖입니다 — ${at} · 꼭 해야 하면 --force`;
  if (m >= AVOID_FROM && m < AVOID_TO) return `05:30 전후(KST ${hhmm(AVOID_FROM)} ~ ${hhmm(AVOID_TO)})는 피합니다 — ${at} · 꼭 해야 하면 --force`;
  return null;
}

/** 원격 셸에 넘길 낱말 — 작은따옴표로 감싼다(안의 ' 는 '\'' ) */
export const shellQuote = (s: string) => (/^[A-Za-z0-9_./=:@%+-]+$/.test(s) ? s : `'${s.replace(/'/g, `'\\''`)}'`);

export type Plan =
  | { stop: string }
  | { dryRun: boolean; force: boolean; key: string; host: string; remote: string; display: string };

/** 인자 · 환경 변수를 풀어 부를 명령을 정한다(접속 · 파일 읽기 없음) */
export function planDeploy(argv: string[], env: NodeJS.ProcessEnv): Plan {
  let dryRun = false;
  let force = false;
  const pass: string[] = [];
  for (const a of argv) {
    if (a === '--dry-run') dryRun = true;
    else if (a === '--force') force = true;
    else pass.push(a);
  }
  for (const name of [KEY_ENV, HOST_ENV]) {
    if (!env[name]?.trim()) return { stop: `환경 변수 ${name} 가 없습니다 — 셸에서 export ${name}=… 로 넣은 뒤 다시 실행하세요` };
  }
  const key = env[KEY_ENV]!.trim();
  const host = env[HOST_ENV]!.trim();
  const remote = [REMOTE_SCRIPT, ...pass.map(shellQuote)].join(' ');
  // 열쇠 경로는 적지 않는다 — 환경 변수 이름만
  const display = `ssh -i $${KEY_ENV} ${host} ${shellQuote(remote)}`;
  return { dryRun, force, key, host, remote, display };
}

export type Runner = (cmd: string, args: string[]) => number;

/** 실제로 부르기 — 종료 코드를 돌려준다. `now` · `run` · `log` 는 시험이 바꿔 끼운다 */
export function runDeploy(
  argv: string[],
  env: NodeJS.ProcessEnv,
  now: Date,
  run: Runner,
  log: (line: string) => void = (l) => console.log(l),
  fail: (line: string) => void = (l) => console.error(l),
): number {
  const plan = planDeploy(argv, env);
  if ('stop' in plan) {
    fail(`❌ ${plan.stop}`);
    return 1;
  }
  if (plan.dryRun) {
    log(`(접속 안 함 — --dry-run) ${plan.display}`);
    return 0;
  }
  const problem = windowProblem(now);
  if (problem && !plan.force) {
    fail(`❌ ${problem}`);
    return 1;
  }
  if (!fs.existsSync(plan.key)) {
    fail(`❌ 환경 변수 ${KEY_ENV} 가 가리키는 열쇠 파일이 없습니다(경로는 적지 않습니다)`);
    return 1;
  }
  log(`▶ 오라클 배포: ${plan.display}${problem ? ' (--force — 시간대 밖)' : ''}`);
  return run('ssh', ['-i', plan.key, plan.host, plan.remote]);
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const code = runDeploy(process.argv.slice(2), process.env, new Date(), (cmd, args) => {
    const r = spawnSync(cmd, args, { stdio: 'inherit' });
    if (r.error) {
      console.error(`❌ ${cmd} 를 부르지 못했습니다: ${r.error.message}`);
      return 1;
    }
    return r.status ?? 1;
  });
  process.exit(code);
}
