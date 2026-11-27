/**
 * 158차(v2.83.0) 폰 증시 일정 시험용 가짜 `/api/calendar` 응답 — 만든 값(실제 실적일 · 종목 값 아님).
 * 오늘 = 2026-11-27(한국 날짜 · 시험 시계). 받는 범위(`from` ~ `to`)에 든 일정만 돌려준다(서버와 같은 꼴).
 */
import type { CalendarEvent, CalendarResponse } from '../../../src/types/calendar';

const TODAY = '2026-11-27';
const E = (date: string, type: CalendarEvent['type'], label: string, o: Partial<CalendarEvent> = {}): CalendarEvent => ({
  date,
  type,
  label,
  past: date < TODAY,
  market: 'US',
  ...o,
});

const EVENTS: CalendarEvent[] = [
  E('2026-10-30', 'earnings', '실적 발표 · 장 마감 뒤', { symbol: 'AAPL', name: '애플' }),
  E('2026-11-03', 'earnings', '실적 발표 · 장 시작 전', { symbol: 'PLTR', name: '팔란티어' }),
  E('2026-11-20', 'expiry', '옵션 만기'),
  E('2026-11-24', 'earnings', '실적 발표 · 장 마감 뒤', { symbol: 'NVDA', name: '엔비디아' }),
  E('2026-11-24', 'earnings', '실적 발표(예정)', { symbol: '005930', name: '삼성전자', isEstimate: true, market: 'KR' }),
  E('2026-11-26', 'holiday', '미국 휴장(추수감사절)'),
  E('2026-11-27', 'earnings', '실적 발표 · 장 마감 뒤', { symbol: 'MRVL', name: '마벨 테크놀로지' }),
  E('2026-11-27', 'earnings', '실적 발표(예정)', { symbol: '000660', name: 'SK하이닉스', isEstimate: true, market: 'KR' }),
  E('2026-11-27', 'fomc', 'FOMC 의사록 공개'),
  E('2026-12-02', 'earnings', '실적 발표 · 장 마감 뒤', { symbol: 'CRM', name: '세일즈포스' }),
  E('2026-12-04', 'earnings', '실적 발표(예정)', { symbol: 'AVGO', name: '브로드컴', isEstimate: true }),
  E('2026-12-09', 'fomc', 'FOMC 회의 결과 발표'),
  E('2026-12-18', 'expiry', '분기 동시 만기', { quarterly: true }),
  E('2026-12-25', 'holiday', '미국 휴장(성탄절)'),
  E('2026-12-25', 'holiday', '국내 휴장(성탄절)', { market: 'KR' }),
  E('2027-01-01', 'holiday', '미국 휴장(새해 첫날)'),
];

export function calendarSample(url: string): CalendarResponse {
  const q = new URL(url, 'http://x').searchParams;
  const from = q.get('from') ?? '2026-11-01';
  const to = q.get('to') ?? '2026-11-30';
  const scope = q.get('scope') === 'universe' ? 'universe' : 'watchlist';
  return {
    from,
    to,
    scope,
    events: EVENTS.filter((e) => e.date >= from && e.date <= to),
    meta: {
      today: TODAY,
      fomcStale: false,
      fomcSource: '연준 일정표(예시)',
      holidays: { US: { from: '2026-01-01', to: '2027-12-31' }, KR: { from: '2026-01-01', to: '2027-12-31' } },
      nyse: { coverage: { from: '2026-01-01', to: '2027-12-31' }, source: 'NYSE(예시)', stale: false, mismatches: [] },
      scopeSize: 7,
    },
  };
}
