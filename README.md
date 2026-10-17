# AlphaScope

미국·국내 주식 차트 + 매매 규칙(퀀트) + 모의투자 자동매매 + AI(Gemini·Claude) 분석 웹앱. 혼자 쓰는 도구입니다(주인 계정 하나).

토스증권 Open API 로 시세를, pandas-ta 로 기술적 지표를, yfinance 로 기업 재무·섹터·뉴스를 모읍니다.

⚠️ **실제 주문은 어디에서도 나가지 않습니다.** 토스 API 는 조회만 하고,
모의투자의 주문·체결·잔고는 앱 안의 SQLite 에서만 움직입니다.

⚠️ 이 앱이 제공하는 모든 분석은 참고용이며 **투자 조언이 아닙니다.** 어느 방법도 이 앱에서 돈을 번다고 확인된 적은 없습니다.

---

## 메뉴

| 메뉴 | 하는 일 |
|---|---|
| 홈 | 종목 탐색(관심·최근·인기·보유 카드, 검색) |
| 탐색 | 종목 지도(시총 크기·등락 색 트리맵, 섹터 강세 순위) · 실시간 순위 |
| 차트·비교 | 차트(캔들 · 지표 · 드로잉 · 호가 · 빠른주문(모의) · 아래 탭: 지표 해석 · 기업정보 · 투자자 동향 · 뉴스 · AI 분석) · 기업 비교(최대 4종목) |
| 증시 일정 | 실적 · FOMC · 옵션 만기 · 휴장일 |
| 퀀트 | 매매 규칙 · 매수 판단 · 백테스트 · 검증 기록 |
| 실험실 | 급등 탐지(검증 전 테스트 기능) |
| 계좌 | 모의투자 계좌(자동매매) · 실제 계좌(토스 조회) |
| 설정 | 계좌 설정 · 앱 기능 설정(로그인된 기기 등) · 업데이트 내역 |

## 매매 규칙 · 자동매매

- **매매 규칙** — 점수형 계산기 하나. 매수 조건(추세 · 타이밍 · 모멘텀 · 거래량 · 손익비 · 이동평균 교차 · RSI 반등)마다 사용 여부와 점수를 정하고, 합계가 기준 이상이면 매수합니다.
  「거름망」(주가가 200일선 위일 때만 · 시장(SPY · KODEX 200)이 200일선 위일 때만)을 통과하지 못하면 점수가 높아도 사지 않습니다.
  매도 = 점수 아래 · 반대 신호 · 손절 · 익절 · 트레일링. **손익비 1 미만이면 어떤 규칙이든 사지 않습니다(끌 수 없음).**
- **판단은 끝난 일봉으로** 합니다(마감 기준). 끝나지 않았거나 새로 받지 못한 일봉으로는 판단하지 않고 미룹니다.
- **매수 판단** — 고른 규칙 하나로 전용 목록을 판단하고, 매일 마감 뒤 자동으로 기록합니다. 주문은 내지 않습니다.
- **계좌 자동매매** — 계좌마다 규칙 하나를 골라 켭니다. 신호는 종목마다 그 시장이 열린 뒤 하루 한 번, 손절·익절·트레일링은 1분마다 봅니다.
  신규 매수 안전장치(실적 발표 전 · 하루 손실 한도)가 있고, 「사도 됨」 이 여럿이면 총점 높은 순으로 삽니다.
- **AI 검증**(계좌마다 켬/끔) — 규칙이 「사도 됨」 이라 한 종목을 사기 직전 Gemini 가 위험만 한 번 확인합니다(통과 · 위험 · 검증 못 함). 매도에는 쓰지 않습니다.
- **백테스트** — 고른 종목 × 규칙 1~3개 × 1~3년. 다음 날 시가 체결 · 같은 날 손절 먼저 · 비용 0.30%p · 기준선(들고 있기 · 아무 날이나 · SPY) · 미래 누설 검사. 「가장 좋음」 표시는 하지 않습니다.

## AI 분석

- **Claude (수동)** — 차트 캡처와 지표·재무를 모아 **붙여넣을 프롬프트**를 만들어 줍니다. 추론은 Claude 구독 대화에서 하므로 API 비용이 들지 않습니다(Claude API 를 쓰지 않습니다).
- **Gemini (선택)** — 4명의 에이전트가 독립 판단한 뒤 종합 의장이 결론을 내는 2라운드 구조(종목당 5회 호출). 지정 종목 하루 한 번 · 바로 분석 · 목표 수익 가능성 · 뉴스 판정 · AI 검증 · 백테스트 설명에 씁니다.
  키가 없으면 이 기능들만 꺼집니다. 결과는 「검증 기록」 에서 뒤에 실제로 어땠는지 채점합니다.

---

## 요구 사항

| 항목 | 버전 | 비고 |
|---|---|---|
| Node.js | **22** | `.nvmrc` |
| Python | **3.12+** | pandas-ta 0.4.x 요구사항 |
| 토스증권 Open API | Client ID/Secret | **필수**(없으면 모의 데이터 모드) |
| Google Gemini API | API Key | 선택 |

## 설치 · 실행

```bash
npm install
npm run py:setup          # python/.venv 가상환경 구성
cp .env.example .env      # API 키 입력 (아래 표)
npm run auth:set-password # 로그인 비밀번호(터미널에서만 — 정하기 전에는 앱이 잠겨 있다)
npm run dev               # 웹 5173 + API 4000 + 지표 엔진 5001
```

맥에서는 관리 폴더의 `start.command` 를 더블클릭해도 세 서버가 뜨고 브라우저가 열립니다.

```bash
npm run build             # 타입 검사 + 프로덕션 빌드
npm run smoke             # 토큰 발급 → 캔들·현재가·호가 조회 검증
npm run diagnose          # 종합 진단 리포트(지표 엔진 필요)
```

시험(`rules:test` · `autotrade:test` · `buyjudge:test` · `prevclose:test` · `auth:test` · `design:check`)은 **DB 사본으로만** 돕니다 — `DB_PATH=<사본>` 이 없거나 실제 DB 면 멈춥니다.

### 환경 변수

`.env` 는 **커밋되지 않습니다** (`.gitignore`). 저장소가 public 이라 `.env.example` 에는 `your_` 자리표시자만 둡니다.

| 변수 | 필수 | 설명 |
|---|:---:|---|
| `TOSS_CLIENT_ID` · `TOSS_CLIENT_SECRET` | ✅ | 토스증권 Open API — **서버에서만 읽습니다**. 비었거나 `your_` 로 시작하면 모의 데이터 모드 |
| `GEMINI_` 로 시작하는 키 · 모델 (이름은 `.env.example`) | | Google Gemini. 없으면 Gemini 기능만 꺼집니다 |
| `API_PORT` · `INDICATORS_PORT` | | 기본값 4000 · 5001 |
| `DB_PATH` | | 기본값 `./db/alphascope.db` |
| `AUTO_TRADING_ENABLED` · `GEMINI_ENABLED` · `GEMINI_SCHEDULED_ENABLED` · `UNIVERSE_UPDATE_ENABLED` | | 스위치(기본 true) — 사본 DB 로 시험 서버를 띄울 때는 끈다 |
| `API_HOST` | | 기본 루프백. ⚠️ `0.0.0.0` 으로 열지 않는다(서버에서는 nginx → 127.0.0.1:4000) |

## 배포 (오라클)

빌드한 화면(dist)을 nginx 가 보내고, API·지표 엔진은 pm2 가 돌립니다. 배포는 `ssh alphascope '~/deploy.sh'` 한 줄입니다 — 자세한 것은 [`deploy/README.md`](deploy/README.md).

## 구조

```
server/          Express API(모든 /api 라우트는 index.ts) · rules/(매매 규칙 엔진) · autoTrading/(자동매매 · 백테스트 — 주문을 내는 유일한 경로)
                 buyJudge/ · aiCheck/ · gemini/(키가 없으면 폴더째 꺼짐) · diagnose/ · analysis/
src/             React 화면(components/ · ui/ 공용 부품) · services/toss(⚠️ 서버 전용) · hooks · store · types · utils
python/          indicators.py(Flask 지표 엔진) · fundamentals.py(yfinance)
db/schema.sql    SQLite 표 정의
scripts/         시험 · 운영 도구 (fixtures/ = 정답 파일)
deploy/          오라클 nginx · pm2 · deploy.sh · 안내서
```

**API 키는 서버에만 존재합니다.** `src/services/toss/*` 는 위치만 `src/` 일 뿐 서버 전용 모듈이며, 화면 코드에서 import 하지 않습니다.

> 개발 규칙과 버전별 작업 기록은 상위 관리 폴더의 `CLAUDE.md` · `docs/rules/` · `PROMPTS_INDEX.md` 에 있습니다.
