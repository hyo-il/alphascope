import { useCallback, useLayoutEffect, useRef } from 'react';

/**
 * 순서가 바뀔 때 **항목이 제자리로 미끄러져 오는 모션**(FLIP).
 *
 * 목록의 순서만 바꾸면 항목이 순간이동해서, 무엇이 어디로 갔는지 눈으로 좇을 수 없다.
 * 바뀌기 **전** 위치를 기억해 두었다가, 바뀐 **뒤** 그 차이만큼 뒤로 밀어 놓고
 * 0 으로 되돌린다 — 실제 레이아웃은 이미 끝나 있고 보이는 것만 따라온다(First-Last-Invert-Play).
 *
 * ⚠️ 라이브러리를 쓰지 않는다. `@dnd-kit` 을 후보로 확인했으나 마지막 배포가
 * 2024-12(약 1.8년 전)이라 「최근 1년 안에 배포」 조건을 넘지 못했다 (2026-09-23 확인).
 * 이 앱의 드래그는 HTML5 DnD 그대로 두고 모션만 여기서 붙인다.
 *
 * ⚠️ **동작 줄이기를 켠 사용자에게는 애니메이션을 하지 않는다** — 즉시 이동한다.
 */
const DURATION_MS = 180;

export function useFlipReorder(key: string) {
  const nodes = useRef(new Map<string, HTMLElement>());
  const before = useRef(new Map<string, number>());

  /** 각 행에 달아 주는 ref 콜백 — `ref={flip('AAPL')}` 처럼 쓴다 */
  const flip = useCallback(
    (id: string) => (el: HTMLElement | null) => {
      if (el) nodes.current.set(id, el);
      else nodes.current.delete(id);
    },
    [],
  );

  useLayoutEffect(() => {
    const now = new Map<string, number>();
    nodes.current.forEach((el, id) => now.set(id, el.getBoundingClientRect().top));

    const reduced =
      typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (!reduced) {
      now.forEach((top, id) => {
        const was = before.current.get(id);
        const el = nodes.current.get(id);
        // 처음 나타난 행은 비교할 이전 위치가 없다 — 그냥 둔다.
        if (was === undefined || !el) return;
        const dy = was - top;
        if (!dy) return;
        el.animate(
          [{ transform: `translateY(${dy}px)` }, { transform: 'translateY(0)' }],
          { duration: DURATION_MS, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
        );
      });
    }

    before.current = now;
  }, [key]);

  return flip;
}
