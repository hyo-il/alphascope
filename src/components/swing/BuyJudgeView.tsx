import { useEffect, useState } from 'react';
import { LoaderCircle, RefreshCw } from 'lucide-react';
import { PANEL_PAD } from '../ui/tokens';
import { Button, PageHeader } from '../ui';
import { ICON_SM } from '../ui/icon';
import HelpBox from '../common/HelpBox';
import SymbolListBar from '../common/SymbolListBar';
import { SkeletonCards } from '../common/SkeletonLoader';
import RuleSelect from '../rules/RuleSelect';
import BuyJudgeTable from './BuyJudgeTable';
import BuyJudgeHistory from './BuyJudgeHistory';
import GoalDialog from './GoalDialog';
import NotProvenLine from './NotProvenLine';
import { useConfirmDelete } from './TargetAnalysisParts';
import { usePageTab } from '../../hooks/usePageTab';
import { useBuyJudge } from '../../hooks/useBuyJudge';
import { useTradingRules } from '../../hooks/useTradingRules';
import { useTargetAnalysis } from '../../hooks/useTargetAnalysis';
import { useSwingGoal } from '../../hooks/useSwingGoal';
import { useStockNames } from '../../hooks/useStockNames';
import { toast } from '../../store/uiStore';
import { formatDateTime } from '../../utils/dateFormat';
import { isKrSymbol } from '../../utils/market';
import type { PageTab } from '../../types/nav';

type Tab = PageTab<'swing'>;
const TABS: { id: Tab; label: string }[] = [
  { id: 'list', label: '매수 판단' },
  { id: 'history', label: '히스토리' },
];
/** 서버 `buyJudge/store.MAX_SYMBOLS` 와 같다 */
const MAX_SYMBOLS = 50;

/**
 * 매수 판단. page id 는 `swing` 그대로(주소·저장값).
 *
 * 위에서 고른 「매매 규칙」 하나로 전용 목록을 판단한다(서버 `buyJudge` — 마감 판단은 계좌 자동매매와 같은 함수).
 * 표 하나 + 장중 참고 점수 + 줄마다 [목표 수익 가능성](한 번에 한 종목) · 「히스토리」 탭.
 * ⚠️ 주문을 내지 않는다([모의 매수] 없음).
 */
export default function BuyJudgeView() {
  const [tab, setTab] = usePageTab('swing');
  const j = useBuyJudge();
  const { rules } = useTradingRules();
  const target = useTargetAnalysis();
  const goal = useSwingGoal();
  const [goalOpen, setGoalOpen] = useState(false);
  const [runningSymbol, setRunningSymbol] = useState<string | null>(null);
  const confirmDeleteTarget = useConfirmDelete(target.remove);
  const symbols = j.state?.symbols ?? [];
  useStockNames(symbols);

  // 목표 수익 가능성 — 서버 진행이 끝나면 줄 표시를 푼다
  useEffect(() => {
    if (runningSymbol && target.progress && !target.progress.running) {
      const r = target.progress.results.find((x) => x.symbol === runningSymbol);
      if (r?.error) toast.error('목표 수익 가능성을 분석하지 못했습니다', r.error);
      setRunningSymbol(null);
    }
  }, [target.progress, runningSymbol]);

  const runTarget = async (symbol: string) => {
    setRunningSymbol(symbol);
    try {
      await target.start({ symbols: [symbol], targetPct: goal.goal.targetPct, stopPct: goal.goal.stopPct, days: goal.goal.days });
    } catch (e) {
      setRunningSymbol(null);
      toast.error('목표 수익 가능성을 시작하지 못했습니다', (e as Error).message);
    }
  };

  const act = async (task: Promise<unknown>, failMsg: string) => {
    try {
      await task;
    } catch (e) {
      toast.error(failMsg, (e as Error).message);
    }
  };

  const busy = j.busy;
  /** [실행] — 끝나면 「실행이 완료됐습니다」 + 몇 종목·사도 됨 몇 개, 실패면 「실행하지 못했습니다」 + 이유 */
  const runAll = async () => {
    try {
      const next = await j.recalc();
      const buys = next.rows.filter((r) => r.verdict === 'buy').length;
      toast.success('실행이 완료됐습니다', `${next.rows.length}종목 판단 · 사도 됨 ${buys}종목 · ${formatDateTime(next.computedAt)}`);
    } catch (e) {
      toast.error('실행하지 못했습니다', (e as Error).message);
    }
  };
  const rows = j.state?.rows ?? [];
  const markets = [...new Set(rows.filter((r) => r.basisDate).map((r) => `${isKrSymbol(r.symbol) ? '국내' : '미국'} ${r.basisDate}`))];
  const ruleMissing = j.state != null && j.state.ruleId == null;
  const tableShown = j.state != null && symbols.length > 0 && !ruleMissing;

  return (
    <div className="flex h-full flex-col">
      <PageHeader title="매수 판단" tabs={TABS} value={tab} onChange={setTab} tabsLabel="매수 판단" />
      <div className={`min-h-0 flex-1 space-y-4 overflow-auto ${PANEL_PAD}`}>
        {tab === 'list' && (
          <>
            <HelpBox id="list" title="매수 판단은 무엇을 하나요?" storageKey="alphascope.swingHelp.list">
              <p>위에서 고른 「매매 규칙」 으로 아래 목록의 종목을 판단합니다. 계좌 자동매매와 같은 계산이라, 같은 종목·같은 규칙이면 계좌의 판단과 같습니다.</p>
              <p>「판단」 은 끝난 봉(마감) 기준이고, 「참고 점수」 는 지금 가격(장중) 또는 마지막 가격을 넣어 한 번 더 계산한 점수입니다 — 확정이 아닙니다.</p>
              <p>서버가 매일 각 시장 마감 뒤 판단을 기록합니다(화면을 열지 않은 날도). 기록과 「사도 됨」 의 그 뒤 수익은 「히스토리」 에서 봅니다. 이 화면은 주문을 내지 않습니다.</p>
            </HelpBox>

            <div className="flex flex-wrap items-start gap-3">
              <RuleSelect rules={rules} value={j.state?.ruleId ?? null} onChange={(id) => void act(j.setRule(id), '규칙을 바꾸지 못했습니다')} disabled={busy != null} label="매매 규칙" />
              {/*
                [실행]. 같은 날 다시 실행하면 판단(끝난 봉)은 같고 걸리는 시간도 짧아 알리지 않으면 바뀐 것이
                하나도 보이지 않는다(진행 표시 0.2초 · 계산 시각은 분 단위). 그래서 끝나면 늘 알림을 띄운다.
              */}
              <Button className="ml-auto" icon={RefreshCw} busy={busy === '실행 중…'} onClick={() => void runAll()} disabled={busy != null || ruleMissing || !symbols.length}>
                {busy === '실행 중…' ? '실행 중…' : '실행'}
              </Button>
            </div>
            {ruleMissing && <p className="text-xs text-warning">매매 규칙을 고르세요.</p>}
            <p className="text-caption text-text-secondary">
              기준: {markets.length ? `${markets.join(' · ')} 마감(끝난 봉)` : '마감(끝난 봉)'} · 참고 점수: 장중엔 지금 가격 / 장 마감 뒤엔 마지막 가격(확정 아님)
              {j.state && <span className="text-text-muted"> · {formatDateTime(j.state.computedAt)} 계산</span>}
            </p>

            <div className="space-y-2">
              <SymbolListBar
                selected={symbols}
                onChange={(next) => void act(j.setSymbols(next), '목록을 바꾸지 못했습니다')}
                max={MAX_SYMBOLS}
                dialogTitle="매수 판단 종목 추가"
                disabled={busy != null || j.state == null}
              />
              {/* 표가 있으면 진행 표시는 표 위에 덮는다(아래) — 표가 없을 때만 이 줄 */}
              {busy && !tableShown && (
                <p className="flex items-center gap-1.5 text-caption text-text-secondary" role="status">
                  <LoaderCircle {...ICON_SM} className="animate-spin" />
                  {busy}
                </p>
              )}
              {j.error && <p className="text-caption text-danger">{j.error}</p>}
              {j.state == null ? (
                <SkeletonCards count={3} className="grid-cols-1" />
              ) : !symbols.length ? (
                <p className="rounded-lg bg-bg-tertiary/40 px-3 py-3 text-xs text-text-muted">아직 추가한 종목이 없습니다. [종목 추가] 로 판단할 종목을 넣으세요.</p>
              ) : ruleMissing ? (
                <p className="rounded-lg bg-bg-tertiary/40 px-3 py-3 text-xs text-text-muted">매매 규칙을 고르면 {symbols.length}종목을 판단합니다.</p>
              ) : (
                // 작업 중에는 표 위에 회전 아이콘 + 문구(버튼과 함께 — 표에 결과가 새로 들어올 자리라는 것이 보이게)
                <div className="relative" aria-busy={busy != null}>
                  {busy && (
                    <div className="absolute inset-0 z-10 flex items-start justify-center rounded-lg bg-bg-primary/40 pt-1.5" role="status">
                      <span className="flex items-center gap-1.5 rounded-md bg-bg-elevated px-3 py-1.5 text-xs text-text-secondary shadow">
                        <LoaderCircle {...ICON_SM} className="animate-spin" />
                        {busy}
                      </span>
                    </div>
                  )}
                  <div className={busy ? 'pointer-events-none opacity-60' : ''}>
                  <BuyJudgeTable
                    rows={rows}
                    onRemove={(s) => void act(j.setSymbols(symbols.filter((x) => x !== s)), '목록을 바꾸지 못했습니다')}
                    disabled={busy != null}
                    goal={goal.goal}
                    targetRecords={target.records}
                    targetRunning={runningSymbol}
                    targetBlockedReason={target.geminiOff ? `지금은 분석할 수 없습니다 — ${target.geminiOff}` : null}
                    onTarget={(s) => void runTarget(s)}
                    onDeleteTarget={confirmDeleteTarget}
                    onEditGoal={() => setGoalOpen(true)}
                  />
                  </div>
                </div>
              )}
            </div>
          </>
        )}
        {tab === 'history' && <BuyJudgeHistory />}
        <NotProvenLine />
      </div>
      {goalOpen && <GoalDialog goal={goal.goal} onSave={goal.save} onClose={() => setGoalOpen(false)} />}
    </div>
  );
}
