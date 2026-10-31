/**
 * 전 거래일 종가 점검 — `npm run prevclose:test` · ⚠️ `DB_PATH=<사본>` 으로만 돈다(맨 첫 import).
 *
 * 등락률이 이틀치로 보이던 버그(어제 봉이 캐시에 없으면 그저께 종가를 전일 종가로 썼다 · 미국 「오늘」 을 뉴욕 달력으로 잡았다)를 재현하고,
 * 고친 규칙(토스 순위 기준가 우선 → 가격 날 바로 앞 영업일의 일봉)을 확인한다.
 * - 합성 종목(`ZZTESTUS` 미국 · `999990` 국내)에 일봉을 직접 넣고, 일봉 다시 받기는 바꿔 끼운다(`setCandleRefreshForTest`) — 토스를 부르지 않는다.
 * - 마지막 절만 실제 토스로: 사본 DB 에서 000660 의 전 거래일 봉을 지우고 다시 받아 오는지.
 * 넣은 합성 봉·휴장일은 끝에서 지운다(사본 DB 라도 남기지 않는다).
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import 'dotenv/config';
import { getDb, loadCandles, saveCandles } from '../server/db';
import { krLimitsAreFor, previousClose, previousTradingDay, priceDay, resetPreviousCloseForTest, setCandleRefreshForTest, setPriceLimitsForTest, setRankingBasesForTest, solveKrBase } from '../server/previousClose';
import { changeRateOf } from '../server/summaryService';
import { tossGet } from '../src/services/toss/httpClient';
import { marketDate } from '../src/utils/marketDate';
import { isMockMode } from '../server/mockData';
import type { Candle } from '../src/types/toss';

let pass = 0;
let fail = 0;
const check = (name: string, ok: boolean, detail = '') => {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

const US = 'ZZTESTUS';
const KR = '999990';
/** 합성 봉 시각 — 12:00 UTC 는 국내(21시)·미국(07~08시, 서머타임 무관) 모두 같은 날짜다. 판정은 날짜(`marketDate`)로만 한다 */
const at = (day: string) => Date.parse(`${day}T12:00:00Z`);
/** 실제 국내 일봉 timestamp — KST 자정 */
const krMidnight = (day: string) => Date.parse(`${day}T00:00:00+09:00`);
const bar = (_symbol: string, day: string, close: number): Candle => ({
  timestamp: at(day),
  open: close,
  high: close,
  low: close,
  close,
  volume: 1000,
});
/** 그 시장 날짜의 낮(국내 12시 KST · 미국 11~12시 ET) — previousClose 의 `now` */
const noon = (symbol: string, day: string) => Date.parse(`${day}T${symbol === KR ? '03' : '16'}:00:00Z`);

const db = getDb();
const clear = () => db.prepare(`DELETE FROM candles WHERE symbol IN (?, ?)`).run(US, KR);
const put = (symbol: string, rows: [string, number][]) => saveCandles(symbol, '1d', rows.map(([d, c]) => bar(symbol, d, c)));

/** 고치기 전 규칙 — "오늘보다 앞선 마지막 캐시 봉"(캐시가 5일 안이면 다시 받지 않았다). 재현용 */
const oldRule = (symbol: string, now: number) => {
  const today = marketDate(now, symbol);
  return loadCandles(symbol, '1d', 5).filter((c) => marketDate(c.timestamp, symbol) < today).at(-1)?.close ?? null;
};

clear();
setRankingBasesForTest(async () => new Map()); // 합성 절은 순위에 없는 종목 — ② 일봉 경로
const addedHoliday = !db.prepare(`SELECT 1 FROM market_holidays WHERE market = 'KR' AND date = '2026-10-09'`).get();
if (addedHoliday) db.prepare(`INSERT INTO market_holidays (market, date) VALUES ('KR', '2026-10-09')`).run();

try {
  for (const s of [US, KR]) {
    const mk = s === US ? '미국' : '국내';
    // ── 1. 재현 · 어제 봉 없음 → 다시 받아서 어제 종가 ──
    resetPreviousCloseForTest();
    clear();
    put(s, [['2026-10-12', 100], ['2026-10-13', 90]]); // 어제(10-14) 봉 없음
    const now = noon(s, '2026-10-15');
    const old = oldRule(s, now);
    check(`${mk} 재현: 예전 규칙은 그저께(10-13) 종가 90`, old === 90, `예전 값 ${old}`);
    let calls = 0;
    setCandleRefreshForTest(async () => {
      calls++;
      put(s, [['2026-10-14', 80]]); // 다시 받으면 어제 봉이 생긴다
    });
    const v1 = await previousClose(s, now);
    check(`${mk} 어제 봉 없음 → 다시 받아 어제(10-14) 종가 80`, v1 === 80, `값 ${v1} · 다시 받기 ${calls}번`);
    const v1b = await previousClose(s, now);
    check(`${mk} 같은 날 두 번째는 기억한 값(다시 받지 않음)`, v1b === 80 && calls === 1, `값 ${v1b} · 다시 받기 ${calls}번`);

    // ── 2. 받아도 없음 → null (그저께 값을 쓰지 않음) ──
    resetPreviousCloseForTest();
    clear();
    put(s, [['2026-10-12', 100], ['2026-10-13', 90]]);
    calls = 0;
    setCandleRefreshForTest(async () => {
      calls++;
    });
    const v2 = await previousClose(s, now);
    check(`${mk} 받아도 어제 봉 없음 → null`, v2 === null, `값 ${v2}`);
    const v2b = await previousClose(s, now);
    check(`${mk} 못 구한 값은 기억하지 않고 바로 다시 받지도 않음(${5}분 뒤)`, v2b === null && calls === 1, `다시 받기 ${calls}번`);

    // ── 3. 받기 실패 → 캐시의 그 날짜 봉이 있으면 그 값(기억하지 않음) ──
    resetPreviousCloseForTest();
    clear();
    put(s, [['2026-10-13', 90], ['2026-10-14', 85]]);
    calls = 0;
    setCandleRefreshForTest(async () => {
      calls++;
      throw new Error('네트워크 끊김(시험)');
    });
    const v3 = await previousClose(s, now);
    check(`${mk} 받기 실패 · 캐시에 어제 봉 있음 → 어제 종가 85`, v3 === 85, `값 ${v3}`);

    // ── 4. 장중에 캐시된 어제 봉(종가가 마감 값이 아님) → 다시 받아 최종 종가 ──
    resetPreviousCloseForTest();
    clear();
    put(s, [['2026-10-13', 90], ['2026-10-14', 88]]); // 88 = 어제 장중에 받아 둔 값
    setCandleRefreshForTest(async () => put(s, [['2026-10-14', 82]])); // 마감 종가 82
    const v4 = await previousClose(s, now);
    check(`${mk} 장중에 캐시된 어제 봉 → 다시 받아 마감 종가 82`, v4 === 82, `값 ${v4}`);

    // ── 5. 주말 다음 월요일 → 금요일 ──
    resetPreviousCloseForTest();
    clear();
    put(s, [['2026-10-15', 70], ['2026-10-16', 75]]);
    setCandleRefreshForTest(async () => {});
    const mon = noon(s, '2026-10-19');
    check(`${mk} 월요일(10-19)의 전 거래일 = 금요일(10-16)`, previousTradingDay(s, '2026-10-19') === '2026-10-16');
    const v5 = await previousClose(s, mon);
    check(`${mk} 월요일 → 금요일 종가 75`, v5 === 75, `값 ${v5}`);
  }

  // ── 6. 휴장일 다음 날 → 휴장 전 영업일 ──
  // 국내: 2026-10-09(한글날, 금) 휴장 → 10-12(월)의 전 거래일 = 10-08(목)
  resetPreviousCloseForTest();
  clear();
  put(KR, [['2026-10-08', 60], ['2026-10-09', 999]]); // 휴장일에 봉이 있어도 쓰지 않는다
  setCandleRefreshForTest(async () => {});
  check('국내 10-12(월)의 전 거래일 = 10-08(목) (한글날·주말 건너뜀)', previousTradingDay(KR, '2026-10-12') === '2026-10-08', previousTradingDay(KR, '2026-10-12'));
  const v6 = await previousClose(KR, noon(KR, '2026-10-12'));
  check('국내 휴장일 다음 영업일 → 휴장 전 영업일 종가 60', v6 === 60, `값 ${v6}`);
  // 미국: 2026-11-26(추수감사절, NYSE 표) → 11-27(금)의 전 거래일 = 11-25(수)
  resetPreviousCloseForTest();
  clear();
  put(US, [['2026-11-25', 50]]);
  check('미국 11-27(금)의 전 거래일 = 11-25(수) (추수감사절 건너뜀)', previousTradingDay(US, '2026-11-27') === '2026-11-25', previousTradingDay(US, '2026-11-27'));
  const v7 = await previousClose(US, noon(US, '2026-11-27'));
  check('미국 휴장일 다음 날 → 휴장 전 영업일 종가 50', v7 === 50, `값 ${v7}`);

  // ── 7. 가격 날(토스 거래일) — 국내 08:00 KST · 미국 20:00 ET 에 넘어간다 ──
  const at2 = (iso: string) => Date.parse(iso);
  const pd = (sym: string, iso: string, want: string, label: string) =>
    check(`가격 날 ${label} → ${want}`, priceDay(sym, at2(iso)) === want, priceDay(sym, at2(iso)));
  pd(KR, '2026-10-15T07:30:00+09:00', '2026-10-14', '국내 목 07:30(장 전)');
  pd(KR, '2026-10-15T08:30:00+09:00', '2026-10-15', '국내 목 08:30');
  pd(KR, '2026-10-17T12:00:00+09:00', '2026-10-16', '국내 토요일');
  pd(US, '2026-10-14T19:30:00-04:00', '2026-10-14', '미국 수 19:30 ET(애프터마켓)');
  pd(US, '2026-10-14T21:30:00-04:00', '2026-10-15', '미국 수 21:30 ET(= 한국 목 10:30)');
  pd(US, '2026-10-17T12:00:00-04:00', '2026-10-16', '미국 토요일');
  pd(US, '2026-10-18T21:00:00-04:00', '2026-10-19', '미국 일 21:00 ET(= 한국 월 아침)');
  // 재현 2: 한국 목 10:30(= 미국 수 21:30 ET) — 미국 「오늘」 을 뉴욕 달력(수요일)으로 잡으면 화요일 종가와 비교해 이틀치가 된다
  resetPreviousCloseForTest();
  clear();
  put(US, [['2026-10-13', 100], ['2026-10-14', 90]]);
  setCandleRefreshForTest(async () => {});
  const kst1030 = at2('2026-10-15T10:30:00+09:00');
  check('재현: 예전 규칙은 한국 목 10:30 미국 기준가 = 화(10-13) 100', oldRule(US, kst1030) === 100, `예전 값 ${oldRule(US, kst1030)}`);
  const v8 = await previousClose(US, kst1030);
  check('한국 목 10:30 미국 기준가 = 수(10-14) 종가 90', v8 === 90, `값 ${v8}`);

  // ── 8. 토스 순위 기준가가 1순위 ──
  resetPreviousCloseForTest();
  clear();
  const nowPd = priceDay(US);
  const expected = previousTradingDay(US, nowPd);
  put(US, [[expected, 120]]);
  let refreshCalls = 0;
  setCandleRefreshForTest(async () => {
    refreshCalls++;
  });
  setRankingBasesForTest(async (m) => new Map(m === 'US' ? [[US, 123]] : []));
  const v9 = await previousClose(US);
  check('순위에 기준가가 있으면 그 값(123, 일봉 120 이 아니라) · 일봉은 받지 않음', v9 === 123 && refreshCalls === 0, `값 ${v9} · 다시 받기 ${refreshCalls}번`);
  resetPreviousCloseForTest();
  setRankingBasesForTest(async () => new Map());
  const v10 = await previousClose(US);
  check('순위에 없으면 일봉(120)', v10 === 120 && refreshCalls === 1, `값 ${v10} · 다시 받기 ${refreshCalls}번`);

  // ── 9. 국내 상·하한가에서 기준가 풀기 ──
  check('풀기: 상 1,844,000 · 하 994,000 → 1,419,000', JSON.stringify(solveKrBase(1844000, 994000)) === '[1419000]', JSON.stringify(solveKrBase(1844000, 994000)));
  check('풀기: 상 225,500 · 하 121,600 → 173,600 · 173,700(인접 호가 둘)', JSON.stringify(solveKrBase(225500, 121600)) === '[173600,173700]', JSON.stringify(solveKrBase(225500, 121600)));
  check('풀기: ETF(호가 5원) 상 123,245 · 하 66,365 → 답 없음', solveKrBase(123245, 66365).length === 0);
  const krPd = priceDay(KR);
  const krExp = previousTradingDay(KR, krPd);
  /** 가격 날(krPd)의 한국 시각 — 상·하한가를 쓰는지는 이 시각으로 본다(시험이 도는 시각과 무관) */
  const krAt = (day: string, hm: string) => Date.parse(`${day}T${hm}:00+09:00`);
  const limitCase = async (label: string, lim: { upper: number; lower: number } | null, candle: number, want: number | null, now = krAt(krPd, '12:00')) => {
    resetPreviousCloseForTest();
    clear();
    put(KR, [[krExp, candle]]);
    setCandleRefreshForTest(async () => {});
    setRankingBasesForTest(async () => new Map());
    setPriceLimitsForTest(async () => lim);
    const v = await previousClose(KR, now);
    check(label, v === want, `값 ${v}`);
  };
  await limitCase('국내 순위에 없음 · 상·하한가 답 하나 → 그 기준가(일봉 1,425,000 이 아니라 1,419,000)', { upper: 1844000, lower: 994000 }, 1425000, 1419000);
  await limitCase('국내 인접 호가 둘 → 일봉 종가에 가까운 쪽(173,700)', { upper: 225500, lower: 121600 }, 173690, 173700);
  await limitCase('국내 상·하한가 답 없음(ETF 등) → 일봉 종가', { upper: 123245, lower: 66365 }, 94800, 94800);
  await limitCase('국내 상·하한가 답이 일봉과 5% 넘게 다름 → 일봉 종가', { upper: 1844000, lower: 994000 }, 1300000, 1300000);
  await limitCase('국내 상·하한가 받기 실패 → 일봉 종가', null, 50000, 50000);
  // 장 마감 뒤 토스 상·하한가는 다음 거래일 것(풀면 오늘 종가) — 가격 날의 정규장 마감 전까지만 쓴다(v2.60.1)
  const nextDay = new Date(Date.parse(`${krPd}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
  await limitCase('국내 장 중 15:29 → 상·하한가 씀(1,419,000)', { upper: 1844000, lower: 994000 }, 1425000, 1419000, krAt(krPd, '15:29'));
  await limitCase('국내 장 마감 15:30 → 상·하한가 쓰지 않고 일봉 종가(1,425,000)', { upper: 1844000, lower: 994000 }, 1425000, 1425000, krAt(krPd, '15:30'));
  await limitCase('국내 저녁 21:45 → 일봉 종가', { upper: 1844000, lower: 994000 }, 1425000, 1425000, krAt(krPd, '21:45'));
  await limitCase('국내 다음 날 07:59(가격 날이 아직 그날) → 일봉 종가', { upper: 1844000, lower: 994000 }, 1425000, 1425000, krAt(nextDay, '07:59'));
  const lf = (iso: string, want: boolean, label: string) => check(`상·하한가가 10-30(금) 것인가 — ${label} → ${want}`, krLimitsAreFor('2026-10-30', Date.parse(iso)) === want);
  lf('2026-10-30T08:30:00+09:00', true, '금 08:30(장 전)');
  lf('2026-10-30T15:29:59+09:00', true, '금 15:29:59');
  lf('2026-10-30T15:30:00+09:00', false, '금 15:30(마감)');
  lf('2026-10-31T21:45:00+09:00', false, '토 21:45');
  setPriceLimitsForTest(null);

  // ── 9-2. AI 요약 등락률(`summaryService.changeRateOf`)도 이 기준가 — 끝에서 두 번째 봉이 아니다(v2.59.6) ──
  resetPreviousCloseForTest();
  clear();
  // 끝에서 두 번째 봉 = 그저께(100) · 전 거래일 봉 = 110 · 마지막 = 오늘 장중(121). 옛 규칙이면 +21%, 맞으면 +10%
  const pdUs = priceDay(US);
  const prevUs = previousTradingDay(US, pdUs);
  put(US, [[previousTradingDay(US, prevUs), 100], [prevUs, 110], [pdUs, 121]]);
  setCandleRefreshForTest(async () => {});
  setRankingBasesForTest(async () => new Map());
  const rate = await changeRateOf(US, 121);
  check('AI 요약 등락률 = 전 거래일 종가(110) 대비 +10%(끝에서 두 번째 봉이면 +21%)', rate !== null && Math.abs(rate - 10) < 1e-9, `값 ${rate}`);
  resetPreviousCloseForTest();
  clear();
  put(US, [[previousTradingDay(US, prevUs), 100], [pdUs, 121]]); // 전 거래일 봉 없음
  const noBase = await changeRateOf(US, 121);
  check('AI 요약 등락률 — 전 거래일 봉이 없으면 null(그저께 값으로 대신하지 않음)', noBase === null, `값 ${noBase}`);
  check('AI 요약 등락률 — 현재가가 없으면 null', (await changeRateOf(US, null)) === null);
  resetPreviousCloseForTest();
  clear();
  put(US, [[previousTradingDay(US, prevUs), 100], [prevUs, 110], [pdUs, 121]]);
  const cachedDay = await changeRateOf(US, 110, Date.now(), prevUs);
  check('AI 요약 등락률 — 현재가 대신 캐시 봉(전 거래일 110)을 쓰면 그 봉 날짜의 전 거래일(100) 대비 +10%', cachedDay !== null && Math.abs(cachedDay - 10) < 1e-9, `값 ${cachedDay}`);

  // ── 10. 실제 토스 — 사본 DB 의 000660 전 거래일 봉을 지우고 다시 받아 오는지 ──
  setCandleRefreshForTest(null);
  setRankingBasesForTest(null);
  resetPreviousCloseForTest();
  if (isMockMode()) {
    console.log('SKIP  실제 토스 절 — 키 없음(모의 모드)');
  } else {
    const sym = '000660';
    const prevDay = previousTradingDay(sym, priceDay(sym));
    db.prepare(`DELETE FROM candles WHERE symbol = ? AND timeframe = '1d' AND timestamp >= ?`).run(sym, krMidnight(prevDay));
    const oldVal = oldRule(sym, Date.now());
    const oldDay = loadCandles(sym, '1d', 5).at(-1);
    // ① 순위 기준가 — 토스 순위 응답의 basePrice 와 같아야 한다
    const r = await tossGet<any>('/api/v1/rankings', { type: 'MARKET_TRADING_AMOUNT', marketCountry: 'KR', duration: '1d' }, 'RANKING');
    const tossBase = Number(r.result?.rankings?.find((x: any) => x.symbol === sym)?.price?.basePrice);
    const viaRank = await previousClose(sym);
    check(`실제 토스 ①: ${sym} 기준가 = 토스 순위 basePrice ${tossBase}`, viaRank === tossBase, `값 ${viaRank} · 예전 규칙이면 ${oldVal}(${oldDay ? marketDate(oldDay.timestamp, sym) : '—'} 봉)`);
    // ② 순위를 빼면 — 장 마감 전: 상·하한가로 푼 기준가 = 토스 기준가 · 장 마감 뒤: 상·하한가는 다음 거래일 것이라 쓰지 않고 일봉 종가
    resetPreviousCloseForTest();
    setRankingBasesForTest(async () => new Map());
    const limitsToday = krLimitsAreFor(priceDay(sym), Date.now());
    const viaLimits = await previousClose(sym);
    const barClose = loadCandles(sym, '1d', 10).find((c) => marketDate(c.timestamp, sym) === prevDay)?.close ?? null;
    if (limitsToday) check(`실제 토스 ②(장 마감 전): 순위 없이 상·하한가로 푼 기준가 = ${tossBase}`, viaLimits === tossBase, `값 ${viaLimits}`);
    else check(`실제 토스 ②(장 마감 뒤): 순위 없이 — 상·하한가를 쓰지 않고 ${prevDay} 일봉 종가 ${barClose}`, barClose !== null && viaLimits === barClose, `값 ${viaLimits}`);
    // ③ 순위·상하한가를 빼면 일봉 — 지운 봉을 다시 받아 그 날짜 종가
    resetPreviousCloseForTest();
    setPriceLimitsForTest(async () => null);
    const viaCandle = await previousClose(sym);
    const realBar = loadCandles(sym, '1d', 10).find((c) => marketDate(c.timestamp, sym) === prevDay);
    check(`실제 토스 ③: 순위·상하한가 없이 — ${prevDay} 봉을 지운 뒤 다시 받아 그 종가`, viaCandle !== null && realBar != null && viaCandle === realBar.close,
      `값 ${viaCandle} (일봉은 KRX+NXT 통합 종가라 기준가와 ${tossBase ? (((viaCandle ?? 0) / tossBase - 1) * 100).toFixed(2) : '—'}% 차이)`);
    setPriceLimitsForTest(null);
  }
} finally {
  setCandleRefreshForTest(null);
  setRankingBasesForTest(null);
  setPriceLimitsForTest(null);
  clear();
  if (addedHoliday) db.prepare(`DELETE FROM market_holidays WHERE market = 'KR' AND date = '2026-10-09'`).run();
}

console.log(`\n결과: ${pass}개 통과 / ${fail}개 실패`);
process.exit(fail ? 1 : 0);
