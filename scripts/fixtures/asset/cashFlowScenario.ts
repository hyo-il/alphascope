/**
 * 현금 자동 반영 바이트 비교 시나리오(v2.71.1 · 140차 「꼭 지킬 동작」 6) — 139차 모양으로 저장한 설정(빠지는 계좌를 모두 정한 줄)을 그대로 두고
 * 가짜 시계로 2026-10-20 ~ 2027-01-31 매일 09:00 · 20:00 예약 확인 + 매수 · 매도 예수금 + 되돌리기를 돌려 **쓰기 목록 · 쓴 값 · 기록**을 글자로 만든다.
 * 같은 글자가 기준 커밋(f5d753e = v2.71.0)에서 만든 정답 `cashFlowWritesBaseline.json` 과 같아야 한다(판단 · 쓰기 · 기록 · 되돌리기 그대로).
 * 이 파일은 기준 코드에서도 돈다 — 139차에 있던 함수만 쓴다. 가짜 구글 · 환경 변수는 부르는 쪽이 준비한다.
 */
import { getDb } from '../../../server/db';
import { cashLines, fixedLines } from '../../../server/asset/cashKeys';
import { clearCashMovesForTest, clearCashSettingsForTest, listCashMoves, tradeCash, undoCashMove } from '../../../server/asset/cashMoves';
import { cashTick, setCashCalendarForTest } from '../../../server/asset/cashSchedule';
import { FIXED, flowBook, type FakeGoogle } from './cashFlowBook';
import { cut } from './cashSheetBook';

const C = '현금';
const F = '월 고정지출';

/** 139차 모양 설정(`v` 없음 · 빠지는 계좌 = 열쇠) — 오라클에 저장돼 있을 모양 */
function oldSettings(g: FakeGoogle) {
  const lines = cashLines(cut(g.book.values, `'${C}'!B1:C`));
  const fixed = fixedLines(cut(g.book.values, `'${F}'!A1:Z`));
  const key = (name: string, nth = 1) => ({ name, nth, of: lines.filter((l) => l.key.name === name).length });
  const item = (reason: string, nth = 1) => {
    const l = fixed.find((x) => x.key.reason === reason && x.key.nth === nth)!;
    return { ...l.key, of: fixed.filter((x) => x.key.category === l.key.category && x.key.reason === reason).length };
  };
  const KB = (n: number) => key('가짜국민 (가짜 예금)', n);
  const KIWOOM = key('가짜키움 (가짜 예수금)');
  const SHINHAN = key('가짜신한');
  const INV = FIXED[0][1];
  return {
    enabled: true,
    enabledDay: '2026-10-20',
    depositPairs: { '개별 투자': KIWOOM },
    salary: { to: KB(1), day: 25, shift: 'prev' },
    flowShift: 'next',
    flows: [
      { item: item('가짜 월세'), day: 31, from: KB(1), to: 'out' },
      { item: item('가짜 통신비'), day: 5, from: SHINHAN, to: 'out' },
      { item: item('가짜 보험'), day: 12, from: SHINHAN, to: 'out' },
      { item: item(INV, 1), day: 26, from: KB(2), to: KIWOOM },
      { item: item(INV, 2), day: 10, from: KB(1), to: KIWOOM },
      { item: item('가짜 ISA'), day: 10, from: KB(1), to: KIWOOM },
    ],
  };
}

/** 시나리오 실행 → 비교할 글자(JSON) */
export async function runCashScenario(g: FakeGoogle): Promise<string> {
  g.book = flowBook();
  g.writes = [];
  clearCashMovesForTest();
  clearCashSettingsForTest();
  getDb().prepare(`INSERT INTO app_settings (key, value) VALUES ('asset.cash', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(JSON.stringify(oldSettings(g)));
  const krHolidays = new Set(['2026-12-25', '2026-12-31']);
  setCashCalendarForTest((d) => krHolidays.has(d));
  const steps: unknown[] = [];
  const cash = () => Object.entries(g.book.values).filter(([k]) => k.startsWith(`${C}!C`)).sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join(',');
  const DAY = 86_400_000;
  for (let t = Date.parse('2026-10-20T00:00:00+09:00'); t <= Date.parse('2027-01-31T00:00:00+09:00'); t += DAY) {
    const day = new Date(t + 9 * 3_600_000).toISOString().slice(0, 10);
    for (const hm of ['07:30', '09:00', '20:00']) {
      const r = await cashTick(Date.parse(`${day}T${hm}:00+09:00`));
      if (r.applied || r.skipped) steps.push({ day, hm, r, writes: g.writes.length });
    }
    if (day === '2026-11-03') g.book.values[`${F}!E18`] = 66_000; // 통신비를 시트에서 고침
    if (day === '2026-11-16') steps.push({ day, buy: await tradeCash('buy', '개별 투자', 9001, '가짜종목', 1_234_000, day) });
    if (day === '2026-11-17') steps.push({ day, sell: await tradeCash('sell', '개별 투자', 9002, '가짜종목', 500_000, day) });
    if (day === '2026-12-01') {
      const last = listCashMoves().find((m) => m.status === 'applied');
      if (last) steps.push({ day, undo: (await undoCashMove(last.id)).status });
    }
  }
  setCashCalendarForTest(null);
  const moves = listCashMoves().map(({ at: _at, undoneAt, ...m }) => ({ ...m, undone: undoneAt != null }));
  return JSON.stringify({ writes: g.writes, cash: cash(), steps, moves }, null, 1);
}
