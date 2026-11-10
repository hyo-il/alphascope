import { TOOLTIP_EDGE, TOOLTIP_GAP, TOOLTIP_MAX_W } from '../tokens';

/**
 * 툴팁 자리 계산 — 순수(DOM 없음 · `tooltip:test`). `ui/Tooltip` 이 [ⓘ] 과 함께 쓴다.
 * - 기본: 대상 바로 아래 `TOOLTIP_GAP`(4px). 아래 자리가 모자라고 위에 들어가면 위로.
 *   가로는 대상 가운데에 맞추고 화면 끝에서 `TOOLTIP_EDGE`(8px) 안쪽으로 당긴다.
 * - 옆(`prefer = 'right'` — 요소의 `data-tip-side="right"`): 대상 오른쪽 4px · 자리가 모자라고 왼쪽에 들어가면 왼쪽.
 *   세로는 대상 가운데에 맞추고 화면 위아래 끝에서 8px 안쪽으로 당긴다. 양옆 다 모자라면 기본(아래 / 위)으로.
 *   표 안 줄마다 있는 작은 버튼 — 아래로 뜨면 다음 줄 글을 가린다.
 */
export interface TipRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export type TipSide = 'below' | 'above' | 'right' | 'left';

/** 상자 최대 폭 — 320px · 화면 폭 − 16px 가운데 작은 것 */
export const tipMaxWidth = (viewportW: number) => Math.max(0, Math.min(TOOLTIP_MAX_W, viewportW - 2 * TOOLTIP_EDGE));

export function placeTip(
  target: TipRect,
  box: { w: number; h: number },
  viewport: { w: number; h: number },
  prefer?: 'right',
): { left: number; top: number; side: TipSide } {
  if (prefer === 'right') {
    const rightLeft = target.right + TOOLTIP_GAP;
    const leftLeft = target.left - TOOLTIP_GAP - box.w;
    const fitsRight = rightLeft + box.w <= viewport.w - TOOLTIP_EDGE;
    const fitsLeft = leftLeft >= TOOLTIP_EDGE;
    if (fitsRight || fitsLeft) {
      const middle = (target.top + target.bottom) / 2 - box.h / 2;
      const top = Math.max(TOOLTIP_EDGE, Math.min(middle, viewport.h - TOOLTIP_EDGE - box.h));
      return fitsRight ? { left: rightLeft, top, side: 'right' } : { left: leftLeft, top, side: 'left' };
    }
  }
  const belowTop = target.bottom + TOOLTIP_GAP;
  const aboveTop = target.top - TOOLTIP_GAP - box.h;
  const fitsBelow = belowTop + box.h <= viewport.h - TOOLTIP_EDGE;
  const fitsAbove = aboveTop >= TOOLTIP_EDGE;
  const side = !fitsBelow && fitsAbove ? 'above' : 'below';
  const centered = (target.left + target.right) / 2 - box.w / 2;
  const left = Math.max(TOOLTIP_EDGE, Math.min(centered, viewport.w - TOOLTIP_EDGE - box.w));
  return { left, top: side === 'above' ? aboveTop : belowTop, side };
}
