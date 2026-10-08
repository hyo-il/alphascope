import { createContext, forwardRef, useContext, type InputHTMLAttributes, type ReactNode } from 'react';
import { CONTROL_H, UNIT_W, type ControlSize } from './tokens';

/** 같은 묶음의 단위 칸 폭 (v2.42.2) — 묶음을 이것으로 감싸면 안의 모든 NumberField 가 같은 단위 칸 폭을 쓴다 */
const UnitWidth = createContext<keyof typeof UNIT_W | undefined>(undefined);
export function NumberUnitGroup({ w, children }: { w: keyof typeof UNIT_W; children: ReactNode }) {
  return <UnitWidth.Provider value={w}>{children}</UnitWidth.Provider>;
}

/**
 * 숫자 입력칸 (v2.42.0 → v2.42.2) — 단위(`%`·`분`·`일`·`주`)를 **칸 안 오른쪽**에 둔다(사용자: 단위가 칸 밖에 있으면 끝이 들쭉날쭉).
 * 값은 오른쪽 정렬. 폭은 부모(`FormRow` 값 칸)가 정한다 — 이 부품은 그 폭을 꽉 채운다.
 * v2.42.2:
 * - **위아래 화살표(스피너) 없음** — 전역 CSS(`index.css` 「숫자 입력칸」)가 숨긴다. 키보드 ↑↓ · 마우스 휠로 값이 바뀌지 않는다(실수로 바뀌지 않게).
 *   숫자만 입력되는 검사(type=number)는 그대로.
 * - 같은 묶음(`NumberUnitGroup`)이면 단위 칸 폭이 같아 숫자 오른쪽 끝이 한 줄이다(단위가 없는 칸도 같은 자리를 비운다).
 */
const NumberField = forwardRef<
  HTMLInputElement,
  Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'type'> & {
    size?: ControlSize;
    unit?: string;
    invalid?: boolean;
    /** 기본값과 다른 값(판단 기준 숫자표) — 밝은 테두리 + 굵게 */
    changed?: boolean;
    /** 단위 칸 폭 — 보통은 `NumberUnitGroup` 이 정한다 */
    unitW?: keyof typeof UNIT_W;
  }
>(function NumberField({ size = 'md', unit, invalid = false, changed = false, unitW, className = '', onKeyDown, onWheel, ...rest }, ref) {
  const groupW = useContext(UnitWidth);
  const w = unitW ?? groupW;
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
        onKeyDown={(e) => {
          // ↑↓ 로 값이 바뀌지 않게 (v2.42.2)
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') e.preventDefault();
          onKeyDown?.(e);
        }}
        onWheel={(e) => {
          // 칸에 마우스를 올린 채 휠을 굴리면 값이 바뀐다 — 초점을 빼 막는다
          (e.target as HTMLInputElement).blur();
          onWheel?.(e);
        }}
        aria-invalid={invalid || undefined}
        className={`h-full min-w-0 flex-1 border-0 bg-transparent px-2 text-right text-xs tabular-nums text-text-primary focus:outline-none disabled:opacity-50 ${changed ? 'font-medium' : ''}`}
      />
      {w ? (
        <span className={`shrink-0 pr-2 text-left text-caption text-text-muted ${UNIT_W[w]}`} aria-hidden={unit ? undefined : true}>
          {unit}
        </span>
      ) : (
        unit && <span className="shrink-0 pr-2 text-caption text-text-muted">{unit}</span>
      )}
    </span>
  );
});
export default NumberField;
