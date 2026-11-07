import { Pencil } from 'lucide-react';
import { Badge, Button, Panel, SectionTitle } from '../ui';
import { LIST_TABLE_ROW, TABLE_HEAD_ROW, TABLE_NAME_COL, TABLE_NUM_COL, TABLE_NUM_GAP } from '../ui/tokens';
import { formatNumber, formatPrice, formatSigned } from '../../utils/formatters';
import type { AssetRebalance, AssetSummary, RebalanceExcluded, RebalanceRow, RebalanceTable } from '../../types/asset';

/**
 * 자산 관리 「비율 조정」(v2.63.0 · 자산 관리 4단계) — **보기만**(목표 비율은 설정 창에서 바꾼다 · 사용자 결정 1).
 * 탭과 떼어 쓸 수 있게 이 부품 하나로 둔다(나중에 설정으로 옮길 수 있게 — 받는 것은 `summary` 와 [목표 비율 바꾸기] 하나).
 * - 맨 위: 기준 금액(「연금 포함」 을 따름) + 계산에서 빠진 것(미지정 · 퇴직 연금 · 가격 못 받은 종목) 줄
 * - 자산 표(현금 · 채권 · 금 · 주식) · 주식 안 표(코어 · 위성) — 목표 % · 지금 % · 목표 금액 · 지금 금액 · 차이 · 차이 %p · 상태
 * 금액 · 상태는 서버 `computeRebalance`(총 자산 탭과 같은 숫자) 그대로 그린다 — 화면에서 다시 계산하지 않는다.
 */

const NUM = `${TABLE_NUM_COL} ${TABLE_NUM_GAP} text-right tabular-nums`;
const pct = (v: number | null) => (v == null ? '—' : formatNumber(v, 1, '%'));

/** 「○원 더 사야 함」(파랑 계열) · 「○원 줄여야 함」(빨강 계열) · 0원 「맞음」 */
function DiffText({ amount }: { amount: number | null }) {
  if (amount == null) return <span className="text-text-muted">—</span>;
  if (amount === 0) return <span className="text-text-secondary">맞음</span>;
  return amount > 0 ? <span className="text-rebalance-add">{formatPrice(amount, 'KRW')} 더 사야 함</span> : <span className="text-rebalance-cut">{formatPrice(-amount, 'KRW')} 줄여야 함</span>;
}

function StatusBadge({ status }: { status: RebalanceRow['status'] }) {
  if (status == null) return <span className="text-text-muted">—</span>;
  return status === 'ok' ? <Badge tone="bullish">괜찮음</Badge> : <Badge tone="warning">조정 필요</Badge>;
}

const excludedText = (e: RebalanceExcluded) =>
  e.key === 'missing' ? `${e.label} ${e.count ?? 0}줄은 계산에서 빠짐` : `${e.label} ${formatPrice(e.amount, 'KRW')}은 계산에서 빠짐`;

/** 표 위 안내 — 목표 칸이 비었음 · 목표 합이 100 이 아님 */
function TargetNotes({ table }: { table: RebalanceTable }) {
  const sumOff = table.targetSum != null && !table.targetMissing && Math.abs(table.targetSum - 100) > 1e-6;
  if (!table.targetMissing && !sumOff) return null;
  return (
    <div className="space-y-1 px-4 pb-2 text-xs text-warning keep-all" role="status">
      {table.targetMissing && <p>시트에 목표 비율이 없습니다 — 비어 있는 줄은 목표 「—」 로 보입니다.</p>}
      {sumOff && <p>목표 비율 합이 {formatNumber(table.targetSum, 1, '%')}입니다 — 설정에서 바로잡아 주세요.</p>}
    </div>
  );
}

/** 비율 조정 표 하나 — 자산 · 주식 안이 같은 모양(열 자리가 같다) */
export function RebalanceTableView({ title, aside, table, testId }: { title: string; aside: string; table: RebalanceTable; testId: string }) {
  return (
    <Panel pad="none" className="pb-1" data-rebalance-table={testId}>
      <div className="px-4 pb-2 pt-3">
        <SectionTitle aside={aside}>{title}</SectionTitle>
      </div>
      <TargetNotes table={table} />
      <table className="w-full text-left text-xs">
        <thead className="text-caption text-text-muted">
          <tr className={`border-b border-border/50 ${TABLE_HEAD_ROW}`}>
            <th className={`${TABLE_NAME_COL} pl-4 font-normal`}>분류</th>
            <th className={`${NUM} font-normal`}>목표</th>
            <th className={`${NUM} font-normal`}>지금</th>
            <th className={`${NUM} font-normal`}>목표 금액</th>
            <th className={`${NUM} font-normal`}>지금 금액</th>
            <th className={`${NUM} font-normal`}>차이</th>
            <th className={`${NUM} font-normal`}>차이(%p)</th>
            <th className={`${TABLE_NUM_COL} ${TABLE_NUM_GAP} pr-4 text-center font-normal`}>상태</th>
          </tr>
        </thead>
        <tbody>
          {table.rows.map((r) => (
            <tr key={r.key} className={`border-t border-border/30 ${LIST_TABLE_ROW} text-text-primary`} data-rebalance-row={r.key}>
              <td className="pl-4">{r.label}</td>
              <td className={NUM}>{pct(r.targetPct)}</td>
              <td className={NUM}>{pct(r.nowPct)}</td>
              <td className={NUM}>{formatPrice(r.targetAmount, 'KRW')}</td>
              <td className={NUM}>{formatPrice(r.nowAmount, 'KRW')}</td>
              <td className={NUM} data-rebalance-diff>
                <DiffText amount={r.diffAmount} />
              </td>
              <td className={NUM}>{r.diffPp == null ? '—' : formatSigned(r.diffPp, 1, '%p')}</td>
              <td className={`${TABLE_NUM_COL} ${TABLE_NUM_GAP} pr-4 text-center`}>
                <StatusBadge status={r.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Panel>
  );
}

/** 맨 위 한 줄 — 기준 금액(연금 포함 / 연금 뺌) + [목표 비율 바꾸기] · 아래에 빠진 금액 줄들 */
function BaseLine({ rebalance, includePension, onEditTarget }: { rebalance: AssetRebalance; includePension: boolean; onEditTarget: () => void }) {
  return (
    <Panel className="space-y-1.5">
      <div className="flex min-w-0 items-center gap-3">
        <span className="text-xs text-text-secondary">기준 금액</span>
        <span className="text-sm font-semibold tabular-nums text-text-primary" data-rebalance-base>
          {formatPrice(rebalance.assets.base, 'KRW')}
        </span>
        <span className="text-caption text-text-muted">{includePension ? '연금 포함' : '연금 뺌'} · 현금 + 채권 + 금 + 주식 · 괜찮음 범위 ±{rebalance.band}%p</span>
        <Button size="sm" icon={Pencil} className="ml-auto" onClick={onEditTarget} data-edit-target>
          목표 비율 바꾸기
        </Button>
      </div>
      {rebalance.excluded.length > 0 && (
        <ul className="space-y-0.5 text-caption text-text-muted" data-rebalance-excluded>
          {rebalance.excluded.map((e) => (
            <li key={e.key} className="tabular-nums">
              {excludedText(e)}
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

export default function AssetRebalanceView({ summary, onEditTarget }: { summary: AssetSummary; onEditTarget: () => void }) {
  const { rebalance } = summary;
  return (
    <div className="space-y-3" id="as-asset-rebalance">
      <BaseLine rebalance={rebalance} includePension={summary.includePension} onEditTarget={onEditTarget} />
      <RebalanceTableView title="자산" aside="목표 = 시트 「자산 투자 비율 관리」" table={rebalance.assets} testId="assets" />
      <RebalanceTableView title="주식 안" aside={`코어 · 위성 — 기준 = 주식 ${formatPrice(rebalance.stocks.base, 'KRW')}`} table={rebalance.stocks} testId="stocks" />
    </div>
  );
}
