import { useSyncExternalStore } from 'react';

/**
 * 화면 모양 — `phone` · `pad` · `desk`(1280 이상 = 지금 모양 그대로 · v2.73.0).
 *
 * 조건은 `src/index.css` 한 곳(`@custom-variant phone` · `pad`)이고, 거기서 정한 `--layout-mode` 를 읽기만 한다 —
 * 여기에 폭 숫자를 다시 쓰지 않는다(CSS 의 `phone:` 과 JS 의 판단이 갈라지지 않게).
 * 창 크기 · 방향이 바뀔 때(`resize`)만 다시 읽는다.
 */
export type LayoutMode = 'phone' | 'pad' | 'desk';

let current: LayoutMode | null = null;

/** 지금 화면 모양을 바로 읽는다(훅 밖 — 스토어 처음 값 등). 조건은 `index.css` 한 곳 */
export function readLayoutMode(): LayoutMode {
  return read();
}

function read(): LayoutMode {
  if (typeof document === 'undefined') return 'desk';
  const v = getComputedStyle(document.documentElement).getPropertyValue('--layout-mode').trim();
  return v === 'phone' || v === 'pad' ? v : 'desk';
}

function snapshot(): LayoutMode {
  if (current == null) current = read();
  return current;
}

function subscribe(onChange: () => void): () => void {
  const onResize = () => {
    const next = read();
    if (next === current) return;
    current = next;
    onChange();
  };
  window.addEventListener('resize', onResize);
  return () => window.removeEventListener('resize', onResize);
}

export function useLayoutMode(): LayoutMode {
  return useSyncExternalStore(subscribe, snapshot, () => 'desk');
}

/**
 * 폰 가로(v2.82.0 · 테마 5-2 끝 줄 — 높이 < 500 인 폰). 조건은 `index.css` 의 `--layout-short` 한 곳 — 여기에 높이 숫자를 쓰지 않는다.
 * 폰이 아니면 늘 false.
 */
let short: boolean | null = null;
const readShort = () =>
  typeof document !== 'undefined' && getComputedStyle(document.documentElement).getPropertyValue('--layout-short').trim() === '1';
function subscribeShort(onChange: () => void): () => void {
  const onResize = () => {
    const next = readShort();
    if (next === short) return;
    short = next;
    onChange();
  };
  window.addEventListener('resize', onResize);
  return () => window.removeEventListener('resize', onResize);
}
function shortSnapshot(): boolean {
  if (short == null) short = readShort();
  return short;
}
export function usePhoneLandscape(): boolean {
  const mode = useLayoutMode();
  const s = useSyncExternalStore(subscribeShort, shortSnapshot, () => false);
  return mode === 'phone' && s;
}

/**
 * 손가락 화면(v2.82.0 · CSS `touch:` 와 같은 조건 — `index.css` 의 `--touch-screen` 한 곳) — 키 · 휠 · 드래그 안내를 숨길 때(테마 9-1 R9).
 */
let touch: boolean | null = null;
const readTouch = () =>
  typeof document !== 'undefined' && getComputedStyle(document.documentElement).getPropertyValue('--touch-screen').trim() === '1';
function subscribeTouch(onChange: () => void): () => void {
  const onResize = () => {
    const next = readTouch();
    if (next === touch) return;
    touch = next;
    onChange();
  };
  window.addEventListener('resize', onResize);
  return () => window.removeEventListener('resize', onResize);
}
export function useTouchScreen(): boolean {
  return useSyncExternalStore(subscribeTouch, () => {
    if (touch == null) touch = readTouch();
    return touch;
  }, () => false);
}
