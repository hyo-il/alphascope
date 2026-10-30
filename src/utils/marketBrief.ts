/**
 * 오늘 시황 — 서버와 화면이 같이 쓰는 작은 규칙(판 경계 · 한국 날짜 · 자산 이름). 서버도 컴파일한다(DOM 금지).
 */
import { marketDate, marketMinutes } from './marketDate';
import { isKrSymbol } from './market';
import { BRIEF_AFTERNOON_HOUR, type BriefAssetKey, type BriefEdition } from '../types/marketBrief';

/** 한국 날짜 YYYY-MM-DD */
export const kstDay = (ms: number) => marketDate(ms, '005930');

/** 한국 시각 — 자정부터 분 */
export const kstMinutes = (ms: number) => marketMinutes(ms, '005930');

/** 지금 시각의 판 — 한국 시간 13시 전 = 오전판, 13시부터 = 오후판 (Stockproject 와 같은 경계) */
export function editionAt(ms: number): BriefEdition {
  return kstMinutes(ms) < BRIEF_AFTERNOON_HOUR * 60 ? 'morning' : 'afternoon';
}

export const EDITION_LABEL: Record<BriefEdition, string> = { morning: '오전판', afternoon: '오후판' };

/** 자산 이름 — AI 입력(원본 name_map)과 화면이 같이 쓴다. 나스닥은 ^IXIC(종합지수)라 「나스닥」 으로 적는다(원본은 「나스닥100」 으로 잘못 적었다) */
export const ASSET_LABEL: Record<BriefAssetKey, string> = {
  KOSPI: '코스피',
  KOSDAQ: '코스닥',
  SP500: 'S&P500',
  NASDAQ: '나스닥',
  DOW: '다우존스',
  RUSSELL2000: '러셀2000',
  GOLD: '금(달러/온스)',
  DXY: '달러인덱스',
  US2Y: '미2년물금리(%)',
  US10Y: '미10년물금리(%)',
  USDKRW: '원/달러',
  WTI: 'WTI 원유(달러/배럴)',
  NATGAS: '천연가스(달러/MMBtu)',
  VIX: 'VIX 공포지수',
  ES: 'S&P500 선물',
  NQ: '나스닥100 선물',
};

/** VIX 구간 — 원본 오후판(30 이상 공포 · 20~30 주의 · 20 미만 안정) */
export function vixZone(value: number): '공포' | '주의' | '안정' {
  return value >= 30 ? '공포' : value >= 20 ? '주의' : '안정';
}

/** 정규장 시간에 거래되는 지수 — 장중에 받으면 마지막 일봉이 아직 끝나지 않았다(원본은 그래도 「종가」 로 적었다) */
const SESSION_OF: Partial<Record<BriefAssetKey, { ref: string; open: number; close: number }>> = {
  KOSPI: { ref: '005930', open: 9 * 60, close: 15 * 60 + 30 },
  KOSDAQ: { ref: '005930', open: 9 * 60, close: 15 * 60 + 30 },
  SP500: { ref: 'AAPL', open: 9 * 60 + 30, close: 16 * 60 },
  NASDAQ: { ref: 'AAPL', open: 9 * 60 + 30, close: 16 * 60 },
  DOW: { ref: 'AAPL', open: 9 * 60 + 30, close: 16 * 60 },
  RUSSELL2000: { ref: 'AAPL', open: 9 * 60 + 30, close: 16 * 60 },
  VIX: { ref: 'AAPL', open: 9 * 60 + 30, close: 16 * 60 },
};

/**
 * 받은 시각(atMs)에 그 지수의 마지막 봉(dataDate)이 아직 장중이었나 — 그 시장 날짜가 같고 정규장 시간 안이면 true.
 * 프롬프트(「[10/29(목) 장중]」)와 화면(「장중」)이 같이 쓴다. 지수가 아닌 값(금리 · 환율 · 선물)은 false.
 */
export function isIntradayBar(key: BriefAssetKey, dataDate: string | null, atMs: number): boolean {
  const s = SESSION_OF[key];
  if (!s || !dataDate) return false;
  if (marketDate(atMs, s.ref) !== dataDate) return false;
  const m = marketMinutes(atMs, s.ref);
  return m >= s.open && m < s.close;
}

/**
 * 오늘 시황 일정 한 줄의 시장 — 날짜(MM/DD) · D+N · 「미국 날짜」 표시가 이 시장 날짜다(서버 뒤처리 · 화면이 같이 쓴다 — v2.59.3).
 * 종목이 있으면 그 종목 시장(.KS/.KQ 접미사 포함), 없으면 이름에 국내 단서(한국 · 국내 · 한은 · 금통위 · 코스피 · 코스닥 · KRX)가 있으면 국내, 그 밖(FOMC · 미국 지표)은 미국.
 */
export function scheduleItemMarket(item: { ticker?: string | null; event?: string | null }): 'KR' | 'US' {
  const t = (item.ticker ?? '').trim().toUpperCase().replace(/\.(KS|KQ)$/, '');
  if (t) return isKrSymbol(t) ? 'KR' : 'US';
  return /한국|국내|한은|한국은행|금통위|코스피|코스닥|KRX/i.test(item.event ?? '') ? 'KR' : 'US';
}
