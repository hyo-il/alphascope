import { ANALYSIS_MODES, type AnalysisMode } from '../../types/analysis';

interface Props {
  mode: AnalysisMode;
  onChange: (mode: AnalysisMode) => void;
  /** 보유 종목이 없으면 포트폴리오 모드를 쓸 수 없다 */
  portfolioAvailable: boolean;
}

/**
 * 분석 방식 — 작은 세그먼트 한 줄 (v2.28.0, 예전에는 아이콘·설명이 든 카드 3장).
 * 복사될 내용을 정하는 첫 선택이라 남기되 버튼보다 앞에 나서지 않게 줄였다. 설명은 툴팁으로.
 */
export default function ModeSelector({ mode, onChange, portfolioAvailable }: Props) {
  return (
    <div role="radiogroup" aria-label="분석 방식" className="inline-flex rounded-md border border-border p-0.5">
      {ANALYSIS_MODES.map((item) => {
        const disabled = item.id === 'portfolio' && !portfolioAvailable;
        const active = mode === item.id;
        return (
          <button
            key={item.id}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={disabled}
            onClick={() => onChange(item.id)}
            title={disabled ? '보유 중인 종목이 없습니다' : item.description}
            className={`whitespace-nowrap rounded px-2.5 py-1 text-xs transition-colors ${
              active ? 'bg-accent/15 font-medium text-accent' : 'text-text-secondary hover:text-text-primary'
            } ${disabled ? 'cursor-not-allowed opacity-40' : ''}`}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}
