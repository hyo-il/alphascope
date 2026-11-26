import type { ReactNode } from 'react';
import Tabs, { type TabItem } from './Tabs';
import { PANEL_X } from './tokens';
import PageTitle, { usePageTitleHidden } from './PageTitle';

/**
 * 화면 머리 (디자인 규칙 7 — **제목 줄과 탭 줄은 나눈다**).
 * - 제목 줄: 제목 16px 600 + 오른쪽 보조 버튼 자리, 위 12px · 아래 8px. 제목이 없는 화면에는 그리지 않는다(새 제목을 만들지 않는다).
 * - 탭 줄: `ui/Tabs` + 오른쪽 끝 안내 배지(`tabsRight`). 바닥 옅은 선 하나.
 * 제목·탭·배지가 한 줄이면 어디까지가 제목인지 구분이 어렵다(사용자 지적).
 * 폰 모양(v2.74.0 · 테마 5-1): 제목 글은 숨기고(`PageTitle` — 화면 읽기용으로는 남음) 오른쪽 단추만 본문 맨 위 한 줄(넘치면 줄바꿈) · 단추가 없으면 그 줄도 없음 · 탭 줄은 그대로.
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
  const titleHidden = usePageTitleHidden();
  return (
    // 가로 여백은 PANEL_X — 탭 글자와 화면 내용의 왼쪽 끝이 같은 선
    <div className={`shrink-0 ${PANEL_X}`}>
      {title != null &&
        (titleHidden ? (
          right != null ? (
            <div className="flex min-w-0 flex-wrap items-center justify-end gap-2 pt-3 pb-2">
              <PageTitle className="">{title}</PageTitle>
              {right}
            </div>
          ) : (
            <PageTitle className="">{title}</PageTitle>
          )
        ) : (
          <div className="flex min-w-0 items-center gap-2 pt-3 pb-2">
            <PageTitle className="min-w-0 text-base font-semibold text-text-primary">{title}</PageTitle>
            {right != null && <div className="ml-auto flex shrink-0 items-center gap-2">{right}</div>}
          </div>
        ))}
      {tabs && value != null && onChange && (
        <div className="flex min-w-0 items-end gap-3 border-b border-border/60">
          <Tabs items={tabs} value={value} onChange={onChange} line={false} label={tabsLabel ?? '화면 안 탭'} />
          {tabsRight != null && <div className="ml-auto flex min-w-0 items-center gap-2 self-center">{tabsRight}</div>}
        </div>
      )}
    </div>
  );
}
