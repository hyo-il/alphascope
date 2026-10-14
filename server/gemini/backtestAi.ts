/**
 * 백테스트 AI 도움 — 「AI에게 결과 설명 듣기」(`explainBacktest`, v2.38.0). **버튼 한 번에 Gemini 1회**, 버튼으로만 부른다.
 * 그 결과의 숫자만 보낸다. 응답 문장 속 % 숫자가 입력 숫자(±0.05)에 없으면 그 문장을 뺀다(뉴스 판정의 인용 검증과 같은 생각).
 * 설명은 그 기록에 저장해 다시 열 때 Gemini 를 부르지 않는다.
 * v2.44.0 에 「AI에게 조건 물어보기」(조언)를 지웠다 — 방법이 「매매 규칙 고르기」 가 되어 채울 숫자 칸이 없어졌다.
 *
 * ⚠️ `gemini_analysis` 에 저장하지 않는다(매매 신호가 아니다). 주문·자동매매와 무관하다.
 * 프롬프트·스키마를 고치면 버전(`EXPLAIN_PROMPT_VERSION`)을 올린다.
 */
import { callGemini, type GeminiCallOptions, type GeminiCallResult } from './client';
import type { BacktestCondition, BacktestCustomReport, BacktestExplain, ConditionLabel } from '../../src/types/backtest';
import { CONDITION_LABELS, methodName } from '../../src/types/backtest';
import { ruleBuyText, ruleSellText } from '../../src/utils/ruleText';

// v2 (v2.39.0): 조언에 익절 추가 · 설명은 조건 비교 모양(조건 1개도 같은 모양) + MDD·Profit Factor 숫자
// v3 (v2.40.0): 초등학생도 아는 쉬운 말 규칙(전문용어 풀이·한 문장 40자 안팎·숫자 1~2개·용어집 이름·"방법 1·2·3")
/** v4 (v2.44.0) — 방법 = 매매 규칙(이름·매수·매도 조건 문장). 프롬프트·스키마를 고치면 올린다 */
export const EXPLAIN_PROMPT_VERSION = 'bt-explain-v4';

/** 쉬운 말 규칙 (v2.40.0) */
const EASY_RULES = [
  '쉬운 말 규칙: 초등학생도 아는 말로 씁니다. MDD·Profit Factor·RSI·이동평균·트레일링 같은 전문용어를 쓰면 같은 문장에서 쉬운 말로 풀어 줍니다',
  '(예: "MDD(가장 크게 떨어졌던 폭)", "트레일링(최고가보다 정한 만큼 내려가면 매도)").',
  '한 문장은 40자 안팎, 한 문장에 숫자는 1~2개만 씁니다.',
  '용어: 사고팔기는 "매수·매도", 산 값은 "매수가", 시험한 조건 묶음은 "방법 1·방법 2·방법 3" 이라고 부릅니다.',
].join(' ');
type Caller = <T>(o: GeminiCallOptions) => Promise<GeminiCallResult<T>>;
const defaultCaller: Caller = (o) => callGemini(o);

const r2 = (v: number) => Math.round(v * 100) / 100;


interface RawExplain {
  summary?: string[];
  byCondition?: { label?: string; good?: string[]; bad?: string[] }[];
  cautions?: string[];
}

const EXPLAIN_SCHEMA = {
  type: 'OBJECT',
  properties: {
    summary: { type: 'ARRAY', items: { type: 'STRING' }, maxItems: 3 },
    byCondition: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          label: { type: 'STRING', enum: ['A', 'B', 'C'] },
          good: { type: 'ARRAY', items: { type: 'STRING' }, maxItems: 2 },
          bad: { type: 'ARRAY', items: { type: 'STRING' }, maxItems: 2 },
        },
        required: ['label', 'good', 'bad'],
      },
      maxItems: 3,
    },
    cautions: { type: 'ARRAY', items: { type: 'STRING' }, maxItems: 2 },
  },
  required: ['summary', 'byCondition', 'cautions'],
};

const EXPLAIN_SYSTEM = [
  '당신은 주식 초보자에게 자동매매 규칙의 과거 시험(백테스트) 결과를 쉬운 한국어로 설명하는 도우미입니다.',
  '규칙: 1) 입력 표에 없는 숫자를 쓰지 않습니다. 숫자를 쓸 때는 표의 값을 그대로 옮깁니다(새로 계산하지 않습니다).',
  '2) 미래를 말하지 않습니다(앞으로 오른다·벌 것이다 금지). 3) 수익을 약속하지 않습니다.',
  '4) "조건을 바꾸면 더 좋아진다" 식의 권유는 "여러 조건을 바꿔 보며 고르면 우연에 속기 쉽다" 와 함께만 씁니다.',
  '5) 방법이 여러 개면 어느 방법이 가장 좋다고 고르지 않습니다 — 차이를 설명하고, 여러 방법을 비교해 고르면 우연에 속기 쉽다는 점을 함께 말합니다.',
  '6) MDD 는 "가장 크게 떨어졌던 폭", Profit Factor 는 "번 돈 ÷ 잃은 돈" 이라고 풀어 씁니다.',
  '7) summary 는 3문장 이하, byCondition 은 방법마다 good·bad 각 2개 이하, cautions 는 2개 이하.',
  '8) byCondition 의 label 칸에는 입력의 (label A/B/C) 값을 넣고, 문장 안에서는 "방법 1·2·3" 으로 부릅니다.',
  `9) ${EASY_RULES}`,
].join('\n');

const ruleText = (c: BacktestCondition, n: (v: number | null | undefined) => string) =>
  `매매 규칙 「${c.ruleName}」 — 매수: ${ruleBuyText(c.rule, (v) => n(v))} / 매도: ${ruleSellText(c.rule, (v) => n(v))}`;

/** 설명에 보낼 숫자 표 — 검증도 이 숫자로 한다(차이 숫자도 미리 계산해 넣는다 — 모델이 새로 빼지 않게) */
export function explainPayload(r: BacktestCustomReport): { text: string; numbers: number[] } {
  const numbers: number[] = [];
  const n = (v: number | null | undefined) => {
    if (v == null) return '—';
    numbers.push(v);
    return String(v);
  };
  const diff = (a: number | null | undefined, b: number | null | undefined) => (a == null || b == null ? null : r2(a - b));
  const lines: string[] = [];
  lines.push(`기간 ${n(r.input.years)}년 · 종목 ${n(r.conditions[0]?.summary.symbols ?? 0)}개 · 수수료 왕복 ${n(0.3)}%p 포함 · 숫자는 모두 종목 평균(%)`);
  lines.push(`그냥 들고 있기: 기간 전체 ${n(r.hold.rule)} · MDD ${n(r.hold.mdd)}`);
  for (const c of r.conditions) {
    const s = c.summary;
    lines.push('', `${methodName(c.label)} (label ${c.label}): ${ruleText(c.condition, n)}`);
    lines.push(`- 기간 전체 ${n(s.rule)} · 아무 날이나 매수·매도 ${n(s.random)} · 이 방법 − 들고 있기 ${n(diff(s.rule, s.hold))} · 이 방법 − 아무 날이나 ${n(diff(s.rule, s.random))}`);
    lines.push(`- MDD(가장 크게 떨어졌던 폭) ${n(s.mdd)}${s.mddWorst ? ` · 가장 나쁜 종목 ${s.mddWorst.name ?? s.mddWorst.symbol} ${n(s.mddWorst.value)}` : ''} · Profit Factor(번 돈 ÷ 잃은 돈) ${s.profitFactor != null ? n(s.profitFactor) : (s.profitFactorNote ?? '—')}`);
    lines.push(`- 한 번 매수·매도할 때 평균 ${n(s.avgTradeReturn)} · 이긴 거래 ${n(s.winRate)} · 종목당 거래 ${n(s.avgTrades)}회 · 거래 10회 미만 종목 ${n(s.weakSymbols)}개`);
    if (s.exits) {
      lines.push(`- 매도한 이유 비율: 매도 신호 ${n(s.exits.signal)} · 손절 ${n(s.exits.stop)} · 익절 ${n(s.exits.take_profit)} · 트레일링 ${n(s.exits.trailing)} · 시험 기간이 끝나 정리 ${n(s.exits.end)}`);
    }
    if (c.segmentRows.length) {
      lines.push(`- 구간별(이 조건 / 들고 있기): ${c.segmentRows.map((g) => `${g.segment}년차 ${n(g.rule)} / ${n(g.hold)}`).join(' · ')}`);
    }
  }
  // 조건이 하나일 때만 종목별 표를 보낸다(여럿이면 조건별 숫자표만 — 지시서 B-4)
  if (r.conditions.length === 1) {
    lines.push('', '종목별(기간 전체):', '| 종목 | 분야 | 횟수 | 이긴 거래 | 한 번 평균 | 손절 비율 | 이 방법 | 들고 있기 | 아무 날이나 | MDD |');
    for (const x of r.conditions[0].symbols) {
      lines.push(
        `| ${x.name ?? x.symbol}(${x.symbol}) | ${x.sector ?? '분야 미확인'} | ${n(x.trades)} | ${n(x.winRate)} | ${n(x.avgReturn)} | ${n(x.stopRate)} | ${n(x.rule)} | ${n(x.hold)} | ${n(x.random)} | ${n(x.mdd)} |`,
      );
    }
  }
  if (r.excluded.length) lines.push('', `계산하지 못한 종목 ${n(r.excluded.length)}개`);
  return { text: lines.join('\n'), numbers };
}

/** 문장 속 % 숫자가 입력 숫자(반올림 ±0.05, 부호 무시)에 모두 있으면 통과 */
export function sentenceOk(sentence: string, numbers: number[]): boolean {
  const found = [...sentence.matchAll(/([+\-−]?\d+(?:[.,]\d+)?)\s*%/g)].map((m) => Math.abs(Number(m[1].replace('−', '-').replace(',', '.'))));
  return found.every((x) => numbers.some((v) => Math.abs(Math.abs(v) - x) <= 0.05 + 1e-9));
}

export async function explainBacktest(report: BacktestCustomReport, caller: Caller = defaultCaller): Promise<BacktestExplain> {
  const { text, numbers } = explainPayload(report);
  const ask = report.conditions.length > 1 ? '방법들의 차이를 초보자에게 쉬운 말로 설명해 주세요(어느 방법이 가장 좋다고 고르지 마세요).' : '이 결과를 초보자에게 쉬운 말로 설명해 주세요.';
  const res = await caller<RawExplain>({ system: EXPLAIN_SYSTEM, parts: [{ text: `${text}\n\n${ask}` }], schema: EXPLAIN_SCHEMA, temperature: 0.3 });
  let removed = 0;
  const keep = (a: unknown, max: number) => {
    const list = Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string' && x.trim() !== '').slice(0, max) : [];
    const ok = list.filter((s) => sentenceOk(s, numbers));
    removed += list.length - ok.length;
    return ok;
  };
  const d = res.data ?? {};
  const labels = new Set<ConditionLabel>(report.conditions.map((c) => c.label));
  // 입력에 없는 조건 이름은 버린다 · 조건마다 하나만
  const seen = new Set<string>();
  const byCondition = (Array.isArray(d.byCondition) ? d.byCondition : [])
    .filter((x) => x && CONDITION_LABELS.includes(x.label as ConditionLabel) && labels.has(x.label as ConditionLabel) && !seen.has(x.label!) && seen.add(x.label!))
    .map((x) => ({ label: x.label as ConditionLabel, good: keep(x.good, 2), bad: keep(x.bad, 2) }));
  return {
    summary: keep(d.summary, 3),
    byCondition,
    cautions: keep(d.cautions, 2),
    removed,
    promptVersion: EXPLAIN_PROMPT_VERSION,
    model: res.model,
    createdAt: new Date().toISOString(),
  };
}
