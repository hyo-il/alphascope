import { CONTROL_H, ORDER_BUY_COLOR, ORDER_SELL_COLOR, SEGMENT_H, TOUCH_FIELD_H, TOUCH_HIT } from './tokens';
import type { ReactNode } from 'react';

export interface SegmentedOption<T extends string | number> {
  value: T;
  label: ReactNode;
  /** 툴팁 — 칸 글자만으로 뜻이 모자랄 때 */
  title?: string;
  disabled?: boolean;
  /**
   * 이 칸을 골랐을 때의 색 — 기본은 밝은 바탕 + 흰 글자. `warning` = 주황 바탕 + 주황 글자.
   * 켜 두면 동작이 달라지는 설정을 켰을 때만 쓴다(지금: 자동매매 설정 「AI 검증 [켬]」). 새 색을 만들지 않고 기준표 토큰을 쓴다.
   */
  activeTone?: 'warning' | 'buy' | 'sell';
}

/** 고른 칸 색 — 기본 · 주황(켜 두면 동작이 바뀌는 설정) · 매수 초록 / 매도 빨강(`tokens` `ORDER_*` · 폰 빠른 주문 [매수 | 매도]) */
const ACTIVE: Record<NonNullable<SegmentedOption<string>['activeTone']> | 'default', string> = {
  default: 'bg-bg-elevated font-medium text-text-primary',
  warning: 'bg-warning/20 font-medium text-warning',
  buy: `${ORDER_BUY_COLOR} font-medium`,
  sell: `${ORDER_SELL_COLOR} font-medium`,
};

/**
 * 묶음 버튼 (디자인 규칙 2) — 미국/국내 · 1일/1주 · 일/주/월 처럼 **하나를 고르는** 줄.
 *
 * 회색 바탕 묶음 안에서 **고른 칸만 한 단계 밝은 바탕 + 흰 글자**. 테두리·파란색을 쓰지 않는다 —
 * 고른 버튼마다 파란 테두리 + 파란 글자면 화면이 파란 상자로 어지럽다.
 * 색·굵기는 바꿀 수 없다(크기만 sm/md) — 예외는 칸의 `activeTone`. 키보드: radiogroup 이라 Tab 으로 들어와 각 칸을 누른다.
 */
export default function Segmented<T extends string | number>({
  options,
  value,
  onChange,
  size = 'md',
  label,
  fieldRow = false,
  full = false,
}: {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  size?: 'sm' | 'md';
  /** 화면 읽기용 이름(예: "시장") — 글자로는 보이지 않는다 */
  label: string;
  /** 입력 칸과 같은 줄(v2.82.0) — 손가락 화면에서 입력 칸(44)과 같은 높이(같은 줄 높이 · 테마 6) · 마우스 화면은 그대로 */
  fieldRow?: boolean;
  /** 줄 폭 전체 · 칸은 같은 폭으로 나눔(v2.82.0 폰 빠른 주문) */
  full?: boolean;
}) {
  // 높이는 기준표(tokens) — 바깥 틀 = 버튼·입력칸과 같은 높이(32/28px), 안 칸 = 그 안에서 2px 씩 여백
  const pad = `${SEGMENT_H[size]} ${size === 'sm' ? 'px-2.5' : 'px-3'}${fieldRow ? ' touch:h-10' : ''}${full ? ' flex-1' : ''}`;
  return (
    <div role="radiogroup" aria-label={label} className={`${full ? 'flex w-full' : 'inline-flex shrink-0'} items-center gap-0.5 rounded-lg bg-bg-tertiary p-0.5 ${CONTROL_H[size]}${fieldRow ? ` ${TOUCH_FIELD_H}` : ''}`}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={on}
            data-tip={o.title}
            data-tone={on && o.activeTone === 'sell' ? 'sell' : undefined}
            disabled={o.disabled}
            onClick={() => !on && onChange(o.value)}
            className={`whitespace-nowrap rounded-md text-xs transition-colors disabled:opacity-40 ${pad} ${TOUCH_HIT} ${
              on ? ACTIVE[o.activeTone ?? 'default'] : 'text-text-secondary hover:text-text-primary'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
