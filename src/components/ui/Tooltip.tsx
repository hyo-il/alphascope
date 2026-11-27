import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { TOOLTIP_BOX, TOOLTIP_CLOSE_MS, TOOLTIP_LONG_PRESS_MS, TOOLTIP_OPEN_MS, TOOLTIP_TOUCH_MOVE_PX } from './tokens';
import { createTipController, type TouchKind } from './tooltip/hover';
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
 * - `data-tip-side="right"` — **옆으로**(대상 오른쪽 · 자리가 모자라면 왼쪽 · 세로 가운데). 없으면 아래 / 위.
 *   표 안 줄마다 있는 작은 아이콘 버튼에 단다(아래로 뜨면 다음 줄 글을 가린다 — 실시간 순위 관심 별 등).
 *
 * 문서 전체의 마우스 · 키보드 초점 · 손가락을 보고 표시가 달린 요소의 툴팁을 `document.body` 에 그린다(조상의 넘침 숨김에 잘리지 않게).
 * **손가락**(`pointerType` touch · pen — v2.74.0 · 사용자 결정 2026-11-25): 누를 때 하는 일이 없는 대상([ⓘ] · 점선 글자 · 누름 동작이 없는 요소의
 *   `data-tip` · 잘린 `data-tip-clip`)은 **누르면** 열림 · 같은 것을 다시 누르면 닫힘. 하는 일이 있는 대상(단추 · 링크 · 입력 · 탭 · 누르면 이동하는 줄)은
 *   **0.5초 길게 누르면** 열리고, 손을 떼도 그 동작은 일어나지 않는다(뒤따르는 click 하나를 막음). 짧게 누르면 동작만 · 누른 채 10px 넘게 밀면 취소.
 *   「하는 일이 있나」 는 여기 한 곳(`touchKind`)에서 가린다 — 역할(단추 · 링크 · 입력 · 탭 …) 또는 **손가락 모양 커서**(`cursor: pointer` —
 *   누르면 이동하는 표 줄은 `cursor-pointer` 를 이미 단다 · 커서는 물려받으므로 줄 안 이름 칸도 같다). 화면 코드는 따로 표시를 달지 않는다.
 *   길게 누를 때 브라우저 기본 메뉴(글 고르기 · 링크 미리보기)는 `index.css` 가 툴팁 대상에만 막고, `contextmenu` 도 여기서 막는다.
 * **초점**: 키보드 초점(`:focus-visible`)이면 바로 열림 — 손가락 화면에서는 마지막 입력이 키일 때만(v2.80.0 · 판단은 `tooltip/hover` `focusIn` 한 곳 ·
 *   창이 열리며 × 로 간 초점에 「닫기」 가 저절로 뜨지 않게 — 창마다 따로 막지 않는다).
 * 열린 툴팁은 앱 전체에서 하나. 다른 곳을 누름 · 스크롤 · Esc · 창 크기 바뀜에 닫힌다.
 * 시간 · 크기 · 상자 모양은 `tokens.ts` 「툴팁」 한 곳.
 */
export const tipController = createTipController<HTMLElement>(
  { now: () => performance.now(), setTimeout: (fn, ms) => window.setTimeout(fn, ms), clearTimeout: (id) => window.clearTimeout(id as number) },
  { openMs: TOOLTIP_OPEN_MS, closeMs: TOOLTIP_CLOSE_MS, longPressMs: TOOLTIP_LONG_PRESS_MS, moveTolerancePx: TOOLTIP_TOUCH_MOVE_PX },
  // 손가락 화면(v2.80.0) — CSS `touch:` 와 같은 조건(`pointer: coarse` · 폭과 상관없음 · `ui/tokens.ts` 「손가락 화면」)
  { touchScreen: () => typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches },
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

/** 누를 때 하는 일이 있는 요소(그 조상 포함) — 길게 눌러야 툴팁 */
const PRESS_ACTION = 'a[href], button, input, select, textarea, label, summary, [role="button"], [role="tab"], [role="link"], [role="radio"], [role="checkbox"], [role="switch"], [role="menuitem"], [role="option"]';

/** 손가락 대상 종류 — [ⓘ] · 꺼진 단추 · 누름 동작이 없는 글은 `tap`(누르면 열림), 그 밖은 `press`(길게 눌러 열림) */
function touchKind(el: HTMLElement): TouchKind {
  if (el.hasAttribute('data-infotip')) return 'tap';
  const act = el.closest<HTMLElement>(PRESS_ACTION);
  if (act && !(act as HTMLButtonElement).disabled) return 'press';
  return getComputedStyle(el).cursor === 'pointer' ? 'press' : 'tap';
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
  /**
   * 대상이 든 판의 움직임(폰 아래 판이 올라오는 200ms 등 — `index.css` `.sheet-panel`)이 끝나면 자리를 다시 잰다(v2.79.0).
   * 창이 열리며 초점이 × 로 가 움직이는 중에 열린 툴팁이 판이 오기 전 자리(화면 아래)에 남지 않게.
   */
  const [placeTick, setPlaceTick] = useState(0);

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
    // 손가락 — 누르는 순간 대상 · 종류를 정하고, 뗄 때 열거나(누르기) 뒤따르는 click 을 막는다(길게 누르기)
    let lastPointer: string = 'mouse';
    const onDown = (e: PointerEvent) => {
      lastPointer = e.pointerType;
      if (e.pointerType === 'mouse') return tipController.press();
      const el = tipTarget(e.target);
      tipController.touchDown(el, el ? touchKind(el) : 'tap', e.clientX, e.clientY);
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') tipController.touchMove(e.clientX, e.clientY);
    };
    const swallowClick = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dropSwallow();
    };
    let swallowTimer = 0;
    const dropSwallow = () => {
      window.removeEventListener('click', swallowClick, true);
      window.clearTimeout(swallowTimer);
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerType === 'mouse' || !tipController.touchUp()) return;
      // 길게 눌러 열었다 — 손을 뗄 때 오는 click 하나만 막는다(오지 않으면 잠시 뒤 풀어 다음 누름은 그대로)
      dropSwallow();
      window.addEventListener('click', swallowClick, true);
      swallowTimer = window.setTimeout(dropSwallow, 800);
    };
    const onCancel = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') tipController.touchCancel();
    };
    // 길게 누를 때 브라우저 메뉴 — 툴팁 대상에서만 막는다
    const onContext = (e: MouseEvent) => {
      if (lastPointer !== 'mouse' && tipTarget(e.target)) e.preventDefault();
    };
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
      tipController.keyDown();
      if (e.key === 'Escape' && tipController.current()) tipController.escape();
    };
    const onScroll = () => tipController.scroll();
    const onResize = () => tipController.resize();
    const onBlur = () => tipController.windowBlur();
    const onAnimEnd = (e: AnimationEvent) => {
      const cur = tipController.current();
      if (cur && e.target instanceof Node && e.target.contains(cur)) setPlaceTick((n) => n + 1);
    };
    document.addEventListener('pointerover', onOver);
    document.addEventListener('pointerout', onOut);
    document.addEventListener('pointerdown', onDown, true);
    document.addEventListener('pointermove', onMove, true);
    document.addEventListener('pointerup', onUp, true);
    document.addEventListener('pointercancel', onCancel, true);
    document.addEventListener('contextmenu', onContext, true);
    document.addEventListener('focusin', onFocusIn);
    document.addEventListener('focusout', onFocusOut);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    window.addEventListener('blur', onBlur);
    document.addEventListener('animationend', onAnimEnd, true);
    return () => {
      offWatch.disconnect();
      document.removeEventListener('pointerover', onOver);
      document.removeEventListener('pointerout', onOut);
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('pointermove', onMove, true);
      document.removeEventListener('pointerup', onUp, true);
      document.removeEventListener('pointercancel', onCancel, true);
      document.removeEventListener('contextmenu', onContext, true);
      dropSwallow();
      document.removeEventListener('focusin', onFocusIn);
      document.removeEventListener('focusout', onFocusOut);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('animationend', onAnimEnd, true);
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
    const side = open.getAttribute('data-tip-side') === 'right' ? 'right' : undefined;
    const p = placeTip(open.getBoundingClientRect(), { w: b.width, h: b.height }, { w: window.innerWidth, h: window.innerHeight }, side);
    setPos({ el: open, left: p.left, top: p.top });
  }, [open, content, placeTick]);

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
