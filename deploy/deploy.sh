#!/bin/bash
# AlphaScope 오라클 서버 배포 — GitHub 최신 코드 받기 → 설치 → 빌드 → 화면 복사 → 재시작
# (v2.36.1) 화면은 nginx 가 /var/www/alphascope 의 완성본을 보낸다. 빌드한 dist 를 거기로 복사하는 단계가 더해졌다.
# 이 파일은 deploy/switch-to-static.sh 가 ~/deploy.sh 로 복사한다. 쓰는 법: ssh alphascope '~/deploy.sh'
set -e
APP_DIR="$HOME/alphascope"
WEB_DIR="/var/www/alphascope"
SERVER_NAME="161.33.153.189"   # nginx 설정의 server_name 과 같아야 한다(확인 요청에 쓴다)
cd "$APP_DIR"

echo "━━━ 1/6 지금 버전"
OLD=$(git rev-parse --short HEAD)
git log -1 --format='  %h  %s'

echo "━━━ 2/6 GitHub 에서 받기"
git pull --ff-only origin main
NEW=$(git rev-parse --short HEAD)
if [ "$OLD" = "$NEW" ]; then
  echo "  새 커밋이 없습니다. 그래도 빌드·재시작은 진행합니다."
else
  echo "  받은 커밋:"
  git log --format='    %h  %s' "$OLD..$NEW"
fi

echo "━━━ 3/6 설치"
npm install --no-audit --no-fund
if [ "$OLD" != "$NEW" ] && git diff --name-only "$OLD" "$NEW" | grep -q '^python/requirements.txt$'; then
  echo "  파이썬 패키지 목록이 바뀌어 다시 설치합니다."
  python/.venv/bin/pip install -r python/requirements.txt
fi

echo "━━━ 4/6 빌드"
# 빌드가 실패하면 set -e 로 여기서 멈춘다 — 아래 복사가 일어나지 않으므로 지금 보이는 (옛) 화면이 그대로 남는다.
npm run build

echo "━━━ 5/6 화면 복사 (dist → $WEB_DIR)"
# --delete: 이번 빌드에 없는 옛 파일(이름에 해시가 붙은 js·css)을 지운다.
rsync -a --delete dist/ "$WEB_DIR/"
sudo nginx -t
sudo systemctl reload nginx

echo "━━━ 6/6 재시작"
# 화면용 개발 서버(alphascope-web)는 없다 — api·indicators 둘만 다시 켜진다.
pm2 restart all
sleep 3
pm2 status

echo "━━━ 확인"
if VERSION=$(curl -sf http://127.0.0.1:4000/api/version); then
  echo "  API 응답: $VERSION"
else
  echo "  ⚠️ API 가 아직 응답하지 않습니다. 'pm2 logs alphascope-api --lines 30' 으로 확인하세요."
fi
CODE=$(curl -s -o /dev/null -w '%{http_code}' -H "Host: $SERVER_NAME" http://127.0.0.1/ || true)
if [ "$CODE" = "200" ]; then
  echo "  화면 응답: 200"
else
  echo "  ⚠️ 화면이 응답하지 않습니다(코드 $CODE). 'sudo nginx -t' 와 '$WEB_DIR' 폴더를 확인하세요."
fi
echo "완료: $OLD → $NEW"
