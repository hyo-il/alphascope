# AlphaScope 개발 현황 인수인계

> 해외주식(미국) 차트 분석 + 멀티 AI 에이전트 의견 앱.
> 명세서는 `CLAUDE.md`(마스터 문서), 이 파일은 **현재 상태와 함정 요약**입니다.
> 저장소: https://github.com/hyo-il/alphascope (private)

## 한 줄 요약

명세의 **7단계가 모두 구현·검증 완료**되었고, 토스증권 실 API·실 계좌 데이터로 동작합니다.
Claude API는 **쓰지 않습니다** — 분석 프롬프트를 클립보드로 복사해 Claude 구독 대화에
붙여넣는 방식이라 API 비용이 $0입니다.

---

## 실행 방법

```bash
# 최초 1회
export PATH=/opt/homebrew/opt/node@22/bin:$PATH   # 전역 node는 v21(EOL, 실행 불가)
npm install
npm run py:setup          # Python 3.12 가상환경 (python/.venv)
cp .env.example .env      # 토스 API 키 입력

# 개발 서버 (3개 프로세스 동시 기동)
npm run dev               # 웹 5173 / API 4000 / 지표 엔진 5001

# 점검 도구
npm run smoke             # 토큰 발급 → 캔들·현재가·호가 조회 검증
npm run probe             # 토스 API 원본 응답 확인 (스키마 확인용)
npm run probe -- /api/v1/holdings    # 임의 엔드포인트도 가능
```

**필요한 키는 토스 API 하나뿐입니다.** 키가 없거나 `your_`로 시작하면 서버가 모의 데이터를
반환하고 화면 상단에 경고 배너가 뜹니다(UI 개발용).

---

## 아키텍처

```
브라우저(React) ──/api/*──> Express(4000) ──> 토스 Open API
                                │
                                ├──> Flask(5001) ──> pandas-ta (지표)
                                │                └─> yfinance (기업 재무)
                                └──> SQLite (캔들·기업정보 캐시, 분석 기록)
```

- **API 키는 서버에만 존재합니다.** `src/services/toss/*`는 파일 위치만 `src/`일 뿐
  **서버 전용 모듈**이며, 프론트 컴포넌트에서 직접 import 하지 않습니다.
  (명세는 이 코드를 프론트에 뒀지만, 그러면 CLIENT_SECRET이 브라우저 번들에 실립니다.)
- 모든 토스 호출은 `httpClient.tossGet()`을 거칩니다 — 인증·Rate Limit·재시도가 여기 모여 있습니다.
- 지표 엔진을 HTTP 상시 서비스로 둔 이유: 매 요청 프로세스 기동은 pandas import만 1초 이상 걸립니다.

---

## 구현 완료 기능

| 단계 | 내용 |
|---|---|
| 1 | OAuth 토큰(만료 10분 전 자동 갱신), 토큰 버킷 Rate Limiter, 429/401/5xx 재시도, SQLite 캔들 캐시 |
| 2 | 캔들 차트, 거래량, 크로스헤어 레전드, 타임프레임 5종, 종목 검색, 1초 폴링 |
| 3 | 드로잉 도구(수평선·추세선·자·피보나치·박스), 호가창, 차트 캡처 |
| 4 | AI 분석 준비 탭 — 차트 이미지 + 지표 요약 클립보드 복사 |
| 5 | Python 지표 엔진 — SMA/EMA/BB/VWAP, RSI/MACD/Stochastic, ATR/OBV + 차트 오버레이·패널 |
| 6 | 기업정보(밸류에이션·재무제표·동종업계), 보유주식·환율 |
| 7 | 멀티 에이전트 프롬프트 조립, 분석 히스토리 |

**차트 조작**: 드래그=확대/축소, Shift+드래그=좌우 이동, 휠=확대/축소
(라이브러리 기본 드래그(팬)를 끄고 `setVisibleLogicalRange`로 직접 구현)

**pane 구성**: 0=가격, 1=거래량, 2 이후=지표 패널

---

## ⚠️ 토스 API 함정 (실제 응답으로 확인한 것)

문서만 보고는 알 수 없어 실제로 부딪혀 확인한 내용입니다. **가장 중요한 섹션입니다.**

| 항목 | 사실 |
|---|---|
| 토큰 발급 | JSON 본문은 400. **form-urlencoded**로 보내야 함 |
| 캔들 주기 | `interval`은 **`1m`, `1d`만** 허용 (5·15·30분은 1분봉을 집계) |
| 캔들 개수 | `count` **최대 200**. 초과 시 400 |
| 캔들 페이지네이션 | 응답의 `nextBefore`를 **`before`** 파라미터로 넘겨 과거 페이지를 이어 받음 |
| 캔들 응답 | `result.candles[]`, 숫자는 **문자열**, timestamp는 ISO8601(+09:00), **최신순 정렬** |
| 현재가 | 파라미터는 **`symbols`(복수)**, 응답 `result[]`의 `lastPrice` |
| 현재가 변동 | **전일 대비 정보가 없음** → 캐시된 일봉의 전일 종가로 서버에서 계산 |
| 호가 | 파라미터는 **`symbol`(단수)** — 현재가와 반대 |
| 보유주식 헤더 | `x-tossinvest-account`에 **계좌번호(accountNo)가 아니라 `accountSeq`** |
| 보유주식 응답 | `result.items[]` + 계좌 요약. 수익률은 소수(-0.578 = -57.8%) |
| 환율 | `baseCurrency`와 `quoteCurrency` **둘 다 필수** |

**yfinance 단위 주의**: 비율은 소수(`profitMargin: 0.2762` = 27.62%)인데
**배당수익률만 이미 퍼센트**(`0.35` = 0.35%)입니다.

---

## 개발 중 발견해 고친 버그

새로 작업할 때 같은 함정을 다시 밟지 않도록 남깁니다.

1. **드로잉 플러그인에 생성 기능이 없음** — `lightweight-charts-drawing`의 `DrawingManager`는
   선택·앵커 편집만 하고, 도구로 새 드로잉을 만들지 않습니다(`handleClick`은 activeTool이
   있으면 무동작). 그래서 `CandleChart`가 마우스로 앵커를 모아
   `getToolRegistry().createDrawing()` → `addDrawing()`을 직접 호출합니다.
2. **StrictMode 재마운트 시 차트 크래시** — 차트가 재생성될 때 옛 차트의 지표 시리즈를
   새 차트에서 제거하려다 화면 전체가 빈 페이지가 됐습니다. 차트 정리 시 시리즈 목록도 비웁니다.
3. **가격축이 음수로 내려감** — 거래량을 가격축에 겹치고 아래를 여백으로 두면, 가격 범위가
   넓은 종목($500→$11)에서 축 라벨이 -100까지 갑니다. 거래량을 별도 pane으로 분리해 해결.
4. **탭이 숨겨진 채 열리면 폴링이 영영 시작되지 않음** — `document.hidden` 검사만 있고
   복귀 신호가 없었습니다. `visibilitychange`에서 즉시 갱신하도록 수정(`usePolling.ts`).
5. **`python/.venv`를 watcher가 감시** — 파일 수만 개라 서버가 계속 재시작됐습니다.
   Vite와 tsx watch에서 제외했습니다.

---

## 환경 특이사항 (이 맥 기준)

- 전역 `node`는 v21.5.0인데 **icu4c 업그레이드로 실행 자체가 깨져 있습니다**.
  이 프로젝트는 `/opt/homebrew/opt/node@22/bin`을 씁니다 (`.nvmrc`에 22 기록).
- Python은 시스템 3.9 외에 **3.12를 추가 설치**했습니다 (pandas-ta 0.4.x가 3.12+ 요구).
  시스템 Python은 건드리지 않았고, 의존성은 `python/.venv`에 격리돼 있습니다.

---

## 남은 작업

1. **호가 레벨 필드명 확정** (유일한 미검증 항목)
   미국장 마감 중에는 `asks`/`bids`가 빈 배열로만 와서, 레벨 하나의 키가 `price`/`quantity`인지
   확인하지 못했습니다. 현재는 후보 키를 훑는 방어 코드입니다.
   개장 시간(한국시간 22:30~)에 `npm run probe -- /api/v1/orderbook symbol=AAPL` 실행 후 확정 필요.

2. 선택 과제
   - 종목 검색 자동완성 (현재는 심볼 직접 입력)
   - 분석 히스토리의 1일/3일/7일 후 가격 자동 추적 (스키마 컬럼은 이미 있음)
   - Electron 패키징
   - 주문 기능 (`services/toss/order.ts`는 아직 비어 있음)

---

## 주요 파일 지도

```
server/index.ts            모든 /api 라우트
server/candleService.ts    캐시 우선 캔들 조회 + 분봉 집계
server/indicatorService.ts Python 지표 엔진 브릿지
server/companyService.ts   yfinance 브릿지 + 24시간 캐시
server/mockData.ts         키 없을 때의 모의 데이터

src/services/toss/         ⚠️ 서버 전용 (auth, httpClient, market, account, rateLimiter)
src/services/analysis/     prompts, multiAgentPrompt, summaryText, chartCapture
src/components/chart/      CandleChart(핵심), DrawingTools, IndicatorToggles, OrderbookPanel
src/components/analysis/   ManualAnalysis(프롬프트 조립), AnalysisHistory
src/components/company/    CompanyInfo, FinancialStatements, SectorComparison
src/components/portfolio/  Holdings, PortfolioSummary

python/indicators.py       Flask 서비스 (지표 + 기업정보 라우트)
python/fundamentals.py     yfinance 정규화
db/schema.sql              candles / analysis_history / company_data
```

---

## 검증 상태

- `tsc -b` 통과, 프로덕션 빌드 통과, 브라우저 콘솔 에러 없음
- 지표는 **두 독립 구현이 교차 검증**됨: Python RSI 58.417 / MACD 히스토그램 -0.132가
  TypeScript 구현(58.4 / -0.132)과 일치. RSI는 공개 표준 예제 데이터(70.46 / 37.77)와도 일치
- 실 데이터 확인: AAPL 일봉 300개(중복 없음), 실 계좌 보유 종목, 환율 1,420.8

⚠️ 이 앱의 모든 AI 분석 결과는 참고용이며 투자 조언이 아닙니다.
