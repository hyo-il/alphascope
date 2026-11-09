/**
 * 「자산 분류 정하기」 창(v2.65.3 · v2.65.4 종목 코드로 묶기)의 계산 — 화면과 시험(`asset:test` [116-3] · [116-4] · [117-1])이 같은 함수를 쓴다(DOM 없음).
 * - 목록: **종목 코드 하나 = 한 줄**(묶음 열쇠 `holdingGroupKey` — 「자산 현황」 종목별 보기와 같은 함수 · 코드가 없으면 `row:<「티커」 줄 번호>`).
 *   같은 코드가 「티커」 여러 줄에 있으면 한 줄 · `rows` 에 그 줄 전부 · 줄마다 값이 다르면 `mixed`(「줄마다 다름」) ·
 *   한 줄이라도 D칸이 수식이면 그 묶음 전체를 바꿀 수 없다(하나라도 수식이면 하나도 안 씀). 계좌를 합친 표는 빼고 센다 · 첫 「티커」 줄 순서.
 * - 저장: 바꾼 묶음만 **값마다 묶어** 한 요청씩(`PUT /api/asset/class { rows, assetClass }` — 값이 넷이라 많아야 4번) · 묶음의 줄은 **모두** `rows` 에 · 미지정은 `''`.
 *   요청 하나가 실패해도 나머지는 보낸다 · 성공한 줄 · 실패한 줄을 돌려준다(창이 실패한 것만 다시 보낸다).
 * ⚠️ 자산 값(이름 · 코드 밖의 금액 · 수량)은 다루지 않는다 — 로그를 찍지 않는다.
 */
import { ASSET_CLASSES, holdingGroupKey, type AssetClass, type AssetSheetData } from '../types/asset';

/** 고를 수 있는 값 — 미지정은 빈 글자(시트 칸을 비운다 · 서버 규칙 그대로) */
export type ClassValue = AssetClass | '';
/** 창 버튼 순서 — 미지정 | 채권 | 금 | 주식 */
export const CLASS_VALUES: readonly ClassValue[] = ['', ...ASSET_CLASSES];
/** 같은 코드의 「티커」 줄마다 값이 다름 — 버튼 넷 중 아무것도 눌리지 않은 상태 */
export const MIXED = 'mixed' as const;
/** 한 묶음의 지금 값 */
export type GroupValue = ClassValue | typeof MIXED;

export interface ClassRow {
  /** 묶음 열쇠 — 종목 코드(`holdingGroupKey`) · 코드가 없으면 `row:<「티커」 줄 번호>` */
  key: string;
  /** 이 묶음의 「티커」 줄 번호 전부(오름차순) */
  rows: number[];
  /** 처음 나온 보유 줄의 이름(시트 순서) */
  name: string;
  symbol: string | null;
  exchange: string | null;
  /** 있는 계좌(계좌 key — 시트 순서 · 합친 표 제외) */
  sections: string[];
  /** 지금 시트 값 — 줄마다 같으면 그 값, 다르면 `mixed` */
  value: GroupValue;
  /** 「티커」 D칸이 한 줄이라도 수식 — 바꿀 수 없다 */
  locked: boolean;
}

/** 시트 값 → 창 목록(종목 코드마다 한 줄 · 첫 줄 번호 순) — 이을 수 없는 줄(`tickerRow` 없음)은 빠진다 */
export function classRowsOf(data: AssetSheetData): ClassRow[] {
  const byKey = new Map<string, ClassRow & { values: Map<number, ClassValue> }>();
  for (const s of data.sections) {
    if (s.combined) continue;
    const section = s.key ?? s.name;
    for (const h of s.holdings) {
      if (h.tickerRow == null) continue;
      const key = holdingGroupKey(h, `row:${h.tickerRow}`);
      const got = byKey.get(key) ?? { key, rows: [], name: h.name, symbol: h.symbol, exchange: h.exchange, sections: [], value: '' as GroupValue, locked: false, values: new Map<number, ClassValue>() };
      if (!got.values.has(h.tickerRow)) got.values.set(h.tickerRow, h.assetClass ?? '');
      if (!got.rows.includes(h.tickerRow)) got.rows.push(h.tickerRow);
      if (!got.sections.includes(section)) got.sections.push(section);
      got.locked ||= h.classFormula;
      byKey.set(key, got);
    }
  }
  return [...byKey.values()]
    .map(({ values, ...r }) => {
      const vs = [...new Set(values.values())];
      return { ...r, rows: [...r.rows].sort((a, b) => a - b), value: vs.length === 1 ? vs[0] : MIXED };
    })
    .sort((a, b) => a.rows[0] - b.rows[0]);
}

/** 바꾼 묶음 열쇠(목록 순서) — 수식 묶음 · 같은 값은 빠진다(`mixed` 묶음은 무엇을 골라도 바꾼 것) */
export function changedKeys(list: readonly ClassRow[], base: Record<string, GroupValue>, draft: Record<string, ClassValue>): string[] {
  return list.filter((r) => !r.locked && draft[r.key] !== undefined && draft[r.key] !== (base[r.key] ?? '')).map((r) => r.key);
}

export interface ClassSaveGroup {
  assetClass: ClassValue;
  /** 보낼 「티커」 줄 — 이 값으로 고른 묶음들의 줄 전부(오름차순) */
  rows: number[];
  /** 이 요청에 든 묶음 열쇠 */
  keys: string[];
}

/** 바꾼 묶음을 값마다 모은다 — 버튼 순서(미지정 · 채권 · 금 · 주식) · 빈 묶음 없음 */
export function planClassSave(list: readonly ClassRow[], base: Record<string, GroupValue>, draft: Record<string, ClassValue>): ClassSaveGroup[] {
  const changed = new Set(changedKeys(list, base, draft));
  return CLASS_VALUES.map((v) => {
    const picked = list.filter((r) => changed.has(r.key) && draft[r.key] === v);
    return { assetClass: v, rows: picked.flatMap((r) => r.rows).sort((a, b) => a - b), keys: picked.map((r) => r.key) };
  }).filter((g) => g.rows.length > 0);
}

/** 그 「티커」 줄의 종목 코드(화면이 본 것 — 서버가 줄이 옮겨졌는지 본다 · v2.66.2) · 모르면 빈 글자 */
export function codeOfTickerRow(data: AssetSheetData, row: number): string {
  for (const s of data.sections) for (const h of s.holdings) if (h.tickerRow === row && h.code) return h.code;
  return '';
}

export type ClassSendResult = { ok: true; data: AssetSheetData } | { ok: false; error: string };

export interface ClassSaveOutcome {
  /** 시트에 쓴 줄 */
  saved: number[];
  /** 시트에 쓴 묶음 열쇠 */
  savedKeys: string[];
  /** 쓰지 못한 묶음 · 이유(서버 문구 그대로) */
  failed: (ClassSaveGroup & { error: string })[];
  /** 마지막으로 성공한 요청이 돌려준 시트 값(다시 읽은 값) — 하나도 성공하지 못했으면 null */
  data: AssetSheetData | null;
}

/** 묶음마다 한 요청씩 차례로 보낸다(동시에 쓰지 않는다 — 서버 쓰기는 한 요청에 한 값) · 실패해도 다음 묶음은 보낸다 */
export async function runClassSave(groups: ClassSaveGroup[], send: (rows: number[], value: ClassValue) => Promise<ClassSendResult>): Promise<ClassSaveOutcome> {
  const out: ClassSaveOutcome = { saved: [], savedKeys: [], failed: [], data: null };
  for (const g of groups) {
    const r = await send(g.rows, g.assetClass);
    if (r.ok) {
      out.saved.push(...g.rows);
      out.savedKeys.push(...g.keys);
      out.data = r.data;
    } else out.failed.push({ ...g, error: r.error });
  }
  return out;
}
