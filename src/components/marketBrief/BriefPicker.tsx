import { Select } from '../ui';
import { InlineSpinner } from '../common/LoadingOverlay';
import { formatTime } from '../../utils/dateFormat';
import { EDITION_LABEL } from '../../utils/marketBrief';
import type { MarketBrief, MarketBriefDayResponse, MarketBriefDays, MarketBriefStatus } from '../../types/marketBrief';
import { dayLabel } from './briefText';

/** 고르기 줄 — 날짜(30일) · 그날 판/시각 · 보관 안내 */
export default function BriefPicker({
  status,
  dateOptions,
  date,
  day,
  selected,
  loadingDay,
  onPickDate,
  onPickBrief,
}: {
  status: MarketBriefStatus | null;
  dateOptions: MarketBriefDays['days'];
  date: string | null;
  day: MarketBriefDayResponse | null;
  selected: MarketBrief | null;
  loadingDay: boolean;
  onPickDate: (date: string) => void;
  onPickBrief: (id: number) => void;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2">
      <Select size="sm" aria-label="날짜" className="w-52" value={date ?? ''} disabled={!dateOptions.length} onChange={(e) => onPickDate(e.target.value)}>
        {dateOptions.map((d) => (
          <option key={d.date} value={d.date}>
            {d.date} {dayLabel(d.date).slice(5)}
            {d.date === status?.today ? ' 오늘' : ''} · {d.count ? `${d.count}번 만듦` : '없음'}
          </option>
        ))}
      </Select>
      {day && day.items.length > 0 && (
        <Select size="sm" aria-label="판 · 만든 시각" className="w-60" value={selected?.id ?? ''} onChange={(e) => onPickBrief(Number(e.target.value))}>
          {day.items.map((i) => (
            <option key={i.id} value={i.id}>
              {formatTime(i.createdAt)} {EDITION_LABEL[i.edition]} · {i.trigger === 'auto' ? '자동' : '직접'}
              {i.hasAi ? '' : ' · AI 없음'}
            </option>
          ))}
        </Select>
      )}
      {loadingDay && day && <InlineSpinner />}
      <span className="text-caption text-text-muted">
        30일 보관 ·{' '}
        {status?.autoDisabledReason ? '이 서버는 자동 만들기가 꺼져 있습니다' : '평일 아침 7시 무렵 자동으로 오전판(13시까지 못 만들면 그날은 없음)'}
      </span>
    </div>
  );
}
