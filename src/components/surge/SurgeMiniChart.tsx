/**
 * 급등 이력 미니 차트 — 순수 SVG.
 *
 * 카드마다 차트 라이브러리를 띄우면 무겁고, 여기서 필요한 것은 축도 라벨도 아닌
 * "막대 간격이 고른가" 하나다 (시황 카드 스파크라인과 같은 방침).
 *
 * ⚠️ X 축은 **실제 날짜에 비례**시킨다. 균등 간격으로 그리면 불규칙한 종목도
 * 규칙적으로 보여, 이 차트를 보는 이유가 사라진다.
 */
export default function SurgeMiniChart({
  history,
  height = 64,
}: {
  history: { date: string; changePercent: number }[];
  height?: number;
}) {
  if (!history.length) {
    return <p className="text-[11px] text-text-muted">표시할 급등 이력이 없습니다.</p>;
  }

  const width = 100; // viewBox 기준. 실제 폭은 CSS 가 늘린다.
  const times = history.map((h) => Date.parse(h.date));
  const first = times[0];
  const span = Math.max(1, times.at(-1)! - first);
  const maxPercent = Math.max(...history.map((h) => h.changePercent), 1);

  // 막대가 양끝에서 잘리지 않도록 안쪽으로 들여 그린다.
  const inset = 4;
  const x = (time: number) => inset + ((time - first) / span) * (width - inset * 2);

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        preserveAspectRatio="none"
        className="h-16 w-full"
        role="img"
        aria-label="급등 이력"
      >
        {history.map((event, index) => {
          const barHeight = Math.max(3, (event.changePercent / maxPercent) * (height - 14));
          return (
            <rect
              key={`${event.date}-${index}`}
              x={x(times[index]) - 1}
              y={height - barHeight}
              width={2}
              height={barHeight}
              fill="#26A69A"
              rx={0.5}
            >
              <title>{`${event.date} +${event.changePercent.toFixed(1)}%`}</title>
            </rect>
          );
        })}
      </svg>

      <div className="flex justify-between text-[10px] text-text-muted">
        <span>{history[0].date.slice(5)}</span>
        <span className="text-bullish">
          평균 +
          {(history.reduce((sum, h) => sum + h.changePercent, 0) / history.length).toFixed(1)}%
        </span>
        <span>{history.at(-1)!.date.slice(5)}</span>
      </div>
    </div>
  );
}
