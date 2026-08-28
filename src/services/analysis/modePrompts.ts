import {
  DEFAULT_HORIZON,
  horizonBlock,
  horizonOf,
  type InvestmentHorizon,
} from './horizons';
import type { SymbolSummary } from '../../types/analysis';
import type { ExchangeRate, Portfolio, Timeframe } from '../../types/toss';
import { DISCLAIMER } from './prompts';

/**
 * 모드별 프롬프트 (빠른 분석 / 보유 주식 / 종목 비교).
 * 멀티 에이전트는 `multiAgentPrompt.ts` 가 담당한다.
 *
 * 값이 없으면 반드시 "데이터 없음"으로 표기한다 — 빈칸이나 undefined 를 그대로 두면
 * 붙여넣은 쪽이 사실로 오해할 수 있다.
 */

const NONE = '데이터 없음';

function n(value: number | null | undefined, digits = 2, prefix = '', suffix = ''): string {
  if (value == null || !Number.isFinite(value)) return NONE;
  return `${prefix}${value.toFixed(digits)}${suffix}`;
}

/** 소수 비율 → 퍼센트 */
function ratio(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? NONE : `${(value * 100).toFixed(2)}%`;
}

function usd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return NONE;
  for (const [size, suffix] of [
    [1e12, 'T'],
    [1e9, 'B'],
    [1e6, 'M'],
  ] as [number, string][]) {
    if (Math.abs(value) >= size) return `$${(value / size).toFixed(2)}${suffix}`;
  }
  return `$${value.toLocaleString('en-US')}`;
}

function above(price: number | null, line: number | null | undefined): string {
  if (price == null || line == null || !Number.isFinite(line)) return NONE;
  return price >= line ? '위' : '아래';
}

const TIMEFRAME_LABEL: Record<Timeframe, string> = {
  '1m': '1분봉',
  '5m': '5분봉',
  '15m': '15분봉',
  '30m': '30분봉',
  '1d': '일봉',
};

/** 모드 1 — 빠른 분석 */
export function buildQuickPrompt(
  summary: SymbolSummary | null,
  timeframe: Timeframe,
  symbol: string,
  horizonId: InvestmentHorizon = DEFAULT_HORIZON,
): string {
  if (!summary) return `${symbol} 데이터를 불러오는 중입니다.`;

  const i = summary.indicators;
  const macdText =
    i.macd == null
      ? NONE
      : `${n(i.macd, 3)} / 시그널: ${n(i.macdSignal, 3)} / 히스토그램: ${n(i.macdHistogram, 3)}`;

  const horizon = horizonOf(horizonId);

  return `아래 차트 이미지와 데이터를 보고 기술적 분석 의견을 주세요.

${horizonBlock(horizonId)}

종목: ${summary.symbol}${summary.name ? ` (${summary.name})` : ''}
타임프레임: ${TIMEFRAME_LABEL[timeframe]}
현재가: ${n(summary.price, 2, '$')} (전일 대비 ${n(summary.changeRate, 2, '', '%')})
거래량: 20봉 평균 대비 ${n(i.volumeRatio, 0, '', '%')}${i.volumeFromCompletedBar ? ' (직전 완성 봉 기준 — 마지막 봉은 진행 중)' : ''}

[기술적 지표]
RSI(14): ${n(i.rsi14, 1)}
MACD: ${macdText}
20MA: ${n(i.sma20, 2, '$')} (현재가 ${above(summary.price, i.sma20)}) | 60MA: ${n(i.sma60, 2, '$')} (현재가 ${above(summary.price, i.sma60)})
볼린저밴드: 상단 ${n(i.bbUpper, 2, '$')} / 중단 ${n(i.bbMiddle, 2, '$')} / 하단 ${n(i.bbLower, 2, '$')}
ATR(14): ${n(i.atr14, 2, '$')}
스토캐스틱: %K ${n(i.stochK, 1)} / %D ${n(i.stochD, 1)}

분석 요청:
1. 현재 기술적 상태 요약
2. ${horizon.label}(${horizon.period}) 방향 의견 + 근거
3. 주요 지지선과 저항선
4. 신뢰도 (높음/중간/낮음)
5. ${horizon.actionPlan}

${DISCLAIMER}`;
}

/** 모드 3 — 보유 주식 분석 */
export function buildPortfolioPrompt(
  portfolio: Portfolio | null,
  summaries: SymbolSummary[],
  exchangeRate: ExchangeRate | null,
  horizonId: InvestmentHorizon = DEFAULT_HORIZON,
): string {
  if (!portfolio || portfolio.holdings.length === 0) {
    return '현재 보유 종목이 없어 이 모드를 사용할 수 없습니다.';
  }

  const { summary: total, holdings } = portfolio;
  const rate = exchangeRate?.rate ?? null;
  const krw =
    rate && Number.isFinite(total.evaluationAmountUsd)
      ? `₩${Math.round(total.evaluationAmountUsd * rate).toLocaleString('ko-KR')} / 환율 ${rate.toLocaleString('ko-KR')}원`
      : NONE;

  const blocks = holdings.map((holding, index) => {
    const found = summaries.find((s) => s.symbol === holding.symbol);
    const i = found?.indicators ?? {};
    const macdStatus =
      i.macdHistogram == null
        ? NONE
        : `${(i.macd ?? 0) > (i.macdSignal ?? 0) ? '시그널선 위(강세)' : '시그널선 아래(약세)'}`;

    return `### ${index + 1}. ${holding.symbol} (${holding.name}) — ${holding.quantity}주
매입단가: ${n(holding.averagePrice, 2, '$')} | 현재가: ${n(holding.currentPrice, 2, '$')} | 손익: ${n(holding.profitLoss, 2, '$')} (${n(holding.profitLossRate, 2, '', '%')})
RSI: ${n(i.rsi14, 1)} | MACD: ${macdStatus} | 20MA ${above(found?.price ?? holding.currentPrice, i.sma20)} | 거래량: 평균 대비 ${n(i.volumeRatio, 0, '', '%')}
섹터: ${found?.fundamentals.sector ?? NONE} | PER: ${n(found?.fundamentals.per)} | PBR: ${n(found?.fundamentals.pbr)}`;
  });

  return `아래는 현재 보유 중인 주식 포트폴리오입니다.

${horizonBlock(horizonId)}
각 종목의 차트 지표와 재무 데이터를 종합하여 분석해주세요.

## 포트폴리오 요약
총 평가금액: ${n(total.evaluationAmountUsd, 2, '$')} (${krw})
총 매입금액: ${n(total.purchaseAmountUsd, 2, '$')}
총 손익: ${n(total.profitLossUsd, 2, '$')} (${n(total.profitLossRate, 2, '', '%')})
당일 손익: ${n(total.dailyProfitLossUsd, 2, '$')} (${n(total.dailyProfitLossRate, 2, '', '%')})

## 보유 종목

${blocks.join('\n\n')}

## 분석 요청
1. 각 종목의 단기 기술적 전망
2. 포트폴리오 전체 리스크 (섹터 편중, 변동성)
3. 리밸런싱 필요 여부
4. 손절/이익실현 권장 종목
5. 환율 리스크 평가 (현재 환율 ${rate ? `${rate.toLocaleString('ko-KR')}원` : NONE})

${DISCLAIMER}`;
}

/** 모드 4 — 종목 비교 */
export function buildComparePrompt(
  summaries: SymbolSummary[],
  horizonId: InvestmentHorizon = DEFAULT_HORIZON,
): string {
  const valid = summaries.filter((s) => s.price != null || s.fundamentals.per != null);
  if (valid.length < 2) {
    return '비교하려면 종목이 2개 이상 필요합니다. 오른쪽에서 비교할 종목을 추가하세요.';
  }

  const blocks = valid.map((s, index) => {
    const label = String.fromCharCode(65 + index); // A, B, C
    const i = s.indicators;
    const fromHigh =
      s.price != null && i.high52w != null && i.high52w
        ? `${(((s.price - i.high52w) / i.high52w) * 100).toFixed(2)}%`
        : NONE;

    return `## 종목 ${label}: ${s.symbol}${s.name ? ` (${s.name})` : ''}
현재가: ${n(s.price, 2, '$')} (전일 대비 ${n(s.changeRate, 2, '', '%')})
섹터: ${s.fundamentals.sector ?? NONE} | 시가총액: ${usd(s.fundamentals.marketCap)}
PER: ${n(s.fundamentals.per)} | PBR: ${n(s.fundamentals.pbr)} | EPS: ${n(s.fundamentals.eps)}
매출성장률: ${ratio(s.fundamentals.revenueGrowth)} | 순이익률: ${ratio(s.fundamentals.profitMargin)} | 부채비율: ${n(s.fundamentals.debtToEquity)}
RSI: ${n(i.rsi14, 1)} | 20MA ${above(s.price, i.sma20)} | 60MA ${above(s.price, i.sma60)}
52주 최고 대비: ${fromHigh} (52주 고가 ${n(i.high52w, 2, '$')} / 저가 ${n(i.low52w, 2, '$')})
배당수익률: ${s.fundamentals.dividendYield == null ? NONE : `${s.fundamentals.dividendYield.toFixed(2)}%`}`;
  });

  return `아래 ${valid.length}개 종목을 비교 분석해주세요.

${horizonBlock(horizonId)}

${blocks.join('\n\n')}

## 비교 분석 요청
1. 밸류에이션 비교 (더 저평가인 쪽과 그 근거)
2. 기술적 상태 비교 (더 매력적인 차트)
3. 리스크 비교
4. 지금 매수한다면 어느 쪽 + 근거

${DISCLAIMER}`;
}
