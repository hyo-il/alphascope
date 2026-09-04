import { Skeleton, SkeletonCards, SkeletonText } from '../common/SkeletonLoader';
import FinancialStatements from './FinancialStatements';
import SectorComparison from './SectorComparison';
import { useFundamentals, usePeers } from '../../hooks/useCompany';
import { formatCompact, formatCompactMoney } from '../../utils/formatters';

interface Props {
  symbol: string;
}

/** 소수 비율(0.2762) → '27.62%' */
function ratio(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? '—' : `${(value * 100).toFixed(2)}%`;
}

/** 이미 퍼센트 단위인 값 → '0.35%' */
function percent(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? '—' : `${value.toFixed(2)}%`;
}

function fixed(value: number | null | undefined, digits = 2): string {
  return value == null || !Number.isFinite(value) ? '—' : value.toFixed(digits);
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md bg-bg-tertiary/60 px-3 py-2">
      <dt className="text-[11px] text-text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium tabular-nums">{value}</dd>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 text-xs font-medium text-text-secondary">{title}</h3>
      <dl className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">{children}</dl>
    </section>
  );
}

export default function CompanyInfo({ symbol }: Props) {
  const { data, loading, error } = useFundamentals(symbol, true);
  // 기업 정보를 먼저 받은 뒤에 동종업계를 부른다 (섹터를 알아야 비교 대상이 정해진다).
  const peers = usePeers(symbol, Boolean(data));

  if (loading) {
    // yfinance 는 종목당 1~3초 걸린다. 그동안 빈 화면 대신 실제 배치를 그려 둔다.
    return (
      <div className="space-y-4 p-4">
        <div className="space-y-2">
          <Skeleton className="h-5 w-48" />
          <SkeletonText lines={2} className="max-w-2xl" />
        </div>
        <SkeletonCards count={6} className="grid-cols-2 md:grid-cols-3" />
        <Skeleton className="h-40 w-full rounded-lg" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4">
        <p className="text-sm text-bearish">기업 정보를 불러오지 못했습니다</p>
        <p className="mt-1 text-xs text-text-secondary">{error}</p>
      </div>
    );
  }

  if (!data) return null;

  const { profile, valuation, profitability, stability, dividend } = data;

  return (
    <div className="h-full overflow-y-auto p-4">
      <header className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="text-base font-semibold">{profile.name ?? symbol}</h2>
        <span className="text-xs text-text-secondary">
          {profile.sector ?? '—'} · {profile.industry ?? '—'}
        </span>
        <span className="text-xs text-text-muted">
          시가총액 {formatCompactMoney(profile.marketCap, profile.currency)}
          {profile.employees ? ` · 임직원 ${formatCompact(profile.employees)}명` : ''}
        </span>
      </header>

      <div className="space-y-3">
        <Section title="밸류에이션">
          <Metric label="PER" value={fixed(valuation.per)} />
          <Metric label="선행 PER" value={fixed(valuation.forwardPer)} />
          <Metric label="PBR" value={fixed(valuation.pbr)} />
          <Metric label="EPS" value={fixed(valuation.eps)} />
          <Metric label="PEG" value={fixed(valuation.peg)} />
          <Metric label="PSR" value={fixed(valuation.priceToSales)} />
          <Metric label="EV/EBITDA" value={fixed(valuation.evToEbitda)} />
          <Metric label="선행 EPS" value={fixed(valuation.forwardEps)} />
        </Section>

        <Section title="수익성 · 성장성">
          <Metric label="매출" value={formatCompactMoney(profitability.revenue, profile.currency)} />
          <Metric label="매출 성장률" value={ratio(profitability.revenueGrowth)} />
          <Metric label="이익 성장률" value={ratio(profitability.earningsGrowth)} />
          <Metric label="영업이익률" value={ratio(profitability.operatingMargin)} />
          <Metric label="순이익률" value={ratio(profitability.profitMargin)} />
          <Metric label="매출총이익률" value={ratio(profitability.grossMargin)} />
          <Metric label="ROE" value={ratio(profitability.roe)} />
          <Metric label="ROA" value={ratio(profitability.roa)} />
        </Section>

        <Section title="재무 안정성 · 배당">
          <Metric label="부채비율" value={fixed(stability.debtToEquity)} />
          <Metric label="유동비율" value={fixed(stability.currentRatio)} />
          <Metric label="당좌비율" value={fixed(stability.quickRatio)} />
          <Metric label="잉여현금흐름" value={formatCompactMoney(stability.freeCashflow, profile.currency)} />
          <Metric label="배당수익률" value={percent(dividend.yield)} />
          <Metric label="주당 배당금" value={fixed(dividend.rate)} />
          <Metric label="배당성향" value={ratio(dividend.payoutRatio)} />
          <Metric label="보유 현금" value={formatCompactMoney(stability.totalCash, profile.currency)} />
        </Section>

        <FinancialStatements
          incomeStatement={data.incomeStatement}
          balanceSheet={data.balanceSheet}
          currency={profile.currency}
        />

        <SectorComparison
          symbol={symbol}
          sector={profile.sector}
          peers={peers.data}
          loading={peers.loading}
          error={peers.error}
        />
      </div>

      <p className="mt-3 text-[11px] text-text-muted">
        데이터: yfinance · 하루 한 번 갱신 · 투자 조언이 아닙니다.
      </p>
    </div>
  );
}
