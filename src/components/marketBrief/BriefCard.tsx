import type { ReactNode } from 'react';
import { InfoTip, Panel, SectionTitle } from '../ui';
import { clean, LABEL_W } from './briefText';

/** 칸 하나의 껍데기 — 제목(+ 곁말 · 설명) + 내용. `data-brief-card` = 칸 이름(점검이 찾는다) */
export function BriefCard({ title, aside, info, children, id }: { title: string; aside?: ReactNode; info?: ReactNode; children: ReactNode; id: string }) {
  return (
    <Panel data-brief-card={id} className="space-y-2">
      <SectionTitle aside={aside} info={info}>
        {title}
      </SectionTitle>
      {children}
    </Panel>
  );
}

/** 이름표 | 글 한 줄 */
export function LabeledLine({ label, tip, children }: { label: string; tip?: string; children: ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className={`${LABEL_W} inline-flex shrink-0 items-start gap-1 text-caption text-text-muted`}>
        {label}
        {tip && <InfoTip label={label}>{tip}</InfoTip>}
      </span>
      <span className="min-w-0 break-keep text-text-primary">{children}</span>
    </div>
  );
}

/** 이름표 | 점 목록(없으면 `empty`) */
export function BulletList({ label, items, empty }: { label: string; items: string[]; empty: string }) {
  return (
    <div className="flex gap-2">
      <span className={`${LABEL_W} shrink-0 text-caption text-text-muted`}>{label}</span>
      {items.length ? (
        <ul className="min-w-0 space-y-1">
          {items.map((t, i) => (
            <li key={i} className="flex gap-2 break-keep text-text-primary">
              <span className="text-text-muted">•</span>
              <span>{clean(t)}</span>
            </li>
          ))}
        </ul>
      ) : (
        <span className="text-text-muted">{empty}</span>
      )}
    </div>
  );
}
