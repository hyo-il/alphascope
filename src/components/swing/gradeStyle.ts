import type { SwingGrade } from '../../types/swing';

/** 등급 표기를 한 곳에 — 카드·검색·이력이 같은 색을 쓰게 한다 */
export const GRADE_STYLE: Record<SwingGrade, { icon: string; label: string; className: string }> = {
  STRONG: { icon: '⭐', label: '강력 추천', className: 'border-bullish/50' },
  BUY: { icon: '🟢', label: '추천', className: 'border-bullish/30' },
  WATCH: { icon: '🟡', label: '관심', className: 'border-warning/40' },
  HOLD: { icon: '⚪', label: '보류', className: 'border-border' },
  AVOID: { icon: '❌', label: '부적합', className: 'border-border' },
};
