// AlphaScope — 오라클 pm2 설정 (v2.36.1)
// 예전 설정에서 alphascope-web(Vite 개발 서버 `npx vite --host 0.0.0.0`)만 뺐다 — 화면은 nginx 가 완성본(dist)으로 보낸다.
// api·indicators 두 항목은 예전 설정(docs/oracle-setup-guide.html Phase 8)과 같다.
// deploy/switch-to-static.sh 가 ~/alphascope/ecosystem.config.cjs 로 복사한다(바꾸기 전 파일과의 차이를 화면에 보여 준다).
module.exports = {
  apps: [
    {
      name: 'alphascope-api',
      cwd: '/home/ubuntu/alphascope',
      script: 'npx',
      args: 'tsx server/index.ts',
      env: { NODE_ENV: 'production' },
      watch: false
    },
    {
      name: 'alphascope-indicators',
      cwd: '/home/ubuntu/alphascope/python',
      script: '/home/ubuntu/alphascope/python/.venv/bin/python',
      args: 'indicators.py',
      interpreter: 'none'
    }
  ]
};
