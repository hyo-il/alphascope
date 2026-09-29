/**
 * FOMC 회의 일정 — 일정 달력(v2.17.0)이 쓴다.
 *
 * 출처: https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm (연준 공식 일정표)
 * 확인일: 2026-09-29. `sep: true` = 경제전망(SEP, 점도표) 발표 회의.
 *
 * ⚠️ **갱신 시점**: 마지막 회의(2027-12-07~08) 전, **2027-10 이 지나면** 달력에 "FOMC 일정 갱신 필요" 가 뜬다
 * (`FOMC_STALE_AFTER`). 연준이 2028 일정을 발표하면 이 배열에 더하고 확인일·만료일을 고친다.
 * 공식 일정표 외의 출처(뉴스·추정)로 채우지 않는다.
 */

export interface FomcMeeting {
  /** 회의 첫날 (YYYY-MM-DD) */
  start: string;
  /** 회의 둘째 날 = 성명·금리 결정 발표일 */
  end: string;
  /** 경제전망(SEP) 발표 회의 */
  sep: boolean;
}

export const FOMC_SOURCE = 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm';
export const FOMC_CHECKED_AT = '2026-09-29';
/** 이 날 이후에는 달력이 "FOMC 일정 갱신 필요" 를 띄운다 */
export const FOMC_STALE_AFTER = '2027-10-31';

export const FOMC_MEETINGS: FomcMeeting[] = [
  { start: '2026-01-27', end: '2026-01-28', sep: false },
  { start: '2026-03-17', end: '2026-03-18', sep: true },
  { start: '2026-04-28', end: '2026-04-29', sep: false },
  { start: '2026-06-16', end: '2026-06-17', sep: true },
  { start: '2026-07-28', end: '2026-07-29', sep: false },
  { start: '2026-09-15', end: '2026-09-16', sep: true },
  { start: '2026-10-27', end: '2026-10-28', sep: false },
  { start: '2026-12-08', end: '2026-12-09', sep: true },
  { start: '2027-01-26', end: '2027-01-27', sep: false },
  { start: '2027-03-16', end: '2027-03-17', sep: true },
  { start: '2027-04-27', end: '2027-04-28', sep: false },
  { start: '2027-06-08', end: '2027-06-09', sep: true },
  { start: '2027-07-27', end: '2027-07-28', sep: false },
  { start: '2027-09-14', end: '2027-09-15', sep: true },
  { start: '2027-10-26', end: '2027-10-27', sep: false },
  { start: '2027-12-07', end: '2027-12-08', sep: true },
];
