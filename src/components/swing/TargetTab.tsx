import Button from '../ui/Button';
import { useEffect, useRef, useState } from 'react';
import SymbolPicker from '../common/SymbolPicker';
import StockName from '../common/StockName';
import HelpBox from '../common/HelpBox';
import NotProvenLine from './NotProvenLine';
import {
  ResultCard,
  TargetHistorySection,
  TargetProgressBox,
  latestFor,
  useConfirmDelete,
} from './TargetAnalysisParts';
import type { useTargetAnalysis } from '../../hooks/useTargetAnalysis';
import type { SwingGoal } from '../../types/swingGoal';
import { goalPct, periodLabel } from '../../types/swingGoal';
import { CALLS_PER_SYMBOL, TARGET_MAX_SYMBOLS } from '../../types/targetAnalysis';
import { toast } from '../../store/uiStore';

/** 다른 탭에서 넘겨받는 것 — 미리 체크할 종목 · 결과로 스크롤할 종목. nonce 가 바뀔 때만 적용한다 */
export interface TargetSeed {
  symbols: string[];
  focus: string | null;
  nonce: number;
}

/**
 * 「목표 수익 가능성」 탭 (v2.35.0) — 고른 종목(최대 5)마다 Gemini 로 "기간 안에 목표·손절 중 어디에 먼저" 확률을 추정한다.
 *
 * ⚠️ 새 분석 경로가 아니다 — `useTargetAnalysis`(`POST /api/target-analysis`) · 진행 상자 · 결과 카드 · 기록·성적 섹션을 그대로 쓴다.
 * 예전에는 「추천 종목」 카드의 체크와 「추천 이력」 맨 아래 기록으로 흩어져 있어 한 기능으로 보이지 않았다.
 * Gemini 는 버튼으로만 부른다.
 */
export default function TargetTab({
  goal,
  target,
  gradeOf,
  seed,
  onOpenCriteria,
}: {
  goal: SwingGoal;
  target: ReturnType<typeof useTargetAnalysis>;
  /** 「지금 살 만한가」 등급(방금 결과 또는 저장된 결과에 있으면) */
  gradeOf: (symbol: string) => string | null;
  seed: TargetSeed | null;
  onOpenCriteria: () => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [focus, setFocus] = useState<string | null>(null);
  /** 이번에 시작한 실행의 종목 — 끝나면 바로 아래에 결과를 모아 보인다 */
  const [runSymbols, setRunSymbols] = useState<string[] | null>(null);
  const confirmDelete = useConfirmDelete(target.remove);
  const focusRef = useRef<HTMLDivElement>(null);
  const running = target.progress?.running ?? false;
  const wasRunning = useRef(running);


  // 다른 탭(종목 검색·지금 살 만한가)에서 넘어오면 — 체크만 하고 자동으로 실행하지 않는다
  useEffect(() => {
    if (!seed) return;
    // 「자세히」 는 볼 종목만 넘긴다 — 이미 골라 둔 체크는 지우지 않는다
    if (seed.symbols.length) setPicked(seed.symbols.slice(0, TARGET_MAX_SYMBOLS));
    setFocus(seed.focus);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed?.nonce]);

  useEffect(() => {
    if (focus && target.records) focusRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }, [focus, target.records]);

  // 실행이 끝나는 순간 알린다 — 결과는 아래 「이번 결과」 에 바로 보인다
  useEffect(() => {
    if (wasRunning.current && !running && target.progress) {
      const ok = target.progress.results.filter((r) => r.id != null).length;
      const failed = target.progress.results.filter((r) => r.error).length;
      if (ok) toast.success(`${ok}종목 분석이 끝났습니다`, failed ? `실패 ${failed}종목 — 이유는 결과 위에 있습니다` : undefined);
      else toast.error('분석하지 못했습니다', '이유는 진행 상자에 있습니다');
    }
    wasRunning.current = running;
  }, [running, target.progress]);

  const start = async () => {
    if (!picked.length) return;
    try {
      await target.start({ symbols: picked, targetPct: goal.targetPct, stopPct: goal.stopPct, days: goal.days });
      setRunSymbols(picked);
      setFocus(null);
      toast.info(`${picked.length}종목 분석을 시작했습니다`, `Gemini 약 ${picked.length * CALLS_PER_SYMBOL}회 · 1종목 약 10초`);
    } catch (e) {
      toast.error('분석을 시작하지 못했습니다', (e as Error).message);
    }
  };

  const runIds = new Set((target.progress?.results ?? []).map((r) => r.id).filter((id): id is number => id != null));
  const thisRun = runSymbols && !running ? (target.records ?? []).filter((r) => runIds.has(r.id)) : [];
  const focusRecord = focus ? latestFor(target.records, focus, goal) : null;

  return (
    <div className="space-y-4">
      <HelpBox id="target" title="목표 수익 가능성은 무엇을 하나요?">
        <p>내가 정한 목표로 묻습니다. 예: "1달 안에 +5% 오르는 게 먼저일까, −2.5% 떨어지는 게 먼저일까?"</p>
        <p>
          AI(Gemini)가 자료를 읽고 확률을 추정합니다(예: 목표 먼저 42% · 손절 먼저 35% · 둘 다 아님 23%). 비교용으로 "지난 1년 아무 날이나
          매수했다면 실제로 몇 %였나" 도 함께 보여 줍니다.
        </p>
        <p>
          고른 종목만(최대 {TARGET_MAX_SYMBOLS}개) 보고, 종목당 Gemini {CALLS_PER_SYMBOL}회를 써서 1~2분 걸립니다. 아직 채점이 쌓이지 않은
          추정입니다 — 투자 조언이 아닙니다.
        </p>
      </HelpBox>

      <div className="flex flex-wrap items-center gap-2 text-caption">
        <span className="text-text-secondary">
          지금 조건: <b className="text-text-primary">목표 +{goalPct(goal.targetPct)} · {periodLabel(goal.days)} · 손절 −{goalPct(goal.stopPct)}</b>
        </span>
        <Button variant="secondary" size="sm"
          onClick={onOpenCriteria}>
          조건 바꾸기
        </Button>
      </div>

      {/* 종목 고르기 — 공용 「종목 고르기」(v2.41.0, 예전 화면 안 관심 목록 표 + 검색칸) */}
      <section className="space-y-2 rounded-xl bg-bg-secondary px-3 py-2">
        <SymbolPicker
          title="종목"
          selected={picked}
          onChange={setPicked}
          max={TARGET_MAX_SYMBOLS}
          maxReason={`종목당 Gemini ${CALLS_PER_SYMBOL}회 — 무료 한도를 아끼려고 막았습니다`}
          dialogTitle="목표 수익 가능성 — 종목 고르기"
          emptyText={`[종목 고르기] 에서 분석할 종목을 고르세요(최대 ${TARGET_MAX_SYMBOLS}개).`}
        />
        {picked.length > 0 && (
          <ul className="space-y-0.5 text-caption">
            {picked.map((s) => {
              const last = latestFor(target.records, s, goal);
              return (
                <li key={s} className="flex flex-wrap items-baseline gap-x-3">
                  <StockName symbol={s} size="sm" />
                  <span className="text-text-muted">지금 살 만한가 등급 {gradeOf(s) ?? '—'}</span>
                  <span className="text-text-muted">이 조건 마지막 분석 {last ? new Date(last.createdAt).toLocaleDateString('ko-KR') : '—'}</span>
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button variant="primary" size="sm"
            onClick={() => void start()}
            disabled={!picked.length || running || Boolean(target.geminiOff)}
            title={target.geminiOff ?? undefined}>
            {running ? '분석 중…' : `선택한 ${picked.length}종목 분석 (Gemini 약 ${picked.length * CALLS_PER_SYMBOL}회)`}
          </Button>
          {target.geminiOff && <span className="text-caption text-warning">지금은 분석할 수 없습니다 — {target.geminiOff}</span>}
        </div>
      </section>

      {/* 이번 결과 — 실행한 자리 바로 아래 */}
      <TargetProgressBox progress={target.progress} />
      {thisRun.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-xs font-semibold text-text-secondary">이번 결과 · {thisRun.length}종목</h3>
          {thisRun.map((record) => (
            <ResultCard key={record.id} record={record} isNew onDelete={confirmDelete} />
          ))}
        </section>
      )}

      {/* 「지금 살 만한가」 의 [자세히] 로 온 종목 — 지금 조건의 가장 최근 결과 */}
      {focus && (
        <div ref={focusRef} className="space-y-2">
          <h3 className="text-xs font-semibold text-text-secondary">
            <StockName symbol={focus} /> — 지금 조건의 가장 최근 결과
          </h3>
          {focusRecord ? (
            <ResultCard record={focusRecord} isNew={false} onDelete={confirmDelete} />
          ) : (
            <p className="text-caption text-text-muted">이 조건으로 분석한 결과가 없습니다.</p>
          )}
        </div>
      )}

      {/* 지난 기록·성적 — 예전 「추천 이력」 맨 아래 섹션을 그대로 옮겼다 */}
      <section className="space-y-2">
        <h3 className="text-xs font-semibold text-text-secondary">히스토리와 성적</h3>
        <TargetHistorySection
          records={target.records}
          stats={target.stats}
          progress={target.progress}
          error={target.error}
          remove={target.remove}
        />
      </section>

      <NotProvenLine />
    </div>
  );
}
