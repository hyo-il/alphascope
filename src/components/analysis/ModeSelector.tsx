import { ANALYSIS_MODES, type AnalysisMode } from '../../types/analysis';

interface Props {
  mode: AnalysisMode;
  onChange: (mode: AnalysisMode) => void;
  /** 보유 종목이 없으면 포트폴리오 모드를 쓸 수 없다 */
  portfolioAvailable: boolean;
}

export default function ModeSelector({ mode, onChange, portfolioAvailable }: Props) {
  return (
    <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
      {ANALYSIS_MODES.map((item) => {
        const disabled = item.id === 'portfolio' && !portfolioAvailable;
        const active = mode === item.id;

        return (
          <button
            key={item.id}
            type="button"
            disabled={disabled}
            onClick={() => onChange(item.id)}
            title={disabled ? '보유 중인 종목이 없습니다' : item.description}
            className={`rounded-lg border px-3 py-2 text-left transition-colors ${
              active
                ? 'border-accent bg-accent/10'
                : 'border-border bg-bg-tertiary/40 hover:border-text-muted'
            } ${disabled ? 'cursor-not-allowed opacity-40' : ''}`}
          >
            <div className="text-sm">
              <span className="mr-1">{item.icon}</span>
              <span className={active ? 'font-medium text-accent' : 'text-text-primary'}>
                {item.label}
              </span>
            </div>
            <div className="mt-0.5 text-[11px] text-text-muted">{item.description}</div>
          </button>
        );
      })}
    </div>
  );
}
