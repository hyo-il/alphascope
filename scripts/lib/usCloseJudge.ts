/**
 * 미국 마감 30분 뒤(16:30 ET) 값과 최종값으로 매수 판단 견주기 — `npm run ussample:judge` 와 시험(`ussample:judge:test`)이 같이 쓴다.
 *
 * 알고 싶은 것: 같은 규칙으로 그날 일봉을 16:30 표본 값(거래량 덜 모임)과 최종 표본 값으로 각각 판단하면 action · code · 점수가 바뀌는가.
 * - 견줄 종목 · 날짜: `compareGroups()` 묶음 가운데 16:25~16:30 표본(`near`)이 있는 것 · 최종값 = 그 묶음의 마지막 줄(20:30 ET 전이면 따로 센다).
 * - 판단: 종목마다 토스 일봉을 한 번 받아 그날(D)까지 자르고, D 봉의 다섯 칸만 두 값으로 바꾼 두 벌을 같은 함수 `judgeOnClose`
 *   (캔들을 넘기는 방식 · now = D 20:45 ET · 보유 없음)로 판단한다. 시장 기준(SPY)도 한 번 받아 D 까지 자른 최종값 한 벌을 두 판단에 같이 넘긴다.
 * - ⚠️ 앱 DB 는 읽기 전용 연결로 규칙 · 계좌 설정만 읽는다(`getDb()` 를 쓰지 않는다). 캔들 캐시를 거치지 않는다. 주문 없음.
 */
import type Database from 'better-sqlite3';
import { judgeOnClose, JUDGE_CANDLE_LIMIT } from '../../server/rules/judge';
import { completedDaily, type MarketRefData, type RuleEvaluation } from '../../server/rules/engine';
import type { MarketRefLoader } from '../../server/rules/marketRef';
import { computeIndicators } from '../../server/indicatorService';
import { marketDayTime } from '../../server/marketHours';
import { RECHECK_AT_MINUTES, type RecheckRow } from '../../server/buyJudge/recheck';
import { STRATEGIES_KEY, normalizeStrategy } from '../../server/autoTrading/store';
import { TossAuthError } from '../../src/services/toss/auth';
import { DEFAULT_RULE_NAME, cloneRuleBody, defaultRuleBody, usesMarketFilter, type RuleBody } from '../../src/types/tradingRule';
import { VERDICT_LABEL, verdictOf } from '../../src/types/buyJudge';
import { BUY_CONDITION_NAME } from '../../src/utils/ruleText';
import { MARKET_REF, isKrSymbol } from '../../src/utils/market';
import { marketDate } from '../../src/utils/marketDate';
import type { Candle } from '../../src/types/toss';
import { FIELDS, FIELD_LABEL, FINAL_MIN_OK, compareGroups, toMin, type SampleLine } from './usClose';
import { changeKind, volumeChangePct, type ChangeKind } from './recheckReport';

export { JUDGE_CANDLE_LIMIT };
type ReadDb = Pick<Database.Database, 'prepare'>;

// ── 규칙 ───────────────────────────────────────────────────────────────────
export interface JudgeRule {
  /** 저장된 규칙 id — 앱 기본값으로 대신했으면 null */
  id: number | null;
  name: string;
  body: RuleBody;
  /** 이 규칙으로 자동매매를 켠 계좌 */
  accountIds: number[];
}

/**
 * ① 「기본 규칙」(같은 이름이 여럿이면 id 가 가장 작은 것 · 지웠으면 앱 기본값) ② 자동매매를 켠 계좌들이 쓰는 규칙 — id 로 중복 없이.
 * 읽기 전용 연결로만 읽는다. 계좌 설정은 앱과 같은 `normalizeStrategy` 로 읽는다(켬 + 규칙 있음 + 계좌가 있음 = 앱의 `listActiveStrategies`).
 */
export function loadJudgeRules(db: ReadDb): JudgeRule[] {
  const ruleRow = (sql: string, arg: string | number) => db.prepare(sql).get(arg) as { id: number; name: string; rule_json: string } | undefined;
  const toBody = (json: string) => cloneRuleBody(JSON.parse(json) as RuleBody);
  const out: JudgeRule[] = [];
  const base = ruleRow(`SELECT id, name, rule_json FROM trading_rules WHERE name = ? ORDER BY id LIMIT 1`, DEFAULT_RULE_NAME);
  out.push(base ? { id: base.id, name: base.name, body: toBody(base.rule_json), accountIds: [] } : { id: null, name: `${DEFAULT_RULE_NAME}(앱 기본값 — 저장된 규칙 없음)`, body: defaultRuleBody(), accountIds: [] });

  let map: Record<string, Record<string, unknown>> = {};
  try {
    const row = db.prepare(`SELECT value FROM gemini_settings WHERE key = ?`).get(STRATEGIES_KEY) as { value: string } | undefined;
    map = row ? (JSON.parse(row.value) as typeof map) : {};
  } catch {
    map = {}; // 표가 없거나(새 DB) 값이 깨짐 — 계좌 규칙 없음
  }
  const accounts = (db.prepare(`SELECT id FROM paper_accounts ORDER BY id`).all() as { id: number }[]).map((a) => a.id);
  for (const accountId of accounts) {
    const saved = map[String(accountId)];
    if (!saved) continue;
    const s = normalizeStrategy(accountId, saved);
    if (!s.enabled || s.ruleId == null) continue;
    const have = out.find((r) => r.id === s.ruleId);
    if (have) {
      have.accountIds.push(accountId);
      continue;
    }
    const row = ruleRow(`SELECT id, name, rule_json FROM trading_rules WHERE id = ?`, s.ruleId);
    if (row) out.push({ id: row.id, name: row.name, body: toBody(row.rule_json), accountIds: [accountId] });
  }
  return out;
}

// ── 견줄 종목 · 날짜 ────────────────────────────────────────────────────────
export interface JudgeTarget {
  day: string;
  symbol: string;
  near: SampleLine;
  final: SampleLine;
}

/** 다섯 칸이 모두 유한한 숫자인가 — 아니면 토스 값을 빈 값으로 덮게 된다 */
const complete = (l: SampleLine) => FIELDS.every((f) => typeof l[f] === 'number' && Number.isFinite(l[f]));

/** 견줄 것 · 16:30 표본 없음 · 최종값 믿기 어려움(마지막 줄이 20:30 ET 전) · 기록 칸 빠짐 — 고르기는 `compareGroups` 그대로 */
export function pickTargets(lines: SampleLine[]): { targets: JudgeTarget[]; noNear: number; lateFinal: number; incomplete: number } {
  const targets: JudgeTarget[] = [];
  let noNear = 0;
  let lateFinal = 0;
  let incomplete = 0;
  for (const g of compareGroups(lines)) {
    if (!g.near) {
      noNear++;
      continue;
    }
    if (toMin(g.finalEt) < FINAL_MIN_OK) {
      lateFinal++;
      continue;
    }
    const final = g.rows[g.rows.length - 1];
    const near = g.rows.find((r) => r !== final && r.et === g.near!.et)!;
    if (!complete(near) || !complete(final)) {
      incomplete++;
      continue;
    }
    targets.push({ day: g.day, symbol: g.symbol, near, final });
  }
  return { targets, noNear, lateFinal, incomplete };
}

// ── 두 벌 ──────────────────────────────────────────────────────────────────
const fieldsOf = (l: SampleLine) => ({ open: l.open!, high: l.high!, low: l.low!, close: l.close!, volume: l.volume! });

/**
 * 받은 일봉을 D 까지 자르고(D 뒤 봉 버림) D 봉의 다섯 칸만 16:30 값 · 최종값으로 바꾼 두 벌. 앞 봉은 두 벌이 같은 객체다.
 * 받은 일봉에 D 봉이 없으면(거래정지 · 토스 누락) null.
 */
export function twoVersions(candles: Candle[], t: JudgeTarget): { partial: Candle[]; final: Candle[]; tossBar: Candle } | null {
  const upto = [...candles].sort((a, b) => a.timestamp - b.timestamp).filter((c) => marketDate(c.timestamp, t.symbol) <= t.day);
  const last = upto.at(-1);
  if (!last || marketDate(last.timestamp, t.symbol) !== t.day) return null;
  const head = upto.slice(0, -1);
  return { partial: [...head, { ...last, ...fieldsOf(t.near) }], final: [...head, { ...last, ...fieldsOf(t.final) }], tossBar: last };
}

// ── 판단 ───────────────────────────────────────────────────────────────────
type Breakdown = { key: string; score: number; max: number }[];
/** 매수 판단 기록 · 다시 계산과 같은 모양 — 켠 조건만 */
const breakdownOf = (ev: RuleEvaluation): Breakdown => ev.breakdown.filter((c) => c.on).map((c) => ({ key: c.key, score: c.score, max: c.max }));

export interface ChangedRow {
  /** `recheck.ts` 와 같은 줄 모양 — 같은 `changeKind` · `volumeChangePct` 를 쓴다 */
  row: RecheckRow;
  kind: ChangeKind;
  ruleName: string;
  /** 점수가 바뀐 조건 이름(거름망 이유가 바뀌었으면 「거름망」) */
  conditions: string[];
}

export interface JudgeResult {
  rules: JudgeRule[];
  days: string[];
  targets: number;
  usesRef: boolean;
  /** 시장 기준을 받지 못함 — 시장 필터 규칙은 두 판단 모두 「시장 데이터 없음」 */
  refMissing: boolean;
  compared: number;
  same: number;
  changed: ChangedRow[];
  /** 판단 못 함(일봉 부족 · 그날 봉 없음 · 판단 오류) — 종목·날짜 × 규칙 */
  skipped: number;
  skipReasons: Record<string, number>;
  /** 받지 못함 — 종목·날짜 × 규칙 */
  notFetched: number;
  notFetchedSymbols: string[];
  noNear: number;
  lateFinal: number;
  /** 16:30 · 최종 표본의 다섯 칸 가운데 빈 칸이 있다(견주지 않음) */
  incomplete: number;
  /** 16:30 표본과 최종 표본의 다섯 칸이 하나라도 다른 종목·날짜 수 */
  barsDiffer: number;
  /** 받은 최종 일봉의 D 봉이 기록 파일의 최종 표본과 다름(그 뒤 토스가 값을 고침) — 판단은 기록 파일 값으로 */
  tossDiffers: { day: string; symbol: string; fields: string[] }[];
  /** 토스 일봉 받기 횟수(종목마다 한 번 + 다시 시도) */
  calls: number;
  retries: number;
  /** 토스 호출 상한 = 종목 수 + 시장 기준 1 */
  callLimit: number;
}

export interface JudgeOptions {
  lines: SampleLine[];
  rules: JudgeRule[];
  /** 토스 일봉 받기(캐시를 거치지 않는다) — 시험은 가짜를 넘긴다. 실패는 던진다 */
  fetchDaily: (symbol: string) => Promise<Candle[]>;
}

const REF = MARKET_REF.US.symbol;
/** 판단 시각 — 다시 계산(74차)과 같은 D 20:45 ET */
export const judgeTimeOf = (day: string) => marketDayTime('US', day, RECHECK_AT_MINUTES * 60_000);

export async function judgeSamples(opts: JudgeOptions): Promise<JudgeResult> {
  const { targets, noNear, lateFinal, incomplete } = pickTargets(opts.lines.filter((l) => !isKrSymbol(l.symbol)));
  const usesRef = opts.rules.some((r) => usesMarketFilter(r.body));
  const symbols = [...new Set(targets.map((t) => t.symbol))].sort();
  const callLimit = symbols.length + (usesRef ? 1 : 0);
  // 견줄 것이 없으면 시장 기준도 받지 않는다
  const fetchList = usesRef && symbols.length && !symbols.includes(REF) ? [...symbols, REF] : symbols;

  // 받기 — 종목마다 한 번(실패면 다시 시도 1번). 토큰 발급 실패면 남은 종목은 부르지 않는다
  const got = new Map<string, Candle[] | null>();
  let calls = 0;
  let firsts = 0;
  let retries = 0;
  let authFailed = false;
  for (const s of fetchList) {
    if (authFailed) {
      got.set(s, null);
      continue;
    }
    if (++firsts > callLimit) throw new Error(`토스 호출 상한(${callLimit}번)을 넘었습니다 — 멈춥니다`);
    let candles: Candle[] | null = null;
    for (let attempt = 0; attempt < 2 && !candles && !authFailed; attempt++) {
      if (attempt) retries++;
      calls++;
      try {
        candles = await opts.fetchDaily(s);
      } catch (e) {
        if (e instanceof TossAuthError) authFailed = true;
      }
    }
    got.set(s, candles);
  }

  // 시장 기준 — 날짜마다 D 까지 자른 최종값 한 벌(지표 한 번). 두 판단이 같은 객체를 받는다
  const refByDay = new Map<string, Promise<MarketRefData | null>>();
  const refFor = (day: string): Promise<MarketRefData | null> => {
    let p = refByDay.get(day);
    if (!p) {
      const all = got.get(REF);
      const cut = all ? completedDaily(all.filter((c) => marketDate(c.timestamp, REF) <= day), REF, judgeTimeOf(day)) : [];
      p = cut.length ? computeIndicators(cut).then((series) => ({ market: 'US' as const, symbol: REF, name: MARKET_REF.US.name, candles: cut, series })) : Promise.resolve(null);
      refByDay.set(day, p);
    }
    return p;
  };
  const loaderFor = (day: string): MarketRefLoader => ({ get: (m) => (m === 'US' ? refFor(day) : Promise.resolve(null)), fetched: () => ({}) });

  const out: JudgeResult = {
    rules: opts.rules,
    days: [...new Set(targets.map((t) => t.day))].sort(),
    targets: targets.length,
    usesRef,
    refMissing: usesRef && !got.get(REF),
    compared: 0,
    same: 0,
    changed: [],
    skipped: 0,
    skipReasons: {},
    notFetched: 0,
    notFetchedSymbols: symbols.filter((s) => !got.get(s)),
    noNear,
    lateFinal,
    incomplete,
    barsDiffer: targets.filter((t) => FIELDS.some((f) => t.near[f] !== t.final[f])).length,
    tossDiffers: [],
    calls,
    retries,
    callLimit,
  };
  const skip = (why: string) => {
    out.skipped++;
    out.skipReasons[why] = (out.skipReasons[why] ?? 0) + 1;
  };

  for (const t of targets) {
    const candles = got.get(t.symbol);
    if (!candles) {
      out.notFetched += opts.rules.length;
      continue;
    }
    const v = twoVersions(candles, t);
    if (!v) {
      for (let i = 0; i < opts.rules.length; i++) skip('받은 일봉에 그날 봉 없음');
      continue;
    }
    const diff = FIELDS.filter((f) => v.tossBar[f] !== t.final[f]);
    if (diff.length) out.tossDiffers.push({ day: t.day, symbol: t.symbol, fields: diff.map((f) => FIELD_LABEL[f]) });
    const now = judgeTimeOf(t.day);
    const refs = loaderFor(t.day);
    for (const rule of opts.rules) {
      let a: RuleEvaluation;
      let b: RuleEvaluation;
      try {
        const ja = await judgeOnClose(t.symbol, rule.body, { held: false }, now, v.partial, refs);
        const jb = await judgeOnClose(t.symbol, rule.body, { held: false }, now, v.final, refs);
        if (ja.kind !== 'ok' || jb.kind !== 'ok') {
          skip(ja.kind === 'short' || jb.kind === 'short' ? '일봉 부족' : '끝나지 않은 봉');
          continue;
        }
        if (marketDate(ja.completed.at(-1)!.timestamp, t.symbol) !== t.day || marketDate(jb.completed.at(-1)!.timestamp, t.symbol) !== t.day) {
          skip('마지막 끝난 봉이 그날이 아님');
          continue;
        }
        a = ja.ev;
        b = jb.ev;
      } catch (e) {
        skip(`판단 오류: ${(e instanceof Error ? e.message : String(e)).slice(0, 80)}`);
        continue;
      }
      out.compared++;
      const ba = breakdownOf(a);
      const bb = breakdownOf(b);
      const same = a.action === b.action && a.code === b.code && a.score === b.score && JSON.stringify(ba) === JSON.stringify(bb) && (a.gateReason ?? null) === (b.gateReason ?? null);
      if (same) {
        out.same++;
        continue;
      }
      const row: RecheckRow = {
        id: 0,
        market_date: t.day,
        symbol: t.symbol,
        rule_id: rule.id ?? 0,
        source: 'judgment',
        account_ids: null,
        before_action: a.action,
        before_code: a.code,
        before_score: a.score,
        before_breakdown_json: JSON.stringify(ba),
        before_gate_reason: a.gateReason ?? null,
        before_at: null,
        after_action: b.action,
        after_code: b.code,
        after_score: b.score,
        after_max_score: b.maxScore,
        after_breakdown_json: JSON.stringify(bb),
        after_gate_reason: b.gateReason ?? null,
        bar_before_json: JSON.stringify(fieldsOf(t.near)),
        bar_after_json: JSON.stringify(fieldsOf(t.final)),
        checked_at: '',
      };
      const conditions = bb
        .filter((c) => ba.find((x) => x.key === c.key)?.score !== c.score)
        .map((c) => BUY_CONDITION_NAME[c.key as keyof typeof BUY_CONDITION_NAME] ?? c.key);
      if ((a.gateReason ?? null) !== (b.gateReason ?? null)) conditions.push('거름망');
      out.changed.push({ row, kind: changeKind(row), ruleName: rule.name, conditions });
    }
  }
  return out;
}

// ── 결과 글 ────────────────────────────────────────────────────────────────
const sign = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');
const verdict = (action: string | null, code: string | null, score: number | null) =>
  `${code == null ? '—' : VERDICT_LABEL[verdictOf(code)]}(${action} · ${code}) ${score}점`;
const pct = (v: number | null) => (v == null ? '모름' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(1)}%`);
const ruleLabel = (r: JudgeRule) => `${r.name}${r.id != null ? `(#${r.id})` : ''}${r.accountIds.length ? ` — 계좌 ${r.accountIds.join('·')}` : ''}`;

/** 터미널 결과 — `recheck:report` 와 같은 모양(머리 · 요약 · 달라진 줄 · 한 줄 결론) */
export function renderJudgeReport(r: JudgeResult): string {
  const kinds = { action: 0, code: 0, score: 0 };
  for (const c of r.changed) kinds[c.kind]++;
  const out: string[] = [];
  const period = r.days.length ? `${r.days[0]} ~ ${r.days.at(-1)} (${r.days.length}일)` : '견줄 날 없음';
  out.push(`미국 마감 30분 뒤(16:30 ET) 값 vs 최종값 매수 판단 — ${period} · 종목·날짜 ${r.targets}개`);
  out.push(`규칙: ${r.rules.map(ruleLabel).join(' · ')} — 사지 않은 상태(매수 쪽)만`);
  out.push(
    r.usesRef
      ? `시장 기준(${REF})은 두 판단 모두 최종값(지금 토스에서 받은 일봉을 그날까지 자름) — 두 판단은 그날 봉 다섯 칸만 다르다${r.refMissing ? ' · ⚠️ 시장 기준을 받지 못해 시장 필터 규칙은 두 판단 모두 「시장 데이터 없음」' : ''}`
      : `시장 기준은 두 판단 모두 최종값(시장 필터를 켠 규칙이 없어 받지 않음) — 두 판단은 그날 봉 다섯 칸만 다르다`,
  );
  out.push('');
  out.push(
    `견줌 ${r.compared}건 · 달라짐 ${r.changed.length}건(action 바뀜 ${kinds.action} · code 바뀜 ${kinds.code} · 점수만 바뀜 ${kinds.score}) · 같음 ${r.same}건 · ` +
      `판단 못 함(일봉 부족 등) ${r.skipped} · 최종값 믿기 어려움 ${r.lateFinal} · 토스 값이 기록과 다름 ${r.tossDiffers.length} · 토스 일봉 호출 ${r.calls}번`,
  );
  const priceDiffers = r.tossDiffers.filter((d) => d.fields.some((f) => f !== FIELD_LABEL.volume)).length;
  out.push(
    `(건 = 종목·날짜 × 규칙 · 최종값 믿기 어려움 · 토스 값이 기록과 다름 = 종목·날짜 수${r.tossDiffers.length ? `(가격 칸이 다름 ${priceDiffers})` : ''} · ` +
      `16:30 값이 최종값과 다른 종목·날짜 ${r.barsDiffer}개 · 16:30 표본 없음 ${r.noNear}개 · 기록 칸 빠짐 ${r.incomplete}개 · 받지 못함 ${r.notFetched}건` +
      `${r.notFetchedSymbols.length ? `(${r.notFetchedSymbols.join(',')})` : ''} · 다시 시도 ${r.retries}번 · 호출 상한 ${r.callLimit}번 + 다시 시도 · 호출 1번 = 일봉 300개 · 토스 요청 2쪽)`,
  );
  if (r.changed.length) {
    out.push('');
    out.push('달라진 줄 — 날짜 | 종목 | 규칙 | 16:30 → 최종 판단 | 거래량 변화 | 바뀐 조건');
    for (const c of r.changed) {
      const x = c.row;
      const judged =
        x.before_code === x.after_code && x.before_action === x.after_action
          ? `${VERDICT_LABEL[verdictOf(x.after_code)]}(${x.after_action} · ${x.after_code}) ${x.before_score} → ${x.after_score}점 (${sign(x.after_score - (x.before_score ?? 0))})`
          : `${verdict(x.before_action, x.before_code, x.before_score)} → ${verdict(x.after_action, x.after_code, x.after_score)}`;
      out.push(`${x.market_date} | ${x.symbol} | ${c.ruleName} | ${judged} | ${pct(volumeChangePct(x))} | ${c.conditions.join(' · ') || '—'}`);
    }
  }
  if (r.tossDiffers.length) {
    out.push('');
    out.push((priceDiffers ? '⚠️ 가격 칸이 다른 줄은 따로 보세요(그 뒤 토스가 앞 봉을 고쳤을 수 있음 — 앞 봉은 지금 토스 값). ' : '') + '토스 값이 기록과 다름(판단은 기록 파일 값으로): ' + r.tossDiffers.slice(0, 10).map((d) => `${d.day} ${d.symbol}(${d.fields.join('·')})`).join(' · ') + (r.tossDiffers.length > 10 ? ` 외 ${r.tossDiffers.length - 10}개` : ''));
  }
  const reasons = Object.entries(r.skipReasons);
  if (reasons.length) {
    out.push('');
    out.push('판단 못 함 이유: ' + reasons.map(([why, n]) => `${why} ${n}건`).join(' · '));
  }
  out.push('');
  out.push(conclusionOf(r, kinds.action));
  return out.join('\n');
}

/** 한 줄 결론 — 숫자 이상을 말하지 않는다(기록한 종목 · 그 기간 · 그 규칙만) */
export function conclusionOf(r: JudgeResult, actionChanged = r.changed.filter((c) => c.kind === 'action').length): string {
  if (!r.compared) return '한 줄 결론: 견준 매수 판단이 없음(받지 못함 · 판단 못 함 · 표본 없음만)';
  const scope = `(${r.days.length}일 · 기록한 종목·날짜 ${r.targets}개 · 규칙 ${r.rules.length}개만 본 결과 — 사용자 종목 목록과 다름)`;
  if (actionChanged) {
    const days = new Set(r.changed.filter((c) => c.kind === 'action').map((c) => c.row.market_date)).size;
    return `한 줄 결론: ${r.compared}건 중 사도 됨/아님이 바뀐 것 ${actionChanged}건(${days}일) — 16:30 값으로 판단하면 결과가 달라지는 경우가 있었다 ${scope}`;
  }
  if (r.changed.length) return `한 줄 결론: ${r.compared}건 중 사도 됨/아님이 바뀐 것 0건 — 점수 · 판단 코드만 ${r.changed.length}건 달라짐 ${scope}`;
  return `한 줄 결론: ${r.compared}건 중 사도 됨/아님이 바뀐 것 0건 — 16:30 값과 최종값의 판단이 같았다(16:30 값이 최종값과 다른 종목·날짜 ${r.barsDiffer}개) ${scope}`;
}
