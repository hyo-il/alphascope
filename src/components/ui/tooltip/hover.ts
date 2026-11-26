/**
 * 툴팁 여닫는 때 판단 — **앱 전체에 하나**(v2.69.0). `ui/Tooltip`(`data-tip`) 과 `ui/InfoTip`([ⓘ]) 이 같은 판단을 쓴다.
 * DOM 을 모른다(대상은 그냥 값) — 시계 · 타이머를 바꿔 넣어 시험한다(`tooltip:test`).
 *
 * - 마우스를 올리고 `openMs` 뒤 열림 · 그 전에 지나가기만 하면 안 열림.
 * - 대상과 상자 둘 다에서 벗어나고 `closeMs` 뒤 닫힘(상자 위로 옮겨 가면 열린 채).
 * - 키보드 초점이면 바로 열림 · 초점이 떠나면 닫힘.
 * - 누름 · Esc · 창 크기 바꿈 · 창이 초점을 잃음에 닫힘. 스크롤에도 닫히되, 키보드 초점으로 연 뒤 `openMs` 안의 스크롤은 무시(초점 받은 곳을 보이게 하는 스크롤).
 * - **하나만** 열림 — 새것이 열리면 앞의 것이 닫힘. 열린 채 다른 대상으로 옮기면 기다리지 않고 바로 바뀜.
 * - **손가락**(v2.74.0 · 사용자 결정 2026-11-25 — `touchDown` · `touchMove` · `touchUp` · `touchCancel`). 대상은 둘로 나뉜다(나누기는 부르는 쪽 — `ui/Tooltip`):
 *   - `tap`(누를 때 하는 일이 없음 — [ⓘ] · 점선 글자 · 누름 동작이 없는 글): **누르면**(손을 뗄 때) 열림 · 같은 것을 다시 누르면 닫힘.
 *   - `press`(단추 · 줄처럼 누르면 하는 일이 있음): **`longPressMs` 길게 누르면** 열림 — 그러면 `touchUp` 이 true(뒤따르는 click 하나를 막으라는 뜻 —
 *     손을 떼도 그 동작은 일어나지 않음). 그 전에 떼면 동작만(툴팁 없음). 누른 채 `moveTolerancePx` 넘게 움직이면(밀어 보기) 취소.
 *   - 다른 곳을 누르면 열린 것이 닫힘(누르는 순간). 스크롤 · Esc · 창 크기 바꿈에도 닫힘(위와 같음).
 */
export interface TipClock {
  now: () => number;
  setTimeout: (fn: () => void, ms: number) => unknown;
  clearTimeout: (id: unknown) => void;
}

export interface TipController<T> {
  /** 지금 열린 대상(없으면 null) */
  current: () => T | null;
  hoverIn: (t: T) => void;
  hoverOut: (t: T) => void;
  boxIn: () => void;
  boxOut: () => void;
  focusIn: (t: T) => void;
  focusOut: (t: T) => void;
  /** 밖에서 바로 열기 · 닫기([ⓘ] 의 `open`) */
  show: (t: T) => void;
  hide: (t: T) => void;
  press: () => void;
  escape: () => void;
  scroll: () => void;
  resize: () => void;
  windowBlur: () => void;
  /** 손가락이 닿음 — 대상(없으면 null)과 그 종류 · 자리 */
  touchDown: (t: T | null, kind: TouchKind, x: number, y: number) => void;
  touchMove: (x: number, y: number) => void;
  /** 손가락을 뗌 — true 면 뒤따르는 click 하나를 막는다(길게 눌러 툴팁을 열었음) */
  touchUp: () => boolean;
  /** 브라우저가 누름을 가져감(스크롤 시작 등) */
  touchCancel: () => void;
  subscribe: (fn: () => void) => () => void;
}

/** 손가락 대상 종류 — `tap` 누름 동작 없음(누르면 열림) · `press` 누름 동작 있음(길게 누르면 열림) */
export type TouchKind = 'tap' | 'press';

export function createTipController<T>(
  clock: TipClock,
  o: { openMs: number; closeMs: number; longPressMs: number; moveTolerancePx: number },
): TipController<T> {
  let open: T | null = null;
  /** 지금 닿아 있는 손가락 — 대상 · 종류 · 처음 자리 · 누르기 전에 이 대상이 열려 있었나 · 길게 눌러 열었나 · 움직였나 */
  let finger: { t: T | null; kind: TouchKind; x: number; y: number; wasOpen: boolean; opened: boolean; moved: boolean } | null = null;
  let pressTimer: unknown = null;
  const cancelPress = () => {
    if (pressTimer != null) clock.clearTimeout(pressTimer);
    pressTimer = null;
  };
  let pending: T | null = null;
  let openTimer: unknown = null;
  let closeTimer: unknown = null;
  let focusOpenedAt: number | null = null;
  const listeners = new Set<() => void>();

  const emit = () => listeners.forEach((fn) => fn());
  const cancelOpen = () => {
    if (openTimer != null) clock.clearTimeout(openTimer);
    openTimer = null;
    pending = null;
  };
  const cancelClose = () => {
    if (closeTimer != null) clock.clearTimeout(closeTimer);
    closeTimer = null;
  };
  const setOpen = (t: T | null, byFocus = false) => {
    cancelOpen();
    cancelClose();
    focusOpenedAt = t != null && byFocus ? clock.now() : null;
    if (open === t) return;
    open = t;
    emit();
  };
  const close = () => setOpen(null);
  const scheduleClose = () => {
    cancelClose();
    closeTimer = clock.setTimeout(() => {
      closeTimer = null;
      close();
    }, o.closeMs);
  };

  return {
    current: () => open,
    hoverIn(t) {
      if (open === t) return cancelClose();
      // 열린 채 다른 대상으로 — 바로 바꾼다
      if (open != null) return setOpen(t);
      if (pending === t) return;
      cancelOpen();
      pending = t;
      openTimer = clock.setTimeout(() => {
        openTimer = null;
        pending = null;
        setOpen(t);
      }, o.openMs);
    },
    hoverOut(t) {
      if (pending === t) cancelOpen();
      if (open === t) scheduleClose();
    },
    boxIn: () => cancelClose(),
    boxOut() {
      if (open != null) scheduleClose();
    },
    focusIn: (t) => setOpen(t, true),
    focusOut(t) {
      if (open === t) close();
    },
    show: (t) => setOpen(t),
    hide(t) {
      if (pending === t) cancelOpen();
      if (open === t) close();
    },
    press() {
      cancelOpen();
      if (open != null) close();
    },
    escape: () => close(),
    scroll() {
      // 손가락으로 밀어 보는 중이면 길게 누르기를 취소한다
      if (finger) {
        cancelPress();
        finger.moved = true;
      }
      if (focusOpenedAt != null && clock.now() - focusOpenedAt < o.openMs) return;
      cancelOpen();
      if (open != null) close();
    },
    resize: () => close(),
    windowBlur() {
      cancelOpen();
      if (open != null) close();
    },
    touchDown(t, kind, x, y) {
      cancelOpen();
      cancelPress();
      const wasOpen = t != null && open === t && kind === 'tap';
      // 다른 곳(또는 길게 누르는 대상 — 다시 누르면 새로 길게 눌러야 함)을 누르면 열린 것이 닫힌다
      if (open != null && !wasOpen) close();
      finger = { t, kind, x, y, wasOpen, opened: false, moved: false };
      if (t != null && kind === 'press') {
        const f = finger;
        pressTimer = clock.setTimeout(() => {
          pressTimer = null;
          if (finger !== f || f.moved) return;
          f.opened = true;
          setOpen(t);
        }, o.longPressMs);
      }
    },
    touchMove(x, y) {
      const f = finger;
      if (!f || f.moved) return;
      if (Math.hypot(x - f.x, y - f.y) > o.moveTolerancePx) {
        f.moved = true;
        cancelPress();
      }
    },
    touchUp() {
      const f = finger;
      finger = null;
      cancelPress();
      if (!f) return false;
      if (f.opened) return true;
      if (f.moved || f.t == null || f.kind !== 'tap') return false;
      if (f.wasOpen) close();
      else setOpen(f.t);
      return false;
    },
    touchCancel() {
      finger = null;
      cancelPress();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
