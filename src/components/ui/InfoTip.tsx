import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { Info } from 'lucide-react';
import { ICON_SM } from './icon';

/**
 * 정보 아이콘 + 툴팁 (v2.36.0 디자인 규칙 6) — 제목 줄·바닥 줄에 늘 떠 있던 긴 설명(기준 시각·새로고침 주기·조작법)을 여기로 옮긴다.
 *
 * - 마우스를 올리거나 **키보드로 포커스하면** 열린다(Tab → 열림, Esc·포커스 이동 → 닫힘). `aria-describedby` 로 내용을 읽힌다.
 * - 툴팁은 `document.body` 에 그린다 — 조상의 `overflow-hidden` 에 잘리지 않게.
 * - ⚠️ **"지우지 않는다" 고정 안내 문구는 여기에 넣지 않는다**(화면에 글자로 남긴다 — CLAUDE.md 디자인 가이드라인).
 */
export default function InfoTip({ children, label = '설명' }: { children: ReactNode; label?: string }) {
  const id = useId();
  const ref = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number; up: boolean } | null>(null);

  const show = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const up = r.bottom + 160 > window.innerHeight;
    setPos({ left: Math.min(Math.max(8, r.left + r.width / 2 - 160), window.innerWidth - 328), top: up ? r.top - 6 : r.bottom + 6, up });
  };
  const hide = () => setPos(null);

  useEffect(() => {
    if (!pos) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && hide();
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', hide, true);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', hide, true);
    };
  }, [pos]);

  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-label={label}
        aria-describedby={pos ? id : undefined}
        onMouseEnter={show}
        onMouseLeave={hide}
        onFocus={show}
        onBlur={hide}
        className="inline-flex shrink-0 items-center justify-center rounded text-text-muted transition-colors hover:text-text-primary focus-visible:text-text-primary"
      >
        <Info {...ICON_SM} />
      </button>
      {pos &&
        createPortal(
          <div
            id={id}
            role="tooltip"
            style={{ left: pos.left, top: pos.top, transform: pos.up ? 'translateY(-100%)' : undefined }}
            className="pointer-events-none fixed z-[120] w-80 rounded-lg bg-bg-elevated px-3 py-2 text-caption leading-relaxed text-text-secondary shadow-lg"
          >
            {children}
          </div>,
          document.body,
        )}
    </>
  );
}
