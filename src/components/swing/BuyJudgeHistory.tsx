import { Fragment, useState } from 'react';
import { ChevronDown, ChevronRight, LoaderCircle } from 'lucide-react';
import StockName from '../common/StockName';
import { SkeletonCards } from '../common/SkeletonLoader';
import { Badge, Button, InfoTip, Segmented } from '../ui';
import { ICON_SM } from '../ui/icon';
import { LIST_TABLE_ROW, TABLE_NAME_COL, TABLE_NUM_COL, TABLE_NUM_GAP } from '../ui/tokens';
import { fetchJudgeDays, useBuyJudgeHistory } from '../../hooks/useBuyJudge';
import { formatSigned } from '../../utils/formatters';
import { modal, toast } from '../../store/uiStore';
import { REASON_DAYS, SMALL_SAMPLE, type JudgeDay } from '../../types/buyJudge';
import { VerdictText } from './BuyJudgeTable';

const OUTCOME_HELP =
  '「사도 됨」 다음 거래일 시가에 샀다고 보고, 그 판단 날(기준 봉)에서 5·10·20번째 거래일 종가로 계산한 수익률입니다. 백테스트와 같은 왕복 비용 0.30%p 를 뺐습니다. 아직 날이 지나지 않은 칸은 「—」 입니다.';

const pct = (v: number | null) => (v == null ? '—' : `${formatSigned(v, 2)}%`);
const tone = (v: number | null) => (v == null ? 'text-text-muted' : v > 0 ? 'text-bullish' : v < 0 ? 'text-bearish' : 'text-text-secondary');

/**
 * 매수 판단 히스토리 (v2.45.0, 사용자 결정 A-8) — ① 「사도 됨」 기록과 5·10·20거래일 뒤 수익 ② 「사지 않은 이유」 종목별 한 줄.
 * [기록 삭제] 는 판단 기록만. 목표 수익 가능성 기록·성적은 v2.47.0 에 「퀀트 > 검증 기록」 탭으로 옮겼다(A-5).
 */
export default function BuyJudgeHistory() {
  const h = useBuyJudgeHistory();
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
        } catch (e) {
          toast.error('삭제하지 못했습니다', (e as Error).message);
        } finally {
          setClearing(false);
        }
      },
    });
  };

  const NUM = `${TABLE_NUM_COL} ${TABLE_NUM_GAP} text-right`;
  const s = h.data?.stats;
  return (
    <div className="space-y-6">
      {/* ① 「사도 됨」 기록 */}
      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-text-primary">「사도 됨」 기록과 그 뒤 수익</h3>
          <InfoTip label="수익 계산">{OUTCOME_HELP}</InfoTip>
          {s && (
            <span className="text-caption text-text-secondary">
              평균 5거래일 {pct(s.avg5)}({s.n5}건) · 10거래일 {pct(s.avg10)}({s.n10}건) · 20거래일 {pct(s.avg20)}({s.n20}건)
            </span>
          )}
          {s?.smallSample && <Badge tone="neutral">표본 적음(5거래일 {s.n5}건 · {SMALL_SAMPLE}건 미만)</Badge>}
        </div>
        {h.loading && !h.data ? (
          <SkeletonCards count={2} className="grid-cols-1" />
        ) : h.error ? (
          <p className="text-caption text-danger">{h.error}</p>
        ) : !h.data?.bought.length ? (
          <p className="rounded-lg bg-bg-tertiary/40 px-3 py-3 text-xs text-text-muted">아직 「사도 됨」 기록이 없습니다. 서버가 매일 각 시장 마감 뒤 판단을 기록합니다.</p>
        ) : (
          <div className="max-h-[24rem] overflow-y-auto rounded-lg bg-bg-tertiary/40 [scrollbar-gutter:stable]">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 z-10 bg-bg-secondary text-caption text-text-muted">
                <tr className="border-b border-border/50">
                  <th className={`${TABLE_NUM_COL} py-2 pl-3 pr-2`}>날짜</th>
                  <th className={`${TABLE_NAME_COL} py-2 pl-4 pr-4`}>종목</th>
                  <th className={`${TABLE_NUM_COL} py-2 pr-2`}>규칙</th>
                  <th className={`${NUM} py-2`}>점수</th>
                  <th className={`${NUM} py-2`}>5거래일</th>
                  <th className={`${NUM} py-2`}>10거래일</th>
                  <th className={`${NUM} py-2 pr-3`}>20거래일</th>
                </tr>
              </thead>
              <tbody>
                {h.data.bought.map((b) => (
                  <tr key={b.id} className={`border-b border-border/30 last:border-b-0 ${LIST_TABLE_ROW}`}>
                    <td className={`${TABLE_NUM_COL} py-1 pl-3 pr-2 tabular-nums text-text-secondary`}>{b.marketDate}</td>
                    <td className="max-w-0 py-1 pl-4 pr-4">
                      <StockName symbol={b.symbol} className="max-w-full" />
                    </td>
                    <td className={`${TABLE_NUM_COL} py-1 pr-2 text-text-secondary`}>{b.ruleName}</td>
                    <td className={`${NUM} py-1 tabular-nums`}>
                      {b.score}/{b.maxScore}
                    </td>
                    <td className={`${NUM} py-1 tabular-nums ${tone(b.r5)}`}>{pct(b.r5)}</td>
                    <td className={`${NUM} py-1 tabular-nums ${tone(b.r10)}`}>{pct(b.r10)}</td>
                    <td className={`${NUM} py-1 pr-3 tabular-nums ${tone(b.r20)}`}>{pct(b.r20)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ② 「사지 않은 이유」 */}
      <section className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold text-text-primary">사지 않은 이유</h3>
          <span className="text-caption text-text-muted">종목마다 최근 {REASON_DAYS}거래일 판단 — 누르면 날짜별 판단</span>
        </div>
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
                        최근 {r.days}거래일 — 기준 미달 {r.below}일 · 손익비 부족 {r.rrBlock}일 · 사도 됨 {r.buy}일
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
                                  <VerdictText verdict={d.verdict} />
                                </td>
                                <td className={`${TABLE_NUM_COL} py-1 pr-4 text-right tabular-nums`}>
                                  {d.score}/{d.maxScore}
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
            <Button size="sm" variant="danger-text" onClick={clear} disabled={clearing}>
              {clearing && <LoaderCircle {...ICON_SM} className="mr-1 animate-spin" />}
              {clearing ? '삭제하는 중…' : '기록 삭제'}
            </Button>
          </span>
        )}
      </section>
    </div>
  );
}
