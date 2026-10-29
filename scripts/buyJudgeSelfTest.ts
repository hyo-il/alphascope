/**
 * 매수 판단 점검 — `npm run buyjudge:test` · ⚠️ `DB_PATH=<사본>` 으로만 돈다(맨 첫 import). 지표 엔진이 떠 있어야 한다.
 *
 * ① 매수 판단 마감 판단 = 계좌 판단(같은 종목·날·규칙, 보유 없음 — action · score · code)
 * ② 매일 기록이 같은 날 두 번 돌아도 한 줄 ③ 휴장일 건너뜀 ④ 서버 재시작 — 가장 최근 날짜 하나만 ⑤ 보관 정리(「사도 됨」 은 남는다)
 * ⑥ 5·10·20거래일 수익률(비용 포함, 손 계산과 같음) ⑦ 「사지 않은 이유」 요약 ⑧ 규칙 삭제 → 매수 판단 규칙 비움
 * 넣은 계좌·규칙·기록·설정은 끝에서 되돌린다.
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import 'dotenv/config';
import { getDb } from '../server/db';
import { createAccount, deleteAccount } from '../server/paperTradingService';
import { resetPendingNotesForTest, runSignalChecks } from '../server/autoTrading/engine';
import { isMarketClosed } from '../server/marketCalendar';
import { lastClosedDay, marketDayTime } from '../server/marketHours';
import { defaultStrategy } from '../src/types/autoTrading';
import { createRule, deleteRule, getRule, listRules } from '../server/rules/store';
import { defaultRuleBody, DEFAULT_RULE_NAME } from '../src/types/tradingRule';
import { warningsOf, judgeSymbol, latestRecordDay, outcomes, reasonSummaries, recordMarket, currentRule, historyDays, buildState } from '../server/buyJudge/judge';
import { buyJudgeTick } from '../server/buyJudge/scheduler';
import * as store from '../server/buyJudge/store';
import { ROUND_TRIP_COST } from '../server/analysis/targetHit';
import { marketDate } from '../src/utils/marketDate';
import { daySymbols, sortDayRows } from '../src/utils/buyJudgeOrder';
import { VERDICT_LABEL, verdictOf } from '../src/types/buyJudge';
import { gateBlockLabel } from '../src/types/autoTrading';
import { loadMarketRef, setMarketRefLoadForTest } from '../server/rules/marketRef';
import { judgeOnClose } from '../server/rules/judge';
import { completedDaily } from '../server/rules/engine';
import { loadCandles, pruneUnconfirmedMissing, saveCandles } from '../server/db';
import { deleteStrategy, getJudgedDay } from '../server/autoTrading/store';
import { calendarEvents } from '../server/calendarService';
import type { RuleEvaluation } from '../server/rules/engine';

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const db = getDb();
const saved = { symbols: store.getSymbols(), ruleRaw: db.prepare(`SELECT value FROM app_settings WHERE key = 'buyJudge.ruleId'`).get() as { value: string } | undefined, recorded: store.getLastRecorded() };
const FAKE = 'ZZJUDGE';
const cleanupRows = () => db.prepare(`DELETE FROM buy_judgments WHERE symbol IN (?, ?, ?, ?, ?)`).run(FAKE, 'AAPL', 'NVDA', 'MSFT', '005930');
cleanupRows();
const addedHoliday = !db.prepare(`SELECT 1 FROM market_holidays WHERE market = 'KR' AND date = '2026-10-09'`).get();
if (addedHoliday) db.prepare(`INSERT INTO market_holidays (market, date) VALUES ('KR', '2026-10-09')`).run();
let tempAccount: number | null = null;
let tempRule: number | null = null;

try {
  const base = listRules().find((r) => r.name === DEFAULT_RULE_NAME) ?? listRules()[0];
  if (!base) throw new Error('규칙이 없습니다');
  store.setRuleId(base.id);
  const rule = currentRule()!;
  const syms = ['AAPL', 'NVDA', 'MSFT', '005930'];

  // ── ① 매수 판단 = 계좌 판단 ──
  // 계좌는 매수 신호에서 안전장치(실적 회피 · 최대 보유 등)로 사유가 바뀔 수 있다 — 엔진 사유가 남은 줄만 점수까지 비교하고,
  // 안전장치 줄은 「엔진이 매수였는지」 만 비교한다. 매수 기준 999점 규칙(늘 기준 미달)으로 한 번 더 — 모든 종목이 점수까지 비교된다.
  // ⚠️ 변형마다 **빈 새 계좌** — 매수 판단은 보유 없음(held=false)이라, 앞 변형에서 계좌가 실제로 산 종목이 남으면 다음 변형의 계좌는
  // 「보유 중」 으로 판단한다(환율 버그가 고쳐져 원화 계좌가 미국 종목을 실제로 사게 되며 드러났다).
  const now = Date.now();
  const GUARD = new Set(['max_positions', 'earnings_blackout', 'daily_loss', 'other', 'error']);
  // 거름망(200일선) 켬 · 기준 1점(점수는 늘 통과 → 거름망이 가른다)
  const gateBody = { ...rule.body, buy: { ...rule.body.buy, minScore: 1, gates: { above200: { on: true } } } };
  const gateCodes: string[] = [];
  // 시장 필터 켬(기준 1점) — 시장 기준(SPY · KODEX 200)이 가른다. 이유(gateReason)까지 같아야 한다
  const marketBody = { ...rule.body, buy: { ...rule.body.buy, minScore: 1, gates: { above200: { on: false }, marketAbove200: { on: true } } } };
  for (const [label, body] of [['기본 규칙', rule.body], ['기준 999점', { ...rule.body, buy: { ...rule.body.buy, minScore: 999 } }], ['거름망 켬', gateBody], ['시장 필터 켬', marketBody]] as const) {
    const acc = createAccount({ name: '매수판단 시험(지움)', initialBalance: 1_000_000_000, currency: 'KRW' });
    tempAccount = acc.id;
    const strategy = { ...defaultStrategy(acc.id), ruleId: base.id, symbols: syms, maxPositions: 10 };
    const acct = await runSignalChecks(strategy, body, { force: true, now: new Date(now) });
    for (const s of syms) {
      const note = acct.notes.find((n) => n.symbol === s);
      const { row } = await judgeSymbol(s, body, null, now);
      const guarded = GUARD.has(note?.code ?? '');
      const acctScore = Number(/점수 (\d+)\//.exec(note?.reason ?? '')?.[1] ?? NaN);
      const acctCode = note?.action === 'BUY' ? 'score_buy' : note?.code;
      const same = guarded ? row.code === 'score_buy' : row.score === acctScore && row.code === acctCode && (row.gateReason ?? null) === (note?.gateReason ?? null);
      if (label !== '기본 규칙' && label !== '기준 999점') gateCodes.push(`${label}/${s}:${row.code}${row.gateReason ? `(${row.gateReason})` : ''}`);
      check(`① ${label} · ${s} 매수 판단 = 계좌 판단`, same, `매수 판단 ${row.code}${row.gateReason ? `(${row.gateReason})` : ''} ${row.score} · 계좌 ${note?.action} ${note?.code}${note?.gateReason ? `(${note.gateReason})` : ''} ${guarded ? '(안전장치)' : acctScore}`);
    }
    deleteAccount(acc.id);
    tempAccount = null;
  }

  console.log(`  INFO 거름망 판단: ${gateCodes.join(' · ')}`);
  check('① 시장 필터 — 표시 「거름망에 걸림 (시장 하락)」 · 이유 4가지 이름', gateBlockLabel('market') === '거름망에 걸림 (시장 하락)' && gateBlockLabel('market_nodata') === '거름망에 걸림 (시장 데이터 없음)' && gateBlockLabel('short') === '거름망에 걸림 (일봉 부족)' && gateBlockLabel('below200') === '거름망에 걸림 (200일선 아래)');

  // 매수 판단 한 번 실행(buildState)에서 시장 기준은 시장마다 한 번 — 미국 3 · 국내 1종목
  {
    const counts: Record<string, number> = {};
    setMarketRefLoadForTest(async (m, n, limit) => {
      counts[m] = (counts[m] ?? 0) + 1;
      return loadMarketRef(m, n, limit);
    });
    const mr = createRule(`__매수판단 시장 필터 ${Date.now()}`, marketBody);
    const prevRule = store.getRuleId();
    const prevSyms = store.getSymbols();
    try {
      store.setRuleId(mr.id);
      store.setSymbols(syms);
      const st = await buildState({ write: false });
      const gr = st.rows.filter((r) => r.code === 'gate_block');
      check('매수 판단 실행 1번 → SPY 1번 · KODEX 200 1번 · 거름망 줄은 이유가 시장', counts.US === 1 && counts.KR === 1 && gr.every((r) => r.gateReason === 'market' || r.gateReason === 'market_nodata'),
        `${JSON.stringify(counts)} · ${st.rows.map((r) => `${r.symbol}:${r.code}${r.gateReason ? `(${r.gateReason})` : ''}`).join(' ')}`);
      // 기록 저장 → 히스토리·사지 않은 이유에도 이유가 남는다
      for (const r of gr) store.upsertJudgment({ marketDate: '2026-01-02', symbol: r.symbol, ruleId: mr.id, ruleName: mr.name, rule: marketBody, action: 'HOLD', code: 'gate_block', score: r.score ?? 0, maxScore: r.maxScore ?? 0, minScore: 1, breakdown: [], reference: null, reason: r.reason ?? '', gateReason: r.gateReason ?? null });
      const sums = reasonSummaries();
      const anyGate = gr[0];
      check('저장한 이유 → 「사지 않은 이유」 이유별 날 수', !anyGate || (sums.find((x) => x.symbol === anyGate.symbol)?.gateReasons[anyGate.gateReason!] ?? 0) >= 1, JSON.stringify(sums.find((x) => x.symbol === anyGate?.symbol)));
      getDb().prepare(`DELETE FROM buy_judgments WHERE rule_id = ?`).run(mr.id);
    } finally {
      setMarketRefLoadForTest(null);
      store.setRuleId(prevRule);
      store.setSymbols(prevSyms);
      deleteRule(mr.id);
    }
  }
  check('① 거름망 — gate_block 은 「거름망에 걸림」 · 순서는 손익비 부족 다음', verdictOf('gate_block') === 'gate_block' && VERDICT_LABEL.gate_block === '거름망에 걸림' && sortDayRows([{ symbol: 'A', verdict: 'below', score: 90 }, { symbol: 'B', verdict: 'gate_block', score: 10 }, { symbol: 'C', verdict: 'rr_block', score: 5 }]).map((r) => r.symbol).join() === 'C,B,A');

  // ── ② 같은 날 두 번 기록해도 한 줄 ──
  store.setSymbols(syms);
  const usDay = latestRecordDay('US', now);
  await recordMarket('US', usDay, now);
  await recordMarket('US', usDay, now);
  const dup = db.prepare(`SELECT symbol, COUNT(*) AS n FROM buy_judgments WHERE market_date = ? AND rule_id = ? GROUP BY symbol`).all(usDay, base.id) as { symbol: string; n: number }[];
  check('② 같은 날 두 번 기록 → 종목마다 한 줄', dup.length > 0 && dup.every((d) => d.n === 1), JSON.stringify(dup));

  // ── ③ 휴장일 건너뜀 ──
  check('③ 국내 휴장일(10-09 금) 낮 → 기록할 날 = 10-08', latestRecordDay('KR', Date.parse('2026-10-09T12:00:00+09:00')) === '2026-10-08');
  check('③ 국내 10-12(월) 20:40 → 10-12', latestRecordDay('KR', Date.parse('2026-10-12T20:40:00+09:00')) === '2026-10-12');
  check('③ 국내 10-12(월) 20:00(기록 시각 전) → 10-08(한글날·주말 건너뜀)', latestRecordDay('KR', Date.parse('2026-10-12T20:00:00+09:00')) === '2026-10-08');
  check('③ 미국 추수감사절(11-26) 저녁 → 11-25', latestRecordDay('US', Date.parse('2026-11-26T18:00:00-05:00')) === '2026-11-25');
  check('③ 미국 토요일 → 금요일(10-16)', latestRecordDay('US', Date.parse('2026-10-17T12:00:00-04:00')) === '2026-10-16');

  // ── ④ 서버 재시작 — 가장 최근 날짜 하나만 ──
  cleanupRows();
  store.setLastRecorded('US', '2026-09-01');
  store.setLastRecorded('KR', '2026-09-01');
  const tick = await buyJudgeTick(now);
  const dates = (db.prepare(`SELECT DISTINCT market_date FROM buy_judgments WHERE symbol IN ('AAPL','NVDA','MSFT','005930')`).all() as { market_date: string }[]).map((r) => r.market_date).sort();
  const want = [latestRecordDay('US', now), latestRecordDay('KR', now)].sort();
  check('④ 놓친 날이 많아도 시장마다 가장 최근 날짜 하나만', JSON.stringify([...new Set(dates)]) === JSON.stringify([...new Set(want)]), `기록된 날짜 ${dates.join(',')} · 기대 ${want.join(',')} · ${JSON.stringify(tick.recorded)}`);
  const again = await buyJudgeTick(now);
  check('④ 같은 날 다시 돌면 기록하지 않음', Object.keys(again.recorded).length === 0, JSON.stringify(again.recorded));

  // ── ⑤ 보관 정리 ──
  const put = (d: string, code: string) =>
    store.upsertJudgment({ marketDate: d, symbol: FAKE, ruleId: base.id, ruleName: 'x', rule: rule.body, action: code === 'score_buy' ? 'BUY' : 'HOLD', code, score: 50, maxScore: 100, minScore: 65, breakdown: [], reference: null, reason: 'r' });
  put('2025-01-02', 'score_buy');
  put('2025-01-03', 'no_signal_buy');
  put('2026-03-01', 'no_signal_buy');
  put('2026-06-01', 'no_signal_buy');
  put('2026-10-01', 'rr_block');
  const today = '2026-10-15';
  check('⑤ 6개월(04-15 이전) — 지워질 줄 2(2025-01-03 · 2026-03-01)', store.pruneOld('6m', today, true) === 2, `${store.pruneOld('6m', today, true)}`);
  check('⑤ 1년 — 지워질 줄 1(2025-01-03)', store.pruneOld('1y', today, true) === 1);
  check('⑤ 계속 보관 — 0', store.pruneOld('forever', today, true) === 0);
  const deleted = store.pruneOld('6m', today);
  const left = (db.prepare(`SELECT market_date, code FROM buy_judgments WHERE symbol = ? ORDER BY market_date`).all(FAKE) as { market_date: string; code: string }[]).map((r) => `${r.market_date}:${r.code}`);
  check('⑤ 6개월 정리 → 「사도 됨」(2025-01-02)은 남음', deleted === 2 && left.join(',') === '2025-01-02:score_buy,2026-06-01:no_signal_buy,2026-10-01:rr_block', left.join(','));

  // ── ⑥ 수익률 ──
  const c = Array.from({ length: 30 }, (_, k) => ({ timestamp: Date.parse(`2026-09-${String(k + 1).padStart(2, '0')}T12:00:00Z`), open: 100 + k, close: 101 + k }));
  const o = outcomes(c, FAKE, '2026-09-01', 30);
  const hand = (n: number) => Math.round(((c[n].close / c[1].open - 1) * 100 - ROUND_TRIP_COST) * 100) / 100;
  check('⑥ 5·10·20거래일 = 다음 날 시가 → N번째 거래일 종가 − 0.30%p', o[5] === hand(5) && o[10] === hand(10) && o[20] === hand(20), `${o[5]} ${o[10]} ${o[20]} · 손 ${hand(5)} ${hand(10)} ${hand(20)}`);
  const o2 = outcomes(c, FAKE, '2026-09-27', 30);
  check('⑥ 아직 날이 안 지난 칸은 null(봉 27번째 · 5거래일 뒤 = 32번째 없음)', o2[5] === null && o2[10] === null, JSON.stringify(o2));
  check('⑥ 끝나지 않은 봉은 쓰지 않음(6번째 봉 · 끝난 봉 25개면 20거래일 null, 30개면 값)', outcomes(c, FAKE, '2026-09-06', 25)[20] === null && outcomes(c, FAKE, '2026-09-06', 30)[20] !== null);

  // ── ⑦ 「사지 않은 이유」 요약 ──
  db.prepare(`DELETE FROM buy_judgments WHERE symbol = ?`).run(FAKE);
  const putB = (d: string, code: string, breakdown: { key: string; score: number; max: number }[]) =>
    store.upsertJudgment({ marketDate: d, symbol: FAKE, ruleId: base.id, ruleName: 'x', rule: rule.body, action: 'HOLD', code, score: 40, maxScore: 100, minScore: 65, breakdown, reference: null, reason: 'r' });
  putB('2026-10-01', 'no_signal_buy', [{ key: 'trend', score: 10, max: 30 }, { key: 'timing', score: 25, max: 25 }]);
  putB('2026-10-02', 'no_signal_buy', [{ key: 'trend', score: 0, max: 30 }, { key: 'timing', score: 8, max: 25 }]);
  putB('2026-10-05', 'no_signal_buy', [{ key: 'trend', score: 20, max: 30 }, { key: 'timing', score: 25, max: 25 }]);
  putB('2026-10-06', 'rr_block', [{ key: 'trend', score: 30, max: 30 }]);
  putB('2026-10-07', 'score_buy', []);
  const sum = reasonSummaries().find((x) => x.symbol === FAKE);
  check('⑦ 기준 미달 3 · 손익비 부족 1 · 사도 됨 1 · 가장 자주 모자란 조건 = 추세', !!sum && sum.days === 5 && sum.below === 3 && sum.rrBlock === 1 && sum.buy === 1 && sum.mostMissing === '추세', JSON.stringify(sum));

  // ── ⑦-b 날짜별 히스토리 — 같은 기록을 날짜로 묶는다 · 최근 날짜가 위 · 「사도 됨」 만 수익률 칸 ──
  const hd = await historyDays(0, 400);
  const dayOf = (d: string) => hd.days.find((x) => x.marketDate === d);
  const fakeOn = (d: string) => dayOf(d)?.rows.find((r) => r.symbol === FAKE);
  const sorted = hd.days.every((d, i) => i === 0 || hd.days[i - 1].marketDate > d.marketDate);
  check('⑦-b 날짜별 — 최근 날짜가 위 · 기록 있는 날 5일이 모두 보임', sorted && ['2026-10-01', '2026-10-02', '2026-10-05', '2026-10-06', '2026-10-07'].every((d) => fakeOn(d)), hd.days.map((d) => d.marketDate).join(','));
  check('⑦-b 날짜별 — 판단·점수 · 「사도 됨」 개수', fakeOn('2026-10-07')?.verdict === 'buy' && fakeOn('2026-10-06')?.verdict === 'rr_block' && fakeOn('2026-10-01')?.verdict === 'below' && fakeOn('2026-10-01')?.score === 40 && (dayOf('2026-10-07')?.buys ?? 0) >= 1, JSON.stringify(dayOf('2026-10-07')));
  check('⑦-b 날짜별 — 「사도 됨」 이 아닌 줄은 수익률 칸 비움', [fakeOn('2026-10-06'), fakeOn('2026-10-01')].every((r) => r && r.r5 === null && r.r10 === null && r.r20 === null));
  const page1 = await historyDays(0, 2);
  const page2 = await historyDays(2, 2);
  check('⑦-b 날짜별 — 30일씩 [더 보기](여기선 2일씩) 겹치지 않음', page1.days.length === Math.min(2, hd.totalDays) && !page2.days.some((d) => page1.days.some((p) => p.marketDate === d.marketDate)) && page1.totalDays === hd.totalDays, `${page1.days.map((d) => d.marketDate)} / ${page2.days.map((d) => d.marketDate)}`);

  // ── ⑦-c 날짜 하나의 순서 — 사도 됨 → 손익비 부족 → 기준 미달, 각각 총점 높은 순 → 티커 순 · 제목 = 사도 됨 첫 종목(없으면 티커 순 첫 종목) ──
  const R = (symbol: string, verdict: 'buy' | 'below' | 'rr_block', score: number) => ({ symbol, verdict, score });
  const mixed = [R('AAPL', 'below', 60), R('MSFT', 'rr_block', 70), R('NVDA', 'buy', 68), R('TSLA', 'buy', 72), R('AMZN', 'below', 45)];
  check('⑦-c 순서 — 사도 됨 있음: 사도 됨(총점 높은 순) → 손익비 부족 → 기준 미달', sortDayRows(mixed).map((r) => r.symbol).join(',') === 'TSLA,NVDA,MSFT,AAPL,AMZN', sortDayRows(mixed).map((r) => r.symbol).join(','));
  check('⑦-c 제목 — 사도 됨 있음: 그중 첫 종목(총점 높은 TSLA)', daySymbols(mixed)[0] === 'TSLA' && daySymbols(mixed).length === 5, daySymbols(mixed).join(','));
  const noBuy = [R('MSFT', 'rr_block', 70), R('NVDA', 'below', 60), R('AAPL', 'below', 40)];
  check('⑦-c 사도 됨 없음: 목록은 손익비 부족 → 기준 미달, 제목은 티커 순 첫 종목(AAPL)', sortDayRows(noBuy).map((r) => r.symbol).join(',') === 'MSFT,NVDA,AAPL' && daySymbols(noBuy)[0] === 'AAPL', `${sortDayRows(noBuy).map((r) => r.symbol)} / ${daySymbols(noBuy)}`);
  const tie = [R('NVDA', 'buy', 70), R('AAPL', 'buy', 70), R('005930', 'buy', 70)];
  check('⑦-c 총점 같음: 티커 순', sortDayRows(tie).map((r) => r.symbol).join(',') === '005930,AAPL,NVDA' && daySymbols(tie)[0] === '005930', sortDayRows(tie).map((r) => r.symbol).join(','));
  check('⑦-c 같은 종목이 규칙 둘로 두 줄이어도 제목 수는 한 번', daySymbols([R('AAPL', 'buy', 70), R('AAPL', 'below', 40), R('MSFT', 'below', 50)]).join(',') === 'AAPL,MSFT');
  const served = hd.days.every((d) => d.rows.map((r) => `${r.symbol}|${r.verdict}|${r.score}`).join() === sortDayRows(d.rows).map((r) => `${r.symbol}|${r.verdict}|${r.score}`).join());
  check('⑦-c 서버가 날짜마다 이 순서로 보낸다', served);

  // ── ⑨ 끝나지 않은 일봉 — 장중에 저장된 봉 + 다음 날 받기 실패 → 판단하지 않음 · 받기 성공 → 끝난 값 · 국내 NXT · 미국 마감 · 시장 기준 ──
  {
    const realFetch = globalThis.fetch;
    // 받기 실패 흉내 — 토스만 끊는다(지표 엔진은 그대로)
    const offline = () => {
      globalThis.fetch = (async (input: any, init?: any) => {
        const u = typeof input === 'string' ? input : input.url ?? String(input);
        if (u.includes('openapi.tossinvest.com')) throw new Error('offline(시험)');
        return realFetch(input, init);
      }) as typeof fetch;
    };
    const H = 3_600_000;
    const last = loadCandles('AAPL', '1d', 1)[0];
    const spyLast = loadCandles('SPY', '1d', 1)[0];
    const D = last.timestamp;
    const nextDay = D + 17.5 * H; // 그날 17:30 ET(마감 뒤 — 다시 받기 실패라 캐시만). 「다음 날」 로 두면 D 가 목요일 이하일 때 직전 거래일 봉이 없어 「오래된 봉」 이 먼저 걸린다
    const acc = createAccount({ name: '끝나지 않은 일봉 시험(지움)', initialBalance: 1_000_000, currency: 'USD' });
    try {
      offline();
      saveCandles('AAPL', '1d', [{ ...last, close: +(last.close * 1.03).toFixed(2) }], D + 10 * H); // 장중(10:00 ET)에 저장된 값
      const j1 = await judgeOnClose('AAPL', rule.body, { held: false }, nextDay);
      check('⑨ 장중에 저장된 봉 + 다음 날 받기 실패 → 판단하지 않음(unconfirmed)', j1.kind === 'unconfirmed' && j1.dates.includes(marketDate(D, 'AAPL')), JSON.stringify(j1.kind === 'unconfirmed' ? j1.dates : j1.kind));
      const { row: r1 } = await judgeSymbol('AAPL', rule.body, null, nextDay);
      check('⑨ 매수 판단도 「일봉을 확정하지 못해 판단을 미룹니다」', (r1.error ?? '').includes('확정하지 못해') && r1.verdict === null, r1.error ?? '');
      const st = { ...defaultStrategy(acc.id), ruleId: rule.id, symbols: ['AAPL'], maxPositions: 10 };
      const a1 = await runSignalChecks(st, rule.body, { force: true, now: new Date(nextDay) });
      check('⑨ 계좌 — 판단을 미루고 그날 판단을 마친 것으로 두지 않음(수동 실행은 늘 이유를 보임)', a1.notes.some((n) => n.code === 'bar_unconfirmed') &&
        getJudgedDay(acc.id, 'AAPL') !== marketDate(nextDay, 'AAPL') && a1.ordered === 0, `${a1.notes.map((n) => n.code)}`);
      // 매일 기록 — 일봉을 확정하지 못한 종목은 다음 틱에 다시(그 날짜를 「기록함」 으로 두지 않게 알려 준다)
      const prevSyms = store.getSymbols();
      const prevRule = store.getRuleId();
      store.setSymbols(['AAPL']);
      store.setRuleId(rule.id);
      const rec = await recordMarket('US', marketDate(D, 'AAPL'), nextDay);
      store.setSymbols(prevSyms);
      store.setRuleId(prevRule);
      check('⑨ 매일 기록 — 확정 못 한 종목은 unconfirmed 로 알림(그날을 기록함으로 두지 않음)', rec.unconfirmed.includes('AAPL') && rec.written === 0, JSON.stringify(rec));
      // 받기가 성공하면(마감 뒤 받은 값으로 덮임) 끝난 값으로 판단
      saveCandles('AAPL', '1d', [last], D + 17 * H);
      const j2 = await judgeOnClose('AAPL', rule.body, { held: false }, nextDay);
      check('⑨ 마감 뒤 받은 값으로 덮이면 → 끝난 값으로 판단', j2.kind === 'ok' && j2.completed.at(-1)!.close === last.close);
      // 시장 기준(SPY)도 장중 저장 봉은 빼고 쓴다 → 그날은 시장 데이터 없음(다음 틱에 다시)
      saveCandles('SPY', '1d', [{ ...spyLast, close: spyLast.close * 1.01 }], spyLast.timestamp + 10 * H);
      const ref = await loadMarketRef('US', spyLast.timestamp + 24 * H + 18 * H);
      check('⑨ 시장 기준 — 장중에 저장된 SPY 봉(마지막)은 빼고 쓴다', !!ref && !ref.candles.some((c) => c.timestamp === spyLast.timestamp) && ref.candles.length > 0);
      // 가운데 봉이 끝나지 않은 채면 200일선이 이어지지 않으므로 통째로 「시장 데이터 없음」
      saveCandles('SPY', '1d', [spyLast]);
      const spy2 = loadCandles('SPY', '1d', 3)[0];
      saveCandles('SPY', '1d', [{ ...spy2, close: spy2.close * 1.01 }], spy2.timestamp + 10 * H);
      check('⑨ 시장 기준 — 가운데 봉이 끝나지 않은 채면 null(시장 데이터 없음 → 다시 시도)', (await loadMarketRef('US', spyLast.timestamp + 24 * H + 18 * H)) === null);
      saveCandles('SPY', '1d', [spy2]);
      // 받기에 성공했는데 토스가 다시 주지 않은 「끝나지 않은」 줄은 지운다(영영 확정 못 함이 되지 않게)
      const tail = loadCandles('AAPL', '1d', 10);
      const ghostTs = tail[3].timestamp + 12 * H; // 받은 범위 안 · 토스 응답에는 없는 시각
      saveCandles('AAPL', '1d', [{ ...tail[3], timestamp: ghostTs }], ghostTs + 2 * H);
      const pruned = pruneUnconfirmedMissing('AAPL', tail, 16 * H);
      check('⑨ 받기 성공 뒤 응답에 없는 끝나지 않은 줄은 지움 · 끝난 줄은 그대로', pruned === 1 && !loadCandles('AAPL', '1d', 12).some((c) => c.timestamp === ghostTs) && loadCandles('AAPL', '1d', 10).length === 10);
    } finally {
      globalThis.fetch = realFetch;
      saveCandles('AAPL', '1d', [last]);
      saveCandles('SPY', '1d', [spyLast]);
      deleteStrategy(acc.id);
      deleteAccount(acc.id);
    }
    // 끝나는 시각 — 국내 20:00 KST(NXT) · 미국 16:00 ET
    const kr = loadCandles('005930', '1d', 50);
    const k = kr.at(-1)!.timestamp;
    const us = loadCandles('AAPL', '1d', 50);
    const u = us.at(-1)!.timestamp;
    check('⑨ 국내 — 17:00 KST(NXT 중)에는 그날 봉을 빼고, 20:30 KST 에는 넣는다', completedDaily(kr, '005930', k + 17 * H).length === kr.length - 1 && completedDaily(kr, '005930', k + 20.5 * H).length === kr.length);
    check('⑨ 미국 — 15:00 ET 에는 빼고, 17:00 ET 에는 넣는다', completedDaily(us, 'AAPL', u + 15 * H).length === us.length - 1 && completedDaily(us, 'AAPL', u + 17 * H).length === us.length);
  }

  // ── ⑩ 오래된 끝난 봉 — 받기 실패 + 장중 저장 봉도 없음 → 마지막 끝난 봉이 직전 거래일보다 앞이면 판단을 미룬다 ──
  //   가짜 종목(캐시에만 있음)에 날짜를 정한 일봉을 넣고 토스를 끊는다 — 월요일 · 휴장일 다음 날 · 국내 NXT · 미국
  {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (input: any, init?: any) => {
      const u = typeof input === 'string' ? input : input.url ?? String(input);
      if (u.includes('openapi.tossinvest.com')) throw new Error('offline(시험)');
      return realFetch(input, init);
    }) as typeof fetch;
    const US = 'ZZSTALE'; // 영문 → 미국
    const KR = '9ZSTAL'; // 숫자로 시작 → 국내(isKrSymbol)
    const H = 3_600_000;
    const back = (d: string) => new Date(Date.parse(`${d}T12:00:00Z`) - 24 * H).toISOString().slice(0, 10);
    // 그 시장 자정(봉 timestamp) — 미국 10월 EDT −4 · 11월 말 EST −5 · 국내 KST +9
    const midnight = (sym: string, d: string) => Date.parse(`${d}T00:00:00${sym === KR ? '+09:00' : d >= '2026-11-01' ? '-05:00' : '-04:00'}`);
    const at = (sym: string, d: string, hour: number) => midnight(sym, d) + hour * H;
    const clear = (sym: string) => getDb().prepare(`DELETE FROM candles WHERE symbol = ?`).run(sym);
    /** 그 시장 거래일 40개(휴장 건너뜀)를 lastDay 까지 — 마감 뒤에 받은 값으로 저장 */
    const seed = (sym: string, lastDay: string) => {
      clear(sym);
      const days: string[] = [];
      for (let d = lastDay; days.length < 40; d = back(d)) if (!isMarketClosed(sym === KR ? 'KR' : 'US', d)) days.unshift(d);
      let p = 100;
      const bars = days.map((d, i) => {
        p = +(p * (1 + Math.sin(i) * 0.01)).toFixed(2);
        return { timestamp: midnight(sym, d), open: p, high: +(p * 1.01).toFixed(2), low: +(p * 0.99).toFixed(2), close: p, volume: 1_000_000 + i };
      });
      saveCandles(sym, '1d', bars, midnight(sym, lastDay) + 22 * H);
    };
    const kindOf = async (sym: string, now: number) => {
      const j = await judgeOnClose(sym, rule.body, { held: false }, now);
      return j.kind === 'unconfirmed' ? `unconfirmed:${j.dates.join(',')}` : j.kind;
    };
    const acc = createAccount({ name: '오래된 일봉 시험(지움)', initialBalance: 1_000_000, currency: 'USD' });
    try {
      // 미국 — 이틀 전 봉(수)만 있고 금 10:00 ET → 직전 거래일(목) 없음 → 미룸
      seed(US, '2026-10-07');
      check('⑩ 미국 — 받기 실패 + 마지막 봉이 이틀 전 → 판단 미룸(확정 못 한 날짜 = 직전 거래일)', (await kindOf(US, at(US, '2026-10-09', 10))) === 'unconfirmed:2026-10-08', await kindOf(US, at(US, '2026-10-09', 10)));
      seed(US, '2026-10-08');
      check('⑩ 미국 — 직전 거래일(목) 봉 있음 → 정상', (await kindOf(US, at(US, '2026-10-09', 10))) === 'ok');
      seed(US, '2026-10-09');
      check('⑩ 미국 — 월요일 10:00 ET · 직전 거래일 = 금요일 → 정상', (await kindOf(US, at(US, '2026-10-12', 10))) === 'ok');
      check('⑩ 미국 — 월요일 17:00 ET(마감 뒤)인데 월요일 봉 없음 → 미룸', (await kindOf(US, at(US, '2026-10-12', 17))) === 'unconfirmed:2026-10-12');
      seed(US, '2026-11-25');
      check('⑩ 미국 — 추수감사절(목 휴장) 다음 날 금 10:00 ET · 직전 거래일 = 수 → 정상', (await kindOf(US, at(US, '2026-11-27', 10))) === 'ok');
      check('⑩ 미국 — 그 금요일 17:00 ET 에 금요일 봉 없음 → 미룸', (await kindOf(US, at(US, '2026-11-27', 17))) === 'unconfirmed:2026-11-27');
      // 국내 — 2026-10-05(월, 개천절 대체) · 10-09(금, 한글날) 휴장
      seed(KR, '2026-10-02');
      check('⑩ 국내 — 주말 + 대체 휴일(월) 다음 날 화 10:00 KST · 직전 거래일 = 금 → 정상', (await kindOf(KR, at(KR, '2026-10-06', 10))) === 'ok');
      seed(KR, '2026-10-07');
      check('⑩ 국내 — 마지막 봉이 수요일, 월 10:00 KST(목이 직전 거래일 — 금은 한글날) → 미룸', (await kindOf(KR, at(KR, '2026-10-12', 10))) === 'unconfirmed:2026-10-08');
      check('⑩ 국내 — 목 19:00 KST(NXT 중)에는 직전 거래일 = 수 → 정상', (await kindOf(KR, at(KR, '2026-10-08', 19))) === 'ok');
      check('⑩ 국내 — 목 20:30 KST(NXT 끝)에 목요일 봉 없음 → 미룸', (await kindOf(KR, at(KR, '2026-10-08', 20.5))) === 'unconfirmed:2026-10-08');
      // 마감(+10분) 뒤 받기가 성공했는데 그날 봉이 없음 — 거래정지(진행)와 토스 반영 지연(미룸)을 시장 기준으로 가른다
      seed(US, '2026-10-07');
      const lastBar = loadCandles(US, '1d', 1)[0];
      saveCandles(US, '1d', [lastBar], at(US, '2026-10-08', 16.05)); // 목 마감 3분 뒤 — 아직 덜 들어왔을 수 있다
      check('⑩ 직전 거래일 마감 직후(10분 안)에 받은 것뿐 → 미룸', (await kindOf(US, at(US, '2026-10-09', 10))) === 'unconfirmed:2026-10-08');
      saveCandles(US, '1d', [lastBar], at(US, '2026-10-08', 18)); // 목 18:00 ET 에 받기 성공 — 그런데 목요일 봉이 없다
      // 시장 기준(SPY · KODEX 200)에 그날 봉이 있는지로 거래정지와 토스 반영 지연을 가른다 — 받기를 바꿔치기해 그날 봉 유무를 정한다
      // 시장 기준도 가짜 이름(캐시에만) — 사본 DB 의 진짜 SPY 줄(받은 시각)과 섞이지 않게
      const REF_US = 'ZZREFUS';
      const REF_KR = '9ZREFK';
      const refWith = (days: string[]) => async (m: 'US' | 'KR') =>
        ({ market: m, symbol: m === 'US' ? REF_US : REF_KR, name: m, candles: days.map((d) => ({ timestamp: midnight(m === 'US' ? US : KR, d), open: 1, high: 1, low: 1, close: 1, volume: 1 })), series: {} as never });
      setMarketRefLoadForTest(refWith(['2026-10-07', '2026-10-08']));
      check('⑩ 받기 성공인데 그 종목만 그날 봉 없음(시장 기준에는 있음) = 거래정지 → 미루지 않고 판단', (await kindOf(US, at(US, '2026-10-09', 10))) === 'ok');
      setMarketRefLoadForTest(refWith(['2026-10-07']));
      check('⑩ 시장 기준에도 그날 봉 없음 = 토스 반영 지연 → 미룸', (await kindOf(US, at(US, '2026-10-09', 10))) === 'unconfirmed:2026-10-08');
      setMarketRefLoadForTest(async () => null);
      check('⑩ 시장 기준을 받지 못함 → 거래정지로 단정하지 않고 미룸', (await kindOf(US, at(US, '2026-10-09', 10))) === 'unconfirmed:2026-10-08');
      // 종목을 마지막으로 받은 것(목 18:00)이 시장 기준의 그날 봉을 받은 것보다 앞이면 — 이 종목은 지연 중에 받았고 이번 받기는 실패했을 수 있다 → 미룸
      setMarketRefLoadForTest(refWith(['2026-10-07', '2026-10-08']));
      const refBar = { timestamp: midnight(US, '2026-10-08'), open: 1, high: 1, low: 1, close: 1, volume: 1 };
      saveCandles(REF_US, '1d', [refBar], at(US, '2026-10-09', 9)); // 시장 기준 그날 봉은 금 09:00 ET 에 들어옴
      check('⑩ 종목의 마지막 받기가 시장 기준 그날 봉이 들어온 것보다 앞 → 거래정지로 단정하지 않고 미룸', (await kindOf(US, at(US, '2026-10-09', 10))) === 'unconfirmed:2026-10-08');
      saveCandles(REF_US, '1d', [refBar], at(US, '2026-10-08', 17)); // 목 17:00 ET 에 들어옴 — 종목 받기(18:00)가 뒤
      check('⑩ 시장 기준 그날 봉이 들어온 뒤에 받았는데도 그 종목만 없음 → 거래정지로 판단', (await kindOf(US, at(US, '2026-10-09', 10))) === 'ok');
      clear(REF_US);
      // 차트를 과거로 스크롤해 옛 봉만 지금 시각으로 저장된 경우는 「받기 성공」 이 아니다(최근 받기는 실패) → 미룸
      seed(US, '2026-10-07');
      saveCandles(US, '1d', [loadCandles(US, '1d', 30)[0]], at(US, '2026-10-08', 18));
      check('⑩ 옛 봉만 마감 뒤에 저장됨(차트 과거 스크롤) → 받기 성공으로 보지 않고 미룸', (await kindOf(US, at(US, '2026-10-09', 10))) === 'unconfirmed:2026-10-08');
      seed(KR, '2026-10-07');
      saveCandles(KR, '1d', [loadCandles(KR, '1d', 1)[0]], at(KR, '2026-10-12', 9.5)); // 월 09:30 KST 받기 성공(목 봉 없음)
      check('⑩ 국내 — 월 09:30 받기 성공에 목 봉 없음 · KODEX 200 에는 있음 → 판단', (await kindOf(KR, at(KR, '2026-10-12', 10))) === 'ok');
      setMarketRefLoadForTest(refWith(['2026-10-07']));
      check('⑩ 국내 — KODEX 200 에도 목 봉 없음 → 미룸', (await kindOf(KR, at(KR, '2026-10-12', 10))) === 'unconfirmed:2026-10-08');
      setMarketRefLoadForTest(null);
      check('⑩ 그 시장 날짜의 시각 — 미국 EDT · EST · 국내', marketDayTime('US', '2026-10-08', 16 * H) === Date.parse('2026-10-08T20:00:00Z') && marketDayTime('US', '2026-11-27', 16 * H) === Date.parse('2026-11-27T21:00:00Z') && marketDayTime('KR', '2026-10-08', 20 * H) === Date.parse('2026-10-08T11:00:00Z'));
      check('⑩ 직전 거래일 계산 = 시장 달력(주말 · 휴장 건너뜀)', lastClosedDay('KR', at(KR, '2026-10-12', 10), 20 * H) === '2026-10-08' && lastClosedDay('US', at(US, '2026-11-27', 10), 16 * H) === '2026-11-25' && lastClosedDay('US', at(US, '2026-10-12', 10), 16 * H) === '2026-10-09');

      // 매수 판단 · 매일 기록 · 계좌 — 「확정 못 함」 과 같은 경로
      seed(US, '2026-10-07');
      const now = at(US, '2026-10-09', 10);
      const { row } = await judgeSymbol(US, rule.body, null, now);
      check('⑩ 매수 판단 — 「일봉을 확정하지 못해 판단을 미룹니다」', (row.error ?? '').includes('2026-10-08') && (row.error ?? '').includes('확정하지 못해') && row.verdict === null, row.error ?? '');
      const prevSyms = store.getSymbols();
      const prevRule = store.getRuleId();
      store.setSymbols([US]);
      store.setRuleId(rule.id);
      const rec = await recordMarket('US', '2026-10-09', at(US, '2026-10-09', 16.5));
      store.setSymbols(prevSyms);
      store.setRuleId(prevRule);
      check('⑩ 매일 기록 — 확정 못 한 종목은 unconfirmed(그날 다시 시도)', rec.unconfirmed.includes(US) && rec.written === 0, JSON.stringify(rec));
      // 시장 기준도 같은 규칙 — 매일 기록에서 「시장 데이터 없음」 이면 줄은 쓰되 그날 다시 시도(계좌도 다시 시도)
      seed(US, '2026-10-09');
      const mrule = createRule(`__시장 데이터 없음 기록 ${Date.now()}`, (() => { const b = defaultRuleBody(); b.buy.minScore = 1; b.buy.gates = { above200: { on: false }, marketAbove200: { on: true } }; return b; })());
      store.setSymbols([US]);
      store.setRuleId(mrule.id);
      setMarketRefLoadForTest(async () => null);
      const recM = await recordMarket('US', '2026-10-09', at(US, '2026-10-09', 16.5));
      setMarketRefLoadForTest(null);
      store.setSymbols(prevSyms);
      store.setRuleId(prevRule);
      deleteRule(mrule.id);
      check('⑩ 매일 기록 — 시장 데이터 없음이면 줄은 쓰되 그날 다시 시도(unconfirmed)', recM.written === 1 && recM.unconfirmed.includes(US), JSON.stringify(recM));
      seed(US, '2026-10-07');
      resetPendingNotesForTest();
      const st = { ...defaultStrategy(acc.id), ruleId: rule.id, symbols: [US], maxPositions: 10 };
      const a1 = await runSignalChecks(st, rule.body, { now: new Date(now) });
      const a2 = await runSignalChecks(st, rule.body, { now: new Date(now + 60_000) });
      const a3 = await runSignalChecks(st, rule.body, { now: new Date(now + 6 * 60_000) });
      check('⑩ 계좌 — 미룸 · 그날 판단을 마치지 않음 · 1분 뒤는 보지 않고 5분 뒤 다시 · 「최근 판단」 은 처음 한 번',
        a1.notes.length === 1 && a1.notes[0].code === 'bar_unconfirmed' && a1.notes[0].reason.includes('2026-10-08') && a2.evaluated === 0 && a3.evaluated === 1 && a3.notes.length === 0 &&
          getJudgedDay(acc.id, US) !== '2026-10-09' && a1.ordered + a3.ordered === 0,
        `${a1.notes.map((n) => n.code)} · ${a2.evaluated} · ${a3.evaluated}/${a3.notes.length}`);
      // 다시 받기가 성공해 직전 거래일 봉이 들어오면 정상 판단 → 그날을 마친다
      seed(US, '2026-10-08');
      const a4 = await runSignalChecks(st, rule.body, { now: new Date(now + 12 * 60_000) });
      check('⑩ 계좌 — 직전 거래일 봉이 들어오면 판단하고 그날을 마침', a4.evaluated === 1 && !a4.notes.some((n) => n.code === 'bar_unconfirmed') && getJudgedDay(acc.id, US) === '2026-10-09', `${a4.notes.map((n) => n.code)}`);
    } finally {
      globalThis.fetch = realFetch;
      setMarketRefLoadForTest(null);
      clear(US);
      clear(KR);
      clear('ZZREFUS');
      resetPendingNotesForTest();
      deleteStrategy(acc.id);
      deleteAccount(acc.id);
    }
  }

  // ── ⑧ 규칙 삭제 → 매수 판단 규칙 비움 ──
  const tr = createRule('매수판단 시험 규칙(지움)', defaultRuleBody());
  tempRule = tr.id;
  store.setRuleId(tr.id);
  check('⑧ 매수 판단이 쓰는 규칙 → 「적용된 곳」 에 매수 판단', getRule(tr.id)?.usedBy.buyJudge === true);
  deleteRule(tr.id);
  tempRule = null;
  check('⑧ 규칙 삭제 → buyJudge.ruleId 비움(null)', store.getRuleId() === null);
} finally {
  cleanupRows();
  if (tempAccount !== null) deleteAccount(tempAccount);
  if (tempRule !== null) deleteRule(tempRule);
  store.setSymbols(saved.symbols);
  if (saved.ruleRaw) db.prepare(`INSERT INTO app_settings (key, value) VALUES ('buyJudge.ruleId', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(saved.ruleRaw.value);
  else db.prepare(`DELETE FROM app_settings WHERE key = 'buyJudge.ruleId'`).run();
  db.prepare(`DELETE FROM app_settings WHERE key = 'buyJudge.lastRecorded'`).run();
  for (const [m, d] of Object.entries(saved.recorded)) store.setLastRecorded(m as 'US' | 'KR', d!);
  if (addedHoliday) db.prepare(`DELETE FROM market_holidays WHERE market = 'KR' AND date = '2026-10-09'`).run();
}

// ── v2.59.2 날짜는 그 종목 · 그 일정의 시장 날짜로 ─────────────────────────────
{
  const db = getDb();
  const T = ['ZZUS1', '0ZZ002'];
  const put = (sym: string, date: string) =>
    db.prepare(`INSERT INTO earnings_calendar (symbol, earnings_date, fetched_at, is_estimate) VALUES (?, ?, 'x', 0) ON CONFLICT(symbol) DO UPDATE SET earnings_date = excluded.earnings_date`).run(sym, date);
  const ev = { reference: null } as unknown as RuleEvaluation;
  const warn = (sym: string, at: number) => warningsOf(sym, ev, null, null, null, at).find((w) => w.includes('실적')) ?? '';
  const et = (d: string, hm: string) => marketDayTime('US', d, (Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3))) * 60_000);
  const kst = (d: string, hm: string) => Date.parse(`${d}T${hm}:00+09:00`);

  // A. 매수 판단 실적 임박 — 미국 16:30 ET(= 한국 다음 날 05:30) 판단
  put('ZZUS1', '2026-10-29');
  check('실적 임박 — 미국 16:30 ET · 실적 오늘 → 「오늘」', warn('ZZUS1', et('2026-10-29', '16:30')).includes('2026-10-29 실적 발표 예정(오늘)'), warn('ZZUS1', et('2026-10-29', '16:30')));
  put('ZZUS1', '2026-10-30');
  check('실적 임박 — 미국 16:30 ET · 실적 내일 → 「1일 뒤」', warn('ZZUS1', et('2026-10-29', '16:30')).includes('(1일 뒤)'));
  put('ZZUS1', '2026-11-12');
  check('실적 임박 — 14일 뒤는 경고', warn('ZZUS1', et('2026-10-29', '16:30')).includes('(14일 뒤)'));
  put('ZZUS1', '2026-11-13');
  check('실적 임박 — 15일 뒤는 없음', warn('ZZUS1', et('2026-10-29', '16:30')) === '');
  put('ZZUS1', '2026-10-28');
  check('실적 임박 — 지난 실적은 없음', warn('ZZUS1', et('2026-10-29', '16:30')) === '');
  put('0ZZ002', '2026-10-30');
  check('실적 임박 — 국내 종목은 한국 날짜(20:30 KST · 오늘)', warn('0ZZ002', kst('2026-10-30', '20:30')).includes('(오늘)'));
  check('실적 임박 — 국내 종목 · 한국 다음 날 00:30 → 지남', warn('0ZZ002', kst('2026-10-31', '00:30')) === '');
  put('ZZUS1', '2026-11-02');
  check('실적 임박 — 서머타임 끝 앞(10-31 16:30 EDT) → 2일 뒤', warn('ZZUS1', et('2026-10-31', '16:30')).includes('(2일 뒤)'));
  check('실적 임박 — 서머타임 끝 뒤(11-01 23:30 EST = UTC 다음 날) → 1일 뒤', warn('ZZUS1', et('2026-11-01', '23:30')).includes('(1일 뒤)'));

  // B. 증시 일정 「지남」 — 한국 날짜와 미국 날짜가 갈리는 시각(한국 아침 = 미국 전날 저녁)으로만 본다(예전 코드면 틀리는 경우)
  const pastAt = (at: number, pick: (e: ReturnType<typeof calendarEvents>['events'][number]) => boolean) =>
    calendarEvents('2026-10-01', '2026-12-31', 'universe', at).events.find(pick)?.past;
  // 실적 — 유니버스에 있는 실제 종목(AAPL · 005930)을 사본 실적 달력에 넣어 calendarEvents 결과로 본다(끝나면 원래 값으로)
  const saved = db.prepare(`SELECT symbol, earnings_date, fetched_at, is_estimate FROM earnings_calendar WHERE symbol IN ('AAPL', '005930')`).all() as { symbol: string; earnings_date: string; fetched_at: string; is_estimate: number | null }[];
  try {
    put('AAPL', '2026-10-29');
    put('005930', '2026-10-29');
    const at = kst('2026-10-30', '08:00'); // 미국 10-29 19:00
    check('증시 일정 — 미국 실적(미국 오늘 10-29)은 한국 10-30 아침에 「지남」 아님', pastAt(at, (e) => e.type === 'earnings' && e.symbol === 'AAPL') === false);
    check('증시 일정 — 국내 실적(한국 어제 10-29)은 「지남」', pastAt(at, (e) => e.type === 'earnings' && e.symbol === '005930') === true);
    check('증시 일정 — 화면 「오늘」 은 한국 날짜', calendarEvents('2026-10-01', '2026-12-31', 'universe', at).meta.today === '2026-10-30');
  } finally {
    db.prepare(`DELETE FROM earnings_calendar WHERE symbol IN ('AAPL', '005930')`).run();
    for (const r of saved) db.prepare(`INSERT INTO earnings_calendar (symbol, earnings_date, fetched_at, is_estimate) VALUES (?, ?, ?, ?)`).run(r.symbol, r.earnings_date, r.fetched_at, r.is_estimate);
  }
  check('증시 일정 — FOMC 마지막 날(미국 12-09)은 한국 12-10 08:00 에 「지남」 아님', pastAt(kst('2026-12-10', '08:00'), (e) => e.type === 'fomc' && e.date === '2026-12-09') === false);
  check('증시 일정 — 월간 옵션 만기(미국 11-20)는 한국 11-21 08:00 에 「지남」 아님', pastAt(kst('2026-11-21', '08:00'), (e) => e.type === 'expiry' && e.date === '2026-11-20') === false);
  check('증시 일정 — 미국 휴장(추수감사절 11-26)은 한국 11-27 08:00 에 「지남」 아님', pastAt(kst('2026-11-27', '08:00'), (e) => e.type === 'holiday' && (e as { market?: string }).market === 'US' && e.date === '2026-11-26') === false);
  // 국내 휴장은 한국 날짜 — 사본에 한글날(10-09)을 넣었다가 지운다. 한국 10-10 08:00(미국 10-09) 에 「지남」 이어야 한다(미국 날짜로 보면 아님)
  const hadKr = db.prepare(`SELECT 1 FROM market_holidays WHERE market = 'KR' AND date = '2026-10-09'`).get();
  db.prepare(`INSERT OR IGNORE INTO market_holidays (market, date) VALUES ('KR', '2026-10-09')`).run();
  try {
    check('증시 일정 — 국내 휴장(10-09)은 한국 10-10 08:00 에 「지남」(한국 날짜)', pastAt(kst('2026-10-10', '08:00'), (e) => e.type === 'holiday' && (e as { market?: string }).market === 'KR' && e.date === '2026-10-09') === true);
  } finally {
    if (!hadKr) db.prepare(`DELETE FROM market_holidays WHERE market = 'KR' AND date = '2026-10-09'`).run();
  }

  db.prepare(`DELETE FROM earnings_calendar WHERE symbol IN (${T.map(() => '?').join(',')})`).run(...T);
}

void marketDate;
console.log(`\n결과: ${pass}개 통과 / ${fail}개 실패`);
process.exit(fail ? 1 : 0);
