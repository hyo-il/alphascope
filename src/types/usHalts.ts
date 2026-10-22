/**
 * 미국 거래정지 (실험실, v2.55.0) — `GET /api/us-halts` 응답 모양. 서버 `server/usHalts/` 와 화면 `components/usHalts/` 가 같이 쓴다.
 *
 * 원문 칸(`raw*`)은 Nasdaq Trader 거래정지 RSS 의 문자열 그대로다(약관 — 피드를 고치거나 왜곡하지 않는다).
 * 시각(ms) · 순번 · 방향은 서버가 원문에서 **따로 계산한** 값이다.
 */

/**
 * 방향 **추정** — 정지 직전 1분봉 종가를 그 5분 전 봉 종가와 비교한 것(`server/usHalts/directionEstimate.ts`).
 * RSS 에 상한 / 하한 칸이 없어(PauseThresholdPrice 는 늘 빈칸) 맞았는지 확인할 수 없다.
 * - pending: 아직 추정하지 않음(처음 본 직후) · none: LULD 정지가 아니라 추정하지 않음
 */
export type HaltDirectionEstimate = 'pending' | 'up' | 'down' | 'unknown' | 'none';

export interface UsHaltRow {
  id: number;
  rawIssueSymbol: string;
  rawIssueName: string;
  rawMarket: string;
  rawReasonCode: string;
  rawHaltDate: string;
  rawHaltTime: string;
  rawResumptionDate: string;
  rawResumptionQuoteTime: string;
  rawResumptionTradeTime: string;
  /** 정지 시각(epoch ms) — 원문 날짜 · 시각(ET) */
  haltAtMs: number;
  /** 재개 시각(epoch ms) — 원문 `ResumptionDate` + `ResumptionTradeTime`. 빈칸이면 null */
  resumeAtMs: number | null;
  firstSeenAt: string;
  resumeSeenAt: string | null;
  directionEst: HaltDirectionEstimate;
  /** 그 종목의 그날 정지 순번(1부터, 정지 시각 순) */
  nthToday: number;
  /** 토스 종목 목록(카탈로그)에 있는 종목 — 없으면 차트를 열 수 없다 */
  inToss: boolean;
  /** 카탈로그의 한글 이름(없으면 null — 화면은 원문 이름) */
  catalogName: string | null;
  /** 모의 계좌 어느 하나라도 들고 있는 종목 */
  held: boolean;
}

/**
 * 지난 날 정지 중(「며칠째 정지 중」) — 정지 날짜가 오늘(미국)보다 앞이고 30일 안 + 안 풀림(`utils/usHalts.isHaltOngoing`).
 * `unlisted` = 마지막으로 성공한 받기의 목록에 더 이상 없다 → 풀렸는지 알 수 없다(「정지 중」 으로 단정하지 않는다).
 */
export interface UsOngoingHaltRow extends UsHaltRow {
  /** 미국 날짜로 센 날 수(정지한 날 = 1일째) */
  daysHalted: number;
  unlisted: boolean;
}

/**
 * 받는 때 — regular: 미국 평일 04:00~20:00 ET(휴장 제외) · extended: 20:00 ET 뒤 미국 자정 전, 오늘 안 풀린 정지가 있어 이어 받음 · outside: 받지 않음
 */
export type UsHaltFetchWindow = 'regular' | 'extended' | 'outside';

export interface UsHaltFetchStatus {
  /** 서버 스위치(`US_HALTS_ENABLED`) */
  enabled: boolean;
  /** 지금 받는가(regular · extended) */
  inWindow: boolean;
  window: UsHaltFetchWindow;
  /** extended 일 때 — 오늘 안 풀린 정지 수 */
  openToday: number;
  lastSuccessAt: string | null;
  lastAttemptAt: string | null;
  consecutiveFailures: number;
  lastError: string | null;
}

export interface UsHaltsResponse {
  /** 보여 주는 미국 날짜(YYYY-MM-DD) */
  day: string;
  /** 서버 시각(epoch ms) — 화면의 예상 재개 판단 기준 */
  serverNow: number;
  /** 새 정지가 위(정지 시각 내림차순) */
  halts: UsHaltRow[];
  /** 지난 날 정지 중 — 오래된 것부터(관심 · 보유를 위로 올리는 것은 화면) */
  ongoing: UsOngoingHaltRow[];
  status: UsHaltFetchStatus;
}
