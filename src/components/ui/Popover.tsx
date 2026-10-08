import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { useDialogEsc } from './Dialog';

/**
 * 버튼 바로 아래 뜨는 창 (v2.42.0) — 가운데 창은 `ui/Dialog`, **버튼에 붙어 뜨는 창**은 이 부품.
 * - 크기 고정(`width`) — 안 내용이 바뀌어도 창 크기가 흔들리지 않게(날짜 고르기는 늘 6주).
 * - 아래로 열고, 화면 아래가 모자라면 **위로 뒤집는다**. 왼쪽·오른쪽은 화면 안으로 밀어 넣는다.
 * - ESC(맨 위 창만 — Dialog 와 같은 스택) · 바깥 클릭으로 닫힌다. body 로 포털이라 부모의 overflow 에 잘리지 않는다.
 */
export default function Popover({
  anchorRef,
  onClose,
  width,
  label,
  children,
  z = 92,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  /** 고정 폭(px) */
  width: number;
  /** 화면 읽기용 이름 */
  label: string;
  children: ReactNode;
  z?: number;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  useDialogEsc(onClose);

  useLayoutEffect(() => {
    const place = () => {
      const a = anchorRef.current?.getBoundingClientRect();
      const box = boxRef.current;
      if (!a || !box) return;
      const h = box.offsetHeight;
      const gap = 4;
      const below = a.bottom + gap;
      const top = below + h > window.innerHeight - 8 && a.top - gap - h > 8 ? a.top - gap - h : below;
      const left = Math.min(Math.max(8, a.left), window.innerWidth - width - 8);
      setPos({ top, left });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [anchorRef, width]);

  useLayoutEffect(() => {
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (boxRef.current?.contains(t) || anchorRef.current?.contains(t)) return;
      onClose();
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [anchorRef, onClose]);

  return createPortal(
    <div
      ref={boxRef}
      role="dialog"
      aria-label={label}
      style={{ zIndex: z, width, top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
      className="fixed rounded-xl bg-bg-elevated p-3 shadow-2xl"
    >
      {children}
    </div>,
    document.body,
  );
}
