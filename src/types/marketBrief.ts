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
  | 'VIX'
  /** 미국 지수 선물(v2.60.0) — CME E-mini S&P 500 · E-mini Nasdaq-100 근월물(yfinance ES=F · NQ=F) */
  | 'ES'
  | 'NQ';

/** 마지막 두 종가로 낸 값 — 원본 stock_analyzer 와 같은 계산 */
export interface BriefAsset {
  current: number;
  change: number;
  change_pct: number;
  /** 마지막 종가의 날짜(그 시장 날짜, YYYY-MM-DD) — 모르면 null */
  data_date: string | null;
  /** 최근 흐름(%, v2.60.0) — 마지막 값 ÷ 5 · 20거래일 전 종가 − 1. 봉이 모자라면 그 칸 null · 지수만 */
  trend?: { d5: number | null; d20: number | null };
}

/** 섹터 1주 흐름 한 줄(종목 지도 1주 · 시총 가중 수익률 %) */
export interface BriefSectorMove {
  sector: string;
  pct: number;
}

/** 섹터 1주 흐름(v2.60.0) — 종목 지도(`heatmap(…, '1w')`) 섹터 통계를 읽기만 한 것. 시장마다 강세 위 3 · 약세 아래 3 · 받지 못하면 null */
export interface BriefSectorTrend {
  kr: { up: BriefSectorMove[]; down: BriefSectorMove[] } | null;
  us: { up: BriefSectorMove[]; down: BriefSectorMove[] } | null;
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
  /** 「발표됨」(v2.59.6 — AI 없는 브리핑의 ② 도) — `BriefScheduleItem.released` 와 같은 판정 · 만들 때 저장 */
  released?: boolean;
  usCloseAt?: string;
}

/** check = 서버 검사(AI 문장 검사 · 대표 종목 거르기 — v2.59.6) · 받기 실패 수에 세지 않는다 */
export type BriefSourceGroup = 'market' | 'news' | 'earnings' | 'ai' | 'check';

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
  /**
   * 「발표됨」 — 미국 일정이고 날짜가 그 일정의 오늘(미국 날짜)이며, 만들 때 그 날 미국 정규장이 이미 끝났다(v2.59.4).
   * 만들 때 서버가 정해 저장한다(지난 브리핑을 열어도 그때 표시 그대로). 일정에서 빼지 않는다.
   */
  released?: boolean;
  /** 「발표됨」 의 기준 — 그 날 미국 정규장 끝 시각(UTC ISO, 조기 마감 반영). 화면 툴팁이 한국 시각으로 보인다 */
  usCloseAt?: string;
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
  /**
   * 대표 종목 — 서버가 후보 목록(`server/marketBrief/sectorStocks.ts`)으로 거른 것(v2.59.6).
   * 글자(string)는 그 전에 만든 브리핑(AI 자유 글 — 화면은 글자 그대로 보인다).
   */
  stocks_kr: BriefSectorStock[] | string;
  stocks_us: BriefSectorStock[] | string;
}

/** 대표 종목 한 개 — 이름은 후보 목록의 이름(카탈로그 한글명) */
export interface BriefSectorStock {
  symbol: string;
  name: string;
}

/**
 * AI 문장 ↔ 시장 데이터 방향 어긋남 한 건(v2.59.6 — `server/marketBrief/directionCheck.ts`). 문장은 고치지 않고 표시만 한다.
 */
export interface BriefMismatch {
  /** 어느 글 — 'market_regime' · 'regime_summary' · 'market_summary' · 'leading_sectors.0.reason' · 'key_themes.1.why_important' · 'swing_check.phase' */
  field: string;
  /** 시장 이름(화면 글자) — '국내 증시' · '코스피' */
  market: string;
  /** 글이 쓴 방향 말 — '방어' */
  said: string;
  /** 같은 브리핑의 숫자 — '코스피 −5.53%(장중) · 코스닥 −4.74%(장중)' */
  actual: string;
}

/** 「오늘 예상 방향」(v2.60.0) 대상 — 코스피(오늘 국내 정규장) · S&P500(오늘 밤 미국 정규장) */
export type OutlookTarget = 'KOSPI' | 'SP500';
export type OutlookDirection = '상승' | '보합' | '하락';
export type OutlookConfidence = '높음' | '보통' | '낮음';
/** 판마다 예상 대상 — 오전판 = 오늘 코스피 + 오늘 밤 미국 · 오후판 = 오늘 밤 미국(사용자 결정 2026-10-30) */
export const OUTLOOK_TARGETS: Record<BriefEdition, OutlookTarget[]> = { morning: ['KOSPI', 'SP500'], afternoon: ['SP500'] };
export const OUTLOOK_DIRECTIONS: OutlookDirection[] = ['상승', '보합', '하락'];
export const OUTLOOK_CONFIDENCES: OutlookConfidence[] = ['높음', '보통', '낮음'];

/** 예상 한 줄 — AI 가 입력 숫자로 쓴 참고 예상(투자 조언 아님 · 매수 판단 · 자동매매에 쓰지 않는다) */
export interface BriefOutlook {
  target: OutlookTarget;
  direction: OutlookDirection;
  confidence: OutlookConfidence;
  /** 근거 1~3줄(입력 숫자) */
  reasons: string[];
  /** 뒤집힐 수 있는 조건 한 줄 */
  watch: string;
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
  /** 「오늘 예상 방향」(v2.60.0) — 판에 맞는 대상만(서버가 거른다) · 그 전 브리핑은 없음 */
  today_outlook?: BriefOutlook[];
  /** 문장 ↔ 숫자 어긋남(v2.59.6) — 없으면 빈 배열 또는 없음(그 전 브리핑) */
  mismatches?: BriefMismatch[];
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
    /** 시장 데이터를 실제로 받은 시각(UTC ISO) — 장중/종가 판단(프롬프트 · 화면 같은 값). 없으면 createdAt */
    collectedAt?: string;
    /** 섹터 1주 흐름(v2.60.0) — 없으면 그 전 브리핑 */
    sectorTrend?: BriefSectorTrend;
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

/**
 * 예상 한 줄의 채점 상태(v2.60.0) — scored 맞음/틀림 · pending 마감 뒤 채점 · after-open 장 시작 뒤 만든 예상(채점 안 함) ·
 * superseded 같은 거래일 장 시작 전 더 나중 예상이 채점됨 · holiday 휴장 · waiting-data 마감 뒤인데 실제 값을 아직 못 받음
 */
export type OutlookScoreStatus = 'scored' | 'pending' | 'after-open' | 'superseded' | 'holiday' | 'waiting-data';

export interface OutlookItemScore {
  target: OutlookTarget;
  status: OutlookScoreStatus;
  /** 채점하는(한) 거래일 — 그 시장 날짜 */
  tradeDay: string | null;
  /** 그 거래일 정규장 끝(UTC ISO) — 채점 대기 문구 「한국 HH:MM 마감 뒤」 */
  closeAt: string | null;
  hit?: boolean;
  actualPct?: number;
  actualDirection?: OutlookDirection;
}

/** 대상별 최근 채점(최근 20번 · 확신별 나눔) */
export interface OutlookStats {
  total: number;
  hits: number;
  byConfidence: Record<OutlookConfidence, { total: number; hits: number }>;
}

export interface OutlookView {
  items: OutlookItemScore[];
  stats: Partial<Record<OutlookTarget, OutlookStats>>;
  /** 최근 몇 번까지 세는가(20) */
  recent: number;
}

export interface MarketBriefDayResponse {
  date: string;
  items: MarketBriefListItem[];
  selected: MarketBrief | null;
  /** 고른 브리핑의 「오늘 예상 방향」 채점 상태 · 대상별 최근 성적(v2.60.0 — 예상이 없으면 없음) */
  outlook?: OutlookView;
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
  /** 마지막으로 끝난 실행의 줄 id · 그 줄의 날짜 — 진행이 끝나면 화면이 이 줄로 간다(자정을 넘겨 끝나도) */
  lastFinishedId: number | null;
  lastFinishedDate: string | null;
  /** 오늘(한국 날짜) 자동 오전판을 시도했나 · 만들었나 — 빈 상태 안내가 쓴다 */
  autoTriedToday: boolean;
  autoDoneToday: boolean;
  /** 자동 오전판을 만드는 시간(평일 06:55~13:00 KST)인가 */
  autoWindowNow: boolean;
  /** 서버가 켜진 시각(ms) — 진행 중 서버가 다시 켜졌는지 화면이 안다 */
  bootAt: number;
  /** 마지막 실행이 줄을 남기지 못하고 실패한 이유 */
  lastError: string | null;
}
