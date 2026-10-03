import type { ReactNode } from 'react';

const TONE = {
  neutral: 'bg-bg-tertiary text-text-secondary',
  accent: 'bg-accent/15 text-accent',
  bullish: 'bg-bullish/15 text-bullish',
  bearish: 'bg-bearish/15 text-bearish',
  warning: 'bg-warning/15 text-warning',
} as const;

/** 작은 표시 (v2.36.0) — 옅은 바탕 + 13px 글자, 테두리 없음. 「테스트」 「현재 계좌」 「잠정」 같은 꼬리표. */
export default function Badge({ tone = 'neutral', title, children }: { tone?: keyof typeof TONE; title?: string; children: ReactNode }) {
  return (
    <span title={title} className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded px-1.5 py-px text-[13px] font-normal ${TONE[tone]}`}>
      {children}
    </span>
  );
}
