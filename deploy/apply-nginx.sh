#!/bin/bash
# AlphaScope — 저장소의 nginx 설정(deploy/nginx-alphascope.conf)을 오라클 nginx 에 넣는다 (v2.60.5).
# 배포(~/deploy.sh)는 nginx 설정 파일을 넣지 않는다 — 설정이 바뀌었을 때만 이 스크립트를 **손으로 한 번** 돌린다.
#
#   쓰는 법(오라클 안에서):  cd ~/alphascope && git pull --ff-only origin main && bash deploy/apply-nginx.sh
#
# 순서: ① 지금 설정 백업(sites-enabled 밖 · 이름에 날짜) → ② 새 설정 복사 → ③ nginx -t(실패하면 되돌리고 멈춤)
#       → ④ reload → ⑤ 화면 · /api/version 확인(200 이 아니면 되돌리고 멈춤) → ⑥ 주소 알림
set -e

APP_DIR="$HOME/alphascope"
SERVER_NAME="161.33.153.189"   # nginx 설정의 server_name 과 같아야 한다
PUBLIC_PORT=8080               # nginx 설정의 listen 과 같아야 한다(npm run deploy:test 가 확인)
NGINX_DIR="${NGINX_DIR:-/etc/nginx}"   # 시험(deploy:test)만 임시 폴더로 바꾼다
NGINX_AVAIL="$NGINX_DIR/sites-available/alphascope"
NGINX_ENABLED="$NGINX_DIR/sites-enabled/alphascope"
STAMP=$(date +%Y%m%d-%H%M%S)
# ⚠️ 백업은 sites-enabled 안에 두지 않는다 — nginx 는 그 폴더의 파일을 전부 읽어 설정이 두 벌이 된다.
BACKUP="$NGINX_AVAIL.backup-$STAMP"
ENABLED_BACKUP="$NGINX_DIR/sites-available/alphascope-enabled-file.backup-$STAMP"

cd "$APP_DIR"

# 백업으로 되돌린다(검사 · 확인이 실패했을 때)
restore() {
  echo "  백업으로 되돌립니다: $BACKUP"
  sudo cp "$BACKUP" "$NGINX_AVAIL"
  if [ -f "$ENABLED_BACKUP" ]; then sudo cp "$ENABLED_BACKUP" "$NGINX_ENABLED"; fi
  sudo nginx -t && sudo systemctl reload nginx
  echo "  되돌렸습니다. 주소는 예전 그대로입니다. 위의 오류 내용을 알려 주세요."
}

echo "━━━ 1/5 지금 설정 백업"
if [ ! -f "$NGINX_AVAIL" ]; then
  echo "  ⚠️ $NGINX_AVAIL 이 없습니다 — 처음 설치라면 deploy/README.md 「처음 서버를 완성본 방식으로 바꿀 때」 를 따르세요. 아무것도 바꾸지 않고 멈춥니다."
  exit 1
fi
sudo cp "$NGINX_AVAIL" "$BACKUP"
echo "  nginx → $BACKUP"
# sites-enabled 의 파일이 링크가 아니라 따로 복사된 파일이면, 그 파일도 백업하고 함께 바꾼다(switch-to-static.sh 와 같다)
if [ -f "$NGINX_ENABLED" ] && [ ! -L "$NGINX_ENABLED" ]; then
  sudo cp "$NGINX_ENABLED" "$ENABLED_BACKUP"
  echo "  알림: $NGINX_ENABLED 이 링크가 아니라 파일입니다 — 백업 → $ENABLED_BACKUP"
fi

echo "━━━ 2/5 새 설정 넣기"
sudo cp deploy/nginx-alphascope.conf "$NGINX_AVAIL"
if [ -f "$ENABLED_BACKUP" ]; then sudo cp deploy/nginx-alphascope.conf "$NGINX_ENABLED"; fi

echo "━━━ 3/5 설정 검사"
if ! sudo nginx -t; then
  echo "  ⚠️ 새 nginx 설정 검사에 실패했습니다."
  restore
  exit 1
fi

echo "━━━ 4/5 적용"
sudo systemctl reload nginx
sleep 1

echo "━━━ 5/5 화면 · API 확인 (Host: $SERVER_NAME:$PUBLIC_PORT)"
CODE=$(curl -s -o /dev/null -w '%{http_code}' -H "Host: $SERVER_NAME:$PUBLIC_PORT" "http://127.0.0.1:$PUBLIC_PORT/" || true)
API=$(curl -s -o /dev/null -w '%{http_code}' -H "Host: $SERVER_NAME:$PUBLIC_PORT" "http://127.0.0.1:$PUBLIC_PORT/api/version" || true)
echo "  화면 응답 $CODE · API(/api/version) 응답 $API"
if [ "$CODE" != "200" ] || [ "$API" != "200" ]; then
  echo "  ⚠️ 화면 또는 API 확인에 실패했습니다."
  restore
  exit 1
fi

echo ""
echo "적용 완료 — AlphaScope 주소: http://$SERVER_NAME:$PUBLIC_PORT"
echo "(백업: $BACKUP — 문제가 없으면 그대로 두어도 됩니다)"
