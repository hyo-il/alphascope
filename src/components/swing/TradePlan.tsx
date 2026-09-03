import type { SwingRecommendation } from '../../types/swing';

/**
 * 매수 · 목표 · 손절을 하나의 가격 축 위에 그린다.
 *
 * 표로만 적으면 "리워드가 리스크보다 넓다" 가 눈에 들어오지 않는다.
 * 비율이 나쁜 추천은 빨간 구간이 초록 구간만큼 넓어져 한눈에 보인다.
 */
export default function TradePlan({
  plan,
  currency = 'USD',
}: {
  plan: Pick<SwingRecommendation, 'entry' | 'targets' | 'stopLoss' | 'currentPrice'>;
  currency?: 'KRW' | 'USD';
}) {
  const entry = plan.entry.price;
  const { target1, target2 } = plan.targets;
  const stop = plan.stopLoss.price;

  if (!entry || !stop || !target1.price) {
    return <p className="text-[11px] text-text-muted">매매 계획을 계산하지 못했습니다.</p>;
  }

  const top = Math.max(target2.price, target1.price, plan.currentPrice);
  const bottom = Math.min(stop, plan.currentPrice);
  const span = Math.max(1e-9, top - bottom);
  /** 값 → 위에서부터의 위치(%) */
  const y = (price: number) => ((top - price) / span) * 100;

  const money = (value: number) =>
    currency === 'KRW' ? `₩${Math.round(value).toLocaleString('ko-KR')}` : `$${value.toFixed(2)}`;

  const rows: { price: number; label: string; percent: number | null; tone: string; icon: string }[] = [
    { price: target2.price, label: '2차 목표', percent: target2.percent, tone: 'text-bullish', icon: '🎯' },
    { price: target1.price, label: '1차 목표', percent: target1.percent, tone: 'text-bullish', icon: '🎯' },
    { price: entry, label: '매수가', percent: null, tone: 'text-text-primary', icon: '➡️' },
    { price: stop, label: '손절가', percent: plan.stopLoss.maxLossPercent, tone: 'text-bearish', icon: '🛑' },
  ];

  return (
    <div className="flex gap-3">
      {/* 리스크(빨강) · 리워드(초록) 구간 막대 */}
      <div className="relative w-2 shrink-0 rounded bg-bg-tertiary" style={{ height: 132 }}>
        <span
          className="absolute left-0 w-full rounded bg-bullish/40"
          style={{ top: `${y(target2.price)}%`, height: `${y(entry) - y(target2.price)}%` }}
        />
        <span
          className="absolute left-0 w-full rounded bg-bearish/40"
          style={{ top: `${y(entry)}%`, height: `${y(stop) - y(entry)}%` }}
        />
        <span
          className="absolute left-[-2px] h-0.5 w-[calc(100%+4px)] bg-text-primary"
          style={{ top: `${y(entry)}%` }}
        />
      </div>

      <div className="relative min-w-0 flex-1" style={{ height: 132 }}>
        {rows.map((row) => (
          <div
            key={row.label}
            className="absolute flex w-full -translate-y-1/2 items-baseline gap-2 text-[11px]"
            style={{ top: `${y(row.price)}%` }}
          >
            <span className="w-14 shrink-0 tabular-nums text-text-primary">{money(row.price)}</span>
            <span className={`w-16 shrink-0 ${row.tone}`}>{row.label}</span>
            <span className={`tabular-nums ${row.tone}`}>
              {row.percent != null
                ? `${row.percent > 0 ? '+' : ''}${row.percent.toFixed(1)}%`
                : '기준'}
            </span>
            <span>{row.icon}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
