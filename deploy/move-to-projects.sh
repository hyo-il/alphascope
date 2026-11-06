#!/bin/bash
# AlphaScope — 오라클 홈 폴더 정리: ~/alphascope 와 곁의 파일들을 ~/projects/alphascope/ 한 곳으로 (v2.61.3). **오라클 안에서 손으로 한 번** 돌린다.
#
#   쓰는 법(오라클 안에서):  cd ~/alphascope && git pull --ff-only origin main && bash deploy/move-to-projects.sh
#
# 언제(KST): 토 15:00 ~ 22:30 또는 일 06:00 ~ 17:00 (자동매매 · 매수 판단 · 다시 계산 · 오늘 시황 · 스냅샷이 쉬는 때 · 배포 시간대 안).
#            평일 장중 · 06:30~07:20 · 05:30 앞뒤 · 일요일 03:00(주간 백업) 앞뒤는 피한다.
#
# 새 자리(deploy/paths.sh 한 곳):
#   ~/projects/_common/                 비워 둠
#   ~/projects/alphascope/app/          ← ~/alphascope (git · DB 는 app/db/)
#                        /secrets/      ← ~/secrets (700 · 파일 600) — .env 의 GOOGLE_SA_KEY_FILE 경로도 새 자리로
#                        /scripts/      ← ~/setpw.sh(옮기기만 — 내용을 읽지 않는다) · deploy.sh(저장소 판) · backup.sh(deploy/backup-db.sh 를 부르는 한 줄)
#                        /backups/      db/ ← ~/backups · node24/ · https/ ← 홈의 옛 백업 · nginx/ ← sites-available 의 *.backup-*
#                        /data/         ← ~/alphascope-samples
#   지움(Vite 때): ~/deploy.sh.vite-backup · ~/alphascope/ecosystem.config.cjs.vite-backup · sites-available/alphascope.vite-backup
#
# 순서: 1/6 지금 상태 확인 — 예상과 다르면 **아무것도 바꾸지 않고 멈춤**
#       2/6 되돌리기 준비(~/projects/.move-backup-<날짜>/ — 옮길 것 목록 · crontab · pm2 이름 · cwd · .env 사본 600)
#       3/6 서버를 켠 채로 — 폴더 · 백업 · 데이터 · nginx 옛 백업 · Vite 옛 파일 · 스크립트 · secrets(+ .env 열쇠 경로)
#       4/6 서버 멈춤 구간(짧게) — AlphaScope pm2 두 이름만 멈춤 → 앱 폴더 옮김 → (DB_PATH 가 옛 절대 경로면 새 경로로) → venv 확인
#           → 두 이름 지우고 새 설정으로 시작 → 확인(API 200 · 두 프로그램 online · 로그인(DB) · 스케줄러 · 지표 엔진 · 옛 경로 오류 없음) → pm2 save
#       5/6 crontab 주간 백업 줄을 새 자리로(시각 그대로 — 일요일 03:00)
#       6/6 Vite 옛 파일 지우기 · 알림
# 어느 단계에서 실패해도 **바꾼 것만 거꾸로 되돌리고**(자리 · pm2 · crontab · .env) 서버를 옛 자리에서 다시 켠다.
# pm2 는 AlphaScope 두 이름만 멈추고 켠다(「모두」 명령 없음) · nginx 사이트 설정 · 인증서 · 다른 프로젝트(8081 · project2)는 건드리지 않는다.
# .env 값 · 열쇠 · setpw.sh 내용은 출력하지 않는다(경로 바꾸기는 줄 단위 치환 · 바꾼 줄 개수만 알림).
set -u
umask 077

unset APP_DIR
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
. "$HERE/paths.sh"   # 새 자리(PROJECTS_ROOT · PROJECT_DIR · APP_DIR · SECRETS_DIR · SCRIPTS_DIR · BACKUP_DIR · DATA_DIR)

OLD_APP="$HOME/alphascope"
NGINX_DIR="${NGINX_DIR:-/etc/nginx}"           # 시험(deploy:test)만 임시 폴더로 바꾼다
AVAIL="$NGINX_DIR/sites-available"
PM2_HOME_DIR="${PM2_HOME:-$HOME/.pm2}"
PM2_LOG_DIR="${PM2_LOG_DIR:-$PM2_HOME_DIR/logs}"
# AlphaScope pm2 프로그램 이름 — deploy.sh · ecosystem.config.cjs 와 같아야 한다(npm run deploy:test 가 확인)
PM2_APPS="alphascope-api alphascope-indicators"
API_URL="http://127.0.0.1:4000/api/version"
CRON_OLD="0 3 * * 0 $HOME/backup.sh"
CRON_NEW="0 3 * * 0 $SCRIPTS_DIR/backup.sh"
VENV_CHECK="import pandas, pandas_ta, flask, yfinance, numpy"   # python/requirements.txt 의 패키지
STAMP=$(date +%Y%m%d-%H%M%S)
MB="$PROJECTS_ROOT/.move-backup-$STAMP"

say() { echo "  $*"; }

# ── 되돌리기 — 바꾼 것을 하나 할 때마다 그 반대 명령을 쌓아 두고, 실패하면 거꾸로 돌린다
UNDO=()
push_undo() { local c; printf -v c '%q ' "$@"; UNDO+=("$c"); }
APPS_STOPPED=0
PM2_DELETED=0
PM2_SAVED=0
T_STOP=0

stop_unchanged() {
  echo "  ⚠️ $1"
  echo "  아무것도 바꾸지 않고 멈춥니다. 서버는 지금 그대로 돕니다. 위 내용을 개발 대화에 알려 주세요."
  exit 1
}

# API 응답 기다리기(최대 60초)
wait_api() {
  local _
  for _ in $(seq 1 30); do
    [ "$(curl -s -o /dev/null -w '%{http_code}' "$API_URL" || true)" = "200" ] && return 0
    sleep 2
  done
  return 1
}

# 옛 자리 pm2 로 되돌린다 — 지웠으면 옛 설정으로 다시 시작, 멈추기만 했으면 다시 켬
restore_pm2() {
  local eco="$OLD_APP/ecosystem.config.cjs" APP
  [ -f "$eco" ] || eco="$OLD_APP/deploy/ecosystem.config.cjs"
  for APP in $PM2_APPS; do
    if [ "$PM2_DELETED" = "1" ]; then
      pm2 delete "$APP" >/dev/null 2>&1
      pm2 start "$eco" --only "$APP" >/dev/null 2>&1 || { say "⚠️ pm2 start $APP 실패(옛 설정 $eco)"; continue; }
    else
      pm2 restart "$APP" >/dev/null 2>&1 || { say "⚠️ pm2 restart $APP 실패"; continue; }
    fi
  done
  [ "$PM2_SAVED" = "1" ] && pm2 save >/dev/null 2>&1
  return 0
}

rollback() {
  local i
  echo ""
  echo "━━━ 되돌리기 (바꾼 것만 거꾸로)"
  trap - INT TERM
  for ((i = ${#UNDO[@]} - 1; i >= 0; i--)); do
    eval "${UNDO[i]}" >/dev/null 2>&1 || say "⚠️ 되돌리지 못함: ${UNDO[i]}"
  done
  if [ "$APPS_STOPPED" = "1" ]; then
    if wait_api; then say "AlphaScope 두 프로그램을 옛 자리에서 다시 켰습니다 — API 응답 200"; else say "⚠️ API 가 응답하지 않습니다 — pm2 logs alphascope-api --lines 50"; fi
  fi
  echo ""
  echo "되돌렸습니다 — 옛 자리($OLD_APP)로 돌아갔습니다. 위의 ⚠️ 내용을 개발 대화에 알려 주세요."
  echo "(되돌리기 준비 폴더 $MB 는 남겨 둡니다 — .env 사본이 들어 있으니 확인 뒤 지웁니다: rm -rf $MB)"
  exit 1
}
fail() {
  echo "  ⚠️ $1"
  rollback
}
trap 'fail "중간에 멈췄습니다(Ctrl+C 등)."' INT TERM

# 옮기고 되돌리기를 쌓는다(sudo 가 필요한 nginx 폴더는 move_sudo)
move() {
  mv "$1" "$2" || return 1
  push_undo mv "$2" "$1"
}
move_sudo() {
  local owner
  owner=$(ls -ldn "$1" | awk '{print $3":"$4}')
  sudo mv "$1" "$2" || return 1
  push_undo sudo chown "$owner" "$1"
  push_undo sudo mv "$2" "$1"
  sudo chown "$(id -u):$(id -g)" "$2" || return 1
}
# .env 를 옮기기 전 사본으로 — 앱 폴더가 아직 새 자리면 그쪽 .env 에(되돌리기 순서와 상관없이 맞는 자리)
restore_env() {
  local f="$ENV_OLD"
  [ -d "$OLD_APP" ] || f="$APP_DIR/.env"
  cat "$MB/.env.before" > "$f"
}
make_dir() {
  [ -d "$1" ] && return 0
  mkdir "$1" || return 1
  push_undo rmdir "$1"
}

# .env 한 줄 값(출력하지 않는다 — 변수로만)
env_value() {
  awk -v key="$1" -v q="$(printf "%c%c" 34 39)" '
    index($0, key "=") == 1 { v = substr($0, length(key) + 2) }
    END { if (index(q, substr(v, 1, 1))) v = substr(v, 2); if (length(v) && index(q, substr(v, length(v)))) v = substr(v, 1, length(v) - 1); print v }' "$2"
}
# KEY= 줄의 값이 OLD 로 시작하면 NEW 로 바꾼다 — 바꾼 줄 수만 내보낸다(값은 내보내지 않음)
rewrite_env_prefix() {
  local f="$1" key="$2" old="$3" new="$4" tmp n
  tmp=$(mktemp "$(dirname "$f")/.env.move.XXXXXX") || return 1
  n=$(awk -v key="$key" -v old="$old" -v new="$new" -v out="$tmp" -v q="$(printf "%c%c" 34 39)" '
    BEGIN { n = 0 }
    {
      line = $0
      if (index(line, key "=") == 1) {
        v = substr(line, length(key) + 2); p = ""
        if (length(v) && index(q, substr(v, 1, 1))) { p = substr(v, 1, 1); v = substr(v, 2) }
        if (index(v, old) == 1) { line = key "=" p new substr(v, length(old) + 1); n++ }
      }
      print line > out
    }
    END { print n }' "$f") || { rm -f "$tmp"; return 1; }
  cat "$tmp" > "$f" && rm -f "$tmp" && echo "$n"
}
# pm2 jlist 에서 AlphaScope 두 줄 — 「이름|상태|cwd」
pm2_rows() {
  pm2 jlist 2>/dev/null | node -e '
const want = process.argv[1].split(" "); let s = "";
process.stdin.on("data", (d) => (s += d)).on("end", () => {
  let list = [];
  try { list = JSON.parse(s.slice(s.indexOf("["))); } catch {}
  for (const n of want) { const p = list.find((x) => x.name === n); console.log(p ? `${n}|${p.pm2_env.status}|${p.pm2_env.pm_cwd}` : `${n}|없음|`); }
});' "$PM2_APPS"
}

echo "AlphaScope 오라클 폴더 정리 — ~/alphascope → $PROJECT_DIR/app"
echo "추천 시간: 토 15:00 ~ 22:30 또는 일 06:00 ~ 17:00 KST · 서버가 멈추는 때는 4/6 의 짧은 구간뿐(보통 20~40초)"
echo ""
echo "━━━ 1/6 지금 상태 확인 (아무것도 바꾸지 않음)"
cd "$HOME" || stop_unchanged "홈 폴더로 들어가지 못했습니다."
[ "$HERE" = "$OLD_APP/deploy" ] || stop_unchanged "이 스크립트는 $OLD_APP/deploy 에서 돌려야 합니다(지금 $HERE)."
[ -d "$OLD_APP/.git" ] || stop_unchanged "$OLD_APP 가 git 저장소가 아닙니다."
if [ -e "$PROJECTS_ROOT" ]; then
  OTHER=$(ls -A "$PROJECTS_ROOT" | grep -v '^\.move-backup-' || true)
  [ -z "$OTHER" ] || stop_unchanged "$PROJECTS_ROOT 가 이미 있고 안에 다른 것이 있습니다: $(echo $OTHER)"
fi
UNKNOWN=""
for p in "$HOME"/*; do
  [ -e "$p" ] || continue
  n=$(basename "$p")
  case "$n" in
    alphascope | deploy.sh | backup.sh | backups | secrets | setpw.sh | alphascope-samples | snap | deploy.sh.vite-backup | projects) ;;
    alphascope-https-backup-* | alphascope-node24-backup-*) [ -d "$p" ] || UNKNOWN="$UNKNOWN $n" ;;
    alphascope-iptables-INPUT.backup-*.txt) [ -f "$p" ] || UNKNOWN="$UNKNOWN $n" ;;
    *) UNKNOWN="$UNKNOWN $n" ;;
  esac
done
[ -z "$UNKNOWN" ] || stop_unchanged "홈 폴더에 예상 밖의 것이 있습니다:$UNKNOWN"
for f in deploy.sh backup.sh setpw.sh; do [ -f "$HOME/$f" ] || stop_unchanged "~/$f 가 없습니다."; done
for d in backups secrets; do [ -d "$HOME/$d" ] || stop_unchanged "~/$d 폴더가 없습니다."; done
grep -q 'alphascope/db/alphascope.db' "$HOME/backup.sh" || stop_unchanged "~/backup.sh 가 예상(alphascope/db/alphascope.db 복사)과 다릅니다."
[ "$(df -P "$HOME" | awk 'NR==2 {print $1}')" = "$(df -P "$OLD_APP" | awk 'NR==2 {print $1}')" ] \
  || stop_unchanged "$OLD_APP 가 홈과 다른 디스크에 있습니다(옮기기가 복사가 되어 오래 걸림)."
# crontab — 주간 백업 한 줄뿐이어야 한다(주석 · 빈 줄 빼고)
CRON_NOW=$(crontab -l 2>/dev/null || true)
CRON_LINES=$(echo "$CRON_NOW" | grep -vE '^[[:space:]]*(#|$)' || true)
[ "$CRON_LINES" = "$CRON_OLD" ] || stop_unchanged "crontab 이 예상(「${CRON_OLD}」 한 줄)과 다릅니다."
# pm2 — 두 이름이 옛 자리에서 online
ROWS=$(pm2_rows)
[ "$(echo "$ROWS" | grep -c '|online|')" = "2" ] || stop_unchanged "pm2 의 AlphaScope 두 프로그램이 online 이 아닙니다: $(echo $ROWS)"
echo "$ROWS" | grep -Fqx "alphascope-api|online|$OLD_APP" && echo "$ROWS" | grep -Fqx "alphascope-indicators|online|$OLD_APP/python" \
  || stop_unchanged "pm2 의 cwd 가 예상($OLD_APP · $OLD_APP/python)과 다릅니다."
[ "$(curl -s -o /dev/null -w '%{http_code}' "$API_URL" || true)" = "200" ] || stop_unchanged "지금 API($API_URL)가 200 이 아닙니다 — 옮기기 전 서버가 정상이어야 합니다."
# .env — 값은 출력하지 않는다
ENV_OLD="$OLD_APP/.env"
[ -f "$ENV_OLD" ] || stop_unchanged ".env 가 없습니다."
DB_PATH_V=$(env_value DB_PATH "$ENV_OLD")
DB_REWRITE=0
case "$DB_PATH_V" in
  "") DB_FILE_OLD="$OLD_APP/db/alphascope.db" ;;
  "$OLD_APP"/*) DB_REWRITE=1; DB_FILE_OLD="$DB_PATH_V" ;;
  "$HOME"/*) stop_unchanged ".env 의 DB_PATH 가 앱 폴더 밖 홈 폴더 경로입니다(예상과 다름 — 값은 보이지 않음)." ;;
  /*) DB_FILE_OLD="$DB_PATH_V" ;;
  *) DB_FILE_OLD="$OLD_APP/${DB_PATH_V#./}" ;;
esac
[ -f "$DB_FILE_OLD" ] || stop_unchanged ".env 의 DB_PATH 가 가리키는 DB 파일이 없습니다."
KEY_V=$(env_value GOOGLE_SA_KEY_FILE "$ENV_OLD")
KEY_REWRITE=0
KEY_EXISTED=0
case "$KEY_V" in
  "") ;;
  "$HOME/secrets"/*) KEY_REWRITE=1; [ -f "$KEY_V" ] && KEY_EXISTED=1 ;;
  "$HOME"/*) stop_unchanged ".env 의 GOOGLE_SA_KEY_FILE 이 ~/secrets 밖 홈 폴더 경로입니다(예상과 다름 — 값은 보이지 않음)." ;;
  *) [ -f "$KEY_V" ] && KEY_EXISTED=1 ;;
esac
# 그 밖의 줄에 옛 홈 경로가 있으면 멈춘다(키 이름만 보인다)
OTHER_KEYS=$(awk -v home="$HOME/" -F= 'index($0, "DB_PATH=") != 1 && index($0, "GOOGLE_SA_KEY_FILE=") != 1 && index($0, home) { print $1 }' "$ENV_OLD" | tr '\n' ' ')
[ -z "$OTHER_KEYS" ] || stop_unchanged ".env 의 다른 줄에도 홈 폴더 경로가 있습니다(키: $OTHER_KEYS)."
INDICATORS_PORT_V=$(env_value INDICATORS_PORT "$ENV_OLD"); INDICATORS_PORT_V="${INDICATORS_PORT_V:-5001}"
ENV_SUM=$(cksum < "$ENV_OLD")
# venv — 지금 도는지 · 다시 만들 때 쓸 파이썬
VENV="$OLD_APP/python/.venv"
[ -x "$VENV/bin/python" ] || stop_unchanged "$VENV/bin/python 이 없습니다."
"$VENV/bin/python" -c "$VENV_CHECK" >/dev/null 2>&1 || stop_unchanged "지금 venv 에서 파이썬 패키지가 열리지 않습니다(옮기기 전부터 문제)."
VENV_BASE=$(awk -F' = ' '$1 == "executable" { print $2 }' "$VENV/pyvenv.cfg" 2>/dev/null)
[ -n "$VENV_BASE" ] || VENV_BASE="$(awk -F' = ' '$1 == "home" { print $2 }' "$VENV/pyvenv.cfg" 2>/dev/null)/python3"
# nginx — sites-available 의 옛 백업 · Vite 파일(sites-enabled 가 가리키면 멈춤)
NGX_BACKUPS=()
for p in "$AVAIL"/alphascope.backup-* "$AVAIL"/alphascope-acme.backup-* "$AVAIL"/alphascope-enabled-file.backup-* "$AVAIL"/alphascope-acme-enabled-file.backup-*; do
  [ -f "$p" ] && NGX_BACKUPS+=("$p")
done
VITE_NGX="$AVAIL/alphascope.vite-backup"
for e in "$NGINX_DIR"/sites-enabled/*; do
  [ -L "$e" ] || continue
  t=$(readlink "$e")
  for p in ${NGX_BACKUPS[@]+"${NGX_BACKUPS[@]}"} "$VITE_NGX"; do
    [ "$t" = "$p" ] || [ "$t" = "../sites-available/$(basename "$p")" ] && stop_unchanged "sites-enabled/$(basename "$e") 가 옮길 파일 $(basename "$p") 를 가리킵니다."
  done
done
say "pm2: $(echo $ROWS) · API 200 · crontab 한 줄 · DB 있음 · venv 열림"
say "옮길 nginx 옛 백업 ${#NGX_BACKUPS[@]}개 · .env 바꿀 줄: DB_PATH $([ "$DB_REWRITE" = 1 ] && echo 바꿈 || echo 그대로) · GOOGLE_SA_KEY_FILE $([ "$KEY_REWRITE" = 1 ] && echo 바꿈 || echo 그대로)"

echo "━━━ 2/6 되돌리기 준비 → $MB"
if [ ! -d "$PROJECTS_ROOT" ]; then
  mkdir "$PROJECTS_ROOT" || stop_unchanged "$PROJECTS_ROOT 를 만들지 못했습니다."
fi
mkdir -m 700 "$MB" || stop_unchanged "$MB 를 만들지 못했습니다."
{
  echo "날짜 $STAMP"; echo "앱 $(git -C "$OLD_APP" rev-parse --short HEAD 2>/dev/null)"
  echo "── 홈"; ls -A "$HOME"
  echo "── sites-available"; ls -A "$AVAIL" 2>/dev/null
} > "$MB/list.txt"
echo "$CRON_NOW" > "$MB/crontab.txt"
echo "$ROWS" > "$MB/pm2.txt"
cp -p "$ENV_OLD" "$MB/.env.before" && chmod 600 "$MB/.env.before" || stop_unchanged ".env 사본을 만들지 못했습니다."
mkdir "$MB/vite" "$MB/old"
say "옮길 것 목록 · crontab · pm2 이름과 cwd · .env 사본(600)"

echo "━━━ 3/6 서버를 켠 채로 — 폴더 · 백업 · 데이터 · nginx 옛 백업 · Vite 옛 파일 · 스크립트 · secrets"
for d in "$PROJECTS_ROOT/_common" "$PROJECT_DIR" "$SCRIPTS_DIR" "$BACKUP_DIR" "$BACKUP_DIR/node24" "$BACKUP_DIR/https" "$BACKUP_DIR/nginx"; do
  make_dir "$d" || fail "$d 를 만들지 못했습니다."
done
move "$HOME/backups" "$BACKUP_DIR/db" || fail "~/backups 를 옮기지 못했습니다."
for p in "$HOME"/alphascope-node24-backup-*; do [ -d "$p" ] && { move "$p" "$BACKUP_DIR/node24/$(basename "$p")" || fail "$p 를 옮기지 못했습니다."; }; done
for p in "$HOME"/alphascope-https-backup-* "$HOME"/alphascope-iptables-INPUT.backup-*.txt; do [ -e "$p" ] && { move "$p" "$BACKUP_DIR/https/$(basename "$p")" || fail "$p 를 옮기지 못했습니다."; }; done
if [ -d "$HOME/alphascope-samples" ]; then
  move "$HOME/alphascope-samples" "$DATA_DIR" || fail "~/alphascope-samples 를 옮기지 못했습니다."
else
  make_dir "$DATA_DIR" || fail "$DATA_DIR 를 만들지 못했습니다."
fi
say "백업 → $BACKUP_DIR (db · node24 · https) · 데이터 → $DATA_DIR"
for p in ${NGX_BACKUPS[@]+"${NGX_BACKUPS[@]}"}; do move_sudo "$p" "$BACKUP_DIR/nginx/$(basename "$p")" || fail "$p 를 옮기지 못했습니다."; done
say "nginx 옛 백업 ${#NGX_BACKUPS[@]}개 → $BACKUP_DIR/nginx (사이트 설정 alphascope · alphascope-acme 는 그대로)"
# Vite 옛 파일 — 끝(6/6)에서 지운다. 그 전에 실패하면 제자리로
[ -f "$HOME/deploy.sh.vite-backup" ] && { move "$HOME/deploy.sh.vite-backup" "$MB/vite/deploy.sh.vite-backup" || fail "Vite 옛 파일을 옮기지 못했습니다."; }
[ -f "$OLD_APP/ecosystem.config.cjs.vite-backup" ] && { move "$OLD_APP/ecosystem.config.cjs.vite-backup" "$MB/vite/ecosystem.config.cjs.vite-backup" || fail "Vite 옛 파일을 옮기지 못했습니다."; }
[ -f "$VITE_NGX" ] && { move_sudo "$VITE_NGX" "$MB/vite/alphascope.vite-backup" || fail "Vite 옛 파일을 옮기지 못했습니다."; }
say "Vite 옛 파일 $(ls -A "$MB/vite" | wc -l | tr -d ' ')개 → 끝에서 지움"
# 스크립트 — setpw.sh 는 옮기기만(읽지 않음) · deploy.sh 는 저장소 판 · backup.sh 는 deploy/backup-db.sh 를 부르는 한 줄
move "$HOME/setpw.sh" "$SCRIPTS_DIR/setpw.sh" || fail "~/setpw.sh 를 옮기지 못했습니다."
move "$HOME/deploy.sh" "$MB/old/deploy.sh" || fail "~/deploy.sh 를 옮기지 못했습니다."
move "$HOME/backup.sh" "$MB/old/backup.sh" || fail "~/backup.sh 를 옮기지 못했습니다."
cp "$OLD_APP/deploy/deploy.sh" "$SCRIPTS_DIR/deploy.sh" && chmod 755 "$SCRIPTS_DIR/deploy.sh" || fail "새 deploy.sh 를 넣지 못했습니다."
push_undo rm -f "$SCRIPTS_DIR/deploy.sh"
cat > "$SCRIPTS_DIR/backup.sh" <<'EOS' && chmod 755 "$SCRIPTS_DIR/backup.sh" || fail "새 backup.sh 를 넣지 못했습니다."
#!/bin/bash
# AlphaScope 주간 DB 백업 — crontab(일요일 03:00)이 부른다. 하는 일은 저장소 app/deploy/backup-db.sh(온라인 백업 · integrity_check · 30일).
exec bash "$(cd "$(dirname "$0")" && pwd)/../app/deploy/backup-db.sh"
EOS
push_undo rm -f "$SCRIPTS_DIR/backup.sh"
say "스크립트 → $SCRIPTS_DIR (setpw.sh 옮김 · deploy.sh 저장소 판 · backup.sh 새 한 줄 · 옛 deploy.sh · backup.sh 는 $MB/old)"
# 앱 폴더 맨 위 pm2 설정 사본 — 이제 deploy/ecosystem.config.cjs 를 그대로 쓴다
[ -f "$OLD_APP/ecosystem.config.cjs" ] && { move "$OLD_APP/ecosystem.config.cjs" "$MB/old/ecosystem.config.cjs" || fail "옛 pm2 설정 사본을 옮기지 못했습니다."; }
# secrets — 서버가 다시 켜질 때까지(4/6) 자산 관리만 잠깐 열쇠를 못 찾는다
push_undo restore_env
move "$HOME/secrets" "$SECRETS_DIR" || fail "~/secrets 를 옮기지 못했습니다."
chmod 700 "$SECRETS_DIR" && find "$SECRETS_DIR" -type f -exec chmod 600 {} + || fail "secrets 권한(700 · 600)을 맞추지 못했습니다."
if [ "$KEY_REWRITE" = "1" ]; then
  N=$(rewrite_env_prefix "$ENV_OLD" GOOGLE_SA_KEY_FILE "$HOME/secrets/" "$SECRETS_DIR/") || fail ".env 의 GOOGLE_SA_KEY_FILE 을 바꾸지 못했습니다."
  [ "$N" = "1" ] || fail ".env 의 GOOGLE_SA_KEY_FILE 바꾼 줄이 1 이 아닙니다($N)."
  say "secrets → $SECRETS_DIR (700 · 600) · .env GOOGLE_SA_KEY_FILE ${N}줄 바꿈(값은 보이지 않음)"
else
  say "secrets → $SECRETS_DIR (700 · 600) · .env 의 열쇠 경로는 그대로"
fi

echo "━━━ 4/6 서버 멈춤 구간 — AlphaScope 두 프로그램만 멈춤 → 앱 폴더 옮김 → 새 설정으로 켬"
LOG_OUT="$PM2_LOG_DIR/alphascope-api-out.log"; LOG_ERR="$PM2_LOG_DIR/alphascope-api-error.log"; LOG_IND="$PM2_LOG_DIR/alphascope-indicators-error.log"
OUT0=$(wc -c 2>/dev/null < "$LOG_OUT" || echo 0); ERR0=$(wc -c 2>/dev/null < "$LOG_ERR" || echo 0); IND0=$(wc -c 2>/dev/null < "$LOG_IND" || echo 0)
OUT0=$(echo $OUT0); ERR0=$(echo $ERR0); IND0=$(echo $IND0)
SCHED_BEFORE=$(head -c "$OUT0" "$LOG_OUT" 2>/dev/null | grep -oE '자동매매 스케줄러 준비됨|자동매매 스케줄러를 시작하지 않습니다' | tail -1)
T_STOP=$(date +%s)
APPS_STOPPED=1
push_undo restore_pm2
for APP in $PM2_APPS; do pm2 stop "$APP" >/dev/null || fail "pm2 stop $APP 실패."; done
move "$OLD_APP" "$APP_DIR" || fail "$OLD_APP 를 $APP_DIR 로 옮기지 못했습니다."
push_undo restore_env   # 되돌릴 때 앱 폴더를 옛 자리로 돌리기 전에 .env 부터(옛 pm2 가 옛 .env 로 켜지게)
ENV_NEW="$APP_DIR/.env"
if [ "$DB_REWRITE" = "1" ]; then
  N=$(rewrite_env_prefix "$ENV_NEW" DB_PATH "$OLD_APP/" "$APP_DIR/") || fail ".env 의 DB_PATH 를 바꾸지 못했습니다."
  [ "$N" = "1" ] || fail ".env 의 DB_PATH 바꾼 줄이 1 이 아닙니다($N)."
  say ".env DB_PATH ${N}줄 바꿈(옛 절대 경로 → 새 자리 · 값은 보이지 않음)"
else
  say ".env DB_PATH 그대로(상대 경로 또는 앱 폴더 밖)"
fi
case "$DB_FILE_OLD" in "$OLD_APP"/*) DB_FILE_NEW="$APP_DIR/${DB_FILE_OLD#"$OLD_APP"/}" ;; *) DB_FILE_NEW="$DB_FILE_OLD" ;; esac
[ -f "$DB_FILE_NEW" ] || fail "새 자리에 DB 파일이 없습니다."
# venv — 옮긴 venv 는 python 은 돌지만 bin/pip 같은 실행 파일 첫 줄에 옛 경로가 남는다(배포는 python -m pip 로 부른다).
# 파이썬 공식 문서: venv 는 옮기는 것을 전제로 하지 않는다 — 깨졌으면 새 자리에서 다시 만든다(python -m venv · pip install -r requirements.txt).
NEW_VENV="$APP_DIR/python/.venv"
if "$NEW_VENV/bin/python" -c "$VENV_CHECK" >/dev/null 2>&1 && "$NEW_VENV/bin/python" -m pip --version >/dev/null 2>&1; then
  say "venv: 옮긴 그대로 열림(패키지 · python -m pip)"
else
  say "venv: 옮긴 뒤 열리지 않아 새 자리에서 다시 만듭니다($VENV_BASE -m venv — 몇 분 걸릴 수 있음)"
  move "$NEW_VENV" "$APP_DIR/python/.venv.moved" || fail "옮긴 venv 를 비켜 두지 못했습니다."
  push_undo rm -rf "$NEW_VENV"
  "$VENV_BASE" -m venv "$NEW_VENV" > "$MB/venv.log" 2>&1 \
    && "$NEW_VENV/bin/python" -m pip install -r "$APP_DIR/python/requirements.txt" >> "$MB/venv.log" 2>&1 \
    && "$NEW_VENV/bin/python" -c "$VENV_CHECK" >/dev/null 2>&1 \
    || fail "venv 를 다시 만들지 못했습니다($MB/venv.log)."
  say "venv: 다시 만듦 — 옛것은 $APP_DIR/python/.venv.moved (확인 뒤 지움)"
fi
ECO_NEW="$APP_DIR/deploy/ecosystem.config.cjs"
APP_REAL=$(cd "$APP_DIR" && pwd -P)   # pm2 설정은 자리를 이 파일 위치(링크를 푼 실제 경로)에서 계산한다
ECO_CWD=$(node -e 'const e = require(process.argv[1]); console.log(e.apps.map((a) => `${a.name}|${a.cwd}`).join(" "))' "$ECO_NEW" 2>/dev/null)
[ "$ECO_CWD" = "alphascope-api|$APP_REAL alphascope-indicators|$APP_REAL/python" ] || fail "새 pm2 설정의 cwd 가 새 자리가 아닙니다($ECO_CWD)."
PM2_DELETED=1
for APP in $PM2_APPS; do
  pm2 delete "$APP" >/dev/null || fail "pm2 delete $APP 실패."
  pm2 start "$ECO_NEW" --only "$APP" >/dev/null || fail "pm2 start $APP 실패(새 설정)."
done

echo "━━━ 확인"
wait_api || fail "API($API_URL)가 60초 안에 응답하지 않습니다."
DOWN=$(( $(date +%s) - T_STOP ))
say "API 응답 200 · 서버가 멈춘 시간 약 ${DOWN}초"
# 서버 기동 로그 — 「로그인 사용 중」 = 새 자리 DB 를 열고 비밀번호가 있음(빈 새 DB 면 「비밀번호가 설정되지 않아」) · 스케줄러 줄
for _ in $(seq 1 15); do
  NEW_OUT=$(tail -c +$((OUT0 + 1)) "$LOG_OUT" 2>/dev/null)
  echo "$NEW_OUT" | grep -qE '자동매매 스케줄러 (준비됨|를 시작하지 않습니다)' && break
  sleep 2
done
echo "$NEW_OUT" | grep -q '로그인 사용 중' || fail "기동 로그에 「로그인 사용 중」 이 없습니다 — DB 를 열지 못했거나 다른 DB 를 열었습니다(pm2 logs alphascope-api --lines 60)."
SCHED_AFTER=$(echo "$NEW_OUT" | grep -oE '자동매매 스케줄러 준비됨|자동매매 스케줄러를 시작하지 않습니다' | tail -1)
[ -n "$SCHED_AFTER" ] || fail "기동 로그에 자동매매 스케줄러 줄이 없습니다."
[ -z "$SCHED_BEFORE" ] || [ "$SCHED_BEFORE" = "$SCHED_AFTER" ] || fail "자동매매 스케줄러가 옮기기 전과 다릅니다(전: $SCHED_BEFORE · 지금: $SCHED_AFTER)."
say "로그인 사용 중(DB 열림) · $SCHED_AFTER"
IND=""
for _ in $(seq 1 30); do
  IND=$(curl -s -o /dev/null -w '%{http_code}' "http://127.0.0.1:$INDICATORS_PORT_V/health" || true)
  [ "$IND" = "200" ] && break
  sleep 2
done
[ "$IND" = "200" ] || fail "지표 엔진(127.0.0.1:$INDICATORS_PORT_V/health)이 응답하지 않습니다($IND)."
say "지표 엔진 /health 200"
sleep 5
ROWS=$(pm2_rows)
echo "$ROWS" | grep -Fqx "alphascope-api|online|$APP_REAL" && echo "$ROWS" | grep -Fqx "alphascope-indicators|online|$APP_REAL/python" \
  || fail "pm2 두 프로그램이 새 자리에서 online 이 아닙니다: $(echo $ROWS)"
say "pm2: $(echo $ROWS)"
NEW_LOG=$( { tail -c +$((OUT0 + 1)) "$LOG_OUT"; tail -c +$((ERR0 + 1)) "$LOG_ERR"; tail -c +$((IND0 + 1)) "$LOG_IND"; } 2>/dev/null )
if echo "$NEW_LOG" | grep -qF -e "$OLD_APP/" -e "$HOME/secrets/"; then fail "다시 켠 뒤 로그에 옛 경로가 나옵니다(pm2 logs alphascope-api --lines 60)."; fi
if echo "$NEW_LOG" | grep -qE 'Cannot find module|ERR_DLOPEN_FAILED|SQLITE_CANTOPEN|unable to open database|EACCES|ModuleNotFoundError|No module named'; then
  fail "다시 켠 뒤 로그에 모듈 · DB · 권한 오류가 있습니다(pm2 logs --lines 60 — AlphaScope 두 이름)."
fi
say "다시 켠 뒤 로그: 옛 경로 · 모듈 · DB · 권한 오류 없음"
[ ! -e "$OLD_APP" ] || fail "옛 자리 $OLD_APP 가 다시 생겼습니다(무언가 옛 경로를 씀)."
if [ "$KEY_EXISTED" = "1" ]; then
  KEY_NOW=$(env_value GOOGLE_SA_KEY_FILE "$ENV_NEW")
  [ -f "$KEY_NOW" ] || fail "자산 관리 열쇠 파일을 새 경로에서 찾지 못했습니다(.env 의 GOOGLE_SA_KEY_FILE)."
  say "자산 관리 열쇠: 새 경로에 있음(값은 보이지 않음)"
fi
# .env 는 경로 두 줄 말고는 그대로여야 한다(스위치 등)
DIFF_LINES=$(diff "$MB/.env.before" "$ENV_NEW" | grep -E '^[<>]' | grep -vE '^[<>] (DB_PATH|GOOGLE_SA_KEY_FILE)=' | wc -l | tr -d ' ')
[ "$DIFF_LINES" = "0" ] || fail ".env 가 경로 줄 말고도 바뀌었습니다(${DIFF_LINES}줄)."
pm2 save >/dev/null || fail "pm2 save 실패."
PM2_SAVED=1
# 재부팅 뒤 켜짐 — pm2 save 가 쓴 목록(dump)에 두 이름이 새 자리로 있어야 한다
DUMP_ROWS=$(node -e '
const fs = require("fs"); const want = process.argv[2].split(" ");
let list = []; try { list = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); } catch {}
console.log(want.map((n) => { const p = list.find((x) => x.name === n); return `${n}|${p ? p.pm_cwd : "없음"}`; }).join(" "));' "$PM2_HOME_DIR/dump.pm2" "$PM2_APPS")
[ "$DUMP_ROWS" = "alphascope-api|$APP_REAL alphascope-indicators|$APP_REAL/python" ] || fail "pm2 save 목록(dump.pm2)이 새 자리가 아닙니다($DUMP_ROWS)."
say "pm2 save · 재부팅 목록(dump.pm2)도 새 자리 · 시작 서비스(pm2 startup): $(systemctl is-enabled "pm2-$(id -un)" 2>/dev/null || echo 모름)"

echo "━━━ 5/6 crontab — 주간 백업 줄을 새 자리로(일요일 03:00 그대로)"
echo "$CRON_NOW" | awk -v old="$CRON_OLD" -v new="$CRON_NEW" '{ print ($0 == old ? new : $0) }' > "$MB/crontab.new"
push_undo crontab "$MB/crontab.txt"
crontab "$MB/crontab.new" || fail "crontab 을 바꾸지 못했습니다."
[ "$(crontab -l 2>/dev/null | grep -vE '^[[:space:]]*(#|$)')" = "$CRON_NEW" ] || fail "바꾼 crontab 이 예상과 다릅니다."
say "crontab: $CRON_NEW"

echo "━━━ 6/6 Vite 옛 파일 지우기 · 알림"
trap - INT TERM
rm -f "$MB/vite/deploy.sh.vite-backup" "$MB/vite/ecosystem.config.cjs.vite-backup"
sudo rm -f "$MB/vite/alphascope.vite-backup"
rmdir "$MB/vite" 2>/dev/null
say "Vite 옛 파일 지움"

echo ""
echo "완료 — 새 자리 $PROJECT_DIR · 서버가 멈춘 시간 약 ${DOWN}초 · 주소 https://161.33.153.189:8080"
echo "  · 배포: ~/projects/alphascope/scripts/deploy.sh   (맥에서: ssh alphascope '~/projects/alphascope/scripts/deploy.sh')"
echo "  · 지우지 않은 것: $BACKUP_DIR (db · node24 · https · nginx) · $MB (되돌리기 준비 — .env 사본 · 옛 deploy.sh · backup.sh)"
echo "  · 사용자가 지울 것(1주쯤 문제없으면): rm -rf $BACKUP_DIR/node24/alphascope-node24-backup-* $MB"
echo "  · ~/setpw.sh 는 $SCRIPTS_DIR/setpw.sh 로 옮기기만 했습니다 — 안에 ~/alphascope 경로가 있으면 직접 새 자리($APP_DIR)로 고칩니다."
exit 0
