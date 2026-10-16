import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import Button from '../ui/Button';
import { ICON_SM } from '../ui/icon';
import { useStockNames } from '../../hooks/useStockNames';
import { stockNameOf } from '../../utils/stockNames';
import { LIST_TABLE_ROW } from '../ui/tokens';

/** 날짜 한 줄 — 펼치면 `render()` 가 그 날의 내용을 그린다(펼칠 때만 부른다) */
export interface DateGroup {
  key: string;
  /** YYYY-MM-DD */
  date: string;
  /** 무엇을 했나 — 예: 「애플 외 4개」 */
  title: ReactNode;
  /** 한눈에 보는 요약 — 예: 「사도 됨 2 · 안 됨 3」 · 「방법 2개 · 3년」 */
  summary: ReactNode;
  render: () => ReactNode;
}

/**
 * 날짜별 히스토리 목록 (v2.48.0 — 사용자 결정) — **매수 판단 히스토리와 백테스트 히스토리가 같은 부품**을 쓴다(날짜 줄 모양 · 펼침 · [더 보기] 가 같아야 한다).
 * 날짜 줄 = 날짜 · 무엇(종목 외 N개) · 요약 · ▸. 누르면 그 날 내용을 아래에 펼친다(펼침은 기억하지 않는다). 최근 날짜가 위 — 순서는 부르는 쪽이 정한다.
 */
export default function DateGroupList({
  groups,
  label,
  hasMore = false,
  onMore,
  loadingMore = false,
  moreLabel = '더 보기',
}: {
  groups: DateGroup[];
  /** 화면 읽기용 목록 이름 */
  label: string;
  hasMore?: boolean;
  onMore?: () => void;
  loadingMore?: boolean;
  moreLabel?: string;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <div className="space-y-2">
      <ul aria-label={label} className="rounded-lg bg-bg-tertiary/40">
        {groups.map((g) => {
          const isOpen = open.has(g.key);
          return (
            <li key={g.key} className="border-b border-border/30 last:border-b-0" data-date-group>
              <button
                type="button"
                onClick={() => toggle(g.key)}
                aria-expanded={isOpen}
                className={`flex w-full items-center gap-4 px-3 text-left text-xs transition-colors hover:bg-bg-tertiary/60 ${LIST_TABLE_ROW} ${isOpen ? 'bg-bg-tertiary/60' : ''}`}
              >
                <span className="w-24 shrink-0 tabular-nums text-text-secondary">{g.date}</span>
                <span className="min-w-0 flex-1 text-text-primary">{g.title}</span>
                <span className="shrink-0 whitespace-nowrap text-text-secondary">{g.summary}</span>
                <span className="shrink-0 text-text-muted">{isOpen ? <ChevronDown {...ICON_SM} /> : <ChevronRight {...ICON_SM} />}</span>
              </button>
              {isOpen && <div className="bg-bg-secondary/60 px-3 pb-3 pt-1">{g.render()}</div>}
            </li>
          );
        })}
      </ul>
      {hasMore && onMore && (
        <Button size="sm" onClick={onMore} busy={loadingMore}>
          {loadingMore ? '불러오는 중…' : moreLabel}
        </Button>
      )}
    </div>
  );
}

/** 날짜 줄의 「무엇」 — 「애플 외 4개」(첫 종목 이름 + 나머지 수). 이름을 아직 못 받았으면 티커 */
export function SymbolsTitle({ symbols }: { symbols: string[] }) {
  useStockNames(symbols.slice(0, 1));
  if (!symbols.length) return <>—</>;
  const first = stockNameOf(symbols[0]) ?? symbols[0];
  return <>{symbols.length > 1 ? `${first} 외 ${symbols.length - 1}개` : first}</>;
}
