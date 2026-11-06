#!/bin/bash
# AlphaScope — 오라클을 https(Let's Encrypt IP 인증서)로 바꾼다 (v2.61.1 · v2.61.2 주소 https://161.33.153.189:8080). **손으로 한 번** 돌린다.
#
#   쓰는 법(오라클 안에서):  cd ~/projects/alphascope/app && git pull --ff-only origin main && bash deploy/setup-https.sh
#   그 전에: 오라클 웹 콘솔 보안 목록에 80 수신 규칙을 더한다(8080 은 이미 열림 · deploy/README.md 「https 로 바꾸기」 — 서버 안에서는 열렸는지 알 수 없어 물어본다).
#
# 순서(근거 · 출처: deploy/README.md 「HTTPS 조사」):
#   1/6 지금 상태 확인 — 예상과 다르면 **아무것도 바꾸지 않고 멈춤**
#   2/6 Certbot 설치(snap · 5.4 이상)
#   3/6 문 열기(iptables 80 — 11-03 과 같은 방식 · 8080 은 이미 열림) + 80번 문 확인 경로(nginx-alphascope-acme.conf) + 확인 파일 시험
#   4/6 인증서 받기 — 연습(--dry-run · 스테이징) → 진짜(shortlived · IP · webroot · 갱신 뒤 nginx reload)
#   5/6 새 nginx 설정(8080 https · 같은 문 http → https · 443 없음) — deploy/apply-nginx.sh(백업 · nginx -t · reload · 확인 · 갱신 연습 · 실패하면 되돌림)
#   6/6 자동 갱신 확인(타이머 · 갱신 뒤 nginx reload — 갱신 연습 --dry-run 은 5/6 의 apply-nginx.sh 가 한다)
# 2/6 ~ 6/6 어디서 실패해도 **nginx · iptables · 인증서 · Certbot 을 이 스크립트 전으로 되돌리고** http://161.33.153.189:8080 이 그대로 되는지 확인한다.
# 같은 서버의 다른 프로젝트(8081 · sites-available/project2)는 읽기만 하고 건드리지 않는다. pm2 · 앱 서버는 다시 켜지 않는다.
set -u

. "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/paths.sh"   # 자리(APP_DIR · SCRIPTS_DIR · BACKUP_DIR …)는 deploy/paths.sh 한 곳
SERVER_NAME="161.33.153.189"   # nginx 설정의 server_name 과 같아야 한다
PUBLIC_PORT=8080               # nginx 설정의 listen … ssl 과 같아야 한다(npm run deploy:test 가 확인)
PUBLIC_URL="https://$SERVER_NAME:$PUBLIC_PORT"
OLD_PORT=8080                  # https 전 주소(http://…:8080) — 새 설정에서는 같은 문이 https 가 되고, 평문 http 는 https 로 넘긴다
ACME_PORT=80                   # 인증서 확인(HTTP-01)은 80번 문에서만 된다 — 늘 열어 둔다
MIN_CERTBOT="5.4"              # IP 주소 + webroot 를 지원하는 첫 판(Let's Encrypt 2026-03-11 글)
# 시험(deploy:test)만 아래 자리를 임시 폴더로 바꾼다
NGINX_DIR="${NGINX_DIR:-/etc/nginx}"
LE_DIR="${LE_DIR:-/etc/letsencrypt}"
ACME_ROOT="${ACME_ROOT:-/var/www/letsencrypt}"
CERTBOT_LINK="${CERTBOT_LINK:-/usr/local/bin/certbot}"
NGINX_AVAIL="$NGINX_DIR/sites-available/alphascope"
NGINX_ENABLED="$NGINX_DIR/sites-enabled/alphascope"
ACME_AVAIL="$NGINX_DIR/sites-available/alphascope-acme"
ACME_ENABLED="$NGINX_DIR/sites-enabled/alphascope-acme"
CERT_DIR="$LE_DIR/live/$SERVER_NAME"
STAMP=$(date +%Y%m%d-%H%M%S)
BK="$BACKUP_DIR/https/alphascope-https-backup-$STAMP"
IPT_RULE=(-m state --state NEW -j ACCEPT)   # 11-03 과 같은 규칙(-p tcp --dport <문> 은 따로 붙인다)

# 되돌릴 것 — 바꾼 것만 표시해 두고, 되돌릴 때 그것만 되돌린다
SNAP_INSTALLED=0; LINK_MADE=0; ADDED_PORTS=""; ACME_ADDED=0; ACME_ROOT_MADE=0; CERT_MADE=0; MAIN_TOUCHED=0

say() { echo "  $*"; }
stop_unchanged() {
  say "⚠️ $1"
  say "아무것도 바꾸지 않고 멈춥니다. 주소는 그대로 http://$SERVER_NAME:$OLD_PORT 입니다. 이 글을 개발 대화에 붙여 주세요."
  exit 1
}
ipt_has() { sudo iptables -C INPUT -p tcp --dport "$1" -m state --state NEW -j ACCEPT >/dev/null 2>&1; }

rollback() {
  echo "━━━ 되돌리기 (이 스크립트 전으로)"
  if [ "$MAIN_TOUCHED" = "1" ]; then
    sudo cp "$BK/alphascope.conf" "$NGINX_AVAIL"
    if [ -f "$BK/alphascope-enabled-file.conf" ]; then sudo cp "$BK/alphascope-enabled-file.conf" "$NGINX_ENABLED"; fi
    say "nginx 설정 alphascope ← $BK/alphascope.conf"
  fi
  if [ "$ACME_ADDED" = "1" ]; then
    sudo rm -f "$ACME_ENABLED" "$ACME_AVAIL"
    say "80번 문 확인 경로(alphascope-acme) 지움"
  fi
  if [ "$MAIN_TOUCHED" = "1" ] || [ "$ACME_ADDED" = "1" ]; then
    if sudo nginx -t >/dev/null 2>&1; then sudo systemctl reload nginx; say "nginx 다시 읽음"; else say "⚠️ 되돌린 nginx 설정 검사(nginx -t)가 실패했습니다 — 'sudo nginx -t' 결과를 붙여 주세요."; fi
  fi
  if [ "$CERT_MADE" = "1" ]; then
    sudo certbot delete --non-interactive --cert-name "$SERVER_NAME" >/dev/null 2>&1 && say "받은 인증서 지움(certbot delete)" || say "⚠️ 인증서를 지우지 못했습니다 — 'sudo certbot delete --cert-name $SERVER_NAME'"
  fi
  if [ "$ACME_ROOT_MADE" = "1" ]; then sudo rm -rf "$ACME_ROOT"; say "확인 파일 폴더 지움($ACME_ROOT)"; fi
  if [ -n "$ADDED_PORTS" ]; then
    for p in $ADDED_PORTS; do sudo iptables -D INPUT -p tcp --dport "$p" "${IPT_RULE[@]}"; done
    sudo netfilter-persistent save >/dev/null 2>&1
    say "iptables 에 더한 문($ADDED_PORTS) 지우고 저장"
  fi
  if [ "$LINK_MADE" = "1" ]; then sudo rm -f "$CERTBOT_LINK"; fi
  if [ "$SNAP_INSTALLED" = "1" ]; then sudo snap remove certbot >/dev/null 2>&1; say "이 스크립트가 깐 Certbot(snap) 지움"; fi
  local code
  code=$(curl -s -o /dev/null -w '%{http_code}' -H "Host: $SERVER_NAME:$OLD_PORT" "http://127.0.0.1:$OLD_PORT/" || true)
  if [ "$code" = "200" ]; then
    say "되돌렸습니다 — http://$SERVER_NAME:$OLD_PORT 가 그대로 됩니다(화면 응답 200). 위의 ⚠️ 줄을 개발 대화에 붙여 주세요."
  else
    say "⚠️ 되돌렸지만 http://$SERVER_NAME:$OLD_PORT 화면 응답이 $code 입니다 — 'sudo nginx -t' 와 백업 $BK 를 확인하세요."
  fi
  say "(백업: $BK)"
}
fail() { say "⚠️ $1"; rollback; exit 1; }
trap 'echo; fail "중간에 멈췄습니다(Ctrl+C)."' INT TERM

cd "$APP_DIR" || stop_unchanged "$APP_DIR 이 없습니다."

echo "━━━ 1/6 지금 상태 확인 (아무것도 바꾸지 않음)"
[ -f deploy/nginx-alphascope.conf ] && [ -f deploy/nginx-alphascope-acme.conf ] && [ -f deploy/apply-nginx.sh ] || stop_unchanged "저장소에 새 설정 파일이 없습니다 — 'git pull --ff-only origin main' 을 먼저 하세요."
command -v nginx >/dev/null || stop_unchanged "nginx 가 없습니다."
[ "$(systemctl is-active nginx 2>/dev/null)" = "active" ] || stop_unchanged "nginx 가 돌고 있지 않습니다."
[ -f "$NGINX_AVAIL" ] || stop_unchanged "$NGINX_AVAIL 이 없습니다."
if grep -Eq '^[[:space:]]*listen[[:space:]]+[^;]*[[:space:]]ssl([[:space:];]|$)' "$NGINX_AVAIL"; then
  say "이미 https 설정입니다 — 할 일이 없습니다. 상태: bash deploy/check-https.sh"
  exit 0
fi
grep -Eq "^[[:space:]]*listen[[:space:]]+$OLD_PORT;" "$NGINX_AVAIL" && grep -q 'proxy_pass http://127.0.0.1:4000' "$NGINX_AVAIL" \
  || stop_unchanged "$NGINX_AVAIL 이 예상한 모양(listen $OLD_PORT · /api/ → 127.0.0.1:4000)이 아닙니다."
[ -e "$ACME_AVAIL" ] || [ -e "$ACME_ENABLED" ] && stop_unchanged "이전 시도의 $ACME_AVAIL 이 남아 있습니다."
sudo test -e "$CERT_DIR" && stop_unchanged "인증서 폴더 $CERT_DIR 가 이미 있습니다(이전 시도?) — 'sudo certbot certificates' 결과를 붙여 주세요."
# 다른 사이트(8081 project2 등)는 읽기만 한다 — 8080 을 쓰거나, 80 에서 같은 server_name 을 쓰면 겹친다(443 을 쓰는 설정은 5/6 apply-nginx.sh 가 확인)
for f in "$NGINX_DIR"/sites-enabled/*; do
  [ -e "$f" ] || continue
  case "$(basename "$f")" in alphascope|alphascope-acme) continue ;; esac
  if grep -Eq "^[[:space:]]*listen[[:space:]]+([^;]*:)?$PUBLIC_PORT([^0-9]|$)" "$f"; then stop_unchanged "다른 사이트($f)가 $PUBLIC_PORT 을 씁니다."; fi
  if grep -Eq '^[[:space:]]*listen[[:space:]]+([^;]*:)?80([^0-9]|$)' "$f" && grep -Eq "server_name[^;]*$SERVER_NAME" "$f"; then
    stop_unchanged "다른 사이트($f)가 80 에서 $SERVER_NAME 을 씁니다."
  fi
done
LPUB=$(sudo ss -ltnpH "( sport = :$PUBLIC_PORT )" 2>/dev/null || true)
if [ -n "$LPUB" ] && ! echo "$LPUB" | grep -q nginx; then stop_unchanged "$PUBLIC_PORT 번 문을 nginx 가 아닌 프로그램이 씁니다: $LPUB"; fi
L80=$(sudo ss -ltnpH "( sport = :$ACME_PORT )" 2>/dev/null || true)
if [ -n "$L80" ] && ! echo "$L80" | grep -q nginx; then stop_unchanged "$ACME_PORT 번 문을 nginx 가 아닌 프로그램이 씁니다: $L80"; fi
if dpkg-query -W -f='${Status}' certbot 2>/dev/null | grep -q 'install ok installed'; then
  stop_unchanged "apt 로 깐 certbot 이 있습니다(우분투 apt 판은 5.4 미만 — IP 인증서 불가). Certbot 공식 안내대로 'sudo apt-get remove certbot' 뒤 다시 돌리세요."
fi
command -v snap >/dev/null || stop_unchanged "snap 이 없습니다(Certbot 공식 설치 방식)."
command -v netfilter-persistent >/dev/null || stop_unchanged "netfilter-persistent 가 없습니다(11-03 에 문을 연 방식 — iptables-persistent)."
CODE=$(curl -s -o /dev/null -w '%{http_code}' -H "Host: $SERVER_NAME:$OLD_PORT" "http://127.0.0.1:$OLD_PORT/" || true)
[ "$CODE" = "200" ] || stop_unchanged "지금 주소 http://$SERVER_NAME:$OLD_PORT 화면 응답이 $CODE 입니다(200 이어야 시작)."
say "nginx 켜짐 · alphascope = $OLD_PORT 설정 · 다른 사이트 · 프로그램과 겹치지 않음 · apt certbot 없음 · 지금 화면 200"
echo ""
echo "  오라클 웹 콘솔 보안 목록(Default Security List)에 수신 규칙 TCP $ACME_PORT (소스 0.0.0.0/0)을 더했습니까? ($PUBLIC_PORT 은 이미 열려 있어야 합니다)"
echo "  (서버 안에서는 콘솔 규칙을 볼 수 없습니다 — 더했으면 yes, 아니면 그냥 Enter)"
read -r -p "  > " ANSWER || ANSWER=""
[ "$ANSWER" = "yes" ] || stop_unchanged "콘솔에서 $ACME_PORT 를 먼저 여세요(deploy/README.md 「https 로 바꾸기」 ①)."

mkdir -p "$BK" || stop_unchanged "백업 폴더 $BK 를 만들지 못했습니다."
sudo cp "$NGINX_AVAIL" "$BK/alphascope.conf"
if [ -f "$NGINX_ENABLED" ] && [ ! -L "$NGINX_ENABLED" ]; then sudo cp "$NGINX_ENABLED" "$BK/alphascope-enabled-file.conf"; fi
sudo iptables -S INPUT > "$BK/iptables-input.txt" 2>/dev/null || true
say "백업: $BK (nginx 설정 · iptables INPUT 목록)"

echo "━━━ 2/6 Certbot 설치 (snap — 공식 안내 https://certbot.eff.org/instructions?ws=nginx&os=snap)"
if snap list certbot >/dev/null 2>&1; then
  say "Certbot(snap)이 이미 있습니다 — 그대로 씁니다(되돌릴 때도 지우지 않음)"
else
  sudo snap install --classic certbot || fail "Certbot 설치(snap install --classic certbot)에 실패했습니다."
  SNAP_INSTALLED=1
fi
if [ ! -e "$CERTBOT_LINK" ]; then sudo ln -s /snap/bin/certbot "$CERTBOT_LINK" && LINK_MADE=1; fi
CB_V=$(certbot --version 2>&1 | grep -Eo '[0-9]+\.[0-9]+(\.[0-9]+)?' | head -1)
if [ -z "$CB_V" ] || [ "$(printf '%s\n%s\n' "$MIN_CERTBOT" "$CB_V" | sort -V | head -1)" != "$MIN_CERTBOT" ]; then
  fail "Certbot 판이 ${CB_V:-알 수 없음} 입니다 — IP 인증서는 $MIN_CERTBOT 이상이어야 합니다."
fi
say "Certbot $CB_V"

echo "━━━ 3/6 문 열기 (iptables $ACME_PORT · $PUBLIC_PORT) · 80번 문 확인 경로"
for p in $ACME_PORT $PUBLIC_PORT; do
  if ipt_has "$p"; then
    say "iptables $p 은 이미 열려 있습니다(그대로 둠)"
  else
    sudo iptables -I INPUT 6 -p tcp --dport "$p" "${IPT_RULE[@]}" || fail "iptables 에 $p 을 더하지 못했습니다."
    ADDED_PORTS="$ADDED_PORTS $p"
  fi
done
ADDED_PORTS="${ADDED_PORTS# }"
if [ -n "$ADDED_PORTS" ]; then
  sudo netfilter-persistent save >/dev/null 2>&1 || fail "iptables 저장(netfilter-persistent save)에 실패했습니다."
  say "iptables 에 $ADDED_PORTS 더하고 저장(재부팅해도 유지)"
fi
if ! sudo test -d "$ACME_ROOT"; then ACME_ROOT_MADE=1; fi
sudo mkdir -p "$ACME_ROOT/.well-known/acme-challenge" || fail "$ACME_ROOT 를 만들지 못했습니다."
ACME_ADDED=1
sudo cp deploy/nginx-alphascope-acme.conf "$ACME_AVAIL" || fail "확인 경로 설정을 복사하지 못했습니다."
sudo ln -s "$ACME_AVAIL" "$ACME_ENABLED" || fail "확인 경로 설정을 켜지 못했습니다."
sudo nginx -t || fail "80번 문 설정 검사(nginx -t)에 실패했습니다."
sudo systemctl reload nginx || fail "nginx reload 에 실패했습니다."
sleep 1
# 확인 파일 시험 — Let's Encrypt 가 가져갈 자리에 파일을 두고 80번 문으로 읽어 본다
TOKEN="alphascope-check-$STAMP"
echo "$TOKEN" | sudo tee "$ACME_ROOT/.well-known/acme-challenge/$TOKEN" >/dev/null
GOT=$(curl -s -H "Host: $SERVER_NAME" "http://127.0.0.1:$ACME_PORT/.well-known/acme-challenge/$TOKEN" || true)
sudo rm -f "$ACME_ROOT/.well-known/acme-challenge/$TOKEN"
# 확인 경로 밖은 응답 없이 끊김(return 444 → curl 종료 코드 52 Empty reply)
R80=$(curl -s -o /dev/null --max-time 5 -w '%{http_code}' -H "Host: $SERVER_NAME" "http://127.0.0.1:$ACME_PORT/x"; echo " $?")
[ "$GOT" = "$TOKEN" ] || fail "80번 문에서 확인 파일을 읽지 못했습니다(받은 것: ${GOT:0:80})."
[ "$R80" = "000 52" ] || fail "80번 문의 확인 경로 밖이 끊기지 않았습니다($R80)."
say "80번 문: 확인 파일 읽힘 · 나머지는 끊김 · 8080 은 아직 그대로"

echo "━━━ 4/6 인증서 받기 (shortlived · IP $SERVER_NAME · webroot)"
CB_ARGS=(certonly --non-interactive --agree-tos --register-unsafely-without-email
  --required-profile shortlived --webroot --webroot-path "$ACME_ROOT"
  --ip-address "$SERVER_NAME" --cert-name "$SERVER_NAME")
say "연습(--dry-run · 스테이징 서버 · 저장 안 함)"
sudo certbot "${CB_ARGS[@]}" --dry-run || fail "인증서 받기 연습(--dry-run)에 실패했습니다 — 보안 목록의 80 · 위 오류를 확인하세요."
say "진짜 받기"
CERT_MADE=1   # 실패해도 일부가 남았을 수 있어 되돌릴 때 지운다
sudo certbot "${CB_ARGS[@]}" --deploy-hook "systemctl reload nginx" || fail "인증서 받기에 실패했습니다."
sudo test -f "$CERT_DIR/fullchain.pem" && sudo test -f "$CERT_DIR/privkey.pem" || fail "인증서 파일($CERT_DIR/fullchain.pem · privkey.pem)이 없습니다."
END=$(sudo openssl x509 -noout -enddate -in "$CERT_DIR/fullchain.pem" 2>/dev/null | cut -d= -f2)
say "받음 — 만료 $END"

echo "━━━ 5/6 새 nginx 설정 ($PUBLIC_URL · 같은 문 http → https · 갱신 연습) — deploy/apply-nginx.sh"
MAIN_TOUCHED=1
bash deploy/apply-nginx.sh || fail "새 nginx 설정 넣기 · 확인에 실패했습니다(apply-nginx.sh 가 설정을 되돌렸고, 나머지를 되돌립니다)."

echo "━━━ 6/6 자동 갱신 확인"
TIMER=$(systemctl list-timers --all --no-pager 2>/dev/null | grep -i certbot || true)
[ -n "$TIMER" ] || fail "Certbot 자동 갱신 타이머가 없습니다(systemctl list-timers) — 이대로면 6일 뒤 인증서가 끝납니다."
say "타이머: $(echo "$TIMER" | head -1 | tr -s ' ')"
sudo grep -q 'systemctl reload nginx' "$LE_DIR/renewal/$SERVER_NAME.conf" 2>/dev/null || fail "갱신 설정에 nginx reload(--deploy-hook)가 없습니다."
say "갱신 뒤 nginx reload 들어 있음(갱신 연습은 5/6 에서 통과)"
trap - INT TERM

echo ""
echo "완료 — $PUBLIC_URL"
echo "  · 인증서 만료: $END (6일짜리 — 남은 기간이 절반(약 80시간) 아래가 되면 타이머가 갱신 · 하루 2번 확인)"
echo "  · 다음 갱신 예정: 만료 약 80시간 전부터 · 다음 타이머 실행 $(echo "$TIMER" | head -1 | awk '{print $1, $2, $3}')"
echo "  · http://$SERVER_NAME:$PUBLIC_PORT 로 들어와도 같은 문의 https 로 넘어갑니다. 상태 보기: bash $APP_DIR/deploy/check-https.sh"
echo "  · 배포 스크립트도 새 것으로: cp $APP_DIR/deploy/deploy.sh $SCRIPTS_DIR/deploy.sh"
echo "  · 백업: $BK"
