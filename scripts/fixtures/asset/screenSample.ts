/**
 * 자산 관리 화면(v2.61.0) 디자인 점검용 가짜 응답 — **만든 값**이다(실제 자산 · 실제 시트가 아니다).
 * `design:check` 가 `page.route` 로 `/api/asset/status` · `/api/asset/sheet` 를 바꿔치기한다 — 구글 · DB 를 건드리지 않는다.
 * 긴 종목명 · 긴 구간 이름 · 달러 소수 4자리 · 빈 구간 · 이을 수식 없는 줄 · 합계 표를 모두 넣어 칸 넘침을 잰다.
 */
import type { AssetClass, AssetHolding, AssetSheetData, AssetSheetFailure, AssetStatus } from '../../../src/types/asset';

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
