import { useState, type RefObject } from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import Popover from '../ui/Popover';
import IconButton from '../ui/IconButton';

/**
 * 증시 일정의 날짜 고르기 (v2.41.0 → v2.42.0 **제목 바로 아래 뜨는 Popover**, 예전 가운데 창) — 「2026년 10월」 제목을 누르면 뜬다.
 * ‹‹ ›› = 1년, ‹ › = 1달. 주 시작 요일은 본 달력과 같다(일요일). 오늘 = 밑줄, 지금 고른 날 = 밝은 바탕(디자인 규칙 2).
 * ⚠️ **늘 6주 줄**(앞뒤 달 날짜는 흐리게) — 달마다 주 수가 달라 창 높이가 흔들렸다. 앞뒤 달 날짜를 눌러도 그 날로 간다.
 * 날짜를 누르면 그 달로 이동 + 그 날 선택 + 닫힘. ESC·바깥 클릭 = 닫힘.
 */
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const pad = (n: number) => String(n).padStart(2, '0');

export default function DatePicker({
  anchorRef,
  selected,
  today,
  onPick,
  onClose,
}: {
  anchorRef: RefObject<HTMLElement | null>;
  selected: string;
  today: string;
  onPick: (day: string) => void;
  onClose: () => void;
}) {
  const [view, setView] = useState({ y: Number(selected.slice(0, 4)), m: Number(selected.slice(5, 7)) });
  const move = (months: number) =>
    setView(({ y, m }) => {
      const t = y * 12 + (m - 1) + months;
      return { y: Math.floor(t / 12), m: (t % 12) + 1 };
    });
  const firstDow = new Date(Date.UTC(view.y, view.m - 1, 1)).getUTCDay();
  /** 6주 × 7일 = 42칸 고정 — 첫 칸은 이 달 1일이 든 주의 일요일 */
  const start = Date.UTC(view.y, view.m - 1, 1 - firstDow);
  const cells = Array.from({ length: 42 }, (_, i) => {
    const d = new Date(start + i * 86_400_000);
    const day = `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
    return { day, inMonth: d.getUTCMonth() + 1 === view.m };
  });

  return (
    <Popover anchorRef={anchorRef} onClose={onClose} width={300} label="날짜 고르기">
      <div className="mb-2 flex items-center justify-center gap-1">
        <IconButton icon={ChevronsLeft} label="1년 전" size="sm" onClick={() => move(-12)} />
        <IconButton icon={ChevronLeft} label="이전 달" size="sm" onClick={() => move(-1)} />
        <span className="w-28 text-center text-xs font-medium tabular-nums text-text-primary">
          {view.y}년 {view.m}월
        </span>
        <IconButton icon={ChevronRight} label="다음 달" size="sm" onClick={() => move(1)} />
        <IconButton icon={ChevronsRight} label="1년 뒤" size="sm" onClick={() => move(12)} />
      </div>
      <div className="grid grid-cols-7 gap-0.5 text-center text-caption">
        {WEEKDAYS.map((w) => (
          <span key={w} className="py-1 text-text-muted">
            {w}
          </span>
        ))}
        {cells.map(({ day, inMonth }) => (
          <button
            key={day}
            type="button"
            onClick={() => onPick(day)}
            aria-current={day === today ? 'date' : undefined}
            aria-pressed={day === selected}
            className={`h-8 rounded-md tabular-nums transition-colors ${
              day === selected
                ? 'bg-bg-tertiary font-medium text-text-primary'
                : inMonth
                  ? 'text-text-secondary hover:bg-bg-tertiary hover:text-text-primary'
                  : 'text-text-muted/50 hover:bg-bg-tertiary hover:text-text-secondary'
            } ${day === today ? 'underline underline-offset-4' : ''}`}
          >
            {Number(day.slice(8, 10))}
          </button>
        ))}
      </div>
    </Popover>
  );
}
