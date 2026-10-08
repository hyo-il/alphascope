import { currencyOfSymbol } from '../../../utils/market';
import { TIMEFRAME_LABEL, type Candle, type Timeframe } from '../../../types/toss';

const UNIT: Partial<Record<Timeframe, { line: string; range: string }>> = {
  '1d': { line: '일선', range: '일일' },
  '1w': { line: '주선', range: '주간' },
  '1M': { line: '개월선', range: '월간' },
};
import type { IndicatorSeries } from '../../../types/chart';
import { summarize } from '../../../utils/indicators';
import { completedVolumeRatio } from '../../../utils/marketBar';

/**
 * 차트 지표 요약.
 *
 * 지표 패널(RSI·MACD)은 차트에 이미 그려지므로, 여기서는 **지금 값이 무엇을 뜻하는지**를
 * 한 줄씩 적는다. 계산은 `utils/indicators.ts`(요약용 TS 구현)로 하고, 차트에 켜 둔
 * 지표가 있으면 엔진 값(볼린저·ATR·스토캐스틱)을 함께 보여 준다 — 이 탭 때문에
 * 지표 엔진을 새로 부르지는 않는다.
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

function Row({
  label,
  value,
  note,
  tone = 'text-text-primary',
}: {
  label: string;
  value: string;
  note?: string;
  tone?: string;
}) {
  return (
    <div className="flex items-baseline gap-2 py-0.5">
      <span className="w-24 shrink-0 whitespace-nowrap text-text-secondary">{label}</span>
      {/* 값 칸은 국내 7자리 가격 두 개(「1,234,000 / 1,200,000」)가 한 줄에 들어가는 폭 — 문구와 겹치지 않고 문구 칸도 너무 좁지 않게 (v2.42.0) */}
      <span className={`w-40 shrink-0 whitespace-nowrap tabular-nums ${tone}`}>{value}</span>
      {note && <span className="min-w-0 text-text-muted">{note}</span>}
    </div>
  );
}

export default function IndicatorSummaryPanel({
  candles,
  timeframe,
  indicators,
  currentPrice,
  symbol = '',
  loading = false,
}: {
  symbol?: string;
  loading?: boolean;
  candles: Candle[];
  timeframe: Timeframe;
  indicators: IndicatorSeries | null;
  currentPrice: number | null;
}) {
  const summary = summarize(candles);
  if (!summary) return <p className="p-3 text-xs text-text-muted">{loading ? '캔들을 불러오는 중…' : '캔들이 없습니다.'}</p>;

  const price = currentPrice ?? summary.price;
  // 장중에는 마지막 봉이 미완성이라 거래량이 평균의 몇 % 로 찍힌다 — 완성 봉 기준으로 본다.
  const volume = completedVolumeRatio(candles, timeframe, 20, symbol);
  /** 가격 숫자는 통화 규칙대로 — 원화는 소수점 없이(예전 toFixed(2) 라 「267550.00」), 달러는 소수 둘째 자리 (v2.42.0) */
  const px = (v: number) => (currencyOfSymbol(symbol) === 'KRW' ? Math.round(v).toLocaleString('ko-KR') : v.toFixed(2));
  // 봉 단위를 문구에 드러낸다 — 주봉에서 "20일선" 이라 쓰면 20주 평균을 20일로 읽는다 (v2.20.0)
  const unit = UNIT[timeframe] ?? { line: '봉선', range: '한 봉' };

  const bbLower = last(indicators?.bbLower);
  const bbMiddle = last(indicators?.bbMiddle);
  const bbUpper = last(indicators?.bbUpper);
  const atr = last(indicators?.atr14);
  const stochK = last(indicators?.stochK);
  const stochD = last(indicators?.stochD);

  const rsiNote =
    summary.rsi == null
      ? ''
      : summary.rsi >= 70
        ? '과매수'
        : summary.rsi >= 55
          ? '상승 우위'
          : summary.rsi > 45
            ? '중립'
            : summary.rsi > 30
              ? '과매도 근접'
              : '과매도';

  const macdNote = (() => {
    if (!summary.macd) return '';
    const { histogram } = summary.macd;
    if (histogram > 0) return '양전환 상태 (상승 우위)';
    return histogram > -0.05 ? '양전환 임박' : '음전환 상태 (하락 우위)';
  })();

  const maNote =
    summary.ma20 == null || summary.ma60 == null
      ? ''
      : summary.ma20 > summary.ma60
        ? `정배열 · 현재가는 20${unit.line} ${price >= summary.ma20 ? '위' : '아래'}`
        : `역배열 · 현재가는 20${unit.line} ${price >= summary.ma20 ? '위' : '아래'}`;

  const bbNote =
    bbLower == null || bbMiddle == null || bbUpper == null
      ? '차트에서 볼린저밴드를 켜면 표시됩니다'
      : price <= bbLower + (bbMiddle - bbLower) * 0.25
        ? '하단 근처'
        : price >= bbUpper - (bbUpper - bbMiddle) * 0.25
          ? '상단 근처'
          : '중단 부근';

  return (
    <div className="p-3 text-caption">
      {(timeframe === '1w' || timeframe === '1M') && (
        <p className="mb-1.5 text-text-muted">
          {TIMEFRAME_LABEL[timeframe]} 기준 — 이동평균·RSI·MACD·거래량 비교가 모두 {TIMEFRAME_LABEL[timeframe]}으로 계산됩니다.
          {volume.forming && ` 마지막 봉(이번 ${timeframe === '1w' ? '주' : '달'})은 아직 진행 중입니다.`}
        </p>
      )}
      <div className="grid gap-x-6 gap-y-0 md:grid-cols-2">
        <Row
          label="RSI(14)"
          value={summary.rsi == null ? '—' : summary.rsi.toFixed(1)}
          note={rsiNote}
        />
        <Row
          label="MACD"
          value={summary.macd == null ? '—' : summary.macd.histogram.toFixed(3)}
          note={macdNote}
        />
        <Row
          label={`20 / 60${unit.line}`}
          value={summary.ma20 == null || summary.ma60 == null ? '—' : `${px(summary.ma20)} / ${px(summary.ma60)}`}
          note={maNote}
        />
        <Row
          label="볼린저"
          // 숫자는 지우고 해석 문구만 (v2.42.0 사용자 요청)
          value={bbLower == null ? '—' : bbNote}
        />
        <Row
          label="ATR(14)"
          value={atr == null ? '—' : px(atr)}
          note={
            atr == null
              ? '차트에서 ATR 패널을 켜면 표시됩니다'
              : `${unit.range} 예상 변동폭 ±${((atr / price) * 100).toFixed(1)}%`
          }
        />
        <Row
          label="스토캐스틱"
          value={stochK == null ? '—' : `${stochK.toFixed(1)} / ${stochD?.toFixed(1) ?? '—'}`}
          note={
            stochK == null
              ? '차트에서 스토캐스틱을 켜면 표시됩니다'
              : stochK > (stochD ?? 0)
                ? '%K가 %D 위 (상승 우위)'
                : '%K가 %D 아래'
          }
        />
        <Row
          label="거래량"
          value={volume.ratio == null ? '—' : `평균 대비 ${Math.round(volume.ratio)}%`}
          note={
            volume.forming
              ? '진행 중인 봉을 제외하고 직전 완성 봉으로 계산했습니다'
              : '20봉 평균 대비'
          }
        />
        <Row
          label="최근 20봉 고/저"
          value={summary.recentHigh == null ? '—' : `${px(summary.recentHigh)} / ${px(summary.recentLow!)}`}
          note="단순 저항·지지 참고선"
        />
      </div>

      <p className="mt-2 text-caption text-text-muted">
        RSI · MACD · MA · 거래량은 이 화면에서 직접 계산합니다(추가 요청 없음). 볼린저 · ATR ·
        스토캐스틱은 차트에 켜 둔 지표의 엔진 계산값을 그대로 보여 줍니다.
      </p>
    </div>
  );
}
