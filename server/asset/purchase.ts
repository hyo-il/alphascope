/**
 * 이번 달 구매 · 구매일 · 구매 완료(v2.64.0 · 자산 관리 5단계) — **보여 주기만, 주문 없음**.
 *
 * - 구매일(`purchaseDayOf` — 순수 함수): 26일이 월~금이면 그 주 금요일 · 토 · 일이면 바로 앞 금요일(24 · 25일).
 *   그날이 휴장(`isClosed` — 주말 · 한국 휴장일)이면 하루씩 앞으로. 휴장 판단은 `server/marketCalendar.ts` `isMarketClosed('KR', day)` 그대로
 *   (새 달력 없음) — 확인한 범위(`coverageOf('KR')`) 밖 날짜는 주말만 휴장으로 보므로 「휴장일 확인 못 함」 을 함께 돌려준다.
 * - 구매 차례(`purchaseCycle`): 오늘(한국 날짜) 기준 가장 최근에 지난(오늘 포함) 구매일 · 다음 구매일.
 * - 살 금액(`computeMonthlyBuy` — 순수 함수): 월급 × 목표 %(현금 · 채권 · 금 · 주식) · 주식 = 코어 + 위성. 원 단위 반올림 ·
 *   목표 합이 100 이면 반올림 차이를 주식(코어)에 더해 합 = 월급 · 코어 + 위성 합이 100 이면 코어 = 주식 − 위성.
 * - 구매 완료: `routes.ts` `POST /api/asset/purchase-done` → `sheet.ts` `writeAccountDates`(시트 계좌 이름 날짜) 성공 뒤에만 `store.ts` `asset_purchase` 에 기록.
 * ⚠️ 월급 · 금액을 로그에 찍지 않는다.
 */
import { marketDate } from '../../src/utils/marketDate';
import { coverageOf, isMarketClosed } from '../marketCalendar';
import type { AssetTargetRatio, MonthlyBuy, MonthlyBuyRow } from '../../src/types/asset';
import { purchaseDoneDay } from './store';

const DAY_MS = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

/** 휴장 판단 — 그날 장이 닫혔나 · 그날을 달력으로 확인할 수 있나(범위 밖이면 주말만 본 값) */
export interface PurchaseCalendar {
  isClosed: (day: string) => boolean;
  isChecked: (day: string) => boolean;
}

/**
 * 그 달 구매일(YYYY-MM-DD) — `month` 는 1~12. 26일이 든 주(월~일)의 금요일, 26일이 토 · 일이면 바로 앞 금요일,
 * 그날이 `isClosed` 이면 하루씩 앞으로(주말 · 휴장 건너뜀). 2월 26일이 월요일이면 그 주 금요일은 3월 초다(글자 그대로).
 */
export function purchaseDayOf(year: number, month: number, isClosed: (day: string) => boolean): string {
  const d26 = Date.UTC(year, month - 1, 26);
  const dow = new Date(d26).getUTCDay(); // 0 일 · 6 토
  const offset = dow === 6 ? -1 : dow === 0 ? -2 : 5 - dow;
  let t = d26 + offset * DAY_MS;
  const weekend = (x: number) => [0, 6].includes(new Date(x).getUTCDay());
  for (let i = 0; i < 31 && (weekend(t) || isClosed(iso(t))); i++) t -= DAY_MS;
  return iso(t);
}

/** 구매일과, 그날을 고를 때 본 날(금요일 후보 → 고른 날) 중 달력 범위 밖이 있었는지 */
function dayWithCheck(year: number, month: number, cal: PurchaseCalendar): { day: string; unchecked: boolean } {
  const seen: string[] = [];
  const day = purchaseDayOf(year, month, (d) => {
    seen.push(d);
    return cal.isClosed(d);
  });
  return { day, unchecked: seen.some((d) => !cal.isChecked(d)) };
}

const monthOf = (day: string) => ({ y: Number(day.slice(0, 4)), m: Number(day.slice(5, 7)) });
const addMonth = (y: number, m: number, n: number) => {
  const k = y * 12 + (m - 1) + n;
  return { y: Math.floor(k / 12), m: (k % 12) + 1 };
};

/**
 * 구매 차례 — 오늘(YYYY-MM-DD) 기준 가장 최근에 지난(오늘 포함) 구매일 · 다음(오늘보다 뒤) 구매일.
 * 이번 달 구매일이 아직 안 왔으면 지난달 구매일이 이번 차례다.
 */
export function purchaseCycle(today: string, cal: PurchaseCalendar): { cycleDay: string; nextDay: string; calendarUnchecked: boolean } {
  const { y, m } = monthOf(today);
  let unchecked = false;
  let cycle: string | null = null;
  let cycleAt = { y, m };
  for (let n = 0; n >= -3 && cycle == null; n--) {
    const at = addMonth(y, m, n);
    const r = dayWithCheck(at.y, at.m, cal);
    if (r.day <= today) {
      cycle = r.day;
      cycleAt = at;
      unchecked ||= r.unchecked;
    }
  }
  let next: string | null = null;
  for (let n = 1; n <= 3 && next == null; n++) {
    const at = addMonth(cycleAt.y, cycleAt.m, n);
    const r = dayWithCheck(at.y, at.m, cal);
    if (r.day > today) {
      next = r.day;
      unchecked ||= r.unchecked;
    }
  }
  return { cycleDay: cycle ?? today, nextDay: next ?? today, calendarUnchecked: unchecked };
}

/** 한국 휴장 달력(앱 DB) — `isMarketClosed('KR', day)` · 확인한 범위 `coverageOf('KR')` */
export function krPurchaseCalendar(): PurchaseCalendar {
  const cov = coverageOf('KR');
  return {
    isClosed: (day) => isMarketClosed('KR', day),
    isChecked: (day) => cov != null && day >= cov.from && day <= cov.to,
  };
}

/** 오늘 한국 날짜 */
export const todayKst = (now = Date.now()) => marketDate(now, '005930');

const sumOf = (vs: (number | null)[]) => {
  const known = vs.filter((v): v is number => v != null);
  return known.length > 0 ? Math.round(known.reduce((a, b) => a + b, 0) * 10_000) / 10_000 : null;
};
const is100 = (v: number | null) => v != null && Math.abs(v - 100) < 1e-6;

/**
 * 살 금액 — 월급 × 목표 %. 순수 함수(시험이 가짜 값으로 부른다).
 * - 월급이 없거나(빈칸 · 글자) 0 이하면 금액 모두 null · `noSalary`.
 * - 목표가 빈 칸은 그 줄 null(「-」). 주식이 null 이면 코어 · 위성도 null.
 * - 네 목표 합이 100 이면 주식 = 월급 − 현금 − 채권 − 금(반올림 차이는 주식에 — 합 = 월급).
 * - 코어 + 위성 합이 100 이면 코어 = 주식 − 위성(반올림 차이는 코어에 — 코어 + 위성 = 주식).
 */
export function computeMonthlyBuy(salary: number | null, target: AssetTargetRatio): Pick<MonthlyBuy, 'rows' | 'total' | 'noSalary' | 'assetTargetSum' | 'stockTargetSum' | 'targetMissing'> {
  const noSalary = salary == null || !Number.isFinite(salary) || salary <= 0;
  const pay = noSalary ? null : (salary as number);
  const part = (base: number | null, pct: number | null) => (base == null || pct == null ? null : Math.round((base * pct) / 100));
  const assetPcts = [target.cash, target.bond, target.gold, target.invest];
  const assetTargetSum = sumOf(assetPcts);
  const stockTargetSum = sumOf([target.core, target.satellite]);
  const assetsExact = assetPcts.every((v) => v != null) && is100(assetTargetSum);
  const stocksExact = target.core != null && target.satellite != null && is100(stockTargetSum);

  const cash = part(pay, target.cash);
  const bond = part(pay, target.bond);
  const gold = part(pay, target.gold);
  const stock = assetsExact && pay != null ? pay - (cash as number) - (bond as number) - (gold as number) : part(pay, target.invest);
  const satellite = part(stock, target.satellite);
  const core = stocksExact && stock != null ? stock - (satellite as number) : part(stock, target.core);

  const rows: MonthlyBuyRow[] = [
    { key: 'cash', label: '현금', targetPct: target.cash, amount: cash },
    { key: 'bond', label: '채권', targetPct: target.bond, amount: bond },
    { key: 'gold', label: '금', targetPct: target.gold, amount: gold },
    { key: 'stock', label: '주식', targetPct: target.invest, amount: stock },
    { key: 'core', label: '코어', targetPct: target.core, amount: core },
    { key: 'satellite', label: '위성', targetPct: target.satellite, amount: satellite },
  ];
  const top = [cash, bond, gold, stock];
  return {
    rows,
    total: pay == null ? null : top.reduce<number>((a, b) => a + (b ?? 0), 0),
    noSalary,
    assetTargetSum,
    stockTargetSum,
    targetMissing: [...assetPcts, target.core, target.satellite].some((v) => v == null),
  };
}

let clock: () => number = () => Date.now();
let calendarOf: () => PurchaseCalendar = krPurchaseCalendar;

/** 시험이 오늘 · 달력을 바꿔 끼운다(null = 실제) */
export function setPurchaseClockForTest(now: (() => number) | null, cal: (() => PurchaseCalendar) | null = null): void {
  clock = now ?? (() => Date.now());
  calendarOf = cal ?? krPurchaseCalendar;
}

/** 지금 구매 차례(오늘 · 이번 차례 · 다음 구매일 · 완료 여부) */
export function currentCycle(): Pick<MonthlyBuy, 'today' | 'cycleDay' | 'nextDay' | 'done' | 'doneDay' | 'calendarUnchecked'> {
  const today = todayKst(clock());
  const c = purchaseCycle(today, calendarOf());
  const doneDay = purchaseDoneDay(c.cycleDay);
  return { today, ...c, done: doneDay != null, doneDay };
}

/** `GET /api/asset/summary` 의 `monthlyBuy` */
export function monthlyBuyOf(salary: number | null, target: AssetTargetRatio): MonthlyBuy {
  return { ...computeMonthlyBuy(salary, target), ...currentCycle() };
}
