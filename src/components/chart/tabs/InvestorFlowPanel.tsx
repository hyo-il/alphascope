import { useInvestorFlow } from '../../../hooks/useInvestorFlow';
import {
  FLOW_SIDE_LABEL,
  flowWindow,
  holdingSummary,
  type FlowRecord,
  type FlowSide,
  type FlowSideKey,
} from '../../../utils/investorFlow';

/**
 * 차트 하단 「투자자 동향」 탭 (v2.23.0) — 국내 종목만, 최근 20 확정 거래일.
 *
 * 요약(5일·20일 순매수) → 막대(날짜별 순매수) → 표(최신이 위) 순서다.
 * - ⚠️ **미국 종목은 요청하지 않는다**(토스 API 가 국내만 준다) — 안내만 보인다.
 * - ⚠️ 당일 행은 장중 **잠정치**다(개인·기타법인 없음). 표에 「잠정」 을 붙이고 합계·막대에는 넣지 않는다.
 * - 단위는 **주(거래량)** — 금액이 아니다. 해석(오른다/내린다)은 붙이지 않는다.
 * - 탭이 보일 때만 그려진다(`ChartBottomTabs` 의 active) — 이 컴포넌트가 마운트될 때만 부른다.
 */

/** 앱 공통색(상승 청록·하락 빨강·주의 주황·액센트 파랑)과 겹치지 않는 세 색 */
const SIDE_COLOR: Record<FlowSideKey, string> = {
  foreigner: '#9575cd',
  institution: '#c0ca33',
  individual: '#90a4ae',
};
const SIDES: FlowSideKey[] = ['foreigner', 'institution', 'individual'];

const signed = (n: number) => `${n > 0 ? '+' : ''}${Math.round(n).toLocaleString('ko-KR')}`;
const tone = (n: number) => (n > 0 ? 'text-bullish' : n < 0 ? 'text-bearish' : 'text-text-secondary');
const mmdd = (date: string) => date.slice(5);

function Net({ side }: { side: FlowSide | null }) {
  if (!side) return <span className="text-text-muted">—</span>;
  return <span className={tone(side.net)}>{signed(side.net)}</span>;
}

function Bars({ records }: { records: FlowRecord[] }) {
  // 왼쪽이 과거, 오른쪽이 최근
  const days = [...records].reverse();
  const max = Math.max(1, ...days.flatMap((r) => SIDES.map((s) => Math.abs(r[s]?.net ?? 0))));
  const W = 640;
  const H = 140;
  const mid = H / 2;
  const slot = W / days.length;
  const bar = Math.max(2, Math.min(8, (slot - 4) / 3));

  return (
    <svg viewBox={`0 0 ${W} ${H + 18}`} className="block h-auto w-full max-w-[720px]" role="img" aria-label="날짜별 투자자 순매수 막대">
      <line x1={0} x2={W} y1={mid} y2={mid} stroke="var(--color-border)" />
      {days.map((r, i) => {
        const x0 = i * slot + (slot - bar * 3) / 2;
        return (
          <g key={r.date}>
            {SIDES.map((side, k) => {
              const net = r[side]?.net ?? 0;
              const h = (Math.abs(net) / max) * (mid - 4);
              return (
                <rect
                  key={side}
                  x={x0 + k * bar}
                  y={net >= 0 ? mid - h : mid}
                  width={bar - 1}
                  height={Math.max(h, 0.5)}
                  fill={SIDE_COLOR[side]}
                >
                  <title>{`${r.date} ${FLOW_SIDE_LABEL[side]} ${signed(net)}주`}</title>
                </rect>
              );
            })}
            {(i % 5 === 0 || i === days.length - 1) && (
              <text x={i * slot + slot / 2} y={H + 13} textAnchor="middle" fontSize={13} fill="var(--color-text-muted)">
                {mmdd(r.date)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

export default function InvestorFlowPanel({ symbol }: { symbol: string }) {
  const { supported, flow, error } = useInvestorFlow(symbol);

  if (!supported) {
    return (
      <p className="p-3 text-[13px] text-text-muted">
        투자자 동향은 국내 종목만 제공됩니다(토스 API 제공 범위).
      </p>
    );
  }
  if (error) return <p className="p-3 text-[13px] text-bearish">투자자 동향을 불러오지 못했습니다: {error}</p>;
  if (!flow) return <p className="p-3 text-[13px] text-text-muted">불러오는 중…</p>;

  const confirmed = flowWindow(flow.records);
  const period = flow.period;
  const holding = holdingSummary(flow.records);

  return (
    <div className="space-y-3 p-3 text-[13px]">
      <div>
        <p className="mb-1 text-text-secondary">
          {period
            ? `확정 ${period.days}거래일: ${mmdd(period.from)} ~ ${mmdd(period.to)} · 순매수(주)`
            : '확정된 기록이 아직 없습니다.'}
          {flow.records[0]?.provisional && <span className="text-text-muted"> · 오늘 잠정치는 합계에서 뺐습니다</span>}
        </p>
        {/* 외국인 보유 비율 (v2.30.0) — 사실만. 막대(주 단위 순매수)와 섞지 않는다 */}
        {holding && (
          <p className="mb-1 text-text-secondary">
            외국인 보유 비율 <b className="text-text-primary">{holding.latest.toFixed(2)}%</b>
            <span className="text-text-muted"> ({mmdd(holding.latestDate)})</span>
            {holding.diffPp != null && (
              <>
                {' · '}
                {holding.baseDate ? `${mmdd(holding.baseDate)} 대비 ` : ''}
                <span className={tone(holding.diffPp)}>
                  {holding.diffPp > 0 ? '+' : ''}
                  {holding.diffPp.toFixed(2)}%p
                </span>
              </>
            )}
          </p>
        )}
        <table className="tabular-nums">
          <thead className="text-text-muted">
            <tr>
              <th className="pr-4 text-left font-normal" />
              <th className="pr-4 text-right font-normal">5일 합계</th>
              <th className="pr-4 text-right font-normal">{period?.days ?? 20}일 합계</th>
              <th className="text-right font-normal">순매수 일수</th>
            </tr>
          </thead>
          <tbody>
            {SIDES.map((side) => {
              const s = flow.sums[side];
              return (
                <tr key={side}>
                  <td className="pr-4">
                    <span className="mr-1 inline-block h-2 w-2 rounded-sm" style={{ background: SIDE_COLOR[side] }} />
                    {FLOW_SIDE_LABEL[side]}
                  </td>
                  <td className={`pr-4 text-right ${tone(s.d5)}`}>{signed(s.d5)}</td>
                  <td className={`pr-4 text-right ${tone(s.d20)}`}>{signed(s.d20)}</td>
                  <td className="text-right text-text-secondary">
                    {s.buyDays}/{s.days}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {confirmed.length > 0 && (
        <div>
          <Bars records={confirmed} />
          <div className="flex gap-3 text-text-muted">
            {SIDES.map((side) => (
              <span key={side} className="inline-flex items-center gap-1">
                <span className="inline-block h-2 w-2 rounded-sm" style={{ background: SIDE_COLOR[side] }} />
                {FLOW_SIDE_LABEL[side]}
              </span>
            ))}
            <span>· 가운데 선 위 = 순매수, 아래 = 순매도</span>
          </div>
        </div>
      )}

      <table className="w-full tabular-nums">
        <thead className="text-text-muted">
          <tr className="border-b border-border/50">
            <th className="py-1 text-left font-normal">날짜</th>
            <th className="text-right font-normal">외국인</th>
            <th className="text-right font-normal">기관</th>
            <th className="text-right font-normal">개인</th>
            <th className="text-right font-normal">기타법인</th>
            <th className="text-right font-normal">외국인 보유</th>
          </tr>
        </thead>
        <tbody>
          {flow.records.map((r) => (
            <tr key={r.date} className="border-b border-border/50">
              <td className="py-1 text-text-secondary">
                {r.date}
                {r.provisional && (
                  <span className="ml-1 rounded bg-warning/15 px-1 text-[13px] text-warning" title="장중 잠정치 — 개인·기타법인은 그날 저녁 확정치 때 채워집니다">
                    잠정
                  </span>
                )}
              </td>
              <td className="text-right"><Net side={r.foreigner} /></td>
              <td className="text-right"><Net side={r.institution} /></td>
              <td className="text-right"><Net side={r.individual} /></td>
              <td className="text-right"><Net side={r.otherCorporation} /></td>
              <td className="text-right text-text-secondary">
                {/* 잠정 행은 '—' — 확정치만 보인다 */}
                {r.provisional || !r.foreignerHolding ? '—' : `${(Math.round(r.foreignerHolding.rate * 10000) / 100).toFixed(2)}%`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <p className="text-text-muted">
        출처: 토스증권 Open API · 단위: 주(금액 아님) · 외국인 = 등록외국인 · 외국인 보유 비율 = 토스 투자자 동향의 외국인 보유 수량 ÷ 외국인 한도 수량 · 기준{' '}
        {flow.updatedAt ? new Date(flow.updatedAt).toLocaleString('ko-KR') : '—'}
      </p>
    </div>
  );
}
