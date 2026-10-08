import { forwardRef, type InputHTMLAttributes } from 'react';
import { CONTROL_H, type ControlSize } from './tokens';

/**
 * 숫자 입력칸 (v2.42.0) — 단위(`%`·`분`·`일`·`주`)를 **칸 안 오른쪽**에 둔다(사용자: 단위가 칸 밖에 있으면 끝이 들쭉날쭉).
 * 값은 오른쪽 정렬. 폭은 부모(`FormRow` 값 칸)가 정한다 — 이 부품은 그 폭을 꽉 채운다.
 */
const NumberField = forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'type'> & { size?: ControlSize; unit?: string; invalid?: boolean; /** 기본값과 다른 값(판단 기준 숫자표) — 밝은 테두리 + 굵게 */ changed?: boolean }
>(function NumberField({ size = 'md', unit, invalid = false, changed = false, className = '', ...rest }, ref) {
  return (
    <span
      className={`flex min-w-0 items-center rounded-md border bg-bg-tertiary focus-within:border-accent ${CONTROL_H[size]} ${
        invalid ? 'border-danger' : changed ? 'border-text-primary/70' : 'border-transparent'
      } ${className}`}
    >
      <input
        ref={ref}
        type="number"
        {...rest}
        aria-invalid={invalid || undefined}
        className={`h-full min-w-0 flex-1 border-0 bg-transparent px-2 text-right text-xs tabular-nums text-text-primary focus:outline-none disabled:opacity-50 ${changed ? 'font-medium' : ''}`}
      />
      {unit && <span className="shrink-0 pr-2 text-caption text-text-muted">{unit}</span>}
    </span>
  );
});
export default NumberField;
