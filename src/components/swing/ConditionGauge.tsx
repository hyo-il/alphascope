import type { ConditionScore } from '../../types/swing';

/**
 * 5가지 조건 게이지.
 *
 * 종합 점수만 보여 주면 "왜 87점인지" 를 알 수 없다. 어느 조건이 채워졌고 어디가
 * 비었는지가 보여야, 사용자가 자기 판단으로 추천을 걸러낼 수 있다.
 */
const LABELS: Record<string, string> = {
  trend: '추세',
  timing: '타이밍',
  momentum: '모멘텀',
  volume: '거래량',
  riskReward: '리스크/리워드',
};

/** 충족률에 따른 색 — 초록(높음) → 노랑(보통) → 빨강(낮음) */
function colorOf(ratio: number): string {
  if (ratio >= 0.75) return 'bg-bullish';
  if (ratio >= 0.4) return 'bg-warning';
  return 'bg-bearish';
}

export default function ConditionGauge({
  conditions,
}: {
  conditions: Record<string, ConditionScore>;
}) {
  return (
    <ul className="space-y-1">
      {Object.entries(conditions).map(([key, condition]) => {
        const ratio = condition.max ? condition.score / condition.max : 0;
        return (
          <li key={key} className="flex items-center gap-2 text-[11px]">
            <span className="w-20 shrink-0 text-text-secondary">{LABELS[key] ?? key}</span>
            <span
              className="h-2 min-w-0 flex-1 overflow-hidden rounded bg-bg-tertiary"
              title={`${condition.details}\n${condition.checks
                .map((c) => `${c.passed ? '✅' : '⬜'} ${c.label}`)
                .join('\n')}`}
            >
              <span
                className={`block h-full rounded ${colorOf(ratio)}`}
                style={{ width: `${Math.round(ratio * 100)}%` }}
              />
            </span>
            <span className="w-12 shrink-0 text-right tabular-nums text-text-primary">
              {condition.score}/{condition.max}
            </span>
          </li>
        );
      })}
    </ul>
  );
}
