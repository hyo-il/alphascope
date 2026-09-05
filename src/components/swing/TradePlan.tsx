import type { SwingRecommendation } from '../../types/swing';

/**
 * 매수 · 목표 · 손절을 **표로** 적고, 왼쪽에 리스크/리워드 막대를 함께 둔다.
 *
 * 예전에는 가격 축 위에 라벨을 절대 위치로 얹었는데, 1·2차 목표가 0.1% 차이면
 * 라벨이 그대로 포개졌다. 표는 값이 아무리 가까워도 겹치지 않는다 —
 * 대신 "리워드가 리스크보다 넓다" 는 감각은 왼쪽 막대가 맡는다.
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

  const money = (value: number) =>
    currency === 'KRW' ? `₩${Math.round(value).toLocaleString('ko-KR')}` : `$${value.toFixed(2)}`;

  const rows: { price: number; label: string; percent: number | null; tone: string; icon: string }[] = [
    { price: target2.price, label: '2차 목표', percent: target2.percent, tone: 'text-bullish', icon: '🎯' },
    { price: target1.price, label: '1차 목표', percent: target1.percent, tone: 'text-bullish', icon: '🎯' },
    { price: entry, label: '매수가', percent: null, tone: 'text-text-primary', icon: '➡️' },
    { price: stop, label: '손절가', percent: plan.stopLoss.maxLossPercent, tone: 'text-bearish', icon: '🛑' },
  ];

  // 막대 비율 — 매수가를 기준으로 위(리워드)와 아래(리스크)의 크기를 비교한다.
  const reward = Math.max(0, target2.price - entry);
  const risk = Math.max(0, entry - stop);
  const total = reward + risk || 1;

  return (
    <div className="flex gap-3">
      <div className="flex w-1.5 shrink-0 flex-col overflow-hidden rounded">
        <span className="bg-bullish/50" style={{ flexGrow: reward / total }} />
        <span className="h-px shrink-0 bg-text-primary" />
        <span className="bg-bearish/50" style={{ flexGrow: risk / total }} />
      </div>

      {/* 열 너비를 고정해 값이 길어져도 라벨과 겹치지 않게 한다 */}
      <table className="min-w-0 flex-1 text-[11px] tabular-nums">
        <tbody>
          {rows.map((row) => (
            <tr key={row.label}>
              <td className="w-[92px] py-0.5 pr-2 text-right font-medium text-text-primary">
                {money(row.price)}
              </td>
              <td className={`w-[68px] py-0.5 pr-2 ${row.tone}`}>{row.label}</td>
              <td className={`w-[64px] py-0.5 pr-1 text-right ${row.tone}`}>
                {row.percent != null
                  ? `${row.percent > 0 ? '+' : ''}${row.percent.toFixed(1)}%`
                  : '기준'}
              </td>
              <td className="py-0.5">{row.icon}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
