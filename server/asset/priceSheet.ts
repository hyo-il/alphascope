/**
 * 시트 가격 [바꾸기] · [되돌리기](v2.65.0 · 자산 관리 2단계) — 「티커」 가격(E) · 환율(C9)을 시트의 GOOGLEFINANCE 에서 토스 숫자로 바꾸고,
 * 원화 표기(F) 수식을 국내 `=E행` / 미국 `=E행*$C$9` 로 바꾼다. 칸 주소 · 모양은 `sheetLayout.ts` `prices` 한 곳.
 *
 * - 스위치: `ASSET_PRICE_WRITE_ENABLED=true` **그리고** `ASSET_SYNC_ENABLED` 가 켜졌을 때만(`isPriceWriteAllowed` — 맥 기본 꺼짐 · 오라클에서만 켬).
 * - [바꾸기](`convertSheetPrices`): 머리 글자 → C9 · 종목 줄 B~F 를 수식 그대로 읽기 → 토스 시세 1번 · 환율 1번 → 바꿀 줄
 *   (E 가 GOOGLEFINANCE 가격 수식 · F 가 E행 / E행 × 환율로 읽힘 · 토스 가격 있음) → **원래 수식을 `asset_sheet_backup` 에 먼저 저장**(실패면 쓰지 않음)
 *   → C9 · 바꿀 줄 E · F 를 **한 요청**(`USER_ENTERED`) → 다시 읽어 확인. 바꾸지 않은 줄은 이유와 함께 목록(화면에만 이름 · 코드).
 *   이미 토스면 GOOGLEFINANCE 로 남은 줄 중 토스 가격이 생긴 줄만 더 바꾼다(「남은 종목도 토스로 바꾸기」).
 * - [되돌리기](`restoreSheetPrices`): 백업의 칸마다 바꿀 때 코드로 **지금 그 코드의 줄**을 찾아(`locateRow` · v2.66.2 — 수식 안의 줄 번호도 그 줄로) + C9 를 한 요청(`USER_ENTERED`)
 *   → 다시 읽어 같으면 그 칸 백업을 지움 · 다르면 백업을 남기고 오류. 코드를 시트에서 못 찾았거나(또는 같은 코드 두 줄) 쓰지 않은 줄은 백업 · 「줄이 옮겨짐 — 직접 확인」 목록으로 남긴다.
 * - G · H · I열과 그 밖 칸은 쓰지 않는다. 구글에 쓰는 함수는 `google.ts` `valuesWrite` 하나.
 * ⚠️ 로그에는 줄 번호 · 이유 종류만(가격 · 코드 · 이름 · 수식 없음).
 */
import { isPriceWriteAllowed, assetSheetConfig } from './config';
import { AssetSheetError, batchGet, valuesWrite, type CellRows } from './google';
import { headerOk, one, resetSheetCache, splitCode, tickerRowCode, wideRange } from './sheet';
import { SHEET_LAYOUT, TICKER_TAB } from './sheetLayout';
import { findTickerGroups, locateRow, tickerRowsOf, type ShapeTicker } from './sheetShape';
import { archivedBackup, clearSheetBackup, deleteSheetBackupCells, replaceSheetBackupCells, saveSheetBackup, sheetBackup } from './store';
import { isMockPrices, priceMoved, priceRows, priceSkipped, priceSource, priceTools, runOperation, savePriceState, type PriceRow } from './priceState';
import { priceWriterStatus, seedPriceWriter, syncPriceWriter } from './priceWriter';
import type { AssetPriceMoved, AssetPriceSheetStatus, AssetPriceSkip, AssetPriceSkipReason } from '../../src/types/asset';

type Cell = string | number | boolean | undefined;
const P = SHEET_LAYOUT.prices;

/** 수식 비교용 — 빈칸 · `$` 를 빼고 대문자 */
const norm = (v: Cell) => String(v ?? '').replace(/[\s$]+/g, '').toUpperCase();
const isFormula = (v: Cell) => typeof v === 'string' && v.trim().startsWith('=');
const fx = norm(P.fxCell);

/** 바꾼 뒤 F 수식 — 국내 `=E행` / 미국 `=E행*$C$9` */
export const wonFormula = (row: number, market: 'US' | 'KR') => {
  const abs = P.fxCell.replace(/^([A-Z]+)(\d+)$/, '$$$1$$$2');
  return market === 'US' ? `=${P.priceColumn}${row}*${abs}` : `=${P.priceColumn}${row}`;
};

/** 「티커」 한 종목 줄 — B 이름 · C 코드 · E 가격 칸 · F 원화 표기 칸(수식 그대로 읽은 것) */
export interface TickerLine {
  row: number;
  name: string;
  code: string;
  e: Cell;
  f: Cell;
}

/**
 * 한 줄의 처지 — `convert`(바꿀 줄) · `done`(이미 토스 — E 숫자 · F 가 바꾼 뒤 모양) · 그 밖은 바꾸지 않는 이유.
 * 순수 함수(시험이 부른다). 토스 가격은 바꿀 수 있는 모양일 때만 본다(모양이 다르면 그 이유가 먼저).
 */
export function classifyLine(line: TickerLine, hasPrice: boolean): 'convert' | 'done' | Exclude<AssetPriceSkipReason, 'code-changed'> {
  const { market } = splitCode(line.code);
  const target = norm(wonFormula(line.row, market as 'US' | 'KR'));
  if (typeof line.e === 'number' && norm(line.f) === target) return 'done';
  const m = typeof line.e === 'string' ? line.e.trim().match(P.priceFormula) : null;
  if (!m) return 'price-shape';
  const arg = norm(m[1]);
  // 첫 인자 = 그 줄의 코드 칸(C행) 또는 그 코드 글자
  if (arg !== `${P.codeColumn}${line.row}` && arg !== `"${line.code.toUpperCase()}"`) return 'price-shape';
  const e = `${P.priceColumn}${line.row}`;
  const gf = `GOOGLEFINANCE(${arg},"PRICE")`;
  const ok = market === 'US' ? [`=${e}*${fx}`, `=${fx}*${e}`, `=${gf}*${fx}`, `=${fx}*${gf}`] : [`=${e}`, `=${gf}`];
  if (!ok.includes(norm(line.f))) return 'won-shape';
  return hasPrice ? 'convert' : 'no-toss-price';
}

/** 읽은 「티커」 B~F(넓은 범위) → 종목 줄(구분 줄 · 빈 줄 제외). 묶음을 이미 찾았으면 `groups`(못 찾으면 `shape` 오류) */
export function tickerLines(rows: CellRows, groups: ShapeTicker[] = findTickerGroups(rows)): TickerLine[] {
  const out: TickerLine[] = [];
  for (const row of tickerRowsOf(groups)) {
    const r = rows[row - 1];
    const code = tickerRowCode(r);
    if (code) out.push({ row, name: String(r?.[0] ?? '').trim(), code, e: r?.[3], f: r?.[4] });
  }
  return out;
}

const symbolOf = (code: string) => splitCode(code).symbol ?? code;
const marketOf = (code: string) => splitCode(code).market as 'US' | 'KR';
const tickerHeaders = () => SHEET_LAYOUT.headers.filter((h) => h.tab === TICKER_TAB);
const linesRange = () => wideRange(TICKER_TAB, P.wonColumn);

function guard(): NonNullable<ReturnType<typeof assetSheetConfig>> {
  if (!isPriceWriteAllowed()) throw new AssetSheetError('disabled', '이 서버에서는 시트 가격 쓰기가 꺼져 있습니다(오라클에서만 켬).');
  const config = assetSheetConfig();
  if (!config) throw new AssetSheetError('not-configured', '시트 연결 정보가 없습니다(`.env`).');
  if (isMockPrices()) throw new AssetSheetError('disabled', '토스 키가 없어(모의 데이터 모드) 시트 가격을 쓰지 않습니다.');
  return config;
}

async function exclusive<T>(fn: () => Promise<T>): Promise<T> {
  const r = await runOperation(fn);
  if (!r.ok) throw new AssetSheetError('busy', '시트 가격 바꾸기 · 되돌리기가 이미 도는 중입니다.');
  return r.value;
}

/** 머리 글자(「티커」 B12 · D12) 확인 — 다르면 「모양 바뀜」 */
function checkHeaders(got: CellRows[]): void {
  tickerHeaders().forEach((h, i) => {
    if (!headerOk(h, got[i]?.[0]?.[0])) throw new AssetSheetError('shape', `시트 모양이 바뀌었어요(「${h.tab}」 탭 ${h.cell} — 「${h.expect}」 이어야 합니다).`);
  });
}

/** [시트 가격을 토스로 바꾸기] · [남은 종목도 토스로 바꾸기] */
export async function convertSheetPrices(): Promise<AssetPriceSheetStatus> {
  const config = guard();
  return exclusive(async () => {
    const heads = tickerHeaders();
    const got = await batchGet(config, [...heads.map((h) => one(h.tab, h.cell)), one(TICKER_TAB, P.fxCell), linesRange()], 'FORMULA');
    checkHeaders(got);
    const source = priceSource();
    const c9 = got[heads.length]?.[0]?.[0];
    const c9Google = typeof c9 === 'string' && P.fxFormula.test(c9.trim());
    if (!c9Google && !(source === 'toss' && typeof c9 === 'number')) {
      throw new AssetSheetError('shape', `「${TICKER_TAB}」 ${P.fxCell} 이 GOOGLEFINANCE 환율 수식이 아니라 바꾸지 않았습니다.`);
    }
    const lines = tickerLines(got[heads.length + 1] ?? []);
    const stored = priceRows();
    const before = new Map(stored.map((r) => [r.row, r]));
    // 지금 줄 → 바꿀 때 기록 — 줄 번호는 마지막으로 본 자리일 뿐 · 코드로 지금 자리를 찾는다(v2.66.2)
    const codeAt = new Map(lines.map((l) => [l.row, l.code]));
    const found = new Map<number, PriceRow>();
    for (const r of stored) {
      const at = locateRow(r, codeAt);
      if (typeof at === 'number' && !found.has(at)) found.set(at, r);
    }

    // 토스 시세 1번(이미 토스인 줄은 빼고) · 환율 1번
    const ask = [...new Set(lines.filter((l) => !(typeof l.e === 'number' && (found.has(l.row) || before.has(l.row)))).map((l) => symbolOf(l.code)))];
    const tools = priceTools();
    const prices = ask.length ? await tools.quotes(ask) : new Map<string, number>();
    const rate = await tools.rate();
    if (rate == null) throw new AssetSheetError('network', '토스 환율을 받지 못해 바꾸지 않았습니다(잠시 뒤 다시 누르세요).');

    const convert: TickerLine[] = [];
    const rows: PriceRow[] = [];
    const skipped: AssetPriceSkip[] = [];
    for (const l of lines) {
      const kind = classifyLine(l, prices.has(symbolOf(l.code)));
      const market = marketOf(l.code);
      if (kind === 'convert') convert.push(l);
      else if (kind === 'done') {
        const was = found.get(l.row);
        const old = before.get(l.row);
        if (!was && old && old.code !== l.code && ![...found.values()].includes(old)) {
          rows.push(old); // 바꾼 그 줄 그대로 두고 쓰지 않는다(10초 쓰기가 코드를 다시 본다)
          skipped.push({ row: l.row, name: l.name, code: l.code, reason: 'code-changed' });
        } else rows.push({ ...was, row: l.row, code: l.code, market });
      } else skipped.push({ row: l.row, name: l.name, code: l.code, reason: kind });
    }
    if (convert.length === 0) throw new AssetSheetError('no-rows', '토스로 바꿀 줄이 없습니다(이미 토스 · 토스 가격 없음 · 칸 모양이 다름).');

    // ① 원래 수식을 먼저 저장 — 실패면 쓰지 않는다
    const backup = [
      ...(c9Google ? [{ cell: P.fxCell, formula: String(c9) }] : []),
      ...convert.flatMap((l) => [
        { cell: `${P.priceColumn}${l.row}`, formula: String(l.e) },
        { cell: `${P.wonColumn}${l.row}`, formula: String(l.f) },
      ]),
    ];
    try {
      saveSheetBackup(backup, new Date().toISOString());
    } catch {
      throw new AssetSheetError('no-backup', '원래 수식을 앱 DB 에 저장하지 못해 시트에 쓰지 않았습니다.');
    }
    const kept = new Set(sheetBackup().map((b) => b.cell));
    if (!backup.every((b) => kept.has(b.cell))) throw new AssetSheetError('no-backup', '원래 수식을 앱 DB 에 저장하지 못해 시트에 쓰지 않았습니다.');

    // ② 한 요청(USER_ENTERED — F 는 수식)
    const writes: { cell: string; value: string | number }[] = [
      { cell: P.fxCell, value: rate },
      ...convert.flatMap((l) => [
        { cell: `${P.priceColumn}${l.row}`, value: prices.get(symbolOf(l.code))! },
        { cell: `${P.wonColumn}${l.row}`, value: wonFormula(l.row, marketOf(l.code)) },
      ]),
    ];
    await valuesWrite(config, writes.map((w) => ({ range: one(TICKER_TAB, w.cell), value: w.value })), 'USER_ENTERED');
    for (const l of convert) rows.push({ row: l.row, code: l.code, market: marketOf(l.code), name: l.name });
    // 「줄이 옮겨짐」 목록은 이번에 다시 바꾼 줄을 뺀다(남은 줄은 백업과 함께 그대로)
    const converted = new Set(convert.map((l) => l.row));
    savePriceState({ source: 'toss', rows, skipped, moved: priceMoved().filter((m) => !converted.has(m.row)) });
    seedPriceWriter(new Map(writes.filter((w) => typeof w.value === 'number').map((w) => [w.cell, w.value as number])));
    resetSheetCache();
    syncPriceWriter();
    console.log(`[asset] 시트 가격 토스로 바꿈 · ${convert.length}줄 · 그대로 ${skipped.length}줄`);

    // ③ 다시 읽어 확인
    const back = await batchGet(config, writes.map((w) => one(TICKER_TAB, w.cell)), 'FORMULA');
    const same = writes.every((w, i) => {
      const v = back[i]?.[0]?.[0];
      return typeof w.value === 'number' ? typeof v === 'number' && Math.abs(v - w.value) < 1e-9 * Math.max(1, Math.abs(w.value)) : norm(v) === norm(w.value);
    });
    if (!same) throw new AssetSheetError('mismatch', '시트에 쓴 가격 · 수식이 다르게 읽혔습니다(시트 「티커」 를 확인하세요 — [되돌리기] 로 원래 수식을 넣을 수 있습니다).');
    return priceSheetStatus();
  });
}

/** 백업 칸 주소 → 「티커」 줄 번호(가격 · 원화 표기 칸) — 환율 칸(C9)과 그 밖은 null */
function backupRow(cell: string): number | null {
  const m = cell.match(/^([A-Z]+)(\d+)$/);
  if (!m || (m[1] !== P.priceColumn && m[1] !== P.wonColumn)) return null;
  return Number(m[2]);
}

/** 수식 안의 그 줄 칸 번호만 새 줄로(따옴표 안 글자 · `$C$9` 처럼 다른 줄은 그대로) — 순수 함수 */
export function retargetFormula(formula: string, from: number, to: number): string {
  const ref = new RegExp(`(?<![A-Za-z0-9_])(\\$?[A-Z]{1,2}\\$?)${from}(?!\\d)`, 'g');
  return formula
    .split('"')
    .map((part, i) => (i % 2 === 0 ? part.replace(ref, `$1${to}`) : part))
    .join('"');
}

/**
 * [되돌리기] 에서 쓸 칸 · 쓰지 않는 줄 나누기(v2.65.1 · v2.66.2 코드로 찾기) — 순수 함수(시험이 부른다).
 * 백업 칸마다: 환율 칸(C9)은 줄과 상관없으니 늘 쓴다 · 가격 · 원화 칸은 바꿀 때 코드(`asset.priceRows`)로 **지금 그 코드의 줄**을 찾아(`locateRow`) 그 줄에 쓴다 — 수식 안의 줄 번호도 그 줄로.
 * 코드를 못 찾으면(지워짐 · 빈 줄 · 바꾼 줄 기록이 없음) · 같은 코드가 둘이라 정할 수 없으면 쓰지 않고 `moved` 로. `from` 은 백업의 원래 칸(백업을 지울 때 쓴다).
 */
export function planRestore(
  backup: { cell: string; formula: string }[],
  stored: PriceRow[],
  lines: TickerLine[],
): { write: { cell: string; formula: string; from: string }[]; moved: AssetPriceMoved[]; movedRows: PriceRow[] } {
  const was = new Map(stored.map((r) => [r.row, r]));
  const now = new Map(lines.map((l) => [l.row, l]));
  const codeAt = new Map(lines.map((l) => [l.row, l.code]));
  const write: { cell: string; formula: string; from: string }[] = [];
  const moved = new Map<number, AssetPriceMoved>();
  for (const b of backup) {
    const row = backupRow(b.cell);
    if (row == null) {
      write.push({ ...b, from: b.cell }); // C9
      continue;
    }
    const w = was.get(row);
    const n = now.get(row);
    const at = w ? locateRow(w, codeAt) : 'missing';
    if (typeof at === 'number') {
      write.push(at === row ? { ...b, from: b.cell } : { cell: b.cell.replace(/\d+$/, String(at)), formula: retargetFormula(b.formula, row, at), from: b.cell });
    } else if (!moved.has(row)) {
      moved.set(row, { row, wasName: w?.name ?? '', wasCode: w?.code ?? '', nowName: n?.name ?? null, nowCode: n?.code ?? null, ...(at === 'duplicate' ? { duplicate: true } : {}) });
    }
  }
  const movedRows = stored.filter((r) => moved.has(r.row));
  return { write, moved: [...moved.values()].sort((a, b) => a.row - b.row), movedRows };
}

/**
 * [되돌리기] — 저장해 둔 원래 GOOGLEFINANCE 수식을 다시 넣는다(v2.65.1 줄마다 코드 확인).
 * ① 머리 글자 · 「티커」 B~F 를 수식 그대로 읽어 묶음을 다시 찾기 ② `planRestore` — 코드로 지금 줄을 찾아 쓴다 · C9 · 찾지 못한 줄은 쓰지 않고 백업을 남긴다
 * ③ 쓴 뒤 출처 google(10초 쓰기 멈춤) — 바꾼 줄 기록은 옮겨진 줄만 남긴다(다시 누를 때 견줄 코드)
 * ④ 다시 읽어 쓴 칸이 모두 같으면 그 칸 백업만 지운다(남은 백업이 없으면 모두 지움) · 다르면 백업을 모두 남기고 오류.
 * ⚠️ 로그에는 줄 번호 · 개수만.
 */
export async function restoreSheetPrices(): Promise<AssetPriceSheetStatus> {
  const config = guard();
  return exclusive(async () => {
    const backup = sheetBackup();
    if (backup.length === 0) throw new AssetSheetError('no-backup', '되돌릴 원래 수식이 앱 DB 에 없습니다.');
    const heads = tickerHeaders();
    const got = await batchGet(config, [...heads.map((h) => one(h.tab, h.cell)), linesRange()], 'FORMULA');
    checkHeaders(got);
    const stored = priceRows();
    const { write, moved, movedRows } = planRestore(backup, stored, tickerLines(got[heads.length] ?? []));
    if (write.length > 0) await valuesWrite(config, write.map((b) => ({ range: one(TICKER_TAB, b.cell), value: b.formula })), 'USER_ENTERED');
    // 쓴 뒤에는 10초 쓰기를 멈춘다(되돌린 칸에 숫자를 다시 쓰지 않게) — 확인이 틀려도 백업은 남아 다시 [되돌리기] 할 수 있다.
    // 확인 전에는 쓴 줄의 기록도 남긴다(다시 누를 때 견줄 코드) — 확인이 끝나면 옮겨진 줄만
    const writtenRows = new Set(write.map((b) => backupRow(b.from)).filter((r): r is number => r != null));
    savePriceState({ source: 'google', rows: stored.filter((r) => writtenRows.has(r.row) || movedRows.includes(r)), skipped: [], moved });
    syncPriceWriter();
    resetSheetCache();
    if (moved.length > 0) console.warn(`[asset] 시트 가격 되돌리지 않음 · 줄이 옮겨짐 ${moved.length}줄(${moved.map((m) => `${m.row}행`).join(' · ')})`);
    if (write.length === 0) return priceSheetStatus();
    const back = await batchGet(config, write.map((b) => one(TICKER_TAB, b.cell)), 'FORMULA');
    const same = write.every((b, i) => {
      const v = back[i]?.[0]?.[0];
      return v === b.formula || (isFormula(v) && norm(v) === norm(b.formula));
    });
    if (!same) throw new AssetSheetError('mismatch', '되돌린 수식이 다르게 읽혔습니다 — 원래 수식은 앱에 남겨 두었습니다(시트 「티커」 를 확인하고 [되돌리기] 를 다시 누르세요).');
    if (moved.length === 0) clearSheetBackup();
    else deleteSheetBackupCells(write.map((b) => b.from));
    savePriceState({ rows: movedRows });
    console.log(`[asset] 시트 가격 되돌림 · ${write.length}칸${moved.length ? ` · 남은 백업 ${sheetBackup().length}칸` : ''}`);
    return priceSheetStatus();
  });
}

/**
 * 「티커」 에 줄을 넣은 뒤(v2.67.0) — 그 줄과 아래 줄의 앱 기록(바꾼 줄 · 바꾸지 않은 줄 · 옮겨진 줄 · 백업 칸과 수식 안 줄 번호)을 한 줄 내린다.
 * 같은 코드가 두 줄인 종목도 자리로 알아보고, [되돌리기] 가 맞는 줄에 쓰게.
 */
export function shiftPriceRowsForInsert(at: number): void {
  const down = <T extends { row: number }>(list: T[]) => list.map((x) => (x.row >= at ? { ...x, row: x.row + 1 } : x));
  savePriceState({ rows: down(priceRows()), skipped: down(priceSkipped()), moved: down(priceMoved()) });
  const moved = sheetBackup().flatMap((b) => {
    const row = backupRow(b.cell);
    return row != null && row >= at ? [{ from: b.cell, cell: b.cell.replace(/\d+$/, String(row + 1)), formula: retargetFormula(b.formula, row, row + 1) }] : [];
  });
  if (moved.length > 0) replaceSheetBackupCells(moved);
}

/** 새 종목을 토스 숫자로 쓴 줄(v2.67.0) — 10초 쓰기 대상 + [되돌리기] 때 넣을 GOOGLEFINANCE 수식(원래 수식이 없는 줄이라 같은 모양으로 저장) */
export function addTossPriceRow(row: number, code: string, market: 'US' | 'KR', name: string): void {
  const fx = P.fxCell.replace(/^([A-Z]+)(\d+)$/, '$$$1$$$2');
  savePriceState({ rows: [...priceRows(), { row, code, market, name }] });
  saveSheetBackup(
    [
      { cell: `${P.priceColumn}${row}`, formula: `=GOOGLEFINANCE(${P.codeColumn}${row},"price")` },
      { cell: `${P.wonColumn}${row}`, formula: market === 'US' ? `=GOOGLEFINANCE($${P.codeColumn}${row},"price")*${fx}` : `=GOOGLEFINANCE(${P.codeColumn}${row},"price")` },
    ],
    new Date().toISOString(),
  );
}

/** 설정 창 「시트 가격」 상태 — summary 응답에 더한다 */
export function priceSheetStatus(): AssetPriceSheetStatus {
  const enabled = isPriceWriteAllowed();
  const source = priceSource();
  const w = priceWriterStatus();
  const rows = priceRows();
  const stored = priceSkipped();
  // 10초 쓰기가 찾은 「줄 코드가 바뀜」 — 저장된 목록에 없으면 더한다(이름은 모름 — 화면은 줄 번호 · 코드)
  const changed = source !== 'toss' ? [] : rows.filter((r) => w.codeChanged.includes(r.row) && !stored.some((s) => s.row === r.row && s.reason === 'code-changed'));
  const twice = source !== 'toss' ? [] : rows.filter((r) => w.duplicateCode.includes(r.row));
  const skipped = [
    ...stored,
    ...changed.map((r) => ({ row: r.row, name: '', code: r.code, reason: 'code-changed' as const })),
    ...twice.map((r) => ({ row: r.row, name: '', code: r.code, reason: 'duplicate-code' as const })),
  ].sort((a, b) => a.row - b.row);
  return {
    enabled,
    source,
    lastWrittenAt: w.lastWrittenAt,
    state: !enabled ? 'off' : source === 'google' ? 'idle' : w.open ? 'writing' : 'closed',
    rows: source === 'toss' ? rows.length : 0,
    remaining: source === 'toss' ? w.remaining : 0,
    hasBackup: sheetBackup().length > 0,
    skipped,
    moved: priceMoved(),
    archived: (() => {
      const a = archivedBackup();
      return a.cells > 0 ? a : null;
    })(),
  };
}
