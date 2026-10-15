import { Fragment, useState } from 'react';
import { ChevronDown, ChevronRight, LoaderCircle } from 'lucide-react';
import StockName from '../common/StockName';
import { SkeletonTable } from '../common/SkeletonLoader';
import { Badge, Button, InfoTip, Segmented } from '../ui';
import { ICON_SM } from '../ui/icon';
import WarnIcon from '../ui/WarnIcon';
import { LIST_TABLE_ROW, TABLE_NAME_COL, TABLE_NUM_COL, TABLE_NUM_GAP } from '../ui/tokens';
import { formatPrice, formatSigned } from '../../utils/formatters';
import { currencyOfSymbol } from '../../utils/market';
import {
  AI_CHECK_OUTCOME_DAYS,
  AI_CHECK_SMALL_SAMPLE,
  AI_UNAVAILABLE_LABEL,
  AI_VERDICT_LABEL,
  type AiCheckHistory,
  type AiOutcomeDays,
  type AiVerdict,
} from '../../types/aiCheck';

const RETURN_HELP =
  '수익률 = AI 검증 때 가격 → 검증한 날 뒤 N번째 거래일 종가(끝난 봉). 「위험으로 막은 것」 과 「통과해서 산 것」 을 같은 기준으로 비교하는 것이라 수수료·슬리피지는 빼지 않습니다. 아직 날이 지나지 않은 칸은 「—」 입니다.';

const pct = (v: number | null) => (v == null ? '—' : `${formatSigned(v, 2)}%`);
const tone = (v: number | null) => (v == null ? 'text-text-muted' : v > 0 ? 'text-bullish' : v < 0 ? 'text-bearish' : 'text-text-secondary');

/** 결과 글자 — 색만으로 뜻을 전하지 않는다(글자가 있다). 위험은 경고 아이콘도 */
export function AiVerdictText({ verdict }: { verdict: AiVerdict }) {
  if (verdict === 'pass') return <span className="font-medium text-bullish">{AI_VERDICT_LABEL.pass}</span>;
  if (verdict === 'risk')
    return (
      <span className="whitespace-nowrap font-medium text-warning">
        <WarnIcon />
        {AI_VERDICT_LABEL.risk}
      </span>
    );
  return <span className="whitespace-nowrap text-text-muted">{AI_VERDICT_LABEL.unavailable}</span>;
}

/**
 * 계좌 화면 「AI 검증 기록」 (v2.46.0, A-7) — 채점 한 줄 + 표. 5단계에서 「검증 기록」 화면으로 옮긴다.
 * 채점은 서버가 읽을 때 캔들에서 낸다(`server/aiCheck/history.ts`).
 */
export default function AiCheckHistoryPanel({
  data,
  loading,
  error,
  onMore,
}: {
  data: AiCheckHistory | null;
  loading: boolean;
  error: string | null;
  onMore: () => void;
}) {
  const [days, setDays] = useState<AiOutcomeDays>(20);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const toggle = (id: number) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  if (!data) {
    return (
      <div className="p-3">
        {error ? <p className="text-caption text-danger">{error}</p> : <SkeletonTable rows={4} columns={6} />}
      </div>
    );
  }

  const { blocked, passed, unavailable } = data.stats;
  const small = blocked.n[days] < AI_CHECK_SMALL_SAMPLE || passed.n[days] < AI_CHECK_SMALL_SAMPLE;
  const NUM = `${TABLE_NUM_COL} ${TABLE_NUM_GAP} text-right`;

  return (
    <div className="space-y-3 p-3">
      {/* 채점 한 줄 */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-xs">
        <Segmented
          label="채점 기간"
          size="sm"
          value={days}
          onChange={setDays}
          options={AI_CHECK_OUTCOME_DAYS.map((d) => ({ value: d, label: `${d}거래일` }))}
        />
        <span className="text-text-secondary">
          위험으로 막은 {blocked.n[days]}건 평균 <span className={`tabular-nums ${tone(blocked.avg[days])}`}>{pct(blocked.avg[days])}</span>
          {' · '}통과해서 산 {passed.n[days]}건 평균 <span className={`tabular-nums ${tone(passed.avg[days])}`}>{pct(passed.avg[days])}</span>
          {' · '}검증 못 함 {unavailable}건
        </span>
        <InfoTip label="수익률 계산">{RETURN_HELP}</InfoTip>
        {small && <Badge tone="neutral">표본 적음({AI_CHECK_SMALL_SAMPLE}건 미만)</Badge>}
        {loading && <LoaderCircle {...ICON_SM} className="animate-spin text-text-muted" aria-label="불러오는 중" />}
      </div>
      {error && <p className="text-caption text-danger">{error}</p>}

      {!data.rows.length ? (
        <p className="rounded-lg bg-bg-tertiary/40 px-3 py-3 text-xs text-text-muted">
          아직 AI 검증 기록이 없습니다. AI 검증을 켠 계좌는 규칙이 「사도 됨」 을 낸 날 사기 직전에 AI에게 묻고 여기에 남깁니다.
        </p>
      ) : (
        <div className="rounded-lg bg-bg-tertiary/40">
          <table className="w-full text-left text-xs">
            <thead className="text-caption text-text-muted">
              <tr className="border-b border-border/50">
                <th className={`${TABLE_NUM_COL} py-2 pl-3 pr-2`}>날짜</th>
                <th className={`${TABLE_NAME_COL} py-2 pl-4 pr-3`}>종목</th>
                <th className={`${TABLE_NUM_COL} py-2 pr-2`}>결과</th>
                <th className={`${TABLE_NUM_COL} py-2 pl-4 pr-2`}>이 계좌</th>
                {AI_CHECK_OUTCOME_DAYS.map((d) => (
                  <th key={d} className={`${NUM} py-2 ${d === 20 ? 'pr-3' : ''}`}>
                    {d}거래일
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => {
                const isOpen = open.has(r.useId);
                const lines = r.verdict === 'unavailable' ? [r.unavailableReason ? AI_UNAVAILABLE_LABEL[r.unavailableReason] : 'AI 오류'] : r.reasons;
                return (
                  <Fragment key={r.useId}>
                    <tr
                      className={`cursor-pointer border-b border-border/30 hover:bg-bg-tertiary/60 ${LIST_TABLE_ROW} ${isOpen ? 'bg-bg-tertiary/60' : ''}`}
                      onClick={() => toggle(r.useId)}
                      aria-expanded={isOpen}
                    >
                      <td className={`${TABLE_NUM_COL} py-1 pl-3 pr-2 tabular-nums text-text-secondary`}>
                        <span className="flex items-center gap-1.5">
                          {isOpen ? <ChevronDown {...ICON_SM} className="shrink-0 text-text-muted" /> : <ChevronRight {...ICON_SM} className="shrink-0 text-text-muted" />}
                          {r.marketDate}
                        </span>
                      </td>
                      <td className="max-w-0 py-1 pl-4 pr-3">
                        <StockName symbol={r.symbol} className="max-w-full" />
                      </td>
                      <td className={`${TABLE_NUM_COL} py-1 pr-2`}>
                        <AiVerdictText verdict={r.verdict} />
                      </td>
                      <td className={`${TABLE_NUM_COL} py-1 pl-4 pr-2 text-text-secondary`}>{r.action === 'bought' ? '샀음' : '사지 않음'}</td>
                      {AI_CHECK_OUTCOME_DAYS.map((d) => (
                        <td key={d} className={`${NUM} py-1 tabular-nums ${tone(r.returns[d])} ${d === 20 ? 'pr-3' : ''}`}>
                          {pct(r.returns[d])}
                        </td>
                      ))}
                    </tr>
                    {isOpen && (
                      <tr className="border-b border-border/30 bg-bg-secondary/60">
                        <td colSpan={7} className="px-4 py-2">
                          <div className="w-0 min-w-full">
                            <ul className="list-disc space-y-0.5 pl-5 text-caption text-text-secondary">
                              {lines.map((l, k) => (
                                <li key={k}>{l}</li>
                              ))}
                            </ul>
                            {r.priceAtCheck != null && <p className="mt-1 text-caption text-text-muted">검증 때 가격 {formatPrice(r.priceAtCheck, currencyOfSymbol(r.symbol))}</p>}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {data.rows.length < data.total && (
        <Button size="sm" onClick={onMore} disabled={loading}>
          더 보기 ({data.total - data.rows.length}건 더)
        </Button>
      )}
      <p className="text-caption text-text-muted">AI 검증은 위험만 확인합니다. 이 앱에서 수익이 확인된 기능은 아닙니다. 투자 조언이 아닙니다.</p>
    </div>
  );
}
