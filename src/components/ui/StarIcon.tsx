import { Star } from 'lucide-react';
import { ICON, ICON_SM } from './icon';

/**
 * 관심 별 (v2.36.0) — 예전 글자 ★☆(노란색)를 대신한다. **노란색을 쓰지 않는다**:
 * 담음 = 채운 별 + 흰색, 안 담음 = 빈 별 + 회색. 모양(채움/비움)으로도 구분된다.
 * 색은 아이콘 자신이 정한다 — 버튼에는 색을 주지 않는다.
 */
export default function StarIcon({ on, size = 'md' }: { on: boolean; size?: 'sm' | 'md' }) {
  return (
    <Star
      {...(size === 'sm' ? ICON_SM : ICON)}
      fill={on ? 'currentColor' : 'none'}
      className={on ? 'text-text-primary' : 'text-text-muted'}
    />
  );
}
