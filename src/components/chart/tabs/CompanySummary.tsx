import { useState } from 'react';
import type { Candle } from '../../../types/toss';
import { useFundamentals, usePeers } from '../../../hooks/useCompany';
import { Skeleton, SkeletonCards } from '../../common/SkeletonLoader';
import FinancialStatements from '../../company/FinancialStatements';
import SectorComparison from '../../company/SectorComparison';
import { formatCompactMoney } from '../../../utils/formatters';
import { currencyOfSymbol, isKrSymbol } from '../../../utils/market';
import { industryKo, sectorKo } from '../../../data/sectors';
import StockName from '../../common/StockName';
import InfoTip from '../../ui/InfoTip';
import Tabs from '../../ui/Tabs';

/**
 * 차트 하단의 기업정보 요약.
 *
 * 예전 사이드 메뉴의 기업정보 화면은 지표 24개를 한 화면에 펼쳤다 — 좁은 하단 탭에서는
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

function Metric({ label, value, note, info }: { label: string; value: string; note?: string; info?: string }) {
  return (
    <div className="rounded-md bg-bg-tertiary/60 p-3">
      <dt className="flex items-center gap-1 text-caption text-text-muted">
        {label}
        {info && <InfoTip label={`${label} 설명`}>{info}</InfoTip>}
      </dt>
      <dd className="mt-1 text-sm font-medium tabular-nums break-keep">{value}</dd>
      {note && <p className="mt-0.5 text-caption text-text-muted">{note}</p>}
    </div>
  );
}

export default function CompanySummary({
  symbol,
  candles,
}: {
  symbol: string;
  candles: Candle[];
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
    <div className="shrink-0 px-1">
      <Tabs items={SUB_TABS} value={tab} onChange={setTab} size="sm" label="기업정보 하위 탭" />
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
          <p className="text-xs text-danger">기업 정보를 불러오지 못했습니다</p>
          <p className="mt-1 text-caption text-text-secondary">{error}</p>
        </div>
      </div>
    );
  }

  if (!data) return <div className="flex h-full flex-col">{header}</div>;

  const { profile, valuation, profitability, dividend } = data;
  const peerPer = median(peers.data?.map((p) => p.per) ?? []);
  const kr = isKrSymbol(symbol);
  /**
   * 국내 종목은 yfinance 가 PER·PBR·EPS 를 주지 않는다(2026-10-08 005930.KS·000660.KS 확인 — trailingPE·priceToBook·trailingEps·bookValue 가 모두 null).
   * 그래서 **같은 응답 안의 값으로 계산할 수 있을 때만** 화면에서 계산한다(시가총액 ÷ 최근 연간 순이익 = PER, 시가총액 ÷ 최근 자본총계 = PBR).
   * ⚠️ 화면 표시만이다 — 서버 fundamentals·분석 프롬프트 입력은 그대로(바꾸면 Gemini 버전이 갈라진다). 값을 지어내지 않는다.
   */
  const latestNet = data.incomeStatement.find((r) => typeof r['Net Income'] === 'number' && (r['Net Income'] as number) > 0);
  const latestEquity = data.balanceSheet.find((r) => typeof r['Stockholders Equity'] === 'number' && (r['Stockholders Equity'] as number) > 0);
  const calcPer = valuation.per == null && profile.marketCap && latestNet ? profile.marketCap / (latestNet['Net Income'] as number) : null;
  const calcPbr = valuation.pbr == null && profile.marketCap && latestEquity ? profile.marketCap / (latestEquity['Stockholders Equity'] as number) : null;
  const NO_VALUE = 'yfinance 가 이 종목 값을 주지 않습니다(국내 종목은 대개 비어 있다).';
  /** 52주 고/저 — 통화 규칙(원화 소수점 없음) */
  const px = (v: number) => (currencyOfSymbol(symbol) === 'KRW' ? Math.round(v).toLocaleString('ko-KR') : v.toFixed(2));

  return (
    <div className="flex h-full flex-col">
      {header}

      <div className="min-h-0 flex-1 overflow-auto p-3">
        {tab === 'basic' && (
          <div className="space-y-2">
            {kr ? (
              // 국내: 카탈로그 한글 이름 + 한글 업종(세부 업종은 한글 이름이 있을 때만 — 영어로 두지 않는다)
              <p className="flex flex-wrap items-baseline gap-x-2 text-xs">
                <StockName symbol={symbol} />
                <span className="text-text-secondary">
                  {profile.sector ? sectorKo(profile.sector) : '—'}
                  {industryKo(profile.industry) ? ` · ${industryKo(profile.industry)}` : ''}
                </span>
              </p>
            ) : (
              <p className="text-xs">
                <span className="font-medium">{profile.name ?? symbol}</span>
                <span className="ml-1.5 text-caption text-text-secondary">{symbol}</span>
                <span className="ml-2 text-text-secondary">
                  {profile.sector ?? '—'} · {profile.industry ?? '—'}
                </span>
              </p>
            )}

            <dl className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              <Metric
                label="PER"
                value={valuation.per != null ? fixed(valuation.per) : calcPer != null ? fixed(calcPer) : '—'}
                note={peerPer != null ? `업종 ${fixed(peerPer)}` : undefined}
                info={
                  valuation.per != null
                    ? undefined
                    : calcPer != null
                      ? `앱이 계산 — 시가총액 ÷ ${String(latestNet!.period).slice(0, 4)} 연간 순이익. yfinance 가 이 종목 PER 을 주지 않아서 같은 응답의 값으로 냈습니다(최근 12개월이 아니라 회계연도 기준).`
                      : NO_VALUE
                }
              />
              <Metric
                label="PBR"
                value={valuation.pbr != null ? fixed(valuation.pbr) : calcPbr != null ? fixed(calcPbr) : '—'}
                info={
                  valuation.pbr != null
                    ? undefined
                    : calcPbr != null
                      ? `앱이 계산 — 시가총액 ÷ ${String(latestEquity!.period).slice(0, 4)} 자본총계. yfinance 가 이 종목 PBR 을 주지 않아서 같은 응답의 값으로 냈습니다.`
                      : NO_VALUE
                }
              />
              <Metric label="EPS" value={fixed(valuation.eps)} info={valuation.eps == null ? `${NO_VALUE} 발행주식 수가 응답에 없어 계산하지 않습니다.` : undefined} />
              <Metric label="시가총액" value={formatCompactMoney(profile.marketCap, profile.currency)} />
            </dl>

            <dl className="grid grid-cols-2 gap-2 lg:grid-cols-4">
              <Metric
                label="52주 고 / 저"
                value={high52 == null ? '—' : `${px(high52)} / ${px(low52!)}`}
              />
              {/* 정의는 분기 손익계산서로 확인했다(2026-10-08, AAPL·005930.KS): revenueGrowth = 최근 분기 ÷ 1년 전 같은 분기 − 1 (일치), operatingMargins = **최근 분기** 영업이익 ÷ 매출 (일치 — 최근 12개월 합계와는 다르다) */}
              <Metric
                label="영업이익률 (최근 분기)"
                value={ratio(profitability.operatingMargin)}
                info="yfinance operatingMargins — 가장 최근 분기의 영업이익 ÷ 매출(분기 손익계산서와 같은 값으로 확인)."
              />
              <Metric
                label="매출 성장률 (최근 분기, 전년 같은 분기 대비)"
                value={ratio(profitability.revenueGrowth)}
                info="yfinance revenueGrowth — 가장 최근 분기 매출을 1년 전 같은 분기와 비교한 값(분기 손익계산서와 같은 값으로 확인)."
              />
              <Metric
                label="배당수익률"
                value={
                  // ⚠️ 배당수익률만 이미 퍼센트 단위다 (0.35 = 0.35%).
                  dividend.yield == null ? '—' : `${dividend.yield.toFixed(2)}%`
                }
              />
            </dl>

            <p className="text-caption text-text-muted">
              데이터: yfinance · 하루 한 번 갱신.
            </p>
          </div>
        )}

        {tab === 'statements' && (
          <FinancialStatements
            incomeStatement={data.incomeStatement}
            balanceSheet={data.balanceSheet}
            currency={profile.currency}
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
