import { ICON_SM } from '../ui/icon';
import { X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { SwingGrade, SwingRecommendation } from '../../types/swing';
import {
  applyCriteria,
  DEFAULT_SWING_GRADES,
  DEFAULT_SWING_LIMIT,
  loadSavedSwing,
  splitByLimit,
  swingRowFromRecommendation,
  type DiscoverRow,
  type FilterStats,
} from './discoverSources';
import StockName from '../common/StockName';
import { useStockNames } from '../../hooks/useStockNames';
import { toast } from '../../store/uiStore';
import CriteriaPanel from '../common/CriteriaPanel';
import { STANDARD_SWING_CRITERIA, swingCriteria } from '../../data/criteria';
import { useStrategyProfile } from '../../hooks/useStrategyProfile';
import { PROFILE_LABEL, type ProfileId } from '../../types/strategyProfile';

/**
 * 자동매매 대상 종목 **발굴** 팝업 — 기준 설정 → 탐지 → 근거 → 선택 추가.
 *
 * ⚠️ **새 알고리즘을 만들지 않았다.** 스윙 추천(Step 10)의 기존 엔드포인트를 그대로 부르고,
 * 이 화면은 **기준으로 거르고 근거를 보여 주는 일만** 한다. 여기에 판정 로직을 또 두면
 * 같은 종목이 발굴 화면과 스윙 화면에서 다르게 보인다.
 *
 * ⚠️ **급등 탐지는 소스에서 뺐다** (v2.15.0, 사용자 결정 2026-09-29). 오라클 진단에서 급등 다음 날
 * 매수 121건이 5일 뒤 −5.02%, +5% 먼저 31.4% vs −5% 먼저 62% 였다 — 자동매매 후보로 둘 근거가 없다.
 * 급등 화면·[모의 매수]는 사람이 직접 쓰는 테스트 기능으로 남는다. 계좌에 이미 담긴 종목은 건드리지 않는다.
 *
 * 예전에는 버튼 하나가 곧바로 "10종목 담았습니다" 였다 — 무엇이 왜 담겼는지 알 수 없어
 * 사용자가 목록을 하나씩 지우며 확인해야 했다. 그래서 세 단계로 나눴다:
 *   ① 기준: 최소 점수·등급·개수 (스윙만)
 *   ② 탐지: 저장된 결과를 읽거나, 다시 채점한다
 *   ③ 선택: 근거를 보고 고른 것만 담는다 (기본값은 전체 선택)
 */

type Source = 'swing' | 'watchlist';
type Row = DiscoverRow;

const SOURCES: { id: Source; label: string; desc: string }[] = [
  { id: 'swing', label: '지금 살 만한가', desc: '5조건 채점 결과 — 진입가·손절·손익비' },
  { id: 'watchlist', label: '관심 목록', desc: '담아 둔 종목 전부 (기준 없음)' },
];

const SWING_GRADES: SwingGrade[] = ['STRONG', 'BUY', 'WATCH'];

const num = (v: number | null | undefined, digits = 0) =>
  v == null || !Number.isFinite(v) ? '—' : v.toFixed(digits);

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
  const profile = useStrategyProfile();
  const activeId: ProfileId = profile.state?.active ?? 'standard';
  const activeParams = profile.state
    ? activeId === 'standard'
      ? profile.state.standard
      : profile.state.custom[activeId]
    : null;
  /** 스윙 추천의 문턱은 곧 BUY 컷이다 — 프로파일을 바꾸면 기본값도 따라간다 */
  const swingBuyCut = activeParams?.grades.buy ?? 65;

  const [source, setSource] = useState<Source>('swing');
  const [minScore, setMinScore] = useState(swingBuyCut);
  const [grades, setGrades] = useState<string[]>(DEFAULT_SWING_GRADES);
  const [limit, setLimit] = useState(DEFAULT_SWING_LIMIT);
  const [fresh, setFresh] = useState(false);

  const [rows, setRows] = useState<Row[] | null>(null);
  /** 불러온 스윙 추천이 어떤 기준으로 나왔는지 — 지금 기준과 다르면 알린다 */
  const [rowsProfile, setRowsProfile] = useState<ProfileId | null>(null);
  const [stats, setStats] = useState<FilterStats | null>(null);
  /** 기준에서 떨어진 종목도 흐리게 보여 줄지 — 왜 0건인지 눈으로 확인하는 용도다 */
  const [showRejected, setShowRejected] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
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

  /** 소스를 바꾸면 기준을 초기화한다 — 스윙의 문턱은 지금 프로파일의 BUY 컷이다 */
  const pickSource = (next: Source) => {
    setSource(next);
    setRows(null);
    setStats(null);
    setRowsProfile(null);
    setSelected([]);
    setNote(null);
    setFresh(false);
    if (next === 'swing') {
      setMinScore(swingBuyCut);
      setGrades(DEFAULT_SWING_GRADES);
    }
  };

  const toggleGrade = (g: string) =>
    setGrades((prev) => (prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]));

  const detect = async () => {
    setBusy(true);
    setRows(null);
    setStats(null);
    setRowsProfile(null);
    setSelected([]);
    setNote(null);
    try {
      if (source === 'watchlist') {
        const all = watchlist.map((symbol) => ({
          symbol,
          score: null,
          grade: null,
          reasons: [],
          passed: true,
        }));
        setRows(all);
        setStats({ total: all.length, passed: all.length, failScore: 0, failGrade: 0, gradeDist: [] });
        setSelected(watchlist.filter((s) => !alreadyAdded.includes(s)));
        return;
      }

      /** 기준을 적용하기 전의 전체 후보 — 떨어진 것도 들고 있어야 사유를 셀 수 있다 */
      let candidates: Row[] = [];

      if (fresh) {
        if (!watchlist.length) {
          toast.info('관심 목록이 비어 있어 다시 분석할 수 없습니다');
          return;
        }
        const res = await fetch('/api/swing/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ symbols: watchlist }),
        });
        const data = await res.json().catch(() => ({}));
        // 실패를 "기준을 통과한 종목이 없습니다" 로 보이지 않는다 (v2.34.1) — 아래 catch 가 오류 알림을 띄운다
        if (!res.ok) throw new Error(data.error ?? `요청 실패 (${res.status})`);
        const all: SwingRecommendation[] = data.recommendations ?? [];
        setRowsProfile(all[0]?.profile ?? activeId);
        setNote(`관심 목록 ${watchlist.length}종목을 다시 채점했습니다`);
        candidates = all.sort((a, b) => b.score - a.score).map(swingRowFromRecommendation);
      } else {
        // 설정 창의 [📈 스윙 추천 담기] 와 **같은 함수**다 (v2.32.0 — `discoverSources.ts`)
        const saved = await loadSavedSwing();
        setRowsProfile(saved.profile);
        if (!saved.rows.length) {
          setNote('저장된 「지금 살 만한가」 결과가 없습니다. [다시 분석] 을 켜고 실행해 보세요.');
        } else if (saved.analyzedAt) {
          setNote(`분석 시각 ${new Date(saved.analyzedAt).toLocaleString('ko-KR')}`);
        }
        candidates = saved.rows;
      }

      if (!alive.current) return;

      const { rows: marked, stats: counted } = applyCriteria(candidates, minScore, grades);
      /*
        통과분만 최대 개수로 자른다 — 떨어진 것은 개수 제한과 상관없이 "왜 0건인가" 를
        설명하는 자료라 그대로 둔다 (목록에는 토글을 켰을 때만 나온다).
      */
      const { passed, rejected } = splitByLimit(marked, limit);
      setRows([...passed, ...rejected]);
      setStats(counted);
      // 기본은 전체 선택이다 — 기준을 통과한 것만 담기 대상이라, 빼는 쪽이 더 적다.
      setSelected(passed.map((r) => r.symbol).filter((s) => !alreadyAdded.includes(s)));
    } catch (e) {
      toast.error('탐지하지 못했습니다', (e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const add = () => {
    if (!selected.length) return;
    onAdd(selected, SOURCES.find((s) => s.id === source)!.label.replace(/^\S+\s/, ''));
    onClose();
  };

  const gradeOptions = SWING_GRADES;
  const passedRows = (rows ?? []).filter((r) => r.passed);
  const rejectedRows = (rows ?? []).filter((r) => !r.passed);
  const visibleRows = showRejected ? [...passedRows, ...rejectedRows] : passedRows;
  const selectable = passedRows.filter((r) => !alreadyAdded.includes(r.symbol));

  return (
    <div
      className="fixed inset-0 z-[95] flex items-center justify-center bg-black/70 p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="flex h-[min(620px,82vh)] w-[min(720px,90vw)] flex-col overflow-hidden rounded-xl bg-bg-secondary shadow-2xl">
        <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold">종목 발굴</h2>
          <span className="text-[13px] text-text-muted">기준을 정하고 탐지한 뒤, 근거를 보고 담습니다</span>
          <button
            type="button"
            onClick={onClose}
            aria-label="닫기"
            className="ml-auto text-text-muted transition-colors hover:text-text-primary"
          >
            <X {...ICON_SM} />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 [scrollbar-gutter:stable]">
          {/* ① 기준 */}
          <section className="space-y-2">
            <h3 className="text-xs font-semibold text-text-primary">① 어디서 찾을까요</h3>
            <div className="grid grid-cols-2 gap-2">
              {SOURCES.map((s) => {
                const active = source === s.id;
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => pickSource(s.id)}
                    className={`rounded-lg border px-3 py-2 text-left transition-colors ${
                      active ? 'border-text-secondary/70 bg-bg-tertiary' : 'border-border/50 hover:border-text-muted'
                    }`}
                  >
                    <p className={`text-xs font-medium ${active ? 'text-accent' : 'text-text-primary'}`}>
                      {s.label}
                    </p>
                    <p className="mt-0.5 text-[13px] leading-relaxed text-text-muted">{s.desc}</p>
                  </button>
                );
              })}
            </div>
          </section>

          {source !== 'watchlist' && (
            <section className="space-y-2 rounded-lg bg-bg-tertiary/30 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-xs font-semibold text-text-primary">② 기준</h3>
                {/* 스윙은 판정 기준이 프로파일에 따라 달라진다 — 무엇으로 걸렀는지 적어 둔다 */}
                {source === 'swing' && (
                  <span className="rounded-lg bg-bg-tertiary/40 px-1.5 py-0.5 text-[13px] text-text-secondary">
                    기준: {PROFILE_LABEL[activeId]}
                    {activeId !== 'standard' ? '(사용자 설정)' : ''}
                  </span>
                )}
              </div>
              {/*
                점수·등급이 무엇인지 모르면 기준을 정할 수 없다. 설명은 스윙 화면과
                **같은 컴포넌트·같은 데이터**를 쓴다 — 두 벌로 적으면 반드시 갈라진다.
              */}
              <CriteriaPanel
                spec={
                  activeParams ? swingCriteria(activeParams, activeId) : STANDARD_SWING_CRITERIA
                }
              />
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
                    className={`rounded border px-2 py-0.5 text-[13px] transition-colors ${
                      grades.includes(g)
                        ? 'border-transparent bg-bg-elevated font-medium text-text-primary'
                        : 'border-transparent bg-bg-tertiary text-text-muted hover:text-text-primary'
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
                다시 분석 (관심 목록 종목을 새로 채점합니다)
              </label>
              <p className="text-[13px] leading-relaxed text-text-muted">
                끄면 「지금 살 만한가」 에서 마지막으로 나온
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
            {note && <span className="text-[13px] text-text-muted">{note}</span>}
          </div>

          {/* ⚠️ 여기서 다시 채점하지 않는다 — 불러온 추천이 다른 기준이면 그 사실만 알린다 */}
          {source === 'swing' && rowsProfile && rowsProfile !== activeId && (
            <p className="rounded-lg bg-warning/10 px-3 py-1.5 text-[13px] text-warning">
              이 추천은 '{PROFILE_LABEL[rowsProfile]}' 기준으로 나왔습니다 · 지금 기준은 '
              {PROFILE_LABEL[activeId]}' 입니다 — [다시 분석] 을 켜고 탐지하면 지금 기준으로
              채점합니다.
            </p>
          )}

          {/* ③ 결과 · 선택 */}
          {rows && (
            <section className="space-y-2">
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-semibold text-text-primary">
                  ③ 담을 종목{' '}
                  <span className="font-normal text-text-muted">
                    ({selected.length}/{passedRows.length})
                  </span>
                </h3>
                {rejectedRows.length > 0 && (
                  <label className="inline-flex w-fit items-center gap-1.5 text-[13px] text-text-muted">
                    <input
                      type="checkbox"
                      checked={showRejected}
                      onChange={(e) => setShowRejected(e.target.checked)}
                    />
                    기준 미달도 보기 ({rejectedRows.length})
                  </label>
                )}
                <button
                  type="button"
                  onClick={() =>
                    setSelected(
                      selected.length === selectable.length ? [] : selectable.map((r) => r.symbol),
                    )
                  }
                  className="ml-auto text-[13px] text-text-muted transition-colors hover:text-text-primary"
                >
                  {selected.length === selectable.length && selectable.length > 0
                    ? '전체 해제'
                    : '전체 선택'}
                </button>
              </div>

              {/*
                ⚠️ "0종목" 만 띄우지 않는다. 실제 신고는 **점수를 10 까지 낮췄는데도 0건**이었고,
                원인은 점수가 아니라 등급 필터였다(7건이 전부 WATCH·HOLD). 무엇에 걸렸는지
                숫자로 말해 주지 않으면 사용자는 엉뚱한 손잡이를 계속 돌린다.
              */}
              {stats && stats.total > 0 && source !== 'watchlist' && (
                <p className="rounded-lg bg-bg-tertiary/40 px-3 py-2 text-[13px] leading-relaxed text-text-muted">
                  전체 {stats.total}건 · 통과 {stats.passed} — 점수 미달 {stats.failScore} · 등급 제외{' '}
                  {stats.failGrade}
                  {stats.failGrade > 0 && ` (지금 ${grades.join('·') || '선택 없음'} 만 봄)`}
                  {stats.gradeDist.length > 0 && (
                    <>
                      <br />
                      실제 등급: {stats.gradeDist.map(([g, n]) => `${g} ${n}`).join(', ')}
                    </>
                  )}
                </p>
              )}

              {visibleRows.length === 0 ? (
                <p className="rounded-lg bg-bg-tertiary/40 px-3 py-4 text-center text-[13px] text-text-muted">
                  기준을 통과한 종목이 없습니다. 점수를 낮추거나 등급을 넓혀 보세요.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {visibleRows.map((row) => {
                    const added = alreadyAdded.includes(row.symbol);
                    const rejected = !row.passed;
                    const disabled = added || rejected;
                    const checked = selected.includes(row.symbol);
                    return (
                      <li key={row.symbol}>
                        <label
                          className={`flex w-full items-start gap-2 rounded-md border px-3 py-2 transition-colors ${
                            disabled
                              ? 'border-border/60 opacity-50'
                              : checked
                                ? 'border-accent bg-accent/5'
                                : 'border-border/50 hover:border-text-muted'
                          }`}
                        >
                          <input
                            type="checkbox"
                            className="mt-0.5"
                            disabled={disabled}
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
                                <span className="rounded bg-bg-tertiary px-1.5 py-0.5 text-[13px] tabular-nums text-text-secondary">
                                  {num(row.score)}점
                                </span>
                              )}
                              {row.grade && (
                                <span className="rounded-lg bg-bg-tertiary/40 px-1.5 py-0.5 text-[13px] text-text-secondary">
                                  {row.grade}
                                </span>
                              )}
                              {added && (
                                <span className="text-[13px] text-text-muted">이미 담긴 종목</span>
                              )}
                              {rejected && (
                                <span className="rounded bg-bg-tertiary px-1.5 py-0.5 text-[13px] text-text-muted">
                                  {row.fail === 'score' ? `점수 미달 (< ${minScore})` : '등급 제외'}
                                </span>
                              )}
                            </span>
                            {/* 근거 — 왜 이 종목이 올라왔는지 여기서 끝나야 한다 */}
                            {row.reasons.map((reason, i) => (
                              <span
                                key={i}
                                className="mt-0.5 block text-[13px] leading-relaxed text-text-muted"
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
          <span className="min-w-0 text-[13px] text-text-muted">
            담아도 자동매매가 곧바로 돌지는 않습니다 — 설정을 저장해야 반영됩니다.
          </span>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 whitespace-nowrap ml-auto rounded-md bg-bg-tertiary px-3 py-1.5 text-xs text-text-secondary transition-colors hover:bg-bg-elevated hover:text-text-primary"
          >
            취소
          </button>
          <button
            type="button"
            onClick={add}
            disabled={!selected.length}
            className="shrink-0 whitespace-nowrap rounded-md bg-accent px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
          >
            선택한 {selected.length}종목 담기
          </button>
        </div>
      </div>
    </div>
  );
}
