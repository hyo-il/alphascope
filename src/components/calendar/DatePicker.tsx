import { useState } from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import Dialog from '../ui/Dialog';
import IconButton from '../ui/IconButton';

/**
 * 증시 일정의 날짜 고르기 창 (v2.41.0) — 「2026년 10월」 제목을 누르면 뜬다.
 * ‹‹ ›› = 1년, ‹ › = 1달. 주 시작 요일은 본 달력과 같다(일요일). 오늘 = 밑줄, 지금 고른 날 = 밝은 바탕(디자인 규칙 2).
 * 날짜를 누르면 그 달로 이동 + 그 날 선택 + 창 닫힘. ESC·바깥 클릭 = 닫힘(공용 창 틀).
 */
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const pad = (n: number) => String(n).padStart(2, '0');

export default function DatePicker({
  selected,
  today,
  onPick,
  onClose,
}: {
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
  const days = new Date(Date.UTC(view.y, view.m, 0)).getUTCDate();
  const cells: (string | null)[] = [...Array(firstDow).fill(null), ...Array.from({ length: days }, (_, i) => `${view.y}-${pad(view.m)}-${pad(i + 1)}`)];

  return (
    <Dialog title="날짜 고르기" onClose={onClose} size="sm" z={90}>
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
        {cells.map((day, i) =>
          day ? (
            <button
              key={day}
              type="button"
              onClick={() => onPick(day)}
              aria-current={day === today ? 'date' : undefined}
              aria-pressed={day === selected}
              className={`rounded-md py-1.5 tabular-nums transition-colors ${
                day === selected ? 'bg-bg-elevated font-medium text-text-primary' : 'text-text-secondary hover:bg-bg-tertiary hover:text-text-primary'
              } ${day === today ? 'underline underline-offset-4' : ''}`}
            >
              {Number(day.slice(8, 10))}
            </button>
          ) : (
            <span key={`e${i}`} />
          ),
        )}
      </div>
    </Dialog>
  );
}
