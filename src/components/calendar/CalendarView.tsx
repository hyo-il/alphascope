import { ChevronLeft, ChevronRight } from 'lucide-react';
import { IconButton, InfoTip, Button } from '../ui';
import WarnIcon from '../ui/WarnIcon';
import { useEffect, useMemo, useRef, useState } from 'react';
import DatePicker from './DatePicker';
import { InlineSpinner } from '../common/LoadingOverlay';
import { SkeletonList } from '../common/SkeletonLoader';
import StockName from '../common/StockName';
import type { CalendarEvent, CalendarEventType, CalendarResponse, CalendarScope } from '../../types/calendar';

/**
 * 📅 주요 일정 달력 (v2.17.0) — 월 달력 + 고른 날의 목록.
 *
 * 실적(관심 종목 · 시총 상위 100) · FOMC · 옵션 만기 · 휴장을 한 곳에서 본다. 데이터는 서버 `GET /api/calendar` 한 곳이고,
 * 이 화면은 거르고 그리기만 한다. 실적 종목을 누르면 그 종목 차트로 간다.
 * ⚠️ 판정은 없다 — 일정 표시일 뿐이다(자동매매 실적 회피는 서버가 따로 본다).
 */

const TYPES: { id: CalendarEventType; label: string; dot: string }[] = [
  { id: 'earnings', label: '실적', dot: 'bg-accent' },
  { id: 'fomc', label: '거시(FOMC)', dot: 'bg-warning' },
  { id: 'expiry', label: '만기', dot: 'bg-bullish' },
  { id: 'holiday', label: '휴장', dot: 'bg-bearish' },
];
const DOT = Object.fromEntries(TYPES.map((t) => [t.id, t.dot])) as Record<CalendarEventType, string>;
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const shortDate = (day: string) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`;
const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** 오늘(KST) — 서버 meta 가 오기 전 초기값 */
const todayKst = () => new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);

export default function CalendarView({ onSelectSymbol }: { onSelectSymbol: (symbol: string) => void }) {
  const initial = todayKst();
  const [month, setMonth] = useState<{ y: number; m: number }>({ y: Number(initial.slice(0, 4)), m: Number(initial.slice(5, 7)) });
  const [selected, setSelected] = useState<string>(initial);
  const [pickerOpen, setPickerOpen] = useState(false);
  const titleRef = useRef<HTMLButtonElement>(null);
  const [scope, setScope] = useState<CalendarScope>('watchlist');
  const [filters, setFilters] = useState<Record<CalendarEventType, boolean>>({
    earnings: true,
    fomc: true,
    expiry: true,
    holiday: true,
  });
  const [data, setData] = useState<CalendarResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 받는 중 — 처음에는 "일정이 없습니다" 대신 불러오는 중을, 달을 바꿀 때는 제목 옆 작은 스피너만 (v2.38.0 로딩 점검) */
  const [loading, setLoading] = useState(true);
  const sequence = useRef(0);

  // 달력 한 장 + 이번 주가 다음 달로 넘어가도 보이게 앞뒤로 조금 넉넉히 받는다
  const range = useMemo(() => {
    const first = ymd(month.y, month.m, 1);
    const last = new Date(Date.UTC(month.y, month.m, 0)).toISOString().slice(0, 10);
    return { from: addDays(first, -7), to: addDays(last, 7), first, last };
  }, [month]);

  useEffect(() => {
    const mine = ++sequence.current;
    setError(null);
    setLoading(true);
    fetch(`/api/calendar?from=${range.from}&to=${range.to}&scope=${scope}`)
      .then(async (r) => {
        const payload = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(payload.error ?? `요청 실패 (${r.status})`);
        return payload as CalendarResponse;
      })
      .then((d) => mine === sequence.current && setData(d))
      .catch((e: Error) => mine === sequence.current && setError(e.message))
      .finally(() => mine === sequence.current && setLoading(false));
  }, [range, scope]);
  const firstLoad = loading && !data;

  const holidaysAvailable = Boolean(data?.meta.holidays.US || data?.meta.holidays.KR);
  const visible = (data?.events ?? []).filter((e) => filters[e.type] && (e.type !== 'holiday' || holidaysAvailable));
  const byDay = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>();
    for (const e of visible) (map.get(e.date) ?? map.set(e.date, []).get(e.date)!).push(e);
    return map;
  }, [visible]);

  const today = data?.meta.today ?? initial;
  // 이번 주 = 오늘이 든 주(월~일)
  const weekStart = addDays(today, -((new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7));
  const weekEnd = addDays(weekStart, 6);
  const thisWeek = visible.filter((e) => e.date >= weekStart && e.date <= weekEnd);

  // 달력 칸 — 첫 주의 일요일부터 6주
  const firstWeekday = new Date(`${range.first}T12:00:00Z`).getUTCDay();
  const cells = Array.from({ length: 42 }, (_, i) => addDays(range.first, i - firstWeekday));

  const move = (delta: number) =>
    setMonth(({ y, m }) => {
      const next = new Date(Date.UTC(y, m - 1 + delta, 1));
      return { y: next.getUTCFullYear(), m: next.getUTCMonth() + 1 };
    });

  const eventText = (e: CalendarEvent) =>
    e.type === 'earnings' ? `${e.name ?? e.symbol} 실적${e.isEstimate ? '(예정)' : ''}` : e.label;

  const dayEvents = byDay.get(selected) ?? [];

  return (
    <div className="h-full overflow-auto p-3">
      <div className="space-y-3">
        {/* 제목 줄 / 고르기 줄을 나눈다 (v2.41.0 디자인 규칙 7) */}
        <h2 className="text-base font-semibold text-text-primary">증시 일정</h2>
        <header className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1">
            <IconButton icon={ChevronLeft} label="이전 달" size="sm" onClick={() => move(-1)} />
            {/* 제목 = 날짜 고르기 창 버튼 (v2.41.0) */}
            <Button variant="secondary" size="sm"
              ref={titleRef}
              onClick={() => setPickerOpen((v) => !v)}
              aria-haspopup="dialog"
              aria-expanded={pickerOpen}
              title="날짜 고르기"
              className="w-24">
              {month.y}년 {month.m}월
            </Button>
            <IconButton icon={ChevronRight} label="다음 달" size="sm" onClick={() => move(1)} />
            <Button variant="secondary" size="sm"
              onClick={() => {
                setMonth({ y: Number(today.slice(0, 4)), m: Number(today.slice(5, 7)) });
                setSelected(today);
              }}
              className="ml-1">
              오늘
            </Button>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-1.5">
            {TYPES.filter((t) => t.id !== 'holiday' || holidaysAvailable).map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setFilters((f) => ({ ...f, [t.id]: !f[t.id] }))}
                className={`flex items-center gap-1 rounded-md px-2 py-0.5 text-caption transition-colors ${
                  filters[t.id] ? 'border-transparent bg-bg-elevated text-text-primary' : 'border-transparent bg-bg-tertiary text-text-muted hover:text-text-primary'
                }`}
              >
                <span className={`h-1.5 w-1.5 rounded-full ${t.dot}`} aria-hidden />
                {t.label}
              </button>
            ))}
            <label className="ml-2 inline-flex w-fit items-center gap-1.5 text-caption text-text-secondary">
              <input
                type="checkbox"
                checked={scope === 'watchlist'}
                onChange={(e) => setScope(e.target.checked ? 'watchlist' : 'universe')}
              />
              관심 종목만
            </label>
          </div>
        </header>

        {/* 이번 주 요약 한 줄 */}
        <p className="rounded-xl bg-bg-secondary px-3 py-2 text-caption text-text-secondary">
          <span className="text-text-muted">이번 주({shortDate(weekStart)}~{shortDate(weekEnd)}) · </span>
          {firstLoad ? (
            <>
              <InlineSpinner className="mr-1 align-[-2px]" />
              일정을 불러오는 중…
            </>
          ) : thisWeek.length ? (
            thisWeek.map((e) => `${eventText(e)} ${shortDate(e.date)}`).join(' · ')
          ) : (
            '고른 종류의 일정이 없습니다'
          )}
          {loading && !firstLoad && <InlineSpinner className="ml-2 align-[-2px]" />}
        </p>

        {data?.meta.fomcStale && (
          <p className="rounded-lg bg-warning/10 px-3 py-1.5 text-caption text-warning">
            FOMC 일정 갱신 필요 — 달력의 FOMC 는 2027년까지만 들어 있습니다 (src/data/fomc.ts)
          </p>
        )}
        {data?.meta.nyse.stale && (
          <p className="rounded-lg bg-warning/10 px-3 py-1.5 text-caption text-warning">
            휴장 상수 갱신 필요 — NYSE 휴장 표는 2027년까지만 들어 있습니다 (src/data/nyseHolidays.ts)
          </p>
        )}
        {error && <p className="rounded-lg bg-danger/10 px-3 py-1.5 text-caption text-danger">{error}</p>}

        <div className="grid gap-3 [grid-template-columns:minmax(0,1fr)_300px]">
          {/* 월 달력 */}
          <div className="rounded-xl bg-bg-secondary p-2">
            <div className="grid grid-cols-7 text-center text-caption text-text-muted">
              {WEEKDAYS.map((w, i) => (
                <div key={w} className={`py-1 ${i === 0 ? 'text-bearish/80' : ''}`}>
                  {w}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-px">
              {cells.map((day) => {
                const inMonth = day >= range.first && day <= range.last;
                const events = byDay.get(day) ?? [];
                const types = [...new Set(events.map((e) => e.type))];
                const isToday = day === today;
                const isSelected = day === selected;
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => setSelected(day)}
                    className={`flex h-16 flex-col items-start rounded p-1 text-left transition-colors ${
                      isSelected ? 'bg-bg-elevated' : 'hover:bg-bg-tertiary/60'
                    } ${inMonth ? '' : 'opacity-40'}`}
                  >
                    <span
                      className={`text-caption tabular-nums ${
                        isToday ? 'rounded bg-text-primary px-1 font-semibold text-bg-primary' : 'text-text-secondary'
                      }`}
                    >
                      {Number(day.slice(8, 10))}
                    </span>
                    <span className="mt-auto flex flex-wrap items-center gap-0.5">
                      {types.map((t) => (
                        <span key={t} className={`h-1.5 w-1.5 rounded-full ${DOT[t]}`} aria-hidden />
                      ))}
                      {events.length > 1 && <span className="text-caption text-text-muted">{events.length}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 고른 날의 목록 */}
          <div className="rounded-xl bg-bg-secondary p-3">
            <p className="mb-2 text-xs font-semibold text-text-primary">
              {Number(selected.slice(5, 7))}월 {Number(selected.slice(8, 10))}일
              {selected === today && <span className="ml-1 text-caption font-normal text-text-secondary">오늘</span>}
            </p>
            {firstLoad ? (
              <SkeletonList count={3} />
            ) : dayEvents.length === 0 ? (
              <p className="text-caption text-text-muted">이날 일정이 없습니다.</p>
            ) : (
              <ul className="space-y-1.5">
                {dayEvents.map((e, i) => (
                  <li key={`${e.type}-${e.symbol ?? i}`} className={`flex items-start gap-2 text-caption ${e.past ? 'opacity-50' : ''}`}>
                    <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${DOT[e.type]}`} aria-hidden />
                    {e.type === 'earnings' && e.symbol ? (
                      <button
                        type="button"
                        onClick={() => onSelectSymbol(e.symbol!)}
                        className="min-w-0 text-left hover:underline"
                        title="이 종목 차트로"
                      >
                        <StockName symbol={e.symbol} name={e.name ?? undefined} size="sm" className="text-text-primary" />
                        <span className="block text-text-muted">{e.label}</span>
                      </button>
                    ) : (
                      <span className="text-text-secondary">{e.label}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* 데이터 출처 설명은 정보 아이콘으로 (v2.36.0 디자인 규칙 6) */}
        <p className="flex items-center gap-1 text-caption text-text-muted">
          데이터 출처{data && ` · 실적 대상 ${data.meta.scopeSize}종목`}
          <InfoTip label="데이터 출처">
          실적일은 yfinance 기준이며 회사가 확정하기 전의 추정일일 수 있습니다(「예정」). FOMC 는 연준 공식 일정표.
          옵션 만기는 매월 셋째 금요일(휴장이면 그 전 거래일), 3·6·9·12월은 분기 동시 만기입니다.
          {holidaysAvailable
            ? ` 휴장일은 토스 시장 달력 기준이고, 미국은 NYSE 공식 일정(${data?.meta.nyse.coverage.to.slice(0, 4) ?? '2027'}년까지)으로 보완합니다 — 둘 중 하나라도 휴장이면 휴장으로 표시합니다.`
            : ' 휴장일은 아직 받지 못해 표시하지 않습니다.'}
          </InfoTip>
        </p>
        {!!data?.meta.nyse.mismatches.length && (
          <p className="text-caption text-warning">
            <WarnIcon />토스·NYSE 휴장일 불일치: {data.meta.nyse.mismatches.join(', ')} — 둘 중 하나라도 휴장이면 휴장으로 계산합니다.
          </p>
        )}
      </div>
      {pickerOpen && (
        <DatePicker
          anchorRef={titleRef}
          selected={selected}
          today={data?.meta.today ?? initial}
          onPick={(day) => {
            setMonth({ y: Number(day.slice(0, 4)), m: Number(day.slice(5, 7)) });
            setSelected(day);
            setPickerOpen(false);
          }}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}
