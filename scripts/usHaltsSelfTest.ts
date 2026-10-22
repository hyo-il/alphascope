/**
 * 미국 거래정지(실험실) 점검 — `npm run ushalts:test` · ⚠️ `DB_PATH=<사본>` 으로만 돈다(맨 첫 import). 네트워크 없이 돈다(Nasdaq · 토스를 부르지 않는다).
 *
 * - 시험용 XML(`scripts/fixtures/usHalts/` — 62차 조사의 10-21 장중 기록 사실로 만든 작은 파일)을 시간 순서대로 받기 작업에 먹인다.
 *   LUDP 재개 칸(Quote = 정지 시각 · Trade 는 재개 뒤) · M 재개 칸(둘 다 빈칸 → 함께 채움) · POM 반복 정지 · 09:41:03 → 09:51:10(10분 연장) ·
 *   전날 정지 · 30일 넘은 정지(2019 T12) · 항목이 쌓임.
 * - 받는 시간대(평일 04:00~20:00 ET · 휴장일 · 서머타임 11-01 앞뒤) · 예상 재개 경계 · 방향 추정(가짜 1분봉 · 정지 1건당 1번) ·
 *   30일 지우기 · 같은 키 갱신 · 받기 실패 → 상태 칸 · 로그인 없으면 401(사본 DB 로 시험 서버 4106).
 * - 사본 DB 의 `us_halts` 를 비우고 시작한다 · 비밀번호를 시험용으로 바꾸고 세션을 지운다(사본만).
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getDb } from '../server/db';
import { setPassword } from '../server/auth';
import { marketDayTime } from '../server/marketHours';
import { isMarketClosed } from '../server/marketCalendar';
import { TossApiError } from '../src/services/toss/httpClient';
import { fetchHaltsFeed, parseHaltsFeed, type RawHaltItem } from '../server/usHalts/feed';
import { ingestHalts, listHaltsOfDay, listOngoingBefore, purgeOldHalts } from '../server/usHalts/store';
import { fetchStatus, fetchWindowOf, markFetched, resetFetchStatusForTest, tooSoon, usHaltsTick } from '../server/usHalts/scheduler';
const isFetchWindow = (now: number, closed: (d: string) => boolean) => fetchWindowOf(now, { closed, openToday: () => 0 }).window !== 'outside';
import { judgeDirection } from '../server/usHalts/directionEstimate';
import { expectedResume, haltDayCount, isHaltOngoing } from '../src/utils/usHalts';
import type { Candle } from '../src/types/toss';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(here, 'fixtures/usHalts');
const PORT = 4106;
const BASE = `http://127.0.0.1:${PORT}`;
// 시험용 값 — 사본 DB 에만 쓴다(실제 비밀번호 아님)
const TEST_PW = 'selftest-ushalts-0001';
const MIN = 60_000;

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const db = getDb();
db.prepare(`DELETE FROM us_halts`).run();

/** 미국 날짜 + ET 시각 → ms */
const et = (day: string, hms: string) => {
  const [h, m, s] = hms.split(':').map(Number);
  return marketDayTime('US', day, ((h * 60 + m) * 60 + s) * 1000);
};
const DAY = '2026-10-21';
const rowsOf = (sym: string) =>
  db.prepare(`SELECT * FROM us_halts WHERE raw_issue_symbol = ? ORDER BY halt_at_ms`).all(sym) as Record<string, string | number | null>[];
const one = (sym: string, time: string) =>
  db.prepare(`SELECT * FROM us_halts WHERE raw_issue_symbol = ? AND raw_halt_time = ?`).get(sym, time) as Record<string, string | number | null> | undefined;

// ── 가짜 1분봉 — 종목마다 위 · 아래 · 모자람 · 404 ───────────────────
const calls = new Map<string, number>();
function fakeBars(symbol: string, haltAtMs: number): Promise<Candle[]> {
  const key = `${symbol}|${haltAtMs}`;
  calls.set(key, (calls.get(key) ?? 0) + 1);
  if (symbol === 'MPU') return Promise.reject(new TossApiError('없는 종목', 404, ''));
  const start = Math.floor(haltAtMs / MIN) * MIN;
  const n = symbol === 'WZRD' ? 3 : 10; // WZRD = 봉 모자람
  const dir = ['SPHL', 'REED', 'WHLRP'].includes(symbol) ? 1 : -1;
  const bars: Candle[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const close = 10 + dir * (n - i) * 0.1;
    bars.push({ timestamp: start - i * MIN, open: close, high: close, low: close, close, volume: 100 });
  }
  return Promise.resolve(bars);
}

// ── 1. 시험용 XML 을 시간 순서대로 ────────────────────────────────
const files = fs.readdirSync(FIXTURES).filter((f) => f.endsWith('.xml')).sort();
check('시험용 XML 10개', files.length === 10, String(files.length));
const timeOf = (f: string) => {
  const t = /-(\d{2})(\d{2})(\d{2})ET\.xml$/.exec(f)!;
  return `${t[1]}:${t[2]}:${t[3]}`;
};
const counts: number[] = [];
let tmsAt0937: Record<string, string | number | null> | undefined;
for (const f of files) {
  const xml = fs.readFileSync(path.join(FIXTURES, f), 'utf8');
  const items = parseHaltsFeed(xml);
  counts.push(items.length);
  const at = timeOf(f);
  const r = await usHaltsTick({ now: et(DAY, at), load: async () => items, bars: fakeBars, closed: () => false });
  if (r !== 'fetched') check(`${f} 받기`, false, r);
  const snap = (sym: string, time: string) => one(sym, time);
  if (at === '09:33:31') {
    const t = snap('TMS', '09:32:03.293');
    check('LUDP 처음 — Quote = 정지 시각 · Trade 빈칸', t?.raw_resumption_quote_time === '09:32:03' && t?.raw_resumption_trade_time === '' && t?.resume_seen_at === null);
  }
  if (at === '09:34:32') {
    const s = snap('SMCC', '09:33:33.003');
    check('M 처음 — 두 재개 칸 모두 빈칸', s?.raw_resumption_quote_time === '' && s?.raw_resumption_trade_time === '' && s?.raw_resumption_date === '');
  }
  if (at === '09:37:34') tmsAt0937 = snap('TMS', '09:32:03.293');
  if (at === '09:39:35') {
    const s = snap('SMCC', '09:33:33.003');
    check('M 재개 뒤 — 두 칸이 같은 값으로 함께 채워짐', s?.raw_resumption_quote_time === '09:38:33' && s?.raw_resumption_trade_time === '09:38:33');
  }
  if (at === '09:47:00') {
    const p = snap('POM', '09:41:03.826');
    check('POM 09:41:03 — 정지 + 5분이 지나도 재개 칸 빈칸(중간 5분 값 없음)', p?.raw_resumption_trade_time === '');
  }
}
check('항목이 지워지지 않고 쌓임(15 → 35개)', counts[0] === 15 && counts.at(-1) === 35 && counts.every((c, i) => i === 0 || c >= counts[i - 1]), counts.join(','));
check(
  '재개 칸이 처음 채워진 파일 — TMS 는 09:37:34',
  tmsAt0937?.raw_resumption_trade_time === '09:37:03' && tmsAt0937?.resume_seen_at === new Date(et(DAY, '09:37:34')).toISOString(),
  String(tmsAt0937?.resume_seen_at),
);

const today = listHaltsOfDay(DAY);
const byCode = (c: string) => today.filter((h) => h.rawReasonCode === c).length;
check('10-21 정지 20줄 = LUDP 13 · M 6 · T1 1', today.length === 20 && byCode('LUDP') === 13 && byCode('M') === 6 && byCode('T1') === 1, `${today.length} / ${byCode('LUDP')} · ${byCode('M')} · ${byCode('T1')}`);
const byMarket = (m: string) => today.filter((h) => h.rawMarket === m).length;
check('시장 — NASDAQ 13 · AMEX 4 · NYSE 1 · Non NASDAQ 2', byMarket('NASDAQ') === 13 && byMarket('AMEX') === 4 && byMarket('NYSE') === 1 && byMarket('Non NASDAQ') === 2);
check('새 정지가 위(정지 시각 내림차순)', today.every((h, i) => i === 0 || h.haltAtMs <= today[i - 1].haltAtMs));
const pomToday = today.filter((h) => h.rawIssueSymbol === 'POM').reverse();
check('POM 10-21 LUDP 7줄(각각 새 줄) · 순번 1~7', pomToday.length === 7 && pomToday.every((h, i) => h.nthToday === i + 1), pomToday.map((h) => h.nthToday).join(','));
check('POM 전체 8줄(전날 T3 포함)', rowsOf('POM').length === 8);
const pom2 = pomToday.find((h) => h.rawHaltTime === '09:41:03.826');
check(
  'POM 09:41:03 → 재개 09:51:10(10분 6초 남짓 — 연장)',
  pom2?.rawResumptionTradeTime === '09:51:10' && pom2.resumeAtMs! - pom2.haltAtMs === 10 * MIN + 6_174,
  String(pom2 && pom2.resumeAtMs! - pom2.haltAtMs),
);
check('POM 09:41:03 재개 칸 채워짐을 본 때 = 09:52:45', one('POM', '09:41:03.826')?.resume_seen_at === new Date(et(DAY, '09:52:45')).toISOString());
check('전날 정지(POM T3 10/20)는 10-21 목록에 없음', !today.some((h) => h.rawHaltDate === '10/20/2026') && rowsOf('POM').some((r) => r.raw_halt_date === '10/20/2026'));
check('30일 넘은 정지(2019 SVA · 2025 T12 · 06/11 HCHL)는 저장 안 됨', !rowsOf('SVA').length && !rowsOf('MAGH').length && !rowsOf('HCHL').length);
check('30일 안의 지난 정지(10/19 ZONE · 10/13 AZTR)는 저장됨', rowsOf('ZONE').length === 1 && rowsOf('AZTR').length === 1);
check('원문 그대로 — 엔티티만 풀어 저장(Reed&apos;s → Reed\'s)', one('REED', '10:02:39.030')?.raw_issue_name === "Reed's, Inc. Common Stock");
check('PauseThresholdPrice 는 빈칸 그대로', today.every((h) => one(h.rawIssueSymbol, h.rawHaltTime)?.raw_pause_threshold_price === ''));
check('LUDP 재개는 Trade 칸 — TMS 재개 = 09:37:03', today.find((h) => h.rawIssueSymbol === 'TMS')?.resumeAtMs === et(DAY, '09:37:03'));

// ── 2. 방향 추정 ─────────────────────────────────────────────────
const est = (sym: string, time: string) => one(sym, time)?.direction_est;
check('LULD 아님(T1 CHOW) → none · 지난 날 T3 → none', est('CHOW', '09:29:33.347') === 'none' && est('POM', '19:50:00.000') === 'none');
check('위 → up(SPHL) · 아래 → down(TMS)', est('SPHL', '09:33:42.523') === 'up' && est('TMS', '09:32:03.293') === 'down');
check('404(MPU) → unknown · 봉 모자람(WZRD) → unknown', est('MPU', '10:19:05.410') === 'unknown' && est('WZRD', '10:29:26.420') === 'unknown');
const catalog = db.prepare(`SELECT 1 FROM stock_catalog WHERE symbol = ?`);
const catalogEmpty = !(db.prepare(`SELECT COUNT(*) AS n FROM stock_catalog`).get() as { n: number }).n;
const luldToday = today.filter((h) => ['LUDP', 'LUDS', 'M'].includes(h.rawReasonCode));
const shouldCall = luldToday.filter((h) => catalogEmpty || catalog.get(h.rawIssueSymbol));
check(
  '정지 1건당 토스 호출 1번(토스 목록에 있는 LULD 정지만) · 다시 받아도 다시 부르지 않음',
  [...calls.values()].every((n) => n === 1) && calls.size === shouldCall.length && luldToday.every((h) => h.directionEst !== 'pending'),
  `호출 ${calls.size} / 대상 ${shouldCall.length}`,
);
if (!catalogEmpty && !catalog.get('POM')) check('토스 목록에 없는 종목(POM) → 부르지 않고 unknown', est('POM', '09:35:44.713') === 'unknown' && ![...calls.keys()].some((k) => k.startsWith('POM|')));

const bar = (t: number, close: number): Candle => ({ timestamp: t, open: close, high: close, low: close, close, volume: 1 });
const h0 = et(DAY, '10:00:30');
const m0 = et(DAY, '10:00:00');
check('judge — 직전 봉 > 5분 전 봉 → up', judgeDirection([bar(m0 - 5 * MIN, 1), bar(m0, 1.2)], h0).est === 'up');
check('judge — 직전 봉 < 5분 전 봉 → down', judgeDirection([bar(m0 - 5 * MIN, 1), bar(m0, 0.8)], h0).est === 'down');
check('judge — 같으면 unknown(flat)', judgeDirection([bar(m0 - 5 * MIN, 1), bar(m0, 1)], h0).detail.reason === 'flat');
check('judge — 5분 전 봉 없음 → unknown(few_bars)', judgeDirection([bar(m0 - 2 * MIN, 1), bar(m0, 2)], h0).detail.reason === 'few_bars');
check('judge — 직전 봉이 2분 넘게 앞섬 → unknown(stale)', judgeDirection([bar(m0 - 10 * MIN, 1), bar(m0 - 3 * MIN, 2)], h0).detail.reason === 'stale');
check('judge — 5분 전 봉이 7분보다 멀면 쓰지 않음(few_bars)', judgeDirection([bar(m0 - 9 * MIN, 1), bar(m0, 2)], h0).detail.reason === 'few_bars');
check('judge — 정지 뒤 봉은 쓰지 않음', judgeDirection([bar(m0 - 5 * MIN, 1), bar(m0, 1.2), bar(m0 + MIN, 0.1)], h0).est === 'up');

// ── 3. 같은 키 갱신 · 지우지 않음 · 30일 ──────────────────────────
const lastXml = fs.readFileSync(path.join(FIXTURES, files.at(-1)!), 'utf8');
const lastItems = parseHaltsFeed(lastXml);
const before = (db.prepare(`SELECT COUNT(*) AS n FROM us_halts`).get() as { n: number }).n;
const again = ingestHalts(lastItems, et(DAY, '11:01:40'));
check('같은 파일을 다시 → 새 줄 0 · 갱신 0', again.inserted === 0 && again.updated === 0, JSON.stringify(again));
const blanked: RawHaltItem[] = lastItems.slice(0, 3).map((i) => ({ ...i, ResumptionTradeTime: '', ResumptionQuoteTime: '' }));
ingestHalts(blanked, et(DAY, '11:02:40'));
check('빈칸으로 돌아와도 채워 둔 재개 칸을 지우지 않음', one(blanked[0].IssueSymbol, blanked[0].HaltTime)?.raw_resumption_trade_time === lastItems[0].ResumptionTradeTime);
check('목록에서 빠진 항목도 지우지 않음', (db.prepare(`SELECT COUNT(*) AS n FROM us_halts`).get() as { n: number }).n === before);
const changed = ingestHalts([{ ...lastItems[0], ReasonCode: 'LUDS' }], et(DAY, '11:03:40'));
check('바뀐 칸만 갱신(사유 코드)', changed.updated === 1 && one(lastItems[0].IssueSymbol, lastItems[0].HaltTime)?.raw_reason_code === 'LUDS');
const chow = lastItems.find((i) => i.IssueSymbol === 'CHOW')!;
ingestHalts([{ ...chow, ReasonCode: 'LUDP' }], et(DAY, '11:04:40'));
check('사유가 LULD 아님 → LULD 로 바뀌면 방향을 다시 추정(pending)', one('CHOW', chow.HaltTime)?.direction_est === 'pending');
ingestHalts([{ ...chow, ReasonCode: 'T1' }], et(DAY, '11:05:40'));
check('LULD → LULD 아님으로 바뀌면 none', one('CHOW', chow.HaltTime)?.direction_est === 'none');
// 30일 — 10-21 기준으로 넣은 10/13 AZTR 은 11-13(미국)에 지워진다
purgeOldHalts(et('2026-11-12', '12:00:00'));
check('30일 지우기 — 11-12(미국)에는 10/13 AZTR 이 남음', rowsOf('AZTR').length === 1);
const purged = purgeOldHalts(et('2026-11-13', '12:00:00'));
check('30일 지우기 — 11-13 에 10/13 AZTR 은 지움 · 10/14 TJGC 는 남음', purged === 1 && !rowsOf('AZTR').length && rowsOf('TJGC').length === 1, `지운 줄 ${purged}`);

// ── 4. 받는 시간대 ────────────────────────────────────────────────
const real = (d: string) => isMarketClosed('US', d);
const win: [string, string, boolean][] = [
  ['2026-10-21 수', '04:00:00', true],
  ['2026-10-21 수', '03:59:59', false],
  ['2026-10-21 수', '19:59:59', true],
  ['2026-10-21 수', '20:00:00', true], // 20:00~20:02 ET 는 유예(목록 지연) — 안 풀린 정지가 없어도 받음
  ['2026-10-21 수', '20:03:00', false],
  ['2026-10-24 토', '10:00:00', false],
  ['2026-11-26 추수감사절(NYSE 휴장)', '10:00:00', false],
  ['2026-10-30 금(서머타임 끝 전)', '04:00:00', true],
  ['2026-10-30 금(서머타임 끝 전)', '19:59:00', true],
  ['2026-11-02 월(서머타임 끝 뒤)', '04:00:00', true],
  ['2026-11-02 월(서머타임 끝 뒤)', '03:30:00', false],
  ['2026-11-02 월(서머타임 끝 뒤)', '20:03:00', false],
];
for (const [label, hms, want] of win) check(`받는 시간대 ${label} ${hms} ET → ${want ? '받음' : '안 받음'}`, isFetchWindow(et(label.slice(0, 10), hms), real) === want);
// UTC 로 확인 — 서머타임(EDT, UTC−4) 04:00 = 08:00Z · 표준시(EST, UTC−5) 04:00 = 09:00Z
check('10-30 08:00Z = 04:00 EDT 받음 · 07:59Z 안 받음', isFetchWindow(Date.parse('2026-10-30T08:00:00Z'), real) && !isFetchWindow(Date.parse('2026-10-30T07:59:00Z'), real));
check('11-02 09:00Z = 04:00 EST 받음 · 08:30Z 안 받음', isFetchWindow(Date.parse('2026-11-02T09:00:00Z'), real) && !isFetchWindow(Date.parse('2026-11-02T08:30:00Z'), real));
check('11-03 00:59Z = 11-02 19:59 EST 받음 · 01:03Z(20:03 EST) 안 받음', isFetchWindow(Date.parse('2026-11-03T00:59:00Z'), real) && !isFetchWindow(Date.parse('2026-11-03T01:03:00Z'), real));
check('받는 시간대 밖이면 받지 않음(load 를 부르지 않음)', (await usHaltsTick({ now: et(DAY, '21:00:00'), openToday: () => 0, load: async () => { throw new Error('불렸음'); } })) === 'outside');

// 서버를 다시 켜도(개발 서버 tsx watch) 1분에 1번 이하 — 마지막 실제 받기 시각을 DB 에 남긴다
const T0 = et(DAY, '13:00:00');
markFetched(T0);
check('켤 때 — 마지막 받기 30초 뒤면 건너뜀 · 60초 뒤면 받음', tooSoon(T0 + 30_000) && !tooSoon(T0 + 60_000));
db.prepare(`DELETE FROM app_settings WHERE key = 'usHalts.lastFetchAt'`).run();
check('기록이 없으면 받음', !tooSoon(T0));

// ── 5. 예상 재개 경계 ─────────────────────────────────────────────
const H = et(DAY, '10:00:00');
const luld = { rawReasonCode: 'LUDP', haltAtMs: H, resumeAtMs: null };
const kind = (now: number, h: Parameters<typeof expectedResume>[0] = luld) => expectedResume(h, now);
check('4분 59초 → 정지 + 5분', JSON.stringify(kind(H + 299_000)) === JSON.stringify({ kind: 'first', at: H + 5 * MIN }));
check('5분 → 연장 · 정지 + 10분', JSON.stringify(kind(H + 300_000)) === JSON.stringify({ kind: 'extended', at: H + 10 * MIN }));
check('9분 59초 → 연장 · 정지 + 10분', kind(H + 599_000).kind === 'extended');
check('10분 → 시각 정해지지 않음', kind(H + 600_000).kind === 'open');
check('M 도 LULD', kind(H + 1000, { ...luld, rawReasonCode: 'M' }).kind === 'first');
check('LULD 아님 · 재개 칸 없음 → 정해진 시각 없음', kind(H + 1000, { ...luld, rawReasonCode: 'T1' }).kind === 'none');
check('재개 칸이 지남 → 재개됨', kind(H + 6 * MIN, { ...luld, resumeAtMs: H + 5 * MIN }).kind === 'resumed');
check('재개 칸이 아직 오지 않음(T3 공지) → 재개 예정', kind(H, { ...luld, rawReasonCode: 'T3', resumeAtMs: H + 60 * MIN }).kind === 'announced');

// ── 6. 받기 실패 → 상태 칸 ────────────────────────────────────────
resetFetchStatusForTest();
const fakeFetch = (mk: () => Promise<Response>) => (() => mk()) as unknown as typeof fetch;
const failures: [string, typeof fetch][] = [
  ['봇 확인 HTML', fakeFetch(async () => new Response('<html><body>Please verify you are human</body></html>', { status: 200 }))],
  ['500', fakeFetch(async () => new Response('err', { status: 500 }))],
  ['시간 초과', fakeFetch(async () => Promise.reject(new DOMException('The operation was aborted due to timeout', 'TimeoutError')))],
];
const okAt = et(DAY, '12:00:00');
await usHaltsTick({ now: okAt, load: async () => lastItems, bars: fakeBars, closed: () => false });
for (const [i, [label, f]] of failures.entries()) {
  const r = await usHaltsTick({ now: okAt + (i + 1) * MIN, load: () => fetchHaltsFeed(f), closed: () => false });
  const s = fetchStatus();
  check(`받기 실패(${label}) → failed · 연속 ${i + 1}번 · 마지막 성공 그대로`, r === 'failed' && s.consecutiveFailures === i + 1 && s.lastSuccessAt === new Date(okAt).toISOString() && !!s.lastError, s.lastError ?? '');
}
const badShape = lastItems.slice(0, 2).map((i) => ({ ...i, HaltDate: '2026-10-21', HaltTime: '9:41' }));
const rBad = await usHaltsTick({ now: okAt + 4 * MIN, load: async () => badShape, closed: () => false });
check('항목을 하나도 못 읽으면(날짜 · 시각 모양 다름) 받기 실패로 셈', rBad === 'failed' && fetchStatus().consecutiveFailures === 4 && /모양/.test(fetchStatus().lastError ?? ''), fetchStatus().lastError ?? '');
await usHaltsTick({ now: okAt + 5 * MIN, load: async () => lastItems, closed: () => false });
check('다시 성공하면 연속 실패 0', fetchStatus().consecutiveFailures === 0 && fetchStatus().lastError === null);

// ── 7. API — 로그인 없으면 401 ─────────────────────────────────────
await setPassword(TEST_PW);
db.prepare(`DELETE FROM auth_sessions`).run();
let server: ChildProcess | null = null;
let serverLog = '';
try {
  server = spawn('node_modules/.bin/tsx', ['server/index.ts'], {
    detached: true,
    env: { ...process.env, API_PORT: String(PORT), AUTO_TRADING_ENABLED: 'false', GEMINI_ENABLED: 'false', UNIVERSE_UPDATE_ENABLED: 'false', US_HALTS_ENABLED: 'false' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout!.on('data', (d) => (serverLog += d));
  server.stderr!.on('data', (d) => (serverLog += d));
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${BASE}/api/version`)).ok) break;
    } catch {
      /* 아직 */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  check('로그인 없이 /api/us-halts → 401', (await fetch(`${BASE}/api/us-halts?day=${DAY}`)).status === 401);
  const login = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: TEST_PW }) });
  const cookie = (login.headers.get('set-cookie') ?? '').split(';')[0];
  const r = await fetch(`${BASE}/api/us-halts?day=${DAY}`, { headers: { cookie } });
  const body = (await r.json()) as { day: string; halts: unknown[]; status: { enabled: boolean }; serverNow: number };
  check('로그인 뒤 200 · 그날 20줄 · 스위치 꺼짐이 보임', r.status === 200 && body.day === DAY && body.halts.length === 20 && body.status.enabled === false && typeof body.serverNow === 'number', `${r.status} ${body.halts?.length}`);
  check('응답에 ongoing(며칠째 정지 중) 목록 · 받기 window', Array.isArray((body as unknown as { ongoing: unknown[] }).ongoing) && typeof (body.status as unknown as { window: string }).window === 'string');
  check('틀린 day → 400', (await fetch(`${BASE}/api/us-halts?day=10-21`, { headers: { cookie } })).status === 400);
  check('스위치를 끄면 받기를 시작하지 않는다(로그)', /US_HALTS_ENABLED=false/.test(serverLog));
} catch (e) {
  fail++;
  console.log('FAIL  시험 서버 —', (e as Error).message, serverLog.slice(-1500));
} finally {
  if (server) {
    try {
      process.kill(-server.pid!, 'SIGTERM');
    } catch {
      server.kill('SIGTERM');
    }
  }
  db.prepare(`DELETE FROM auth_sessions`).run();
}

// ── 8. 20:00 ET 뒤 이어 받기 · 며칠째 정지 중 (v2.55.1) ───────────────────
// 시험용 XML(scripts/fixtures/usHalts/ongoing — 가상의 종목): 10-22(목) 20:01:30 · 20:05:30 ET 에 받은 목록
const D2 = '2026-10-22';
const ongoingFeed = (f: string) => parseHaltsFeed(fs.readFileSync(path.join(FIXTURES, 'ongoing', f), 'utf8'));
const e1 = ongoingFeed('20261022-200130ET.xml');
const e2 = ongoingFeed('20261022-200530ET.xml');
resetFetchStatusForTest();
check('20:01:30 ET — 유예 3분 안이라 받음(19:59 정지를 처음 봄)', (await usHaltsTick({ now: et(D2, '20:01:30'), load: async () => e1, bars: fakeBars })) === 'fetched');
const w1 = fetchWindowOf(et(D2, '20:04:00'));
check('20:04 ET — 안 풀린 오늘 정지(FFFF) 1건 → 이어 받음(extended)', w1.window === 'extended' && w1.openToday === 1, JSON.stringify(w1));
check('받기 상태에 window · openToday', fetchStatus(et(D2, '20:04:00')).window === 'extended' && fetchStatus(et(D2, '20:04:00')).openToday === 1);
check('20:05:30 ET — 이어 받기로 받음', (await usHaltsTick({ now: et(D2, '20:05:30'), load: async () => e2, bars: fakeBars })) === 'fetched');
check('모두 풀린 다음 분(20:06:30) → 받지 않음', fetchWindowOf(et(D2, '20:06:30')).window === 'outside' && (await usHaltsTick({ now: et(D2, '20:06:30'), load: async () => { throw new Error('불렸음'); } })) === 'outside');
const open1 = () => 1;
const W = (iso: string, closed?: (d: string) => boolean) => fetchWindowOf(Date.parse(iso), { openToday: open1, closed: closed ?? real }).window;
check('안 풀린 정지 있음 — 20:30 이어 받음 / 없음 — 안 받음', W('2026-10-23T00:30:00Z') === 'extended' && fetchWindowOf(Date.parse('2026-10-23T00:30:00Z'), { openToday: () => 0, closed: real }).window === 'outside');
check('23:59 EDT 이어 받음 · 00:00 안 받음(미국 날짜가 바뀜)', W('2026-10-23T03:59:00Z') === 'extended' && W('2026-10-23T04:00:00Z') === 'outside');
check('토요일 20:30 · 추수감사절 20:30 → 안 받음', W('2026-10-25T00:30:00Z') === 'outside' && W('2026-11-27T01:30:00Z') === 'outside');
check('서머타임 끝 전 10-30(금) 23:59 EDT 받음 · 10-31 00:00 안 받음', W('2026-10-31T03:59:00Z') === 'extended' && W('2026-10-31T04:00:00Z') === 'outside');
check('서머타임 끝 뒤 11-02(월) 20:30 EST = 01:30Z 받음 · 23:59 EST 받음 · 00:00 EST 안 받음', W('2026-11-03T01:30:00Z') === 'extended' && W('2026-11-03T04:59:00Z') === 'extended' && W('2026-11-03T05:00:00Z') === 'outside');
check('19:59 EST(11-02) 는 정규 · 20:00 EDT(10-30)는 이어 받기 판정', W('2026-11-03T00:59:00Z') === 'regular' && W('2026-10-31T00:30:00Z') === 'extended');
check('공지된 재개 시각이 아직 안 온 정지 → 안 풀림 · 지나면 풀림', isHaltOngoing({ resumeAtMs: et(D2, '21:00:00') }, et(D2, '20:30:00')) && !isHaltOngoing({ resumeAtMs: et(D2, '21:00:00') }, et(D2, '21:00:00')));

// 10-23(금) 09:00 ET 에 본다 — 마지막 성공 받기 = 20:05:30(전날)
const D3 = '2026-10-23';
const view = et(D3, '09:00:00');
const ongoing = listOngoingBefore(D3, view, fetchStatus(view).lastSuccessAt);
const og = (sym: string) => ongoing.find((h) => h.rawIssueSymbol === sym);
check('목록에 남은 지난 정지(AAAA 10/20) → 며칠째 4일째 · 상태 정지 중', og('AAAA')?.daysHalted === 4 && og('AAAA')?.unlisted === false, JSON.stringify(og('AAAA') && { d: og('AAAA')!.daysHalted, u: og('AAAA')!.unlisted }));
check('재개 칸이 채워진 지난 정지(BBBB) → 빠짐', !og('BBBB'));
check('목록에서 사라진 지난 정지(CCCC) → 상태 모름(unlisted)', og('CCCC')?.unlisted === true && og('CCCC')?.daysHalted === 3);
check('공지된 재개(EEEE 10/23 09:30)가 아직 → 며칠째에 남음', og('EEEE') != null && og('EEEE')!.resumeAtMs === et(D3, '09:30:00'));
check('공지 시각이 지나면(09:31) 빠짐', !listOngoingBefore(D3, et(D3, '09:31:00'), fetchStatus(view).lastSuccessAt).some((h) => h.rawIssueSymbol === 'EEEE'));
check('오늘 정지(FFFF)는 며칠째에 없음 · 31일 전 정지(OLDT 09/22)는 안 나옴', !og('FFFF') && !og('OLDT') && rowsOf('OLDT').length === 1);
check('오래된 정지부터', ongoing.every((h, i) => i === 0 || h.haltAtMs >= ongoing[i - 1].haltAtMs));
check('받은 적이 없으면 사라졌다고 하지 않음', listOngoingBefore(D3, view, null).every((h) => !h.unlisted));
check('며칠째 — 주말 포함 미국 날짜(10-16 금 → 10-19 월 = 4일째 · 같은 날 = 1일째)', haltDayCount('2026-10-16', '2026-10-19') === 4 && haltDayCount('2026-10-19', '2026-10-19') === 1);
// 「안 풀림」 은 한 함수 — 화면 · 서버 · 스케줄러에 재개 시각을 따로 비교하는 식이 없다
const root = path.join(here, '..');
const sources = ['src/components/usHalts/UsHaltsView.tsx', 'server/usHalts/store.ts', 'server/usHalts/scheduler.ts', 'server/index.ts'].map((f) => fs.readFileSync(path.join(root, f), 'utf8'));
check('「안 풀림」 판단은 utils/usHalts.isHaltOngoing 한 곳(다른 곳에 resumeAtMs 비교 없음)', sources.every((src) => !/resumeAtMs\s*(<=|>=|<|>)/.test(src)) && /isHaltOngoing/.test(sources[1]));

console.log(`\n결과: ${pass}개 통과 / ${fail}개 실패`);
process.exit(fail ? 1 : 0);
