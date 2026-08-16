#!/bin/bash
# AlphaScope 실행 스크립트 — Finder 에서 더블클릭하거나 터미널에서 ./start.command
#
# 전역 node 는 v21(EOL)이라 실행되지 않는다. 여기서 Node 22 경로를 앞에 붙여 준다.

cd "$(dirname "$0")" || exit 1
export PATH=/opt/homebrew/opt/node@22/bin:$PATH

echo "AlphaScope 시작 중…"
echo "  Node: $(node -v)"
echo

# 의존성이 없으면 먼저 설치
if [ ! -d node_modules ]; then
  echo "의존성을 설치합니다 (최초 1회)…"
  npm install || exit 1
fi

# 파이썬 가상환경이 없으면 안내
if [ ! -x python/.venv/bin/python ]; then
  echo "⚠️  Python 가상환경이 없습니다. 먼저 아래를 실행하세요:"
  echo "    npm run py:setup"
  exit 1
fi

# .env 확인
if [ ! -f .env ]; then
  echo "⚠️  .env 파일이 없습니다. .env.example 을 복사해 토스 API 키를 넣으세요:"
  echo "    cp .env.example .env"
  exit 1
fi

# 서버가 뜨면 브라우저를 연다 (백그라운드에서 대기)
(
  for _ in $(seq 1 60); do
    if curl -sf http://localhost:5173 > /dev/null 2>&1; then
      open http://localhost:5173
      break
    fi
    sleep 1
  done
) &

echo "웹 5173 · API 4000 · 지표 엔진 5001 을 시작합니다."
echo "종료하려면 이 창에서 Control+C 를 누르세요."
echo

npm run dev
