import { Fragment, useState } from 'react';
import { ChevronDown, ChevronRight, LoaderCircle } from 'lucide-react';
import StockName from '../common/StockName';
import { Button, ListRemoveButton } from '../ui';
import { ICON_SM } from '../ui/icon';
import WarnIcon from '../ui/WarnIcon';
import { LIST_TABLE_ROW, TABLE_NAME_COL, TABLE_NUM_COL, TABLE_NUM_GAP } from '../ui/tokens';
import TradePlan from './TradePlan';
import { ResultCard, latestFor } from './TargetAnalysisParts';
import { formatNumber, formatPrice } from '../../utils/formatters';
import { currencyOfSymbol } from '../../utils/market';
import { ENTRY_LABEL, VERDICT_LABEL, type BuyJudgeRow, type Verdict } from '../../types/buyJudge';
import type { SwingGoal } from '../../types/swingGoal';
import type { TargetAnalysisRecord } from '../../types/targetAnalysis';

/** 판단 글자 — 색만으로 뜻을 전하지 않는다(글자가 있다). 손익비 부족은 경고 아이콘도 */
function VerdictText({ verdict }: { verdict: Verdict | null }) {
  if (!verdict) return <span className="text-text-muted">—</span>;
  if (verdict === 'buy') return <span className="font-medium text-bullish">{VERDICT_LABEL.buy}</span>;
  if (verdict === 'rr_block')
    return (
      <span className="whitespace-nowrap text-warning">
        <WarnIcon />
        {VERDICT_LABEL.rr_block}
      </span>
    );
  return <span className="text-text-secondary">{VERDICT_LABEL.below}</span>;
}

const TARGET_ONE_AT_A_TIME = '목표 수익 가능성은 한 번에 한 종목만 분석합니다 — Gemini 무료 한도를 아끼기 위해서입니다(종목당 약 5회 호출).';

/**
 * 매수 판단 표 (v2.45.0 — 사용자 결정 A-2). 종목 · 판단 · 점수(마감) · 참고 점수 · 손절가 · 목표가 · 손익비 · 비중(참고) · [목표 수익 가능성] · ×.
 * 줄을 누르면 아래에 조건별 점수 · 진입 방식 · 가격 계획 · 경고 · 목표 수익 가능성 결과가 펼쳐진다.
 * 표 규칙(기준표 「표」): 숫자 칸 = 내용 폭 + 고정 여백, 남는 폭 = 종목 칸. 손절가~비중은 「사도 됨」 · 「손익비 부족」 줄에만.
 */
export default function BuyJudgeTable({
  rows,
  onRemove,
  disabled,
  goal,
  targetRecords,
  targetRunning,
  targetBlockedReason,
  onTarget,
  onDeleteTarget,
  onEditGoal,
}: {
  rows: BuyJudgeRow[];
  onRemove: (symbol: string) => void;
  disabled: boolean;
  goal: SwingGoal;
  targetRecords: TargetAnalysisRecord[] | null;
  /** 지금 목표 수익 가능성을 돌리는 종목(없으면 null) */
  targetRunning: string | null;
  /** 버튼을 못 쓰는 이유(Gemini 꺼짐 등) */
  targetBlockedReason: string | null;
  onTarget: (symbol: string) => void;
  onDeleteTarget: (record: TargetAnalysisRecord) => void;
  onEditGoal: () => void;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (s: string) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(s)) next.delete(s);
    else next.add(s);
    return next;
  });
  const NUM = `${TABLE_NUM_COL} ${TABLE_NUM_GAP} text-right`;

  return (
    <div className="rounded-lg bg-bg-tertiary/40" data-buy-judge-table>
      <table className="w-full text-left text-xs">
        <thead className="text-caption text-text-muted">
          <tr className="border-b border-border/50">
            <th className={`${TABLE_NAME_COL} py-2 pl-3 pr-4`}>종목</th>
            <th className={`${TABLE_NUM_COL} py-2 pr-2`}>판단</th>
            <th className={`${NUM} py-2`}>점수(마감)</th>
            <th className={`${NUM} py-2`}>참고 점수</th>
            <th className={`${NUM} py-2`}>손절가</th>
            <th className={`${NUM} py-2`}>목표가</th>
            <th className={`${NUM} py-2`}>손익비</th>
            <th className={`${NUM} py-2`}>비중(참고)</th>
            <th className={`${TABLE_NUM_COL} py-2 pl-6 pr-2`} aria-label="목표 수익 가능성" />
            <th className="w-px py-2 pr-2" aria-label="목록에서 삭제" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const cur = currencyOfSymbol(r.symbol);
            const planned = r.verdict === 'buy' || r.verdict === 'rr_block';
            const ref = planned ? r.reference : null;
            const isOpen = open.has(r.symbol);
            const running = targetRunning === r.symbol;
            const record = latestFor(targetRecords, r.symbol, goal);
            const targetDisabled = disabled || targetBlockedReason != null || (targetRunning != null && !running);
            return (
              <Fragment key={r.symbol}>
                <tr
                  className={`cursor-pointer border-b border-border/30 hover:bg-bg-tertiary/60 ${LIST_TABLE_ROW} ${isOpen ? 'bg-bg-tertiary/60' : ''}`}
                  onClick={() => toggle(r.symbol)}
                  aria-expanded={isOpen}
                >
                  <td className="max-w-0 py-1 pl-3 pr-4">
                    <span className="flex min-w-0 items-center gap-1.5">
                      {isOpen ? <ChevronDown {...ICON_SM} className="shrink-0 text-text-muted" /> : <ChevronRight {...ICON_SM} className="shrink-0 text-text-muted" />}
                      <span className="block min-w-0 truncate">
                        <StockName symbol={r.symbol} />
                      </span>
                    </span>
                  </td>
                  <td className={`${TABLE_NUM_COL} py-1 pr-2`}>{r.error ? <span className="text-text-muted">판단 못 함</span> : <VerdictText verdict={r.verdict} />}</td>
                  <td className={`${NUM} py-1 tabular-nums`}>{r.score != null ? `${r.score}/${r.maxScore}` : '—'}</td>
                  <td className={`${NUM} py-1 tabular-nums text-text-secondary`}>
                    {r.refScore != null ? (
                      <>
                        {r.refScore} <span className="text-caption text-text-muted">({r.refLabel})</span>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className={`${NUM} py-1 tabular-nums`}>{ref ? formatPrice(ref.stop, cur) : '—'}</td>
                  <td className={`${NUM} py-1 tabular-nums`}>{ref ? formatPrice(ref.target1, cur) : '—'}</td>
                  <td className={`${NUM} py-1 tabular-nums`}>{ref ? formatNumber(ref.ratio, 2) : '—'}</td>
                  <td className={`${NUM} py-1 tabular-nums`}>{ref ? `${formatNumber(ref.sizePercent, 1)}%` : '—'}</td>
                  <td className={`${TABLE_NUM_COL} py-1 pl-6 pr-2`} onClick={(e) => e.stopPropagation()}>
                    <Button
                      size="sm"
                      onClick={() => {
                        setOpen((prev) => new Set(prev).add(r.symbol));
                        onTarget(r.symbol);
                      }}
                      disabled={targetDisabled}
                      title={targetBlockedReason ?? TARGET_ONE_AT_A_TIME}
                    >
                      {running && <LoaderCircle {...ICON_SM} className="mr-1 animate-spin" />}
                      목표 수익 가능성
                    </Button>
                  </td>
                  <td className="w-px py-1 pr-2 text-right" onClick={(e) => e.stopPropagation()}>
                    <ListRemoveButton onClick={() => onRemove(r.symbol)} name={r.symbol} label="목록에서 삭제" />
                  </td>
                </tr>
                {isOpen && (
                  <tr className="border-b border-border/30 bg-bg-secondary/60">
                    <td colSpan={10} className="px-4 py-3">
                      <Detail row={r} currency={cur} record={record} running={running} goal={goal} onDeleteTarget={onDeleteTarget} onEditGoal={onEditGoal} />
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** 펼친 줄 — 조건별 점수 · 진입 방식 · 가격 계획 · 경고 · 목표 수익 가능성 */
function Detail({
  row: r,
  currency,
  record,
  running,
  goal,
  onDeleteTarget,
  onEditGoal,
}: {
  row: BuyJudgeRow;
  currency: 'KRW' | 'USD';
  record: TargetAnalysisRecord | null;
  running: boolean;
  goal: SwingGoal;
  onDeleteTarget: (record: TargetAnalysisRecord) => void;
  onEditGoal: () => void;
}) {
  if (r.error) return <p className="text-caption text-text-muted">{r.error}</p>;
  return (
    <div className="space-y-3 text-caption">
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_auto]">
        <div className="space-y-2">
          <p className="font-medium text-text-primary">
            조건별 점수 <span className="font-normal text-text-muted">· {r.basisDate} 마감 기준 · 합계 {r.score}/{r.maxScore} · 매수 기준 {r.minScore}점</span>
          </p>
          <ul className="space-y-1">
            {r.conditions.map((c) => (
              <li key={c.key} className="flex flex-wrap items-baseline gap-x-2">
                <span className="w-24 shrink-0 text-text-secondary">{c.name}</span>
                <span className={`w-14 shrink-0 text-right tabular-nums ${c.score >= c.max ? 'text-bullish' : 'text-text-primary'}`}>
                  {c.score}/{c.max}
                </span>
                <span className="min-w-0 text-text-muted">
                  {c.checks.map((k) => `${k.passed ? '○' : '×'} ${k.label}`).join(' · ')}
                </span>
              </li>
            ))}
          </ul>
          {r.reason && <p className="text-text-muted">{r.reason}</p>}
        </div>
        <div className="space-y-2">
          <p className="font-medium text-text-primary">
            가격 계획 <span className="font-normal text-text-muted">· 참고{r.reference ? ` · 진입 방식 ${ENTRY_LABEL[r.reference.entryType]}` : ''}</span>
          </p>
          {r.reference ? <TradePlan plan={r.reference} currency={currency} /> : <p className="text-text-muted">손절 자리를 찾지 못해 계획이 없습니다.</p>}
        </div>
      </div>
      {r.warnings.length > 0 && (
        <ul className="space-y-0.5 text-warning">
          {r.warnings.map((w) => (
            <li key={w}>
              <WarnIcon />
              {w}
            </li>
          ))}
        </ul>
      )}
      <p className="text-text-muted">참고 — 실제 주문은 계좌 자동매매가 규칙대로 합니다. 이 화면은 주문을 내지 않습니다.</p>
      <div className="space-y-2 border-t border-border/40 pt-3">
        <p className="flex flex-wrap items-center gap-2 font-medium text-text-primary">
          목표 수익 가능성
          <span className="font-normal text-text-muted">
            조건: 목표 +{goal.targetPct}% · {goal.days}거래일 · 손절 −{goal.stopPct}%
          </span>
          <button type="button" className="font-normal text-accent hover:underline" onClick={onEditGoal}>
            조건 바꾸기
          </button>
        </p>
        {running ? (
          <p className="text-text-secondary">
            <LoaderCircle {...ICON_SM} className="mr-1 inline animate-spin" />
            분석하는 중… 1분 안팎 걸립니다.
          </p>
        ) : record ? (
          <ResultCard record={record} isNew={false} onDelete={onDeleteTarget} />
        ) : (
          <p className="text-text-muted">이 조건으로 분석한 결과가 없습니다. 줄의 [목표 수익 가능성] 을 누르면 이 종목 하나를 분석합니다.</p>
        )}
      </div>
    </div>
  );
}
