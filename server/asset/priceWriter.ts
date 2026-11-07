/**
 * 시트 가격 10초 쓰기(v2.65.0) — 출처가 토스(`asset.priceSource = toss`)인 동안, 미국 · 한국 중 **세션이 열린 시장**의 바꾼 줄 가격(E)과
 * (그 시장에 미국 줄이 있으면) 환율(C9)을 **10초마다 · 지난번과 다른 칸만 · 한 요청**(숫자 — RAW)으로 「티커」 에 쓴다.
 *
 * - 열림 = 토스 장 달력(`heatmapSession.sessionSpans` — 같은 캐시를 읽기만)의 세션 칸 안 — 미국 주간거래 · 프리 · 정규 · 애프터 / 한국 프리 · 정규 · 애프터.
 *   서머타임 · 휴장 · 조기 마감은 달력이 맞춘다(시각을 코드에 박지 않는다). 달력을 받지 못하면(모의 · 실패) 그 시장은 닫힘으로 본다.
 * - 한 시장이 닫히면(애프터가 끝나면) 그 시장 줄의 마지막 가격을 **1번** 쓰고, 다음 세션까지 그 시장은 쉰다. 두 시장이 다 닫히면 요청 0.
 * - 시세: 열린 시장의 바꾼 줄(+ 토스 가격이 없어 남은 줄 — 「남은 종목도 토스로 바꾸기」 를 보일지)만 토스 /prices **1번** ·
 *   환율은 60초 캐시(`fetchExchangeRate` 와 같은 길이). 토스 가격을 못 받은 줄은 그 회차에 건너뛴다(시트 값 그대로).
 * - 쓰기 전에 「티커」 C열 코드를 다시 읽어 `asset.priceRows` 의 코드와 같은지 본다 — 다르면 그 줄은 쓰지 않고 「줄 코드가 바뀜」.
 * - 실패는 이유 종류만 로그. 구글 429 · 5xx 가 두 번 이어지면 60초 쉰다.
 * - 부담(한 시간): 구글 쓰기 ≤ 360 · 토스 시세 ≤ 360 · 환율 ≤ 60(`assetprice:test` 가 가짜 시계로 확인).
 * 스위치: `ASSET_PRICE_WRITE_ENABLED=true` 그리고 `ASSET_SYNC_ENABLED` · 시트 연결 정보 · 토스 키(모의 아님)일 때만.
 * ⚠️ 가격 · 코드를 로그에 찍지 않는다.
 */
import { sessionSpans } from '../heatmapSession';
import { assetSheetConfig, isAssetPriceWriteEnabled, isPriceWriteAllowed, isSheetConfigured } from './config';
import { AssetSheetError, batchGet, valuesWrite } from './google';
import { one, splitCode } from './sheet';
import { SHEET_LAYOUT, TICKER_TAB } from './sheetLayout';
import { isMockPrices, priceRows, priceSkipped, priceSource, priceTools, tryExclusive } from './priceState';

export const PRICE_TICK_MS = 10_000;
const RATE_TTL_MS = 60_000;
const BACKOFF_MS = 60_000;
/** 429 · 5xx 가 이만큼 이어지면 쉰다 */
const BACKOFF_AFTER = 2;

type Market = 'US' | 'KR';
const MARKETS: Market[] = ['US', 'KR'];
const P = SHEET_LAYOUT.prices;
const T = SHEET_LAYOUT.tickers;

const state = {
  /** 칸(E14 · C9) → 지난번에 쓴 값 */
  lastWritten: new Map<string, number>(),
  wasOpen: { US: false, KR: false } as Record<Market, boolean>,
  open: false,
  lastWrittenAt: null as string | null,
  backoffUntil: 0,
  googleFails: 0,
  codeChanged: new Set<number>(),
  /** 토스 가격이 없어 남았는데 이제 가격이 생긴 줄 */
  remaining: new Set<number>(),
  rate: null as { at: number; value: number | null } | null,
};

export function priceWriterStatus(): { lastWrittenAt: string | null; open: boolean; remaining: number; codeChanged: number[] } {
  return { lastWrittenAt: state.lastWrittenAt, open: state.open, remaining: state.remaining.size, codeChanged: [...state.codeChanged] };
}

/** [바꾸기] 가 방금 쓴 값 — 다음 회차에 같은 값을 다시 쓰지 않게 */
export function seedPriceWriter(values: Map<string, number>): void {
  for (const [cell, v] of values) state.lastWritten.set(cell, v);
  state.lastWrittenAt = new Date().toISOString();
  state.codeChanged.clear();
  state.remaining.clear();
}

/** 시험이 상태를 비운다 */
export function resetPriceWriterForTest(): void {
  state.lastWritten.clear();
  state.wasOpen = { US: false, KR: false };
  state.open = false;
  state.lastWrittenAt = null;
  state.backoffUntil = 0;
  state.googleFails = 0;
  state.codeChanged.clear();
  state.remaining.clear();
  state.rate = null;
}

async function rateAt(now: number): Promise<number | null> {
  if (state.rate && now - state.rate.at < RATE_TTL_MS) return state.rate.value;
  const value = await priceTools().rate();
  state.rate = { at: now, value };
  return value;
}

async function isOpen(market: Market, now: number): Promise<boolean> {
  const spans = await sessionSpans(market, now);
  return !!spans?.some((s) => s.start <= now && now < s.end);
}

const symbolOf = (code: string) => splitCode(code).symbol ?? code;
const marketOf = (code: string): Market => (splitCode(code).market === 'US' ? 'US' : 'KR');

export type PriceTickResult = 'off' | 'busy' | 'backoff' | 'closed' | 'unchanged' | 'written' | 'failed';

/** 한 회차 — 시험이 가짜 시계(now) · 가짜 달력 · 가짜 토스 · 가짜 구글로 부른다 */
export async function priceTick(now = Date.now()): Promise<PriceTickResult> {
  if (!isPriceWriteAllowed() || !isSheetConfigured() || isMockPrices() || priceSource() !== 'toss') {
    state.open = false;
    return 'off';
  }
  return (await tryExclusive(() => tick(now))) ?? 'busy';
}

async function tick(now: number): Promise<PriceTickResult> {
  if (now < state.backoffUntil) return 'backoff';
  const rows = priceRows();
  const pending = priceSkipped().filter((s) => s.reason === 'no-toss-price');
  const open = { US: false, KR: false } as Record<Market, boolean>;
  for (const m of MARKETS) {
    if (rows.some((r) => r.market === m) || pending.some((p) => marketOf(p.code) === m)) open[m] = await isOpen(m, now);
  }
  state.open = open.US || open.KR;
  // 열린 시장 + 방금 닫힌 시장(마지막 1번)
  const active = new Set(MARKETS.filter((m) => open[m] || state.wasOpen[m]));
  const settle = () => {
    state.wasOpen = { ...open };
  };
  if (active.size === 0) {
    settle();
    return 'closed';
  }

  const activeRows = rows.filter((r) => active.has(r.market));
  const activePending = pending.filter((p) => active.has(marketOf(p.code)));
  const symbols = [...new Set([...activeRows, ...activePending].map((r) => symbolOf(r.code)))];
  let prices: Map<string, number>;
  try {
    prices = symbols.length ? await priceTools().quotes(symbols) : new Map();
  } catch {
    console.warn('[asset] 시트 가격 쓰기 실패: 토스 시세');
    return 'failed';
  }
  for (const p of activePending) {
    if (prices.has(symbolOf(p.code))) state.remaining.add(p.row);
    else state.remaining.delete(p.row);
  }
  const needRate = activeRows.some((r) => r.market === 'US');
  const rate = needRate ? await rateAt(now) : null;

  const changedRows = activeRows.flatMap((r) => {
    const price = prices.get(symbolOf(r.code));
    const cell = `${P.priceColumn}${r.row}`;
    return price != null && state.lastWritten.get(cell) !== price ? [{ r, cell, value: price }] : [];
  });
  const writes: { cell: string; value: number }[] = [];
  if (rate != null && state.lastWritten.get(P.fxCell) !== rate) writes.push({ cell: P.fxCell, value: rate });

  const config = assetSheetConfig();
  if (!config) return 'off';
  try {
    if (changedRows.length > 0) {
      // 쓰기 전에 줄 코드 확인(사용자가 시트 줄을 옮겼으면 엉뚱한 줄에 쓰지 않는다)
      const [codes] = await batchGet(config, [`'${TICKER_TAB}'!${P.codeColumn}${T.firstRow}:${P.codeColumn}${T.lastRow}`], 'UNFORMATTED_VALUE');
      for (const c of changedRows) {
        const got = String(codes[c.r.row - T.firstRow]?.[0] ?? '').trim();
        if (got !== c.r.code) {
          if (!state.codeChanged.has(c.r.row)) console.warn(`[asset] 시트 가격 쓰지 않음 · ${c.r.row}행 줄 코드가 바뀜`);
          state.codeChanged.add(c.r.row);
          continue;
        }
        state.codeChanged.delete(c.r.row);
        writes.push({ cell: c.cell, value: c.value });
      }
    }
    if (writes.length === 0) {
      settle();
      return 'unchanged';
    }
    await valuesWrite(config, writes.map((w) => ({ range: one(TICKER_TAB, w.cell), value: w.value })));
    for (const w of writes) state.lastWritten.set(w.cell, w.value);
    state.lastWrittenAt = new Date(now).toISOString();
    state.googleFails = 0;
    settle();
    return 'written';
  } catch (e) {
    const err = e instanceof AssetSheetError ? e : null;
    const status = err?.status;
    if (status === 429 || (status != null && status >= 500)) {
      state.googleFails++;
      if (state.googleFails >= BACKOFF_AFTER) {
        state.backoffUntil = now + BACKOFF_MS;
        state.googleFails = 0;
      }
    }
    console.warn(`[asset] 시트 가격 쓰기 실패: ${err ? err.kind : '알 수 없는 오류'}${status ? ` ${status}` : ''}`);
    // 닫힌 시장의 마지막 1번은 다음 회차에 다시(wasOpen 을 그대로 둔다)
    return 'failed';
  }
}

let timer: ReturnType<typeof setInterval> | null = null;
let timerAllowed = true;
/** 시험이 실제 시계 예약을 막는다(회차는 가짜 시각으로 직접 부른다) */
export function setPriceTimerForTest(on: boolean): void {
  timerAllowed = on;
}

/** 상태를 따라 10초 예약을 켜거나 끈다 — 서버 시작 · [바꾸기] · [되돌리기] 뒤 */
export function syncPriceWriter(): void {
  const run = isPriceWriteAllowed() && isSheetConfigured() && !isMockPrices() && priceSource() === 'toss';
  if (run && !timer && timerAllowed) {
    timer = setInterval(() => void priceTick(), PRICE_TICK_MS);
  } else if (!run && timer) {
    clearInterval(timer);
    timer = null;
  }
  if (!run) {
    state.open = false;
    state.lastWritten.clear();
    state.wasOpen = { US: false, KR: false };
  }
}

/** 서버 시작 때 한 번 */
export function startAssetPriceWriter(): void {
  if (!isAssetPriceWriteEnabled()) {
    console.log('[asset] 시트 가격 쓰기를 하지 않습니다 (ASSET_PRICE_WRITE_ENABLED 꺼짐)');
    return;
  }
  syncPriceWriter();
}
