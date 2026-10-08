import type { ReactNode } from 'react';
import { FORM_LABEL_W, FORM_VALUE_W } from './tokens';

/**
 * 폼 줄 (v2.42.0) — 이름 칸 **고정 폭** + 값 칸 **고정 폭** + (선택) 설명. 같은 묶음(설정 창·고급 설정 등)은 같은 `labelW`·`valueW` 를 써서
 * 입력칸의 **왼쪽 끝과 오른쪽 끝**이 맞는다. 값 칸 안의 부품(Input·Select·NumberField·Segmented)은 그 폭을 채운다.
 * 묶음마다 폭 하나를 고른다(그 묶음에서 가장 긴 값이 들어가는 폭) — 줄마다 다른 폭을 주지 않는다.
 */
export default function FormRow({
  label,
  children,
  hint,
  labelW = 'md',
  valueW = 'md',
  htmlFor,
}: {
  label: ReactNode;
  children: ReactNode;
  /** 값 칸 오른쪽의 짧은 설명(회색 13px) */
  hint?: ReactNode;
  labelW?: keyof typeof FORM_LABEL_W;
  valueW?: keyof typeof FORM_VALUE_W | 'auto';
  htmlFor?: string;
}) {
  return (
    <div data-formrow className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
      <label htmlFor={htmlFor} className={`shrink-0 text-xs text-text-secondary ${FORM_LABEL_W[labelW]}`}>
        {label}
      </label>
      <div data-formrow-value className={`flex shrink-0 items-center [&>*]:w-full ${valueW === 'auto' ? '' : FORM_VALUE_W[valueW]}`}>{children}</div>
      {hint != null && <span className="min-w-0 flex-1 text-caption text-text-muted">{hint}</span>}
    </div>
  );
}
