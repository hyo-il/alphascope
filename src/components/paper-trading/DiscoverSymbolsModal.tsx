import { useEffect, useRef, useState } from 'react';
import type { SurgeDetection, SurgeGrade, SurgeProgress } from '../../types/surge';
import type { SwingGrade, SwingRecommendation, SwingRecord } from '../../types/swing';
import StockName from '../common/StockName';
import { useStockNames } from '../../hooks/useStockNames';
import { toast } from '../../store/uiStore';

/**
 * 자동매매 대상 종목 **발굴** 팝업 — 기준 설정 → 탐지 → 근거 → 선택 추가.
 *
 * ⚠️ **새 알고리즘을 만들지 않았다.** 급등 탐지(Step 9)와 스윙 추천(Step 10)의 기존
 * 엔드포인트를 그대로 부르고, 이 화면은 **기준으로 거르고 근거를 보여 주는 일만** 한다.
 * 여기에 판정 로직을 또 두면 같은 종목이 발굴 화면과 급등/스윙 화면에서 다르게 보인다.
 *
 * 예전에는 버튼 하나가 곧바로 "10종목 담았습니다" 였다 — 무엇이 왜 담겼는지 알 수 없어
 * 사용자가 목록을 하나씩 지우며 확인해야 했다. 그래서 세 단계로 나눴다:
 *   ① 기준: 최소 점수·등급·개수 (급등/스윙만)
 *   ② 탐지: 저장된 결과를 읽거나, 다시 돌린다 (급등 재탐지는 1분을 넘을 수 있다)
 *   ③ 선택: 근거를 보고 고른 것만 담는다 (기본값은 전체 선택)
 */

type Source = 'surge' | 'swing' | 'watchlist';

interface Row {
  symbol: string;
  score: number | null;
  grade: string | null;
  /** 화면에 그대로 적는 근거 — 계산하지 않고 서버가 준 값을 옮긴다 */
  reasons: string[];
}

const SOURCES: { id: Source; label: string; desc: string }[] = [
  { id: 'surge', label: '🔥 급등 탐지', desc: '주기적으로 급등하는 종목 — 점수·규칙성·다음 예상일' },
  { id: 'swing', label: '📈 스윙 추천', desc: '5조건 채점 결과 — 진입가·손절·손익비' },
  { id: 'watchlist', label: '★ 관심 목록', desc: '담아 둔 종목 전부 (기준 없음)' },
];

const SURGE_GRADES: SurgeGrade[] = ['HIGH', 'MEDIUM', 'LOW'];
const SWING_GRADES: SwingGrade[] = ['STRONG', 'BUY', 'WATCH'];

const num = (v: number | null | undefined, digits = 0) =>
  v == null || !Number.isFinite(v) ? '—' : v.toFixed(digits);

function surgeRow(r: SurgeDetection): Row {
  const reasons = [`규칙성 ${num(r.regularity)}% · 급등 ${r.surgeCount}회`];
  if (r.nextEstimatedDate) {
    const d = r.daysUntilNext;
    reasons.push(`다음 예상 ${r.nextEstimatedDate}${d == null ? '' : d >= 0 ? ` (D-${d})` : ` (${-d}일 지남)`}`);
  }
  if (r.reason) reasons.push(r.reason);
  return { symbol: r.symbol, score: r.surgeScore, grade: r.grade, reasons };
}

function swingRowFromRecord(r: SwingRecord): Row {
  const reasons = [
    `진입 ${r.entryType ?? '—'} $${num(r.entryPrice, 2)} · 손절 $${num(r.stopLossPrice, 2)}`,
    `손익비 ${num(r.riskRewardRatio, 2)} · 권장 비중 ${num(r.recommendedPercent, 1)}%`,
  ];
  if (r.entryReason) reasons.push(r.entryReason);
  return { symbol: r.symbol, score: r.score, grade: r.grade, reasons };
}

function swingRowFromRecommendation(r: SwingRecommendation): Row {
  const reasons = [
    `진입 ${r.entry.type} $${num(r.entry.price, 2)} · 손절 $${num(r.stopLoss.price, 2)}`,
    `손익비 ${num(r.conditions.riskReward.ratio, 2)} · 권장 비중 ${num(r.position.recommendedPercent, 1)}%`,
    r.entry.reason,
  ];
  if (r.warnings.length) reasons.push(`⚠️ ${r.warnings[0]}`);
  return { symbol: r.symbol, score: r.score, grade: r.grade, reasons };
}

export default function DiscoverSymbolsModal({
  watchlist,
  alreadyAdded,
  onAdd,
  onClose,
}: {
  watchlist: string[];
  /** 이미 대상에 담긴 종목 — 중복 선택을 막고 「담김」 으로 표시한다 */
  alreadyAdded: string[];
  onAdd: (symbols: string[], source: string) => void;
  onClose: () => void;
}) {
  const [source, setSource] = useState<Source>('surge');
  const [minScore, setMinScore] = useState(60);
  const [grades, setGrades] = useState<string[]>(['HIGH', 'MEDIUM']);
  const [limit, setLimit] = useState(10);
  const [fresh, setFresh] = useState(false);

  const [rows, setRows] = useState<Row[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<SurgeProgress | null>(null);
  const [note, setNote] = useState<string | null>(null);

  // 팝업이 닫힌 뒤에도 폴링이 돌면 상태를 없는 화면에 쓴다.
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  useStockNames(rows?.map((r) => r.symbol) ?? []);

  /** 소스를 바꾸면 기준도 그 소스의 것으로 맞춘다 — 급등 60점과 스윙 65점은 다른 척도다 */
  const pickSource = (next: Source) => {
    setSource(next);
    setRows(null);
    setSelected([]);
    setNote(null);
    setFresh(false);
    if (next === 'surge') {
      setMinScore(60);
      setGrades(['HIGH', 'MEDIUM']);
    } else if (next === 'swing') {
      setMinScore(65);
      setGrades(['STRONG', 'BUY']);
    }
  };

  const toggleGrade = (g: string) =>
    setGrades((prev) => (prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]));

  /** 급등 재탐지는 종목 풀이 90개를 넘어 1분 이상 걸린다 — 진행률을 보여 주며 기다린다 */
  const waitForDetection = async () => {
    for (;;) {
      await new Promise((r) => setTimeout(r, 1500));
      if (!alive.current) return;
      const { progress: p } = (await fetch('/api/surge/progress').then((r) => r.json())) as {
        progress: SurgeProgress;
      };
      setProgress(p);
      if (!p.running) return;
    }
  };

  const detect = async () => {
    setBusy(true);
    setRows(null);
    setSelected([]);
    setNote(null);
    try {
      if (source === 'watchlist') {
        setRows(watchlist.map((symbol) => ({ symbol, score: null, grade: null, reasons: [] })));
        setSelected(watchlist.filter((s) => !alreadyAdded.includes(s)));
        return;
      }

      let found: Row[] = [];

      if (source === 'surge') {
        if (fresh) {
          await fetch('/api/surge/detect', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ watchlist }),
          });
          await waitForDetection();
          if (!alive.current) return;
        }
        const data = await fetch('/api/surge/results').then((r) => r.json());
        const all: SurgeDetection[] = data.results ?? [];
        if (!all.length) {
          setNote('저장된 급등 탐지 결과가 없습니다. [다시 탐지] 를 켜고 실행해 보세요.');
        } else if (data.detectedAt) {
          setNote(`탐지 시각 ${new Date(data.detectedAt).toLocaleString('ko-KR')} · 전체 ${all.length}건`);
        }
        found = all
          .filter((r) => r.surgeScore >= minScore && grades.includes(r.grade))
          .sort((a, b) => b.surgeScore - a.surgeScore)
          .slice(0, limit)
          .map(surgeRow);
      } else {
        if (fresh) {
          if (!watchlist.length) {
            toast.info('관심 목록이 비어 있어 다시 분석할 수 없습니다');
            return;
          }
          const data = await fetch('/api/swing/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ symbols: watchlist }),
          }).then((r) => r.json());
          const all: SwingRecommendation[] = data.recommendations ?? [];
          setNote(`관심 목록 ${watchlist.length}종목을 다시 채점했습니다 · 전체 ${all.length}건`);
          found = all
            .filter((r) => r.score >= minScore && grades.includes(r.grade))
            .sort((a, b) => b.score - a.score)
            .slice(0, limit)
            .map(swingRowFromRecommendation);
        } else {
          const data = await fetch('/api/swing/recommendations').then((r) => r.json());
          const all: SwingRecord[] = data.records ?? [];
          if (!all.length) {
            setNote('저장된 스윙 추천이 없습니다. [다시 분석] 을 켜고 실행해 보세요.');
          } else if (data.analyzedAt) {
            setNote(`분석 시각 ${new Date(data.analyzedAt).toLocaleString('ko-KR')} · 전체 ${all.length}건`);
          }
          found = all
            .filter((r) => r.score >= minScore && grades.includes(r.grade))
            .sort((a, b) => b.score - a.score)
            .slice(0, limit)
            .map(swingRowFromRecord);
        }
      }

      if (!alive.current) return;
      setRows(found);
      // 기본은 전체 선택이다 — 기준을 통과한 것만 보이므로, 빼는 쪽이 더 적다.
      setSelected(found.map((r) => r.symbol).filter((s) => !alreadyAdded.includes(s)));
    } catch (e) {
      toast.error('탐지하지 못했습니다', (e as Error).message);
    } finally {
      if (alive.current) {
        setBusy(false);
        setProgress(null);
      }
    }
  };

  const add = () => {
    if (!selected.length) return;
    onAdd(selected, SOURCES.find((s) => s.id === source)!.label.replace(/^\S+\s/, ''));
    onClose();
  };

  const gradeOptions = source === 'surge' ? SURGE_GRADES : SWING_GRADES;
  const selectable = (rows ?? []).filter((r) => !alreadyAdded.includes(r.symbol));

  return (
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center bg-black/70 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex h-[min(620px,82vh)] w-[min(720px,90vw)] flex-col overflow-hidden rounded-xl border border-border bg-bg-secondary shadow-2xl">
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">종목 발굴</h2>
          <span className="text-[11px] text-text-muted">기준을 정하고 탐지한 뒤, 근거를 보고 담습니다</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="ml-auto text-text-muted transition-colors hover:text-text-primary"
          >
            ✕
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 [scrollbar-gutter:stable]">
          {/* ① 기준 */}
          <section className="space-y-2">
            <h3 className="text-xs font-semibold text-text-primary">① 어디서 찾을까요</h3>
            <div className="grid grid-cols-3 gap-2">
              {SOURCES.map((s) => {
                const active = source === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => pickSource(s.id)}
                    className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                      active ? 'border-accent bg-accent/10' : 'border-border hover:border-accent/50'
                    }`}
                  >
                    <p className={`text-xs font-medium ${active ? 'text-accent' : 'text-text-primary'}`}>
                      {s.label}
                    </p>
                    <p className="mt-0.5 text-[11px] leading-relaxed text-text-muted">{s.desc}</p>
                  </button>
                );
              })}
            </div>
          </section>

          {source !== 'watchlist' && (
            <section className="space-y-2 rounded-md border border-border bg-bg-tertiary/30 p-3">
              <h3 className="text-xs font-semibold text-text-primary">② 기준</h3>
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs text-text-secondary">최소 점수</span>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={minScore}
                  onChange={(e) => setMinScore(Number(e.target.value))}
                  className="w-20 rounded border border-border bg-bg-tertiary px-2 py-1 text-xs tabular-nums"
                />
                <span className="ml-2 text-xs text-text-secondary">등급</span>
                {gradeOptions.map((g) => (
                  <button
                    key={g}
                    type="button"
                    onClick={() => toggleGrade(g)}
                    className={`rounded border px-2 py-0.5 text-[11px] transition-colors ${
                      grades.includes(g)
                        ? 'border-accent bg-accent/10 text-accent'
                        : 'border-border text-text-muted hover:border-accent/50'
                    }`}
                  >
                    {g}
                  </button>
                ))}
                <span className="ml-2 text-xs text-text-secondary">최대</span>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={limit}
                  onChange={(e) => setLimit(Number(e.target.value))}
                  className="w-16 rounded border border-border bg-bg-tertiary px-2 py-1 text-xs tabular-nums"
                />
                <span className="text-xs text-text-secondary">종목</span>
              </div>

              <label className="inline-flex w-fit items-center gap-2 text-xs text-text-secondary">
                <input type="checkbox" checked={fresh} onChange={(e) => setFresh(e.target.checked)} />
                {source === 'surge'
                  ? '다시 탐지 (종목 풀 90여 개 · 1분 이상 걸립니다)'
                  : '다시 분석 (관심 목록 종목을 새로 채점합니다)'}
              </label>
              <p className="text-[11px] leading-relaxed text-text-muted">
                끄면 {source === 'surge' ? '급등 탐지' : '스윙 추천'} 화면에서 마지막으로 나온
                결과를 그대로 읽습니다 — 판정 기준은 그 화면과 같습니다.
              </p>
            </section>
          )}

          {/* ② 탐지 */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void detect()}
              disabled={busy}
              className="rounded-md bg-accent px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
            >
              {busy ? '탐지 중…' : '탐지'}
            </button>
            {progress?.running && (
              <span className="text-[11px] text-text-muted">
                {progress.done}/{progress.total || '?'}
                {progress.current ? ` · ${progress.current}` : ''}
              </span>
            )}
            {note && <span className="text-[11px] text-text-muted">{note}</span>}
          </div>

          {/* ③ 결과 · 선택 */}
          {rows && (
            <section className="space-y-2">
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-semibold text-text-primary">
                  ③ 담을 종목 <span className="font-normal text-text-muted">({selected.length}/{rows.length})</span>
                </h3>
                <button
                  type="button"
                  onClick={() =>
                    setSelected(
                      selected.length === selectable.length ? [] : selectable.map((r) => r.symbol),
                    )
                  }
                  className="ml-auto text-[11px] text-text-muted transition-colors hover:text-text-primary"
                >
                  {selected.length === selectable.length && selectable.length > 0
                    ? '전체 해제'
                    : '전체 선택'}
                </button>
              </div>

              {rows.length === 0 ? (
                <p className="rounded border border-border bg-bg-tertiary/40 px-3 py-4 text-center text-[11px] text-text-muted">
                  기준을 통과한 종목이 없습니다. 점수를 낮추거나 등급을 넓혀 보세요.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {rows.map((row) => {
                    const added = alreadyAdded.includes(row.symbol);
                    const checked = selected.includes(row.symbol);
                    return (
                      <li key={row.symbol}>
                        <label
                          className={`flex w-full items-start gap-2 rounded-md border px-3 py-2 transition-colors ${
                            added
                              ? 'border-border/60 opacity-50'
                              : checked
                                ? 'border-accent bg-accent/5'
                                : 'border-border hover:border-accent/50'
                          }`}
                        >
                          <input
                            type="checkbox"
                            className="mt-0.5"
                            disabled={added}
                            checked={checked}
                            onChange={(e) =>
                              setSelected((prev) =>
                                e.target.checked
                                  ? [...new Set([...prev, row.symbol])]
                                  : prev.filter((s) => s !== row.symbol),
                              )
                            }
                          />
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-1.5">
                              <StockName symbol={row.symbol} size="sm" className="text-text-primary" />
                              {row.score != null && (
                                <span className="rounded bg-bg-tertiary px-1.5 py-0.5 text-[10px] tabular-nums text-text-secondary">
                                  {num(row.score)}점
                                </span>
                              )}
                              {row.grade && (
                                <span className="rounded border border-border px-1.5 py-0.5 text-[10px] text-text-secondary">
                                  {row.grade}
                                </span>
                              )}
                              {added && (
                                <span className="text-[10px] text-text-muted">이미 담긴 종목</span>
                              )}
                            </span>
                            {/* 근거 — 왜 이 종목이 올라왔는지 여기서 끝나야 한다 */}
                            {row.reasons.map((reason, i) => (
                              <span
                                key={i}
                                className="mt-0.5 block text-[11px] leading-relaxed text-text-muted"
                              >
                                {reason}
                              </span>
                            ))}
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-2 border-t border-border px-4 py-3">
          <span className="text-[11px] text-text-muted">
            담아도 자동매매가 곧바로 돌지는 않습니다 — 설정을 저장해야 반영됩니다.
          </span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto rounded-md border border-border px-3 py-1.5 text-xs text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary"
          >
            취소
          </button>
          <button
            type="button"
            onClick={add}
            disabled={!selected.length}
            className="rounded-md bg-accent px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
          >
            선택한 {selected.length}종목 담기
          </button>
        </div>
      </div>
    </div>
  );
}
