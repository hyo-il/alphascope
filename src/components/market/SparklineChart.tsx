interface Props {
  data: number[];
  /** 상승/하락에 따라 선과 채움 색이 바뀐다 */
  isUp: boolean;
  width?: number;
  height?: number;
}

/**
 * 미니 추세 차트 — 순수 SVG.
 *
 * 차트 라이브러리를 카드마다 띄우면 무겁다. 축·라벨 없이 흐름만 보여 주면 되므로
 * polyline 하나와 그라데이션 채움으로 충분하다.
 */
export default function SparklineChart({ data, isUp, width = 120, height = 40 }: Props) {
  if (data.length < 2) {
    return <div style={{ width, height }} aria-hidden />;
  }

  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1; // 완전히 평평한 구간에서 0으로 나누지 않도록
  const step = width / (data.length - 1);

  // 위쪽/아래쪽에 약간 여백을 두어 선이 잘리지 않게 한다.
  const pad = 3;
  const usable = height - pad * 2;
  const points = data.map((value, i) => {
    const x = i * step;
    const y = pad + (1 - (value - min) / span) * usable;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const color = isUp ? '#26A69A' : '#EF5350';
  const gradientId = `spark-${isUp ? 'up' : 'down'}`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.28" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* 선 아래 영역을 옅게 채워 방향이 더 잘 보이게 한다 */}
      <polygon
        points={`0,${height} ${points.join(' ')} ${width},${height}`}
        fill={`url(#${gradientId})`}
      />
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
