#!/bin/bash
# AlphaScope 오라클 서버 배포 — GitHub 최신 코드 받기 → 설치 → 빌드 → 화면 복사 → 재시작
# (v2.36.1) 화면은 nginx 가 /var/www/alphascope 의 완성본을 보낸다. 빌드한 dist 를 거기로 복사하는 단계가 더해졌다.
# 이 파일은 deploy/switch-to-static.sh 가 ~/deploy.sh 로 복사한다. 쓰는 법: ssh alphascope '~/deploy.sh'
set -e
APP_DIR="$HOME/alphascope"
WEB_DIR="/var/www/alphascope"
SERVER_NAME="161.33.153.189"   # nginx 설정의 server_name 과 같아야 한다(확인 요청에 쓴다)
PUBLIC_PORT=8080               # nginx 설정의 listen … ssl 과 같아야 한다 — AlphaScope 주소 https://161.33.153.189:8080 (v2.61.2 · 같은 문 http 는 https 로 넘김 · 443 은 닫음)
PUBLIC_URL="https://$SERVER_NAME:$PUBLIC_PORT"
# AlphaScope pm2 프로그램 이름 — 이 둘만 다시 켠다(같은 서버의 다른 프로젝트 pm2 프로그램은 건드리지 않는다).
# deploy/ecosystem.config.cjs 의 name 과 같아야 한다(npm run deploy:test 가 확인).
PM2_APPS="alphascope-api alphascope-indicators"
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
# 실행 중인 ~/deploy.sh 는 덮어쓰지 않는다(bash 는 스크립트를 읽으면서 돌린다) — 다르면 끝에 안내만 한다.
SCRIPT_CHANGED=0
if ! cmp -s "$APP_DIR/deploy/deploy.sh" "$HOME/deploy.sh"; then SCRIPT_CHANGED=1; fi

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

echo "━━━ 6/6 재시작 (AlphaScope 두 프로그램만)"
# 화면용 개발 서버(alphascope-web)는 없다. 「모두」 명령(restart all 등)은 쓰지 않는다 — 같은 서버의 다른 프로젝트까지 다시 켜진다.
ECO="$APP_DIR/ecosystem.config.cjs"
[ -f "$ECO" ] || ECO="$APP_DIR/deploy/ecosystem.config.cjs"
for APP in $PM2_APPS; do
  if pm2 describe "$APP" >/dev/null 2>&1; then
    pm2 restart "$APP"
  else
    echo "  알림: pm2 에 $APP 이 없어 $ECO 로 켭니다."
    pm2 start "$ECO" --only "$APP"
  fi
done
sleep 3
# 상태는 AlphaScope 두 줄만 보인다(pm2 status 표는 다른 프로젝트까지 나오므로 jlist 에서 이름으로 고른다)
echo "  pm2 상태:"
pm2 jlist | node -e '
const want = process.argv[1].split(" ");
let s = "";
process.stdin.on("data", (d) => (s += d)).on("end", () => {
  const list = JSON.parse(s.slice(s.indexOf("[")));
  for (const name of want) {
    const p = list.find((x) => x.name === name);
    console.log(p ? `    ${name}  ${p.pm2_env.status}  (다시 켠 횟수 ${p.pm2_env.restart_time})` : `    ${name}  ⚠️ pm2 에 없음`);
  }
});' "$PM2_APPS" || echo "  (pm2 상태를 읽지 못했습니다 — 'pm2 status' 로 확인하세요)"

echo "━━━ 확인"
if VERSION=$(curl -sf http://127.0.0.1:4000/api/version); then
  echo "  API 응답: $VERSION"
else
  echo "  ⚠️ API 가 아직 응답하지 않습니다. 'pm2 logs alphascope-api --lines 30' 으로 확인하세요."
fi
# --resolve: 이름은 $SERVER_NAME 그대로(인증서 확인) 두고 이 서버(127.0.0.1)로 묻는다
CODE=$(curl -s -o /dev/null -w '%{http_code}' --resolve "$SERVER_NAME:$PUBLIC_PORT:127.0.0.1" "$PUBLIC_URL/" || true)
if [ "$CODE" = "200" ]; then
  echo "  화면 응답: 200"
else
  echo "  ⚠️ 화면이 응답하지 않습니다(코드 $CODE · $PUBLIC_URL). 'sudo nginx -t' 와 '$WEB_DIR' 폴더 · 'bash ~/alphascope/deploy/check-https.sh'(인증서)를 확인하세요. nginx 설정이 바뀌었으면 'bash ~/alphascope/deploy/apply-nginx.sh'."
fi
# 인증서 남은 기간 한 줄(48시간 안에 끝나면 ⚠️ — 자동 갱신이 멈췄다는 뜻)
bash "$APP_DIR/deploy/check-https.sh" --short || true
if [ "$SCRIPT_CHANGED" = "1" ]; then
  echo "  ⚠️ 배포 스크립트가 바뀌었습니다 — cp ~/alphascope/deploy/deploy.sh ~/deploy.sh"
fi
echo "완료: $OLD → $NEW"
