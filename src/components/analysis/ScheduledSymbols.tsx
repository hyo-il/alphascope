import { ICON_SM } from '../ui/icon';
import { X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useScheduledSymbols, type ScheduledStatus } from '../../hooks/useScheduledSymbols';
import { useWatchlist } from '../../hooks/useWatchlist';
import { useStockNames } from '../../hooks/useStockNames';
import { modal, toast } from '../../store/uiStore';
import SymbolTagInput from '../common/SymbolTagInput';
import { SIGNAL_LABEL } from './signalStyle';

/**
 * 「AI 분석 기록」 상태 판의 「내가 지정한 종목」 칸 + 편집 팝업 (v2.23.0).
 *
 * 하루 1번(미국 장 마감 30분 뒤 첫 확인), 최대 10종목. ⚠️ 분석만 한다 — 주문은 내지 않는다.
 * 1종목 = Gemini 5호출(에이전트 4 + 의장 1) 이라 "하루 최대 약 N×5호출" 을 숫자로 보여 준다.
 */

const RUN_LABEL: Record<string, string> = { schedule: '정기 실행', catchup: '보충 실행(놓친 날)', manual: '즉시 실행' };

const time = (iso: string | null | undefined) =>
  iso
    ? new Date(iso).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '—';

function Summary({ status }: { status: ScheduledStatus }) {
  const last = status.last;
  return (
    <div className="space-y-1">
      {last ? (
        <p className="text-text-secondary">
          마지막 {RUN_LABEL[last.trigger] ?? '정기 실행'} {time(last.finishedAt ?? last.startedAt)} (기준일{' '}
          {last.baseDate}) — 완료 {last.done.length}
          {last.failed.length > 0 && <span className="text-bearish"> · 실패 {last.failed.length}</span>}
          {last.rateLimited && (
            <span className="text-warning"> · 무료 한도 초과로 {last.skipped.length}종목 중단</span>
          )}
        </p>
      ) : (
        <p className="text-text-muted">아직 실행한 적이 없습니다.</p>
      )}
      {last && last.done.length > 0 && (
        <p className="truncate text-text-muted" title={last.done.map((d) => `${d.symbol} ${SIGNAL_LABEL[d.signal as keyof typeof SIGNAL_LABEL] ?? d.signal}`).join(' · ')}>
          {last.done.map((d) => `${d.symbol} ${SIGNAL_LABEL[d.signal as keyof typeof SIGNAL_LABEL] ?? d.signal}`).join(' · ')}
        </p>
      )}
      {last && last.failed.length > 0 && (
        <p className="truncate text-bearish" title={last.failed.map((f) => `${f.symbol}: ${f.error}`).join('\n')}>
          실패: {last.failed.map((f) => `${f.symbol}(${f.error})`).join(' · ')}
        </p>
      )}
    </div>
  );
}

export default function ScheduledSymbols() {
  const { status, error, save, runNow } = useScheduledSymbols();
  const [editing, setEditing] = useState(false);
  const names = useStockNames(status?.symbols ?? []);

  if (error && !status) return <p className="text-[13px] text-bearish">불러오지 못했습니다: {error}</p>;
  if (!status) return <p className="text-[13px] text-text-muted">불러오는 중…</p>;

  const n = status.symbols.length;

  const confirmRun = () => {
    modal.confirm({
      title: '지정 종목 지금 한 번 분석',
      message: `${n}종목을 지금 분석합니다. Gemini 약 ${n * 5}회를 씁니다(1종목 = 5회). 오늘의 정기 실행(미국 장 마감 30분 뒤)은 그대로 따로 돕니다.`,
      confirmText: '실행',
      onConfirm: async () => {
        try {
          await runNow();
          toast.success('지정 종목 분석을 시작했습니다', '끝나면 이 칸과 기록 목록에 나타납니다');
        } catch (e) {
          toast.error('실행하지 못했습니다', (e as Error).message);
        }
      },
    });
  };

  return (
    <div className="space-y-1.5 text-[13px] leading-relaxed">
      <div className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-text-primary">
          {n ? (
            status.symbols.map((s) => names(s) ?? s).join(', ')
          ) : (
            <span className="text-text-muted">지정한 종목이 없습니다</span>
          )}
        </span>
        <span className="text-text-muted">
          ({n}/{status.max}) · 하루 1번 · 미국 장 마감 30분 뒤
        </span>
      </div>
      {status.disabledReason ? (
        <p className="text-warning">돌지 않습니다 — {status.disabledReason}</p>
      ) : (
        <p className="text-text-muted">
          다음 실행 {n ? time(status.nextRunAt) : '— (종목 없음)'} · 하루 최대 약 {n * 5}호출
          {status.running && <span className="text-accent"> · 지금 실행 중…</span>}
        </p>
      )}
      <Summary status={status} />
      <div className="flex gap-2 pt-1">
        <button
          type="button"
          onClick={() => setEditing(true)}
          className="rounded bg-bg-tertiary px-2 py-0.5 text-text-secondary transition-colors hover:bg-bg-elevated hover:text-text-primary"
        >
          설정
        </button>
        <button
          type="button"
          onClick={confirmRun}
          disabled={!n || status.running || Boolean(status.disabledReason)}
          title={status.disabledReason ?? undefined}
          className="rounded bg-bg-tertiary px-2 py-0.5 text-text-secondary transition-colors hover:bg-bg-elevated hover:text-text-primary disabled:opacity-40"
        >
          지금 한 번 실행
        </button>
      </div>
      <p className="text-text-muted">분석만 합니다 — 주문은 내지 않습니다.</p>

      {editing && <ScheduledEditor status={status} onSave={save} onClose={() => setEditing(false)} />}
    </div>
  );
}

function ScheduledEditor({
  status,
  onSave,
  onClose,
}: {
  status: ScheduledStatus;
  onSave: (symbols: string[]) => Promise<unknown>;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<string[]>(status.symbols);
  const [saving, setSaving] = useState(false);
  const { watchlist } = useWatchlist();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const change = (next: string[]) => {
    if (next.length > status.max) {
      toast.warning(`지정 종목은 최대 ${status.max}개입니다`, `하루 최대 ${status.max * 5}호출 — 필요하면 나중에 늘립니다`);
      return;
    }
    setDraft(next);
  };

  const submit = async () => {
    setSaving(true);
    try {
      await onSave(draft);
      toast.success('지정 종목을 저장했습니다');
      onClose();
    } catch (e) {
      toast.error('저장하지 못했습니다', (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center bg-black/70 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex w-[min(560px,80vw)] flex-col gap-3 rounded-xl bg-bg-secondary p-4 shadow-2xl">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-text-primary">내가 지정한 종목 — 하루 1번 Gemini 분석</h2>
          <button type="button" onClick={onClose} className="ml-auto text-text-muted hover:text-text-primary" aria-label="닫기">
            <X {...ICON_SM} />
          </button>
        </div>
        <p className="text-[13px] leading-relaxed text-text-secondary">
          미국 장 마감 30분 뒤 첫 확인(약 10분 간격)에 하루 1번 분석합니다. 휴장일은 건너뜁니다. 국내 종목도 같은 시각에
          마지막 종가 기준으로 분석합니다. 결과는 「AI 분석 기록」 의 「지정 종목」 으로 쌓이고, <b>주문은 내지 않습니다.</b>
        </p>
        <SymbolTagInput symbols={draft} onChange={change} watchlist={watchlist} />
        <p className="text-[13px] text-text-muted">
          {draft.length}/{status.max}종목 · 하루 최대 약 <b className="text-text-secondary">{draft.length * 5}</b>호출
          (1종목 = 에이전트 4 + 의장 1)
        </p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded bg-bg-tertiary px-3 py-1 text-xs text-text-secondary hover:bg-bg-elevated"
          >
            취소
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={saving}
            className="rounded bg-accent px-3 py-1 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
          >
            {saving ? '저장 중…' : '저장'}
          </button>
        </div>
      </div>
    </div>
  );
}
