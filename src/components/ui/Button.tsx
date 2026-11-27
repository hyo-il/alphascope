import { LoaderCircle, type LucideIcon } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { ICON, ICON_SM } from './icon';
import { CONTROL_H, ORDER_BUY_COLOR, ORDER_SELL_COLOR, PRIMARY_BUTTON_COLOR, TOUCH_HIT } from './tokens';

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'buy' | 'sell';
type IconType = LucideIcon;

const VARIANT: Record<Variant, string> = {
  // 파란색은 그 화면의 **주요 실행 버튼 하나**에만 (디자인 규칙 2)
  // 바탕은 주 단추 전용 진한 파랑(흰 글 대비 5.41 · v2.73.0) — 파란 글 · 초점 테두리는 accent 그대로
  primary: PRIMARY_BUTTON_COLOR,
  secondary: 'bg-bg-tertiary text-text-primary hover:bg-bg-elevated',
  ghost: 'text-text-secondary hover:bg-bg-tertiary hover:text-text-primary',
  // 빨강은 셋에만(테마 9-1 R2) — `danger` 는 **확인 창의 마지막 위험 단추 하나**(`modal.confirm` 의 danger)에만 쓴다.
  // 화면 안의 삭제 · 모두 삭제 · 로그아웃 · 끄기는 `secondary` · `ghost`(회색 글)
  danger: 'bg-bearish text-bg-primary hover:brightness-110',
  // 매수 초록 · 매도 빨강(미국 증권 기준) — 색 정의는 `tokens` 한 곳(빠른주문과 같은 색)
  buy: ORDER_BUY_COLOR,
  sell: ORDER_SELL_COLOR,
};
/** 빨간 바탕의 뜻(`designrules:test` 가 읽음) — 매도 · 확인 창 위험 단추 */
const TONE: Partial<Record<Variant, string>> = { sell: 'sell', danger: 'danger-confirm' };
/** 높이는 `tokens.CONTROL_H` 와 같다 — 입력칸·드롭박스·묶음 버튼과 같은 줄에 두면 높이가 맞는다 */
const SIZE = { sm: `${CONTROL_H.sm} gap-1 px-2.5 text-xs`, md: `${CONTROL_H.md} gap-1.5 px-3 text-xs` } as const;

/**
 * 버튼 — variant 6개 · 크기 2개만. 테두리 없음, 굵기 중간(500).
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
    /** 작업 중 — 아이콘 자리에 회전 아이콘을 보이고 누를 수 없게 한다. 글자는 부르는 쪽이 「실행 중…」 처럼 바꾼다 */
    busy?: boolean;
    /** 폼의 [저장] — 누르면(꺼져 있어도) 그 폼 묶음(`Dialog` · `FormScope`)의 틀린 칸이 빨갛게 보인다(`fieldReveal`) */
    submit?: boolean;
  }
>(function Button({ variant = 'secondary', size = 'md', icon: Icon, children, className = '', type = 'button', busy = false, disabled, submit = false, ...rest }, ref) {
  const iconProps = size === 'sm' ? ICON_SM : ICON;
  return (
    <button
      ref={ref}
      type={type}
      {...rest}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      data-form-submit={submit || undefined}
      data-tone={TONE[variant]}
      className={`inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-md font-medium transition-colors disabled:opacity-40 ${VARIANT[variant]} ${SIZE[size]} ${TOUCH_HIT} ${className}`}
    >
      {busy ? <LoaderCircle {...iconProps} className="animate-spin" /> : Icon && <Icon {...iconProps} />}
      {children}
    </button>
  );
});
export default Button;
