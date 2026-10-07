import { Button, Segmented } from '../ui';
import { TIMEFRAME_ITEMS, type IndicatorToggles } from '../../types/chart';
import type { Timeframe } from '../../types/toss';
import DrawingTools, { type DrawingToolType } from './DrawingTools';
import IndicatorDropdown from './IndicatorDropdown';

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
  /** 확대·위치를 처음으로(드로잉은 남긴다) */
  onResetView: () => void;
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
  onResetView,
}: Props) {
  return (
    <div className="flex flex-wrap items-center gap-x-1 gap-y-1 border-b border-border/60 px-3 py-1.5">
      {/* 봉 = 회색 묶음 버튼 (v2.36.0 공용 Segmented) */}
      <Segmented
        label="봉 단위"
        size="sm"
        value={timeframe}
        onChange={onTimeframeChange}
        options={TIMEFRAME_ITEMS.map((tf) => ({ value: tf.value, label: tf.short, title: tf.label }))}
      />
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

      <span className="mx-1.5 h-4 w-px bg-border" />
      {/* 확대·위치만 처음으로 — 그린 선은 남는다 (v2.41.0) */}
      <Button size="sm" variant="ghost" onClick={onResetView} title="확대·위치를 처음으로" className="shrink-0 whitespace-nowrap">
        초기화
      </Button>
    </div>
  );
}
