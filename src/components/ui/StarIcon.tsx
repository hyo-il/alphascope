import { Star } from 'lucide-react';
import { ICON, ICON_SM } from './icon';

/**
 * 관심 별 — 담음 = 채운 별 + 노랑(`--color-star`), 안 담음 = 빈 별 + 회색.
 * 모양(채움/비움)으로도 구분된다 — 색만으로 구분하지 않는다.
 * 색은 아이콘 자신이 정한다 — 버튼에는 색을 주지 않는다.
 */
export default function StarIcon({ on, size = 'md' }: { on: boolean; size?: 'sm' | 'md' }) {
  return (
    <Star
      {...(size === 'sm' ? ICON_SM : ICON)}
      fill={on ? 'currentColor' : 'none'}
      className={on ? 'text-star' : 'text-text-muted'}
    />
  );
}
