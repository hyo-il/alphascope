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
 * 6. 사람에게 보여 주는 안내 글에도 「모두」 명령 없음 · 7. nginx 는 8080 만 · Host $http_host · 문 번호 한 곳
 * 8. apply-nginx.sh — 백업 · 넣기 · nginx -t · reload · 화면 확인 · 되돌리기(가짜 sudo 는 cp 를 임시 nginx 폴더에서 진짜로 돌린다)
 * 9. upgrade-node24.sh — 설치 방식이 예상과 다르면 아무것도 바꾸지 않고 멈춤 · 어느 단계에서 실패해도 Node 22 · 옛 node_modules · 옛 화면으로
 *    되돌리고 다시 켬 · AlphaScope 두 이름만 멈추고 켬(가짜 apt-get · dpkg · node -v · /proc — 실제 apt · pm2 를 부르지 않는다)
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
  *http_code*) echo -n "\${FAKE_CURL_CODE:-200}" ;;
  *api/version*) echo '{"version":"v-test"}' ;;
esac
exit 0
`;
const fakeLogOnly = (name: string) => `#!/bin/bash\necho "${name} $*" >> "$FAKE_LOG"\nexit 0\n`;
/** sudo — 적고 나서 그대로 실행한다(cp 는 임시 nginx 폴더에서 진짜로 돈다 · nginx · systemctl 은 가짜) */
const FAKE_SUDO = `#!/bin/bash
echo "sudo $*" >> "$FAKE_LOG"
exec "$@"
`;
/** nginx — -t 는 FAKE_NGINX_T_FAIL_FIRST=1 이면 처음 한 번만 실패(되돌린 뒤 검사는 통과) */
const FAKE_NGINX = `#!/bin/bash
echo "nginx $*" >> "$FAKE_LOG"
if [ "$1" = "-t" ] && [ "$FAKE_NGINX_T_FAIL_FIRST" = "1" ] && [ ! -f "$FAKE_LOG.tfail" ]; then
  touch "$FAKE_LOG.tfail"; echo "nginx: [emerg] 시험용 실패" >&2; exit 1
fi
exit 0
`;

/** 가짜 명령을 bin 폴더에 쓴다 */
function writeFakes(bin: string): void {
  const fakes: Record<string, string> = {
    pm2: FAKE_PM2,
    git: FAKE_GIT,
    curl: FAKE_CURL,
    sudo: FAKE_SUDO,
    nginx: FAKE_NGINX,
    npm: fakeLogOnly('npm'),
    rsync: fakeLogOnly('rsync'),
    sleep: fakeLogOnly('sleep'),
    systemctl: fakeLogOnly('systemctl'),
  };
  for (const [name, body] of Object.entries(fakes)) {
    fs.writeFileSync(path.join(bin, name), body, { mode: 0o755 });
  }
}
/** 가짜 명령이 맨 앞 · 진짜 pm2 · nginx 가 있는 곳(/usr/local/bin · homebrew)은 넣지 않는다 · node 는 지금 쓰는 것 */
const testPath = (bin: string) => [bin, path.dirname(process.execPath), '/usr/bin', '/bin'].join(':');

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
    writeFakes(bin);
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
        PATH: testPath(bin),
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
  for (const f of ['deploy.sh', 'upgrade-node24.sh']) {
    const m = fs.readFileSync(path.join(DEPLOY_DIR, f), 'utf8').match(/^PM2_APPS="([^"]*)"/m);
    check(`${f} 의 PM2_APPS = ecosystem.config.cjs 의 name 들`, !!m && m[1].split(' ').join(',') === ecoNames.join(','), `PM2_APPS=${m?.[1]} · ecosystem=${ecoNames.join(' ')}`);
  }
}

console.log('━━━ 1. 「모두」 pm2 명령 없음 · 두 이름만 다시 켬 (두 프로그램 다 있음 · ~/deploy.sh 같음)');
const a = runDeploy({ existing: APPS, homeDeploy: 'same' });
{
  check('끝까지 성공(종료 코드 0)', a.code === 0, a.out);
  for (const f of ['deploy.sh', 'switch-to-static.sh', 'rollback-to-vite.sh', 'upgrade-node24.sh']) {
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
  check('화면(8080) 확인 줄 — Host 161.33.153.189:8080 · http://127.0.0.1:8080/', a.log.some((l) => l.includes('curl') && l.includes('Host: 161.33.153.189:8080') && l.includes('http://127.0.0.1:8080/')) && a.out.includes('화면 응답: 200'), a.out);
  check('80번(http://127.0.0.1/)으로 묻지 않음', !a.log.some((l) => l.includes('curl') && /http:\/\/127\.0\.0\.1\//.test(l)), a.log.filter((l) => l.startsWith('curl')).join(' | '));
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

console.log('━━━ 6. 사람에게 보여 주는 안내에도 「모두」 pm2 명령 없음');
{
  /** src · server · scripts · deploy 의 글 파일 — 이 시험 파일(옛 스크립트 · 금지 검사 글)은 뺀다 */
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name !== 'node_modules' && e.name !== 'fixtures') walk(p);
      } else if (/\.(ts|tsx|js|cjs|mjs|sh|md|html|json)$/.test(e.name) && p !== fileURLToPath(import.meta.url)) {
        files.push(p);
      }
    }
  };
  for (const d of ['src', 'server', 'scripts', 'deploy']) walk(path.join(root, d));
  const hits = files.filter((f) => ALL_RE.test(fs.readFileSync(f, 'utf8').replace(/&amp;/g, '&')));
  // deploy/README.md 는 「restart all 같은 「모두」 명령은 쓰지 않는다」 를 설명하는 글이라 뺀다
  const bad = hits.filter((f) => path.relative(root, f) !== path.join('deploy', 'README.md'));
  check(`src · server · scripts · deploy 에 pm2 「모두」 명령 글 없음(${files.length}개 파일)`, bad.length === 0, bad.map((f) => path.relative(root, f)).join(', '));
  const banner = fs.readFileSync(path.join(root, 'src/components/common/VersionMismatchBanner.tsx'), 'utf8');
  check('버전 배너 오라클 안내 = ~/deploy.sh 한 줄(git pull · npm run build 글 없음)',
    /오라클:[\s\S]*?<code[^>]*>~\/deploy\.sh<\/code>/.test(banner) && !/git pull|npm run build|npm install/.test(banner));
  check('버전 배너 맥 안내(start.command 다시 실행)는 그대로', /맥: 실행 창을 닫고 <code[^>]*>start\.command<\/code> 를\s*다시 실행/.test(banner));
}

console.log('━━━ 7. 8080 — nginx 설정 · 문 번호 한 곳');
const NGINX_CONF = fs.readFileSync(path.join(DEPLOY_DIR, 'nginx-alphascope.conf'), 'utf8');
const portOf = (f: string) => fs.readFileSync(path.join(DEPLOY_DIR, f), 'utf8').match(/^PUBLIC_PORT=(\d+)/m)?.[1];
{
  const listens = [...NGINX_CONF.matchAll(/^\s*listen\s+([^;]+);/gm)].map((m) => m[1].trim());
  check('nginx 설정은 8080 만 듣는다(listen 80 없음)', listens.join(',') === '8080', listens.join(','));
  check('/api/ 로 넘길 때 Host $http_host(문 번호 포함) · $host 없음', /proxy_set_header\s+Host\s+\$http_host;/.test(NGINX_CONF) && !/proxy_set_header\s+Host\s+\$host;/.test(NGINX_CONF));
  for (const f of ['deploy.sh', 'apply-nginx.sh', 'switch-to-static.sh', 'upgrade-node24.sh']) {
    check(`${f} 의 PUBLIC_PORT = nginx listen(${listens[0]})`, portOf(f) === listens[0], `PUBLIC_PORT=${portOf(f)}`);
  }
  check('bash -n deploy/apply-nginx.sh 통과', spawnSync('/bin/bash', ['-n', path.join(DEPLOY_DIR, 'apply-nginx.sh')]).status === 0);
}

console.log('━━━ 8. apply-nginx.sh — 백업 · 넣기 · 검사 · 적용 · 확인 · 되돌리기');
const OLD_CONF = 'server { listen 80; # 옛 설정 }\n';
interface ApplyResult {
  code: number | null;
  out: string;
  log: string[];
  avail: string;
  enabled: string;
  enabledIsLink: boolean;
  availFiles: string[];
  enabledFiles: string[];
  /** 백업 파일 이름 → 내용 */
  backups: Record<string, string>;
}
/** apply-nginx.sh 를 임시 HOME · 임시 nginx 폴더에서 돌린다 */
function runApply(opts: { enabled: 'link' | 'file'; tFail?: boolean; curlCode?: string }): ApplyResult {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alphascope-deploytest-'));
  try {
    const bin = path.join(tmp, 'bin');
    const app = path.join(tmp, 'alphascope');
    const ngx = path.join(tmp, 'nginx');
    fs.mkdirSync(bin);
    fs.mkdirSync(app);
    fs.mkdirSync(path.join(ngx, 'sites-available'), { recursive: true });
    fs.mkdirSync(path.join(ngx, 'sites-enabled'));
    fs.cpSync(DEPLOY_DIR, path.join(app, 'deploy'), { recursive: true });
    writeFakes(bin);
    const avail = path.join(ngx, 'sites-available', 'alphascope');
    const enabled = path.join(ngx, 'sites-enabled', 'alphascope');
    fs.writeFileSync(avail, OLD_CONF);
    if (opts.enabled === 'link') fs.symlinkSync(avail, enabled);
    else fs.writeFileSync(enabled, OLD_CONF);
    const logPath = path.join(tmp, 'calls.log');
    fs.writeFileSync(logPath, '');
    const r = spawnSync('/bin/bash', [path.join(app, 'deploy', 'apply-nginx.sh')], {
      cwd: tmp,
      encoding: 'utf8',
      env: {
        PATH: testPath(bin),
        HOME: tmp,
        NGINX_DIR: ngx,
        FAKE_LOG: logPath,
        FAKE_NGINX_T_FAIL_FIRST: opts.tFail ? '1' : '0',
        FAKE_CURL_CODE: opts.curlCode ?? '200',
        LANG: 'en_US.UTF-8',
      },
      timeout: 30_000,
    });
    return {
      code: r.status,
      out: `${r.stdout}${r.stderr}`,
      log: fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean),
      avail: fs.readFileSync(avail, 'utf8'),
      enabled: fs.readFileSync(enabled, 'utf8'),
      enabledIsLink: fs.lstatSync(enabled).isSymbolicLink(),
      availFiles: fs.readdirSync(path.join(ngx, 'sites-available')).sort(),
      enabledFiles: fs.readdirSync(path.join(ngx, 'sites-enabled')).sort(),
      backups: Object.fromEntries(fs.readdirSync(path.join(ngx, 'sites-available')).filter((f) => f.includes('.backup-')).map((f) => [f, fs.readFileSync(path.join(ngx, 'sites-available', f), 'utf8')])),
    };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
{
  const BACKUP_RE = /^alphascope\.backup-\d{8}-\d{6}$/;
  const idx = (r: ApplyResult, re: RegExp) => r.log.findIndex((l) => re.test(l));
  // 성공(sites-enabled 가 링크)
  const ok = runApply({ enabled: 'link' });
  check('성공 — 종료 코드 0', ok.code === 0, ok.out);
  check('성공 — ① 백업은 sites-available 안 · 이름에 날짜 · 옛 설정 그대로 · sites-enabled 에는 alphascope 하나뿐',
    Object.entries(ok.backups).some(([f, c]) => BACKUP_RE.test(f) && c === OLD_CONF) && ok.enabledFiles.join(',') === 'alphascope', `${ok.availFiles.join(',')} / ${ok.enabledFiles.join(',')}`);
  check('성공 — ② 새 설정이 sites-available 에 들어감 · 링크는 링크 그대로', ok.avail === NGINX_CONF && ok.enabledIsLink);
  const order = [/^sudo cp .*sites-available\/alphascope .*\.backup-/, /^sudo cp deploy\/nginx-alphascope\.conf .*sites-available\/alphascope$/, /^nginx -t$/, /^systemctl reload nginx$/, /^curl .*Host: 161\.33\.153\.189:8080.* http:\/\/127\.0\.0\.1:8080\/$/, /^curl .*Host: 161\.33\.153\.189:8080.* http:\/\/127\.0\.0\.1:8080\/api\/version$/];
  const pos = order.map((re) => idx(ok, re));
  check('성공 — 순서 ① 백업 → ② 넣기 → ③ nginx -t → ④ reload → ⑤ 화면 · /api/version(Host :8080)', pos.every((p, i) => p >= 0 && (i === 0 || p > pos[i - 1])), `${pos.join(',')} :: ${ok.log.join(' | ')}`);
  check('성공 — ⑥ 「AlphaScope 주소: http://161.33.153.189:8080」', ok.out.includes('AlphaScope 주소: http://161.33.153.189:8080'), ok.out);
  // 성공(sites-enabled 가 따로 복사된 파일)
  const okFile = runApply({ enabled: 'file' });
  check('성공(sites-enabled 가 파일) — 거기도 새 설정 · 그 백업도 sites-available 안',
    okFile.code === 0 && okFile.enabled === NGINX_CONF && !okFile.enabledIsLink && Object.entries(okFile.backups).some(([f, c]) => /^alphascope-enabled-file\.backup-\d{8}-\d{6}$/.test(f) && c === OLD_CONF) && okFile.enabledFiles.join(',') === 'alphascope',
    `${okFile.code} · ${okFile.availFiles.join(',')}`);
  // nginx -t 실패
  const tf = runApply({ enabled: 'file', tFail: true });
  check('nginx -t 실패 — 멈춤(종료 코드 ≠ 0)', tf.code !== 0 && tf.code !== null);
  check('nginx -t 실패 — 두 곳 모두 옛 설정으로 되돌림', tf.avail === OLD_CONF && tf.enabled === OLD_CONF, `${JSON.stringify(tf.avail.slice(0, 40))} / ${JSON.stringify(tf.enabled.slice(0, 40))}`);
  check('nginx -t 실패 — 새 설정으로 reload 하지 않음 · 화면 확인 안 함(되돌린 뒤 reload 만 한 번)',
    tf.log.filter((l) => l === 'systemctl reload nginx').length === 1 && !tf.log.some((l) => l.startsWith('curl')) && tf.out.includes('되돌립니다'), tf.log.join(' | '));
  check('nginx -t 실패 — 주소 알림 없음', !tf.out.includes('AlphaScope 주소:'));
  // 화면 확인 실패
  const sf = runApply({ enabled: 'link', curlCode: '502' });
  check('화면 확인 실패(502) — 멈춤 · 옛 설정으로 되돌림 · 다시 reload', sf.code !== 0 && sf.code !== null && sf.avail === OLD_CONF && sf.enabledIsLink && sf.log.filter((l) => l === 'systemctl reload nginx').length === 2, `${sf.code} :: ${sf.log.join(' | ')}`);
  check('화면 확인 실패 — 주소 알림 없음', !sf.out.includes('AlphaScope 주소:'));
}

console.log('━━━ 9. upgrade-node24.sh — 멈춤 · 되돌리기 · 두 이름만 (가짜 apt-get · dpkg · node -v · /proc)');
const OLD_PKG = '22.23.4-1nodesource1';
const OLD_SRC = 'Types: deb\nURIs: https://deb.nodesource.com/node_22.x\nSuites: nodistro\n';
const OLD_PREF = 'Package: nodejs\nPin: origin deb.nodesource.com\nPin-Priority: 600\n# 옛것\n';
/** 상태 파일($FAKE_STATE/node_v · pkg)로 「설치된 Node」 를 흉내 낸다 */
const UP_FAKES: Record<string, string> = {
  node: `#!/bin/bash
echo "node $*" >> "$FAKE_LOG"
if [ "$1" = "-v" ]; then cat "$FAKE_STATE/node_v"; exit 0; fi
exec "$REAL_NODE" "$@"
`,
  npm: `#!/bin/bash
echo "npm $*" >> "$FAKE_LOG"
case "$1" in
  -v) echo "11.19.1" ;;
  ci)
    [ "\${FAKE_NPM_CI_FAIL:-0}" = "1" ] && { echo "npm error 시험용 실패" >&2; exit 1; }
    mkdir -p node_modules/better-sqlite3 node_modules/.bin
    echo 'module.exports = class { prepare() { return { get: () => 1 }; } };' > node_modules/better-sqlite3/index.js
    printf '#!/bin/bash\\n' > node_modules/.bin/tsx && chmod +x node_modules/.bin/tsx
    echo node24 > node_modules/MARK ;;
  run)
    [ "\${FAKE_BUILD_FAIL:-0}" = "1" ] && exit 1
    mkdir -p dist && echo new > dist/index.html ;;
esac
exit 0
`,
  pm2: `#!/bin/bash
echo "pm2 $*" >> "$FAKE_LOG"
case "$1" in
  -v) echo "6.0.8" ;;
  describe) case "$2" in alphascope-api|alphascope-indicators) exit 0 ;; *) exit 1 ;; esac ;;
  jlist) echo '[{"name":"alphascope-api","pm2_env":{"status":"online","restart_time":1}},{"name":"alphascope-indicators","pm2_env":{"status":"online","restart_time":1}},{"name":"${OTHER}","pm2_env":{"status":"online","restart_time":0}}]' ;;
  pid) echo 4242 ;;
  # 다시 켤 때 새 로그 줄을 쌓는다(옛 줄은 runUpgrade 가 미리 넣어 둔다 — 그 줄로 되돌리면 안 된다)
  restart) [ "$2" = "alphascope-api" ] && echo "\${FAKE_PM2_LOGS:-[api] 서버 시작}" >> "$HOME/.pm2/logs/alphascope-api-error.log" ;;
esac
exit 0
`,
  git: `#!/bin/bash\necho "git $*" >> "$FAKE_LOG"\n[ "$1" = "rev-parse" ] && echo abc1234\nexit 0\n`,
  dpkg: `#!/bin/bash
echo "dpkg $*" >> "$FAKE_LOG"
case "$1" in
  -S) echo "\${FAKE_DPKG_OWNER:-nodejs}: $2" ;;
  --print-architecture) echo arm64 ;;
  -i) echo v22.23.4 > "$FAKE_STATE/node_v"; echo "${OLD_PKG}" > "$FAKE_STATE/pkg" ;;
esac
exit 0
`,
  'dpkg-query': `#!/bin/bash\necho "dpkg-query $*" >> "$FAKE_LOG"\ncat "$FAKE_STATE/pkg"\n`,
  'apt-get': `#!/bin/bash
echo "apt-get $*" >> "$FAKE_LOG"
case "$1" in
  download) V="\${2#nodejs=}"; touch "nodejs_\${V}_arm64.deb" ;;
  install)
    [ "\${FAKE_APT_INSTALL_FAIL:-0}" = "1" ] && { echo "E: 시험용 실패" >&2; exit 100; }
    echo v24.22.1 > "$FAKE_STATE/node_v"; echo "\${4#nodejs=}" > "$FAKE_STATE/pkg" ;;
esac
exit 0
`,
  // sudo — 적고 나서 그대로 실행(-E 는 떼고)
  sudo: `#!/bin/bash\necho "sudo $*" >> "$FAKE_LOG"\n[ "$1" = "-E" ] && shift\nexec "$@"\n`,
  curl: `#!/bin/bash
echo "curl $*" >> "$FAKE_LOG"
OUT=""; prev=""
for a in "$@"; do [ "$prev" = "-o" ] && OUT="$a"; prev="$a"; done
case "$*" in
  *setup_24.x*)
    # 받은 「설치 스크립트」 — 진짜 nodesource 처럼 저장소 설정을 24 로 바꾼다
    printf '#!/bin/bash\\nrm -f "$APT_DIR/sources.list.d/nodesource.list" "$APT_DIR/sources.list.d/nodesource.sources"\\nprintf "URIs: https://deb.nodesource.com/node_24.x\\\\n" > "$APT_DIR/sources.list.d/nodesource.sources"\\nprintf "new pref\\\\n" > "$APT_DIR/preferences.d/nodejs"\\n' > "$OUT"
    exit 0 ;;
  *http_code*127.0.0.1:4000*)
    if [ -n "\${FAKE_API_FAIL_WITH:-}" ] && grep -q "$FAKE_API_FAIL_WITH" "$HOME/alphascope/node_modules/MARK" 2>/dev/null; then echo -n 000; else echo -n 200; fi ;;
  *http_code*) echo -n "\${FAKE_CODE_8080:-200}" ;;
esac
exit 0
`,
  nginx: fakeLogOnly('nginx'),
  systemctl: fakeLogOnly('systemctl'),
  sleep: fakeLogOnly('sleep'),
  df: `#!/bin/bash\necho "Filesystem 1024-blocks Used Available Capacity Mounted"\necho "/dev/sda1 100000000 1000000 50000000 2% /"\n`,
};
interface UpResult {
  code: number | null;
  out: string;
  log: string[];
  nodeV: string;
  mark: string;
  web: string;
  src: string;
  pref: string;
  backups: string[];
  backupFiles: string[];
}
function runUpgrade(env: Record<string, string> = {}, setup: { pkg?: string; nodeV?: string } = {}): UpResult {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alphascope-deploytest-'));
  try {
    const bin = path.join(tmp, 'bin');
    const app = path.join(tmp, 'alphascope');
    const state = path.join(tmp, 'state');
    const apt = path.join(tmp, 'apt');
    const keyrings = path.join(tmp, 'keyrings');
    const web = path.join(tmp, 'www');
    const proc = path.join(tmp, 'proc', '4242');
    for (const d of [bin, state, path.join(apt, 'sources.list.d'), path.join(apt, 'preferences.d'), keyrings, web, proc, path.join(app, 'db'), path.join(app, 'node_modules'), path.join(tmp, '.pm2')]) fs.mkdirSync(d, { recursive: true });
    fs.cpSync(DEPLOY_DIR, path.join(app, 'deploy'), { recursive: true });
    for (const [name, body] of Object.entries(UP_FAKES)) fs.writeFileSync(path.join(bin, name), body, { mode: 0o755 });
    // pm2 는 전역 npm 자리(…/lib/node_modules/pm2/…)에 두고 bin 에서 링크
    const pm2Real = path.join(tmp, 'lib', 'node_modules', 'pm2', 'bin', 'pm2');
    fs.mkdirSync(path.dirname(pm2Real), { recursive: true });
    fs.renameSync(path.join(bin, 'pm2'), pm2Real);
    fs.symlinkSync(pm2Real, path.join(bin, 'pm2'));
    fs.writeFileSync(path.join(state, 'node_v'), `${setup.nodeV ?? 'v22.23.4'}\n`);
    fs.writeFileSync(path.join(state, 'pkg'), `${setup.pkg ?? OLD_PKG}\n`);
    fs.writeFileSync(path.join(proc, 'exe'), env.FAKE_RUN_V ? `#!/bin/bash\necho ${env.FAKE_RUN_V}\n` : `#!/bin/bash\ncat "${state}/node_v"\n`, { mode: 0o755 });
    fs.writeFileSync(path.join(apt, 'sources.list.d', 'nodesource.sources'), OLD_SRC);
    fs.writeFileSync(path.join(apt, 'preferences.d', 'nodejs'), OLD_PREF);
    fs.writeFileSync(path.join(keyrings, 'nodesource.gpg'), 'oldkey');
    fs.writeFileSync(path.join(app, 'package.json'), '{}');
    fs.writeFileSync(path.join(app, 'package-lock.json'), '{}');
    fs.writeFileSync(path.join(app, '.env'), 'AUTO_TRADING_ENABLED=true\n');
    fs.writeFileSync(path.join(app, 'db', 'alphascope.db'), 'db');
    fs.writeFileSync(path.join(app, 'db', 'alphascope.db-wal'), 'wal');
    fs.writeFileSync(path.join(app, 'node_modules', 'MARK'), 'node22\n');
    fs.writeFileSync(path.join(web, 'index.html'), 'old\n');
    fs.writeFileSync(path.join(tmp, '.pm2', 'dump.pm2'), '[]');
    fs.mkdirSync(path.join(tmp, '.pm2', 'logs'));
    fs.writeFileSync(path.join(tmp, '.pm2', 'logs', 'alphascope-api-error.log'), 'Error: Cannot find module (지난달 옛 줄)\n');
    const logPath = path.join(tmp, 'calls.log');
    fs.writeFileSync(logPath, '');
    const r = spawnSync('/bin/bash', [path.join(app, 'deploy', 'upgrade-node24.sh')], {
      cwd: tmp,
      encoding: 'utf8',
      env: {
        PATH: testPath(bin),
        HOME: tmp,
        FAKE_LOG: logPath,
        FAKE_STATE: state,
        REAL_NODE: process.execPath,
        WEB_DIR: web,
        APT_DIR: apt,
        KEYRING_DIRS: keyrings,
        PROC_DIR: path.join(tmp, 'proc'),
        NODE_BIN_EXPECTED: env.NODE_BIN_EXPECTED ?? path.join(bin, 'node'),
        LANG: 'en_US.UTF-8',
        ...env,
      },
      timeout: 60_000,
    });
    const backups = fs.readdirSync(tmp).filter((f) => f.startsWith('alphascope-node24-backup-'));
    const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() && e.name !== 'node_modules.node22' && e.name !== 'node_modules.node24-failed' && e.name !== 'stage' ? walk(path.join(d, e.name)) : [path.relative(path.join(tmp, backups[0] ?? ''), path.join(d, e.name))]));
    return {
      code: r.status,
      out: `${r.stdout}${r.stderr}`,
      log: fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean),
      nodeV: fs.readFileSync(path.join(state, 'node_v'), 'utf8').trim(),
      mark: fs.readFileSync(path.join(app, 'node_modules', 'MARK'), 'utf8').trim(),
      web: fs.readFileSync(path.join(web, 'index.html'), 'utf8').trim(),
      src: fs.readFileSync(path.join(apt, 'sources.list.d', 'nodesource.sources'), 'utf8'),
      pref: fs.readFileSync(path.join(apt, 'preferences.d', 'nodejs'), 'utf8'),
      backups,
      backupFiles: backups[0] ? walk(path.join(tmp, backups[0])) : [],
    };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
{
  check('bash -n deploy/upgrade-node24.sh 통과', spawnSync('/bin/bash', ['-n', path.join(DEPLOY_DIR, 'upgrade-node24.sh')]).status === 0);
  const upPm2Changes = (r: UpResult) => r.log.filter((l) => /^pm2 (stop|restart|start|delete|reload|kill|update|resurrect)\b/.test(l));
  const changedSystem = (r: UpResult) => r.log.filter((l) => /^(sudo|apt-get install|dpkg -i|pm2 (stop|restart|start|save|update|delete|kill))\b/.test(l));
  const at = (r: UpResult, re: RegExp) => r.log.findIndex((l) => re.test(l));

  // 성공
  const ok = runUpgrade();
  check('[성공] 종료 코드 0 · 끝에 「완료 — Node 24 … 서버 켜짐 · 오류 없음」', ok.code === 0 && /완료 — Node 24 \(v24\.22\.1\) · 서버 켜짐 · 오류 없음/.test(ok.out), ok.out);
  check('[성공] Node 24 · 새 node_modules · 새 화면', ok.nodeV === 'v24.22.1' && ok.mark === 'node24' && ok.web === 'new', `${ok.nodeV} · ${ok.mark} · ${ok.web}`);
  check('[성공] 백업 — Node 22 패키지 · apt 설정 · DB(+wal) · pm2 목록 · 옛 화면', ['nodejs_22.23.4-1nodesource1_arm64.deb', 'apt/nodesource.sources', 'apt/nodejs', 'db/alphascope.db', 'db/alphascope.db-wal', 'dump.pm2', 'web/index.html', 'info.txt'].every((f) => ok.backupFiles.includes(f)), ok.backupFiles.join(', '));
  const changes = upPm2Changes(ok);
  check('[성공] pm2 를 바꾼 명령 = AlphaScope 두 이름 stop → restart 뿐', changes.join(',') === [...APPS.map((n) => `pm2 stop ${n}`), ...APPS.map((n) => `pm2 restart ${n}`)].join(','), changes.join(' | '));
  check(`[성공] 다른 프로젝트(${OTHER}) · all · pm2 update 없음`, !ok.log.some((l) => l.startsWith('pm2 ') && (l.includes(OTHER) || /\ball\b/.test(l) || /^pm2 update/.test(l))), ok.log.filter((l) => l.startsWith('pm2')).join(' | '));
  check('[성공] nginx 설정 파일은 건드리지 않음(nginx -t · reload 만)', !ok.log.some((l) => /sites-(available|enabled)/.test(l)));
  const order = [/^apt-get download nodejs=22\.23\.4-1nodesource1$/, /^curl -fsSL https:\/\/deb\.nodesource\.com\/setup_24\.x -o /, /^pm2 save$/, /^sudo -E bash .*nodesource_setup_24\.sh$/, /^sudo apt-get install -y --allow-downgrades nodejs=24\.22\.1-1nodesource1$/, /^npm ci --no-audit --no-fund$/, /^pm2 stop alphascope-api$/, /^pm2 restart alphascope-api$/, /^curl .*127\.0\.0\.1:4000\/api\/version/, /^npm run build$/, /^sudo nginx -t$/, /^sudo systemctl reload nginx$/, /^curl .*Host: 161\.33\.153\.189:8080.* http:\/\/127\.0\.0\.1:8080\/$/];
  const pos = order.map((re) => at(ok, re));
  check('[성공] 순서 — 되돌리기 준비(패키지 · 설치 스크립트 · pm2 save) → Node 24 → npm ci(켠 채로) → 멈춤 → 다시 켬 → API → 빌드 → nginx → 8080', pos.every((p, i) => p >= 0 && (i === 0 || p > pos[i - 1])), `${pos.join(',')} :: ${ok.log.join(' | ')}`);
  check('[성공] npm ci 는 서버를 멈추기 전(옆 폴더) — 멈춘 뒤에는 설치 · 빌드 없음', at(ok, /^npm ci/) < at(ok, /^pm2 stop/) && !ok.log.slice(at(ok, /^pm2 stop/), at(ok, /^pm2 restart alphascope-indicators$/)).some((l) => /^npm (ci|install)/.test(l)));
  check('[성공] 돌고 있는 alphascope-api 의 node 를 확인(/proc/<pid>/exe -v)', /alphascope-api 가 쓰는 node: v24\.22\.1/.test(ok.out), ok.out);
  check('[성공] 다시 켜기 전의 옛 오류 줄(Cannot find module)로는 되돌리지 않음 · 새 줄만 봄', /pm2 로그\(다시 켠 뒤 1줄\): 네이티브 부품 · 모듈 오류 없음/.test(ok.out), ok.out);
  check('[성공] 스위치(.env) 그대로 확인 · 멈춘 시간 출력', ok.out.includes('스위치(.env) 그대로') && /멈춘 시간 약 \d+초/.test(ok.out), ok.out);

  // 설치 방식이 예상과 다르면 아무것도 바꾸지 않고 멈춤
  const cases: [string, UpResult][] = [
    ['nodejs 가 nodesource 가 아님(우분투 기본 패키지)', runUpgrade({}, { pkg: '22.3.0-1ubuntu1' })],
    ['node 위치가 다름(nvm 등)', runUpgrade({ NODE_BIN_EXPECTED: '/usr/bin/node' })],
    ['/usr/bin/node 가 nodejs 패키지 것이 아님', runUpgrade({ FAKE_DPKG_OWNER: 'nsolid' })],
    ['node 가 22 가 아님(20)', runUpgrade({}, { nodeV: 'v20.18.0' })],
  ];
  for (const [name, r] of cases) {
    check(`[멈춤] ${name} — 종료 코드 1 · sudo · apt · dpkg -i · pm2 바꾸는 명령 0 · 백업 폴더 없음 · 그대로`,
      r.code === 1 && changedSystem(r).length === 0 && r.backups.length === 0 && r.nodeV.startsWith(name.includes('20') ? 'v20' : 'v22') && r.mark === 'node22' && r.web === 'old' && r.src === OLD_SRC && r.out.includes('아무것도 바꾸지 않고 멈춥니다'),
      `${r.code} · ${changedSystem(r).join(' | ')} · ${r.backups.join(',')} :: ${r.out.slice(-300)}`);
  }
  const already = runUpgrade({}, { nodeV: 'v24.22.1', pkg: '24.22.1-1nodesource1' });
  check('[멈춤] 이미 Node 24 — 종료 코드 0 · 아무것도 바꾸지 않음', already.code === 0 && changedSystem(already).length === 0 && already.backups.length === 0 && already.out.includes('이미 Node 24'), already.out);

  // 어느 단계에서 실패해도 되돌림
  const back = (r: UpResult) => r.code === 1 && r.nodeV === 'v22.23.4' && r.mark === 'node22' && r.web === 'old' && r.src === OLD_SRC && r.pref === OLD_PREF && r.log.some((l) => /^sudo dpkg -i .*nodejs_22\.23\.4-1nodesource1_arm64\.deb$/.test(l)) && r.out.includes('되돌렸습니다');
  const fails: [string, UpResult, boolean][] = [
    ['Node 24 설치 실패(apt)', runUpgrade({ FAKE_APT_INSTALL_FAIL: '1' }), false],
    ['npm ci 실패', runUpgrade({ FAKE_NPM_CI_FAIL: '1' }), false],
    ['바꿔 끼운 뒤 API 가 응답하지 않음', runUpgrade({ FAKE_API_FAIL_WITH: 'node24' }), true],
    ['다시 켠 api 가 옛 Node 로 돎(/proc)', runUpgrade({ FAKE_RUN_V: 'v22.23.4' }), true],
    ['pm2 로그에 NODE_MODULE_VERSION 오류', runUpgrade({ FAKE_PM2_LOGS: 'Error: was compiled against a different Node.js version using NODE_MODULE_VERSION 127' }), true],
    ['빌드 실패', runUpgrade({ FAKE_BUILD_FAIL: '1' }), true],
    ['8080 화면 확인 실패(502)', runUpgrade({ FAKE_CODE_8080: '502' }), true],
  ];
  for (const [name, r, stopped] of fails) {
    const ch = upPm2Changes(r);
    const want = stopped
      ? [...APPS.map((n) => `pm2 stop ${n}`), ...APPS.map((n) => `pm2 restart ${n}`), ...APPS.map((n) => `pm2 stop ${n}`), ...APPS.map((n) => `pm2 restart ${n}`)]
      : [];
    check(`[되돌림] ${name} — 종료 코드 1 · Node 22 · 옛 node_modules · 옛 화면 · apt 설정 옛것 · ${stopped ? '두 이름만 다시 켬' : '서버는 멈추지 않음'}`,
      back(r) && ch.join(',') === want.join(',') && !r.log.some((l) => l.startsWith('pm2 ') && l.includes(OTHER)),
      `${r.code} · ${r.nodeV} · ${r.mark} · ${r.web} · ${ch.join(' | ')} :: ${r.out.slice(-400)}`);
  }
  check('[되돌림] 되돌린 뒤 API 확인 줄', /AlphaScope 두 프로그램을 다시 켰습니다 — API 응답 200/.test(fails[2][1].out), fails[2][1].out);
}

console.log(`\n결과: 통과 ${pass} · 실패 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
