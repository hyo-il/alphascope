/**
 * 매수 판단 점검 (v2.45.0) — `npm run buyjudge:test` · ⚠️ `DB_PATH=<사본>` 으로만 돈다(맨 첫 import). 지표 엔진이 떠 있어야 한다.
 *
 * ① 매수 판단 마감 판단 = 계좌 판단(같은 종목·날·규칙, 보유 없음 — action · score · code)
 * ② 매일 기록이 같은 날 두 번 돌아도 한 줄 ③ 휴장일 건너뜀 ④ 서버 재시작 — 가장 최근 날짜 하나만 ⑤ 보관 정리(「사도 됨」 은 남는다)
 * ⑥ 5·10·20거래일 수익률(비용 포함, 손 계산과 같음) ⑦ 「사지 않은 이유」 요약 ⑧ 규칙 삭제 → 매수 판단 규칙 비움
 * 넣은 계좌·규칙·기록·설정은 끝에서 되돌린다.
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다(v2.44.2)
import 'dotenv/config';
import { getDb } from '../server/db';
import { createAccount, deleteAccount } from '../server/paperTradingService';
import { runSignalChecks } from '../server/autoTrading/engine';
import { defaultStrategy } from '../src/types/autoTrading';
import { createRule, deleteRule, getRule, listRules } from '../server/rules/store';
import { defaultRuleBody, DEFAULT_RULE_NAME } from '../src/types/tradingRule';
import { judgeSymbol, latestRecordDay, outcomes, reasonSummaries, recordMarket, currentRule, historyDays, buildState } from '../server/buyJudge/judge';
import { buyJudgeTick } from '../server/buyJudge/scheduler';
import * as store from '../server/buyJudge/store';
import { ROUND_TRIP_COST } from '../server/analysis/targetHit';
import { marketDate } from '../src/utils/marketDate';
import { daySymbols, sortDayRows } from '../src/utils/buyJudgeOrder';
import { VERDICT_LABEL, verdictOf } from '../src/types/buyJudge';
import { gateBlockLabel } from '../src/types/autoTrading';
import { loadMarketRef, setMarketRefLoadForTest } from '../server/rules/marketRef';

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
  // 「보유 중」 으로 판단한다(v2.45.1 — 환율 버그가 고쳐져 원화 계좌가 미국 종목을 실제로 사게 되며 드러났다).
  const now = Date.now();
  const GUARD = new Set(['max_positions', 'earnings_blackout', 'daily_loss', 'other', 'error']);
  // v2.50.0 — 거름망(200일선) 켬 · 기준 1점(점수는 늘 통과 → 거름망이 가른다)
  const gateBody = { ...rule.body, buy: { ...rule.body.buy, minScore: 1, gates: { above200: { on: true } } } };
  const gateCodes: string[] = [];
  // v2.51.0 — 시장 필터 켬(기준 1점) — 시장 기준(SPY · KODEX 200)이 가른다. 이유(gateReason)까지 같아야 한다
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

  // ── ⑦-b 날짜별 히스토리 (v2.48.0) — 같은 기록을 날짜로 묶는다 · 최근 날짜가 위 · 「사도 됨」 만 수익률 칸 ──
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

  // ── ⑦-c 날짜 하나의 순서 (v2.48.1) — 사도 됨 → 손익비 부족 → 기준 미달, 각각 총점 높은 순 → 티커 순 · 제목 = 사도 됨 첫 종목(없으면 티커 순 첫 종목) ──
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

void marketDate;
console.log(`\n결과: ${pass}개 통과 / ${fail}개 실패`);
process.exit(fail ? 1 : 0);
