/**
 * `npm run rules:test` — 「매매 규칙」 엔진 시험 (v2.43.0, 퀀트 다시 만들기 1단계).
 *
 * ① 교차와 같은 판단 — 규칙 = 교차(1점) + RSI 반등(1점) · 기준 1점 · 반대 신호 켬 · 점수 매도 끔 · 대기 0 ·
 *    손익비 안전장치 끔(시험용 인자) → 예전 `decideRule` 의 **정답 파일**(`scripts/fixtures/crossRuleAnswers.json`, 5b16cc4 에서 만듦 —
 *    캔들까지 담았다)과 action 이 모두 같은지 (규칙형 4종 × 보유/미보유). 예전 코드는 v2.44.0 에 지웠다.
 * ①-b 백테스트 — 같은 규칙 + 손절(·트레일링·익절) → 새 `simulateRule` 의 거래 목록 == 예전 `simulateRule` 정답(같은 파일)
 * ② 점수와 같은 점수 — 기본 규칙 → 미국 시총 상위 100 × 최근 120 거래일, 지운 예전 점수 계산기(`evaluateSwing`, 표준 기준)의 **정답 파일**
 *    (`scripts/fixtures/swingScoreAnswers.json`, 510b0e4 에서 만듦 — 캔들 포함)과 5그룹 점수·합계가 같은지, 손익비로 막힌 날 = 손익비 강등 날인지
 * ③ 미래 정보 — 봉 i 까지 잘라 계산한 판단 == 전체로 계산한 i 의 판단
 * ④ 속도 — 미국 시총 상위 100 × 3년(756 거래일) 판단 시간 · 지표 엔진 호출 수
 * ⑤ 단위 시험 — 다시 사기 대기 · 점수 매도 · 빈 규칙 · 점수표 비례 · 손익비 막음 · 반대 신호 · 입력 검사
 *
 * ⚠️ **실제 DB 를 바꾸지 않는다** — DB 를 임시 파일로 복사해 그것만 연다. 토스를 부르지 않는다(캔들은 DB 캐시만 — 고정 캔들).
 * ⚠️ 지표 엔진이 떠 있어야 한다(①~④). 꺼져 있으면 ⑤만 돌고 실패로 끝난다.
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다(v2.44.2)
import 'dotenv/config';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const srcDb = path.resolve(root, process.env.DB_PATH ?? './db/alphascope.db');
const tmpDb = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rules-test-')), 'copy.db');
await new Database(srcDb, { readonly: true }).backup(tmpDb);
process.env.DB_PATH = tmpDb;

// 지표 엔진 호출 수를 센다 (토스는 부르지 않는다 — 부르면 실패로 센다)
let engineCalls = 0;
let tossCalls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: any, init?: any) => {
  const url = typeof input === 'string' ? input : input.url ?? String(input);
  if (url.includes('/indicators')) engineCalls++;
  if (url.includes('tossinvest')) {
    tossCalls++;
    throw new Error('rules:test 는 토스를 부르지 않는다');
  }
  return realFetch(input, init);
}) as typeof fetch;

const { loadCandles } = await import('../server/db');
const { computeIndicators } = await import('../server/indicatorService');
const { completedDaily, evaluateRule, exitLevels, scoreAt } = await import('../server/rules/engine');
const { simulateRule, leakCheck } = await import('../server/autoTrading/ruleBacktest');
const { readUniverse } = await import('../server/universe');
const { marketDate } = await import('../src/utils/marketDate');
const T = await import('../src/types/tradingRule');
const { ruleFieldErrors, ruleWarnings, parseRuleBody } = await import('../src/utils/ruleInput');
type RuleBody = import('../src/types/tradingRule').RuleBody;
/** 예전 규칙형 설정 모양 — 정답 파일이 담고 있다 */
interface RuleConfig {
  maShort: number;
  maLong: number;
  rsiBuyBelow: number;
  rsiSellAbove: number;
  useMaCross: boolean;
  useRsi: boolean;
}
interface Fixture {
  configs: RuleConfig[];
  variants: { hardStopLossPercent: number; trailingStopEnabled: boolean; trailingStopPercent: number; takeProfitEnabled?: boolean; takeProfitPercent?: number }[];
  symbols: {
    symbol: string;
    candles: [number, number, number, number, number, number][];
    decisions: { actions: string; codes: string[] }[][];
    backtests: { ruleReturn: number; holdReturn: number | null; trades: [number, number, number, number, number, string][] }[][];
  }[];
}
const fixture = JSON.parse(fs.readFileSync(path.join(root, 'scripts/fixtures/crossRuleAnswers.json'), 'utf8')) as Fixture;
const toCandles = (rows: Fixture['symbols'][number]['candles']): Candle[] =>
  rows.map(([timestamp, open, high, low, close, volume]) => ({ timestamp, open, high, low, close, volume }));
type Candle = import('../src/types/toss').Candle;
type IndicatorSeries = import('../src/types/chart').IndicatorSeries;

let failures = 0;
const results: string[] = [];
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) failures++;
  const line = `${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`;
  results.push(line);
  console.log(line);
}

/** 예전 규칙형 설정 → 새 규칙 (① 비교용) */
function fromRuleConfig(r: RuleConfig): RuleBody {
  const body = T.emptyRuleBody();
  body.buy.maCross = { on: r.useMaCross, points: 1, short: r.maShort, long: r.maLong };
  body.buy.rsiRebound = { on: r.useRsi, points: 1, below: r.rsiBuyBelow };
  body.buy.minScore = 1;
  body.sell.opposite = { on: true, rsiAbove: r.rsiSellAbove };
  body.reentryWaitDays = 0;
  return body;
}

// 고정 시각 — 예전 비교 자료와 같은 기준(2026-10-07 0시 UTC 에 끝난 봉)
const FIXED_NOW = Date.parse('2026-10-07T00:00:00Z');

// ── ① ─────────────────────────────────────────────────────────────────────
/** 예전 decideRule 의 코드 → 새 엔진 코드 (매수는 점수 매수 하나로 모인다) */
const mapCode = (old: string) => (old === 'golden' || old === 'rsi_rebound' ? 'score_buy' : old);

async function testCross(): Promise<void> {
  let rows = 0;
  let actionDiff = 0;
  let codeDiff = 0;
  let tradeDiff = 0;
  let runs = 0;
  let trades = 0;
  const examples: string[] = [];
  for (const fx of fixture.symbols) {
    const s = fx.symbol;
    const c = toCandles(fx.candles);
    const series = await computeIndicators(c);
    const ctx = { symbol: s, candles: c, series };
    for (const [k, cfg] of fixture.configs.entries()) {
      const body = fromRuleConfig(cfg);
      for (const [h, held] of [false, true].entries()) {
        const ans = fx.decisions[k][h];
        for (let i = 1; i < c.length; i++) {
          const neu = evaluateRule(ctx, i, body, { held }, { testOnlySkipRrGuard: true });
          rows++;
          if (ans.actions[i - 1] !== neu.action[0]) {
            actionDiff++;
            if (examples.length < 5) examples.push(`${s} i=${i} held=${held} ${ans.actions[i - 1]}≠${neu.action[0]}`);
          }
          if (mapCode(ans.codes[i - 1]) !== neu.code) codeDiff++;
        }
      }
      // ①-b 백테스트 — 같은 규칙 + 예전 손절(늘 켬)·트레일링·익절 → 거래 목록이 같은지
      for (const [v, variant] of fixture.variants.entries()) {
        const rule = fromRuleConfig(cfg);
        rule.sell.stopLoss = { on: true, percent: variant.hardStopLossPercent };
        rule.sell.trailing = { on: variant.trailingStopEnabled, percent: variant.trailingStopPercent };
        rule.sell.takeProfit = { on: Boolean(variant.takeProfitEnabled), percent: variant.takeProfitPercent ?? 10 };
        const r = simulateRule(s, c, series, c.length - 250, rule, undefined, { testOnlySkipRrGuard: true });
        const ans = fx.backtests[k][v];
        const got = r.list.map((t) => [t.entryIdx, t.exitIdx, t.entry, t.exit, t.returnPct, t.exitKind]);
        runs++;
        trades += ans.trades.length;
        if (JSON.stringify(got) !== JSON.stringify(ans.trades) || r.ruleReturn !== ans.ruleReturn || r.holdReturn !== ans.holdReturn) {
          tradeDiff++;
          if (examples.length < 8) examples.push(`백테스트 ${s} 규칙${k} 변형${v}: 거래 ${got.length} vs 정답 ${ans.trades.length}`);
        }
      }
    }
  }
  check('① 교차와 같은 판단 (정답 파일, action)', actionDiff === 0, `${rows.toLocaleString('en-US')}행 중 다름 ${actionDiff}${examples.length ? ` 예: ${examples.join(', ')}` : ''}`);
  check('① 판단 코드 (예전 매수 코드 → score_buy)', codeDiff === 0, `다름 ${codeDiff}`);
  check('①-b 백테스트 거래 목록 = 예전 simulateRule 정답', tradeDiff === 0, `${runs}번 실행 · 정답 거래 ${trades}건 · 다른 실행 ${tradeDiff}`);
}

// ── ② ─────────────────────────────────────────────────────────────────────
/**
 * 예전 점수 계산기(`evaluateSwing`, 표준 기준)의 **정답 파일**과 비교 — v2.45.0 에 그 계산기를 지웠다(A-11).
 * `scripts/fixtures/swingScoreAnswers.json`(510b0e4 에서 만듦): 미국 시총 상위 100 의 끝난 일봉(그때 쓴 그대로) + 최근 120 거래일마다
 * [i, 5그룹 점수, 합계, 매수(STRONG·BUY), 손익비 강등, 진입 종류, 매수가, 손절가, 1차, 2차, 손익비, 비중].
 */
interface SwingFixture {
  symbols: { symbol: string; skipped?: number; candles?: Fixture['symbols'][number]['candles']; days?: [number, number[], number, number, number, string, number, number, number, number, number, number][] }[];
}
async function testScore(): Promise<void> {
  const answers = JSON.parse(fs.readFileSync(path.join(root, 'scripts/fixtures/swingScoreAnswers.json'), 'utf8')) as SwingFixture;
  const body = T.defaultRuleBody();
  const groups = ['trend', 'timing', 'momentum', 'volume', 'riskReward'] as const;
  let days = 0;
  let scoreDiff = 0;
  let totalDiff = 0;
  let blockDiff = 0;
  let buyDiff = 0;
  let planDiff = 0;
  let blocked = 0;
  let buys = 0;
  let skipped = 0;
  const examples: string[] = [];
  for (const sym of answers.symbols) {
    if (!sym.candles || !sym.days) {
      skipped++;
      continue;
    }
    const s = sym.symbol;
    const c = toCandles(sym.candles);
    const series = await computeIndicators(c);
    const ctx = { symbol: s, candles: c, series };
    for (const [i, oldGroups, oldScore, oldBuy, demoted, entryType, entry, stop, t1, t2, ratio, size] of sym.days) {
      const neu = evaluateRule(ctx, i, body, { held: false });
      days++;
      groups.forEach((g, k) => {
        const b = neu.breakdown.find((x) => x.key === g)!.score;
        if (oldGroups[k] !== b) {
          scoreDiff++;
          if (examples.length < 5) examples.push(`${s} i=${i} ${g} ${oldGroups[k]}≠${b}`);
        }
      });
      if (oldScore !== neu.score) totalDiff++;
      if (Boolean(demoted) !== neu.rrBlocked) blockDiff++;
      if (neu.rrBlocked) blocked++;
      if (Boolean(oldBuy) !== (neu.action === 'BUY')) buyDiff++;
      if (neu.action === 'BUY') buys++;
      // 참고 계획도 같은지 (매수가·손절·목표·비율·비중)
      const r = neu.reference;
      const samePlan = r
        ? r.entryPrice === entry && r.stop === stop && r.target1 === t1 && r.target2 === t2 && r.ratio === ratio && r.sizePercent === size && r.entryType === entryType
        : stop === 0;
      if (!samePlan) planDiff++;
    }
  }
  check('② 5그룹 점수 (정답 파일)', scoreDiff === 0, `${answers.symbols.length - skipped}종목(일봉 60개 미만 ${skipped} 제외) · ${days}일 · 다른 그룹 점수 ${scoreDiff}${examples.length ? ` 예: ${examples.join(', ')}` : ''}`);
  check('② 합계', totalDiff === 0, `다름 ${totalDiff}`);
  check('② 손익비로 막힌 날 = 손익비 강등 날', blockDiff === 0, `막힌 날 ${blocked} · 다름 ${blockDiff}`);
  check('② 매수 날 = 예전 STRONG·BUY 날', buyDiff === 0, `매수 ${buys} · 다름 ${buyDiff}`);
  check('② 참고 계획(매수가·손절·목표·손익비·비중·진입)', planDiff === 0, `다름 ${planDiff}`);
}

// ── ③ ─────────────────────────────────────────────────────────────────────
async function testLeak(): Promise<void> {
  const rules: [string, RuleBody][] = [['기본 규칙', T.defaultRuleBody()]];
  const all = T.defaultRuleBody();
  all.buy.maCross.on = true;
  all.buy.rsiRebound.on = true;
  all.sell.opposite.on = true;
  rules.push(['모든 조건', all]);
  let compared = 0;
  let diff = 0;
  for (const s of ['AAPL', '005930']) {
    const c = completedDaily(loadCandles(s, '1d', 300), s, FIXED_NOW);
    const full = { symbol: s, candles: c, series: await computeIndicators(c) };
    for (let i = c.length - 60; i < c.length; i++) {
      const cut = c.slice(0, i + 1);
      const part = { symbol: s, candles: cut, series: await computeIndicators(cut) };
      for (const [, body] of rules) {
        for (const held of [false, true]) {
          compared++;
          if (JSON.stringify(evaluateRule(full, i, body, { held })) !== JSON.stringify(evaluateRule(part, i, body, { held }))) diff++;
        }
      }
    }
  }
  check('③ 미래 정보 (잘라 계산 == 전체)', diff === 0, `${compared}건 비교 · 다름 ${diff}`);
}

// ── ④ ─────────────────────────────────────────────────────────────────────
async function testSpeed(): Promise<void> {
  const DAYS = 756;
  const syms = readUniverse().us.map((e) => e.symbol.toUpperCase());
  const body = T.defaultRuleBody();
  const before = engineCalls;
  let evaluated = 0;
  let short = 0;
  let loadMs = 0;
  let indMs = 0;
  let evalMs = 0;
  const t0 = Date.now();
  for (const s of syms) {
    let t = Date.now();
    const c = completedDaily(loadCandles(s, '1d', DAYS + 200), s, FIXED_NOW);
    loadMs += Date.now() - t;
    if (c.length < DAYS + 60) short++;
    if (c.length < 60) continue;
    t = Date.now();
    const series = await computeIndicators(c);
    indMs += Date.now() - t;
    const ctx = { symbol: s, candles: c, series };
    t = Date.now();
    let held = false;
    for (let i = Math.max(59, c.length - DAYS); i < c.length; i++) {
      const r = evaluateRule(ctx, i, body, { held });
      if (r.action === 'BUY') held = true;
      else if (r.action === 'SELL') held = false;
      evaluated++;
    }
    evalMs += Date.now() - t;
  }
  const total = Date.now() - t0;
  results.push(
    `INFO  ④ 속도 — ${syms.length}종목 · 판단 ${evaluated.toLocaleString('en-US')}번 · 전체 ${(total / 1000).toFixed(1)}초 ` +
      `(캔들 읽기 ${(loadMs / 1000).toFixed(1)} · 지표 ${(indMs / 1000).toFixed(1)} · 판단 ${(evalMs / 1000).toFixed(1)}) · 지표 엔진 ${engineCalls - before}회 · 3년치 모자란 종목 ${short}`,
  );
  console.log(results.at(-1));
  check('④ 지표 엔진은 종목마다 한 번', engineCalls - before <= syms.length, `${engineCalls - before}회 / ${syms.length}종목`);
}

// ── ⑤ ─────────────────────────────────────────────────────────────────────
function synth(n: number): { candles: Candle[]; series: IndicatorSeries } {
  const day = 86_400_000;
  const start = Date.parse('2026-01-05T05:00:00Z');
  const candles: Candle[] = Array.from({ length: n }, (_, i) => ({
    timestamp: start + i * day,
    open: 100,
    high: 101,
    // 저가를 크게 낮춰 손절 폭을 넓힌다 → 손익비 1 미만(손익비 막음 시험). 다른 매수 시험은 시험용 인자로 막음을 끈다
    low: 50,
    close: 100,
    volume: 1000,
  }));
  const blank = () => Array<number | null>(n).fill(null);
  const series = {
    sma5: blank(), sma20: blank(), sma60: blank(), sma120: blank(), rsi14: blank(),
    macdHistogram: blank(), stochK: blank(), stochD: blank(), bbLower: blank(), bbMiddle: blank(), bbUpper: blank(),
    atr14: blank(), obv: blank(),
  } as unknown as IndicatorSeries;
  return { candles, series };
}

function testUnits(): void {
  // 점수표 비례
  for (const k of Object.keys(T.GROUP_TABLES) as (keyof typeof T.GROUP_TABLES)[]) {
    const base = T.GROUP_TABLES[k];
    check(`⑤ 점수표 기본값 = 예전 표 (${k})`, JSON.stringify(T.scaledTable(k, base[3])) === JSON.stringify(base));
  }
  check('⑤ 추세 만점 50 → [0,17,33,50]', JSON.stringify(T.scaledTable('trend', 50)) === '[0,17,33,50]', JSON.stringify(T.scaledTable('trend', 50)));
  check('⑤ 타이밍 만점 10 → [0,3,6,10]', JSON.stringify(T.scaledTable('timing', 10)) === '[0,3,6,10]', JSON.stringify(T.scaledTable('timing', 10)));
  check('⑤ 만점 0 → 모두 0', JSON.stringify(T.scaledTable('volume', 0)) === '[0,0,0,0]');

  // 빈 규칙
  const { candles, series } = synth(30);
  const ctx = { symbol: 'TEST', candles, series };
  const empty = T.emptyRuleBody();
  const r0 = evaluateRule(ctx, 29, empty, { held: false });
  check('⑤ 빈 규칙 → 매수 안 함', r0.action === 'HOLD' && r0.maxScore === 0 && r0.code === 'no_signal_buy', r0.reasons[0]);
  check('⑤ 빈 규칙 경고 「매수 조건이 없습니다」', ruleWarnings(empty).some((w) => w.includes('매수 조건이 없습니다')));
  check('⑤ 빈 규칙 · 기본 규칙 입력 오류 없음', Object.keys(ruleFieldErrors(empty)).length === 0 && Object.keys(ruleFieldErrors(T.defaultRuleBody())).length === 0);

  // 골든크로스를 봉 20 에 만든다
  const s = series as any;
  for (let i = 0; i < 30; i++) {
    s.sma5[i] = i < 20 ? 1 : 3;
    s.sma20[i] = 2;
    s.bbUpper[i] = 102;
  }
  const cross = T.emptyRuleBody();
  cross.buy.maCross = { on: true, points: 1, short: 5, long: 20 };
  cross.buy.minScore = 1;
  const date = (i: number) => marketDate(candles[i].timestamp, 'TEST');

  // 다시 사기 대기: 손절 = 봉 17 → 봉 20 까지 3거래일
  const wait = (days: number) => evaluateRule(ctx, 20, { ...cross, reentryWaitDays: days }, { held: false, lastStopDate: date(17) }, { testOnlySkipRrGuard: true });
  check('⑤ 대기 5거래일 · 3일째 → 기다림', wait(5).action === 'HOLD' && wait(5).code === 'reentry_wait', wait(5).reasons[0]);
  check('⑤ 대기 3거래일 · 3일째 → 매수', wait(3).action === 'BUY');
  check('⑤ 대기 0 → 바로 매수', wait(0).action === 'BUY');
  check('⑤ 손절 기록 없음 → 대기 없음', evaluateRule(ctx, 20, { ...cross, reentryWaitDays: 5 }, { held: false }, { testOnlySkipRrGuard: true }).action === 'BUY');

  // 손익비 막음 (계획을 세울 수 없음 = 손익비 0) — 시험 인자 없이는 막힌다
  const rr = evaluateRule(ctx, 20, cross, { held: false });
  check('⑤ 손익비 1 미만 → 매수하지 않음 (끌 수 없다)', rr.action === 'HOLD' && rr.code === 'rr_block' && rr.rrBlocked, rr.reasons[0]);

  // 목표를 세울 수 없으면(볼린저 상단 없음) 계획 없음 → 손익비 0 → 매수하지 않음
  const noBand = synth(30);
  const nb = noBand.series as any;
  for (let i = 0; i < 30; i++) {
    nb.sma5[i] = i < 20 ? 1 : 3;
    nb.sma20[i] = 2;
  }
  const nbr = evaluateRule({ symbol: 'TEST', ...noBand }, 20, cross, { held: false });
  check('⑤ 목표가 무한대(볼린저 상단 없음) → 계획 없음 · 매수 안 함', nbr.reference === null && nbr.code === 'rr_block', nbr.reasons[0]);

  // 점수 매도
  const sellRule = { ...cross, sell: { ...cross.sell, scoreBelow: { on: true, value: 1 } } };
  const sold = evaluateRule(ctx, 25, sellRule, { held: true });
  check('⑤ 점수 1 아래 → 매도', sold.action === 'SELL' && sold.code === 'score_sell', sold.reasons[0]);
  check('⑤ 점수 매도 끔 → 보유', evaluateRule(ctx, 25, cross, { held: true }).action === 'HOLD');
  check('⑤ 교차 당일 점수 1 → 점수 매도 안 함', evaluateRule(ctx, 20, sellRule, { held: true }).action === 'HOLD');

  // 반대 신호: 데드크로스를 봉 25 에
  for (let i = 25; i < 30; i++) s.sma5[i] = 1;
  const opp = { ...cross, sell: { ...cross.sell, opposite: { on: true, rsiAbove: 70 } } };
  check('⑤ 반대 신호 켬 · 데드크로스 → 매도', evaluateRule(ctx, 25, opp, { held: true }).code === 'dead');
  check('⑤ 반대 신호 끔 → 보유', evaluateRule(ctx, 25, cross, { held: true }).action === 'HOLD');
  const oppNoCross = { ...opp, buy: { ...opp.buy, maCross: { ...opp.buy.maCross, on: false }, minScore: 1 } };
  check('⑤ 교차를 끄면 데드크로스를 보지 않음', evaluateRule(ctx, 25, oppNoCross, { held: true }).action === 'HOLD');

  // 순간 조건은 그날만
  check('⑤ 교차 다음 날은 점수 0', scoreAt(ctx, 21, cross).score === 0);

  // 가격
  const lv = exitLevels({ ...cross, sell: { ...cross.sell, stopLoss: { on: true, percent: 7 }, takeProfit: { on: true, percent: 10 }, trailing: { on: true, percent: 5 } } }, { held: true, avgPrice: 100, peak: 120 });
  check('⑤ 손절·익절·트레일링 가격', Math.abs(lv.stop! - 93) < 1e-9 && Math.abs(lv.takeProfit! - 110) < 1e-9 && Math.abs(lv.trailing! - 114) < 1e-9, JSON.stringify(lv));

  // 입력 검사
  const bad = T.defaultRuleBody();
  bad.sell.scoreBelow.value = 65;
  check('⑤ 매도 점수 ≥ 매수 기준 → 오류', !!ruleFieldErrors(bad)['sell.scoreBelow.value']);
  const badMa = T.defaultRuleBody();
  badMa.buy.maCross.short = 60;
  badMa.buy.maCross.long = 20;
  check('⑤ 단기선 ≥ 장기선 → 오류', !!ruleFieldErrors(badMa)['buy.maCross.long']);
  badMa.buy.maCross.short = 13;
  check('⑤ 엔진에 없는 이동평균(13일) → 오류', !!ruleFieldErrors(badMa)['buy.maCross.short']);
  const badRsi = T.defaultRuleBody();
  badRsi.buy.timing.rsiLow = 50;
  badRsi.buy.timing.rsiHigh = 40;
  check('⑤ RSI 구간 거꾸로 → 오류', !!ruleFieldErrors(badRsi)['buy.timing.rsiHigh']);
  check('⑤ 모양이 틀린 규칙 → 거절', 'error' in parseRuleBody({ buy: { trend: { on: 'yes' } } }));
  check('⑤ 올바른 규칙 → 그대로', JSON.stringify((parseRuleBody(JSON.parse(JSON.stringify(T.defaultRuleBody()))) as any).body) === JSON.stringify(T.defaultRuleBody()));
}

// ── ⑥ 거름망(200일선) · 50/200 교차 (v2.50.0) — 손으로 만든 시리즈 ─────────────────
function testGates(): void {
  const { candles, series } = synth(30);
  const ctx = { symbol: 'TEST', candles, series };
  const s = series as any;
  s.sma50 = Array<number | null>(30).fill(null);
  s.sma200 = Array<number | null>(30).fill(null);
  for (let i = 0; i < 30; i++) {
    s.sma5[i] = i < 20 ? 1 : 3;
    s.sma20[i] = 2;
    s.bbUpper[i] = 102;
  }
  const cross = T.emptyRuleBody();
  cross.buy.maCross = { on: true, points: 1, short: 5, long: 20 };
  cross.buy.minScore = 1;
  const gated = T.cloneRuleBody(cross);
  gated.buy.gates = { above200: { on: true } };

  // 봉 부족(200일선 없음) → 막음 — 안전 쪽
  const none = evaluateRule(ctx, 20, gated, { held: false });
  check('⑥ 200일선 없음(봉 부족) → gate_block 「200일선을 계산할 일봉이 부족해」', none.action === 'HOLD' && none.code === 'gate_block' && none.reasons[0].includes('200일선을 계산할 일봉이 부족해'), none.reasons[0]);
  // 종가 100 ≤ 200일선 101 → 막음. 손익비도 1 미만인 자료 — 거름망이 먼저다
  s.sma200[20] = 101;
  const below = evaluateRule(ctx, 20, gated, { held: false });
  check('⑥ 종가 ≤ 200일선 → gate_block (손익비 안전장치보다 먼저)', below.code === 'gate_block' && !below.rrBlocked && below.reasons[0].includes('주가가 200일선 아래라 사지 않습니다 (종가 $100.00 · 200일선 $101.00)'), below.reasons[0]);
  // 문장 속 가격은 쉼표 — 국내 원 정수 · 미국 소수 둘째
  const krCtx = { symbol: '005930', candles: candles.map((c) => ({ ...c, close: 207_500 })), series };
  s.sma200[20] = 231_956.5;
  const kr = evaluateRule(krCtx, 20, gated, { held: false });
  check('⑥ 국내 문장 가격 ₩ · 쉼표 — 「종가 ₩207,500 · 200일선 ₩231,957」', kr.reasons[0].includes('(종가 ₩207,500 · 200일선 ₩231,957)'), kr.reasons[0]);
  s.sma200[20] = 100;
  check('⑥ 종가 = 200일선 → 막음(위일 때만)', evaluateRule(ctx, 20, gated, { held: false }).code === 'gate_block');
  // 종가 > 200일선 → 거름망 통과 → 다음은 손익비(이 자료는 1 미만) → 시험 인자로 막음을 끄면 매수
  s.sma200[20] = 99;
  check('⑥ 종가 > 200일선 → 통과 · 다음은 손익비 안전장치', evaluateRule(ctx, 20, gated, { held: false }).code === 'rr_block');
  check('⑥ 종가 > 200일선 · 손익비 막음 끔 → 매수', evaluateRule(ctx, 20, gated, { held: false }, { testOnlySkipRrGuard: true }).action === 'BUY');
  // 점수 미달이면 거름망까지 가지 않는다(예전 문장 그대로)
  s.sma200[21] = 101;
  check('⑥ 점수 미달 → no_signal_buy (거름망 문장 아님)', evaluateRule(ctx, 21, gated, { held: false }).code === 'no_signal_buy');
  // 보유 중 매도에는 영향 없음 — 200일선 아래여도 반대 신호로 매도, 매도 조건 없으면 보유
  for (let i = 25; i < 30; i++) s.sma5[i] = 1;
  s.sma200[25] = 999;
  const opp = { ...gated, sell: { ...gated.sell, opposite: { on: true, rsiAbove: 70 } } };
  check('⑥ 보유 중 · 200일선 아래 · 데드크로스 → 매도(거름망은 매수만 막는다)', evaluateRule(ctx, 25, opp, { held: true }).code === 'dead');
  check('⑥ 보유 중 · 200일선 아래 · 매도 조건 없음 → 보유', evaluateRule(ctx, 24, gated, { held: true }).code === 'no_signal_hold');
  // 옛 규칙(거름망 칸 없음) = 끈 것과 같다
  const old = T.cloneRuleBody(cross);
  delete (old.buy as any).gates;
  s.sma200[20] = 999;
  const same = JSON.stringify(evaluateRule(ctx, 20, old, { held: false })) === JSON.stringify(evaluateRule(ctx, 20, cross, { held: false }));
  check('⑥ 거름망 칸 없는 옛 규칙 = 거름망 끔과 같은 판단', same && evaluateRule(ctx, 20, old, { held: false }).code === 'rr_block');
  check('⑥ 옛 규칙(거름망 칸 없음) 받기 → 꺼진 거름망으로', (() => { const r = parseRuleBody(JSON.parse(JSON.stringify(old))) as any; return !!r.body && r.body.buy.gates.above200.on === false; })());
  check('⑥ 기본 규칙 = 200일선 안 씀 · 예시 규칙 = 씀', !T.usesMa200(T.defaultRuleBody()) && T.usesMa200(T.above200RuleBody()) && T.above200RuleBody().buy.gates?.above200?.on === true);

  // 50/200 교차 — 봉 20 에 골든크로스, 봉 25 에 데드크로스
  const g = synth(30);
  const gs = g.series as any;
  gs.sma50 = Array.from({ length: 30 }, (_, i) => (i < 20 ? 90 : i < 25 ? 110 : 90));
  gs.sma200 = Array<number | null>(30).fill(100);
  for (let i = 0; i < 30; i++) gs.bbUpper[i] = 102;
  const gctx = { symbol: 'TEST', ...g };
  const gc = T.emptyRuleBody();
  gc.buy.maCross = { on: true, points: 1, short: 50, long: 200 };
  gc.buy.minScore = 1;
  check('⑥ 50/200 입력 검사 통과 · 200/50 은 오류', Object.keys(ruleFieldErrors(gc)).length === 0 && (() => { const b = T.cloneRuleBody(gc); b.buy.maCross = { ...b.buy.maCross, short: 200, long: 50 }; return !!ruleFieldErrors(b)['buy.maCross.long']; })());
  check('⑥ 50/200 골든크로스 날(봉 20) → 점수 1 · 매수', scoreAt(gctx, 20, gc).score === 1 && evaluateRule(gctx, 20, gc, { held: false }, { testOnlySkipRrGuard: true }).action === 'BUY');
  check('⑥ 50/200 골든크로스 전날·다음 날 → 점수 0', scoreAt(gctx, 19, gc).score === 0 && scoreAt(gctx, 21, gc).score === 0);
  const gcOpp = { ...gc, sell: { ...gc.sell, opposite: { on: true, rsiAbove: 70 } } };
  const dead = evaluateRule(gctx, 25, gcOpp, { held: true });
  check('⑥ 50/200 데드크로스(봉 25) → 반대 신호 매도 · MA50·MA200', dead.code === 'dead' && dead.reasons[0].includes('MA50·MA200'), dead.reasons[0]);
}

// ── ⑦ 시장 필터 (v2.51.0) — 손으로 만든 시장 기준 · 백테스트 날짜별 판정 · 실제 캐시(SPY)로 미래 누설 ──────────
type MarketRef = import('../server/rules/engine').MarketRefData;
async function testMarketFilter(): Promise<void> {
  const { candles, series } = synth(30);
  const s = series as any;
  s.sma200 = Array<number | null>(30).fill(50); // 종목 200일선은 늘 아래(종목 거름망 통과)
  for (let i = 0; i < 30; i++) {
    s.sma5[i] = i < 20 ? 1 : 3;
    s.sma20[i] = 2;
    s.bbUpper[i] = 102;
  }
  // 시장 기준 — 종목과 같은 날짜의 봉(미국 날짜). 종가 100, 200일선은 날마다 정한다
  const refSeries = { sma200: Array<number | null>(30).fill(90) } as unknown as IndicatorSeries;
  const ref: MarketRef = { market: 'US', symbol: 'SPY', name: 'SPY', candles: candles.map((c) => ({ ...c })), series: refSeries };
  const rule = T.emptyRuleBody();
  rule.buy.maCross = { on: true, points: 1, short: 5, long: 20 };
  rule.buy.minScore = 1;
  rule.buy.gates = { above200: { on: false }, marketAbove200: { on: true } };
  const ev = (market: MarketRef | null | undefined, r = rule, opts = {}) =>
    evaluateRule({ symbol: 'TEST', candles, series, ...(market !== undefined ? { market } : {}) }, 20, r, { held: false }, opts);

  check('⑦ 시장 기준 > 200일선 → 통과 · 다음은 손익비', ev(ref).code === 'rr_block' && !('gateReason' in ev(ref)));
  check('⑦ 시장 기준 > 200일선 · 손익비 막음 끔 → 매수', ev(ref, rule, { testOnlySkipRrGuard: true }).action === 'BUY');
  (refSeries.sma200 as (number | null)[])[20] = 100;
  const down = ev(ref);
  check('⑦ 시장 기준 ≤ 200일선 → gate_block · market · 「시장 기준 SPY 가 200일선 아래라」', down.code === 'gate_block' && down.gateReason === 'market' && down.reasons[0].includes('시장 기준 SPY 가 200일선 아래라 사지 않습니다 (SPY $100.00 · 200일선 $100.00)'), down.reasons[0]);
  (refSeries.sma200 as (number | null)[])[20] = null;
  check('⑦ 시장 기준 200일선 없음(봉 부족) → market_nodata', ev(ref).gateReason === 'market_nodata');
  (refSeries.sma200 as (number | null)[])[20] = 90;
  const gap: MarketRef = { ...ref, candles: ref.candles.filter((_, k) => k !== 20) };
  // 같은 날짜 봉이 없으면 다른 날 값을 쓰지 않는다(지표 배열이 하나 밀린 자료라도)
  check('⑦ 같은 날짜 봉 없음 → market_nodata (다른 날로 때우지 않음)', ev(gap).gateReason === 'market_nodata' && ev(gap).reasons[0].includes('데이터가 없어'), ev(gap).reasons[0]);
  check('⑦ 받기 실패(null) → market_nodata', ev(null).gateReason === 'market_nodata');
  check('⑦ 시장 기준을 넘기지 않음(undefined) → market_nodata (안전 쪽)', ev(undefined).gateReason === 'market_nodata');
  // 순서: 종목 200일선 → 시장 → 손익비
  const both = T.cloneRuleBody(rule);
  both.buy.gates = { above200: { on: true }, marketAbove200: { on: true } };
  (refSeries.sma200 as (number | null)[])[20] = 100;
  s.sma200[20] = 101;
  check('⑦ 순서 — 종목 200일선 아래가 먼저(below200)', ev(ref, both).gateReason === 'below200');
  s.sma200[20] = 50;
  check('⑦ 순서 — 종목 통과 · 시장 하락 → market', ev(ref, both).gateReason === 'market');
  (refSeries.sma200 as (number | null)[])[20] = 90;
  check('⑦ 순서 — 둘 다 통과 → 손익비 안전장치', ev(ref, both).code === 'rr_block');
  // 보유 중 매도에는 쓰지 않는다
  (refSeries.sma200 as (number | null)[])[25] = 999;
  for (let i = 25; i < 30; i++) s.sma5[i] = 1;
  const opp = { ...rule, sell: { ...rule.sell, opposite: { on: true, rsiAbove: 70 } } };
  check('⑦ 보유 중 · 시장 하락 · 데드크로스 → 매도(시장 필터는 매수만 막는다)', evaluateRule({ symbol: 'TEST', candles, series, market: ref }, 25, opp, { held: true }).code === 'dead');
  // 시장 필터 끈 규칙은 시장 기준이 있든 없든 같은 판단
  const off = T.cloneRuleBody(rule);
  off.buy.gates = { above200: { on: false }, marketAbove200: { on: false } };
  check('⑦ 시장 필터 끔 → 시장 기준과 무관(바이트 같음)', JSON.stringify(ev(null, off)) === JSON.stringify(ev(undefined, off)) && JSON.stringify(ev(ref, off)) === JSON.stringify(ev(undefined, off)));
  check('⑦ 옛 규칙(거름망에 above200 만) 받기 → 시장 필터 꺼짐', (() => { const r = parseRuleBody(JSON.parse(JSON.stringify(T.above200RuleBody()))) as any; return !!r.body && r.body.buy.gates.marketAbove200.on === false && r.body.buy.gates.above200.on === true; })());

  // 백테스트 날짜별 판정 — 교차가 10봉마다 오고, 시장 기준은 봉 60 부터만 200일선 위 → 매수는 봉 60 이후 신호에서만
  const n = 120;
  const g = synth(n);
  const gs = g.series as any;
  gs.sma200 = Array<number | null>(n).fill(50);
  for (let i = 0; i < n; i++) {
    gs.sma5[i] = i % 10 < 5 ? 1 : 3; // 봉 5·15·25… 골든크로스, 10·20… 데드크로스
    gs.sma20[i] = 2;
    gs.bbUpper[i] = 102;
  }
  const mRef: MarketRef = { market: 'US', symbol: 'SPY', name: 'SPY', candles: g.candles.map((c) => ({ ...c })), series: { sma200: Array.from({ length: n }, (_, k) => (k < 60 ? 200 : 50)) } as unknown as IndicatorSeries };
  const bt = T.cloneRuleBody(rule);
  bt.sell.opposite = { on: true, rsiAbove: 70 };
  const sim = simulateRule('TEST', g.candles, g.series, 1, bt, undefined, { testOnlySkipRrGuard: true }, mRef);
  const noGate = simulateRule('TEST', g.candles, g.series, 1, { ...bt, buy: { ...bt.buy, gates: { above200: { on: false }, marketAbove200: { on: false } } } }, undefined, { testOnlySkipRrGuard: true });
  check('⑦ 백테스트 — 시장 하락 구간(봉 60 전) 신호로는 사지 않음 · 그 뒤는 삼', sim.list.length > 0 && sim.list.every((t) => t.entryIdx > 60) && noGate.list.some((t) => t.entryIdx <= 60), `거름망 ${sim.list.map((t) => t.entryIdx)} / 없음 ${noGate.list.map((t) => t.entryIdx)}`);

  // 실제 캐시(AAPL · SPY)로 미래 누설 — 시장 기준도 그 날짜까지 잘라 다시 계산해 같은 판단
  const aapl = completedDaily(loadCandles('AAPL', '1d', 300), 'AAPL', FIXED_NOW);
  const spy = completedDaily(loadCandles('SPY', '1d', 400), 'SPY', FIXED_NOW);
  const realRef: MarketRef = { market: 'US', symbol: 'SPY', name: 'SPY', candles: spy, series: await computeIndicators(spy) };
  const leakRule = T.cloneRuleBody(T.defaultRuleBody());
  leakRule.buy.minScore = 30;
  leakRule.buy.gates = { above200: { on: false }, marketAbove200: { on: true } };
  const bad = await leakCheck('AAPL', aapl, await computeIndicators(aapl), aapl.length - 40, [leakRule], realRef);
  const codes = new Set<string>();
  for (let i = aapl.length - 40; i < aapl.length; i++) {
    const e = evaluateRule({ symbol: 'AAPL', candles: aapl, series: await computeIndicators(aapl), market: realRef }, i, leakRule, { held: false });
    codes.add(e.gateReason ?? e.code);
    break;
  }
  check('⑦ 미래 누설 — 시장 기준(SPY 캐시)을 날짜까지 잘라 다시 계산해도 같은 판단(AAPL 40봉)', bad === null, bad ?? `SPY ${spy.length}봉 · 예: ${[...codes].join(',')}`);
}

const t0 = Date.now();
testUnits();
testGates();
await testMarketFilter().catch((e) => check('⑦ 시장 필터 시험', false, (e as Error).message));
try {
  await testCross();
  await testScore();
  await testLeak();
  await testSpeed();
} catch (e) {
  check('지표 엔진이 필요한 시험', false, (e as Error).message);
}
check('토스 호출 0회', tossCalls === 0, `${tossCalls}회`);
fs.rmSync(path.dirname(tmpDb), { recursive: true, force: true });
console.log(`\n${failures ? `실패 ${failures}건` : '모두 통과'} · ${((Date.now() - t0) / 1000).toFixed(1)}초 · DB 사본 ${srcDb}`);
process.exit(failures ? 1 : 0);
