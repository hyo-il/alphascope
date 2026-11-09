import type { InputHTMLAttributes } from 'react';

/**
 * 글자와 나란한 체크박스 — 글자 잉크가 줄 가운데보다 1px 아래에 그려지므로 체크박스를 1px 내려 잉크 가운데에 맞춘다(실제 픽셀로 측정 · v2.67.3).
 * 잰 차이가 1px 을 넘는 곳에만 쓴다 — 1px 안인 곳에 쓰면 반대로 어긋난다. 동작 · 저장 값은 맨 `<input type="checkbox">` 와 같다.
 */
export default function Checkbox({ className = '', ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  return <input type="checkbox" className={`relative top-px ${className}`.trim()} {...props} />;
}
