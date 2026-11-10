import { Star, type LucideProps } from 'lucide-react';

/**
 * 관심 별 — 담음 = 채운 별 + 노랑(`--color-star`), 안 담음 = 빈 별 + 회색.
 * 모양(채움/비움)으로도 구분된다 — 색만으로 구분하지 않는다.
 * 색은 아이콘 자신이 정한다 — 버튼에는 색을 주지 않는다. 버튼은 공용 `IconButton`(`icon={starIconOf(on)}` — 크기 · 선 굵기는 버튼 크기를 따른다).
 */
const StarOn = (p: LucideProps) => <Star {...p} fill="currentColor" className="text-star" />;
const StarOff = (p: LucideProps) => <Star {...p} fill="none" className="text-text-muted" />;
export const starIconOf = (on: boolean) => (on ? StarOn : StarOff);
