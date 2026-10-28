/**
 * 16:30 값 vs 최종값 매수 판단 견주기 점검 — `npm run ussample:judge:test` · ⚠️ `DB_PATH=<사본>` 으로만 돈다(맨 첫 import). 지표 엔진(INDICATORS_PORT)이 떠 있어야 한다.
 * 네트워크 없음 — 토스 일봉은 가짜(그날 뒤 봉도 섞음), 기록 파일은 임시 폴더.
 *
 * ① 고르기: 16:25~16:30 표본 · 16:30 우선 · 16:30 밖(16:15 · 16:35)만 있으면 「16:30 표본 없음」 · 최종 20:30 경계 · 실패 줄 · 다른 날 봉
 * ② 두 벌: 그날 뒤 봉 버림 · 마지막 봉 다섯 칸만 다름(앞 봉은 바이트로 같음)
 * ③ 판단: 거래량만 다를 때 「점수만 바뀜」(거래량 조건) · 문턱을 넘으면 「action 바뀜」 · 시장 기준 한 번만 받음 · 못 받으면 두 판단 같게
 * ④ 받기: 다시 시도 1번 · 받지 못함 · 토큰 발급 실패 뒤 멈춤 · 호출 상한 ⑤ 토스 값이 기록과 다름 · 일봉 부족 · 그날 봉 없음
 * ⑥ 규칙: 기본 + 자동매매 켠 계좌 규칙(중복 없이 · 꺼짐 · 없는 계좌 뺌 · 기본 규칙을 지웠으면 앱 기본값)
 * ⑦ 사본 DB · 기록 파일이 시험 전후 바이트로 같음 ⑧ 결과 글 · 한 줄 결론 ⑨ 명령 — 기록 없음 · 지표 엔진 꺼짐 안내(토스 부르지 않음)
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import 'dotenv/config';
import Database from 'better-sqlite3';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dbFilePath } from '../server/db';
import { marketDayTime } from '../server/marketHours';
import { TossAuthError } from '../src/services/toss/auth';
import { defaultRuleBody, type RuleBody } from '../src/types/tradingRule';
import { marketDate } from '../src/utils/marketDate';
import type { Candle } from '../src/types/toss';
import { readLines, type SampleLine } from './lib/usClose';
import { conclusionOf, judgeSamples, loadJudgeRules, pickTargets, renderJudgeReport, twoVersions, type JudgeRule } from './lib/usCloseJudge';

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const here = path.dirname(fileURLToPath(import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ussample-judge-'));
const sampleFile = path.join(tmp, 'us-close.jsonl');
const dbPath = dbFilePath();
// 읽기 전용으로 열어도 SQLite 가 빈 -wal · -shm 을 만든다(WAL 모드) — 없음과 빈 파일은 같은 것으로 본다. -shm 은 공유 메모리 색인이라 보지 않는다
const hashOf = (p: string) => crypto.createHash('sha256').update(fs.existsSync(p) ? fs.readFileSync(p) : Buffer.alloc(0)).digest('hex');
const dbHash = () => [dbPath, `${dbPath}-wal`].map(hashOf).join(',');
const dbHashBefore = dbHash();

// ── 가짜 일봉 ──
const DAY = '2026-10-21'; // 수
const LAST = '2026-10-23'; // 토스는 그날 뒤 봉(10-22 · 10-23)도 준다 — 버려야 한다
const weekdays = (end: string, n: number) => {
  const out: string[] = [];
  let t = Date.parse(`${end}T12:00:00Z`);
  while (out.length < n) {
    const d = new Date(t);
    if (d.getUTCDay() !== 0 && d.getUTCDay() !== 6) out.unshift(d.toISOString().slice(0, 10));
    t -= 86_400_000;
  }
  return out;
};
const DAYS = weekdays(LAST, 262);
const DAY_IDX = DAYS.indexOf(DAY);
/** 천천히 오르는 일봉 — 그날 앞 두 날 거래량 1.5M, 그날 `dayVolume`, 그날 뒤 두 날 9M(새면 결과가 달라진다) */
function series(dayVolume: number): Candle[] {
  let x = 100;
  return DAYS.map((d, i) => {
    const wiggle = Math.sin(i * 0.7) * 1.2;
    const open = x;
    x = x * 1.002 + wiggle * 0.3;
    const close = x;
    const volume = i === DAY_IDX ? dayVolume : i > DAY_IDX ? 9_000_000 : i >= DAY_IDX - 2 ? 1_500_000 : 1_000_000 + Math.round(Math.cos(i) * 50_000);
    return { timestamp: marketDayTime('US', d, 0), open, high: Math.max(open, close) * 1.01, low: Math.min(open, close) * 0.99, close, volume };
  });
}
const TOSS = series(3_000_000);
const DBAR = TOSS[DAY_IDX];

// ── 가짜 기록 파일 ──
const etIso = (day: string, hm: string) => new Date(marketDayTime('US', day, (Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3))) * 60_000)).toISOString();
const ok = (symbol: string, et: string, volume: number, extra: Partial<SampleLine> = {}): SampleLine => ({
  day: DAY, et, at: etIso(DAY, et), symbol, barDate: DAY, open: DBAR.open, high: DBAR.high, low: DBAR.low, close: DBAR.close, volume, ...extra,
});
const LINES: SampleLine[] = [
  ok('ZZJA', '16:25', 500_000), ok('ZZJA', '16:30', 600_000), ok('ZZJA', '20:40', 3_000_000), // 16:30 을 고름
  ok('ZZJB', '16:30', 600_000), ok('ZZJB', '20:40', 2_900_000), // 토스 그날 봉(3.0M)이 기록 최종값과 다름
  ok('ZZJR', '16:30', 600_000), ok('ZZJR', '20:30', 3_000_000), // 최종 20:30 = 경계 안 · 받기 한 번 실패 뒤 다시 시도로 받음
  ok('ZZJF', '16:30', 600_000), ok('ZZJF', '20:40', 3_000_000), // 두 번 다 실패 → 받지 못함
  ok('ZZJS', '16:30', 600_000), ok('ZZJS', '20:40', 3_000_000), // 일봉 10개뿐 → 일봉 부족
  ok('ZZJN', '16:30', 600_000), ok('ZZJN', '20:40', 3_000_000), // 토스에 그날 봉 없음
  ok('ZZJL', '16:30', 600_000), ok('ZZJL', '20:25', 3_000_000), // 최종 20:25 → 믿기 어려움
  ok('ZZJQ', '16:15', 600_000), ok('ZZJQ', '16:35', 700_000), ok('ZZJQ', '20:40', 3_000_000), // 16:25~16:30 밖만 → 16:30 표본 없음
  { day: DAY, et: '16:30', at: etIso(DAY, '16:30'), symbol: 'ZZJE', error: '토스 500' }, // 실패 줄
  ok('ZZJE', '20:40', 3_000_000, { barDate: '2026-10-20', error: '그날 봉 없음' }), // 다른 날 봉
  ok('ZZJV', '16:30', 600_000, { close: undefined }), ok('ZZJV', '20:40', 3_000_000), // 16:30 표본 종가 빠짐 → 기록 칸 빠짐
  ok('ZZJD', '16:30', 600_000, { barDate: '2026-10-20' }), ok('ZZJD', '20:40', 3_000_000, { barDate: '2026-10-20' }), // barDate ≠ day(오류 칸 없이도)
];
fs.writeFileSync(sampleFile, LINES.map((l) => JSON.stringify(l)).join('\n') + '\n');
const sampleHashBefore = hashOf(sampleFile);

/** 가짜 토스 — 종목별 횟수 · 실패 흉내 */
const SPY = series(80_000_000).map((c, i) => ({ ...c, close: 400 + i, open: 400 + i, high: 401 + i, low: 399 + i }));
function fakeToss(opts: { spyFails?: boolean; authFailFirst?: boolean } = {}) {
  const calls = new Map<string, number>();
  const fetchDaily = async (symbol: string): Promise<Candle[]> => {
    const n = (calls.get(symbol) ?? 0) + 1;
    calls.set(symbol, n);
    if (opts.authFailFirst) throw new TossAuthError('토큰 발급 실패 (429): too many', 429, '');
    if (symbol === 'SPY') {
      if (opts.spyFails) throw new Error('토스 500');
      return SPY;
    }
    if (symbol === 'ZZJF' || (symbol === 'ZZJR' && n === 1)) throw new Error('토스 500');
    if (symbol === 'ZZJS') return TOSS.slice(DAY_IDX - 9, DAY_IDX + 1);
    if (symbol === 'ZZJN') return TOSS.filter((c) => marketDate(c.timestamp, 'ZZJN') !== DAY);
    return [...TOSS].reverse(); // 순서가 뒤집혀 와도 정렬한다
  };
  return { calls, fetchDaily };
}

try {
  // ── ① 고르기 ──
  const picked = pickTargets(readLines(sampleFile));
  check(
    '고르기 — 16:30 표본 + 최종 20:30 이상만(ZZJA·B·F·N·R·S) · 최종 20:25 따로(1) · 16:15/16:35 만 → 표본 없음(1) · 종가 빠짐 따로(1) · 실패 줄 · 다른 날 봉 빠짐',
    picked.targets.map((t) => t.symbol).sort().join(',') === 'ZZJA,ZZJB,ZZJF,ZZJN,ZZJR,ZZJS' && picked.lateFinal === 1 && picked.noNear === 1 && picked.incomplete === 1,
    `${picked.targets.map((t) => t.symbol).join(',')} · 늦음 ${picked.lateFinal} · 없음 ${picked.noNear}`,
  );
  const ta = picked.targets.find((t) => t.symbol === 'ZZJA')!;
  check('고르기 — 16:25 · 16:30 둘 다 있으면 16:30 · 최종 = 마지막 줄(20:40)', ta.near.et === '16:30' && ta.near.volume === 600_000 && ta.final.et === '20:40');

  // ── ② 두 벌 ──
  const v = twoVersions([...TOSS].reverse(), ta)!;
  const lastDay = (c: Candle[]) => marketDate(c.at(-1)!.timestamp, 'ZZJA');
  check('두 벌 — 그날 뒤 봉(10-22 · 10-23) 버림 · 마지막 = 그날', !!v && lastDay(v.partial) === DAY && lastDay(v.final) === DAY && v.partial.length === DAY_IDX + 1 && v.final.length === DAY_IDX + 1);
  check('두 벌 — 앞 봉은 바이트로 같음', JSON.stringify(v.partial.slice(0, -1)) === JSON.stringify(v.final.slice(0, -1)) && JSON.stringify(v.final.slice(0, -1)) === JSON.stringify(TOSS.slice(0, DAY_IDX)));
  const pl = v.partial.at(-1)!;
  const fl = v.final.at(-1)!;
  check('두 벌 — 마지막 봉은 기록 값(16:30 거래량 600,000 · 최종 3,000,000 · 시각 그대로)', pl.volume === 600_000 && fl.volume === 3_000_000 && pl.timestamp === DBAR.timestamp && fl.timestamp === DBAR.timestamp && pl.close === fl.close);
  check('두 벌 — 그날 봉이 없으면 null', twoVersions(TOSS.filter((c) => marketDate(c.timestamp, 'X') !== DAY), ta) === null);

  // ── ③④⑤ 판단 ──
  const basic: JudgeRule = { id: 1, name: '기본 규칙', body: defaultRuleBody(), accountIds: [] };
  // 문턱 = 최종값 판단의 총점 — 기본 규칙으로 한 번 판단해 맞춘다
  const probe = await judgeSamples({ lines: LINES.filter((l) => l.symbol === 'ZZJA'), rules: [basic], fetchDaily: async () => TOSS });
  const sa = probe.changed[0];
  check('기본 규칙 — 거래량만 다르면 「점수만 바뀜」 · 바뀐 조건 = 거래량', !!sa && sa.kind === 'score' && sa.conditions.join() === '거래량', sa ? `${sa.row.before_score} → ${sa.row.after_score} · ${sa.conditions.join()}` : '달라짐 없음');
  const tight: RuleBody = { ...basic.body, buy: { ...basic.body.buy, minScore: sa?.row.after_score ?? 0 } };
  const market: RuleBody = { ...basic.body, buy: { ...basic.body.buy, gates: { marketAbove200: { on: true } } } };
  const rules: JudgeRule[] = [basic, { id: 2, name: '문턱 규칙', body: tight, accountIds: [7] }, { id: 3, name: '시장 필터', body: market, accountIds: [8] }];

  const t1 = fakeToss();
  const r = await judgeSamples({ lines: readLines(sampleFile), rules, fetchDaily: t1.fetchDaily });
  const byRule = (sym: string, id: number) => r.changed.find((c) => c.row.symbol === sym && c.row.rule_id === id);
  const d = byRule('ZZJA', 2);
  check(
    '문턱 규칙 — 16:30 기준 미달 → 최종 넘음 = 「action 바뀜」(손익비 부족이면 「code 바뀜」)',
    !!d && d.row.before_action !== 'BUY' && d.row.before_code !== 'score_buy' && (d.row.after_code === 'score_buy' ? d.kind === 'action' : d.kind === 'code'),
    d ? `${d.row.before_action}/${d.row.before_code} → ${d.row.after_action}/${d.row.after_code} · ${d.kind}` : '없음',
  );
  const g = byRule('ZZJA', 3);
  check('시장 필터 규칙 — 시장 기준(SPY 200일선 위)을 같게 넘겨 거름망은 두 판단 같음(점수만 바뀜)', !!g && g.kind === 'score' && g.row.before_gate_reason === g.row.after_gate_reason && !g.conditions.includes('거름망'), g ? `${g.row.before_code} → ${g.row.after_code}` : '없음');
  check('16:30 거래량 → 최종 거래량 변화 +400.0%(같은 `volumeChangePct`)', /\+400\.0%/.test(renderJudgeReport(r)));
  check(
    '요약 — 견줌 9(ZZJA·B·R × 3) · 받지 못함 3(ZZJF) · 판단 못 함 6(일봉 부족 3 · 그날 봉 없음 3) · 믿기 어려움 1 · 표본 없음 1',
    r.compared === 9 && r.notFetched === 3 && r.skipped === 6 && r.skipReasons['일봉 부족'] === 3 && r.skipReasons['받은 일봉에 그날 봉 없음'] === 3 && r.lateFinal === 1 && r.noNear === 1,
    JSON.stringify({ c: r.compared, nf: r.notFetched, s: r.skipReasons, l: r.lateFinal, n: r.noNear }),
  );
  check('토스 값이 기록과 다름 — ZZJB 거래량만(판단은 기록 값으로 — ZZJA 와 같은 결과)', r.tossDiffers.length === 1 && r.tossDiffers[0].symbol === 'ZZJB' && r.tossDiffers[0].fields.join() === '거래량');
  check(
    '토스 호출 — 종목마다 한 번 · SPY 한 번 · 실패만 다시 시도 1번(ZZJF 2 · ZZJR 2) · 상한 = 종목 6 + 시장 기준 1',
    t1.calls.get('SPY') === 1 && t1.calls.get('ZZJA') === 1 && t1.calls.get('ZZJF') === 2 && t1.calls.get('ZZJR') === 2 && r.calls === 9 && r.retries === 2 && r.callLimit === 7 && !t1.calls.has('ZZJL') && !t1.calls.has('ZZJQ'),
    `${JSON.stringify([...t1.calls])} · ${r.calls}번 · 상한 ${r.callLimit}`,
  );

  // 시장 필터 규칙이 없으면 SPY 를 받지 않는다 · SPY 를 받지 못하면 두 판단 모두 「시장 데이터 없음」(같음)
  const t2 = fakeToss();
  const r2 = await judgeSamples({ lines: readLines(sampleFile), rules: [basic], fetchDaily: t2.fetchDaily });
  check('시장 필터 규칙 없음 — SPY 안 받음 · 상한 = 종목 수', !t2.calls.has('SPY') && r2.callLimit === 6 && !r2.usesRef);
  const t3 = fakeToss({ spyFails: true });
  // 문턱을 16:30 총점으로 낮춰 두 판단 모두 점수는 넘게 — 거름망에서 같은 이유로 걸려야 한다
  const marketLow: RuleBody = { ...market, buy: { ...market.buy, minScore: sa?.row.before_score ?? 0 } };
  const r3 = await judgeSamples({ lines: LINES.filter((l) => l.symbol === 'ZZJA'), rules: [{ id: 4, name: '시장 필터 낮은 문턱', body: marketLow, accountIds: [] }], fetchDaily: t3.fetchDaily });
  const g3 = r3.changed[0];
  check(
    'SPY 받지 못함 — 두 판단 모두 거름망(같은 이유) · action 그대로 · 머리에 ⚠️',
    r3.refMissing && r3.compared === 1 && !!g3 && g3.row.before_code === 'gate_block' && g3.row.after_code === 'gate_block' && g3.row.before_gate_reason != null && g3.row.before_gate_reason === g3.row.after_gate_reason && g3.kind === 'score' && /⚠️ 시장 기준을 받지 못해/.test(renderJudgeReport(r3)),
    g3 ? `${g3.row.before_code}/${g3.row.before_gate_reason} → ${g3.row.after_code}/${g3.row.after_gate_reason}` : '같음',
  );
  // 토큰 발급 실패 — 다시 시도하지 않고 남은 종목도 부르지 않는다
  const t4 = fakeToss({ authFailFirst: true });
  const r4 = await judgeSamples({ lines: readLines(sampleFile), rules: [basic], fetchDaily: t4.fetchDaily });
  check('토큰 발급 실패 — 1번만 부르고 멈춤 · 모두 받지 못함', r4.calls === 1 && [...t4.calls.values()].reduce((a, n) => a + n, 0) === 1 && r4.notFetched === 6 && r4.compared === 0);
  check('한 줄 결론 — 견준 것 없음', conclusionOf(r4).includes('견준 매수 판단이 없음'));
  // 견줄 것이 없으면(표본 없음만) 시장 기준도 받지 않는다
  const t5 = fakeToss();
  const r5 = await judgeSamples({ lines: LINES.filter((l) => l.symbol === 'ZZJQ'), rules, fetchDaily: t5.fetchDaily });
  check('견줄 것 없음 — SPY 도 받지 않음(호출 0)', r5.calls === 0 && t5.calls.size === 0);

  // ── ⑥ 규칙 ──
  const mem = new Database(':memory:');
  mem.exec(`CREATE TABLE trading_rules (id INTEGER PRIMARY KEY, name TEXT, rule_json TEXT); CREATE TABLE paper_accounts (id INTEGER PRIMARY KEY, sort_order INTEGER);
            CREATE TABLE gemini_settings (key TEXT PRIMARY KEY, value TEXT);`);
  const body = JSON.stringify(defaultRuleBody());
  for (const [id, name] of [[1, '기본 규칙'], [2, '내 규칙'], [3, '꺼진 규칙'], [4, '없는 계좌 규칙']] as const) mem.prepare(`INSERT INTO trading_rules VALUES (?, ?, ?)`).run(id, name, body);
  for (const id of [1, 2, 3, 4, 5]) mem.prepare(`INSERT INTO paper_accounts VALUES (?, ?)`).run(id, id);
  mem.prepare(`INSERT INTO gemini_settings VALUES ('autoTrading.strategies', ?)`).run(
    JSON.stringify({ 1: { enabled: true, ruleId: 2 }, 2: { enabled: true, ruleId: 2 }, 3: { enabled: true, ruleId: 1 }, 4: { enabled: false, ruleId: 3 }, 5: { enabled: true, ruleId: 99 }, 9: { enabled: true, ruleId: 4 } }),
  );
  const loaded = loadJudgeRules(mem);
  check(
    '규칙 — 기본(#1, 계좌 3) + 계좌 규칙(#2, 계좌 1·2) · 꺼진 계좌 · 없는 규칙 · 없는 계좌 뺌 · 중복 없음',
    loaded.map((x) => `${x.id}:${x.accountIds.join('·')}`).join(',') === '1:3,2:1·2',
    loaded.map((x) => `${x.id}:${x.name}:${x.accountIds.join('·')}`).join(','),
  );
  mem.prepare(`DELETE FROM trading_rules WHERE id = 1`).run();
  mem.prepare(`DROP TABLE gemini_settings`).run();
  const fallback = loadJudgeRules(mem);
  check('규칙 — 「기본 규칙」 을 지웠으면 앱 기본값 · 설정 표가 없으면 계좌 규칙 없음', fallback.length === 1 && fallback[0].id === null && JSON.stringify(fallback[0].body) === body);
  mem.close();

  // ── ⑦ 사본 DB 로 한 바퀴 — 읽기 전용 연결 ──
  const ro = new Database(dbPath, { readonly: true, fileMustExist: true });
  const copyRules = loadJudgeRules(ro);
  ro.close();
  const rc = await judgeSamples({ lines: readLines(sampleFile), rules: copyRules, fetchDaily: fakeToss().fetchDaily });
  check('사본 DB 규칙으로 한 바퀴', copyRules.length >= 1 && rc.compared === 3 * copyRules.length, copyRules.map((x) => `${x.name}(#${x.id})`).join(' · '));
  console.log('\n----- ussample:judge 모양(시험 데이터 · 규칙 3개) -----\n' + renderJudgeReport(r) + '\n-----\n');

  // ── ⑧ 결과 글 ──
  const text = renderJudgeReport(r);
  check(
    '결과 글 — 머리(기간 · 규칙 이름 · 「시장 기준(SPY)은 두 판단 모두 최종값」) · 요약 줄 · 달라진 줄 · 한 줄 결론',
    text.includes(`${DAY} ~ ${DAY} (1일)`) && text.includes('문턱 규칙(#2) — 계좌 7') && text.includes('시장 기준(SPY)은 두 판단 모두 최종값') &&
      /견줌 9건 · 달라짐 \d+건\(action 바뀜 \d+ · code 바뀜 \d+ · 점수만 바뀜 \d+\) · 같음 \d+건 · 판단 못 함\(일봉 부족 등\) 6 · 최종값 믿기 어려움 1 · 토스 값이 기록과 다름 1 · 토스 일봉 호출 9번/.test(text) &&
      /\n2026-10-21 \| ZZJA \| 기본 규칙 \| .+ \| \+400\.0% \| 거래량/.test(text) && /\n한 줄 결론: 9건 중 사도 됨\/아님이 바뀐 것 /.test(text),
  );
  const none = { ...probe, changed: [], same: probe.compared };
  check('한 줄 결론 — 모두 같으면 「16:30 값과 최종값의 판단이 같았다」(다른 표본 수) + 범위(일 · 종목·날짜 · 규칙) — 숫자 이상을 말하지 않음', /0건 — 16:30 값과 최종값의 판단이 같았다\(16:30 값이 최종값과 다른 종목·날짜 1개\) \(1일 · 기록한 종목·날짜 1개 · 규칙 1개만 본 결과/.test(conclusionOf(none)));
  check('한 줄 결론 — 점수만 바뀌면 「점수 · 판단 코드만 N건」', conclusionOf(probe).includes('바뀐 것 0건 — 점수 · 판단 코드만 1건 달라짐'));

  // ── ⑨ 명령 — 토스를 부르기 전에 끝나는 길 ──
  const run = (env: Record<string, string>) =>
    spawnSync(path.join(here, '..', 'node_modules', '.bin', 'tsx'), [path.join(here, 'usCloseJudge.ts')], { env: { ...process.env, ...env }, encoding: 'utf8', timeout: 60_000 });
  const empty = run({ USSAMPLE_OUT: path.join(tmp, 'none.jsonl') });
  check('명령 — 기록 없음 안내 · 종료 1', empty.status === 1 && empty.stdout.includes('기록이 없습니다'), empty.stdout.trim());
  const off = run({ USSAMPLE_OUT: sampleFile, INDICATORS_PORT: '5999' });
  check(
    '명령 — 지표 엔진 꺼짐(또는 모의 데이터 모드) 안내 · 종료 1 · 토큰 파일 안 만듦',
    off.status === 1 && /지표 엔진\(포트 5999\)이 꺼져 있습니다|모의 데이터 모드/.test(off.stdout) && !fs.existsSync(path.join(tmp, '.toss-token.json')),
    off.stdout.trim(),
  );
} catch (err) {
  fail++;
  console.log(`FAIL  예외 — ${err instanceof Error ? err.stack : err}`);
} finally {
  check('사본 DB — 시험 전후 바이트로 같음(읽기만)', dbHash() === dbHashBefore);
  check('기록 파일 — 시험 전후 바이트로 같음', hashOf(sampleFile) === sampleHashBefore);
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n결과: ${pass}개 통과 / ${fail}개 실패`);
process.exit(fail ? 1 : 0);
