#!/bin/bash
# AlphaScope — 저장소의 nginx 설정 두 개를 오라클 nginx 에 넣는다 (v2.60.5 · v2.61.1 https · v2.61.2 주소 8080 · 443 닫음).
#   deploy/nginx-alphascope.conf      → sites-available/alphascope       (https://161.33.153.189:8080 · 같은 문 http → https)
#   deploy/nginx-alphascope-acme.conf → sites-available/alphascope-acme  (80 — 인증서 확인 경로만 · 나머지 끊음)
# 배포(scripts/deploy.sh)는 nginx 설정 파일을 넣지 않는다 — 설정이 바뀌었을 때만 이 스크립트를 **손으로 한 번** 돌린다.
#
#   쓰는 법(오라클 안에서):  cd ~/projects/alphascope/app && git pull --ff-only origin main && bash deploy/apply-nginx.sh
#
# 순서: ⓪ 확인 — 인증서 · 80 확인 경로 설정이 있는지 · 다른 설정 · 프로그램이 443 을 듣지 않는지(하나라도 다르면 **아무것도 바꾸지 않고 멈춤**)
#       → ① 지금 설정 두 개 백업(sites-enabled 밖 · 이름에 날짜) → ② 새 설정 복사 → ③ nginx -t(실패하면 되돌리고 멈춤) → ④ reload
#       → ⑤ 확인(https 8080 화면 · /api/version 200 · http 8080 → 같은 문 https 301 · 443 접속 거절 · 80 확인 파일 200 · 80 그 밖 끊김)
#       → ⑥ 인증서 갱신 연습(certbot renew --dry-run) — ⑤ · ⑥ 이 실패하면 되돌리고 예전 주소를 확인하고 멈춤
#       → ⑦ iptables 의 443 수신 규칙 지우고 저장(이제 안 쓰는 문) → ⑧ 주소 · 되돌리는 명령 알림
# deploy/setup-https.sh 도 이 스크립트를 부른다(실패하면 종료 코드 1 — 그 스크립트가 나머지를 되돌린다).
# 같은 서버의 다른 프로젝트(8081 · sites-available/project2) · default 설정은 읽기만 하고 건드리지 않는다.
set -e

. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/paths.sh"   # 자리(APP_DIR · SCRIPTS_DIR · BACKUP_DIR …)는 deploy/paths.sh 한 곳
SERVER_NAME="161.33.153.189"   # nginx 설정의 server_name 과 같아야 한다
PUBLIC_PORT=8080               # nginx 설정의 listen … ssl 과 같아야 한다(npm run deploy:test 가 확인)
PUBLIC_URL="https://$SERVER_NAME:$PUBLIC_PORT"
ACME_PORT=80                   # 인증서 확인(HTTP-01) — nginx-alphascope-acme.conf 의 listen
RETIRED_PORT=443               # 이제 아무것도 보여 주지 않는 문(문 번호 없는 https 주소) — 접속 거절이어야 한다
NGINX_DIR="${NGINX_DIR:-/etc/nginx}"           # 시험(deploy:test)만 임시 폴더로 바꾼다
LE_DIR="${LE_DIR:-/etc/letsencrypt}"           # 시험만 임시 폴더로 바꾼다
ACME_ROOT="${ACME_ROOT:-/var/www/letsencrypt}" # 시험만 임시 폴더로 바꾼다 — nginx-alphascope-acme.conf 의 root
NGINX_AVAIL="$NGINX_DIR/sites-available/alphascope"
NGINX_ENABLED="$NGINX_DIR/sites-enabled/alphascope"
ACME_AVAIL="$NGINX_DIR/sites-available/alphascope-acme"
ACME_ENABLED="$NGINX_DIR/sites-enabled/alphascope-acme"
STAMP=$(date +%Y%m%d-%H%M%S)
# ⚠️ 백업은 sites-enabled 안에 두지 않는다 — nginx 는 그 폴더의 파일을 전부 읽어 설정이 두 벌이 된다.
# v2.61.3 — 백업은 nginx 폴더가 아니라 관리 루트 backups/nginx/ 에 둔다(이름은 그대로)
NGINX_BK_DIR="$BACKUP_DIR/nginx"
BACKUP="$NGINX_BK_DIR/alphascope.backup-$STAMP"
ENABLED_BACKUP="$NGINX_BK_DIR/alphascope-enabled-file.backup-$STAMP"
ACME_BACKUP="$NGINX_BK_DIR/alphascope-acme.backup-$STAMP"
ACME_ENABLED_BACKUP="$NGINX_BK_DIR/alphascope-acme-enabled-file.backup-$STAMP"
IPT_RULE=(-p tcp --dport "$RETIRED_PORT" -m state --state NEW -j ACCEPT)   # 102차(setup-https.sh)가 더한 규칙과 같은 꼴

cd "$APP_DIR"

stop_unchanged() {
  echo "  ⚠️ $1"
  echo "  아무것도 바꾸지 않고 멈춥니다. 주소는 예전 그대로입니다. 이 글을 개발 대화에 붙여 주세요."
  exit 1
}

# 백업으로 되돌린다(검사 · 확인이 실패했을 때) — 되돌린 뒤 예전 주소가 되는지 확인한다
restore() {
  echo "  백업으로 되돌립니다: $BACKUP · $ACME_BACKUP"
  sudo cp "$BACKUP" "$NGINX_AVAIL"
  if [ -f "$ENABLED_BACKUP" ]; then sudo cp "$ENABLED_BACKUP" "$NGINX_ENABLED"; fi
  sudo cp "$ACME_BACKUP" "$ACME_AVAIL"
  if [ -f "$ACME_ENABLED_BACKUP" ]; then sudo cp "$ACME_ENABLED_BACKUP" "$ACME_ENABLED"; fi
  if ! sudo nginx -t; then
    echo "  ⚠️ 되돌린 설정 검사(nginx -t)도 실패했습니다 — 'sudo nginx -t' 결과를 개발 대화에 붙여 주세요."
    return
  fi
  sudo systemctl reload nginx
  sleep 1
  # 백업이 듣던 https 문(listen N ssl)으로 화면을 물어본다 — 443 이면 문 번호 없는 주소
  local port url code
  port=$(sudo grep -Eo '^[[:space:]]*listen[[:space:]]+([^;]*:)?[0-9]+[[:space:]]+ssl' "$BACKUP" | grep -Eo '[0-9]+[[:space:]]+ssl' | grep -Eo '^[0-9]+' | head -1 || true)
  if [ -z "$port" ]; then
    echo "  되돌렸습니다(예전 설정에 https 문이 없어 화면 확인은 건너뜀). 위의 오류 내용을 알려 주세요."
    return
  fi
  if [ "$port" = "443" ]; then url="https://$SERVER_NAME"; else url="https://$SERVER_NAME:$port"; fi
  code=$(curl -s -o /dev/null -w '%{http_code}' --resolve "$SERVER_NAME:$port:127.0.0.1" "$url/" || true)
  if [ "$code" = "200" ]; then
    echo "  되돌렸습니다 — 예전 주소 $url 가 그대로 됩니다(화면 응답 200). 위의 ⚠️ 줄을 개발 대화에 붙여 주세요."
  else
    echo "  ⚠️ 되돌렸지만 예전 주소 $url 화면 응답이 $code 입니다 — 'sudo nginx -t' 와 백업 $BACKUP 를 확인하세요."
  fi
}
fail() { echo "  ⚠️ $1"; restore; exit 1; }

echo "━━━ 0/7 지금 상태 확인 (아무것도 바꾸지 않음)"
# 인증서가 없으면 새 설정(8080 ssl)은 nginx -t 를 통과하지 못한다 — 바꾸기 전에 멈춘다
sudo test -f "$LE_DIR/live/$SERVER_NAME/fullchain.pem" \
  || stop_unchanged "https 인증서($LE_DIR/live/$SERVER_NAME/)가 아직 없습니다 — 처음이면 bash deploy/setup-https.sh 를 돌리세요."
[ -f "$NGINX_AVAIL" ] \
  || stop_unchanged "$NGINX_AVAIL 이 없습니다 — 처음 설치라면 deploy/README.md 「처음 서버를 완성본 방식으로 바꿀 때」 를 따르세요."
[ -f "$ACME_AVAIL" ] \
  || stop_unchanged "80번 문 확인 경로 설정($ACME_AVAIL)이 없습니다 — 처음이면 bash deploy/setup-https.sh 를 돌리세요."
sudo test -d "$ACME_ROOT/.well-known/acme-challenge" \
  || stop_unchanged "인증서 확인 파일 폴더($ACME_ROOT/.well-known/acme-challenge)가 없습니다."
# 443 을 다른 설정이 들으면, 이 설정에서 443 을 없애도 그 설정이 응답한다(문 번호 없는 주소가 닫히지 않음) — 지우지 않고 알린다
for f in "$NGINX_DIR"/sites-enabled/* "$NGINX_DIR"/conf.d/*.conf; do
  [ -e "$f" ] || continue
  case "$(basename "$f")" in alphascope|alphascope-acme) continue ;; esac
  if sudo grep -Eq "^[[:space:]]*listen[[:space:]]+([^;]*:)?$RETIRED_PORT([^0-9]|$)" "$f"; then
    stop_unchanged "다른 설정($f)이 $RETIRED_PORT 번 문을 듣습니다 — 그대로 두면 문 번호 없는 주소(https://$SERVER_NAME)에 그 설정이 응답합니다. 그 파일을 어떻게 할지 개발 대화에서 정하세요(이 스크립트는 지우지 않습니다)."
  fi
done
L_RETIRED=$(sudo ss -ltnpH "( sport = :$RETIRED_PORT )" 2>/dev/null || true)
if [ -n "$L_RETIRED" ] && ! echo "$L_RETIRED" | grep -q nginx; then
  stop_unchanged "$RETIRED_PORT 번 문을 nginx 가 아닌 프로그램이 듣습니다: $L_RETIRED"
fi
command -v certbot >/dev/null || stop_unchanged "certbot 이 없습니다(갱신 연습을 할 수 없음) — 처음이면 bash deploy/setup-https.sh."
echo "  인증서 있음 · 80 확인 경로 설정 있음 · 다른 설정 · 프로그램이 $RETIRED_PORT 을 듣지 않음"

echo "━━━ 1/7 지금 설정 백업"
mkdir -p "$NGINX_BK_DIR"
sudo cp "$NGINX_AVAIL" "$BACKUP"
sudo cp "$ACME_AVAIL" "$ACME_BACKUP"
echo "  nginx → $BACKUP · $ACME_BACKUP"
# sites-enabled 의 파일이 링크가 아니라 따로 복사된 파일이면, 그 파일도 백업하고 함께 바꾼다(switch-to-static.sh 와 같다)
if [ -f "$NGINX_ENABLED" ] && [ ! -L "$NGINX_ENABLED" ]; then
  sudo cp "$NGINX_ENABLED" "$ENABLED_BACKUP"
  echo "  알림: $NGINX_ENABLED 이 링크가 아니라 파일입니다 — 백업 → $ENABLED_BACKUP"
fi
if [ -f "$ACME_ENABLED" ] && [ ! -L "$ACME_ENABLED" ]; then
  sudo cp "$ACME_ENABLED" "$ACME_ENABLED_BACKUP"
  echo "  알림: $ACME_ENABLED 이 링크가 아니라 파일입니다 — 백업 → $ACME_ENABLED_BACKUP"
fi

echo "━━━ 2/7 새 설정 넣기"
sudo cp deploy/nginx-alphascope.conf "$NGINX_AVAIL"
if [ -f "$ENABLED_BACKUP" ]; then sudo cp deploy/nginx-alphascope.conf "$NGINX_ENABLED"; fi
sudo cp deploy/nginx-alphascope-acme.conf "$ACME_AVAIL"
if [ -f "$ACME_ENABLED_BACKUP" ]; then sudo cp deploy/nginx-alphascope-acme.conf "$ACME_ENABLED"; fi

echo "━━━ 3/7 설정 검사"
sudo nginx -t || fail "새 nginx 설정 검사(nginx -t)에 실패했습니다."

echo "━━━ 4/7 적용"
sudo systemctl reload nginx
sleep 1

echo "━━━ 5/7 확인 ($PUBLIC_URL · http → https · $RETIRED_PORT 닫힘 · 80 확인 경로)"
# --resolve: 이름은 $SERVER_NAME 그대로(인증서 확인 · Host) 두고 이 서버(127.0.0.1)로 묻는다 — 인증서가 틀리거나 만료면 000
CODE=$(curl -s -o /dev/null -w '%{http_code}' --resolve "$SERVER_NAME:$PUBLIC_PORT:127.0.0.1" "$PUBLIC_URL/" || true)
API=$(curl -s -o /dev/null -w '%{http_code}' --resolve "$SERVER_NAME:$PUBLIC_PORT:127.0.0.1" "$PUBLIC_URL/api/version" || true)
# 같은 문에 평문 http — 같은 문의 https 로, 경로 · 물음표 뒤 그대로 301
MOVE=$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' -H "Host: $SERVER_NAME:$PUBLIC_PORT" "http://127.0.0.1:$PUBLIC_PORT/alphascope-check?x=1" || true)
# 443 — 듣는 곳이 없어 접속 거절(curl 종료 코드 7)이어야 한다
R443=$(curl -s -o /dev/null --max-time 5 -w '%{http_code}' --resolve "$SERVER_NAME:$RETIRED_PORT:127.0.0.1" "https://$SERVER_NAME/"; echo " $?")
# 80 — 확인 파일은 읽히고(Let's Encrypt 가 가져가는 자리), 그 밖은 응답 없이 끊김(return 444 → curl 종료 코드 52 Empty reply)
TOKEN="alphascope-check-$STAMP"
echo "$TOKEN" | sudo tee "$ACME_ROOT/.well-known/acme-challenge/$TOKEN" >/dev/null || true
GOT=$(curl -s --max-time 5 -H "Host: $SERVER_NAME" "http://127.0.0.1:$ACME_PORT/.well-known/acme-challenge/$TOKEN" || true)
sudo rm -f "$ACME_ROOT/.well-known/acme-challenge/$TOKEN"
R80=$(curl -s -o /dev/null --max-time 5 -w '%{http_code}' -H "Host: $SERVER_NAME" "http://127.0.0.1:$ACME_PORT/alphascope-check"; echo " $?")
echo "  https $PUBLIC_PORT 화면 $CODE · API(/api/version) $API · http $PUBLIC_PORT → $MOVE"
echo "  $RETIRED_PORT → 응답 코드 · curl 종료 코드 = $R443 (000 7 = 접속 거절) · 80 확인 파일 $([ "$GOT" = "$TOKEN" ] && echo 읽힘 || echo "안 읽힘(${GOT:0:60})") · 80 그 밖 = $R80 (000 52 = 끊김)"
[ "$CODE" = "200" ] && [ "$API" = "200" ] || fail "https 화면 · API 확인에 실패했습니다."
[ "$MOVE" = "301 $PUBLIC_URL/alphascope-check?x=1" ] || fail "http $PUBLIC_PORT → https 넘김이 예상과 다릅니다($MOVE)."
[ "$R443" = "000 7" ] || fail "$RETIRED_PORT 번 문이 닫히지 않았습니다($R443 — 접속 거절이어야 함)."
[ "$GOT" = "$TOKEN" ] || fail "80번 문에서 인증서 확인 파일을 읽지 못했습니다 — 이대로면 자동 갱신이 실패합니다."
[ "$R80" = "000 52" ] || fail "80번 문의 확인 경로 밖이 끊기지 않았습니다($R80)."

echo "━━━ 6/7 인증서 갱신 연습 (certbot renew --dry-run — 스테이징 서버 · 저장 안 함 · 80 webroot 그대로)"
sudo certbot renew --dry-run --cert-name "$SERVER_NAME" || fail "갱신 연습(certbot renew --dry-run)에 실패했습니다 — 이대로면 6일 뒤 인증서가 끝납니다."
echo "  갱신 연습 통과"

echo "━━━ 7/7 iptables $RETIRED_PORT 닫기 (이제 안 쓰는 문)"
mkdir -p "$BACKUP_DIR/https"
IPT_BACKUP="$BACKUP_DIR/https/alphascope-iptables-INPUT.backup-$STAMP.txt"
if sudo iptables -C INPUT "${IPT_RULE[@]}" >/dev/null 2>&1; then
  sudo iptables -S INPUT > "$IPT_BACKUP" 2>/dev/null || true
  while sudo iptables -C INPUT "${IPT_RULE[@]}" >/dev/null 2>&1; do
    sudo iptables -D INPUT "${IPT_RULE[@]}" || { echo "  ⚠️ iptables 에서 $RETIRED_PORT 규칙을 지우지 못했습니다(nginx 는 이미 듣지 않아 접속은 거절됩니다)."; break; }
  done
  if sudo netfilter-persistent save >/dev/null 2>&1; then
    echo "  iptables $RETIRED_PORT 규칙 지우고 저장(재부팅해도 유지) · 지우기 전 목록: $IPT_BACKUP"
  else
    echo "  ⚠️ iptables 저장(netfilter-persistent save)에 실패했습니다 — 재부팅하면 $RETIRED_PORT 규칙이 돌아옵니다(nginx 는 듣지 않아 접속은 거절됩니다)."
  fi
else
  echo "  iptables 에 $RETIRED_PORT 규칙이 없습니다(그대로 둠)"
fi

echo ""
echo "적용 완료 — AlphaScope 주소: $PUBLIC_URL (http://$SERVER_NAME:$PUBLIC_PORT 로 들어와도 같은 문의 https 로 넘어감 · https://$SERVER_NAME 는 접속 거절)"
echo "  · 오라클 웹 콘솔 보안 목록의 $RETIRED_PORT 수신 규칙도 지우세요(80 · 8080 · 8081 · 22 는 그대로) — deploy/README.md 「주소 8080 · 443 닫기」"
echo "  · 배포 스크립트도 새 것으로: cp $APP_DIR/deploy/deploy.sh $SCRIPTS_DIR/deploy.sh"
echo "  · 되돌리기(예전 설정으로):"
echo "      sudo cp $BACKUP $NGINX_AVAIL && sudo cp $ACME_BACKUP $ACME_AVAIL && sudo nginx -t && sudo systemctl reload nginx"
echo "      (예전 설정이 443 이었다면) sudo iptables -I INPUT 6 ${IPT_RULE[*]} && sudo netfilter-persistent save  — 콘솔 보안 목록에도 443 을 다시 더함"
