import type { InputHTMLAttributes } from 'react';
import { TOUCH_HIT } from './tokens';

/**
 * 체크박스 하나 — 손가락 화면 누르는 칸 44(`TOUCH_HIT` · 보이는 모양 · 배치는 그대로). 동작 · 저장 값은 맨 `<input type="checkbox">` 와 같다.
 * - `nudge`(기본 켬): 글자 잉크가 줄 가운데보다 1px 아래에 그려지므로 체크박스를 1px 내려 잉크 가운데에 맞춘다(실제 픽셀로 측정 · v2.67.3).
 *   잰 차이가 1px 을 넘는 곳에만 켠다 — 1px 안인 곳(표 칸 가운데 · 폼 줄 이름 · 거름망 줄 · 목표 바꾸기 창)은 `nudge={false}` 로 맨 체크박스와 같은 자리.
 */
export default function Checkbox({ className = '', nudge = true, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { nudge?: boolean }) {
  return <input type="checkbox" className={`${nudge ? 'relative top-px ' : ''}${TOUCH_HIT} ${className}`.trim()} {...props} />;
}
