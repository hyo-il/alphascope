import { Panel } from '../ui';
import { LIST_TABLE_ROW, TABLE_HEAD_ROW, TABLE_NAME_COL, TABLE_NUM_COL, TABLE_NUM_GAP } from '../ui/tokens';
import { formatNumber, formatPrice } from '../../utils/formatters';
import { UNASSIGNED_LABEL, type AssetSymbolRow } from '../../types/asset';

/**
 * 「자산 현황」 종목별 표(v2.63.0) — 같은 종목을 계좌와 상관없이 한 줄로(서버 `holdingsBySymbol` — 총 자산과 같은 값 계산 · 화면에서 다시 계산하지 않는다).
 * 칸: 종목 · 코드 · 자산 분류 · 코어/위성(주식만) · 있는 계좌 · 수량 합 · 평가 금액 합 · 비중(「연금 포함」 을 따른 총 자산 대비). 평가 금액 큰 순.
 * 「전체 / 코어 / 위성」 거르기 — 코어 · 위성을 고르면 분류 「주식」 만 남는다 · 표 아래 합계 한 줄(코어 합 = 비율 조정 탭 코어 금액).
 * 가격 못 받은 종목은 금액 「—」 + 흐리게. 거르기는 이 화면 안에서만(기억하지 않는다 — 상태는 부모). 있는 계좌는 계좌 key(짧은 이름 · 날짜 없음 — 좁은 창에서 꺾임).
 */

export type SymbolFilter = 'all' | 'core' | 'satellite';
type Filter = SymbolFilter;
/** 「전체 / 코어 / 위성」 — 「계좌별 | 종목별」 과 같은 줄에 부모가 그린다 */
export const SYMBOL_FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: '전체' },
  { value: 'core', label: '코어' },
  { value: 'satellite', label: '위성' },
];
const FILTERS = SYMBOL_FILTERS;
const SIDE_LABEL = { core: '코어', satellite: '위성' } as const;

const NUM = `${TABLE_NUM_COL} ${TABLE_NUM_GAP} text-right tabular-nums`;
const TEXT = `${TABLE_NUM_COL} ${TABLE_NUM_GAP}`;

/** 수량 소수 자릿수 — 같은 열은 같은 자릿수(가장 긴 것 · 최대 4자리) */
function qtyDigits(rows: AssetSymbolRow[]): number {
  let d = 0;
  for (const r of rows) {
    if (r.quantity == null || Number.isInteger(r.quantity)) continue;
    d = Math.max(d, Math.min(4, (String(r.quantity).split('.')[1] ?? '').length));
  }
  return d;
}

export default function AssetSymbolTable({ rows, filter }: { rows: AssetSymbolRow[]; filter: Filter }) {
  const shown = filter === 'all' ? rows : rows.filter((r) => r.assetClass === '주식' && r.side === filter);
  // 수량 자릿수는 거르기 전 모든 줄로 — 거르기를 바꿔도 같은 종목의 자릿수가 같다
  const digits = qtyDigits(rows);
  const sum = shown.reduce((a, r) => a + (r.value ?? 0), 0);
  const label = FILTERS.find((f) => f.value === filter)?.label ?? '전체';

  return (
    <div className="space-y-2" data-symbol-view>
      <Panel pad="none" className="pb-1">
        <table className="w-full text-left text-xs" data-symbol-table>
          <thead className="text-caption text-text-muted">
            <tr className={`border-b border-border/50 ${TABLE_HEAD_ROW}`}>
              <th className={`${TABLE_NAME_COL} pl-4 font-normal`}>종목</th>
              <th className={`${TEXT} font-normal`}>코드</th>
              <th className={`${TEXT} text-center font-normal`}>자산 분류</th>
              <th className={`${TEXT} text-center font-normal`}>코어/위성</th>
              <th className={`${TABLE_NUM_GAP} min-w-28 font-normal`}>있는 계좌</th>
              <th className={`${NUM} font-normal`}>수량</th>
              <th className={`${NUM} font-normal`}>평가 금액</th>
              <th className={`${NUM} pr-4 font-normal`}>비중</th>
            </tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr className={LIST_TABLE_ROW}>
                <td colSpan={8} className="px-4 text-text-muted">
                  {filter === 'all' ? '보유 종목이 없습니다.' : `${label} 종목이 없습니다 — 분류 「주식」 종목만 코어 · 위성으로 나뉩니다.`}
                </td>
              </tr>
            )}
            {shown.map((r) => {
              const dim = r.value == null;
              return (
                <tr key={r.id} className={`border-t border-border/30 ${LIST_TABLE_ROW} ${dim ? 'text-text-muted' : 'text-text-primary'}`} data-symbol-row={r.id}>
                  <td className="max-w-0 pl-4">
                    <span className="block truncate" title={r.name}>
                      {r.name}
                    </span>
                  </td>
                  <td className={`${TEXT} ${dim ? '' : 'text-text-secondary'}`}>
                    {r.symbol ?? '—'}
                    {r.exchange && <span className="ml-1 text-caption text-text-muted">{r.exchange}</span>}
                  </td>
                  <td className={`${TEXT} text-center`}>{r.assetClass ?? UNASSIGNED_LABEL}</td>
                  <td className={`${TEXT} text-center`}>{r.side ? SIDE_LABEL[r.side] : '—'}</td>
                  <td className={`${TABLE_NUM_GAP} py-1 text-caption ${dim ? '' : 'text-text-secondary'}`}>
                    {r.sections.map((k, i) => (
                      <span key={k} className="whitespace-nowrap">
                        {i > 0 && ' · '}
                        {k}
                      </span>
                    ))}
                  </td>
                  <td className={NUM}>{r.quantity == null ? '—' : formatNumber(r.quantity, digits)}</td>
                  <td className={NUM} title={r.missing > 0 ? `가격을 받지 못한 줄 ${r.missing}개는 빠졌습니다` : undefined}>
                    {r.value == null ? '—' : formatPrice(r.value, 'KRW')}
                  </td>
                  <td className={`${NUM} pr-4`}>{r.ratio == null ? '—' : formatNumber(r.ratio * 100, 1, '%')}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Panel>
      <p className="pl-4 text-xs text-text-secondary tabular-nums" data-symbol-sum>
        {label} {formatPrice(sum, 'KRW')} · {shown.length}종목
      </p>
    </div>
  );
}
