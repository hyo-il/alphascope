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
 * 6. 사람에게 보여 주는 안내 글에도 「모두」 명령 없음
 * 7. nginx(v2.61.2) — 8080 ssl 하나 + 같은 문 http → https(error_page 497) · 443 블록 없음 · 80 은 확인 경로만 · 나머지 444 · Host $http_host · 문 번호 한 곳
 * 8. apply-nginx.sh — 멈춤(인증서 · 80 설정 없음 · 다른 설정 · 프로그램이 443) · 백업 · 넣기(두 설정) · nginx -t · reload · 확인 6가지 · 갱신 연습
 *    · iptables 443 지움 · 실패하면 두 설정 되돌리고 예전 주소 확인 · 8081(project2) · default 는 건드리지 않음(가짜 sudo 는 cp 를 임시 nginx 폴더에서 진짜로 돌린다)
 * 9. upgrade-node24.sh — 설치 방식이 예상과 다르면 아무것도 바꾸지 않고 멈춤 · 어느 단계에서 실패해도 Node 22 · 옛 node_modules · 옛 화면으로
 *    되돌리고 다시 켬 · AlphaScope 두 이름만 멈추고 켬(가짜 apt-get · dpkg · node -v · /proc — 실제 apt · pm2 를 부르지 않는다)
 * 10. setup-https.sh(v2.61.1 · v2.61.2 8080) — 상태가 예상과 다르면 아무것도 바꾸지 않고 멈춤 · 순서(Certbot → iptables 80 → 80 확인 경로 → 연습 → 인증서 → 새 nginx · 갱신 연습 → 타이머)
 *     · 어느 단계에서 실패해도 nginx · iptables · 인증서 · Certbot 을 전으로 되돌리고 8080 확인 · 8081(project2)은 건드리지 않음
 *     (가짜 snap · certbot · iptables · netfilter-persistent · ss · nginx · systemctl · curl · openssl — 실제 apt · certbot · nginx · iptables 를 부르지 않는다)
 * 11. check-https.sh — 남은 기간 한 줄 · 48시간 경고 · https 문(8080) 응답 없음
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
  check('화면(https 8080) 확인 줄 — --resolve 161.33.153.189:8080:127.0.0.1 https://161.33.153.189:8080/', a.log.some((l) => /^curl .*--resolve 161\.33\.153\.189:8080:127\.0\.0\.1 https:\/\/161\.33\.153\.189:8080\/$/.test(l)) && a.out.includes('화면 응답: 200'), a.out);
  check('평문 http 8080 · 443 으로 화면을 묻지 않음(8080 은 https 문 · 443 은 닫힌 문)', !a.log.some((l) => l.includes('curl') && (l.includes('http://127.0.0.1:8080') || l.includes(':443'))), a.log.filter((l) => l.startsWith('curl')).join(' | '));
  check('끝에 인증서 한 줄(check-https.sh --short)', /인증서: 만료 Nov 12 10:00:00 2026 GMT · 48시간 넘게 남음/.test(a.out), a.out);
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
  for (const f of ['deploy.sh', 'apply-nginx.sh', 'switch-to-static.sh', 'upgrade-node24.sh', 'setup-https.sh', 'check-https.sh']) {
    check(`${f} 의 PUBLIC_PORT = nginx listen … ssl(${sslPort}) · SERVER_NAME = server_name`, sslPort === '8080' && varOf(f, 'PUBLIC_PORT') === sslPort && varOf(f, 'SERVER_NAME') === '161.33.153.189', `PUBLIC_PORT=${varOf(f, 'PUBLIC_PORT')} · SERVER_NAME=${varOf(f, 'SERVER_NAME')}`);
  }
  check('setup-https.sh 의 OLD_PORT(https 전 주소) = 옛 8080(http) 정답 파일의 listen', varOf('setup-https.sh', 'OLD_PORT') === listenOf(OLD)[0], `OLD_PORT=${varOf('setup-https.sh', 'OLD_PORT')}`);
  for (const f of ['apply-nginx.sh', 'setup-https.sh']) {
    check(`${f} 의 ACME_PORT = 확인용 파일 listen(80)`, varOf(f, 'ACME_PORT') === listenOf(acme[0] ?? '')[0]);
  }
  check('apply-nginx.sh 의 RETIRED_PORT = 443(닫힌 문 — 확인 · iptables 지움)', varOf('apply-nginx.sh', 'RETIRED_PORT') === '443');
  for (const f of ['apply-nginx.sh', 'setup-https.sh', 'check-https.sh', 'deploy.sh', 'switch-to-static.sh', 'upgrade-node24.sh']) {
    check(`bash -n deploy/${f} 통과`, spawnSync('/bin/bash', ['-n', path.join(DEPLOY_DIR, f)]).status === 0);
  }
  // 사람에게 보여 주는 주소 · 확인 요청 — 문 번호 없는 https 주소(이제 닫힘)와 「주소 http://…:8080」(이제 https 문)을 쓰지 않는다
  for (const f of ['deploy.sh', 'switch-to-static.sh', 'upgrade-node24.sh', 'setup-https.sh']) {
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
    const app = path.join(tmp, 'alphascope');
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
      backups: Object.fromEntries(fs.readdirSync(path.join(ngx, 'sites-available')).filter((f) => f.includes('.backup-')).map((f) => [f, fs.readFileSync(path.join(ngx, 'sites-available', f), 'utf8')])),
      project2: read(path.join(ngx, 'sites-available', 'project2')),
      extra: Object.fromEntries([...Object.keys(opts.extraEnabled ?? {}).map((n) => [n, read(path.join(ngx, 'sites-available', n))]), ...Object.keys(opts.confD ?? {}).map((n) => [`conf.d/${n}`, read(path.join(ngx, 'conf.d', n))])]),
      ipt: lines(path.join(state, 'ipt')),
      iptSaved: lines(path.join(state, 'ipt.saved')),
      iptBackups: fs.readdirSync(tmp).filter((f) => /^alphascope-iptables-INPUT\.backup-\d{8}-\d{6}\.txt$/.test(f)),
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
  check('[성공] ① 백업 두 개(alphascope · alphascope-acme) — sites-available 안 · 이름에 날짜 · 지금 설정 그대로 · sites-enabled 에 백업 없음',
    Object.entries(ok.backups).some(([f, c]) => /^alphascope\.backup-\d{8}-\d{6}$/.test(f) && c === CONF_443) && Object.entries(ok.backups).some(([f, c]) => /^alphascope-acme\.backup-\d{8}-\d{6}$/.test(f) && c === ACME_301) && ok.enabledFiles.join(',') === 'alphascope,alphascope-acme,default,project2', `${ok.availFiles.join(',')} / ${ok.enabledFiles.join(',')}`);
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
  check('[성공] iptables — 443 만 지움(22 · 80 · 8080 · 8081 그대로) · 저장 · 지우기 전 목록 백업(~/alphascope-iptables-INPUT.backup-<날짜>.txt)', ok.ipt.join(',') === IPT_AFTER.join(',') && ok.iptSaved.join(',') === IPT_AFTER.join(',') && ok.iptBackups.length === 1, `${ok.ipt.join(',')} · ${ok.iptBackups.join(',')}`);
  check('[성공] 8081 · project2 · default 는 읽기만(cp · rm · ln 없음 · 내용 그대로) · pm2 · npm 명령 0', othersUntouched(ok) && !ok.log.some((l) => /^(pm2|npm) /.test(l)));
  check('[성공] 확인 파일은 쓰고 나서 지움 · 끝에 되돌리는 명령(백업 두 개 · iptables 443 다시 더하기) 안내', ok.log.some((l) => /^sudo rm -f .*acme-challenge\/alphascope-check-/.test(l)) && /sudo cp \S*alphascope\.backup-\S+ \S*sites-available\/alphascope && sudo cp \S*alphascope-acme\.backup-\S+ \S*sites-available\/alphascope-acme && sudo nginx -t && sudo systemctl reload nginx/.test(ok.out) && ok.out.includes('sudo iptables -I INPUT 6 -p tcp --dport 443 -m state --state NEW -j ACCEPT && sudo netfilter-persistent save'), ok.out.slice(-800));
  check('[성공] 콘솔 보안 목록 443 지우기 안내(80 · 8080 · 8081 · 22 그대로)', ok.out.includes('오라클 웹 콘솔 보안 목록의 443 수신 규칙도 지우세요(80 · 8080 · 8081 · 22 는 그대로)'));
  // 성공(sites-enabled 가 따로 복사된 파일)
  const okFile = runApply({ enabled: 'file' });
  check('[성공 · sites-enabled 가 파일] 거기도 새 설정 두 개 · 그 백업도 sites-available 안',
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
  *http_code*) echo -n "\${FAKE_CODE_WEB:-200}" ;;
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
  check('[성공] 종료 코드 0 · 끝에 「완료 — Node 24 … 서버 켜짐 · 오류 없음 · 주소 https://161.33.153.189:8080」', ok.code === 0 && /완료 — Node 24 \(v24\.22\.1\) · 서버 켜짐 · 오류 없음 · 주소 https:\/\/161\.33\.153\.189:8080$/m.test(ok.out), ok.out);
  check('[성공] Node 24 · 새 node_modules · 새 화면', ok.nodeV === 'v24.22.1' && ok.mark === 'node24' && ok.web === 'new', `${ok.nodeV} · ${ok.mark} · ${ok.web}`);
  check('[성공] 백업 — Node 22 패키지 · apt 설정 · DB(+wal) · pm2 목록 · 옛 화면', ['nodejs_22.23.4-1nodesource1_arm64.deb', 'apt/nodesource.sources', 'apt/nodejs', 'db/alphascope.db', 'db/alphascope.db-wal', 'dump.pm2', 'web/index.html', 'info.txt'].every((f) => ok.backupFiles.includes(f)), ok.backupFiles.join(', '));
  const changes = upPm2Changes(ok);
  check('[성공] pm2 를 바꾼 명령 = AlphaScope 두 이름 stop → restart 뿐', changes.join(',') === [...APPS.map((n) => `pm2 stop ${n}`), ...APPS.map((n) => `pm2 restart ${n}`)].join(','), changes.join(' | '));
  check(`[성공] 다른 프로젝트(${OTHER}) · all · pm2 update 없음`, !ok.log.some((l) => l.startsWith('pm2 ') && (l.includes(OTHER) || /\ball\b/.test(l) || /^pm2 update/.test(l))), ok.log.filter((l) => l.startsWith('pm2')).join(' | '));
  check('[성공] nginx 설정 파일은 건드리지 않음(nginx -t · reload 만)', !ok.log.some((l) => /sites-(available|enabled)/.test(l)));
  const order = [/^apt-get download nodejs=22\.23\.4-1nodesource1$/, /^curl -fsSL https:\/\/deb\.nodesource\.com\/setup_24\.x -o /, /^pm2 save$/, /^sudo -E bash .*nodesource_setup_24\.sh$/, /^sudo apt-get install -y --allow-downgrades nodejs=24\.22\.1-1nodesource1$/, /^npm ci --no-audit --no-fund$/, /^pm2 stop alphascope-api$/, /^pm2 restart alphascope-api$/, /^curl .*127\.0\.0\.1:4000\/api\/version/, /^npm run build$/, /^sudo nginx -t$/, /^sudo systemctl reload nginx$/, /^curl .*--resolve 161\.33\.153\.189:8080:127\.0\.0\.1 https:\/\/161\.33\.153\.189:8080\/$/];
  const pos = order.map((re) => at(ok, re));
  check('[성공] 순서 — 되돌리기 준비(패키지 · 설치 스크립트 · pm2 save) → Node 24 → npm ci(켠 채로) → 멈춤 → 다시 켬 → API → 빌드 → nginx → https 8080 화면', pos.every((p, i) => p >= 0 && (i === 0 || p > pos[i - 1])), `${pos.join(',')} :: ${ok.log.join(' | ')}`);
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
    ['https 8080 화면 확인 실패(502)', runUpgrade({ FAKE_CODE_WEB: '502' }), true],
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
    const app = path.join(tmp, 'alphascope');
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
      backups: fs.readdirSync(tmp).filter((f) => f.startsWith('alphascope-https-backup-')),
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
  check('[성공] 백업 폴더 하나(~/alphascope-https-backup-<날짜>)', ok.backups.length === 1 && /^alphascope-https-backup-\d{8}-\d{6}$/.test(ok.backups[0]));

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

console.log(`\n결과: 통과 ${pass} · 실패 ${fail}`);
process.exit(fail === 0 ? 0 : 1);
