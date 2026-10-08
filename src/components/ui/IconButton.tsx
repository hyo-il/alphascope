import type { LucideIcon } from 'lucide-react';
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { ICON, ICON_SM } from './icon';

type IconType = LucideIcon;

/**
 * 아이콘만 있는 버튼 (v2.36.0) — **`label` 이 필수**다(`aria-label` 과 툴팁에 함께 쓴다).
 * 글자 없는 버튼은 뜻을 아이콘에만 맡기므로, 이름이 없으면 화면 읽기·마우스 모두에서 무엇인지 모른다.
 * tone: 기본 회색 → hover 흰색 / danger 는 hover 때 빨강(지우기) / active 는 켜진 상태(흰색 + 옅은 바탕).
 */
const IconButton = forwardRef<
  HTMLButtonElement,
  Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children' | 'aria-label' | 'title'> & {
    icon: IconType;
    label: string;
    size?: 'sm' | 'md';
    tone?: 'default' | 'danger';
    active?: boolean;
  }
>(function IconButton({ icon: Icon, label, size = 'md', tone = 'default', active = false, className = '', type = 'button', ...rest }, ref) {
  const box = size === 'sm' ? 'h-6 w-6' : 'h-7 w-7';
  const color = active
    ? 'bg-bg-tertiary text-text-primary'
    : tone === 'danger'
      ? 'text-text-muted hover:bg-bg-tertiary hover:text-danger'
      : 'text-text-muted hover:bg-bg-tertiary hover:text-text-primary';
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      {...rest}
      className={`inline-flex shrink-0 items-center justify-center rounded-md transition-colors disabled:opacity-40 ${box} ${color} ${className}`}
    >
      <Icon {...(size === 'sm' ? ICON_SM : ICON)} />
    </button>
  );
});
export default IconButton;
