import { ICON_SM } from '../ui/icon';
import { CONTROL_H, TOUCH_HIT, TOUCH_LIST_ROW } from '../ui/tokens';
import Popover from '../ui/Popover';
import { SquareCheck, Square, ChevronDown } from 'lucide-react';
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
  /**
   * 목록을 화면 기준으로 띄움(v2.82.0 폰 칩 줄 — 단추가 옆으로 미는 줄 안이라, 줄 안에 그리면 미는 상자가 목록을 잘라 먹는다).
   * 공용 `ui/Popover`(body 로 포털 · 화면 안으로 밀어 넣음 · 바깥 누르기 · Esc 로 닫힘). 단추는 옆 칩과 같은 32(같은 줄 높이).
   */
  floating?: boolean;
}

/** 목록 폭(w-52) */
const MENU_W = 208;

/** 보조지표 추가/삭제 드롭다운 — 오버레이와 별도 패널을 구분해 보여 준다. */
export default function IndicatorDropdown({ toggles, onChange, loading, floating = false }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // 바깥 클릭·Esc 로 닫는다.
  useEffect(() => {
    if (!open || floating) return;

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
  }, [open, floating]);

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
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors hover:bg-bg-tertiary ${TOUCH_LIST_ROW} ${
        options.indent ? 'pl-6' : ''
      }`}
    >
      <span className={checked ? 'text-text-primary' : 'text-text-muted'}>{checked ? <SquareCheck {...ICON_SM} /> : <Square {...ICON_SM} />}</span>
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

  const menu = (
    <>
      <p className="px-3 py-1 text-caption text-text-muted">차트 오버레이</p>

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
      <p className="px-3 py-1 text-caption text-text-muted">별도 패널</p>

      {PANEL_ITEMS.map((item) =>
        row(toggles.panels[item.key], item.label, () => togglePanel(item.key)),
      )}
    </>
  );

  return (
    <div ref={rootRef} className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`rounded-md px-2.5 py-1 text-xs transition-colors ${TOUCH_HIT}${floating ? ` whitespace-nowrap ${CONTROL_H.md}` : ''} ${
          open ? 'bg-bg-tertiary text-text-primary' : 'text-text-secondary hover:text-text-primary'
        }`}
      >
        지표 {activeCount > 0 && <span className="text-text-secondary">{activeCount}</span>} <ChevronDown {...ICON_SM} className="inline-block align-[-2px]" />
        {loading && <span className="ml-1 text-text-muted">계산 중…</span>}
      </button>

      {open &&
        (floating ? (
          <Popover anchorRef={buttonRef} onClose={() => setOpen(false)} width={MENU_W} label="지표">
            {menu}
          </Popover>
        ) : (
          <div className="absolute left-0 top-full z-40 mt-1 w-52 rounded-lg bg-bg-elevated py-1 shadow-xl">
            {menu}
          </div>
        ))}
    </div>
  );
}
