/** 종목 지도(히트맵) — 서버 `server/heatmap.ts` 와 화면 `components/heatmap` 이 함께 쓴다 */

export type HeatmapMarket = 'us' | 'kr';

/** 지도 보기 — market = 시총 상위 N(30·50·100) · watch = 그 시장의 관심 종목 */
export type HeatmapView = 'market' | 'watch';

/**
 * 색으로 보는 기간. 1d = 실시간 시세 ÷ 기준 종가(전 거래일 종가 — 미국 애프터마켓만 오늘 정규장 종가),
 * 그 밖은 **마지막 완성 종가 ÷ N거래일 전 종가** — 1w = 5, 1m = 21, 3m = 63 거래일.
 */
export type HeatmapPeriod = '1d' | '1w' | '1m' | '3m';

/**
 * 「1일」 지도 새로고침 간격 — **화면 주기와 서버 캐시가 이 값 하나**를 쓴다.
 * 근거(테스트 서버 실측, 2026-10-14): 한 번 만들 때 토스 `/prices` 는 30종목씩 — 시장 상위 100 = 4회, 관심 종목 = 종목 수 ÷ 30 올림.
 * 10초면 지도 하나(상위 100)에 초당 약 0.4회 · 1시간 1,440회(MARKET_DATA 한도 15/s). 최악(1일 지도 네 개를 10초마다 + 차트 현재가·호가·관심 시세 약 3회/s)을
 * 3분 돌려 `/prices` 512회 · 429 0회 · `x-ratelimit-remaining` 최저 2/15(401 3회는 토큰 재발급) — 10초로 정했다.
 */
export const HEATMAP_LIVE_MS = 10_000;

/**
 * 종목 지도 1일의 거래 시간대(`server/heatmapSession.ts`) — 정규장 밖도 거래가 열려 있으면 10초마다 다시 받는다.
 * day = 미국 주간거래 · other = 시간표에는 없지만 최근 2분 안에 체결이 있음(장외 거래)
 */
export type HeatmapSession = 'pre' | 'regular' | 'after' | 'day' | 'other';

/** 1일 등락률 기준 — prev: 전 거래일 종가 · today: 오늘 정규장 종가(미국 애프터마켓, 오늘 봉 확정 뒤) · recent: 가장 최근 정규장 종가 */
export type HeatmapBasis = 'prev' | 'today' | 'recent';

export const HEATMAP_PERIODS: { id: HeatmapPeriod; label: string; bars: number }[] = [
  { id: '1d', label: '1일', bars: 1 },
  { id: '1w', label: '1주', bars: 5 },
  { id: '1m', label: '1개월', bars: 21 },
  { id: '3m', label: '3개월', bars: 63 },
];

/**
 * 섹터 강세 한 줄 — **설명용 통계**다. 판정·자동매매에 쓰지 않는다(검증 전).
 * 수익률은 전부 % 단위.
 */
export interface HeatmapSector {
  sector: string;
  /** 시총 가중 기간 수익률 — ⚠️ 가중치는 **현재** 시총(기간 초 시총이 아니다) */
  capReturn: number;
  /** 동일 가중(단순 평균) 기간 수익률 */
  equalReturn: number;
  /** 오른 종목 수 / 계산에 들어간 종목 수 */
  up: number;
  counted: number;
  /** N거래일 전 종가가 없어(상장 직후·거래 정지 등) 뺀 종목 수 */
  excluded: number;
  /** 시장 평균(시총 가중) 대비 차이(%p) */
  vsMarket: number;
  /** 섹터 수익률에 가장 크게 기여한 종목 3개 — contribution = 시총 비중 × 수익률 (%p) */
  top: { symbol: string; name: string | null; returnPct: number; contribution: number }[];
}

export interface HeatmapCell {
  symbol: string;
  name: string | null;
  /** 한국어 섹터 이름 (없으면 '기타') */
  sector: string;
  /** 네모 크기 — 시가총액(통화 단위 그대로) */
  marketCap: number;
  price: number | null;
  /** 고른 기간의 수익률(%) — 1d 는 기준 종가(`HeatmapResponse.basis`) 대비. 모르면 null(회색, 섹터 통계에서 제외) */
  changeRate: number | null;
  currency: 'KRW' | 'USD';
  /** 관심 종목인가 — 시장 보기에서는 파란 테두리(상위 N 밖의 관심 종목은 넣지 않는다) */
  watch: boolean;
}

export interface HeatmapResponse {
  market: HeatmapMarket;
  period: HeatmapPeriod;
  view: HeatmapView;
  /** 시장 보기의 상위 N (관심 종목 보기는 null) */
  top: number | null;
  cells: HeatmapCell[];
  /** 섹터 강세 순위 — 시총 가중 수익률 높은 순 */
  sectors: HeatmapSector[];
  /** 시장 전체(대상 종목) 시총 가중 수익률 · 계산에 들어간 수 · 뺀 수 */
  marketReturn: number | null;
  counted: number;
  excluded: number;
  asOf: string;
  /**
   * 그 시장에 지금 거래가 열려 있나 — **어느 세션이든**(프리 · 정규 · 애프터 · 주간거래 · NXT · 장외 거래, `server/heatmapSession.ts`).
   * 자동매매의 정규장 판단(`marketHours.isMarketOpen`)과 다르다. 닫혀 있으면 화면은 「장 마감」 이고 1분마다 다시 열렸는지만 묻는다
   */
  marketOpen: boolean;
  /** 지금 세션(닫혀 있으면 null) · 이름(「프리마켓」 등) */
  session: HeatmapSession | null;
  sessionLabel: string | null;
  /** 1일 등락률 기준과 그 문구(「전일 종가 대비」 · 「오늘 종가 대비」 · 「최근 종가 대비」) */
  basis: HeatmapBasis;
  basisLabel: string;
  /** 다음 세션 시작(ISO, 휴장일 반영) — 닫혀 있을 때 화면이 이 시각 5초 뒤 한 번 다시 받는다 */
  nextOpen: string;
  /** 섹터를 아직 모르는 종목 수 — 하루 1회 갱신 전이면 '기타' 로 묶인다 */
  missingSectors: number;
  /** 시가총액을 몰라 지도에서 빠진 종목 (관심 종목 보기에서만 생긴다) */
  missingCap: { symbol: string; name: string | null }[];
}
