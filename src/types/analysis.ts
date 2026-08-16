/** 분석 모드 — 프롬프트 형태와 필요한 데이터가 달라진다. */
export type AnalysisMode = 'quick' | 'multi' | 'portfolio' | 'compare';

export const ANALYSIS_MODES: {
  id: AnalysisMode;
  icon: string;
  label: string;
  description: string;
}[] = [
  { id: 'quick', icon: '⚡', label: '빠른 분석', description: '간단 요약' },
  { id: 'multi', icon: '🧠', label: '멀티 에이전트', description: '5명 전문가' },
  { id: 'portfolio', icon: '💼', label: '보유 주식 분석', description: '포트폴리오' },
  { id: 'compare', icon: '🔄', label: '종목 비교', description: '2~3종목' },
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
