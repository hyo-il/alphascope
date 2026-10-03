import type { SurgeGrade } from '../../types/surge';

/**
 * 등급 표기를 한 곳에 모은다 — 카드와 검색 평가가 다른 색을 쓰면 같은 점수가
 * 화면마다 달라 보인다.
 * v2.36.0: 이모지(🔴🟡⚪)를 지우고 글자 배지(`tone` = ui/Badge 색)로.
 */
export const GRADE_STYLE: Record<SurgeGrade, { label: string; tone: 'bearish' | 'warning' | 'neutral'; className: string }> = {
  HIGH: { label: '급등 가능성 높음', tone: 'bearish', className: 'border-bearish/50 text-bearish' },
  MEDIUM: { label: '관심 필요', tone: 'warning', className: 'border-warning/50 text-warning' },
  LOW: { label: '가능성 낮음', tone: 'neutral', className: 'border-border text-text-secondary' },
  NONE: { label: '신호 없음', tone: 'neutral', className: 'border-border text-text-muted' },
};
