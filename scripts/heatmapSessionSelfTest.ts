/**
 * 종목 지도 거래 시간대 점검 — `npm run heatmapsession:test` · ⚠️ `DB_PATH=<사본>` 으로만 돈다(맨 첫 import).
 *
 * 네트워크 없음 — 토스 달력은 2026-10-22 실제 응답(`scripts/fixtures/heatmapSession/`)이나 「못 받음」(고정표)으로,
 * 최근 체결 · 일봉 다시 받기 · 순위 기준가 · 상하한가는 바꿔 끼운다. 합성 종목(`ZZTESTUS` · `999990`)의 봉과 넣은 휴장일은 끝에서 지운다.
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { getDb, saveCandles } from '../server/db';
import { baseClose, basisOf, CALENDAR_TIMEOUT_MS, heatmapSession, setSessionHooksForTest, type SessionInfo, type TossCalendarResponse } from '../server/heatmapSession';
import { priceDay, resetPreviousCloseForTest, setCandleRefreshForTest, setPriceLimitsForTest, setRankingBasesForTest } from '../server/previousClose';
import type { CalendarMarket } from '../server/marketCalendar';
import type { Candle } from '../src/types/toss';

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const fixture = (market: CalendarMarket, day: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/heatmapSession/calendar-${market}-${day}.json`, import.meta.url), 'utf8')) as TossCalendarResponse;
/** 토스 달력 실제 응답 — 2026-10-22(목, 서머타임) · 10-24(토 — today 세션 null) · 11-02(월, 서머타임 끝난 뒤) */
const FIX: Record<CalendarMarket, Record<string, TossCalendarResponse>> = {
  US: { '2026-10-22': fixture('US', '2026-10-22'), '2026-10-24': fixture('US', '2026-10-24'), '2026-11-02': fixture('US', '2026-11-02') },
  KR: { '2026-10-22': fixture('KR', '2026-10-22') },
};

/** 시각 — 'ET' 는 서머타임을 직접 적는다(EDT −04:00 · EST −05:00) */
const et = (iso: string, offset = '-04:00') => Date.parse(`${iso}${offset}`);
const kst = (iso: string) => Date.parse(`${iso}+09:00`);
const show = (info: SessionInfo) => (info.span ? `${info.span.session}·${info.span.label}·${info.span.tradeDay}` : '닫힘');

/** 고정표(토스 달력 못 받음) · 최근 체결 없음 */
const useFixed = (lastTrade: number | null = null) =>
  setSessionHooksForTest({ calendar: async () => null, lastTrade: async () => lastTrade, refreshDaily: async () => {} });
/** 토스 달력(fixture 가 있는 한국 날짜만 — 그 밖 날짜는 못 받음) */
const useToss = (lastTrade: number | null = null, refreshDaily: (symbol: string) => Promise<unknown> = async () => {}) =>
  setSessionHooksForTest({ calendar: async (m, day) => FIX[m][day] ?? null, lastTrade: async () => lastTrade, refreshDaily });

const expectSession = async (market: CalendarMarket, name: string, now: number, want: string | null, label?: string) => {
  const info = await heatmapSession(market, now);
  const ok = want === null ? info.span === null : info.span?.session === want && (label == null || info.span.label === label);
  check(`${market} ${name} → ${want === null ? '닫힘' : `${want}${label ? `(${label})` : ''}`}`, ok, show(info));
  return info;
};

const US = 'ZZTESTUS';
const KR = '999990';
const db = getDb();
const clear = () => db.prepare(`DELETE FROM candles WHERE symbol IN (?, ?)`).run(US, KR);
const bar = (day: string, close: number): Candle => ({ timestamp: Date.parse(`${day}T12:00:00Z`), open: close, high: close, low: close, close, volume: 1000 });
const addedHoliday = !db.prepare(`SELECT 1 FROM market_holidays WHERE market = 'KR' AND date = '2026-10-09'`).get();
if (addedHoliday) db.prepare(`INSERT INTO market_holidays (market, date) VALUES ('KR', '2026-10-09')`).run();

try {
  // ── 1. 미국 고정표 경계 (2026-10-22 목 · EDT) ──
  useFixed();
  await expectSession('US', '03:59 ET', et('2026-10-22T03:59:00'), null);
  await expectSession('US', '04:00 ET', et('2026-10-22T04:00:00'), 'pre', '프리마켓');
  await expectSession('US', '09:29 ET', et('2026-10-22T09:29:00'), 'pre');
  await expectSession('US', '09:30 ET', et('2026-10-22T09:30:00'), 'regular', '정규장');
  await expectSession('US', '15:59 ET', et('2026-10-22T15:59:00'), 'regular');
  await expectSession('US', '16:00 ET', et('2026-10-22T16:00:00'), 'after', '애프터마켓');
  await expectSession('US', '19:59 ET', et('2026-10-22T19:59:00'), 'after');
  const at20 = await expectSession('US', '20:00 ET(고정표엔 주간거래 없음 · 최근 체결 없음)', et('2026-10-22T20:00:00'), null);
  check('US 20:00 ET 닫힘 → 다음 세션 = 금 04:00 ET', at20.nextStart === et('2026-10-23T04:00:00'), new Date(at20.nextStart).toISOString());
  await expectSession('US', '토요일 10:00 ET', et('2026-10-24T10:00:00'), null);
  await expectSession('US', 'NYSE 휴장 추수감사절 11-26 10:00 ET', et('2026-11-26T10:00:00', '-05:00'), null);
  // 서머타임 끝(11-01) 앞뒤 — 금요일은 EDT, 월요일은 EST
  await expectSession('US', '10-30(금, EDT) 04:00 ET = 08:00Z', Date.parse('2026-10-30T08:00:00Z'), 'pre');
  await expectSession('US', '11-02(월, EST) 03:30 ET = 08:30Z', Date.parse('2026-11-02T08:30:00Z'), null);
  await expectSession('US', '11-02(월, EST) 04:00 ET = 09:00Z', Date.parse('2026-11-02T09:00:00Z'), 'pre');
  await expectSession('US', '11-02(월, EST) 16:00 ET = 21:00Z', Date.parse('2026-11-02T21:00:00Z'), 'after');
  const fri20 = await heatmapSession('US', et('2026-10-30T20:00:00'));
  check('US 금 10-30 20:00 EDT 닫힘 → 다음 = 월 11-02 04:00 EST(09:00Z)', fri20.span === null && fri20.nextStart === Date.parse('2026-11-02T09:00:00Z'), new Date(fri20.nextStart).toISOString());

  // ── 2. 국내 고정표 경계 (2026-10-22 목 · KST) ──
  await expectSession('KR', '07:59 KST', kst('2026-10-22T07:59:00'), null);
  await expectSession('KR', '08:00 KST', kst('2026-10-22T08:00:00'), 'pre', 'NXT 프리마켓');
  await expectSession('KR', '08:50 KST', kst('2026-10-22T08:50:00'), 'pre', '정규장 시작 전');
  await expectSession('KR', '09:00 KST', kst('2026-10-22T09:00:00'), 'regular', '정규장');
  await expectSession('KR', '15:30 KST', kst('2026-10-22T15:30:00'), 'after', 'NXT 애프터마켓');
  await expectSession('KR', '19:59 KST', kst('2026-10-22T19:59:00'), 'after');
  const kr20 = await expectSession('KR', '20:00 KST', kst('2026-10-22T20:00:00'), null);
  check('KR 20:00 KST 닫힘 → 다음 = 금 08:00 KST', kr20.nextStart === kst('2026-10-23T08:00:00'), new Date(kr20.nextStart).toISOString());
  await expectSession('KR', '휴장일 10-09 10:00 KST', kst('2026-10-09T10:00:00'), null);

  // ── 3. 토스 달력(2026-10-22 실제 응답) ──
  useToss();
  for (const [name, now, want, label, day] of [
    ['한국 03:00(전날 정규장)', kst('2026-10-22T03:00:00'), 'regular', '정규장', '2026-10-21'],
    ['한국 06:00(전날 애프터)', kst('2026-10-22T06:00:00'), 'after', '애프터마켓', '2026-10-21'],
    ['한국 10:00(주간거래)', kst('2026-10-22T10:00:00'), 'day', '주간거래', '2026-10-22'],
    ['한국 18:00(프리마켓)', kst('2026-10-22T18:00:00'), 'pre', '프리마켓', '2026-10-22'],
    ['한국 23:00(정규장)', kst('2026-10-22T23:00:00'), 'regular', '정규장', '2026-10-22'],
  ] as const) {
    const info = await expectSession('US', `토스 ${name}`, now, want, label);
    check(`US 토스 ${name} — 세션 거래일 ${day} = 가격 날(priceDay)`, info.span?.tradeDay === day && priceDay('AAPL', now) === day, `${info.span?.tradeDay} · priceDay ${priceDay('AAPL', now)}`);
  }
  const gap = await expectSession('US', '토스 한국 08:55(애프터 끝 08:50 ~ 주간거래 09:00 사이)', kst('2026-10-22T08:55:00'), null);
  check('US 토스 08:55 → 다음 = 09:00 KST 주간거래', gap.nextStart === kst('2026-10-22T09:00:00') && gap.source === 'toss', new Date(gap.nextStart).toISOString());
  await expectSession('KR', '토스 08:10', kst('2026-10-22T08:10:00'), 'pre', 'NXT 프리마켓');
  await expectSession('KR', '토스 08:55', kst('2026-10-22T08:55:00'), 'pre', '정규장 시작 전');
  await expectSession('KR', '토스 10:00', kst('2026-10-22T10:00:00'), 'regular');
  await expectSession('KR', '토스 16:00', kst('2026-10-22T16:00:00'), 'after', 'NXT 애프터마켓');
  const kr2030 = await expectSession('KR', '토스 20:30', kst('2026-10-22T20:30:00'), null);
  check('KR 토스 20:30 → 다음 = 10-23 08:00 KST', kr2030.nextStart === kst('2026-10-23T08:00:00'), new Date(kr2030.nextStart).toISOString());

  // ── 4. 보조 판단(시간표 닫힘 + 최근 체결) ──
  const n = kst('2026-10-22T21:00:00');
  useFixed(n - 90_000);
  const krOther = await expectSession('KR', '닫힘 + 90초 전 체결', n, 'other', '장외 거래');
  const krOtherBasis = basisOf('KR', krOther, n);
  check('KR 장외 거래 → 기준 prev(전일 종가 대비 — 국내는 늘 기준가)', krOtherBasis.basis === 'prev' && krOtherBasis.label === '전일 종가 대비', krOtherBasis.label);
  useFixed(n + 5 * 60_000);
  await expectSession('KR', '닫힘 + 체결 시각이 5분 뒤(이상한 값)', n, null);
  useFixed(n - 30_000);
  const noProbe = await heatmapSession('KR', n, { probe: false });
  check('KR 1주 이상 지도(probe: false) → 체결을 묻지 않고 닫힘', noProbe.span === null, show(noProbe));
  useFixed(n - 180_000);
  await expectSession('KR', '닫힘 + 3분 전 체결', n, null);
  const u = et('2026-10-22T21:00:00');
  useFixed(u - 30_000);
  await expectSession('US', '고정표 21:00 ET + 30초 전 체결 → 주간거래', u, 'day', '주간거래');
  useFixed(u - 30_000);
  const regular = await expectSession('US', '정규장은 체결을 묻지 않고 그대로 정규장', et('2026-10-22T10:00:00'), 'regular');
  check('US 정규장 10:00 ET 다음 세션 = 16:00 ET 애프터', regular.nextStart === et('2026-10-22T16:00:00'));

  // ── 5. 등락률 기준(세션별) ──
  useFixed();
  const basisAt = async (market: CalendarMarket, now: number) => basisOf(market, await heatmapSession(market, now), now);
  for (const [market, name, now, want, label] of [
    ['US', '프리마켓 05:00 ET', et('2026-10-22T05:00:00'), 'prev', '전일 종가 대비'],
    ['US', '정규장 11:00 ET', et('2026-10-22T11:00:00'), 'prev', '전일 종가 대비'],
    ['US', '애프터 16:09 ET(오늘 봉 확정 전)', et('2026-10-22T16:09:00'), 'prev', '전일 종가 대비'],
    ['US', '애프터 16:11 ET', et('2026-10-22T16:11:00'), 'today', '오늘 종가 대비'],
    ['KR', 'NXT 프리 08:10 KST', kst('2026-10-22T08:10:00'), 'prev', '전일 종가 대비'],
    ['KR', '정규장 10:00 KST', kst('2026-10-22T10:00:00'), 'prev', '전일 종가 대비'],
    ['KR', 'NXT 애프터 16:00 KST', kst('2026-10-22T16:00:00'), 'prev', '전일 종가 대비'],
  ] as const) {
    const b = await basisAt(market, now);
    check(`${market} ${name} → 기준 ${want}(${label})`, b.basis === want && b.label === label, `${b.basis} · ${b.label}`);
  }
  useToss();
  const dayBasis = await basisAt('US', kst('2026-10-22T10:00:00'));
  check('US 주간거래 → 기준 recent(최근 종가 대비)', dayBasis.basis === 'recent' && dayBasis.label === '최근 종가 대비', dayBasis.label);
  const tossAfter = await heatmapSession('US', kst('2026-10-22T05:05:00'));
  check('US 토스 애프터 05:05 KST(시작 5분 뒤) → 기준 prev', basisOf('US', tossAfter, kst('2026-10-22T05:05:00')).basis === 'prev');
  check('US 토스 애프터 05:11 KST → 기준 today', basisOf('US', await heatmapSession('US', kst('2026-10-22T05:11:00')), kst('2026-10-22T05:11:00')).basis === 'today');

  // ── 6. 기준 종가(합성 종목 — 일봉을 직접 넣고, 다시 받기는 바꿔 끼운다) ──
  resetPreviousCloseForTest();
  setRankingBasesForTest(async () => new Map());
  setPriceLimitsForTest(async () => null);
  setCandleRefreshForTest(async () => {});
  clear();
  const closeAt = et('2026-10-22T16:00:00');
  saveCandles(US, '1d', [bar('2026-10-20', 100), bar('2026-10-21', 110)], et('2026-10-21T18:00:00'));
  saveCandles(US, '1d', [bar('2026-10-22', 118)], et('2026-10-22T15:00:00')); // 장중에 받은 오늘 봉(미확정)
  const usBase = async (now: number) => {
    const info = await heatmapSession('US', now);
    return baseClose(US, now, info, basisOf('US', info, now));
  };
  useFixed();
  check('US 프리마켓 → 전일(10-21) 종가 110', (await usBase(et('2026-10-22T05:00:00'))) === 110);
  check('US 정규장 → 전일(10-21) 종가 110', (await usBase(et('2026-10-22T11:00:00'))) === 110);
  check('US 애프터 16:09(확정 전) → 전일 종가 110 그대로', (await usBase(et('2026-10-22T16:09:00'))) === 110);
  // 확정된 오늘 봉을 받지 못하면 null(전일 종가로 대신하지 않는다)
  setSessionHooksForTest({ calendar: async () => null, lastTrade: async () => null, refreshDaily: async () => {} });
  const noConfirmed = await usBase(et('2026-10-22T16:11:00'));
  check('US 애프터 16:11 · 확정된 오늘 봉 없음 → null(기준을 섞지 않음)', noConfirmed === null, `값 ${noConfirmed}`);
  let refreshed = 0;
  setSessionHooksForTest({
    calendar: async () => null,
    lastTrade: async () => null,
    refreshDaily: async () => {
      refreshed++;
      saveCandles(US, '1d', [bar('2026-10-22', 120)], closeAt + 11 * 60_000); // 마감 뒤 받은 오늘 종가
    },
  });
  const todayVal = await usBase(et('2026-10-22T16:11:00'));
  check('US 애프터 16:11 → 오늘(10-22) 정규장 종가 120(다시 받아 확정)', todayVal === 120 && refreshed === 1, `값 ${todayVal} · 다시 받기 ${refreshed}번`);
  const again = await usBase(et('2026-10-22T17:00:00'));
  check('US 애프터 같은 날 두 번째는 기억한 값(다시 받지 않음)', again === 120 && refreshed === 1, `값 ${again} · ${refreshed}번`);
  useFixed(et('2026-10-22T21:00:00') - 30_000);
  check('US 주간거래(20:00 ET 뒤) → 최근 정규장(10-22) 종가 120', (await usBase(et('2026-10-22T21:00:00'))) === 120);

  saveCandles(KR, '1d', [bar('2026-10-20', 1000), bar('2026-10-21', 1100)], kst('2026-10-21T21:00:00'));
  saveCandles(KR, '1d', [bar('2026-10-22', 1180)], kst('2026-10-22T10:00:00'));
  useFixed();
  for (const [name, now] of [['NXT 프리 08:10', kst('2026-10-22T08:10:00')], ['정규장 10:00', kst('2026-10-22T10:00:00')], ['NXT 애프터 16:00', kst('2026-10-22T16:00:00')]] as const) {
    const info = await heatmapSession('KR', now);
    const v = await baseClose(KR, now, info, basisOf('KR', info, now));
    check(`KR ${name} → 전일(10-21) 종가 1100`, v === 1100, `값 ${v}`);
  }

  // ── 7. 토스 달력 — 주말 · 서머타임 끝 ──
  useToss();
  await expectSession('US', '토스 토 10-24 06:00 KST(금요일 애프터)', kst('2026-10-24T06:00:00'), 'after', '애프터마켓');
  const sat = await expectSession('US', '토스 토 10-24 12:00 KST', kst('2026-10-24T12:00:00'), null);
  check('US 토스 토요일 닫힘 → 다음 = 월 10-26 09:00 KST 주간거래', sat.nextStart === kst('2026-10-26T09:00:00') && sat.source === 'toss', new Date(sat.nextStart).toISOString());
  await expectSession('US', '토스 월 11-02 09:30 KST(서머타임 끝 — 주간거래 10:00 부터)', kst('2026-11-02T09:30:00'), null);
  for (const [name, now, want, day] of [
    ['월 11-02 10:30 KST', kst('2026-11-02T10:30:00'), 'day', '2026-11-02'],
    ['월 11-02 23:40 KST', kst('2026-11-02T23:40:00'), 'regular', '2026-11-02'],
  ] as const) {
    const info = await expectSession('US', `토스 ${name}`, now, want);
    check(`US 토스 ${name} — 세션 거래일 ${day} = 가격 날`, info.span?.tradeDay === day && priceDay('AAPL', now) === day, `${info.span?.tradeDay} · priceDay ${priceDay('AAPL', now)}`);
  }

  // ── 8. 토스 달력 경로의 기준 종가 값 · 애프터 뒤 틈(19:50~20:00 ET) ──
  resetPreviousCloseForTest();
  clear();
  saveCandles(US, '1d', [bar('2026-10-20', 100)], et('2026-10-20T18:00:00'));
  saveCandles(US, '1d', [bar('2026-10-21', 110)], kst('2026-10-22T05:20:00')); // 10-21 정규장 마감 + 20분에 받은 값(확정)
  saveCandles(US, '1d', [bar('2026-10-22', 118)], kst('2026-10-22T23:30:00')); // 10-22 장중 값(미확정)
  const tossBase = async (now: number, lastTrade: number | null = null) => {
    useToss(lastTrade);
    const info = await heatmapSession('US', now);
    const b = basisOf('US', info, now);
    return { v: await baseClose(US, now, info, b), b: b.basis, s: info.span?.session ?? null };
  };
  for (const [name, now, wantV, wantB] of [
    ['애프터 05:05 KST(10-21, 확정 전)', kst('2026-10-22T05:05:00'), 100, 'prev'],
    ['애프터 05:11 KST(10-21)', kst('2026-10-22T05:11:00'), 110, 'today'],
    ['주간거래 10:00 KST(10-22)', kst('2026-10-22T10:00:00'), 110, 'recent'],
    ['프리마켓 18:00 KST(10-22)', kst('2026-10-22T18:00:00'), 110, 'prev'],
  ] as const) {
    const r = await tossBase(now);
    check(`US 토스 ${name} → 기준 ${wantB} · 값 ${wantV}`, r.v === wantV && r.b === wantB, `${r.s} · ${r.b} · ${r.v}`);
  }
  const gapNow = kst('2026-10-22T08:51:00');
  const g = await tossBase(gapNow, gapNow - 60_000);
  check('US 토스 08:51 KST(애프터 끝 뒤 틈) + 1분 전 체결 → 장외 거래 · 오늘(10-21) 종가 기준 이어 감 110', g.s === 'other' && g.b === 'today' && g.v === 110, `${g.s} · ${g.b} · ${g.v}`);

  // ── 9. 토스 달력이 시간 제한 안에 답하지 않으면 고정표(v2.59.6 — 기본 10초, 여기서는 50ms 로 줄여 본다) ──
  check('토스 달력 시간 제한 기본 = 10초', CALENDAR_TIMEOUT_MS === 10_000, String(CALENDAR_TIMEOUT_MS));
  let hung = 0;
  setSessionHooksForTest({
    calendar: () => {
      hung++;
      return new Promise<never>(() => {}); // 끝나지 않는 응답
    },
    lastTrade: async () => null,
    refreshDaily: async () => {},
    calendarTimeoutMs: 50,
  });
  const slowAt = Date.now();
  const slowUs = await heatmapSession('US', kst('2026-10-26T23:40:00'));
  const slowMs = Date.now() - slowAt;
  check('토스 달력 응답 없음 → 시간 제한 뒤 고정표로 세션을 낸다(US 월 23:40 KST = 정규장)', slowUs.source === 'fixed' && slowUs.span?.session === 'regular' && hung === 1 && slowMs < 2000, `${slowUs.source} · ${slowUs.span?.session} · ${slowMs}ms · 받기 ${hung}번`);
  const slowAgain = await heatmapSession('US', kst('2026-10-26T23:45:00'));
  check('시간 제한 뒤 5분 안에는 다시 부르지 않는다(받기 실패와 같은 재시도 간격)', slowAgain.source === 'fixed' && hung === 1, `받기 ${hung}번`);
  setSessionHooksForTest({ calendarTimeoutMs: null });
} finally {
  setSessionHooksForTest({ calendar: null, lastTrade: null, refreshDaily: null });
  setCandleRefreshForTest(null);
  setRankingBasesForTest(null);
  setPriceLimitsForTest(null);
  clear();
  if (addedHoliday) db.prepare(`DELETE FROM market_holidays WHERE market = 'KR' AND date = '2026-10-09'`).run();
}

console.log(`\n결과: ${pass}개 통과 / ${fail}개 실패`);
process.exit(fail ? 1 : 0);
