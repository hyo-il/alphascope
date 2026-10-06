import { useId, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import StockName from '../common/StockName';
import { Panel, SectionTitle } from '../ui';
import { ICON_SM } from '../ui/icon';
import { VERDICT_ICON } from '../ui/statusIcons';
import { RULE_CHOICES } from '../../types/ruleChoices';
import { BACKTEST_SECTORS, type BacktestMethodResult, type BacktestReport, type BacktestVerdictKind } from '../../types/backtest';

/**
 * 「미리 정한 시험」(v2.37.0 고정 3년 시험, `npm run research:rule`) 결과 — **읽기 전용** (v2.38.0 에 실행 화면에서 떼어 냈다).
 * 판정 배지는 그 기록에 저장된 그대로 보인다(그때의 사전 등록 결과다). 계좌에 적용하는 버튼은 두지 않는다 — 사용자 시험에서 한다.
 */
const VERDICT: Record<BacktestVerdictKind, { label: string; badge: string }> = {
  good: { label: '기준선보다 좋음', badge: 'bg-bullish/15 text-bullish' },
  bad: { label: '기준선 이하', badge: 'bg-bearish/15 text-bearish' },
  hold: { label: '판단 보류', badge: 'bg-bg-tertiary text-text-secondary' },
};

const pct = (v: number | null | undefined) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`);
const pp = (v: number | null | undefined) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%p`);
const tone = (v: number | null | undefined, plain = false) => (plain || v == null ? '' : v > 0 ? 'text-bullish' : v < 0 ? 'text-bearish' : '');

function VerdictBadge({ verdict, why }: { verdict: BacktestVerdictKind; why: string }) {
  const id = useId();
  const Icon = VERDICT_ICON[verdict];
  return (
    <>
      {/* 마우스를 올리거나 키보드로 포커스하면 비교식 — 판정과 같은 값에서 만든 문장(진단 리포트와 같은 방식) */}
      <span
        tabIndex={0}
        title={why}
        aria-describedby={id}
        className={`inline-flex shrink-0 cursor-help items-center gap-1 rounded px-1.5 py-0.5 text-[13px] ${VERDICT[verdict].badge}`}
      >
        <Icon {...ICON_SM} /> {VERDICT[verdict].label}
      </span>
      <span id={id} className="sr-only">
        {why}
      </span>
    </>
  );
}

function MethodBlock({ m }: { m: BacktestMethodResult }) {
  const plain = m.verdict === 'hold';
  const choice = RULE_CHOICES.find((c) => c.id === m.id);
  return (
    <Panel pad="sm" className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <h4 className="text-sm font-semibold text-text-primary">{m.title}</h4>
        <VerdictBadge verdict={m.verdict} why={m.why} />
        <span className="min-w-0 text-[13px] text-text-muted">
          {choice ? `산다: ${choice.buy} · 판다: ${choice.sell}` : ''}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px] tabular-nums">
          <thead className="whitespace-nowrap text-text-muted">
            <tr className="border-b border-border/50">
              <th className="py-1.5 text-left font-normal">구간</th>
              <th className="text-right font-normal">이 방법(1년 전체)</th>
              <th className="text-right font-normal">들고 있기</th>
              <th className="text-right font-normal">아무 날이나</th>
              <th className="text-right font-normal">한 번 평균</th>
              <th className="text-right font-normal">이긴 거래</th>
              <th className="pr-1 text-right font-normal">거래 10회 미만 종목</th>
            </tr>
          </thead>
          <tbody>
            {m.segments.map((s) => (
              <tr key={s.segment} className="border-b border-border/30">
                <td className="whitespace-nowrap py-2">
                  {s.segment}년차 <span className="text-text-muted">{s.from} ~ {s.to}</span>
                </td>
                <td className={`text-right font-medium ${tone(s.avgRule, plain)}`}>{pct(s.avgRule)}</td>
                <td className={`text-right ${tone(s.avgHold, plain)}`}>{pct(s.avgHold)}</td>
                <td className={`text-right ${tone(s.avgRandom, plain)}`}>{pct(s.avgRandom)}</td>
                <td className={`text-right ${tone(s.avgTradeReturn, plain)}`}>{pct(s.avgTradeReturn)}</td>
                <td className="text-right">{s.avgWinRate == null ? '—' : `${s.avgWinRate}%`}</td>
                <td className="pr-1 text-right">
                  {s.weakSymbols}/{s.symbols}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[13px] text-text-muted">
        차이(이 방법 − 들고 있기 / − 아무 날이나): {m.segments.map((s) => `${s.segment}년차 ${pp(s.diffHold)} / ${pp(s.diffRandom)}`).join(' · ')}
      </p>
    </Panel>
  );
}

function Conditions({ r }: { r: BacktestReport }) {
  const rows: [string, string][] = [
    ['대상', `미국 시총 상위 100 중 7분야 ${r.targets.included.length}종목(${BACKTEST_SECTORS.join('·')}) · 기준일 ${r.universeAsOf.slice(0, 10)}`],
    ['기간', r.segments.length ? `3년 · ${r.segments.map((s) => `${s.segment}년차 ${s.from} ~ ${s.to}`).join(' · ')}` : '최근 3년(완성 거래일 756개), 1년(252일)씩 3구간'],
    ['방법', RULE_CHOICES.map((c) => c.title).join(' · ')],
    ['손절 · 트레일링', `손절 ${r.conditions.stopLossPercent}% · 트레일링 끔`],
    ['비용 · 체결', `왕복 ${r.conditions.costPct}%p · ${r.conditions.fill}`],
    ['비교 기준', '그냥 들고 있기 · 아무 날이나 사고팔기(같은 횟수·같은 보유일, 200번 평균)'],
    ['사전 등록', r.version],
  ];
  return (
    <Panel pad="sm">
      <SectionTitle>미리 정한 시험 조건</SectionTitle>
      <dl className="mt-2 grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 text-[13px]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-text-muted">{k}</dt>
            <dd className="text-text-primary">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-[13px] text-text-muted">결과를 보기 전에 정해 둔 조건입니다. 판정은 그때 기록된 그대로입니다.</p>
    </Panel>
  );
}

export default function FixedResult({ r }: { r: BacktestReport }) {
  const [symbolsOpen, setSymbolsOpen] = useState(false);
  const errors = r.symbols.filter((s) => s.error);
  return (
    <div className="space-y-4">
      <Conditions r={r} />
      <section className="space-y-2">
        <SectionTitle aside="종목 평균(동일 가중) · 수수료 포함">방법별 결과</SectionTitle>
        {r.methods.map((m) => (
          <MethodBlock key={m.id} m={m} />
        ))}
      </section>

      <section className="space-y-2">
        <SectionTitle aside="3년(1년씩 복리로 이은 값) 이 방법 − 들고 있기 · 종목 평균">분야별 결과</SectionTitle>
        <Panel pad="sm">
          <table className="w-full text-[13px] tabular-nums">
            <thead className="text-text-muted">
              <tr className="border-b border-border/50">
                <th className="py-1.5 text-left font-normal">분야</th>
                <th className="text-right font-normal">종목</th>
                {r.methods.map((m) => (
                  <th key={m.id} className="text-right font-normal">
                    {m.title}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {r.sectors.map((s) => (
                <tr key={s.sector} className="border-b border-border/30">
                  <td className="py-2">
                    {s.sector}
                    {s.weak && <span className="ml-1.5 rounded bg-bg-tertiary px-1.5 py-0.5 text-text-secondary">표본 적음</span>}
                  </td>
                  <td className={`text-right ${s.weak ? 'text-text-muted' : ''}`}>{s.symbols}</td>
                  {r.methods.map((m) => (
                    <td key={m.id} className={`text-right ${s.weak ? 'text-text-muted' : tone(s.byMethod[m.id])}`}>
                      {pp(s.byMethod[m.id])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-[13px] text-text-muted">
            분야별 숫자는 설명용입니다. 강한 분야가 다음에도 강한지는 확인되지 않았습니다(섹터 강세 시험 6개 중 0개 통과).
          </p>
        </Panel>
      </section>

      <section className="space-y-2">
        <button
          type="button"
          onClick={() => setSymbolsOpen((v) => !v)}
          aria-expanded={symbolsOpen}
          className="inline-flex items-center gap-1.5 text-sm font-semibold text-text-secondary hover:text-text-primary"
        >
          {symbolsOpen ? <ChevronDown {...ICON_SM} /> : <ChevronRight {...ICON_SM} />}
          종목별 상세 ({r.symbols.length})
        </button>
        {symbolsOpen && (
          <Panel pad="sm" className="max-h-[28rem] overflow-y-auto">
            <table className="w-full text-[13px] tabular-nums">
              <thead className="sticky top-0 bg-bg-secondary text-text-muted">
                <tr className="border-b border-border/50">
                  <th className="py-1.5 text-left font-normal">종목</th>
                  <th className="text-left font-normal">분야</th>
                  {r.methods.map((m) => (
                    <th key={m.id} className="text-right font-normal">
                      {m.title} 3년
                    </th>
                  ))}
                  <th className="text-right font-normal">들고 있기 3년</th>
                </tr>
              </thead>
              <tbody>
                {r.symbols.map((s) => (
                  <tr key={s.symbol} className="border-b border-border/30">
                    <td className="py-1.5">
                      <StockName symbol={s.symbol} name={s.name} size="sm" />
                    </td>
                    <td className="text-text-secondary">{s.sector}</td>
                    {s.error ? (
                      <td colSpan={r.methods.length + 1} className="text-right text-text-muted">
                        {s.error}
                      </td>
                    ) : (
                      <>
                        {r.methods.map((m) => {
                          const v = s.byMethod[m.id];
                          return (
                            <td key={m.id} className={`text-right ${tone(v?.rule3y)}`}>
                              {pct(v?.rule3y)} <span className="text-text-muted">({v?.trades ?? 0}회)</span>
                            </td>
                          );
                        })}
                        <td className={`text-right ${tone(s.byMethod.trend?.hold3y)}`}>{pct(s.byMethod.trend?.hold3y)}</td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>
        )}
      </section>

      <div className="space-y-1 text-[13px] text-text-muted">
        <p>
          분야 밖이라 뺀 종목 {r.targets.outOfSector.length}개: {r.targets.outOfSector.map((t) => `${t.name ?? t.symbol}(${t.sector})`).join(', ') || '없음'}
        </p>
        <p>
          분야를 확인하지 못한 종목 {r.targets.unknown.length}개: {r.targets.unknown.map((t) => t.name ?? t.symbol).join(', ') || '없음'}
        </p>
        {errors.length > 0 && (
          <p>
            3년치 기록이 모자라 계산하지 못한 종목 {errors.length}개: {errors.map((s) => s.name ?? s.symbol).join(', ')}
          </p>
        )}
        <p>
          미래 누설 검사: {r.leakCheck.symbol} {r.leakCheck.bars}봉 {r.leakCheck.ok ? '통과' : '실패'}
        </p>
      </div>
    </div>
  );
}
