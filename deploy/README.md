# 오라클 서버 운영

오라클 서버는 미리 만들어 둔 **완성본(dist)** 을 nginx 가 바로 보냅니다. API(4000)와 지표 엔진(5001)은 pm2 가 돌립니다.
**AlphaScope 주소: `http://161.33.153.189:8080`** — 80번 문은 닫혀 있습니다(`http://161.33.153.189` 는 열리지 않음). 같은 서버의 다른 프로젝트는 8081 입니다.
개발용 서버(Vite)는 인터넷에 열지 않습니다 — 자동 탐색 요청 하나로 열린 모든 화면에 「URI malformed」 오류 창이 뜨고, 소스 파일도 그대로 나갑니다.

## 배포

맥에서 한 줄입니다(05:00~22:30 KST 사이, 05:30 전후는 피합니다).

```bash
ssh alphascope '~/deploy.sh'
```

받기 → 설치 → 빌드 → 화면을 `/var/www/alphascope` 로 복사 + nginx 다시 읽기 → pm2 `alphascope-api` · `alphascope-indicators` 재시작 → API·화면 확인 순서로 돕니다.
빌드가 실패하면 복사하지 않으므로 예전 화면이 그대로 남습니다. 화면만 바뀌어도 이 배포가 필요합니다.
`~/deploy.sh` 는 저장소 `deploy/deploy.sh` 의 **복사본**입니다. 받은 코드에서 배포 스크립트가 바뀌었으면 끝에 「배포 스크립트가 바뀌었습니다」 가 나옵니다(돌고 있는 스크립트는 덮어쓰지 않습니다) — 그때 아래 한 줄로 바꿉니다.

```bash
cp ~/alphascope/deploy/deploy.sh ~/deploy.sh
```

### nginx 설정이 바뀌었을 때

배포는 nginx 설정 파일(`deploy/nginx-alphascope.conf`)을 서버에 넣지 않습니다. 설정이 바뀐 코드를 받았으면 서버에서 한 번 돌립니다.

```bash
cd ~/alphascope && git pull --ff-only origin main && bash deploy/apply-nginx.sh
```

지금 설정을 날짜 붙은 이름으로 백업(`/etc/nginx/sites-available/alphascope.backup-…`) → 새 설정 넣기 → `nginx -t` → 적용 → 8080 화면 · `/api/version` 확인 순서로 돌고, 끝에 「AlphaScope 주소: http://161.33.153.189:8080」 이 나옵니다. 검사나 확인이 실패하면 **자동으로 백업으로 되돌리고 멈춥니다**(주소는 예전 그대로).

### Node 24 올리기 (v2.60.9 · 한 번만)

맥과 같은 **Node 24.22.1**(nodesource 패키지 `24.22.1-1nodesource1`)로 올립니다. `deploy/upgrade-node24.sh` 가 **설치 · 빌드 · 화면 복사까지** 하므로 푸시한 뒤 `~/deploy.sh` 를 **먼저 돌리지 않습니다**.

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
   cd ~/alphascope && git pull --ff-only origin main && bash deploy/upgrade-node24.sh
   ```

   - 「━━━ 1/7 … 7/7」 을 차례로 지나 끝에 **「완료 — Node 24 (v24.22.1) · 서버 켜짐 · 오류 없음」** 이 나오면 성공입니다.
   - 「아무것도 바꾸지 않고 멈춥니다」 — 설치 방식이 예상과 다릅니다(nodesource 가 아님 · nvm · node 가 22 가 아님 등). 서버는 그대로 돕니다. 나온 글을 개발 대화에 붙여 주세요.
   - 「되돌렸습니다」 — 중간에 실패해 **스스로 Node 22 · 옛 node_modules · 옛 화면으로 되돌리고 서버를 다시 켠 것**입니다. ⚠️ 줄을 개발 대화에 붙여 주세요.
   - 이미 Node 24 면 「할 일이 없습니다」 로 끝납니다(두 번 돌려도 해가 없음).

**끝난 뒤 확인할 것**

1. 브라우저에서 `http://161.33.153.189:8080` 새로고침 → 로그인 · 차트 · 계좌가 열린다.
2. 서버에서 `node -v` = `v24.22.1` · `pm2 list` 에서 `alphascope-api` · `alphascope-indicators` 가 `online`(다른 프로젝트 줄은 그대로).
3. 다음 장에서 자동매매 · 매수 판단 기록이 평소처럼 돈다(계좌 「최근 판단」 · 매수 판단 화면의 그날 기록).
4. 며칠 문제가 없으면 백업 폴더를 지웁니다(옛 node_modules 가 있어 수백 MB): `rm -rf ~/alphascope-node24-backup-<날짜>`

**알아 둘 것**

- 백업 폴더 `~/alphascope-node24-backup-<날짜>/` — `info.txt`(옛 버전들) · Node 22 패키지(`nodejs_22…arm64.deb`) · apt 저장소 설정 · `db/`(멈춘 뒤 복사한 DB · `-wal` · `-shm`) · `node_modules.node22` · `web/`(옛 화면) · `dump.pm2` · 단계별 로그.
- 같은 서버의 **다른 프로젝트**는 멈추거나 다시 켜지 않습니다. 다만 서버의 `node` 가 24 로 바뀌므로 그 프로젝트도 **다음에 다시 켜질 때(재부팅 포함)부터 Node 24** 로 돕니다. pm2 자체(데몬)도 재부팅 전까지는 옛 Node 로 돌지만 AlphaScope 는 영향이 없습니다 — `pm2 update` 는 모든 프로그램을 다시 켜므로 쓰지 않습니다.
- DB 는 되돌릴 때도 **덮어쓰지 않습니다**(better-sqlite3 11.10 → 12.1 은 같은 SQLite 3.49.2 라 파일 형식이 같고, 되돌리기 전까지 새 서버가 쓴 기록을 잃지 않게). 사본은 백업 폴더 `db/` 에 있습니다.

**손으로 되돌리기**(스크립트가 성공한 뒤 며칠 지나 문제가 보일 때 — 서버 안에서, `<날짜>` 는 `ls ~ | grep node24-backup` 로 확인):

```bash
B=~/alphascope-node24-backup-<날짜>
sudo rm -f /etc/apt/sources.list.d/nodesource.sources /etc/apt/sources.list.d/nodesource.list /etc/apt/preferences.d/nodejs /etc/apt/preferences.d/nsolid
while IFS='|' read -r NAME DEST; do sudo cp "$B/apt/$NAME" "$DEST"; done < "$B/apt-paths.txt"
sudo dpkg -i "$B"/nodejs_*.deb && node -v
pm2 stop alphascope-api alphascope-indicators
mv ~/alphascope/node_modules "$B/node_modules.node24" && mv "$B/node_modules.node22" ~/alphascope/node_modules
pm2 restart alphascope-api && pm2 restart alphascope-indicators && curl -s http://127.0.0.1:4000/api/version
```

되돌린 뒤 `~/deploy.sh` 를 돌리면 Node 22 로 다시 설치 · 빌드합니다(`package.json` 의 `engines` 가 24 라 npm 이 경고만 냅니다).

### 같은 서버에 다른 프로젝트가 있을 때

배포는 **AlphaScope 두 프로그램(`alphascope-api` · `alphascope-indicators`)만** 다시 켭니다 — `pm2 restart all` 같은 「모두」 명령은 쓰지 않으므로 다른 프로젝트의 pm2 프로그램은 그대로 돕니다. 둘 가운데 하나가 pm2 에 없으면 `ecosystem.config.cjs` 로 그 이름만 켜고 알립니다. 끝의 pm2 상태도 AlphaScope 두 줄만 보입니다. 다른 프로젝트의 pm2 설정 · nginx 설정 파일은 AlphaScope 것(`ecosystem.config.cjs` · `/etc/nginx/sites-available/alphascope`)과 **따로** 두고, 문은 AlphaScope 8080 · 다른 프로젝트 8081 로 나눕니다(80은 비워 둠). `sudo nginx -t` · `reload` 는 모든 사이트에 함께 걸리므로, 다른 사이트 설정이 틀려 있으면 AlphaScope 배포도 `nginx -t` 에서 멈춥니다(화면 복사는 이미 끝난 뒤 — pm2 는 다시 켜지지 않음).

## 로그인 비밀번호

비밀번호는 서버에서만 정합니다. **정하기 전에는 앱이 잠겨 있습니다**(모든 API 503 — 의도된 동작).

```bash
ssh alphascope
cd ~/alphascope && npm run auth:set-password
```

비밀번호를 잊었을 때도 같은 명령을 다시 돌립니다. 바꾸면 모든 기기의 로그인이 끊깁니다.
기기 하나만 끊으려면 앱의 「설정 > 앱 기능 설정 > 로그인된 기기」 에서 [로그아웃] 을 누릅니다.


## 처음 서버를 완성본 방식으로 바꿀 때 (한 번만 — 이미 했다면 필요 없음)

아래 명령을 **순서대로 하나씩** 복사해 붙여 넣습니다.

1. 맥의 터미널에서 서버에 들어갑니다. (줄 앞이 `ubuntu@alphascope-server` 로 시작하면 이미 서버 안이니 건너뜁니다.)

   ```bash
   ssh alphascope
   ```

2. 최신 코드를 받습니다.

   ```bash
   cd ~/alphascope && git pull --ff-only origin main
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
| 403 Forbidden | nginx 가 화면 폴더를 못 읽는다 | `ls -ld /var/www/alphascope` 로 권한 확인 → `sudo chmod 755 /var/www/alphascope`(화면 폴더를 홈 폴더 `~/alphascope/dist` 에 두지 않는다) |
| 502 Bad Gateway (로그인·데이터가 안 뜸) | API 서버가 꺼져 있다 | `pm2 logs alphascope-api --lines 30` 으로 이유 확인 → `pm2 restart alphascope-api` |
| 모든 화면이 잠겨 있다(503) | 비밀번호를 아직 정하지 않았다 | 위 「로그인 비밀번호」 |
| 배포했는데 화면이 옛날 것 | 브라우저가 예전 화면을 들고 있다 | 새로고침(맥 `Cmd+Shift+R`, 윈도 `Ctrl+F5`) — 앱 위에 「서버가 옛 버전」 띠가 보이면 반대로 서버 배포가 덜 된 것이다 |

| 「오늘 시황」 수집 상태에 뉴스 · 시장 데이터 실패 | 오라클에서 RSS(연합뉴스 · 매일경제 · 전자신문 · CNBC · MarketWatch · 연준) · 미국 재무부(미 2년물) · yfinance 가 막혔거나 그 사이트가 죽었다 | 화면 「수집 상태 보기」 에 곳마다 실패 이유가 보인다. 한 곳만 실패면 나머지로 만든다(국내 4곳이 다 실패하면 SBS 경제로 대신). 오래 막히면 `curl -sI <주소>` 로 오라클에서 닿는지 확인 · `pm2 logs alphascope-api --lines 50 \| grep market-brief` |
| 「오늘 시황」 이 아침에 안 생김 | 07:05 무렵 서버가 꺼져 있었거나(13시 전에 켜지면 보충) · 자동 실행 중 재시작됐다(그날은 다시 안 만듦 — Gemini 두 번 쓰기 방지) · `MARKET_BRIEF_ENABLED=false` | 화면 「시황 분석」 으로 만든다. 07:00~07:20 에는 배포를 피한다 |

진단 리포트 파일은 서버의 `~/alphascope/reports/` 에 쌓입니다.

### 실적일 날짜 (v2.59.1)

실적 발표일을 그 종목 시장의 현지 날짜로 자르게 고쳤습니다(전에는 UTC 날짜 — 국내 아침 발표가 하루 이르게 될 수 있었다). **이미 저장된 날짜는 배포 다음 실적일 갱신(하루 1번 — 서버가 켜지고 90초 뒤 · 6시간마다 「오늘(KST) 받았나」 확인)부터 맞는 날짜로 바뀝니다.** 따로 DB 를 고치지 않습니다. 기업정보 화면의 실적일은 그 종목 기업정보 캐시(24시간)가 새로 받아질 때 바뀝니다. 2026-10-30 맥에서 본 영향 목록은 0종목(지금 yfinance 의 국내 시각은 15:00 · 19:59 KST 라 UTC 로도 같은 날)입니다.

### 오늘 시황 스위치 (v2.59.0)

- `MARKET_BRIEF_ENABLED`(기본 켬) — 평일 06:55 KST 뒤 첫 10분 확인(07:05 무렵)에 오전판을 자동으로 만든다. `false` 면 자동만 끄고 「시황 분석」 버튼(횟수 제한 없음)은 그대로.
- `GEMINI_BRIEF_MODEL`(기본 비움 = `GEMINI_MODEL`) — 오늘 시황만 다른 Gemini 모델로. 브리핑 1번 = Gemini 1번(실패하면 1번만 다시 · 429 면 다시 하지 않음).
- 자동 한 번에 RSS 8곳(대체 소스는 첫 후보가 안 되면 다음 후보) · 미국 재무부 1~2번 · 지표 엔진(yfinance 지수 13종 + 60일 안 실적 종목의 전망치 — 종목당 4번, 엔진이 6시간 캐시).

## 점검 도구

### 오늘 시황 소스 점검 (`marketbrief:sources`)

오늘 시황이 받는 뉴스 RSS · 해외 대체 소스 후보(MarketWatch → 미국 연준 보도자료) · 미국 2년물 금리 출처(미국 재무부)가 **오라클에서** 열리는지 봅니다.
각 소스 · 후보를 **1번씩** 열어 표를 찍습니다 — 앱 DB 를 열지 않고 Gemini · 토스를 부르지 않습니다. 미2년물은 지표 엔진 가상환경의 파이썬(`python/.venv`)으로 엽니다:

```bash
cd ~/alphascope && npm run -s marketbrief:sources
```

「묶음 | 후보 | HTTP | 걸린 시간 | 받은 건수/값」 표와 「N곳 중 M곳 받음」 한 줄이 나옵니다. 뉴스 칸은 「N건 · 72시간 안 N건 · 최신 날짜」 — 72시간 안 0건인 소스는 묵은 피드입니다(오늘 시황은 72시간 넘은 글을 빼고 씁니다). 표를 개발 대화에 붙이면 다음 차수에서 후보를 정합니다. 1분 남짓 걸릴 수 있습니다(막힌 곳은 15초 제한).

### 미국 매수 판단 다시 계산 결과 (`recheck:report`)

서버가 미국 거래일 20:45 ET 뒤(한국 다음 날 09:45 · 11-02 부터 10:45) 매수 판단을 최종 일봉으로 한 번 더 계산해 16:30 기록과 달라진 것만 남깁니다(v2.58.0).
결과는 **오라클에 들어가서** 봅니다(앱 DB 를 읽기 전용으로 엽니다 — 쓰지 않고 토스도 부르지 않습니다):

```bash
cd ~/alphascope && npm run -s recheck:report
```

「다시 계산 N건 · 달라짐 M건(action 바뀜 a · code 바뀜 b · 점수만 바뀜 c)」 · 달라진 줄 표 · 한 줄 결론이 나옵니다. 기간만 보려면 `npm run -s recheck:report -- --from 2026-11-02 --to 2026-11-06`. 끄려면 `.env` 에 `BUYJUDGE_RECHECK_ENABLED=false` 를 넣고 pm2 를 다시 켭니다.

### 16:30 값 vs 최종값 매수 판단 견주기 (`ussample:judge`)

`~/alphascope-samples/us-close.jsonl`(아래 `ussample:run` 기록)의 16:30 ET 무렵 값과 최종값으로 같은 규칙(「기본 규칙」 + 자동매매를 켠 계좌의 규칙)을 두 번 판단해
action · code · 점수가 바뀌는지 셉니다(v2.58.2). **오라클에 들어가서** 한 번 돌립니다:

```bash
cd ~/alphascope && npm run -s ussample:judge
```

- 읽기만 합니다 — 앱 DB 는 읽기 전용으로 열어 규칙 · 계좌 설정만 읽고, 캔들 캐시 · 매수 판단 기록 · 다시 계산 표에 쓰지 않습니다. 주문 없음.
- 토스 일봉 받기: 기록에 있는 종목마다 한 번 + 시장 기준(SPY) 한 번(시장 필터 규칙이 있을 때) — 실패한 종목만 한 번 더. 받기 한 번 = 일봉 300개 = 토스 요청 2쪽.
- `ussample:run` 기록 시간대(15:55~20:40 ET) 밖에 돌립니다 — 같은 토큰 파일을 같이 고치지 않게. 토큰은 `ussample:run` 과 같은 토큰 파일(`~/alphascope-samples/.toss-token.json`, 권한 600)을 씁니다.
- 지표 엔진(pm2 `alphascope-indicators`)이 떠 있어야 합니다 — 꺼져 있으면 안내만 하고 끝납니다.
- 「견줌 N건 · 달라짐 M건(action 바뀜 a · code 바뀜 b · 점수만 바뀜 c) …」 · 달라진 줄 · 한 줄 결론이 나옵니다. 다른 기록 파일은 `USSAMPLE_OUT=<경로>` 로.

### 미국 마감 직후 값 기록 (`ussample:run` · `ussample:report`)

매수 판단 매일 기록(16:30 ET)이 받는 미국 일봉이 애프터마켓이 끝난 뒤의 최종값과 같은지 보려고, 미국 거래일 15:55~20:40 ET 에
5분마다 그날 일봉을 받아 `~/alphascope-samples/us-close.jsonl` 에 적습니다. 앱 DB 에는 쓰지 않습니다(읽기만).
종목과 기간(`startDate` ~ `endDate`)은 `scripts/usCloseSampler.symbols.json` 에 있습니다 — 기간이 지나면 스스로 아무것도 하지 않으므로 예약을 늦게 지워도 해가 없습니다.
배포(`~/deploy.sh`)를 먼저 한 뒤에 설치합니다. 맥 터미널에 한 줄씩 붙여 넣습니다.

설치(두 번 실행해도 예약은 한 줄 — 마지막에 「예약 줄 수: 1」):

```bash
ssh alphascope 'N=$(command -v node) || { echo "node 를 찾지 못했습니다"; exit 1; }; mkdir -p ~/alphascope-samples && L="*/5 * * * * cd $HOME/alphascope && PATH=$(dirname "$N"):/usr/bin:/bin ./node_modules/.bin/tsx scripts/usCloseSampler.ts >> $HOME/alphascope-samples/cron.log 2>&1 # alphascope-ussample" && (crontab -l 2>/dev/null | grep -v "# alphascope-ussample"; echo "$L") | crontab - && echo "예약 줄 수: $(crontab -l | grep -c "# alphascope-ussample")"'
```

결과 보기(표 + 한 줄 결론, 끝에 기록 로그 마지막 3줄):

```bash
ssh alphascope 'cd ~/alphascope && npm run -s ussample:report; tail -n 3 ~/alphascope-samples/cron.log 2>/dev/null'
```

지우기(마지막에 「남은 예약 줄 수: 0」 — 기록 파일과 토큰 파일(`.toss-token.json`, 1시간 안에 만료)은 남습니다):

```bash
ssh alphascope '(crontab -l 2>/dev/null | grep -v "# alphascope-ussample") | crontab - && echo "남은 예약 줄 수: $(crontab -l 2>/dev/null | grep -c "# alphascope-ussample")"'
```

## 이 폴더의 파일

| 파일 | 하는 일 |
|---|---|
| `nginx-alphascope.conf` | nginx 설정 — **8080** 만 듣는다 · 화면은 `/var/www/alphascope`(`/assets/` 1년 캐시 · `index.html` 캐시 안 함), `/api/` 는 127.0.0.1:4000(`Host $http_host` — 문 번호까지 넘겨야 로그인 · 저장이 403 이 아니다) |
| `apply-nginx.sh` | nginx 설정이 바뀌었을 때 손으로 한 번 — 백업 · 넣기 · 검사 · 적용 · 8080 확인 · 실패하면 되돌림 |
| `upgrade-node24.sh` | Node 22 → 24 올리기(손으로 한 번 · 위 「Node 24 올리기」) — 설치 방식이 예상과 다르면 아무것도 바꾸지 않고 멈춤 · 실패하면 Node 22 · 옛 node_modules · 옛 화면으로 되돌림 · pm2 는 AlphaScope 두 이름만 |
| `ecosystem.config.cjs` | pm2 설정 — api·indicators 두 개(개발 서버 없음) |
| `deploy.sh` | 배포 스크립트 — `~/deploy.sh` 로 복사되어 쓰인다 · pm2 는 AlphaScope 두 이름만(`PM2_APPS` — `ecosystem.config.cjs` 와 같게 · `npm run deploy:test`) |
| `switch-to-static.sh` | 한 번만 쓰는 전환 스크립트(백업·자동 되돌리기 포함) |
| `rollback-to-vite.sh` | 옛 Vite 시절(80번)로 되돌리기 — 지금은 쓰지 않는다 |
