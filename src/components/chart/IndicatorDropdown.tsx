import { useEffect, useRef, useState } from 'react';
import {
  MA_LINES,
  OVERLAY_ITEMS,
  PANEL_ITEMS,
  type IndicatorToggles,
  type OverlayIndicator,
  type PanelIndicator,
} from '../../types/chart';

interface Props {
  toggles: IndicatorToggles;
  onChange: (toggles: IndicatorToggles) => void;
  loading: boolean;
}

/** 보조지표 추가/삭제 드롭다운 — 오버레이와 별도 패널을 구분해 보여 준다. */
export default function IndicatorDropdown({ toggles, onChange, loading }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // 바깥 클릭·Esc 로 닫는다.
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };

    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  const activeCount =
    Object.values(toggles.overlays).filter(Boolean).length +
    Object.values(toggles.panels).filter(Boolean).length;

  const toggleOverlay = (key: OverlayIndicator) =>
    onChange({ ...toggles, overlays: { ...toggles.overlays, [key]: !toggles.overlays[key] } });

  const togglePanel = (key: PanelIndicator) =>
    onChange({ ...toggles, panels: { ...toggles.panels, [key]: !toggles.panels[key] } });

  const row = (
    checked: boolean,
    label: string,
    onClick: () => void,
    options: { indent?: boolean; color?: string } = {},
  ) => (
    <button
      key={label}
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-bg-tertiary ${
        options.indent ? 'pl-6' : ''
      }`}
    >
      <span className={checked ? 'text-accent' : 'text-text-muted'}>{checked ? '☑' : '☐'}</span>
      {options.color && (
        <span
          className="h-0.5 w-3 shrink-0 rounded"
          style={{ backgroundColor: options.color }}
          aria-hidden
        />
      )}
      <span className={checked ? 'text-text-primary' : 'text-text-secondary'}>{label}</span>
    </button>
  );

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
          open ? 'bg-bg-tertiary text-text-primary' : 'text-text-secondary hover:text-text-primary'
        }`}
      >
        지표 {activeCount > 0 && <span className="text-accent">{activeCount}</span>} ▾
        {loading && <span className="ml-1 text-text-muted">계산 중…</span>}
      </button>

      {open && (
        <div className="absolute left-0 top-full z-30 mt-1 w-52 rounded-md border border-border bg-bg-secondary py-1 shadow-xl">
          <p className="px-3 py-1 text-[10px] text-text-muted">차트 오버레이</p>

          {/* MA 는 상위 라벨 + 기간별 하위 항목으로 묶는다 */}
          <div className="px-3 py-0.5 text-xs text-text-secondary">이동평균선</div>
          {MA_LINES.map((line) =>
            row(
              toggles.overlays[line.key],
              OVERLAY_ITEMS.find((i) => i.key === line.key)?.label ?? line.label,
              () => toggleOverlay(line.key),
              { indent: true, color: line.color },
            ),
          )}

          {OVERLAY_ITEMS.filter((item) => !item.indent).map((item) =>
            row(toggles.overlays[item.key], item.label, () => toggleOverlay(item.key)),
          )}

          <div className="my-1 border-t border-border" />
          <p className="px-3 py-1 text-[10px] text-text-muted">별도 패널</p>

          {PANEL_ITEMS.map((item) =>
            row(toggles.panels[item.key], item.label, () => togglePanel(item.key)),
          )}
        </div>
      )}
    </div>
  );
}
