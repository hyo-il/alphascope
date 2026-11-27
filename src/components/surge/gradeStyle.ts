import type { SurgeGrade } from '../../types/surge';

/**
 * 등급 표기를 한 곳에 모은다 — 카드와 검색 평가가 다른 색을 쓰면 같은 점수가
 * 화면마다 달라 보인다.
 * 글자 배지(`tone` = ui/Badge 색) — 이모지를 쓰지 않는다. 급등(오름)은 상승 초록(빨강은 하락 · 매도 · 틀린 칸에만 — 테마 9-1 R2).
 */
export const GRADE_STYLE: Record<SurgeGrade, { label: string; tone: 'bullish' | 'warning' | 'neutral'; className: string }> = {
  HIGH: { label: '급등 가능성 높음', tone: 'bullish', className: 'border-bullish/50 text-bullish' },
  MEDIUM: { label: '관심 필요', tone: 'warning', className: 'border-warning/50 text-warning' },
  LOW: { label: '가능성 낮음', tone: 'neutral', className: 'border-border text-text-secondary' },
  NONE: { label: '신호 없음', tone: 'neutral', className: 'border-border text-text-muted' },
};
