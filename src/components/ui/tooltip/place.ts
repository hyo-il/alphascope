import { TOOLTIP_EDGE, TOOLTIP_GAP, TOOLTIP_MAX_W } from '../tokens';

/**
 * 툴팁 자리 계산 — 순수(DOM 없음 · `tooltip:test`). `ui/Tooltip` 이 [ⓘ] 과 함께 쓴다.
 * - 대상 바로 아래 `TOOLTIP_GAP`(4px). 아래 자리가 모자라고 위에 들어가면 위로.
 * - 가로는 대상 가운데에 맞추고 화면 끝에서 `TOOLTIP_EDGE`(8px) 안쪽으로 당긴다.
 */
export interface TipRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** 상자 최대 폭 — 320px · 화면 폭 − 16px 가운데 작은 것 */
export const tipMaxWidth = (viewportW: number) => Math.max(0, Math.min(TOOLTIP_MAX_W, viewportW - 2 * TOOLTIP_EDGE));

export function placeTip(target: TipRect, box: { w: number; h: number }, viewport: { w: number; h: number }): { left: number; top: number; side: 'below' | 'above' } {
  const belowTop = target.bottom + TOOLTIP_GAP;
  const aboveTop = target.top - TOOLTIP_GAP - box.h;
  const fitsBelow = belowTop + box.h <= viewport.h - TOOLTIP_EDGE;
  const fitsAbove = aboveTop >= TOOLTIP_EDGE;
  const side = !fitsBelow && fitsAbove ? 'above' : 'below';
  const centered = (target.left + target.right) / 2 - box.w / 2;
  const left = Math.max(TOOLTIP_EDGE, Math.min(centered, viewport.w - TOOLTIP_EDGE - box.w));
  return { left, top: side === 'above' ? aboveTop : belowTop, side };
}
