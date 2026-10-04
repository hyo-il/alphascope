#!/bin/bash
# AlphaScope — 오라클을 「개발 서버(Vite)」 에서 「완성본(dist) + nginx」 로 바꾸는 스크립트 (v2.36.1). **한 번만** 실행한다.
#
#   쓰는 법(오라클 안에서):  cd ~/alphascope && git pull --ff-only origin main && bash deploy/switch-to-static.sh
#
# 안전장치:
#   - 바꾸기 전에 지금 설정 3개(nginx · pm2 · deploy.sh)를 백업한다. 백업이 이미 있으면 덮어쓰지 않는다(처음 상태를 지킨다).
#   - 새 nginx 설정이 틀리거나 화면 확인이 실패하면 **예전 nginx 설정으로 되돌리고 멈춘다.**
#     이때 개발 서버(alphascope-web)는 아직 켜져 있으므로 화면은 예전 그대로 보인다.
#   - 개발 서버는 **확인이 통과한 뒤에야** 끈다.
#   - 문제가 생기면 언제든: bash ~/alphascope/deploy/rollback-to-vite.sh
set -e

APP_DIR="$HOME/alphascope"
WEB_DIR="/var/www/alphascope"
SERVER_NAME="161.33.153.189"   # nginx 설정의 server_name 과 같아야 한다
NGINX_AVAIL="/etc/nginx/sites-available/alphascope"
NGINX_ENABLED="/etc/nginx/sites-enabled/alphascope"
# ⚠️ 백업은 sites-enabled 안에 두지 않는다 — nginx 는 그 폴더의 파일을 전부 읽어 설정이 두 벌이 된다.
NGINX_BACKUP="$NGINX_AVAIL.vite-backup"
ENABLED_BACKUP="/etc/nginx/sites-available/alphascope-enabled-file.vite-backup"
ECO="$APP_DIR/ecosystem.config.cjs"
DEPLOY="$HOME/deploy.sh"

cd "$APP_DIR"

# nginx 설정을 예전으로 되돌린다(전환 도중 실패했을 때)
restore_nginx() {
  echo "  예전 nginx 설정으로 되돌립니다."
  sudo cp "$NGINX_BACKUP" "$NGINX_AVAIL"
  if [ -f "$ENABLED_BACKUP" ] && [ ! -L "$NGINX_ENABLED" ]; then
    sudo cp "$ENABLED_BACKUP" "$NGINX_ENABLED"
  fi
  sudo nginx -t && sudo systemctl reload nginx
  echo "  되돌렸습니다. 화면은 예전(개발 서버) 그대로입니다. 위의 오류 내용을 알려 주세요."
}

echo "━━━ 1/7 지금 설정 백업"
# 백업이 이미 있으면 그대로 둔다 — 두 번째 실행에서 「바뀐 설정」 으로 백업을 덮어쓰면 되돌릴 곳이 사라진다.
if [ -f "$NGINX_BACKUP" ]; then echo "  nginx 백업이 이미 있습니다(그대로 둠): $NGINX_BACKUP"; else sudo cp "$NGINX_AVAIL" "$NGINX_BACKUP"; echo "  nginx → $NGINX_BACKUP"; fi
# sites-enabled 의 파일이 링크가 아니라 따로 복사된 파일이면, 그 파일도 백업한다(그 경우 sites-available 만 고치면 반영되지 않는다)
if [ ! -L "$NGINX_ENABLED" ]; then
  echo "  알림: $NGINX_ENABLED 이 링크가 아니라 파일입니다 — 이 파일도 함께 바꿉니다."
  if [ -f "$ENABLED_BACKUP" ]; then echo "  (그 파일의 백업이 이미 있습니다: $ENABLED_BACKUP)"; else sudo cp "$NGINX_ENABLED" "$ENABLED_BACKUP"; echo "  sites-enabled 파일 → $ENABLED_BACKUP"; fi
fi
if [ -f "$ECO.vite-backup" ]; then echo "  pm2 설정 백업이 이미 있습니다(그대로 둠)"; else cp "$ECO" "$ECO.vite-backup"; echo "  pm2 설정 → $ECO.vite-backup"; fi
if [ -f "$DEPLOY.vite-backup" ]; then echo "  deploy.sh 백업이 이미 있습니다(그대로 둠)"; else cp "$DEPLOY" "$DEPLOY.vite-backup"; echo "  deploy.sh → $DEPLOY.vite-backup"; fi

echo "━━━ 2/7 화면 폴더 준비 ($WEB_DIR)"
command -v rsync >/dev/null || { echo "  ⚠️ rsync 가 없습니다. 'sudo apt install -y rsync' 를 실행한 뒤 이 스크립트를 다시 실행하세요."; exit 1; }
sudo mkdir -p "$WEB_DIR"
sudo chown ubuntu:ubuntu "$WEB_DIR"

echo "━━━ 3/7 빌드하고 화면 복사"
npm run build
rsync -a --delete dist/ "$WEB_DIR/"
echo "  복사한 파일 $(find "$WEB_DIR" -type f | wc -l)개"

echo "━━━ 4/7 새 nginx 설정 넣기"
sudo cp deploy/nginx-alphascope.conf "$NGINX_AVAIL"
if [ ! -L "$NGINX_ENABLED" ]; then sudo cp deploy/nginx-alphascope.conf "$NGINX_ENABLED"; fi
if ! sudo nginx -t; then
  echo "  ⚠️ 새 nginx 설정 검사에 실패했습니다."
  restore_nginx
  exit 1
fi

echo "━━━ 5/7 적용하고 화면 확인"
sudo systemctl reload nginx
sleep 1
# Host 를 server_name 으로 준다 — 127.0.0.1 로만 물으면 다른 nginx 사이트(default)가 대답할 수 있다
CODE=$(curl -s -o /tmp/alphascope-index.html -w '%{http_code}' -H "Host: $SERVER_NAME" http://127.0.0.1/ || true)
# 완성본이면 /assets/ 파일을 부르고, 개발 서버 화면이면 /@vite/client 가 들어 있다
if [ "$CODE" = "200" ] && grep -q '/assets/' /tmp/alphascope-index.html && ! grep -q '/@vite/client' /tmp/alphascope-index.html; then
  echo "  화면 응답 200 · 완성본(/assets/) 확인"
else
  echo "  ⚠️ 화면 확인 실패 (응답 코드 $CODE)."
  restore_nginx
  exit 1
fi
API=$(curl -s -o /dev/null -w '%{http_code}' -H "Host: $SERVER_NAME" http://127.0.0.1/api/version || true)
echo "  API(/api/version) 응답 $API"

echo "━━━ 6/7 개발 서버 끄기 (확인이 통과했으므로)"
pm2 delete alphascope-web || echo "  (alphascope-web 이 이미 없습니다)"
echo "  pm2 설정을 새 것으로 바꿉니다. 예전 파일과의 차이(alphascope-web 항목만 빠져야 정상):"
diff "$ECO.vite-backup" deploy/ecosystem.config.cjs || true
cp deploy/ecosystem.config.cjs "$ECO"
pm2 save

echo "━━━ 7/7 배포 스크립트 바꾸기"
cp deploy/deploy.sh "$DEPLOY"
chmod +x "$DEPLOY"
pm2 list

echo ""
echo "전환 완료 — 브라우저에서 http://$SERVER_NAME 를 새로고침하세요."
echo "되돌리려면: bash ~/alphascope/deploy/rollback-to-vite.sh"
