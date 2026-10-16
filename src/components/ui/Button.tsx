import { LoaderCircle, type LucideIcon } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { ICON, ICON_SM } from './icon';
import { CONTROL_H } from './tokens';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'danger-text';
type IconType = LucideIcon;

const VARIANT: Record<Variant, string> = {
  // 파란색은 그 화면의 **주요 실행 버튼 하나**에만 (디자인 규칙 2)
  primary: 'bg-accent text-white hover:bg-accent-hover',
  secondary: 'bg-bg-tertiary text-text-primary hover:bg-bg-elevated',
  ghost: 'text-text-secondary hover:bg-bg-tertiary hover:text-text-primary',
  // 확인 창의 「삭제」 = 빨간 바탕 / 화면 안의 삭제(「방법 3 삭제」·「모두 삭제」 등) = 빨간 글자 (v2.42.0)
  danger: 'bg-danger text-white hover:brightness-110',
  'danger-text': 'text-danger hover:bg-danger/10',
};
/** 높이는 `tokens.CONTROL_H` 와 같다 — 입력칸·드롭박스·묶음 버튼과 같은 줄에 두면 높이가 맞는다 */
const SIZE = { sm: `${CONTROL_H.sm} gap-1 px-2.5 text-xs`, md: `${CONTROL_H.md} gap-1.5 px-3 text-xs` } as const;

/**
 * 버튼 (v2.36.0 → v2.42.0 danger-text) — variant 5개 · 크기 2개만. 테두리 없음, 굵기 중간(500).
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
    /** 작업 중 (v2.48.0) — 아이콘 자리에 회전 아이콘을 보이고 누를 수 없게 한다. 글자는 부르는 쪽이 「실행 중…」 처럼 바꾼다 */
    busy?: boolean;
  }
>(function Button({ variant = 'secondary', size = 'md', icon: Icon, children, className = '', type = 'button', busy = false, disabled, ...rest }, ref) {
  const iconProps = size === 'sm' ? ICON_SM : ICON;
  return (
    <button
      ref={ref}
      type={type}
      {...rest}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={`inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-md font-medium transition-colors disabled:opacity-40 ${VARIANT[variant]} ${SIZE[size]} ${className}`}
    >
      {busy ? <LoaderCircle {...iconProps} className="animate-spin" /> : Icon && <Icon {...iconProps} />}
      {children}
    </button>
  );
});
export default Button;
