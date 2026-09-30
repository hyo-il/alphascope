/** 토스증권 Open API Rate Limit (그룹별 초당 허용 요청 수) */
export const RATE_LIMITS = {
  AUTH: { perSecond: 5 },
  MARKET_DATA: { perSecond: 15 }, // prices, orderbook, trades, price-limits
  MARKET_DATA_CHART: { perSecond: 20 }, // candles
  STOCK: { perSecond: 5 }, // stocks, warnings
  STOCK_ALL: { perSecond: 1 }, // 전종목 조회
  STOCK_TRADING_TREND: { perSecond: 10 }, // investor-trading, short-selling 등
  MARKET_INFO: { perSecond: 3 }, // exchange-rate, market-calendar
  RANKING: { perSecond: 5 },
  ACCOUNT: { perSecond: 1 },
  ASSET: { perSecond: 5 }, // holdings
  ORDER: { perSecond: 10 },
  ORDER_INFO: { perSecond: 6, peakPerSecond: 3 }, // 09:00~09:10 KST
  CONDITIONAL_ORDER: { perSecond: 5 },
} as const;

export type RateLimitGroup = keyof typeof RATE_LIMITS;

/** OAuth 토큰을 만료 몇 ms 전에 미리 갱신할지 */
export const TOKEN_REFRESH_MARGIN_MS = 10 * 60 * 1000; // 10분

/** API 재시도 정책 (지수 백오프) */
export const RETRY = {
  maxAttempts: 4,
  baseDelayMs: 500,
  maxDelayMs: 8000,
} as const;

/** 5m/15m/30m 은 1분봉을 집계해 만든다 */
export const AGGREGATION_MINUTES: Record<string, number> = {
  '5m': 5,
  '15m': 15,
  '30m': 30,
};

/**
 * 메인 차트가 처음 받는 봉 수 — **캔들과 지표가 같은 값**을 써야 지표가 화면과 어긋나지 않는다(한 곳에 둔다).
 * 주봉 104 ≈ 2년(일봉 약 520), 월봉 60 ≈ 5년(일봉 약 1,260) — v2.20.0.
 */
export const CHART_CANDLE_LIMITS = {
  '1m': 500,
  '5m': 400,
  '15m': 300,
  '30m': 300,
  '1d': 300,
  '1w': 104,
  '1M': 60,
} as const satisfies Record<string, number>;

/** 과거로 스크롤할 때 한 번에 더 받는 봉 수 — 주·월은 원본 일봉이 5·22배라 줄인다 */
export const CHART_PAGE_SIZE = { '1m': 200, '5m': 200, '15m': 200, '30m': 200, '1d': 200, '1w': 104, '1M': 60 } as const;
