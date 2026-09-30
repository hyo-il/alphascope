/** 주요 일정 달력 (v2.17.0) — 서버 `calendarService.ts` 와 화면 `components/calendar` 가 함께 쓴다 */

export type CalendarScope = 'watchlist' | 'universe';
export type CalendarEventType = 'earnings' | 'fomc' | 'expiry' | 'holiday';

export interface CalendarEvent {
  /** YYYY-MM-DD (그 시장의 날짜) */
  date: string;
  type: CalendarEventType;
  label: string;
  /** 오늘보다 앞선 날 — 회색으로 */
  past: boolean;
  /** 실적 */
  symbol?: string;
  name?: string | null;
  isEstimate?: boolean;
  /** 옵션 만기 — 3·6·9·12월 */
  quarterly?: boolean;
  /** 휴장 */
  market?: 'US' | 'KR';
}

export interface CalendarResponse {
  from: string;
  to: string;
  scope: CalendarScope;
  events: CalendarEvent[];
  meta: {
    today: string;
    /** FOMC 상수가 만료됐나 (2027-10 이후) — "FOMC 일정 갱신 필요" */
    fomcStale: boolean;
    fomcSource: string;
    /** 휴장일을 확인한 범위 — null 이면 아직 못 받았다(휴장 필터를 숨긴다) */
    holidays: { US: { from: string; to: string } | null; KR: { from: string; to: string } | null };
    /** NYSE 공식 휴장 표(2026~2027) — 토스 달력을 보완한다 (v2.18.0) */
    nyse: {
      coverage: { from: string; to: string };
      source: string;
      /** 2027-10 이후 — "휴장 상수 갱신 필요" */
      stale: boolean;
      /** 둘 다 확인한 기간에 토스와 NYSE 가 다른 날 */
      mismatches: string[];
    };
    /** 실적을 본 종목 수 */
    scopeSize: number;
  };
}
