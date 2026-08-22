# AlphaScope

해외주식(미국) 차트 분석 + 멀티 AI 에이전트 의견 데스크톱 웹앱.

토스증권 Open API로 시세를, pandas-ta로 기술적 지표를, yfinance로 기업 재무를 모아
**Claude에게 붙여넣을 최적의 분석 프롬프트**를 만들어 줍니다.
추론은 Claude 구독 대화에서 이뤄지므로 **AI API 비용이 들지 않습니다.**

> 상세 명세와 개발 이력은 상위 관리 폴더의 `CLAUDE.md` / `PROMPTS_INDEX.md` 를 참고하세요.

---

## 요구 사항

| 항목 | 버전 | 비고 |
|---|---|---|
| Node.js | **22 LTS** | 이 맥의 전역 `node`(v21)는 EOL이라 동작하지 않음 |
| Python | **3.12+** | pandas-ta 0.4.x 요구사항 |
| 토스증권 Open API | Client ID/Secret | 유일하게 필요한 API 키 |

## 설치

```bash
export PATH=/opt/homebrew/opt/node@22/bin:$PATH
npm install
npm run py:setup          # python/.venv 가상환경 구성
cp .env.example .env      # 토스 API 키 입력
```

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
브라우저(React) ──/api/*──> Express(4000) ──> 토스 Open API
                                │
                                ├──> Flask(5001) ──> pandas-ta (지표)
                                │                └─> yfinance (기업 재무)
                                └──> SQLite (캔들·기업정보 캐시, 분석 기록)
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
- **AI 분석** — 4가지 모드(빠른 / 멀티 에이전트 / 보유 주식 / 종목 비교), 프롬프트 편집, 3단계 복사
- **히스토리** — 분석 결과 기록, 당시 프롬프트 보관, 저장 시점 대비 등락 추적

## 디렉터리

```
server/          Express API, 지표·기업정보 브릿지, SQLite
src/services/    toss(서버 전용) · analysis(프롬프트 조립)
src/components/  chart · analysis · company · portfolio · common
python/          indicators.py(Flask) · fundamentals.py(yfinance)
db/              schema.sql
scripts/         smokeTest · probeApi · initDb
```

---

⚠️ 이 앱이 제공하는 모든 분석은 참고용이며 **투자 조언이 아닙니다.**
