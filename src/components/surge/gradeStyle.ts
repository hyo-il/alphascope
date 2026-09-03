import type { SurgeGrade } from '../../types/surge';

/**
 * 등급 표기를 한 곳에 모은다 — 카드와 검색 평가가 다른 색을 쓰면 같은 점수가
 * 화면마다 달라 보인다.
 */
export const GRADE_STYLE: Record<SurgeGrade, { icon: string; label: string; className: string }> = {
  HIGH: { icon: '🔴', label: '급등 가능성 높음', className: 'border-bearish/50 text-bearish' },
  MEDIUM: { icon: '🟡', label: '관심 필요', className: 'border-warning/50 text-warning' },
  LOW: { icon: '⚪', label: '가능성 낮음', className: 'border-border text-text-secondary' },
  NONE: { icon: '·', label: '신호 없음', className: 'border-border text-text-muted' },
};

/** 다음 예상일까지 남은 일수를 사람 말로 */
export function daysLabel(days: number | null): string {
  if (days == null) return '예상일 없음';
  if (days === 0) return '오늘';
  if (days > 0) return `${days}일 후`;
  return `${Math.abs(days)}일 지남`;
}
