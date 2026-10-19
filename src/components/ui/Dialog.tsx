import { useEffect, useId, useRef, type ReactNode } from 'react';
import { X } from 'lucide-react';
import IconButton from './IconButton';

/**
 * 창(모달) 틀 하나 — 어두운 바탕 · 제목 줄 + 닫기 X · ESC 닫기 · 크기는 정해진 값만 · 테두리 없음(디자인 규칙 3).
 *
 * - 크기: `sm` 420 · `md` 560 · `lg` 720×640 · `xl` 960×680 · `full` 1200(88vw)×78vh. 높이가 정해진 크기(lg·xl·full)는 본문이 스크롤된다.
 * - ⚠️ **겹침 순서(`z`)는 창마다 그대로 넘긴다** — 처음 켜기 85 · 설정 90 · 종목 추가 98 · 확인 창 100.
 * - ⚠️ **바깥 클릭으로 닫지 않는 창**이 있다(입력 중인 내용을 잃는 창) — `closeOnBackdrop={false}`.
 * - ESC 는 **맨 위 창 하나만** 닫는다(창 위에 창이 뜨면 둘 다 닫히지 않게 — 아래 스택).
 * - **초점 가두기**(맨 위 창만): Tab · Shift+Tab 은 창 안에서만 돈다(끝 다음 → 처음, 처음 이전 → 끝). 초점이 뒤 화면(`#root` 안 · 창 밖)으로
 *   나가면 창으로 되돌린다. 닫으면 창을 연 요소로 초점을 돌려준다(없어졌으면 그대로). 화면 읽기 프로그램은 `aria-modal` 로 뒤 화면을 읽지 않는다.
 *   창은 `#root` 안에 그려져 뒤 화면에 `inert` 를 걸면 창도 막히므로 이 방식으로 같은 효과를 낸다.
 *   `body` 로 따로 뜨는 것(`Popover` · `InfoTip` — 날짜 고르기 등)은 창 밖이어도 막지 않는다(그 안의 Tab 은 브라우저 그대로).
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
/** 열린 창의 판(panel) 순서 — 초점은 마지막(맨 위) 창에만 가둔다(ESC 를 쓰지 않는 창도 들어간다) */
const trapStack: HTMLElement[] = [];
const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]):not([type="hidden"]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
function focusablesIn(el: HTMLElement): HTMLElement[] {
  return [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.getClientRects().length > 0);
}
/** 뒤 화면(앱 루트 안)인가 — `body` 로 따로 뜨는 목록은 뒤 화면이 아니다 */
function inAppRoot(node: Node | null): boolean {
  const root = document.getElementById('root');
  return Boolean(root && node && root.contains(node));
}

/** 초점 가두기 — `Dialog` 가 쓴다. 판(panel) ref 를 돌려준다 */
function useFocusTrap() {
  const panelRef = useRef<HTMLDivElement>(null);
  /** 창을 연 요소 — 첫 그리기(자식의 autoFocus 보다 먼저)에서 잡는다 */
  const openerRef = useRef<Element | null | undefined>(undefined);
  if (openerRef.current === undefined) openerRef.current = typeof document === 'undefined' ? null : document.activeElement;

  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    trapStack.push(panel);
    const isTop = () => trapStack[trapStack.length - 1] === panel;
    // 자식이 이미 초점을 가져갔으면(autoFocus) 그대로, 아니면 창 안 첫 요소(없으면 판)로
    if (!panel.contains(document.activeElement)) (focusablesIn(panel)[0] ?? panel).focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab' || !isTop()) return;
      const active = document.activeElement;
      // 창 밖 · 앱 루트 밖(body 로 뜬 목록) — 그 안의 Tab 은 브라우저 그대로
      if (active && !panel.contains(active) && !inAppRoot(active)) return;
      const list = focusablesIn(panel);
      if (!list.length) {
        e.preventDefault();
        panel.focus();
        return;
      }
      const first = list[0];
      const last = list[list.length - 1];
      if (!active || !panel.contains(active)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault();
        last.focus();
      }
    };
    // 초점이 뒤 화면으로 나가면(스크립트 · 화면 읽기 프로그램 이동 등) 창으로 되돌린다
    const onFocusIn = (e: FocusEvent) => {
      if (!isTop()) return;
      const target = e.target as Node | null;
      // 다른 창 안으로 가는 초점은 그대로 둔다 — 위에 새로 뜬 창의 autoFocus 는 그 창이 「맨 위」 로 등록되기(effect) 전에 일어난다
      const inOtherDialog = target instanceof Element && target.closest('[role="dialog"]') != null;
      if (target && !panel.contains(target) && inAppRoot(target) && !inOtherDialog) (focusablesIn(panel)[0] ?? panel).focus();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('focusin', onFocusIn);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('focusin', onFocusIn);
      const i = trapStack.lastIndexOf(panel);
      if (i >= 0) trapStack.splice(i, 1);
      // 연 요소로 초점을 돌려준다 — 창이 정말 사라졌을 때만(개발 모드 StrictMode 는 effect 를 뗐다 다시 붙여, 그때 돌려주면 창 첫 요소로 초점이 튀었다),
      // 그 요소가 남아 있고, 아래 창이 있으면 그 창 안일 때만
      const opener = openerRef.current as HTMLElement | null;
      queueMicrotask(() => {
        if (panel.isConnected) return;
        const below = trapStack[trapStack.length - 1];
        if (opener && opener.isConnected && typeof opener.focus === 'function' && (!below || below.contains(opener))) opener.focus();
      });
    };
  }, []);
  return panelRef;
}

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
  const panelRef = useFocusTrap();

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
      <div ref={panelRef} tabIndex={-1} className={`flex flex-col overflow-hidden rounded-xl bg-bg-secondary shadow-2xl outline-none ${SIZE[size]}`}>
        <div className="flex shrink-0 items-center gap-2 border-b border-border/40 px-4 py-3">
          <h2 id={titleId} className="min-w-0 text-sm font-semibold text-text-primary">
            {title}
          </h2>
          {titleAside != null && <span className="min-w-0 text-caption text-text-muted">{titleAside}</span>}
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
