import { Children, forwardRef, isValidElement, useCallback, useEffect, useRef, type HTMLAttributes, type ReactNode } from 'react';
import { useLayoutMode } from '../../hooks/useLayoutMode';
import { TABLE_NAME_MIN_PX, TOOLTIP_TOUCH_MOVE_PX } from './tokens';

/**
 * 옆으로 미는 표(v2.75.0 · 테마 4-2) — **넓은 표는 이 부품 하나**로 감싼다. 표마다 `overflow-x-auto` 를 쓰지 않는다(`design:lint`).
 *
 * **1280 이상(`desk`)** — 지금 모양 그대로: `className`(또는 `deskScroll`)이 있으면 그 `div` 하나, 없으면 표만 그린다
 *   (상자 · 고정 칸 · 흐림 · 그림자 없음). `deskScroll` = 예전 표마다의 `overflow-x-auto` 가 하던 일(넘치면 밀기)을 부품이 맡음
 *   — 클래스 글자는 `${className} overflow-x-auto` 로 예전과 같다.
 * **폰 · 패드** — 표를 바탕 상자(둥근 12 · 바탕 = 그 표가 놓인 상자 바탕 그대로 — 고정 칸 · 흐림 색은 그 자리의 실제 바탕 `surfaceBg`) 안에서만 가로로 민다(세로는 지금처럼 바깥 ·
 *   감싼 상자가 원래 세로 스크롤이면 그 상자가 그대로 맡는다 — 머리 줄 `sticky top` 도 그대로).
 *   - 고정 칸: 머리 · 몸 줄의 `pin` 번째 칸(기본 첫 칸)에 `sticky left` · 바탕 = 상자 바탕 + 그 줄의 바탕(고른 줄 · 머리 바탕).
 *     그 칸이 상자 폭의 절반을 넘으면 고정하지 않는다(고정 칸이 화면을 다 차지하지 않게).
 *   - 고정 칸 그림자: 그 칸이 실제로 붙어 있을 때만(첫 칸이면 가로 스크롤 > 0) — `--shadow-scroll-pin`.
 *   - 끝 흐림 24(`--scroll-table-fade`): 더 밀 수 있는 쪽만(왼쪽은 고정 칸 바로 오른쪽부터) · 상자 바탕 → 투명.
 *   - 이름 칸(`TABLE_NAME_COL` = 글이 있는 `w-full` 머리 칸) 최소 `TABLE_NAME_MIN_PX`(칸에 원래 최소 폭이 있으면 그것).
 *   - 줄 전체를 합친 칸(묶음 머리 줄)의 내용은 보이는 폭으로 줄여 왼쪽에 붙인다(밀어도 묶음 이름 · 단추가 보임).
 *   - 판단은 스크롤 · 크기 바뀜(`ResizeObserver`) · 줄 바뀜(`MutationObserver`)마다 다시 한다(내용이 늦게 와도 맞음).
 *   - 손가락: 가로 · 세로 밀기는 브라우저 기본(`touch-action` 을 막지 않음). 밀고 뗀 뒤의 줄 누름(`click`)은 막는다
 *     (`TOOLTIP_TOUCH_MOVE_PX` 넘게 움직였거나 표가 밀렸으면 — 툴팁 길게 누르기의 취소 거리와 같음). 창 「아래로 밀어 닫기」 는 손잡이 · 머리에서만이라 부딪히지 않는다.
 * 모양 CSS 는 `src/index.css` 「옆으로 미는 표」 한 곳(폰 · 패드에서만 생기는 `data-scroll-table` 에만 걸림).
 * 표(`<table>`)는 이 부품의 **바로 아래 자식**으로 둔다(흐림을 표 옆에 붙인다). 다른 자식(더 보기 단추 등)은 그대로 그린다.
 */
interface ScrollTableProps extends HTMLAttributes<HTMLDivElement> {
  children: ReactNode;
  /** 1280 이상에서 넘치면 밀기(예전 감싸기의 `overflow-x-auto`) */
  deskScroll?: boolean;
  /** 고정할 칸 번호(1부터 · 기본 1) — 첫 칸이 순위 · 별처럼 종목이 아닌 좁은 칸이면 종목 칸 번호 */
  pin?: 1 | 2 | 3;
}

const join = (...xs: (string | false | undefined)[]) => xs.filter(Boolean).join(' ');

const clear = (c: string) => !c || c === 'transparent' || c === 'rgba(0, 0, 0, 0)';

/**
 * 상자 자리의 실제 바탕 — 상자부터 뿌리까지 바탕색을 겹쳐 칠한 색(반투명 바탕 `bg-…/40` 도 아래 바탕과 겹친 색).
 * 새 색을 만들지 않는다: 화면에 이미 깔린 바탕을 그대로 고정 칸 · 흐림에 쓴다(1×1 캔버스에 바깥부터 차례로 칠해 읽음).
 */
export function surfaceBg(el: HTMLElement): string {
  const layers: string[] = [];
  for (let n: HTMLElement | null = el; n; n = n.parentElement) {
    const c = getComputedStyle(n).backgroundColor;
    if (!clear(c)) layers.push(c);
  }
  const cv = document.createElement('canvas');
  cv.width = 1;
  cv.height = 1;
  const ctx = cv.getContext('2d');
  if (!ctx) return '';
  for (const c of layers.reverse()) {
    ctx.fillStyle = c;
    ctx.fillRect(0, 0, 1, 1);
  }
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
  return a === 0 ? '' : `rgb(${r} ${g} ${b})`;
}

/** 줄 바탕(투명이면 머리 · 몸 묶음 바탕) — 고정 칸이 상자 바탕 위에 같이 칠한다 */
function rowBg(tr: HTMLTableRowElement): string {
  const own = getComputedStyle(tr).backgroundColor;
  if (!clear(own)) return own;
  const sec = tr.parentElement ? getComputedStyle(tr.parentElement).backgroundColor : '';
  return sec && !clear(sec) ? sec : 'transparent';
}

const ScrollTable = forwardRef<HTMLDivElement, ScrollTableProps>(function ScrollTable(
  { children, className, deskScroll, pin = 1, ...rest },
  ref,
) {
  const mode = useLayoutMode();
  const boxRef = useRef<HTMLDivElement | null>(null);
  const setRef = useCallback(
    (el: HTMLDivElement | null) => {
      boxRef.current = el;
      if (typeof ref === 'function') ref(el);
      else if (ref) ref.current = el;
    },
    [ref],
  );
  const mobile = mode !== 'desk';

  useEffect(() => {
    const box = boxRef.current;
    if (!mobile || !box) return;
    let raf = 0;
    let pinOffset = 0;

    const measure = () => {
      raf = 0;
      const cs = getComputedStyle(box);
      const padL = parseFloat(cs.paddingLeft) || 0;
      const padR = parseFloat(cs.paddingRight) || 0;
      box.style.setProperty('--st-pad-l', `${padL}px`);
      box.style.setProperty('--st-pad-r', `${padR}px`);
      box.style.setProperty('--st-view-w', `${box.clientWidth - padL - padR}px`);
      const bg = surfaceBg(box);
      if (bg) box.style.setProperty('--st-bg', bg);
      const tables = box.querySelectorAll<HTMLTableElement>(':scope > [data-scroll-table-inner] > table');
      let pinW = 0;
      pinOffset = 0;
      for (const t of tables) {
        for (const tr of t.rows) {
          tr.style.setProperty('--st-row', rowBg(tr));
          // pin 번째 칸 — 앞 칸들이 한 칸씩일 때만(합친 칸 줄은 재지 않음)
          const cells = tr.cells;
          let ok = cells.length >= pin;
          for (let i = 0; ok && i < pin; i++) if (cells[i].colSpan !== 1) ok = false;
          if (!ok) continue;
          const c = cells[pin - 1];
          pinW = Math.max(pinW, c.offsetWidth);
          pinOffset = Math.max(pinOffset, c.offsetLeft);
        }
      }
      const pinOn = pinW > 0 && pinW <= box.clientWidth / 2;
      box.dataset.pin = pinOn ? String(pin) : 'off';
      box.style.setProperty('--st-fade-l', `${pinOn ? pinW : -padL}px`);
      box.style.setProperty('--st-pin-w', `${pinOn ? pinW : 0}px`);
      onScroll();
    };
    const onScroll = () => {
      const max = box.scrollWidth - box.clientWidth;
      const x = box.scrollLeft;
      const pinned = box.dataset.pin !== 'off';
      // 고정 칸이 실제로 붙어 있나(첫 칸이면 조금이라도 밀었을 때)
      const stuck = pinned && x > Math.max(0, pinOffset - (parseFloat(getComputedStyle(box).paddingLeft) || 0)) + 0.5;
      const left = x > 0.5 && (!pinned || pin === 1 || stuck);
      const right = max > 0.5 && x < max - 0.5;
      const fade = join(left && 'l', right && 'r');
      if (box.dataset.fade !== fade) box.dataset.fade = fade;
      if (stuck) box.dataset.stuck = '';
      else delete box.dataset.stuck;
    };
    const schedule = () => {
      if (!raf) raf = requestAnimationFrame(measure);
    };

    // 손가락: 밀고 뗀 뒤의 누름은 줄 누름으로 보지 않는다
    let start: { x: number; y: number; left: number; top: number } | null = null;
    let moved = false;
    let movedAt = 0;
    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0];
      start = t ? { x: t.clientX, y: t.clientY, left: box.scrollLeft, top: box.scrollTop } : null;
      moved = false;
    };
    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!start || !t) return;
      if (Math.abs(t.clientX - start.x) > TOOLTIP_TOUCH_MOVE_PX || Math.abs(t.clientY - start.y) > TOOLTIP_TOUCH_MOVE_PX) {
        moved = true;
        movedAt = Date.now();
      }
    };
    const onTouchEnd = () => {
      if (start && (Math.abs(box.scrollLeft - start.left) > 1 || Math.abs(box.scrollTop - start.top) > 1)) {
        moved = true;
        movedAt = Date.now();
      }
      start = null;
    };
    const onClick = (e: MouseEvent) => {
      if (moved && Date.now() - movedAt < 1000) {
        e.stopPropagation();
        e.preventDefault();
      }
      moved = false;
    };

    box.addEventListener('scroll', onScroll, { passive: true });
    box.addEventListener('touchstart', onTouchStart, { passive: true, capture: true });
    box.addEventListener('touchmove', onTouchMove, { passive: true, capture: true });
    box.addEventListener('touchend', onTouchEnd, { passive: true, capture: true });
    box.addEventListener('click', onClick, { capture: true });
    const ro = new ResizeObserver(schedule);
    ro.observe(box);
    for (const t of box.querySelectorAll(':scope > [data-scroll-table-inner] > table')) ro.observe(t);
    const mo = new MutationObserver((list) => {
      // 표가 새로 생기면(로딩 뒤) 크기도 지켜본다
      for (const m of list) for (const n of m.addedNodes) if (n instanceof HTMLTableElement) ro.observe(n);
      schedule();
    });
    mo.observe(box, { subtree: true, childList: true, attributes: true, attributeFilter: ['class', 'colspan'] });
    measure();
    return () => {
      if (raf) cancelAnimationFrame(raf);
      ro.disconnect();
      mo.disconnect();
      box.removeEventListener('scroll', onScroll);
      box.removeEventListener('touchstart', onTouchStart, { capture: true });
      box.removeEventListener('touchmove', onTouchMove, { capture: true });
      box.removeEventListener('touchend', onTouchEnd, { capture: true });
      box.removeEventListener('click', onClick, { capture: true });
    };
  }, [mobile, pin]);

  if (!mobile) {
    const cls = deskScroll ? join(className, 'overflow-x-auto') : className;
    if (cls === undefined) return <>{children}</>;
    return (
      <div ref={setRef} className={cls} {...rest}>
        {children}
      </div>
    );
  }

  // 폰 · 패드: 표마다 덧칸 넷(여백 덮개 · 고정 칸 그림자 · 흐림 둘)을 같은 칸(grid 1/1)에 겹쳐 둔다 — sticky 라 상자 끝 · 고정 칸 자리에 붙어 있다
  const body = Children.map(children, (child) => {
    if (!isValidElement(child) || child.type !== 'table') return child;
    return (
      <div className="grid w-fit min-w-full" data-scroll-table-inner>
        {child}
        <span aria-hidden data-scroll-pin-cover />
        <span aria-hidden data-scroll-pin-shadow />
        <span aria-hidden data-scroll-fade="left" />
        <span aria-hidden data-scroll-fade="right" />
      </div>
    );
  });
  return (
    <div
      ref={setRef}
      {...rest}
      className={join(className, 'overflow-x-auto', !/(^|\s)rounded(-|\s|$)/.test(className ?? '') && 'rounded-xl')}
      data-scroll-table=""
      style={{ ...rest.style, ['--st-name-min' as string]: `${TABLE_NAME_MIN_PX}px` }}
    >
      {body}
    </div>
  );
});

export default ScrollTable;
