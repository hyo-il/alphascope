import type { KeyboardEvent, ReactNode } from 'react';
import { Skeleton } from '../common/SkeletonLoader';
import { DATA_CARD, DATA_CARD_LIST, DATA_CARD_PRESS } from './tokens';

/**
 * 폰 카드(v2.76.0 · 테마 4-1) — **폰 모양에서만** 표 대신 그리는 카드 한 장. 모양은 `tokens.DATA_CARD` 한 곳.
 * 카드 전체가 누르는 곳이다(지금 표 줄 · 종목 칸을 누른 것과 같은 일) — 손가락 화면에서 누르는 칸 = 카드 전체(44 보다 큼).
 * 키보드: 역할 button · 이름 `label` · Enter / Space. 카드 안에 따로 단추를 두면 그 단추의 키는 단추 몫이다(`e.target === e.currentTarget` 일 때만).
 * 패드 · 1280 이상은 표 그대로 — 고르는 곳은 쓰는 화면(`useLayoutMode() === 'phone'`).
 */
export default function DataCard({
  label,
  onOpen,
  expanded,
  after,
  children,
}: {
  label: string;
  onOpen: () => void;
  /** 펼치는 카드(v2.77.0 매수 판단) — `aria-expanded` */
  expanded?: boolean;
  /** 펼친 내용 — 카드 안 맨 아래(누르는 곳 밖 · 눌러도 접히지 않음 — 표의 펼친 줄과 같음) */
  after?: ReactNode;
  children: ReactNode;
}) {
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onOpen();
    }
  };
  const press = { role: 'button', tabIndex: 0, 'aria-label': label, 'aria-expanded': expanded, onClick: onOpen, onKeyDown: onKey } as const;
  if (after === undefined)
    return (
      <div {...press} data-card className={`${DATA_CARD} cursor-pointer`}>
        {children}
      </div>
    );
  return (
    <div data-card className={DATA_CARD}>
      <div {...press} className={DATA_CARD_PRESS}>
        {children}
      </div>
      {after}
    </div>
  );
}

/** 카드 한 줄 — 왼쪽(줄어들고 넘치면 말줄임) · 오른쪽(줄지 않음 · 오른쪽 끝) */
export function DataCardRow({ left, right }: { left: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-3">
      <div className="min-w-0 truncate">{left}</div>
      {right != null && <div className="shrink-0 text-right">{right}</div>}
    </div>
  );
}

/** 카드 목록 — 카드 사이 8 */
export function DataCardList({ children }: { children: ReactNode }) {
  return (
    <div className={DATA_CARD_LIST} data-card-list>
      {children}
    </div>
  );
}

/** 받기 전 — 카드 모양 회색 상자(응답 전에 「없음」 을 그리지 않는다 · `docs/rules/ui.md` 「로딩 표시」) */
export function DataCardSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className={DATA_CARD_LIST} aria-hidden data-card-skeleton>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className={DATA_CARD}>
          <div className="flex justify-between gap-3">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-5 w-24" />
          </div>
          <div className="flex justify-between gap-3">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-4 w-28" />
          </div>
          <Skeleton className="h-4 w-28" />
        </div>
      ))}
    </div>
  );
}
