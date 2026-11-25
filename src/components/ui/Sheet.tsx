import { useEffect, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';
import IconButton from './IconButton';
import { useDialogEsc, useFocusTrap } from './Dialog';

/** 판이 미끄러지는 시간(ms) — `index.css` 의 `.sheet-panel` 움직임과 같은 값 */
const SHEET_MS = 200;
/** 이만큼(px) 판이 나온 쪽으로 밀면 닫는다 */
const SWIPE_CLOSE_PX = 60;

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/**
 * 옆 판 하나(v2.73.0 · 테마 3-2 · 3-3) — 폰 메뉴 서랍(왼쪽) · 관심 목록 판(오른쪽) · 패드 덮개 메뉴(왼쪽)가 함께 쓴다.
 *
 * - 화면 끝(`side`)에서 나와 본문 **위에 덮는다**(본문을 밀지 않음) · 뒤는 `bg-overlay` 덮개.
 * - 닫힘: 덮개 누름 · [닫기] · Esc(맨 위 창 · 판 하나만 — `Dialog` 와 같은 순서) · 나온 쪽으로 밀기. 고른 뒤 닫는 것은 쓰는 쪽이.
 * - 초점: 열면 [닫기](`data-sheet-close` — 머리를 직접 그리면 그 단추에 붙인다)로 가고 판 안에 갇힘 · 닫으면 연 단추로 돌아감(`Dialog` 의 초점 가두기 그대로).
 * - 움직임 200ms(`index.css` `.sheet-panel`) · 움직임 줄이기면 바로.
 * - 머리: `title` 을 주면 높이 52 · 제목 + [닫기]. 직접 그리려면 `header`(그 안에 `data-sheet-close` 단추).
 */
export default function Sheet({
  open,
  onClose,
  side,
  label,
  title,
  header,
  footer,
  widthClass,
  children,
  testId,
}: {
  open: boolean;
  onClose: () => void;
  side: 'left' | 'right';
  /** 판의 이름(화면 읽기 · 시험이 `getByRole('dialog', { name })` 로 찾음) */
  label: string;
  /** 머리 제목(16 굵게) — `header` 를 주면 쓰지 않음 */
  title?: ReactNode;
  header?: ReactNode;
  /** 판 아래에 붙는 줄(아래 안전 여백 위) */
  footer?: ReactNode;
  /** 폭 — 쓰는 쪽이 테마 값으로 */
  widthClass: string;
  children: ReactNode;
  testId?: string;
}) {
  // 닫힌 뒤에도 사라지는 움직임 동안은 그려 둔다
  const [shown, setShown] = useState(open);
  useEffect(() => {
    if (open) {
      setShown(true);
      return;
    }
    const t = setTimeout(() => setShown(false), reducedMotion() ? 0 : SHEET_MS);
    return () => clearTimeout(t);
  }, [open]);
  if (!open && !shown) return null;
  return (
    <SheetPanel open={open} onClose={onClose} side={side} label={label} title={title} header={header} footer={footer} widthClass={widthClass} testId={testId}>
      {children}
    </SheetPanel>
  );
}

function SheetPanel({
  open,
  onClose,
  side,
  label,
  title,
  header,
  footer,
  widthClass,
  children,
  testId,
}: {
  open: boolean;
  onClose: () => void;
  side: 'left' | 'right';
  label: string;
  title?: ReactNode;
  header?: ReactNode;
  footer?: ReactNode;
  widthClass: string;
  children: ReactNode;
  testId?: string;
}) {
  const panelRef = useFocusTrap();
  useDialogEsc(open ? onClose : null);
  // 열면 초점은 [닫기] — 초점 가두기(위 줄)가 먼저 첫 요소로 보낸 뒤 옮긴다
  useEffect(() => {
    panelRef.current?.querySelector<HTMLElement>('[data-sheet-close]')?.focus();
  }, [panelRef]);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const state = open ? 'open' : 'closed';

  return (
    // 닫히는 움직임 동안은 누름을 받지 않는다(뒤 화면으로 그대로 — 두 번 닫기 · 판 안 단추 누름 막기)
    <div className={`fixed inset-0 z-[80] ${open ? '' : 'pointer-events-none'}`} data-testid={testId}>
      <div aria-hidden="true" data-state={state} className="sheet-backdrop absolute inset-0 bg-overlay" onMouseDown={onClose} />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        data-side={side}
        data-state={state}
        onTouchStart={(e) => {
          const t = e.touches[0];
          touch.current = t ? { x: t.clientX, y: t.clientY } : null;
        }}
        onTouchEnd={(e) => {
          const s = touch.current;
          const t = e.changedTouches[0];
          touch.current = null;
          if (!s || !t) return;
          const dx = t.clientX - s.x;
          const dy = t.clientY - s.y;
          if (Math.abs(dx) < SWIPE_CLOSE_PX || Math.abs(dx) < Math.abs(dy)) return;
          if ((side === 'left' && dx < 0) || (side === 'right' && dx > 0)) onClose();
        }}
        className={`sheet-panel absolute inset-y-0 ${side === 'left' ? 'left-0' : 'right-0'} flex flex-col bg-bg-secondary pt-[env(safe-area-inset-top)] shadow-2xl outline-none ${widthClass}`}
      >
        {header ?? (
          <div className="flex h-[52px] shrink-0 items-center gap-2 pl-4 pr-2">
            <h2 className="min-w-0 flex-1 truncate text-sm font-semibold text-text-primary">{title}</h2>
            <IconButton icon={X} label="닫기" onClick={onClose} data-sheet-close />
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
        {footer != null && <div className="shrink-0 pb-[env(safe-area-inset-bottom)]">{footer}</div>}
      </div>
    </div>
  );
}
