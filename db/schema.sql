-- 캔들 데이터 캐시
CREATE TABLE IF NOT EXISTS candles (
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,  -- '1m', '1d'
  timestamp INTEGER NOT NULL,
  open REAL NOT NULL,
  high REAL NOT NULL,
  low REAL NOT NULL,
  close REAL NOT NULL,
  volume REAL NOT NULL,
  fetched_at INTEGER,       -- 받은 시각(ms, v2.51.1) — 그 시장 마감 전에 받은 일봉은 아직 끝나지 않은 값이다. 옛 줄은 NULL
  PRIMARY KEY (symbol, timeframe, timestamp)
);

-- AI 분석 히스토리
CREATE TABLE IF NOT EXISTS analysis_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  analyzed_at TEXT NOT NULL,  -- ISO 8601
  price_at_analysis REAL NOT NULL,
  mode TEXT,                   -- 'quick' | 'multi' | 'portfolio' | 'compare'
  prompt TEXT,                 -- 분석에 사용한 프롬프트 원문

  -- 에이전트별 의견
  technician_opinion TEXT,     -- JSON
  quant_opinion TEXT,          -- JSON
  fundamental_opinion TEXT,    -- JSON
  risk_opinion TEXT,           -- JSON

  -- 종합
  synthesis TEXT,              -- JSON
  verdict TEXT,                -- 'strong_buy' | 'buy' | 'neutral' | 'sell' | 'strong_sell'
  confidence TEXT,             -- 'high' | 'medium' | 'low'

  -- 향후 결과 추적 (수동 입력)
  price_after_1d REAL,
  price_after_3d REAL,
  price_after_7d REAL,
  actual_result TEXT           -- 'correct' | 'incorrect' | 'pending'
);

-- 기업 재무 데이터 캐시
CREATE TABLE IF NOT EXISTS company_data (
  symbol TEXT PRIMARY KEY,
  data TEXT NOT NULL,           -- JSON (yfinance 결과)
  updated_at TEXT NOT NULL      -- ISO 8601
);

-- 전종목 카탈로그 (한글 종목명 검색용)
CREATE TABLE IF NOT EXISTS stock_catalog (
  symbol TEXT PRIMARY KEY,
  name TEXT NOT NULL,          -- 한글명 (예: 삼성전자)
  english_name TEXT,           -- 영문명
  market TEXT NOT NULL,        -- KOSPI | KOSDAQ | NASDAQ | NYSE | AMEX
  updated_at TEXT NOT NULL     -- ISO 8601
);

CREATE INDEX IF NOT EXISTS idx_stock_catalog_name ON stock_catalog(name);

-- ─────────────────────────────────────────────────────────────────────────────
-- 모의투자 (페이퍼 트레이딩)
--
-- 시세·차트·지표는 토스 실 API 를 쓰지만, 주문·체결·잔고·손익은 전부 여기에만 있다.
-- 토스 주문 API 는 절대 호출하지 않는다 — 돈이 나가지 않는다.
--
-- 통화 규칙: 가격·수량·손익은 **종목의 통화**(미국 USD / 국내 KRW)로 저장하고,
-- 계좌 현금(current_cash)만 **계좌 통화**로 둔다. 환산에 쓴 환율은 주문·체결에 함께 남겨
-- 나중에 현금 증감을 그대로 재현할 수 있게 한다.
-- ─────────────────────────────────────────────────────────────────────────────

-- 모의투자 계좌
CREATE TABLE IF NOT EXISTS paper_accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,                    -- 계좌 이름 (예: "전략 A", "스윙 테스트")
  initial_balance REAL NOT NULL,         -- 초기 자금 (계좌 통화)
  current_cash REAL NOT NULL,            -- 현재 현금 잔고 (계좌 통화)
  currency TEXT NOT NULL DEFAULT 'KRW',  -- 기준 통화
  commission_rate REAL NOT NULL DEFAULT 0.001,  -- 수수료율 (0.1%)
  slippage_rate REAL NOT NULL DEFAULT 0.0005,   -- 슬리피지율 (0.05%)
  created_at TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,  -- 활성/비활성
  sort_order INTEGER                     -- 화면 순서 (v2.48.0 — 작을수록 위, 옛 DB 는 migrate() 가 채운다)
);

-- 모의투자 주문
CREATE TABLE IF NOT EXISTS paper_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  symbol TEXT NOT NULL,
  name TEXT,                             -- 종목명
  side TEXT NOT NULL,                    -- 'BUY' | 'SELL'
  order_type TEXT NOT NULL,              -- 'MARKET' | 'LIMIT'
  requested_price REAL,                  -- 주문 가격 (지정가)
  executed_price REAL,                   -- 체결 가격
  quantity REAL NOT NULL,                -- 주문 수량
  amount REAL,                           -- 체결 금액 (종목 통화, 수수료 제외)
  commission REAL DEFAULT 0,             -- 수수료 (종목 통화)
  slippage REAL DEFAULT 0,               -- 슬리피지 총액 (종목 통화)
  currency TEXT NOT NULL DEFAULT 'USD',  -- 종목 통화
  fx_rate REAL NOT NULL DEFAULT 1,       -- 체결 시점 종목 통화 → 계좌 통화 환율
  status TEXT NOT NULL DEFAULT 'PENDING', -- 'PENDING' | 'FILLED' | 'CANCELLED'
  reason TEXT,                           -- 주문 사유 (예: "RSI 30 이하 매수")
  ordered_at TEXT NOT NULL,
  filled_at TEXT,
  FOREIGN KEY (account_id) REFERENCES paper_accounts(id)
);

CREATE INDEX IF NOT EXISTS idx_paper_orders_account ON paper_orders(account_id, ordered_at);
CREATE INDEX IF NOT EXISTS idx_paper_orders_pending ON paper_orders(status);

-- 모의투자 포지션 (보유 종목)
CREATE TABLE IF NOT EXISTS paper_positions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  symbol TEXT NOT NULL,
  name TEXT,
  quantity REAL NOT NULL,                -- 보유 수량
  avg_price REAL NOT NULL,               -- 평균 매입가 (종목 통화, 수수료 포함)
  total_cost REAL NOT NULL,              -- 총 매입 금액 (종목 통화)
  currency TEXT NOT NULL DEFAULT 'USD',  -- 종목 통화
  opened_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (account_id) REFERENCES paper_accounts(id),
  UNIQUE(account_id, symbol)
);

-- 모의투자 거래 내역 (체결된 주문의 상세 기록)
CREATE TABLE IF NOT EXISTS paper_trades (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  order_id INTEGER NOT NULL,
  symbol TEXT NOT NULL,
  name TEXT,
  side TEXT NOT NULL,
  price REAL NOT NULL,                   -- 체결가 (종목 통화)
  quantity REAL NOT NULL,
  commission REAL NOT NULL,
  slippage REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  fx_rate REAL NOT NULL DEFAULT 1,
  cash_delta REAL NOT NULL DEFAULT 0,    -- 계좌 현금 증감 (계좌 통화)
  pnl REAL,                              -- 매도 시 실현 손익 (종목 통화)
  pnl_percent REAL,                      -- 매도 시 수익률
  reason TEXT,
  traded_at TEXT NOT NULL,
  FOREIGN KEY (account_id) REFERENCES paper_accounts(id),
  FOREIGN KEY (order_id) REFERENCES paper_orders(id)
);

CREATE INDEX IF NOT EXISTS idx_paper_trades_account ON paper_trades(account_id, traded_at);

-- 모의투자 입금 · 출금 (v2.52.0) — 넣고 뺀 만큼 initial_balance(원금)도 함께 바꾼다(수익률이 그대로).
-- paper_trades 는 order_id 가 필수(주문과 묶임)라 따로 둔다. 초기화 · 삭제하면 그 계좌 줄도 지운다.
CREATE TABLE IF NOT EXISTS paper_cash_flows (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  type TEXT NOT NULL,                    -- 'deposit' | 'withdraw'
  amount REAL NOT NULL,                  -- 계좌 통화, 양수
  created_at TEXT NOT NULL,
  FOREIGN KEY (account_id) REFERENCES paper_accounts(id)
);

CREATE INDEX IF NOT EXISTS idx_paper_cash_flows_account ON paper_cash_flows(account_id, created_at);

-- 모의투자 일별 스냅샷 (성과 추적용)
CREATE TABLE IF NOT EXISTS paper_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL,
  date TEXT NOT NULL,                    -- YYYY-MM-DD
  total_value REAL NOT NULL,             -- 총 평가금액 (현금 + 주식, 계좌 통화)
  cash REAL NOT NULL,
  stock_value REAL NOT NULL,             -- 주식 평가액 (계좌 통화)
  daily_pnl REAL,                        -- 일일 손익
  daily_return REAL,                     -- 일일 수익률 (%)
  cumulative_return REAL,                -- 누적 수익률 (%)
  FOREIGN KEY (account_id) REFERENCES paper_accounts(id),
  UNIQUE(account_id, date)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 급등 탐지 (Step 9)
--
-- 탐지는 "한 바퀴" 단위로 남긴다 — 같은 detected_at 을 가진 행들이 한 번의 실행이다.
-- 실제 매매는 하지 않는다. 탐지와 평가만 기록한다.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS surge_detections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  detected_at TEXT NOT NULL,             -- ISO 8601 (한 실행 = 같은 값)
  symbol TEXT NOT NULL,
  name TEXT,

  -- 주기성 분석 결과
  surge_count INTEGER NOT NULL,
  avg_interval REAL,
  std_deviation REAL,
  regularity REAL,                       -- 0~100
  last_surge_date TEXT,
  next_estimated_date TEXT,
  days_until_next INTEGER,

  -- 급등 가능성 평가
  surge_score INTEGER NOT NULL,          -- 0~100
  grade TEXT NOT NULL,                   -- 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE'
  reason TEXT,
  signals_snapshot TEXT,                 -- JSON

  -- 이력
  surge_history TEXT,                    -- JSON: [{date, changePercent}]
  price_at_detection REAL,

  -- 성과 추적 (탐지 후 채워 넣는다)
  price_after_7d REAL,
  price_after_14d REAL,
  price_after_30d REAL,
  actual_surged INTEGER,                 -- 1 / 0 / null(아직 판정 전)
  actual_surge_date TEXT,
  actual_surge_percent REAL
);

CREATE INDEX IF NOT EXISTS idx_surge_detected ON surge_detections(detected_at DESC);
CREATE INDEX IF NOT EXISTS idx_surge_symbol ON surge_detections(symbol, detected_at DESC);

-- 급등 탐지 설정 · yfinance 일봉 캐시 (24시간)
CREATE TABLE IF NOT EXISTS surge_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS surge_history_cache (
  symbol TEXT NOT NULL,
  period TEXT NOT NULL,                  -- '3mo' | '6mo' | '1y'
  data TEXT NOT NULL,                    -- JSON: Candle[]
  updated_at TEXT NOT NULL,
  PRIMARY KEY (symbol, period)
);

-- 스윙 투자 추천 표(swing_recommendations)는 v2.45.0 에 지웠다 — 매수 판단은 buy_judgments 에 남긴다.
-- ⚠️ 운영 DB 에서 DROP 하지 않는다(이미 있는 표는 그대로 남고, 읽고 쓰는 코드가 없다). v2.44.0 데이터 정리 때 비웠다.

-- 급등 탐지의 종목 풀 — 토스 랭킹 캐시
--
-- 랭킹은 Rate Limit 소모가 크고(RANKING 5/s) 하루에도 여러 번 바뀌는데,
-- 주기성 분석은 몇 달을 보는 성질이라 하루 두세 번이면 충분하다.
CREATE TABLE IF NOT EXISTS surge_ranking_cache (
  type TEXT PRIMARY KEY,           -- MARKET_TRADING_VOLUME | TOP_GAINERS | ...
  ranked_at TEXT,                  -- 토스가 알려 준 랭킹 기준 시각
  data TEXT NOT NULL,              -- JSON: RankingEntry[]
  updated_at TEXT NOT NULL
);

-- 앱 전역 설정 (키-값). 급등 전용인 surge_settings 와 섞지 않는다 —
-- 이름이 기능에 묶여 있으면 다음 세션이 못 찾는다.
-- 지금 쓰는 키 예: tradingRules.seeded · buyJudge.* · swing.goal (예전 strategyProfile 은 v2.45.0 부터 읽지 않는다)
CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- 사용자 데이터 (기기 간 공유) — 관심 목록·최근 조회.
--
-- ⚠️ app_settings 와 **나눠 둔다.** 나중에 로그인이 들어오면 이 테이블에만 user_id 를
-- 더하면 된다. 앱 설정(전략 프로파일)은 사용자와 무관할 수 있어 성격이 다르다.
-- ⚠️ 지금은 user_id 컬럼을 만들지 않는다 — 쓰지 않는 컬럼은 "누가 채우나" 를 헷갈리게 한다.
--
-- revision 은 동시 수정을 막는 값이다. 클라이언트가 읽은 revision 을 함께 보내고,
-- 그 사이 다른 기기가 바꿨으면 409 로 돌려보낸다(덮어쓰기 방지).
-- 지금 쓰는 키: watchlist.folders = WatchFolder[] / watchlist.recent = string[]
CREATE TABLE IF NOT EXISTS user_data (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  revision INTEGER NOT NULL,
  updated_at TEXT NOT NULL
);

-- 로그인 세션 (주인 계정 1개 — 회원가입은 없다).
--
-- ⚠️ **토큰 원본은 저장하지 않는다.** DB 가 새어도 그 값으로 로그인할 수 없도록
-- SHA-256 해시만 둔다. 원본은 쿠키에만 있다.
-- 비밀번호 자체는 app_settings 의 `auth.owner` 키에 있다 (scrypt salt+hash).
CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  user_agent TEXT
);

-- 진단 리포트 (v2.14.0) — `npm run diagnose` 와 웹의 「진단 리포트」가 같은 함수로 만들고 여기에 쌓는다.
-- summary_json = 요약 카드 네 장, detail_json = 상세 표. 파일 출력(docs/analysis · reports)은 그대로다.
-- 최근 20개만 남긴다 (server/diagnose/store.ts).
CREATE TABLE IF NOT EXISTS diagnose_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  server TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  detail_json TEXT NOT NULL
);

-- 3년 백테스트 결과 (v2.37.0, 「실험실 > 백테스트」 · npm run research:rule) — diagnose_reports 와 같은 모양, 최근 20개.
-- 화면만 읽는다(자동매매·판정은 읽지 않는다).
CREATE TABLE IF NOT EXISTS backtest_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  server TEXT NOT NULL,
  summary_json TEXT NOT NULL,
  detail_json TEXT NOT NULL
);

-- 시가총액 유니버스 월별 스냅샷 (v2.15.0) — 한 달에 한 행(KST 기준 YYYY-MM).
-- 1년 뒤 "그 시점의 시총 상위" 로 과거를 시험해 생존 편향을 줄이려고 쌓는다.
-- 최신본은 server/data/universe.json 이고, 이 표는 누적 기록이다 (server/universe.ts).
CREATE TABLE IF NOT EXISTS universe_snapshots (
  month TEXT PRIMARY KEY,
  as_of TEXT NOT NULL,
  source TEXT NOT NULL,
  us_json TEXT NOT NULL,
  kr_json TEXT NOT NULL
);

-- 실적 발표일 (v2.16.0) — 실적일 소스는 server/earningsCalendar.ts 한 곳이다.
-- 스윙 "실적 14일 이내" 경고와 자동매매 "실적 전 신규 매수 회피" 가 함께 쓴다.
-- earnings_date 가 NULL 이면 받았지만 실적일이 없던 종목(→ "실적일 미확인").
-- is_estimate = 1 은 회사 확정 전의 추정일. 하루 1회 갱신(마지막 날짜는 app_settings 'earnings.lastRefresh').
CREATE TABLE IF NOT EXISTS earnings_calendar (
  symbol TEXT PRIMARY KEY,
  earnings_date TEXT,
  fetched_at TEXT NOT NULL,
  is_estimate INTEGER
);

-- 휴장일 (v2.17.0) — 토스 market-calendar 로 확인한 **평일 휴장일**만 둔다(주말은 따로 판정).
-- 확인한 범위는 app_settings 'marketCalendar.coverage' — 범위 밖은 주말만 휴장으로 본다 (server/marketCalendar.ts).
CREATE TABLE IF NOT EXISTS market_holidays (
  market TEXT NOT NULL,
  date TEXT NOT NULL,
  PRIMARY KEY (market, date)
);

-- 종목 프로필 (v2.18.0) — 종목 지도의 섹터·시가총액. 실적일 하루 1회 갱신(earningsCalendar.ts)이 같은 yfinance info 에서
-- 함께 채운다(호출을 늘리지 않는다). 국내 종목도 yfinance 섹터가 오면 쓰고, 없으면 지도에서 "기타".
CREATE TABLE IF NOT EXISTS stock_profiles (
  symbol TEXT PRIMARY KEY,
  sector TEXT,
  market_cap REAL,
  fetched_at TEXT NOT NULL,
  -- v2.42.0 — 세부 업종(yfinance industry). 동종업계 자동 고르기가 쓴다. 옛 DB 는 db.ts migrate() 가 더한다
  industry TEXT
);

-- 뉴스 AI 판정 (v2.18.0) — 버튼을 눌렀을 때만 만든다. 나중에 적중(판정 뒤 주가)을 재려고 입력·출력을 그대로 둔다.
-- input_json = 기사 목록(제목·발행처·시각·링크), output_json = { raw(모델 원문), judgment(인용 검증 후) }.
-- ⚠️ 자동매매에 쓰지 않는다(검증 전).
CREATE TABLE IF NOT EXISTS news_sentiment (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  symbol TEXT NOT NULL,
  created_at TEXT NOT NULL,
  input_json TEXT NOT NULL,
  output_json TEXT NOT NULL,
  prompt_version TEXT NOT NULL
);

-- 매매 규칙 (v2.43.0 — 퀀트 다시 만들기 1단계). 규칙 내용(매수·매도 조건)은 rule_json 하나에 담는다(src/types/tradingRule.ts 의 RuleBody).
-- 「기본 규칙」 은 처음 한 번만 넣는다 — app_settings 'tradingRules.seeded' 가 표시(사용자가 다 지워도 다시 만들지 않는다). server/rules/store.ts
CREATE TABLE IF NOT EXISTS trading_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  rule_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- 매수 판단 기록 (v2.45.0 — 퀀트 다시 만들기 3단계). server/buyJudge/*
-- 서버가 각 시장 마감 뒤 전용 목록을 고른 규칙으로 판단해 쓴다(마감 판단만, 참고 점수는 저장하지 않는다). [다시 계산] 은 그날 줄을 덮어쓴다.
-- (날짜, 종목, 규칙) 한 줄. 그날 쓴 규칙 이름·내용(rule_json)을 함께 남긴다. 「사도 됨」(code = 'score_buy') 은 계속 보관,
-- 나머지는 app_settings 'buyJudge.retention' 기간이 지나면 하루 한 번 지운다. 성과(5·10·20거래일 뒤)는 저장하지 않고 읽을 때 캔들에서 구한다.
CREATE TABLE IF NOT EXISTS buy_judgments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  market_date TEXT NOT NULL,        -- 기준 봉 날짜(그 종목 시장 날짜)
  symbol TEXT NOT NULL,
  rule_id INTEGER NOT NULL,
  rule_name TEXT NOT NULL,
  rule_json TEXT NOT NULL,
  action TEXT NOT NULL,             -- BUY · HOLD
  code TEXT NOT NULL,               -- score_buy · no_signal_buy · rr_block …
  score INTEGER NOT NULL,
  max_score INTEGER NOT NULL,
  min_score INTEGER NOT NULL,
  breakdown_json TEXT NOT NULL,     -- 켠 조건의 [{key, score, max}]
  reference_json TEXT,              -- 진입 방식·매수가·손절·목표·손익비·비중(참고)
  reason TEXT NOT NULL,
  created_at TEXT NOT NULL,
  gate_reason TEXT,                 -- 「거름망에 걸림」 이유(v2.51.0): below200 · short · market · market_nodata (gate_block 줄만)
  UNIQUE (market_date, symbol, rule_id)
);
CREATE INDEX IF NOT EXISTS idx_buy_judgments_symbol ON buy_judgments (symbol, market_date);

-- AI 검증 (v2.46.0, 퀀트 4단계) — 규칙이 「사도 됨」 을 낸 종목을 사기 직전 AI(Gemini)에게 위험만 묻는다.
-- (그 종목 시장 날짜, 종목) 한 줄 — 같은 날 같은 종목은 한 번만 묻고 여러 계좌가 같이 쓴다. 「못 함」 줄도 남긴다(그날 다시 묻지 않는다 — 한도를 지키려고).
-- 하루 횟수(한국 시간 날짜, 최대 20번)는 따로 세지 않고 이 표에서 구한다 — 실제로 Gemini 를 부른 줄만(통과 · 위험 · 못 함 중 rate_limit/error/timeout/format).
-- 채점(5·10·20거래일 뒤)은 저장하지 않고 읽을 때 캔들에서 구한다(price_at_check → N거래일 뒤 종가, 비용 빼지 않음).
CREATE TABLE IF NOT EXISTS ai_checks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  market_date TEXT NOT NULL,          -- 그 종목 시장 날짜
  symbol TEXT NOT NULL,
  verdict TEXT NOT NULL,              -- pass · risk · unavailable
  reasons_json TEXT NOT NULL DEFAULT '[]',  -- 이유 최대 3줄
  unavailable_reason TEXT,            -- disabled · daily_limit · rate_limit · error · timeout · format
  price_at_check REAL,
  model TEXT,
  prompt_version TEXT NOT NULL,
  input_json TEXT,                    -- AI 에게 준 정보 그대로
  raw_output TEXT,                    -- 모델 원문
  tokens INTEGER,
  elapsed_ms INTEGER,
  created_at TEXT NOT NULL,
  UNIQUE (market_date, symbol)
);
CREATE INDEX IF NOT EXISTS idx_ai_checks_created ON ai_checks(created_at);

-- 계좌별 사용 기록 — 같은 검증 결과를 어느 계좌가 어떻게 썼는지(산 것 · 사지 않은 것). 채점을 계좌별로 한다.
CREATE TABLE IF NOT EXISTS ai_check_uses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  check_id INTEGER NOT NULL REFERENCES ai_checks(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL,
  action TEXT NOT NULL,               -- bought · skipped
  order_id INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_check_uses_account ON ai_check_uses(account_id, created_at DESC);

-- 미국 거래정지 (v2.55.0, 실험실) — Nasdaq Trader 거래정지 RSS(`server/usHalts/`)를 1분마다 받아 쌓는다.
-- 한 정지 = 한 줄(키 = 종목 + 정지 날짜 + 정지 시각 — 원문 문자열 그대로). 같은 종목이 다시 멈추면 새 줄.
-- ⚠️ 원문 칸(raw_*)은 받은 문자열 그대로 둔다(약관 — 피드를 고치거나 왜곡하지 않는다). 계산한 값은 따로 칸을 둔다.
-- 30일 보관(정지 날짜 기준, 하루 한 번 지움). 방향은 **추정**이다(토스 1분봉 — 정답 칸이 없어 맞았는지 확인할 수 없다).
CREATE TABLE IF NOT EXISTS us_halts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  raw_issue_symbol TEXT NOT NULL,
  raw_halt_date TEXT NOT NULL,          -- MM/DD/YYYY (ET)
  raw_halt_time TEXT NOT NULL,          -- HH:MM:SS(.mmm) (ET)
  raw_issue_name TEXT NOT NULL DEFAULT '',
  raw_market TEXT NOT NULL DEFAULT '',
  raw_reason_code TEXT NOT NULL DEFAULT '',
  raw_pause_threshold_price TEXT NOT NULL DEFAULT '',
  raw_resumption_date TEXT NOT NULL DEFAULT '',
  raw_resumption_quote_time TEXT NOT NULL DEFAULT '',
  raw_resumption_trade_time TEXT NOT NULL DEFAULT '',
  halt_day TEXT NOT NULL,               -- 정지 날짜(미국, YYYY-MM-DD) — 원문 날짜를 바꿔 적은 것
  halt_at_ms INTEGER NOT NULL,          -- 정지 시각(epoch ms) — 원문 날짜 · 시각(ET)으로 계산
  first_seen_at TEXT NOT NULL,          -- 처음 본 시각(UTC ISO)
  first_seen_kst TEXT NOT NULL,         -- 처음 본 시각(한국 시간 YYYY-MM-DD HH:MM:SS)
  resume_seen_at TEXT,                  -- 재개 칸(ResumptionTradeTime)이 처음 채워진 것을 본 시각(UTC ISO)
  direction_est TEXT NOT NULL,          -- 방향 추정: pending · up · down · unknown · none(LULD 아님)
  direction_est_json TEXT,              -- 추정에 쓴 값(봉 시각 · 종가 · 판정 못 한 이유)
  updated_at TEXT NOT NULL,
  last_listed_at TEXT,                  -- 마지막으로 Nasdaq 목록에서 본 시각(UTC ISO, v2.55.1) — 지난 정지가 목록에서 사라졌는지 판단
  UNIQUE (raw_issue_symbol, raw_halt_date, raw_halt_time)
);
CREATE INDEX IF NOT EXISTS idx_us_halts_day ON us_halts (halt_day, halt_at_ms);
