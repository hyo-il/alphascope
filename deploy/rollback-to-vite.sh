#!/bin/bash
# AlphaScope — 완성본(dist)+nginx 에서 예전 개발 서버(Vite) 방식으로 되돌리기 (v2.36.1).
# switch-to-static.sh 가 남긴 백업 3개(nginx · pm2 · deploy.sh)를 원래 자리로 돌려놓고 개발 서버를 다시 켠다.
#   쓰는 법(오라클 안에서):  bash ~/alphascope/deploy/rollback-to-vite.sh
set -e

APP_DIR="$HOME/alphascope"
NGINX_AVAIL="/etc/nginx/sites-available/alphascope"
NGINX_ENABLED="/etc/nginx/sites-enabled/alphascope"
NGINX_BACKUP="$NGINX_AVAIL.vite-backup"
ENABLED_BACKUP="/etc/nginx/sites-available/alphascope-enabled-file.vite-backup"
ECO="$APP_DIR/ecosystem.config.cjs"
DEPLOY="$HOME/deploy.sh"

echo "━━━ 1/4 백업 확인"
MISSING=0
for f in "$NGINX_BACKUP" "$ECO.vite-backup" "$DEPLOY.vite-backup"; do
  if [ ! -f "$f" ]; then echo "  ⚠️ 백업이 없습니다: $f"; MISSING=1; fi
done
if [ "$MISSING" = "1" ]; then
  echo "  백업이 없어 되돌릴 수 없습니다. 아무것도 바꾸지 않고 멈춥니다."
  exit 1
fi

echo "━━━ 2/4 예전 설정 되돌리기"
sudo cp "$NGINX_BACKUP" "$NGINX_AVAIL"
if [ -f "$ENABLED_BACKUP" ] && [ ! -L "$NGINX_ENABLED" ]; then sudo cp "$ENABLED_BACKUP" "$NGINX_ENABLED"; fi
cp "$ECO.vite-backup" "$ECO"
cp "$DEPLOY.vite-backup" "$DEPLOY"
chmod +x "$DEPLOY"

echo "━━━ 3/4 개발 서버 다시 켜기"
# 개발 서버를 먼저 켜야 nginx 가 5173 으로 넘길 곳이 생긴다
pm2 start "$ECO" --only alphascope-web
pm2 save
sleep 3

echo "━━━ 4/4 nginx 적용"
sudo nginx -t
sudo systemctl reload nginx
pm2 list
echo ""
echo "되돌리기 완료 — 브라우저를 새로고침하세요. (화면 폴더 /var/www/alphascope 는 지우지 않았습니다)"
