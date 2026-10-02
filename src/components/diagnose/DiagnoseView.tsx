import { useId, useState, type ReactNode } from 'react';
import { useDiagnose } from '../../hooks/useDiagnose';
import { useStockNames } from '../../hooks/useStockNames';
import { modal, toast } from '../../store/uiStore';
import type { DiagnoseDetail, DiagnoseSummary } from '../../types/diagnose';
import { GEMINI_TRIGGER_LABEL } from '../../types/gemini';
import StockName from '../common/StockName';
import TrashIcon from '../common/TrashIcon';

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
/** "+3.2%" 같은 문자열 숫자 — 부호로 색을 정한다 (리포트의 numbers 는 문자열이다) */
const toneText = (v: string | null | undefined) => {
  const n = Number.parseFloat(String(v ?? '').replace(/[^0-9.+-]/g, ''));
  return Number.isFinite(n) ? tone(n) : 'text-text-secondary';
};
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
/** 적중률 vs 기준선 — 높으면 초록, 낮거나 같으면 빨강. 기준선이 없으면 색 없음 */
const vsBase = (rate: number | null | undefined, base: number | null | undefined) =>
  isNum(rate) && isNum(base) ? (rate > base ? 'text-bullish' : 'text-bearish') : '';

/**
 * 등급 색 — STRONG·BUY 초록 / WATCH 주황 / HOLD 회색 / AVOID·ERROR 빨강 (v2.22.0).
 * 앱 공통 4색만 쓴다.
 */
const GRADE_TONE: Record<string, string> = {
  STRONG: 'text-bullish',
  BUY: 'text-bullish',
  WATCH: 'text-warning',
  HOLD: 'text-text-secondary',
  AVOID: 'text-bearish',
  ERROR: 'text-bearish',
};
const Grade = ({ g }: { g: string }) => <span className={GRADE_TONE[g] ?? ''}>{g}</span>;

/**
 * 카드 판정 (v2.22.0) — **리포트에 이미 있는 숫자와 기준선만** 비교한다. 새 기준을 만들지 않는다.
 * 표본 부족(weak)이거나 값이 없으면(옛 리포트) 판단 보류.
 */
type Verdict = 'good' | 'bad' | 'hold';

/**
 * 판정 + 그 판정의 비교식 한 줄 (v2.30.0 — 배지 툴팁). **같은 값**으로 판정과 문구를 함께 만든다 —
 * 문구를 따로 만들면 판정과 툴팁이 갈라진다.
 *   value / base: 비교한 두 숫자, valueLabel / baseLabel: 이름, unit: 단위, sample: 표본 설명("채점 12건" 등)
 */
interface Judgement {
  verdict: Verdict;
  why: string;
}
function judge(o: {
  weak: boolean | undefined;
  /** 표본이 모자랄 때의 문구 — 카드마다 표본 기준이 다르다 */
  weakWhy: string;
  value: unknown;
  base: unknown;
  valueLabel: string;
  baseLabel: string;
  unit: string;
  /** 부호를 붙이는 값(수익률·기대값) */
  signed?: boolean;
}): Judgement {
  if (o.weak) return { verdict: 'hold', why: o.weakWhy };
  if (!isNum(o.value) || !isNum(o.base)) return { verdict: 'hold', why: '비교할 숫자가 없는 리포트라 판단 보류' };
  const fmt = (v: number) => `${o.signed && v > 0 ? '+' : ''}${v}${o.unit}`;
  const good = o.value > o.base;
  return {
    verdict: good ? 'good' : 'bad',
    why: `${o.valueLabel} ${fmt(o.value)} ${good ? '>' : '≤'} ${o.baseLabel} ${fmt(o.base)}`,
  };
}

/** 배지 — 색만으로 구분하지 않는다(기호 + 글자, v2.28.0 기호 추가). 위 「이 화면은 무엇인가요?」 의 설명도 이 값을 쓴다 */
const VERDICT_STYLE: Record<Verdict, { mark: string; label: string; badge: string; border: string }> = {
  good: { mark: '🟢', label: '기준선보다 좋음', badge: 'bg-bullish/15 text-bullish', border: 'border-bullish/40' },
  bad: { mark: '🔴', label: '기준선 이하', badge: 'bg-bearish/15 text-bearish', border: 'border-bearish/40' },
  hold: { mark: '⚪', label: '판단 보류', badge: 'bg-bg-tertiary text-text-secondary', border: 'border-border' },
};

// ── 쉬운 설명 (v2.28.0) ─────────────────────────────────────────────────────
// 숫자·판정·카드 구조는 바꾸지 않는다 — 읽는 법만 더한다. 접힘 상태는 이 기기의 화면 설정이라 localStorage.
const HELP_KEY = 'alphascope.diagnoseHelpCollapsed';

function HelpBox() {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(HELP_KEY) === '1';
    } catch {
      return false;
    }
  });
  const toggle = () =>
    setCollapsed((v) => {
      try {
        localStorage.setItem(HELP_KEY, v ? '0' : '1');
      } catch {
        /* 저장이 막힌 브라우저 — 이번 화면에서만 */
      }
      return !v;
    });
  const badge = (v: Verdict) => (
    <span className={`rounded px-1.5 py-0.5 ${VERDICT_STYLE[v].badge}`}>
      {VERDICT_STYLE[v].mark} {VERDICT_STYLE[v].label}
    </span>
  );
  return (
    <section className="rounded-lg border border-border bg-bg-secondary">
      <button
        type="button"
        onClick={toggle}
        aria-expanded={!collapsed}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-text-primary"
      >
        ❓ 이 화면은 무엇인가요?
        <span className="ml-auto font-normal text-text-muted">{collapsed ? '펼치기 ▾' : '접기 ▴'}</span>
      </button>
      {!collapsed && (
        <div className="space-y-2.5 border-t border-border px-3 py-2.5 text-[15px] leading-relaxed text-text-secondary">
          <p>
            이 앱은 여러 가지 "신호"를 냅니다. 스윙 추천, 급등 탐지, Gemini 의 매수·매도 판단, 뉴스의 긍정·부정 판정 같은 것들입니다.
            <br />
            진단 리포트는 이 신호들이 <b className="text-text-primary">과거에 실제로 맞았는지 채점하는 성적표</b>입니다. 지금 무엇을 사라고 알려
            주는 화면이 아닙니다.
          </p>
          <p>
            <b className="text-text-primary">어떻게 채점하나요?</b> 신호가 나온 뒤 실제 주가가 어떻게 움직였는지 봅니다. 그리고{' '}
            <b className="text-text-primary">기준선</b>과 비교합니다 — "아무 생각 없이 샀을 때" 나 "우연히 맞힐 확률", "본전(0)" 같은 비교
            대상이고, 카드마다 다르므로 각 카드 제목 아래에 적어 두었습니다. 기준선보다 나아야 그 신호가 쓸모 있다고 봅니다.
          </p>
          <div>
            <b className="text-text-primary">배지 읽는 법</b>
            <ul className="mt-1 space-y-1">
              <li>{badge('good')} — 기준선보다 결과가 좋았습니다. (수익이 났다는 뜻과 같지는 않습니다.)</li>
              <li>{badge('bad')} — 기준선보다 나을 게 없었습니다. 이 신호만 믿고 사면 안 됩니다.</li>
              <li>{badge('hold')} — 채점한 기록이 아직 적어 결론을 낼 수 없습니다. 기록이 쌓일 때까지 기다립니다.</li>
            </ul>
          </div>
          <p>
            <b className="text-text-primary">언제 보나요?</b> 한 달에 한 번쯤 [▶ 진단 실행]을 눌러 보세요. 같은 신호가 몇 달 계속{' '}
            {VERDICT_STYLE.bad.mark} 이면 그 기능은 참고만 하세요.
          </p>
          <p className="text-warning">⚠️ 과거 성적이 좋아도 앞으로 맞는다는 보장은 없습니다.</p>
        </div>
      )}
    </section>
  );
}

/** 종목 칸 — 이름 먼저, 티커 뒤(이름을 모르면 티커만) */
const Sym = ({ symbol }: { symbol: string }) => <StockName symbol={symbol} size="sm" className="max-w-[180px]" />;

function Card({
  title,
  hint,
  weak,
  judgement,
  numbers,
  conclusion,
}: {
  title: string;
  /** 무엇을 묻나 · 어떻게 읽나 — 한 줄 (v2.28.0) */
  hint: string;
  weak: boolean;
  /** 판정과 그 비교식 (v2.30.0) — 배지 툴팁이 `why` 를 보인다 */
  judgement: Judgement;
  numbers: { label: string; value: ReactNode }[];
  conclusion: string;
}) {
  const { verdict, why } = judgement;
  const style = VERDICT_STYLE[verdict];
  const whyId = useId();
  return (
    <div className={`flex flex-col rounded-lg border bg-bg-secondary p-3 ${style.border}`}>
      <div className="mb-2 flex items-start gap-2">
        <p className="text-xs font-semibold text-text-primary">{title}</p>
        {/* 예전 "표본 부족" 배지와 합쳤다 — 표본이 모자라면 판정 없이 회색 */}
        {/* 마우스를 올리면(키보드 포커스로도) 이 카드의 실제 비교식 — 판정과 같은 값에서 만든다 (v2.30.0) */}
        <span
          tabIndex={0}
          title={why}
          aria-describedby={whyId}
          className={`ml-auto shrink-0 cursor-help rounded px-1.5 py-0.5 text-[14px] ${style.badge}`}
        >
          {style.mark} {style.label}
          {verdict === 'hold' && weak ? ' · 표본 부족' : ''}
        </span>
        <span id={whyId} className="sr-only">
          {why}
        </span>
      </div>
      {/* 읽는 법 한 줄 — 배지 옆 좁은 칸에 두면 세로로 길어져 카드 전체 폭에 둔다 */}
      <p className="-mt-1 mb-2 text-[14px] leading-snug text-text-secondary">{hint}</p>
      <dl className="space-y-1 text-[14px]">
        {numbers.map((n) => (
          <div key={n.label} className="flex justify-between gap-2">
            <dt className="text-text-secondary">{n.label}</dt>
            <dd className="tabular-nums text-text-primary">{n.value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-auto border-t border-border pt-2 text-[14px] leading-relaxed text-text-secondary">
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
        hint={'스윙 추천이 BUY 를 낸 날 샀다면 20거래일 뒤 평균 몇 % 였는지 봅니다. 플러스면 좋은 신호입니다(기준선 = 0).'}
        weak={s.swing.weak}
        judgement={judge({
          weak: s.swing.weak,
          weakWhy: `과거 BUY 이상 ${s.swing.buyTotal}일 — 30일 미만이라 판단 보류`,
          value: s.swing.forward?.d20,
          base: 0,
          valueLabel: 'BUY 뒤 20일 평균',
          baseLabel: '기준선',
          unit: '%',
          signed: true,
        })}
        numbers={[
          { label: `과거 ${s.swing.window}거래일 BUY 이상`, value: `${s.swing.buyTotal}일 (${s.swing.buyRate}%)` },
          { label: 'BUY 뒤 20일 평균', value: <span className={tone(s.swing.forward?.d20)}>{signed(s.swing.forward?.d20)}</span> },
          { label: '20일 뒤 플러스 종목', value: `${s.swing.positive20}/${s.swing.withBuy}` },
        ]}
        conclusion={s.swing.conclusion}
      />
      <Card
        title="2. 목표를 3% 로 작게 잡으면 달라지나?"
        hint={'아무 날이나 종가에 사서 10거래일 안에 +3% / −1.5% 중 먼저 닿는 쪽으로 정리했다면 한 번에 평균 몇 %p 였는지 봅니다(수수료 포함, 둘 다 안 닿으면 0). 0 보다 크면 좋음, SPY 는 시장 비교용입니다.'}
        weak={s.target.weak}
        judgement={judge({
          weak: s.target.weak,
          weakWhy: '계산한 종목이 없어 판단 보류',
          value: s.target.avgExp,
          base: 0,
          valueLabel: '기대값(비용 반영)',
          baseLabel: '기준선',
          unit: '%p',
          signed: true,
        })}
        numbers={[
          { label: '+3%/−1.5%/10일 목표 먼저', value: plain(s.target.avgHit) },
          { label: '기대값 (비용 반영)', value: <span className={tone(s.target.avgExp)}>{signed(s.target.avgExp, '%p')}</span> },
          { label: 'SPY 기대값', value: <span className={tone(s.target.spyExp)}>{signed(s.target.spyExp, '%p')}</span> },
        ]}
        conclusion={s.target.conclusion}
      />
      <Card
        title="3. 급등 탐지의 주기 예측이 맞나?"
        hint={'급등 탐지가 "다음 급등일" 을 맞힌 비율을, 우연히 맞을 비율(기준선)과 비교합니다.'}
        weak={s.surge.weak}
        judgement={judge({
          weak: s.surge.weak,
          weakWhy: `주기 적중 표본 ${s.surge.cases}건 — 30건 미만이라 판단 보류`,
          value: s.surge.hitRate,
          base: s.surge.baseline,
          valueLabel: '주기 적중',
          baseLabel: '우연 기준선',
          unit: '%',
        })}
        numbers={[
          { label: `주기 적중 (${s.surge.cases}건)`, value: `${s.surge.hitRate}% vs 우연 ${s.surge.baseline}%` },
          { label: `급등 다음 날 매수 (${s.surge.chase.n}건) 5일`, value: <span className={tone(s.surge.chase.d5)}>{signed(s.surge.chase.d5)}</span> },
          { label: '+5% 먼저 / −5% 먼저', value: `${s.surge.chase.up5}% / ${s.surge.chase.down5}%` },
        ]}
        conclusion={s.surge.conclusion}
      />
      <Card
        title="4. Gemini 분석은 정확한가? (Gemini 만)"
        hint={'Gemini 의 매수·매도 판단이 5거래일 뒤 맞은 비율을, 그냥 "오른다" 고 찍었을 때(5일 뒤 상승 비율)와 비교합니다.'}
        weak={s.ai.weak}
        judgement={judge({
          weak: s.ai.weak,
          weakWhy: `채점 ${s.ai.judged}건 — 30건 미만이라 판단 보류`,
          value: s.ai.rate,
          base: s.ai.baseline,
          valueLabel: '적중',
          baseLabel: '기준선(5일 뒤 상승 비율)',
          unit: '%',
        })}
        numbers={[
          { label: '적중률', value: `${s.ai.rate}% (채점 ${s.ai.judged}건)` },
          { label: '기준선 (5일 뒤 상승 비율)', value: `${s.ai.baseline}%` },
          { label: '분석 기록', value: `${s.ai.total}건 (원본 ${s.ai.raw}건)` },
          s.ai.claude
            ? { label: 'Claude 수동(별도·선택 편향)', value: `${s.ai.claude.rate}% (채점 ${s.ai.claude.judged}건)` }
            : { label: '출처', value: 'Claude 수동 분석이 섞인 옛 리포트' },
        ]}
        conclusion={s.ai.conclusion}
      />
      {s.news && (
        <Card
          title="5. 뉴스 AI 판정(긍정·부정)은 맞았나?"
          hint={'뉴스 긍정·부정 판정이 5거래일 뒤 주가 방향과 맞은 비율을, 그냥 "오른다" 고 찍었을 때와 비교합니다.'}
          weak={s.news.weak}
          judgement={judge({
            weak: s.news.weak,
            weakWhy: `5일 채점 ${s.news.d5?.judged ?? 0}건 — 30건 미만이라 판단 보류`,
            value: s.news.d5?.rate,
            base: s.news.d5?.baseline,
            valueLabel: '5거래일 뒤 적중',
            baseLabel: '기준선(무조건 상승)',
            unit: '%',
          })}
          numbers={[
            { label: '5거래일 뒤 적중', value: `${s.news.d5.rate}% (채점 ${s.news.d5.judged}건)` },
            { label: '기준선 (무조건 상승)', value: `${s.news.d5.baseline}%` },
            { label: '1거래일 뒤 적중 · 기준선', value: `${s.news.d1.rate}% · ${s.news.d1.baseline}% (${s.news.d1.judged}건)` },
            { label: '판정 기록', value: `${s.news.total}건 (원본 ${s.news.raw} · 판단 불가 ${s.news.undetermined})` },
          ]}
          conclusion={s.news.conclusion}
        />
      )}
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
      <table className="w-full text-[14px]">
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
  // 종목명은 다른 화면과 같은 캐시에서 받는다 (모르는 것만 한 번에)
  useStockNames([
    ...d.today.map((t) => t.symbol),
    ...d.replay.map((r) => r.symbol),
    ...Object.keys(d.freq),
    ...d.surge.cases.map((c) => c.symbol),
  ]);
  const geminiBase = d.gemini.baselineUp5;
  return (
    <div className="space-y-2">
      <Section title="스윙 — 오늘 기준">
        <Table
          headers={['종목', '등급', '점수', '추세', '타이밍', '모멘텀', '거래량', '손익비', 'RSI', '60일선', 'BUY 까지 모자란 것']}
          rows={d.today.map((t) =>
            t.error
              ? [<Sym symbol={t.symbol} />, <Grade g="ERROR" />, '—', '—', '—', '—', '—', '—', '—', '—', t.error]
              : [
                  <Sym symbol={t.symbol} />,
                  <Grade g={t.grade} />,
                  t.score,
                  ...['추세(30)', '타이밍(25)', '모멘텀(20)', '거래량(15)', '손익비(10)'].map(
                    (k) => `${t.conditions[k]?.score ?? '—'}/${t.conditions[k]?.max ?? '—'}`,
                  ),
                  t.numbers.RSI,
                  <span className={toneText(t.numbers['60일선거리'])}>{t.numbers['60일선거리']}</span>,
                  <span className="block max-w-[360px] text-left text-text-secondary">{t.missing.join(' / ') || '—'}</span>,
                ],
          )}
        />
      </Section>

      <Section title={`스윙 — 과거 ${s.swing.window}거래일 재현 · BUY 날 뒤 수익률`}>
        <p className="text-[14px] text-text-muted">각 날짜의 판정에는 그날까지의 봉만 넣었습니다(미래 차단).</p>
        <Table
          headers={['종목', '평가일수', 'STRONG', 'BUY', 'WATCH', 'HOLD', 'AVOID', '손익비 강등', 'BUY 날짜(최근 5)']}
          rows={d.replay.map((r) => [
            <Sym symbol={r.symbol} />, r.days,
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
                <Sym symbol={r.symbol} />, r.forward.d5.length,
                <span className={tone(a)}>{signed(a)}</span>,
                <span className={tone(b)}>{signed(b)}</span>,
                <span className={tone(c)}>{signed(c)}</span>,
              ];
            })}
          />
        ) : (
          <p className="text-[14px] text-text-muted">BUY 신호가 없어 이후 수익률을 낼 수 없습니다.</p>
        )}
      </Section>

      <Section title="목표 수익률 — 10거래일 안 목표 먼저 도달률 · 기대값">
        <p className="text-[14px] text-text-muted">
          매일 종가 매수 가정 · 같은 날 둘 다 닿으면 손절 · 왕복 비용 0.30%p 반영. 조건을 바꿔 보려면
          「투자 분석 &gt; 스윙 추천 &gt; 추천 종목」의 🎯 목표 도달 가능성 분석 결과 카드에서 과거 기준선을 볼 수 있습니다(지난 기록은 「추천 이력」 맨 아래).
        </p>
        <Table
          headers={['종목', 'ATR/일', ...TARGET_COLUMNS.map(([t, st]) => `+${t}/−${st}`)]}
          rows={Object.entries(d.freq).map(([symbol, f]) => [
            symbol === 'SPY' ? <b>SPY (시장)</b> : <Sym symbol={symbol} />,
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
        <p className="text-[14px] text-text-secondary">
          주기 판정 {d.surge.cases.length}건 · 적중{' '}
          <span className={vsBase(d.surge.hitRate, d.surge.baseline)}>{d.surge.hitRate}%</span> · 우연 기준선{' '}
          {d.surge.baseline}% · 차이 <span className={tone(d.surge.edge)}>{signed(d.surge.edge, '%p')}</span>
          {d.surge.staleCount > 0 && ` · 예상일이 이미 지난 경우 ${d.surge.staleCount}건`}
        </p>
        <Table
          headers={['규칙성 구간', '건수', '적중률', '기준선']}
          rows={d.surge.byRegularity.map((b) => [
            b.band, b.n, <span className={vsBase(b.hit, b.base)}>{b.hit}%</span>, `${b.base}%`,
          ])}
        />
        <p className="text-[14px] text-text-secondary">
          급등 다음 날 시가에 산 경우 {d.surge.chase.n}건: 1일{' '}
          <span className={tone(d.surge.chase.d1)}>{signed(d.surge.chase.d1)}</span> · 3일{' '}
          <span className={tone(d.surge.chase.d3)}>{signed(d.surge.chase.d3)}</span> · 5일{' '}
          <span className={tone(d.surge.chase.d5)}>{signed(d.surge.chase.d5)}</span> · 10일{' '}
          <span className={tone(d.surge.chase.d10)}>{signed(d.surge.chase.d10)}</span> / +5% 먼저{' '}
          {d.surge.chase.up5}% vs −5% 먼저 {d.surge.chase.down5}%
        </p>
        {d.surge.cases.length > 0 && (
          <Table
            headers={['기준일', '종목', '급등횟수', '규칙성', '평균간격', '예상일', '적중']}
            rows={d.surge.cases.slice(0, 30).map((c) => [
              c.asOf, <Sym symbol={c.symbol} />, c.surgeCount, `${c.regularity}%`, `${c.avgInterval}일`,
              // v2.20.0 부터 경과 일수를 적는다. 그 전에 저장된 리포트는 overdueDays 가 없어 ⚠️ 로 남긴다
              c.overdueDays != null
                ? `${c.predicted} — 예상일 지남(${c.overdueDays}일 경과)`
                : `${c.predicted}${c.stale ? ' ⚠️' : ''}`,
              c.hit ? <span className="text-bullish">✅</span> : <span className="text-bearish">❌</span>,
            ])}
          />
        )}
      </Section>

      <Section title="AI(Gemini) 정확도">
        <p className="text-[14px] text-text-secondary">
          원본 {d.gemini.raw ?? d.gemini.total}건 → 같은 종목·같은 날 1건으로 묶어 {d.gemini.total}건 · 채점 가능{' '}
          {d.gemini.judged}건 · 적중{' '}
          <span className={vsBase(d.gemini.rate, geminiBase)}>{d.gemini.rate}%</span> · 기준선(무조건 매수 5일 뒤 상승) {d.gemini.baselineUp5}%
        </p>
        <p className="text-[14px] text-text-muted">
          채점 규칙: {d.gemini.rule ?? '5봉 뒤 종가(v2.15.0 이전 규칙 — 장중 분석은 실제로 6거래일 뒤)'}
        </p>
        {d.gemini.claude ? (
          <p className="rounded border border-warning/30 bg-warning/10 px-2 py-1 text-[14px] text-warning">
            위 숫자는 Gemini 만입니다. Claude 수동 분석(별도): {d.gemini.claude.total}건 · 채점{' '}
            {d.gemini.claude.judged}건 · 적중 {d.gemini.claude.rate}% — 사용자가 고른 종목만이라 선택 편향이 있어
            직접 비교하지 않습니다.
          </p>
        ) : (
          <p className="text-[14px] text-text-muted">이 리포트(v2.16.0 이전)는 Claude 수동 분석이 위 숫자에 섞여 있습니다.</p>
        )}
        {d.gemini.byVersion && d.gemini.byVersion.length > 0 && (
          <Table
            headers={['프롬프트 버전(Gemini)', '건수', '채점', '적중률']}
            rows={d.gemini.byVersion.map((v) => [v.version, v.total, v.judged, v.rate == null ? '—' : `${v.rate}%`])}
          />
        )}
        {/* 출처별 (v2.30.0) — 같은 종목·같은 날 묶기는 출처별로. 채점 30건 미만이면 「표본 부족」 */}
        {d.gemini.bySource && d.gemini.bySource.length > 0 && (
          <Table
            headers={['출처(Gemini)', '건수', '채점', '적중률']}
            rows={d.gemini.bySource.map((v) => [
              GEMINI_TRIGGER_LABEL[v.source],
              v.total,
              v.judged,
              v.rate == null ? '—' : `${v.rate}%${v.judged < 30 ? ' · 표본 부족' : ''}`,
            ])}
          />
        )}
        <Table
          headers={['신호', '건수', '적중', '적중률']}
          rows={d.gemini.bySignal.map((b) => [
            b.signal, b.n, b.correct, <span className={vsBase(b.rate, geminiBase)}>{b.rate}%</span>,
          ])}
        />
        <Table
          headers={['신뢰도', '건수', '적중률']}
          rows={d.gemini.byConfidence.map((b) => [
            b.band, b.n, <span className={vsBase(b.rate, geminiBase)}>{b.rate}%</span>,
          ])}
        />
      </Section>
    </div>
  );
}

/** "2026-10-01 09:12" — 확인창 문구용 */
function stamp(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function DiagnoseView() {
  const { reports, loading, listError, selected, select, detail, detailError, progress, runError, run, remove } =
    useDiagnose();
  const running = progress?.running ?? false;
  const s = selected?.summary ?? null;

  /** 리포트 삭제 — DB 행만 지운다. 서버의 파일(맥 docs/analysis · 오라클 reports)은 남는다 */
  const confirmDelete = () => {
    if (!selected) return;
    const target = selected;
    modal.confirm({
      title: '진단 리포트 삭제',
      message: `${stamp(target.createdAt)} 리포트를 지울까요? 웹 목록에서만 지워지고, 서버의 파일은 남습니다.`,
      confirmText: '삭제',
      danger: true,
      onConfirm: async () => {
        try {
          await remove(target.id);
          toast.success('리포트를 지웠습니다');
        } catch (e) {
          toast.error('삭제 실패', (e as Error).message);
        }
      },
    });
  };

  return (
    <div className="h-full overflow-auto p-3">
      <div className="space-y-3">
        <header className="flex flex-wrap items-center gap-3">
          <div>
            <h2 className="text-sm font-semibold text-text-primary">🩺 진단 리포트</h2>
            <p className="text-[14px] text-text-muted">
              스윙·목표 수익률·급등·AI 가 실제로 쓸모 있는지 과거 데이터로 확인합니다 (기준선과 나란히).
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {reports.length > 0 && (
              <select
                value={selected?.id ?? ''}
                onChange={(e) => select(Number(e.target.value))}
                className="rounded border border-border bg-bg-tertiary px-2 py-1 text-[14px]"
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
            {selected && (
              <button
                type="button"
                onClick={confirmDelete}
                disabled={running}
                title="이 리포트 지우기 (웹 목록에서만)"
                aria-label="이 리포트 지우기"
                className="rounded border border-border p-1 text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-bearish disabled:opacity-40"
              >
                <TrashIcon className="h-3.5 w-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={() => void run()}
              disabled={running}
              className="rounded bg-accent px-2.5 py-1 text-[14px] font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
            >
              {running ? '실행 중…' : '▶ 진단 실행'}
            </button>
          </div>
        </header>

        {running && progress && (
          <div className="rounded-lg border border-border bg-bg-secondary px-3 py-2">
            <div className="mb-1 flex justify-between text-[14px] text-text-secondary">
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

        <HelpBox />

        {(runError || listError) && (
          <p className="rounded border border-bearish/40 bg-bearish/10 px-3 py-2 text-[14px] text-bearish">
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
            <p className="text-[14px] text-text-muted">
              대상 {s.symbols.length}종목 ({s.source}) · 판정 기준 {s.profile} · 실행 {s.elapsed}초 · {s.server}
              {s.quick && ' · quick'}
            </p>
            <Cards s={s} />
            {detailError && <p className="text-[14px] text-bearish">상세를 불러오지 못했습니다: {detailError}</p>}
            {detail && <Details d={detail} s={s} />}
          </>
        )}

        <p className="text-[14px] text-text-muted">
          ⚠️ 모든 숫자는 과거 데이터의 빈도이며 예측이 아닙니다. 카드 배지는 리포트의 숫자를 기준선과만
          비교합니다 — 표본이 30건 미만이면 "판단 보류 · 표본 부족" 으로 표시합니다. 이 분석은 투자 조언이 아닙니다.
        </p>
      </div>
    </div>
  );
}
