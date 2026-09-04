import type { Fundamentals, PeerSummary } from '../../types/company';
import type { Candle, Holding, Timeframe } from '../../types/toss';
import { summarize } from '../../utils/indicators';
import { completedVolumeRatio } from '../../utils/marketBar';
import {
  AGENTS,
  CROSS_REVIEW_PROMPT,
  DISCLAIMER,
  MODERATOR_PROMPT,
} from './prompts';
import { stockNameOf } from '../../utils/stockNames';

/**
 * 멀티 에이전트 분석 프롬프트를 만든다 (방식 B — 붙여넣기용).
 *
 * 앱이 하는 일은 "Claude 에게 보낼 최적의 입력을 정리하는 것"까지다.
 * 실제 추론은 구독 대화에서 이뤄지므로 API 비용이 들지 않는다.
 */

const TIMEFRAME_LABEL: Record<Timeframe, string> = {
  '1m': '1분봉',
  '5m': '5분봉',
  '15m': '15분봉',
  '30m': '30분봉',
  '1d': '일봉',
};

function fmt(value: number | null | undefined, digits = 2): string {
  return value == null || !Number.isFinite(value) ? '—' : value.toFixed(digits);
}

/** 소수 비율 → 퍼센트 문자열 */
function pct(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? '—' : `${(value * 100).toFixed(2)}%`;
}

/** 큰 금액을 읽기 쉬운 단위로 (예: 4.46조 달러 → $4.46T) */
function usd(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const units: [number, string][] = [
    [1e12, 'T'],
    [1e9, 'B'],
    [1e6, 'M'],
  ];
  for (const [size, suffix] of units) {
    if (Math.abs(value) >= size) return `$${(value / size).toFixed(2)}${suffix}`;
  }
  return `$${value.toLocaleString('en-US')}`;
}

function median(values: (number | null)[]): number | null {
  const sorted = values.filter((v): v is number => v != null && Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** 차트·지표 블록 — 기술 분석가와 퀀트가 쓴다 */
function marketBlock(
  symbol: string,
  /** 기업명 — 모델이 티커만 보고 다른 회사로 착각하지 않게 함께 적는다 */
  name: string | null,
  timeframe: Timeframe,
  candles: Candle[],
  currentPrice: number | null,
): string {
  const s = summarize(candles);
  if (!s) return `## 시세 데이터\n캔들 데이터가 없습니다.`;

  // 진행 중인 봉의 거래량을 그대로 쓰면 '거래량 급감' 으로 오독된다.
  const volume = completedVolumeRatio(candles, timeframe);

  const price = currentPrice ?? s.price;
  const macd = s.macd
    ? `${s.macd.isBullish ? '시그널선 위(강세)' : '시그널선 아래(약세)'}, 히스토그램 ${fmt(
        s.macd.histogram,
        3,
      )} ${s.macd.isExpanding ? '확대 중' : '축소 중'}`
    : '—';

  // 최근 흐름을 캔들 몇 개로 보여 준다 (이미지가 없을 때도 판단할 수 있도록).
  // 분봉은 날짜만 적으면 같은 날짜가 10줄 반복돼 순서를 알 수 없다 — 시각까지 적는다.
  const slice = candles.slice(-10);
  const recent = slice.map((c, index) => {
    const iso = new Date(c.timestamp).toISOString();
    const stamp = timeframe === '1d' ? iso.slice(0, 10) : iso.slice(0, 16).replace('T', ' ');
    const mark = volume.forming && index === slice.length - 1 ? '  ← 진행 중(미확정)' : '';
    return `${stamp} O${fmt(c.open)} H${fmt(c.high)} L${fmt(c.low)} C${fmt(c.close)} V${c.volume}${mark}`;
  });

  return `## 시세 · 기술적 지표
- 종목: ${symbol}${name ? ` (${name})` : ''}
- 타임프레임: ${TIMEFRAME_LABEL[timeframe]}
- 기준 시각: ${new Date().toLocaleString('ko-KR')}
- 현재가: $${fmt(price)}
- RSI(14): ${fmt(s.rsi, 1)}
- MACD(12,26,9): ${macd}
- 20MA: $${fmt(s.ma20)} (현재가 ${s.ma20 != null && price >= s.ma20 ? '위' : '아래'})
- 60MA: $${fmt(s.ma60)}
- 거래량: 최근 20봉 평균 대비 ${fmt(volume.ratio ?? s.volumeRatio, 0)}%${
    volume.forming ? ' (직전 완성 봉 기준 — 마지막 봉은 아직 진행 중)' : ''
  }
- 최근 20봉 고가: $${fmt(s.recentHigh)} / 저가: $${fmt(s.recentLow)}

### 최근 10봉 OHLCV
${recent.join('\n')}`;
}

/** 재무 블록 — 펀더멘탈 애널리스트가 쓴다 */
function fundamentalBlock(data: Fundamentals | null, peers: PeerSummary[] | null): string {
  if (!data) {
    return `## 기업 재무 데이터
(불러오지 못했습니다 — 펀더멘탈 분석은 공개 정보를 근거로 하되, 추정임을 명시해 주세요.)`;
  }

  const { profile, valuation, profitability, stability, dividend } = data;
  const peerPer = median((peers ?? []).map((p) => p.per));
  const peerPbr = median((peers ?? []).map((p) => p.pbr));

  const peerLines = (peers ?? [])
    .map((p) => `  - ${p.symbol}: PER ${fmt(p.per)} / PBR ${fmt(p.pbr)} / 순이익률 ${pct(p.profitMargin)}`)
    .join('\n');

  const income = data.incomeStatement
    .slice(0, 3)
    .map(
      (row) =>
        `  - ${row.period}: 매출 ${usd(row['Total Revenue'] as number)} / 영업이익 ${usd(
          row['Operating Income'] as number,
        )} / 순이익 ${usd(row['Net Income'] as number)}`,
    )
    .join('\n');

  return `## 기업 재무 데이터 (yfinance)
- 기업명: ${profile.name ?? '—'} / 섹터: ${profile.sector ?? '—'} / 산업: ${profile.industry ?? '—'}
- 시가총액: ${usd(profile.marketCap)}
- PER ${fmt(valuation.per)} (업종 중앙값 ${fmt(peerPer)}) / 선행 PER ${fmt(valuation.forwardPer)}
- PBR ${fmt(valuation.pbr)} (업종 중앙값 ${fmt(peerPbr)}) / EPS ${fmt(valuation.eps)} / PEG ${fmt(valuation.peg)}
- 매출 성장률 ${pct(profitability.revenueGrowth)} / 이익 성장률 ${pct(profitability.earningsGrowth)}
- 영업이익률 ${pct(profitability.operatingMargin)} / 순이익률 ${pct(profitability.profitMargin)} / ROE ${pct(profitability.roe)}
- 부채비율 ${fmt(stability.debtToEquity)} / 유동비율 ${fmt(stability.currentRatio)}
- 배당수익률 ${fmt(dividend.yield)}% / 배당성향 ${pct(dividend.payoutRatio)}

### 연간 실적 (단위: USD)
${income || '  - 데이터 없음'}

### 동종업계
${peerLines || '  - 비교 데이터 없음'}`;
}

/** 보유 현황 블록 — 리스크 매니저가 쓴다 */
function holdingBlock(holding: Holding | null): string {
  if (!holding) return `## 보유 현황\n- 현재 이 종목을 보유하고 있지 않습니다 (신규 진입 검토).`;

  return `## 보유 현황
- 보유 수량: ${holding.quantity}주
- 평균 매입가: $${fmt(holding.averagePrice)} / 현재가: $${fmt(holding.currentPrice)}
- 평가손익: $${fmt(holding.profitLoss)} (${fmt(holding.profitLossRate)}%)
- ※ 이미 보유 중이므로 신규 진입뿐 아니라 **보유 유지 / 추가 매수 / 손절** 관점도 함께 판단해 주세요.`;
}

import {
  DEFAULT_HORIZON,
  horizonBlock,
  horizonOf,
  type InvestmentHorizon,
} from './horizons';

export interface PromptOptions {
  symbol: string;
  timeframe: Timeframe;
  candles: Candle[];
  currentPrice: number | null;
  fundamentals: Fundamentals | null;
  peers: PeerSummary[] | null;
  holding: Holding | null;
  /** 2라운드 교차 검증 포함 여부 */
  crossReview: boolean;
  /** 투자 기간 — 각 전문가와 의장의 판단 시간축을 정한다 */
  horizon?: InvestmentHorizon;
}

/** 5개 에이전트 역할이 모두 담긴 최종 프롬프트 */
export function buildMultiAgentPrompt(options: PromptOptions): string {
  const { symbol, crossReview } = options;
  const horizon = horizonOf(options.horizon ?? DEFAULT_HORIZON);

  // 각 전문가에게도 기간을 붙인다 — 역할별 판단이 서로 다른 시간축을 보면 종합이 안 된다.
  /*
   * 기업명은 재무 데이터에서 먼저 찾고, 없으면 전종목 카탈로그 캐시에서 가져온다.
   * 티커만 적으면 모델이 다른 회사로 읽는 일이 생긴다 (특히 국내 6자리 코드).
   */
  const companyName = options.fundamentals?.profile.name ?? stockNameOf(symbol) ?? null;

  const agentSections = AGENTS.map(
    (agent, index) => `### ${index + 1}. ${agent.name} (${agent.headline}) — 투자 기간: ${horizon.label}(${horizon.period})
${agent.body}`,
  ).join('\n\n');

  return `# ${symbol}${companyName ? ` (${companyName})` : ''} 멀티 전문가 분석 요청

첨부한 차트 이미지와 아래 데이터를 근거로, **5명의 전문가 역할을 순서대로 모두 수행**해 주세요.
각 역할은 독립적으로 판단하고, 앞선 역할의 결론에 끌려가지 마세요.

${horizonBlock(options.horizon ?? DEFAULT_HORIZON)}

${marketBlock(options.symbol, companyName, options.timeframe, options.candles, options.currentPrice)}

${fundamentalBlock(options.fundamentals, options.peers)}

${holdingBlock(options.holding)}

---

## 1라운드: 독립 분석
아래 네 역할을 각각 수행하세요.

${agentSections}
${crossReview ? `\n---\n\n${CROSS_REVIEW_PROMPT}\n` : ''}
---

## ${crossReview ? '3' : '2'}라운드: 종합 판단

${MODERATOR_PROMPT}

**액션 플랜의 시간축**: ${horizon.actionPlan}

---

${DISCLAIMER}`;
}
