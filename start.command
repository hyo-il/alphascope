#!/bin/bash
# AlphaScope 실행 스크립트 — Finder 에서 더블클릭하거나 터미널에서 ./start.command
#
# Node 24 로 돈다(.nvmrc · 오라클 서버와 같은 버전). PATH 의 node 가 24 가 아니면 시작하지 않고 안내한다.

cd "$(dirname "$0")" || exit 1

NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null)
if [ "$NODE_MAJOR" != "24" ]; then
  echo "⚠️  Node 24 가 필요합니다. 지금 node: $(node -v 2>/dev/null || echo '찾지 못함') ($(command -v node 2>/dev/null || echo 'PATH 에 없음'))"
  echo "    Node 24 를 설치하거나 PATH 앞에 두고 다시 실행하세요. 노드를 바꿨다면 node_modules 를 지우고 다시 설치합니다(npm ci)."
  exit 1
fi

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
