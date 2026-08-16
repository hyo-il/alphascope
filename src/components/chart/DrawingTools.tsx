import { useEffect } from 'react';

/** 툴바에 노출할 도구 — 플러그인의 67종 중 스윙 트레이딩에 자주 쓰는 것만 추린다. */
export const DRAWING_TOOLS = [
  { type: null, label: '커서', hint: '드로잉 해제 (Esc)' },
  { type: 'horizontal-line', label: '수평선', hint: '지지/저항선 — 클릭한 가격에 선' },
  { type: 'trend-line', label: '추세선', hint: '두 점을 잇는 추세선' },
  { type: 'date-price-range', label: '자', hint: '드래그 구간의 ±% 와 봉 수 측정' },
  { type: 'fib-retracement', label: '피보나치', hint: '되돌림 레벨' },
  { type: 'rectangle', label: '박스', hint: '박스권 표시' },
] as const;

export type DrawingToolType = (typeof DRAWING_TOOLS)[number]['type'];

interface Props {
  activeTool: DrawingToolType;
  onSelect: (tool: DrawingToolType) => void;
  onClearAll: () => void;
  onDeleteSelected: () => void;
  hasDrawings: boolean;
}

export default function DrawingTools({
  activeTool,
  onSelect,
  onClearAll,
  onDeleteSelected,
  hasDrawings,
}: Props) {
  // Esc = 드로잉 취소, Delete/Backspace = 선택한 드로잉 삭제
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;

      if (e.key === 'Escape') onSelect(null);
      if (e.key === 'Delete' || e.key === 'Backspace') onDeleteSelected();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onSelect, onDeleteSelected]);

  return (
    <div className="flex items-center gap-1">
      {DRAWING_TOOLS.map((tool) => (
        <button
          key={tool.label}
          type="button"
          title={tool.hint}
          onClick={() => onSelect(tool.type)}
          className={`rounded-md px-2.5 py-1.5 text-sm transition-colors ${
            activeTool === tool.type
              ? 'bg-accent text-white'
              : 'text-text-secondary hover:bg-bg-tertiary hover:text-text-primary'
          }`}
        >
          {tool.label}
        </button>
      ))}

      <span className="mx-1 h-5 w-px bg-border" />

      <button
        type="button"
        onClick={onClearAll}
        disabled={!hasDrawings}
        title="그린 것 전체 삭제"
        className="rounded-md px-2.5 py-1.5 text-sm text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-bearish disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-text-secondary"
      >
        전체 삭제
      </button>
    </div>
  );
}
