import type { Candle, Timeframe } from '../../types/toss';
import { summarize } from '../../utils/indicators';

const TIMEFRAME_LABEL: Record<Timeframe, string> = {
  '1m': '1분봉',
  '5m': '5분봉',
  '15m': '15분봉',
  '30m': '30분봉',
  '1d': '일봉',
};

function fmt(value: number | null | undefined, digits = 2): string {
  return value == null || !Number.isFinite(value) ? '데이터 부족' : value.toFixed(digits);
}

/**
 * 차트와 함께 Claude 대화에 붙여넣을 요약 텍스트를 만든다 (방식 B — 수동 분석).
 * 지표 수치는 화면에 그려진 것과 동일한 캔들에서 계산한다.
 */
export function buildAnalysisText(
  symbol: string,
  timeframe: Timeframe,
  candles: Candle[],
  currentPrice: number | null,
): string {
  const s = summarize(candles);
  if (!s) return `종목: ${symbol}\n캔들 데이터가 없습니다.`;

  const price = currentPrice ?? s.price;
  const maPosition =
    s.ma20 == null ? '알 수 없음' : price >= s.ma20 ? '위 (지지 시도)' : '아래 (저항 상태)';

  const macdText = s.macd
    ? `${s.macd.isBullish ? '시그널선 위 (강세)' : '시그널선 아래 (약세)'}, 히스토그램 ${fmt(
        s.macd.histogram,
        3,
      )} (${s.macd.isExpanding ? '확대 중' : '축소 중'})`
    : '데이터 부족';

  return [
    `종목: ${symbol}`,
    `타임프레임: ${TIMEFRAME_LABEL[timeframe]}`,
    `기준 시각: ${new Date().toLocaleString('ko-KR')}`,
    `현재가: $${fmt(price)}`,
    '',
    `RSI(14): ${fmt(s.rsi, 1)}`,
    `MACD(12,26,9): ${macdText}`,
    `20MA: $${fmt(s.ma20)} (현재가 ${maPosition})`,
    `60MA: $${fmt(s.ma60)}`,
    `거래량: 최근 20봉 평균 대비 ${fmt(s.volumeRatio, 0)}%`,
    `최근 20봉 고가: $${fmt(s.recentHigh)} / 저가: $${fmt(s.recentLow)}`,
    '',
    '이 차트와 지표를 기반으로 단기 기술적 분석 의견을 주세요.',
    '스윙 트레이딩(수일~수주 보유) 관점이며, 투자 조언이 아닌 참고 의견으로 받겠습니다.',
  ].join('\n');
}
