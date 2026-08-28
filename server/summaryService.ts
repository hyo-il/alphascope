import type { SymbolSummary } from '../src/types/analysis';
import { getCandles } from './candleService';
import { loadCandles } from './db';
import { getFundamentals } from './companyService';
import { computeIndicators } from './indicatorService';
import { isMockMode, mockPrice } from './mockData';
import { completedVolumeRatio } from '../src/utils/marketBar';
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
    // 실시간 조회가 막혀도(API 장애·IP 차단) 캐시가 있으면 요약은 만들어 준다 —
    // 여기서 던지면 지표·재무까지 통째로 비어 버린다.
    const candles = await getCandles(symbol, '1d', 300).catch((error) => {
      const cached = loadCandles(symbol, '1d', 300);
      if (!cached.length) throw error;
      summary.error = `실시간 캔들 조회 실패, 캐시 사용: ${(error as Error).message}`;
      return cached;
    });
    // 현재가도 마찬가지다 — 실패하면 마지막 캔들 종가로 대신한다.
    const price = isMockMode()
      ? mockPrice(symbol)
      : await fetchPrice(symbol).catch(() => ({ close: NaN }) as Awaited<ReturnType<typeof fetchPrice>>);
    summary.price = Number.isFinite(price.close) ? price.close : (candles.at(-1)?.close ?? null);

    // 전일 종가 대비 변동률
    if (candles.length >= 2 && summary.price) {
      const previous = candles.at(-2)!.close;
      if (previous) summary.changeRate = ((summary.price - previous) / previous) * 100;
    }

    const indicators = await computeIndicators(candles);
    // 장중에는 마지막 봉이 미완성이라 거래량이 평균의 몇 % 수준으로 찍힌다.
    // 그대로 내보내면 프롬프트에서 '거래량 급감' 으로 읽힌다.
    const volume = completedVolumeRatio(candles, '1d');

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
      volumeRatio: volume.ratio,
      volumeFromCompletedBar: volume.forming,
      high52w: candles.length ? Math.max(...candles.slice(-252).map((c) => c.high)) : null,
      low52w: candles.length ? Math.min(...candles.slice(-252).map((c) => c.low)) : null,
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
