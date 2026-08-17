import { ANALYSIS_MODES, type AnalysisMode } from '../../types/analysis';

interface Props {
  mode: AnalysisMode;
  onChange: (mode: AnalysisMode) => void;
  /** 보유 종목이 없으면 포트폴리오 모드를 쓸 수 없다 */
  portfolioAvailable: boolean;
}

/** 분석 모드 카드 — 아이콘을 위, 이름을 아래에 두어 이름이 접히지 않게 한다. */
export default function ModeSelector({ mode, onChange, portfolioAvailable }: Props) {
  return (
    // 좌측 패널 폭(320px)에 4개를 한 줄로 넣으면 카드가 잘린다. 2×2 로 배치한다.
    <div className="grid grid-cols-2 gap-3">
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
            className={`flex flex-col items-center gap-1.5 rounded-lg border px-3 py-4 text-center transition-colors ${
              active
                ? 'border-accent bg-accent/10'
                : 'border-border bg-bg-tertiary/40 hover:border-text-muted'
            } ${disabled ? 'cursor-not-allowed opacity-40' : ''}`}
          >
            <span className="text-2xl leading-none">{item.icon}</span>
            <span
              className={`text-sm font-semibold whitespace-nowrap ${
                active ? 'text-accent' : 'text-text-primary'
              }`}
            >
              {item.label}
            </span>
            <span className="text-[11px] leading-snug text-text-secondary">
              {item.description}
            </span>
          </button>
        );
      })}
    </div>
  );
}
