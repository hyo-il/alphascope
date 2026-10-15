/**
 * 전 거래일 종가 점검 (v2.44.3) — `npm run prevclose:test` · ⚠️ `DB_PATH=<사본>` 으로만 돈다(맨 첫 import).
 *
 * 등락률이 이틀치로 보이던 버그(어제 봉이 캐시에 없으면 그저께 종가를 전일 종가로 썼다)를 재현하고, 고친 규칙을 확인한다.
 * - 합성 종목(`ZZTESTUS` 미국 · `999990` 국내)에 일봉을 직접 넣고, 일봉 다시 받기는 바꿔 끼운다(`setCandleRefreshForTest`) — 토스를 부르지 않는다.
 * - 마지막 절만 실제 토스로: 사본 DB 에서 000660 의 전 거래일 봉을 지우고 다시 받아 오는지.
 * 넣은 합성 봉·휴장일은 끝에서 지운다(사본 DB 라도 남기지 않는다).
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다(v2.44.2)
import 'dotenv/config';
import { getDb, loadCandles, saveCandles } from '../server/db';
import { previousClose, previousTradingDay, resetPreviousCloseForTest, setCandleRefreshForTest } from '../server/previousClose';
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

/** 예전 규칙(v2.44.2 까지) — "오늘보다 앞선 마지막 캐시 봉"(캐시가 5일 안이면 다시 받지 않았다). 재현용 */
const oldRule = (symbol: string, now: number) => {
  const today = marketDate(now, symbol);
  return loadCandles(symbol, '1d', 5).filter((c) => marketDate(c.timestamp, symbol) < today).at(-1)?.close ?? null;
};

clear();
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

  // ── 7. 실제 토스 — 사본 DB 의 000660 전 거래일 봉을 지우고 다시 받아 오는지 ──
  setCandleRefreshForTest(null);
  resetPreviousCloseForTest();
  if (isMockMode()) {
    console.log('SKIP  실제 토스 절 — 키 없음(모의 모드)');
  } else {
    const sym = '000660';
    const today = marketDate(Date.now(), sym);
    const prevDay = previousTradingDay(sym, today);
    db.prepare(`DELETE FROM candles WHERE symbol = ? AND timeframe = '1d' AND timestamp >= ?`).run(sym, krMidnight(prevDay));
    const oldVal = oldRule(sym, Date.now());
    const oldDay = loadCandles(sym, '1d', 5).at(-1);
    const real = await previousClose(sym);
    const realBar = loadCandles(sym, '1d', 10).find((c) => marketDate(c.timestamp, sym) === prevDay);
    check(`실제 토스: ${sym} 전 거래일(${prevDay}) 봉을 지운 뒤 다시 받아 그 종가`, real !== null && realBar != null && real === realBar.close,
      `값 ${real} · 예전 규칙이면 ${oldVal}(${oldDay ? marketDate(oldDay.timestamp, sym) : '—'} 봉)`);
  }
} finally {
  setCandleRefreshForTest(null);
  clear();
  if (addedHoliday) db.prepare(`DELETE FROM market_holidays WHERE market = 'KR' AND date = '2026-10-09'`).run();
}

console.log(`\n결과: ${pass}개 통과 / ${fail}개 실패`);
process.exit(fail ? 1 : 0);
