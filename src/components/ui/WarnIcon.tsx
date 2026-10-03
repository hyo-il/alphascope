import { TriangleAlert } from 'lucide-react';

/**
 * 문장 앞 경고 표시 (v2.36.0) — 예전 ⚠️ 이모지 자리. 글자와 같은 줄에 서도록 inline + 살짝 내림.
 * 색은 둘러싼 글자색을 따른다(경고 문장이면 `text-warning`).
 */
export default function WarnIcon() {
  return <TriangleAlert size={14} strokeWidth={1.75} aria-hidden className="mr-1 inline-block shrink-0 align-[-2px]" />;
}
