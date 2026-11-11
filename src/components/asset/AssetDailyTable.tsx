import { Fragment, useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronDown, ChevronRight, LoaderCircle } from 'lucide-react';
import { ICON_SM, Input, Panel, SectionTitle } from '../ui';
import WarnIcon from '../ui/WarnIcon';
import { LIST_TABLE_ROW, TABLE_HEAD_ROW, TABLE_NUM_COL, TABLE_NUM_GAP_TIGHT } from '../ui/tokens';
import { changeColor, formatSigned } from '../../utils/formatters';
import { formatAssetManwon, formatAssetWon, formatAssetWonSigned } from '../../utils/assetFormat';
import { ASSET_DAILY_NOTE_MAX, type AssetDailyChange } from '../../types/asset';

/**
 * 일별 자산 변화 표(v2.70.0) — 「총 자산」 탭, 추이 그래프 바로 아래. 그래프와 같은 응답(`GET /api/asset/history` 의 `rows`)을 쓴다.
 * - 줄 순서: 최신 날짜가 맨 위 · 칸: 날짜 · 총 자산 · 전날 대비(원) · 등락률 · 무엇 때문에(큰 몫 3개 · 만 원 단위) · 메모.
 * - 줄을 누르면 펼침: 몫 전부(원 단위) · 사고판 금액 · 많이 바뀐 종목 3개 · 「대략」 · 「가격 못 받음」 · 지난 날짜 안내.
 * - 메모: 누르면 바로 입력 · Enter / 바깥 누르기에 저장 · Esc 취소 · 저장 중 회전 표시 · 실패하면 글을 그대로 두고 오류 한 줄 · 잠겨 있으면 꺼짐.
 * - 줄이 많으면 표 안 스크롤(머리 줄 고정) · 숫자 칸은 오른쪽 정렬 · 말줄임 금지(「무엇 때문에」 · 메모 글만 말줄임 + 툴팁).
 */
/** 숫자 칸 — 칸이 여섯이라 좁은 간격(1280 에서 「무엇 때문에」 몫 셋이 보이게) */
const NUM = `${TABLE_NUM_COL} ${TABLE_NUM_GAP_TIGHT} text-right tabular-nums`;
const SKIP_TEXT: Record<NonNullable<AssetDailyChange['skip']>, string> = {
  first: '첫 기록 — 견줄 앞 기록이 없어요',
  'sheet-switched': '시트를 바꾼 뒤 첫 기록 — 견주지 않아요',
};
const OLD_RECORD_TEXT = '이 날은 주가 · 환율을 나눠 볼 기록이 없어요(v2.70.0 전)';

/** 「무엇 때문에」 짧은 글 — 큰 몫(절댓값) 3개 */
export function reasonText(r: AssetDailyChange): string {
  if (r.skip) return SKIP_TEXT[r.skip];
  if (r.shares.length === 0) return '변화 없음';
  return [...r.shares]
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))
    .slice(0, 3)
    .map((s) => `${s.label} ${formatAssetManwon(s.amount)}`)
    .join(' · ');
}

export type NoteSave = (day: string, note: string) => Promise<{ ok: true; note: string | null } | { ok: false; error: string }>;

export default function AssetDailyTable({
  rows,
  busy,
  noteDisabled,
  onSaveNote,
}: {
  /** 날짜 순(그래프와 같은 순서) — 화면이 거꾸로 보인다(처음 받기 스켈레톤 · 받기 실패는 부르는 쪽) */
  rows: AssetDailyChange[];
  /** 기간 · 연금 포함을 바꿔 다시 받는 중 — 내용은 두고 제목 옆 회전 표시 */
  busy: boolean;
  noteDisabled: boolean;
  onSaveNote: NoteSave;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [noteError, setNoteError] = useState<string | null>(null);
  const list = [...rows].reverse();
  const toggle = (day: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(day)) next.delete(day);
      else next.add(day);
      return next;
    });

  return (
    <Panel pad="none" className="flex flex-col pb-1" data-testid="asset-daily-table">
      <div className="px-4 pt-3 pb-2">
        <SectionTitle
          aside={busy ? <LoaderCircle {...ICON_SM} className="animate-spin" aria-label="받는 중" /> : undefined}
          info="하루 기록마다 바로 앞 기록과 견줍니다. 「입금 · 출금」 은 사고판 것을 뺀 현금 변화(급여 · 이체 등)이고, 사고판 금액은 현금에서 종목으로 옮긴 돈이라 총 자산 변화에는 들어가지 않습니다. 기록 시각의 환율 · 종목별 금액이 남은 날(v2.70.0 뒤)부터 「주가 · 환율」 로 나눠 보여 줍니다."
        >
          일별 자산 변화
        </SectionTitle>
      </div>
      {noteError && (
        <p role="alert" className="mx-4 mb-2 rounded-lg bg-danger/10 px-3 py-1.5 text-xs text-danger keep-all" data-testid="asset-daily-error">
          메모를 저장하지 못했습니다 — {noteError}
        </p>
      )}
      {rows.length === 0 && (
        <p className="px-4 pb-3 text-xs text-text-muted keep-all" data-testid="asset-daily-empty">
          아직 하루 기록이 없습니다 — 기록이 쌓이면 날마다 무엇 때문에 바뀌었는지 보여 줍니다.
        </p>
      )}
      {list.length > 0 && (
        <div className="max-h-96 overflow-y-auto [scrollbar-gutter:stable]" data-testid="asset-daily-scroll">
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 z-10 bg-bg-secondary text-caption text-text-muted">
              <tr className={`border-b border-border/50 ${TABLE_HEAD_ROW}`}>
                <th className="w-px whitespace-nowrap pl-4 font-normal">날짜</th>
                <th className={`${NUM} font-normal`}>총 자산</th>
                <th className={`${NUM} font-normal`}>전날 대비</th>
                <th className={`${NUM} font-normal`}>등락률</th>
                <th className="pl-4 font-normal">무엇 때문에</th>
                <th className="w-24 pl-3 pr-3 font-normal">메모</th>
              </tr>
            </thead>
            <tbody>
              {list.map((r) => {
                const expanded = open.has(r.day);
                const reason = reasonText(r);
                return (
                  <Fragment key={r.day}>
                    <tr className={`cursor-pointer border-t border-border/30 hover:bg-bg-tertiary/50 ${LIST_TABLE_ROW}`} onClick={() => toggle(r.day)} data-day={r.day}>
                      <td className="whitespace-nowrap pl-4">
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 text-text-primary tabular-nums"
                          aria-expanded={expanded}
                          aria-controls={`asset-daily-detail-${r.day}`}
                          aria-label={`${r.day} 자세히 보기`}
                          onClick={(e) => {
                            e.stopPropagation();
                            toggle(r.day);
                          }}
                        >
                          {expanded ? <ChevronDown {...ICON_SM} className="text-text-muted" /> : <ChevronRight {...ICON_SM} className="text-text-muted" />}
                          {r.day}
                        </button>
                      </td>
                      <td className={`${NUM} text-text-primary`}>{formatAssetWon(r.total)}</td>
                      <td className={`${NUM} ${r.change == null ? 'text-text-muted' : changeColor(r.change)}`}>{r.change == null ? '—' : formatAssetWonSigned(r.change)}</td>
                      <td className={`${NUM} ${r.change == null ? 'text-text-muted' : changeColor(r.change)}`}>{r.ratio == null ? '—' : formatSigned(r.ratio * 100, 2, '%')}</td>
                      <td className="max-w-0 pl-4">
                        <span className="flex min-w-0 items-center">
                          {/* 가격 못 받은 줄 — 글 대신 경고 표시 하나(자세한 글은 툴팁 · 펼침) */}
                          {r.missing > 0 && !r.skip && (
                            <span className="shrink-0 text-warning" data-tip={`가격 못 받음 ${r.missing}줄 — 정확하지 않음`} aria-label={`가격 못 받음 ${r.missing}줄`} role="img">
                              <WarnIcon />
                            </span>
                          )}
                          <span className={`min-w-0 truncate ${r.skip ? 'text-text-muted' : 'text-text-secondary'}`} data-tip={reason} data-tip-clip>
                            {reason}
                          </span>
                        </span>
                      </td>
                      <td className="w-24 max-w-24 pl-3 pr-3" onClick={(e) => e.stopPropagation()}>
                        <NoteCell day={r.day} note={r.note} disabled={noteDisabled} onSave={onSaveNote} onError={setNoteError} />
                      </td>
                    </tr>
                    {expanded && (
                      <tr className="bg-bg-tertiary/30" id={`asset-daily-detail-${r.day}`} data-testid="asset-daily-detail">
                        <td colSpan={6} className="px-4 py-2">
                          <Detail r={r} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

/** 펼친 줄 — 몫 전부(원 단위) · 사고판 금액 · 많이 바뀐 종목 · 안내 */
function Detail({ r }: { r: AssetDailyChange }) {
  if (r.skip) return <p className="text-xs text-text-muted keep-all">{SKIP_TEXT[r.skip]}</p>;
  const shares = [...r.shares].sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount));
  return (
    <div className="flex flex-wrap gap-x-10 gap-y-2 text-xs">
      <dl className="grid grid-cols-[auto_auto] gap-x-6 gap-y-1">
        <dt className="text-caption text-text-muted">{r.prevDay} 기록 대비</dt>
        <dd className={`text-right tabular-nums ${changeColor(r.change ?? 0)}`}>{formatAssetWonSigned(r.change)}</dd>
        {shares.map((s) => (
          <Fragment key={s.key}>
            <dt className="text-text-secondary">{s.label}</dt>
            <dd className={`text-right tabular-nums ${changeColor(s.amount)}`}>{formatAssetWonSigned(s.amount)}</dd>
          </Fragment>
        ))}
        {r.traded != null && (
          <>
            <dt className="text-text-secondary">사고판 금액(현금 → 종목 · 합에는 0)</dt>
            <dd className="text-right tabular-nums text-text-secondary">{formatAssetWonSigned(r.traded)}</dd>
          </>
        )}
      </dl>
      {r.movers.length > 0 && (
        <dl className="grid grid-cols-[auto_auto] content-start gap-x-6 gap-y-1">
          <dt className="col-span-2 text-caption text-text-muted">많이 바뀐 종목(주가 + 환율)</dt>
          {r.movers.map((m) => (
            <Fragment key={m.symbol}>
              <dt className="text-text-secondary">
                {m.name} <span className="text-caption text-text-muted">{m.symbol}</span>
              </dt>
              <dd className={`text-right tabular-nums ${changeColor(m.amount)}`}>{formatAssetWonSigned(m.amount)}</dd>
            </Fragment>
          ))}
        </dl>
      )}
      <ul className="min-w-0 basis-full space-y-0.5 text-caption text-text-muted keep-all">
        {!r.split && <li>{OLD_RECORD_TEXT}</li>}
        {r.approx && <li className="text-warning">대략 — 미국 매매를 원화로 바꿀 그날 환율 기록이 없어 가까운 날의 환율로 셌어요(없으면 그 매매는 빼고 셈)</li>}
        {r.missing > 0 && <li className="text-warning">가격 못 받음 {r.missing}줄 — 정확하지 않음(그 줄 금액은 「기타」 에 들어가요)</li>}
      </ul>
    </div>
  );
}

/** 메모 칸 — 누르면 입력 · Enter / 바깥 누르기 저장 · Esc 취소 */
function NoteCell({ day, note, disabled, onSave, onError }: { day: string; note: string | null; disabled: boolean; onSave: NoteSave; onError: (message: string | null) => void }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(note ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [shown, setShown] = useState(note);
  const inputRef = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  useEffect(() => setShown(note), [note]);
  useEffect(() => {
    if (editing) inputRef.current?.focus();
  }, [editing]);

  const save = async () => {
    if (done.current || saving) return;
    if (text.trim() === (shown ?? '')) {
      setEditing(false);
      setError(null);
      onError(null);
      return;
    }
    done.current = true;
    setSaving(true);
    const r = await onSave(day, text);
    setSaving(false);
    done.current = false;
    if (r.ok) {
      setShown(r.note);
      setText(r.note ?? '');
      setEditing(false);
      setError(null);
      onError(null);
    } else {
      setError(r.error); // 글은 그대로 두고 입력 칸을 연 채로 · 오류는 표 위 한 줄
      onError(r.error);
    }
  };
  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      void save();
    } else if (e.key === 'Escape') {
      setText(shown ?? '');
      setEditing(false);
      setError(null);
      onError(null);
    }
  };

  if (editing) {
    return (
      <span className="flex items-center gap-1">
        <Input
          ref={inputRef}
          size="sm"
          className="w-full"
          value={text}
          maxLength={ASSET_DAILY_NOTE_MAX}
          invalid={error != null}
          disabled={saving}
          aria-label={`${day} 메모`}
          placeholder="예: 급여"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          onBlur={() => void save()}
          data-tip={error ?? undefined}
        />
        {saving && <LoaderCircle {...ICON_SM} className="shrink-0 animate-spin text-text-muted" aria-label="저장 중" />}
      </span>
    );
  }
  return (
    <button
      type="button"
      disabled={disabled}
      aria-label={`${day} 메모${shown ? ` — ${shown}` : ''}`}
      data-tip={disabled ? '잠금을 풀면 적을 수 있어요' : shown ? shown : undefined}
      data-tip-clip={!disabled && shown ? true : undefined}
      onClick={() => {
        setText(shown ?? '');
        setEditing(true);
      }}
      className={`block w-full truncate rounded-md px-2 py-1 text-left hover:bg-bg-tertiary disabled:cursor-not-allowed disabled:opacity-50 ${shown ? 'text-text-primary' : 'text-text-muted'}`}
    >
      {shown ?? '메모'}
    </button>
  );
}
