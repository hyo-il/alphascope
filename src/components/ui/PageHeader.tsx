import type { ReactNode } from 'react';
import Tabs, { type TabItem } from './Tabs';

/**
 * 화면 머리 (v2.41.0, 디자인 규칙 7 — **제목 줄과 탭 줄은 나눈다**).
 * - 제목 줄: 제목 16px 600 + 오른쪽 보조 버튼 자리, 위 12px · 아래 8px. 제목이 없는 화면에는 그리지 않는다(새 제목을 만들지 않는다).
 * - 탭 줄: `ui/Tabs` + 오른쪽 끝 안내 배지(`tabsRight`). 바닥 옅은 선 하나.
 * 예전 「계좌 관리」 는 제목·탭·배지가 한 줄이라 어디까지가 제목인지 구분이 어려웠다(사용자 지적, 23차).
 */
export default function PageHeader<T extends string>({
  title,
  right,
  tabs,
  value,
  onChange,
  tabsLabel,
  tabsRight,
}: {
  title?: ReactNode;
  right?: ReactNode;
  tabs?: TabItem<T>[];
  value?: T;
  onChange?: (id: T) => void;
  /** 탭 묶음 이름(aria-label) */
  tabsLabel?: string;
  tabsRight?: ReactNode;
}) {
  return (
    <div className="shrink-0 px-3">
      {title != null && (
        <div className="flex min-w-0 items-center gap-2 pt-3 pb-2">
          <h2 className="min-w-0 text-sm font-semibold text-text-primary">{title}</h2>
          {right != null && <div className="ml-auto flex shrink-0 items-center gap-2">{right}</div>}
        </div>
      )}
      {tabs && value != null && onChange && (
        <div className="flex min-w-0 items-end gap-3 border-b border-border/60">
          <Tabs items={tabs} value={value} onChange={onChange} line={false} label={tabsLabel ?? '화면 안 탭'} />
          {tabsRight != null && <div className="ml-auto flex min-w-0 items-center gap-2 self-center">{tabsRight}</div>}
        </div>
      )}
    </div>
  );
}
