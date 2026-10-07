import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import IconButton from './IconButton';

/**
 * 창(모달) 틀 하나 (v2.41.0) — 어두운 바탕 · 제목 줄 + 닫기 X · ESC 닫기 · 크기는 정해진 값만 · 테두리 없음(디자인 규칙 3).
 *
 * - 크기: `sm` 420 · `md` 560 · `lg` 720×640 · `xl` 960×680 · `full` 1200(88vw)×78vh. 높이가 정해진 크기(lg·xl·full)는 본문이 스크롤된다.
 * - ⚠️ **겹침 순서(`z`)는 창마다 그대로 넘긴다** — 처음 켜기 85 · 설정 90 · 발굴 95 · 종목 고르기 98 · 확인 창 100.
 * - ⚠️ **바깥 클릭으로 닫지 않는 창**이 있다(입력 중인 내용을 잃는 창) — `closeOnBackdrop={false}`.
 * - ESC 는 **맨 위 창 하나만** 닫는다(창 위에 창이 뜨면 둘 다 닫히지 않게 — 아래 스택).
 */
export type DialogSize = 'sm' | 'md' | 'lg' | 'xl' | 'full';

const SIZE: Record<DialogSize, string> = {
  sm: 'w-[min(420px,90vw)] max-h-[85vh]',
  md: 'w-[min(560px,90vw)] max-h-[85vh]',
  lg: 'h-[min(640px,85vh)] w-[min(720px,90vw)]',
  xl: 'h-[min(680px,85vh)] w-[min(960px,90vw)]',
  full: 'h-[78vh] w-[88vw] max-w-[1200px]',
};

/** 열린 창 순서 — ESC 는 마지막(맨 위) 창만 */
const stack: string[] = [];

export function isTopDialog(id: string): boolean {
  return stack[stack.length - 1] === id;
}

/** 창 틀 없이 ESC 만 맨 위 규칙을 따르게 할 때(확인 창 등) */
export function useDialogEsc(onEsc: (() => void) | null): void {
  const id = useId();
  const ref = useRef(onEsc);
  ref.current = onEsc;
  const active = onEsc != null;
  useEffect(() => {
    if (!active) return;
    stack.push(id);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || !isTopDialog(id)) return;
      e.stopPropagation();
      ref.current?.();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      const i = stack.lastIndexOf(id);
      if (i >= 0) stack.splice(i, 1);
    };
  }, [id, active]);
}

export default function Dialog({
  title,
  titleAside,
  onClose,
  size = 'md',
  z = 90,
  closeOnBackdrop = true,
  closeOnEsc = true,
  footer,
  children,
  bodyClassName = 'p-4',
  headerRight,
}: {
  title: ReactNode;
  /** 제목 옆 짧은 회색 글자 */
  titleAside?: ReactNode;
  /** 없으면 닫기 X·ESC·바깥 클릭이 모두 없다 — 반드시 하나를 골라야 하는 창(관심 목록 맞추기) */
  onClose?: () => void;
  size?: DialogSize;
  /** 겹침 순서 — 창마다 지금 값 그대로 */
  z?: number;
  closeOnBackdrop?: boolean;
  closeOnEsc?: boolean;
  /** 아래 버튼 줄(오른쪽 정렬) */
  footer?: ReactNode;
  children: ReactNode;
  /** 본문 여백·배치 — 기본 p-4. 높이가 정해진 크기에서는 본문이 스크롤된다 */
  bodyClassName?: string;
  /** 제목 줄 오른쪽(닫기 X 앞)에 둘 것 */
  headerRight?: ReactNode;
}) {
  const titleId = useId();
  useDialogEsc(closeOnEsc && onClose ? onClose : null);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      style={{ zIndex: z }}
      className="fixed inset-0 flex items-center justify-center bg-black/70 p-4"
      onMouseDown={(e) => {
        if (closeOnBackdrop && onClose && e.target === e.currentTarget) onClose();
      }}
    >
      <div className={`flex flex-col overflow-hidden rounded-xl bg-bg-secondary shadow-2xl ${SIZE[size]}`}>
        <div className="flex shrink-0 items-center gap-2 border-b border-border/40 px-4 py-3">
          <h2 id={titleId} className="min-w-0 text-sm font-semibold text-text-primary">
            {title}
          </h2>
          {titleAside != null && <span className="min-w-0 text-[13px] text-text-muted">{titleAside}</span>}
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {headerRight}
            {onClose && <IconButton icon={X} label="닫기" size="sm" onClick={onClose} />}
          </div>
        </div>
        <div className={`min-h-0 flex-1 overflow-y-auto ${bodyClassName}`}>{children}</div>
        {footer != null && (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border/40 px-4 py-3">{footer}</div>
        )}
      </div>
    </div>
  );
}
