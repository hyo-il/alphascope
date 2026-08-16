# CLAUDE.md — AlphaScope 프로젝트 명세서

> 이 문서는 Claude Code가 프로젝트를 이해하고 개발할 수 있도록 작성된 마스터 프롬프트입니다.
> 모든 개발 작업은 이 문서를 기준으로 수행합니다.

---

## 프로젝트 개요

**프로젝트명**: AlphaScope (알파스코프)
**목적**: 해외주식(미국) 차트 분석 + 멀티 AI 에이전트 의견 제공 앱
**핵심 가치**: 토스증권 수준의 차트 UI + 여러 전문가 AI가 토론하여 분석 의견 제공
**개발 도구**: Claude Code
**대상 시장**: 미국 주식 (US Market)
**투자 스타일**: 스윙 트레이딩 (수일~수주 보유), 단기 투자

---

## 기술 스택

### 프론트엔드
- **React 18+** (Vite 빌드)
- **TypeScript**
- **TradingView Lightweight Charts v5** — 캔들스틱 차트
- **lightweight-charts-drawing** — 드로잉 도구 (수평선, 트렌드라인, 피보나치 등 68종)
- **Tailwind CSS** — 스타일링
- **Electron** (선택) — 데스크톱 앱 패키징

### 백엔드
- **Node.js** (Express) — API 서버
- **Python 3.12+** — 기술적 지표 계산 엔진 (pandas-ta 0.4.x 요구사항)
- **SQLite** (better-sqlite3) — 로컬 데이터 저장

### 외부 API
- **토스증권 Open API** (`https://openapi.tossinvest.com`) — 시세, 호가, 캔들, 주문, 계좌
- **yfinance** (Python) — PER, PBR, EPS, 재무제표, 배당, 섹터
- ~~Claude API~~ — **사용하지 않는다.** 분석 프롬프트를 클립보드로 복사해
  Claude 구독 대화에 붙여넣는 방식이라 API 키도 비용도 필요 없다 (Step 7 참고)

### 인증
- 토스증권: OAuth 2.0 Client Credentials Grant

---

## 개발 환경 (이 머신 기준)

- **Node 22 LTS 를 사용한다.** 전역 `node` 는 v21.5.0(EOL)이라 Vite 가 동작하지 않는다.
  ```bash
  export PATH=/opt/homebrew/opt/node@22/bin:$PATH
  ```
  `.nvmrc` 에 `22` 를 기록해 두었다.
- **Python 3.12** 를 쓴다 (`/opt/homebrew/opt/python@3.12`). 가상환경은 `python/.venv`,
  최초 1회 `npm run py:setup` 으로 만든다. 시스템 Python 3.9 는 건드리지 않았다.

### 실행 명령
```bash
npm run dev       # 웹(5173) + API(4000) + 지표 엔진(5001) 동시 실행
npm run dev:api   # API 서버만 / npm run dev:py 지표 엔진만
npm run py:setup  # Python 가상환경 최초 구성
npm run db:init   # SQLite 스키마 생성 확인
npm run smoke     # 토스 API 검증: 토큰 발급 → AAPL 캔들/현재가/호가
npm run probe     # 토스 API 원본 응답 확인 (스키마 확인용)
```

---

## 아키텍처 원칙

- **API 키는 서버에만 존재한다.** 토스 `CLIENT_SECRET` 은 Express 서버 프로세스에서만 읽는다. 브라우저는 `/api/*` 프록시만 호출한다 (`vite.config.ts` 의 proxy).
- `src/services/toss/*` 는 **서버 전용 모듈**이다. 프론트 컴포넌트에서 직접 import 하지 않는다.
- 모든 외부 호출은 `httpClient.tossGet()` 을 거친다 — 인증, Rate Limit, 재시도가 여기 모여 있다.

---

## 프로젝트 구조

```
alphascope/
├── CLAUDE.md                    # 이 파일 (프로젝트 명세)
├── package.json / tsconfig*.json / vite.config.ts
├── .env                         # 환경 변수 (git 제외)
├── .env.example
│
├── server/                      # Express API 서버 (Node 전용)
│   ├── index.ts                 # 모든 /api 라우트
│   ├── candleService.ts         # 캐시 우선 캔들 조회 + 집계
│   ├── indicatorService.ts      # Python 지표 엔진 브릿지
│   ├── companyService.ts        # yfinance 브릿지 + 24시간 캐시
│   ├── mockData.ts              # API 키 없을 때의 모의 데이터
│   └── db.ts                    # SQLite (캔들·분석 기록·기업 캐시)
│
├── scripts/
│   ├── initDb.ts                # 스키마 생성 확인
│   ├── smokeTest.ts             # 토스 API 검증 스크립트
│   └── probeApi.ts              # 토스 API 원본 응답 확인
│
├── src/
│   ├── main.tsx                 # React 엔트리
│   ├── App.tsx                  # 라우팅 및 레이아웃
│   │
│   ├── components/
│   │   ├── chart/
│   │   │   ├── CandleChart.tsx          # TradingView Lightweight Charts 래퍼
│   │   │   ├── ChartControls.tsx        # 타임프레임 전환, 지표 토글
│   │   │   ├── DrawingTools.tsx         # 수평선, 트렌드라인, 자(Measure) 도구
│   │   │   ├── IndicatorToggles.tsx     # 지표 ON/OFF
│   │   │   └── OrderbookPanel.tsx       # 호가창
│   │   │
│   │   ├── analysis/
│   │   │   ├── ManualAnalysis.tsx       # AI 분석 준비 (프롬프트 조립·복사)
│   │   │   └── AnalysisHistory.tsx      # 분석 히스토리 (답변 붙여넣기 기록)
│   │   │
│   │   ├── company/
│   │   │   ├── CompanyInfo.tsx          # PER/PBR/EPS 등 기업 정보
│   │   │   ├── FinancialStatements.tsx  # 재무제표 요약
│   │   │   └── SectorComparison.tsx     # 동종업계 비교
│   │   │
│   │   ├── portfolio/
│   │   │   ├── Holdings.tsx             # 보유 주식 목록
│   │   │   └── PortfolioSummary.tsx     # 포트폴리오 요약 (총손익, 환율)
│   │   │
│   │   └── common/
│   │       ├── SymbolSearch.tsx         # 종목 검색
│   │       ├── TabMenu.tsx              # 탭 메뉴
│   │       └── LoadingSpinner.tsx
│   │
│   ├── services/
│   │   ├── toss/                       # ⚠️ 서버 전용
│   │   │   ├── auth.ts                 # OAuth 토큰 발급/자동 갱신
│   │   │   ├── httpClient.ts           # 인증 + Rate Limit + 재시도 래퍼
│   │   │   ├── market.ts               # 시세, 호가, 캔들
│   │   │   ├── account.ts              # 계좌, 보유주식, 환율
│   │   │   ├── order.ts                # 주문 (향후)
│   │   │   └── rateLimiter.ts          # 토큰 버킷 Rate Limiter
│   │   │
│   │   ├── analysis/
│   │   │   ├── prompts.ts             # 에이전트별 시스템 프롬프트
│   │   │   ├── multiAgentPrompt.ts    # 붙여넣기용 프롬프트 조립
│   │   │   ├── summaryText.ts         # 간단 요약 텍스트
│   │   │   └── chartCapture.ts        # 차트 이미지 캡처 (html2canvas)
│   │   │
│   │   └── data/
│   │       └── fundamentals.ts        # yfinance 데이터 조회 (Python 브릿지)
│   │
│   ├── hooks/
│   │   ├── usePolling.ts              # 공용 폴링 (탭 가시성 대응)
│   │   ├── useCandleData.ts           # 캔들 데이터 조회
│   │   ├── useRealtimePrice.ts        # 1초 폴링 현재가
│   │   ├── useOrderbook.ts            # 1초 폴링 호가
│   │   ├── useIndicators.ts           # 기술적 지표 (Python 엔진)
│   │   └── useCompany.ts              # 기업정보·동종업계·보유·환율
│   │
│   ├── store/
│   │   └── appStore.ts                # Zustand 상태 관리
│   │
│   ├── types/
│   │   ├── toss.ts                    # 토스 API 응답 타입
│   │   ├── chart.ts                   # 지표·차트 타입
│   │   └── company.ts                 # 기업 정보 타입
│   │
│   └── utils/
│       ├── candleAggregator.ts        # 1분봉 → 5분봉/15분봉 집계
│       ├── indicators.ts              # 경량 지표 (요약 텍스트용)
│       ├── formatters.ts              # 숫자, 통화, 날짜 포맷
│       └── constants.ts               # API URL, Rate Limit 상수
│
├── python/
│   ├── requirements.txt               # pandas-ta, yfinance
│   ├── indicators.py                  # 기술적 지표 계산 서비스
│   └── fundamentals.py                # yfinance 재무 데이터 조회
│
└── db/
    └── schema.sql                     # SQLite 스키마
```

---

## 환경 변수 (.env)

```env
# 토스증권 Open API
TOSS_CLIENT_ID=your_client_id
TOSS_CLIENT_SECRET=your_client_secret
TOSS_BASE_URL=https://openapi.tossinvest.com

# 앱 설정
API_PORT=4000
POLLING_INTERVAL_MS=1000
DB_PATH=./db/alphascope.db
```

---

## 개발 단계

### Step 1: 프로젝트 초기화 + 토스 API 연동 — ✅ 완료 (실 API 검증 완료)

구현된 것:
1. React + Vite + TypeScript + Tailwind CSS v4
2. `.env` / `.env.example`
3. OAuth 토큰 발급 + 만료 10분 전 자동 갱신 (`services/toss/auth.ts`)
4. 토큰 버킷 Rate Limiter, 그룹별 초당 한도, `X-RateLimit-Remaining` 반영 (`rateLimiter.ts`)
5. 재시도 래퍼 — 429 `Retry-After` 존중, 401 재발급, 5xx 지수 백오프 (`httpClient.ts`)
6. 캔들 / 현재가 / 호가 조회 (`market.ts`)
7. SQLite 스키마 + 캔들 캐싱 (`server/db.ts`, `server/candleService.ts`)
8. Express API 서버 (`server/index.ts`)

실제 응답으로 확인한 스키마 (2026-08 기준):
- `/candles`: `interval` 은 **1m / 1d 만** 허용, `count` 는 **최대 200** (초과 시 400).
  더 필요하면 응답의 `nextBefore` 를 `before` 파라미터로 넘겨 페이지를 이어 받는다.
  응답은 `result.candles[]`, 숫자는 문자열, timestamp 는 ISO8601(+09:00), **최신순**.
- `/prices`: 파라미터는 `symbols`(복수), 응답은 `result[]` 의 `lastPrice`.
  **전일 대비 변동 정보가 없어** 캐시된 일봉으로 서버에서 계산한다.
- `/orderbook`: 파라미터는 `symbol`(단수), 응답은 `result.asks/bids`.
  ⏳ 레벨 하나의 필드명은 미확인 — 미국장 개장 시간에 `npm run probe` 로 확정할 것.

### Step 2: 차트 UI 기본 — ✅ 완료

1. Lightweight Charts v5 래퍼 (`components/chart/CandleChart.tsx`)
2. 캔들스틱 + 거래량 히스토그램(하단 20%, 별도 `volume` 가격축)
3. 드래그 = 확대/축소, **Shift + 드래그 = 좌우 이동**, 휠 = 확대/축소
   — 라이브러리 기본 드래그(팬)를 끄고 `setVisibleLogicalRange` 로 직접 구현했다.
4. 크로스헤어 + 좌상단 OHLCV 레전드 (마우스를 떼면 마지막 캔들 값 표시)
5. 타임프레임 전환 `ChartControls.tsx` — 5/15/30분은 1분봉 집계
6. 종목 검색 `SymbolSearch.tsx`, 상태는 Zustand `store/appStore.ts`
7. 현재가 1초 폴링 `hooks/useRealtimePrice.ts` + 마지막 캔들 실시간 갱신
   — 탭이 백그라운드면 폴링 중단, 요청 겹침 방지
   — 폴링가가 마지막 캔들 대비 20% 이상 벗어나면 무시 (이상값이 고가/저가를 영구 왜곡)

**모의 데이터 모드** (`server/mockData.ts`): `.env` 의 토스 키가 비었거나 `your_` 로 시작하면
서버가 랜덤워크 캔들/호가를 반환하고 응답에 `mock: true` 를 붙인다. 화면 상단에 경고 배너가
뜨며, 유효한 키를 넣으면 자동으로 실 API 로 전환된다. 캐시에는 저장하지 않는다.

디자인: 다크 테마, 상승 `#26A69A`, 하락 `#EF5350`

### Step 3: 차트 고급 기능 — ✅ 완료

1. `lightweight-charts-drawing@0.1.1` 연동 (`components/chart/DrawingTools.tsx`)
   — 툴바에는 67종 중 6개만 노출: 커서 / 수평선 / 추세선 / 자 / 피보나치 / 박스
2. **드로잉 생성은 직접 구현했다.** `DrawingManager` 는 선택·앵커 편집·이벤트만 담당하고
   도구로 새 드로잉을 만드는 로직이 없다 (`handleClick` 은 activeTool 이 있으면 무동작).
   그래서 `CandleChart` 가 마우스 이벤트로 앵커를 모아 `getToolRegistry().createDrawing()` →
   `manager.addDrawing()` 을 호출한다. 1점 도구는 클릭, 2점 도구는 드래그로 만든다.
3. Measure(자) = 플러그인의 `date-price-range`. 반투명 블록에 ±$ / ±% / 봉 수 / 일 수를
   표시하고, 방향에 따라 색을 넘긴다 (상승 `#26A69A` / 하락 `#EF5350`).
4. 호가창 `OrderbookPanel.tsx` — 차트 우측, 잔량 막대, 현재가 경계 표시
5. 차트 캡처 `services/analysis/chartCapture.ts` — html2canvas → PNG data URL / 클립보드 / 다운로드
6. UX: 하나 그리면 커서 모드로 자동 복귀, Esc = 드로잉 해제, Delete = 선택 항목 삭제

폴링 훅은 `hooks/usePolling.ts` 로 통합했다 (현재가·호가 공용). 탭이 백그라운드면 쉬고,
다시 보이는 순간 즉시 갱신한다 — 숨겨진 채로 열린 탭이 영영 비어 있던 문제를 고친 것이다.

### Step 4: 방식 B — 수동 분석 — ✅ 완료

`components/analysis/ManualAnalysis.tsx` + 하단 탭 `components/common/TabMenu.tsx`.

1. "① 차트 캡처 + 데이터 복사" — 하나의 `ClipboardItem` 에 `image/png` 와 `text/plain` 을
   함께 담아, 붙여넣는 앱이 지원하는 형식을 골라 가게 한다.
   이미지 복사가 막히면(권한·포커스·미지원) 텍스트만 넣고 **원인을 구분해** 안내한다.
2. "② Claude 대화 열기" — claude.ai/new 새 탭
3. 보조 버튼: 텍스트만 복사 / 이미지 저장(PNG 다운로드)
4. 복사될 내용 미리보기 + 사용 방법 안내
5. 탭: 수동분석(활성) / AI분석 · 히스토리(Step 7) / 기업정보 · 보유주식(Step 6), 패널 접기 지원

**지표 계산** `utils/indicators.ts` — RSI(14, Wilder), MACD(12,26,9), SMA, 거래량 비율.
표준 예제 데이터로 검증했다 (RSI 70.46 / 37.79 ↔ 기준값 70.46 / 37.77).
Step 5 에서 pandas-ta 엔진이 들어오면 차트 오버레이와 정밀 계산은 그쪽이 맡고,
이 모듈은 화면 요약용으로 남는다.

요약 텍스트 생성은 `services/analysis/summaryText.ts` 가 담당하며 Step 7 에서 재사용한다.

이 단계 완료 시점부터 앱을 실제로 사용 가능.

### Step 5: 기술적 지표 엔진 — ✅ 완료

**Python 3.12 를 쓴다.** pandas-ta 0.4.x 가 3.12 이상을 요구해 명세의 3.11+ 보다 높다.
가상환경은 `python/.venv` 이며 `npm run py:setup` 으로 만든다.

- `python/indicators.py` — Flask 서비스(포트 5001). 캔들 배열을 POST 받아 지표 시리즈 반환
  - SMA(20/60/120), EMA(12/26), 볼린저밴드(20,2), VWAP → 가격 차트 오버레이
  - RSI(14), MACD(12,26,9), Stochastic(14,3,3) → 하단 별도 패널
  - ATR(14), OBV
  - pandas-ta 컬럼은 이름 접두사로 고른다 (`MACDh_` 등). 위치 인덱스는 버전에 따라 흔들린다.
  - VWAP 는 직접 계산한다. pandas-ta 쪽은 DatetimeIndex 를 요구하고 일 단위로 리셋한다.
- `server/indicatorService.ts` — Node → Python 브릿지 (HTTP). 매 요청 프로세스 기동은
  pandas import 만으로 1초 이상 걸려서 상시 서비스로 띄운다. 엔진이 꺼져 있으면 503 +
  `engineDown: true` 로 구분해 알린다.
- `GET /api/indicators?symbol&timeframe&limit` — 차트와 **같은 캔들**로 계산해 화면과 어긋나지 않게 한다
- `components/chart/IndicatorToggles.tsx` — 오버레이 4종 / 패널 3종 토글.
  전부 꺼져 있으면 엔진을 호출하지 않는다.
- 패널은 Lightweight Charts v5 의 pane 기능을 쓰고, 가격:지표 = 3:1 로 높이를 배분한다.

**교차 검증**: Python RSI 58.417 / MACD 히스토그램 -0.132 가 Step 4 의 TypeScript 구현
(58.4 / -0.132)과 일치한다. 두 구현은 용도가 다르다 — TS 는 요약 텍스트용, Python 은 차트용.

`python/.venv` 는 파일이 수만 개라 Vite watcher 와 tsx watch 에서 제외했다 (`vite.config.ts`,
`dev:api` 스크립트). 제외하지 않으면 서버가 계속 재시작된다.

### Step 6: 기업 데이터 수집 — ✅ 완료

**yfinance 갈래**
- `python/fundamentals.py` — 프로필·밸류에이션·수익성·안정성·배당·재무제표(4개년) 정규화.
  indicators.py 의 Flask 앱에 `/fundamentals`, `/peers` 라우트로 붙는다 (프로세스는 하나).
- `server/companyService.ts` — SQLite `company_data` 에 24시간 캐시.
  yfinance 호출이 종목당 1~3초라 캐시가 체감 차이를 만든다.
- 동종업계는 yfinance 에 목록 API 가 없어 `SECTOR_PEERS` 맵으로 섹터별 대표 종목을 둔다.
  업종 평균은 이상치에 덜 흔들리도록 **중앙값**을 쓴다.
- ⚠️ **단위 주의**: 비율은 소수(0.2762 = 27.62%)인데 **배당수익률만 이미 퍼센트**(0.35 = 0.35%)다.

**토스 갈래** (`src/services/toss/account.ts`)
- ⚠️ `x-tossinvest-account` 헤더에는 계좌번호(accountNo)가 아니라 **accountSeq** 를 넣는다.
  accountNo 를 넣으면 400 account-not-found 다.
- `/api/v1/accounts` → 계좌 목록. accountSeq 는 프로세스 내 캐시 (ACCOUNT 한도 1/s)
- `/api/v1/holdings` → `result.items[]` + 계좌 전체 요약. 수익률은 소수라 100 배 한다.
- `/api/v1/exchange-rate` → `baseCurrency` + `quoteCurrency` 둘 다 필수

**UI**: `company/CompanyInfo.tsx`(+ FinancialStatements, SectorComparison),
`portfolio/Holdings.tsx`(+ PortfolioSummary). 보유 종목을 클릭하면 차트가 그 종목으로 바뀐다.

**거래량은 별도 pane 으로 옮겼다.** 가격축에 겹쳐 두면 아래 여백만큼 축이 늘어나,
가격 범위가 넓은 종목에서 축 라벨이 음수까지 내려간다. pane 0 = 가격, 1 = 거래량,
2 이후 = 지표 패널이다.

### Step 7: 멀티 AI 분석 — ✅ 완료 (방식 B 강화로 대체)

**방식 A(앱 내 Claude API 자동 호출)는 구현하지 않기로 했다.** API 키와 호출 비용 없이,
Claude 구독 대화에서 같은 결과를 얻을 수 있기 때문이다. 앱의 역할은 **"Claude 에게 보낼 최적의
입력을 자동으로 정리하는 것"** 까지이고, 추론은 구독 대화에서 한다. 비용 $0.

- `services/analysis/prompts.ts` — 4개 에이전트 + 종합 의장 + 교차 검증 프롬프트
- `services/analysis/multiAgentPrompt.ts` — 하나의 붙여넣기용 프롬프트로 조립한다.
  포함되는 것: 차트 이미지(클립보드) + 최근 10봉 OHLCV + 지표(Step 4·5) +
  재무·밸류에이션·동종업계 중앙값 비교(Step 6) + **보유 현황**(보유 중이면
  "보유 유지 / 추가 매수 / 손절" 관점을 추가로 요구한다)
- `components/analysis/ManualAnalysis.tsx` — **4가지 분석 모드**
  - ⚡ 빠른 분석: 지표 요약(RSI·MACD·MA·볼린저·ATR·스토캐스틱)
  - 🧠 멀티 에이전트: 5명 전문가 + 종합 의장 (교차 검증 토글)
  - 💼 보유 주식 분석: 포트폴리오 전체 + 종목별 지표 + 환율 (보유 없으면 비활성)
  - 🔄 종목 비교: 기준 종목 + 최대 2개 추가, 밸류에이션·기술적 상태 비교
- 프롬프트는 **편집 가능**(textarea)하며 "초기화"로 자동 생성본 복원. 글자 수 표시.
- `CopySteps.tsx` — 2단계 복사(이미지 → 텍스트). 브라우저 클립보드는 마지막 항목만 남기므로
  나눠서 순서대로 붙여넣는 편이 확실하다. 각 단계에 ✅/⬜ 상태와 시각 표시.
  포트폴리오·비교 모드는 차트 이미지가 프롬프트와 맞지 않아 이미지 단계를 숨긴다.
- `GET /api/summary?symbols=A,B,C` (`server/summaryService.ts`) — 여러 종목의 지표·재무를
  한 번에. 종목마다 따로 호출하면 왕복이 너무 많아진다. 한 종목이 실패해도 나머지는 살린다.
- `components/analysis/AnalysisHistory.tsx` — Claude 답변을 붙여넣어 기록.
  붙여넣는 순간 결론·신뢰도를 추정해 채워 주고, 저장 시점 가격 대비 현재 등락률을 보여 준다.
  `GET/POST/DELETE /api/analysis` + `analysis_history` 테이블.
  **분석 모드와 당시 프롬프트도 함께 저장**하며, 상세에서 "분석 답변 / 당시 프롬프트"를 전환해 볼 수 있다.
  (`mode`·`prompt` 컬럼은 나중에 추가돼서 `server/db.ts` 의 `migrate()` 가 기존 DB 에 채워 넣는다 —
  `CREATE TABLE IF NOT EXISTS` 는 이미 있는 테이블을 바꾸지 않기 때문이다.)
  (에이전트별 컬럼은 개별 응답을 받지 않으므로 비워 두고 `synthesis` 에 원문을 담는다.)

탭 구성: **AI 분석 / 기업정보 / 히스토리 / 보유주식** (방식 A 전용 탭은 제거).

---

## 멀티 AI 에이전트 시스템 프롬프트

### 에이전트 1: 차트 기술 분석가 (Chart Technician)

```
당신은 20년 경력의 차트 기술 분석 전문가입니다.
순수하게 차트 패턴과 기술적 지표만 보고 판단합니다.
펀더멘탈이나 뉴스는 무시하고, 오직 가격과 거래량 데이터에 집중합니다.

분석 항목:
1. 캔들 패턴 식별 (망치형, 도지, 장악형, 샛별형 등)
2. 추세 판단 (상승/하락/횡보, 추세선 이탈 여부)
3. 이동평균선 배열 (정배열/역배열, 골든크로스/데드크로스 근접 여부)
4. RSI 과매수(70↑)/과매도(30↓) 구간 판단
5. MACD 시그널 교차 상태 및 히스토그램 방향
6. 볼린저밴드 내 위치 및 밴드 폭 변화
7. 거래량 변화 (돌파 시 거래량 동반 여부)
8. 지지선/저항선 식별

출력 형식 (반드시 이 형식으로):
## 기술적 분석 요약
- **현재 상태**: (한 문장)
- **추세**: 상승추세 / 하락추세 / 횡보
- **주요 패턴**: (식별된 캔들 패턴)

## 지표 해석
- **RSI**: (수치 + 해석)
- **MACD**: (상태 + 해석)
- **이동평균선**: (배열 상태 + 해석)
- **볼린저밴드**: (위치 + 해석)
- **거래량**: (평균 대비 비율 + 해석)

## 단기 전망 (1~5일)
- **방향**: 상승 / 하락 / 횡보
- **근거**: (2~3가지)
- **주요 지지선**: $XX.XX
- **주요 저항선**: $XX.XX

## 신뢰도
- **등급**: 높음 / 중간 / 낮음
- **이유**: (한 문장)

⚠️ 이 분석은 기술적 지표에만 기반한 의견이며, 투자 조언이 아닙니다.
```

### 에이전트 2: 퀀트 트레이더 (Quant Trader)

```
당신은 통계와 수학에 기반한 퀀트 트레이더입니다.
감정이나 주관을 배제하고, 오직 숫자와 확률로 판단합니다.
매매 시나리오를 구체적인 가격과 비율로 제시합니다.

분석 항목:
1. 변동성 분석 (ATR 기반 일일 예상 변동폭)
2. 모멘텀 점수 (RSI + MACD + 스토캐스틱 종합)
3. 평균 회귀 가능성 (현재가 vs 20일 이평 괴리율)
4. 리스크/리워드 비율 계산
5. 적정 포지션 사이즈 (ATR 기반, 총자산 대비 %)
6. 손절/이익실현 가격대 (ATR × 배수)

출력 형식 (반드시 이 형식으로):
## 통계적 분석
- **일일 예상 변동폭**: ±$XX.XX (ATR 기반)
- **모멘텀 점수**: X/10
- **20일 이평 괴리율**: +X.X% / -X.X%
- **평균 회귀 확률**: 높음 / 중간 / 낮음

## 매매 시나리오
### 시나리오 A: 매수
- **진입가**: $XX.XX
- **목표가**: $XX.XX (+X.X%)
- **손절가**: $XX.XX (-X.X%)
- **리스크/리워드**: 1:X.X

### 시나리오 B: 관망
- **조건**: (어떤 조건이 충족되면 진입)

## 포지션 사이즈
- **권장 비중**: 총자산의 X%
- **근거**: ATR 기반 변동성 고려

⚠️ 이 분석은 통계적 모델에 기반한 시나리오이며, 투자 조언이 아닙니다.
```

### 에이전트 3: 펀더멘탈 애널리스트 (Fundamental Analyst)

```
당신은 증권사 리서치센터의 수석 애널리스트입니다.
기업의 본질적 가치와 재무 건전성을 평가합니다.
차트보다는 기업의 사업 모델, 재무제표, 산업 동향에 집중합니다.

분석 항목:
1. 밸류에이션 (PER/PBR 현재 수준 vs 업종 평균 vs 과거 평균)
2. 수익성 (매출 성장률, 영업이익률, 순이익률)
3. 재무 안정성 (부채비율, 유동비율, 이자보상배율)
4. 성장성 (매출/이익 YoY 성장률, PEG 비율)
5. 배당 (배당수익률, 배당성향, 배당 성장률)
6. 업종 내 위치 (시가총액 순위, 점유율)

출력 형식 (반드시 이 형식으로):
## 밸류에이션 판단
- **현재 PER**: XX.X (업종 평균: XX.X)
- **현재 PBR**: X.X (업종 평균: X.X)
- **판단**: 저평가 / 적정 / 고평가
- **근거**: (한 문장)

## 재무 건전성
- **등급**: 우수 / 양호 / 주의 / 위험
- **핵심 지표**: (2~3가지)

## 성장성
- **매출 성장률**: YoY +X.X%
- **이익 성장률**: YoY +X.X%
- **전망**: (한 문장)

## 중장기 전망 (3~12개월)
- **방향**: 긍정 / 중립 / 부정
- **핵심 카탈리스트**: (상승 요인)
- **핵심 리스크**: (하락 요인)

⚠️ 이 분석은 공개된 재무 데이터에 기반한 의견이며, 투자 조언이 아닙니다.
```

### 에이전트 4: 리스크 매니저 (Risk Manager)

```
당신은 보수적인 리스크 매니저입니다.
다른 분석가들의 의견에 항상 반론을 제시하는 역할입니다.
낙관적 시나리오보다 비관적 시나리오에 더 주목합니다.
"지금 매매하지 않아야 할 이유"를 찾는 것이 당신의 임무입니다.

분석 항목:
1. 다른 에이전트 의견에 대한 반론
2. 최악의 시나리오 (최대 예상 손실)
3. 시장 전체 리스크 (금리, 환율, 지정학적 이벤트)
4. 종목 고유 리스크 (실적, 규제, 경쟁)
5. 유동성 리스크 (거래량, 스프레드)
6. 환율 리스크 (KRW/USD)
7. 타이밍 리스크 (실적 발표 임박 여부 등)

출력 형식 (반드시 이 형식으로):
## 주요 리스크 요인
1. **[심각도 높음]** (리스크 설명)
2. **[심각도 중간]** (리스크 설명)
3. **[심각도 낮음]** (리스크 설명)

## 반론
- **기술 분석가에게**: (반론)
- **퀀트 트레이더에게**: (반론)
- **펀더멘탈 애널리스트에게**: (반론)

## 최악의 시나리오
- **예상 최대 손실**: -X.X%
- **시나리오**: (어떤 상황에서 발생)

## 매매하지 않아야 할 이유
- (핵심 이유 1~3가지)

## 그럼에도 매매한다면
- **반드시 지켜야 할 것**: (손절 라인, 포지션 제한 등)

⚠️ 이 분석은 리스크 관점의 의견이며, 투자 조언이 아닙니다.
```

### 에이전트 5: 종합 의장 (Moderator)

```
당신은 투자 분석 종합 의장입니다.
4명의 전문가(차트 기술 분석가, 퀀트 트레이더, 펀더멘탈 애널리스트, 리스크 매니저)의
분석 결과를 모두 검토하고, 균형 잡힌 최종 판단을 내리는 역할입니다.

작업:
1. 4개 분석의 의견 일치 영역 식별
2. 의견 충돌 영역 식별 + 어느 쪽 근거가 더 강한지 평가
3. 최종 종합 판단 도출
4. 구체적인 액션 플랜 제시

출력 형식 (반드시 이 형식으로):
## 종합 판단
- **결론**: 강력 매수 / 매수 / 중립 / 매도 / 강력 매도
- **신뢰도**: 높음 / 중간 / 낮음
- **한줄 요약**: (한 문장)

## 의견 일치 영역
- (모든 분석가가 동의하는 점)

## 의견 충돌 영역
- **쟁점**: (무엇에 대해 의견이 다른지)
- **판단**: (어느 쪽의 근거가 더 강한지 + 이유)

## 액션 플랜
- **지금 할 일**: (구체적 행동)
- **진입 조건**: (어떤 조건이 충족되면 매수/매도)
- **손절 라인**: $XX.XX
- **목표 가격**: $XX.XX
- **모니터링 포인트**: (다음에 확인해야 할 것)

## 주의사항
- (핵심 리스크 요약)

⚠️ 이 보고서는 AI 분석 종합이며, 최종 투자 판단은 본인이 내려야 합니다.
⚠️ 과거 분석의 정확도가 미래를 보장하지 않습니다.
```

---

## 토스증권 API Rate Limits (필수 준수)

`src/utils/constants.ts` 의 `RATE_LIMITS` 가 단일 출처다.

```typescript
const RATE_LIMITS = {
  AUTH:                    { perSecond: 5 },
  MARKET_DATA:             { perSecond: 15 },  // prices, orderbook, trades, price-limits
  MARKET_DATA_CHART:       { perSecond: 20 },  // candles
  STOCK:                   { perSecond: 5 },   // stocks, warnings
  STOCK_ALL:               { perSecond: 1 },   // 전종목 조회
  STOCK_TRADING_TREND:     { perSecond: 10 },  // investor-trading, short-selling 등
  MARKET_INFO:             { perSecond: 3 },   // exchange-rate, market-calendar
  RANKING:                 { perSecond: 5 },
  ACCOUNT:                 { perSecond: 1 },
  ASSET:                   { perSecond: 5 },   // holdings
  ORDER:                   { perSecond: 10 },  // 주문
  ORDER_INFO:              { perSecond: 6, peakPerSecond: 3 },  // 09:00~09:10 KST
  CONDITIONAL_ORDER:       { perSecond: 5 },
};
```

---

## SQLite 스키마

`db/schema.sql` 참고 — `candles`, `analysis_history`, `company_data` 3개 테이블.
서버 기동 시 `CREATE TABLE IF NOT EXISTS` 로 자동 적용된다.

---

## 디자인 가이드라인

### 컬러 팔레트 (다크 테마)
`src/index.css` 의 `@theme` 블록이 단일 출처이며, Tailwind 유틸(`bg-bg-secondary`,
`text-bullish` 등)로 바로 쓸 수 있다.

```css
--color-bg-primary: #0D0D1A;       /* 메인 배경 */
--color-bg-secondary: #1A1A2E;     /* 카드/패널 배경 */
--color-bg-tertiary: #252540;      /* 입력 필드, 호버 */
--color-text-primary: #E8E8F0;     /* 주요 텍스트 */
--color-text-secondary: #9898B0;   /* 보조 텍스트 */
--color-text-muted: #5A5A70;       /* 비활성 텍스트 */
--color-accent: #6366F1;           /* 주요 액센트 (인디고) */
--color-accent-hover: #818CF8;
--color-bullish: #26A69A;          /* 상승 (초록) */
--color-bearish: #EF5350;          /* 하락 (빨강) */
--color-warning: #FFA726;          /* 경고 (주황) */
--color-border: #2A2A45;           /* 구분선 */
--color-chart-grid: #1E1E35;       /* 차트 그리드 */
```

### 레이아웃
```
┌─────────────────────────────────────────────────────┐
│  [로고] AlphaScope     [종목검색]     [설정]          │
├─────────────────────────────────────┬───────────────┤
│                                     │               │
│          차트 영역 (70%)             │   호가창      │
│                                     │   (15%)       │
│                                     │               │
├─────────────────────────────────────┴───────────────┤
│  [1m] [5m] [15m] [30m] [1D]  │  [MA] [RSI] [MACD]  │
│  타임프레임                    │  지표 토글           │
├─────────────────────────────────────────────────────┤
│  [수동분석] [AI분석] [기업정보] [히스토리] [보유주식]   │
│                                                     │
│           선택된 탭 내용 영역 (30%)                   │
│                                                     │
└─────────────────────────────────────────────────────┘
```

---

## 주의사항

1. **투자 면책 조항**: 모든 AI 분석 결과에 "이 분석은 투자 조언이 아닙니다" 문구 필수 표시
   (프롬프트 말미에도 이 문구가 포함된다)
2. **API 키 보안**: `.env` 는 절대 커밋하지 않음 (`.gitignore` 포함됨). 토스 키는 서버에서만 읽는다
3. **에러 핸들링**: 모든 API 호출에 try-catch + 지수 백오프 재시도 (`httpClient.ts`)
4. **Rate Limit**: 429 응답 시 `Retry-After` 헤더 확인 후 대기
5. **토큰 갱신**: OAuth 토큰 만료 10분 전 자동 갱신
6. **환율**: USD → KRW 환산 시 토스 `/exchange-rate` API 사용
7. **시간대**: 미국 시장 시간 → 한국 시간 변환 유틸리티 필요
8. **캐싱**: 동일 캔들 데이터 반복 호출 금지. SQLite 캐싱 후 재사용

---

*이 CLAUDE.md는 프로젝트의 마스터 명세서입니다. 개발 진행에 따라 업데이트합니다.*
