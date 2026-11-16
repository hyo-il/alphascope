/**
 * 다음 한 달 미리 보기(v2.71.1 · `GET /api/asset/cash/preview` · 설정 화면 응답 `preview`) — **읽기만**(시트 쓰기 0 · 기록 0).
 *
 * - 날짜 · 영업일 · 그 달 항목은 실제 예약과 **같은 함수**(`cashSchedule.ts` `plannedOf` → `dueDay`)로 계산하고, 금액은 예약이 반영할 때 읽는 것과 같은 값
 *   (월급 = 「현재 월 급여」 · 고정 흐름 = 같은 열쇠로 찾은 「비용」)이다 — 미리 보기와 실제가 어긋나지 않게 따로 계산하지 않는다.
 * - 보는 범위 = 오늘 ~ 다음 달 같은 날 하루 앞. 예약처럼 지난달 · 이번 달 · 다음 달 항목을 본다.
 *   켜져 있으면: 켠 날보다 앞선 날짜는 빼고(예약도 하지 않음), 오늘 앞이지만 아직 기록이 없는 이번 달 것은 「반영 예정」(다음 확인에 반영).
 *   꺼져 있으면: 「켜면 이렇게」 — 켜는 날이 오늘이므로 오늘부터만.
 * - 반영하지 않는 줄도 보인다(날짜 없음 · 계좌 없음 · ₩0 · 변동 지출 · 다시 확인 필요) — 날짜 없이 맨 아래.
 * ⚠️ 로그를 남기지 않는다(금액 · 계좌 이름).
 */
import {
  ASSET_CASH_FROM_SALARY,
  cashBankLabelOf,
  type AssetCashBankFix,
  type AssetCashKey,
  type AssetCashPreview,
  type AssetCashPreviewItem,
  type AssetCashSettings,
} from '../../src/types/asset';
import { findCashLine, findFixedLine, fixedLabel, sameCashKey, type CashLine, type FixedLine } from './cashKeys';
import { monthMoveStatus, readCashStored, resolveCashSettings } from './cashMoves';
import { addMonth, kstDay, plannedOf, type ClosedFn } from './cashSchedule';

const DAY_MS = 86_400_000;

/** 오늘 → 다음 달 같은 날 하루 앞(그 달에 없는 날은 말일) */
export function previewUntil(today: string): string {
  const [y, m] = addMonth(today.slice(0, 7), 1).split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const t = Date.UTC(y, m - 1, Math.min(Number(today.slice(8, 10)), last)) - DAY_MS;
  return new Date(t).toISOString().slice(0, 10);
}

export interface PreviewSheet {
  lines: CashLine[];
  fixed: FixedLine[] | null;
  salary: number | null;
}

/** 미리 보기 — 순수 계산(DB 는 그 달 기록 상태 · 설정 읽기만) · 시험이 가짜 시계 · 가짜 달력을 넣는다 */
export function cashPreview(sheet: PreviewSheet, fix: AssetCashBankFix, now: number, closed: ClosedFn): AssetCashPreview {
  const stored = readCashStored();
  const s: AssetCashSettings = resolveCashSettings(stored);
  const today = kstDay(now);
  const until = previewUntil(today);
  const start = s.enabled ? (s.enabledDay ?? today) : today;
  const thisMonth = today.slice(0, 7);
  const names = sheet.lines.map((l) => l.key.name);
  const nameOf = (k: AssetCashKey | null) => (k ? (cashBankLabelOf(k, names, fix) ?? (k.nth > 1 ? `${k.name} #${k.nth}` : k.name)) : null);
  const rowOk = (k: AssetCashKey | null) => k == null || findCashLine(sheet.lines, k) != null;

  const dated: AssetCashPreviewItem[] = [];
  for (const month of [addMonth(thisMonth, -1), thisMonth, addMonth(thisMonth, 1)]) {
    for (const p of plannedOf(s, month, closed)) {
      if (p.day < start || p.day > until) {
        // 오늘 앞 · 켠 날 뒤 · 아직 기록 없는 이번 달 것(예약이 다음 확인에 반영)만 남긴다
        const lastMonth = p.day.slice(0, 7) > p.month ? p.day.slice(0, 7) : p.month;
        if (!(s.enabled && p.day >= start && p.day < today && lastMonth >= thisMonth)) continue;
      }
      const record = monthMoveStatus(p.kind, p.itemKey, p.month);
      if (p.day < today && record != null) continue;
      const line = p.item && sheet.fixed ? findFixedLine(sheet.fixed, p.item) : null;
      // 「월 고정지출」 에서 사라진 줄은 아래 「다시 확인 필요」 한 칸으로(예약은 그 달 「건너뜀」)
      if (p.kind === 'fixed' && sheet.fixed && !line) continue;
      const base: AssetCashPreviewItem = {
        day: p.day,
        kind: p.kind,
        label: p.kind === 'salary' ? '월급' : line && sheet.fixed ? fixedLabel(line.key, sheet.fixed) : p.item!.reason,
        category: p.item?.category ?? null,
        from: nameOf(p.from),
        to: nameOf(p.to),
        out: p.kind === 'fixed' && p.to == null,
        amount: p.kind === 'salary' ? sheet.salary : (line?.amount ?? null),
        status: 'planned',
        record: null,
        why: null,
      };
      if (record != null) dated.push({ ...base, status: 'recorded', record });
      else if (p.kind === 'fixed' && line && !line.reflect) dated.push({ ...base, status: 'not', why: 'missing-item' }); // 예약과 같은 까닭(반영하는 분류에서 빠짐)
      else if (!rowOk(p.from) || !rowOk(p.to)) dated.push({ ...base, status: 'not', why: 'missing-row' });
      else if (p.kind === 'salary' && !(sheet.salary != null && sheet.salary > 0)) dated.push({ ...base, status: 'not', why: 'no-salary' });
      else if (p.kind === 'fixed' && line && !(line.amount != null && line.amount > 0)) dated.push({ ...base, status: 'not', why: 'zero' });
      else dated.push(base);
    }
  }
  dated.sort((a, b) => (a.day! < b.day! ? -1 : a.day! > b.day! ? 1 : 0));

  // 반영하지 않는 줄(날짜 없이) — 월급 · 시트 순서의 고정 흐름 · 변동 지출은 맨 아래
  const undated: AssetCashPreviewItem[] = [];
  const variable: AssetCashPreviewItem[] = [];
  if (!s.salary.to) undated.push({ day: null, kind: 'salary', label: '월급', category: null, from: null, to: null, out: false, amount: sheet.salary, status: 'not', record: null, why: 'no-to' });
  for (const line of sheet.fixed ?? []) {
    const st = stored.flows.find((f) => findFixedLine(sheet.fixed!, f.item)?.row === line.row) ?? null;
    const label = fixedLabel(line.key, sheet.fixed!);
    const item: AssetCashPreviewItem = { day: null, kind: 'fixed', label, category: line.key.category, from: null, to: null, out: false, amount: line.amount, status: 'not', record: null, why: null };
    if (!line.reflect) {
      variable.push({ ...item, why: 'variable' });
      continue;
    }
    const zero = !(line.amount != null && line.amount > 0);
    if (!st || st.day == null) {
      undated.push({ ...item, why: zero ? 'zero' : 'no-day' });
      continue;
    }
    if (st.to == null) undated.push({ ...item, why: 'no-to' });
    else if (st.from == null) undated.push({ ...item, why: 'no-from' });
    else if (st.from === ASSET_CASH_FROM_SALARY && !s.salary.to) undated.push({ ...item, why: 'no-from' });
    else if (st.from === ASSET_CASH_FROM_SALARY && st.to !== 'out' && sameCashKey(s.salary.to, st.to)) undated.push({ ...item, why: 'same-row' });
  }
  // 「월 고정지출」 에서 사라진 설정 줄 — 다시 확인 필요
  if (sheet.fixed) {
    for (const f of stored.flows) {
      if (findFixedLine(sheet.fixed, f.item)) continue;
      undated.push({ day: null, kind: 'fixed', label: f.item.nth > 1 ? `${f.item.reason} #${f.item.nth}` : f.item.reason, category: f.item.category, from: null, to: null, out: false, amount: null, status: 'not', record: null, why: 'missing-item' });
    }
  }
  return { from: today, until, enabled: s.enabled, items: [...dated, ...undated, ...variable] };
}
