import { useEffect, useRef, type ReactNode } from 'react';
import { surfaceBg } from './ScrollTable';

/**
 * 옆으로 미는 줄(v2.82.0 · 테마 9-1 R7) — 한 줄에 다 들어가지 않는 **탭 줄 · 칩 줄**을 상자 안에서 가로로 민다.
 * 끝 흐림 24 는 옆으로 미는 표(`ui/ScrollTable`)와 같은 이름 · 같은 방법(`--scroll-table-fade` · 그 자리의 실제 바탕 `surfaceBg` · 더 밀 수 있는 쪽만).
 * 잘린 글자(「설」)가 끝에 걸려 보이지 않게 한다. 모양 CSS 는 `src/index.css` 「옆으로 미는 줄」 한 곳.
 * 폰 · 패드 화면에서만 쓴다(1280 이상 DOM 에 새로 넣지 않는다).
 */
export default function ScrollRow({
  children,
  className = '',
  innerClassName = '',
  testId,
}: {
  children: ReactNode;
  /** 바깥 상자(자리 · 폭) */
  className?: string;
  /** 미는 줄(줄 안 배치 — `flex items-center gap-…`) */
  innerClassName?: string;
  testId?: string;
}) {
  const boxRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const box = boxRef.current;
    const inner = innerRef.current;
    if (!box || !inner) return;
    let raf = 0;
    const measure = () => {
      raf = 0;
      const bg = surfaceBg(box);
      if (bg) box.style.setProperty('--st-bg', bg);
      const max = inner.scrollWidth - inner.clientWidth;
      const x = inner.scrollLeft;
      const fade = [x > 0.5 && 'l', max > 0.5 && x < max - 0.5 && 'r'].filter(Boolean).join(' ');
      if (box.dataset.fade !== fade) box.dataset.fade = fade;
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };
    measure();
    inner.addEventListener('scroll', schedule, { passive: true });
    const ro = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    ro?.observe(inner);
    for (const c of inner.children) ro?.observe(c);
    return () => {
      inner.removeEventListener('scroll', schedule);
      ro?.disconnect();
      if (raf) cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <div ref={boxRef} data-scroll-row="" data-testid={testId} className={className}>
      <div ref={innerRef} data-scroll-row-inner="" className={innerClassName}>
        {children}
      </div>
      <span aria-hidden data-scroll-fade="left" />
      <span aria-hidden data-scroll-fade="right" />
    </div>
  );
}
