/**
 * 자산 하루 기록 예약(v2.62.0) — 미국 거래일 D 마다 **한 번**, 두 시장이 모두 닫힌 때 총 자산을 `asset_daily` 에 남긴다.
 *
 * 기록 시각(숫자로 박지 않는다 — 토스 장 달력 `sessionSpans` · `regularSessionStart/End` 를 읽는다 · 휴장 · 조기 마감 · 서머타임은 달력이 맞춘다):
 * - 가장 최근에 **끝난** 미국 애프터마켓 칸(그 거래일 = D) 의 끝 시각.
 * - 그 시각이 국내 정규장 안이면(서머타임이 아닐 때 — 애프터 끝 09:50 KST) 그날 국내 정규장 끝까지 미룬다.
 * - 기록할 수 있는 동안: 그 시각부터 **다음 미국 정규장 시작 전까지**. 서버가 꺼져 있었으면 켜진 뒤 이 안에서 한 번.
 *   다음 정규장이 시작한 뒤에는 D 를 쓰지 않는다(지난 날은 채우지 않는다 — 그날 가격을 모른다).
 * - 토스 달력을 받지 못하면(모의 · 실패) 그 확인은 건너뛴다(다음 확인에 다시 — 고정표로 짐작하지 않는다).
 * 가격(v2.62.1): **미국 종목 = 그 거래일 D 의 미국 정규장 종가** — `heatmapSession.regularCloseOn`(종목 지도 「오늘 종가」 와 같은 함수 · 캐시 ·
 *   정규장 끝 + 10분 뒤에 받은 일봉만 — 토스 미국 일봉 종가 = 정규장 종가). 겨울에는 기록 시각(국내 정규장 끝 15:30 KST)이 미국 주간거래 중이라
 *   토스 지금 가격에 주간거래 체결이 섞인다 — 그래서 지금 가격을 쓰지 않는다. 종가를 못 받으면 그 종목은 「가격 못 받음」.
 *   국내 종목 · 환율은 지금처럼 토스 지금 가격(기록 시각이 국내 정규장 끝 뒤). 화면의 지금 총 자산(10초 갱신)은 지금 가격 그대로.
 * v2.70.0: 그 기록에 쓴 환율(`fx_usdkrw`) · 보유 줄마다 금액(`holdings_json`)도 같은 `book` 으로 남긴다(총 자산 계산은 그대로).
 * 같은 날 두 번 쓰지 않는다(`day` 기본 키). 모든 보유 줄의 가격을 못 받았으면 쓰지 않고 다음 확인에 다시(총 자산이 현금만으로 남지 않게).
 * 예약은 `ASSET_SYNC_ENABLED`(기본 켬) · 시트 연결 정보가 있을 때만 · 모의 데이터 모드는 하지 않는다(받은 가격이 아니다).
 * ⚠️ 로그에는 「하루 기록 완료 · 가격 못 받음 N줄」 과 실패 이유 종류만(금액 · 수량 없음).
 */
import { CONFIRM_MARGIN_MS } from '../db';
import { regularCloseOn, regularSessionEnd, regularSessionStart, sessionSpans } from '../heatmapSession';
import { isMockMode } from '../mockData';
import { marketDate } from '../../src/utils/marketDate';
import { isAssetSyncEnabled, isSheetConfigured } from './config';
import { AssetSheetError } from './google';
import { hasRecord, insertRecord } from './store';
import type { AssetSheetData } from '../../src/types/asset';
import { computeAssetTotals, dailyHoldings, loadInputs, type PriceBook } from './summary';

/** 확인 간격 — 기록할 수 있는 동안(몇 시간)보다 훨씬 짧으면 된다 */
const CHECK_MS = 5 * 60_000;

export interface RecordWindow {
  /** 미국 거래일 D */
  day: string;
  /** 기록 시각(이때부터) */
  at: number;
  /** 다음 미국 정규장 시작(이 전까지) — 달력에 없으면 null(끝을 모름 — 막지 않는다) */
  until: number | null;
}

/** 지금 기준 가장 최근 미국 거래일의 기록 칸 — 토스 달력이 없으면 null */
export async function recordWindow(now: number): Promise<RecordWindow | null> {
  const us = await sessionSpans('US', now);
  if (!us) return null;
  const after = us.filter((s) => s.session === 'after' && s.end <= now && s.tradeDay).at(-1);
  if (!after?.tradeDay) return null;
  let at = after.end;
  const krDay = marketDate(at, '005930');
  const [krStart, krEnd] = await Promise.all([regularSessionStart('KR', krDay, now), regularSessionEnd('KR', krDay, now)]);
  if (krStart != null && krEnd != null && krStart <= at && at < krEnd) at = krEnd;
  const until = us.find((s) => s.session === 'regular' && s.start > after.end)?.start ?? null;
  return { day: after.tradeDay, at, until };
}

/**
 * 하루 기록 가격 — 미국 종목은 지금 가격을 버리고 D 의 정규장 종가로 바꾼다(못 받으면 빠짐 → 「가격 못 받음」). 국내 · 환율은 그대로.
 * 종가는 정규장 끝 + 10분 뒤에 받은 일봉만(`regularCloseOn` 의 `confirmAt`) — 달력에 정규장 끝이 없으면 기록 시각 뒤에 받은 것만.
 */
export async function closingBook(data: AssetSheetData, book: PriceBook, w: RecordWindow, now: number): Promise<PriceBook> {
  const prices = new Map(book.prices);
  const usSymbols = [...new Set(data.sections.filter((s) => !s.combined).flatMap((s) => s.holdings.flatMap((h) => (h.market === 'US' && h.symbol ? [h.symbol] : []))))];
  if (usSymbols.length === 0) return book;
  const end = await regularSessionEnd('US', w.day, now);
  const confirmAt = end != null ? end + CONFIRM_MARGIN_MS : w.at;
  for (const symbol of usSymbols) {
    prices.delete(symbol);
    const close = await regularCloseOn(symbol, w.day, confirmAt);
    if (close != null && Number.isFinite(close) && close > 0) prices.set(symbol, close);
  }
  return { prices, usdKrw: book.usdKrw };
}

export type TickResult = 'off' | 'no-window' | 'not-yet' | 'expired' | 'done-already' | 'no-prices' | 'failed' | 'recorded';

let running = false;

/** 한 번 확인 — 시험이 가짜 시계(now) · 가짜 달력으로 부른다 */
export async function dailyTick(now = Date.now()): Promise<TickResult> {
  if (!isAssetSyncEnabled() || !isSheetConfigured() || isMockMode()) return 'off';
  if (running) return 'not-yet';
  running = true;
  try {
    const w = await recordWindow(now);
    if (!w) return 'no-window'; // 토스 달력 없음 · 달력 안에 끝난 애프터 없음(그 앞 날은 이미 지났다)
    if (now < w.at) return 'not-yet';
    if (w.until != null && now >= w.until) return 'expired';
    if (hasRecord(w.day)) return 'done-already';
    const inputs = await loadInputs();
    const { data, settings } = inputs;
    const book = await closingBook(data, inputs.book, w, now);
    const plain = computeAssetTotals(data, book, settings, false).totals;
    const pension = computeAssetTotals(data, book, settings, true).totals;
    const rows = data.sections.filter((s) => !s.combined).reduce((n, s) => n + s.holdings.length, 0);
    if (rows > 0 && pension.missing >= rows) {
      console.warn('[asset] 하루 기록 미룸 · 가격을 하나도 받지 못함');
      return 'no-prices';
    }
    // v2.70.0 — 같은 `book` 으로 계산한 환율 · 보유 줄마다 금액도 함께(다시 받지 않는다 · 「무엇 때문에」 의 주가 · 환율 나누기)
    const extra = { fxUsdKrw: book.usdKrw, holdings: dailyHoldings(data, book, settings) };
    if (!insertRecord(w.day, plain, pension, new Date(now).toISOString(), extra)) return 'done-already';
    console.log(`[asset] 하루 기록 완료 · 가격 못 받음 ${pension.missing}줄`);
    return 'recorded';
  } catch (e) {
    console.warn(`[asset] 하루 기록 실패: ${e instanceof AssetSheetError ? e.kind : '알 수 없는 오류'}`);
    return 'failed';
  } finally {
    running = false;
  }
}

/** 서버 시작 때 한 번 — 켜자마자 한 번 확인(꺼져 있던 동안의 그날 것) 뒤 5분마다 */
export function startAssetDailyScheduler(): void {
  if (!isAssetSyncEnabled()) {
    console.log('[asset] 하루 기록 예약을 하지 않습니다 (ASSET_SYNC_ENABLED=false)');
    return;
  }
  if (!isSheetConfigured()) return; // 시트 연결 정보 없음 — 자산 관리 화면만 안내(서버는 조용히)
  setTimeout(() => void dailyTick(), 60_000);
  setInterval(() => void dailyTick(), CHECK_MS);
}
