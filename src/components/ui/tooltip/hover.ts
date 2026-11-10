/**
 * 툴팁 여닫는 때 판단 — **앱 전체에 하나**(v2.69.0). `ui/Tooltip`(`data-tip`) 과 `ui/InfoTip`([ⓘ]) 이 같은 판단을 쓴다.
 * DOM 을 모른다(대상은 그냥 값) — 시계 · 타이머를 바꿔 넣어 시험한다(`tooltip:test`).
 *
 * - 마우스를 올리고 `openMs` 뒤 열림 · 그 전에 지나가기만 하면 안 열림.
 * - 대상과 상자 둘 다에서 벗어나고 `closeMs` 뒤 닫힘(상자 위로 옮겨 가면 열린 채).
 * - 키보드 초점이면 바로 열림 · 초점이 떠나면 닫힘.
 * - 누름 · Esc · 창 크기 바꿈 · 창이 초점을 잃음에 닫힘. 스크롤에도 닫히되, 키보드 초점으로 연 뒤 `openMs` 안의 스크롤은 무시(초점 받은 곳을 보이게 하는 스크롤).
 * - **하나만** 열림 — 새것이 열리면 앞의 것이 닫힘. 열린 채 다른 대상으로 옮기면 기다리지 않고 바로 바뀜.
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
  subscribe: (fn: () => void) => () => void;
}

export function createTipController<T>(clock: TipClock, o: { openMs: number; closeMs: number }): TipController<T> {
  let open: T | null = null;
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
      if (focusOpenedAt != null && clock.now() - focusOpenedAt < o.openMs) return;
      cancelOpen();
      if (open != null) close();
    },
    resize: () => close(),
    windowBlur() {
      cancelOpen();
      if (open != null) close();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
