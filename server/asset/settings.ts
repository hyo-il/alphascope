/**
 * 자산 관리 설정(v2.62.0 · v2.62.1 설정 창) — `app_settings` 세 칸(JSON):
 * - 'asset.pensionSections'(기본 `['연금 저축 계좌']`) — 「연금으로 볼 계좌」. 「연금 포함」 이 꺼지면 빼는 계좌. 퇴직 연금(「현금」 C30)은 이 설정과 상관없이 연금이다.
 * - 'asset.satelliteSymbols' — 「위성으로 선택한 종목」(종목 코드 `symbol`). 분류 「주식」 이면서 여기 있으면 위성, 그 밖 「주식」 은 코어.
 *   같은 코드는 어느 계좌에 있든 같은 쪽. 분류가 「주식」 이 아니게 된 종목은 목록에 남지만 계산에서 빠진다.
 *   **처음 값**(저장값이 없을 때 한 번): 시트의 `개별 투자` 계좌에 있는 분류 「주식」 종목(106차와 같은 코어 · 위성 금액).
 *   옛 'asset.satelliteSections'(계좌 목록 — v2.62.0) 저장값이 있으면 그 계좌들로 같은 방식으로 한 번 옮기고 옛 키를 지운다.
 * - 'asset.classColors' — 「자산 분류 색」 `{ cash, bond, gold, stock, retirement }` → 팔레트 색 이름. 없거나 팔레트에 없는 이름이면 기본색.
 * - 'asset.rebalanceBand' — 「비율 조정 범위」 ±%p(v2.63.0 · 정수 1~20 · 처음 값 5). 없거나 틀린 값이면 5.
 * - 'asset.lockMinutes' — 「잠금 시간」 분(v2.65.4 · 10 · 30 · 60 · 0 = 끄기 · 처음 값 30). 없거나 틀린 값이면 30. 잠금(`lock.ts`)이 요청마다 읽는다(`readLockMinutes`).
 * 저장 검사: 계좌는 시트 계좌 key 만 · 종목 코드는 지금 시트에 있는 코드(또는 이미 목록에 있는 코드) 만 · 색은 팔레트 이름만 ·
 *   비율 조정 범위는 정수 1~20 만 · 잠금 시간은 10 · 30 · 60 · 0(숫자)만 — 하나라도 틀리면 요청 전체를 거절.
 * ⚠️ 목표 비율은 여기(앱 DB)가 아니라 시트에 있다(`sheet.ts` `writeTargetRatio`).
 * ⚠️ 종목 코드 목록 · 개수를 로그에 찍지 않는다.
 */
import { getDb } from '../db';
import {
  COLORED_GROUP_KEYS,
  DEFAULT_CLASS_COLORS,
  DEFAULT_LOCK_MINUTES,
  DEFAULT_REBALANCE_BAND,
  isAssetColorId,
  isLockMinutes,
  isRebalanceBand,
  type AssetClassColors,
  type AssetSettings,
  type AssetSheetData,
  type AssetStockChoice,
} from '../../src/types/asset';
import { SHEET_LAYOUT } from './sheetLayout';

const KEYS = { pensionSections: 'asset.pensionSections', satelliteSymbols: 'asset.satelliteSymbols', classColors: 'asset.classColors', rebalanceBand: 'asset.rebalanceBand', lockMinutes: 'asset.lockMinutes' } as const;
/** v2.62.0 위성 계좌 목록 — 처음 한 번 `satelliteSymbols` 로 옮기고 지운다 */
const LEGACY_SATELLITE_SECTIONS = 'asset.satelliteSections';
const DEFAULT_PENSION = ['연금 저축 계좌'];
/** 처음 위성 = 이 계좌의 「주식」 종목(106차 기본 위성 계좌) */
const DEFAULT_SATELLITE_SECTIONS = ['개별 투자'];

/** 「연금으로 볼 계좌」 에서 고를 수 있는 계좌 key — 시트 순서(합친 표 제외) */
export const SECTION_KEYS: string[] = SHEET_LAYOUT.sections.flatMap((s) => ('key' in s && s.key ? [s.key] : []));

function readJson(key: string): unknown {
  const row = getDb().prepare(`SELECT value FROM app_settings WHERE key = ?`).get(key) as { value: string } | undefined;
  if (!row) return undefined;
  try {
    return JSON.parse(row.value) as unknown;
  } catch {
    return null;
  }
}

function put(key: string, value: unknown): void {
  getDb().prepare(`INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(key, JSON.stringify(value));
}

const strings = (v: unknown): string[] | null => (Array.isArray(v) && v.every((x) => typeof x === 'string') ? (v as string[]) : null);

function readPension(): string[] {
  const v = readJson(KEYS.pensionSections);
  if (v === undefined) return DEFAULT_PENSION;
  return (strings(v) ?? DEFAULT_PENSION).filter((x) => SECTION_KEYS.includes(x));
}

/** 「연금으로 볼 계좌」 만(v2.70.0 — 하루 기록 「무엇 때문에」 가 시트를 읽지 않고 매매 줄의 계좌를 가린다 · `readAssetSettings` 와 같은 값) */
export const readPensionSections = (): string[] => readPension();

function readColors(): AssetClassColors {
  const v = readJson(KEYS.classColors);
  const out = { ...DEFAULT_CLASS_COLORS };
  if (v && typeof v === 'object') {
    for (const k of COLORED_GROUP_KEYS) {
      const c = (v as Record<string, unknown>)[k];
      if (isAssetColorId(c)) out[k] = c;
    }
  }
  return out;
}

function readBand(): number {
  const v = readJson(KEYS.rebalanceBand);
  return isRebalanceBand(v) ? v : DEFAULT_REBALANCE_BAND;
}

/** 잠금 시간(분 · 0 = 끄기) — 시트 없이 읽는다(잠금이 자산 요청마다 부른다 · 설정 한 줄 읽기) */
export function readLockMinutes(): number {
  const v = readJson(KEYS.lockMinutes);
  return isLockMinutes(v) ? v : DEFAULT_LOCK_MINUTES;
}

/** 시트의 계좌(합친 표 제외) 보유 — 위성 계산 · 고르기 목록 · 검사가 같이 쓴다 */
const accountHoldings = (data: AssetSheetData) => data.sections.filter((s) => !s.combined && s.key).flatMap((s) => s.holdings.map((h) => ({ h, key: s.key as string })));

/** 그 계좌들에 있는 분류 「주식」 종목 코드 — 시트 순서 · 겹침 없음 */
function stockSymbolsIn(data: AssetSheetData, sections: string[]): string[] {
  const out: string[] = [];
  for (const { h, key } of accountHoldings(data)) {
    if (sections.includes(key) && h.assetClass === '주식' && h.symbol && !out.includes(h.symbol)) out.push(h.symbol);
  }
  return out;
}

/**
 * 위성 종목 — 저장값이 없으면 처음 한 번 채워 저장한다(옛 위성 계좌 저장값 → 그 계좌들 · 없으면 개별 투자).
 * 시트를 읽은 뒤에만 부른다(처음 값은 시트에서 정한다).
 */
function readSatellite(data: AssetSheetData): string[] {
  const v = readJson(KEYS.satelliteSymbols);
  if (v !== undefined) return strings(v) ?? [];
  const legacy = strings(readJson(LEGACY_SATELLITE_SECTIONS));
  const sections = legacy ? legacy.filter((x) => SECTION_KEYS.includes(x)) : DEFAULT_SATELLITE_SECTIONS;
  const symbols = stockSymbolsIn(data, sections);
  const db = getDb();
  db.transaction(() => {
    put(KEYS.satelliteSymbols, symbols);
    db.prepare(`DELETE FROM app_settings WHERE key = ?`).run(LEGACY_SATELLITE_SECTIONS);
  })();
  return symbols;
}

/** 설정 다섯 가지 — 시트 값이 있어야 위성 처음 값을 정할 수 있다 */
export function readAssetSettings(data: AssetSheetData): AssetSettings {
  return { pensionSections: readPension(), satelliteSymbols: readSatellite(data), classColors: readColors(), rebalanceBand: readBand(), lockMinutes: readLockMinutes() };
}

/** 「위성으로 선택한 종목」 고르기 목록 — 분류 「주식」 종목 + 위성 목록에 남은 종목(분류가 바뀐 것) · 시트 순서 */
export function stockChoices(data: AssetSheetData, settings: AssetSettings): AssetStockChoice[] {
  const map = new Map<string, AssetStockChoice>();
  for (const { h, key } of accountHoldings(data)) {
    if (!h.symbol) continue;
    const stock = h.assetClass === '주식';
    if (!stock && !settings.satelliteSymbols.includes(h.symbol)) continue;
    const c = map.get(h.symbol) ?? { symbol: h.symbol, name: h.name, sections: [], isStock: false };
    if (!c.sections.includes(key)) c.sections.push(key);
    c.isStock ||= stock;
    map.set(h.symbol, c);
  }
  return [...map.values()];
}

/**
 * 고칠 칸만 — `{ pensionSections?, satelliteSymbols?, classColors?, rebalanceBand?, lockMinutes? }`. 틀린 값이 하나라도 있으면 요청 전체를 거절(null).
 * 종목 코드는 지금 시트 계좌에 있는 코드 · 이미 위성 목록에 있는 코드만(시트에서 빠진 종목을 체크 해제 없이 다시 저장할 수 있게).
 */
export function writeAssetSettings(patch: unknown, data: AssetSheetData): AssetSettings | null {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return null;
  const p = patch as Record<string, unknown>;
  const fields = (Object.keys(KEYS) as (keyof typeof KEYS)[]).filter((k) => p[k] !== undefined);
  if (fields.length === 0) return null;
  const current = readAssetSettings(data);
  const next: Partial<AssetSettings> = {};

  if (p.pensionSections !== undefined) {
    const v = strings(p.pensionSections);
    if (!v || !v.every((x) => SECTION_KEYS.includes(x))) return null;
    next.pensionSections = SECTION_KEYS.filter((k) => v.includes(k)); // 시트 순서 · 겹침 없음
  }
  if (p.satelliteSymbols !== undefined) {
    const v = strings(p.satelliteSymbols);
    const known = new Set([...accountHoldings(data).flatMap(({ h }) => (h.symbol ? [h.symbol] : [])), ...current.satelliteSymbols]);
    if (!v || !v.every((x) => known.has(x))) return null;
    next.satelliteSymbols = [...new Set(v)];
  }
  if (p.classColors !== undefined) {
    const v = p.classColors;
    if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
    const entries = Object.entries(v as Record<string, unknown>);
    if (entries.length === 0 || !entries.every(([k, c]) => (COLORED_GROUP_KEYS as readonly string[]).includes(k) && isAssetColorId(c))) return null;
    next.classColors = { ...current.classColors, ...(v as Partial<AssetClassColors>) };
  }
  if (p.rebalanceBand !== undefined) {
    if (!isRebalanceBand(p.rebalanceBand)) return null;
    next.rebalanceBand = p.rebalanceBand;
  }
  if (p.lockMinutes !== undefined) {
    if (!isLockMinutes(p.lockMinutes)) return null;
    next.lockMinutes = p.lockMinutes;
  }

  const db = getDb();
  db.transaction(() => {
    for (const k of fields) put(KEYS[k], next[k]);
  })();
  return readAssetSettings(data);
}
