import type { ReactNode } from 'react';
import WarnIcon from '../ui/WarnIcon';
import { changeColor, formatNumber, formatPercent, formatSigned } from '../../utils/formatters';
import { ASSET_LABEL, isIntradayBar, vixZone } from '../../utils/marketBrief';
import type { BriefAsset, BriefAssetKey, MarketBrief } from '../../types/marketBrief';
import { BriefCard } from './BriefCard';
import { dayLabel } from './briefText';

/** ⑤ 시장 데이터(참고) — AI 와 상관없이 늘 보인다(수집한 값 그대로) */
export default function MarketDataCard({ brief }: { brief: MarketBrief }) {
  return (
    <BriefCard id="market" title="시장 데이터" aside="참고">
      <MarketData brief={brief} />
    </BriefCard>
  );
}

const prevOf = (a: BriefAsset) => a.current - a.change;
/**
 * 바뀐 만큼 — 부호 숫자(▲▼ 대신 · 디자인 규칙 「시황 등락은 +/− 부호」). 주식 지수가 아닌 값(금리 · 달러 · 금 · 에너지 · 환율 · VIX)은
 * 오르내림이 좋고 나쁨과 상관없어 색을 칠하지 않는다(VIX 가 오르면 초록으로 보이던 것).
 */
const Move = ({ value, digits, suffix = '' }: { value: number; digits: number; suffix?: string }) => (
  <span className="text-text-secondary">({formatSigned(value, digits, suffix)})</span>
);

/**
 * 묶음 — 상자 없이 제목 + 줄(카드 안에 상자를 두지 않는다). index: 지수 = 종가/장중 · 그 밖 = 기준.
 * 줄은 칸(이름 | 앞 값 | → | 뒤 값 | 바뀐 만큼)으로 나눠 묶음 안에서 세로로 맞춘다 — 한 덩어리로 오른쪽 맞춤하면 자릿수가 다른 줄마다 화살표가 어긋났다.
 */
function Group({ title, date, intraday = false, index = false, children }: { title: string; date?: string | null; intraday?: boolean; index?: boolean; children: ReactNode }) {
  return (
    <div className="space-y-1" data-brief-group={title}>
      <div className="flex items-baseline justify-between gap-2 border-b border-border/60 pb-1 text-caption">
        <span className="font-medium text-text-secondary">{title}</span>
        {/* 정규장 중에 받은 지수는 끝나지 않은 봉 — 「종가」 라 적지 않는다. 선물 · 환율 · 금리는 거의 하루 내내 움직여 「기준」 */}
        {date && (
          <span className={`tabular-nums ${intraday ? 'text-warning' : 'text-text-muted'}`}>
            {dayLabel(date)} {!index ? '기준' : intraday ? '장중(마감 전)' : '종가'}
          </span>
        )}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto_auto] items-baseline gap-x-1.5 gap-y-1 text-xs tabular-nums">{children}</div>
    </div>
  );
}

/** 한 줄 = 다섯 칸(묶음 grid 의 열) */
function Row({ label, first, second, move }: { label: string; first: ReactNode; second: ReactNode; move?: ReactNode }) {
  return (
    <>
      <span className="min-w-0 truncate text-text-secondary" title={label}>
        {label}
      </span>
      <span className="text-right">{first}</span>
      <span className="text-text-muted">→</span>
      <span className="text-right text-text-primary">{second}</span>
      <span className="text-right">{move}</span>
    </>
  );
}

/** 지수 — 원본처럼 「등락률% → 현재값」 */
function IndexRow({ label, a }: { label: string; a?: BriefAsset }) {
  if (!a) return null;
  return <Row label={label} first={<span className={changeColor(a.change_pct)}>{formatPercent(a.change_pct)}</span>} second={formatNumber(a.current, 2)} />;
}

/** 금리 · 달러 · 금 · 에너지 · 환율 · VIX — 원본처럼 「전일 → 현재」 + 바뀐 만큼(금리는 %p). 묶음 날짜와 다르면 줄에 날짜 */
function MoveRow({
  label,
  a,
  digits,
  suffix = '',
  moveSuffix,
  groupDate,
  pct = false,
}: {
  label: string;
  a?: BriefAsset;
  digits: number;
  suffix?: string;
  moveSuffix?: string;
  groupDate?: string | null;
  /** 바뀐 만큼을 등락률로(원/달러 — 원본과 같음) */
  pct?: boolean;
}) {
  if (!a) return null;
  const ownDate = a.data_date && groupDate && a.data_date !== groupDate ? ` · ${dayLabel(a.data_date)}` : '';
  return (
    <Row
      label={`${label}${ownDate}`}
      first={<span className="text-text-primary">{formatNumber(prevOf(a), digits, suffix)}</span>}
      second={formatNumber(a.current, digits, suffix)}
      move={pct ? <Move value={a.change_pct} digits={2} suffix="%" /> : <Move value={a.change} digits={digits} suffix={moveSuffix ?? suffix} />}
    />
  );
}

function MarketData({ brief }: { brief: MarketBrief }) {
  const a = brief.data.assets;
  const at = Date.parse(brief.data.collectedAt ?? brief.createdAt);
  const live = (k: BriefAssetKey) => isIntradayBar(k, a[k]?.data_date ?? null, at);
  const missing = (keys: BriefAssetKey[]) => keys.filter((k) => !a[k]).map((k) => ASSET_LABEL[k]);
  if (brief.edition === 'afternoon') {
    const lost = missing(['KOSPI', 'KOSDAQ', 'VIX']);
    return (
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-x-6 gap-y-4">
          <Group title="국내 지수" date={a.KOSPI?.data_date} intraday={live('KOSPI')} index>
            <IndexRow label="코스피" a={a.KOSPI} />
            <IndexRow label="코스닥" a={a.KOSDAQ} />
          </Group>
          <Group title="공포지수(미국)" date={a.VIX?.data_date} intraday={live('VIX')} index>
            {a.VIX && <MoveRow label={`VIX (${vixZone(a.VIX.current)} 구간)`} a={a.VIX} digits={2} />}
          </Group>
        </div>
        <Missing names={lost} />
      </div>
    );
  }
  const lost = missing(['SP500', 'NASDAQ', 'DOW', 'RUSSELL2000', 'US2Y', 'US10Y', 'DXY', 'GOLD', 'WTI', 'NATGAS', 'USDKRW', 'KOSPI', 'KOSDAQ']);
  const rateDate = a.US10Y?.data_date ?? a.US2Y?.data_date;
  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-x-6 gap-y-4">
        <Group title="미국 증시" date={a.SP500?.data_date} intraday={live('SP500')} index>
          <IndexRow label="S&P500" a={a.SP500} />
          <IndexRow label="나스닥" a={a.NASDAQ} />
          <IndexRow label="다우" a={a.DOW} />
          <IndexRow label="러셀2000" a={a.RUSSELL2000} />
        </Group>
        <Group title="미국 국채 수익률" date={rateDate}>
          <MoveRow label="2년" a={a.US2Y} digits={3} suffix="%" moveSuffix="%p" groupDate={rateDate} />
          <MoveRow label="10년" a={a.US10Y} digits={3} suffix="%" moveSuffix="%p" groupDate={rateDate} />
        </Group>
        <Group title="달러 인덱스" date={a.DXY?.data_date}>
          <MoveRow label="DXY" a={a.DXY} digits={3} />
        </Group>
        <Group title="골드(달러/온스)" date={a.GOLD?.data_date}>
          <MoveRow label="금" a={a.GOLD} digits={2} />
        </Group>
        {/* 원본 소수 자릿수(WTI 2 · 천연가스 3)를 지키려고 묶음을 나눈다 — 같은 열은 자릿수가 같아야 한다 */}
        <Group title="원유(달러/배럴)" date={a.WTI?.data_date}>
          <MoveRow label="WTI" a={a.WTI} digits={2} />
        </Group>
        <Group title="천연가스(달러/MMBtu)" date={a.NATGAS?.data_date}>
          <MoveRow label="천연가스" a={a.NATGAS} digits={3} />
        </Group>
        <Group title="원/달러(원)" date={a.USDKRW?.data_date}>
          <MoveRow label="환율" a={a.USDKRW} digits={2} pct />
        </Group>
        <Group title="국내 지수" date={a.KOSPI?.data_date} intraday={live('KOSPI')} index>
          <IndexRow label="코스피" a={a.KOSPI} />
          <IndexRow label="코스닥" a={a.KOSDAQ} />
        </Group>
      </div>
      <Missing names={lost} />
    </div>
  );
}

function Missing({ names }: { names: string[] }) {
  if (!names.length) return null;
  return (
    <p className="text-caption text-warning">
      <WarnIcon />
      받지 못한 값: {names.join(' · ')}
    </p>
  );
}
