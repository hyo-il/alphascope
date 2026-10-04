# 오라클 서버 — 완성본으로 화면 보내기 (v2.36.1)

## 왜 바꾸나요?

- 지금 오라클은 화면을 **개발용 서버(Vite)** 로 보냅니다. 공사 중인 작업장을 그대로 손님에게 열어 둔 셈입니다.
- 그래서 인터넷의 자동 탐색 요청 하나가 들어오면, 열려 있는 모든 화면에 「URI malformed」 오류 창이 떴습니다.
- 앞으로는 미리 만들어 둔 **완성본(dist)** 을 nginx 가 바로 보냅니다. 오류 창이 사라지고 첫 화면도 빨라집니다.

## 오라클에서 할 일 (한 번만)

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

4. 브라우저에서 `http://161.33.153.189` 를 **새로고침**하고 세 가지를 봅니다.
   1. 로그인 화면이 뜨고, 로그인하면 종목 지도·차트가 보인다.
   2. 글자 모양(글꼴)이 전과 같다.
   3. 서버에서 `pm2 list` 를 쳤을 때 `alphascope-web` 이 없고 `alphascope-api`·`alphascope-indicators` 가 `online` 이다.

## 앞으로 배포

지금처럼 맥에서 한 줄입니다.

```bash
ssh alphascope '~/deploy.sh'
```

바뀐 점: 빌드한 화면을 `/var/www/alphascope` 로 복사하는 단계가 자동으로 들어 있습니다. 빌드가 실패하면 복사하지 않으므로 예전 화면이 그대로 남습니다.

## 되돌리기 (문제가 생기면)

```bash
bash ~/alphascope/deploy/rollback-to-vite.sh
```

예전 설정 3개(nginx · pm2 · deploy.sh)를 백업에서 되돌리고 개발 서버를 다시 켭니다.

## 자주 생길 일

| 보이는 것 | 뜻 | 할 일 |
|---|---|---|
| 403 Forbidden | nginx 가 화면 폴더를 못 읽는다 | `ls -ld /var/www/alphascope` 로 권한 확인 → `sudo chmod 755 /var/www/alphascope` |
| 502 Bad Gateway (로그인·데이터가 안 뜸) | API 서버가 꺼져 있다 | `pm2 logs alphascope-api --lines 30` 으로 이유 확인 → `pm2 restart alphascope-api` |
| 배포했는데 화면이 옛날 것 | 브라우저가 예전 화면을 들고 있다 | 새로고침(맥 `Cmd+Shift+R`, 윈도 `Ctrl+F5`) |

## 이 폴더의 파일

| 파일 | 하는 일 |
|---|---|
| `nginx-alphascope.conf` | nginx 설정 — 화면은 `/var/www/alphascope`, `/api/` 는 4000 |
| `ecosystem.config.cjs` | pm2 설정 — api·indicators 두 개(개발 서버 없음) |
| `deploy.sh` | 배포 스크립트 — `~/deploy.sh` 로 복사되어 쓰인다 |
| `switch-to-static.sh` | 한 번만 쓰는 전환 스크립트(백업·자동 되돌리기 포함) |
| `rollback-to-vite.sh` | 예전 방식으로 되돌리기 |
