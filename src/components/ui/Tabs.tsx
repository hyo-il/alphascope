import type { ReactNode } from 'react';

export interface TabItem<T extends string> {
  id: T;
  label: ReactNode;
  /** 라벨 옆 작은 글자(개수·「테스트」 등) */
  badge?: ReactNode;
  title?: string;
}

/**
 * 탭 (v2.36.0 디자인 규칙 2) — 글자 + **고른 탭만 흰 글자 + 밑줄 2px**, 나머지는 회색 글자. 상자·테두리 없음.
 * 바닥의 옅은 선 하나만 둔다(`line` 을 끄면 그것도 없다 — 패널 머리처럼 이미 선이 있는 자리).
 */
export default function Tabs<T extends string>({
  items,
  value,
  onChange,
  size = 'md',
  line = true,
  label,
}: {
  items: TabItem<T>[];
  value: T;
  onChange: (id: T) => void;
  size?: 'sm' | 'md';
  line?: boolean;
  label: string;
}) {
  const text = size === 'sm' ? 'text-xs' : 'text-sm';
  const gap = size === 'sm' ? 'gap-3' : 'gap-4';
  return (
    <div role="tablist" aria-label={label} className={`flex shrink-0 items-end ${gap} ${line ? 'border-b border-border/60' : ''}`}>
      {items.map((t) => {
        const on = t.id === value;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={on}
            title={t.title}
            onClick={() => onChange(t.id)}
            className={`relative -mb-px inline-flex items-center gap-1 whitespace-nowrap border-b-2 py-2 transition-colors ${text} ${
              on ? 'border-text-primary font-medium text-text-primary' : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            {t.label}
            {t.badge != null && <span className="text-[13px] font-normal text-text-muted">{t.badge}</span>}
          </button>
        );
      })}
    </div>
  );
}
