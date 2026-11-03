/**
 * 오라클 배포 스크립트 점검 — `npm run deploy:test` · ⚠️ `DB_PATH=<사본>` 으로만 돈다(맨 첫 import · DB 는 쓰지 않는다).
 *
 * 실제 pm2 · 서버 없이 `deploy/deploy.sh` 를 임시 폴더(가짜 HOME)에서 돌린다.
 * PATH 맨 앞에 가짜 `pm2` · `git` · `npm` · `sudo` · `rsync` · `curl` · `sleep` 을 두어 받은 인자를 기록 파일에 적고,
 * 같은 서버에 다른 프로젝트(`other-project`)가 pm2 에 떠 있다고 꾸며 확인한다.
 * 1. pm2 에 「모두」 명령이 없고 AlphaScope 두 이름만 다시 켠다(배포 · 전환 · 되돌리기 스크립트 글도 검사)
 * 2. 하나가 pm2 에 없으면 ecosystem 으로 그 이름만 켜고 알린다
 * 3. 끝의 API · 화면 확인이 있고, pm2 상태는 AlphaScope 두 줄만 보인다
 * 4. 저장소의 deploy.sh 가 ~/deploy.sh 와 다르면 덮어쓰지 않고 안내 한 줄
 * 5. 받기 · 설치 · 빌드 · 화면 복사 · nginx 확인은 그대로
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEPLOY_DIR = path.join(root, 'deploy');
const APPS = ['alphascope-api', 'alphascope-indicators'];
const OTHER = 'other-project';

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? '  ✓' : '  ✗'} ${name}${!ok && detail ? `\n      ${detail}` : ''}`);
}

/** 가짜 명령 — 받은 인자를 $FAKE_LOG 에 「이름 인자…」 한 줄로 적는다 */
const FAKE_PM2 = `#!/bin/bash
echo "pm2 $*" >> "$FAKE_LOG"
case "$1" in
  describe)
    for n in $FAKE_PM2_EXISTING; do [ "$n" = "$2" ] && exit 0; done
    echo "[PM2][WARN] $2 doesn't exist" >&2; exit 1 ;;
  jlist)
    out="["; sep=""
    for n in $FAKE_PM2_EXISTING ${OTHER}; do out="$out$sep{\\"name\\":\\"$n\\",\\"pm2_env\\":{\\"status\\":\\"online\\",\\"restart_time\\":3}}"; sep=","; done
    echo "$out]" ;;
  status|list|ls)
    for n in $FAKE_PM2_EXISTING ${OTHER}; do echo "│ $n │ online │"; done ;;
esac
exit 0
`;
const FAKE_GIT = `#!/bin/bash
echo "git $*" >> "$FAKE_LOG"
case "$1" in
  rev-parse) echo "abc1234" ;;
  log) echo "  abc1234  시험 커밋" ;;
esac
exit 0
`;
const FAKE_CURL = `#!/bin/bash
echo "curl $*" >> "$FAKE_LOG"
case "$*" in
  *http_code*) echo -n 200 ;;
  *api/version*) echo '{"version":"v-test"}' ;;
esac
exit 0
`;
const fakeLogOnly = (name: string) => `#!/bin/bash\necho "${name} $*" >> "$FAKE_LOG"\nexit 0\n`;

interface RunResult {
  code: number | null;
  out: string;
  log: string[];
  homeDeploy: string;
  homeDeployBefore: string;
}

/** deploy.sh 를 임시 HOME 에서 돌린다 */
function runDeploy(opts: { existing: string[]; homeDeploy: 'same' | 'old' }): RunResult {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alphascope-deploytest-'));
  try {
    const bin = path.join(tmp, 'bin');
    const app = path.join(tmp, 'alphascope');
    fs.mkdirSync(bin);
    fs.mkdirSync(app);
    fs.cpSync(DEPLOY_DIR, path.join(app, 'deploy'), { recursive: true });
    const fakes: Record<string, string> = {
      pm2: FAKE_PM2,
      git: FAKE_GIT,
      curl: FAKE_CURL,
      npm: fakeLogOnly('npm'),
      sudo: fakeLogOnly('sudo'),
      rsync: fakeLogOnly('rsync'),
      sleep: fakeLogOnly('sleep'),
    };
    for (const [name, body] of Object.entries(fakes)) {
      fs.writeFileSync(path.join(bin, name), body, { mode: 0o755 });
    }
    const repoScript = fs.readFileSync(path.join(DEPLOY_DIR, 'deploy.sh'), 'utf8');
    const homeDeployBefore = opts.homeDeploy === 'same' ? repoScript : '#!/bin/bash\n# 옛 배포 스크립트\npm2 restart all\n';
    const homeDeployPath = path.join(tmp, 'deploy.sh');
    fs.writeFileSync(homeDeployPath, homeDeployBefore, { mode: 0o755 });
    const logPath = path.join(tmp, 'calls.log');
    fs.writeFileSync(logPath, '');

    const r = spawnSync('/bin/bash', [path.join(app, 'deploy', 'deploy.sh')], {
      cwd: tmp,
      encoding: 'utf8',
      env: {
        // 가짜 명령이 맨 앞 · 진짜 pm2 가 있는 곳(/usr/local/bin · homebrew)은 넣지 않는다 · node 는 지금 쓰는 것
        PATH: [bin, path.dirname(process.execPath), '/usr/bin', '/bin'].join(':'),
        HOME: tmp,
        FAKE_LOG: logPath,
        FAKE_PM2_EXISTING: opts.existing.join(' '),
        LANG: 'en_US.UTF-8',
      },
      timeout: 30_000,
    });
    return {
      code: r.status,
      out: `${r.stdout}${r.stderr}`,
      log: fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean),
      homeDeploy: fs.readFileSync(homeDeployPath, 'utf8'),
      homeDeployBefore,
    };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const pm2Calls = (r: RunResult) => r.log.filter((l) => l.startsWith('pm2 '));
/** pm2 를 바꾸는 명령(조회 describe · jlist · status 를 뺀 것) */
const pm2Changes = (r: RunResult) => pm2Calls(r).filter((l) => !/^pm2 (describe|jlist|status|list|ls)\b/.test(l));
const ALL_RE = /\bpm2\s+(restart|stop|delete|reload|kill|start)\s+all\b|\bpm2\s+save\s+--force\b|\bpm2\s+kill\b/;

console.log('━━━ 0. 문법 · 이름 한 곳');
{
  const r = spawnSync('/bin/bash', ['-n', path.join(DEPLOY_DIR, 'deploy.sh')], { encoding: 'utf8' });
  check('bash -n deploy/deploy.sh 통과', r.status === 0, r.stderr);
  const require = createRequire(import.meta.url);
  const eco = require(path.join(DEPLOY_DIR, 'ecosystem.config.cjs')) as { apps: { name: string }[] };
  const ecoNames = eco.apps.map((a) => a.name);
  const m = fs.readFileSync(path.join(DEPLOY_DIR, 'deploy.sh'), 'utf8').match(/^PM2_APPS="([^"]*)"/m);
  check('deploy.sh 의 PM2_APPS = ecosystem.config.cjs 의 name 들', !!m && m[1].split(' ').join(',') === ecoNames.join(','), `PM2_APPS=${m?.[1]} · ecosystem=${ecoNames.join(' ')}`);
}

console.log('━━━ 1. 「모두」 pm2 명령 없음 · 두 이름만 다시 켬 (두 프로그램 다 있음 · ~/deploy.sh 같음)');
const a = runDeploy({ existing: APPS, homeDeploy: 'same' });
{
  check('끝까지 성공(종료 코드 0)', a.code === 0, a.out);
  for (const f of ['deploy.sh', 'switch-to-static.sh', 'rollback-to-vite.sh']) {
    const text = fs.readFileSync(path.join(DEPLOY_DIR, f), 'utf8').split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
    check(`${f} 에 「모두」 pm2 명령(restart all · stop all · delete all · save --force 등) 없음`, !ALL_RE.test(text));
  }
  check('실제로 받은 pm2 인자에 all 없음', !pm2Calls(a).some((l) => /\ball\b/.test(l)), pm2Calls(a).join(' | '));
  const changes = pm2Changes(a);
  check('pm2 를 바꾼 명령 = restart alphascope-api · restart alphascope-indicators 둘뿐', changes.join(',') === APPS.map((n) => `pm2 restart ${n}`).join(','), changes.join(' | '));
  check(`다른 프로젝트(${OTHER})는 어떤 pm2 명령에도 없음`, !pm2Calls(a).some((l) => l.includes(OTHER)));
}

console.log('━━━ 2. 하나가 pm2 에 없으면 그 이름만 켬');
{
  const b = runDeploy({ existing: ['alphascope-api'], homeDeploy: 'same' });
  const changes = pm2Changes(b);
  check('끝까지 성공(종료 코드 0)', b.code === 0, b.out);
  check('있는 api 는 restart · 없는 indicators 는 ecosystem 으로 그 이름만 start',
    changes.length === 2 && changes[0] === 'pm2 restart alphascope-api' && /^pm2 start \S*ecosystem\.config\.cjs --only alphascope-indicators$/.test(changes[1]),
    changes.join(' | '));
  check('없어서 켰다는 알림 줄', /알림: pm2 에 alphascope-indicators 이 없어 .*ecosystem\.config\.cjs 로 켭니다/.test(b.out), b.out);
  const c = runDeploy({ existing: [], homeDeploy: 'same' });
  const cChanges = pm2Changes(c);
  check('둘 다 없으면 두 이름만 하나씩 start(--only 없는 start 없음)',
    cChanges.length === 2 && cChanges.every((l, i) => new RegExp(`^pm2 start \\S*ecosystem\\.config\\.cjs --only ${APPS[i]}$`).test(l)),
    cChanges.join(' | '));
}

console.log('━━━ 3. 끝 확인 · pm2 상태는 AlphaScope 두 줄만');
{
  check('API(4000) 확인 줄', a.log.some((l) => l.includes('curl') && l.includes('127.0.0.1:4000/api/version')) && a.out.includes('API 응답: {"version":"v-test"}'), a.out);
  check('화면(80) 확인 줄 — Host 161.33.153.189', a.log.some((l) => l.includes('curl') && l.includes('Host: 161.33.153.189') && l.includes('http://127.0.0.1/')) && a.out.includes('화면 응답: 200'), a.out);
  check('pm2 상태에 AlphaScope 두 줄', APPS.every((n) => new RegExp(`^\\s+${n}  online`, 'm').test(a.out)), a.out);
  check(`출력에 다른 프로젝트 이름(${OTHER}) 없음`, !a.out.includes(OTHER), a.out);
  check('표 전체를 그리는 pm2 status · list 를 부르지 않음', !pm2Calls(a).some((l) => /^pm2 (status|list|ls)\b/.test(l)));
}

console.log('━━━ 4. 저장소 deploy.sh 가 ~/deploy.sh 와 다르면 안내만');
{
  const NOTICE = '배포 스크립트가 바뀌었습니다 — cp ~/alphascope/deploy/deploy.sh ~/deploy.sh';
  const d = runDeploy({ existing: APPS, homeDeploy: 'old' });
  check('끝까지 성공(종료 코드 0)', d.code === 0, d.out);
  check('안내 한 줄이 보임', d.out.includes(NOTICE), d.out);
  check('안내는 끝(「완료」 바로 앞)', /배포 스크립트가 바뀌었습니다[^\n]*\n완료: /.test(d.out));
  check('~/deploy.sh 는 덮어쓰지 않음', d.homeDeploy === d.homeDeployBefore);
  check('같으면 안내 없음', !a.out.includes('배포 스크립트가 바뀌었습니다'));
}

console.log('━━━ 5. 나머지 단계 그대로');
{
  const want: [string, RegExp][] = [
    ['받기 git pull --ff-only origin main', /^git pull --ff-only origin main$/],
    ['설치 npm install --no-audit --no-fund', /^npm install --no-audit --no-fund$/],
    ['빌드 npm run build', /^npm run build$/],
    ['화면 복사 rsync -a --delete dist/ /var/www/alphascope/', /^rsync -a --delete dist\/ \/var\/www\/alphascope\/$/],
    ['nginx 확인 sudo nginx -t', /^sudo nginx -t$/],
    ['nginx 다시 읽기 sudo systemctl reload nginx', /^sudo systemctl reload nginx$/],
  ];
  let last = -1;
  for (const [name, re] of want) {
    const i = a.log.findIndex((l) => re.test(l));
    check(`${name} (순서대로)`, i > last, a.log.join(' | '));
    if (i > last) last = i;
  }
  const firstPm2Change = a.log.findIndex((l) => /^pm2 (restart|start)\b/.test(l));
  check('pm2 재시작은 화면 복사 · nginx 다음', firstPm2Change > last);
  check('단계 표시 1/6 ~ 6/6', [1, 2, 3, 4, 5, 6].every((n) => a.out.includes(`━━━ ${n}/6`)));
}

console.log(`\n결과: 통과 ${pass} · 실패 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
