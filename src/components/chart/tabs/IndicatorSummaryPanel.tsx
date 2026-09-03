import type { Candle, Timeframe } from '../../../types/toss';
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
      <span className="w-28 shrink-0 text-text-secondary">{label}</span>
      <span className={`w-28 shrink-0 tabular-nums ${tone}`}>{value}</span>
      {note && <span className="min-w-0 text-text-muted">{note}</span>}
    </div>
  );
}

export default function IndicatorSummaryPanel({
  candles,
  timeframe,
  indicators,
  currentPrice,
}: {
  candles: Candle[];
  timeframe: Timeframe;
  indicators: IndicatorSeries | null;
  currentPrice: number | null;
}) {
  const summary = summarize(candles);
  if (!summary) return <p className="p-3 text-xs text-text-muted">캔들이 없습니다.</p>;

  const price = currentPrice ?? summary.price;
  // 장중에는 마지막 봉이 미완성이라 거래량이 평균의 몇 % 로 찍힌다 — 완성 봉 기준으로 본다.
  const volume = completedVolumeRatio(candles, timeframe);

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
        ? `정배열 · 현재가는 20일선 ${price >= summary.ma20 ? '위' : '아래'}`
        : `역배열 · 현재가는 20일선 ${price >= summary.ma20 ? '위' : '아래'}`;

  const bbNote =
    bbLower == null || bbMiddle == null || bbUpper == null
      ? '차트에서 볼린저밴드를 켜면 표시됩니다'
      : price <= bbLower + (bbMiddle - bbLower) * 0.25
        ? '하단 근처'
        : price >= bbUpper - (bbUpper - bbMiddle) * 0.25
          ? '상단 근처'
          : '중단 부근';

  return (
    <div className="p-3 text-[11px]">
      <div className="grid gap-x-8 gap-y-0 md:grid-cols-2">
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
          label="20 / 60일선"
          value={
            summary.ma20 == null || summary.ma60 == null
              ? '—'
              : `${summary.ma20.toFixed(2)} / ${summary.ma60.toFixed(2)}`
          }
          note={maNote}
        />
        <Row
          label="볼린저"
          value={bbLower == null ? '—' : `${bbLower.toFixed(2)}~${bbUpper!.toFixed(2)}`}
          note={bbNote}
        />
        <Row
          label="ATR(14)"
          value={atr == null ? '—' : atr.toFixed(2)}
          note={
            atr == null
              ? '차트에서 ATR 패널을 켜면 표시됩니다'
              : `일일 예상 변동폭 ±${((atr / price) * 100).toFixed(1)}%`
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
              ? '진행 중인 봉을 빼고 직전 완성 봉으로 계산했습니다'
              : '20봉 평균 대비'
          }
        />
        <Row
          label="최근 20봉 고/저"
          value={
            summary.recentHigh == null
              ? '—'
              : `${summary.recentHigh.toFixed(2)} / ${summary.recentLow!.toFixed(2)}`
          }
          note="단순 저항·지지 참고선"
        />
      </div>

      <p className="mt-2 text-[11px] text-text-muted">
        RSI · MACD · MA · 거래량은 이 화면에서 직접 계산합니다(추가 요청 없음). 볼린저 · ATR ·
        스토캐스틱은 차트에 켜 둔 지표의 엔진 계산값을 그대로 보여 줍니다.
      </p>
    </div>
  );
}
