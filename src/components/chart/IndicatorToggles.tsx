import type {
  IndicatorToggles as Toggles,
  OverlayIndicator,
  PanelIndicator,
} from '../../types/chart';

const OVERLAY_LABELS: Record<OverlayIndicator, string> = {
  ma: 'MA',
  ema: 'EMA',
  bb: 'BB',
  vwap: 'VWAP',
};

const PANEL_LABELS: Record<PanelIndicator, string> = {
  rsi: 'RSI',
  macd: 'MACD',
  stoch: 'Stoch',
};

interface Props {
  toggles: Toggles;
  onChange: (toggles: Toggles) => void;
  loading: boolean;
}

export default function IndicatorToggles({ toggles, onChange, loading }: Props) {
  const button = (label: string, active: boolean, onClick: () => void) => (
    <button
      key={label}
      type="button"
      onClick={onClick}
      className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
        active
          ? 'bg-accent/20 text-accent ring-1 ring-accent/40'
          : 'text-text-secondary hover:bg-bg-tertiary hover:text-text-primary'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex items-center gap-1">
      <span className="mr-1 text-xs text-text-muted">지표</span>

      {(Object.keys(OVERLAY_LABELS) as OverlayIndicator[]).map((key) =>
        button(OVERLAY_LABELS[key], toggles.overlays[key], () =>
          onChange({
            ...toggles,
            overlays: { ...toggles.overlays, [key]: !toggles.overlays[key] },
          }),
        ),
      )}

      <span className="mx-1 h-4 w-px bg-border" />

      {(Object.keys(PANEL_LABELS) as PanelIndicator[]).map((key) =>
        button(PANEL_LABELS[key], toggles.panels[key], () =>
          onChange({
            ...toggles,
            panels: { ...toggles.panels, [key]: !toggles.panels[key] },
          }),
        ),
      )}

      {loading && <span className="ml-1 text-xs text-text-muted">계산 중…</span>}
    </div>
  );
}
