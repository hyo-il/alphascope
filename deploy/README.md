# 오라클 서버 운영

오라클 서버는 미리 만들어 둔 **완성본(dist)** 을 nginx 가 바로 보냅니다. API(4000)와 지표 엔진(5001)은 pm2 가 돌립니다.
**AlphaScope 주소: `https://161.33.153.189:8080`**(v2.61.2 — Let's Encrypt IP 인증서 · 아래 「주소 8080 · 443 닫기」). `http://161.33.153.189:8080` 으로 들어와도 같은 문의 https 로 넘어갑니다. 문 번호 없는 주소(443)는 접속 거절, 80번 문은 인증서 확인 경로만 보내고 나머지는 응답 없이 끊습니다. 같은 서버의 다른 프로젝트는 8081 입니다.
개발용 서버(Vite)는 인터넷에 열지 않습니다 — 자동 탐색 요청 하나로 열린 모든 화면에 「URI malformed」 오류 창이 뜨고, 소스 파일도 그대로 나갑니다.

## 배포

맥에서 한 줄입니다(05:00~22:30 KST 사이, 05:30 전후는 피합니다).

```bash
ssh -i ~/Documents/ClaudeCode/Work/Alphascope/secrets/Oracle-Ssh-Key/ssh-key-2026-09-19.key ubuntu@161.33.153.189 '~/projects/alphascope/scripts/deploy.sh'
```

받기 → 설치 → 빌드 → 화면을 `/var/www/alphascope` 로 복사 + nginx 다시 읽기 → pm2 `alphascope-api` · `alphascope-indicators` 재시작 → API·화면 확인 순서로 돕니다.
빌드가 실패하면 복사하지 않으므로 예전 화면이 그대로 남습니다. 화면만 바뀌어도 이 배포가 필요합니다.
`~/projects/alphascope/scripts/deploy.sh` 는 저장소 `deploy/deploy.sh` 의 **복사본**입니다(오라클 자리는 모두 `deploy/paths.sh` 한 곳 — v2.61.3). 받은 코드에서 배포 스크립트가 바뀌었으면 끝에 「배포 스크립트가 바뀌었습니다」 가 나옵니다(돌고 있는 스크립트는 덮어쓰지 않습니다) — 그때 아래 한 줄로 바꿉니다.

```bash
cp ~/projects/alphascope/app/deploy/deploy.sh ~/projects/alphascope/scripts/deploy.sh
```

### nginx 설정이 바뀌었을 때

배포는 nginx 설정 파일(`deploy/nginx-alphascope.conf` · `deploy/nginx-alphascope-acme.conf`)을 서버에 넣지 않습니다. 설정이 바뀐 코드를 받았으면 서버에서 한 번 돌립니다.

```bash
cd ~/projects/alphascope/app && git pull --ff-only origin main && bash deploy/apply-nginx.sh
```

지금 설정 두 개를 날짜 붙은 이름으로 백업(`~/projects/alphascope/backups/nginx/alphascope.backup-…` · `alphascope-acme.backup-…` — v2.61.3 부터 nginx 폴더 밖) → 새 설정 넣기 → `nginx -t` → 적용 → 확인(https 8080 화면 · `/api/version` 200 · http 8080 → https 넘김 · 443 접속 거절 · 80 확인 파일 · 80 그 밖 끊김) → 인증서 갱신 연습 → iptables 443 규칙 지움 순서로 돌고, 끝에 「AlphaScope 주소: https://161.33.153.189:8080」 과 되돌리는 명령이 나옵니다. 인증서 · 80 확인 경로가 아직 없거나(https 로 바꾸기 전) 다른 설정 · 프로그램이 443 을 들으면 아무것도 바꾸지 않고 멈춥니다. 검사 · 확인 · 갱신 연습이 실패하면 **자동으로 백업으로 되돌리고 예전 주소를 확인하고 멈춥니다**.

### 폴더 정리 — `~/projects/alphascope/` 한 곳으로 (v2.61.3 · 한 번만)

오라클에 다른 프로젝트가 들어와도 섞이지 않게 맥 `Work/<프로젝트>/` 와 같은 모양으로 둡니다(사용자 결정 2026-11-06). 자리는 저장소 `deploy/paths.sh` 한 곳에서 정합니다.

```
~/projects/
├── _common/                 비워 둠(나중에 여러 프로젝트가 같이 쓰는 것)
└── alphascope/
    ├── app/                 ← ~/alphascope (git · DB 는 app/db/)
    ├── secrets/             ← ~/secrets (700 · 파일 600)
    ├── scripts/             ← ~/setpw.sh(옮기기만) · deploy.sh(저장소 판) · backup.sh(새 한 줄)
    ├── backups/             db/ ← ~/backups · node24/ · https/ ← 홈의 옛 백업 · nginx/ ← sites-available 의 *.backup-*
    └── data/                ← ~/alphascope-samples
/var/www/alphascope · /etc/nginx/sites-available/alphascope · alphascope-acme 는 그대로
```

지우는 것(Vite 때): `~/deploy.sh.vite-backup` · `~/alphascope/ecosystem.config.cjs.vite-backup` · `/etc/nginx/sites-available/alphascope.vite-backup`. 건드리지 않는 것: `~/.ssh` · `~/.pm2` · `~/snap` · `~/.cache` · `~/.npm` · `/var/www/letsencrypt` · `/var/www/html` · `/var/www/project2` · `sites-available/project2` · `default` · 인증서(`/etc/letsencrypt`).

**언제** — **토 15:00 ~ 22:30 또는 일 06:00 ~ 17:00 KST**(스케줄러가 쉬는 때 · 배포 시간대 안 · 일요일 03:00 주간 백업 앞뒤는 피함 — 위 「Node 24 올리기」 표와 같은 이유).

**멈추는 시간** — AlphaScope 두 프로그램이 꺼져 있는 것은 4/6 단계(두 이름 멈춤 → 앱 폴더 옮기기 → venv 확인 → 새 설정으로 켬 → API 응답)뿐으로 **약 20~40초**입니다. 같은 디스크 안의 옮기기라 688M 앱 폴더도 이름만 바뀝니다(디스크가 다르면 스크립트가 멈춤). 백업 · 데이터 · nginx 옛 백업 · 스크립트 · secrets 옮기기는 **서버를 켠 채로** 먼저 합니다. 옮긴 venv 가 열리지 않으면 새 자리에서 다시 만드느라(`python -m venv` + `pip install -r requirements.txt`) **몇 분** 더 멈출 수 있습니다.

**① 맥에서 푸시** 한 뒤 **② 서버에서**(아직 옛 자리에서 받습니다):

```bash
ssh -i ~/Documents/ClaudeCode/Work/Alphascope/secrets/Oracle-Ssh-Key/ssh-key-2026-09-19.key ubuntu@161.33.153.189
```

```bash
cd ~/alphascope && git pull --ff-only origin main && bash deploy/move-to-projects.sh
```

`move-to-projects.sh` 가 하는 일 — 1/6 지금 상태 확인(홈 목록 · `~/projects` 없음 · crontab 이 주간 백업 한 줄뿐 · pm2 두 이름이 옛 자리에서 online · API 200 · `.env` 의 `DB_PATH` · `GOOGLE_SA_KEY_FILE` · venv — 하나라도 다르면 **아무것도 바꾸지 않고 멈춤**) → 2/6 되돌리기 준비(`~/projects/.move-backup-<날짜>/` — 목록 · crontab · pm2 이름과 cwd · `.env` 사본 600) → 3/6 켠 채로 옮기기(+ `.env` 의 열쇠 경로) → 4/6 멈춤 구간(+ `DB_PATH` 가 옛 절대 경로일 때만 새 경로로) → 확인(API 200 · 「로그인 사용 중」 = 새 자리 DB · 자동매매 스케줄러 줄 · 지표 엔진 `/health` · 옛 경로 오류 없음 · 열쇠 새 경로 · `pm2 save` 목록) → 5/6 crontab 주간 백업 줄을 새 자리로(일요일 03:00 그대로) → 6/6 Vite 옛 파일 지우기. `.env` 값 · 열쇠 · `setpw.sh` 내용은 출력하지 않습니다(바꾼 줄 개수만).

- 끝에 **「완료 — 새 자리 /home/ubuntu/projects/alphascope · 서버가 멈춘 시간 약 N초」** 가 나오면 성공입니다.
- 「아무것도 바꾸지 않고 멈춥니다」 — 서버 모양이 예상과 다릅니다. 나온 글을 개발 대화에 붙여 주세요(서버는 그대로 돕니다).
- 「되돌렸습니다 — 옛 자리(/home/ubuntu/alphascope)로 돌아갔습니다」 — 중간에 실패해 **바꾼 것만 거꾸로 되돌리고 옛 자리에서 다시 켠 것**입니다. ⚠️ 줄을 붙여 주세요. `~/projects/.move-backup-<날짜>/` 만 남습니다(`.env` 사본 — 확인 뒤 지움).

**③ 끝난 뒤 확인**

1. `https://161.33.153.189:8080` — 로그인 · 차트 · 계좌 · 자산 관리(열쇠 새 경로)가 된다.
2. 서버에서 `ls ~` → `projects` 와 시스템 폴더(`snap`)만 · `crontab -l` → `0 3 * * 0 /home/ubuntu/projects/alphascope/scripts/backup.sh` · `pm2 list` 의 두 이름 online.
3. 주간 백업을 바로 한 번 시험해도 됩니다(서버가 도는 중에도 안전): `~/projects/alphascope/scripts/backup.sh && tail -n 2 ~/projects/alphascope/backups/db/backup.log` → 「완료 … integrity_check ok」.
4. `~/projects/alphascope/scripts/setpw.sh` 는 옮기기만 했습니다(스크립트는 내용을 읽지 않음) — 안에 `~/alphascope` 가 있으면 직접 `~/projects/alphascope/app` 으로 고칩니다.
5. 다음 일요일 03:00 뒤 `ls ~/projects/alphascope/backups/db/` 에 새 백업이 있다.
6. 1주쯤 문제없으면 지웁니다: `rm -rf ~/projects/alphascope/backups/node24/alphascope-node24-backup-* ~/projects/.move-backup-*`

맥에서 배포하는 한 줄도 바뀝니다: `ssh -i ~/Documents/ClaudeCode/Work/Alphascope/secrets/Oracle-Ssh-Key/ssh-key-2026-09-19.key ubuntu@161.33.153.189 '~/projects/alphascope/scripts/deploy.sh'`.

**④ 손으로 되돌리기**(성공한 뒤 며칠 지나 문제가 보일 때 — 서버 안에서. 그 사이 `.env` 를 고쳤다면 그 줄은 다시 고칩니다):

```bash
M=$(ls -d ~/projects/.move-backup-* | tail -1); P=~/projects/alphascope
pm2 stop alphascope-api && pm2 stop alphascope-indicators
mv $P/app ~/alphascope && mv $P/secrets ~/secrets && cat "$M/.env.before" > ~/alphascope/.env
mv $P/backups/db ~/backups && mv $P/data ~/alphascope-samples && mv $P/scripts/setpw.sh ~/setpw.sh
cp "$M/old/deploy.sh" ~/deploy.sh && cp "$M/old/backup.sh" ~/backup.sh && crontab "$M/crontab.txt"
pm2 delete alphascope-api && pm2 delete alphascope-indicators
pm2 start "$M/old/ecosystem.config.cjs" --only alphascope-api && pm2 start "$M/old/ecosystem.config.cjs" --only alphascope-indicators
pm2 save && curl -s http://127.0.0.1:4000/api/version
```

- nginx 옛 백업 · Node 24 · https 백업은 `~/projects/alphascope/backups/` 에 그대로 둬도 해가 없습니다. 지운 Vite 옛 파일 3개는 되돌리지 않습니다(옛 Vite 시절로 돌아갈 일 없음 — `rollback-to-vite.sh` 는 이제 1/4 에서 멈춤).

### Node 24 올리기 (v2.60.9 · 한 번만)

맥과 같은 **Node 24.22.1**(nodesource 패키지 `24.22.1-1nodesource1`)로 올립니다. `deploy/upgrade-node24.sh` 가 **설치 · 빌드 · 화면 복사까지** 하므로 푸시한 뒤 배포(`scripts/deploy.sh`)를 **먼저 돌리지 않습니다**.

**언제** — 서버 스케줄러가 모두 쉬는 때(KST, 11월 · 미국 서머타임이 끝난 뒤 기준):

| 때(KST) | 도는 것 | 올려도 되나 |
|---|---|---|
| **토 15:00 ~ 일 17:00** | 6시간 · 24시간마다 「오늘 받았나」 확인만(실적일 · 휴장일 · 종목 목록 · 세션 정리 — 켜지면 따라잡음) | ✅ **추천** |
| 토 06:00 ~ 14:00 | 미국 금요일 장 뒤 일 — 매수 판단 기록(06:30) · 지정 종목 Gemini 분석 · 거래정지 받기(~10:00, 안 풀린 정지가 있으면 ~14:00) · 다시 계산(10:45~14:00) | ⚠️ 피함 |
| 일 18:00 ~ | 미국 월요일 04:00 ET 부터 거래정지 받기 | ⚠️ 피함 |
| 평일 06:30 ~ 07:20 | 매수 판단(미국) · Gemini 지정 종목 · 성과 스냅샷(07:00) · 오늘 시황(07:05) | ❌ |
| 평일 09:00 ~ 15:30 · 23:30 ~ 06:00 | 국내 장 · 미국 장 — 계좌 자동매매(60초마다 손절 · 익절 검사) | ❌ |
| 05:30 앞뒤 | (배포 시간대 규칙) | ❌ |

미국 서머타임 중(3월~11월 첫 주)에는 미국 쪽 시각이 모두 1시간 앞당겨집니다(추천은 토 14:00 ~ 일 16:00).

**멈추는 시간** — AlphaScope 두 프로그램이 꺼져 있는 것은 ⑤단계(멈춤 → DB 복사 → node_modules 바꿔 끼움 → 다시 켬 → API 응답)뿐으로, **약 10~30초**입니다(맥: 서버가 켜져 응답까지 0.9초 · 오라클 2 OCPU 는 몇 배 느림 · DB 크기만큼 복사 시간이 더해짐). Node 24 설치(apt)와 `npm ci`(맥에서 캐시 없이 7초 — 오라클은 1~2분 예상)는 **서버를 켠 채로** 옆 폴더에서 먼저 합니다. 스크립트 전체는 3~5분쯤 걸립니다.

**순서** — 맥 터미널에서 한 줄씩:

1. 들어가기 전에 지금 상태만 봅니다(아무것도 바꾸지 않음 — `v22.x` · `…nodesource…` · `/usr/bin/node` 가 나와야 합니다).

   ```bash
   ssh -i ~/Documents/ClaudeCode/Work/Alphascope/secrets/Oracle-Ssh-Key/ssh-key-2026-09-19.key ubuntu@161.33.153.189 'node -v; dpkg-query -W -f="\${Version}\n" nodejs; command -v node; readlink -f "$(command -v pm2)"; df -h ~ | tail -1'
   ```

2. 서버에 들어가 코드를 받고 스크립트를 돌립니다.

   ```bash
   ssh -i ~/Documents/ClaudeCode/Work/Alphascope/secrets/Oracle-Ssh-Key/ssh-key-2026-09-19.key ubuntu@161.33.153.189
   ```

   ```bash
   cd ~/projects/alphascope/app && git pull --ff-only origin main && bash deploy/upgrade-node24.sh
   ```

   - 「━━━ 1/7 … 7/7」 을 차례로 지나 끝에 **「완료 — Node 24 (v24.22.1) · 서버 켜짐 · 오류 없음」** 이 나오면 성공입니다.
   - 「아무것도 바꾸지 않고 멈춥니다」 — 설치 방식이 예상과 다릅니다(nodesource 가 아님 · nvm · node 가 22 가 아님 등). 서버는 그대로 돕니다. 나온 글을 개발 대화에 붙여 주세요.
   - 「되돌렸습니다」 — 중간에 실패해 **스스로 Node 22 · 옛 node_modules · 옛 화면으로 되돌리고 서버를 다시 켠 것**입니다. ⚠️ 줄을 개발 대화에 붙여 주세요.
   - 이미 Node 24 면 「할 일이 없습니다」 로 끝납니다(두 번 돌려도 해가 없음).

**끝난 뒤 확인할 것**

1. 브라우저에서 `https://161.33.153.189:8080` 새로고침 → 로그인 · 차트 · 계좌가 열린다.
2. 서버에서 `node -v` = `v24.22.1` · `pm2 list` 에서 `alphascope-api` · `alphascope-indicators` 가 `online`(다른 프로젝트 줄은 그대로).
3. 다음 장에서 자동매매 · 매수 판단 기록이 평소처럼 돈다(계좌 「최근 판단」 · 매수 판단 화면의 그날 기록).
4. 며칠 문제가 없으면 백업 폴더를 지웁니다(옛 node_modules 가 있어 수백 MB): `rm -rf ~/projects/alphascope/backups/node24/alphascope-node24-backup-<날짜>`

**알아 둘 것**

- 백업 폴더 `~/projects/alphascope/backups/node24/alphascope-node24-backup-<날짜>/` — `info.txt`(옛 버전들) · Node 22 패키지(`nodejs_22…arm64.deb`) · apt 저장소 설정 · `db/`(멈춘 뒤 복사한 DB · `-wal` · `-shm`) · `node_modules.node22` · `web/`(옛 화면) · `dump.pm2` · 단계별 로그.
- 같은 서버의 **다른 프로젝트**는 멈추거나 다시 켜지 않습니다. 다만 서버의 `node` 가 24 로 바뀌므로 그 프로젝트도 **다음에 다시 켜질 때(재부팅 포함)부터 Node 24** 로 돕니다. pm2 자체(데몬)도 재부팅 전까지는 옛 Node 로 돌지만 AlphaScope 는 영향이 없습니다 — `pm2 update` 는 모든 프로그램을 다시 켜므로 쓰지 않습니다.
- DB 는 되돌릴 때도 **덮어쓰지 않습니다**(better-sqlite3 11.10 → 12.1 은 같은 SQLite 3.49.2 라 파일 형식이 같고, 되돌리기 전까지 새 서버가 쓴 기록을 잃지 않게). 사본은 백업 폴더 `db/` 에 있습니다.

**손으로 되돌리기**(스크립트가 성공한 뒤 며칠 지나 문제가 보일 때 — 서버 안에서, `<날짜>` 는 `ls ~/projects/alphascope/backups/node24` 로 확인):

```bash
B=~/projects/alphascope/backups/node24/alphascope-node24-backup-<날짜>
sudo rm -f /etc/apt/sources.list.d/nodesource.sources /etc/apt/sources.list.d/nodesource.list /etc/apt/preferences.d/nodejs /etc/apt/preferences.d/nsolid
while IFS='|' read -r NAME DEST; do sudo cp "$B/apt/$NAME" "$DEST"; done < "$B/apt-paths.txt"
sudo dpkg -i "$B"/nodejs_*.deb && node -v
pm2 stop alphascope-api alphascope-indicators
mv ~/projects/alphascope/app/node_modules "$B/node_modules.node24" && mv "$B/node_modules.node22" ~/projects/alphascope/app/node_modules
pm2 restart alphascope-api && pm2 restart alphascope-indicators && curl -s http://127.0.0.1:4000/api/version
```

되돌린 뒤 배포(`~/projects/alphascope/scripts/deploy.sh`)를 돌리면 Node 22 로 다시 설치 · 빌드합니다(`package.json` 의 `engines` 가 24 라 npm 이 경고만 냅니다).

### 주소 8080 · 443 닫기 (v2.61.2 · 한 번만)

`https://161.33.153.189` → **`https://161.33.153.189:8080`**(사용자 결정 2026-11-06). 같은 8080 에 `http://` 로 들어와도 같은 문의 https 로 넘어갑니다(nginx `error_page 497` — 「https 문에 평문 http 요청」). 문 번호 없는 주소(443)는 **접속 거절**, 80 은 인증서 확인 경로만 보내고 나머지는 **응답 없이 끊습니다**(`return 444`). 인증서는 IP 인증서라 문 번호와 상관없이 그대로 씁니다(새로 받지 않음). 앱 서버(pm2)는 다시 켜지 않습니다 — 멈추는 시간이 거의 없습니다. 배포 시간대(05:00~22:30 KST · 05:30 전후 피함) 안에.

**① 맥에서 푸시** 한 뒤 **② 서버에서**:

```bash
ssh -i ~/Documents/ClaudeCode/Work/Alphascope/secrets/Oracle-Ssh-Key/ssh-key-2026-09-19.key ubuntu@161.33.153.189
```

```bash
cd ~/projects/alphascope/app && git pull --ff-only origin main && bash deploy/apply-nginx.sh && cp ~/projects/alphascope/app/deploy/deploy.sh ~/projects/alphascope/scripts/deploy.sh && bash deploy/check-https.sh
```

`apply-nginx.sh` 가 하는 일 — ⓪ 확인(인증서 · 80 확인 경로 설정 · **다른 설정이나 프로그램이 443 을 듣지 않는지** — 들으면 지우지 않고 아무것도 바꾸지 않고 멈춤) → ① 설정 두 개(`alphascope` · `alphascope-acme`) 백업 → ② 넣기 → ③ `nginx -t` → ④ reload → ⑤ 확인(`https://161.33.153.189:8080/` · `/api/version` 200 · `http://…:8080/…` → 같은 경로 https 301 · 443 접속 거절 · 80 확인 파일 200 · 80 그 밖 끊김) → ⑥ **인증서 갱신 연습**(`sudo certbot renew --dry-run --cert-name 161.33.153.189`) → ⑦ iptables 의 443 규칙 지우고 저장(지우기 전 목록 `~/projects/alphascope/backups/https/alphascope-iptables-INPUT.backup-<날짜>.txt`). ⑤ · ⑥ 이 실패하면 **두 설정을 백업으로 되돌리고 예전 주소(`https://161.33.153.189`)가 200 인지 확인한 뒤 멈춥니다**(iptables 는 그때까지 건드리지 않음).

- 끝에 **「적용 완료 — AlphaScope 주소: https://161.33.153.189:8080 …」** 이 나오면 성공입니다.
- 갱신 연습만 따로: `sudo certbot renew --dry-run --cert-name 161.33.153.189`(스테이징 서버 · 저장 안 함).

**③ 오라클 웹 콘솔** — 보안 목록(Default Security List)의 수신 규칙에서 **TCP 443 한 줄만 지웁니다**. 80(인증서 확인) · 8080(AlphaScope) · 8081(다른 프로젝트) · 22(ssh)는 그대로 둡니다.

**④ 확인** — `https://161.33.153.189:8080` 자물쇠 · 로그인 · 차트 · 계좌 · 자산 관리 / `http://161.33.153.189:8080` 과 맥 아이콘이 https 8080 으로 열림 / `https://161.33.153.189` 는 열리지 않음 / `check-https.sh` 「결과: 괜찮음」.

**⑤ 되돌리기**(그 뒤 문제가 보일 때 — 서버 안에서. 103차(2026-11-06) 적용 때 만든 백업은 `…-20261106-120406` 두 개이고, v2.61.3 폴더 정리 뒤에는 `~/projects/alphascope/backups/nginx/` 에 있습니다 — `ls ~/projects/alphascope/backups/nginx` 로 확인):

```bash
B=~/projects/alphascope/backups/nginx
sudo cp $B/alphascope.backup-20261106-120406 /etc/nginx/sites-available/alphascope
sudo cp $B/alphascope-acme.backup-20261106-120406 /etc/nginx/sites-available/alphascope-acme
sudo nginx -t && sudo systemctl reload nginx
sudo iptables -I INPUT 6 -p tcp --dport 443 -m state --state NEW -j ACCEPT && sudo netfilter-persistent save
```

- 배포 스크립트는 지금 것(`scripts/deploy.sh`)을 그대로 둡니다 — 옛 판(v2.61.1)은 옛 자리(`~/alphascope`)를 찾아 폴더 정리 뒤에는 돌지 않습니다. 되돌린 뒤 배포 끝의 화면 확인(8080)만 ⚠️ 로 나옵니다.

- 콘솔 보안 목록에 443 을 다시 더합니다. 맥 아이콘은 관리 루트 `launcher/_backup/AlphaScope.app.20261106-2`(`https://161.33.153.189` 를 여는 것)를 `launcher/AlphaScope.app` 자리에 되돌립니다.

### https 로 바꾸기 (v2.61.1 · 한 번만 — 오라클은 이미 함 · 새 서버에서만)

`http://161.33.153.189:8080` → **`https://161.33.153.189:8080`**(Let's Encrypt IP 인증서 · 무료 · 같은 문이 https 가 되고 평문 http 는 https 로 넘어감). 근거 · 출처는 아래 「HTTPS 조사」.

**언제** — 앱 서버(pm2)는 다시 켜지 않고 nginx 만 다시 읽으므로 **멈추는 시간이 거의 없습니다**(자동매매 · 스케줄러는 그대로 돕니다). 그래도 장 밖(위 「Node 24 올리기」 표의 토 15:00 ~ 일 17:00 추천)에, 배포 시간대(05:00~22:30 KST · 05:30 전후 피함) 안에 합니다. 5~10분.

**① 오라클 웹 콘솔** — 보안 목록에 80 을 더합니다(서버 안에서는 이것을 볼 수 없어 스크립트가 물어봅니다).
☰ → 네트워킹 → 가상 클라우드 네트워크 → VCN → 서브넷 → 공용 서브넷 → 보안 목록 → Default Security List → 수신 규칙 추가:

| 소스 CIDR | IP 프로토콜 | 대상 포트 | 설명 |
|---|---|---|---|
| `0.0.0.0/0` | TCP | `80` | 인증서 확인(약 3일마다 갱신 — 늘 열어 둠) |

8080 · 8081 규칙은 그대로 둡니다(8080 은 AlphaScope https · 8081 은 다른 프로젝트). 443 은 열지 않습니다.

**② 서버에서** — 맥 터미널:

```bash
ssh -i ~/Documents/ClaudeCode/Work/Alphascope/secrets/Oracle-Ssh-Key/ssh-key-2026-09-19.key ubuntu@161.33.153.189
```

```bash
cd ~/projects/alphascope/app && git pull --ff-only origin main && ~/projects/alphascope/scripts/deploy.sh && bash deploy/setup-https.sh
```

- 배포 스크립트 사본(`scripts/deploy.sh` · 8080 확인)으로 v2.61.1 을 먼저 올립니다(끝에 「배포 스크립트가 바뀌었습니다」 가 나오면 정상 — https 가 된 뒤에 바꿉니다).
- `setup-https.sh` 가 중간에 「보안 목록에 … 더했습니까?」 를 물으면 `yes` 를 칩니다.
- 「━━━ 1/6 … 6/6」 을 지나 끝에 **「완료 — https://161.33.153.189:8080 · 인증서 만료 … · 다음 갱신 예정 …」** 이 나오면 성공입니다. 이어서:

```bash
cp ~/projects/alphascope/app/deploy/deploy.sh ~/projects/alphascope/scripts/deploy.sh
```

- 「아무것도 바꾸지 않고 멈춥니다」 — 서버 모양이 예상과 다릅니다(8080 을 다른 사이트 · 프로그램이 씀 · apt 로 깐 certbot · 이전 시도가 남음 · 콘솔에서 안 열었다고 답함 등). 주소는 8080 그대로입니다. 나온 글을 개발 대화에 붙여 주세요.
- 「되돌리기 … 되돌렸습니다 — http://161.33.153.189:8080 가 그대로 됩니다」 — 중간(Certbot 설치 · 80번 문 시험 · 인증서 받기 · 새 nginx 설정 · 갱신 연습)에 실패해 **nginx 설정 · iptables · 받은 인증서 · 이 스크립트가 깐 Certbot 을 전으로 돌린 것**입니다. ⚠️ 줄을 붙여 주세요. 보안 목록 규칙은 그대로 남습니다(지우려면 콘솔에서).
- 이미 https 면 「할 일이 없습니다」 로 끝납니다(두 번 돌려도 해가 없음).

**③ 끝난 뒤 확인**

1. 브라우저에서 `https://161.33.153.189:8080` — 주소창에 자물쇠 · 경고 없음 → 로그인 · 차트 · 계좌.
2. `http://161.33.153.189:8080` 과 맥 아이콘(`launcher/AlphaScope.app` — https 8080 을 엶)이 https 로 열린다.
3. (원하면) 브라우저 개발자 도구 → 응용 프로그램(Application) → 쿠키 `as_session` 의 **Secure** 칸이 체크(다시 로그인한 뒤 — 옛 쿠키는 그대로 쓰이다가 다음 로그인 때 바뀝니다).
4. 서버에서 `bash ~/projects/alphascope/app/deploy/check-https.sh` → 「결과: 괜찮음」. **일주일 뒤에도** 한 번 더(자동 갱신을 두 번 넘게 지난 뒤 — 만료 날짜가 뒤로 밀려 있어야 함).

**갱신이 멈춘 것을 알아채는 법** — Let's Encrypt 만료 알림 메일은 끝났습니다. ① 배포(`scripts/deploy.sh`) 끝에 「인증서: 만료 … · 48시간 넘게 남음」 한 줄(48시간 안이면 ⚠️) ② 아무 때나 `bash ~/projects/alphascope/app/deploy/check-https.sh`(인증서 · 타이머 · 마지막 갱신 기록) ③ 마지막 안전망은 브라우저의 「안전하지 않음」 경고(HSTS 를 넣지 않아 경고를 넘겨 들어가 고칠 수 있음). 손으로 갱신: `sudo certbot renew --cert-name 161.33.153.189`.

**④ 되돌리기**(https 가 된 뒤 며칠 지나 문제가 보일 때 — 서버 안에서. `<날짜>` 는 `ls ~/projects/alphascope/backups/https`):

```bash
B=~/projects/alphascope/backups/https/alphascope-https-backup-<날짜>
sudo cp "$B/alphascope.conf" /etc/nginx/sites-available/alphascope
sudo rm -f /etc/nginx/sites-enabled/alphascope-acme /etc/nginx/sites-available/alphascope-acme
sudo nginx -t && sudo systemctl reload nginx
# 배포 스크립트는 지금 것(scripts/deploy.sh)을 그대로 둔다 — 옛 판(fe034fe)은 옛 자리(~/alphascope)를 찾아 폴더 정리(v2.61.3) 뒤에는 돌지 않는다
```

- 이것으로 `http://161.33.153.189:8080` 이 예전처럼 열립니다(멈춤 없음). 인증서 · Certbot · 80 문은 남아도 해가 없습니다 — 다 지우려면 이어서 `sudo certbot delete --cert-name 161.33.153.189 && sudo snap remove certbot && sudo rm -f /usr/local/bin/certbot` · `sudo iptables -D INPUT -p tcp --dport 80 -m state --state NEW -j ACCEPT && sudo netfilter-persistent save` · 콘솔 보안 목록의 80 규칙 삭제.
- 맥 아이콘은 관리 루트 `launcher/_backup/AlphaScope.app.20261106`(`http://…:8080` 을 여는 옛것)을 `launcher/AlphaScope.app` 자리에 되돌립니다.

### 같은 서버에 다른 프로젝트가 있을 때

배포는 **AlphaScope 두 프로그램(`alphascope-api` · `alphascope-indicators`)만** 다시 켭니다 — `pm2 restart all` 같은 「모두」 명령은 쓰지 않으므로 다른 프로젝트의 pm2 프로그램은 그대로 돕니다. 둘 가운데 하나가 pm2 에 없으면 `ecosystem.config.cjs` 로 그 이름만 켜고 알립니다. 끝의 pm2 상태도 AlphaScope 두 줄만 보입니다. 다른 프로젝트의 pm2 설정 · nginx 설정 파일은 AlphaScope 것(`ecosystem.config.cjs` · `/etc/nginx/sites-available/alphascope`)과 **따로** 두고, 문은 AlphaScope 8080(https · 같은 문 http 는 https 로 넘김) · 80(인증서 확인 — `sites-available/alphascope-acme`) · 다른 프로젝트 8081 로 나눕니다(443 은 아무도 듣지 않음). `sudo nginx -t` · `reload` 는 모든 사이트에 함께 걸리므로, 다른 사이트 설정이 틀려 있으면 AlphaScope 배포도 `nginx -t` 에서 멈춥니다(화면 복사는 이미 끝난 뒤 — pm2 는 다시 켜지지 않음).

## 로그인 비밀번호

비밀번호는 서버에서만 정합니다. **정하기 전에는 앱이 잠겨 있습니다**(모든 API 503 — 의도된 동작).

```bash
ssh -i ~/Documents/ClaudeCode/Work/Alphascope/secrets/Oracle-Ssh-Key/ssh-key-2026-09-19.key ubuntu@161.33.153.189
cd ~/projects/alphascope/app && npm run auth:set-password
```

비밀번호를 잊었을 때도 같은 명령을 다시 돌립니다. 바꾸면 모든 기기의 로그인이 끊깁니다.
기기 하나만 끊으려면 앱의 「설정 > 앱 기능 설정 > 로그인된 기기」 에서 [로그아웃] 을 누릅니다.


## 처음 서버를 완성본 방식으로 바꿀 때 (한 번만 — 이미 했다면 필요 없음)

아래 명령을 **순서대로 하나씩** 복사해 붙여 넣습니다.

1. 맥의 터미널에서 서버에 들어갑니다. (줄 앞이 `ubuntu@alphascope-server` 로 시작하면 이미 서버 안이니 건너뜁니다.)

   ```bash
   ssh -i ~/Documents/ClaudeCode/Work/Alphascope/secrets/Oracle-Ssh-Key/ssh-key-2026-09-19.key ubuntu@161.33.153.189
   ```

2. 최신 코드를 받습니다.

   ```bash
   cd ~/projects/alphascope/app && git pull --ff-only origin main
   ```

3. 전환 스크립트를 실행합니다. (1~2분 걸립니다. 마지막에 「전환 완료」 가 나오면 성공입니다.)

   ```bash
   bash deploy/switch-to-static.sh
   ```

   - 중간에 「⚠️ … 되돌립니다」 가 나오면 **자동으로 예전 상태로 돌아간 것**입니다. 화면은 그대로 쓸 수 있습니다. 나온 글을 그대로 알려 주세요.

4. 브라우저에서 서버 주소를 **새로고침**하고 세 가지를 봅니다.
   1. 로그인 화면이 뜨고, 로그인하면 종목 지도·차트가 보인다.
   2. 글자 모양(글꼴)이 전과 같다.
   3. 서버에서 `pm2 list` 를 쳤을 때 `alphascope-web` 이 없고 `alphascope-api`·`alphascope-indicators` 가 `online` 이다.

## 되돌리기

- **nginx 설정을 바꾼 뒤 문제가 생기면**: `apply-nginx.sh` 는 검사 · 확인이 실패하면 스스로 되돌립니다. 적용된 뒤에 되돌리려면 그때 남긴 백업을 넣습니다(이름은 `ls /etc/nginx/sites-available/` 로 확인).

  ```bash
  sudo cp /etc/nginx/sites-available/alphascope.backup-<날짜> /etc/nginx/sites-available/alphascope && sudo nginx -t && sudo systemctl reload nginx
  ```

- ⚠️ `rollback-to-vite.sh` 는 **옛 Vite 시절(80번) 설정**으로 돌아갑니다 — 지금은 쓰지 않습니다.

## 자주 생길 일

| 보이는 것 | 뜻 | 할 일 |
|---|---|---|
| 403 Forbidden | nginx 가 화면 폴더를 못 읽는다 | `ls -ld /var/www/alphascope` 로 권한 확인 → `sudo chmod 755 /var/www/alphascope`(화면 폴더를 홈 폴더 `~/projects/alphascope/app/dist` 에 두지 않는다) |
| 502 Bad Gateway (로그인·데이터가 안 뜸) | API 서버가 꺼져 있다 | `pm2 logs alphascope-api --lines 30` 으로 이유 확인 → `pm2 restart alphascope-api` |
| 모든 화면이 잠겨 있다(503) | 비밀번호를 아직 정하지 않았다 | 위 「로그인 비밀번호」 |
| 배포했는데 화면이 옛날 것 | 브라우저가 예전 화면을 들고 있다 | 새로고침(맥 `Cmd+Shift+R`, 윈도 `Ctrl+F5`) — 앱 위에 「서버가 옛 버전」 띠가 보이면 반대로 서버 배포가 덜 된 것이다 |

| 「오늘 시황」 수집 상태에 뉴스 · 시장 데이터 실패 | 오라클에서 RSS(연합뉴스 · 매일경제 · 전자신문 · CNBC · MarketWatch · 연준) · 미국 재무부(미 2년물) · yfinance 가 막혔거나 그 사이트가 죽었다 | 화면 「수집 상태 보기」 에 곳마다 실패 이유가 보인다. 한 곳만 실패면 나머지로 만든다(국내 4곳이 다 실패하면 SBS 경제로 대신). 오래 막히면 `curl -sI <주소>` 로 오라클에서 닿는지 확인 · `pm2 logs alphascope-api --lines 50 \| grep market-brief` |
| 「오늘 시황」 이 아침에 안 생김 | 07:05 무렵 서버가 꺼져 있었거나(13시 전에 켜지면 보충) · 자동 실행 중 재시작됐다(그날은 다시 안 만듦 — Gemini 두 번 쓰기 방지) · `MARKET_BRIEF_ENABLED=false` | 화면 「시황 분석」 으로 만든다. 07:00~07:20 에는 배포를 피한다 |

진단 리포트 파일은 서버의 `~/projects/alphascope/app/reports/` 에 쌓입니다.

### 실적일 날짜 (v2.59.1)

실적 발표일을 그 종목 시장의 현지 날짜로 자르게 고쳤습니다(전에는 UTC 날짜 — 국내 아침 발표가 하루 이르게 될 수 있었다). **이미 저장된 날짜는 배포 다음 실적일 갱신(하루 1번 — 서버가 켜지고 90초 뒤 · 6시간마다 「오늘(KST) 받았나」 확인)부터 맞는 날짜로 바뀝니다.** 따로 DB 를 고치지 않습니다. 기업정보 화면의 실적일은 그 종목 기업정보 캐시(24시간)가 새로 받아질 때 바뀝니다. 2026-10-30 맥에서 본 영향 목록은 0종목(지금 yfinance 의 국내 시각은 15:00 · 19:59 KST 라 UTC 로도 같은 날)입니다.

### 오늘 시황 스위치 (v2.59.0)

- `MARKET_BRIEF_ENABLED`(기본 켬) — 평일 06:55 KST 뒤 첫 10분 확인(07:05 무렵)에 오전판을 자동으로 만든다. `false` 면 자동만 끄고 「시황 분석」 버튼(횟수 제한 없음)은 그대로.
- `GEMINI_BRIEF_MODEL`(기본 비움 = `GEMINI_MODEL`) — 오늘 시황만 다른 Gemini 모델로. 브리핑 1번 = Gemini 1번(실패하면 1번만 다시 · 429 면 다시 하지 않음).
- 자동 한 번에 RSS 8곳(대체 소스는 첫 후보가 안 되면 다음 후보) · 미국 재무부 1~2번 · 지표 엔진(yfinance 지수 13종 + 60일 안 실적 종목의 전망치 — 종목당 4번, 엔진이 6시간 캐시).

### 자산 관리 시트 가격 스위치 (v2.65.0)

- `ASSET_PRICE_WRITE_ENABLED`(**기본 꺼짐** — 값이 정확히 `true` 일 때만 켬) — 설정 창 「시트 가격」 의 [시트 가격을 토스로 바꾸기] · [되돌리기] 와, 토스로 바꾼 뒤 장이 열린 동안 10초마다 바뀐 가격 · 환율만 시트 「티커」 에 쓰는 일. `ASSET_SYNC_ENABLED` 도 켜져 있어야 한다.
- **오라클에서만 켠다**(맥 사용자 서버가 같은 시트에 함께 쓰면 겹친다). 오라클에 **접속한 상태에서** 한 줄(이미 있으면 그 줄만 `true` 로 고치고, 없으면 끝에 더함 → AlphaScope 두 이름만 다시 켬):

```bash
F=~/projects/alphascope/app/.env; if grep -q '^ASSET_PRICE_WRITE_ENABLED=' "$F"; then sed -i 's/^ASSET_PRICE_WRITE_ENABLED=.*/ASSET_PRICE_WRITE_ENABLED=true/' "$F"; else [ -n "$(tail -c1 "$F")" ] && echo >> "$F"; echo 'ASSET_PRICE_WRITE_ENABLED=true' >> "$F"; fi; grep -c '^ASSET_PRICE_WRITE_ENABLED=true$' "$F"; pm2 restart alphascope-api && pm2 restart alphascope-indicators
```

- 확인: `pm2 logs alphascope-api --lines 50 --nostream | grep '시트 가격'` 에 「시트 가격 쓰기를 하지 않습니다」 가 **없어야** 한다(꺼져 있으면 서버가 켜질 때 이 줄을 남긴다). 끄려면 그 줄을 `false` 로 고치고 같은 두 이름을 다시 켠다(시트는 그때 모양 그대로 — 먼저 [되돌리기] 를 누른다).
- 부담: 토스 시세 10초에 1번 · 환율 60초에 1번 · 구글 쓰기 10초에 1번 이하(바뀐 칸이 없거나 두 시장이 닫히면 0) · 쓰기 전 줄 코드 확인 읽기 1번.

### 자산 원본 시트로 바꾸기 (v2.65.1 · 한 번만)

앱이 읽는 시트는 오라클 `.env` 의 `ASSET_SHEET_ID` 하나로 정해진다. 아래 순서대로 한다(오라클 명령은 **오라클에 접속한 상태에서** 친다).
시트 ID 는 구글 시트 주소 `https://docs.google.com/spreadsheets/d/<여기>/edit` 의 `<여기>` 부분이다.

1. (앱) 자산 관리 → 설정 → 「시트 가격」 [되돌리기] — 시험용 시트의 가격 칸을 GOOGLEFINANCE 로 되돌린다. 「줄이 옮겨짐 — 직접 확인」 목록이 보이면 시트 줄을 원래대로 돌린 뒤 [되돌리기] 를 다시 눌러 목록을 먼저 비운다.
2. (구글 시트) 원본에서 「파일 → 버전 기록 → 현재 버전 이름 지정」.
3. (구글 시트) 원본 「티커」 탭에 D열을 넣고 D12 에 `자산 분류` — 시험용 시트와 같은 자리.
4. (구글 시트) 원본을 서비스 계정 이메일에 **편집자**로 공유한다. 이메일은 5번 점검이 「1. 열기」 줄(또는 실패 문구)에 알려 준다.
5. (오라클) 점검 — 읽기만 한다(쓰기 0). 마지막 줄이 「✅ 연결해도 됩니다」 인지 본다. 「❌」 이면 그 위의 칸을 고치고 다시 친다.

```bash
cd ~/projects/alphascope/app && npm run -s asset:check-sheet -- --sheet <원본 ID>
```

6. (오라클) `.env` 의 `ASSET_SHEET_ID` 를 원본 ID 로 바꾸고(있으면 그 줄만 바꾸고 없으면 끝에 더함 · 값은 출력하지 않고 맞는 줄 개수만 — `1` 이면 됨) AlphaScope 두 이름만 다시 켠다.
   ⚠️ **v2.65.1 이상을 배포해 서버가 시험용 시트로 한 번 켜진 뒤에** 한다 — 그 전에 바꾸면 새 코드가 처음 켜질 때 원본을 「처음 연결」 로 보고 저장만 해, 시험용 하루 기록이 보관되지 않고 원본 기록과 섞인다.

```bash
ID='<원본 ID>'; F=~/projects/alphascope/app/.env; if grep -q '^ASSET_SHEET_ID=' "$F"; then sed -i "s|^ASSET_SHEET_ID=.*|ASSET_SHEET_ID=$ID|" "$F"; else [ -n "$(tail -c1 "$F")" ] && echo >> "$F"; echo "ASSET_SHEET_ID=$ID" >> "$F"; fi; grep -c "^ASSET_SHEET_ID=$ID\$" "$F"; pm2 restart alphascope-api && pm2 restart alphascope-indicators
```

   - 서버가 켜질 때 시트가 바뀐 것을 알아채고 **한 번만** 정리한다: 하루 기록(총 자산 차트)을 보관표 `asset_daily_archive` 로 옮기고 새로 쌓기 시작 · 시트 가격 상태를 처음(Google)으로 · 옛 시트 백업이 남아 있으면 지우지 않고 보관(새 시트에는 쓰지 않음). 위성 종목 · 연금 계좌 · 분류 색 · 괜찮음 범위 · 구매 기록은 그대로.
   - 확인: `pm2 logs alphascope-api --lines 80 --nostream | grep '시트가 바뀜'` 에 「[asset] 시트가 바뀜 — 하루 기록 n줄 보관 · 옛 시트 백업 n칸 보관」 한 줄.
7. (앱) 자산 관리 화면 확인 → 「자산 현황」 에서 D열 자산 분류 고르기 → 설정 「시트 가격」 [시트 가격을 토스로 바꾸기].
8. 되돌리고 싶을 때: 6번 명령의 ID 를 시험용 시트 ID 로 바꿔 다시 친다(두 이름 다시 켜기 포함). 그때 쌓인 하루 기록도 보관표로 옮겨지고 **자동으로 복원되지 않는다**(필요하면 따로 요청). 원본에서 [시트 가격을 토스로 바꾸기] 를 했다면 먼저 [되돌리기] 를 누른다.

## 점검 도구

- 자산 시트 점검(`asset:check-sheet`) — 위 「자산 원본 시트로 바꾸기」 5번(읽기만 · `--sheet` 가 없으면 `.env` 의 `ASSET_SHEET_ID`).

### 오늘 시황 소스 점검 (`marketbrief:sources`)

오늘 시황이 받는 뉴스 RSS · 해외 대체 소스 후보(MarketWatch → 미국 연준 보도자료) · 미국 2년물 금리 출처(미국 재무부)가 **오라클에서** 열리는지 봅니다.
각 소스 · 후보를 **1번씩** 열어 표를 찍습니다 — 앱 DB 를 열지 않고 Gemini · 토스를 부르지 않습니다. 미2년물은 지표 엔진 가상환경의 파이썬(`python/.venv`)으로 엽니다:

```bash
cd ~/projects/alphascope/app && npm run -s marketbrief:sources
```

「묶음 | 후보 | HTTP | 걸린 시간 | 받은 건수/값」 표와 「N곳 중 M곳 받음」 한 줄이 나옵니다. 뉴스 칸은 「N건 · 72시간 안 N건 · 최신 날짜」 — 72시간 안 0건인 소스는 묵은 피드입니다(오늘 시황은 72시간 넘은 글을 빼고 씁니다). 표를 개발 대화에 붙이면 다음 차수에서 후보를 정합니다. 1분 남짓 걸릴 수 있습니다(막힌 곳은 15초 제한).

### 미국 매수 판단 다시 계산 결과 (`recheck:report`)

서버가 미국 거래일 20:45 ET 뒤(한국 다음 날 09:45 · 11-02 부터 10:45) 매수 판단을 최종 일봉으로 한 번 더 계산해 16:30 기록과 달라진 것만 남깁니다(v2.58.0).
결과는 **오라클에 들어가서** 봅니다(앱 DB 를 읽기 전용으로 엽니다 — 쓰지 않고 토스도 부르지 않습니다):

```bash
cd ~/projects/alphascope/app && npm run -s recheck:report
```

「다시 계산 N건 · 달라짐 M건(action 바뀜 a · code 바뀜 b · 점수만 바뀜 c)」 · 달라진 줄 표 · 한 줄 결론이 나옵니다. 기간만 보려면 `npm run -s recheck:report -- --from 2026-11-02 --to 2026-11-06`. 끄려면 `.env` 에 `BUYJUDGE_RECHECK_ENABLED=false` 를 넣고 pm2 를 다시 켭니다.

### 16:30 값 vs 최종값 매수 판단 견주기 (`ussample:judge`)

`~/projects/alphascope/data/us-close.jsonl`(아래 `ussample:run` 기록)의 16:30 ET 무렵 값과 최종값으로 같은 규칙(「기본 규칙」 + 자동매매를 켠 계좌의 규칙)을 두 번 판단해
action · code · 점수가 바뀌는지 셉니다(v2.58.2). **오라클에 들어가서** 한 번 돌립니다:

```bash
cd ~/projects/alphascope/app && npm run -s ussample:judge
```

- 읽기만 합니다 — 앱 DB 는 읽기 전용으로 열어 규칙 · 계좌 설정만 읽고, 캔들 캐시 · 매수 판단 기록 · 다시 계산 표에 쓰지 않습니다. 주문 없음.
- 토스 일봉 받기: 기록에 있는 종목마다 한 번 + 시장 기준(SPY) 한 번(시장 필터 규칙이 있을 때) — 실패한 종목만 한 번 더. 받기 한 번 = 일봉 300개 = 토스 요청 2쪽.
- `ussample:run` 기록 시간대(15:55~20:40 ET) 밖에 돌립니다 — 같은 토큰 파일을 같이 고치지 않게. 토큰은 `ussample:run` 과 같은 토큰 파일(`~/projects/alphascope/data/.toss-token.json`, 권한 600)을 씁니다.
- 지표 엔진(pm2 `alphascope-indicators`)이 떠 있어야 합니다 — 꺼져 있으면 안내만 하고 끝납니다.
- 「견줌 N건 · 달라짐 M건(action 바뀜 a · code 바뀜 b · 점수만 바뀜 c) …」 · 달라진 줄 · 한 줄 결론이 나옵니다. 다른 기록 파일은 `USSAMPLE_OUT=<경로>` 로.

### 미국 마감 직후 값 기록 (`ussample:run` · `ussample:report`)

매수 판단 매일 기록(16:30 ET)이 받는 미국 일봉이 애프터마켓이 끝난 뒤의 최종값과 같은지 보려고, 미국 거래일 15:55~20:40 ET 에
5분마다 그날 일봉을 받아 `~/projects/alphascope/data/us-close.jsonl` 에 적습니다. 앱 DB 에는 쓰지 않습니다(읽기만).
종목과 기간(`startDate` ~ `endDate`)은 `scripts/usCloseSampler.symbols.json` 에 있습니다 — 기간이 지나면 스스로 아무것도 하지 않으므로 예약을 늦게 지워도 해가 없습니다.
배포(`scripts/deploy.sh`)를 먼저 한 뒤에 설치합니다. 맥 터미널에 한 줄씩 붙여 넣습니다.

설치(두 번 실행해도 예약은 한 줄 — 마지막에 「예약 줄 수: 1」):

```bash
ssh -i ~/Documents/ClaudeCode/Work/Alphascope/secrets/Oracle-Ssh-Key/ssh-key-2026-09-19.key ubuntu@161.33.153.189 'N=$(command -v node) || { echo "node 를 찾지 못했습니다"; exit 1; }; mkdir -p ~/projects/alphascope/data && L="*/5 * * * * cd $HOME/projects/alphascope/app && PATH=$(dirname "$N"):/usr/bin:/bin ./node_modules/.bin/tsx scripts/usCloseSampler.ts >> $HOME/projects/alphascope/data/cron.log 2>&1 # alphascope-ussample" && (crontab -l 2>/dev/null | grep -v "# alphascope-ussample"; echo "$L") | crontab - && echo "예약 줄 수: $(crontab -l | grep -c "# alphascope-ussample")"'
```

결과 보기(표 + 한 줄 결론, 끝에 기록 로그 마지막 3줄):

```bash
ssh -i ~/Documents/ClaudeCode/Work/Alphascope/secrets/Oracle-Ssh-Key/ssh-key-2026-09-19.key ubuntu@161.33.153.189 'cd ~/projects/alphascope/app && npm run -s ussample:report; tail -n 3 ~/projects/alphascope/data/cron.log 2>/dev/null'
```

지우기(마지막에 「남은 예약 줄 수: 0」 — 기록 파일과 토큰 파일(`.toss-token.json`, 1시간 안에 만료)은 남습니다):

```bash
ssh -i ~/Documents/ClaudeCode/Work/Alphascope/secrets/Oracle-Ssh-Key/ssh-key-2026-09-19.key ubuntu@161.33.153.189 '(crontab -l 2>/dev/null | grep -v "# alphascope-ussample") | crontab - && echo "남은 예약 줄 수: $(crontab -l 2>/dev/null | grep -c "# alphascope-ussample")"'
```

## HTTPS 조사 (v2.61.1 · 2026-11-06 · 공식 자료만)

IP 주소(`161.33.153.189`)에 Let's Encrypt 인증서를 받아 https 로 여는 방법을 공식 자료로 확인한 결과입니다(인증서 대상은 IP 라 문 번호와 상관없음 — 지금 주소는 `https://161.33.153.189:8080`). 「모름」 은 공식 자료에서 확인하지 못한 것입니다.

| 물음 | 결과 | 출처 |
|---|---|---|
| IP 인증서를 받을 수 있나 | 됩니다(IPv4 · IPv6). **`shortlived` 프로필만** — 수명 160시간(약 6일). `classic` · `tlsserver` 프로필은 도메인만 | [6일 · IP 인증서 정식 제공(2026-01-15)](https://letsencrypt.org/2026/01/15/6day-and-ip-general-availability) · [프로필 문서](https://letsencrypt.org/docs/profiles/)(shortlived 「Identifier Types: DNS, IP」 · Validity 160 hours) |
| 확인 방식 | **HTTP-01**(80번 문에서만) · **TLS-ALPN-01**(443번 문) 이 IP 에 됩니다. **DNS-01 은 IP 에 안 됩니다** | [Challenge Types](https://letsencrypt.org/docs/challenge-types/) — 「HTTP-01 … can only be done on port 80 … can be used to validate IP Addresses」 · 「DNS-01 … cannot be used to validate IP Addresses」 · 「TLS-ALPN-01 … on port 443 … can be used to validate IP Addresses」 |
| 클라이언트 | **Certbot 5.4 이상**(`--ip-address` 는 5.3 · webroot 로 IP 는 5.4 · `--preferred-profile` 는 4.0). nginx · apache 설치 기능(`--nginx`)은 IP 를 아직 못 함 → **`certonly --webroot` 로 받기만** 하고 nginx 설정은 `/etc/letsencrypt/live/<IP>/fullchain.pem` · `privkey.pem` 을 직접 가리키고, 갱신 뒤 다시 읽게 `--deploy-hook` | [Certbot 의 6일 · IP 인증서(2026-03-11)](https://letsencrypt.org/2026/03/11/shorter-certs-certbot) |
| `--required-profile` | 「프로필을 못 주면 기본 프로필로 넘어가지 않고 실패」 — IP 인증서는 shortlived 밖에 안 되므로 이것을 씁니다 | [Certbot 사용 설명](https://eff-certbot.readthedocs.io/en/stable/using.html)(CLI 도움말) |
| Certbot 이 TLS-ALPN-01 을 하나 | Certbot 문서에는 http-01 · dns-01 만 나옵니다 → **이 서버에서는 HTTP-01(80번 문)** | 위 Certbot 사용 설명 |
| 설치 | Certbot 공식 안내 = **snap**(`sudo snap install --classic certbot` · `ln -s /snap/bin/certbot /usr/local/bin/certbot`) · apt 로 깐 certbot 이 있으면 먼저 지우라고 함. 우분투 apt 의 certbot 은 24.04 = 2.9.0 · 26.04 = 4.0.0 으로 **5.4 미만이라 쓸 수 없음**. snap 지금 판 = 5.9.0(2026-10-29) | [Certbot 설치 안내(nginx · snap)](https://certbot.eff.org/instructions?ws=nginx&os=snap) · [Ubuntu 패키지](https://packages.ubuntu.com/search?keywords=certbot&searchon=names&exact=1) · [snapcraft certbot](https://snapcraft.io/certbot) |
| snap 이 ARM(arm64)에 있나 | **모름**(snapcraft 페이지가 아키텍처를 보여 주지 않음) → 스크립트가 설치에 실패하면 아무것도 바꾸지 않은 채 멈춥니다 | — |
| nginx 를 멈추나 | 멈추지 않습니다 — webroot 방식은 돌고 있는 웹 서버가 `/.well-known/acme-challenge/` 파일을 보내게 함(standalone 은 80 을 쓰는 서버를 멈춰야 해서 쓰지 않음). webroot 는 숨은 폴더를 보낼 수 있어야 함 | 위 Certbot 글 · 사용 설명 |
| 자동 갱신 주기 | snap 은 **systemd 타이머**를 함께 깜(`systemctl list-timers` 로 확인). Certbot 은 하루 2번 `certbot renew` 를 돌리는 방식 · **수명 10일 이하 인증서는 수명의 1/2 이 남으면 갱신**(6일 인증서 = 받은 지 약 3.3일 뒤) | 위 설치 안내 · 사용 설명 「As of Certbot 4.0.0 … For certificates with a lifetime of 10 days or less, that threshold is 1/2」 |
| 실패하면 몇 번 다시 하나 | 따로 「다시 시도」 는 없고 **다음 타이머(약 12시간 뒤)에 또 함** → 만료까지 남은 약 80시간 동안 6번쯤 기회. ARI(서버가 갱신 시각을 알려 주는 것)를 Certbot 이 쓰는지는 **모름** | 위 사용 설명(타이머 · 1/2) — 횟수는 그 둘로 셈 |
| 갱신 뒤 nginx | `--deploy-hook "systemctl reload nginx"` — **갱신에 성공했을 때만** 돎(설정은 갱신 설정 파일에 남음) | 위 Certbot 글 · 사용 설명 「--deploy-hook … only after a successful renewal」 |
| 갱신 연습 | `certbot renew --dry-run`(스테이징 서버 · 저장 안 함) · 처음 받기 전에 `--staging` / `--dry-run` 으로 시험 | 위 설치 안내 · Certbot 글 |
| 만료 알림 메일 | Let's Encrypt 만료 알림 메일은 **2025-06-04 에 끝남** → 메일로 알 수 없음 | [만료 알림 종료](https://letsencrypt.org/2025/06/26/expiration-notification-service-has-ended) |
| 열어 둘 문 | HTTP-01 은 **80** 이 늘 열려 있어야 함(6일 인증서를 약 3일마다 갱신 — 잠깐 여는 것은 맞지 않음). 확인 요청이 넘김(리다이렉트)을 따라가긴 하지만 **80 · 443 으로만** 감 → 80 은 확인 경로만 보내고(넘기지 않음) 나머지는 끊습니다(`return 444`). https 는 8080 · 443 은 닫음 | Challenge Types(「only to ports 80 or 443」) |
| TLS 설정 | Mozilla 권장 **intermediate**(지침 6.0): TLSv1.2 · TLSv1.3 · ECDHE + AES-GCM / CHACHA20 6개 · 서버 순서 우선 안 함. 곡선 목록의 `X25519MLKEM768` 은 OpenSSL 3.5 가 있어야 해서 넣지 않음(우분투 nginx 가 그보다 옛 OpenSSL 이면 `nginx -t` 실패). OCSP 스테이플링은 하지 않음 — shortlived 인증서는 폐기 정보가 없음(프로필 문서). **HSTS 는 넣지 않음** — 6일 인증서 갱신이 한 번 늦으면 브라우저가 「그래도 계속」 을 막음 | [Mozilla 지침 latest.json](https://ssl-config.mozilla.org/guidelines/latest.json) · 프로필 문서 |
| 서버 방화벽(iptables) | 11-03 과 같은 방식: `sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport <문> -j ACCEPT` → `sudo netfilter-persistent save` | 관리 루트 `docs/reference/oracle-setup-guide.html` Phase 4 ④ |
| 오라클 보안 목록 | 웹 콘솔에서 사용자가 **80** 수신 규칙을 더함(8080 은 이미 열림 · 443 은 지움)(서버 안에서는 열렸는지 알 수 없음 → 스크립트가 물어봄) | 같은 가이드 Phase 4 ①~③ |

결정: **Certbot(snap) + webroot(HTTP-01, 80번 문) + `--required-profile shortlived` + `--ip-address 161.33.153.189`** · 80 을 늘 엶 · https 는 8080(같은 문 http → https · `error_page 497`) · 443 은 닫음(v2.61.2). 유료 · 도메인 · 다른 웹 서버는 필요 없음.
갱신 실패 알아채기(이 앱에서 할 수 있는 가장 간단한 것): `deploy/check-https.sh` 한 줄(남은 시간 · 타이머 · 마지막 갱신 기록) · 배포(`scripts/deploy.sh`) 끝에 남은 시간 한 줄(48시간 미만이면 ⚠️) · 마지막 안전망은 브라우저 경고. 앱 화면에 띄우는 것은 앱 코드를 바꿔야 해서 넣지 않음.

## 이 폴더의 파일

| 파일 | 하는 일 |
|---|---|
| `nginx-alphascope.conf` | nginx 설정 — **8080 https**(Let's Encrypt IP 인증서 · TLS Mozilla intermediate · HSTS 없음 · 같은 문 평문 http → `error_page 497` 로 https 301) · 443 블록 없음 · 화면은 `/var/www/alphascope`(`/assets/` 1년 캐시 · `index.html` 캐시 안 함), `/api/` 는 127.0.0.1:4000(`Host $http_host` — 문 번호까지 넘겨야 로그인 · 저장이 403 이 아니다 · `X-Forwarded-Proto` — 로그인 쿠키 Secure) |
| `nginx-alphascope-acme.conf` | 80번 문 — 인증서 확인 경로(`/var/www/letsencrypt`)만 보내고 나머지는 끊음(`return 444`) · `setup-https.sh` 가 `sites-available/alphascope-acme` 로 처음 넣고, 바뀌면 `apply-nginx.sh` 가 넣음 |
| `setup-https.sh` | https 로 바꾸기(손으로 한 번 · 위 「https 로 바꾸기」) — 상태가 예상과 다르면 아무것도 바꾸지 않고 멈춤 · Certbot(snap) · iptables 80 · 인증서 · 새 nginx · 자동 갱신 확인 · 실패하면 nginx · iptables · 인증서 · Certbot 을 전으로 |
| `check-https.sh` | 인증서 상태 보기(바꾸지 않음) — 만료 · 48시간 경고 · 갱신 타이머 · 마지막 갱신 기록. `--short` 한 줄은 배포 끝에서 |
| `apply-nginx.sh` | nginx 설정 두 개가 바뀌었을 때 손으로 한 번 — (인증서 · 80 확인 경로가 없거나 다른 설정 · 프로그램이 443 을 들으면 멈춤) 백업 · 넣기 · 검사 · 적용 · 확인(https 8080 · http → https · 443 거절 · 80 확인 파일 · 80 끊김) · 갱신 연습 · iptables 443 지움 · 실패하면 되돌리고 예전 주소 확인 |
| `upgrade-node24.sh` | Node 22 → 24 올리기(손으로 한 번 · 위 「Node 24 올리기」) — 설치 방식이 예상과 다르면 아무것도 바꾸지 않고 멈춤 · 실패하면 Node 22 · 옛 node_modules · 옛 화면으로 되돌림 · pm2 는 AlphaScope 두 이름만 |
| `paths.sh` | 오라클 자리 한 곳(v2.61.3) — `~/projects/alphascope/` 아래 `app` · `secrets` · `scripts` · `backups` · `data`. 배포 스크립트들이 맨 위에서 읽는다(경로를 파일마다 적지 않음) |
| `ecosystem.config.cjs` | pm2 설정 — api·indicators 두 개(개발 서버 없음) · cwd · venv 는 이 파일 자리(`app/deploy/`)에서 계산 · 배포가 이 파일을 그대로 씀 |
| `backup-db.sh` · `backup-db.cjs` | 주간 DB 백업(crontab 일요일 03:00 → `scripts/backup.sh` → 이것) — SQLite 온라인 백업(WAL 이어도 온전) · `integrity_check` · 실패하면 사본 지움 · 성공했을 때만 30일 넘은 것 지움 · 로그 `backups/db/backup.log` |
| `move-to-projects.sh` | 홈 폴더 정리(손으로 한 번 · 위 「폴더 정리」) — 상태가 예상과 다르면 멈춤 · 서버 멈춤은 pm2 두 이름 멈춤 ~ 다시 켬 사이뿐 · 실패하면 자리 · pm2 · crontab · `.env` 를 되돌리고 옛 자리에서 다시 켬 |
| `deploy.sh` | 배포 스크립트 — `~/projects/alphascope/scripts/deploy.sh` 로 복사되어 쓰인다 · pm2 는 AlphaScope 두 이름만(`PM2_APPS` — `ecosystem.config.cjs` 와 같게 · `npm run deploy:test`) |
| `switch-to-static.sh` | 한 번만 쓰는 전환 스크립트(백업·자동 되돌리기 포함) |
| `rollback-to-vite.sh` | 옛 Vite 시절(80번)로 되돌리기 — 지금은 쓰지 않는다 |
