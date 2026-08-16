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
