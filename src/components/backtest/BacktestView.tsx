import { useId, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useBacktest } from '../../hooks/useBacktest';
import HelpBox from '../swing/HelpBox';
import StockName from '../common/StockName';
import TrashIcon from '../common/TrashIcon';
import { Button, Panel, SectionTitle } from '../ui';
import { ICON_SM } from '../ui/icon';
import { VERDICT_ICON } from '../ui/statusIcons';
import { modal, toast } from '../../store/uiStore';
import { RULE_CHOICES } from '../../types/ruleChoices';
import ApplyRuleButton from './ApplyRuleButton';
import { BACKTEST_SECTORS, isCustomSummary, type BacktestMethodResult, type BacktestReport, type BacktestVerdictKind } from '../../types/backtest';

/**
 * 「실험실 > 백테스트」 (v2.37.0) — 규칙형 3가지 방법을 미국 시총 상위 100(7분야)에 3년(1년씩 3구간)으로 시험한 결과.
 *
 * - 조건은 **고정**이다(사전 등록 — `server/autoTrading/ruleResearch.ts` 머리). 화면에서 숫자를 고칠 수 없다(바꿔 가며 좋은 숫자를 고르면 우연에 속는다).
 * - 계산은 서버(`npm run research:rule` 과 같은 함수). 주문을 내지 않는다. [이 방법을 계좌에 적용] 은 **규칙형 설정만 저장**한다(자동매매를 켜지 않는다).
 * - v2.36.0 디자인 규칙 — 이모지 없음, 파랑은 [시험 실행] 하나, 「판단 보류」·「표본 적음」 안의 숫자는 색칠하지 않는다.
 */

const VERDICT: Record<BacktestVerdictKind, { label: string; badge: string }> = {
  good: { label: '기준선보다 좋음', badge: 'bg-bullish/15 text-bullish' },
  bad: { label: '기준선 이하', badge: 'bg-bearish/15 text-bearish' },
  hold: { label: '판단 보류', badge: 'bg-bg-tertiary text-text-secondary' },
};

const pct = (v: number | null | undefined) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`);
const pp = (v: number | null | undefined) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%p`);
const tone = (v: number | null | undefined, plain = false) => (plain || v == null ? '' : v > 0 ? 'text-bullish' : v < 0 ? 'text-bearish' : '');
const kstDay = (iso: string) => new Date(iso).toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });
const when = (iso: string) => new Date(iso).toLocaleString('ko-KR');

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
        {/* 결과에서 바로 계좌로 — 규칙형 설정만 저장, 자동매매는 켜지 않는다 (D 절) */}
        <span className="ml-auto">{choice && <ApplyRuleButton choiceId={choice.id} />}</span>
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

function Conditions({ r }: { r: BacktestReport | null }) {
  const rows: [string, string][] = [
    [
      '대상',
      r
        ? `미국 시총 상위 100 중 7분야 ${r.targets.included.length}종목(${BACKTEST_SECTORS.join('·')}) · 기준일 ${r.universeAsOf.slice(0, 10)}`
        : `미국 시총 상위 100 중 7분야(${BACKTEST_SECTORS.join('·')}) — 실행할 때 종목 수가 정해집니다`,
    ],
    ['기간', r && r.segments.length ? `3년 · ${r.segments.map((s) => `${s.segment}년차 ${s.from} ~ ${s.to}`).join(' · ')}` : '최근 3년(완성 거래일 756개), 1년(252일)씩 3구간'],
    ['방법', RULE_CHOICES.map((c) => c.title).join(' · ')],
    ['손절 · 트레일링', '손절 7% · 트레일링 끔'],
    ['비용 · 체결', '왕복 0.30%p · 신호 다음 날 시가에 사고팖'],
    ['비교 기준', '그냥 들고 있기 · 아무 날이나 사고팔기(같은 횟수·같은 보유일, 200번 평균)'],
  ];
  return (
    <Panel pad="sm">
      <SectionTitle>시험 조건</SectionTitle>
      <dl className="mt-2 grid grid-cols-[8rem_1fr] gap-x-3 gap-y-1.5 text-[13px]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-text-muted">{k}</dt>
            <dd className="text-text-primary">{v}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-2 text-[13px] text-text-muted">조건은 미리 정해 두었고 화면에서 바꿀 수 없습니다.</p>
    </Panel>
  );
}

export default function BacktestView() {
  const { reports, selectedId, setSelectedId, detail, progress, error, engineDown, start, remove } = useBacktest();
  const [symbolsOpen, setSymbolsOpen] = useState(false);
  const r = detail?.detail ?? null;
  const running = progress?.running ?? false;
  const todayDone = reports?.some((x) => kstDay(x.createdAt) === kstDay(new Date().toISOString())) ?? false;

  const run = async () => {
    try {
      await start(todayDone);
    } catch (e) {
      toast.error('시험을 시작하지 못했습니다', (e as Error).message);
    }
  };

  const confirmRemove = (id: number, createdAt: string) =>
    modal.confirm({
      title: '백테스트 결과 지우기',
      message: `${when(createdAt)} 결과를 지웁니다. 되돌릴 수 없습니다.\n서버의 파일 보고서는 남습니다.`,
      confirmText: '지우기',
      danger: true,
      onConfirm: async () => {
        try {
          await remove(id);
        } catch (e) {
          toast.error('지우지 못했습니다', (e as Error).message);
        }
      },
    });

  const errors = r?.symbols.filter((s) => s.error) ?? [];

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mx-auto max-w-5xl space-y-4">
        <SectionTitle level={1}>백테스트</SectionTitle>

        <HelpBox id="backtest" storageKey="alphascope.backtestHelp" title="백테스트는 무엇인가요?">
          <p>백테스트는 지금 쓰는 규칙을 과거에 그대로 써 봤다면 어땠을지 계산하는 것입니다.</p>
          <p>규칙형 세 가지 방법을 미국 시가총액 상위 종목에 최근 3년(1년씩 세 번) 적용해 보고, 그냥 들고 있었을 때·아무 날이나 사고팔았을 때와 비교합니다.</p>
          <p>시험 조건은 미리 정해 두었고 바꿀 수 없습니다 — 조건을 바꿔 가며 좋은 숫자를 고르면 우연에 속기 쉽습니다.</p>
          <p>과거 결과는 앞으로를 보장하지 않습니다.</p>
        </HelpBox>

        <Conditions r={r} />

        <div className="flex flex-wrap items-center gap-3">
          <Button variant="primary" onClick={() => void run()} disabled={running}>
            {running ? '계산 중…' : todayDone ? '다시 계산' : '시험 실행'}
          </Button>
          {running && progress && (
            <span className="text-[13px] text-text-secondary">
              {progress.done}/{progress.total || '…'} {progress.current ?? ''}
            </span>
          )}
          {!running && detail && <span className="text-[13px] text-text-muted">결과 {when(detail.createdAt)}</span>}
          {!running && !detail && reports?.length === 0 && (
            <span className="text-[13px] text-text-muted">아직 결과가 없습니다. 89종목 정도라 1분 남짓 걸립니다.</span>
          )}
        </div>
        {engineDown && <p className="rounded-lg bg-warning/10 px-3 py-2 text-[13px] text-warning">지표 엔진이 꺼져 있어 계산할 수 없습니다.</p>}
        {error && !engineDown && <p className="rounded-lg bg-bearish/10 px-3 py-2 text-[13px] text-bearish">{error}</p>}

        {r && (
          <>
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
          </>
        )}

        {reports && reports.length > 0 && (
          <section className="space-y-2">
            <SectionTitle aside="최근 20개">지난 결과</SectionTitle>
            <Panel pad="none">
              <ul className="divide-y divide-border/40">
                {reports.map((item) => (
                  <li key={item.id} className={`flex items-center gap-3 px-3 py-2 text-[13px] ${item.id === selectedId ? 'bg-bg-tertiary' : ''}`}>
                    <button type="button" onClick={() => setSelectedId(item.id)} className="min-w-0 flex-1 text-left">
                      <span className="text-text-primary">{when(item.createdAt)}</span>
                      <span className="ml-2 text-text-muted">
                        {item.server} · {item.summary.symbols}종목 ·{' '}
                        {isCustomSummary(item.summary) ? '사용자 시험' : item.summary.methods.map((m) => `${m.title} ${VERDICT[m.verdict].label}`).join(' · ')}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => confirmRemove(item.id, item.createdAt)}
                      aria-label={`${when(item.createdAt)} 결과 지우기`}
                      title="지우기"
                      className="shrink-0 rounded p-1 text-text-muted transition-colors hover:bg-bg-tertiary hover:text-bearish"
                    >
                      <TrashIcon className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            </Panel>
          </section>
        )}

        {/* ⚠️ 고정 문구 4개 — 지우지 않는다, 정보 아이콘에 넣지 않는다 (CLAUDE.md) */}
        <div className="space-y-0.5 pb-2 text-[13px] text-text-muted">
          <p>과거 결과이며 앞으로를 보장하지 않습니다.</p>
          <p>오늘의 시가총액 상위 종목으로 과거를 시험했습니다 — 그동안 사라지거나 순위에서 밀린 종목이 빠져 실제보다 좋게 보일 수 있습니다(생존 편향).</p>
          <p>종목마다 따로 계산했습니다 — 실제 계좌의 비중·동시 보유 한도는 반영하지 않았습니다.</p>
          <p>어느 방법도 이 앱에서 돈을 번다고 확인된 적은 없습니다.</p>
        </div>
      </div>
    </div>
  );
}
