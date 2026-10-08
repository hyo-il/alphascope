import { CONTROL_H, SEGMENT_H } from './tokens';
import type { ReactNode } from 'react';

export interface SegmentedOption<T extends string | number> {
  value: T;
  label: ReactNode;
  /** 툴팁 — 칸 글자만으로 뜻이 모자랄 때 */
  title?: string;
  disabled?: boolean;
}

/**
 * 묶음 버튼 (v2.36.0 디자인 규칙 2) — 미국/국내 · 1일/1주 · 일/주/월 처럼 **하나를 고르는** 줄.
 *
 * 회색 바탕 묶음 안에서 **고른 칸만 한 단계 밝은 바탕 + 흰 글자**. 테두리·파란색을 쓰지 않는다 —
 * 예전에는 고른 버튼마다 파란 테두리 + 파란 글자라 화면이 파란 상자로 어지러웠다.
 * 색·굵기는 바꿀 수 없다(크기만 sm/md). 키보드: radiogroup 이라 Tab 으로 들어와 각 칸을 누른다.
 */
export default function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  size = 'md',
  label,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: 'sm' | 'md';
  /** 화면 읽기용 이름(예: "시장") — 글자로는 보이지 않는다 */
  label: string;
}) {
  // 높이는 기준표(tokens) — 바깥 틀 = 버튼·입력칸과 같은 높이(32/28px), 안 칸 = 그 안에서 2px 씩 여백
  const pad = `${SEGMENT_H[size]} ${size === 'sm' ? 'px-2.5' : 'px-3'}`;
  return (
    <div role="radiogroup" aria-label={label} className={`inline-flex shrink-0 items-center gap-0.5 rounded-lg bg-bg-tertiary p-0.5 ${CONTROL_H[size]}`}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={on}
            title={o.title}
            disabled={o.disabled}
            onClick={() => !on && onChange(o.value)}
            className={`whitespace-nowrap rounded-md text-xs transition-colors disabled:opacity-40 ${pad} ${
              on ? 'bg-bg-elevated font-medium text-text-primary' : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
