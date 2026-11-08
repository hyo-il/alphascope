/**
 * 「자산 분류 정하기」 창(v2.65.3)의 계산 — 화면과 시험(`asset:test` [116-3] · [116-4])이 같은 함수를 쓴다(DOM 없음).
 * - 목록: 「티커」 줄 하나 = 한 줄(같은 종목이 여러 계좌에 있어도 한 줄 · 계좌를 합친 표는 빼고 셈) · 「티커」 줄 순서.
 * - 저장: 바꾼 줄만 **값마다 묶어** 한 요청씩(`PUT /api/asset/class { rows, assetClass }` — 값이 넷이라 많아야 4번) · 미지정은 `''`.
 *   요청 하나가 실패해도 나머지는 보낸다 · 성공한 줄 · 실패한 줄을 돌려준다(창이 실패한 것만 다시 보낸다).
 * ⚠️ 자산 값(이름 · 코드 밖의 금액 · 수량)은 다루지 않는다 — 로그를 찍지 않는다.
 */
import { ASSET_CLASSES, type AssetClass, type AssetSheetData } from '../types/asset';

/** 고를 수 있는 값 — 미지정은 빈 글자(시트 칸을 비운다 · 서버 규칙 그대로) */
export type ClassValue = AssetClass | '';
/** 창 버튼 순서 — 미지정 | 채권 | 금 | 주식 */
export const CLASS_VALUES: readonly ClassValue[] = ['', ...ASSET_CLASSES];

export interface ClassRow {
  /** 「티커」 줄 번호 */
  row: number;
  /** 처음 나온 보유 줄의 이름(시트 순서) */
  name: string;
  symbol: string | null;
  exchange: string | null;
  /** 있는 계좌(계좌 key — 시트 순서 · 합친 표 제외) */
  sections: string[];
  /** 지금 시트 값 */
  value: ClassValue;
  /** 「티커」 D칸이 수식 — 바꿀 수 없다 */
  locked: boolean;
}

/** 시트 값 → 창 목록(「티커」 줄마다 한 줄 · 줄 번호 순) — 이을 수 없는 줄(`tickerRow` 없음)은 빠진다 */
export function classRowsOf(data: AssetSheetData): ClassRow[] {
  const byRow = new Map<number, ClassRow>();
  for (const s of data.sections) {
    if (s.combined) continue;
    const key = s.key ?? s.name;
    for (const h of s.holdings) {
      if (h.tickerRow == null) continue;
      const got = byRow.get(h.tickerRow);
      if (got) {
        if (!got.sections.includes(key)) got.sections.push(key);
        continue;
      }
      byRow.set(h.tickerRow, { row: h.tickerRow, name: h.name, symbol: h.symbol, exchange: h.exchange, sections: [key], value: h.assetClass ?? '', locked: h.classFormula });
    }
  }
  return [...byRow.values()].sort((a, b) => a.row - b.row);
}

/** 바꾼 줄 — 수식 줄 · 같은 값은 빠진다 */
export function changedRows(base: Record<number, ClassValue>, draft: Record<number, ClassValue>, locked: ReadonlySet<number>): number[] {
  return Object.keys(draft)
    .map(Number)
    .filter((r) => !locked.has(r) && draft[r] !== undefined && draft[r] !== (base[r] ?? ''))
    .sort((a, b) => a - b);
}

export interface ClassSaveGroup {
  assetClass: ClassValue;
  rows: number[];
}

/** 바꾼 줄을 값마다 묶는다 — 버튼 순서(미지정 · 채권 · 금 · 주식) · 빈 묶음 없음 */
export function planClassSave(base: Record<number, ClassValue>, draft: Record<number, ClassValue>, locked: ReadonlySet<number>): ClassSaveGroup[] {
  const rows = changedRows(base, draft, locked);
  return CLASS_VALUES.map((v) => ({ assetClass: v, rows: rows.filter((r) => draft[r] === v) })).filter((g) => g.rows.length > 0);
}

export type ClassSendResult = { ok: true; data: AssetSheetData } | { ok: false; error: string };

export interface ClassSaveOutcome {
  /** 시트에 쓴 줄 */
  saved: number[];
  /** 쓰지 못한 묶음 · 이유(서버 문구 그대로) */
  failed: (ClassSaveGroup & { error: string })[];
  /** 마지막으로 성공한 요청이 돌려준 시트 값(다시 읽은 값) — 하나도 성공하지 못했으면 null */
  data: AssetSheetData | null;
}

/** 묶음마다 한 요청씩 차례로 보낸다(동시에 쓰지 않는다 — 서버 쓰기는 한 요청에 한 값) · 실패해도 다음 묶음은 보낸다 */
export async function runClassSave(groups: ClassSaveGroup[], send: (rows: number[], value: ClassValue) => Promise<ClassSendResult>): Promise<ClassSaveOutcome> {
  const out: ClassSaveOutcome = { saved: [], failed: [], data: null };
  for (const g of groups) {
    const r = await send(g.rows, g.assetClass);
    if (r.ok) {
      out.saved.push(...g.rows);
      out.data = r.data;
    } else out.failed.push({ ...g, error: r.error });
  }
  return out;
}
