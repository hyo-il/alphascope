/**
 * 자산 관리 화면(v2.61.0 · v2.62.0) 디자인 점검용 가짜 응답 — **만든 값**이다(실제 자산 · 실제 시트가 아니다).
 * `design:check` 가 `page.route` 로 `/api/asset/status` · `sheet` · `summary` · `history` 를 바꿔치기한다 — 구글 · DB 를 건드리지 않는다.
 * 긴 종목명 · 긴 구간 이름 · 달러 소수 4자리 · 빈 구간 · 이을 수식 없는 줄 · 합계 표를 모두 넣어 칸 넘침을 잰다.
 */
import { DEFAULT_CLASS_COLORS, type AssetClassColors } from '../../../src/types/asset';
import type { AssetClass, AssetGroup, AssetGroupKey, AssetHistoryPoint, AssetHolding, AssetPriceSheetStatus, AssetSheetData, AssetSheetFailure, AssetStatus, AssetSummary, AssetTargetRatio } from '../../../src/types/asset';
import { computeRebalance } from '../../../server/asset/rebalance';
import { computeMonthlyBuy } from '../../../server/asset/purchase';

export const assetStatusSample = (unlocked: boolean, sheetConfigured = true): AssetStatus => ({ passwordSet: true, unlocked, sheetConfigured });

function holding(row: number, name: string, code: string | null, quantity: number, avgPrice: number, currency: 'USD' | 'KRW', tickerRow: number | null = null, assetClass: AssetClass | null = null, classFormula = false): AssetHolding {
  const us = code?.includes(':') ?? false;
  return {
    row,
    name,
    code,
    market: code ? (us ? 'US' : 'KR') : null,
    exchange: us && code ? code.split(':')[0] : null,
    symbol: code ? (us ? code.split(':')[1] : code) : null,
    quantity,
    avgPrice,
    currency,
    tickerRow: code ? tickerRow : null,
    assetClass,
    classFormula: code ? classFormula : false,
  };
}

export function assetSheetSample(): AssetSheetData {
  return {
    readAt: new Date().toISOString(),
    sections: [
      {
        key: '개별 투자', name: '개별 투자 ( 2026.07 )',
        combined: false,
        holdings: [
          holding(5, '예시 미국 기술주', 'NASDAQ:AAAA', 12.5, 101.2345, 'USD', 15, '주식'),
          holding(6, '예시 국내 대형주', '000001', 30, 71000, 'KRW', 16, '주식'),
          holding(7, '예시 미국 ETF 이름이 아주 긴 종목 Vanguard Total World Stock Market Index Fund ETF Shares', 'NYSEARCA:BBBB', 4, 1250.5, 'USD', 17, '채권'),
          holding(8, '예시 고가 국내주', '000003', 1, 1234567, 'KRW', 18, null), // 시트 글자가 세 가지가 아님(미지정)
        ],
      },
      { key: '적립식 계좌', name: '적립식 계좌 ( 2026.07 )', combined: false, holdings: [holding(13, 'KODEX 예시 S&P500', '0072R0', 1200, 15000, 'KRW', 21, '주식'), holding(14, '이을 수식 없는 줄', null, 1, 1000, 'KRW'), holding(15, '예시 분류 칸이 수식인 종목', '000004', 3, 50000, 'KRW', 23, '채권', true), holding(16, '예시 미국 소형주', 'NYSE:CCCC', 7, 12.5, 'USD', 24, null)] },
      // 같은 종목(「티커」 16행)이 개별 투자에도 있다: 「자산 분류 정하기」 창에서 한 줄(v2.65.3)
      { key: 'ISA 계좌', name: 'ISA 계좌 ( 2026.07 )', combined: false, holdings: [holding(22, '예시 국내 배당주', '000002', 15, 42350, 'KRW', 25, '금'), holding(23, '예시 국내 대형주', '000001', 5, 70000, 'KRW', 16, '주식')] },
      { key: '연금 저축 계좌', name: '연금 저축 계좌 ( 2026.07 )', combined: false, holdings: [] },
      { key: null, name: '적립식 주식', combined: true, holdings: [holding(39, 'KODEX 예시 S&P500', '0072R0', 1200, 15000, 'KRW', 21, '주식'), holding(40, '예시 국내 배당주', '000002', 15, 42350, 'KRW', 25, '금')] },
    ],
    cashTotal: 1234567890,
    retirement: 234567890,
    salary: 3456789,
    avgFxRate: 1350.25,
    targetRatio: { cash: 20, gold: 10, bond: 10, invest: 60, core: 70, satellite: 30 },
  };
}

export const assetSheetFailureSample: AssetSheetFailure = {
  error: '시트 모양이 바뀌었어요(「주식 투자 정리」 탭 B38 — 「내 계좌 정보」 이어야 합니다).',
  kind: 'shape',
};

/**
 * 총 자산 요약(v2.62.0) 가짜 응답 — 만든 값. `none` = 미지정 금액 · 가격 못 받은 줄을 넣는다(긴 금액 · 경고 줄 넘침을 잰다).
 */
export function assetSummarySample(
  opts: { pension?: boolean; none?: boolean; vsLast?: boolean; colors?: Partial<AssetClassColors>; target?: AssetTargetRatio; band?: number; writeEnabled?: boolean; purchaseDone?: boolean; calendarUnchecked?: boolean; skipped?: boolean; salary?: number | null; price?: Parameters<typeof priceSheetSample>[0] } = {},
): AssetSummary {
  const pension = opts.pension ?? false;
  const amounts: [AssetGroupKey, string, number][] = [
    ['cash', '현금', 1234567890],
    ['bond', '채권', 345678901],
    ['gold', '금', 234567890],
    ['stock', '주식', 3456789012],
    ...(pension ? ([['retirement', '퇴직 연금', 234567890]] as [AssetGroupKey, string, number][]) : []),
    ['none', '미지정', opts.none ? 98765432 : 0],
  ];
  const total = amounts.reduce((a, [, , v]) => a + v, 0);
  const groups: AssetGroup[] = amounts.map(([key, label, amount]) => ({ key, label, amount, ratio: amount / total }));
  const totals = { total, groups, core: 2765431209, satellite: 691357803, missing: opts.none ? 2 : 0 };
  // 비율 조정 — 서버와 같은 순수 함수로(괜찮음 · 조정 필요가 섞이는 목표)
  const target = opts.target ?? { cash: 20, gold: 5, bond: 10, invest: 65, core: 70, satellite: 30 };
  const band = opts.band ?? 5;
  return {
    readAt: new Date().toISOString(),
    pricedAt: new Date().toISOString(),
    includePension: pension,
    totals,
    profit: { amount: -12345678, ratio: -0.0234 },
    vsLast: opts.vsLast === false ? null : { day: '2026-11-05', amount: 23456789, ratio: 0.0043 },
    missingNames: opts.none ? ['이을 수식 없는 줄', '예시 미국 ETF 이름이 아주 긴 종목'] : [],
    settings: { pensionSections: ['연금 저축 계좌'], satelliteSymbols: ['AAAA', '000001', '000003'], classColors: { ...DEFAULT_CLASS_COLORS, ...opts.colors }, rebalanceBand: band },
    accounts: [
      { key: '개별 투자', name: '개별 투자 ( 2026.07 )', holdings: 4, value: 1876543210, missing: 0 },
      { key: '적립식 계좌', name: '적립식 계좌 ( 2026.07 )', holdings: 2, value: 18000000, missing: 1 },
      { key: 'ISA 계좌', name: 'ISA 계좌 ( 2026.07 )', holdings: 2, value: 985250, missing: 0 },
      { key: '연금 저축 계좌', name: '연금 저축 계좌 ( 2026.07 )', holdings: 0, value: 0, missing: 0 },
    ],
    // 위성으로 선택한 종목 고르기 — 주식 종목 셋 + 위성 목록에 남았지만 분류가 주식이 아닌 종목(흐리게) · 계좌 둘에 있는 종목
    stockChoices: [
      { symbol: 'AAAA', name: '예시 미국 기술주', sections: ['개별 투자'], isStock: true },
      { symbol: '000001', name: '예시 국내 대형주', sections: ['개별 투자'], isStock: true },
      { symbol: '000003', name: '예시 고가 국내주', sections: ['개별 투자'], isStock: false },
      { symbol: 'CCCC', name: '예시 미국 반도체주', sections: ['ISA 계좌'], isStock: true },
      { symbol: '0072R0', name: 'KODEX 예시 S&P500 이름이 아주 긴 종목 Vanguard Total World Stock Market Index Fund ETF Shares', sections: ['적립식 계좌', 'ISA 계좌'], isStock: true },
    ],
    // 종목별(가짜 — 같은 종목 두 계좌 · 미국 · 가격 못 받음 · 코어 / 위성 · 분류가 주식이 아닌 것)
    bySymbol: [
      { id: 'AAAA', name: '예시 미국 기술주', symbol: 'AAAA', exchange: 'NASDAQ', assetClass: '주식', side: 'satellite', sections: ['개별 투자'], quantity: 12.5, value: 691357803, missing: 0, ratio: 691357803 / total },
      { id: '0072R0', name: 'KODEX 예시 S&P500 이름이 아주 긴 종목 Vanguard Total World Stock Market Index Fund ETF Shares', symbol: '0072R0', exchange: null, assetClass: '주식', side: 'core', sections: ['적립식 계좌', 'ISA 계좌'], quantity: 1500.25, value: 2765431209, missing: 0, ratio: 2765431209 / total },
      { id: 'BBBB', name: '예시 미국 채권 ETF', symbol: 'BBBB', exchange: 'NYSEARCA', assetClass: '채권', side: null, sections: ['개별 투자'], quantity: 4, value: 345678901, missing: 0, ratio: 345678901 / total },
      { id: '000002', name: '예시 국내 금 ETF', symbol: '000002', exchange: null, assetClass: '금', side: null, sections: ['ISA 계좌'], quantity: 15, value: 234567890, missing: 0, ratio: 234567890 / total },
      { id: '000003', name: '예시 고가 국내주', symbol: '000003', exchange: null, assetClass: null, side: null, sections: ['개별 투자'], quantity: 1, value: opts.none ? null : 98765432, missing: opts.none ? 1 : 0, ratio: opts.none ? null : 98765432 / total },
      { id: 'name:이을 수식 없는 줄', name: '이을 수식 없는 줄', symbol: null, exchange: null, assetClass: null, side: null, sections: ['적립식 계좌'], quantity: 1, value: null, missing: 1, ratio: null },
    ],
    rebalance: computeRebalance(totals, target, band),
    targetRatio: target,
    writeEnabled: opts.writeEnabled ?? true,
    // 이번 달 구매(v2.64.0) — 서버와 같은 순수 함수 · 긴 월급(9자리)으로 칸 넘침을 잰다.
    // 처음 값은 「완료」(구매일 팝업이 뜨지 않게 — 다른 장면 사진을 가리지 않는다) · 팝업 장면은 `purchaseDone: false`
    monthlyBuy: {
      ...computeMonthlyBuy(opts.salary === undefined ? 123456789 : opts.salary, target),
      // 시작 전 차례(v2.64.1 · `skipped`) — 오늘 11-07 · 차례 10-30 · 시작한 날 11-07
      ...(opts.skipped
        ? { today: '2026-11-07', cycleDay: '2026-10-30', nextDay: '2026-11-27', done: false, doneDay: null, startDay: '2026-11-07', skipped: true }
        : { today: '2026-11-27', cycleDay: '2026-11-27', nextDay: '2026-12-24', done: opts.purchaseDone ?? true, doneDay: opts.purchaseDone ?? true ? '2026-11-27' : null, startDay: '2026-11-07', skipped: false }),
      calendarUnchecked: opts.calendarUnchecked ?? false,
      // 시트에 쓸 날짜 글자 — 위 가짜 계좌 이름(「( 2026.07 )」 모양)에 차례 날짜를 넣은 값
      sheetDates: [opts.skipped ? '2026.10' : '2026.11'],
    },
    priceSheet: priceSheetSample(opts.price ?? 'google'),
  };
}

/**
 * 시트 가격(v2.65.0) 가짜 상태 — google: 처음(Google) · toss: 토스로 바꾼 뒤(쓰는 중 · 토스 가격 없음 목록 · 남은 종목 1) ·
 * off: 스위치 꺼진 서버(맥 기본) · google-backup: Google 인데 되돌리기 확인이 틀려 백업이 남음 ·
 * google-archived(v2.65.1): 시트를 바꿔 옛 시트 백업 보관 중 · google-moved(v2.65.1): 되돌리기 때 줄이 옮겨져 쓰지 않은 줄 셋(긴 이름 · 이름 모름 · 빈 줄) — 백업 남음. 긴 종목명 · 영문 섞인 코드로 칸 넘침을 잰다.
 */
export function priceSheetSample(kind: 'google' | 'toss' | 'off' | 'google-backup' | 'google-moved' | 'google-archived'): AssetPriceSheetStatus {
  const skipped: AssetPriceSheetStatus['skipped'] = [
    { row: 17, name: 'KODEX 예시 S&P500 이름이 아주 긴 종목 Vanguard Total World Stock Market Index Fund ETF Shares', code: '0072R0', reason: 'no-toss-price' },
    { row: 21, name: '예시 미국 채권 ETF', code: 'NYSEARCA:BBBB', reason: 'won-shape' },
    { row: 24, name: '', code: '000009', reason: 'code-changed' },
  ];
  const base = { lastWrittenAt: null, rows: 0, remaining: 0, skipped: [], moved: [], archived: null };
  if (kind === 'toss') return { ...base, enabled: true, source: 'toss', lastWrittenAt: '2026-11-07T13:05:20.000Z', state: 'writing', rows: 19, remaining: 1, hasBackup: true, skipped };
  if (kind === 'off') return { ...base, enabled: false, source: 'google', state: 'off', hasBackup: false };
  if (kind === 'google-backup') return { ...base, enabled: true, source: 'google', state: 'idle', hasBackup: true };
  if (kind === 'google-moved') {
    return {
      ...base,
      enabled: true,
      source: 'google',
      state: 'idle',
      hasBackup: true,
      moved: [
        { row: 15, wasName: 'KODEX 예시 S&P500 이름이 아주 긴 종목 Vanguard Total World Stock Market Index Fund ETF Shares', wasCode: '0072R0', nowName: '예시 미국 기술주', nowCode: 'NASDAQ:AAAA' },
        { row: 18, wasName: '', wasCode: 'NYSEARCA:BBBB', nowName: '예시 국내 반도체 이름이 아주 긴 종목', nowCode: '000009' },
        { row: 27, wasName: '예시 금 ETF', wasCode: '000007', nowName: null, nowCode: null },
      ],
    };
  }
  // v2.65.1 — 시트를 바꿔 옛 시트 백업을 보관 중(둘 — 시험용 시트 · 그 전 시트)
  if (kind === 'google-archived') return { ...base, enabled: true, source: 'google', state: 'idle', hasBackup: false, archived: { cells: 1234, sheets: ['1aBc', 'Xy9Z'] } };
  return { ...base, enabled: true, source: 'google', state: 'idle', hasBackup: false };
}

/** 하루 기록 가짜 응답 — n 개(평일만 · 오늘 쪽으로 끝남) · since = 시트가 바뀐 시각(v2.65.1 — 빈 차트 문구) */
export function assetHistorySample(n: number, since: string | null = null): { range: string; points: AssetHistoryPoint[]; since: string | null } {
  const points: AssetHistoryPoint[] = [];
  let t = Date.now() - 86_400_000;
  let v = 5_100_000_000;
  while (points.length < n) {
    const d = new Date(t);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) {
      points.unshift({ day: d.toISOString().slice(0, 10), total: Math.round(v) });
      v *= 1 - 0.006 * Math.sin(points.length * 1.3);
    }
    t -= 86_400_000;
  }
  return { range: '1m', points, since };
}

export const assetSummaryFailureSample: AssetSheetFailure = {
  error: '시트 모양이 바뀌었어요(「티커」 탭 D12 — 「자산 분류」 이어야 합니다).',
  kind: 'shape',
};
