import { forwardRef, type InputHTMLAttributes } from 'react';
import { CONTROL_H, type ControlSize } from './tokens';

/**
 * 입력칸 (v2.42.0) — 높이는 기준표(32/28px), 글자 14px, 테두리 대신 옅은 바탕(디자인 규칙 3, 포커스·오류 때만 테두리).
 * `invalid` 면 빨간 테두리(danger). 폭은 부모가 정한다 — 한 줄에 혼자 있는 칸은 `className="flex-1"`, 폼 줄은 `FormRow` 값 칸이 정한다.
 * ⚠️ 체크박스·라디오는 이 부품이 아니다.
 */
const Input = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & { size?: ControlSize; invalid?: boolean }>(
  function Input({ size = 'md', invalid = false, className = '', ...rest }, ref) {
    return (
      <input
        ref={ref}
        {...rest}
        aria-invalid={invalid || undefined}
        className={`min-w-0 rounded-md border bg-bg-tertiary px-2 text-xs text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none disabled:opacity-50 ${CONTROL_H[size]} ${
          invalid ? 'border-danger' : 'border-transparent'
        } ${className}`}
      />
    );
  },
);
export default Input;
