/**
 * AI 검증 (v2.46.0, 퀀트 다시 만들기 4단계) — 서버(`server/aiCheck/*`)와 화면이 같이 쓰는 모양.
 * 규칙이 「사도 됨」 을 낸 종목을 사기 직전에 AI(Gemini)에게 한 번 묻고, 「위험」 이면 사지 않는다. 매도에는 쓰지 않는다.
 */

/** 통과 · 위험 · 검증 못 함 */
export type AiVerdict = 'pass' | 'risk' | 'unavailable';

/**
 * 「검증 못 함」 까닭 — 모두 **사지 않는다**(안전 쪽, A-4).
 * - disabled: 서버에서 Gemini 가 꺼져 있다(GEMINI_ENABLED=false · 키 없음) — 부르지 않음
 * - daily_limit: 하루 최대 횟수(`AI_CHECK_DAILY_LIMIT`)를 다 썼다 — 부르지 않음
 * - rate_limit: Gemini 한도 초과(429) · error: 그 밖의 오류 · timeout: 60초 넘음 · format: 답 모양이 틀림 — 부른 것으로 센다
 */
export type AiUnavailableReason = 'disabled' | 'daily_limit' | 'rate_limit' | 'error' | 'timeout' | 'format';

export const AI_UNAVAILABLE_LABEL: Record<AiUnavailableReason, string> = {
  disabled: '이 서버에서 AI 가 꺼져 있음',
  daily_limit: '하루 횟수를 다 씀',
  rate_limit: 'AI 한도 초과',
  error: 'AI 오류',
  timeout: '시간 초과',
  format: '답 형식이 맞지 않음',
};

export const AI_VERDICT_LABEL: Record<AiVerdict, string> = {
  pass: '통과',
  risk: '위험',
  unavailable: '검증 못 함',
};

/** 하루 최대 횟수(모든 계좌 합계, 한국 시간 날짜) — 앱의 출발값(근거 검증 전) */
export const AI_CHECK_DAILY_LIMIT = 20;

/** 한 번 검증의 시간 제한(Gemini 재시도 포함) */
export const AI_CHECK_TIMEOUT_MS = 60_000;

/** 채점 기간(거래일) */
export const AI_CHECK_OUTCOME_DAYS = [5, 10, 20] as const;
export type AiOutcomeDays = (typeof AI_CHECK_OUTCOME_DAYS)[number];

/** 이 수보다 적으면 「표본 적음」 */
export const AI_CHECK_SMALL_SAMPLE = 30;

/** 계좌 화면 「AI 검증 기록」 한 줄 — 그 계좌가 쓴 검증 */
export interface AiCheckRecord {
  useId: number;
  checkId: number;
  marketDate: string;
  symbol: string;
  verdict: AiVerdict;
  reasons: string[];
  unavailableReason: AiUnavailableReason | null;
  /** 이 계좌의 행동 */
  action: 'bought' | 'skipped';
  priceAtCheck: number | null;
  /** 검증 때 가격 → N거래일 뒤 종가(%). 아직 날이 안 지났으면 null. 비용은 빼지 않는다(두 묶음 비교용) */
  returns: Record<AiOutcomeDays, number | null>;
  createdAt: string;
}

/** 묶음 하나의 평균(기간별) */
export interface AiGroupStats {
  /** 결과가 나온 건수 */
  n: Record<AiOutcomeDays, number>;
  avg: Record<AiOutcomeDays, number | null>;
}

export interface AiCheckHistory {
  rows: AiCheckRecord[];
  /** 이 계좌의 전체 줄 수(더 보기용) */
  total: number;
  stats: {
    /** 「위험」 으로 막은 것 */
    blocked: AiGroupStats;
    /** 「통과」 해서 산 것 */
    passed: AiGroupStats;
    /** 「검증 못 함」 수 */
    unavailable: number;
  };
}
