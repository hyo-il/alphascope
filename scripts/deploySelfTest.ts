/**
 * 오라클 배포 스크립트 점검 — `npm run deploy:test` · ⚠️ `DB_PATH=<사본>` 으로만 돈다(맨 첫 import · DB 는 쓰지 않는다).
 *
 * 실제 pm2 · 서버 없이 `deploy/deploy.sh` 를 임시 폴더(가짜 HOME)에서 돌린다.
 * PATH 맨 앞에 가짜 `pm2` · `git` · `npm` · `sudo` · `rsync` · `curl` · `sleep` 을 두어 받은 인자를 기록 파일에 적고,
 * 같은 서버에 다른 프로젝트(`other-project`)가 pm2 에 떠 있다고 꾸며 확인한다.
 * 1. pm2 에 「모두」 명령이 없고 AlphaScope 두 이름만 다시 켠다(배포 스크립트 글도 검사)
 * 2. 하나가 pm2 에 없으면 ecosystem 으로 그 이름만 켜고 알린다
 * 3. 끝의 API · 화면 확인이 있고, pm2 상태는 AlphaScope 두 줄만 보인다
 * 4. 저장소의 deploy.sh 가 ~/deploy.sh 와 다르면 덮어쓰지 않고 안내 한 줄
 * 5. 받기 · 설치 · 빌드 · 화면 복사 · nginx 확인은 그대로
 * 6. 사람에게 보여 주는 안내 글에도 「모두」 명령 없음
 * 7. nginx(v2.61.2) — 8080 ssl 하나 + 같은 문 http → https(error_page 497) · 443 블록 없음 · 80 은 확인 경로만 · 나머지 444 · Host $http_host · 문 번호 한 곳
 * 8. apply-nginx.sh — 멈춤(인증서 · 80 설정 없음 · 다른 설정 · 프로그램이 443) · 백업 · 넣기(두 설정) · nginx -t · reload · 확인 6가지 · 갱신 연습
 *    · iptables 443 지움 · 실패하면 두 설정 되돌리고 예전 주소 확인 · 8081(project2) · default 는 건드리지 않음(가짜 sudo 는 cp 를 임시 nginx 폴더에서 진짜로 돌린다)
 * 10. setup-https.sh(v2.61.1 · v2.61.2 8080) — 상태가 예상과 다르면 아무것도 바꾸지 않고 멈춤 · 순서(Certbot → iptables 80 → 80 확인 경로 → 연습 → 인증서 → 새 nginx · 갱신 연습 → 타이머)
 *     · 어느 단계에서 실패해도 nginx · iptables · 인증서 · Certbot 을 전으로 되돌리고 8080 확인 · 8081(project2)은 건드리지 않음
 *     (가짜 snap · certbot · iptables · netfilter-persistent · ss · nginx · systemctl · curl · openssl — 실제 apt · certbot · nginx · iptables 를 부르지 않는다)
 * 11. check-https.sh — 남은 기간 한 줄 · 48시간 경고 · https 문(8080) 응답 없음
 * 12. 자리 한 곳(v2.61.3 deploy/paths.sh) — 모든 배포 스크립트가 같은 APP_DIR · 박힌 옛 경로(~/alphascope · /home/ubuntu) 없음
 * 13. ecosystem.config.cjs — 다른 자리에 두어도 cwd · venv 경로가 그 자리를 따라감
 * 14. backup-db.sh — 서버가 연 WAL DB 에서도 온전한 사본(실제 SQLite) · integrity_check · 실패하면 사본 지움 · 성공했을 때만 30일 넘은 것 지움
 * (9 · 15 는 비워 둠 — 한 번 쓰고 끝난 스크립트의 시험이었다 · 137차에 스크립트와 함께 지움)
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import BetterSqlite from 'better-sqlite3';
import { SAMPLE_FILE } from './lib/usClose';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DEPLOY_DIR = path.join(root, 'deploy');
const APPS = ['alphascope-api', 'alphascope-indicators'];
/** 가짜 HOME 안의 새 자리(deploy/paths.sh 와 같은 모양 — v2.61.3) */
const projIn = (home: string) => path.join(home, 'projects', 'alphascope');
const appIn = (home: string) => path.join(projIn(home), 'app');
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
/**
 * curl — 묻는 곳마다 오라클 nginx 처럼 답한다.
 * · 443(--resolve …:443:) — sites-available/alphascope 가 443 을 들으면 200, 아니면 접속 거절(000 · 종료 코드 7) · FAKE_443="코드 종료코드" 로 덮어씀
 * · 80 확인 경로 밖 — sites-available/alphascope-acme 에 return 444 가 있으면 끊김(000 · 52), 아니면 301 · FAKE_80 으로 덮어씀
 * · 80 확인 파일 — $ACME_ROOT 의 그 파일(FAKE_ACME_BROKEN=1 이면 404 쪽 글)
 */
const FAKE_CURL = `#!/bin/bash
echo "curl $*" >> "$FAKE_LOG"
URL="\${@: -1}"
case "$URL" in
  */.well-known/acme-challenge/*)
    [ "\${FAKE_ACME_BROKEN:-0}" = "1" ] && { echo -n "<html>404</html>"; exit 0; }
    cat "$ACME_ROOT/.well-known/acme-challenge/\${URL##*/}" 2>/dev/null | tr -d '\\n'; exit 0 ;;
esac
case "$*" in
  *redirect_url*) echo -n "\${FAKE_MOVE:-301 https://161.33.153.189:8080/alphascope-check?x=1}" ;;
  *:443:127.0.0.1*)
    if [ -n "\${FAKE_443:-}" ]; then echo -n "\${FAKE_443% *}"; exit "\${FAKE_443#* }"; fi
    if grep -Eqs '^[[:space:]]*listen[[:space:]]+443' "$NGINX_DIR/sites-available/alphascope"; then echo -n "\${FAKE_HTTPS_CODE:-200}"; exit 0; fi
    echo -n 000; exit 7 ;;
  *127.0.0.1:80/*)
    if [ -n "\${FAKE_80:-}" ]; then echo -n "\${FAKE_80% *}"; exit "\${FAKE_80#* }"; fi
    if grep -qs 'return 444' "$NGINX_DIR/sites-available/alphascope-acme"; then echo -n 000; exit 52; fi
    echo -n 301; exit 0 ;;
  *http_code*https://*) echo -n "\${FAKE_HTTPS_CODE:-\${FAKE_CURL_CODE:-200}}" ;;
  *http_code*127.0.0.1:8080/*) echo -n "\${FAKE_OLD_CODE:-200}" ;;
  *http_code*) echo -n "\${FAKE_CURL_CODE:-200}" ;;
  *api/version*) echo '{"version":"v-test"}' ;;
esac
exit 0
`;
/** ss — FAKE_SS_<문>=<프로그램 이름> 이면 그 문을 그 프로그램이 듣는다 */
const FAKE_SS = `#!/bin/bash
echo "ss $*" >> "$FAKE_LOG"
P=$(echo "$*" | grep -Eo 'sport = :[0-9]+' | grep -Eo '[0-9]+$')
N="FAKE_SS_$P"; V="\${!N:-}"
[ -n "$V" ] && echo "LISTEN 0 511 0.0.0.0:$P 0.0.0.0:* users:((\\"$V\\",pid=1))"
exit 0
`;
/** iptables — $FAKE_STATE/ipt 에 열린 문 번호를 한 줄씩(-C 있나 · -I 더함 · -D 지움 · -S 목록) */
const FAKE_IPTABLES = `#!/bin/bash
echo "iptables $*" >> "$FAKE_LOG"
P=""; prev=""; for a in "$@"; do [ "$prev" = "--dport" ] && P="$a"; prev="$a"; done
F="$FAKE_STATE/ipt"
case "$1" in
  -C) grep -qx "$P" "$F" ;;
  -I) echo "$P" >> "$F" ;;
  -D) grep -vx "$P" "$F" > "$F.tmp"; mv "$F.tmp" "$F" ;;
  -S) sed 's/^/-A INPUT -p tcp --dport /' "$F" ;;
esac
`;
const FAKE_NETFILTER = `#!/bin/bash\necho "netfilter-persistent $*" >> "$FAKE_LOG"\ncp "$FAKE_STATE/ipt" "$FAKE_STATE/ipt.saved"\n`;
/** certbot(apply-nginx 용) — renew --dry-run 은 FAKE_RENEW_DRY_FAIL 로 실패 */
const FAKE_CERTBOT_RENEW = `#!/bin/bash
echo "certbot $*" >> "$FAKE_LOG"
[ "$1" = "renew" ] && exit "\${FAKE_RENEW_DRY_FAIL:-0}"
exit 0
`;
const fakeLogOnly = (name: string) => `#!/bin/bash\necho "${name} $*" >> "$FAKE_LOG"\nexit 0\n`;
/** openssl — https 문이 내보내는 인증서(가짜) · 만료 날짜 · -checkend 는 FAKE_CHECKEND(0 = 48시간 넘게 남음) · FAKE_NO_TLS=1 이면 응답 없음 */
const FAKE_OPENSSL = `#!/bin/bash
echo "openssl $*" >> "$FAKE_LOG"
if [ "$1" = "s_client" ]; then
  [ "\${FAKE_NO_TLS:-0}" = "1" ] && exit 1
  printf -- '-----BEGIN CERTIFICATE-----\\nFAKE\\n-----END CERTIFICATE-----\\n'; exit 0
fi
[ "$*" = "x509" ] && { cat; exit 0; }
case " $* " in *" -in "*) ;; *) cat >/dev/null ;; esac
case " $* " in
  *" -checkend "*) exit "\${FAKE_CHECKEND:-0}" ;;
  *" -enddate "*) echo "notAfter=Nov 12 10:00:00 2026 GMT" ;;
esac
exit 0
`;
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
    openssl: FAKE_OPENSSL,
    ss: FAKE_SS,
    iptables: FAKE_IPTABLES,
    'netfilter-persistent': FAKE_NETFILTER,
    certbot: FAKE_CERTBOT_RENEW,
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
function runDeploy(opts: { existing: string[]; homeDeploy: 'same' | 'old'; from?: 'app' | 'scripts' }): RunResult {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alphascope-deploytest-'));
  try {
    const bin = path.join(tmp, 'bin');
    const app = appIn(tmp);
    fs.mkdirSync(bin);
    fs.mkdirSync(app, { recursive: true });
    fs.mkdirSync(path.join(projIn(tmp), 'scripts'));
    fs.cpSync(DEPLOY_DIR, path.join(app, 'deploy'), { recursive: true });
    writeFakes(bin);
    const repoScript = fs.readFileSync(path.join(DEPLOY_DIR, 'deploy.sh'), 'utf8');
    const homeDeployBefore = opts.homeDeploy === 'same' ? repoScript : '#!/bin/bash\n# 옛 배포 스크립트\npm2 restart all\n';
    const homeDeployPath = path.join(projIn(tmp), 'scripts', 'deploy.sh');
    fs.writeFileSync(homeDeployPath, homeDeployBefore, { mode: 0o755 });
    const logPath = path.join(tmp, 'calls.log');
    fs.writeFileSync(logPath, '');

    // from 'scripts' = 오라클처럼 관리 루트 사본(scripts/deploy.sh)으로 돌림 — paths.sh 를 ../app/deploy/ 에서 찾아야 한다
    const r = spawnSync('/bin/bash', [opts.from === 'scripts' ? homeDeployPath : path.join(app, 'deploy', 'deploy.sh')], {
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
  for (const f of ['deploy.sh']) {
    const m = fs.readFileSync(path.join(DEPLOY_DIR, f), 'utf8').match(/^PM2_APPS="([^"]*)"/m);
    check(`${f} 의 PM2_APPS = ecosystem.config.cjs 의 name 들`, !!m && m[1].split(' ').join(',') === ecoNames.join(','), `PM2_APPS=${m?.[1]} · ecosystem=${ecoNames.join(' ')}`);
  }
}

console.log('━━━ 1. 「모두」 pm2 명령 없음 · 두 이름만 다시 켬 (두 프로그램 다 있음 · scripts/deploy.sh 같음)');
const a = runDeploy({ existing: APPS, homeDeploy: 'same' });
{
  check('끝까지 성공(종료 코드 0)', a.code === 0, a.out);
  for (const f of ['deploy.sh']) {
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
  check('화면(https 8080) 확인 줄 — --resolve 161.33.153.189:8080:127.0.0.1 https://161.33.153.189:8080/', a.log.some((l) => /^curl .*--resolve 161\.33\.153\.189:8080:127\.0\.0\.1 https:\/\/161\.33\.153\.189:8080\/$/.test(l)) && a.out.includes('화면 응답: 200'), a.out);
  check('평문 http 8080 · 443 으로 화면을 묻지 않음(8080 은 https 문 · 443 은 닫힌 문)', !a.log.some((l) => l.includes('curl') && (l.includes('http://127.0.0.1:8080') || l.includes(':443'))), a.log.filter((l) => l.startsWith('curl')).join(' | '));
  check('끝에 인증서 한 줄(check-https.sh --short)', /인증서: 만료 Nov 12 10:00:00 2026 GMT · 48시간 넘게 남음/.test(a.out), a.out);
  check('80번(http://127.0.0.1/)으로 묻지 않음', !a.log.some((l) => l.includes('curl') && /http:\/\/127\.0\.0\.1\//.test(l)), a.log.filter((l) => l.startsWith('curl')).join(' | '));
  check('pm2 상태에 AlphaScope 두 줄', APPS.every((n) => new RegExp(`^\\s+${n}  online`, 'm').test(a.out)), a.out);
  check(`출력에 다른 프로젝트 이름(${OTHER}) 없음`, !a.out.includes(OTHER), a.out);
  check('표 전체를 그리는 pm2 status · list 를 부르지 않음', !pm2Calls(a).some((l) => /^pm2 (status|list|ls)\b/.test(l)));
}

console.log('━━━ 4. 저장소 deploy.sh 가 관리 루트 사본(scripts/deploy.sh)과 다르면 안내만');
{
  const NOTICE = /배포 스크립트가 바뀌었습니다 — cp \S+\/projects\/alphascope\/app\/deploy\/deploy\.sh \S+\/projects\/alphascope\/scripts\/deploy\.sh\n/;
  const d = runDeploy({ existing: APPS, homeDeploy: 'old' });
  check('끝까지 성공(종료 코드 0)', d.code === 0, d.out);
  check('안내 한 줄이 보임(새 자리 app/deploy → scripts)', NOTICE.test(d.out), d.out);
  check('안내는 끝(「완료」 바로 앞)', /배포 스크립트가 바뀌었습니다[^\n]*\n완료: /.test(d.out));
  check('scripts/deploy.sh 는 덮어쓰지 않음', d.homeDeploy === d.homeDeployBefore);
  check('같으면 안내 없음', !a.out.includes('배포 스크립트가 바뀌었습니다'));
  // 오라클에서 실제로 도는 모양 — 관리 루트 사본(scripts/deploy.sh)이 ../app/deploy/paths.sh 를 찾아 같은 일을 한다
  const s = runDeploy({ existing: APPS, homeDeploy: 'same', from: 'scripts' });
  check('관리 루트 사본(scripts/deploy.sh)으로 돌려도 성공 · 같은 pm2 명령 · 안내 없음', s.code === 0 && pm2Changes(s).join(',') === pm2Changes(a).join(',') && !s.out.includes('배포 스크립트가 바뀌었습니다'), s.out);
  const pipLine = fs.readFileSync(path.join(DEPLOY_DIR, 'deploy.sh'), 'utf8').split('\n').filter((l) => /pip install/.test(l));
  check('파이썬 패키지 설치는 python -m pip(옮긴 venv 의 bin/pip 첫 줄이 깨져도 됨)', pipLine.length === 1 && /python\/\.venv\/bin\/python -m pip install -r python\/requirements\.txt/.test(pipLine[0]), pipLine.join(' | '));
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
  // 배포 자리 = deploy/paths.sh 의 SCRIPTS_DIR(~/projects/alphascope/scripts) + deploy.sh — 맥 안내 줄은 두지 않는다(맥에서 앱을 켜지 않음 · v2.61.4)
  const bannerCodes = [...banner.matchAll(/<code[^>]*>([^<]*)<\/code>/g)].map((m) => m[1]);
  check('버전 배너 안내 = 오라클 ~/projects/alphascope/scripts/deploy.sh 한 줄(git pull · npm run build 글 없음)',
    bannerCodes.length === 1 && bannerCodes[0] === '~/projects/alphascope/scripts/deploy.sh' && /오라클:[\s\S]*?<code[^>]*>~\/projects\/alphascope\/scripts\/deploy\.sh<\/code>/.test(banner) && !/git pull|npm run build|npm install/.test(banner),
    bannerCodes.join(' | '));
  check('버전 배너 맥 안내 줄 없음(맥: · start.command 글 없음)', !/맥:|start\.command/.test(banner));
  // 맥에는 `alphascope` 접속 이름(~/.ssh/config Host)이 없다 — 안내 명령은 열쇠 파일을 직접 적는다(v2.61.4)
  const SSH_ALIAS_RE = /\bssh(\s+-[a-zA-Z]+)*\s+alphascope\b/;
  const filesBeforeDocs = files.length;
  // 저장소 `docs/` 는 문서를 지우면 폴더째 없어질 수 있다 — 없으면 멈추지 않고 건너뛴 사실을 확인 줄에 적는다(130차 · 확인 뜻은 그대로)
  const DOCS_DIR = path.join(root, 'docs');
  const docsThere = fs.existsSync(DOCS_DIR);
  if (docsThere) walk(DOCS_DIR);
  const aliasHits = [...files, path.join(root, 'README.md')].filter((f) => fs.existsSync(f) && SSH_ALIAS_RE.test(fs.readFileSync(f, 'utf8')));
  check(
    `src · server · scripts · deploy · ${docsThere ? 'docs' : 'docs(폴더 없음 — 건너뜀)'} · README 에 맥에 없는 접속 이름(ssh 뒤 alphascope) 0곳`,
    aliasHits.length === 0,
    aliasHits.map((f) => path.relative(root, f)).join(', ') || `${files.length - filesBeforeDocs}개 docs 파일 포함`,
  );
  const pathsSh = fs.readFileSync(path.join(DEPLOY_DIR, 'paths.sh'), 'utf8');
  check('배너 경로 = deploy/paths.sh 의 SCRIPTS_DIR 자리', /^PROJECTS_ROOT="\$HOME\/projects"$/m.test(pathsSh) && /^PROJECT_DIR="\$PROJECTS_ROOT\/alphascope"$/m.test(pathsSh) && /^SCRIPTS_DIR="\$PROJECT_DIR\/scripts"$/m.test(pathsSh));
}

console.log('━━━ 7. nginx 설정 — 8080 https 하나 · 같은 문 http → https · 443 없음 · 80 은 확인 경로만 · 문 번호 · 주소 한 곳');
const NGINX_CONF = fs.readFileSync(path.join(DEPLOY_DIR, 'nginx-alphascope.conf'), 'utf8');
const ACME_CONF = fs.readFileSync(path.join(DEPLOY_DIR, 'nginx-alphascope-acme.conf'), 'utf8');
/** 정답 파일 — v2.61.1(e959bdc)에 오라클에 들어가 있는 설정(443 https · 8080 넘김 · 80 은 https 로 넘김). 되돌리기 · 「지금과 같게」 비교의 기준 */
const CONF_443 = fs.readFileSync(path.join(root, 'scripts/fixtures/nginx-alphascope-443.conf'), 'utf8');
const ACME_301 = fs.readFileSync(path.join(root, 'scripts/fixtures/nginx-alphascope-acme-301.conf'), 'utf8');
const varOf = (f: string, name: string) => fs.readFileSync(path.join(DEPLOY_DIR, f), 'utf8').match(new RegExp(`^${name}=("?)([^"\\s]+)\\1`, 'm'))?.[2];
/** server { … } 블록들 — 주석을 빼고 */
const blocksOf = (conf: string) => {
  const text = conf.split('\n').map((l) => l.replace(/#.*$/, '')).join('\n');
  const out: string[] = [];
  let i = 0;
  while ((i = text.indexOf('server {', i)) >= 0) {
    let depth = 0;
    let j = i;
    for (; j < text.length; j++) {
      if (text[j] === '{') depth++;
      else if (text[j] === '}' && --depth === 0) break;
    }
    out.push(text.slice(i, j + 1));
    i = j + 1;
  }
  return out;
};
/** 지시어 목록(줄 단위 · 공백 정리) */
const directives = (block: string) => block.split('\n').map((l) => l.trim().replace(/\s+/g, ' ')).filter(Boolean);
const listenOf = (b: string) => [...b.matchAll(/^\s*listen\s+([^;]+);/gm)].map((m) => m[1].trim());
{
  const blocks = blocksOf(NGINX_CONF);
  const sslBlock = blocks[0] ?? '';
  check('nginx 설정 = server 하나 — listen 8080 ssl 만(평문 listen · 443 없음)', blocks.length === 1 && listenOf(sslBlock).join(',') === '8080 ssl', blocks.map((b) => listenOf(b).join('+')).join(' / '));
  check('443 — 두 설정 어디에도 listen 443 없음(문 번호 없는 주소 = 접속 거절)', ![...blocks, ...blocksOf(ACME_CONF)].some((b) => listenOf(b).some((l) => /(^|:)443(\s|$)/.test(l))));
  // 8080 ssl = 지금(v2.61.1) 443 블록과 같은 내용 — 문 번호와 497 넘김 한 줄만 다름(꼭 지킬 동작 1: 화면 · /api/ 가 지금과 같게)
  const NOW = blocksOf(CONF_443).find((b) => listenOf(b).includes('443 ssl')) ?? '';
  const REDIRECT_497 = 'error_page 497 =301 https://161.33.153.189:8080$request_uri;';
  const gotNow = directives(sslBlock).filter((d) => d !== 'listen 8080 ssl;' && d !== REDIRECT_497);
  const wantNow = directives(NOW).filter((d) => d !== 'listen 443 ssl;');
  check('8080 ssl — 인증서 · TLS · 화면 · /api/ · /assets/ · index.html · location / 가 v2.61.1 의 443 블록과 같다(문 번호 · 497 한 줄만 다름)', NOW !== '' && JSON.stringify(gotNow) === JSON.stringify(wantNow), `got ${JSON.stringify(gotNow)}\n      want ${JSON.stringify(wantNow)}`);
  // 옛 8080(http) 정답 파일과도 — ssl · X-Forwarded-Proto · 497 만 더함
  const OLD = blocksOf(fs.readFileSync(path.join(root, 'scripts/fixtures/nginx-alphascope-8080.conf'), 'utf8'))[0] ?? '';
  const added = /^(listen 8080 ssl;|ssl_[a-z_]+ .*;|proxy_set_header X-Forwarded-Proto \$scheme;|error_page 497 .*;)$/;
  check('8080 ssl — 옛 8080(http) 설정에서 ssl · X-Forwarded-Proto · 497 만 더함', JSON.stringify(directives(sslBlock).filter((d) => !added.test(d))) === JSON.stringify(directives(OLD).filter((d) => d !== 'listen 8080;')));
  // 497 넘김 — server 단계 한 줄 · location 안에 error_page 가 없어 모든 location 이 물려받음(nginx 문서 「이 단계에 error_page 가 없을 때만 물려받음」)
  const firstLoc = sslBlock.indexOf('location ');
  const at497 = sslBlock.indexOf(REDIRECT_497);
  check('8080 — 평문 http(497) → 같은 문 https 로 301 · 경로 · 물음표 뒤 그대로($request_uri) · server 단계 한 줄', at497 > 0 && at497 < firstLoc && (sslBlock.match(/error_page/g) ?? []).length === 1, sslBlock.slice(0, 300));
  check('8080 — /api/ 에 Host $http_host 그대로 · $host 없음 · X-Forwarded-Proto $scheme(쿠키 Secure)', /proxy_set_header\s+Host\s+\$http_host;/.test(sslBlock) && !/proxy_set_header\s+Host\s+\$host;/.test(NGINX_CONF) && /location \/api\/ \{[^}]*proxy_set_header\s+X-Forwarded-Proto\s+\$scheme;/.test(sslBlock));
  check('8080 — 인증서 = /etc/letsencrypt/live/161.33.153.189/ fullchain · privkey(그대로)', /ssl_certificate\s+\/etc\/letsencrypt\/live\/161\.33\.153\.189\/fullchain\.pem;/.test(sslBlock) && /ssl_certificate_key\s+\/etc\/letsencrypt\/live\/161\.33\.153\.189\/privkey\.pem;/.test(sslBlock));
  check('8080 — TLS = Mozilla intermediate(TLSv1.2 TLSv1.3 · ECDHE 6개) · HSTS 없음(이유 주석 있음)', /ssl_protocols TLSv1\.2 TLSv1\.3;/.test(sslBlock) && (sslBlock.match(/ssl_ciphers ([^;]+);/)?.[1].split(':').length === 6) && !/add_header\s+Strict-Transport-Security/i.test(NGINX_CONF) && /HSTS[^\n]*넣지 않는다/.test(NGINX_CONF));
  check('497 · 444 출처(nginx 공식 문서 주소)가 주석에', /nginx\.org\/en\/docs\/http\/ngx_http_ssl_module\.html/.test(NGINX_CONF) && /nginx\.org\/en\/docs\/http\/ngx_http_core_module\.html#error_page/.test(NGINX_CONF) && /nginx\.org\/en\/docs\/http\/ngx_http_rewrite_module\.html#return/.test(ACME_CONF));
  const acme = blocksOf(ACME_CONF);
  const acmeOld = blocksOf(ACME_301)[0] ?? '';
  const acmePath = (b: string) => b.match(/location \^~ \/\.well-known\/acme-challenge\/ \{[^}]*\}/)?.[0].replace(/\s+/g, ' ');
  check('80 — listen 80 · 인증서 확인 경로(/.well-known/acme-challenge/ → /var/www/letsencrypt)는 v2.61.1 과 글자까지 같음', acme.length === 1 && listenOf(acme[0]).join(',') === '80' && !!acmePath(acme[0]) && acmePath(acme[0]) === acmePath(acmeOld) && /root \/var\/www\/letsencrypt;/.test(acmePath(acme[0]) ?? ''));
  check('80 — 확인 경로 밖은 return 444(끊음) · https 넘김(301) 없음 · 그 밖 지시어 없음', /location \/ \{\s*return 444;\s*\}/.test(acme[0] ?? '') && !/return 30\d/.test(acme[0] ?? '') && directives(acme[0] ?? '').filter((d) => !/^(location|root|default_type|try_files|return 444;|\}|server \{|listen 80;|server_name)/.test(d)).length === 0, directives(acme[0] ?? '').join('|'));
  check('확인 파일 폴더 ≠ 화면 폴더(배포 rsync --delete 가 지우지 않게)', !/\/var\/www\/alphascope/.test(acme[0] ?? ''));
  const names = [...blocks, ...acme].map((b) => b.match(/server_name\s+([^;]+);/)?.[1]);
  check('server_name 은 두 블록 모두 161.33.153.189', names.length === 2 && names.every((n) => n === '161.33.153.189'), names.join(','));
  const sslPort = listenOf(sslBlock)[0]?.split(' ')[0];
  for (const f of ['deploy.sh', 'apply-nginx.sh', 'setup-https.sh', 'check-https.sh']) {
    check(`${f} 의 PUBLIC_PORT = nginx listen … ssl(${sslPort}) · SERVER_NAME = server_name`, sslPort === '8080' && varOf(f, 'PUBLIC_PORT') === sslPort && varOf(f, 'SERVER_NAME') === '161.33.153.189', `PUBLIC_PORT=${varOf(f, 'PUBLIC_PORT')} · SERVER_NAME=${varOf(f, 'SERVER_NAME')}`);
  }
  check('setup-https.sh 의 OLD_PORT(https 전 주소) = 옛 8080(http) 정답 파일의 listen', varOf('setup-https.sh', 'OLD_PORT') === listenOf(OLD)[0], `OLD_PORT=${varOf('setup-https.sh', 'OLD_PORT')}`);
  for (const f of ['apply-nginx.sh', 'setup-https.sh']) {
    check(`${f} 의 ACME_PORT = 확인용 파일 listen(80)`, varOf(f, 'ACME_PORT') === listenOf(acme[0] ?? '')[0]);
  }
  check('apply-nginx.sh 의 RETIRED_PORT = 443(닫힌 문 — 확인 · iptables 지움)', varOf('apply-nginx.sh', 'RETIRED_PORT') === '443');
  for (const f of ['apply-nginx.sh', 'setup-https.sh', 'check-https.sh', 'deploy.sh']) {
    check(`bash -n deploy/${f} 통과`, spawnSync('/bin/bash', ['-n', path.join(DEPLOY_DIR, f)]).status === 0);
  }
  // 사람에게 보여 주는 주소 · 확인 요청 — 문 번호 없는 https 주소(이제 닫힘)와 「주소 http://…:8080」(이제 https 문)을 쓰지 않는다
  for (const f of ['deploy.sh', 'setup-https.sh']) {
    const text = fs.readFileSync(path.join(DEPLOY_DIR, f), 'utf8').split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
    check(`${f} — 문 번호 없는 https 주소(https://$SERVER_NAME/ · https://161.33.153.189") 없음 · 주소는 $PUBLIC_URL`, !/https:\/\/(\$SERVER_NAME|\$\{SERVER_NAME\}|161\.33\.153\.189)(\/|"|\s|$)/.test(text) && /PUBLIC_URL="https:\/\/\$SERVER_NAME:\$PUBLIC_PORT"/.test(text));
    check(`${f} — 「주소 http://…:8080」 안내 없음(같은 줄에 https 넘김 설명이 없으면)`, !/주소[^\n]*http:\/\/(\$SERVER_NAME|161\.33\.153\.189):(\$PUBLIC_PORT|8080)(?![^\n]*https)/.test(text));
  }
}

console.log('━━━ 8. apply-nginx.sh — 멈춤 · 백업 · 넣기(두 설정) · 확인 6가지 · 갱신 연습 · iptables 443 · 되돌리기 · 다른 사이트 그대로');
const PROJECT2 = 'server {\n    listen 8081;\n    server_name 161.33.153.189;\n    root /var/www/project2;\n}\n';
const DEFAULT_SITE = 'server {\n    listen 80 default_server;\n    server_name _;\n}\n';
interface ApplyResult {
  code: number | null;
  out: string;
  log: string[];
  avail: string;
  enabled: string;
  enabledIsLink: boolean;
  acmeAvail: string;
  acmeEnabled: string;
  acmeEnabledIsLink: boolean;
  availFiles: string[];
  enabledFiles: string[];
  /** 백업 파일 이름 → 내용 */
  backups: Record<string, string>;
  project2: string;
  extra: Record<string, string>;
  ipt: string[];
  iptSaved: string[];
  iptBackups: string[];
}
/** apply-nginx.sh 를 임시 HOME · 임시 nginx 폴더에서 돌린다 — 처음 상태 = 지금 오라클(v2.61.1 설정 두 개 · iptables 22 · 80 · 443 · 8080 · 8081) */
function runApply(opts: { enabled?: 'link' | 'file'; env?: Record<string, string>; noCert?: boolean; noAcme?: boolean; ipt?: string[]; extraEnabled?: Record<string, string>; confD?: Record<string, string> } = {}): ApplyResult {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alphascope-deploytest-'));
  try {
    const bin = path.join(tmp, 'bin');
    const app = appIn(tmp);
    const ngx = path.join(tmp, 'nginx');
    const state = path.join(tmp, 'state');
    const acmeRoot = path.join(tmp, 'www-letsencrypt');
    for (const d of [bin, app, state, path.join(ngx, 'sites-available'), path.join(ngx, 'sites-enabled'), path.join(ngx, 'conf.d'), path.join(acmeRoot, '.well-known', 'acme-challenge')]) fs.mkdirSync(d, { recursive: true });
    fs.cpSync(DEPLOY_DIR, path.join(app, 'deploy'), { recursive: true });
    writeFakes(bin);
    const avail = path.join(ngx, 'sites-available', 'alphascope');
    const enabled = path.join(ngx, 'sites-enabled', 'alphascope');
    const acmeAvail = path.join(ngx, 'sites-available', 'alphascope-acme');
    const acmeEnabled = path.join(ngx, 'sites-enabled', 'alphascope-acme');
    const le = path.join(tmp, 'letsencrypt');
    if (!opts.noCert) {
      fs.mkdirSync(path.join(le, 'live', '161.33.153.189'), { recursive: true });
      fs.writeFileSync(path.join(le, 'live', '161.33.153.189', 'fullchain.pem'), 'cert');
    }
    fs.writeFileSync(avail, CONF_443);
    if (!opts.noAcme) fs.writeFileSync(acmeAvail, ACME_301);
    if ((opts.enabled ?? 'link') === 'link') {
      fs.symlinkSync(avail, enabled);
      if (!opts.noAcme) fs.symlinkSync(acmeAvail, acmeEnabled);
    } else {
      fs.writeFileSync(enabled, CONF_443);
      if (!opts.noAcme) fs.writeFileSync(acmeEnabled, ACME_301);
    }
    const sites: Record<string, string> = { project2: PROJECT2, default: DEFAULT_SITE, ...(opts.extraEnabled ?? {}) };
    for (const [name, body] of Object.entries(sites)) {
      fs.writeFileSync(path.join(ngx, 'sites-available', name), body);
      fs.symlinkSync(path.join(ngx, 'sites-available', name), path.join(ngx, 'sites-enabled', name));
    }
    for (const [name, body] of Object.entries(opts.confD ?? {})) fs.writeFileSync(path.join(ngx, 'conf.d', name), body);
    const ipt = opts.ipt ?? ['22', '80', '443', '8080', '8081'];
    fs.writeFileSync(path.join(state, 'ipt'), ipt.map((p) => `${p}\n`).join(''));
    fs.writeFileSync(path.join(state, 'ipt.saved'), ipt.map((p) => `${p}\n`).join(''));
    const logPath = path.join(tmp, 'calls.log');
    fs.writeFileSync(logPath, '');
    const r = spawnSync('/bin/bash', [path.join(app, 'deploy', 'apply-nginx.sh')], {
      cwd: tmp,
      encoding: 'utf8',
      env: {
        PATH: testPath(bin),
        HOME: tmp,
        NGINX_DIR: ngx,
        LE_DIR: le,
        ACME_ROOT: acmeRoot,
        FAKE_LOG: logPath,
        FAKE_STATE: state,
        FAKE_SS_443: 'nginx',
        LANG: 'en_US.UTF-8',
        ...(opts.env ?? {}),
      },
      timeout: 30_000,
    });
    const lines = (f: string) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).sort();
    const read = (f: string) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '');
    return {
      code: r.status,
      out: `${r.stdout}${r.stderr}`,
      log: fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean),
      avail: read(avail),
      enabled: read(enabled),
      enabledIsLink: fs.lstatSync(enabled).isSymbolicLink(),
      acmeAvail: read(acmeAvail),
      acmeEnabled: read(acmeEnabled),
      acmeEnabledIsLink: (() => { try { return fs.lstatSync(acmeEnabled).isSymbolicLink(); } catch { return false; } })(),
      availFiles: fs.readdirSync(path.join(ngx, 'sites-available')).sort(),
      enabledFiles: fs.readdirSync(path.join(ngx, 'sites-enabled')).sort(),
      // v2.61.3 — 백업은 관리 루트 backups/nginx/ 에(sites-available 에는 백업이 없어야 한다 — availFiles 로 확인)
      backups: (() => { const d = path.join(projIn(tmp), 'backups', 'nginx'); return fs.existsSync(d) ? Object.fromEntries(fs.readdirSync(d).filter((f) => f.includes('.backup-')).map((f) => [f, fs.readFileSync(path.join(d, f), 'utf8')])) : {}; })(),
      project2: read(path.join(ngx, 'sites-available', 'project2')),
      extra: Object.fromEntries([...Object.keys(opts.extraEnabled ?? {}).map((n) => [n, read(path.join(ngx, 'sites-available', n))]), ...Object.keys(opts.confD ?? {}).map((n) => [`conf.d/${n}`, read(path.join(ngx, 'conf.d', n))])]),
      ipt: lines(path.join(state, 'ipt')),
      iptSaved: lines(path.join(state, 'ipt.saved')),
      iptBackups: (() => { const d = path.join(projIn(tmp), 'backups', 'https'); return fs.existsSync(d) ? fs.readdirSync(d).filter((f) => /^alphascope-iptables-INPUT\.backup-\d{8}-\d{6}\.txt$/.test(f)) : []; })(),
    };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
{
  const IPT_NOW = ['22', '443', '80', '8080', '8081'];
  const IPT_AFTER = ['22', '80', '8080', '8081'];
  const idx = (r: ApplyResult, re: RegExp) => r.log.findIndex((l) => re.test(l));
  /** 무언가를 바꾸는 명령(읽기 · 확인용 sudo test · grep · ss · iptables -C 는 뺀다) */
  const changing = (r: ApplyResult) => r.log.filter((l) => /^(sudo )?(cp|rm|ln|mv|tee)\b/.test(l) || /^(nginx -t|systemctl reload|iptables -[ID]|netfilter-persistent|certbot)/.test(l));
  const othersUntouched = (r: ApplyResult) => r.project2 === PROJECT2 && !r.log.some((l) => /(project2|sites-[a-z]+\/default|sites-[a-z]+\/other|conf\.d\/)/.test(l) && /^(sudo )?(cp|rm|ln|mv|tee)\b/.test(l));
  const restored = (r: ApplyResult) => r.code === 1 && r.avail === CONF_443 && r.acmeAvail === ACME_301 && r.ipt.join(',') === IPT_NOW.join(',') && r.iptSaved.join(',') === IPT_NOW.join(',')
    && r.out.includes('되돌렸습니다 — 예전 주소 https://161.33.153.189 가 그대로 됩니다(화면 응답 200)') && !r.out.includes('적용 완료') && othersUntouched(r);

  // 성공(sites-enabled 가 링크)
  const ok = runApply();
  check('[성공] 종료 코드 0 · 「AlphaScope 주소: https://161.33.153.189:8080 (http://…:8080 은 https 로 · https://161.33.153.189 는 접속 거절)」', ok.code === 0 && ok.out.includes('AlphaScope 주소: https://161.33.153.189:8080 (http://161.33.153.189:8080 로 들어와도 같은 문의 https 로 넘어감 · https://161.33.153.189 는 접속 거절)'), ok.out);
  check('[성공] ① 백업 두 개(alphascope · alphascope-acme) — 관리 루트 backups/nginx/ 안 · 이름에 날짜 · 지금 설정 그대로 · sites-available · sites-enabled 에 백업 없음',
    Object.entries(ok.backups).some(([f, c]) => /^alphascope\.backup-\d{8}-\d{6}$/.test(f) && c === CONF_443) && Object.entries(ok.backups).some(([f, c]) => /^alphascope-acme\.backup-\d{8}-\d{6}$/.test(f) && c === ACME_301) && ok.enabledFiles.join(',') === 'alphascope,alphascope-acme,default,project2' && ok.availFiles.join(',') === 'alphascope,alphascope-acme,default,project2', `${ok.availFiles.join(',')} / ${ok.enabledFiles.join(',')}`);
  check('[성공] ② 새 설정 두 개가 들어감 · 링크는 링크 그대로', ok.avail === NGINX_CONF && ok.acmeAvail === ACME_CONF && ok.enabledIsLink && ok.acmeEnabledIsLink);
  const order: [string, RegExp][] = [
    ['인증서 있음', /^sudo test -f .*\/live\/161\.33\.153\.189\/fullchain\.pem$/],
    ['443 듣는 프로그램(ss)', /^ss -ltnpH \( sport = :443 \)$/],
    ['백업', /^sudo cp .*sites-available\/alphascope .*\.backup-/],
    ['넣기 alphascope', /^sudo cp deploy\/nginx-alphascope\.conf .*sites-available\/alphascope$/],
    ['넣기 alphascope-acme', /^sudo cp deploy\/nginx-alphascope-acme\.conf .*sites-available\/alphascope-acme$/],
    ['nginx -t', /^nginx -t$/],
    ['reload', /^systemctl reload nginx$/],
    ['https 8080 화면', /^curl .*--resolve 161\.33\.153\.189:8080:127\.0\.0\.1 https:\/\/161\.33\.153\.189:8080\/$/],
    ['https 8080 /api/version', /^curl .*--resolve 161\.33\.153\.189:8080:127\.0\.0\.1 https:\/\/161\.33\.153\.189:8080\/api\/version$/],
    ['http 8080 → https', /^curl .*redirect_url.*Host: 161\.33\.153\.189:8080 http:\/\/127\.0\.0\.1:8080\/alphascope-check\?x=1$/],
    ['443 접속 거절', /^curl .*--resolve 161\.33\.153\.189:443:127\.0\.0\.1 https:\/\/161\.33\.153\.189\/$/],
    ['80 확인 파일', /^curl .*Host: 161\.33\.153\.189 http:\/\/127\.0\.0\.1:80\/\.well-known\/acme-challenge\/alphascope-check-/],
    ['80 그 밖', /^curl .*Host: 161\.33\.153\.189 http:\/\/127\.0\.0\.1:80\/alphascope-check$/],
    ['갱신 연습', /^certbot renew --dry-run --cert-name 161\.33\.153\.189$/],
    ['iptables 443 지움', /^iptables -D INPUT -p tcp --dport 443 -m state --state NEW -j ACCEPT$/],
    ['저장', /^netfilter-persistent save$/],
  ];
  const pos = order.map(([, re]) => idx(ok, re));
  check('[성공] 순서 — 확인 → 백업 → 넣기(두 설정) → nginx -t → reload → https 8080 · /api/ · http → https · 443 · 80 확인 파일 · 80 그 밖 → 갱신 연습 → iptables 443 지움 → 저장', pos.every((p, i) => p >= 0 && (i === 0 || p > pos[i - 1])), order.map(([n], i) => `${n}=${pos[i]}`).join(' · '));
  check('[성공] iptables — 443 만 지움(22 · 80 · 8080 · 8081 그대로) · 저장 · 지우기 전 목록 백업(backups/https/alphascope-iptables-INPUT.backup-<날짜>.txt)', ok.ipt.join(',') === IPT_AFTER.join(',') && ok.iptSaved.join(',') === IPT_AFTER.join(',') && ok.iptBackups.length === 1, `${ok.ipt.join(',')} · ${ok.iptBackups.join(',')}`);
  check('[성공] 8081 · project2 · default 는 읽기만(cp · rm · ln 없음 · 내용 그대로) · pm2 · npm 명령 0', othersUntouched(ok) && !ok.log.some((l) => /^(pm2|npm) /.test(l)));
  check('[성공] 확인 파일은 쓰고 나서 지움 · 끝에 되돌리는 명령(백업 두 개 · iptables 443 다시 더하기) 안내', ok.log.some((l) => /^sudo rm -f .*acme-challenge\/alphascope-check-/.test(l)) && /sudo cp \S*alphascope\.backup-\S+ \S*sites-available\/alphascope && sudo cp \S*alphascope-acme\.backup-\S+ \S*sites-available\/alphascope-acme && sudo nginx -t && sudo systemctl reload nginx/.test(ok.out) && ok.out.includes('sudo iptables -I INPUT 6 -p tcp --dport 443 -m state --state NEW -j ACCEPT && sudo netfilter-persistent save'), ok.out.slice(-800));
  check('[성공] 콘솔 보안 목록 443 지우기 안내(80 · 8080 · 8081 · 22 그대로)', ok.out.includes('오라클 웹 콘솔 보안 목록의 443 수신 규칙도 지우세요(80 · 8080 · 8081 · 22 는 그대로)'));
  // 성공(sites-enabled 가 따로 복사된 파일)
  const okFile = runApply({ enabled: 'file' });
  check('[성공 · sites-enabled 가 파일] 거기도 새 설정 두 개 · 그 백업도 backups/nginx/ 안',
    okFile.code === 0 && okFile.enabled === NGINX_CONF && okFile.acmeEnabled === ACME_CONF && !okFile.enabledIsLink
    && Object.entries(okFile.backups).some(([f, c]) => /^alphascope-enabled-file\.backup-\d{8}-\d{6}$/.test(f) && c === CONF_443)
    && Object.entries(okFile.backups).some(([f, c]) => /^alphascope-acme-enabled-file\.backup-\d{8}-\d{6}$/.test(f) && c === ACME_301),
    `${okFile.code} · ${okFile.availFiles.join(',')}`);
  // iptables 에 443 이 이미 없음
  const noRule = runApply({ ipt: IPT_AFTER });
  check('[성공 · iptables 에 443 없음] 지우지 않음 · 저장 안 함 · 「규칙이 없습니다」', noRule.code === 0 && !noRule.log.some((l) => /^(iptables -D|netfilter-persistent)/.test(l)) && noRule.ipt.join(',') === IPT_AFTER.join(',') && noRule.out.includes('iptables 에 443 규칙이 없습니다'), noRule.out.slice(-300));

  // 바꾸기 전에 멈춤 — 아무것도 바꾸지 않음
  const stops: [string, ApplyResult, string][] = [
    ['인증서 없음', runApply({ noCert: true }), 'setup-https.sh'],
    ['80 확인 경로 설정(alphascope-acme) 없음', runApply({ noAcme: true }), 'alphascope-acme'],
    ['다른 사이트(sites-enabled)가 443 을 들음', runApply({ extraEnabled: { other443: 'server {\n    listen 443 ssl default_server;\n    server_name _;\n}\n' } }), 'other443'],
    ['conf.d 의 설정이 443 을 들음', runApply({ confD: { 'ssl.conf': 'server {\n    listen [::]:443 ssl;\n}\n' } }), 'ssl.conf'],
    ['443 을 nginx 아닌 프로그램이 들음(ss)', runApply({ env: { FAKE_SS_443: 'apache2' } }), 'apache2'],
  ];
  for (const [name, r, mention] of stops) {
    check(`[멈춤] ${name} — 종료 코드 1 · 바꾸는 명령 0 · 설정 · iptables 그대로 · 백업 없음 · 지우지 않음 · 알림(${mention})`,
      r.code === 1 && changing(r).length === 0 && r.avail === CONF_443 && r.ipt.join(',') === IPT_NOW.join(',') && Object.keys(r.backups).length === 0
      && r.out.includes('아무것도 바꾸지 않고 멈춥니다') && r.out.includes(mention) && Object.values(r.extra).every((c) => c.length > 0),
      `${r.code} · ${changing(r).join(' | ')} :: ${r.out.slice(-300)}`);
  }

  // 넣은 뒤 실패 — 두 설정 되돌리고 예전 주소(https://161.33.153.189) 확인 · iptables 그대로
  const fails: [string, ApplyResult][] = [
    ['nginx -t 실패', runApply({ enabled: 'file', env: { FAKE_NGINX_T_FAIL_FIRST: '1' } })],
    ['https 8080 화면 502', runApply({ env: { FAKE_CURL_CODE: '502' } })],
    ['http 8080 → https 넘김이 경로를 버림', runApply({ env: { FAKE_MOVE: '301 https://161.33.153.189:8080/' } })],
    ['http 8080 → 문 번호 없는 https 로 넘김', runApply({ env: { FAKE_MOVE: '301 https://161.33.153.189/alphascope-check?x=1' } })],
    ['443 이 아직 응답함', runApply({ env: { FAKE_443: '200 0' } })],
    ['80 확인 파일이 안 읽힘', runApply({ env: { FAKE_ACME_BROKEN: '1' } })],
    ['80 그 밖이 끊기지 않음(301)', runApply({ env: { FAKE_80: '301 0' } })],
    ['갱신 연습(certbot renew --dry-run) 실패', runApply({ env: { FAKE_RENEW_DRY_FAIL: '1' } })],
  ];
  for (const [name, r] of fails) {
    check(`[되돌림] ${name} — 종료 코드 1 · 두 설정 v2.61.1 그대로 · iptables 443 그대로 · 예전 주소 https://161.33.153.189 화면 200 확인 · 다른 사이트 그대로`,
      restored(r) && !r.log.some((l) => /^(iptables -D|netfilter-persistent)/.test(l)),
      `${r.code} · ${r.ipt.join(',')} :: ${r.out.slice(-500)}`);
  }
  const tf = fails[0][1];
  check('[되돌림] nginx -t 실패 — 새 설정으로 reload · 확인 안 함(되돌린 뒤 reload 한 번 · 예전 주소 확인만) · sites-enabled 파일도 되돌림',
    tf.log.filter((l) => l === 'systemctl reload nginx').length === 1 && !tf.log.some((l) => l.startsWith('curl') && l.includes(':8080')) && tf.enabled === CONF_443 && tf.acmeEnabled === ACME_301, tf.log.join(' | '));
  check('[되돌림] 되돌린 뒤 예전 주소를 443 으로 물음(--resolve 161.33.153.189:443 https://161.33.153.189/) · reload 두 번', fails.slice(1).every(([, r]) => r.log.filter((l) => l === 'systemctl reload nginx').length === 2 && r.log.filter((l) => /^curl .*--resolve 161\.33\.153\.189:443:127\.0\.0\.1 https:\/\/161\.33\.153\.189\/$/.test(l)).length >= 1));
}

console.log('━━━ 10. setup-https.sh — 멈춤 · 순서 · 되돌리기 · 8081 그대로 (가짜 snap · certbot · iptables · nginx · ss)');
const IP = '161.33.153.189';
const OLD_8080 = fs.readFileSync(path.join(root, 'scripts/fixtures/nginx-alphascope-8080.conf'), 'utf8');
/** 상태 파일($FAKE_STATE)로 「깔린 snap · iptables 규칙」 을 흉내 낸다 */
const HTTPS_FAKES: Record<string, string> = {
  sudo: `#!/bin/bash\necho "sudo $*" >> "$FAKE_LOG"\nexec "$@"\n`,
  nginx: FAKE_NGINX,
  systemctl: `#!/bin/bash
echo "systemctl $*" >> "$FAKE_LOG"
case "$1" in
  is-active) echo "\${FAKE_NGINX_STATE:-active}" ;;
  list-timers) [ "\${FAKE_NO_TIMER:-0}" = "1" ] || [ ! -f "$FAKE_STATE/snap_certbot" ] || echo "Sat 2026-11-07 00:12:00 UTC 5h left - - snap.certbot.renew.timer snap.certbot.renew.service" ;;
  is-failed) exit 1 ;;
esac
exit 0
`,
  snap: `#!/bin/bash
echo "snap $*" >> "$FAKE_LOG"
case "$1" in
  list) [ -f "$FAKE_STATE/snap_certbot" ] ;;
  install) [ "\${FAKE_SNAP_FAIL:-0}" = "1" ] && { echo "error: 시험용 실패" >&2; exit 1; }; touch "$FAKE_STATE/snap_certbot" ;;
  remove) rm -f "$FAKE_STATE/snap_certbot" ;;
esac
`,
  certbot: `#!/bin/bash
echo "certbot $*" >> "$FAKE_LOG"
NAME=161.33.153.189
case "$1" in
  --version) echo "certbot \${FAKE_CERTBOT_V:-5.9.0}"; exit 0 ;;
  certonly)
    case " $* " in *" --dry-run "*) exit "\${FAKE_CB_DRY_FAIL:-0}" ;; esac
    [ "\${FAKE_CB_FAIL:-0}" = "1" ] && { mkdir -p "$LE_DIR/live/$NAME"; echo "시험용 실패" >&2; exit 1; }
    HOOK=""; prev=""; for a in "$@"; do [ "$prev" = "--deploy-hook" ] && HOOK="$a"; prev="$a"; done
    mkdir -p "$LE_DIR/live/$NAME" "$LE_DIR/renewal"
    echo cert > "$LE_DIR/live/$NAME/fullchain.pem"; echo key > "$LE_DIR/live/$NAME/privkey.pem"
    printf '[renewalparams]\\nrenew_hook = %s\\n' "$HOOK" > "$LE_DIR/renewal/$NAME.conf" ;;
  renew) exit "\${FAKE_RENEW_DRY_FAIL:-0}" ;;
  delete) rm -rf "$LE_DIR/live/$NAME" "$LE_DIR/renewal/$NAME.conf" ;;
esac
exit 0
`,
  iptables: FAKE_IPTABLES,
  'netfilter-persistent': FAKE_NETFILTER,
  ss: FAKE_SS,
  'dpkg-query': `#!/bin/bash\necho "dpkg-query $*" >> "$FAKE_LOG"\n[ "\${FAKE_APT_CERTBOT:-0}" = "1" ] && { echo -n "install ok installed"; exit 0; }\nexit 1\n`,
  curl: FAKE_CURL,
  openssl: FAKE_OPENSSL,
  sleep: fakeLogOnly('sleep'),
};
interface HttpsResult {
  code: number | null;
  out: string;
  log: string[];
  avail: string;
  enabledIsLink: boolean;
  enabledFiles: string[];
  availFiles: string[];
  project2: string;
  acme: string;
  ipt: string[];
  iptSaved: string[];
  snap: boolean;
  link: boolean;
  cert: boolean;
  acmeRoot: boolean;
  backups: string[];
}
function runHttps(env: Record<string, string> = {}, setup: { conf?: string; ipt?: string[]; snap?: boolean; extraEnabled?: Record<string, string>; acmeLeft?: boolean; cert?: boolean } = {}, input = 'yes\n'): HttpsResult {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alphascope-deploytest-'));
  try {
    const bin = path.join(tmp, 'bin');
    const app = appIn(tmp);
    const state = path.join(tmp, 'state');
    const ngx = path.join(tmp, 'nginx');
    const le = path.join(tmp, 'letsencrypt');
    const acmeRoot = path.join(tmp, 'www-letsencrypt');
    const link = path.join(tmp, 'usr-local-bin-certbot');
    for (const d of [bin, app, state, path.join(ngx, 'sites-available'), path.join(ngx, 'sites-enabled')]) fs.mkdirSync(d, { recursive: true });
    fs.cpSync(DEPLOY_DIR, path.join(app, 'deploy'), { recursive: true });
    for (const [name, body] of Object.entries(HTTPS_FAKES)) fs.writeFileSync(path.join(bin, name), body, { mode: 0o755 });
    const avail = path.join(ngx, 'sites-available', 'alphascope');
    fs.writeFileSync(avail, setup.conf ?? OLD_8080);
    fs.symlinkSync(avail, path.join(ngx, 'sites-enabled', 'alphascope'));
    const sites: Record<string, string> = { project2: PROJECT2, default: DEFAULT_SITE, ...(setup.extraEnabled ?? {}) };
    for (const [name, body] of Object.entries(sites)) {
      fs.writeFileSync(path.join(ngx, 'sites-available', name), body);
      fs.symlinkSync(path.join(ngx, 'sites-available', name), path.join(ngx, 'sites-enabled', name));
    }
    if (setup.acmeLeft) fs.writeFileSync(path.join(ngx, 'sites-available', 'alphascope-acme'), 'left');
    if (setup.cert) { fs.mkdirSync(path.join(le, 'live', IP), { recursive: true }); }
    const ipt = setup.ipt ?? ['22', '8080', '8081'];
    fs.writeFileSync(path.join(state, 'ipt'), ipt.map((p) => `${p}\n`).join(''));
    fs.writeFileSync(path.join(state, 'ipt.saved'), ipt.map((p) => `${p}\n`).join(''));
    if (setup.snap) fs.writeFileSync(path.join(state, 'snap_certbot'), '');
    const logPath = path.join(tmp, 'calls.log');
    fs.writeFileSync(logPath, '');
    const r = spawnSync('/bin/bash', [path.join(app, 'deploy', 'setup-https.sh')], {
      cwd: tmp,
      encoding: 'utf8',
      input,
      env: {
        PATH: testPath(bin),
        HOME: tmp,
        NGINX_DIR: ngx,
        LE_DIR: le,
        ACME_ROOT: acmeRoot,
        CERTBOT_LINK: link,
        FAKE_LOG: logPath,
        FAKE_STATE: state,
        FAKE_SS_80: 'nginx',
        LANG: 'en_US.UTF-8',
        ...env,
      },
      timeout: 60_000,
    });
    const lines = (f: string) => fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).sort();
    return {
      code: r.status,
      out: `${r.stdout}${r.stderr}`,
      log: fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean),
      avail: fs.readFileSync(avail, 'utf8'),
      enabledIsLink: fs.lstatSync(path.join(ngx, 'sites-enabled', 'alphascope')).isSymbolicLink(),
      enabledFiles: fs.readdirSync(path.join(ngx, 'sites-enabled')).sort(),
      availFiles: fs.readdirSync(path.join(ngx, 'sites-available')).sort(),
      project2: fs.readFileSync(path.join(ngx, 'sites-available', 'project2'), 'utf8'),
      acme: fs.existsSync(path.join(ngx, 'sites-available', 'alphascope-acme')) ? fs.readFileSync(path.join(ngx, 'sites-available', 'alphascope-acme'), 'utf8') : '',
      ipt: lines(path.join(state, 'ipt')),
      iptSaved: lines(path.join(state, 'ipt.saved')),
      snap: fs.existsSync(path.join(state, 'snap_certbot')),
      link: fs.existsSync(link) || (() => { try { fs.lstatSync(link); return true; } catch { return false; } })(),
      cert: fs.existsSync(path.join(le, 'live', IP)),
      acmeRoot: fs.existsSync(acmeRoot),
      backups: (() => { const d = path.join(projIn(tmp), 'backups', 'https'); return fs.existsSync(d) ? fs.readdirSync(d).filter((f) => f.startsWith('alphascope-https-backup-')) : []; })(),
    };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
{
  /** 무언가를 바꾸는 명령(읽기 · 확인용 sudo test · ss · iptables -C/-S 는 뺀다) */
  const changing = (r: HttpsResult) => r.log.filter((l) => /^sudo (cp|ln|mkdir|rm|tee|snap|certbot|systemctl reload|iptables -[ID]|netfilter-persistent)\b/.test(l) || /^(snap install|snap remove|certbot (certonly|delete)|iptables -[ID]|netfilter-persistent|systemctl reload)\b/.test(l));
  const touchesP2 = (r: HttpsResult) => r.log.some((l) => /project2/.test(l) && /^(sudo )?(cp|rm|ln|mv|tee)\b/.test(l));
  const at = (r: HttpsResult, re: RegExp) => r.log.findIndex((l) => re.test(l));
  const BASE_IPT = ['22', '8080', '8081'];

  // 성공
  const ok = runHttps();
  check('[성공] 종료 코드 0 · 끝에 「완료 — https://161.33.153.189:8080」 · 인증서 만료 · 다음 갱신 예정', ok.code === 0 && ok.out.includes(`완료 — https://${IP}:8080\n`) && /인증서 만료: Nov 12 10:00:00 2026 GMT/.test(ok.out) && /다음 갱신 예정: /.test(ok.out), ok.out.slice(-1500));
  check('[성공] nginx: alphascope = 새 설정(8080 https) · alphascope-acme(80 · 확인 경로 밖 끊음) 켜짐 · 링크 그대로', ok.avail === NGINX_CONF && ok.acme === ACME_CONF && ok.enabledIsLink && ok.enabledFiles.join(',') === 'alphascope,alphascope-acme,default,project2', ok.enabledFiles.join(','));
  check('[성공] iptables: 80 만 더함(8080 은 이미 열림 · 443 은 열지 않음 · 8081 · 22 그대로) · 저장(netfilter-persistent)', ok.ipt.join(',') === [...BASE_IPT, '80'].sort().join(',') && ok.iptSaved.join(',') === ok.ipt.join(',') && !ok.log.some((l) => /^iptables -I .*--dport (443|8080) /.test(l)), ok.ipt.join(','));
  check('[성공] iptables 규칙 = 11-03 과 같은 꼴(-I INPUT 6 … --dport N -m state --state NEW -j ACCEPT)', ok.log.some((l) => /^iptables -I INPUT 6 -p tcp --dport 80 -m state --state NEW -j ACCEPT$/.test(l)));
  const cb = ok.log.find((l) => /^certbot certonly/.test(l) && !l.includes('--dry-run')) ?? '';
  check('[성공] 인증서 받기 인자 — shortlived(required) · webroot(확인 파일 폴더) · --ip-address 161.33.153.189 · 갱신 뒤 nginx reload', /--required-profile shortlived/.test(cb) && /--webroot --webroot-path \S*www-letsencrypt/.test(cb) && /--ip-address 161\.33\.153\.189/.test(cb) && /--deploy-hook systemctl reload nginx/.test(cb) && /--non-interactive/.test(cb), cb);
  const order: [string, RegExp][] = [
    ['상태 확인(ss 8080)', /^ss -ltnpH \( sport = :8080 \)$/],
    ['Certbot 설치(snap)', /^snap install --classic certbot$/],
    ['iptables 80', /^iptables -I INPUT 6 -p tcp --dport 80 /],
    ['저장', /^netfilter-persistent save$/],
    ['80 확인 경로 넣기', /^sudo cp deploy\/nginx-alphascope-acme\.conf .*alphascope-acme$/],
    ['nginx -t', /^nginx -t$/],
    ['reload', /^systemctl reload nginx$/],
    ['확인 파일 시험', /^curl .*Host: 161\.33\.153\.189 http:\/\/127\.0\.0\.1:80\/\.well-known\/acme-challenge\/alphascope-check-/],
    ['연습(--dry-run)', /^certbot certonly .*--dry-run$/],
    ['진짜 받기', /^certbot certonly (?!.*--dry-run)/],
    ['새 설정(apply-nginx)', /^sudo cp deploy\/nginx-alphascope\.conf .*sites-available\/alphascope$/],
    ['https 8080 확인', /^curl .*--resolve 161\.33\.153\.189:8080:127\.0\.0\.1 https:\/\/161\.33\.153\.189:8080\/api\/version$/],
    ['갱신 연습(apply-nginx)', /^certbot renew --dry-run --cert-name 161\.33\.153\.189$/],
    ['타이머 확인', /^systemctl list-timers/],
  ];
  const pos = order.map(([, re]) => at(ok, re));
  check('[성공] 순서 — 확인 → Certbot → iptables 80 → 저장 → 80 확인 경로 → 확인 파일 시험 → 연습 → 인증서 → 새 nginx → https 8080 확인 → 갱신 연습 → 타이머', pos.every((p, i) => p >= 0 && (i === 0 || p > pos[i - 1])), order.map(([n], i) => `${n}=${pos[i]}`).join(' · '));
  check('[성공] 8081 · project2 · default 사이트는 읽기만(cp · rm · ln 없음 · 내용 그대로)', !touchesP2(ok) && ok.project2 === PROJECT2 && !ok.log.some((l) => /sites-[a-z]+\/default/.test(l) && /^(sudo )?(cp|rm|ln)/.test(l)));
  check('[성공] pm2 · 앱 서버는 건드리지 않음(pm2 · npm 명령 0)', !ok.log.some((l) => /^(pm2|npm) /.test(l)));
  check('[성공] 백업 폴더 하나(backups/https/alphascope-https-backup-<날짜>)', ok.backups.length === 1 && /^alphascope-https-backup-\d{8}-\d{6}$/.test(ok.backups[0]));

  // 이미 https · 상태가 예상과 다르면 아무것도 바꾸지 않고 멈춤
  for (const [name, conf] of [['8080 https(v2.61.2)', NGINX_CONF], ['443 https(v2.61.1)', CONF_443]]) {
    const already = runHttps({}, { conf });
    check(`[멈춤] 이미 https — ${name} — 종료 코드 0 · 「할 일이 없습니다」 · 바꾸는 명령 0`, already.code === 0 && already.out.includes('할 일이 없습니다') && changing(already).length === 0, already.out);
  }
  const stops: [string, HttpsResult][] = [
    ['nginx 가 꺼져 있음', runHttps({ FAKE_NGINX_STATE: 'inactive' })],
    ['alphascope 설정이 예상한 모양(8080 · /api/)이 아님', runHttps({}, { conf: 'server { listen 9999; }\n' })],
    ['이전 시도의 alphascope-acme 가 남음', runHttps({}, { acmeLeft: true })],
    ['인증서 폴더가 이미 있음', runHttps({}, { cert: true })],
    ['다른 사이트가 8080 을 씀', runHttps({}, { extraEnabled: { other8080: 'server {\n    listen 8080;\n    server_name example.com;\n}\n' } })],
    ['다른 사이트가 80 에서 같은 IP 를 씀', runHttps({}, { extraEnabled: { other80: 'server {\n    listen 80;\n    server_name 161.33.153.189;\n}\n' } })],
    ['8080 을 nginx 아닌 프로그램이 씀(ss)', runHttps({ FAKE_SS_8080: 'apache2' })],
    ['80 을 nginx 아닌 프로그램이 씀', runHttps({ FAKE_SS_80: 'python3' })],
    ['apt 로 깐 certbot 이 있음', runHttps({ FAKE_APT_CERTBOT: '1' })],
    ['지금 8080 화면이 200 이 아님', runHttps({ FAKE_OLD_CODE: '502' })],
    ['콘솔에서 80 을 열었냐는 물음에 yes 가 아님', runHttps({}, {}, '\n')],
  ];
  for (const [name, r] of stops) {
    check(`[멈춤] ${name} — 종료 코드 1 · 바꾸는 명령 0 · 설정 · iptables 그대로 · 백업 폴더 없음`,
      r.code === 1 && changing(r).length === 0 && r.ipt.join(',') === BASE_IPT.join(',') && !r.snap && r.backups.length === 0 && r.out.includes('아무것도 바꾸지 않고 멈춥니다') && !r.enabledFiles.includes('alphascope-acme'),
      `${r.code} · ${changing(r).join(' | ')} :: ${r.out.slice(-300)}`);
  }

  // 어느 단계에서 실패해도 전으로
  const back = (r: HttpsResult, ipt = BASE_IPT, snapBefore = false) =>
    r.code === 1 && r.avail === OLD_8080 && r.enabledIsLink && !r.enabledFiles.includes('alphascope-acme') && !r.availFiles.includes('alphascope-acme')
    && r.ipt.join(',') === [...ipt].sort().join(',') && r.iptSaved.join(',') === [...ipt].sort().join(',') && !r.cert && !r.acmeRoot && r.snap === snapBefore && !r.link
    && r.project2 === PROJECT2 && !touchesP2(r) && r.out.includes('되돌렸습니다 — http://161.33.153.189:8080 가 그대로 됩니다');
  const fails: [string, HttpsResult][] = [
    ['Certbot 설치(snap) 실패', runHttps({ FAKE_SNAP_FAIL: '1' })],
    ['Certbot 판이 5.4 미만(5.3.1)', runHttps({ FAKE_CERTBOT_V: '5.3.1' })],
    ['80 확인 경로 nginx -t 실패', runHttps({ FAKE_NGINX_T_FAIL_FIRST: '1' })],
    ['80 번 문에서 확인 파일이 안 읽힘', runHttps({ FAKE_ACME_BROKEN: '1' })],
    ['80 번 문의 확인 경로 밖이 끊기지 않음(301)', runHttps({ FAKE_80: '301 0' })],
    ['인증서 받기 연습(--dry-run) 실패', runHttps({ FAKE_CB_DRY_FAIL: '1' })],
    ['인증서 받기 실패(폴더가 반쯤 남음)', runHttps({ FAKE_CB_FAIL: '1' })],
    ['새 nginx 설정 https 8080 확인 실패(502)', runHttps({ FAKE_HTTPS_CODE: '502' })],
    ['http 8080 → https 넘김이 경로를 버림', runHttps({ FAKE_MOVE: '301 https://161.33.153.189:8080/' })],
    ['자동 갱신 타이머 없음', runHttps({ FAKE_NO_TIMER: '1' })],
    ['갱신 연습(renew --dry-run) 실패', runHttps({ FAKE_RENEW_DRY_FAIL: '1' })],
  ];
  for (const [name, r] of fails) {
    check(`[되돌림] ${name} — 종료 코드 1 · nginx 옛 설정(8080) · alphascope-acme 없음 · iptables · 저장본 그대로 · 인증서 · Certbot · 링크 지움 · 8081 그대로 · 8080 확인`,
      back(r), `${r.code} · ipt=${r.ipt.join(',')} · cert=${r.cert} · snap=${r.snap} · link=${r.link} · ${r.enabledFiles.join(',')} :: ${r.out.slice(-500)}`);
  }
  check('[되돌림] 새 nginx 실패 — 받은 인증서를 지움(certbot delete)', fails[7][1].log.some((l) => /^certbot delete --non-interactive --cert-name 161\.33\.153\.189$/.test(l)));
  check('[되돌림] 되돌린 뒤 8080 화면을 확인(Host 161.33.153.189:8080)', fails[7][1].log.filter((l) => /^curl .*Host: 161\.33\.153\.189:8080 http:\/\/127\.0\.0\.1:8080\/$/.test(l)).length >= 2);
  // 이미 있던 것은 되돌릴 때도 남김
  const pre = runHttps({ FAKE_CB_DRY_FAIL: '1' }, { ipt: [...BASE_IPT, '443'], snap: true });
  check('[되돌림] 전부터 열려 있던 443 · 전부터 있던 Certbot(snap)은 지우지 않음(80 만 지움)', back(pre, [...BASE_IPT, '443'], true) && !pre.log.some((l) => /^snap (install|remove)/.test(l)) && !pre.log.some((l) => /^iptables -[ID] .*--dport 443/.test(l)), `${pre.ipt.join(',')} · ${pre.snap} :: ${pre.out.slice(-300)}`);
}

console.log('━━━ 11. check-https.sh — 남은 기간 · 48시간 경고 · https 문(8080) 응답 없음');
{
  const runCheck = (env: Record<string, string>) => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alphascope-deploytest-'));
    try {
      const bin = path.join(tmp, 'bin');
      fs.mkdirSync(bin);
      writeFakes(bin);
      const logPath = path.join(tmp, 'calls.log');
      fs.writeFileSync(logPath, '');
      const r = spawnSync('/bin/bash', [path.join(DEPLOY_DIR, 'check-https.sh'), '--short'], { encoding: 'utf8', env: { PATH: testPath(bin), HOME: tmp, FAKE_LOG: logPath, LANG: 'en_US.UTF-8', ...env }, timeout: 30_000 });
      return { code: r.status, out: `${r.stdout}${r.stderr}`, log: fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean) };
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  };
  const fine = runCheck({});
  check('넉넉함 — 종료 코드 0 · 「만료 … · 48시간 넘게 남음」 · 8080 에서 받은 인증서로 봄 · 48시간(172800초) 기준', fine.code === 0 && /인증서: 만료 Nov 12 10:00:00 2026 GMT · 48시간 넘게 남음/.test(fine.out) && fine.log.some((l) => l === 'openssl s_client -connect 127.0.0.1:8080') && fine.log.some((l) => l.includes('-checkend 172800')), fine.out);
  const soon = runCheck({ FAKE_CHECKEND: '1' });
  check('48시간 안 — 종료 코드 1 · ⚠️ 「자동 갱신이 멈춘 것 같습니다」', soon.code === 1 && /⚠️ 인증서가 48시간 안에 끝납니다\(만료 Nov 12 10:00:00 2026 GMT\) — 자동 갱신이 멈춘 것 같습니다/.test(soon.out), soon.out);
  const none = runCheck({ FAKE_NO_TLS: '1' });
  check('8080 응답 없음 — 종료 코드 1 · ⚠️ 한 줄', none.code === 1 && /⚠️ 인증서: 8080 번 문에서 인증서를 받지 못했습니다/.test(none.out), none.out);
  check('바꾸는 명령 0(sudo · certbot · systemctl 없음 — --short)', [fine, soon, none].every((r) => !r.log.some((l) => /^(sudo|certbot|systemctl|nginx)/.test(l))));
}

console.log('━━━ 12. 자리 한 곳(deploy/paths.sh) — 모든 배포 스크립트가 같은 APP_DIR · 박힌 옛 경로 없음');
{
  const shs = fs.readdirSync(DEPLOY_DIR).filter((f) => f.endsWith('.sh') && f !== 'paths.sh');
  const r = spawnSync('/bin/bash', ['-c', `. "${path.join(DEPLOY_DIR, 'paths.sh')}"; echo "$PROJECT_DIR|$APP_DIR|$SECRETS_DIR|$SCRIPTS_DIR|$BACKUP_DIR|$DATA_DIR"`], { encoding: 'utf8', env: { HOME: '/h', PATH: '/usr/bin:/bin' } });
  check('paths.sh — HOME=/h 이면 /h/projects/alphascope 아래 app · secrets · scripts · backups · data',
    r.stdout.trim() === '/h/projects/alphascope|/h/projects/alphascope/app|/h/projects/alphascope/secrets|/h/projects/alphascope/scripts|/h/projects/alphascope/backups|/h/projects/alphascope/data', r.stdout + r.stderr);
  for (const f of shs) {
    const text = fs.readFileSync(path.join(DEPLOY_DIR, f), 'utf8');
    const code = text.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
    const sources = /^\s*\. "\$\(cd "\$\(dirname "\$\{BASH_SOURCE\[0\]\}"\)" && pwd\)\/paths\.sh"/m.test(text) || /^\s*\. "\$HERE\/paths\.sh"/m.test(text) || /if \[ -f "\$HERE\/paths\.sh" \]; then \. "\$HERE\/paths\.sh"; else \. "\$HERE\/\.\.\/app\/deploy\/paths\.sh"; fi/.test(text);
    const needsPaths = f !== 'check-https.sh';
    check(`${f} — ${needsPaths ? 'paths.sh 를 읽음 · ' : ''}APP_DIR · 홈 경로를 스스로 정하지 않음 · /home/ubuntu 없음`,
      (!needsPaths || sources) && !/^\s*APP_DIR=/m.test(code) && !/\/home\/ubuntu/.test(text)
      && !/\$HOME\/alphascope|~\/alphascope(?!-)|\$HOME\/(deploy|backup)\.sh|\$HOME\/(backups|secrets)\b/.test(code),
      f);
  }
  const tsHits = fs.readdirSync(path.join(root, 'scripts')).filter((f) => f.endsWith('.ts') && f !== path.basename(fileURLToPath(import.meta.url)))
    .concat(fs.readdirSync(path.join(root, 'scripts', 'lib')).map((f) => `lib/${f}`))
    .filter((f) => /~\/alphascope(?!-)|alphascope-samples|\/home\/ubuntu|os\.homedir\(\), 'alphascope/.test(fs.readFileSync(path.join(root, 'scripts', f), 'utf8')));
  check('scripts/*.ts 에 옛 오라클 경로(~/alphascope · alphascope-samples · /home/ubuntu) 없음', tsHits.length === 0, tsHits.join(', '));
  check('미국 마감 표본 기본 자리 = 앱 폴더 옆 data/us-close.jsonl(파일 자리에서 계산)', SAMPLE_FILE === path.resolve(root, '..', 'data', 'us-close.jsonl'), SAMPLE_FILE);
}

console.log('━━━ 13. ecosystem.config.cjs — 다른 자리에 두어도 cwd · venv 가 그 자리를 따라감');
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alphascope-deploytest-'));
  try {
    const require = createRequire(import.meta.url);
    for (const at of [path.join(tmp, 'projects', 'alphascope', 'app'), path.join(tmp, 'somewhere', 'else', 'app2')]) {
      fs.mkdirSync(path.join(at, 'deploy'), { recursive: true });
      const where = fs.realpathSync(at);   // __dirname 은 링크를 푼 실제 경로(맥 /var → /private/var)
      fs.copyFileSync(path.join(DEPLOY_DIR, 'ecosystem.config.cjs'), path.join(where, 'deploy', 'ecosystem.config.cjs'));
      const eco = require(path.join(where, 'deploy', 'ecosystem.config.cjs')) as { apps: { name: string; cwd: string; script: string; args: string }[] };
      const api = eco.apps.find((a) => a.name === 'alphascope-api');
      const ind = eco.apps.find((a) => a.name === 'alphascope-indicators');
      check(`${path.relative(tmp, where)} — api cwd = 그 앱 폴더 · indicators cwd = python · script = python/.venv/bin/python`,
        api?.cwd === where && api.script === 'npx' && api.args === 'tsx server/index.ts' && ind?.cwd === path.join(where, 'python') && ind.script === path.join(where, 'python', '.venv', 'bin', 'python') && ind.args === 'indicators.py',
        JSON.stringify(eco.apps));
    }
    const dep = fs.readFileSync(path.join(DEPLOY_DIR, 'deploy.sh'), 'utf8');
    check('deploy.sh 는 deploy/ecosystem.config.cjs 를 그대로 씀(앱 폴더 맨 위 사본 안 씀)', /^ECO="\$APP_DIR\/deploy\/ecosystem\.config\.cjs"/m.test(dep) && !/\$APP_DIR\/ecosystem\.config\.cjs/.test(dep));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

console.log('━━━ 14. backup-db.sh — WAL 에서도 온전한 사본 · integrity_check · 실패하면 사본 지움 · 30일');
const TODAY = (() => { const d = new Date(); return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`; })();
/** 서버처럼 연결을 연 채로 WAL 에만 줄을 쌓은 DB — 연결(닫기 함수)을 돌려준다 */
function walDb(file: string, rows: number): { close: () => void } {
  const db = new BetterSqlite(file);
  db.pragma('journal_mode = WAL');
  db.pragma('wal_autocheckpoint = 0');
  db.exec('CREATE TABLE IF NOT EXISTS t (x INTEGER)');
  const ins = db.prepare('INSERT INTO t VALUES (?)');
  db.transaction(() => { for (let i = 0; i < rows; i++) ins.run(i); })();
  return { close: () => db.close() };
}
const countRows = (file: string) => { const d = new BetterSqlite(file, { readonly: true }); try { return (d.prepare('SELECT count(*) AS c FROM t').get() as { c: number }).c; } finally { d.close(); } };
function runBackup(home: string, env: Record<string, string>) {
  const r = spawnSync('/bin/bash', [path.join(DEPLOY_DIR, 'backup-db.sh')], { encoding: 'utf8', env: { PATH: [path.dirname(process.execPath), '/usr/bin', '/bin'].join(':'), HOME: home, LANG: 'en_US.UTF-8', ...env }, timeout: 60_000 });
  const dir = path.join(projIn(home), 'backups', 'db');
  return { code: r.status, out: `${r.stdout}${r.stderr}`, dir, files: fs.existsSync(dir) ? fs.readdirSync(dir).sort() : [], log: fs.existsSync(path.join(dir, 'backup.log')) ? fs.readFileSync(path.join(dir, 'backup.log'), 'utf8') : '' };
}
{
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'alphascope-deploytest-'));
  try {
    const home = path.join(tmp, 'home');
    const dbFile = path.join(tmp, 'live', 'alphascope.db');
    fs.mkdirSync(path.dirname(dbFile), { recursive: true });
    const bkDir = path.join(projIn(home), 'backups', 'db');
    fs.mkdirSync(bkDir, { recursive: true });
    const old31 = path.join(bkDir, 'alphascope_20200101.db');
    const old29 = path.join(bkDir, 'alphascope_20200201.db');
    const note = path.join(bkDir, 'note.txt');
    for (const [f, days] of [[old31, 31], [old29, 29], [note, 60]] as const) {
      fs.writeFileSync(f, 'old');
      const t = new Date(Date.now() - days * 86_400_000 - 3_600_000);
      fs.utimesSync(f, t, t);
    }
    const live = walDb(dbFile, 500);
    try {
      check('준비 — 서버가 연 채로 WAL 에만 500줄(.db 파일만 복사하면 표조차 없음)', fs.statSync(`${dbFile}-wal`).size > 0 && (() => { fs.copyFileSync(dbFile, path.join(tmp, 'cp.db')); try { countRows(path.join(tmp, 'cp.db')); return false; } catch { return true; } })());
      const ok = runBackup(home, { DB_FILE: dbFile });
      const dest = path.join(bkDir, `alphascope_${TODAY}.db`);
      check('[성공] 종료 코드 0 · backups/db/alphascope_YYYYMMDD.db · 로그 「완료 … integrity_check ok」', ok.code === 0 && fs.existsSync(dest) && /완료 — \S+alphascope_\d{8}\.db .* integrity_check ok/.test(ok.log), ok.out);
      check('[성공] 사본에 WAL 의 500줄이 모두 있음 · integrity_check = ok · 한 파일(journal_mode delete · -wal · -shm · .part 없음)', countRows(dest) === 500
        && (() => { const d = new BetterSqlite(dest, { readonly: true }); try { return d.pragma('integrity_check', { simple: true }) === 'ok' && d.pragma('journal_mode', { simple: true }) === 'delete'; } finally { d.close(); } })()
        && !ok.files.some((f) => /\.(part|db-wal|db-shm)$|-journal$/.test(f)), ok.files.join(','));
      check('[성공] 원본은 그대로(서버 연결이 쓴 500줄 · WAL 그대로)', countRows(dbFile) === 500 && fs.existsSync(`${dbFile}-wal`));
      check('[성공] 30일 넘은 *.db 만 지움(29일 · .db 아닌 파일은 남김) · 로그에 지운 이름', !fs.existsSync(old31) && fs.existsSync(old29) && fs.existsSync(note) && /30일 넘어 지움 — alphascope_20200101\.db/.test(ok.log), ok.files.join(','));
    } finally {
      live.close();
    }
    // 실패 — DB 가 아닌 파일 · 없는 파일 : 사본을 지우고 · 예전 백업은 지우지 않음
    for (const [name, prep] of [['DB 가 아닌 파일', (f: string) => fs.writeFileSync(f, 'this is not a sqlite database at all, just text'.repeat(200))], ['DB 파일 없음', () => undefined]] as const) {
      const h2 = path.join(tmp, `home-${name.length}`);
      const d2 = path.join(projIn(h2), 'backups', 'db');
      fs.mkdirSync(d2, { recursive: true });
      const keep = path.join(d2, 'alphascope_20200101.db');
      fs.writeFileSync(keep, 'old');
      const t = new Date(Date.now() - 40 * 86_400_000);
      fs.utimesSync(keep, t, t);
      const bad = path.join(tmp, `bad-${name.length}.db`);
      prep(bad);
      const r = runBackup(h2, { DB_FILE: bad });
      check(`[실패 · ${name}] 종료 코드 1 · 사본 없음(.part 도) · 로그 「실패」 · 예전 백업은 지우지 않음`, r.code === 1 && r.files.join(',') === 'alphascope_20200101.db,backup.log' && /실패 — /.test(r.log), `${r.code} · ${r.files.join(',')} · ${r.log}`);
    }
    const src = fs.readFileSync(path.join(DEPLOY_DIR, 'backup-db.cjs'), 'utf8');
    check('backup-db.cjs — 온라인 백업(db.backup) · integrity_check · 공식 문서 출처 · 원본에 쓰는 문장 없음', /await db\.backup\(dest\)/.test(src) && /integrity_check/.test(src) && src.includes('https://www.sqlite.org/backup.html') && src.includes('better-sqlite3/blob/master/docs/api.md#backupdestination-options---promise') && !/db\.(exec|prepare|pragma)\(/.test(src.replace(/copy\.pragma/g, '')));
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

console.log(`\n결과: 통과 ${pass} · 실패 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
