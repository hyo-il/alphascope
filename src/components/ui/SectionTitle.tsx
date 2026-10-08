import type { ReactNode } from 'react';
import InfoTip from './InfoTip';

/**
 * 구역 제목 (v2.36.0) — 굵기 600 한 단계, 아이콘·이모지 없음. 옆에 짧은 꼬리 글자(`aside`, 회색)와 정보 아이콘(`info`), 오른쪽 끝 도구(`right`).
 * level 1 = 화면 제목(text-base), 2 = 구역 제목(text-sm).
 */
export default function SectionTitle({
  children,
  level = 2,
  aside,
  info,
  right,
}: {
  children: ReactNode;
  level?: 1 | 2;
  aside?: ReactNode;
  info?: ReactNode;
  right?: ReactNode;
}) {
  const Tag = level === 1 ? 'h2' : 'h3';
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Tag className={`shrink-0 font-semibold text-text-primary ${level === 1 ? 'text-base' : 'text-sm'}`}>{children}</Tag>
      {aside != null && <span className="min-w-0 text-caption text-text-muted">{aside}</span>}
      {info != null && <InfoTip>{info}</InfoTip>}
      {right != null && <div className="ml-auto flex shrink-0 items-center gap-2">{right}</div>}
    </div>
  );
}
