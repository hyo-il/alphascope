import SparklineChart from './SparklineChart';

interface Props {
  name: string;
  value: number | null;
  change: number | null;
  changePercent: number | null;
  sparklineData: number[];
  /** 원화 표기가 필요한 항목(환율)에만 붙인다 */
  unit?: string;
}

/** 시황 카드 하나 — 지수명·현재가·변동·미니 차트. */
export default function MarketCard({
  name,
  value,
  change,
  changePercent,
  sparklineData,
  unit = '',
}: Props) {
  const up = changePercent != null && changePercent > 0;
  const down = changePercent != null && changePercent < 0;
  /**
   * 환율 카드는 토스 실시간 시세를 쓰고 등락률이 없다.
   * 그때는 스파크라인의 처음↔마지막으로 선 색을 정한다 — 내림세인데 초록으로 두면 오해를 부른다.
   */
  const trendUp =
    changePercent != null
      ? !down
      : sparklineData.length < 2 || sparklineData[sparklineData.length - 1] >= sparklineData[0];
  const color = up ? 'text-bullish' : down ? 'text-bearish' : 'text-text-muted';

  const format = (n: number) =>
    n.toLocaleString('ko-KR', { maximumFractionDigits: 2, minimumFractionDigits: 2 });

  return (
    <article className="flex min-w-0 items-center justify-between gap-3 rounded-xl bg-bg-secondary px-3 py-2">
      {/* 글자 칸은 줄지 않는다(이름 · 금액 · 등락 모두 한 줄) — 좁은 1280 에서는 미니 차트가 남는 폭만큼 줄어든다 */}
      <div className="shrink-0">
        <p className="whitespace-nowrap text-caption leading-tight text-text-secondary">{name}</p>
        <p className="text-sm font-semibold tabular-nums text-text-primary">
          {value != null ? `${unit}${format(value)}` : '—'}
        </p>
        <p className={`text-caption tabular-nums ${color}`}>
          {changePercent == null ? (
            '—'
          ) : (
            <>
              {/* 방향은 부호로 (▲▼ 기호를 쓰지 않는다). 색은 그대로 */}
              {up ? '+' : down ? '−' : ''}
              {change != null ? format(Math.abs(change)) : ''} ({up ? '+' : down ? '−' : ''}
              {Math.abs(changePercent).toFixed(2)}%)
            </>
          )}
        </p>
      </div>

      <SparklineChart data={sparklineData} isUp={trendUp} width={88} height={44} />
    </article>
  );
}
