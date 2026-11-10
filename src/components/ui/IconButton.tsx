import { LoaderCircle, type LucideIcon, type LucideProps } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes, type ComponentType } from 'react';
import { ICON, ICON_SM } from './icon';
import { ICON_BUTTON_BOX, type IconButtonSize } from './tokens';

/** lucide 아이콘, 또는 같은 크기 · 선 굵기를 받는 아이콘(채운 관심 별 `starIconOf`) */
type IconType = LucideIcon | ComponentType<LucideProps>;

/**
 * 아이콘만 있는 버튼 — **`label` 이 필수**다(`aria-label` 과 앱 툴팁 `data-tip` 에 함께 쓴다 · 브라우저 기본 `title` 은 쓰지 않는다).
 * 글자 없는 버튼은 뜻을 아이콘에만 맡기므로, 이름이 없으면 화면 읽기·마우스 모두에서 무엇인지 모른다.
 * **크기는 두 가지만**(`tokens.ICON_BUTTON_BOX` · 다른 크기 금지 — `className` 에 높이 · 폭을 덧칠하지 않는다):
 *   `md` 도구 줄 = 28px 상자 · 16px 아이콘 / `sm` 표 안 = 24px 상자 · 14px 아이콘.
 * tone: 기본 회색 → hover 흰색 / danger 는 hover 때 빨강(지우기) / active 는 켜진 상태(흰색 + 옅은 바탕).
 * busy: 작업 중 — 아이콘 자리에 회전 아이콘 · 누를 수 없음(`Button` 의 busy 와 같다).
 */
const IconButton = forwardRef<
  HTMLButtonElement,
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label' | 'title'> & {
    icon: IconType;
    label: string;
    /** 툴팁 글 — 없으면 `label`(`aria-label` 을 따로 줄 때 툴팁은 짧은 이름 그대로) */
    'aria-label'?: string;
    size?: IconButtonSize;
    tone?: 'default' | 'danger';
    active?: boolean;
    busy?: boolean;
  }
>(function IconButton({ icon: Icon, label, size = 'md', tone = 'default', active = false, busy = false, disabled, className = '', type = 'button', ...rest }, ref) {
  const color = active
    ? 'bg-bg-tertiary text-text-primary'
    : tone === 'danger'
      ? 'text-text-muted hover:bg-bg-tertiary hover:text-danger'
      : 'text-text-muted hover:bg-bg-tertiary hover:text-text-primary';
  const iconProps = size === 'sm' ? ICON_SM : ICON;
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      data-tip={label}
      {...rest}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      className={`inline-flex shrink-0 items-center justify-center rounded-md transition-colors disabled:opacity-40 ${ICON_BUTTON_BOX[size]} ${color} ${className}`}
    >
      {busy ? <LoaderCircle {...iconProps} className="animate-spin" /> : <Icon {...iconProps} />}
    </button>
  );
});
export default IconButton;
