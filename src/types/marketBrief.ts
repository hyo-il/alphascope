/**
 * 오늘 시황(탐색 → 오늘 시황, v2.59.0) — 서버(`server/marketBrief/`)와 화면(`components/marketBrief/`)이 같이 쓰는 모양.
 * AI 결과의 키(snake_case)는 Stockproject 응답 JSON 키 그대로다(옮겨 만든 기능 — 키를 바꾸면 원본과 견주기 어렵다).
 */

/** 오전판(미국 마감 기준 13종) · 오후판(국내 마감 + VIX) */
export type BriefEdition = 'morning' | 'afternoon';
/** auto = 평일 아침 자동 · button = 「시황 분석」 버튼 */
export type BriefTrigger = 'auto' | 'button';

/** 버튼 하루(KST) 횟수 — 자동은 세지 않는다 */
export const BRIEF_BUTTON_DAILY_LIMIT = 5;
/** 보관 기간(일) */
export const BRIEF_KEEP_DAYS = 30;
/** 판 경계 — 한국 시간 이 시(時)부터 오후판 (Stockproject 와 같음) */
export const BRIEF_AFTERNOON_HOUR = 13;
/** 자동 시각(한국 시간, 월~금) — 실제로는 이 시각 뒤 첫 10분 확인 때 돈다 */
export const BRIEF_AUTO_TIME = '06:55';

export type BriefAssetKey =
  | 'KOSPI'
  | 'KOSDAQ'
  | 'SP500'
  | 'NASDAQ'
  | 'DOW'
  | 'RUSSELL2000'
  | 'GOLD'
  | 'DXY'
  | 'US2Y'
  | 'US10Y'
  | 'USDKRW'
  | 'WTI'
  | 'NATGAS'
  | 'VIX';

/** 마지막 두 종가로 낸 값 — 원본 stock_analyzer 와 같은 계산 */
export interface BriefAsset {
  current: number;
  change: number;
  change_pct: number;
  /** 마지막 종가의 날짜(그 시장 날짜, YYYY-MM-DD) — 모르면 null */
  data_date: string | null;
}

/** 60일 안 실적 한 건 — 실적일은 `earningsCalendar.getEarningsDate` 하나에서, 전망치는 지표 엔진 */
export interface BriefEarning {
  symbol: string;
  /** 한글 이름(종목 목록) — 없으면 티커 */
  name: string;
  /** 한국어 섹터(`data/sectors.sectorKo` — 종목 지도와 같은 이름). 모르면 '기타' */
  sector: string;
  /** YYYY-MM-DD */
  date: string;
  /** 오늘(한국 날짜)부터 며칠 뒤 */
  daysUntil: number;
  /** 회사가 확정하기 전 추정일 */
  isEstimateDate: boolean;
  /** 아래는 원본 표기 그대로(국내는 원화) — 모르면 '-' */
  epsEstimate: string;
  lastQuarterEps: string;
  yoyEps: string;
  /** 매출 sanity 에 걸리면 '-'(노이즈 매출 숨김) */
  revenueEstimate: string;
  recommendation: string;
  /** 분산 30% 이상일 때만 「분산 ±N%」, 아니면 '-' */
  epsDispersion: string;
  epsSanityFlag: boolean;
  revenueSanityFlag: boolean;
  /** 전망치를 받았나 — 못 받으면 실적일만 */
  estimatesOk: boolean;
}

export type BriefSourceGroup = 'market' | 'news' | 'earnings' | 'ai';

/** 수집 상태 한 줄 — 화면 「수집 상태」 */
export interface BriefSourceStatus {
  group: BriefSourceGroup;
  label: string;
  ok: boolean;
  /** 받은 건수 등 짧은 설명 · 실패 이유 */
  detail: string;
}

export interface BriefScheduleItem {
  date: string;
  event: string;
  ticker: string;
  sector_kr: string;
  detail: string;
  importance: number;
}

export interface BriefTheme {
  /** 🔴 하락 리스크 · 🟡 중립 · 🟢 상승 모멘텀(원본 값 그대로 — 화면은 배지로 바꿔 보인다) */
  icon: string;
  category: string;
  title: string;
  why_important: string;
  duration: string;
  swing_point: string;
}

export interface BriefLeadingSector {
  /** 원본 키 — 화면에 쓰지 않는다(이모지 금지) */
  emoji: string;
  name: string;
  stars: string;
  reason: string;
  stocks_kr: string;
  stocks_us: string;
}

/** AI 결과 — 오전판은 market_regime · regime_summary, 오후판은 market_summary · vix_comment */
export interface BriefAi {
  market_regime?: 'Risk-On' | 'Risk-Off' | '혼조';
  regime_summary?: string;
  market_summary?: string;
  vix_comment?: string;
  portfolio_note: string;
  key_themes: BriefTheme[];
  leading_sectors: BriefLeadingSector[];
  swing_check: { phase: string; catalysts: string[]; risks: string[] };
  upcoming_schedule: { this_week: BriefScheduleItem[]; this_month: BriefScheduleItem[]; next_2_months: BriefScheduleItem[] };
  portfolio_adjustment: { passive_note: string; swing_candidates: string[] };
}

export interface MarketBrief {
  id: number;
  /** 한국 날짜 YYYY-MM-DD */
  date: string;
  edition: BriefEdition;
  trigger: BriefTrigger;
  /** 만든 시각(UTC ISO) */
  createdAt: string;
  model: string | null;
  tokens: number | null;
  /** Gemini 를 부른 횟수(0 · 1 · 2) */
  aiCalls: number;
  promptVersion: string;
  sources: BriefSourceStatus[];
  data: {
    assets: Partial<Record<BriefAssetKey, BriefAsset>>;
    earnings: BriefEarning[];
  };
  /** AI 결과 — 꺼짐 · 실패면 null(데이터만 저장) */
  brief: BriefAi | null;
  /** AI 가 없는 이유 */
  aiError: string | null;
}

export interface MarketBriefListItem {
  id: number;
  edition: BriefEdition;
  trigger: BriefTrigger;
  createdAt: string;
  hasAi: boolean;
}

export interface MarketBriefDayResponse {
  date: string;
  items: MarketBriefListItem[];
  selected: MarketBrief | null;
}

export interface MarketBriefDays {
  /** 최근 것부터 */
  days: { date: string; count: number }[];
}

export type BriefStage = 'collect' | 'ai' | 'save';

export interface MarketBriefStatus {
  running: boolean;
  stage: BriefStage | null;
  edition: BriefEdition | null;
  trigger: BriefTrigger | null;
  startedAt: string | null;
  /** 한국 날짜 */
  today: string;
  buttonUsed: number;
  buttonLimit: number;
  /** 지금 버튼을 누르면 만들 판 */
  nowEdition: BriefEdition;
  /** 자동이 꺼진 이유(MARKET_BRIEF_ENABLED=false) — 켜져 있으면 null */
  autoDisabledReason: string | null;
  /** Gemini 를 부를 수 없는 이유 — 있으면 데이터만 만든다 */
  geminiDisabledReason: string | null;
  /** 마지막으로 끝난 실행의 줄 id — 진행이 끝나면 화면이 이 줄로 간다 */
  lastFinishedId: number | null;
  /** 마지막 실행이 줄을 남기지 못하고 실패한 이유 */
  lastError: string | null;
}
