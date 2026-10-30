/**
 * 오늘 시황 — 「오늘 예상 방향」 채점(v2.60.0, 사용자 결정 2026-10-30). 다음 실제 결과와 견준다.
 *
 * - **어느 예상을**: 대상 · 거래일마다 **그 거래일 정규장 시작 전에 만든 마지막 브리핑**의 그 대상 예상 하나.
 *   - 코스피: 만든 한국 날짜가 그 거래일 · 그날 09:00 KST(토스 달력 → 고정표) 전에 만든 것.
 *   - S&P500: 만든 뒤 처음 열리는 미국 정규장(서머타임 · 휴장 — `heatmapSession.regularSessionStart`)의 날 — 36시간 안에 열리는 것만.
 *   - 장 시작 뒤(그 정규장 중)에 만든 예상 · 휴장인 날은 채점하지 않는다.
 * - **실제 결과**: 그 거래일 정규장 종가 ÷ 전일 정규장 종가 − 1(지표 엔진 일봉 — 시장 데이터와 같은 받기 · 같은 티커). 소수 2자리.
 *   |등락| < `FLAT_PCT`(0.3%) 면 보합 — 예상 · 문장 검사와 같은 상수.
 * - **언제**: 10분 확인 틱마다 — 그 정규장 끝 + `SETTLE_MARGIN_MS` 뒤(일봉이 확정된 뒤)에 아직 채점 안 된 것. 놓친 날은 다음 틱에 보충(브리핑 30일 안).
 * - **저장**: `market_brief_scores` — 대상 · 거래일 한 줄(다시 채점하면 덮음) · 1년 보관(브리핑은 30일이지만 「최근 20번」 을 늘 셀 수 있게).
 * ⚠️ 맞힌 비율은 참고 통계다 — 매수 판단 · 자동매매 · 주문에 쓰지 않는다(그 모듈을 import 하지 않는다).
 */

import { getDb } from '../db';
import { regularSessionEnd, regularSessionStart } from '../heatmapSession';
import { marketDate } from '../../src/utils/marketDate';
import { kstDay } from '../../src/utils/marketBrief';
import { BRIEF_KEEP_DAYS, OUTLOOK_CONFIDENCES, type BriefOutlook, type OutlookItemScore, type OutlookStats, type OutlookTarget, type OutlookView } from '../../src/types/marketBrief';
import { directionOfPct } from './outlook';
import { getScore, listOutlookBriefs, purgeOldScores, recentScores, upsertScore } from './store';

/** 채점 줄 보관(일) — 1년. 브리핑(30일)보다 길게 — 「최근 20번」 을 늘 셀 수 있게 */
export const SCORE_KEEP_DAYS = 365;
/** 「최근 N번 중 M번 맞음」 의 N */
export const SCORE_RECENT = 20;
/** 정규장 끝 뒤 이만큼 지나야 그날 일봉을 확정으로 보고 채점한다(지표 엔진 일봉이 마감 값으로 바뀌는 여유) */
export const SETTLE_MARGIN_MS = 60 * 60_000;
/** S&P500 예상은 만든 뒤 이 시간 안에 열리는 미국 정규장만 — 주말 · 연휴 너머의 정규장을 그 예상으로 채점하지 않는다 */
export const US_LEAD_MAX_MS = 36 * 3_600_000;

const ENGINE_URL = process.env.INDICATORS_URL ?? `http://127.0.0.1:${process.env.INDICATORS_PORT ?? 5001}`;

type Market = 'KR' | 'US';
const MARKET_OF: Record<OutlookTarget, Market> = { KOSPI: 'KR', SP500: 'US' };
const REF_SYMBOL: Record<Market, string> = { KR: '005930', US: 'SPY' };

export type DailyCloses = Partial<Record<OutlookTarget, { date: string; close: number }[]>>;

export interface ScoreDeps {
  /** 정규장 시작 · 끝(휴장이면 null) — 기본은 `heatmapSession` 의 시간표를 읽기만 */
  start: (market: Market, day: string) => Promise<number | null>;
  end: (market: Market, day: string) => Promise<number | null>;
  /** 지표 엔진 일봉 — 기본 `/market-brief-closes` */
  closes: (targets: OutlookTarget[]) => Promise<DailyCloses>;
}

export const defaultScoreDeps: ScoreDeps = {
  start: (market, day) => regularSessionStart(market, day),
  end: (market, day) => regularSessionEnd(market, day),
  closes: async (targets) => {
    const response = await fetch(`${ENGINE_URL}/market-brief-closes?keys=${targets.join(',')}`, { signal: AbortSignal.timeout(60_000) });
    const payload = (await response.json().catch(() => ({}))) as { closes?: DailyCloses; error?: string };
    if (!response.ok || !payload.closes) throw new Error(payload.error ?? `지표 엔진 응답 ${response.status}`);
    return payload.closes;
  },
};

const shiftDay = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export type TargetDay = { day: string; start: number; end: number } | { skip: 'after-open' | 'holiday' };

/** 그 예상이 맞힐 거래일 — 장 시작 전에 만든 것만 */
export async function targetDayOf(target: OutlookTarget, createdAt: number, deps: Pick<ScoreDeps, 'start' | 'end'>): Promise<TargetDay> {
  const market = MARKET_OF[target];
  if (market === 'KR') {
    const day = kstDay(createdAt);
    const start = await deps.start('KR', day);
    const end = await deps.end('KR', day);
    if (start == null || end == null) return { skip: 'holiday' };
    if (createdAt >= start) return { skip: 'after-open' };
    return { day, start, end };
  }
  // 미국 — 만든 시각의 미국 날짜부터 차례로. 그 날 정규장 중에 만들었으면 채점 안 함 · 이미 끝났으면 다음 날
  const first = marketDate(createdAt, REF_SYMBOL.US);
  for (let k = 0; k < 7; k++) {
    const day = shiftDay(first, k);
    const start = await deps.start('US', day);
    const end = await deps.end('US', day);
    if (start == null || end == null) continue;
    if (createdAt >= start && createdAt < end) return { skip: 'after-open' };
    if (createdAt >= end) continue;
    if (start - createdAt > US_LEAD_MAX_MS) return { skip: 'holiday' };
    return { day, start, end };
  }
  return { skip: 'holiday' };
}

interface Candidate {
  briefId: number;
  createdAt: number;
  outlook: BriefOutlook;
  day: string;
  end: number;
}

/** 대상 · 거래일마다 채점할 예상 — 장 시작 전에 만든 것 가운데 가장 나중 것(키 `${target}|${day}`) */
export async function chooseCandidates(briefs: { id: number; createdAt: string; outlook: BriefOutlook[] }[], deps: Pick<ScoreDeps, 'start' | 'end'>): Promise<Map<string, Candidate>> {
  const chosen = new Map<string, Candidate>();
  for (const b of briefs) {
    const createdAt = Date.parse(b.createdAt);
    for (const o of b.outlook) {
      const t = await targetDayOf(o.target, createdAt, deps);
      if ('skip' in t) continue;
      const key = `${o.target}|${t.day}`;
      const prev = chosen.get(key);
      if (!prev || createdAt > prev.createdAt || (createdAt === prev.createdAt && b.id > prev.briefId)) {
        chosen.set(key, { briefId: b.id, createdAt, outlook: o, day: t.day, end: t.end });
      }
    }
  }
  return chosen;
}

/**
 * 그 거래일 실제 등락률(%) — 그 날 봉 ÷ 전 거래일 봉 − 1. **앞 봉 날짜가 전 거래일(prevDay)과 같을 때만**(일봉 하루가 빠지면
 * 이틀치가 하루로 채점되지 않게 — 「끝에서 두 번째 봉」 으로 잡지 않는다). 그 날 봉 · 전 거래일 봉이 없으면 null(다음 틱에 다시)
 */
export function actualPctOf(rows: { date: string; close: number }[] | undefined, day: string, prevDay: string | null): number | null {
  if (!rows?.length || !prevDay) return null;
  const today = rows.find((r) => r.date === day);
  const prev = rows.find((r) => r.date === prevDay);
  if (!today || !prev || !(prev.close > 0)) return null;
  return Math.round((today.close / prev.close - 1) * 10_000) / 100;
}

/** 그 시장에서 day 바로 앞 거래일 — 정규장 시각표(휴장 · 주말 null)로 거꾸로 찾는다(10일 안) */
export async function previousTradeDay(market: Market, day: string, deps: Pick<ScoreDeps, 'start'>): Promise<string | null> {
  for (let k = 1; k <= 10; k++) {
    const d = shiftDay(day, -k);
    if ((await deps.start(market, d)) != null) return d;
  }
  return null;
}

/**
 * 10분 확인마다 — 마감 + 여유가 지났는데 채점 안 된(또는 다른 브리핑으로 채점된) 예상을 채점한다. 채점한 줄 수.
 * 일봉은 채점할 것이 있을 때만 한 번 받는다. 받지 못한 대상은 다음 틱에 다시.
 */
export async function scoreOutlooks(now: number, deps: ScoreDeps = defaultScoreDeps): Promise<number> {
  const since = shiftDay(kstDay(now), -(BRIEF_KEEP_DAYS - 1));
  const chosen = await chooseCandidates(listOutlookBriefs(since), deps);
  const due = [...chosen.values()].filter((c) => now >= c.end + SETTLE_MARGIN_MS && getScore(c.outlook.target, c.day)?.briefId !== c.briefId);
  if (!due.length) return 0;
  const closes = await deps.closes([...new Set(due.map((c) => c.outlook.target))]);
  let n = 0;
  for (const c of due) {
    const pct = actualPctOf(closes[c.outlook.target], c.day, await previousTradeDay(MARKET_OF[c.outlook.target], c.day, deps));
    if (pct == null) continue;
    const actualDirection = directionOfPct(pct);
    upsertScore({
      target: c.outlook.target,
      tradeDay: c.day,
      briefId: c.briefId,
      direction: c.outlook.direction,
      confidence: c.outlook.confidence,
      actualPct: pct,
      actualDirection,
      hit: actualDirection === c.outlook.direction,
      scoredAt: new Date(now).toISOString(),
    });
    n++;
  }
  return n;
}

/** 하루 한 번 — 1년 넘은 채점 줄 지우기 */
export function purgeScores(now: number): number {
  return purgeOldScores(kstDay(now), SCORE_KEEP_DAYS);
}

/** 대상별 최근 N번 · 확신별 나눔 */
export function outlookStats(target: OutlookTarget, n = SCORE_RECENT): OutlookStats {
  const rows = recentScores(target, n);
  const byConfidence = Object.fromEntries(OUTLOOK_CONFIDENCES.map((c) => [c, { total: 0, hits: 0 }])) as OutlookStats['byConfidence'];
  for (const r of rows) {
    byConfidence[r.confidence].total++;
    if (r.hit) byConfidence[r.confidence].hits++;
  }
  return { total: rows.length, hits: rows.filter((r) => r.hit).length, byConfidence };
}

/**
 * 화면용 — 고른 브리핑의 예상마다 채점 상태 + 대상별 최근 성적. 같은 거래일에 더 나중 예상이 있으면 superseded.
 * 표가 아직 없으면(처음 켠 서버) 빈 상태로.
 */
export async function outlookView(brief: { id: number; createdAt: string; outlook: BriefOutlook[] }, now: number, deps: Pick<ScoreDeps, 'start' | 'end'> = defaultScoreDeps): Promise<OutlookView> {
  const since = shiftDay(kstDay(now), -(BRIEF_KEEP_DAYS - 1));
  const chosen = await chooseCandidates(listOutlookBriefs(since), deps);
  const items: OutlookItemScore[] = [];
  for (const o of brief.outlook) {
    const t = await targetDayOf(o.target, Date.parse(brief.createdAt), deps);
    if ('skip' in t) {
      items.push({ target: o.target, status: t.skip, tradeDay: null, closeAt: null });
      continue;
    }
    const base = { target: o.target, tradeDay: t.day, closeAt: new Date(t.end).toISOString() };
    const score = getScore(o.target, t.day);
    const pick = chosen.get(`${o.target}|${t.day}`);
    if (score && score.briefId === brief.id) {
      items.push({ ...base, status: 'scored', hit: score.hit, actualPct: score.actualPct, actualDirection: score.actualDirection });
    } else if ((pick && pick.briefId !== brief.id) || (score && score.briefId !== brief.id)) {
      items.push({ ...base, status: 'superseded' });
    } else {
      items.push({ ...base, status: now >= t.end + SETTLE_MARGIN_MS ? 'waiting-data' : 'pending' });
    }
  }
  const stats: OutlookView['stats'] = {};
  for (const target of new Set(brief.outlook.map((o) => o.target))) stats[target] = outlookStats(target);
  return { items, stats, recent: SCORE_RECENT };
}

/** 시험용 — 채점 표 비우기 */
export function clearScoresForTest(): void {
  getDb().prepare(`DELETE FROM market_brief_scores`).run();
}
