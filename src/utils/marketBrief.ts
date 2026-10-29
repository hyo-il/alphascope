/**
 * 오늘 시황 — 서버와 화면이 같이 쓰는 작은 규칙(판 경계 · 한국 날짜 · 자산 이름). 서버도 컴파일한다(DOM 금지).
 */
import { marketDate, marketMinutes } from './marketDate';
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
};

/** VIX 구간 — 원본 오후판(30 이상 공포 · 20~30 주의 · 20 미만 안정) */
export function vixZone(value: number): '공포' | '주의' | '안정' {
  return value >= 30 ? '공포' : value >= 20 ? '주의' : '안정';
}
