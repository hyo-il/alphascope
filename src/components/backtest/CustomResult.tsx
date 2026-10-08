import { MDD_HELP, PF_HELP } from '../../data/indicatorHelp';
import { useMemo, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Sparkles } from 'lucide-react';
import StockName from '../common/StockName';
import { InlineSpinner } from '../common/LoadingOverlay';
import { Badge, Button, InfoTip, Panel, Segmented, SectionTitle, TABLE_FILL, TABLE_NAME_COL, TABLE_NUM_COL, TABLE_NUM_GAP, TABLE_TEXT_COL } from '../ui';
import { ICON_SM } from '../ui/icon';
import { toast } from '../../store/uiStore';
import { exitReasonText, ruleConditionLine, type ExitReason } from '../../utils/autoTradeExplain';
import WarnIcon from '../ui/WarnIcon';
import { fixMethodNames, methodName, type BacktestConditionResult, type BacktestCustomReport, type BacktestCustomSymbol, type ConditionLabel, type WorstDrawdown } from '../../types/backtest';

/**
 * ④ 결과 (v2.38.0 → v2.39.0 조건 비교) — 사용자 시험. **판정 배지 없음**.
 * - 비교 표: 열 = 방법 1·2·3(저장 라벨 A·B·C — 화면 이름만 숫자, `methodName`) · 들고 있기, 행 = 조건 · 기간 전체 · 아무 날이나 대비 · MDD · Profit Factor · 거래 · 10회 미만 · 매도한 이유.
 * - v2.40.0: 숫자 색은 **항상**(표본이 적어도 끄지 않는다) — 대신 결과 맨 위 **표본 경고 상자**. MDD 는 빨강, Profit Factor 는 1 이상 초록·미만 빨강.
 *   ⚠️ **「가장 좋음」 표시·굵게·강조를 하지 않는다**(숫자의 +/− 색은 앱 공통 그대로) — 여러 조건을 비교해 고르면 우연에 속기 쉽다.
 * - 거래 10회 미만 종목이 절반 이상인 조건은 「결론 내기 어려움」, 그 조건의 숫자는 색칠하지 않는다.
 * - 종목별 표는 조건 하나를 골라 본다. 숫자는 모두 종목 평균(동일 가중)·수수료 왕복 0.30%p 포함. "기간 전체" = 1년 구간 수익률을 복리로 이은 값.
 */
const pct = (v: number | null | undefined) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`);
const pp = (v: number | null | undefined) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%p`);
const tone = (v: number | null | undefined) => (v == null ? '' : v > 0 ? 'text-bullish' : v < 0 ? 'text-bearish' : '');
const mddTone = (v: number | null | undefined) => (v != null && v < 0 ? 'text-bearish' : '');
const pfTone = (v: number | null | undefined) => (v == null ? '' : v >= 1 ? 'text-bullish' : 'text-bearish');
const when = (iso: string) => new Date(iso).toLocaleString('ko-KR');
const worstText = (w: WorstDrawdown | null | undefined) => (w ? `${w.name ?? w.symbol} ${pct(w.value)}` : '—');
const diffOf = (a: number | null | undefined, b: number | null | undefined) => (a == null || b == null ? null : a - b);

type SortKey = 'rule' | 'hold' | 'random' | 'trades' | 'winRate' | 'avgReturn' | 'stopRate' | 'mdd';
const COLS: { key: SortKey; label: string }[] = [
  { key: 'rule', label: '이 방법' },
  { key: 'hold', label: '들고 있기' },
  { key: 'random', label: '아무 날이나' },
  { key: 'mdd', label: 'MDD' },
  { key: 'trades', label: '횟수' },
  { key: 'winRate', label: '이긴 거래' },
  { key: 'avgReturn', label: '한 번 평균' },
  { key: 'stopRate', label: '손절로 매도' },
];
const EXITS: ExitReason[] = ['signal', 'stop', 'take_profit', 'trailing', 'end'];

/** " · " 로 이은 조각을 조각마다 줄바꿈 없이 — 좁은 칸에서 줄이 "· 기간 끝" 처럼 점으로 시작하지 않게 */
function Pieces({ parts }: { parts: string[] }) {
  return (
    <>
      {parts.map((t, i) => (
        <span key={i} className="whitespace-nowrap">
          {t}
          {i < parts.length - 1 ? ' · ' : ''}
          {i < parts.length - 1 && <wbr />}
        </span>
      ))}
    </>
  );
}

function Row({ head, help, cells, hold }: { head: string; help?: string; cells: ReactNode[]; hold: ReactNode }) {
  return (
    <tr className="border-b border-border/30 align-top">
      {/* 행 머리는 폭을 정하고 줄바꿈을 허용한다 — 1280 창에서 조건 3개 + 들고 있기 열이 들어가게. 넓은 창(1536px 이상)에서는 넓혀 한 줄로 (v2.42.1) */}
      <th scope="row" className="w-32 min-w-32 py-2 pr-3 text-left font-normal text-text-muted 2xl:w-52 2xl:min-w-52">
        {head}
        {help && (
          <span className="ml-1 inline-block align-[-2px]">
            <InfoTip label={`${head} 설명`}>{help}</InfoTip>
          </span>
        )}
      </th>
      {cells.map((c, i) => (
        <td key={i} className="py-2 pr-3 text-right">
          {c}
        </td>
      ))}
      <td className="py-2 text-right text-text-secondary">{hold}</td>
      {/* 남는 폭은 마지막 빈 칸이 가져간다(기준표 「표」 — 방법 칸을 고르게 벌리지 않는다) */}
      <td className={TABLE_FILL} />
    </tr>
  );
}

function SymbolTable({ result }: { result: BacktestConditionResult }) {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'rule', desc: true });
  const rows = useMemo(() => {
    const v = (x: BacktestCustomSymbol) => x[sort.key] ?? null;
    return [...result.symbols].sort((a, b) => {
      const av = v(a);
      const bv = v(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1; // 값 없음은 늘 아래
      if (bv == null) return -1;
      return sort.desc ? bv - av : av - bv;
    });
  }, [result.symbols, sort]);
  return (
    <div className="mt-2 max-h-[28rem] overflow-auto">
      <table className="w-full text-caption tabular-nums [&_td+td]:pl-3 [&_th+th]:pl-3">
        <thead className="sticky top-0 whitespace-nowrap bg-bg-secondary text-text-muted">
          <tr className="border-b border-border/50">
            <th className={`${TABLE_NAME_COL} py-1.5 text-left font-normal`}>종목 · 분야</th>
            {COLS.map((c) => (
              <th key={c.key} className={`${TABLE_NUM_COL} ${TABLE_NUM_GAP} text-right font-normal`} aria-sort={sort.key === c.key ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
                <button
                  type="button"
                  onClick={() => setSort((cur) => ({ key: c.key, desc: cur.key === c.key ? !cur.desc : true }))}
                  className={`inline-flex items-center gap-0.5 hover:text-text-primary ${sort.key === c.key ? 'text-text-primary' : ''}`}
                >
                  {c.label}
                  {sort.key === c.key && (sort.desc ? <ArrowDown {...ICON_SM} /> : <ArrowUp {...ICON_SM} />)}
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((x) => (
            <tr key={x.symbol} className="border-b border-border/30">
              <td className="py-1.5">
                <StockName symbol={x.symbol} name={x.name} size="sm" />
                <span className="block text-text-muted">{x.sector ?? '분야 미확인'}</span>
              </td>
              <td className={`text-right font-medium ${tone(x.rule)}`}>{pct(x.rule)}</td>
              <td className={`text-right ${tone(x.hold)}`}>{pct(x.hold)}</td>
              <td className={`text-right ${tone(x.random)}`}>{pct(x.random)}</td>
              <td className={`text-right ${mddTone(x.mdd)}`}>{pct(x.mdd)}</td>
              <td className="whitespace-nowrap text-right">
                {x.trades}
                {x.trades < 10 && <span className="text-text-muted"> (적음)</span>}
              </td>
              <td className="text-right">{x.winRate == null ? '—' : `${x.winRate}%`}</td>
              <td className={`text-right ${tone(x.avgReturn)}`}>{pct(x.avgReturn)}</td>
              <td className="text-right">{x.stopRate == null ? '—' : `${x.stopRate}%`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function CustomResult({
  id,
  report,
  onExplain,
  gemini,
  onRerun,
  rerunBusy,
  applySlot,
}: {
  id: number;
  report: BacktestCustomReport;
  onExplain: (id: number) => Promise<unknown>;
  gemini: { enabled: boolean; reason: string | null } | null;
  /** 같은 입력으로 강제 다시 계산 */
  onRerun: () => void;
  rerunBusy: boolean;
  applySlot?: ReactNode;
}) {
  const cs = report.conditions;
  const many = cs.length > 1;
  const [pick, setPick] = useState<ConditionLabel>('A');
  const [explaining, setExplaining] = useState(false);
  const picked = cs.find((c) => c.label === pick) ?? cs[0];
  const symbolsCount = cs[0]?.summary.symbols ?? 0;

  const explain = async () => {
    setExplaining(true);
    try {
      await onExplain(id);
    } catch (e) {
      toast.error('AI 설명을 받지 못했습니다', (e as Error).message);
    } finally {
      setExplaining(false);
    }
  };
  const ex = report.explain;

  // 표본 경고 — 어느 방법이든 거래 10회 미만 종목이 절반 이상이면 결과 맨 위에(색을 켠 대신, 색이 확신처럼 보이지 않게)
  const weakOnes = cs.filter((c) => c.summary.hardToTell);

  return (
    <div className="space-y-3">
      {weakOnes.length > 0 && (
        <div role="note" className="flex gap-2 rounded-xl bg-warning/10 px-3 py-2 text-caption text-warning">
          <WarnIcon />
          <div className="min-w-0 space-y-0.5">
            {weakOnes.length === 1 && !many ? (
              <p>
                거래가 10번이 안 된 종목이 {weakOnes[0].summary.symbols}개 중 {weakOnes[0].summary.weakSymbols}개라, 이 결과로 결론을 내기 어렵습니다. 종목 수나 기간을 늘려 보세요.
              </p>
            ) : (
              <>
                <p>거래가 10번이 안 된 종목이 절반 이상이라 결론을 내기 어려운 방법이 있습니다. 종목 수나 기간을 늘려 보세요.</p>
                {weakOnes.map((c) => (
                  <p key={c.label}>
                    {methodName(c.label)}: {c.summary.symbols}개 중 {c.summary.weakSymbols}개
                  </p>
                ))}
              </>
            )}
          </div>
        </div>
      )}
      <Panel pad="sm" className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="min-w-0 text-xs text-text-secondary">
            기간 {report.input.years}년 · 종목 {symbolsCount}개{many ? ` · 방법 ${cs.length}개` : ''} · {when(report.computedAt)}
          </p>
          <span className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={onRerun} disabled={rerunBusy}>
              다시 실행
            </Button>
            {applySlot}
          </span>
        </div>
        {/* 같은 기간 SPY 한 줄 (v2.41.0) — 비교 기준일 뿐, 판정·강조 없음. 옛 기록에는 없다 */}
        {report.spy &&
          ('error' in report.spy ? (
            <p className="text-caption text-text-muted">{report.spy.error}</p>
          ) : (
            <p className="flex flex-wrap items-center gap-1 text-caption text-text-secondary">
              <span>
                같은 기간 SPY(미국 시장 전체) 그냥 들고 있기 <span className={tone(report.spy.hold)}>{pct(report.spy.hold)}</span> · {report.spy.from} ~ {report.spy.to}
              </span>
              <InfoTip label="SPY 란">
                SPY 는 미국 S&amp;P 500 지수를 따르는 ETF 의 가격입니다(지수 그 자체는 아닙니다). 종목의 「그냥 들고 있기」 와 같은 계산(같은 기간, 1년씩 이어 붙인 수익률, 수수료 포함)입니다.
              </InfoTip>
            </p>
          ))}
        <div className="overflow-x-auto">
          <table className="w-full text-caption tabular-nums">
            <thead className="whitespace-nowrap text-text-muted">
              <tr className="border-b border-border/50">
                <th className="py-1.5 text-left font-normal">종목 {symbolsCount}개 평균</th>
                {cs.map((c) => (
                  <th key={c.label} className={`${TABLE_TEXT_COL} pr-3 text-right font-normal text-text-primary`}>
                    {methodName(c.label)}
                  </th>
                ))}
                <th className={`${TABLE_TEXT_COL} text-right font-normal`}>들고 있기</th>
                <th className={TABLE_FILL} />
              </tr>
            </thead>
            <tbody>
              <Row
                head="조건"
                cells={cs.map((c) => (
                  <span className="text-text-secondary">
                    <Pieces parts={ruleConditionLine(c.condition).split(' · ')} />
                  </span>
                ))}
                hold="—"
              />
              <Row
                head="기간 전체 수익"
                cells={cs.map((c) => <span className={tone(c.summary.rule)}>{pct(c.summary.rule)}</span>)}
                hold={<span className={tone(report.hold.rule)}>{pct(report.hold.rule)}</span>}
              />
              <Row
                head="아무 날이나 대비"
                help="같은 종목·같은 횟수·같은 보유일로 아무 날이나 매수·매도했을 때(200번 평균)보다 얼마나 높았나(%p)."
                cells={cs.map((c) => {
                  const d = diffOf(c.summary.rule, c.summary.random);
                  return <span className={tone(d)}>{pp(d)}</span>;
                })}
                hold="—"
              />
              <Row
                head="MDD(최대 낙폭)"
                help={MDD_HELP}
                cells={cs.map((c) => (
                  <span>
                    <span className={mddTone(c.summary.mdd)}>{pct(c.summary.mdd)}</span>
                    <span className="block text-text-muted">가장 나쁨 {worstText(c.summary.mddWorst)}</span>
                  </span>
                ))}
                hold={
                  <span>
                    <span className={mddTone(report.hold.mdd)}>{pct(report.hold.mdd)}</span>
                    <span className="block text-text-muted">가장 나쁨 {worstText(report.hold.mddWorst)}</span>
                  </span>
                }
              />
              <Row
                head="Profit Factor (번 돈 ÷ 잃은 돈)"
                help={PF_HELP}
                cells={cs.map((c) =>
                  c.summary.profitFactor != null ? <span className={pfTone(c.summary.profitFactor)}>{c.summary.profitFactor.toFixed(2)}</span> : c.summary.profitFactorNote ? `— (${c.summary.profitFactorNote})` : '—',
                )}
                hold="—"
              />
              <Row
                head="이긴 거래 · 한 번 평균 · 횟수"
                cells={cs.map((c) => (
                  <span>
                    <span className="whitespace-nowrap">{c.summary.winRate == null ? '—' : `${c.summary.winRate}%`} · </span>
                    <wbr />
                    <span className={`whitespace-nowrap ${tone(c.summary.avgTradeReturn)}`}>{pct(c.summary.avgTradeReturn)}</span>
                    <span className="whitespace-nowrap"> · {c.summary.avgTrades ?? 0}번</span>
                  </span>
                ))}
                hold="—"
              />
              <Row
                head="거래 10회 미만 종목"
                cells={cs.map((c) => (
                  <span>
                    {c.summary.weakSymbols}/{c.summary.symbols}
                    {c.summary.hardToTell && (
                      <span className="mt-0.5 block">
                        <Badge>결론 내기 어려움</Badge>
                      </span>
                    )}
                  </span>
                ))}
                hold="—"
              />
              <Row
                head="매도한 이유"
                help="이 방법으로 매도한 거래가 어떤 이유로 매도됐는지의 비율입니다. 괄호 안 숫자는 그 방법의 설정입니다 — 매도 신호(방법의 매도 조건) · 손절 · 익절 · 트레일링 · 시험 기간이 끝나 마지막 종가로 정리."
                cells={cs.map((c) =>
                  c.summary.exits ? (
                    <span className="text-text-secondary">
                      <Pieces
                        parts={EXITS.filter((k) => c.summary.exits![k] > 0).map(
                          (k) => `${exitReasonText(k, c.condition)} ${Math.round(c.summary.exits![k])}%`,
                        )}
                      />
                    </span>
                  ) : (
                    '—'
                  ),
                )}
                hold="—"
              />
            </tbody>
          </table>
        </div>
        {/* ⚠️ 고정 문구 — 지우지 않는다 */}
        <p className="text-caption text-text-muted">여러 조건을 바꿔 보며 가장 좋은 숫자를 고르면 우연에 속기 쉽습니다.</p>
      </Panel>

      {report.segments.length > 1 && (
        <Panel pad="sm">
          <SectionTitle aside="1년씩 · 종목 평균 · 기간 수익">구간별</SectionTitle>
          <div className="mt-2 overflow-x-auto">
            <table className="w-full text-caption tabular-nums [&_td+td]:pl-3 [&_th+th]:pl-3">
              <thead className="whitespace-nowrap text-text-muted">
                <tr className="border-b border-border/50">
                  <th className="py-1.5 text-left font-normal">구간</th>
                  {cs.map((c) => (
                    <th key={c.label} className={`${TABLE_NUM_COL} ${TABLE_NUM_GAP} text-right font-normal`}>
                      {methodName(c.label)}
                    </th>
                  ))}
                  <th className={`${TABLE_NUM_COL} ${TABLE_NUM_GAP} text-right font-normal`}>들고 있기</th>
                  <th className={TABLE_FILL} />
                </tr>
              </thead>
              <tbody>
                {report.segments.map((g, k) => (
                  <tr key={g.segment} className="border-b border-border/30">
                    <td className="whitespace-nowrap py-1.5">
                      {g.segment}년차
                      <span className="block text-text-muted">
                        {g.from} ~ {g.to}
                      </span>
                    </td>
                    {cs.map((c) => (
                      <td key={c.label} className={`text-right ${tone(c.segmentRows[k]?.rule)}`}>
                        {pct(c.segmentRows[k]?.rule)}
                      </td>
                    ))}
                    <td className={`text-right ${tone(cs[0]?.segmentRows[k]?.hold)}`}>{pct(cs[0]?.segmentRows[k]?.hold)}</td>
                    <td className={TABLE_FILL} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Panel>
      )}

      <Panel pad="sm">
        <SectionTitle
          aside="기간 전체 · 머리를 누르면 정렬"
          right={
            many ? (
              <Segmented label="종목별 표의 방법" size="sm" options={cs.map((c) => ({ value: c.label, label: methodName(c.label) }))} value={picked.label} onChange={setPick} />
            ) : undefined
          }
        >
          종목별{many ? ` — ${methodName(picked.label)}` : ''}
        </SectionTitle>
        <SymbolTable key={picked.label} result={picked} />
        {report.excluded.length > 0 && (
          <p className="mt-2 text-caption text-text-muted">
            계산하지 못해 뺀 종목 {report.excluded.length}개: {report.excluded.map((e) => `${e.name ?? e.symbol}(${e.reason})`).join(' · ')}
          </p>
        )}
        <p className="mt-1 text-caption text-text-muted">
          미래 누설 검사: {report.leakCheck.symbol || '—'} {report.leakCheck.bars}봉 {report.leakCheck.ok ? '통과' : '실패'}
        </p>
      </Panel>

      <Panel pad="sm" className="space-y-2">
        <SectionTitle
          right={
            !ex ? (
              <Button size="sm" icon={explaining ? undefined : Sparkles} onClick={() => void explain()} disabled={explaining || !gemini?.enabled}>
                {explaining && <InlineSpinner />}
                {explaining ? '설명 받는 중…' : many ? 'AI에게 비교 설명 듣기' : 'AI에게 결과 설명 듣기'}
              </Button>
            ) : undefined
          }
        >
          AI 설명
        </SectionTitle>
        {!ex && gemini && !gemini.enabled && <p className="text-caption text-text-muted">AI 설명: {gemini.reason ?? 'Gemini 를 쓸 수 없습니다'}</p>}
        {!ex && gemini?.enabled && (
          <p className="text-caption text-text-muted">
            누르면 Gemini 를 1번 부릅니다(무료 한도를 자동매매와 함께 씁니다). {many ? '방법별 숫자만 보내고, 어느 방법이 가장 좋다고 고르지 않습니다. ' : ''}
            받은 설명은 이 히스토리에 함께 저장됩니다.
          </p>
        )}
        {ex && (
          <div className="space-y-2 text-caption text-text-secondary">
            {ex.summary.length > 0 && (
              <div>
                <p className="text-text-muted">요약</p>
                <ul className="list-disc space-y-0.5 pl-5">
                  {ex.summary.map((t, i) => (
                    <li key={i}>{fixMethodNames(t)}</li>
                  ))}
                </ul>
              </div>
            )}
            {ex.byCondition.map((b) => (
              <div key={b.label}>
                <p className="text-text-muted">{many ? methodName(b.label) : '좋았던 점 · 아쉬운 점'}</p>
                <ul className="list-disc space-y-0.5 pl-5">
                  {b.good.map((t, i) => (
                    <li key={`g${i}`}>좋았던 점: {fixMethodNames(t)}</li>
                  ))}
                  {b.bad.map((t, i) => (
                    <li key={`b${i}`}>아쉬운 점: {fixMethodNames(t)}</li>
                  ))}
                </ul>
              </div>
            ))}
            {ex.cautions.length > 0 && (
              <div>
                <p className="text-text-muted">주의</p>
                <ul className="list-disc space-y-0.5 pl-5">
                  {ex.cautions.map((t, i) => (
                    <li key={i}>{fixMethodNames(t)}</li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-text-muted">
              {ex.removed > 0 && `검증 실패 문장 ${ex.removed}개 제외(입력 표에 없는 숫자) · `}
              {ex.model} · {when(ex.createdAt)} · AI 설명은 표의 숫자를 풀어 쓴 것이며 검증된 판단이 아닙니다.
            </p>
          </div>
        )}
      </Panel>
    </div>
  );
}
