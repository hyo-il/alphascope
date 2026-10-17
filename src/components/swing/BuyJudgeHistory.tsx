import type { ReactNode } from 'react';
import { GATE_REASON_LABEL, type GateReason } from '../../types/autoTrading';
import { Fragment, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import StockName from '../common/StockName';
import { SkeletonCards } from '../common/SkeletonLoader';
import { Badge, Button, InfoTip, Segmented } from '../ui';
import { ICON_SM } from '../ui/icon';
import { LIST_TABLE_ROW, TABLE_NUM_COL } from '../ui/tokens';
import { fetchJudgeDays, useBuyJudgeDays, useBuyJudgeHistory } from '../../hooks/useBuyJudge';
import DateGroupList, { SymbolsTitle } from '../common/DateGroupList';
import { daySymbols } from '../../utils/buyJudgeOrder';
import DisclosureButton from '../ui/DisclosureButton';
import { formatSigned } from '../../utils/formatters';
import { modal, toast } from '../../store/uiStore';
import { REASON_DAYS, SMALL_SAMPLE, type JudgeDay } from '../../types/buyJudge';
import { VerdictText } from './BuyJudgeTable';

const OUTCOME_HELP =
  '「사도 됨」 다음 거래일 시가에 샀다고 보고, 그 판단 날(기준 봉)에서 5·10·20번째 거래일 종가로 계산한 수익률입니다. 백테스트와 같은 왕복 비용 0.30%p 를 뺐습니다. 아직 날이 지나지 않은 칸은 「—」 입니다.';

const pct = (v: number | null) => (v == null ? '—' : `${formatSigned(v, 2)}%`);
const tone = (v: number | null) => (v == null ? 'text-text-muted' : v > 0 ? 'text-bullish' : v < 0 ? 'text-bearish' : 'text-text-secondary');

/**
 * 매수 판단 히스토리 (사용자 결정 A-8) — ① 날짜별 목록(위 한 줄 = 「사도 됨」 성과 요약, 펼치면 그날 종목 · 판단(색 + 총점) · 규칙 ·
 * 「사도 됨」 의 5·10·20거래일 뒤 수익) ② 아래 접힌 칸 「종목별 사지 않은 이유」.
 * [기록 삭제] 는 판단 기록만. 목표 수익 가능성 기록·성적은 「퀀트 > 검증 기록」 탭(A-5).
 */
/** 「거름망에 걸림 N일 (시장 하락 2 · 200일선 아래 1)」 의 괄호 — 이유를 아는 날만. 괄호 덩어리는 한 번에 꺾인다(「1)」 만 남지 않게) */
function gateBreakdown(reasons?: Partial<Record<GateReason, number>>): ReactNode {
  const parts = (Object.keys(GATE_REASON_LABEL) as GateReason[]).filter((k) => reasons?.[k]).map((k) => `${GATE_REASON_LABEL[k]} ${reasons![k]}`);
  return parts.length ? <> <span className="whitespace-nowrap">({parts.join(' · ')})</span></> : null;
}

export default function BuyJudgeHistory() {
  const h = useBuyJudgeHistory();
  const dayList = useBuyJudgeDays();
  const [reasonsOpen, setReasonsOpen] = useState(false);
  const [scope, setScope] = useState<'nonBuy' | 'all'>('nonBuy');
  const [openSym, setOpenSym] = useState<string | null>(null);
  const [days, setDays] = useState<Record<string, JudgeDay[] | 'loading'>>({});
  const [clearing, setClearing] = useState(false);

  const toggle = async (s: string) => {
    if (openSym === s) return setOpenSym(null);
    setOpenSym(s);
    if (!days[s] || days[s] === 'loading') {
      setDays((d) => ({ ...d, [s]: 'loading' }));
      try {
        const list = await fetchJudgeDays(s);
        setDays((d) => ({ ...d, [s]: list }));
      } catch (e) {
        toast.error('날짜별 판단을 불러오지 못했습니다', (e as Error).message);
        setDays((d) => ({ ...d, [s]: [] }));
      }
    }
  };

  const clear = () => {
    const n = scope === 'all' ? (h.data?.counts.all ?? 0) : (h.data?.counts.nonBuy ?? 0);
    if (!n) return toast.info('삭제할 판단 기록이 없습니다');
    modal.confirm({
      title: '매수 판단 기록 삭제',
      message: `${n}줄이 삭제됩니다${scope === 'nonBuy' ? '(「사도 됨」 기록은 남습니다)' : '(「사도 됨」 기록과 성과도 함께 지워집니다)'}. 되돌릴 수 없습니다.\n목표 수익 가능성 기록(「검증 기록」)은 삭제하지 않습니다.`,
      confirmText: '삭제',
      danger: true,
      onConfirm: async () => {
        setClearing(true);
        try {
          const deleted = await h.clear(scope);
          toast.success(`판단 기록 ${deleted}줄을 삭제했습니다`);
          setDays({});
          void dayList.reload();
        } catch (e) {
          toast.error('삭제하지 못했습니다', (e as Error).message);
        } finally {
          setClearing(false);
        }
      },
    });
  };

  /** 날짜를 펼친 표의 숫자 칸(폭은 colgroup 이 정한다) */
  const DAY_NUM = 'whitespace-nowrap pl-8 text-right';
  const s = h.data?.stats;
  return (
    <div className="space-y-6">
      {/* ① 날짜별 목록 (사용자 결정) — 위 한 줄 = 「사도 됨」 성과 요약, 날짜를 펼치면 그날 종목 전부. 백테스트 히스토리와 같은 부품(DateGroupList) */}
      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-text-primary">날짜별 판단</h3>
          <InfoTip label="수익 계산">{OUTCOME_HELP}</InfoTip>
          {s && (
            <span className="text-caption text-text-secondary">
              「사도 됨」 그 뒤 평균 수익 — 5거래일 {pct(s.avg5)}({s.n5}건) · 10거래일 {pct(s.avg10)}({s.n10}건) · 20거래일 {pct(s.avg20)}({s.n20}건)
            </span>
          )}
          {s?.smallSample && <Badge tone="neutral">표본 적음(5거래일 {s.n5}건 · {SMALL_SAMPLE}건 미만)</Badge>}
        </div>
        {dayList.days == null ? (
          dayList.error ? <p className="text-caption text-danger">{dayList.error}</p> : <SkeletonCards count={2} className="grid-cols-1" />
        ) : !dayList.days.length ? (
          <p className="rounded-lg bg-bg-tertiary/40 px-3 py-3 text-xs text-text-muted">아직 판단 기록이 없습니다. 서버가 매일 각 시장 마감 뒤 기록하고, [실행] 을 눌러도 기록합니다.</p>
        ) : (
          <DateGroupList
            label="날짜별 매수 판단"
            hasMore={dayList.days.length < dayList.totalDays}
            onMore={() => void dayList.more()}
            loadingMore={dayList.loadingMore}
            groups={dayList.days.map((d) => ({
              key: d.marketDate,
              date: d.marketDate,
              title: <SymbolsTitle symbols={daySymbols(d.rows)} />,
              summary: (
                <>
                  <span className={d.buys ? 'text-bullish' : ''}>사도 됨 {d.buys}</span> · <span className={d.nonBuys ? 'text-danger' : ''}>안 됨 {d.nonBuys}</span>
                </>
              ),
              render: () => (
                // 칸 폭 고정(table-fixed) — 날짜마다 내용 폭이 달라 두 날짜를 펼치면 열이 어긋난다
                <table className="w-full table-fixed text-left text-xs">
                  <colgroup>
                    <col />
                    <col className="w-44" />
                    <col className="w-36" />
                    <col className="w-24" />
                    <col className="w-24" />
                    <col className="w-24" />
                  </colgroup>
                  <thead className="text-caption text-text-muted">
                    <tr className="border-b border-border/50">
                      <th className="py-2 pr-4">종목</th>
                      <th className="whitespace-nowrap py-2 pr-4">판단 · 점수</th>
                      <th className="whitespace-nowrap py-2 pr-2">규칙</th>
                      <th className={`${DAY_NUM} py-2`}>5거래일</th>
                      <th className={`${DAY_NUM} py-2`}>10거래일</th>
                      <th className={`${DAY_NUM} py-2`}>20거래일</th>
                    </tr>
                  </thead>
                  <tbody>
                    {d.rows.map((r) => (
                      <tr key={`${r.symbol}-${r.ruleName}`} className={`border-b border-border/30 last:border-b-0 ${LIST_TABLE_ROW}`}>
                        <td className="max-w-0 py-1 pr-4">
                          <StockName symbol={r.symbol} className="max-w-full" />
                        </td>
                        <td className="whitespace-nowrap py-1 pr-4">
                          <VerdictText verdict={r.verdict} score={r.score} maxScore={r.maxScore} gateReason={r.gateReason} stackReason />
                        </td>
                        <td className="truncate py-1 pr-2 text-text-secondary" title={r.ruleName}>
                          {r.ruleName}
                        </td>
                        {/* 「사도 됨」 만 그 뒤 수익률 — 다른 판단은 「—」 */}
                        <td className={`${DAY_NUM} py-1 tabular-nums ${tone(r.r5)}`}>{pct(r.r5)}</td>
                        <td className={`${DAY_NUM} py-1 tabular-nums ${tone(r.r10)}`}>{pct(r.r10)}</td>
                        <td className={`${DAY_NUM} py-1 tabular-nums ${tone(r.r20)}`}>{pct(r.r20)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ),
            }))}
          />
        )}
      </section>

      {/* ② 종목별 「사지 않은 이유」 — 목록 아래 접힌 칸 */}
      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <DisclosureButton open={reasonsOpen} onToggle={() => setReasonsOpen((v) => !v)} label="종목별 사지 않은 이유 보기" controls="buy-judge-reasons" />
          <span className="text-caption text-text-muted">종목마다 최근 {REASON_DAYS}거래일 판단 — 누르면 날짜별 판단</span>
        </div>
        <div id="buy-judge-reasons" hidden={!reasonsOpen} className="space-y-2">
        {h.loading && !h.data ? (
          <SkeletonCards count={2} className="grid-cols-1" />
        ) : !h.data?.reasons.length ? (
          <p className="rounded-lg bg-bg-tertiary/40 px-3 py-3 text-xs text-text-muted">아직 판단 기록이 없습니다. 「매수 판단」 탭에 종목을 추가하면 서버가 매일 각 시장 마감 뒤 기록합니다.</p>
        ) : (
          <ul className="space-y-1">
            {h.data.reasons.map((r) => {
              const open = openSym === r.symbol;
              const list = days[r.symbol];
              return (
                <Fragment key={r.symbol}>
                  <li>
                    <button
                      type="button"
                      onClick={() => void toggle(r.symbol)}
                      aria-expanded={open}
                      className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs transition-colors hover:bg-bg-tertiary/60 ${open ? 'bg-bg-tertiary/60' : 'bg-bg-tertiary/30'}`}
                    >
                      {open ? <ChevronDown {...ICON_SM} className="shrink-0 text-text-muted" /> : <ChevronRight {...ICON_SM} className="shrink-0 text-text-muted" />}
                      <StockName symbol={r.symbol} className="w-48 shrink-0" />
                      <span className="min-w-0 text-text-secondary">
                        최근 {r.days}거래일 — 기준 미달 {r.below}일 · 손익비 부족 {r.rrBlock}일 · 거름망에 걸림 {r.gateBlock ?? 0}일{gateBreakdown(r.gateReasons)} · 사도 됨 {r.buy}일
                        {r.mostMissing ? ` · 가장 자주 모자란 조건: ${r.mostMissing}` : ''}
                      </span>
                    </button>
                  </li>
                  {open && (
                    <li className="px-3 pb-2">
                      {list === 'loading' || !list ? (
                        <p className="py-2 text-caption text-text-muted">불러오는 중…</p>
                      ) : (
                        <table className="w-full text-left text-caption">
                          <tbody>
                            {list.map((d) => (
                              <tr key={`${d.marketDate}-${d.ruleName}`} className="border-b border-border/30 last:border-b-0">
                                <td className={`${TABLE_NUM_COL} py-1 pr-4 tabular-nums text-text-secondary`}>{d.marketDate}</td>
                                <td className={`${TABLE_NUM_COL} py-1 pr-4`}>
                                  <VerdictText verdict={d.verdict} score={d.score} maxScore={d.maxScore} gateReason={d.gateReason} stackReason />
                                </td>
                                <td className="py-1 text-text-muted">{d.reason}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </li>
                  )}
                </Fragment>
              );
            })}
          </ul>
        )}
        </div>
      </section>

      {/* [기록 삭제] — 판단 기록만. 0줄이면 삭제 칸을 감추고(공통 동작 규칙) 삭제 버튼은 줄 오른쪽 끝(기준표 9) */}
      <section className="flex flex-wrap items-center gap-2 rounded-lg bg-bg-tertiary/30 px-3 py-2">
        <span className="text-xs text-text-secondary">판단 기록 {h.data?.counts.all ?? 0}줄</span>
        <span className="min-w-0 text-caption text-text-muted">보관 기간은 「설정 &gt; 앱 기능 설정」 에서 고릅니다(「사도 됨」 은 늘 남습니다).</span>
        {(h.data?.counts.all ?? 0) > 0 && (
          <span className="ml-auto flex shrink-0 items-center gap-2">
            <Segmented
              label="삭제할 범위"
              size="sm"
              value={scope}
              onChange={setScope}
              options={[
                { value: 'nonBuy', label: '「사도 됨」 제외' },
                { value: 'all', label: '전부' },
              ]}
            />
            <Button busy={clearing} size="sm" variant="danger-text" onClick={clear} disabled={clearing}>
              {clearing ? '삭제하는 중…' : '기록 삭제'}
            </Button>
          </span>
        )}
      </section>
    </div>
  );
}
