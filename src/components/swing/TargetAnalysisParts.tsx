import { useEffect, useMemo, useState } from 'react';
import { useWatchlist } from '../../hooks/useWatchlist';
import { useStockNames } from '../../hooks/useStockNames';
import { modal, toast } from '../../store/uiStore';
import { formatPrice } from '../../utils/formatters';
import { currencyOfSymbol } from '../../utils/market';
import StockName from '../common/StockName';
import SymbolSearch from '../common/SymbolSearch';
import TrashIcon from '../common/TrashIcon';
import {
  CALLS_PER_SYMBOL,
  TARGET_MAX_SYMBOLS,
  type TargetAnalysisRecord,
  type TargetOutcome,
  type TargetProgress,
  type TargetStats,
} from '../../types/targetAnalysis';
import { goalPct, periodLabel, sameCondition, type SwingGoal } from '../../types/swingGoal';

/**
 * 목표 도달 가능성 분석 부품 (v2.29.0 — 예전 「목표 도달 분석」 탭 `TargetAnalysisTab.tsx`(v2.24.0)에서 떼어 냈다).
 *
 * 쓰는 곳: 스윙 「추천 종목」 카드 체크 + 버튼 · 「종목 검색」 1종목 버튼 · 「추천 이력」 맨 아래 기록 섹션.
 * 엔진·저장·채점·성적은 서버 그대로(`server/gemini/targetAnalysis.ts`, 프롬프트 `t1`). 조건은 초보자 목표 설정(`swing.goal`).
 * ⚠️ 분석만 한다 — 주문·판정·자동매매에 쓰지 않는다. 비교 문장("과거 평균보다 높게/낮게/비슷하게(±5%p)")과 안내 문구는 지우지 않는다.
 */

const OUTCOME_LABEL: Record<TargetOutcome, { text: string; className: string }> = {
  target: { text: '목표 도달 ✅', className: 'text-bullish' },
  stop: { text: '손절 ❌', className: 'text-bearish' },
  neither: { text: '둘 다 아님 ➖', className: 'text-text-secondary' },
};


/** AI 가 과거 평균보다 목표 도달을 어떻게 보는가 — ±5%p 이내는 "비슷하게" */
export function compareWord(aiTarget: number, baseTarget: number): '높게' | '낮게' | '비슷하게' {
  const diff = aiTarget - baseTarget;
  if (diff > 5) return '높게';
  if (diff < -5) return '낮게';
  return '비슷하게';
}


function ProbBar({ t, s, n }: { t: number; s: number; n: number }) {
  return (
    <div className="flex h-3 w-full overflow-hidden rounded" role="img" aria-label={`목표 ${t}% 손절 ${s}% 둘 다 아님 ${n}%`}>
      <div className="bg-bullish" style={{ width: `${t}%` }} />
      <div className="bg-bearish" style={{ width: `${s}%` }} />
      <div className="bg-bg-tertiary" style={{ width: `${n}%` }} />
    </div>
  );
}


export function ResultCard({
  record,
  isNew,
  onDelete,
}: {
  record: TargetAnalysisRecord;
  isNew: boolean;
  onDelete: (record: TargetAnalysisRecord) => void;
}) {
  const [open, setOpen] = useState(false);
  const word = record.base ? compareWord(record.pTarget, record.base.target) : null;

  return (
    <div className={`space-y-2 rounded-lg border bg-bg-secondary p-3 text-[13px] ${isNew ? 'border-accent' : 'border-border'}`}>
      <div className="flex flex-wrap items-baseline gap-2">
        {isNew && <span className="rounded bg-accent px-1.5 py-0.5 text-[13px] font-medium text-white">NEW</span>}
        <StockName symbol={record.symbol} className="text-sm text-text-primary" />
        <span className="text-text-secondary">
          +{record.targetPct}% / −{record.stopPct}% · {record.days}거래일 · 기준 {record.baseDate} 종가{' '}
          {formatPrice(record.entryPrice, currencyOfSymbol(record.symbol))}
        </span>
        <button
          type="button"
          onClick={() => onDelete(record)}
          aria-label="이 기록 지우기"
          title="이 기록 지우기"
          className="ml-auto rounded p-1 text-text-muted transition-colors hover:bg-bg-tertiary hover:text-bearish"
        >
          <TrashIcon className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="space-y-1">
        <p className="text-text-secondary">
          <b className="text-text-primary">AI 예상</b> — 목표 먼저 <span className="text-bullish">{record.pTarget}%</span> · 손절 먼저{' '}
          <span className="text-bearish">{record.pStop}%</span> · 둘 다 아님 {record.pNeither}%
          {record.normalized && <span className="text-text-muted"> (합이 100 이 되도록 맞춤)</span>}
        </p>
        <ProbBar t={record.pTarget} s={record.pStop} n={record.pNeither} />
      </div>

      {record.base ? (
        <p className="text-text-secondary">
          <b className="text-text-primary">과거 기준선</b> — 같은 조건으로 최근 1년 아무 날이나 샀다면 목표 먼저 {record.base.target}% · 손절 먼저{' '}
          {record.base.stop}% · 기대값 {record.base.expectancy > 0 ? '+' : ''}
          {record.base.expectancy}%p <span className="text-text-muted">({record.base.samples}일 기준, 비용 반영)</span>
        </p>
      ) : (
        <p className="text-text-muted">과거 기준선 없음</p>
      )}

      {word && (
        <p className="text-text-primary">
          AI 는 과거 평균보다 목표 도달 가능성을 <b>{word}</b> 봅니다.
          <span className="text-text-muted">
            {' '}
            ({record.pTarget}% vs {record.base!.target}%{word === '비슷하게' ? ' — 차이 ±5%p 이내' : ''})
          </span>
        </p>
      )}

      {record.summary && <p className="whitespace-pre-line text-text-secondary">{record.summary}</p>}

      <button type="button" onClick={() => setOpen((v) => !v)} className="text-accent hover:underline">
        {open ? '근거·위험 접기' : '근거·위험 보기'}
      </button>
      {open && (
        <div className="space-y-1.5 border-t border-border pt-2 text-text-secondary">
          {record.reasons.length > 0 && (
            <div>
              <p className="text-text-muted">근거</p>
              <ul className="list-disc pl-4">{record.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul>
            </div>
          )}
          {record.risks.length > 0 && (
            <div>
              <p className="text-text-muted">위험</p>
              <ul className="list-disc pl-4">{record.risks.map((r, i) => <li key={i}>{r}</li>)}</ul>
            </div>
          )}
          <div>
            <p className="text-text-muted">전문가별</p>
            <ul className="space-y-0.5">
              {record.agents.map((a) => (
                <li key={a.role}>
                  {a.label}: {a.error ? <span className="text-bearish">실패 — {a.error}</span> : `목표 ${a.pTarget}% · 손절 ${a.pStop}% · 둘 다 아님 ${a.pNeither}% — ${a.summary}`}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <p className={record.outcome ? OUTCOME_LABEL[record.outcome].className : 'text-text-muted'}>
        {record.outcome
          ? `결과: ${OUTCOME_LABEL[record.outcome].text} (만기 ${record.outcomeDate})`
          : `채점 대기 — ${record.dueDate}까지`}
      </p>
    </div>
  );
}


export function SymbolPickerDialog({
  calls,
  onStart,
  onClose,
}: {
  calls: (n: number) => number;
  onStart: (symbols: string[]) => void;
  onClose: () => void;
}) {
  const { watchlist } = useWatchlist();
  const [extra, setExtra] = useState<string[]>([]);
  const [checked, setChecked] = useState<string[]>([]);
  const candidates = useMemo(() => [...new Set([...extra, ...watchlist])], [extra, watchlist]);
  useStockNames(candidates);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const toggle = (symbol: string) => {
    if (checked.includes(symbol)) {
      setChecked(checked.filter((s) => s !== symbol));
      return;
    }
    if (checked.length >= TARGET_MAX_SYMBOLS) {
      toast.warning(`한 번에 최대 ${TARGET_MAX_SYMBOLS}종목입니다`, `종목당 Gemini ${CALLS_PER_SYMBOL}회 — 무료 한도를 아끼려고 막았습니다`);
      return;
    }
    setChecked([...checked, symbol]);
  };

  const addFromSearch = (symbol: string) => {
    const s = symbol.trim().toUpperCase();
    if (!s) return;
    setExtra((list) => (list.includes(s) ? list : [s, ...list]));
    if (!checked.includes(s)) toggle(s);
  };

  const full = checked.length >= TARGET_MAX_SYMBOLS;

  return (
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center bg-black/70 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex max-h-[min(640px,85vh)] w-[min(520px,80vw)] flex-col gap-3 rounded-xl border border-border bg-bg-secondary p-4 shadow-2xl">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-text-primary">분석할 종목 고르기 (최대 {TARGET_MAX_SYMBOLS}개)</h2>
          <button type="button" onClick={onClose} className="ml-auto text-text-muted hover:text-text-primary" aria-label="닫기">
            ✕
          </button>
        </div>
        <SymbolSearch symbol="" onSubmit={addFromSearch} submitLabel="담기" clearOnSubmit dropUp={false} placeholder="관심 목록에 없는 종목 검색" />
        <ul className="min-h-0 flex-1 space-y-0.5 overflow-y-auto rounded border border-border/60 p-1">
          {candidates.length === 0 && <li className="p-3 text-center text-xs text-text-muted">관심 목록이 비어 있습니다. 위에서 검색해 담으세요.</li>}
          {candidates.map((symbol) => {
            const on = checked.includes(symbol);
            const disabled = !on && full;
            return (
              <li key={symbol}>
                <label
                  className={`flex w-full items-center gap-2 rounded px-2 py-1 text-xs ${disabled ? 'opacity-40' : 'hover:bg-bg-tertiary'}`}
                  title={disabled ? `최대 ${TARGET_MAX_SYMBOLS}종목입니다` : undefined}
                >
                  <input type="checkbox" checked={on} onChange={() => toggle(symbol)} aria-disabled={disabled} />
                  <StockName symbol={symbol} className="text-text-primary" />
                  {extra.includes(symbol) && <span className="text-[13px] text-text-muted">검색에서 추가</span>}
                </label>
              </li>
            );
          })}
        </ul>
        <p className="text-[13px] text-text-secondary">
          {checked.length}/{TARGET_MAX_SYMBOLS}종목 · 이번 분석에 Gemini 약 <b className="text-text-primary">{calls(checked.length)}</b>회 사용
        </p>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="rounded border border-border px-3 py-1 text-xs text-text-secondary hover:bg-bg-tertiary">
            취소
          </button>
          <button
            type="button"
            onClick={() => onStart(checked)}
            disabled={!checked.length}
            className="rounded bg-accent px-3 py-1 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-40"
          >
            분석 시작
          </button>
        </div>
      </div>
    </div>
  );
}


// ── 진행률 ───────────────────────────────────────────────────────────────────

export function TargetProgressBox({ progress }: { progress: TargetProgress | null }) {
  if (!progress || !(progress.running || progress.results.length > 0)) return null;
  return (
        <section className="rounded-lg border border-border bg-bg-secondary px-3 py-2 text-[13px]">
          <div className="mb-1 flex justify-between text-text-secondary">
            <span>
              {progress.running ? `분석 중 ${progress.current ?? ''}` : '최근 실행'} · {progress.done}/{progress.total}
            </span>
            {progress.input && (
              <span className="text-text-muted">
                +{progress.input.targetPct}% / −{progress.input.stopPct}% · {progress.input.days}거래일
              </span>
            )}
          </div>
          {progress.running && (
            <div className="h-1.5 rounded bg-bg-tertiary">
              <div className="h-full rounded bg-accent transition-all" style={{ width: `${Math.max(5, (progress.done / Math.max(1, progress.total)) * 100)}%` }} />
            </div>
          )}
          {progress.results.filter((r) => r.error).map((r) => (
            <p key={r.symbol} className="text-bearish">
              {r.symbol}: {r.error}
            </p>
          ))}
          {progress.rateLimited && (
            <p className="text-warning">무료 한도 초과로 남은 {progress.skipped.length}종목({progress.skipped.join(', ')})은 분석하지 않았습니다.</p>
          )}
        </section>
  );
}

// ── 버튼 (추천 종목·종목 검색) ──────────────────────────────────────────────

/** 같은 조건의 그 종목 **가장 최근 기록 1건** — 조건이 다르면 null(옛 조건 결과를 지금 목표의 답처럼 보이지 않게) */
export function latestFor(records: TargetAnalysisRecord[] | null, symbol: string, goal: SwingGoal): TargetAnalysisRecord | null {
  if (!records) return null;
  const list = records.filter((r) => r.symbol === symbol && sameCondition(r, goal));
  return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}

const localDay = (iso: string) => new Date(iso).toLocaleDateString('sv-SE');

/** 오늘 이미 같은 조건으로 분석했는가 (다시 분석은 막지 않는다 — 한도만 알린다) */
export function analyzedToday(records: TargetAnalysisRecord[] | null, symbol: string, goal: SwingGoal): boolean {
  const latest = latestFor(records, symbol, goal);
  return Boolean(latest && localDay(latest.createdAt) === localDay(new Date().toISOString()));
}

/** 체크 토글 — 6번째는 막고 예전 탭과 같은 토스트. ⚠️ 상태 갱신 함수(updater) 안에서 부르지 않는다 — 개발 모드가 두 번 불러 토스트가 두 번 뜬다 */
export function toggleTargetPick(list: string[], symbol: string): string[] {
  if (list.includes(symbol)) return list.filter((s) => s !== symbol);
  if (list.length >= TARGET_MAX_SYMBOLS) {
    toast.warning(`한 번에 최대 ${TARGET_MAX_SYMBOLS}종목입니다`, `종목당 Gemini ${CALLS_PER_SYMBOL}회 — 무료 한도를 아끼려고 막았습니다`);
    return list;
  }
  return [...list, symbol];
}

export function goalLabel(goal: { targetPct: number; stopPct: number; days: number }): string {
  return `+${goalPct(goal.targetPct)}/${periodLabel(goal.days)}`;
}

/**
 * [목표 도달 가능성 분석] — 고른 종목으로 시작한다. `GEMINI_ENABLED=false`·키 없음이면 꺼지고 이유를 보인다.
 * `symbols` 가 비어 있으면 종목 고르기 창(관심 목록 + 검색)을 연다.
 */
export function TargetAnalyzeButton({
  symbols,
  goal,
  label,
  running,
  geminiOff,
  onStart,
}: {
  symbols: string[];
  goal: SwingGoal;
  label?: string;
  running: boolean;
  geminiOff: string | null;
  onStart: (body: { symbols: string[]; targetPct: number; stopPct: number; days: number }) => Promise<void>;
}) {
  const [picking, setPicking] = useState(false);
  const begin = async (list: string[]) => {
    setPicking(false);
    try {
      await onStart({ symbols: list, targetPct: goal.targetPct, stopPct: goal.stopPct, days: goal.days });
      toast.success(`${list.length}종목 분석을 시작했습니다`, `Gemini 약 ${list.length * CALLS_PER_SYMBOL}회 · 1종목 약 10초`);
    } catch (e) {
      toast.error('분석을 시작하지 못했습니다', (e as Error).message);
    }
  };
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => (symbols.length ? void begin(symbols) : setPicking(true))}
        disabled={running || Boolean(geminiOff)}
        title={geminiOff ?? undefined}
        className="rounded bg-accent px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
      >
        {running ? '분석 중…' : label ?? `목표 도달 가능성 분석${symbols.length ? ` (${symbols.length}종목)` : ''}`}
      </button>
      <span className="text-[13px] text-text-muted">
        종목당 Gemini {CALLS_PER_SYMBOL}회 · 최대 {TARGET_MAX_SYMBOLS}종목 · 조건 +{goalPct(goal.targetPct)} / −{goalPct(goal.stopPct)} ·{' '}
        {periodLabel(goal.days)}
      </span>
      {geminiOff && <span className="text-[13px] text-warning">지금은 분석할 수 없습니다 — {geminiOff}</span>}
      {picking && (
        <SymbolPickerDialog calls={(n) => n * CALLS_PER_SYMBOL} onStart={(list) => void begin(list)} onClose={() => setPicking(false)} />
      )}
    </div>
  );
}

/** 카드 안 한 줄 요약 + [자세히] (펼치면 기록 카드 전체) */
export function TargetSummaryLine({
  record,
  onDelete,
}: {
  record: TargetAnalysisRecord;
  onDelete: (record: TargetAnalysisRecord) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-2 rounded-md border border-accent/30 bg-accent/5 px-2.5 py-1.5 text-[13px]">
      <p className="text-text-secondary">
        <b className="text-text-primary">목표 {goalLabel(record)}</b>: 목표 먼저 <span className="text-bullish">{record.pTarget}%</span> · 손절 먼저{' '}
        <span className="text-bearish">{record.pStop}%</span> · 둘 다 아님 {record.pNeither}%
        {record.base && <span className="text-text-muted"> (과거 평균 {record.base.target}%)</span>}
        <button type="button" onClick={() => setOpen((v) => !v)} className="ml-2 text-accent hover:underline">
          {open ? '접기' : '자세히'}
        </button>
      </p>
      {open && <ResultCard record={record} isNew={false} onDelete={onDelete} />}
    </div>
  );
}

export function useConfirmDelete(remove: (id: number) => Promise<void>) {
  return (record: TargetAnalysisRecord) =>
    modal.confirm({
      title: '목표 도달 분석 기록 삭제',
      message: `${record.symbol} (${record.baseDate}, +${record.targetPct}%/−${record.stopPct}%/${record.days}일) 기록을 지울까요? 성적 집계에서도 빠집니다.`,
      confirmText: '삭제',
      danger: true,
      onConfirm: async () => {
        try {
          await remove(record.id);
          toast.success('기록을 지웠습니다');
        } catch (e) {
          toast.error('삭제 실패', (e as Error).message);
        }
      },
    });
}

// ── 기록 섹션 (추천 이력 맨 아래) ────────────────────────────────────────────

export function TargetHistorySection({
  records,
  stats,
  progress,
  error,
  remove,
}: {
  records: TargetAnalysisRecord[] | null;
  stats: TargetStats | null;
  progress: TargetProgress | null;
  error: string | null;
  remove: (id: number) => Promise<void>;
}) {
  const [symbolFilter, setSymbolFilter] = useState('all');
  const [outcomeFilter, setOutcomeFilter] = useState<'all' | 'pending' | TargetOutcome>('all');
  const confirmDelete = useConfirmDelete(remove);
  const newIds = new Set((progress?.results ?? []).map((r) => r.id).filter((id): id is number => id != null));
  const symbols = useMemo(() => [...new Set((records ?? []).map((r) => r.symbol))], [records]);
  const shown = (records ?? []).filter(
    (r) =>
      (symbolFilter === 'all' || r.symbol === symbolFilter) &&
      (outcomeFilter === 'all' || (outcomeFilter === 'pending' ? !r.outcome : r.outcome === outcomeFilter)),
  );
  return (
    <div className="space-y-3">
      {error && <p className="text-[13px] text-bearish">기록을 불러오지 못했습니다: {error}</p>}
      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <h3 className="font-medium text-text-secondary">분석 기록 (모든 조건)</h3>
          <select value={symbolFilter} onChange={(e) => setSymbolFilter(e.target.value)} aria-label="종목" className="rounded border border-border bg-bg-tertiary px-2 py-0.5 text-[13px]">
            <option value="all">모든 종목</option>
            {symbols.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          <select value={outcomeFilter} onChange={(e) => setOutcomeFilter(e.target.value as typeof outcomeFilter)} aria-label="결과" className="rounded border border-border bg-bg-tertiary px-2 py-0.5 text-[13px]">
            <option value="all">모든 결과</option>
            <option value="pending">채점 대기</option>
            <option value="target">목표 도달</option>
            <option value="stop">손절</option>
            <option value="neither">둘 다 아님</option>
          </select>
          {stats && (
            <span className="ml-auto text-[13px] text-text-secondary">
              {stats.weak ? (
                <>
                  성적: <b>판단 보류</b> — 채점 {stats.scored}건(30건 미만)
                </>
              ) : (
                <>
                  성적(채점 {stats.scored}건): AI 가 가장 높게 준 결과 적중 <b>{stats.aiRate}%</b> vs 과거 기준선 <b>{stats.baseRate}%</b>
                </>
              )}
              {stats.rawScored != null && (
                <span className="ml-1 text-text-muted">· 같은 종목·같은 날·같은 조건은 1건으로 셉니다(원본 {stats.rawScored}건)</span>
              )}
            </span>
          )}
        </div>
        {records === null && !error && <p className="text-[13px] text-text-muted">불러오는 중…</p>}
        {records && shown.length === 0 && (
          <p className="rounded-lg border border-border bg-bg-secondary p-6 text-center text-xs text-text-muted">
            {records.length ? '조건에 맞는 기록이 없습니다.' : '아직 분석 기록이 없습니다. 「추천 종목」·「종목 검색」 의 [목표 도달 가능성 분석] 으로 시작하세요.'}
          </p>
        )}
        {shown.map((record) => (
          <ResultCard key={record.id} record={record} isNew={newIds.has(record.id)} onDelete={confirmDelete} />
        ))}
      </section>

      <p className="text-[13px] text-text-muted">
        AI 예상은 참고용입니다. 이 앱의 연구에서 '목표 수익 후보 선별'은 우연 수준이었습니다. 실제 매매 판단은 직접 하세요. 이 분석은 투자 조언이 아닙니다.
      </p>

    </div>
  );
}

