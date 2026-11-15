/**
 * 오라클용 읽기 전용 보고 명령 두 개 시험 — `npm run oraclereport:test` · ⚠️ `DB_PATH=<사본>` 으로만 돈다(맨 첫 import).
 *
 * 135차 「꼭 지킬 동작」 4 — `brief:score-report` · `autotrade:report`:
 * 읽기만(DB 파일 바이트 같음) · 외부 호출 0(fetch · http · https · net 막음) · 출력에 금액 · 수량 0 · 100줄 안 · 「한 줄 결론」 · 기간 옵션 · 셈이 맞음.
 * 사본을 다시 임시 파일로 복사하고 그 안의 관련 표를 비운 뒤 만든 값만 넣는다(사본 · 사용자 DB 는 건드리지 않는다).
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import Database from 'better-sqlite3';
import { buildBriefScoreReport } from './lib/briefScoreReport';
import { buildAutotradeReport } from './lib/autotradeReport';
import { isMarketClosed } from '../server/marketCalendar';

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? ` — ${detail}` : ''}`);
};

const root = path.resolve(import.meta.dirname, '..');
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'as-oraclereport-'));
const file = path.join(work, 'report.db');
fs.copyFileSync(process.env.DB_PATH!, file);
const sha = () => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
/** WAL 모드 파일을 읽기 전용으로 열면 -wal · -shm 이 생길 수 있다 — 쓴 것이 없으면 -wal 은 비어 있다 */
const walEmpty = () => !fs.existsSync(`${file}-wal`) || fs.statSync(`${file}-wal`).size === 0;

// ── 만든 값 넣기(임시 파일) ──
// 금액 · 수량 · 가격은 눈에 띄는 숫자로 — 출력에 하나도 나오면 안 된다
const MONEY = ['12345678', '12,345,678', '23456789', '23,456,789', '987.65', '987', '437', '3456789', '3,456,789'];
{
  const w = new Database(file);
  w.pragma('foreign_keys = OFF'); // 만든 값만 넣는다(주문 줄 없이 체결 줄)
  w.exec(fs.readFileSync(path.join(root, 'db/schema.sql'), 'utf8'));
  w.exec(`CREATE TABLE IF NOT EXISTS gemini_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
  for (const t of ['market_brief_scores', 'market_briefs', 'paper_accounts', 'paper_trades', 'paper_positions', 'paper_snapshots', 'paper_cash_flows', 'buy_judgments', 'ai_check_uses', 'ai_checks', 'trading_rules']) w.exec(`DELETE FROM ${t}`);
  w.exec(`DELETE FROM candles WHERE symbol IN ('SPY', '069500')`);
  w.exec(`DELETE FROM gemini_settings WHERE key IN ('autoTrading.strategies', 'autoTrading.lastNotes')`);
  w.exec(`DELETE FROM market_holidays WHERE date LIKE '2026-10-%'`);
  w.prepare(`INSERT INTO market_holidays (market, date) VALUES ('KR', ?)`).run('2026-10-05');
  w.prepare(`INSERT INTO market_holidays (market, date) VALUES ('KR', ?)`).run('2026-10-09');

  // 채점 줄 — 코스피 5일 · S&P500 3일
  const score = w.prepare(`INSERT INTO market_brief_scores (target, trade_day, brief_id, direction, confidence, actual_pct, actual_direction, hit, scored_at) VALUES (?, ?, 1, ?, ?, ?, ?, ?, '2026-10-20T00:00:00Z')`);
  const flat = (p: number) => (Math.abs(p) < 0.3 ? '보합' : p > 0 ? '상승' : '하락');
  const kospi: [string, string, string, number][] = [
    ['2026-10-01', '상승', '높음', 0.8], // 맞음 · 0.5~1
    ['2026-10-02', '보합', '보통', 0.42], // 틀림(±0.5 면 맞음) · 0.3~0.5
    ['2026-10-06', '하락', '낮음', -1.6], // 맞음 · 1 넘음
    ['2026-10-07', '보합', '보통', 0.1], // 맞음 · 0.3 미만
    ['2026-10-08', '상승', '높음', -0.65], // 틀림(±0.7 면 보합 — 그래도 틀림) · 0.5~1
  ];
  for (const [d, dir, conf, p] of kospi) score.run('KOSPI', d, dir, conf, p, flat(p), dir === flat(p) ? 1 : 0);
  const sp: [string, string, string, number][] = [
    ['2026-10-01', '상승', '보통', 0.35],
    ['2026-10-02', '하락', '높음', 0.9],
    ['2026-10-05', '보합', '낮음', 0.95], // ±1.0 이면 보합 → 맞음
  ];
  for (const [d, dir, conf, p] of sp) score.run('SP500', d, dir, conf, p, flat(p), dir === flat(p) ? 1 : 0);

  // 채점 못 한 날 — 최근 거래일(국내) 08:00 KST 에 만든 코스피 예상, 채점 줄 없음 · 그 앞 거래일은 채점됨(세지 않음)
  const kstToday = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
  const back = (d: string, n: number) => new Date(Date.parse(`${d}T12:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
  const recent: string[] = [];
  for (let k = 2; recent.length < 2 && k < 20; k++) if (!isMarketClosed('KR', back(kstToday, k), w)) recent.push(back(kstToday, k));
  const brief = w.prepare(`INSERT INTO market_briefs (brief_date, edition, trigger, created_at, prompt_version, sources_json, data_json, brief_json) VALUES (?, 'morning', 'auto', ?, 'x', '[]', '{}', ?)`);
  for (const d of recent) brief.run(d, new Date(Date.parse(`${d}T08:00:00+09:00`)).toISOString(), JSON.stringify({ today_outlook: [{ target: 'KOSPI', direction: '상승', confidence: '보통', reason: 'x' }] }));
  score.run('KOSPI', recent[1], '상승', '보통', 0.5, '상승', 1); // 앞 거래일은 채점됨
  (globalThis as { __unscored?: string }).__unscored = recent[0];

  // 계좌 · 규칙 · 전략
  const rule = Number(w.prepare(`INSERT INTO trading_rules (name, rule_json, created_at, updated_at) VALUES ('시험 규칙', '{}', '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z')`).run().lastInsertRowid);
  const acc = w.prepare(`INSERT INTO paper_accounts (name, initial_balance, current_cash, currency, created_at, is_active) VALUES (?, 12345678, 23456789, 'USD', '2026-10-01T00:00:00Z', 1)`);
  const on = Number(acc.run('시험 켬').lastInsertRowid);
  const off = Number(acc.run('시험 끔').lastInsertRowid);
  const kr = Number(acc.run('시험 국내').lastInsertRowid);
  const strategies = {
    [on]: { enabled: true, ruleId: rule, symbols: ['AAPL', 'MSFT'], aiCheck: true },
    [off]: { enabled: true, ruleId: rule, symbols: ['MSFT', 'AAPL'], aiCheck: false },
    [kr]: { enabled: false, ruleId: rule, symbols: ['005930'], aiCheck: false },
  };
  w.prepare(`INSERT INTO gemini_settings (key, value) VALUES ('autoTrading.strategies', ?)`).run(JSON.stringify(strategies));
  w.prepare(`INSERT INTO gemini_settings (key, value) VALUES ('autoTrading.lastNotes', ?)`).run(
    JSON.stringify({ [on]: { at: '2026-10-30T14:00:00Z', day: '2026-10-30', notes: [{ symbol: 'AAPL', action: 'HOLD', reason: 'x', code: 'max_positions' }, { symbol: 'MSFT', action: 'HOLD', reason: 'x', code: 'no_signal_buy' }, { symbol: 'MSFT', action: 'HOLD', reason: 'x', code: 'no_signal_buy' }] } }),
  );
  const trade = w.prepare(`INSERT INTO paper_trades (account_id, order_id, symbol, side, price, quantity, commission, slippage, currency, traded_at) VALUES (?, 0, ?, ?, 987.65, 437, 1, 1, 'USD', ?)`);
  trade.run(on, 'AAPL', 'BUY', '2026-10-06T14:00:00Z');
  trade.run(on, 'AAPL', 'SELL', '2026-10-20T14:00:00Z');
  trade.run(off, 'AAPL', 'BUY', '2026-10-06T14:00:00Z');
  trade.run(off, 'MSFT', 'BUY', '2026-10-08T14:00:00Z');
  const pos = w.prepare(`INSERT INTO paper_positions (account_id, symbol, quantity, avg_price, total_cost, currency, opened_at, updated_at) VALUES (?, ?, 437, 987.65, 3456789, 'USD', 'x', 'x')`);
  pos.run(off, 'AAPL');
  pos.run(off, 'MSFT');
  w.prepare(`INSERT INTO paper_cash_flows (account_id, type, amount, created_at) VALUES (?, 'deposit', 3456789, '2026-10-10T00:00:00Z')`).run(on);
  const snap = w.prepare(`INSERT INTO paper_snapshots (account_id, date, total_value, cash, stock_value, cumulative_return) VALUES (?, ?, 23456789, 12345678, 3456789, ?)`);
  snap.run(on, '2026-10-14', 2.0);
  snap.run(on, '2026-10-30', 5.2);
  snap.run(off, '2026-10-14', 1.0);
  snap.run(off, '2026-10-30', -1.5);
  const candle = w.prepare(`INSERT OR REPLACE INTO candles (symbol, timeframe, timestamp, open, high, low, close, volume) VALUES (?, '1d', ?, 1, 1, 1, ?, 1)`);
  candle.run('SPY', Date.parse('2026-09-30T04:00:00Z'), 500);
  candle.run('SPY', Date.parse('2026-10-14T04:00:00Z'), 510);
  candle.run('SPY', Date.parse('2026-10-30T04:00:00Z'), 525);
  candle.run('069500', Date.parse('2026-09-29T15:00:00Z'), 40000);
  candle.run('069500', Date.parse('2026-10-29T15:00:00Z'), 38000);
  const bj = w.prepare(`INSERT INTO buy_judgments (market_date, symbol, rule_id, rule_name, rule_json, action, code, score, max_score, min_score, breakdown_json, reason, created_at, gate_reason) VALUES (?, ?, ?, '시험 규칙', '{}', ?, ?, 1, 1, 1, '[]', 'x', 'x', ?)`);
  bj.run('2026-10-05', 'AAPL', rule, 'BUY', 'score_buy', null); // 둘 다 10-06 에 삼
  bj.run('2026-10-07', 'MSFT', rule, 'BUY', 'score_buy', null); // 켬: AI 위험으로 안 삼 · 끔: 10-08 에 삼
  bj.run('2026-10-09', 'AAPL', rule, 'BUY', 'score_buy', null); // 둘 다 이미 보유 중
  bj.run('2026-10-12', 'MSFT', rule, 'HOLD', 'rr_block', null);
  bj.run('2026-10-13', 'AAPL', rule, 'HOLD', 'gate_block', 'below200');
  bj.run('2026-10-14', 'AAPL', rule, 'HOLD', 'no_signal_buy', null);
  bj.run('2026-10-05', '005930', rule, 'HOLD', 'no_signal_buy', null);
  bj.run('2026-10-14', 'NVDA', rule, 'BUY', 'score_buy', null); // 계좌 종목이 아님 — 세지 않음
  const ai = Number(w.prepare(`INSERT INTO ai_checks (market_date, symbol, verdict, prompt_version, created_at) VALUES ('2026-10-08', 'MSFT', 'risk', 'x', 'x')`).run().lastInsertRowid);
  w.prepare(`INSERT INTO ai_check_uses (check_id, account_id, action, created_at) VALUES (?, ?, 'skipped', 'x')`).run(ai, on);
  w.pragma('wal_checkpoint(TRUNCATE)');
  w.close();
}
const unscoredDay = (globalThis as { __unscored?: string }).__unscored!;

// ── 외부 호출 막기(이 프로세스) ──
let calls = 0;
const deny = (what: string) => () => {
  calls++;
  throw new Error(`시험 — 외부 호출 금지(${what})`);
};
globalThis.fetch = deny('fetch') as typeof fetch;
(http as { request: unknown }).request = deny('http');
(https as { request: unknown }).request = deny('https');
(net as { connect: unknown }).connect = deny('net');

const before = sha();
const ro = new Database(file, { readonly: true, fileMustExist: true });

// ── brief:score-report ──
console.log('1) brief:score-report');
const brief = await buildBriefScoreReport(ro);
const briefLines = brief.split('\n');
check('대상별 — 코스피 6일 · 맞음 4 · 틀림 2 · 67% · 채점 못 함 1(최근 거래일)', brief.includes(`| 코스피 | 6 | 4 | 2 | 67% | 1 (${unscoredDay}) |`), briefLines.find((l) => l.startsWith('| 코스피 | 6')) ?? '');
check('대상별 — S&P500 3일 · 맞음 1 · 틀림 2 · 채점 못 함 0', brief.includes('| S&P500 | 3 | 1 | 2 | 33% | 0 |'));
check('예상 방향별 · 확신별 — 코스피 상승 2/3 · 보합 1/2 · 하락 1/1 · 높음 1/2', brief.includes('| 코스피 | 2/3 (67%) | 1/2 (50%) | 1/1 (100%) | 1/2 (50%) | 2/3 (67%) | 1/1 (100%) |'), briefLines.find((l) => l.startsWith('| 코스피 | 2/')) ?? '');
check('실제 등락률 크기 — 코스피 0.3 미만 1 · 0.3~0.5 1 · 0.5~1 3 · 1 넘음 1', brief.includes('| 코스피 | 1 | 1 | 3 | 1 |'));
check('보합 기준 다시 셈 — 코스피 ±0.3 67% · ±0.5 83%(0.42 보합) · ±0.7 67%(0.65 · 0.5 보합) · ±1.0 50%(0.8 도 보합)', brief.includes('| 코스피 | 67% (실제 보합 1일) | 83% (실제 보합 2일) | 67% (실제 보합 4일) | 50% (실제 보합 5일) |'), briefLines.find((l) => l.startsWith('| 코스피 | 67%')) ?? '');
check('보합 기준 다시 셈 — S&P500 ±0.5 · ±0.7 0%(0.35 가 보합 → 틀림) · ±1.0 33%(0.95 「보합」 예상이 맞음 · 실제 보합 3일)', brief.includes('| S&P500 | 33% (실제 보합 0일) | 0% (실제 보합 1일) | 0% (실제 보합 1일) | 33% (실제 보합 3일) |'), briefLines.find((l) => l.startsWith('| S&P500 | 33%')) ?? '');
check('100줄 안 · 맨 끝 「한 줄 결론」', briefLines.length <= 100 && briefLines.at(-1)!.startsWith('한 줄 결론: ') && brief.includes('코스피 6일 중 4번 맞음'), `${briefLines.length}줄`);
const briefPeriod = await buildBriefScoreReport(ro, { from: '2026-10-02', to: '2026-10-07' });
check('기간 옵션 — 10-02 ~ 10-07 이면 코스피 3일 · S&P500 2일 · 채점 못 함 0(기간 밖)', briefPeriod.includes('| 코스피 | 3 | 2 | 1 | 67% | 0 |') && briefPeriod.includes('| S&P500 | 2 | 0 | 2 | 0% | 0 |') && briefPeriod.includes('기간: 2026-10-02 ~ 2026-10-07'));

// ── autotrade:report ──
console.log('\n2) autotrade:report');
const auto = buildAutotradeReport(ro, { today: '2026-10-31' });
const autoLines = auto.split('\n');
const line = (prefix: string) => autoLines.find((l) => l.startsWith(prefix)) ?? '';
const ids = (ro.prepare(`SELECT id, name FROM paper_accounts ORDER BY id`).all() as { id: number; name: string }[]).map((r) => `#${r.id} ${r.name}`);
const [onName, offName, krName] = ids;
check('계좌마다 — 켬: 규칙 · AI 켬 · 자동 켬 · 시작일 · 거래일 22 · 산 1 · 판 1 · 보유 0 · +5.20% · SPY +5.00%', line(`| ${onName} |`) === `| ${onName} | 시험 규칙 | 켬 | 켬 | 2026-10-01 | 22 | 1 | 1 | 0 | +5.20% | SPY +5.00% |`, line(`| ${onName} |`));
check('계좌마다 — 끔: 산 2 · 판 0 · 보유 2 · −1.50%', line(`| ${offName} |`) === `| ${offName} | 시험 규칙 | 끔 | 켬 | 2026-10-01 | 22 | 2 | 0 | 2 | −1.50% | SPY +5.00% |`, line(`| ${offName} |`));
check('계좌마다 — 국내: 거래일 20(10-05 · 10-09 휴장) · KODEX 200 −5.00% · 수익률 없음', line(`| ${krName} |`) === `| ${krName} | 시험 규칙 | 끔 | 끔 | 2026-10-01 | 20 | 0 | 0 | 0 | — | KODEX 200 −5.00% |`, line(`| ${krName} |`));
check('합계 줄 — 3계좌 · 산 3 · 판 1 · 보유 2', line('| 합계 3계좌 |').includes('| 3 | 1 | 2 |'), line('| 합계'));
const reasonOn = autoLines.filter((l) => l.startsWith(`| ${onName} |`))[1] ?? '';
check('못 산 이유 — 켬: 덮은 종목 2/2 · 판단 6 · 사도 됨 3 · 이유 많은 순(1씩 — 이름 순)', reasonOn === `| ${onName} | 2/2 | 6 | 3 | 거름망에 걸림 (200일선 아래) 1 · 기준 미달 1 · 손익비 부족 1 |`, reasonOn);
const missOn = autoLines.filter((l) => l.startsWith(`| ${onName} |`))[2] ?? '';
const missOff = autoLines.filter((l) => l.startsWith(`| ${offName} |`))[2] ?? '';
check('「사도 됨」 인데 사지 않음 — 켬 2(AI 위험 1 · 이미 보유 중 1) · AI 위험 계좌 기록 1', missOn === `| ${onName} | 3 | 2 | AI 검증 위험 1 · 이미 보유 중 1 | 1 |`, missOn);
check('「사도 됨」 인데 사지 않음 — 끔 1(이미 보유 중) · AI 칸 「끔」', missOff === `| ${offName} | 3 | 1 | 이미 보유 중 1 | — (끔) |`, missOff);
const lastOn = autoLines.filter((l) => l.startsWith(`| ${onName} |`))[3] ?? '';
check('마지막 판단 날 — 켬 10-30: 기준 미달(매수) 2 · 보유 종목 수 가득 1', lastOn === `| ${onName} | 2026-10-30 | 기준 미달(매수) 2 · 보유 종목 수 가득 1 |`, lastOn);
check('AI 켬 / 끔 견주기 — 같은 규칙 · 같은 종목(순서 달라도) 한 줄', auto.includes(`| ${onName} | ${offName} | +5.20% / −1.50% | 1 / 2 | 1 / 0 | 2 / 1 | 1 |`));
check('100줄 안 · 맨 끝 「한 줄 결론」', autoLines.length <= 100 && autoLines.at(-1)!.startsWith('한 줄 결론: 3계좌 · 산 3번 · 판 1번'), `${autoLines.length}줄 · ${autoLines.at(-1)}`);
const autoPeriod = buildAutotradeReport(ro, { from: '2026-10-15', to: '2026-10-30', today: '2026-10-31' });
check('기간 옵션 — 10-15 ~ 10-30: 켬 산 0 · 판 1 · 수익률 (1.052 ÷ 1.02 − 1) = +3.14% · SPY 510 → 525 = +2.94%', autoPeriod.split('\n').some((l) => l.startsWith(`| ${onName} |`) && l.includes('| 2026-10-15 | 12 | 0 | 1 | 0 | +3.14% | SPY +2.94% |')), autoPeriod.split('\n').find((l) => l.startsWith(`| ${onName} |`)) ?? '');

// ── 금액 · 수량 · 외부 호출 · 읽기만 ──
console.log('\n3) 금액 · 수량 · 외부 호출 · 읽기만');
const leaked = (s: string) => MONEY.filter((m) => s.includes(m));
check('출력에 금액 · 수량 · 가격 0(넣은 값 그대로든 쉼표든)', [brief, briefPeriod, auto, autoPeriod].every((s) => leaked(s).length === 0), [brief, auto].map(leaked).flat().join(', '));
check('외부 호출 0(fetch · http · https · net)', calls === 0, String(calls));
ro.close();
check('함수로 읽은 뒤 DB 파일 바이트 같음 · -wal 빔', sha() === before && walEmpty());

// ── 명령 그대로(자식 프로세스 · 오라클과 같은 모양) ──
console.log('\n4) 명령 그대로 — npm run -s brief:score-report · autotrade:report');
for (const [cmd, extra] of [['brief:score-report', []], ['brief:score-report', ['--', '--from', '2026-10-02', '--to', '2026-10-07']], ['autotrade:report', []], ['autotrade:report', ['--', '--from', '2026-10-15']]] as [string, string[]][]) {
  const r = spawnSync('npm', ['run', '-s', cmd, ...extra], { cwd: root, encoding: 'utf8', env: { ...process.env, DB_PATH: file }, timeout: 120_000 });
  const out = r.stdout ?? '';
  const lines = out.trimEnd().split('\n');
  check(`${cmd} ${extra.slice(1).join(' ')} — 종료 0 · 100줄 안 · 「한 줄 결론」 · 금액 0 · DB 바이트 같음 · -wal 빔`,
    r.status === 0 && lines.length <= 100 && lines.at(-1)!.startsWith('한 줄 결론: ') && leaked(out).length === 0 && sha() === before && walEmpty(),
    `${r.status} ${lines.length}줄 ${leaked(out).join(',')} ${(r.stderr ?? '').slice(0, 200)}`);
}

fs.rmSync(work, { recursive: true, force: true });
console.log(`\n결과: ${pass}개 통과 / ${fail}개 실패`);
process.exit(fail ? 1 : 0);
