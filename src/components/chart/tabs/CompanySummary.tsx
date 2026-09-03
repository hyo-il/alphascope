import { useState } from 'react';
import type { Candle } from '../../../types/toss';
import { useFundamentals, usePeers } from '../../../hooks/useCompany';
import { Skeleton, SkeletonCards } from '../../common/SkeletonLoader';
import FinancialStatements from '../../company/FinancialStatements';
import SectorComparison from '../../company/SectorComparison';
import { formatCompact } from '../../../utils/formatters';

/**
 * 차트 하단의 기업정보 요약.
 *
 * 사이드 메뉴의 `CompanyInfo` 는 지표 24개를 한 화면에 펼친다 — 좁은 하단 탭에서는
 * 스크롤만 길어진다. 여기서는 **매매 판단에 바로 쓰는 값**만 남기고, 재무제표·동종업계는
 * 같은 컴포넌트를 서브탭으로 재사용한다. 서버 캐시(24시간)를 그대로 타므로
 * 전체 화면을 오가도 다시 부르지 않는다.
 */

type SubTab = 'basic' | 'statements' | 'peers';

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: 'basic', label: '기본정보' },
  { id: 'statements', label: '재무제표' },
  { id: 'peers', label: '동종업계' },
];

function ratio(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? '—' : `${(value * 100).toFixed(2)}%`;
}

function fixed(value: number | null | undefined, digits = 2): string {
  return value == null || !Number.isFinite(value) ? '—' : value.toFixed(digits);
}

/** 업종 중앙값 — 이상치에 덜 흔들리도록 평균 대신 중앙값을 쓴다 (SectorComparison 과 같은 방침) */
function median(values: (number | null)[]): number | null {
  const sorted = values.filter((v): v is number => v != null && Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function Metric({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="rounded-md bg-bg-tertiary/60 px-2.5 py-1.5">
      <dt className="text-[10px] text-text-muted">{label}</dt>
      <dd className="mt-0.5 text-sm font-medium tabular-nums">{value}</dd>
      {note && <p className="text-[10px] text-text-muted">{note}</p>}
    </div>
  );
}

export default function CompanySummary({
  symbol,
  candles,
  onOpenFullView,
}: {
  symbol: string;
  candles: Candle[];
  onOpenFullView: () => void;
}) {
  const [tab, setTab] = useState<SubTab>('basic');
  const { data, loading, error } = useFundamentals(symbol, true);
  // 기업 정보를 받은 뒤에 동종업계를 부른다 (섹터를 알아야 비교 대상이 정해진다).
  const peers = usePeers(symbol, tab === 'peers' && Boolean(data));

  // 52주 고저는 이미 받아 둔 캔들에서 낸다 — 이 값 때문에 따로 조회하지 않는다.
  const window = candles.slice(-252);
  const high52 = window.length ? Math.max(...window.map((c) => c.high)) : null;
  const low52 = window.length ? Math.min(...window.map((c) => c.low)) : null;

  const header = (
    <div className="flex shrink-0 items-center gap-1 border-b border-border/60 px-1">
      {SUB_TABS.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => setTab(item.id)}
          className={`px-2.5 py-1 text-[11px] transition-colors ${
            tab === item.id ? 'text-accent' : 'text-text-secondary hover:text-text-primary'
          }`}
        >
          {item.label}
        </button>
      ))}
      <button
        type="button"
        onClick={onOpenFullView}
        className="ml-auto px-2 py-1 text-[11px] text-text-muted transition-colors hover:text-accent"
      >
        전체 화면으로 ↗
      </button>
    </div>
  );

  if (loading) {
    return (
      <div className="flex h-full flex-col">
        {header}
        <div className="space-y-2 p-3">
          <Skeleton className="h-4 w-56" />
          <SkeletonCards count={4} className="grid-cols-2 md:grid-cols-4" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col">
        {header}
        <div className="p-3">
          <p className="text-xs text-bearish">기업 정보를 불러오지 못했습니다</p>
          <p className="mt-1 text-[11px] text-text-secondary">{error}</p>
        </div>
      </div>
    );
  }

  if (!data) return <div className="flex h-full flex-col">{header}</div>;

  const { profile, valuation, profitability, dividend } = data;
  const peerPer = median(peers.data?.map((p) => p.per) ?? []);

  return (
    <div className="flex h-full flex-col">
      {header}

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {tab === 'basic' && (
          <div className="space-y-2">
            <p className="text-xs">
              <span className="font-medium">{profile.name ?? symbol}</span>
              <span className="ml-2 text-text-secondary">
                {profile.sector ?? '—'} · {profile.industry ?? '—'}
              </span>
            </p>

            <dl className="grid grid-cols-2 gap-1.5 md:grid-cols-4">
              <Metric
                label="PER"
                value={fixed(valuation.per)}
                note={peerPer != null ? `업종 ${fixed(peerPer)}` : undefined}
              />
              <Metric label="PBR" value={fixed(valuation.pbr)} />
              <Metric label="EPS" value={fixed(valuation.eps)} />
              <Metric label="시가총액" value={`$${formatCompact(profile.marketCap)}`} />
            </dl>

            <dl className="grid grid-cols-2 gap-1.5 md:grid-cols-4">
              <Metric
                label="52주 고 / 저"
                value={
                  high52 == null ? '—' : `${high52.toFixed(2)} / ${low52!.toFixed(2)}`
                }
              />
              <Metric label="영업이익률" value={ratio(profitability.operatingMargin)} />
              <Metric label="매출 성장률" value={ratio(profitability.revenueGrowth)} />
              <Metric
                label="배당수익률"
                value={
                  // ⚠️ 배당수익률만 이미 퍼센트 단위다 (0.35 = 0.35%).
                  dividend.yield == null ? '—' : `${dividend.yield.toFixed(2)}%`
                }
              />
            </dl>

            <p className="text-[11px] text-text-muted">
              데이터: yfinance · 하루 한 번 갱신. 더 많은 지표는 [전체 화면으로] 에서 봅니다.
            </p>
          </div>
        )}

        {tab === 'statements' && (
          <FinancialStatements
            incomeStatement={data.incomeStatement}
            balanceSheet={data.balanceSheet}
          />
        )}

        {tab === 'peers' && (
          <SectorComparison
            symbol={symbol}
            sector={profile.sector}
            peers={peers.data}
            loading={peers.loading}
            error={peers.error}
          />
        )}
      </div>
    </div>
  );
}
