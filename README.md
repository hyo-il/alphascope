# AlphaScope

해외주식(미국) 차트 분석 + 멀티 AI 에이전트 의견 데스크톱 웹앱.

토스증권 Open API로 시세를, pandas-ta로 기술적 지표를, yfinance로 기업 재무를 모읍니다.
분석은 두 갈래입니다.

- **Claude (수동)** — 모은 데이터로 **붙여넣을 최적의 프롬프트**를 만들어 줍니다.
  추론은 Claude 구독 대화에서 하므로 API 비용이 들지 않습니다.
- **Gemini (자동)** — 관심 종목을 주기적으로 분석합니다. 4명의 에이전트가 독립 판단한 뒤
  종합 의장이 결론을 내는 2라운드 구조이며, 신호를 **모의투자** 계좌에 자동 주문할 수 있습니다.

⚠️ **실제 주문은 어디에서도 나가지 않습니다.** 시세만 실 API를 읽고,
주문·체결·잔고는 앱 안의 SQLite에서만 움직입니다.

> 상세 명세와 개발 이력은 상위 관리 폴더의 `CLAUDE.md` / `PROMPTS_INDEX.md` 를 참고하세요.

---

## 브랜치 규칙

**`main` 하나로만 작업합니다. 새 브랜치를 만들지 않습니다.**
커밋 전에 `git branch --show-current` 로 main 인지 확인하세요.
저장소가 public 이므로 푸시는 확인 후에 합니다.

## 요구 사항

| 항목 | 버전 | 비고 |
|---|---|---|
| Node.js | **22 LTS** | 이 맥의 전역 `node`(v21)는 EOL이라 동작하지 않음 |
| Python | **3.12+** | pandas-ta 0.4.x 요구사항 |
| 토스증권 Open API | Client ID/Secret | **필수** |
| Google Gemini API | API Key | 선택 — 자동 분석에만 쓰입니다 |

## 설치

```bash
export PATH=/opt/homebrew/opt/node@22/bin:$PATH
npm install
npm run py:setup          # python/.venv 가상환경 구성
cp .env.example .env      # API 키 입력 (아래 표 참고)
```

### 환경 변수

`.env` 는 **커밋되지 않습니다** (`.gitignore`). 키는 각자 로컬에 직접 넣어야 합니다.

| 변수 | 필수 | 설명 |
|---|:---:|---|
| `TOSS_CLIENT_ID` | ✅ | 토스증권 Open API |
| `TOSS_CLIENT_SECRET` | ✅ | 토스증권 Open API — **서버에서만 읽습니다** |
| `GEMINI_API_KEY` | | Google Gemini. 없으면 자동 분석 기능만 꺼집니다 |
| `GEMINI_MODEL` | | 기본값 `gemini-3.5-flash-lite` |
| `API_PORT` · `INDICATORS_PORT` | | 기본값 4000 · 5001 |
| `DB_PATH` | | 기본값 `./db/alphascope.db` |

## 실행

**가장 쉬운 방법** — Finder에서 `start.command` 를 더블클릭하면 세 서버가 뜨고 브라우저가 열립니다.

터미널에서 직접 실행할 때는 **Node 22 경로 지정이 필수**입니다.
전역 `node`(v21)는 실행 자체가 깨져 있어서, 이 줄이 없으면 `npm` 명령도 동작하지 않습니다.

```bash
export PATH=/opt/homebrew/opt/node@22/bin:$PATH
npm run dev               # 웹 5173 + API 4000 + 지표 엔진 5001
```

브라우저에서 **http://localhost:5173** 으로 접속합니다. 종료는 터미널에서 `Control+C`.

```bash
npm run build             # 타입 검사 + 프로덕션 빌드
npm run dev:api           # API 서버만 / dev:web, dev:py 도 개별 실행 가능
```

### 점검 도구

```bash
npm run smoke             # 토큰 발급 → 캔들·현재가·호가 조회 검증
npm run probe             # 토스 API 원본 응답 확인
npm run probe -- /api/v1/holdings   # 임의 엔드포인트
npm run db:init           # SQLite 스키마 확인
```

키가 없거나 `your_`로 시작하면 서버가 **모의 데이터**를 반환하고 화면 상단에 경고 배너가 뜹니다.

---

## 아키텍처

```
브라우저(React) ──/api/*──> Express(4000) ──> 토스 Open API (시세·호가·계좌)
                                │
                                ├──> Flask(5001) ──> pandas-ta (지표)
                                │                └─> yfinance (기업 재무·지수)
                                ├──> Gemini API   (자동 분석 — 키가 있을 때만)
                                └──> SQLite (캔들·기업정보 캐시, 분석 기록,
                                             모의투자 계좌·주문·체결)
```

**API 키는 서버에만 존재합니다.** `src/services/toss/*`는 파일 위치만 `src/`일 뿐
서버 전용 모듈이며, 프론트 컴포넌트에서 직접 import 하지 않습니다.

## 주요 기능

- **차트** — 캔들·거래량, 커서 기준 휠 확대/축소, 드래그 이동, 크로스헤어 레전드, 타임프레임 5종
- **시황 카드** — 코스피·코스닥·S&P500·나스닥·다우·VIX·환율, 30 거래일 스파크라인
- **드로잉** — 수평선·추세선·자(±% 측정)·피보나치·박스
- **지표** — SMA/EMA/볼린저/VWAP 오버레이, RSI/MACD/Stochastic 패널, ATR·OBV
- **기업정보** — 밸류에이션·재무제표·동종업계 비교
- **보유주식** — 실 계좌 손익, 환율 원화 환산
- **차트 캡처** — 팝업에서 범위·포함 지표·타임프레임을 고르고 미리 확인한 뒤 클립보드로
- **AI 분석 (Claude 수동)** — 4가지 모드(빠른 / 멀티 에이전트 / 보유 주식 / 종목 비교),
  투자 기간 선택, 프롬프트 편집, 단계별 복사
- **AI 분석 (Gemini 자동)** — 대상 종목을 정해 두면 주기적으로 분석합니다.
  4개 에이전트(기술·퀀트·펀더멘탈·리스크) 독립 판단 → 종합 의장이 결론.
  1종목당 API 5회를 쓰며, 실행 주기와 정규장 여부를 설정할 수 있습니다
- **자동매매** — 신호가 조건(신호 강도·신뢰도)을 넘으면 모의 계좌에 주문합니다.
  매수·매도 조건을 따로 잡고, 최대 보유 종목 수로 분산을 제한합니다
- **모의투자** — 계좌 생성, 시장가/지정가 주문, 체결·포지션·실현손익,
  일별 스냅샷과 성과 차트. 차트 화면 우측에는 **빠른주문** 패널
- **분석 결과·성적표** — Claude·Gemini 결과를 한 타임라인에서 보고,
  5 거래일 뒤 종가로 적중 여부를 채점합니다

## 디렉터리

```
server/          Express API, 지표·기업정보 브릿지, 모의투자, SQLite
server/gemini/   Gemini 자동 분석 (키가 없으면 폴더째 비활성)
src/services/    toss(서버 전용) · analysis(프롬프트 조립)
src/components/  chart · analysis · paper-trading · market · company · portfolio · common
python/          indicators.py(Flask) · fundamentals.py(yfinance)
db/              schema.sql
scripts/         smokeTest · probeApi · initDb
```

---

⚠️ 이 앱이 제공하는 모든 분석은 참고용이며 **투자 조언이 아닙니다.**
