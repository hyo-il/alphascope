import { TriangleAlert } from 'lucide-react';
import { Badge, ICON_SM, InfoTip } from '../ui';
import SymbolChartLink from '../common/SymbolChartLink';
import UsDateTag from '../common/UsDateTag';
import { kstClockText } from '../../utils/marketDate';
import { scheduleItemMarket } from '../../utils/marketBrief';
import type { BriefAi, BriefEarning, BriefScheduleItem, MarketBrief } from '../../types/marketBrief';
import { BriefCard } from './BriefCard';
import { clean, dayLabel } from './briefText';

/** 용어집 「발표됨」 — 오늘 시황 ② 일정의 미국 D+0 · 장 마감 뒤 */
const RELEASED_LABEL = '발표됨';
/** AI 없이 만든 브리핑의 ② — 묶음마다 이만큼만 보이고 나머지는 수로 */
const RAW_SCHEDULE_MAX = 8;
/** AI 일정 날짜 「11/02(월)」 → 「11-02(월)」(화면 표기 — 문장 속 날짜는 AI 글 그대로) */
const slotDate = (label: string) => label.slice(0, 9).replace(/^(\d{1,2})\/(\d{1,2})/, (_, m: string, d: string) => `${m.padStart(2, '0')}-${d.padStart(2, '0')}`);

/** ② 향후 60일 주요 일정 — AI 가 고른 일정, AI 가 없으면 수집한 실적 일정 그대로 */
export default function ScheduleCard({ brief, onOpen }: { brief: MarketBrief; onOpen: (symbol: string) => void }) {
  const ai = brief.brief;
  return (
    <BriefCard
      id="schedule"
      title="향후 60일 주요 일정"
      aside={ai ? '주도 섹터의 실적 · 경제지표' : '수집한 실적 일정(AI 거르기 없음)'}
      info="실적 발표일은 앱의 실적 일정(시총 상위 · 관심 · 자동매매 종목)에서, 예상 EPS · 매출 · 컨센서스는 yfinance 에서 가져옵니다. 이번 주는 섹터마다 3개 · 모두 6개, 이번 달은 3개 · 5개, 다음 한 달은 2개 · 5개까지 보입니다. 국내 종목은 섹터와 상관없이 남깁니다. 읽는 법: 예상 EPS = 주당순이익 예상치 · 직전 = 직전 분기 실제 · YoY = 1년 전 같은 분기 실제 · ±% = 애널리스트 예상이 갈린 정도 · 컨센서스 Buy(39/44) = 애널리스트 44명 중 39명이 매수 의견(앱의 판단이 아님) · B = 10억 달러."
    >
      {ai ? <ScheduleBody schedule={ai.upcoming_schedule} earnings={brief.data.earnings} onOpen={onOpen} /> : <RawSchedule earnings={brief.data.earnings} onOpen={onOpen} />}
    </BriefCard>
  );
}

const GROUPS = [
  { key: 'this_week', label: '이번 주', range: '7일 안', badge: '매우 중요' },
  { key: 'this_month', label: '이번 달', range: '8~30일 안', badge: '중요' },
  { key: 'next_2_months', label: '다음 한 달', range: '31~60일 안', badge: null },
] as const;

const SANITY_TIP =
  '예상 EPS 가 직전 분기 실제의 2.5배를 넘거나 0.4배에 못 미치거나, 애널리스트 추정치가 크게 갈립니다(분산 50% 초과). 추정치가 부정확할 수 있습니다.';

function ScheduleBody({ schedule, earnings, onOpen }: { schedule: BriefAi['upcoming_schedule']; earnings: BriefEarning[]; onOpen: (symbol: string) => void }) {
  const bySymbol = new Map(earnings.map((e) => [e.symbol.toUpperCase(), e]));
  const total = GROUPS.reduce((n, g) => n + schedule[g.key].length, 0);
  if (!total) return <p className="text-xs text-text-muted">60일 안에 주도 섹터의 실적 · 주요 경제지표 일정이 없습니다.</p>;
  return (
    <div className="space-y-3">
      {GROUPS.map((g) =>
        schedule[g.key].length ? (
          <div key={g.key} className="space-y-1.5" data-brief-slot={g.key}>
            <div className="flex items-center gap-2 text-caption text-text-muted">
              <span className="font-medium text-text-secondary">{g.label}</span>
              <span>{g.range}</span>
              {g.badge && <Badge tone="warning">{g.badge}</Badge>}
            </div>
            <ul className="space-y-2">
              {schedule[g.key].map((item, i) => (
                <ScheduleRow key={i} item={item} earning={item.ticker ? bySymbol.get(item.ticker.toUpperCase().replace(/\.(KS|KQ)$/, '')) : undefined} onOpen={onOpen} />
              ))}
            </ul>
          </div>
        ) : null,
      )}
    </div>
  );
}

/** 「발표됨」 배지 — 기존 배지 모양(`Badge`) · 키보드로도 열리는 툴팁(`InfoTip` trigger). 마감 시각은 한국 시간으로 */
function ReleasedTag({ closeAt }: { closeAt?: string }) {
  const ms = closeAt ? Date.parse(closeAt) : NaN;
  const at = Number.isFinite(ms) ? kstClockText(ms).slice(0, 5) : null;
  return (
    <InfoTip label={RELEASED_LABEL} trigger={<Badge>{RELEASED_LABEL}</Badge>}>
      미국 장 마감{at ? `(한국 ${at})` : ''} 뒤라 이미 발표됐을 수 있습니다 — 결과는 뉴스 · 차트로 확인하세요.
    </InfoTip>
  );
}

function ScheduleRow({ item, earning, onOpen }: { item: BriefScheduleItem; earning?: BriefEarning; onOpen: (symbol: string) => void }) {
  const flagged = earning?.epsSanityFlag || /신뢰도 주의|⚠/.test(item.detail);
  const detail = clean(item.detail.replace(/,?\s*신뢰도 주의\s*$/, ''));
  const symbol = earning?.symbol ?? (item.ticker ? item.ticker.toUpperCase().replace(/\.(KS|KQ)$/, '') : null);
  // 날짜는 그 시장 날짜 — 서버 뒤처리와 같은 판정(`scheduleItemMarket`)으로 미국 일정에만 「미국 날짜」
  const usDate = scheduleItemMarket({ ticker: symbol ?? item.ticker, event: item.event }) === 'US';
  return (
    <li className="flex gap-2 text-xs">
      <span className="flex w-20 shrink-0 flex-col items-start gap-0.5 tabular-nums text-text-secondary">
        {slotDate(item.date)}
        {/* 「발표됨」 — 만들 때 그 날 미국 장 마감이 지났다(서버가 정해 저장). 흐리게 하지 않는다(어젯밤 발표도 정보) */}
        {item.released && <ReleasedTag closeAt={item.usCloseAt} />}
        {usDate && <UsDateTag />}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-medium text-text-primary">{clean(item.event)}</span>
          {/* 회사 이름은 event(「마이크론 실적 발표」)에 이미 있다 — 링크는 티커만(이름 = 티커로 주면 StockName 이 티커만 적는다) */}
          {symbol && <SymbolChartLink symbol={symbol} name={symbol} onOpen={onOpen} className="text-caption" />}
          {item.sector_kr && <Badge>{item.sector_kr}</Badge>}
          {flagged && (
            <span className="inline-flex items-center gap-1 text-caption text-warning">
              <TriangleAlert {...ICON_SM} />
              신뢰도 주의
              <InfoTip label="신뢰도 주의">{SANITY_TIP}</InfoTip>
            </span>
          )}
        </div>
        {detail && <p className="mt-0.5 break-keep text-caption text-text-secondary tabular-nums">{detail}</p>}
      </div>
    </li>
  );
}

/** AI 없이 만든 브리핑 — 수집한 실적 일정을 같은 세 묶음으로(묶음마다 앞 8개) */
function RawSchedule({ earnings, onOpen }: { earnings: BriefEarning[]; onOpen: (symbol: string) => void }) {
  if (!earnings.length) return <p className="text-xs text-text-muted">60일 안 실적 일정을 받지 못했습니다(수집 상태를 보세요).</p>;
  const groups = [
    { label: '이번 주', range: '7일 안', items: earnings.filter((e) => e.daysUntil <= 7) },
    { label: '이번 달', range: '8~30일 안', items: earnings.filter((e) => e.daysUntil >= 8 && e.daysUntil <= 30) },
    { label: '다음 한 달', range: '31~60일 안', items: earnings.filter((e) => e.daysUntil >= 31 && e.daysUntil <= 60) },
  ].map((g) => ({ ...g, items: [...g.items].sort((a, b) => a.daysUntil - b.daysUntil) }));
  return (
    <div className="space-y-3">
      {groups.map((g) =>
        g.items.length ? (
          <div key={g.label} className="space-y-1.5">
            <div className="flex items-center gap-2 text-caption text-text-muted">
              <span className="font-medium text-text-secondary">{g.label}</span>
              <span>{g.range}</span>
              <span className="tabular-nums">· {g.items.length}종목</span>
            </div>
            <ul className="space-y-2">
              {g.items.slice(0, RAW_SCHEDULE_MAX).map((e) => (
                <ScheduleRow
                  key={e.symbol}
                  item={{ date: `${e.date.slice(5, 7)}/${e.date.slice(8, 10)}${dayLabel(e.date).slice(5)}`, event: `${e.name} 실적 발표${e.isEstimateDate ? '(날짜 미확정)' : ''}`, ticker: e.symbol, sector_kr: e.sector, detail: rawDetail(e), importance: 0, released: e.released, usCloseAt: e.usCloseAt }}
                  earning={e}
                  onOpen={onOpen}
                />
              ))}
            </ul>
            {g.items.length > RAW_SCHEDULE_MAX && (
              <p className="text-caption text-text-muted">외 {g.items.length - RAW_SCHEDULE_MAX}종목 — 전체 실적 일정은 「증시 일정」 화면에서 봅니다</p>
            )}
          </div>
        ) : null,
      )}
    </div>
  );
}

/** 원본 압축형 detail 과 같은 모양 */
function rawDetail(e: BriefEarning): string {
  if (!e.estimatesOk) return '전망치를 받지 못했습니다';
  const disp = e.epsDispersion !== '-' ? `, ${e.epsDispersion.replace('분산 ', '')}` : '';
  const rev = e.revenueEstimate !== '-' ? ` | 매출 ${e.revenueEstimate}` : '';
  return `예상 EPS ${e.epsEstimate} (직전 ${e.lastQuarterEps}, YoY ${e.yoyEps}${disp}) | 컨센서스 ${e.recommendation.replace(' (', '(')}${rev}`;
}
