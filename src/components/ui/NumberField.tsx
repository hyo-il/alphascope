import { createContext, forwardRef, useContext, useLayoutEffect, useRef, type InputHTMLAttributes, type ReactNode } from 'react';
import { CONTROL_H, FIELD_W, UNIT_W, type ControlSize, type FieldKind } from './tokens';

/** 같은 묶음의 단위 열 폭 (v2.42.2 → v2.42.3) — 묶음을 이것으로 감싸면 안의 모든 단위 열(`FormRow` · `NumberField`)이 같은 폭이다 */
const UnitWidth = createContext<keyof typeof UNIT_W | undefined>(undefined);
export function NumberUnitGroup({ w, children }: { w: keyof typeof UNIT_W; children: ReactNode }) {
  return <UnitWidth.Provider value={w}>{children}</UnitWidth.Provider>;
}
/** 지금 묶음의 단위 열 폭(없으면 undefined) — `FormRow` 가 단위 열을 그릴 때 쓴다 */
export function useUnitWidth() {
  return useContext(UnitWidth);
}

/** 쉼표 입력(thousands) — 숫자·소수점만 남긴다. `decimals` 0 이면 정수 */
export function sanitizeNumber(text: string, decimals: number): string {
  let s = text.replace(/[^\d.]/g, '');
  if (decimals <= 0) s = s.replace(/\./g, '');
  else {
    const dot = s.indexOf('.');
    if (dot >= 0) s = s.slice(0, dot + 1) + s.slice(dot + 1).replace(/\./g, '').slice(0, decimals);
  }
  // 앞자리 0 정리(「0.5」 는 그대로)
  s = s.replace(/^0+(?=\d)/, '');
  return s;
}
/** 화면 표시 — 정수부에 천 단위 쉼표(소수점·소수부는 입력한 그대로) */
export function groupNumber(raw: string): string {
  if (!raw) return '';
  const [int, frac] = raw.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return frac !== undefined ? `${grouped}.${frac}` : grouped;
}

/**
 * 숫자 입력칸 (v2.42.0 → v2.42.2 → v2.42.3).
 * - **폭은 종류별**(`kind` — `ui/tokens` 의 `FIELD_W`: short 짧은 숫자 · long 금액). 값은 칸 안 오른쪽 정렬.
 * - **단위는 칸 밖 오른쪽**(v2.42.3 — 예전에는 칸 안). 묶음(`NumberUnitGroup`)이면 단위 열 폭이 같아 단위·설명 시작점이 한 줄이다.
 *   `FormRow` 안에서는 FormRow 가 단위 열을 그린다(이 부품은 칸만).
 * - 위아래 화살표 없음(전역 CSS) · 키보드 ↑↓ · 휠로 값이 바뀌지 않는다(v2.42.2).
 * - **`thousands`**(v2.42.3, 금액 칸): 입력하는 동안에도 천 단위 쉼표(263,500 · 1,234.56). 텍스트 입력이라 숫자·소수점 외는 무시하고,
 *   쉼표가 끼어도 **커서는 숫자 개수 기준으로 제자리**. 붙여넣기(₩·쉼표 섞인 값)도 숫자만. 값은 `onValue` 로 **쉼표 없는 문자열**을 넘긴다.
 *   `decimals` — 원화 0(정수) · 달러 2.
 */
type Common = {
  size?: ControlSize;
  kind?: FieldKind;
  unit?: string;
  invalid?: boolean;
  /** 기본값과 다른 값(판단 기준 숫자표) — 밝은 테두리 + 굵게 */
  changed?: boolean;
  /** 단위 열 폭 — 보통은 `NumberUnitGroup` 이 정한다 */
  unitW?: keyof typeof UNIT_W;
  /** 칸(상자)에 붙는 클래스 — 폭을 직접 정할 때(예: flex-1) */
  boxClassName?: string;
};
type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'type' | 'value'> &
  Common & {
    value?: number | string;
    thousands?: boolean;
    decimals?: number;
    /** thousands 모드의 값 전달 — 쉼표 없는 숫자 문자열 */
    onValue?: (raw: string) => void;
  };

const NumberField = forwardRef<HTMLInputElement, Props>(function NumberField(
  { size = 'md', kind = 'short', unit, invalid = false, changed = false, unitW, className = '', boxClassName = '', onKeyDown, onWheel, thousands = false, decimals = 0, onValue, value, onChange, ...rest },
  ref,
) {
  const groupW = useContext(UnitWidth);
  const w = unitW ?? groupW;
  const inner = useRef<HTMLInputElement | null>(null);
  /** thousands — 다음 렌더 뒤 커서를 둘 자리(커서 앞 숫자·소수점 개수) */
  const caretDigits = useRef<number | null>(null);

  const raw = value == null ? '' : String(value);
  const shown = thousands ? groupNumber(sanitizeNumber(raw, decimals)) : raw;

  useLayoutEffect(() => {
    const el = inner.current;
    const n = caretDigits.current;
    if (!thousands || !el || n == null || document.activeElement !== el) return;
    caretDigits.current = null;
    let pos = 0;
    let seen = 0;
    while (pos < el.value.length && seen < n) {
      if (/[\d.]/.test(el.value[pos])) seen++;
      pos++;
    }
    el.setSelectionRange(pos, pos);
  });

  // 폭: className 에 폭이 있으면 그것, 없으면 종류별 폭
  const widthClass = /\b(w-|flex-1|min-w-)/.test(`${className} ${boxClassName}`) ? '' : FIELD_W[kind];
  const box = (
    <span
      className={`flex min-w-0 items-center rounded-md border bg-bg-tertiary focus-within:border-accent ${CONTROL_H[size]} ${widthClass} ${
        invalid ? 'border-danger' : changed ? 'border-text-primary/70' : 'border-transparent'
      } ${className} ${boxClassName}`}
    >
      <input
        ref={(el) => {
          inner.current = el;
          if (typeof ref === 'function') ref(el);
          else if (ref) ref.current = el;
        }}
        type={thousands ? 'text' : 'number'}
        inputMode={thousands ? 'decimal' : undefined}
        {...rest}
        value={shown}
        onChange={(e) => {
          if (thousands) {
            const el = e.target;
            const before = el.value.slice(0, el.selectionStart ?? el.value.length);
            caretDigits.current = (before.match(/[\d.]/g) ?? []).length;
            onValue?.(sanitizeNumber(el.value, decimals));
            return;
          }
          onChange?.(e);
        }}
        onKeyDown={(e) => {
          // ↑↓ 로 값이 바뀌지 않게 (v2.42.2)
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') e.preventDefault();
          // 쉼표 바로 옆에서 지우면 쉼표 너머의 숫자를 지운다 — 쉼표만 지우면 값이 그대로라 아무 일도 없고 커서가 끝으로 튀었다 (v2.42.3)
          if (thousands && (e.key === 'Backspace' || e.key === 'Delete')) {
            const el = e.currentTarget;
            const at = el.selectionStart ?? 0;
            if (at === el.selectionEnd) {
              if (e.key === 'Backspace' && el.value[at - 1] === ',') el.setSelectionRange(at - 1, at - 1);
              if (e.key === 'Delete' && el.value[at] === ',') el.setSelectionRange(at + 1, at + 1);
            }
          }
          onKeyDown?.(e);
        }}
        onWheel={(e) => {
          // 칸에 마우스를 올린 채 휠을 굴리면 값이 바뀐다 — 초점을 빼 막는다
          (e.target as HTMLInputElement).blur();
          onWheel?.(e);
        }}
        aria-invalid={invalid || undefined}
        className={`h-full w-full min-w-0 border-0 bg-transparent px-2 text-right text-xs tabular-nums text-text-primary focus:outline-none disabled:opacity-50 ${changed ? 'font-medium' : ''}`}
      />
    </span>
  );
  if (!unit && !w) return box;
  // 단위는 칸 밖 오른쪽 — 묶음이면 단위 열 폭을 같게(단위가 없어도 자리를 비운다)
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5">
      {box}
      <span className={`shrink-0 text-caption text-text-muted ${w ? UNIT_W[w] : ''}`} aria-hidden={unit ? undefined : true}>
        {unit}
      </span>
    </span>
  );
});
export default NumberField;
