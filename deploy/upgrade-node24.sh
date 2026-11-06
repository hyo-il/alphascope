#!/bin/bash
# AlphaScope — 오라클 서버의 Node 를 22 → 24 로 올린다 (v2.60.9). **오라클 안에서 손으로 한 번** 돌린다.
#
#   쓰는 법(오라클 안에서):  cd ~/projects/alphascope/app && git pull --ff-only origin main && bash deploy/upgrade-node24.sh
#   ⚠️ 이 스크립트가 설치 · 빌드 · 화면 복사까지 한다 — 먼저 배포(scripts/deploy.sh)를 돌리지 않는다.
#
# 언제(KST): 토 15:00 ~ 일 17:00 이 가장 안전하다(자동매매 · 매수 판단 · 다시 계산 · 거래정지 받기 · 오늘 시황 · 스냅샷이 모두 쉬는 때).
#            평일 06:30~07:20 · 국내 장(09:00~15:30) · 미국 장(23:30~06:00, 서머타임이면 22:30~05:00) · 05:30 앞뒤는 피한다.
#
# 순서: ① 지금 상태 확인(설치 방식이 예상과 다르면 아무것도 바꾸지 않고 멈춤) → ② 되돌리기 준비(Node 22 패키지 · apt 설정 · pm2 save)
#       → ③ Node 24 설치(서버는 켠 채로) → ④ 새 node_modules 를 옆 폴더에서 설치(서버는 켠 채로)
#       → ⑤ AlphaScope 두 프로그램만 멈춤 · DB 백업 · node_modules 바꿔 끼움 · 다시 켬(서버가 꺼지는 때는 여기뿐)
#       → ⑥ 확인(API · Node 24 · pm2 로그 · 스위치) → ⑦ 빌드 · 화면 복사 · https 확인
#       어느 단계에서든 실패하면 스스로 Node 22 · 옛 node_modules · 옛 화면으로 되돌리고 서버를 다시 켠다.
# pm2 는 AlphaScope 두 이름만 멈추고 켠다 — 같은 서버의 다른 프로젝트 pm2 · nginx 설정 파일은 건드리지 않는다(「모두」 명령 없음).
set -u

. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/paths.sh"   # 자리(APP_DIR · SCRIPTS_DIR · BACKUP_DIR …)는 deploy/paths.sh 한 곳
WEB_DIR="${WEB_DIR:-/var/www/alphascope}"
SERVER_NAME="161.33.153.189"   # nginx 설정의 server_name 과 같아야 한다
PUBLIC_PORT=8080               # nginx 설정의 listen … ssl 과 같아야 한다(npm run deploy:test 가 확인 · v2.61.2 https://161.33.153.189:8080)
PUBLIC_URL="https://$SERVER_NAME:$PUBLIC_PORT"
# AlphaScope pm2 프로그램 이름 — deploy.sh · ecosystem.config.cjs 와 같아야 한다(npm run deploy:test 가 확인)
PM2_APPS="alphascope-api alphascope-indicators"
# 올릴 Node — 맥 시험과 같은 버전(nodesource 패키지 버전)
NODE24_PKG="24.22.1-1nodesource1"
NODE24_V="v24.22.1"
# 아래 넷은 시험(deploy:test)만 임시 폴더로 바꾼다
APT_DIR="${APT_DIR:-/etc/apt}"
KEYRING_DIRS="${KEYRING_DIRS:-/usr/share/keyrings /etc/apt/keyrings}"
PROC_DIR="${PROC_DIR:-/proc}"
PM2_LOG_DIR="${PM2_LOG_DIR:-$HOME/.pm2/logs}"   # pm2 기본 로그 자리(alphascope-api-out.log · -error.log)
NODE_BIN_EXPECTED="${NODE_BIN_EXPECTED:-/usr/bin/node}"

STAMP=$(date +%Y%m%d-%H%M%S)
BK="$BACKUP_DIR/node24/alphascope-node24-backup-$STAMP"
STAGE="$BK/stage"

# 되돌릴 때 쓰는 표시 — 어디까지 바꿨나
NODE_CHANGED=0
APPS_STOPPED=0
MODULES_SWAPPED=0
WEB_CHANGED=0
OLD_PKG=""
OLD_V=""

say() { echo "  $*"; }

# 멈추기 전(①) — 아무것도 바꾸지 않았다
stop_unchanged() {
  echo "  ⚠️ $1"
  echo "  아무것도 바꾸지 않고 멈춥니다. 서버는 지금 그대로 돕니다. 위 내용을 개발 대화에 알려 주세요."
  exit 1
}

# 앱 응답 기다리기(최대 60초)
wait_api() {
  for _ in $(seq 1 30); do
    if [ "$(curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:4000/api/version || true)" = "200" ]; then return 0; fi
    sleep 2
  done
  return 1
}

# 되돌리기 — 바꾼 것만 거꾸로
rollback() {
  echo ""
  echo "━━━ 되돌리기"
  trap - INT TERM
  if [ "$APPS_STOPPED" = "1" ]; then
    for APP in $PM2_APPS; do pm2 stop "$APP" >/dev/null 2>&1; done
  fi
  if [ "$MODULES_SWAPPED" = "1" ]; then
    rm -rf "$BK/node_modules.node24-failed"
    mv "$APP_DIR/node_modules" "$BK/node_modules.node24-failed" && mv "$BK/node_modules.node22" "$APP_DIR/node_modules" \
      && say "node_modules → 옛것(Node 22)" || say "⚠️ node_modules 를 되돌리지 못했습니다 — 옛것: $BK/node_modules.node22"
  fi
  if [ "$WEB_CHANGED" = "1" ]; then
    rsync -a --delete "$BK/web/" "$WEB_DIR/" && sudo nginx -t && sudo systemctl reload nginx \
      && say "화면 → 옛것" || say "⚠️ 화면을 되돌리지 못했습니다 — 옛것: $BK/web"
  fi
  if [ "$NODE_CHANGED" = "1" ]; then
    sudo rm -f "$APT_DIR/sources.list.d/nodesource.list" "$APT_DIR/sources.list.d/nodesource.sources" \
      "$APT_DIR/preferences.d/nodejs" "$APT_DIR/preferences.d/nsolid"
    for f in "$BK"/apt/*; do
      [ -f "$f" ] || continue
      DEST=$(grep -F "$(basename "$f")|" "$BK/apt-paths.txt" | head -1 | cut -d'|' -f2)
      [ -n "$DEST" ] && sudo cp "$f" "$DEST"
    done
    if sudo dpkg -i "$BK"/nodejs_*.deb >/dev/null && [ "$(node -v)" = "$OLD_V" ]; then
      say "Node → $(node -v)"
    else
      say "⚠️ Node 22 로 되돌리지 못했습니다(지금 $(node -v 2>/dev/null)). 손으로: sudo dpkg -i $BK/nodejs_*.deb"
    fi
  fi
  if [ "$APPS_STOPPED" = "1" ]; then
    for APP in $PM2_APPS; do pm2 restart "$APP" >/dev/null; done
    if wait_api; then say "AlphaScope 두 프로그램을 다시 켰습니다 — API 응답 200"; else say "⚠️ API 가 응답하지 않습니다 — pm2 logs alphascope-api --lines 50"; fi
  fi
  echo ""
  echo "되돌렸습니다 — 서버는 예전(Node ${OLD_V:-22})대로 돕니다. 위의 ⚠️ 내용을 개발 대화에 알려 주세요."
  echo "(백업: $BK — DB 사본 · Node 22 패키지 · apt 설정 · pm2 목록)"
  exit 1
}
fail() {
  echo "  ⚠️ $1"
  rollback
}
trap 'fail "중간에 멈췄습니다(Ctrl+C 등)."' INT TERM

echo "AlphaScope Node 24 올리기 — 추천 시간: 토 15:00 ~ 일 17:00 KST (평일 장중 · 06:30~07:20 · 05:30 앞뒤 피함)"
echo ""
echo "━━━ 1/7 지금 상태 확인 (아무것도 바꾸지 않음)"
[ -d "$APP_DIR" ] || stop_unchanged "$APP_DIR 가 없습니다."
cd "$APP_DIR" || stop_unchanged "$APP_DIR 로 들어가지 못했습니다."
NODE_BIN=$(command -v node || true)
OLD_V=$(node -v 2>/dev/null || true)
say "node $OLD_V ($NODE_BIN) · npm $(npm -v 2>/dev/null) · pm2 $(pm2 -v 2>/dev/null | tail -1) · 앱 $(git rev-parse --short HEAD 2>/dev/null)"
case "$OLD_V" in
  v24.*) echo "  이미 Node 24($OLD_V)입니다 — 할 일이 없습니다. 아무것도 바꾸지 않았습니다."; exit 0 ;;
  v22.*) ;;
  *) stop_unchanged "node 가 22 가 아닙니다($OLD_V) — 예상과 다릅니다." ;;
esac
[ "$NODE_BIN" = "$NODE_BIN_EXPECTED" ] || stop_unchanged "node 위치가 $NODE_BIN 입니다($NODE_BIN_EXPECTED 가 아님 — nvm 등 다른 방식으로 설치한 듯합니다)."
OWNER=$(dpkg -S "$NODE_BIN_EXPECTED" 2>/dev/null | cut -d: -f1)
[ "$OWNER" = "nodejs" ] || stop_unchanged "$NODE_BIN_EXPECTED 가 apt 패키지 nodejs 의 것이 아닙니다(dpkg -S: ${OWNER:-없음})."
OLD_PKG=$(dpkg-query -W -f='${Version}' nodejs 2>/dev/null || true)
case "$OLD_PKG" in
  22.*nodesource*) say "설치 방식: apt nodesource (nodejs $OLD_PKG)" ;;
  *) stop_unchanged "nodejs 패키지가 nodesource 22 가 아닙니다($OLD_PKG)." ;;
esac
SRC=""
for f in "$APT_DIR/sources.list.d/nodesource.sources" "$APT_DIR/sources.list.d/nodesource.list"; do [ -f "$f" ] && SRC="$f"; done
[ -n "$SRC" ] || stop_unchanged "nodesource apt 저장소 설정($APT_DIR/sources.list.d/nodesource.*)이 없습니다."
grep -q 'node_22.x' "$SRC" || stop_unchanged "$SRC 가 node_22.x 저장소가 아닙니다."
PM2_BIN=$(readlink -f "$(command -v pm2 || echo /nonexistent)" 2>/dev/null || true)
case "$PM2_BIN" in
  */lib/node_modules/pm2/*) say "pm2: $PM2_BIN (전역 npm)" ;;
  *) stop_unchanged "pm2 위치가 예상과 다릅니다(${PM2_BIN:-없음})." ;;
esac
for APP in $PM2_APPS; do pm2 describe "$APP" >/dev/null 2>&1 || stop_unchanged "pm2 에 $APP 이 없습니다."; done
FREE_KB=$(df -Pk "$HOME" | awk 'NR==2 {print $4}')
say "디스크 여유: $((FREE_KB / 1024))MB · CPU $(dpkg --print-architecture 2>/dev/null)"
[ "${FREE_KB:-0}" -ge 2000000 ] || stop_unchanged "디스크 여유가 2GB 보다 적습니다."
[ -f .env ] || stop_unchanged ".env 가 없습니다."
ENV_SUM=$(cksum < .env)
DB_FILE=$(grep -E '^DB_PATH=' .env | tail -1 | cut -d= -f2- | tr -d '"'"'")
[ -n "$DB_FILE" ] || DB_FILE="db/alphascope.db"
case "$DB_FILE" in /*) ;; *) DB_FILE="$APP_DIR/$DB_FILE" ;; esac
[ -f "$DB_FILE" ] || stop_unchanged "DB 파일($DB_FILE)이 없습니다."
say "pm2 (AlphaScope 두 줄):"
pm2 jlist 2>/dev/null | node -e '
const want = process.argv[1].split(" "); let s = "";
process.stdin.on("data", (d) => (s += d)).on("end", () => {
  const list = JSON.parse(s.slice(s.indexOf("[")));
  for (const n of want) { const p = list.find((x) => x.name === n); console.log(`    ${n}  ${p ? p.pm2_env.status : "없음"}`); }
});' "$PM2_APPS"

echo "━━━ 2/7 되돌리기 준비 (서버는 그대로 돔) → $BK"
mkdir -p "$BK/apt" "$BK/db" || stop_unchanged "백업 폴더를 만들지 못했습니다."
{
  echo "날짜 $STAMP"; echo "node $OLD_V"; echo "nodejs 패키지 $OLD_PKG"; echo "npm $(npm -v)"; echo "pm2 $(pm2 -v | tail -1)"
  echo "앱 $(git rev-parse --short HEAD)"; echo "DB $DB_FILE"; echo "저장소 설정 $SRC"
} > "$BK/info.txt"
(cd "$BK" && apt-get download "nodejs=$OLD_PKG" >/dev/null 2>&1) && ls "$BK"/nodejs_*.deb >/dev/null 2>&1 \
  || stop_unchanged "되돌리기용 Node 22 패키지(nodejs=$OLD_PKG)를 받지 못했습니다."
say "Node 22 패키지 → $(basename "$BK"/nodejs_*.deb)"
: > "$BK/apt-paths.txt"
for f in "$APT_DIR/sources.list.d/nodesource.list" "$APT_DIR/sources.list.d/nodesource.sources" \
  "$APT_DIR/preferences.d/nodejs" "$APT_DIR/preferences.d/nsolid"; do
  if [ -f "$f" ]; then cp "$f" "$BK/apt/$(basename "$f")" && echo "$(basename "$f")|$f" >> "$BK/apt-paths.txt"; fi
done
for d in $KEYRING_DIRS; do
  f="$d/nodesource.gpg"
  if [ -f "$f" ]; then
    n="nodesource.gpg.$(echo "$d" | tr '/' '_')"
    cp "$f" "$BK/apt/$n" && echo "$n|$f" >> "$BK/apt-paths.txt"
  fi
done
say "apt 설정 $(wc -l < "$BK/apt-paths.txt" | tr -d ' ')개 → $BK/apt"
curl -fsSL https://deb.nodesource.com/setup_24.x -o "$BK/nodesource_setup_24.sh" || stop_unchanged "nodesource 설치 스크립트(setup_24.x)를 받지 못했습니다."
pm2 save >/dev/null && cp "$HOME/.pm2/dump.pm2" "$BK/dump.pm2" 2>/dev/null
say "pm2 save · 목록 사본 → $BK/dump.pm2"

echo "━━━ 3/7 Node 24 설치 (서버는 켠 채로 — 돌고 있는 프로그램은 다시 켤 때까지 옛 Node 로 돈다)"
NODE_CHANGED=1
sudo -E bash "$BK/nodesource_setup_24.sh" > "$BK/nodesource_setup.log" 2>&1 || fail "nodesource 저장소 설정에 실패했습니다($BK/nodesource_setup.log)."
sudo apt-get install -y --allow-downgrades "nodejs=$NODE24_PKG" > "$BK/apt-install.log" 2>&1 || fail "nodejs $NODE24_PKG 설치에 실패했습니다($BK/apt-install.log)."
[ "$(node -v)" = "$NODE24_V" ] || fail "설치 뒤 node 가 $NODE24_V 가 아닙니다($(node -v))."
pm2 -v >/dev/null 2>&1 || fail "Node 24 에서 pm2 명령이 돌지 않습니다."
say "node $(node -v) · npm $(npm -v)"

echo "━━━ 4/7 새 node_modules 설치 (옆 폴더 — 서버는 켠 채로)"
mkdir -p "$STAGE" && cp package.json package-lock.json "$STAGE/" || fail "설치 폴더를 만들지 못했습니다."
T0=$(date +%s)
(cd "$STAGE" && npm ci --no-audit --no-fund > "$BK/npm-ci.log" 2>&1) || fail "npm ci 에 실패했습니다($BK/npm-ci.log)."
(cd "$STAGE" && node -e 'const D = require("better-sqlite3"); new D(":memory:").prepare("select 1").get();') \
  || fail "Node 24 에서 better-sqlite3 가 열리지 않습니다(미리 빌드된 파일을 받지 못했을 수 있음 — $BK/npm-ci.log)."
[ -x "$STAGE/node_modules/.bin/tsx" ] || fail "tsx 가 설치되지 않았습니다."
say "npm ci $(( $(date +%s) - T0 ))초 · better-sqlite3 열림"

echo "━━━ 5/7 AlphaScope 두 프로그램만 멈춤 → DB 백업 → node_modules 바꿈 → 다시 켬"
T1=$(date +%s)
# 다시 켠 뒤에 새로 쌓인 로그만 보려고 지금 길이를 적어 둔다(옛 오류 줄로 되돌리지 않게)
LOG_OUT="$PM2_LOG_DIR/alphascope-api-out.log"; LOG_ERR="$PM2_LOG_DIR/alphascope-api-error.log"
OUT0=$(wc -c < "$LOG_OUT" 2>/dev/null || echo 0); ERR0=$(wc -c < "$LOG_ERR" 2>/dev/null || echo 0)
APPS_STOPPED=1
for APP in $PM2_APPS; do pm2 stop "$APP" >/dev/null || fail "pm2 stop $APP 실패."; done
# 멈춘 뒤 DB 를 WAL 째로 복사한다(-wal · -shm 이 있으면 함께 — 셋을 같이 두면 그 순간 그대로 열린다)
for x in "" -wal -shm; do
  if [ -f "$DB_FILE$x" ]; then cp -p "$DB_FILE$x" "$BK/db/" || fail "DB 백업 실패($DB_FILE$x)."; fi
done
say "DB → $BK/db/ ($(du -sh "$BK/db" | cut -f1))"
mv "$APP_DIR/node_modules" "$BK/node_modules.node22" || fail "옛 node_modules 를 옮기지 못했습니다."
MODULES_SWAPPED=1
mv "$STAGE/node_modules" "$APP_DIR/node_modules" || fail "새 node_modules 를 넣지 못했습니다."
for APP in $PM2_APPS; do pm2 restart "$APP" >/dev/null || fail "pm2 restart $APP 실패."; done

echo "━━━ 6/7 확인"
wait_api || fail "API(127.0.0.1:4000/api/version)가 60초 안에 응답하지 않습니다."
say "API 응답 200 · 멈춘 시간 약 $(( $(date +%s) - T1 ))초"
API_PID=$(pm2 pid alphascope-api 2>/dev/null | tail -1)
RUN_V=$("$PROC_DIR/$API_PID/exe" -v 2>/dev/null || true)
[ "$RUN_V" = "$NODE24_V" ] || fail "alphascope-api 가 Node 24 로 돌지 않습니다(돌고 있는 node: ${RUN_V:-모름} · pid ${API_PID:-없음})."
say "alphascope-api 가 쓰는 node: $RUN_V"
sleep 10
STATUS=$(pm2 jlist 2>/dev/null | node -e '
const want = process.argv[1].split(" "); let s = "";
process.stdin.on("data", (d) => (s += d)).on("end", () => {
  const list = JSON.parse(s.slice(s.indexOf("[")));
  console.log(want.map((n) => { const p = list.find((x) => x.name === n); return `${n}=${p ? p.pm2_env.status : "없음"}`; }).join(" "));
});' "$PM2_APPS")
say "pm2: $STATUS"
case "$STATUS" in *"alphascope-api=online"*"alphascope-indicators=online"*) ;; *) fail "pm2 상태가 online 이 아닙니다($STATUS)." ;; esac
NEW_LOG=$( { tail -c +$((OUT0 + 1)) "$LOG_OUT" 2>/dev/null; tail -c +$((ERR0 + 1)) "$LOG_ERR" 2>/dev/null; } )
if echo "$NEW_LOG" | grep -E 'NODE_MODULE_VERSION|was compiled against a different Node|ERR_DLOPEN_FAILED|Cannot find module' >/dev/null; then
  fail "다시 켠 뒤 pm2 로그에 네이티브 부품 · 모듈 오류가 있습니다(pm2 logs alphascope-api --lines 60)."
fi
say "pm2 로그(다시 켠 뒤 $(echo "$NEW_LOG" | grep -c .)줄): 네이티브 부품 · 모듈 오류 없음"
[ "$(cksum < .env)" = "$ENV_SUM" ] || fail ".env 가 바뀌었습니다(스위치)."
say "스위치(.env) 그대로"

echo "━━━ 7/7 빌드 · 화면 복사 · $PUBLIC_PORT 확인"
npm run build > "$BK/build.log" 2>&1 || fail "빌드에 실패했습니다($BK/build.log)."
cp -a "$WEB_DIR" "$BK/web" || fail "지금 화면을 백업하지 못했습니다."
WEB_CHANGED=1
rsync -a --delete dist/ "$WEB_DIR/" || fail "화면 복사에 실패했습니다."
sudo nginx -t > "$BK/nginx-t.log" 2>&1 || fail "nginx -t 실패($BK/nginx-t.log)."
sudo systemctl reload nginx || fail "nginx reload 실패."
sleep 1
CODE=$(curl -s -o /dev/null -w '%{http_code}' --resolve "$SERVER_NAME:$PUBLIC_PORT:127.0.0.1" "$PUBLIC_URL/" || true)
API=$(curl -s -o /dev/null -w '%{http_code}' --resolve "$SERVER_NAME:$PUBLIC_PORT:127.0.0.1" "$PUBLIC_URL/api/version" || true)
say "화면 응답 $CODE · API(/api/version) 응답 $API"
[ "$CODE" = "200" ] && [ "$API" = "200" ] || fail "화면 또는 API 확인에 실패했습니다."
pm2 save >/dev/null
trap - INT TERM

echo ""
echo "완료 — Node 24 ($NODE24_V) · 서버 켜짐 · 오류 없음 · 주소 $PUBLIC_URL"
echo "  · 백업: $BK (DB 사본 · Node 22 패키지 · 옛 node_modules) — 며칠 써 보고 문제가 없으면 지웁니다: rm -rf $BK"
echo "  · 같은 서버의 다른 프로젝트는 건드리지 않았습니다 — 그 프로그램은 다음에 다시 켜질 때부터 Node 24 로 돕니다."
