/**
 * 「은행 묶음 고치기」(v2.71.1) — 「현금」 탭 계좌를 은행별로 묶는 규칙(괄호 앞 글자 = 은행 · `src/types/asset.ts` `cashBankName`)을
 * 앱에서만 고친다: 줄 하나를 다른 은행으로 옮기기 · 은행 이름 바꾸기. 저장은 `app_settings` 'asset.cashBanks'(JSON — 시트는 그대로).
 * 시트에 새 은행 줄을 넣으면 고치기 없이도 새 묶음이 생긴다(이 파일은 고친 것만 둔다).
 * ⚠️ 로그를 남기지 않는다(계좌 이름).
 */
import { getDb } from '../db';
import { ASSET_CASH_BANK_NAME_MAX, cashBankName, type AssetCashBankFix } from '../../src/types/asset';

const KEY = 'asset.cashBanks';

const cleanName = (v: unknown): string | null => {
  if (typeof v !== 'string') return null;
  const t = v.trim().replace(/\s+/g, ' ');
  return t.length > 0 && t.length <= ASSET_CASH_BANK_NAME_MAX ? t : null;
};

const stringMap = (v: unknown): Record<string, string> => {
  const out: Record<string, string> = {};
  if (v && typeof v === 'object' && !Array.isArray(v)) for (const [k, x] of Object.entries(v)) if (typeof x === 'string' && x.trim()) out[k] = x.trim();
  return out;
};

/** 저장값 → 고치기(모양이 틀리면 빈 고치기) */
export function readCashBankFix(): AssetCashBankFix {
  const row = getDb().prepare(`SELECT value FROM app_settings WHERE key = ?`).get(KEY) as { value: string } | undefined;
  if (!row) return { rows: {}, renames: {} };
  try {
    const v = JSON.parse(row.value) as Partial<AssetCashBankFix> | null;
    return { rows: stringMap(v?.rows), renames: stringMap(v?.renames) };
  } catch {
    return { rows: {}, renames: {} };
  }
}

/** 시험이 지운다 */
export const clearCashBankFixForTest = (): void => void getDb().prepare(`DELETE FROM app_settings WHERE key = ?`).run(KEY);

/**
 * 고치기 한 번 — `{ row: { name, bank } }`(지금 시트에 있는 계좌 이름만 · bank null = 처음대로) 또는 `{ rename: { from, to } }`(지금 시트의 괄호 앞 은행 이름만 · to null = 처음대로).
 * 틀리면 null(요청 전체 거절). `names` = 지금 「현금」 탭 은행 계좌 이름(한 줄로 고친 이름 · 시트 순서).
 */
export function writeCashBankFix(patch: unknown, names: string[]): AssetCashBankFix | null {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return null;
  const p = patch as Record<string, unknown>;
  const keys = Object.keys(p);
  if (keys.length !== 1 || !['row', 'rename'].includes(keys[0])) return null;
  const cur = readCashBankFix();
  const next: AssetCashBankFix = { rows: { ...cur.rows }, renames: { ...cur.renames } };
  if (p.row !== undefined) {
    const r = p.row as { name?: unknown; bank?: unknown } | null;
    if (!r || typeof r.name !== 'string' || !names.includes(r.name)) return null;
    if (r.bank === null) delete next.rows[r.name];
    else {
      const bank = cleanName(r.bank);
      if (!bank) return null;
      // 처음 묶음(괄호 앞 글자 · 이름 바꾸기 뒤)과 같으면 고치기를 남기지 않는다
      if (cashBankName(r.name, { rows: {}, renames: next.renames }).bank === bank) delete next.rows[r.name];
      else next.rows[r.name] = bank;
    }
  } else {
    const r = p.rename as { from?: unknown; to?: unknown } | null;
    const raws = new Set(names.map((n) => cashBankName(n).raw));
    if (!r || typeof r.from !== 'string' || !raws.has(r.from)) return null;
    if (r.to === null) delete next.renames[r.from];
    else {
      const to = cleanName(r.to);
      if (!to) return null;
      if (to === r.from) delete next.renames[r.from];
      else next.renames[r.from] = to;
    }
  }
  getDb().prepare(`INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(KEY, JSON.stringify(next));
  return readCashBankFix();
}
