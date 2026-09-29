import type { ReactNode } from 'react';
import { useDiagnose } from '../../hooks/useDiagnose';
import type { DiagnoseDetail, DiagnoseSummary } from '../../types/diagnose';

/**
 * 🩺 진단 리포트 — 네 질문(스윙·목표 수익률·급등·AI)에 숫자로 답한다.
 *
 * `npm run diagnose` 와 **같은 함수**를 서버에서 돌린다. 요약 카드 네 장 → 상세 표(접이식).
 * 표는 JSON 에서 그린다 — 마크다운을 HTML 로 바꾸지 않는다.
 */

const signed = (v: number | null | undefined, suffix = '%') =>
  v == null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}${suffix}`;
const plain = (v: number | null | undefined, suffix = '%') => (v == null ? '—' : `${v}${suffix}`);
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const tone = (v: number | null | undefined) =>
  v == null ? 'text-text-muted' : v > 0 ? 'text-bullish' : v < 0 ? 'text-bearish' : 'text-text-secondary';

function Card({
  title,
  weak,
  numbers,
  conclusion,
}: {
  title: string;
  weak: boolean;
  numbers: { label: string; value: ReactNode }[];
  conclusion: string;
}) {
  return (
    <div className="flex flex-col rounded-lg border border-border bg-bg-secondary p-3">
      <div className="mb-2 flex items-start gap-2">
        <p className="text-xs font-semibold text-text-primary">{title}</p>
        {weak && (
          <span className="ml-auto shrink-0 rounded bg-bg-tertiary px-1.5 py-0.5 text-[10px] text-text-secondary">
            표본 부족
          </span>
        )}
      </div>
      <dl className="space-y-1 text-[11px]">
        {numbers.map((n) => (
          <div key={n.label} className="flex justify-between gap-2">
            <dt className="text-text-secondary">{n.label}</dt>
            <dd className="tabular-nums text-text-primary">{n.value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-auto border-t border-border pt-2 text-[11px] leading-relaxed text-text-secondary">
        <span className="text-text-muted">결론 · </span>
        {conclusion}
      </p>
    </div>
  );
}

function Cards({ s }: { s: DiagnoseSummary }) {
  return (
    <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(250px,1fr))]">
      <Card
        title="1. 관심 종목이 스윙에서 부적합한 것은 정상인가?"
        weak={s.swing.weak}
        numbers={[
          { label: `과거 ${s.swing.window}거래일 BUY 이상`, value: `${s.swing.buyTotal}일 (${s.swing.buyRate}%)` },
          { label: 'BUY 뒤 20일 평균', value: <span className={tone(s.swing.forward.d20)}>{signed(s.swing.forward.d20)}</span> },
          { label: '20일 뒤 플러스 종목', value: `${s.swing.positive20}/${s.swing.withBuy}` },
        ]}
        conclusion={s.swing.conclusion}
      />
      <Card
        title="2. 목표를 3% 로 작게 잡으면 달라지나?"
        weak={s.target.weak}
        numbers={[
          { label: '+3%/−1.5%/10일 목표 먼저', value: plain(s.target.avgHit) },
          { label: '기대값 (비용 반영)', value: <span className={tone(s.target.avgExp)}>{signed(s.target.avgExp, '%p')}</span> },
          { label: 'SPY 기대값', value: <span className={tone(s.target.spyExp)}>{signed(s.target.spyExp, '%p')}</span> },
        ]}
        conclusion={s.target.conclusion}
      />
      <Card
        title="3. 급등 탐지의 주기 예측이 맞나?"
        weak={s.surge.weak}
        numbers={[
          { label: `주기 적중 (${s.surge.cases}건)`, value: `${s.surge.hitRate}% vs 우연 ${s.surge.baseline}%` },
          { label: `급등 다음 날 매수 (${s.surge.chase.n}건) 5일`, value: <span className={tone(s.surge.chase.d5)}>{signed(s.surge.chase.d5)}</span> },
          { label: '+5% 먼저 / −5% 먼저', value: `${s.surge.chase.up5}% / ${s.surge.chase.down5}%` },
        ]}
        conclusion={s.surge.conclusion}
      />
      <Card
        title="4. Gemini 분석은 정확한가?"
        weak={s.ai.weak}
        numbers={[
          { label: '적중률', value: `${s.ai.rate}% (채점 ${s.ai.judged}건)` },
          { label: '기준선 (5일 뒤 상승 비율)', value: `${s.ai.baseline}%` },
          { label: '분석 기록', value: `${s.ai.total}건 (원본 ${s.ai.raw}건)` },
        ]}
        conclusion={s.ai.conclusion}
      />
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="rounded-lg border border-border bg-bg-secondary px-3 py-2">
      <summary className="text-xs font-semibold text-text-secondary">{title}</summary>
      <div className="mt-2 space-y-3">{children}</div>
    </details>
  );
}

function Table({ headers, rows }: { headers: string[]; rows: ReactNode[][] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[11px]">
        <thead className="text-text-secondary">
          <tr>
            {headers.map((h, i) => (
              <th key={h} className={`px-2 py-1 font-normal ${i === 0 ? 'text-left' : 'text-right'}`}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r} className="border-t border-border">
              {row.map((cell, i) => (
                <td key={i} className={`px-2 py-1 tabular-nums ${i === 0 ? 'text-left' : 'text-right'}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const TARGET_COLUMNS: [number, number][] = [
  [3, 1.5], [3, 3], [5, 2.5], [5, 5], [10, 5], [10, 10], [15, 7.5], [15, 15],
];

function Details({ d, s }: { d: DiagnoseDetail; s: DiagnoseSummary }) {
  const withForward = d.replay.filter((r) => r.forward.d5.length);
  return (
    <div className="space-y-2">
      <Section title="스윙 — 오늘 기준">
        <Table
          headers={['종목', '등급', '점수', '추세', '타이밍', '모멘텀', '거래량', '손익비', 'RSI', '60일선', 'BUY 까지 모자란 것']}
          rows={d.today.map((t) =>
            t.error
              ? [t.symbol, 'ERROR', '—', '—', '—', '—', '—', '—', '—', '—', t.error]
              : [
                  t.symbol,
                  t.grade,
                  t.score,
                  ...['추세(30)', '타이밍(25)', '모멘텀(20)', '거래량(15)', '손익비(10)'].map(
                    (k) => `${t.conditions[k]?.score ?? '—'}/${t.conditions[k]?.max ?? '—'}`,
                  ),
                  t.numbers.RSI,
                  t.numbers['60일선거리'],
                  <span className="block max-w-[360px] text-left text-text-secondary">{t.missing.join(' / ') || '—'}</span>,
                ],
          )}
        />
      </Section>

      <Section title={`스윙 — 과거 ${s.swing.window}거래일 재현 · BUY 날 뒤 수익률`}>
        <p className="text-[11px] text-text-muted">각 날짜의 판정에는 그날까지의 봉만 넣었습니다(미래 차단).</p>
        <Table
          headers={['종목', '평가일수', 'STRONG', 'BUY', 'WATCH', 'HOLD', 'AVOID', '손익비 강등', 'BUY 날짜(최근 5)']}
          rows={d.replay.map((r) => [
            r.symbol, r.days,
            r.grades.STRONG ?? 0, r.grades.BUY ?? 0, r.grades.WATCH ?? 0, r.grades.HOLD ?? 0, r.grades.AVOID ?? 0,
            r.rrDemoted,
            <span className="text-text-secondary">{r.buyDates.slice(-5).join(' ') || '—'}</span>,
          ])}
        />
        {withForward.length ? (
          <Table
            headers={['BUY 날 뒤', '건수', '5일', '10일', '20일']}
            rows={withForward.map((r) => {
              const [a, b, c] = [mean(r.forward.d5), mean(r.forward.d10), mean(r.forward.d20)];
              return [
                r.symbol, r.forward.d5.length,
                <span className={tone(a)}>{signed(a)}</span>,
                <span className={tone(b)}>{signed(b)}</span>,
                <span className={tone(c)}>{signed(c)}</span>,
              ];
            })}
          />
        ) : (
          <p className="text-[11px] text-text-muted">BUY 신호가 없어 이후 수익률을 낼 수 없습니다.</p>
        )}
      </Section>

      <Section title="목표 수익률 — 10거래일 안 목표 먼저 도달률 · 기대값">
        <p className="text-[11px] text-text-muted">
          매일 종가 매수 가정 · 같은 날 둘 다 닿으면 손절 · 왕복 비용 0.30%p 반영. 조건을 바꿔 보려면
          「스윙 추천 &gt; 목표 수익률」 탭을 쓰세요.
        </p>
        <Table
          headers={['종목', 'ATR/일', ...TARGET_COLUMNS.map(([t, st]) => `+${t}/−${st}`)]}
          rows={Object.entries(d.freq).map(([symbol, f]) => [
            symbol === 'SPY' ? <b>SPY (시장)</b> : symbol,
            plain(f.atr),
            ...TARGET_COLUMNS.map(([t, st]) => {
              const row = f.rows.find((r) => r.target === t && r.stop === st && r.horizon === 10);
              if (!row) return '—';
              return (
                <span>
                  {row.hitTarget}%<br />
                  <span className={tone(row.expectancy)}>{signed(row.expectancy, '%p')}</span>
                </span>
              );
            }),
          ])}
        />
      </Section>

      <Section title="급등 — 주기성 워크포워드 · 추격 매수">
        <p className="text-[11px] text-text-secondary">
          주기 판정 {d.surge.cases.length}건 · 적중 {d.surge.hitRate}% · 우연 기준선 {d.surge.baseline}% · 차이{' '}
          {signed(d.surge.edge, '%p')}
          {d.surge.staleCount > 0 && ` · 예상일이 이미 지난 경우 ${d.surge.staleCount}건`}
        </p>
        <Table
          headers={['규칙성 구간', '건수', '적중률', '기준선']}
          rows={d.surge.byRegularity.map((b) => [b.band, b.n, `${b.hit}%`, `${b.base}%`])}
        />
        <p className="text-[11px] text-text-secondary">
          급등 다음 날 시가에 산 경우 {d.surge.chase.n}건: 1일 {signed(d.surge.chase.d1)} · 3일{' '}
          {signed(d.surge.chase.d3)} · 5일 {signed(d.surge.chase.d5)} · 10일 {signed(d.surge.chase.d10)} / +5%
          먼저 {d.surge.chase.up5}% vs −5% 먼저 {d.surge.chase.down5}%
        </p>
        {d.surge.cases.length > 0 && (
          <Table
            headers={['기준일', '종목', '급등횟수', '규칙성', '평균간격', '예상일', '적중']}
            rows={d.surge.cases.slice(0, 30).map((c) => [
              c.asOf, c.symbol, c.surgeCount, `${c.regularity}%`, `${c.avgInterval}일`,
              `${c.predicted}${c.stale ? ' ⚠️' : ''}`, c.hit ? '✅' : '❌',
            ])}
          />
        )}
      </Section>

      <Section title="AI(Gemini) 정확도">
        <p className="text-[11px] text-text-secondary">
          원본 {d.gemini.raw ?? d.gemini.total}건 → 같은 종목·같은 날 1건으로 묶어 {d.gemini.total}건 · 채점 가능{' '}
          {d.gemini.judged}건 · 적중 {d.gemini.rate}% · 기준선(무조건 매수 5일 뒤 상승) {d.gemini.baselineUp5}%
        </p>
        <Table
          headers={['신호', '건수', '적중', '적중률']}
          rows={d.gemini.bySignal.map((b) => [b.signal, b.n, b.correct, `${b.rate}%`])}
        />
        <Table
          headers={['신뢰도', '건수', '적중률']}
          rows={d.gemini.byConfidence.map((b) => [b.band, b.n, `${b.rate}%`])}
        />
      </Section>
    </div>
  );
}

export default function DiagnoseView() {
  const { reports, loading, listError, selected, select, detail, detailError, progress, runError, run } =
    useDiagnose();
  const running = progress?.running ?? false;
  const s = selected?.summary ?? null;

  return (
    <div className="h-full overflow-auto p-3">
      <div className="space-y-3">
        <header className="flex flex-wrap items-center gap-3">
          <div>
            <h2 className="text-sm font-semibold text-text-primary">🩺 진단 리포트</h2>
            <p className="text-[11px] text-text-muted">
              스윙·목표 수익률·급등·AI 가 실제로 쓸모 있는지 과거 데이터로 확인합니다 (기준선과 나란히).
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {reports.length > 0 && (
              <select
                value={selected?.id ?? ''}
                onChange={(e) => select(Number(e.target.value))}
                className="rounded border border-border bg-bg-tertiary px-2 py-1 text-[11px]"
                aria-label="과거 리포트"
              >
                {reports.map((r) => (
                  <option key={r.id} value={r.id}>
                    {new Date(r.createdAt).toLocaleString('ko-KR')} · {r.server}
                    {r.summary.quick ? ' · quick' : ''}
                  </option>
                ))}
              </select>
            )}
            <button
              type="button"
              onClick={() => void run()}
              disabled={running}
              className="rounded bg-accent px-2.5 py-1 text-[11px] font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
            >
              {running ? '실행 중…' : '▶ 진단 실행'}
            </button>
          </div>
        </header>

        {running && progress && (
          <div className="rounded-lg border border-border bg-bg-secondary px-3 py-2">
            <div className="mb-1 flex justify-between text-[11px] text-text-secondary">
              <span>
                {progress.step}/{progress.total} {progress.label}
              </span>
              <span>1분 안팎 걸립니다 — 다른 화면으로 가도 계속 돕니다</span>
            </div>
            <div className="h-1.5 rounded bg-bg-tertiary">
              <div
                className="h-full rounded bg-accent transition-all"
                style={{ width: `${Math.max(5, (progress.step / progress.total) * 100)}%` }}
              />
            </div>
          </div>
        )}

        {(runError || listError) && (
          <p className="rounded border border-bearish/40 bg-bearish/10 px-3 py-2 text-[11px] text-bearish">
            {runError ?? listError}
          </p>
        )}

        {!loading && !reports.length && !running && (
          <p className="rounded-lg border border-border bg-bg-secondary px-3 py-6 text-center text-xs text-text-muted">
            아직 진단 리포트가 없습니다. [▶ 진단 실행] 을 누르면 관심 목록으로 진단합니다.
          </p>
        )}

        {s && (
          <>
            <p className="text-[11px] text-text-muted">
              대상 {s.symbols.length}종목 ({s.source}) · 판정 기준 {s.profile} · 실행 {s.elapsed}초 · {s.server}
              {s.quick && ' · quick'}
            </p>
            <Cards s={s} />
            {detailError && <p className="text-[11px] text-bearish">상세를 불러오지 못했습니다: {detailError}</p>}
            {detail && <Details d={detail} s={s} />}
          </>
        )}

        <p className="text-[11px] text-text-muted">
          ⚠️ 모든 숫자는 과거 데이터의 빈도이며 예측이 아닙니다. 표본이 30건 미만이면 "표본 부족" 으로
          표시합니다. 이 분석은 투자 조언이 아닙니다.
        </p>
      </div>
    </div>
  );
}
