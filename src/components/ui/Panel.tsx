import type { HTMLAttributes, ReactNode } from 'react';

/**
 * 바탕 패널 (v2.36.0 디자인 규칙 3) — 구역은 **테두리 대신 바탕색 차이 + 여백**으로 나눈다.
 * 둥근 모서리 12px. 안의 칸에는 테두리를 두지 않는다(상자 안에 상자 금지).
 * pad: none(표처럼 안에서 여백을 정하는 것) · sm 12px · md 16px.
 */
export default function Panel({
  pad = 'md',
  tone = 'secondary',
  className = '',
  children,
  ...rest
}: HTMLAttributes<HTMLDivElement> & { pad?: 'none' | 'sm' | 'md'; tone?: 'secondary' | 'tertiary'; children?: ReactNode }) {
  const p = pad === 'none' ? '' : pad === 'sm' ? 'p-3' : 'p-4';
  const bg = tone === 'tertiary' ? 'bg-bg-tertiary' : 'bg-bg-secondary';
  return (
    <div {...rest} className={`rounded-xl ${bg} ${p} ${className}`}>
      {children}
    </div>
  );
}
