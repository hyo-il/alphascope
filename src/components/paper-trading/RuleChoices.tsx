import { useEffect, useRef, useState } from 'react';
import type { RuleConfig } from '../../types/autoTrading';
import StockName from '../common/StockName';
import { useAppStore } from '../../store/appStore';

/**
 * 규칙형 쉬운 선택지 3개 + 「과거 1년에 썼다면?」 (v2.31.0).
 *
 * - 세 선택지의 값은 **앱의 출발값(검증 전)** 이다 — "추천"·"검증된" 이라고 쓰지 않는다.
 * - 저장된 값이 셋 중 어느 것과도 같지 않으면 「직접 설정」(스윙 쉬운 설정과 같은 방식).
 * - 과거 재현은 **버튼으로만** 부른다(고를 때마다 자동으로 계산하지 않는다) — `POST /api/auto-trading/rule-preview` + 진행률.
 *   계산은 서버 `autoTrading/ruleBacktest.ts`(실제 엔진과 같은 판정 함수, 주문 없음).
 */

// 세 방법의 정의는 `types/ruleChoices.ts` 한 곳 (v2.37.0 — 서버 백테스트(`autoTrading/ruleResearch.ts`)도 같은 값을 쓴다)
export { RULE_CHOICES, matchChoice, type RuleChoice } from '../../types/ruleChoices';
import { RULE_CHOICES, matchChoice } from '../../types/ruleChoices';

interface SymbolRow {
  symbol: string;
  trades: number;
  winRate: number | null;
  avgReturn: number | null;
  stopRate: number | null;
  avgHoldDays: number | null;
  ruleReturn: number;
  holdReturn: number | null;
  weak: boolean;
  endExits: number;
  error?: string;
}
interface PreviewJob {
  key: string;
  running: boolean;
  done: number;
  total: number;
  current: string;
  error: string | null;
  result: {
    days: number;
    symbols: SymbolRow[];
    summary: {
      symbols: number;
      avgTrades: number | null;
      avgWinRate: number | null;
      avgReturn: number | null;
      avgRuleReturn: number | null;
      avgHoldReturn: number | null;
      totalTrades: number;
      weak: boolean;
      /** 거래 10회 미만 종목 수 (v2.37.0 — 옛 서버면 없다) */
      weakSymbols?: number;
    };
    leakCheck: { ok: boolean };
  } | null;
}

const signed = (v: number | null | undefined) => (v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`);
const tone = (v: number | null | undefined) => (v == null ? '' : v > 0 ? 'text-bullish' : v < 0 ? 'text-bearish' : '');

export default function RuleChoices({
  rule,
  onChange,
  symbols,
  hardStopLossPercent,
  trailingStopEnabled,
  trailingStopPercent,
}: {
  rule: RuleConfig;
  onChange: (rule: RuleConfig) => void;
  symbols: string[];
  hardStopLossPercent: number;
  trailingStopEnabled: boolean;
  trailingStopPercent: number;
}) {
  const active = matchChoice(rule);
  const [job, setJob] = useState<PreviewJob | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);

  // 설정이 바뀌면 이전 결과를 지운다 — 다른 설정의 결과가 지금 설정의 답처럼 보이지 않게
  const signature = JSON.stringify([rule, hardStopLossPercent, trailingStopEnabled, trailingStopPercent, symbols]);
  useEffect(() => {
    seq.current++;
    setJob(null);
    setError(null);
    setBusy(false);
  }, [signature]);

  // 창을 닫으면 진행률 묻기를 멈춘다 (v2.33.0 — 예전에는 닫은 뒤에도 계산이 끝날 때까지 1초마다 물었다)
  useEffect(
    () => () => {
      seq.current++;
    },
    [],
  );

  const run = async () => {
    const mine = ++seq.current;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch('/api/auto-trading/rule-preview', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ symbols, rule, hardStopLossPercent, trailingStopEnabled, trailingStopPercent }),
      });
      let body = (await r.json().catch(() => ({}))) as PreviewJob & { error?: string; engineDown?: boolean };
      if (!r.ok) throw new Error(body.engineDown ? '지표 엔진이 꺼져 있어 계산할 수 없습니다.' : (body.error ?? `요청 실패 (${r.status})`));
      while (mine === seq.current && body.running) {
        setJob(body);
        await new Promise((res) => setTimeout(res, 1000));
        const g = await fetch(`/api/auto-trading/rule-preview?key=${encodeURIComponent(body.key)}`);
        const next = (await g.json().catch(() => ({}))) as PreviewJob & { error?: string; engineDown?: boolean };
        if (!g.ok) throw new Error(next.engineDown ? '지표 엔진이 꺼져 있어 계산할 수 없습니다.' : (next.error ?? `요청 실패 (${g.status})`));
        body = next;
      }
      if (mine === seq.current) setJob(body);
    } catch (e) {
      if (mine === seq.current) setError((e as Error).message);
    } finally {
      if (mine === seq.current) setBusy(false);
    }
  };

  const setPage = useAppStore((st) => st.setPage);
  const res = job?.result;
  const s = res?.summary;

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-3 gap-2">
        {RULE_CHOICES.map((c) => {
          const on = active === c.id;
          return (
            <button
              key={c.id}
              type="button"
              onClick={() => onChange({ ...rule, ...c.rule })}
              aria-pressed={on}
              className={`flex flex-col justify-start rounded-lg border px-2.5 py-2 text-left transition-colors ${
                on ? 'border-text-secondary/70 bg-bg-tertiary' : 'border-border/50 hover:border-text-muted'
              }`}
            >
              <p className={`text-xs font-semibold text-text-primary`}>
                {c.title}
              </p>
              <p className="mt-1 text-[13px] leading-snug text-text-secondary">
                <b className="text-text-primary">삽니다</b>: {c.buy}
              </p>
              <p className="text-[13px] leading-snug text-text-secondary">
                <b className="text-text-primary">팝니다</b>: {c.sell}
              </p>
              <p className="mt-1 text-[13px] leading-snug text-text-secondary">
                <b className="text-text-primary">왜 쓰나</b>: {c.why}
              </p>
              <p className="text-[13px] leading-snug text-warning">
                <b>약점</b>: {c.weak}
              </p>
            </button>
          );
        })}
      </div>
      {!active && (
        <p className="text-[13px] text-text-secondary">
          <span className="rounded bg-bg-tertiary px-1.5 py-0.5">직접 설정</span> — 아래 「상세 설정」 에서 고친 값입니다.
        </p>
      )}
      <p className="text-[13px] text-text-muted">
        세 가지 값은 앱의 출발값입니다(근거 검증 전). 손절(−{hardStopLossPercent}%)은 어느 방법이든 따로 지켜집니다.
      </p>
      {/* ⚠️ 고정 안내 — 지우지 않는다 */}
      <p className="rounded-md bg-warning/10 px-2.5 py-1.5 text-[13px] text-warning">
        어느 방법도 이 앱에서 돈을 번다고 확인된 적은 없습니다. 아래 「과거 1년 재현」 을 먼저 보세요.
      </p>

      {/* 과거 1년 재현 */}
      <div className="space-y-1.5 rounded-lg bg-bg-tertiary/40 p-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void run()}
            disabled={busy}
            className="rounded bg-accent px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
          >
            {busy ? '계산 중…' : '과거 1년에 썼다면?'}
          </button>
          <span className="text-[13px] text-text-muted">
            {symbols.length ? `대상 종목 ${symbols.length}개` : '대상 종목이 없어 관심 목록(최대 20)'} · 지금 고른 방법·손절로 계산
          </span>
          {job?.running && (
            <span className="text-[13px] text-text-secondary">
              {job.done}/{job.total} {job.current}
            </span>
          )}
        </div>
        {error && <p className="text-[13px] text-bearish">{error}</p>}
        {res && s && (
          <>
            {/*
              요약은 짧은 줄 목록 (v2.37.0). 예전 한 문장은 「거래당 평균」(한 번 사고팔 때)과 「그냥 들고 있었다면」(1년 전체)을 나란히 둬
              단위가 다른 비교였다 — 1년 전체끼리를 한 줄에 둔다(둘 다 종목별 결과의 단순 평균). 계산은 바꾸지 않았다.
            */}
            {(() => {
              const weakSymbols = s.weakSymbols ?? res.symbols.filter((r) => !r.error && r.weak).length;
              const hardToTell = s.weak || weakSymbols * 2 >= s.symbols;
              return (
                <div className="space-y-0.5 text-[14px] text-text-primary">
                  <p className="flex flex-wrap items-center gap-2 text-[13px] text-text-secondary">
                    지난 1년 · 종목 {s.symbols}개 평균
                    {hardToTell && <span className="rounded bg-bg-tertiary px-1.5 py-0.5 text-text-secondary">결론 내기 어려움</span>}
                  </p>
                  <ul className="space-y-0.5">
                    <li>
                      사고판 횟수: 종목당 <b>{s.avgTrades ?? 0}번</b>
                    </li>
                    <li>
                      이긴 거래: <b>{s.avgWinRate == null ? '—' : `${s.avgWinRate}%`}</b>
                      {s.avgWinRate != null && <span className="text-text-secondary"> (10번 중 약 {Math.round(s.avgWinRate / 10)}번)</span>}
                    </li>
                    <li>
                      한 번 사고팔 때 평균: <b className={hardToTell ? '' : tone(s.avgReturn)}>{signed(s.avgReturn)}</b>
                      <span className="text-text-secondary"> (수수료 포함)</span>
                    </li>
                    <li>
                      1년 전체 결과: 이 방법 <b className={hardToTell ? '' : tone(s.avgRuleReturn)}>{signed(s.avgRuleReturn)}</b> · 그냥 들고 있기{' '}
                      <b className={hardToTell ? '' : tone(s.avgHoldReturn)}>{signed(s.avgHoldReturn)}</b>
                    </li>
                    <li>
                      거래 10회 미만 종목: {s.symbols}개 중 <b>{weakSymbols}개</b>
                    </li>
                  </ul>
                </div>
              );
            })()}
            <div className="max-h-56 overflow-y-auto">
              <table className="w-full text-[13px] tabular-nums">
                <thead className="text-text-muted">
                  <tr className="border-b border-border/50">
                    <th className="py-1 text-left font-normal">종목</th>
                    <th className="text-right font-normal">횟수</th>
                    <th className="text-right font-normal">이긴 비율</th>
                    <th className="text-right font-normal">한 번 평균</th>
                    <th className="text-right font-normal">손절</th>
                    <th className="text-right font-normal">보유일</th>
                    <th className="text-right font-normal">1년 전체</th>
                    <th className="text-right font-normal">들고 있기(1년)</th>
                  </tr>
                </thead>
                <tbody>
                  {res.symbols.map((r) => (
                    <tr key={r.symbol} className="border-b border-border/50">
                      <td className="py-1">
                        <StockName symbol={r.symbol} size="sm" />
                      </td>
                      {r.error ? (
                        <td colSpan={7} className="text-right text-text-muted">
                          {r.error}
                        </td>
                      ) : (
                        <>
                          <td className="text-right">
                            {r.trades}
                            {r.weak && <span className="text-text-muted"> (적음)</span>}
                          </td>
                          <td className="text-right">{r.winRate == null ? '—' : `${r.winRate}%`}</td>
                          <td className={`text-right ${tone(r.avgReturn)}`}>{signed(r.avgReturn)}</td>
                          <td className="text-right">{r.stopRate == null ? '—' : `${r.stopRate}%`}</td>
                          <td className="text-right">{r.avgHoldDays ?? '—'}</td>
                          <td className={`text-right ${tone(r.ruleReturn)}`}>{signed(r.ruleReturn)}</td>
                          <td className={`text-right ${tone(r.holdReturn)}`}>{signed(r.holdReturn)}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[13px] text-text-muted">
              신호가 난 다음 날 시가에 사고팔았고, 같은 날 손절 조건이 함께 맞으면 손절로 셌습니다.
              기간 끝에 들고 있던 것은 마지막 종가로 정리했습니다.
            </p>
            {/* 더 큰 시험으로 가는 길 (v2.37.0) — 같은 판정 함수로 미국 시총 상위 100(7분야)·3년 */}
            <button type="button" onClick={() => setPage('backtest')} className="text-[13px] text-accent hover:underline">
              더 많은 종목·3년으로 보려면 실험실 &gt; 백테스트
            </button>
          </>
        )}
        {/* ⚠️ 고정 문구 3개 — 지우지 않는다 */}
        <p className="text-[13px] text-text-muted">과거 결과이며 앞으로를 보장하지 않습니다.</p>
        <p className="text-[13px] text-text-muted">여러 방법을 바꿔 보며 가장 좋은 숫자를 고르면 우연에 속기 쉽습니다.</p>
        <p className="text-[13px] text-text-muted">
          종목마다 따로 계산했습니다 — 실제 계좌의 비중·최대 종목 수 제한은 반영하지 않았습니다.
        </p>
      </div>
    </div>
  );
}
