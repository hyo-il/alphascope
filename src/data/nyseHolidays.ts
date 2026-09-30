/**
 * NYSE 휴장일 — 토스 시장 달력을 보완한다 (v2.18.0).
 *
 * 출처: https://www.nyse.com/markets/hours-calendars (NYSE 공식 「Holidays & Trading Hours」 표)
 * 확인일: 2026-09-30 — 2026·2027 열을 페이지 원문에서 직접 대조했다.
 * 독립기념일 대체 휴일(2026-07-03 금 · 2027-07-05 월)도 **공식 표에 "Independence Day observed" 로 적혀 있어** 넣었다.
 *
 * - 토스 달력은 "오늘 + 180일" 까지만 받으므로 먼 날짜의 미국 휴일이 빠진다. 이 표가 2027년 말까지를 메운다.
 * - 합칠 때는 **어느 한쪽이라도 휴장이면 휴장**이다(`server/marketCalendar.ts`). 둘 다 확인한 기간에 서로 다르면
 *   로그와 달력 하단에 "토스·NYSE 휴장일 불일치" 를 띄운다 — 어느 쪽이 틀렸는지 사람이 확인한다.
 * - ⚠️ 조기 폐장(오후 1시)은 다루지 않는다 — 휴장이 아니다.
 * - ⚠️ **갱신 시점**: 2027-10 이 지나면 달력에 "휴장 상수 갱신 필요" 가 뜬다(`NYSE_STALE_AFTER`).
 *   NYSE 가 2028 표를 올리면 이 배열에 더하고 확인일·범위·만료일을 고친다. 공식 표 외의 출처로 채우지 않는다.
 */

export const NYSE_SOURCE = 'https://www.nyse.com/markets/hours-calendars';
export const NYSE_CHECKED_AT = '2026-09-30';
/** 이 표가 책임지는 기간 */
export const NYSE_COVERAGE = { from: '2026-01-01', to: '2027-12-31' };
/** 이 날 이후에는 달력이 "휴장 상수 갱신 필요" 를 띄운다 */
export const NYSE_STALE_AFTER = '2027-10-31';

export const NYSE_HOLIDAYS: { date: string; name: string }[] = [
  { date: '2026-01-01', name: '신정' },
  { date: '2026-01-19', name: '마틴 루서 킹 데이' },
  { date: '2026-02-16', name: '대통령의 날' },
  { date: '2026-04-03', name: '성금요일' },
  { date: '2026-05-25', name: '메모리얼 데이' },
  { date: '2026-06-19', name: '준틴스' },
  { date: '2026-07-03', name: '독립기념일(대체)' },
  { date: '2026-09-07', name: '노동절' },
  { date: '2026-11-26', name: '추수감사절' },
  { date: '2026-12-25', name: '성탄절' },
  { date: '2027-01-01', name: '신정' },
  { date: '2027-01-18', name: '마틴 루서 킹 데이' },
  { date: '2027-02-15', name: '대통령의 날' },
  { date: '2027-03-26', name: '성금요일' },
  { date: '2027-05-31', name: '메모리얼 데이' },
  { date: '2027-06-18', name: '준틴스(대체)' },
  { date: '2027-07-05', name: '독립기념일(대체)' },
  { date: '2027-09-06', name: '노동절' },
  { date: '2027-11-25', name: '추수감사절' },
  { date: '2027-12-24', name: '성탄절(대체)' },
];
