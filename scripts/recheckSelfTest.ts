/**
 * 미국 매수 판단 다시 계산 점검 — `npm run recheck:test` · ⚠️ `DB_PATH=<사본>` 으로만 돈다(맨 첫 import). 지표 엔진(INDICATORS_PORT)이 떠 있어야 한다.
 * 네트워크 없음 — 일봉은 가짜(16:30 = 그날 거래량 적음 · 최종 = 많음), 시장 기준은 바꿔치기.
 *
 * ① 시각: 20:45 ET 앞뒤 · 그날 자정 넘으면 안 돎(소급 안 함) · 토요일 · 휴장일(추수감사절) · 서머타임 끝(11-01) 앞뒤
 * ② 같은 함수 `judgeOnClose` — 거래량 그룹 점수가 바뀌는 경우 · action 이 바뀌는 경우 · 안 바뀌는 경우(줄 없음 · 요약 「같음」)
 * ③ 16:30 봉 값: 판단 기록 전에 받은 캐시면 앎 · 뒤면 모름 ④ 계좌 쌍(보유 종목 뺌 · 16:30 값 없음)
 * ⑤ 같은 날 두 번 안 돎 · 16:30 기록 전이면 안 돎 · 스위치 끔 · 받기 실패는 다시(최대 3번) ⑥ 30일 정리
 * ⑦ buy_judgments 기존 줄 · 계좌 상태(설정 · 포지션 · 주문)가 바뀌지 않음 ⑧ 결과 글(`recheck:report`) 모양
 * 넣은 규칙 · 계좌 · 기록 · 설정은 끝에서 되돌린다.
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import 'dotenv/config';
import { getDb } from '../server/db';
import { createAccount, deleteAccount } from '../server/paperTradingService';
import { createRule, deleteRule } from '../server/rules/store';
import { deleteStrategy, saveStrategy } from '../server/autoTrading/store';
import { judgeOnClose } from '../server/rules/judge';
import type { MarketRefLoader } from '../server/rules/marketRef';
import { isMarketClosed } from '../server/marketCalendar';
import { marketDayTime } from '../server/marketHours';
import * as store from '../server/buyJudge/store';
import {
  RECHECK_MAX_TRIES,
  listRecheckDays,
  listRecheckRows,
  recheckDay,
  recheckDayOf,
  recheckPairs,
  recheckTick,
  resetRecheckTriesForTest,
  setRecheckHooksForTest,
  type FinalCandles,
} from '../server/buyJudge/recheck';
import { renderRecheckReport, changeKind, volumeChangePct } from './lib/recheckReport';
import { defaultRuleBody, type RuleBody } from '../src/types/tradingRule';
import type { Candle } from '../src/types/toss';

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const db = getDb();
/** 미국 동부 시각 → epoch ms(그날 자정 기준 — 서머타임은 `marketDayTime` 이 맞춘다) */
const et = (day: string, hm: string) => {
  const [h, m] = hm.split(':').map(Number);
  return marketDayTime('US', day, (h * 60 + m) * 60_000);
};

// ── ① 시각 ──
check('20:44 ET 안 돎 · 20:45 ET 그날(10-21 수)', recheckDayOf(et('2026-10-21', '20:44')) === null && recheckDayOf(et('2026-10-21', '20:45')) === '2026-10-21');
check('23:59 ET 그날 · 다음 날 00:01 · 10:00 ET 안 돎(놓친 날 소급 안 함)', recheckDayOf(et('2026-10-21', '23:59')) === '2026-10-21' && recheckDayOf(et('2026-10-22', '00:01')) === null && recheckDayOf(et('2026-10-22', '10:00')) === null);
check('토요일(10-24) · 추수감사절(11-26) 21:00 ET 안 돎', recheckDayOf(et('2026-10-24', '21:00')) === null && recheckDayOf(et('2026-11-26', '21:00')) === null);
check(
  '서머타임 끝 앞뒤 — 금 10-30 20:45 ET = 10-31 00:45Z · 월 11-02 20:45 ET = 11-03 01:45Z',
  recheckDayOf(Date.parse('2026-10-31T00:44:00Z')) === null && recheckDayOf(Date.parse('2026-10-31T00:45:00Z')) === '2026-10-30' &&
    recheckDayOf(Date.parse('2026-11-03T00:45:00Z')) === null && recheckDayOf(Date.parse('2026-11-03T01:45:00Z')) === '2026-11-02',
);

// ── 가짜 일봉 ──
const DAY = '2026-12-02'; // 사본 DB 에 그날 실제 기록이 없는 날(수)
const tradingDays = (end: string, n: number) => {
  const out: string[] = [];
  let t = Date.parse(`${end}T12:00:00Z`);
  while (out.length < n) {
    const d = new Date(t).toISOString().slice(0, 10);
    if (!isMarketClosed('US', d)) out.unshift(d);
    t -= 86_400_000;
  }
  return out;
};
const DAYS = tradingDays(DAY, 260);
/** 천천히 오르는 일봉 — 마지막 두 날 거래량 1.5M, 그날(마지막) 거래량 `lastVolume` */
function series(lastVolume: number, seed = 1): Candle[] {
  let x = 100;
  return DAYS.map((d, i) => {
    const wiggle = Math.sin(i * 0.7 * seed) * 1.2;
    const open = x;
    x = x * 1.002 + wiggle * 0.3;
    const close = x;
    const volume = i === DAYS.length - 1 ? lastVolume : i >= DAYS.length - 3 ? 1_500_000 : 1_000_000 + Math.round(Math.cos(i) * 50_000);
    return { timestamp: marketDayTime('US', d, 0), open, high: Math.max(open, close) * 1.01, low: Math.min(open, close) * 0.99, close, volume };
  });
}
const PARTIAL = series(600_000);
const FINAL = series(3_000_000);
const AT_1630 = et(DAY, '16:30');
const NOW = et(DAY, '20:50');
const noRefs = (): MarketRefLoader => ({ get: async () => null }) as unknown as MarketRefLoader;

const SYMS = ['ZZRCKA', 'ZZRCKB', 'ZZRCKC', 'ZZRCKD', 'ZZRCKE', 'ZZRCKH'] as const;
const cleanup = () => {
  db.prepare(`DELETE FROM buy_judgments WHERE symbol IN (${SYMS.map(() => '?').join(',')})`).run(...SYMS);
  db.prepare(`DELETE FROM buy_judgment_rechecks WHERE market_date IN (?, '2026-09-01')`).run(DAY);
  db.prepare(`DELETE FROM buy_judgment_recheck_days WHERE market_date IN (?, '2026-09-01')`).run(DAY);
};
const savedSettings = db.prepare(`SELECT key, value FROM app_settings WHERE key IN ('buyJudge.lastRecorded', 'buyJudge.recheckLast')`).all() as { key: string; value: string }[];
const savedEnv = process.env.BUYJUDGE_RECHECK_ENABLED;
cleanup();
let ruleA: number | null = null;
let ruleB: number | null = null;
let account: number | null = null;

try {
  // 규칙 둘 — 기본 규칙(점수만 바뀜) · 매수 기준을 최종 총점에 맞춘 규칙(16:30 = 기준 미달 → 최종 = 넘음)
  const body = defaultRuleBody();
  const before = await judgeOnClose('ZZRCKA', body, { held: false }, AT_1630, PARTIAL, noRefs());
  const after = await judgeOnClose('ZZRCKA', body, { held: false }, NOW, FINAL, noRefs());
  if (before.kind !== 'ok' || after.kind !== 'ok') throw new Error(`가짜 일봉 판단 못 함 ${before.kind} ${after.kind}`);
  const vol = (e: typeof before.ev) => e.breakdown.find((c) => c.key === 'volume')!.score;
  check('가짜 일봉 — 그날 거래량만 바꿔도 거래량 그룹 점수가 바뀐다(16:30 < 최종)', vol(before.ev) < vol(after.ev), `${vol(before.ev)} → ${vol(after.ev)} · 총점 ${before.ev.score} → ${after.ev.score}`);
  const tight: RuleBody = { ...body, buy: { ...body.buy, minScore: after.ev.score } };
  ruleA = createRule(`__다시 계산 시험 기본 ${Date.now()}`, body).id;
  ruleB = createRule(`__다시 계산 시험 기준 ${Date.now()}`, tight).id;

  // 16:30 기록(①) — 매수 판단 매일 기록과 같은 모양(`judge.save`)으로, 16:30 캔들로 같은 함수
  const record = async (symbol: string, ruleId: number, rule: RuleBody, candles: Candle[]) => {
    const j = await judgeOnClose(symbol, rule, { held: false }, AT_1630, candles, noRefs());
    if (j.kind !== 'ok') throw new Error('기록 못 함');
    store.upsertJudgment({
      marketDate: DAY, symbol, ruleId, ruleName: 'x', rule, action: j.ev.action, code: j.ev.code, score: j.ev.score, maxScore: j.ev.maxScore, minScore: rule.buy.minScore,
      breakdown: j.ev.breakdown.filter((c) => c.on).map((c) => ({ key: c.key, score: c.score, max: c.max })), reference: null, reason: j.ev.reasons[0] ?? '', gateReason: j.ev.gateReason ?? null,
    });
    // 매일 기록이 16:31 ET 에 썼다고 친다(시험 날짜는 지금보다 미래 — `upsertJudgment` 는 지금 시각을 쓴다)
    db.prepare(`UPDATE buy_judgments SET created_at = ? WHERE market_date = ? AND symbol = ? AND rule_id = ?`).run(new Date(AT_1630 + 60_000).toISOString(), DAY, symbol, ruleId);
    return j.ev;
  };
  const evA = await record('ZZRCKA', ruleA, body, PARTIAL); // 점수만 바뀜 · 16:30 봉 앎
  await record('ZZRCKB', ruleA, body, FINAL); // 같음(16:30 에도 최종값이었다고 친다)
  await record('ZZRCKC', ruleA, body, PARTIAL); // 바뀜 · 16:30 봉 모름(기록 뒤에 다시 받음)
  const evD = await record('ZZRCKD', ruleB, tight, PARTIAL); // 기준 미달 → 넘음
  const recordedJson = JSON.stringify(db.prepare(`SELECT * FROM buy_judgments WHERE symbol IN (${SYMS.map(() => '?').join(',')}) ORDER BY id`).all(...SYMS));

  // 계좌(②) — ZZRCKE(①에 없음) · ZZRCKH(보유 — 뺀다) · ZZRCKA(①에 있음 — 뺀다)
  account = createAccount({ name: '다시 계산 시험(지움)', initialBalance: 1_000_000, currency: 'USD' }).id;
  saveStrategy(account, { enabled: true, ruleId: ruleA, symbols: ['ZZRCKA', 'ZZRCKE', 'ZZRCKH'] }, () => true);
  db.prepare(`INSERT INTO paper_positions (account_id, symbol, name, quantity, avg_price, total_cost, currency, opened_at, updated_at) VALUES (?, 'ZZRCKH', NULL, 1, 100, 100, 'USD', ?, ?)`).run(account, new Date().toISOString(), new Date().toISOString());
  const acctState = () =>
    JSON.stringify([
      db.prepare(`SELECT key, value FROM app_settings WHERE key LIKE 'autoTrading.%' ORDER BY key`).all(),
      db.prepare(`SELECT * FROM paper_positions WHERE account_id = ?`).all(account),
      db.prepare(`SELECT * FROM paper_orders WHERE account_id = ?`).all(account),
      db.prepare(`SELECT * FROM paper_accounts WHERE id = ?`).all(account),
    ]);
  const acctBefore = acctState();

  const mine = new Set<string>(SYMS);
  const foreign = recheckPairs(DAY).filter((p) => !mine.has(p.symbol));
  const pairs = recheckPairs(DAY).filter((p) => mine.has(p.symbol));
  check('쌍 — ① 매수 판단 4줄 + ② 계좌 ZZRCKE 하나(①에 있는 ZZRCKA · 보유 ZZRCKH 뺌)', pairs.map((p) => `${p.symbol}:${p.source}`).join(',') === 'ZZRCKA:judgment,ZZRCKB:judgment,ZZRCKC:judgment,ZZRCKD:judgment,ZZRCKE:account', pairs.map((p) => `${p.symbol}:${p.source}`).join(','));

  // 가짜 받기 — 종목마다 몇 번 불렀는지(토스 일봉 호출 대신)
  const calls = new Map<string, number>();
  let failNext = false;
  const load = async (symbol: string): Promise<FinalCandles> => {
    calls.set(symbol, (calls.get(symbol) ?? 0) + 1);
    if (!mine.has(symbol)) return { candles: null, before: null };
    if (failNext && symbol === 'ZZRCKA') return { candles: null, before: null };
    const closeAt = et(DAY, '16:00');
    if (symbol === 'ZZRCKB') return { candles: FINAL, before: { bar: FINAL.at(-1)!, fetchedAt: closeAt + 30 * 60_000 } };
    if (symbol === 'ZZRCKC') return { candles: FINAL, before: { bar: PARTIAL.at(-1)!, fetchedAt: AT_1630 + 2 * 3_600_000 } }; // 기록(16:31) 뒤에 다시 받은 캐시
    return { candles: FINAL, before: { bar: PARTIAL.at(-1)!, fetchedAt: closeAt + 30 * 60_000 } };
  };
  setRecheckHooksForTest({ load, refs: noRefs, mock: false });
  resetRecheckTriesForTest();

  // ⑤ 스위치 · 16:30 기록 전 · 시각 전
  db.prepare(`DELETE FROM app_settings WHERE key = 'buyJudge.recheckLast'`).run();
  process.env.BUYJUDGE_RECHECK_ENABLED = 'false';
  check('스위치 끔 — 돌지 않음', (await recheckTick(NOW)).skipped === 'disabled' && !calls.size);
  delete process.env.BUYJUDGE_RECHECK_ENABLED;
  store.setLastRecorded('US', '2026-12-01');
  check('그날 16:30 기록 전 — 돌지 않음', (await recheckTick(NOW)).skipped === 'not_recorded' && !calls.size);
  store.setLastRecorded('US', DAY);
  check('20:44 ET — 돌지 않음', (await recheckTick(et(DAY, '20:44'))).skipped === 'not_time' && !calls.size);

  // 받기 실패 — 그날을 마치지 않고 다음 틱에 다시(최대 3번)
  failNext = true;
  const t1 = await recheckTick(NOW);
  check('받기 실패 — 그 쌍은 「받지 못함」 · 그날을 마치지 않음', t1.result != null && (await recheckTick(NOW + 300_000)).result != null, JSON.stringify(t1.result));
  const t3 = await recheckTick(NOW + 600_000);
  const t4 = await recheckTick(NOW + 900_000);
  check(`받기 실패가 남아도 ${RECHECK_MAX_TRIES}번째에 그날을 마침(토스 호출 상한)`, t3.result != null && t4.skipped === 'done');

  // 정상 — 처음부터 다시
  failNext = false;
  db.prepare(`DELETE FROM app_settings WHERE key = 'buyJudge.recheckLast'`).run();
  db.prepare(`DELETE FROM buy_judgment_rechecks WHERE market_date = ?`).run(DAY);
  resetRecheckTriesForTest();
  calls.clear();
  // 30일 정리 확인용 옛 줄
  db.prepare(`INSERT INTO buy_judgment_recheck_days (market_date, checked, same, changed, accounts, failed, symbols, finished_at) VALUES ('2026-09-01', 1, 1, 0, 0, 0, 1, 'x')`).run();
  const ok = await recheckTick(NOW);
  const r = ok.result!;
  check(
    '요약 — 매수 판단 4건 중 같음 1 · 달라짐 3 · 계좌 1쌍 · 받지 못함 = 사본 DB 의 다른 쌍만',
    r.checked - foreign.filter((p) => p.source === 'judgment').length === 4 && r.same === 1 && r.changed === 3 && r.accounts === 1 && r.failed === foreign.length,
    JSON.stringify(r),
  );
  check('토스 일봉 — 종목마다 한 번(같은 종목 두 규칙이어도)', [...calls.entries()].filter(([s]) => mine.has(s)).every(([, n]) => n === 1) && r.symbols === new Set(recheckPairs(DAY).map((p) => p.symbol)).size, JSON.stringify([...calls]));
  check('두 번째 틱 — 같은 날 다시 돌지 않음', (await recheckTick(NOW + 300_000)).skipped === 'done' && [...calls.values()].every((n) => n === 1));
  check('30일 정리 — 09-01 요약 지움', !db.prepare(`SELECT 1 FROM buy_judgment_recheck_days WHERE market_date = '2026-09-01'`).get() && ok.pruned >= 1);

  const rows = listRecheckRows().filter((x) => x.market_date === DAY);
  const row = (s: string) => rows.find((x) => x.symbol === s);
  check('같음(ZZRCKB) — 줄 없음', !row('ZZRCKB'));
  const a = row('ZZRCKA')!;
  check('점수만 바뀜(ZZRCKA) — 16:30 = 기록 줄 · 최종 = 같은 함수 · 거래량 그룹 점수', !!a && a.before_score === evA.score && a.after_score === after.ev.score && changeKind(a) !== 'action', a ? `${a.before_code} ${a.before_score} → ${a.after_code} ${a.after_score}` : '없음');
  check('16:30 봉 앎(기록 전에 받은 캐시) — 거래량 600,000 → 3,000,000 = +400.0%', a && JSON.parse(a.bar_before_json!).volume === 600_000 && JSON.parse(a.bar_after_json).volume === 3_000_000 && volumeChangePct(a) === 400);
  const c = row('ZZRCKC')!;
  check('16:30 봉 모름(기록 뒤에 다시 받은 캐시) — NULL · 변화 % 모름', !!c && c.bar_before_json === null && volumeChangePct(c) === null);
  const d = row('ZZRCKD')!;
  check(
    'action 바뀜(ZZRCKD — 매수 기준 = 최종 총점) · 16:30 기준 미달 → 최종 넘음',
    !!d && evD.action !== 'BUY' && d.before_action === evD.action && (d.after_code === 'score_buy' ? changeKind(d) === 'action' : changeKind(d) === 'code'),
    d ? `${d.before_action}/${d.before_code} → ${d.after_action}/${d.after_code}` : '없음',
  );
  const e = row('ZZRCKE')!;
  check('계좌 쌍(ZZRCKE) — 16:30 값 없음(before 비움) · 최종값 · 계좌 id', !!e && e.source === 'account' && e.before_action === null && e.bar_before_json === null && e.account_ids === JSON.stringify([account]));
  check('보유 종목(ZZRCKH) — 줄 없음', !row('ZZRCKH'));

  // ⑦ 기존 줄 · 계좌 그대로
  check('buy_judgments 기존 줄 — 바이트까지 같음', JSON.stringify(db.prepare(`SELECT * FROM buy_judgments WHERE symbol IN (${SYMS.map(() => '?').join(',')}) ORDER BY id`).all(...SYMS)) === recordedJson);
  check('계좌 상태(자동매매 설정 · 판단한 날 · 포지션 · 주문 · 계좌) — 그대로', acctState() === acctBefore);

  // 같은 날 다시 계산(수동) — 달랐다가 같아지면 줄을 지운다
  await recheckDay(DAY, NOW);
  check('다시 계산해도 줄 수 그대로(덮어씀)', listRecheckRows().filter((x) => x.market_date === DAY).length === rows.length);

  // ⑧ 결과 글
  const text = renderRecheckReport(rows, listRecheckDays().filter((x) => x.market_date === DAY));
  console.log('\n----- recheck:report 모양(시험 데이터) -----\n' + text + '\n-----');
  check('결과 글 — 「다시 계산 N건 · 달라짐 M건(action 바뀜 a · code 바뀜 b · 점수만 바뀜 c)」 · 한 줄 결론', /다시 계산 \d+건 · 달라짐 3건\(action 바뀜 \d · code 바뀜 \d · 점수만 바뀜 \d\)/.test(text) && /한 줄 결론/.test(text));
  check('결과 글 — 기록 없음', renderRecheckReport([], []).startsWith('다시 계산 기록이 없습니다'));
  // 모의 데이터 모드면 돌지 않는다
  setRecheckHooksForTest({ load, refs: noRefs, mock: true });
  db.prepare(`DELETE FROM app_settings WHERE key = 'buyJudge.recheckLast'`).run();
  check('모의 데이터 모드 — 돌지 않음', (await recheckTick(NOW)).skipped === 'mock');
} catch (err) {
  fail++;
  console.log(`FAIL  예외 — ${err instanceof Error ? err.stack : err}`);
} finally {
  setRecheckHooksForTest(null);
  if (savedEnv === undefined) delete process.env.BUYJUDGE_RECHECK_ENABLED;
  else process.env.BUYJUDGE_RECHECK_ENABLED = savedEnv;
  cleanup();
  if (account != null) {
    db.prepare(`DELETE FROM paper_positions WHERE account_id = ?`).run(account);
    deleteStrategy(account);
    deleteAccount(account);
  }
  if (ruleA != null) deleteRule(ruleA);
  if (ruleB != null) deleteRule(ruleB);
  db.prepare(`DELETE FROM app_settings WHERE key IN ('buyJudge.lastRecorded', 'buyJudge.recheckLast')`).run();
  for (const s of savedSettings) db.prepare(`INSERT INTO app_settings (key, value) VALUES (?, ?)`).run(s.key, s.value);
}

console.log(`\n결과: ${pass}개 통과 / ${fail}개 실패`);
process.exit(fail ? 1 : 0);
