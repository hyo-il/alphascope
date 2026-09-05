/**
 * 에이전트 4명이 공유하는 "종목 데이터 블록" 을 만든다.
 *
 * 4명에게 같은 텍스트를 보내고 시스템 프롬프트만 다르게 한다 —
 * 데이터가 다르면 의견 차이가 관점 때문인지 입력 때문인지 구분할 수 없다.
 */

import type { SymbolSummary } from '../../src/types/analysis';
import type { Candle } from '../../src/types/toss';
import { getCandles } from '../candleService';
import { loadCandles } from '../db';
import { summarizeSymbols } from '../summaryService';
import { completedVolumeRatio, isFormingBar } from '../../src/utils/marketBar';

export interface AnalysisContext {
  symbol: string;
  /** 프롬프트에 넣을 텍스트 */
  text: string;
  /** 분석 시점 가격 — 사후 채점의 기준 */
  price: number | null;
  summary: SymbolSummary;
}

function num(value: number | null | undefined, digits = 2, suffix = ''): string {
  if (value == null || !Number.isFinite(value)) return '데이터 없음';
  return `${value.toFixed(digits)}${suffix}`;
}

/** 최근 N봉을 표로 — 모델이 캔들 패턴을 직접 읽을 수 있게 한다 */
function candleTable(candles: Candle[], count: number, forming: boolean): string {
  const recent = candles.slice(-count);
  const rows = recent.map((c, index) => {
    const date = new Date(c.timestamp).toISOString().slice(0, 10);
    const mark = forming && index === recent.length - 1 ? ' | ← 진행 중(미확정)' : '';
    return `${date} | ${c.open.toFixed(2)} | ${c.high.toFixed(2)} | ${c.low.toFixed(2)} | ${c.close.toFixed(2)} | ${Math.round(c.volume).toLocaleString()}${mark}`;
  });
  return ['날짜 | 시가 | 고가 | 저가 | 종가 | 거래량', '--- | --- | --- | --- | --- | ---', ...rows].join('\n');
}

export async function buildContext(symbol: string): Promise<AnalysisContext> {
  // 캔들 조회가 실패해도(토스 API 장애·IP 차단 등) SQLite 캐시로 분석은 이어 간다.
  // 다만 언제 데이터인지는 반드시 프롬프트에 적는다 — 모델이 오래된 가격을
  // 현재가로 착각하면 신호 자체가 무의미해진다.
  let stale = false;
  const [summaries, candles] = await Promise.all([
    summarizeSymbols([symbol]),
    getCandles(symbol, '1d', 300).catch(() => {
      stale = true;
      return loadCandles(symbol, '1d', 300);
    }),
  ]);

  const summary = summaries[0];
  const indicators = summary?.indicators ?? {};
  const fundamentals = summary?.fundamentals ?? {};
  const price = summary?.price ?? candles.at(-1)?.close ?? null;

  const lines: string[] = [];
  lines.push(`# 분석 대상: ${summary?.name ? `${summary.name} (${symbol})` : symbol}`);
  lines.push(`분석 시각: ${new Date().toISOString()}`);
  const forming = candles.length > 0 && !stale && isFormingBar(candles, '1d');
  if (candles.length) {
    const lastDate = new Date(candles.at(-1)!.timestamp).toISOString().slice(0, 10);
    const note = stale
      ? ' (실시간 조회 실패 — 캐시된 과거 데이터입니다)'
      : forming
        ? ' (오늘 봉은 아직 진행 중이라 종가·거래량이 확정되지 않았습니다)'
        : '';
    lines.push(`캔들 마지막 봉: ${lastDate}${note}`);
  }
  lines.push('');
  lines.push('## 현재 시세');
  lines.push(`- 현재가: ${num(price)}`);
  lines.push(`- 전일 대비: ${num(summary?.changeRate, 2, '%')}`);
  lines.push(`- 52주 최고/최저: ${num(indicators.high52w)} / ${num(indicators.low52w)}`);
  lines.push('');
  lines.push('## 기술적 지표 (일봉 기준)');
  lines.push(`- RSI(14): ${num(indicators.rsi14)}`);
  lines.push(
    `- MACD(12,26,9): MACD ${num(indicators.macd, 3)} / 시그널 ${num(indicators.macdSignal, 3)} / 히스토그램 ${num(indicators.macdHistogram, 3)}`,
  );
  lines.push(`- 이동평균: MA20 ${num(indicators.sma20)} / MA60 ${num(indicators.sma60)}`);
  lines.push(
    `- 볼린저밴드(20,2): 상단 ${num(indicators.bbUpper)} / 중심 ${num(indicators.bbMiddle)} / 하단 ${num(indicators.bbLower)}`,
  );
  lines.push(`- ATR(14): ${num(indicators.atr14)}`);
  lines.push(`- 스토캐스틱: %K ${num(indicators.stochK)} / %D ${num(indicators.stochD)}`);
  // volumeRatio 는 퍼센트다 (100 = 평균과 같음).
  // 장중에는 진행 중인 봉을 뺀 값을 쓴다 — 개장 직후 거래량을 급감으로 오독하지 않도록.
  const volumeRatio = indicators.volumeRatio ?? completedVolumeRatio(candles, '1d').ratio;
  lines.push(
    `- 거래량(20일 평균 대비): ${num(volumeRatio, 1, '%')} (100% = 평균 수준)${forming ? ' — 직전 완성 봉 기준' : ''}`,
  );
  if (forming) {
    const todayVolume = candles.at(-1)?.volume ?? 0;
    lines.push(`- 오늘(진행 중) 누적 거래량: ${Math.round(todayVolume).toLocaleString()}주`);
  }
  lines.push('');
  lines.push('## 재무·밸류에이션');
  if (Object.values(fundamentals).some((v) => v != null)) {
    lines.push(`- 섹터: ${fundamentals.sector ?? '데이터 없음'}`);
    lines.push(`- 시가총액: ${fundamentals.marketCap ? fundamentals.marketCap.toLocaleString() : '데이터 없음'}`);
    lines.push(`- PER: ${num(fundamentals.per)} / PBR: ${num(fundamentals.pbr)} / EPS: ${num(fundamentals.eps)}`);
    // ⚠️ 배당수익률만 이미 퍼센트 단위다. 나머지 비율은 소수(0.2762 = 27.62%).
    lines.push(`- 배당수익률: ${num(fundamentals.dividendYield, 2, '%')}`);
    lines.push(
      `- 매출 성장률: ${fundamentals.revenueGrowth != null ? num(fundamentals.revenueGrowth * 100, 2, '%') : '데이터 없음'}`,
    );
    lines.push(
      `- 순이익률: ${fundamentals.profitMargin != null ? num(fundamentals.profitMargin * 100, 2, '%') : '데이터 없음'}`,
    );
    lines.push(`- 부채비율(D/E): ${num(fundamentals.debtToEquity)}`);
  } else {
    lines.push('- 재무 데이터를 가져오지 못했습니다. 추측하지 마세요.');
  }
  lines.push('');

  if (candles.length) {
    lines.push('## 최근 30 거래일 OHLCV');
    lines.push(candleTable(candles, 30, forming));
  } else {
    lines.push('## 최근 캔들: 데이터 없음');
  }

  if (summary?.error) {
    lines.push('', `⚠️ 일부 데이터 수집 실패: ${summary.error}`);
  }

  return { symbol, text: lines.join('\n'), price, summary };
}
