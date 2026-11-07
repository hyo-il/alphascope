/**
 * 자산 관리 화면(v2.61.0 · v2.62.0) 디자인 점검용 가짜 응답 — **만든 값**이다(실제 자산 · 실제 시트가 아니다).
 * `design:check` 가 `page.route` 로 `/api/asset/status` · `sheet` · `summary` · `history` 를 바꿔치기한다 — 구글 · DB 를 건드리지 않는다.
 * 긴 종목명 · 긴 구간 이름 · 달러 소수 4자리 · 빈 구간 · 이을 수식 없는 줄 · 합계 표를 모두 넣어 칸 넘침을 잰다.
 */
import { DEFAULT_CLASS_COLORS, type AssetClassColors } from '../../../src/types/asset';
import type { AssetClass, AssetGroup, AssetGroupKey, AssetHistoryPoint, AssetHolding, AssetSheetData, AssetSheetFailure, AssetStatus, AssetSummary } from '../../../src/types/asset';

export const assetStatusSample = (unlocked: boolean, sheetConfigured = true): AssetStatus => ({ passwordSet: true, unlocked, sheetConfigured });

function holding(row: number, name: string, code: string | null, quantity: number, avgPrice: number, currency: 'USD' | 'KRW', tickerRow: number | null = null, assetClass: AssetClass | null = null, unknown: string | null = null): AssetHolding {
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
    assetClassUnknown: unknown,
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
          holding(8, '예시 고가 국내주', '000003', 1, 1234567, 'KRW', 18, null, '부동산'),
        ],
      },
      { key: '적립식 계좌', name: '적립식 계좌 ( 2026.07 )', combined: false, holdings: [holding(13, 'KODEX 예시 S&P500', '0072R0', 1200, 15000, 'KRW', 21, '주식'), holding(14, '이을 수식 없는 줄', null, 1, 1000, 'KRW')] },
      { key: 'ISA 계좌', name: 'ISA 계좌 ( 2026.07 )', combined: false, holdings: [holding(22, '예시 국내 배당주', '000002', 15, 42350, 'KRW', 25, '금')] },
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
 * 총 자산 요약(v2.62.0) 가짜 응답 — 만든 값. `none` = 분류 없음 금액 · 알 수 없는 분류 · 가격 못 받은 줄을 넣는다(긴 금액 · 경고 줄 넘침을 잰다).
 */
export function assetSummarySample(opts: { pension?: boolean; none?: boolean; vsLast?: boolean; colors?: Partial<AssetClassColors> } = {}): AssetSummary {
  const pension = opts.pension ?? false;
  const amounts: [AssetGroupKey, string, number][] = [
    ['cash', '현금', 1234567890],
    ['bond', '채권', 345678901],
    ['gold', '금', 234567890],
    ['stock', '주식', 3456789012],
    ...(pension ? ([['retirement', '퇴직 연금', 234567890]] as [AssetGroupKey, string, number][]) : []),
    ['none', '분류 없음', opts.none ? 98765432 : 0],
  ];
  const total = amounts.reduce((a, [, , v]) => a + v, 0);
  const groups: AssetGroup[] = amounts.map(([key, label, amount]) => ({ key, label, amount, ratio: amount / total }));
  return {
    readAt: new Date().toISOString(),
    pricedAt: new Date().toISOString(),
    includePension: pension,
    totals: { total, groups, core: 2765431209, satellite: 691357803, missing: opts.none ? 2 : 0 },
    profit: { amount: -12345678, ratio: -0.0234 },
    vsLast: opts.vsLast === false ? null : { day: '2026-11-05', amount: 23456789, ratio: 0.0043 },
    missingNames: opts.none ? ['이을 수식 없는 줄', '예시 미국 ETF 이름이 아주 긴 종목'] : [],
    unknownClassCount: opts.none ? 1 : 0,
    settings: { pensionSections: ['연금 저축 계좌'], satelliteSymbols: ['AAAA', '000001', '000003'], classColors: { ...DEFAULT_CLASS_COLORS, ...opts.colors } },
    sectionKeys: ['개별 투자', '적립식 계좌', 'ISA 계좌', '연금 저축 계좌'],
    // 위성으로 선택한 종목 고르기 — 주식 종목 셋 + 위성 목록에 남았지만 분류가 주식이 아닌 종목(흐리게) · 계좌 둘에 있는 종목
    stockChoices: [
      { symbol: 'AAAA', name: '예시 미국 기술주', sections: ['개별 투자'], isStock: true },
      { symbol: '000001', name: '예시 국내 대형주', sections: ['개별 투자'], isStock: true },
      { symbol: '000003', name: '예시 고가 국내주', sections: ['개별 투자'], isStock: false },
      { symbol: '0072R0', name: 'KODEX 예시 S&P500 이름이 아주 긴 종목 Vanguard Total World Stock Market Index Fund ETF Shares', sections: ['적립식 계좌', 'ISA 계좌'], isStock: true },
    ],
  };
}

/** 하루 기록 가짜 응답 — n 개(평일만 · 오늘 쪽으로 끝남) */
export function assetHistorySample(n: number): { range: string; points: AssetHistoryPoint[] } {
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
  return { range: '1m', points };
}

export const assetSummaryFailureSample: AssetSheetFailure = {
  error: '시트 모양이 바뀌었어요(「티커」 탭 D12 — 「자산 분류」 이어야 합니다).',
  kind: 'shape',
};
