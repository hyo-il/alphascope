import type { DirectionUnknownReason } from '../types/usHalts';

/**
 * Nasdaq 거래정지 사유 코드 → 쉬운 말 — **이 표 한 곳**(실험실 「미국 거래정지」).
 *
 * 뜻은 Nasdaq 공식 코드표(https://www.nasdaqtrader.com/Trader.aspx?id=TradeHaltCodes)를 따른다. 영어 원문은 `en` 에 그대로 둔다.
 * 표에 없는 코드는 화면에 원문 코드만 보인다(뜻을 짐작해 적지 않는다).
 * LULD(가격 제한 범위를 벗어나 5분 멈춤): Nasdaq 상장 = LUDP · LUDS, 다른 거래소 상장 = M — 코드표에서 셋 다 「Volatility Trading Pause」.
 */
export const HALT_CODES: Record<string, { label: string; en: string }> = {
  LUDP: { label: '변동성 정지(LULD)', en: 'Volatility Trading Pause' },
  LUDS: { label: '변동성 정지(LULD · 호가가 범위에 걸침)', en: 'Volatility Trading Pause - Straddle Condition' },
  M: { label: '변동성 정지(LULD)', en: 'Volatility Trading Pause' },
  T1: { label: '뉴스 대기 정지', en: 'Halt - News Pending' },
  T2: { label: '뉴스 발표 정지', en: 'Halt - News Released' },
  T3: { label: '뉴스 발표 · 재개 시각 공지', en: 'News and Resumption Times' },
  T5: { label: '단일 종목 일시 정지', en: 'Single Stock Trading Pause In Effect' },
  T6: { label: '이상 거래로 정지', en: 'Halt - Extraordinary Market Activity' },
  T7: { label: '단일 종목 일시 정지(호가만)', en: 'Single Stock Trading Pause/Quotation-Only Period' },
  T8: { label: 'ETF 관련 정지', en: 'Halt - Exchange-Traded-Fund (ETF)' },
  T12: { label: '나스닥 추가 정보 요청 정지', en: 'Halt - Additional Information Requested by NASDAQ' },
  H4: { label: '상장 요건 미달 정지', en: 'Halt - Non-compliance' },
  H9: { label: '공시 지연 정지', en: 'Halt - Not Current' },
  H10: { label: 'SEC 거래 정지', en: 'Halt - SEC Trading Suspension' },
  H11: { label: '규제 우려 정지', en: 'Halt - Regulatory Concern' },
  O1: { label: '거래소 운영상 정지', en: 'Operations Halt, Contact Market Operations' },
  IPO1: { label: '상장 전(아직 거래 안 함)', en: 'IPO Issue not yet Trading' },
  IPOQ: { label: '신규 상장 호가 시작', en: 'IPO security released for quotation' },
  IPOE: { label: '신규 상장 호가 기간 연장', en: 'IPO security - positioning window extension' },
  M1: { label: '기업 행위로 정지', en: 'Corporate Action' },
  M2: { label: '호가 없음', en: 'Quotation Not Available' },
  MWC0: { label: '시장 전체 서킷브레이커(전날 이어짐)', en: 'Market Wide Circuit Breaker Halt - Carry over from previous day' },
  MWC1: { label: '시장 전체 서킷브레이커 1단계', en: 'Market Wide Circuit Breaker Halt - Level 1' },
  MWC2: { label: '시장 전체 서킷브레이커 2단계', en: 'Market Wide Circuit Breaker Halt - Level 2' },
  MWC3: { label: '시장 전체 서킷브레이커 3단계', en: 'Market Wide Circuit Breaker Halt - Level 3' },
  MWCQ: { label: '서킷브레이커 뒤 재개', en: 'Market Wide Circuit Breaker Resumption' },
  R1: { label: '신규 종목 거래 가능', en: 'New Issue Available' },
  R2: { label: '거래 가능', en: 'Issue Available' },
  R4: { label: '요건 확인 끝 · 재개', en: 'Qualifications Issues Reviewed/Resolved; Quotations/Trading to Resume' },
  R9: { label: '공시 요건 충족 · 재개', en: 'Filing Requirements Satisfied/Resolved; Quotations/Trading To Resume' },
  C3: { label: '발표 없음 · 재개', en: 'Issuer News Not Forthcoming; Quotations/Trading To Resume' },
  C4: { label: '요건 정지 끝 · 재개', en: 'Qualifications Halt ended; maint. req. met; Resume' },
  C9: { label: '요건 정지 끝(공시 충족) · 재개', en: 'Qualifications Halt Concluded; Filings Met; Quotes/Trades To Resume' },
  C11: { label: '다른 기관의 정지 끝 · 재개', en: 'Trade Halt Concluded By Other Regulatory Authority; Quotes/Trades Resume' },
  D: { label: '나스닥 목록에서 삭제', en: 'Security deletion from NASDAQ / CQS' },
};

/** 쉬운 말 — 모르는 코드는 null(화면은 원문 코드만) */
export const haltCodeLabel = (code: string): string | null => HALT_CODES[code]?.label ?? null;

/**
 * 방향 「판정 못 함」 이유 → 쉬운 말 — **이 표 한 곳**. 서버가 남긴 이유(`DirectionUnknownReason`)로 고른다.
 * 표에 없는 이유(not_today · code_changed · mock)와 이유 없는 옛 줄은 「판정 못 함」 만.
 */
const DIRECTION_UNKNOWN_LABELS: Partial<Record<DirectionUnknownReason, string>> = {
  stale: '거래 적음',
  few_bars: '거래 적음',
  flat: '변화 없음',
  not_in_toss: '토스에 없음',
  not_found: '토스에 없음',
  fetch_failed: '받기 실패',
};

/** 「판정 못 함 · 거래 적음」 처럼 — 이유를 모르면 「판정 못 함」 */
export const directionUnknownText = (reason: DirectionUnknownReason | null): string => {
  const label = reason ? DIRECTION_UNKNOWN_LABELS[reason] : undefined;
  return label ? `판정 못 함 · ${label}` : '판정 못 함';
};
