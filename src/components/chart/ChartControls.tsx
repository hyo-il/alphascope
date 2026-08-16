import type { Timeframe } from '../../types/toss';

const TIMEFRAMES: { value: Timeframe; label: string }[] = [
  { value: '1m', label: '1분' },
  { value: '5m', label: '5분' },
  { value: '15m', label: '15분' },
  { value: '30m', label: '30분' },
  { value: '1d', label: '일봉' },
];

interface Props {
  timeframe: Timeframe;
  onChange: (timeframe: Timeframe) => void;
}

export default function ChartControls({ timeframe, onChange }: Props) {
  return (
    <div className="flex items-center gap-1">
      {TIMEFRAMES.map((tf) => (
        <button
          key={tf.value}
          type="button"
          onClick={() => onChange(tf.value)}
          className={`rounded-md px-3 py-1.5 text-sm transition-colors ${
            timeframe === tf.value
              ? 'bg-accent text-white'
              : 'text-text-secondary hover:bg-bg-tertiary hover:text-text-primary'
          }`}
        >
          {tf.label}
        </button>
      ))}
      {/* 지표 토글은 Step 5(지표 엔진)에서 이 영역에 추가된다. */}
    </div>
  );
}
