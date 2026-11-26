import { forwardRef, type InputHTMLAttributes } from 'react';
import { CONTROL_H, TOUCH_FIELD, type ControlSize } from './tokens';
import { useFieldInvalid } from './fieldReveal';

/**
 * 입력칸 — 높이는 기준표(32/28px), 글자 14px, 테두리 대신 옅은 바탕(디자인 규칙 3, 포커스·오류 때만 테두리).
 * `invalid`(틀림)면 빨간 테두리(danger) — **보이는 때는 `fieldReveal`**(칸을 떠난 뒤 · [저장] 을 누른 뒤). 서버가 거절한 값은 `rejected`(바로). 폭은 부모가 정한다 — 한 줄에 혼자 있는 칸은 `className="flex-1"`, 폼 줄은 `FormRow` 값 칸이 정한다.
 * ⚠️ 체크박스·라디오는 이 부품이 아니다.
 */
const Input = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & { size?: ControlSize; invalid?: boolean; rejected?: boolean }>(
  function Input({ size = 'md', invalid = false, rejected = false, className = '', onBlur, ...rest }, ref) {
    const { show, touch } = useFieldInvalid(invalid, rejected);
    return (
      <input
        ref={ref}
        {...rest}
        onBlur={(e) => {
          touch();
          onBlur?.(e);
        }}
        aria-invalid={show || undefined}
        className={`min-w-0 rounded-md border bg-bg-tertiary px-2 text-xs text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none disabled:opacity-50 ${CONTROL_H[size]} ${TOUCH_FIELD} ${
          show ? 'border-danger' : 'border-transparent'
        } ${className}`}
      />
    );
  },
);
export default Input;
