/**
 * 자산 관리 계좌 구간 설정(v2.62.0) — `app_settings` 두 칸(구간 key 목록 · JSON):
 * - 'asset.pensionSections'(기본 `['연금 저축 계좌']`) — 「연금 포함」 이 꺼지면 빼는 구간. 퇴직 연금(「현금」 C30)은 이 설정과 상관없이 연금이다.
 * - 'asset.satelliteSections'(기본 `['개별 투자']`) — 분류 「주식」 종목을 위성으로 보는 구간(그 밖 구간의 「주식」 은 코어).
 * 고를 수 있는 key 는 `sheetLayout.ts` 의 계좌 구간(합친 표 제외) — 모르는 key 는 저장하지 않는다.
 */
import { getDb } from '../db';
import type { AssetSectionSettings } from '../../src/types/asset';
import { SHEET_LAYOUT } from './sheetLayout';

const KEYS = { pensionSections: 'asset.pensionSections', satelliteSections: 'asset.satelliteSections' } as const;
const DEFAULTS: AssetSectionSettings = { pensionSections: ['연금 저축 계좌'], satelliteSections: ['개별 투자'] };

/** 설정에서 고를 수 있는 구간 key — 시트 순서 */
export const SECTION_KEYS: string[] = SHEET_LAYOUT.sections.flatMap((s) => ('key' in s && s.key ? [s.key] : []));

function readKey(key: string, fallback: string[]): string[] {
  const row = getDb().prepare(`SELECT value FROM app_settings WHERE key = ?`).get(key) as { value: string } | undefined;
  if (!row) return fallback;
  try {
    const v = JSON.parse(row.value) as unknown;
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && SECTION_KEYS.includes(x)) : fallback;
  } catch {
    return fallback;
  }
}

export function readSectionSettings(): AssetSectionSettings {
  return {
    pensionSections: readKey(KEYS.pensionSections, DEFAULTS.pensionSections),
    satelliteSections: readKey(KEYS.satelliteSections, DEFAULTS.satelliteSections),
  };
}

/** 고칠 칸만 — 배열이 아니거나 모르는 key 가 있으면 그 요청 전체를 거절(null) */
export function writeSectionSettings(patch: unknown): AssetSectionSettings | null {
  if (!patch || typeof patch !== 'object') return null;
  const p = patch as Record<string, unknown>;
  const fields = (Object.keys(KEYS) as (keyof typeof KEYS)[]).filter((k) => p[k] !== undefined);
  if (fields.length === 0) return null;
  for (const k of fields) {
    const v = p[k];
    if (!Array.isArray(v) || !v.every((x) => typeof x === 'string' && SECTION_KEYS.includes(x))) return null;
  }
  const put = getDb().prepare(`INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`);
  for (const k of fields) {
    const list = SECTION_KEYS.filter((key) => (p[k] as string[]).includes(key)); // 시트 순서 · 겹침 없음
    put.run(KEYS[k], JSON.stringify(list));
  }
  return readSectionSettings();
}
