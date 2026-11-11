/**
 * 매수 · 매도 입력(v2.66.0) · 새 종목 매수 · 모두 매도(v2.67.0). **실제 주문은 없다** — 다른 증권사에서 사고판 것을 적어 시트를 갱신한다.
 *
 * - 검사 · 계산 · 쓰기 · 기록은 `recordTrade`(가진 종목) · `recordNewHolding`(새 종목). 줄 넣기 · 지우기는 `rowOps.ts`. 계산은 화면 미리 보기와 같은 함수(평균 `src/utils/assetAverage.ts` · 자릿수 `src/utils/assetTrade.ts`).
 * - 표 `asset_trades` — 선택 기능이라 이 파일에서 만든다. ⚠️ 개인 자산 정보다: 로그에는 id · 이유 종류만.
 * - G9(구매 평균 환율)는 쓰지 않는다 — 시트 「달러 환전」 탭이 계산한다(v2.66.2 · `fx` 를 보내면 400). 표의 `fx` · `fx_before` · `fx_after` 칸은 옛 기록 보존용(새 기록은 NULL).
 */
import { getDb } from '../db';
import { isAssetSyncEnabled, assetSheetConfig } from './config';
import { AssetSheetError, batchGet, valuesWrite, type CellRows, type CellWrite } from './google';
import { one, readAssetSheet, resetSheetCache } from './sheet';
import { HOLDINGS_TAB, SHEET_LAYOUT } from './sheetLayout';
import { addTossPriceRow, shiftPriceRowsForInsert } from './priceSheet';
import { isMockPrices, priceSource, priceTools, runOperation } from './priceState';
import { decideNewHolding, deleteHoldingRow, insertNewHolding, readGrid, type NewHoldingDecision, type StockInfo } from './rowOps';
import { findStock } from '../stockCatalog';
import { TRADE_DIGITS, TRADE_MAX, decimalPlaces } from '../../src/utils/assetTrade';
import { tradeAfter } from '../../src/utils/assetAverage';
import { isAssetClass, isUsPrefix } from '../../src/types/asset';
import type { AssetCurrency, AssetHolding, AssetNewHoldingPlan, AssetNewHoldingRequest, AssetNewHoldingResult, AssetNewHoldingTarget, AssetTradeRecord, AssetTradeRequest, AssetTradeResult, AssetTradesResponse, AssetTradeSide } from '../../src/types/asset';

let ready = false;
function db() {
  const database = getDb();
  if (!ready) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS asset_trades (
        id INTEGER PRIMARY KEY,
        at TEXT NOT NULL,               -- 입력 시각(ISO)
        section TEXT NOT NULL,          -- 계좌 key
        holding_row INTEGER NOT NULL,   -- 「주식 투자 정리」 줄 번호
        symbol TEXT NOT NULL,
        name TEXT NOT NULL,
        side TEXT NOT NULL,             -- buy | sell
        qty REAL NOT NULL,
        price REAL NOT NULL,            -- 원래 통화(국내 원 · 미국 달러)
        currency TEXT NOT NULL,         -- KRW | USD
        fx REAL,                        -- 옛 기록의 넣은 환율(v2.66.2 부터 NULL)
        before_qty REAL NOT NULL,
        before_avg REAL NOT NULL,
        after_qty REAL NOT NULL,
        after_avg REAL NOT NULL,
        fx_before REAL,                 -- 옛 기록(v2.66.2 부터 NULL)
        fx_after REAL,
        new_row INTEGER NOT NULL DEFAULT 0,     -- 시트에 보유 줄을 넣은 매수(v2.67.0)
        deleted_row INTEGER NOT NULL DEFAULT 0  -- 모두 매도로 보유 줄을 지움(v2.67.0)
      );
    `);
    // 선택 기능 표라 칸도 여기서 더한다(CREATE TABLE IF NOT EXISTS 는 있는 표를 바꾸지 않는다)
    const columns = new Set((database.prepare(`PRAGMA table_info(asset_trades)`).all() as { name: string }[]).map((c) => c.name));
    for (const name of ['new_row', 'deleted_row']) if (!columns.has(name)) database.exec(`ALTER TABLE asset_trades ADD COLUMN ${name} INTEGER NOT NULL DEFAULT 0`);
    ready = true;
  }
  return database;
}

interface TradeRow {
  id: number; at: string; section: string; holding_row: number; symbol: string; name: string; side: AssetTradeSide; qty: number; price: number;
  currency: 'KRW' | 'USD'; fx: number | null; before_qty: number; before_avg: number; after_qty: number; after_avg: number; fx_before: number | null; fx_after: number | null;
}

const TRADES_DEFAULT = 50;
const TRADES_MAX = 1000;

/** 기록 목록 — 최근 순 */
export function listTrades(limit: unknown): AssetTradesResponse {
  const n = typeof limit === 'string' && /^\d+$/.test(limit) ? Number(limit) : TRADES_DEFAULT;
  const take = Math.min(TRADES_MAX, Math.max(1, n));
  const rows = db().prepare(`SELECT * FROM asset_trades ORDER BY id DESC LIMIT ?`).all(take + 1) as TradeRow[];
  const trades: AssetTradeRecord[] = rows.slice(0, take).map((r) => ({
    id: r.id, at: r.at, section: r.section, holdingRow: r.holding_row, symbol: r.symbol, name: r.name, side: r.side, qty: r.qty, price: r.price, currency: r.currency, fx: r.fx,
    beforeQty: r.before_qty, beforeAvg: r.before_avg, afterQty: r.after_qty, afterAvg: r.after_avg, fxBefore: r.fx_before, fxAfter: r.fx_after,
  }));
  return { trades, hasMore: rows.length > take };
}

/** 「무엇 때문에」 계산(v2.70.0 · `dailyChange.ts`)이 쓰는 칸만 — 모든 기록(입력 순) · 읽기만 */
export function tradesForChange(): { at: string; section: string; symbol: string; side: AssetTradeSide; qty: number; price: number; currency: 'KRW' | 'USD' }[] {
  return db().prepare(`SELECT at, section, symbol, side, qty, price, currency FROM asset_trades ORDER BY id`).all() as ReturnType<typeof tradesForChange>;
}

/** 시험이 비운다 */
export const clearTradesForTest = (): void => void db().prepare(`DELETE FROM asset_trades`).run();

const refuse = (message: string) => new AssetSheetError('not-editable', message);
const positive = (v: unknown, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= max;
const sameNum = (a: number, b: number) => Math.abs(a - b) < 1e-9;

/** 요청 모양 검사(숫자 · 범위) — 시장에 따른 자릿수는 줄을 읽은 뒤 */
function parseRequest(input: unknown): AssetTradeRequest {
  const o = (input && typeof input === 'object' && !Array.isArray(input) ? input : {}) as Record<string, unknown>;
  const e = (o.expect && typeof o.expect === 'object' ? o.expect : {}) as Record<string, unknown>;
  if ('fx' in o) throw refuse('환율은 받지 않습니다 — 시트 「달러 환전」 탭이 계산합니다.');
  if (
    typeof o.section !== 'string' || typeof o.row !== 'number' || !Number.isInteger(o.row) || o.row < 1 || (o.side !== 'buy' && o.side !== 'sell') ||
    !positive(o.qty, TRADE_MAX.qty) || !positive(o.price, TRADE_MAX.price) ||
    typeof e.name !== 'string' || typeof e.code !== 'string' || typeof e.quantity !== 'number' || typeof e.avgPrice !== 'number'
  ) {
    throw refuse('입력이 올바르지 않습니다 — 수량 · 가격은 0 보다 커야 합니다.');
  }
  return { section: o.section, row: o.row, side: o.side, qty: o.qty as number, price: o.price as number, expect: { name: e.name, code: e.code, quantity: e.quantity, avgPrice: e.avgPrice } };
}

/** 시트의 그 줄이 화면이 본 것과 같은가 */
function sameAsSeen(h: AssetHolding | undefined, seen: AssetTradeRequest['expect']): h is AssetHolding {
  return h != null && h.name === seen.name && h.code === seen.code && h.quantity != null && sameNum(h.quantity, seen.quantity) && h.avgPrice != null && sameNum(h.avgPrice, seen.avgPrice);
}

/**
 * 화면이 본 줄의 지금 자리(v2.66.2 — 시트에 줄이 늘거나 줄어도 맞는 줄에 쓴다) — 그 줄 번호가 그대로면 그 줄 ·
 * 아니면 같은 계좌에서 이름 · 코드 · 수량 · 평균가가 모두 같은 줄이 **하나일 때만** 그 줄.
 */
function seenRow(holdings: AssetHolding[], req: AssetTradeRequest): AssetHolding | undefined {
  const at = holdings.find((x) => x.row === req.row);
  if (sameAsSeen(at, req.expect)) return at;
  const same = holdings.filter((x) => sameAsSeen(x, req.expect));
  return same.length === 1 ? same[0] : undefined;
}

let busy = false;

/** 같은 서버에서 동시에 두 건이 같은 수량을 읽고 쓰지 않게 — 입력 한 건씩 */
async function oneAtATime<T>(fn: () => Promise<T>): Promise<T> {
  if (busy) throw new AssetSheetError('busy', '다른 입력을 저장하는 중입니다 — 잠시 후 다시 시도해 주세요.');
  busy = true;
  try {
    return await fn();
  } finally {
    busy = false;
  }
}

function writableConfig() {
  if (!isAssetSyncEnabled()) throw new AssetSheetError('disabled', '이 서버에서는 시트 쓰기가 꺼져 있습니다(ASSET_SYNC_ENABLED=false).');
  const config = assetSheetConfig();
  if (!config) throw new AssetSheetError('not-configured', '시트 연결 정보가 없습니다(`.env`).');
  return config;
}

/** 자릿수 검사 — 시장마다 */
function checkDigits(currency: AssetCurrency, qty: number, price: number): void {
  const digits = TRADE_DIGITS[currency];
  if (decimalPlaces(qty) > digits.qty) throw refuse(digits.qty === 0 ? '국내 종목 수량은 정수만 넣을 수 있습니다.' : `미국 종목 수량은 소수 ${digits.qty}자리까지 넣을 수 있습니다.`);
  if (decimalPlaces(price) > digits.price) throw refuse(digits.price === 0 ? '국내 종목 가격은 원 단위 정수만 넣을 수 있습니다.' : `미국 종목 가격은 소수 ${digits.price}자리까지 넣을 수 있습니다.`);
}

interface TradeLine {
  section: string; holdingRow: number; symbol: string; name: string; side: AssetTradeSide; qty: number; price: number; currency: AssetCurrency;
  beforeQty: number; beforeAvg: number; afterQty: number; afterAvg: number; newRow?: boolean; deletedRow?: boolean;
}

/** 기록 한 줄 — 시트 쓰기가 확인된 뒤에만 부른다. ⚠️ 로그에는 id 만 */
function saveTrade(t: TradeLine): number {
  const res = db()
    .prepare(`INSERT INTO asset_trades (at, section, holding_row, symbol, name, side, qty, price, currency, before_qty, before_avg, after_qty, after_avg, new_row, deleted_row) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(new Date().toISOString(), t.section, t.holdingRow, t.symbol, t.name, t.side, t.qty, t.price, t.currency, t.beforeQty, t.beforeAvg, t.afterQty, t.afterAvg, t.newRow ? 1 : 0, t.deletedRow ? 1 : 0);
  const id = Number(res.lastInsertRowid);
  console.log(`[asset] 매수·매도 기록 id=${id}`);
  return id;
}

/** 가진 줄의 수량 · 평균가 쓰기 — `valuesWrite` **한 요청** → 쓴 칸을 다시 읽어 확인(다르면 `mismatch`) → 그때만 기록 */
async function applyTrade(config: NonNullable<ReturnType<typeof assetSheetConfig>>, section: string, h: AssetHolding, side: AssetTradeSide, qty: number, price: number): Promise<number> {
  if (!h.tradable) throw new AssetSheetError('formula-cell', '이 줄은 평균가 · 수량 칸 모양이 달라 입력할 수 없습니다(수식을 덮어쓰지 않습니다).');
  const beforeQty = h.quantity as number;
  const beforeAvg = h.avgPrice as number;
  const { afterQty, afterAvg } = tradeAfter({ side, currency: h.currency, beforeQty, beforeAvg, qty, price });

  const avgCell = one(HOLDINGS_TAB, `C${h.row}`);
  const qtyCell = one(HOLDINGS_TAB, `D${h.row}`);
  const cells: CellWrite[] = [{ range: qtyCell, value: afterQty }];
  if (side === 'buy') cells.push({ range: avgCell, value: h.currency === 'USD' ? usdFormulaWith(h.avgFormula as string, afterAvg) : afterAvg });
  // 미국 평균가 칸은 수식이라 USER_ENTERED(「=」 그대로 수식) · 나머지(국내 매수 · 모든 매도)는 숫자만이라 RAW
  await valuesWrite(config, cells, side === 'buy' && h.currency === 'USD' ? 'USER_ENTERED' : 'RAW');
  resetSheetCache();

  const back: CellRows[] = await batchGet(config, cells.map((c) => c.range), 'FORMULA');
  const sameCell = (i: number) => {
    const got = back[i]?.[0]?.[0];
    const want = cells[i].value;
    if (typeof want === 'number') return typeof got === 'number' && sameNum(got, want);
    const g = typeof got === 'string' ? got.trim().match(SHEET_LAYOUT.usdFormula) : null;
    return g != null && sameNum(Number(g[1]), afterAvg);
  };
  if (!cells.every((_, i) => sameCell(i))) throw new AssetSheetError('mismatch', '시트에 쓴 값이 다르게 읽혔습니다(시트를 열어 그 줄을 확인하세요) — 기록은 남기지 않았습니다.');

  return saveTrade({ section, holdingRow: h.row, symbol: h.symbol ?? '', name: h.name, side, qty, price, currency: h.currency, beforeQty, beforeAvg, afterQty, afterAvg });
}

/**
 * 가진 종목의 매수 · 일부 매도 · 모두 매도 한 건. 순서:
 * ① 스위치 · 요청 모양 ② 시트를 값 · 수식으로 다시 읽음(머리 글자 확인 포함 · 모두 매도면 모든 탭의 수식까지) ③ 화면이 본 이름 · 코드 · 수량 · 평균가와 비교(다르면 409 `sheet-changed`)
 * ④ 입력 검사(자릿수 · 매도 수량) ⑤ 모두 매도면 보유 줄을 지우고(`deleteHoldingRow` — 「티커」 줄은 남김) · 아니면 계산 뒤 `applyTrade` ⑥ 시트 확인 뒤에만 `asset_trades` 한 줄.
 */
export async function recordTrade(input: unknown): Promise<AssetTradeResult> {
  if (!isAssetSyncEnabled()) throw new AssetSheetError('disabled', '이 서버에서는 시트 쓰기가 꺼져 있습니다(ASSET_SYNC_ENABLED=false).');
  const req = parseRequest(input);
  const config = writableConfig();
  if (!SHEET_LAYOUT.sections.some((s) => 'key' in s && s.key === req.section)) throw refuse('이 줄에는 매수 · 매도를 입력할 수 없습니다.');
  return oneAtATime(async () => {
    resetSheetCache();
    // 화면이 본 수량을 모두 판다면 — 시트가 그대로일 때만 모두 매도가 된다(`seenRow`)
    const grid = req.side === 'sell' && sameNum(req.qty, req.expect.quantity) ? await readGrid(config, true) : null;
    const data = grid ? grid.data : await readAssetSheet();
    const h = seenRow(data.sections.find((s) => !s.combined && s.key === req.section)?.holdings ?? [], req);
    if (!h) throw new AssetSheetError('sheet-changed', '시트가 바뀌었어요 — 다시 열어 주세요.');
    if (!h.tradable) throw new AssetSheetError('formula-cell', '이 줄은 평균가 · 수량 칸 모양이 달라 입력할 수 없습니다(수식을 덮어쓰지 않습니다).');
    const beforeQty = h.quantity as number;
    const beforeAvg = h.avgPrice as number;
    checkDigits(h.currency, req.qty, req.price);
    if (req.side === 'sell' && req.qty > beforeQty && !sameNum(req.qty, beforeQty)) throw refuse('매도 수량이 가진 수량보다 많습니다.');
    if (grid && sameNum(req.qty, beforeQty)) {
      await deleteHoldingRow(config, grid, req.section, h);
      resetSheetCache();
      const id = saveTrade({ section: req.section, holdingRow: h.row, symbol: h.symbol ?? '', name: h.name, side: 'sell', qty: req.qty, price: req.price, currency: h.currency, beforeQty, beforeAvg, afterQty: 0, afterAvg: beforeAvg, deletedRow: true });
      return { id };
    }
    return { id: await applyTrade(config, req.section, h, req.side, req.qty, req.price) };
  });
}

/** 종목 목록의 시장 → 국내 / 미국 */
const US_LISTINGS = new Set(['NASDAQ', 'NYSE', 'AMEX']);
const KR_LISTINGS = new Set(['KOSPI', 'KOSDAQ']);

function catalogStock(symbol: string): StockInfo {
  const found = findStock(symbol);
  const market = found ? (US_LISTINGS.has(found.market) ? 'US' : KR_LISTINGS.has(found.market) ? 'KR' : null) : null;
  if (!found || !market) throw refuse('종목 목록에 없는 코드입니다 — 검색에서 골라 주세요.');
  return { symbol: found.symbol, name: found.name, market, listing: found.market, currency: market === 'US' ? 'USD' : 'KRW' };
}

/** 계좌 · 종목 · 미국 앞부분 모양 */
function parseTarget(o: Record<string, unknown>): AssetNewHoldingTarget {
  if (typeof o.section !== 'string' || typeof o.symbol !== 'string' || !/^[A-Za-z0-9.-]{1,20}$/.test(o.symbol)) throw refuse('계좌 · 종목이 올바르지 않습니다.');
  if (o.exchange != null && !isUsPrefix(o.exchange)) throw refuse('미국 코드 앞부분이 올바르지 않습니다.');
  return { section: o.section, symbol: o.symbol, exchange: isUsPrefix(o.exchange) ? o.exchange : null };
}

const asObject = (input: unknown) => (input && typeof input === 'object' && !Array.isArray(input) ? input : {}) as Record<string, unknown>;

function parseNewRequest(input: unknown): AssetNewHoldingRequest {
  const o = asObject(input);
  if ('fx' in o) throw refuse('환율은 받지 않습니다 — 시트 「달러 환전」 탭이 계산합니다.');
  const target = parseTarget(o);
  if (!positive(o.qty, TRADE_MAX.qty) || !positive(o.price, TRADE_MAX.price)) throw refuse('입력이 올바르지 않습니다 — 수량 · 가격은 0 보다 커야 합니다.');
  if (o.assetClass !== '' && !isAssetClass(o.assetClass)) throw refuse('자산 분류는 미지정 · 채권 · 금 · 주식 중 하나여야 합니다.');
  return { ...target, qty: o.qty, price: o.price, assetClass: o.assetClass as AssetNewHoldingRequest['assetClass'] };
}

const noticeOf = (section: string) => (section === SHEET_LAYOUT.combinedFrom ? '합친 표 「적립식 주식」 은 직접 고쳐 주세요.' : null);

function planOf(req: AssetNewHoldingTarget, d: NewHoldingDecision): AssetNewHoldingPlan {
  return {
    section: req.section,
    name: d.stock.name,
    symbol: d.stock.symbol,
    market: d.stock.market,
    currency: d.stock.currency,
    code: d.code,
    prefix: d.prefix,
    prefixEditable: d.stock.market === 'US' && d.ticker.status !== 'existing' && d.existing == null,
    ticker: { group: d.group, row: d.ticker.row, status: d.ticker.status },
    existing: d.existing ? { row: d.existing.row, quantity: d.existing.quantity, avgPrice: d.existing.avgPrice } : null,
    notice: d.existing ? null : noticeOf(req.section),
  };
}

/** 새 종목을 어디에 쓸지(확인 화면) — 시트를 읽기만 한다 */
export async function planNewHolding(input: unknown): Promise<AssetNewHoldingPlan> {
  const config = writableConfig();
  const req = parseTarget(asObject(input));
  const grid = await readGrid(config);
  return planOf(req, decideNewHolding(grid, req.section, catalogStock(req.symbol), req.exchange));
}

/** 시트 가격이 토스인 때 새 줄에 쓸 가격 — 못 받으면 아무것도 쓰지 않고 멈춘다 */
async function tossPriceOf(d: NewHoldingDecision): Promise<number | null> {
  if (d.ticker.status === 'existing' || priceSource() !== 'toss') return null;
  if (isMockPrices()) throw new AssetSheetError('disabled', '토스 키가 없어(모의 데이터 모드) 시트 가격 칸을 쓸 수 없습니다.');
  const price = await priceTools().quotes([d.stock.symbol]).then((m) => m.get(d.stock.symbol) ?? null).catch(() => null);
  if (price == null) throw new AssetSheetError('network', '토스 가격을 받지 못해 쓰지 않았습니다(잠시 뒤 다시 시도해 주세요).');
  return price;
}

/**
 * 새 종목 매수 한 건. 순서:
 * ① 스위치 · 요청 모양 · 종목 · 자릿수 ② 입력 한 건씩 + 시트 가격 쓰기와 겹치지 않게(줄이 옮겨지는 사이 10초 쓰기가 엉뚱한 줄에 쓰지 않게)
 * ③ 시트를 다시 읽어 구간을 찾고 어디에 쓸지 정함 ④ 그 계좌에 같은 종목이 있으면 매수로 처리(`applyTrade`) ⑤ 아니면 `insertNewHolding`(단계마다 실패하면 되돌림)
 * ⑥ 시트 확인 뒤 기록 · 시트 가격 기록을 한 트랜잭션으로(실패하면 시트도 되돌린다).
 */
export async function recordNewHolding(input: unknown): Promise<AssetNewHoldingResult> {
  const config = writableConfig();
  const req = parseNewRequest(input);
  const stock = catalogStock(req.symbol);
  checkDigits(stock.currency, req.qty, req.price);
  return oneAtATime(async () => {
    const op = await runOperation(async (): Promise<AssetNewHoldingResult> => {
      resetSheetCache();
      const grid = await readGrid(config);
      const d = decideNewHolding(grid, req.section, stock, req.exchange);
      if (d.existing) return { id: await applyTrade(config, req.section, d.existing, 'buy', req.qty, req.price), mode: 'buy', notice: null };
      const tossPrice = await tossPriceOf(d);
      const { committed } = await insertNewHolding(config, grid, d, { qty: req.qty, price: req.price, assetClass: req.assetClass, tossPrice }, (done) =>
        getDb().transaction(() => {
          if (done.tickerInserted != null) shiftPriceRowsForInsert(done.tickerInserted);
          if (tossPrice != null && done.tickerWritten) addTossPriceRow(done.tickerRow, d.code, stock.market, stock.name);
          return saveTrade({ section: req.section, holdingRow: done.holdingRow, symbol: stock.symbol, name: stock.name, side: 'buy', qty: req.qty, price: req.price, currency: stock.currency, beforeQty: 0, beforeAvg: 0, afterQty: req.qty, afterAvg: req.price, newRow: true });
        })(),
      );
      resetSheetCache();
      return { id: committed, mode: 'new', notice: noticeOf(req.section) };
    });
    if (!op.ok) throw new AssetSheetError('busy', '시트 가격 바꾸기 · 되돌리기가 도는 중입니다 — 잠시 후 다시 시도해 주세요.');
    return op.value;
  });
}

/** `=(옛 달러)*('티커'!$G$9)` — 수식 모양은 그대로 숫자만 바꾼 글자 */
function usdFormulaWith(formula: string, dollars: number): string {
  return formula.replace(/-?[0-9]+(?:\.[0-9]+)?/, () => String(dollars));
}
