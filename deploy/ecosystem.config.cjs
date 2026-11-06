// AlphaScope — 오라클 pm2 설정 (v2.36.1 · v2.61.3 자리를 이 파일 위치에서 계산)
// 화면은 nginx 가 완성본(dist)으로 보낸다(개발 서버 alphascope-web 없음).
// 앱 폴더 = 이 파일(app/deploy/)의 한 단계 위 — 폴더를 옮겨도 고칠 일이 없다. 배포(deploy.sh)는 이 파일을 그대로 쓴다(사본을 두지 않음).
const path = require('node:path');

const APP_DIR = path.resolve(__dirname, '..');

module.exports = {
  apps: [
    {
      name: 'alphascope-api',
      cwd: APP_DIR,
      script: 'npx',
      args: 'tsx server/index.ts',
      env: { NODE_ENV: 'production' },
      watch: false
    },
    {
      name: 'alphascope-indicators',
      cwd: path.join(APP_DIR, 'python'),
      script: path.join(APP_DIR, 'python', '.venv', 'bin', 'python'),
      args: 'indicators.py',
      interpreter: 'none'
    }
  ]
};
