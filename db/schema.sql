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
  is_active INTEGER NOT NULL DEFAULT 1   -- 활성/비활성
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

-- ─────────────────────────────────────────────────────────────────────────────
-- 스윙 투자 추천 (Step 10)
--
-- 추천은 "한 번 돌린 것" 단위로 남긴다 — 같은 analyzed_at 이 한 번의 분석이다.
-- 매수 전에 목표가·손절가가 함께 저장돼야 나중에 성과를 채점할 수 있다.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS swing_recommendations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  analyzed_at TEXT NOT NULL,
  symbol TEXT NOT NULL,
  name TEXT,
  price_at_analysis REAL NOT NULL,

  score INTEGER NOT NULL,
  grade TEXT NOT NULL,               -- 'STRONG' | 'BUY' | 'WATCH' | 'HOLD' | 'AVOID'

  trend_score INTEGER,
  timing_score INTEGER,
  momentum_score INTEGER,
  volume_score INTEGER,
  risk_reward_score INTEGER,

  entry_price REAL,
  entry_type TEXT,                   -- 'NOW' | 'PULLBACK' | 'BREAKOUT'
  entry_reason TEXT,
  target1_price REAL,
  target2_price REAL,
  stop_loss_price REAL,
  risk_reward_ratio REAL,
  recommended_percent REAL,
  holding_period_min INTEGER,
  holding_period_max INTEGER,
  warnings TEXT,                     -- JSON
  invalidation TEXT,

  conditions_detail TEXT,            -- JSON: 조건별 점수·근거
  indicators_snapshot TEXT,          -- JSON: 당시 지표값

  price_after_7d REAL,
  price_after_14d REAL,
  price_after_30d REAL,
  target1_hit INTEGER DEFAULT 0,
  target2_hit INTEGER DEFAULT 0,
  stop_loss_hit INTEGER DEFAULT 0,
  actual_result TEXT DEFAULT 'pending',  -- target1 | target2 | stop_loss | open | not_triggered | pending
  actual_return REAL
);

CREATE INDEX IF NOT EXISTS idx_swing_analyzed ON swing_recommendations(analyzed_at DESC);
CREATE INDEX IF NOT EXISTS idx_swing_symbol ON swing_recommendations(symbol, analyzed_at DESC);

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
