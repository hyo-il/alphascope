/** 시황 바에 표시하는 주요 지수 */
export interface MarketIndex {
  symbol: string;
  label: string;
  price: number | null;
  /** 전일 대비 변동폭 */
  change?: number | null;
  /** 전일 대비 등락률 (%) */
  changeRate: number | null;
  /** 미니 차트용 최근 종가 (약 30 거래일) */
  sparkline?: number[];
}

/** 분석 모드 — 프롬프트 형태와 필요한 데이터가 달라진다. */
export type AnalysisMode = 'quick' | 'multi' | 'portfolio' | 'compare';

/** 라벨은 5글자 이내로 둔다 — 길면 카드 안에서 개행돼 읽기 나빠진다. */
export const ANALYSIS_MODES: {
  id: AnalysisMode;
  icon: string;
  label: string;
  description: string;
}[] = [
  { id: 'quick', icon: '⚡', label: '간단 분석', description: '핵심 지표만 빠르게' },
  { id: 'multi', icon: '🧠', label: '전문가 분석', description: '5명 AI 전문가 다각도' },
  { id: 'portfolio', icon: '💼', label: '포트폴리오', description: '보유종목 전체 진단' },
  { id: 'compare', icon: '🔄', label: '비교 분석', description: '2~3 종목 나란히' },
];

/** 여러 종목을 한 번에 분석할 때 쓰는 종목별 요약 (서버 `/api/summary`) */
export interface SymbolSummary {
  symbol: string;
  name: string | null;
  price: number | null;
  changeRate: number | null;
  indicators: {
    rsi14?: number | null;
    macd?: number | null;
    macdSignal?: number | null;
    macdHistogram?: number | null;
    sma20?: number | null;
    sma60?: number | null;
    bbUpper?: number | null;
    bbMiddle?: number | null;
    bbLower?: number | null;
    atr14?: number | null;
    stochK?: number | null;
    stochD?: number | null;
    volumeRatio?: number | null;
    high52w?: number | null;
    low52w?: number | null;
  };
  fundamentals: {
    sector?: string | null;
    marketCap?: number | null;
    per?: number | null;
    pbr?: number | null;
    eps?: number | null;
    dividendYield?: number | null;
    revenueGrowth?: number | null;
    profitMargin?: number | null;
    debtToEquity?: number | null;
  };
  /** 종목 하나가 실패해도 나머지는 살린다 */
  error: string | null;
}
