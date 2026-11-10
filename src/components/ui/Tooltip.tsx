import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { TOOLTIP_BOX, TOOLTIP_CLOSE_MS, TOOLTIP_OPEN_MS } from './tokens';
import { createTipController } from './tooltip/hover';
import { placeTip, tipMaxWidth } from './tooltip/place';

/**
 * 앱 툴팁 담당 — **앱 뿌리(`main.tsx`)에 하나**(v2.69.0 · 사용자 결정 2026-11-10). 브라우저 기본 `title` 은 쓰지 않는다(뜨는 때 · 글자 크기를 앱이 못 정한다).
 *
 * 다는 법(화면 코드):
 * - `data-tip="글"` — 마우스를 올리고 0.3초 뒤 · 키보드 초점이면 바로. 줄바꿈 글(`\n`) 그대로.
 * - `data-tip-clip="글"` — **글이 잘렸을 때만**(말줄임 칸의 긴 이름 전체 보기). 안 잘렸으면 뜨지 않는다.
 * - [ⓘ] 은 `ui/InfoTip` — 같은 판단(`tooltip/hover`) · 같은 상자 · 같은 자리 계산(`tooltip/place`)을 쓴다.
 * - `data-tip-off` — **툴팁 숨김 표시**. 붙어 있는 동안 그 요소의 툴팁을 열지 않는다(열려 있으면 바로 닫음 · 조상으로 올라가 찾지도 않음).
 *   떨어지면 마우스가 그 위에 있을 때 0.3초 규칙대로 다시 연다(예: 접힌 왼쪽 메뉴 — 펼침 메뉴가 열린 동안 대메뉴 툴팁이 그 글자를 가리지 않게).
 *   화면 코드는 표시만 단다 — 툴팁 코드를 따로 만들지 않는다.
 *
 * 문서 전체의 마우스 · 키보드 초점을 보고 표시가 달린 요소의 툴팁을 `document.body` 에 그린다(조상의 넘침 숨김에 잘리지 않게).
 * 터치(마우스 아닌 누름)에는 열지 않는다 — 누름은 버튼 동작. 열린 툴팁은 앱 전체에서 하나.
 * 시간 · 크기 · 상자 모양은 `tokens.ts` 「툴팁」 한 곳.
 */
export const tipController = createTipController<HTMLElement>(
  { now: () => performance.now(), setTimeout: (fn, ms) => window.setTimeout(fn, ms), clearTimeout: (id) => window.clearTimeout(id as number) },
  { openMs: TOOLTIP_OPEN_MS, closeMs: TOOLTIP_CLOSE_MS },
);

/** [ⓘ] 내용 — `InfoTip` 이 자기 단추에 맞춰 넣는다(글자가 아니라 React 내용이라 속성에 담지 못한다) */
const infoContent = new Map<HTMLElement, ReactNode>();
const contentListeners = new Set<() => void>();
let contentVersion = 0;
export function setInfoTipContent(el: HTMLElement, node: ReactNode | null) {
  if (node == null) infoContent.delete(el);
  else infoContent.set(el, node);
  contentVersion++;
  contentListeners.forEach((fn) => fn());
}

const TIP_SELECTOR = '[data-tip], [data-tip-clip], [data-infotip]';
const TIP_ID = 'as-tooltip';

/** 한 줄 말줄임이 잘렸나 — 가로만 본다(본고딕 글자 위아래가 줄 높이보다 커 세로 scrollHeight 는 안 잘린 칸도 크다) */
const clipped = (el: HTMLElement) => el.scrollWidth > el.clientWidth;

/**
 * 그 요소(또는 조상)의 툴팁 대상 — 보일 글이 없으면(빈 글 · 안 잘린 `data-tip-clip`) 바깥 조상으로 올라가 찾고, 끝내 없으면 null.
 * (`data-tip` 버튼 안의 안 잘린 이름 칸에서도 버튼 설명이 뜬다)
 */
function tipTarget(node: EventTarget | null): HTMLElement | null {
  if (!(node instanceof Element)) return null;
  let el = node.closest<HTMLElement>(TIP_SELECTOR);
  while (el) {
    if (el.hasAttribute('data-tip-off')) return null; // 툴팁 숨김 표시 — 이 요소 · 조상 모두 열지 않음
    if (el.hasAttribute('data-infotip')) return el;
    if (el.getAttribute('data-tip')) return el;
    const clip = el.getAttribute('data-tip-clip');
    if (clip && clipped(el)) return el;
    el = el.parentElement?.closest<HTMLElement>(TIP_SELECTOR) ?? null;
  }
  return null;
}

function contentOf(el: HTMLElement): ReactNode {
  if (el.hasAttribute('data-infotip')) return infoContent.get(el) ?? null;
  return el.getAttribute('data-tip') || el.getAttribute('data-tip-clip') || null;
}

export default function TooltipHost() {
  const open = useSyncExternalStore(tipController.subscribe, tipController.current);
  useSyncExternalStore(
    (fn) => {
      contentListeners.add(fn);
      return () => contentListeners.delete(fn);
    },
    () => contentVersion,
  );
  const boxRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ el: HTMLElement; left: number; top: number } | null>(null);

  // 문서 전체 — 마우스(대상 · 상자) · 초점 · 닫히는 때
  useEffect(() => {
    let zone: HTMLElement | 'box' | null = null;
    const moveTo = (next: HTMLElement | 'box' | null) => {
      if (next === zone) return;
      if (zone === 'box') tipController.boxOut();
      else if (zone) tipController.hoverOut(zone);
      zone = next;
      if (next === 'box') tipController.boxIn();
      else if (next) tipController.hoverIn(next);
    };
    const zoneOf = (t: EventTarget | null): HTMLElement | 'box' | null => (t instanceof Node && boxRef.current?.contains(t) ? 'box' : tipTarget(t));
    /** 마우스가 지금 올라가 있는 요소 — 툴팁 숨김 표시가 바뀌면 이 자리로 다시 판단한다 */
    let over: EventTarget | null = null;
    const onOver = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      over = e.target;
      const cur = tipController.current();
      if (cur && !cur.isConnected) tipController.hide(cur);
      moveTo(zoneOf(e.target));
    };
    const onOut = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' && e.relatedTarget == null) {
        over = null;
        moveTo(null);
      }
    };
    // 툴팁 숨김 표시(`data-tip-off`)가 붙으면 그 요소 툴팁을 바로 닫고, 떨어지면 마우스 자리로 다시 판단(0.3초 뒤 열림)
    const offWatch = new MutationObserver((list) => {
      for (const m of list) {
        const el = m.target as HTMLElement;
        if (el.hasAttribute('data-tip-off')) tipController.hide(el);
      }
      moveTo(zoneOf(over));
    });
    offWatch.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['data-tip-off'] });
    const onDown = () => tipController.press();
    const onFocusIn = (e: FocusEvent) => {
      const t = e.target;
      if (!(t instanceof Element) || !t.matches(':focus-visible')) return;
      const el = tipTarget(t);
      if (el) tipController.focusIn(el);
    };
    const onFocusOut = (e: FocusEvent) => {
      const el = e.target instanceof Element ? e.target.closest<HTMLElement>(TIP_SELECTOR) : null;
      if (el) tipController.focusOut(el);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && tipController.current()) tipController.escape();
    };
    const onScroll = () => tipController.scroll();
    const onResize = () => tipController.resize();
    const onBlur = () => tipController.windowBlur();
    document.addEventListener('pointerover', onOver);
    document.addEventListener('pointerout', onOut);
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    window.addEventListener('blur', onBlur);
    return () => {
      offWatch.disconnect();
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('pointerout', onOut);
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  // 대상에 aria-describedby — 열린 동안만(원래 값은 되돌린다)
  useEffect(() => {
    if (!open) return;
    const before = open.getAttribute('aria-describedby');
    open.setAttribute('aria-describedby', before ? `${before} ${TIP_ID}` : TIP_ID);
    return () => {
      if (before) open.setAttribute('aria-describedby', before);
      else open.removeAttribute('aria-describedby');
    };
  }, [open]);

  const content = open ? contentOf(open) : null;

  // 크기를 잰 뒤 자리를 정하고 보이게(처음엔 숨김)
  useLayoutEffect(() => {
    if (!open || content == null || !boxRef.current) {
      setPos(null);
      return;
    }
    const b = boxRef.current.getBoundingClientRect();
    const p = placeTip(open.getBoundingClientRect(), { w: b.width, h: b.height }, { w: window.innerWidth, h: window.innerHeight });
    setPos({ el: open, left: p.left, top: p.top });
  }, [open, content]);

  if (!open || content == null) return null;
  const placed = pos?.el === open ? pos : null;
  return createPortal(
    <div
      ref={boxRef}
      id={TIP_ID}
      role="tooltip"
      data-tooltip
      style={{ left: placed?.left ?? 0, top: placed?.top ?? 0, maxWidth: tipMaxWidth(window.innerWidth), visibility: placed ? 'visible' : 'hidden' }}
      className={TOOLTIP_BOX}
    >
      {content}
    </div>,
    document.body,
  );
}
