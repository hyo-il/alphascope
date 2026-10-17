import { Children, cloneElement, isValidElement, type ReactElement, type ReactNode } from 'react';
import { FORM_LABEL_W, FORM_VALUE_W, UNIT_W } from './tokens';
import { FormRowValue, useUnitWidth } from './NumberField';

/**
 * 폼 줄 (기준표 「입력칸」, 사용자 결정 2026-10-13)
 * ```
 * 분석 주기      [    60] 분   설명…
 * 종목당 비중      [  10] %    설명…
 * 매수 신호  [ 매수 이상 ▾]     설명…
 * ```
 * - 이름 칸 **고정 폭**(왼쪽 끝 맞춤) · **이름은 짧게**(괄호 속 설명은 `hint` 로 — 이름이 두 줄로 꺾이지 않게).
 * - 값 칸 고정 폭 안에서 입력칸은 **오른쪽 끝에 붙는다**(칸이 짧으면 왼쪽이 빈다) — 입력칸 폭은 종류별(`FIELD_W` short·long·select).
 * - **단위는 칸 밖 단위 열** — 묶음(`NumberUnitGroup`)이면 열 폭이 같고, 단위가 없는 줄도 자리를 비워 **설명 시작점이 한 줄**.
 *   단위는 `unit` 으로 주거나, 값이 `NumberField` 면 그 `unit` 을 옮겨 그린다(칸 안에는 그리지 않는다).
 * - `error` 는 줄 아래(값 칸 시작 아래)에 빨간 글자.
 */
export default function FormRow({
  label,
  children,
  hint,
  unit,
  error,
  labelW = 'md',
  valueW = 'md',
  htmlFor,
}: {
  label: ReactNode;
  children: ReactNode;
  /** 오른쪽 설명(회색 13px) */
  hint?: ReactNode;
  unit?: ReactNode;
  error?: ReactNode;
  labelW?: keyof typeof FORM_LABEL_W;
  valueW?: keyof typeof FORM_VALUE_W | 'auto';
  htmlFor?: string;
}) {
  const groupW = useUnitWidth();
  // 값이 NumberField 하나면 그 단위를 단위 열로 옮긴다(칸 안·바로 옆에 그리지 않게)
  let control: ReactNode = children;
  let unitText: ReactNode = unit;
  const only = Children.toArray(children);
  if (only.length === 1 && isValidElement(only[0]) && (only[0].props as { unit?: string }).unit !== undefined) {
    const el = only[0] as ReactElement<{ unit?: string; unitW?: unknown }>;
    unitText = unitText ?? el.props.unit;
    control = cloneElement(el, { unit: undefined, unitW: undefined });
  }
  const showUnit = groupW != null || unitText != null;
  return (
    <div data-formrow className="min-w-0">
      <div className="flex min-w-0 items-center gap-x-3">
        <label htmlFor={htmlFor} className={`shrink-0 whitespace-nowrap text-xs text-text-secondary ${FORM_LABEL_W[labelW]}`}>
          {label}
        </label>
        <div className="flex shrink-0 items-center gap-1.5">
          <div data-formrow-value className={`flex items-center justify-end gap-2 ${valueW === 'auto' ? '' : FORM_VALUE_W[valueW]}`}>
            <FormRowValue>{control}</FormRowValue>
          </div>
          {showUnit && (
            <span data-formrow-unit className={`shrink-0 text-caption text-text-muted ${groupW ? UNIT_W[groupW] : ''}`}>
              {unitText}
            </span>
          )}
        </div>
        {hint != null && <span data-formrow-hint className="min-w-0 flex-1 text-caption text-text-muted">{hint}</span>}
      </div>
      {error != null && error !== false && error !== '' && (
        <p className={`mt-1 text-caption text-danger ${FORM_LABEL_PAD[labelW]}`}>{error}</p>
      )}
    </div>
  );
}

/** 오류 줄을 값 칸 시작에 맞추는 왼쪽 여백(이름 칸 폭 + 간격 12px) */
const FORM_LABEL_PAD = { sm: 'pl-[9.25rem]', md: 'pl-[11.75rem]', lg: 'pl-[14.75rem]' } as const;
