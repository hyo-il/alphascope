#!/bin/bash
# AlphaScope — https 인증서 상태 보기 (v2.61.1). 아무것도 바꾸지 않는다.
#
#   쓰는 법(오라클 안에서):  bash ~/alphascope/deploy/check-https.sh            (자세히 — 인증서 · 갱신 타이머 · 마지막 갱신 기록)
#                            bash ~/alphascope/deploy/check-https.sh --short    (한 줄 — 배포(~/deploy.sh) 끝에서 부른다)
#
# 인증서는 6일짜리라 약 3일마다 자동 갱신된다(Certbot 타이머 하루 2번). Let's Encrypt 의 만료 알림 메일은 2025-06 에 끝났으므로
# 갱신이 멈춘 것은 이 스크립트(또는 배포 끝 한 줄)로 알아챈다 — 48시간 안에 끝나면 이미 갱신을 여러 번 놓친 것이다.
# 종료 코드: 0 = 괜찮음 · 1 = ⚠️(48시간 안에 끝남 · 443 응답 없음 · 타이머 없음 · 마지막 갱신 실패)
set -u

SERVER_NAME="161.33.153.189"   # nginx 설정의 server_name 과 같아야 한다
PUBLIC_PORT=443                # nginx 설정의 listen … ssl 과 같아야 한다(npm run deploy:test 가 확인)
WARN_HOURS=48
SHORT=0
[ "${1:-}" = "--short" ] && SHORT=1

# 이 서버의 443 이 지금 내보내는 인증서(설정 파일이 아니라 실제로 브라우저가 받는 것)
PEM=$(openssl s_client -connect "127.0.0.1:$PUBLIC_PORT" </dev/null 2>/dev/null | openssl x509 2>/dev/null || true)
if [ -z "$PEM" ]; then
  echo "  ⚠️ 인증서: $PUBLIC_PORT 번 문에서 인증서를 받지 못했습니다(https 를 아직 켜지 않았으면 정상 — deploy/setup-https.sh)."
  exit 1
fi
END=$(printf '%s\n' "$PEM" | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
STATUS=0
if printf '%s\n' "$PEM" | openssl x509 -noout -checkend $((WARN_HOURS * 3600)) >/dev/null 2>&1; then
  echo "  인증서: 만료 $END · ${WARN_HOURS}시간 넘게 남음(자동 갱신 정상)"
else
  echo "  ⚠️ 인증서가 ${WARN_HOURS}시간 안에 끝납니다(만료 $END) — 자동 갱신이 멈춘 것 같습니다. 'bash ~/alphascope/deploy/check-https.sh' 로 자세히 보세요."
  STATUS=1
fi
[ "$SHORT" = "1" ] && exit "$STATUS"

echo "━━━ 갱신 타이머(Certbot snap — 하루 2번)"
if TIMERS=$(systemctl list-timers --all --no-pager 2>/dev/null | grep -i certbot); then
  echo "$TIMERS" | sed 's/^/  /'
else
  echo "  ⚠️ certbot 타이머가 없습니다 — 'sudo snap info certbot' · 'systemctl list-timers --all' 로 확인하세요."
  STATUS=1
fi
SVC=$(systemctl list-units --all --no-pager --plain 2>/dev/null | grep -io 'snap\.certbot\.renew\.service' | head -1 || true)
if [ -n "$SVC" ] && systemctl is-failed --quiet "$SVC"; then
  echo "  ⚠️ 마지막 갱신 실행이 실패했습니다($SVC) — 아래 기록을 확인하세요."
  STATUS=1
fi

echo "━━━ Certbot 이 아는 인증서"
sudo certbot certificates --cert-name "$SERVER_NAME" 2>&1 | grep -E 'Certificate Name|Identifiers|Domains|Expiry Date' | sed 's/^ */  /' || true

echo "━━━ 마지막 갱신 기록(/var/log/letsencrypt/letsencrypt.log — 오류 · 갱신 줄만 10줄)"
sudo grep -iE 'error|renew|success|fail' /var/log/letsencrypt/letsencrypt.log 2>/dev/null | tail -n 10 | sed 's/^/  /' || echo "  (기록이 없습니다)"

[ "$STATUS" = "0" ] && echo "결과: 괜찮음" || echo "결과: ⚠️ 위 줄을 개발 대화에 붙여 주세요"
exit "$STATUS"
