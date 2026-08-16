import type { SymbolSummary } from '../src/types/analysis';
import { getCandles } from './candleService';
import { getFundamentals } from './companyService';
import { computeIndicators } from './indicatorService';
import { isMockMode, mockPrice } from './mockData';
import { fetchPrice } from '../src/services/toss/market';

/**
 * 여러 종목의 "분석에 필요한 요약"을 한 번에 만든다.
 *
 * 보유 주식 분석(모드 3)과 종목 비교(모드 4)에서 쓴다.
 * 종목마다 캔들·지표·재무를 따로 호출하면 왕복이 너무 많아진다.
 */

/** 시리즈의 마지막 유효 값 */
function last(series: (number | null)[] | undefined): number | null {
  if (!series?.length) return null;
  for (let i = series.length - 1; i >= 0; i--) {
    const value = series[i];
    if (value != null && Number.isFinite(value)) return value;
  }
  return null;
}

async function summarizeOne(symbol: string): Promise<SymbolSummary> {
  const summary: SymbolSummary = {
    symbol,
    name: null,
    price: null,
    changeRate: null,
    indicators: {},
    fundamentals: {},
    error: null,
  };

  try {
    const candles = await getCandles(symbol, '1d', 300);
    const price = isMockMode() ? mockPrice(symbol) : await fetchPrice(symbol);
    summary.price = Number.isFinite(price.close) ? price.close : (candles.at(-1)?.close ?? null);

    // 전일 종가 대비 변동률
    if (candles.length >= 2 && summary.price) {
      const previous = candles.at(-2)!.close;
      if (previous) summary.changeRate = ((summary.price - previous) / previous) * 100;
    }

    const indicators = await computeIndicators(candles);
    const recent = candles.slice(-20);
    const averageVolume = recent.length
      ? recent.reduce((sum, c) => sum + c.volume, 0) / recent.length
      : 0;

    summary.indicators = {
      rsi14: last(indicators.rsi14),
      macd: last(indicators.macd),
      macdSignal: last(indicators.macdSignal),
      macdHistogram: last(indicators.macdHistogram),
      sma20: last(indicators.sma20),
      sma60: last(indicators.sma60),
      bbUpper: last(indicators.bbUpper),
      bbMiddle: last(indicators.bbMiddle),
      bbLower: last(indicators.bbLower),
      atr14: last(indicators.atr14),
      stochK: last(indicators.stochK),
      stochD: last(indicators.stochD),
      volumeRatio: averageVolume ? ((candles.at(-1)?.volume ?? 0) / averageVolume) * 100 : null,
      high52w: recent.length ? Math.max(...candles.slice(-252).map((c) => c.high)) : null,
      low52w: recent.length ? Math.min(...candles.slice(-252).map((c) => c.low)) : null,
    };
  } catch (e) {
    summary.error = e instanceof Error ? e.message : String(e);
  }

  // 재무는 실패해도 나머지 요약은 살린다 (상장 직후 등 데이터가 없는 종목이 있다).
  try {
    const fundamentals = await getFundamentals(symbol);
    summary.name = fundamentals.profile.name;
    summary.fundamentals = {
      sector: fundamentals.profile.sector,
      marketCap: fundamentals.profile.marketCap,
      per: fundamentals.valuation.per,
      pbr: fundamentals.valuation.pbr,
      eps: fundamentals.valuation.eps,
      dividendYield: fundamentals.dividend.yield,
      revenueGrowth: fundamentals.profitability.revenueGrowth,
      profitMargin: fundamentals.profitability.profitMargin,
      debtToEquity: fundamentals.stability.debtToEquity,
    };
  } catch {
    // 재무 데이터 없음 — fundamentals 는 빈 객체로 둔다.
  }

  return summary;
}

export async function summarizeSymbols(symbols: string[]): Promise<SymbolSummary[]> {
  // 종목 수가 많지 않고(보유 종목·비교 최대 3개) Rate Limiter 가 뒤에서 조절하므로 병렬로 둔다.
  return Promise.all(symbols.map((symbol) => summarizeOne(symbol)));
}
