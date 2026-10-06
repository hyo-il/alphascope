import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, Sparkles } from 'lucide-react';
import StockName from '../common/StockName';
import { InlineSpinner } from '../common/LoadingOverlay';
import { Badge, Button, Panel, SectionTitle } from '../ui';
import { ICON_SM } from '../ui/icon';
import { toast } from '../../store/uiStore';
import { ruleConditionLine } from '../../utils/autoTradeExplain';
import type { BacktestCustomReport, BacktestCustomSymbol } from '../../types/backtest';

/**
 * ④ 결과 (v2.38.0) — 사용자 시험. **판정 배지 없음**(조건을 바꿔 보는 화면이라 "좋음" 을 붙이면 우연을 고르게 된다).
 * 거래 10회 미만 종목이 절반 이상이면 「결론 내기 어려움」 만, 그때 숫자는 색칠하지 않는다.
 * 숫자는 모두 종목 평균(동일 가중)·수수료 왕복 0.30%p 포함. "기간 전체" = 1년 구간 수익률을 복리로 이은 값.
 */
const pct = (v: number | null | undefined) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`);
const tone = (v: number | null | undefined, plain: boolean) => (plain || v == null ? '' : v > 0 ? 'text-bullish' : v < 0 ? 'text-bearish' : '');
const when = (iso: string) => new Date(iso).toLocaleString('ko-KR');

type SortKey = 'rule' | 'hold' | 'random' | 'trades' | 'winRate' | 'avgReturn' | 'stopRate';
// 비교 세 칸을 앞에 — 1280 창에서는 표가 옆으로 스크롤되는데, 그때도 핵심 비교가 먼저 보이게
const COLS: { key: SortKey; label: string }[] = [
  { key: 'rule', label: '이 방법' },
  { key: 'hold', label: '들고 있기' },
  { key: 'random', label: '아무 날이나' },
  { key: 'trades', label: '횟수' },
  { key: 'winRate', label: '이긴 거래' },
  { key: 'avgReturn', label: '한 번 평균' },
  { key: 'stopRate', label: '손절 비율' },
];

export function conditionText(r: BacktestCustomReport): string {
  return `${ruleConditionLine(r.input)} · 기간 ${r.input.years}년`;
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
  applySlot?: React.ReactNode;
}) {
  const s = report.summary;
  const plain = s.hardToTell;
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'rule', desc: true });
  const [explaining, setExplaining] = useState(false);
  const rows = useMemo(() => {
    const v = (x: BacktestCustomSymbol) => x[sort.key];
    return [...report.symbols].sort((a, b) => {
      const av = v(a);
      const bv = v(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1; // 값 없음은 늘 아래
      if (bv == null) return -1;
      return sort.desc ? bv - av : av - bv;
    });
  }, [report.symbols, sort]);

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

  return (
    <div className="space-y-3">
      <Panel pad="sm" className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <p className="min-w-0 text-xs text-text-secondary">
            {conditionText(report)} · {when(report.computedAt)}
          </p>
          <span className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={onRerun} disabled={rerunBusy}>
              다시 계산
            </Button>
            {applySlot}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[13px] text-text-secondary">
          종목 {s.symbols}개 평균
          {plain && <Badge>결론 내기 어려움</Badge>}
        </div>
        <ul className="space-y-1 text-[14px] text-text-primary">
          <li>
            사고판 횟수: 종목당 <b>{s.avgTrades ?? 0}번</b>
          </li>
          <li>
            이긴 거래: <b>{s.winRate == null ? '—' : `${s.winRate}%`}</b>
            {s.winRate != null && <span className="text-text-secondary"> (10번 중 약 {Math.round(s.winRate / 10)}번)</span>}
          </li>
          <li>
            한 번 사고팔 때 평균: <b className={tone(s.avgTradeReturn, plain)}>{pct(s.avgTradeReturn)}</b>
            <span className="text-text-secondary"> (수수료 포함)</span>
          </li>
          <li>
            기간 전체: 이 방법 <b className={tone(s.rule, plain)}>{pct(s.rule)}</b> · 그냥 들고 있기 <b className={tone(s.hold, plain)}>{pct(s.hold)}</b> · 아무 날이나 사고팔기{' '}
            <b className={tone(s.random, plain)}>{pct(s.random)}</b>
          </li>
          <li>
            거래 10회 미만 종목: {s.symbols}개 중 <b>{s.weakSymbols}개</b>
          </li>
        </ul>
        {plain && <p className="text-[13px] text-text-muted">거래 10회 미만 종목이 절반 이상이라 숫자만으로 결론을 내기 어렵습니다. 기간을 늘리거나 종목을 더 담아 보세요.</p>}
      </Panel>

      {report.segmentRows.length > 0 && (
        <Panel pad="sm">
          <SectionTitle aside="1년씩 · 종목 평균">구간별</SectionTitle>
          <div className="mt-2 overflow-x-auto">
          <table className="w-full text-[13px] tabular-nums [&_td+td]:pl-3 [&_th+th]:pl-3">
            <thead className="whitespace-nowrap text-text-muted">
              <tr className="border-b border-border/50">
                <th className="py-1.5 text-left font-normal">구간</th>
                <th className="text-right font-normal">이 방법</th>
                <th className="text-right font-normal">들고 있기</th>
                <th className="text-right font-normal">아무 날이나</th>
                <th className="text-right font-normal">한 번 평균</th>
                <th className="text-right font-normal">이긴 거래</th>
                <th className="text-right font-normal">종목당 횟수</th>
              </tr>
            </thead>
            <tbody>
              {report.segmentRows.map((g) => (
                <tr key={g.segment} className="border-b border-border/30">
                  <td className="whitespace-nowrap py-1.5">
                    {g.segment}년차
                    <span className="block text-text-muted">
                      {g.from} ~ {g.to}
                    </span>
                  </td>
                  <td className={`text-right font-medium ${tone(g.rule, plain)}`}>{pct(g.rule)}</td>
                  <td className={`text-right ${tone(g.hold, plain)}`}>{pct(g.hold)}</td>
                  <td className={`text-right ${tone(g.random, plain)}`}>{pct(g.random)}</td>
                  <td className={`text-right ${tone(g.avgTradeReturn, plain)}`}>{pct(g.avgTradeReturn)}</td>
                  <td className="text-right">{g.winRate == null ? '—' : `${g.winRate}%`}</td>
                  <td className="text-right">{g.avgTrades ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </Panel>
      )}

      <Panel pad="sm">
        <SectionTitle aside="기간 전체 · 머리를 누르면 정렬">종목별</SectionTitle>
        <div className="mt-2 max-h-[28rem] overflow-auto">
          <table className="w-full text-[13px] tabular-nums [&_td+td]:pl-3 [&_th+th]:pl-3">
            <thead className="sticky top-0 whitespace-nowrap bg-bg-secondary text-text-muted">
              <tr className="border-b border-border/50">
                <th className="py-1.5 text-left font-normal">종목 · 분야</th>
                {COLS.map((c) => (
                  <th key={c.key} className="text-right font-normal" aria-sort={sort.key === c.key ? (sort.desc ? 'descending' : 'ascending') : 'none'}>
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
                  <td className={`text-right font-medium ${tone(x.rule, plain)}`}>{pct(x.rule)}</td>
                  <td className={`text-right ${tone(x.hold, plain)}`}>{pct(x.hold)}</td>
                  <td className={`text-right ${tone(x.random, plain)}`}>{pct(x.random)}</td>
                  <td className="whitespace-nowrap text-right">
                    {x.trades}
                    {x.trades < 10 && <span className="text-text-muted"> (적음)</span>}
                  </td>
                  <td className="text-right">{x.winRate == null ? '—' : `${x.winRate}%`}</td>
                  <td className={`text-right ${tone(x.avgReturn, plain)}`}>{pct(x.avgReturn)}</td>
                  <td className="text-right">{x.stopRate == null ? '—' : `${x.stopRate}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {report.excluded.length > 0 && (
          <p className="mt-2 text-[13px] text-text-muted">
            계산하지 못해 뺀 종목 {report.excluded.length}개: {report.excluded.map((e) => `${e.name ?? e.symbol}(${e.reason})`).join(' · ')}
          </p>
        )}
        <p className="mt-1 text-[13px] text-text-muted">
          미래 누설 검사: {report.leakCheck.symbol || '—'} {report.leakCheck.bars}봉 {report.leakCheck.ok ? '통과' : '실패'}
        </p>
      </Panel>

      <Panel pad="sm" className="space-y-2">
        <SectionTitle
          right={
            !ex ? (
              <Button size="sm" icon={explaining ? undefined : Sparkles} onClick={() => void explain()} disabled={explaining || !gemini?.enabled}>
                {explaining && <InlineSpinner />}
                {explaining ? '설명 받는 중…' : 'AI에게 결과 설명 듣기'}
              </Button>
            ) : undefined
          }
        >
          AI 설명
        </SectionTitle>
        {!ex && gemini && !gemini.enabled && <p className="text-[13px] text-text-muted">AI 설명: {gemini.reason ?? 'Gemini 를 쓸 수 없습니다'}</p>}
        {!ex && gemini?.enabled && <p className="text-[13px] text-text-muted">누르면 Gemini 를 1번 부릅니다(무료 한도를 자동매매와 함께 씁니다). 받은 설명은 이 기록에 함께 남습니다.</p>}
        {ex && (
          <div className="space-y-2 text-[13px] text-text-secondary">
            {[
              ['요약', ex.summary],
              ['좋았던 점', ex.good],
              ['아쉬운 점', ex.bad],
              ['주의', ex.cautions],
            ].map(([title, list]) =>
              (list as string[]).length ? (
                <div key={title as string}>
                  <p className="text-text-muted">{title as string}</p>
                  <ul className="list-disc space-y-0.5 pl-5">
                    {(list as string[]).map((t, i) => (
                      <li key={i}>{t}</li>
                    ))}
                  </ul>
                </div>
              ) : null,
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
