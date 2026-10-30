import { GATE_REASON_HELP, GATE_REASON_LABEL, gateBlockLabel, type GateReason } from '../../types/autoTrading';
import { Fragment, useState } from 'react';
import { ChevronDown, ChevronRight, LoaderCircle } from 'lucide-react';
import StockName from '../common/StockName';
import { Button, ListRemoveButton } from '../ui';
import { ICON_SM } from '../ui/icon';
import { withUsDateTag } from '../common/UsDateTag';
import WarnIcon from '../ui/WarnIcon';
import { LIST_TABLE_ROW, TABLE_NAME_COL, TABLE_NUM_COL, TABLE_NUM_GAP_TIGHT } from '../ui/tokens';
import TradePlan from './TradePlan';
import { ResultCard, latestFor } from './TargetAnalysisParts';
import { formatNumber, formatPrice } from '../../utils/formatters';
import { currencyOfSymbol } from '../../utils/market';
import { ENTRY_LABEL, VERDICT_LABEL, type BuyJudgeRow, type Verdict } from '../../types/buyJudge';
import type { SwingGoal } from '../../types/swingGoal';
import type { TargetAnalysisRecord } from '../../types/targetAnalysis';

/** 판단 글자 — 색만으로 뜻을 전하지 않는다(글자가 있다). 손익비 부족은 경고 아이콘도 */
/**
 * 판단 글자 (사용자 결정): 「사도 됨」 = 초록(상승 토큰 `bullish`) · 「기준 미달」 · 「손익비 부족」 = 빨강(`danger`).
 * 총점이 있으면 함께 — `사도 됨 · 72/100`. 펼치기 전에도 판단과 점수가 한눈에 보이게. 색만으로 뜻을 전하지 않는다(글자가 있다).
 * 손익비 부족은 경고 아이콘을 그대로 둔다(같은 빨강이라 「기준 미달」 과 모양으로 구분).
 */
export function VerdictText({
  verdict,
  score,
  maxScore,
  gateReason,
  stackReason = false,
}: {
  verdict: Verdict | null;
  score?: number | null;
  maxScore?: number | null;
  /** 「거름망에 걸림 (시장 하락)」 — 이유. 모르는 옛 줄은 「거름망에 걸림」 */
  gateReason?: GateReason;
  /** 이유를 둘째 줄에(칸이 좁은 매수 판단 표 — 1280 에서 「(시장 데이터 없음)」 이 한 줄이면 오른쪽 칸이 밀려났다) */
  stackReason?: boolean;
}) {
  if (!verdict) return <span className="text-text-muted">—</span>;
  const total = score != null && maxScore != null ? <span className="tabular-nums"> · {score}/{maxScore}</span> : null;
  if (verdict === 'buy')
    return (
      <span className="whitespace-nowrap font-medium text-bullish">
        {VERDICT_LABEL.buy}
        {total}
      </span>
    );
  if (verdict === 'rr_block')
    return (
      <span className="whitespace-nowrap text-danger">
        <WarnIcon />
        {VERDICT_LABEL.rr_block}
        {total}
      </span>
    );
  // 기준 미달 · 거름망에 걸림 — 같은 빨강, 글자로 구분
  if (verdict === 'gate_block' && stackReason && gateReason)
    return (
      <span className="text-danger" title={GATE_REASON_HELP[gateReason]}>
        <span className="whitespace-nowrap">
          {VERDICT_LABEL.gate_block}
          {total}
        </span>
        <span className="block whitespace-nowrap text-caption">({GATE_REASON_LABEL[gateReason]})</span>
      </span>
    );
  return (
    <span className="whitespace-nowrap text-danger" title={verdict === 'gate_block' && gateReason ? GATE_REASON_HELP[gateReason] : undefined}>
      {verdict === 'gate_block' ? gateBlockLabel(gateReason) : VERDICT_LABEL[verdict]}
      {total}
    </span>
  );
}

const TARGET_ONE_AT_A_TIME = '목표 수익 가능성은 한 번에 한 종목만 분석합니다 — Gemini 무료 한도를 아끼기 위해서입니다(종목당 약 5회 호출).';

/**
 * 매수 판단 표 (사용자 결정 A-2). 종목 · 판단(총점 함께) · 참고 점수 · 손절가 · 목표가 · 손익비 · 비중(참고) · [목표 수익 가능성] · ×.
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
  // 칸이 10개라 숫자 칸 여백을 좁힌다(1280 에서 종목 칸에 이름·티커 자리 — 티커는 자르지 않는다)
  const NUM = `${TABLE_NUM_COL} ${TABLE_NUM_GAP_TIGHT} text-right`;

  return (
    <div className="rounded-lg bg-bg-tertiary/40" data-buy-judge-table>
      {/* 미국($ 소수 둘째)·국내(₩ 정수) 종목이 한 표에 섞여 가격 열의 소수 자릿수가 통화마다 다르다 — 통화 규칙이 맞다(data-rows-differ: 자릿수 측정 제외) */}
      <table className="w-full text-left text-xs" data-rows-differ>
        <thead className="text-caption text-text-muted">
          <tr className="border-b border-border/50">
            <th className={`${TABLE_NAME_COL} py-2 pl-3 pr-3`}>종목</th>
            <th className={`${TABLE_NUM_COL} py-2 pr-1`}>판단 · 점수(마감)</th>
            <th className={`${NUM} py-2`}>참고 점수</th>
            <th className={`${NUM} py-2`}>손절가</th>
            <th className={`${NUM} py-2`}>목표가</th>
            <th className={`${NUM} py-2`}>손익비</th>
            <th className={`${NUM} py-2`}>비중(참고)</th>
            <th className={`${TABLE_NUM_COL} py-2 pl-3 pr-2`} aria-label="목표 수익 가능성" />
            <th className="w-px py-2 pr-2" aria-label="목록에서 삭제" />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const cur = currencyOfSymbol(r.symbol);
            const planned = r.verdict === 'buy' || r.verdict === 'rr_block' || r.verdict === 'gate_block';
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
                  <td className="py-1 pl-3 pr-3">
                    <span className="flex min-w-0 items-center gap-1.5">
                      {isOpen ? <ChevronDown {...ICON_SM} className="shrink-0 text-text-muted" /> : <ChevronRight {...ICON_SM} className="shrink-0 text-text-muted" />}
                      {/* 칸이 9개라 1280 에서 종목 칸이 좁다 — 말줄임 대신 단어 단위 줄바꿈(티커는 자르지 않는다). 칸 최소 폭 = 가장 긴 단어 */}
                      <StockName symbol={r.symbol} wrap />
                    </span>
                  </td>
                  <td className={`${TABLE_NUM_COL} py-1 pr-1`}>{r.error ? <span className="text-text-muted">판단 못 함</span> : <VerdictText verdict={r.verdict} score={r.score} maxScore={r.maxScore} gateReason={r.gateReason} stackReason />}</td>
                  <td className={`${NUM} py-1 tabular-nums text-text-secondary`}>
                    {r.refScore != null ? (
                      // 「(장 마감 가격)」 은 숫자 아래 줄 — 칸이 10개라 1280 에서 한 줄로 두면 표가 넘쳤다
                      <span className="flex flex-col items-end leading-tight">
                        <span>{r.refScore}</span>
                        <span className="text-caption text-text-muted">({r.refLabel})</span>
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className={`${NUM} py-1 tabular-nums`}>{ref ? formatPrice(ref.stop, cur) : '—'}</td>
                  <td className={`${NUM} py-1 tabular-nums`}>{ref ? formatPrice(ref.target1, cur) : '—'}</td>
                  <td className={`${NUM} py-1 tabular-nums`}>{ref ? formatNumber(ref.ratio, 2) : '—'}</td>
                  <td className={`${NUM} py-1 tabular-nums`}>{ref ? `${formatNumber(ref.sizePercent, 1)}%` : '—'}</td>
                  <td className={`${TABLE_NUM_COL} py-1 pl-3 pr-2`} onClick={(e) => e.stopPropagation()}>
                    <Button busy={running}
                      size="sm"
                      onClick={() => {
                        setOpen((prev) => new Set(prev).add(r.symbol));
                        onTarget(r.symbol);
                      }}
                      disabled={targetDisabled}
                      title={targetBlockedReason ?? TARGET_ONE_AT_A_TIME}
                    >
                      {/* 한 종목 약 5회 호출 — 10초 넘게 걸릴 수 있어 진행 문구를 보인다 */}
                      {running ? '분석 중…' : '목표 수익 가능성'}
                    </Button>
                  </td>
                  <td className="w-px py-1 pr-2 text-right" onClick={(e) => e.stopPropagation()}>
                    <ListRemoveButton onClick={() => onRemove(r.symbol)} name={r.symbol} label="목록에서 삭제" />
                  </td>
                </tr>
                {isOpen && (
                  <tr className="border-b border-border/30 bg-bg-secondary/60">
                    <td colSpan={9} className="px-4 py-3">
                      {/* w-0 min-w-full — 펼친 내용의 폭이 위 표의 열 폭을 바꾸지 않게(펼칠 때 「판단」 열이 옮겨 갔다) */}
                      <div className="w-0 min-w-full">
                      <Detail row={r} currency={cur} record={record} running={running} goal={goal} onDeleteTarget={onDeleteTarget} onEditGoal={onEditGoal} />
                      </div>
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
              <li key={c.key} className="flex items-baseline gap-x-2">
                <span className="w-24 shrink-0 text-text-secondary">{c.name}</span>
                <span className={`w-14 shrink-0 text-right tabular-nums ${c.score >= c.max ? 'text-bullish' : 'text-text-primary'}`}>
                  {c.score}/{c.max}
                </span>
                <span className="min-w-0 flex-1 text-text-muted">
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
              {withUsDateTag(w)}
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
          <ResultCard record={record} isNew={false} onDelete={onDeleteTarget} flat />
        ) : (
          <p className="text-text-muted">이 조건으로 분석한 결과가 없습니다. 줄의 [목표 수익 가능성] 을 누르면 이 종목 하나를 분석합니다.</p>
        )}
      </div>
    </div>
  );
}
