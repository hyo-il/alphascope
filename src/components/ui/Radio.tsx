import type { InputHTMLAttributes } from 'react';
import { TOUCH_HIT } from './tokens';

/**
 * 글자와 나란한 동그라미 고르기(v2.76.0) — 동작 · 저장 값은 맨 `<input type="radio">` 와 같다.
 * 손가락 화면 누르는 칸 44 는 이 부품이 맡는다(`TOUCH_HIT` — 보이는 크기 그대로). 줄 사이는 쓰는 곳이 `TOUCH_LIST_ROW` 로.
 */
export default function Radio({ className = '', ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  return <input type="radio" className={`${TOUCH_HIT} ${className}`.trim()} {...props} />;
}
