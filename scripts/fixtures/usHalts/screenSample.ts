/**
 * 실시간 거래정지 화면 점검용 가짜 응답 — `design:check` 의 `ushalts-*` 대상이 `page.route` 로 바꿔치기한다(DB · Nasdaq · 토스를 건드리지 않는다).
 * 한 줄 배치를 재려고 긴 것을 일부러 넣는다: 긴 종목명 · 긴 사유(LUDS · T12 · T3) · 공지 재개 · 조건이 맞으면 재개 · 모르는 코드 · 관심/보유 배지 · 「상태 모름」.
 */
import type { UsHaltRow, UsHaltsResponse, UsOngoingHaltRow } from '../../../src/types/usHalts';
import type { LiveRankingKind, LiveRankingResponse } from '../../../src/types/ranking';

const MIN = 60_000;

function row(id: number, now: number, p: Partial<UsHaltRow> & { sym: string; code: string; agoMin: number }): UsHaltRow {
  return {
    id,
    rawIssueSymbol: p.sym,
    rawIssueName: p.rawIssueName ?? `${p.sym} Inc. Common Stock`,
    rawMarket: p.rawMarket ?? 'NASDAQ',
    rawReasonCode: p.code,
    rawHaltDate: '10/23/2026',
    rawHaltTime: '10:00:00',
    rawResumptionDate: '',
    rawResumptionQuoteTime: '',
    rawResumptionTradeTime: '',
    haltAtMs: now - p.agoMin * MIN,
    resumeAtMs: p.resumeAtMs ?? null,
    firstSeenAt: new Date(now - p.agoMin * MIN).toISOString(),
    resumeSeenAt: null,
    directionEst: p.directionEst ?? 'none',
    directionReason: p.directionReason ?? null,
    turnover5mUsd: p.turnover5mUsd === undefined ? 12_300 : p.turnover5mUsd,
    turnoverPending: p.turnoverPending ?? false,
    inToss: p.inToss ?? true,
    catalogName: p.catalogName ?? null,
    held: p.held ?? false,
  };
}

/** regularOpen = false 면 「정규장에만 보입니다」 상태(다음 정규장은 now + 20시간 · 6시간 30분) */
export function usHaltsSample(now: number, regularOpen = true): UsHaltsResponse {
  const halts: UsHaltRow[] = [
    row(1, now, { sym: 'LGNM', code: 'T12', agoMin: 40, rawIssueName: 'Very Long Company Name Holdings International Incorporated Class A Common Stock', inToss: false, held: true, turnover5mUsd: 1_234_567 }),
    row(2, now, { sym: 'LUDA', code: 'LUDS', agoMin: 2, directionEst: 'up', turnover5mUsd: 845_000 }),
    row(3, now, { sym: 'LUDB', code: 'LUDP', agoMin: 7, directionEst: 'down', turnover5mUsd: 0, rawMarket: 'NYSE American' }),
    row(4, now, { sym: 'OPNC', code: 'M', agoMin: 15, directionEst: 'unknown', directionReason: 'not_in_toss', turnover5mUsd: null, turnoverPending: true }),
    row(5, now, { sym: 'NWSD', code: 'T3', agoMin: 30, resumeAtMs: now + 30 * MIN, turnover5mUsd: 45_600 }),
    row(6, now, { sym: 'UNKE', code: 'XYZ9', agoMin: 25, turnover5mUsd: null }),
    row(7, now, { sym: 'TSLA', code: 'T1', agoMin: 12, catalogName: '테슬라', held: true, turnover5mUsd: 98_700_000 }),
  ];
  const ongoing: UsOngoingHaltRow[] = [
    { ...row(11, now, { sym: 'OLDA', code: 'LUDS', agoMin: 3 * 24 * 60, resumeAtMs: now + 20 * 60 * MIN, rawIssueName: 'Another Very Long Biotechnology Therapeutics Name Corp' }), daysHalted: 3, unlisted: true },
    { ...row(12, now, { sym: 'OLDB', code: 'H10', agoMin: 12 * 24 * 60, turnover5mUsd: null }), daysHalted: 12, unlisted: false },
  ];
  const day = new Intl.DateTimeFormat('sv-SE', { timeZone: 'America/New_York' }).format(new Date(now));
  return {
    day,
    serverNow: now,
    halts,
    ongoing,
    status: { enabled: true, inWindow: true, window: 'regular', openToday: 0, lastSuccessAt: new Date(now - 20_000).toISOString(), lastAttemptAt: new Date(now - 20_000).toISOString(), consecutiveFailures: 0, lastError: null },
    minTurnoverUsd: null,
    regularOpen,
    nextRegularOpen: now + 20 * 60 * MIN,
    nextRegularClose: now + (20 * 60 + 390) * MIN,
  };
}

/** 순위 100개 — 상승: LUDA 3위 · LGNM 7위 · TSLA 10위 · NWSD 11위(상위 10 밖) / 하락: LUDB 2위 · OPNC 15위 */
export function rankingSample(kind: LiveRankingKind, now: number): LiveRankingResponse {
  const placed: Record<string, [string, number][]> = {
    gainers: [['LUDA', 3], ['LGNM', 7], ['TSLA', 10], ['NWSD', 11]],
    losers: [['LUDB', 2], ['OPNC', 15]],
  };
  const at = new Map((placed[kind] ?? []).map(([s, r]) => [r, s]));
  const sign = kind === 'losers' ? -1 : 1;
  const rows = Array.from({ length: 100 }, (_, i) => {
    const rank = i + 1;
    return { rank, symbol: at.get(rank) ?? `R${rank}`, name: null, currency: 'USD' as const, price: 10, changeRate: sign * (rank === 3 ? 45.2 : rank === 2 ? 38.1 : 60 - rank * 0.5), tradingVolume: 1000, tradingAmount: 10_000 };
  });
  return { market: 'us', kind, duration: '1d', rankedAt: new Date(now - 15_000).toISOString(), fetchedAt: new Date(now).toISOString(), rows };
}
