import { forwardRef, type SelectHTMLAttributes } from 'react';
import { CONTROL_H, type ControlSize } from './tokens';

/**
 * 드롭박스 (v2.42.0) — 높이는 기준표(32/28px), 글자 14px. 화살표·오른쪽 여백 32px 은 `index.css` 의 전역 select 규칙(v2.41.0)이 그린다.
 * 폭은 부모가 정한다(`FormRow` 값 칸 · `className="w-full"`) — 글자 길이만큼 늘어나게 두지 않는다.
 */
const Select = forwardRef<HTMLSelectElement, Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> & { size?: ControlSize }>(
  function Select({ size = 'md', className = '', children, ...rest }, ref) {
    return (
      <select
        ref={ref}
        {...rest}
        className={`min-w-0 rounded-md border border-transparent bg-bg-tertiary pl-2 text-xs text-text-primary focus:border-accent focus:outline-none disabled:opacity-50 ${CONTROL_H[size]} ${className}`}
      >
        {children}
      </select>
    );
  },
);
export default Select;
