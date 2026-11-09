/**
 * 매수 · 매도 입력(v2.66.0 · 1차 — 시트에 줄이 있는 종목의 매수 · 일부 매도). **실제 주문은 없다** — 다른 증권사에서 사고판 것을 적어 시트 수량 · 평균가를 갱신한다.
 *
 * - 검사 · 계산 · 쓰기 · 기록은 `recordTrade` 한 곳. 계산은 화면 미리 보기와 같은 함수(`src/utils/assetTrade.ts`).
 * - 표 `asset_trades` — 선택 기능이라 이 파일에서 만든다. ⚠️ 개인 자산 정보다: 로그에는 id · 이유 종류만.
 * - G9(구매 평균 환율)가 **수식이면 쓰지 않는다**(409 `formula-cell` — 시트의 수식을 덮어쓰지 않는다는 다른 쓰기와 같은 규칙).
 */
import { getDb } from '../db';
import { isAssetSyncEnabled, assetSheetConfig } from './config';
import { AssetSheetError, batchGet, valuesWrite, type CellRows, type CellWrite } from './google';
import { one, readAssetSheet, resetSheetCache } from './sheet';
import { HOLDINGS_TAB, SHEET_LAYOUT, type HoldingSection } from './sheetLayout';
import { TRADE_DIGITS, TRADE_MAX, decimalPlaces, nextAvgFx, tradeAfter, usdCostOf } from '../../src/utils/assetTrade';
import type { AssetHolding, AssetTradeRecord, AssetTradeRequest, AssetTradeResult, AssetTradesResponse, AssetTradeSide } from '../../src/types/asset';

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
        fx REAL,                        -- 넣은 환율(미국 매수에서만 · 비우면 NULL)
        before_qty REAL NOT NULL,
        before_avg REAL NOT NULL,
        after_qty REAL NOT NULL,
        after_avg REAL NOT NULL,
        fx_before REAL,                 -- G9 를 바꿨을 때만
        fx_after REAL
      );
    `);
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

/** 시험이 비운다 */
export const clearTradesForTest = (): void => void db().prepare(`DELETE FROM asset_trades`).run();

const refuse = (message: string) => new AssetSheetError('not-editable', message);
const positive = (v: unknown, max: number): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= max;
const sameNum = (a: number, b: number) => Math.abs(a - b) < 1e-9;

/** 요청 모양 검사(숫자 · 범위) — 시장에 따른 자릿수는 줄을 읽은 뒤 */
function parseRequest(input: unknown): AssetTradeRequest {
  const o = (input && typeof input === 'object' && !Array.isArray(input) ? input : {}) as Record<string, unknown>;
  const e = (o.expect && typeof o.expect === 'object' ? o.expect : {}) as Record<string, unknown>;
  const fx = o.fx == null ? null : o.fx;
  if (
    typeof o.section !== 'string' || typeof o.row !== 'number' || !Number.isInteger(o.row) || (o.side !== 'buy' && o.side !== 'sell') ||
    !positive(o.qty, TRADE_MAX.qty) || !positive(o.price, TRADE_MAX.price) || (fx !== null && !positive(fx, TRADE_MAX.fx)) ||
    typeof e.name !== 'string' || typeof e.code !== 'string' || typeof e.quantity !== 'number' || typeof e.avgPrice !== 'number'
  ) {
    throw refuse('입력이 올바르지 않습니다 — 수량 · 가격은 0 보다 커야 합니다.');
  }
  return { section: o.section, row: o.row, side: o.side, qty: o.qty as number, price: o.price as number, fx: fx as number | null, expect: { name: e.name, code: e.code, quantity: e.quantity, avgPrice: e.avgPrice } };
}

/** 시트의 그 줄이 화면이 본 것과 같은가 */
function sameAsSeen(h: AssetHolding | undefined, seen: AssetTradeRequest['expect']): h is AssetHolding {
  return h != null && h.name === seen.name && h.code === seen.code && h.quantity != null && sameNum(h.quantity, seen.quantity) && h.avgPrice != null && sameNum(h.avgPrice, seen.avgPrice);
}

let busy = false;

/**
 * 매수 · 일부 매도 한 건. 순서:
 * ① 스위치 · 요청 모양 ② 시트를 값 · 수식으로 다시 읽음(머리 글자 확인 포함) ③ 화면이 본 이름 · 코드 · 수량 · 평균가와 비교(다르면 409 `sheet-changed`)
 * ④ 입력 검사(자릿수 · 매도 수량 · 환율) ⑤ 계산 ⑥ `valuesWrite` **한 요청** ⑦ 쓴 칸을 다시 읽어 확인(다르면 `mismatch`) ⑧ 그때만 `asset_trades` 한 줄.
 */
export async function recordTrade(input: unknown): Promise<AssetTradeResult> {
  if (!isAssetSyncEnabled()) throw new AssetSheetError('disabled', '이 서버에서는 시트 쓰기가 꺼져 있습니다(ASSET_SYNC_ENABLED=false).');
  const req = parseRequest(input);
  const config = assetSheetConfig();
  if (!config) throw new AssetSheetError('not-configured', '시트 연결 정보가 없습니다(`.env`).');
  const layout = SHEET_LAYOUT.sections.find((s: HoldingSection) => s.key === req.section && !s.combined);
  if (!layout || req.row < layout.firstRow || req.row > layout.lastRow) throw refuse('이 줄에는 매수 · 매도를 입력할 수 없습니다.');
  // 같은 서버에서 동시에 두 건이 같은 수량을 읽고 쓰지 않게
  if (busy) throw new AssetSheetError('busy', '다른 입력을 저장하는 중입니다 — 잠시 후 다시 시도해 주세요.');
  busy = true;
  try {
    resetSheetCache();
    const data = await readAssetSheet();
    const h = data.sections.find((s) => !s.combined && s.key === req.section)?.holdings.find((x) => x.row === req.row);
    if (!sameAsSeen(h, req.expect)) throw new AssetSheetError('sheet-changed', '시트가 바뀌었어요 — 다시 열어 주세요.');
    if (!h.tradable) throw new AssetSheetError('formula-cell', '이 줄은 평균가 · 수량 칸 모양이 달라 입력할 수 없습니다(수식을 덮어쓰지 않습니다).');
    const beforeQty = h.quantity as number;
    const beforeAvg = h.avgPrice as number;
    const digits = TRADE_DIGITS[h.currency];
    if (decimalPlaces(req.qty) > digits.qty) throw refuse(digits.qty === 0 ? '국내 종목 수량은 정수만 넣을 수 있습니다.' : `미국 종목 수량은 소수 ${digits.qty}자리까지 넣을 수 있습니다.`);
    if (decimalPlaces(req.price) > digits.price) throw refuse(digits.price === 0 ? '국내 종목 가격은 원 단위 정수만 넣을 수 있습니다.' : `미국 종목 가격은 소수 ${digits.price}자리까지 넣을 수 있습니다.`);
    if (req.side === 'sell') {
      if (req.qty > beforeQty && !sameNum(req.qty, beforeQty)) throw refuse('매도 수량이 가진 수량보다 많습니다.');
      if (sameNum(req.qty, beforeQty)) throw new AssetSheetError('sell-all-later', '모두 파는 것은 다음 업데이트에서 돼요.');
    }
    const fx = req.fx ?? null;
    if (fx != null && (h.currency !== 'USD' || req.side !== 'buy')) throw refuse('환율은 미국 종목 매수에서만 넣을 수 있습니다.');
    if (fx != null && data.avgFxFormula) throw new AssetSheetError('formula-cell', '구매 평균 환율 칸이 수식이라 쓰지 않았습니다 — 환율을 비우고 저장해 주세요.');
    if (fx != null && data.avgFxRate == null) throw refuse('구매 평균 환율 칸이 숫자가 아니라 환율을 넣을 수 없습니다 — 환율을 비우고 저장해 주세요.');

    const { afterQty, afterAvg } = tradeAfter({ side: req.side, currency: h.currency, beforeQty, beforeAvg, qty: req.qty, price: req.price });
    const fxBefore = fx != null ? (data.avgFxRate as number) : null;
    const fxAfter = fx != null ? nextAvgFx(fxBefore as number, usdCostOf(data.sections), fx, req.qty * req.price) : null;

    const avgCell = one(HOLDINGS_TAB, `C${h.row}`);
    const qtyCell = one(HOLDINGS_TAB, `D${h.row}`);
    const fxCell = one(SHEET_LAYOUT.cells.avgFxRate.tab, SHEET_LAYOUT.cells.avgFxRate.cell);
    const cells: CellWrite[] = [{ range: qtyCell, value: afterQty }];
    if (req.side === 'buy') cells.push({ range: avgCell, value: h.currency === 'USD' ? usdFormulaWith(h.avgFormula as string, afterAvg) : afterAvg });
    if (fxAfter != null) cells.push({ range: fxCell, value: fxAfter });
    // 미국 평균가 칸은 수식이라 USER_ENTERED(「=」 그대로 수식) · 나머지(국내 매수 · 모든 매도)는 숫자만이라 RAW
    await valuesWrite(config, cells, req.side === 'buy' && h.currency === 'USD' ? 'USER_ENTERED' : 'RAW');
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

    const res = db()
      .prepare(`INSERT INTO asset_trades (at, section, holding_row, symbol, name, side, qty, price, currency, fx, before_qty, before_avg, after_qty, after_avg, fx_before, fx_after) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(new Date().toISOString(), req.section, h.row, h.symbol ?? '', h.name, req.side, req.qty, req.price, h.currency, fx, beforeQty, beforeAvg, afterQty, afterAvg, fxBefore, fxAfter);
    const id = Number(res.lastInsertRowid);
    console.log(`[asset] 매수·매도 기록 id=${id}`);
    return { id };
  } finally {
    busy = false;
  }
}

/** `=(옛 달러)*('티커'!$G$9)` — 수식 모양은 그대로 숫자만 바꾼 글자 */
function usdFormulaWith(formula: string, dollars: number): string {
  return formula.replace(/-?[0-9]+(?:\.[0-9]+)?/, () => String(dollars));
}
