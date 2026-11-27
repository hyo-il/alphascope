import { CircleMinus } from 'lucide-react';

/**
 * 「기준 미달 · 거름망에 걸림 · 안 됨 · 빗나감」 글 앞 아이콘 — 빨강 대신 회색 글 + 이 아이콘(테마 9-1 R2 ③ · 색만으로 알리지 않음).
 * 색은 둘러싼 글자색(`text-text-secondary`)을 따른다. 자리 잡기는 `WarnIcon` 과 같다.
 */
export default function NotPassIcon() {
  return <CircleMinus size={14} strokeWidth={1.75} aria-hidden className="mr-1 inline-block shrink-0 align-[-2px]" />;
}
