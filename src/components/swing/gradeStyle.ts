import type { SwingGrade } from '../../types/swing';

/**
 * 등급 표기를 한 곳에 — 카드·검색·이력이 같은 색을 쓰게 한다.
 * v2.36.0: 이모지(⭐🟢🟡⚪❌)를 지우고 **글자 배지**(`tone` = ui/Badge 색)로 — 색만이 아니라 글자로 등급을 읽는다.
 */
export const GRADE_STYLE: Record<SwingGrade, { label: string; tone: 'bullish' | 'warning' | 'neutral'; className: string }> = {
  STRONG: { label: '강력 추천', tone: 'bullish', className: 'border-bullish/50' },
  BUY: { label: '추천', tone: 'bullish', className: 'border-bullish/30' },
  WATCH: { label: '관심', tone: 'warning', className: 'border-warning/40' },
  HOLD: { label: '보류', tone: 'neutral', className: 'border-border' },
  AVOID: { label: '부적합', tone: 'neutral', className: 'border-border' },
};
