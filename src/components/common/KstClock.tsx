import { forwardRef, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Pin, type LucideIcon, type LucideProps } from 'lucide-react';
import { IconButton } from '../ui';
import { CONTROL_H } from '../ui/tokens';
import { kstClockText } from '../../utils/marketDate';
import { saveClock, useClockStore } from '../../hooks/useClockSetting';
import type { ClockCorner, ClockSetting } from '../../types/clock';

/**
 * 떠 있는 **한국 시간** 시계(사용자 결정 2026-10-21) — 미국 장 시작 · 거래정지 해제 시각을 한국 시간으로 바로 본다.
 *
 * - 앱 루트(`App.tsx` 의 공통 부품 자리)에 한 번 — 모든 화면에서 같은 자리, 화면을 바꿔도 다시 만들지 않는다.
 * - 시각: 매 초 `Date.now()` 로 다시 계산한다(`utils/marketDate.kstClockText` — PC 시간대와 상관없이 Asia/Seoul).
 *   숨긴 탭에서 돌아오면(`visibilitychange`) 곧바로 다시 그린다 — 밀린 타이머의 틀린 초를 보이지 않게.
 * - 핀: 풀림이면 상자를 끌어 옮긴다(Pointer Events). 누르면 그 자리에 고정 — 고정이면 끌리지 않고 상자 클릭은 아무 일도 안 한다.
 * - 자리: 가장 가까운 화면 모서리에서의 거리(`types/clock.ts`)로 저장 · 창 크기가 바뀌면 그 모서리 기준으로 다시 놓고 화면 안으로 밀어 넣는다.
 *   저장은 **놓을 때 한 번 · 핀을 누를 때 한 번**(끄는 중에는 저장하지 않는다).
 * - 겹침: `z-30` — 화면 내용(표 머리 z-10 · 차트 위 그림 z-20) 위, 드롭다운 메뉴 · 검색 목록 · 로딩 가림(z-40) · 창(50~) · 팝오버(92) · 토스트(110) 아래
 *   (순서 표는 `docs/rules/ui.md` 「떠 있는 부품의 겹침 순서」 한 곳).
 *   `#root` 안에 있어 창이 열리면 창의 초점 가두기(`ui/Dialog`)가 그대로 막는다(창 안 Tab 이 시계로 새지 않는다).
 */

/** 채운 핀 — 고정됨. 빈 핀(`Pin`) = 고정 풀림 */
const PinFilled = forwardRef<SVGSVGElement, LucideProps>(function PinFilled(props, ref) {
  return <Pin ref={ref} {...props} fill="currentColor" />;
}) as LucideIcon;

/** 놓을 때 이만큼(px) 넘게 움직였을 때만 옮긴 것으로 본다 — 살짝 누른 것은 저장하지 않는다 */
const DRAG_SLOP = 3;

interface Box {
  left: number;
  top: number;
}

const clamp = (v: number, max: number) => Math.min(Math.max(0, v), Math.max(0, max));

/** 저장한 자리 → 화면 좌표(창 안으로 밀어 넣음) */
function placeOf(clock: ClockSetting, w: number, h: number, vw: number, vh: number): Box {
  const left = clock.corner.endsWith('left') ? clock.dx : vw - w - clock.dx;
  const top = clock.corner.startsWith('top') ? clock.dy : vh - h - clock.dy;
  return { left: clamp(left, vw - w), top: clamp(top, vh - h) };
}

/** 화면 좌표 → 가장 가까운 모서리 기준 거리 */
function settingOf(box: Box, w: number, h: number, vw: number, vh: number, pinned: boolean): ClockSetting {
  const left = box.left + w / 2 < vw / 2;
  const top = box.top + h / 2 < vh / 2;
  return {
    pinned,
    corner: `${top ? 'top' : 'bottom'}-${left ? 'left' : 'right'}` as ClockCorner,
    dx: Math.round(Math.max(0, left ? box.left : vw - w - box.left)),
    dy: Math.round(Math.max(0, top ? box.top : vh - h - box.top)),
  };
}

/** 지금 한국 시각 — 다음 초가 바뀌는 때에 맞춰 다시 그린다 */
function useKstNow(): string {
  const [text, setText] = useState(() => kstClockText(Date.now()));
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const now = Date.now();
      setText(kstClockText(now));
      clearTimeout(timer);
      timer = setTimeout(tick, 1000 - (now % 1000));
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    tick();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  return text;
}

export default function KstClock() {
  const time = useKstNow();
  const clock = useClockStore((s) => s.clock);
  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [viewport, setViewport] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }));
  /** 끄는 중의 자리 — 놓으면 비운다(그 뒤에는 저장한 자리에서 계산) */
  const [dragBox, setDragBox] = useState<Box | null>(null);
  const drag = useRef<{ id: number; startX: number; startY: number; from: Box; last: Box | null } | null>(null);

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setSize({ w: el.offsetWidth, h: el.offsetHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  const placed = size ? placeOf(clock, size.w, size.h, viewport.w, viewport.h) : null;
  const box = dragBox ?? placed;

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    // 핀 버튼은 버튼으로만 동작한다 · 고정이면 끌지 않는다 · 왼쪽 버튼만
    if (clock.pinned || !placed || e.button !== 0 || (e.target as Element).closest('button')) return;
    // ⚠️ preventDefault 하지 않는다 — 크롬은 그러면 mousedown 을 보내지 않아, 열린 목록 · 팝오버의 「바깥 클릭으로 닫기」 가 동작하지 않는다.
    // 글자 선택은 상자의 `select-none` 이 막는다(선택이 상자 안에서 시작되지 않는다)
    e.currentTarget.setPointerCapture(e.pointerId); // 끄는 동안 다른 요소가 포인터를 받지 않는다
    drag.current = { id: e.pointerId, startX: e.clientX, startY: e.clientY, from: placed, last: null };
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId || !size) return;
    // 놓기를 놓쳤으면(버튼이 이미 떨어짐) 끌기를 끝낸다 — 안 그러면 버튼 없이 지나가도 시계가 따라온다
    if (e.buttons === 0) return endDrag(e, true);
    const mx = e.clientX - d.startX;
    const my = e.clientY - d.startY;
    if (!d.last && Math.hypot(mx, my) <= DRAG_SLOP) return;
    // 끌기를 시작했다 — 늦게 온 받기 결과가 끄는 중인 시계를 덮지 않게
    if (!d.last) useClockStore.setState({ touched: true });
    d.last = { left: clamp(d.from.left + mx, viewport.w - size.w), top: clamp(d.from.top + my, viewport.h - size.h) };
    setDragBox(d.last);
  };
  function endDrag(e: ReactPointerEvent<HTMLDivElement>, cancelled: boolean) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    if (!cancelled && d.last && size) void saveClock(settingOf(d.last, size.w, size.h, viewport.w, viewport.h, false));
    setDragBox(null);
  }

  const togglePin = () => {
    // 고정 여부만 바꾼다 — 자리(모서리 · 거리)는 저장된 값 그대로(지금 창 크기로 다시 계산하면 다른 크기의 창에서 자리가 바뀐다)
    void saveClock({ ...clock, pinned: !clock.pinned });
  };

  const pinned = clock.pinned;
  return (
    <div
      ref={boxRef}
      role="group"
      aria-label="한국 시간"
      data-kst-clock={pinned ? 'pinned' : 'free'}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => endDrag(e, false)}
      onPointerCancel={(e) => endDrag(e, true)}
      onLostPointerCapture={(e) => endDrag(e, true)}
      style={{ left: box?.left ?? 0, top: box?.top ?? 0, visibility: box ? 'visible' : 'hidden', touchAction: 'none' }}
      className={`fixed z-30 flex ${CONTROL_H.md} select-none items-center gap-2 rounded-xl bg-bg-elevated pl-3 pr-1 shadow-2xl ${
        pinned ? '' : dragBox ? 'cursor-grabbing' : 'cursor-grab'
      }`}
    >
      {/* 떠 있는 상자(bg-elevated) 위라 text-muted 는 대비가 모자란다 — InfoTip 과 같은 text-secondary */}
      <span className="text-caption text-text-secondary">한국</span>
      <time className="text-sm font-semibold tabular-nums text-text-primary">{time}</time>
      <IconButton
        icon={pinned ? PinFilled : Pin}
        label={pinned ? '위치 고정됨 — 누르면 옮길 수 있습니다' : '끌어서 옮기세요 — 누르면 이 자리에 고정됩니다'}
        size="sm"
        aria-pressed={pinned}
        onClick={togglePin}
        // 고정 = 채운 핀 + 밝은 글자색, 풀림 = 빈 핀(text-secondary — muted 는 elevated 위에서 거의 안 보인다)
        className={`cursor-pointer ${pinned ? '!text-text-primary' : '!text-text-secondary hover:!text-text-primary'}`}
      />
    </div>
  );
}
