/**
 * 거래정지(실험실) 점검 — `npm run ushalts:test` · ⚠️ `DB_PATH=<사본>` 으로만 돈다(맨 첫 import). 네트워크 없이 돈다(Nasdaq · 토스를 부르지 않는다).
 *
 * - 시험용 XML(`scripts/fixtures/usHalts/` — 62차 조사의 10-21 장중 기록 사실로 만든 작은 파일)을 시간 순서대로 받기 작업에 먹인다.
 *   LUDP 재개 칸(Quote = 정지 시각 · Trade 는 재개 뒤) · M 재개 칸(둘 다 빈칸 → 함께 채움) · POM 반복 정지 · 09:41:03 → 09:51:10(10분 연장) ·
 *   전날 정지 · 30일 넘은 정지(2019 T12) · 항목이 쌓임.
 * - 받는 시간대(평일 04:00~20:00 ET · 휴장일 · 서머타임 11-01 앞뒤) · 예상 재개 경계 · 방향 추정(가짜 1분봉 · 정지 1건당 1번) ·
 *   정지 전 5분 거래대금(구간 경계 · 봉 없음 0 · 모름 null · LULD 아닌 정지도 1번) · 같은 종목 묶기 · 숨기기 판단 ·
 *   30일 지우기 · 같은 키 갱신 · 받기 실패 → 상태 칸 · 로그인 없으면 401 · 숨기기 기준 API(저장 · 400 · 재시작 뒤 유지)(사본 DB 로 시험 서버 4106).
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
import { analyzeHalt, judgeDirection, turnoverBefore } from '../server/usHalts/directionEstimate';
import { HALT_RANK_TOPS, expectedResume, filterGroupsByRank, groupHalts, groupTurnover, haltDayCount, isHaltOngoing, isHiddenByTurnover, rankHitOf, rankHits } from '../src/utils/usHalts';
import { formatUsdShort } from '../src/utils/formatters';
import { directionUnknownText } from '../src/data/haltCodes';
import type { Candle } from '../src/types/toss';
import { setSessionHooksForTest, type TossCalendarResponse } from '../server/heatmapSession';
import { usRegularStatus } from '../server/usHalts/regularSession';

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
check('POM 10-21 LUDP 7줄(각각 새 줄로 저장)', pomToday.length === 7);
const groups = groupHalts(today);
const pomGroup = groups.find((g) => g.latest.rawIssueSymbol === 'POM');
check(
  '묶기 — POM 은 한 묶음 · 줄 = 가장 최근 정지 · 앞선 정지 6건(오래된 것부터)',
  groups.filter((g) => g.latest.rawIssueSymbol === 'POM').length === 1 &&
    pomGroup?.latest.id === pomToday.at(-1)!.id &&
    pomGroup.earlier.length === 6 &&
    pomGroup.earlier.every((h, i) => h.id === pomToday[i].id),
);
check('묶기 — 종목 수만큼 · 가장 최근 정지 시각 내림차순', groups.length === new Set(today.map((h) => h.rawIssueSymbol.trim())).size && groups.every((g, i) => i === 0 || g.latest.haltAtMs <= groups[i - 1].latest.haltAtMs));
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
// 거래대금 때문에 LULD 가 아닌 정지(T1 CHOW)도 1번 — 토스 목록에 있는 오늘 정지 전부
const shouldCall = today.filter((h) => catalogEmpty || catalog.get(h.rawIssueSymbol));
check(
  '정지 1건당 토스 호출 1번(토스 목록에 있는 오늘 정지 전부 — LULD 아닌 정지도) · 다시 받아도 다시 부르지 않음',
  [...calls.values()].every((n) => n === 1) && calls.size === shouldCall.length && luldToday.every((h) => h.directionEst !== 'pending') && today.every((h) => !h.turnoverPending),
  `호출 ${calls.size} / 대상 ${shouldCall.length}`,
);
const chowToday = today.find((h) => h.rawIssueSymbol === 'CHOW')!;
if (catalogEmpty || catalog.get('CHOW'))
  check('LULD 아닌 정지(T1 CHOW)도 거래대금을 냄 · 방향은 none 그대로', calls.get(`CHOW|${chowToday.haltAtMs}`) === 1 && (chowToday.turnover5mUsd ?? 0) > 0 && chowToday.directionEst === 'none');
const sphl = today.find((h) => h.rawIssueSymbol === 'SPHL')!;
const sphlBars = await fakeBars('SPHL', sphl.haltAtMs);
calls.set(`SPHL|${sphl.haltAtMs}`, 1); // 위 한 줄은 시험이 직접 부른 것 — 호출 수에서 뺀다
check('거래대금 저장값 = 같은 1분봉으로 낸 값(SPHL)', sphl.turnover5mUsd != null && Math.abs(sphl.turnover5mUsd - (turnoverBefore(sphlBars, sphl.haltAtMs) ?? NaN)) < 1e-9, String(sphl.turnover5mUsd));
check('404(MPU) → 거래대금 모름(null) · 방향 판정 못 함 · 토스에 없음', today.find((h) => h.rawIssueSymbol === 'MPU')?.turnover5mUsd === null && today.find((h) => h.rawIssueSymbol === 'MPU')?.directionReason === 'not_found');
const zone = listHaltsOfDay('2026-10-19').find((h) => h.rawIssueSymbol === 'ZONE');
check('지난 날 정지(10/19 ZONE)는 부르지 않음 · 거래대금 모름', zone != null && zone.turnover5mUsd === null && !zone.turnoverPending && ![...calls.keys()].some((k) => k.startsWith('ZONE|')));
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

// ── 2-1. 정지 전 5분 거래대금 ──────────────────────────────────────
const vbar = (t: number, close: number, volume: number): Candle => ({ timestamp: t, open: close, high: close, low: close, close, volume });
// 정지 10:00:30 → 정지 칸 10:00 · 더하는 칸 09:55 ~ 09:59
const tb = [vbar(m0 - 6 * MIN, 9, 1000), vbar(m0 - 5 * MIN, 10, 100), vbar(m0 - 3 * MIN, 11, 200), vbar(m0 - MIN, 12, 300), vbar(m0, 50, 9999), vbar(m0 + MIN, 50, 9999)];
check('거래대금 — 봉 여러 개 Σ(종가 × 거래량) = 10×100 + 11×200 + 12×300', turnoverBefore(tb, h0) === 1000 + 2200 + 3600, String(turnoverBefore(tb, h0)));
check('거래대금 경계 — 정확히 5분 전 칸(09:55) 포함 · 6분 전(09:54) 제외', turnoverBefore([vbar(m0 - 5 * MIN, 2, 10)], h0) === 20 && turnoverBefore([vbar(m0 - 6 * MIN, 2, 10)], h0) === 0);
check('거래대금 경계 — 정지가 들어 있는 1분 칸(10:00) · 그 뒤 제외', turnoverBefore([vbar(m0, 2, 10), vbar(m0 + MIN, 2, 10)], h0) === 0);
check('거래대금 경계 — 정지가 정각(10:00:00)이면 09:55~09:59', turnoverBefore([vbar(m0 - 5 * MIN, 1, 1), vbar(m0 - MIN, 1, 1), vbar(m0, 1, 1)], m0) === 2);
check('거래대금 — 5칸에 봉 없음(앞 · 뒤 봉은 있음) → 0(거래 없음)', turnoverBefore([vbar(m0 - 8 * MIN, 1, 1), vbar(m0, 1, 1)], h0) === 0);
check('거래대금 — 받은 봉이 아예 없음 → null(모름 — 토스 반영 지연과 구별 못 함)', turnoverBefore([], h0) === null);
check('거래대금 — 5칸 안 봉의 거래량이 숫자가 아님 → null', turnoverBefore([vbar(m0 - 2 * MIN, 1, Number.NaN), vbar(m0 - MIN, 1, 5)], h0) === null);
let analyzeCalls = 0;
const counting = (impl: () => Promise<Candle[]>) => () => {
  analyzeCalls++;
  return impl();
};
const notInToss = await analyzeHalt('ZZZZ', h0, { luld: true, inToss: false, mock: false, fetcher: counting(async () => tb) });
check('토스에 없음 → 거래대금 null · 부르지 않음 · 판정 못 함 · 토스에 없음', notInToss.turnover5mUsd === null && analyzeCalls === 0 && directionUnknownText(notInToss.direction!.detail.reason ?? null) === '판정 못 함 · 토스에 없음');
const a404 = await analyzeHalt('ZZZZ', h0, { luld: true, inToss: true, mock: false, fetcher: counting(() => Promise.reject(new TossApiError('없음', 404, ''))) });
check('404 → 거래대금 null · 1번만', a404.turnover5mUsd === null && a404.direction?.detail.reason === 'not_found' && analyzeCalls === 1);
const aFail = await analyzeHalt('ZZZZ', h0, { luld: false, inToss: true, mock: false, fetcher: counting(() => Promise.reject(new Error('네트워크'))) });
check('받기 실패 → 거래대금 null · LULD 아니면 방향 없음(null)', aFail.turnover5mUsd === null && aFail.direction === null && analyzeCalls === 2);
const aEmpty = await analyzeHalt('ZZZZ', h0, { luld: true, inToss: true, mock: false, fetcher: counting(async () => []) });
check('받은 봉 없음 → 거래대금 null · 방향 판정 못 함 · 거래 적음 · 1번만', aEmpty.turnover5mUsd === null && directionUnknownText(aEmpty.direction!.detail.reason ?? null) === '판정 못 함 · 거래 적음' && analyzeCalls === 3);
check('모의 모드 → 부르지 않음 · null', (await analyzeHalt('ZZZZ', h0, { luld: false, inToss: true, mock: true, fetcher: counting(async () => tb) })).turnover5mUsd === null && analyzeCalls === 3);

// ── 2-2. 「판정 못 함」 이유 쉬운 말 · 숨기기 판단 · 금액 표기 ───────────────
const reasonText: [Parameters<typeof directionUnknownText>[0], string][] = [
  ['stale', '판정 못 함 · 거래 적음'],
  ['few_bars', '판정 못 함 · 거래 적음'],
  ['flat', '판정 못 함 · 변화 없음'],
  ['not_in_toss', '판정 못 함 · 토스에 없음'],
  ['not_found', '판정 못 함 · 토스에 없음'],
  ['fetch_failed', '판정 못 함 · 받기 실패'],
  ['not_today', '판정 못 함'],
  [null, '판정 못 함'],
];
check('판정 못 함 이유 — 6가지 + 그 밖 · 옛 줄', reasonText.every(([r, t]) => directionUnknownText(r) === t), reasonText.map(([r]) => directionUnknownText(r)).join(' / '));
const tv = (turnover5mUsd: number | null, turnoverPending = false) => ({ turnover5mUsd, turnoverPending });
const gt = (...h: ReturnType<typeof tv>[]) => JSON.stringify(groupTurnover(h));
check('숨기기 — 기준 없음(null)이면 숨기지 않음', !isHiddenByTurnover(groupTurnover([tv(10)]), null, false));
check('숨기기 — 기준보다 작으면 숨김 · 같거나 크면 안 숨김', isHiddenByTurnover(groupTurnover([tv(999)]), 1000, false) && !isHiddenByTurnover(groupTurnover([tv(1000)]), 1000, false));
check('숨기기 — 거래 없음(0)은 숨김 · 거래량 모름(null)은 안 숨김', isHiddenByTurnover(groupTurnover([tv(0)]), 1000, false) && !isHiddenByTurnover(groupTurnover([tv(null)]), 1000, false));
check('숨기기 — 관심 · 보유 종목은 안 숨김', !isHiddenByTurnover(groupTurnover([tv(1)]), 1000, true));
// 묶음 거래대금 = 정지들 가운데 최대(v2.56.2) — 표시 · 숨기기가 같은 숫자
check('groupTurnover — 최대값(120000 · 80000 · 0 → 120000)', gt(tv(120_000), tv(80_000), tv(0)) === JSON.stringify({ usd: 120_000, partial: false, checking: false }));
check('groupTurnover — 모두 null → null(모름)', gt(tv(null), tv(null)) === JSON.stringify({ usd: null, partial: false, checking: false }));
check('groupTurnover — 0 과 null 섞임 → 0 · 일부 모름', gt(tv(0), tv(null)) === JSON.stringify({ usd: 0, partial: true, checking: false }));
check('groupTurnover — 한 개 → 그 값', gt(tv(45_600)) === JSON.stringify({ usd: 45_600, partial: false, checking: false }));
check('groupTurnover — 아는 값 없음 + 아직 → 확인 중', gt(tv(null, true), tv(null)) === JSON.stringify({ usd: null, partial: false, checking: true }));
check('groupTurnover — 아는 값 + 아직 → 아는 값 · 일부 모름 · 확인 중', gt(tv(500), tv(null, true)) === JSON.stringify({ usd: 500, partial: true, checking: true }));
check('숨기기 — 방금 다시 멈춰 확인 중인 정지가 있으면 앞선 값이 작아도 안 숨김', !isHiddenByTurnover(groupTurnover([tv(500), tv(null, true)]), 5000, false));
check('다시 멈춘 종목(마지막 정지 0 · 첫 정지 큼)은 최대값이 기준보다 커 숨지 않음', !isHiddenByTurnover(groupTurnover([tv(120_000), tv(0)]), 5000, false));
// 급상승 · 급하락 보기(v2.57.0) — 토스 순위 상위 N 안의 종목만 · 경계 10/11 · 거래대금 숨기기와 함께(거르기 → 숨기기)
{
  const ranking = Array.from({ length: 100 }, (_, i) => ({ rank: i + 1, symbol: `S${i + 1}`, changeRate: 50 - i * 0.4 }));
  const top10 = rankHits(ranking, 10);
  check('순위 거르기 — 상위 10: 10위 안 · 11위 밖', top10.size === 10 && top10.has('S10') && !top10.has('S11'));
  check('순위 거르기 — 상위 100 = 응답 전부', rankHits(ranking, 100).size === 100 && HALT_RANK_TOPS.join(',') === '10,20,50,100');
  check('순위 거르기 — 티커 앞뒤 공백 · 대소문자 무시 · 순위 · 등락률', JSON.stringify(rankHitOf(rankHits([{ rank: 3, symbol: 'abcd', changeRate: 45.2 }], 10), ' ABCD ')) === JSON.stringify({ rank: 3, changeRate: 45.2 }));
  const hg = (sym: string, id: number, turnover5mUsd: number | null) => ({ latest: { rawIssueSymbol: sym, haltAtMs: id, id, turnover5mUsd, turnoverPending: false }, earlier: [] });
  const groups = [hg('S1', 1, 100), hg('S10 ', 2, 50_000), hg('S11', 3, 50_000), hg('ZZZ', 4, 50_000)];
  check('순위 거르기 — 「전체」(null)면 그대로', filterGroupsByRank(groups, null).length === 4);
  const inTop = filterGroupsByRank(groups, top10).map((g) => g.latest.rawIssueSymbol.trim());
  check('순위 거르기 — 10위 · 1위만 남고 11위 · 순위 밖은 빠짐', inTop.join(',') === 'S1,S10', inTop.join(','));
  const shown = filterGroupsByRank(groups, top10).filter((g) => !isHiddenByTurnover(groupTurnover([g.latest]), 1000, false));
  check('순위 거르기 + 거래대금 숨기기 — 둘 다 적용(S1 은 $100 이라 숨김)', shown.map((g) => g.latest.rawIssueSymbol.trim()).join(',') === 'S10');
  check('순위 거르기 — 관심 · 보유 예외 없음(순위 밖이면 빠짐) · 숨기기 예외는 그대로', !filterGroupsByRank([hg('MINE', 5, 1)], top10).length && !isHiddenByTurnover(groupTurnover([hg('S1', 1, 100).latest]), 1000, true));
  check('순위 거르기 — 빈 순위면 전부 빠짐', !filterGroupsByRank(groups, rankHits([], 10)).length);
}
// 정규장에만 목록(v2.57.1) — `usRegularStatus` = heatmapSession('US') 의 세션이 정규장인가. 고정표(토스 달력 못 받음) · 가짜 토스 달력(조기 마감)
{
  setSessionHooksForTest({ calendar: async () => null, lastTrade: async () => null });
  const open = async (day: string, hms: string) => (await usRegularStatus(et(day, hms))).regularOpen;
  check('정규장 — 09:29 닫힘 · 09:30 열림 · 15:59 열림 · 16:00 닫힘(10-21 수)', !(await open('2026-10-21', '09:29:00')) && (await open('2026-10-21', '09:30:00')) && (await open('2026-10-21', '15:59:59')) && !(await open('2026-10-21', '16:00:00')));
  check('정규장 — 토요일 · 추수감사절(11-26) 닫힘', !(await open('2026-10-24', '12:00:00')) && !(await open('2026-11-26', '12:00:00')));
  const sat = await usRegularStatus(et('2026-10-24', '12:00:00'));
  check('다음 정규장 — 토요일 → 월요일 09:30~16:00 ET', sat.nextRegularOpen === et('2026-10-26', '09:30:00') && sat.nextRegularClose === et('2026-10-26', '16:00:00'));
  // 서머타임 끝(11-01 일) 앞뒤 — 09:30 ET 가 금 13:30Z · 월 14:30Z
  check('서머타임 앞뒤 — 10-30 09:30 ET = 13:30Z · 11-02 09:30 ET = 14:30Z 에 열림', (await usRegularStatus(Date.parse('2026-10-30T13:30:00Z'))).regularOpen && !(await usRegularStatus(Date.parse('2026-11-02T13:30:00Z'))).regularOpen && (await usRegularStatus(Date.parse('2026-11-02T14:30:00Z'))).regularOpen);
  const friNight = await usRegularStatus(et('2026-10-30', '20:00:00'));
  check('다음 정규장 — 금 20:00 ET → 월 11-02 09:30 ET(14:30Z · 한국 23:30)', friNight.nextRegularOpen === Date.parse('2026-11-02T14:30:00Z'));
  // 조기 마감(가짜 토스 달력 — 11-27 정규장 09:30~13:00 ET)
  const early: TossCalendarResponse = { result: { today: { date: '2026-11-27', regularMarket: { startTime: '2026-11-27T09:30:00-05:00', endTime: '2026-11-27T13:00:00-05:00' }, afterMarket: { startTime: '2026-11-27T13:00:00-05:00', endTime: '2026-11-27T17:00:00-05:00' } } } };
  setSessionHooksForTest({ calendar: async () => early, lastTrade: async () => null });
  check('조기 마감(토스 달력) — 12:59 열림 · 13:00 닫힘', (await open('2026-11-27', '12:59:59')) && !(await open('2026-11-27', '13:00:00')));
  check('조기 마감 뒤 다음 정규장 — 토스 칸에 없으면 고정표로 월 11-30 09:30 ET', (await usRegularStatus(et('2026-11-27', '13:00:00'))).nextRegularOpen === et('2026-11-30', '09:30:00'));
  setSessionHooksForTest({ calendar: null, lastTrade: null });
}
const usd: [number, string][] = [
  [850, '$850'],
  [999.6, '$1.0K'],
  [0.3, '<$1'],
  [12_345, '$12.3K'],
  [999_960, '$1.0M'],
  [1_234_567, '$1.2M'],
  [3_400_000_000, '$3.4B'],
];
check('금액 줄임 — $850 · $1.0K(999.6) · <$1 · $12.3K · $1.0M · $1.2M · $3.4B', usd.every(([v, t]) => formatUsdShort(v) === t), usd.map(([v]) => formatUsdShort(v)).join(' '));

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
// 1분봉을 이미 받은 줄 — 다시 부르지 않고 「판정 못 함」(정지 1건당 1번)
const callsBefore = [...calls.values()].reduce((a, b) => a + b, 0);
await usHaltsTick({ now: et(DAY, '11:04:50'), load: async () => [{ ...chow, ReasonCode: 'LUDP' }], bars: fakeBars, closed: () => false });
check(
  '1분봉을 받은 뒤 LULD 로 바뀐 줄 — 다시 부르지 않음(code_changed)',
  one('CHOW', chow.HaltTime)?.direction_est === 'unknown' && /code_changed/.test(String(one('CHOW', chow.HaltTime)?.direction_est_json)) && [...calls.values()].reduce((a, b) => a + b, 0) === callsBefore,
);
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
db.prepare(`DELETE FROM app_settings WHERE key = 'usHalts.minTurnoverUsd'`).run();
let server: ChildProcess | null = null;
let serverLog = '';
async function startServer(): Promise<void> {
  server = spawn('node_modules/.bin/tsx', ['server/index.ts'], {
    detached: true,
    env: { ...process.env, API_PORT: String(PORT), AUTO_TRADING_ENABLED: 'false', GEMINI_ENABLED: 'false', UNIVERSE_UPDATE_ENABLED: 'false', US_HALTS_ENABLED: 'false' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout!.on('data', (d) => (serverLog += d));
  server.stderr!.on('data', (d) => (serverLog += d));
  for (let i = 0; i < 120; i++) {
    try {
      if ((await fetch(`${BASE}/api/version`)).ok) return;
    } catch {
      /* 아직 */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error('시험 서버가 뜨지 않음');
}
async function stopServer(): Promise<void> {
  if (!server) return;
  const s = server;
  server = null;
  const exited = new Promise((r) => s.once('exit', r));
  try {
    process.kill(-s.pid!, 'SIGTERM');
  } catch {
    s.kill('SIGTERM');
  }
  await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
  // 포트가 풀릴 때까지
  for (let i = 0; i < 20; i++) {
    try {
      await fetch(`${BASE}/api/version`);
      await new Promise((r) => setTimeout(r, 250));
    } catch {
      return;
    }
  }
}
const login = async () => {
  const r = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: TEST_PW }) });
  return (r.headers.get('set-cookie') ?? '').split(';')[0];
};
const SETTING = `${BASE}/api/settings/us-halts-min-turnover`;
const putMin = (cookie: string, body: unknown) =>
  fetch(SETTING, { method: 'PUT', headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) }, body: JSON.stringify(body) });
try {
  await startServer();
  check('로그인 없이 /api/us-halts → 401', (await fetch(`${BASE}/api/us-halts?day=${DAY}`)).status === 401);
  check('로그인 없이 숨기기 기준 GET · PUT → 401', (await fetch(SETTING)).status === 401 && (await putMin('', { minTurnoverUsd: 5000 })).status === 401);
  const cookie = await login();
  const r = await fetch(`${BASE}/api/us-halts?day=${DAY}`, { headers: { cookie } });
  const body = (await r.json()) as { day: string; halts: unknown[]; status: { enabled: boolean }; serverNow: number; minTurnoverUsd: unknown };
  check('로그인 뒤 200 · 그날 20줄 · 스위치 꺼짐이 보임', r.status === 200 && body.day === DAY && body.halts.length === 20 && body.status.enabled === false && typeof body.serverNow === 'number', `${r.status} ${body.halts?.length}`);
  check('응답에 정규장 칸(regularOpen · 다음 정규장)', typeof (body as unknown as { regularOpen: unknown }).regularOpen === 'boolean' && 'nextRegularOpen' in body && 'nextRegularClose' in body);
  check('응답에 ongoing(며칠째 정지 중) 목록 · 받기 window', Array.isArray((body as unknown as { ongoing: unknown[] }).ongoing) && typeof (body.status as unknown as { window: string }).window === 'string');
  check('응답 줄에 nthToday 없음 · 거래대금 칸 있음', (body.halts as Record<string, unknown>[]).every((h) => !('nthToday' in h) && 'turnover5mUsd' in h && 'directionReason' in h));
  check('틀린 day → 400', (await fetch(`${BASE}/api/us-halts?day=10-21`, { headers: { cookie } })).status === 400);
  check('스위치를 끄면 받기를 시작하지 않는다(로그)', /US_HALTS_ENABLED=false/.test(serverLog));

  const getMin = async () => ((await (await fetch(SETTING, { headers: { cookie } })).json()) as { minTurnoverUsd: unknown }).minTurnoverUsd;
  check('숨기기 기준 — 처음은 null(숨기지 않음) · 목록 응답에도 null', (await getMin()) === null && body.minTurnoverUsd === null);
  const bad: unknown[] = [0, -1, 'abc', '5000', 100_000_001, Number.MAX_SAFE_INTEGER, true, {}, undefined];
  const badStatus = await Promise.all(bad.map(async (v) => (await putMin(cookie, v === undefined ? {} : { minTurnoverUsd: v })).status));
  check('숨기기 기준 — 틀린 값 400(0 · 음수 · 글자 · 문자열 숫자 · 1억 초과 · 참거짓 · 객체 · 빠짐)', badStatus.every((st) => st === 400), badStatus.join(','));
  check('숨기기 기준 — 틀린 값은 저장하지 않음', (await getMin()) === null);
  const saved = await putMin(cookie, { minTurnoverUsd: 5000 });
  check('숨기기 기준 — 5000 저장 · 다시 읽어도 5000 · 상한 1억은 받음', saved.status === 200 && (await getMin()) === 5000 && (await putMin(cookie, { minTurnoverUsd: 100_000_000 })).status === 200);
  await putMin(cookie, { minTurnoverUsd: 2500.5 });
  await stopServer();
  await startServer();
  const cookie2 = await login();
  const afterRestart = ((await (await fetch(SETTING, { headers: { cookie: cookie2 } })).json()) as { minTurnoverUsd: unknown }).minTurnoverUsd;
  const listAfter = ((await (await fetch(`${BASE}/api/us-halts?day=${DAY}`, { headers: { cookie: cookie2 } })).json()) as { minTurnoverUsd: unknown }).minTurnoverUsd;
  check('숨기기 기준 — 서버를 다시 켜도 유지(2500.5) · 목록 응답에도', afterRestart === 2500.5 && listAfter === 2500.5, `${afterRestart} / ${listAfter}`);
  check('숨기기 기준 — 비우면(null) 숨기지 않음으로', (await putMin(cookie2, { minTurnoverUsd: null })).status === 200 && ((await (await fetch(SETTING, { headers: { cookie: cookie2 } })).json()) as { minTurnoverUsd: unknown }).minTurnoverUsd === null);
} catch (e) {
  fail++;
  console.log('FAIL  시험 서버 —', (e as Error).message, serverLog.slice(-1500));
} finally {
  await stopServer();
  db.prepare(`DELETE FROM auth_sessions`).run();
  db.prepare(`DELETE FROM app_settings WHERE key = 'usHalts.minTurnoverUsd'`).run();
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
// 경계 — 30일째(오늘 − 29일)는 나옴 · 31일째(오늘 − 30일)는 안 나옴. 배포 전 줄(last_listed_at NULL)은 마지막 성공이 있으면 「사라짐」
const mk = (sym: string, date: string) => ({ HaltDate: date, HaltTime: '19:50:00', IssueSymbol: sym, IssueName: sym, Market: 'NASDAQ', ReasonCode: 'T12', PauseThresholdPrice: '', ResumptionDate: '', ResumptionQuoteTime: '', ResumptionTradeTime: '' });
ingestHalts([mk('D30', '09/24/2026'), mk('D31', '09/23/2026'), mk('NULL', '10/21/2026')], et(D2, '20:05:30'));
db.prepare(`UPDATE us_halts SET last_listed_at = NULL WHERE raw_issue_symbol = 'NULL'`).run();
const edge = listOngoingBefore(D3, view, fetchStatus(view).lastSuccessAt);
check('30일째(09-24)는 나옴 · 31일째(09-23)는 안 나옴', edge.find((h) => h.rawIssueSymbol === 'D30')?.daysHalted === 30 && !edge.some((h) => h.rawIssueSymbol === 'D31'));
check('배포 전 줄(last_listed_at NULL) + 마지막 성공 있음 → 사라짐 · 받은 적 없음 → 판단 안 함', edge.find((h) => h.rawIssueSymbol === 'NULL')?.unlisted === true && listOngoingBefore(D3, view, null).find((h) => h.rawIssueSymbol === 'NULL')?.unlisted === false);
const W0 = (iso: string) => fetchWindowOf(Date.parse(iso), { openToday: () => 0, closed: real }).window;
check('유예 끝 — 20:02:59 EDT 받음 · 20:03:00 안 받음', W0('2026-10-23T00:02:59Z') === 'regular' && W0('2026-10-23T00:03:00Z') === 'outside');
check('며칠째 — 주말 포함 미국 날짜(10-16 금 → 10-19 월 = 4일째 · 같은 날 = 1일째)', haltDayCount('2026-10-16', '2026-10-19') === 4 && haltDayCount('2026-10-19', '2026-10-19') === 1);
// 「안 풀림」 은 한 함수 — 화면 · 서버 · 스케줄러에 재개 시각을 따로 비교하는 식이 없다
const root = path.join(here, '..');
const sources = ['src/components/usHalts/UsHaltsView.tsx', 'server/usHalts/store.ts', 'server/usHalts/scheduler.ts', 'server/index.ts'].map((f) => fs.readFileSync(path.join(root, f), 'utf8'));
check('「안 풀림」 판단은 utils/usHalts.isHaltOngoing 한 곳(다른 곳에 resumeAtMs 비교 없음)', sources.every((src) => !/resumeAtMs\s*(<=|>=|<|>)/.test(src)) && /isHaltOngoing/.test(sources[1]));

// 묶기 · 숨기기 · 예상 재개는 한 곳 — 화면이 utils 의 함수를 쓰고, 같은 판단을 따로 두지 않는다
const viewSrc = sources[0];
check(
  '화면 — 묶기 groupHalts · 최대값 groupTurnover · 숨기기 isHiddenByTurnover · 안 풀림 isHaltOngoing · 예상 재개 expectedResume 를 씀(따로 판단 없음)',
  /groupHalts\(/.test(viewSrc) && /groupTurnover\(/.test(viewSrc) && /isHiddenByTurnover\(/.test(viewSrc) && /isHaltOngoing\(/.test(viewSrc) && /expectedResume\(/.test(viewSrc) && !/turnover5mUsd\s*[<>]|Math\.max/.test(viewSrc),
);
check(
  '화면 — 토스트는 지금 멈춘 정지만(isHaltOngoing) · 며칠째 칸도 매초 거르고 상태 모름(unlisted)은 남김(v2.56.3)',
  /isHaltOngoing\(h, data\.serverNow\)/.test(viewSrc) && /data\.ongoing\.filter\(\(h\) => h\.unlisted \|\| isHaltOngoing\(h, now\)\)/.test(viewSrc) && !/split\([^)]*, (true|false)\)/.test(viewSrc),
);
check('화면 — 「앞선 정지」 줄 · 「실제 재개」 · 「재개됨」 상태를 만들던 코드가 남지 않음', !/앞선 정지 [<{]|EarlierTimes|실제 재개|재개됨/.test(viewSrc));
const grepNth = (dir: string): string[] =>
  fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) return grepNth(rel);
    return /\.(ts|tsx)$/.test(e.name) && rel !== 'scripts/usHaltsSelfTest.ts' && /nthToday/.test(fs.readFileSync(path.join(root, rel), 'utf8')) ? [rel] : [];
  });
const nthLeft = ['src', 'server', 'scripts'].flatMap(grepNth);
check('「오늘 N번째」(nthToday) 를 쓰는 곳이 남지 않음', nthLeft.length === 0, nthLeft.join(', '));

console.log(`\n결과: ${pass}개 통과 / ${fail}개 실패`);
process.exit(fail ? 1 : 0);
