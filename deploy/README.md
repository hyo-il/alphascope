# 오라클 서버 운영

오라클 서버는 미리 만들어 둔 **완성본(dist)** 을 nginx 가 바로 보냅니다. API(4000)와 지표 엔진(5001)은 pm2 가 돌립니다.
개발용 서버(Vite)는 인터넷에 열지 않습니다 — 자동 탐색 요청 하나로 열린 모든 화면에 「URI malformed」 오류 창이 뜨고, 소스 파일도 그대로 나갑니다.

## 배포

맥에서 한 줄입니다(05:00~22:30 KST 사이, 05:30 전후는 피합니다).

```bash
ssh alphascope '~/deploy.sh'
```

받기 → 설치 → 빌드 → 화면을 `/var/www/alphascope` 로 복사 + nginx 다시 읽기 → pm2 재시작 → API·화면 확인 순서로 돕니다.
빌드가 실패하면 복사하지 않으므로 예전 화면이 그대로 남습니다. 화면만 바뀌어도 이 배포가 필요합니다.

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

## 되돌리기 (문제가 생기면)

```bash
bash ~/alphascope/deploy/rollback-to-vite.sh
```

전환 때 남긴 백업 3개(nginx · pm2 · deploy.sh)를 되돌리고 개발 서버를 다시 켭니다.

## 자주 생길 일

| 보이는 것 | 뜻 | 할 일 |
|---|---|---|
| 403 Forbidden | nginx 가 화면 폴더를 못 읽는다 | `ls -ld /var/www/alphascope` 로 권한 확인 → `sudo chmod 755 /var/www/alphascope`(화면 폴더를 홈 폴더 `~/alphascope/dist` 에 두지 않는다) |
| 502 Bad Gateway (로그인·데이터가 안 뜸) | API 서버가 꺼져 있다 | `pm2 logs alphascope-api --lines 30` 으로 이유 확인 → `pm2 restart alphascope-api` |
| 모든 화면이 잠겨 있다(503) | 비밀번호를 아직 정하지 않았다 | 위 「로그인 비밀번호」 |
| 배포했는데 화면이 옛날 것 | 브라우저가 예전 화면을 들고 있다 | 새로고침(맥 `Cmd+Shift+R`, 윈도 `Ctrl+F5`) — 앱 위에 「서버가 옛 버전」 띠가 보이면 반대로 서버 배포가 덜 된 것이다 |

| 「오늘 시황」 수집 상태에 뉴스 · 시장 데이터 실패 | 오라클에서 RSS(연합뉴스 · 매일경제 · 전자신문 · CNBC · Yahoo) · FRED(미 2년물) · yfinance 가 막혔거나 그 사이트가 죽었다 | 화면 「수집 상태 보기」 에 곳마다 실패 이유가 보인다. 한 곳만 실패면 나머지로 만든다(국내 4곳이 다 실패하면 SBS 경제로 대신). 오래 막히면 `curl -sI <주소>` 로 오라클에서 닿는지 확인 · `pm2 logs alphascope-api --lines 50 \| grep market-brief` |
| 「오늘 시황」 이 아침에 안 생김 | 07:05 무렵 서버가 꺼져 있었거나(13시 전에 켜지면 보충) · 자동 실행 중 재시작됐다(그날은 다시 안 만듦 — Gemini 두 번 쓰기 방지) · `MARKET_BRIEF_ENABLED=false` | 화면 「시황 분석」 으로 만든다. 07:00~07:20 에는 배포를 피한다 |

진단 리포트 파일은 서버의 `~/alphascope/reports/` 에 쌓입니다.

### 실적일 날짜 (v2.59.1)

실적 발표일을 그 종목 시장의 현지 날짜로 자르게 고쳤습니다(전에는 UTC 날짜 — 국내 아침 발표가 하루 이르게 될 수 있었다). **이미 저장된 날짜는 배포 다음 실적일 갱신(하루 1번 — 서버가 켜지고 90초 뒤 · 6시간마다 「오늘(KST) 받았나」 확인)부터 맞는 날짜로 바뀝니다.** 따로 DB 를 고치지 않습니다. 기업정보 화면의 실적일은 그 종목 기업정보 캐시(24시간)가 새로 받아질 때 바뀝니다. 2026-10-30 맥에서 본 영향 목록은 0종목(지금 yfinance 의 국내 시각은 15:00 · 19:59 KST 라 UTC 로도 같은 날)입니다.

### 오늘 시황 스위치 (v2.59.0)

- `MARKET_BRIEF_ENABLED`(기본 켬) — 평일 06:55 KST 뒤 첫 10분 확인(07:05 무렵)에 오전판을 자동으로 만든다. `false` 면 자동만 끄고 「시황 분석」 버튼(하루 5번)은 그대로.
- `GEMINI_BRIEF_MODEL`(기본 비움 = `GEMINI_MODEL`) — 오늘 시황만 다른 Gemini 모델로. 브리핑 1번 = Gemini 1번(실패하면 1번만 다시 · 429 면 다시 하지 않음).
- 자동 한 번에 RSS 8곳 · FRED 1번 · 지표 엔진(yfinance 지수 13종 + 60일 안 실적 종목의 전망치 — 종목당 4번, 엔진이 6시간 캐시).

## 점검 도구

### 오늘 시황 소스 점검 (`marketbrief:sources`)

오늘 시황이 받는 뉴스 RSS · 해외 4번째 자리 후보(MarketWatch → 미국 연준 보도자료) · 미국 2년물 금리 후보(FRED → 미국 재무부)가 **오라클에서** 열리는지 봅니다(v2.59.6).
각 소스 · 후보를 **1번씩** 열어 표를 찍습니다 — 앱 DB 를 열지 않고 Gemini · 토스를 부르지 않습니다. 미2년물은 지표 엔진 가상환경의 파이썬(`python/.venv`)으로 엽니다:

```bash
cd ~/alphascope && npm run -s marketbrief:sources
```

「묶음 | 후보 | HTTP | 걸린 시간 | 받은 건수/값」 표와 「N곳 중 M곳 받음」 한 줄이 나옵니다. 표를 개발 대화에 붙이면 다음 차수에서 후보 순서를 확정합니다. 1분 남짓 걸릴 수 있습니다(막힌 곳은 15초 제한).

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
| `nginx-alphascope.conf` | nginx 설정 — 화면은 `/var/www/alphascope`(`/assets/` 1년 캐시 · `index.html` 캐시 안 함), `/api/` 는 127.0.0.1:4000 |
| `ecosystem.config.cjs` | pm2 설정 — api·indicators 두 개(개발 서버 없음) |
| `deploy.sh` | 배포 스크립트 — `~/deploy.sh` 로 복사되어 쓰인다 |
| `switch-to-static.sh` | 한 번만 쓰는 전환 스크립트(백업·자동 되돌리기 포함) |
| `rollback-to-vite.sh` | 예전 방식으로 되돌리기 |
