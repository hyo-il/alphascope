import type { StatementRow } from '../../types/company';
import { formatCompact } from '../../utils/formatters';

interface Props {
  incomeStatement: StatementRow[];
  balanceSheet: StatementRow[];
}

const INCOME_LABELS: Record<string, string> = {
  'Total Revenue': '매출',
  'Gross Profit': '매출총이익',
  'Operating Income': '영업이익',
  'Net Income': '순이익',
};

const BALANCE_LABELS: Record<string, string> = {
  'Total Assets': '총자산',
  'Total Debt': '총부채',
  'Stockholders Equity': '자본총계',
  'Cash And Cash Equivalents': '현금성자산',
};

function Table({ title, rows, labels }: { title: string; rows: StatementRow[]; labels: Record<string, string> }) {
  if (!rows.length) {
    return (
      <div>
        <h4 className="mb-1 text-[11px] text-text-muted">{title}</h4>
        <p className="text-xs text-text-muted">데이터 없음</p>
      </div>
    );
  }

  return (
    <div className="min-w-0 flex-1 overflow-x-auto">
      <h4 className="mb-1 text-[11px] text-text-muted">{title} (단위: USD)</h4>
      <table className="w-full min-w-[280px] text-xs tabular-nums">
        <thead>
          <tr className="text-text-muted">
            <th className="py-1 pr-2 text-left font-normal">항목</th>
            {rows.map((row) => (
              <th key={row.period} className="py-1 pl-2 text-right font-normal">
                {row.period.slice(0, 7)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Object.entries(labels).map(([key, label]) => (
            <tr key={key} className="border-t border-border/60">
              <td className="py-1 pr-2 text-text-secondary">{label}</td>
              {rows.map((row) => {
                const value = row[key];
                return (
                  <td key={row.period} className="py-1 pl-2 text-right">
                    {typeof value === 'number' ? formatCompact(value) : '—'}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function FinancialStatements({ incomeStatement, balanceSheet }: Props) {
  return (
    <section>
      <h3 className="mb-1.5 text-xs font-medium text-text-secondary">재무제표 (연간)</h3>
      <div className="flex flex-col gap-3 sm:flex-row">
        <Table title="손익계산서" rows={incomeStatement} labels={INCOME_LABELS} />
        <Table title="재무상태표" rows={balanceSheet} labels={BALANCE_LABELS} />
      </div>
    </section>
  );
}
