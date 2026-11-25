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
