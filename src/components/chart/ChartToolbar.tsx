import type { IndicatorToggles } from '../../types/chart';
import type { Timeframe } from '../../types/toss';
import DrawingTools, { type DrawingToolType } from './DrawingTools';
import IndicatorDropdown from './IndicatorDropdown';

const TIMEFRAMES: { value: Timeframe; label: string }[] = [
  { value: '1m', label: '1분' },
  { value: '5m', label: '5분' },
  { value: '15m', label: '15분' },
  { value: '30m', label: '30분' },
  { value: '1d', label: '일봉' },
];

interface Props {
  timeframe: Timeframe;
  onTimeframeChange: (timeframe: Timeframe) => void;
  toggles: IndicatorToggles;
  onTogglesChange: (toggles: IndicatorToggles) => void;
  indicatorsLoading: boolean;
  activeTool: DrawingToolType;
  onToolSelect: (tool: DrawingToolType) => void;
  onClearDrawings: () => void;
  onDeleteSelected: () => void;
  hasDrawings: boolean;
}

/**
 * 차트 바로 위 도구 모음 — 타임프레임 · 지표 · 드로잉.
 * 차트와 물리적으로 붙여 시선 이동을 줄인다 (토스 WTS 방식).
 */
export default function ChartToolbar({
  timeframe,
  onTimeframeChange,
  toggles,
  onTogglesChange,
  indicatorsLoading,
  activeTool,
  onToolSelect,
  onClearDrawings,
  onDeleteSelected,
  hasDrawings,
}: Props) {
  return (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-1 border-b border-border px-3 py-1.5">
      {TIMEFRAMES.map((tf) => (
        <button
          key={tf.value}
          type="button"
          onClick={() => onTimeframeChange(tf.value)}
          className={`rounded px-2 py-1 text-xs transition-colors ${
            timeframe === tf.value
              ? 'bg-accent/15 font-medium text-accent'
              : 'text-text-secondary hover:bg-bg-tertiary hover:text-text-primary'
          }`}
        >
          {tf.label}
        </button>
      ))}

      <span className="mx-1.5 h-4 w-px bg-border" />

      <IndicatorDropdown
        toggles={toggles}
        onChange={onTogglesChange}
        loading={indicatorsLoading}
      />

      <span className="mx-1.5 h-4 w-px bg-border" />

      <DrawingTools
        activeTool={activeTool}
        onSelect={onToolSelect}
        onClearAll={onClearDrawings}
        onDeleteSelected={onDeleteSelected}
        hasDrawings={hasDrawings}
      />
    </div>
  );
}
