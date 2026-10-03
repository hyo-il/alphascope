import type { LucideIcon } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { ICON, ICON_SM } from './icon';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger';
type IconType = LucideIcon;

const VARIANT: Record<Variant, string> = {
  // 파란색은 그 화면의 **주요 실행 버튼 하나**에만 (디자인 규칙 2)
  primary: 'bg-accent text-white hover:bg-accent-hover',
  secondary: 'bg-bg-tertiary text-text-primary hover:bg-bg-elevated',
  ghost: 'text-text-secondary hover:bg-bg-tertiary hover:text-text-primary',
  danger: 'bg-bearish text-white hover:brightness-110',
};
const SIZE = { sm: 'h-7 gap-1 px-2.5 text-xs', md: 'h-8 gap-1.5 px-3 text-xs' } as const;

/**
 * 버튼 (v2.36.0) — variant 4개 · 크기 2개만. 테두리 없음, 굵기 중간(500).
 * `className` 은 **자리 잡기(여백·위치·너비)** 에만 쓴다 — 색·굵기·테두리를 덧칠하지 않는다.
 * 줄바꿈하지 않는다(`whitespace-nowrap shrink-0` — 문장은 줄바꿈, 버튼은 그대로).
 */
const Button = forwardRef<
  HTMLButtonElement,
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> & {
    variant?: Variant;
    size?: keyof typeof SIZE;
    icon?: IconType;
    children?: ReactNode;
  }
>(function Button({ variant = 'secondary', size = 'md', icon: Icon, children, className = '', type = 'button', ...rest }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      {...rest}
      className={`inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-md font-medium transition-colors disabled:opacity-40 ${VARIANT[variant]} ${SIZE[size]} ${className}`}
    >
      {Icon && <Icon {...(size === 'sm' ? ICON_SM : ICON)} />}
      {children}
    </button>
  );
});
export default Button;
