import type { ReactNode } from 'react';
import { CHIP_SIZE, TOUCH_HIT } from './tokens';

/**
 * 고르기 칩(v2.76.0 · 디자인 규칙 「버튼 부품을 쓰지 않는 것 — 고르기 칩」) — 줄 안에서 하나를 고르는 작은 글자 단추.
 * 고른 칩 = 한 단계 밝은 바탕(bg-elevated) + 흰 글자 500 · 안 고른 칩 = 회색 글자 + 올리면 바탕. 테두리 · 파란색 없음.
 * 크기는 `tokens.CHIP_SIZE` 한 곳 · 손가락 화면 누르는 칸 44 는 이 부품이 맡는다(`TOUCH_HIT` — 화면 파일에 따로 쓰지 않는다).
 * `tab` 크기는 계좌 화면 아래 탭(안 고른 칩에 올리면 글자도 밝게).
 */
export default function Chip({
  selected,
  onClick,
  size = 'md',
  children,
}: {
  selected: boolean;
  onClick: () => void;
  size?: keyof typeof CHIP_SIZE;
  children: ReactNode;
}) {
  const off = size === 'tab' ? 'text-text-secondary hover:bg-bg-tertiary hover:text-text-primary' : 'text-text-secondary hover:bg-bg-tertiary';
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={`rounded ${CHIP_SIZE[size]} transition-colors ${TOUCH_HIT} ${selected ? 'bg-bg-elevated font-medium text-text-primary' : off}`}
    >
      {children}
    </button>
  );
}
