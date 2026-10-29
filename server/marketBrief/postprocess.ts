/**
 * 오늘 시황 — AI 응답 뒤처리 (Stockproject `ai_analyzer.py` 의 3단계를 **원본 순서 그대로**: ① → ② → ③).
 *
 * ⓪ (AlphaScope 추가) 실적 항목의 섹터를 입력 데이터로 맞춘다 — 티커가 입력 실적 목록에 있으면 그 종목의 섹터로 바꾼다.
 *    AI 가 섹터 이름을 조금 바꿔 적으면 ① 에서 맞는 실적이 빠진다(원본 주의사항 24). 입력에 없는 티커 · 빈 섹터는 그대로.
 * ① 주도 섹터 거르기 — leading_sectors 이름과 같은 섹터만 남긴다 · 섹터 빈 항목(경제지표 · FOMC) · **국내 종목은 늘 남긴다**.
 * ② 오늘 대비 날수로 슬롯 다시 배치 — 0~7 이번 주 · 8~30 이번 달 · 31~60 다음 한 달 · 날짜를 못 읽으면 이번 달 · 60일 넘으면 버린다.
 * ③ 섹터 상한(이번 주 · 이번 달 3 / 다음 한 달 2) + 슬롯 총 상한(6 / 5 / 5) · 주도 섹터 별점 높은 순 → 날짜 순.
 *    원본은 날짜를 「MM/DD(요일)」 글자로 정렬해 해가 바뀌는 12~1월에 1월이 앞섰다 — 여기서는 ② 와 같은 날수로 정렬한다.
 */

import { isKrSymbol } from '../../src/utils/market';
import type { BriefAi, BriefEarning, BriefScheduleItem } from '../../src/types/marketBrief';

type Slot = keyof BriefAi['upcoming_schedule'];
export const SLOTS: Slot[] = ['this_week', 'this_month', 'next_2_months'];

/** 국내 종목 — AlphaScope 6자리(숫자로 시작) 또는 원본 표기(.KS · .KQ) */
const isDomesticTicker = (ticker: string) => isKrSymbol(ticker) || /\.(KS|KQ)$/i.test(ticker);
const bareTicker = (ticker: string) => ticker.trim().toUpperCase().replace(/\.(KS|KQ)$/, '');

/** 응답을 정해진 모양으로 — 빠진 배열은 빈 배열, 슬롯 dict 가 아니면 빈 슬롯 */
export function normalizeBrief(raw: Partial<BriefAi>): BriefAi {
  const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  const us = (raw.upcoming_schedule ?? {}) as Partial<BriefAi['upcoming_schedule']>;
  const items = (v: unknown) =>
    arr<BriefScheduleItem>(v)
      .filter((i) => i && typeof i === 'object')
      .map((i) => ({
        date: String(i.date ?? ''),
        event: String(i.event ?? ''),
        ticker: String(i.ticker ?? '').trim(),
        sector_kr: String(i.sector_kr ?? '').trim(),
        detail: String(i.detail ?? ''),
        importance: Number(i.importance) || 0,
      }));
  return {
    ...raw,
    portfolio_note: String(raw.portfolio_note ?? ''),
    key_themes: arr(raw.key_themes),
    leading_sectors: arr<BriefAi['leading_sectors'][number]>(raw.leading_sectors).map((s) => ({ ...s, name: String(s?.name ?? '').trim() })),
    swing_check: {
      phase: String(raw.swing_check?.phase ?? ''),
      catalysts: arr<string>(raw.swing_check?.catalysts).filter((c) => typeof c === 'string' && c.trim()),
      risks: arr<string>(raw.swing_check?.risks).filter((c) => typeof c === 'string' && c.trim()),
    },
    upcoming_schedule: { this_week: items(us.this_week), this_month: items(us.this_month), next_2_months: items(us.next_2_months) },
    portfolio_adjustment: {
      passive_note: String(raw.portfolio_adjustment?.passive_note ?? '').trim(),
      swing_candidates: arr<string>(raw.portfolio_adjustment?.swing_candidates).filter((s) => typeof s === 'string' && s.trim()),
    },
  };
}

/** ⓪ 실적 항목 섹터를 입력 데이터로 */
export function alignEarningSectors(brief: BriefAi, earnings: BriefEarning[]): BriefAi {
  const sectorOf = new Map(earnings.map((e) => [e.symbol.toUpperCase(), e.sector]));
  for (const slot of SLOTS) {
    for (const item of brief.upcoming_schedule[slot]) {
      const sector = item.ticker ? sectorOf.get(bareTicker(item.ticker)) : undefined;
      if (sector) item.sector_kr = sector;
    }
  }
  return brief;
}

/** ① 주도 섹터 거르기 (원본 _filter_upcoming_by_leading_sectors) */
export function filterByLeadingSectors(brief: BriefAi): BriefAi {
  const leading = new Set(brief.leading_sectors.map((s) => s.name).filter(Boolean));
  if (!leading.size) return brief; // 주도 섹터가 비면 거르지 않는다(원본과 같음)
  for (const slot of SLOTS) {
    brief.upcoming_schedule[slot] = brief.upcoming_schedule[slot].filter(
      (item) => isDomesticTicker(item.ticker) || !item.sector_kr || leading.has(item.sector_kr),
    );
  }
  return brief;
}

/** 「MM/DD…」 → 오늘(YYYY-MM-DD)부터 며칠 뒤. 오늘보다 앞선 날이면 다음 해로 본다(해 경계). 못 읽으면 null */
export function daysUntilLabel(label: string, today: string): number | null {
  const m = /^(\d{1,2})\/(\d{1,2})/.exec(label.trim());
  if (!m) return null;
  const mm = Number(m[1]);
  const dd = Number(m[2]);
  const year = Number(today.slice(0, 4));
  const at = (y: number) => {
    const d = new Date(Date.UTC(y, mm - 1, dd));
    return d.getUTCMonth() === mm - 1 && d.getUTCDate() === dd ? d.getTime() : null;
  };
  const base = Date.parse(`${today}T00:00:00Z`);
  let t = at(year);
  if (t === null) return null;
  if (t < base) t = at(year + 1);
  if (t === null) return null;
  return Math.round((t - base) / 86_400_000);
}

/** ② 날수로 슬롯 다시 배치 (원본 _reassign_upcoming_slots_by_days) */
export function reassignSlotsByDays(brief: BriefAi, today: string): BriefAi {
  const all = SLOTS.flatMap((s) => brief.upcoming_schedule[s]);
  const next: BriefAi['upcoming_schedule'] = { this_week: [], this_month: [], next_2_months: [] };
  for (const item of all) {
    const days = daysUntilLabel(item.date, today);
    if (days === null) next.this_month.push(item);
    else if (days <= 7) next.this_week.push(item);
    else if (days <= 30) next.this_month.push(item);
    else if (days <= 60) next.next_2_months.push(item);
    // 60일 넘으면 버린다(수집 기간 밖)
  }
  brief.upcoming_schedule = next;
  return brief;
}

/** 슬롯마다 (섹터 상한, 총 상한) — 사용자 정책 3/3/2(한 섹터 몰림 방지), 원본과 같음 */
export const SLOT_CAPS: Record<Slot, { sector: number; total: number }> = {
  this_week: { sector: 3, total: 6 },
  this_month: { sector: 3, total: 5 },
  next_2_months: { sector: 2, total: 5 },
};

/** ③ 섹터 상한 + 주도 섹터 별점 순 (원본 _cap_and_sort_by_sector_priority) */
export function capAndSortBySectorPriority(brief: BriefAi, today: string): BriefAi {
  const stars = new Map(brief.leading_sectors.map((s) => [s.name, (String(s.stars ?? '').match(/★/g) ?? []).length]));
  for (const slot of SLOTS) {
    const cap = SLOT_CAPS[slot];
    const keyed = brief.upcoming_schedule[slot].map((item, i) => ({
      item,
      i,
      priority: stars.get(item.sector_kr) ?? 0,
      days: daysUntilLabel(item.date, today) ?? Number.MAX_SAFE_INTEGER,
    }));
    keyed.sort((a, b) => b.priority - a.priority || a.days - b.days || a.i - b.i);
    const perSector = new Map<string, number>();
    const kept: BriefScheduleItem[] = [];
    for (const { item } of keyed) {
      if (kept.length >= cap.total) break;
      if (!item.sector_kr) {
        kept.push(item); // 경제지표 · FOMC 는 섹터 상한 없음
        continue;
      }
      const n = perSector.get(item.sector_kr) ?? 0;
      if (n < cap.sector) {
        kept.push(item);
        perSector.set(item.sector_kr, n + 1);
      }
    }
    brief.upcoming_schedule[slot] = kept;
  }
  return brief;
}

/** 뒤처리 전부 — ⓪ → ① → ② → ③ */
export function postprocess(raw: Partial<BriefAi>, earnings: BriefEarning[], today: string): BriefAi {
  const brief = alignEarningSectors(normalizeBrief(raw), earnings);
  filterByLeadingSectors(brief);
  reassignSlotsByDays(brief, today);
  capAndSortBySectorPriority(brief, today);
  return brief;
}
