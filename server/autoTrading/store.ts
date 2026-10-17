/**
 * 계좌별 자동매매 설정 저장소.
 *
 * 저장은 `gemini_settings` 테이블(key-value)을 재사용한다 — 이미 있는 읽기/쓰기 유틸을 그대로 쓴다.
 * ⚠️ **계좌마다 키를 나누지 않고 맵 하나에 담는다.** 스케줄러가 "활성화된 계좌 전부" 를 매 틱 훑기 때문이다.
 *
 * 설정 모양은 「규칙 하나 + 종목 + 계좌 운용 + 신규 매수 안전장치」 다. 옛 칸(mode · 분석 주기 · 청산 등)은
 * 읽을 때 버린다(`normalizeStrategy`). 데이터 정리(`server/dataReset/v2_44_0.ts`)가 저장값도 한 번 새 모양으로 바꾼다.
 * 같은 테이블에 계좌 × 종목별로 「마지막 신호 판단 시장 날짜」·「마지막 손절 시장 날짜」·트레일링 최고가를 둔다.
 */

import { readSetting, writeSetting } from '../gemini/store';
import { listAccounts } from '../paperTradingService';
import { defaultStrategy, type AccountStrategy, type DecisionNote } from '../../src/types/autoTrading';
import { marketDate } from '../../src/utils/marketDate';
import { isKrSymbol } from '../../src/utils/market';

export const STRATEGIES_KEY = 'autoTrading.strategies';
export const PEAKS_KEY = 'autoTrading.trailingPeaks';
/** 계좌별 마지막 바퀴의 판단 (건너뜀 사유 포함) — 재시작해도 화면에서 볼 수 있게 저장한다 */
export const NOTES_KEY = 'autoTrading.lastNotes';
/** 계좌 × 종목 → 마지막으로 신호를 본 그 종목 시장 날짜 (하루 한 번 판단) */
export const JUDGED_KEY = 'autoTrading.lastJudged';
/** 계좌 × 종목 → 마지막 손절(hard_stop)로 판 그 종목 시장 날짜 (손절 뒤 다시 매수 대기) */
export const STOPS_KEY = 'autoTrading.lastStops';

export type { DecisionNote };
/** `day` = 한국 시간 날짜(옛 기록에는 없다: `at` 의 한국 날짜로 읽는다) */
type NotesMap = Record<string, { at: string; day?: string; notes: DecisionNote[] }>;

/** 「최근 판단」 한 계좌의 최대 줄 수 */
export const NOTES_MAX = 200;
/** 한국 시간 날짜 — 국내 종목 코드로 `marketDate` 를 부르면 Asia/Seoul 로 잰다 */
const kstDay = (ms: number) => marketDate(ms, '005930');

/**
 * 「최근 판단」 을 **그날(한국 시간 날짜) 하루치** 남긴다 (사용자 결정 A-4).
 * 새 판단은 앞에 덧붙이고(최근이 위), 날짜가 바뀐 첫 판단 때 지난 날을 비운다. 계좌마다 최대 `NOTES_MAX` 줄(넘으면 오래된 줄부터 버림).
 * 줄마다 판단 시각 `at`(같은 바퀴 = 같은 값 — 화면이 이것으로 묶는다)과 시장을 붙인다. 빈 목록은 이전 기록을 지우지 않는다.
 */
export function recordNotes(accountId: number, notes: DecisionNote[], now = new Date()): void {
  if (!notes.length) return;
  const map = readSetting<NotesMap>(NOTES_KEY, {});
  const at = now.toISOString();
  const day = kstDay(now.getTime());
  const prev = map[String(accountId)];
  const kept = prev && (prev.day ?? kstDay(Date.parse(prev.at))) === day ? readNotesOf(prev) : [];
  // detail(AI 검증 이유)·rank 는 있을 때만
  const stamped = notes.map((n) => ({
    symbol: n.symbol,
    action: n.action,
    reason: n.reason,
    ...(n.code ? { code: n.code } : {}),
    ...(n.detail?.length ? { detail: n.detail } : {}),
    ...(n.rank ? { rank: n.rank } : {}),
    ...(n.gateReason ? { gateReason: n.gateReason } : {}),
    at,
    market: isKrSymbol(n.symbol) ? ('KR' as const) : ('US' as const),
  }));
  map[String(accountId)] = { at, day, notes: [...stamped, ...kept].slice(0, NOTES_MAX) };
  writeSetting(NOTES_KEY, map);
}

/** 옛 기록(줄에 시각·시장이 없음)은 묶음 시각으로 채운다 */
function readNotesOf(found: { at: string; notes: DecisionNote[] }): DecisionNote[] {
  return found.notes.map((n) => ({ ...n, at: n.at ?? found.at, market: n.market ?? (isKrSymbol(n.symbol) ? 'KR' : 'US') }));
}

export function readNotes(accountId: number): { at: string | null; notes: DecisionNote[] } {
  const found = readSetting<NotesMap>(NOTES_KEY, {})[String(accountId)];
  return { at: found?.at ?? null, notes: found ? readNotesOf(found) : [] };
}

type StrategyMap = Record<string, Partial<AccountStrategy> & Record<string, unknown>>;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

/** 토스 symbol 은 영문·숫자·점·하이픈만 허용한다 (한글 종목명이 들어오면 매번 실패한다) */
const SYMBOL_PATTERN = /^[A-Z0-9.\-]+$/;

function cleanSymbols(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : [];
  return [...new Set(list.map((s) => String(s).trim().toUpperCase()).filter((s) => s && s.length <= 20 && SYMBOL_PATTERN.test(s)))];
}

/** 저장 전·읽을 때 값을 조이고 **새 모양 칸만** 남긴다 — 옛 칸(mode·intervalMinutes·청산·AI)은 여기서 버려진다 */
export function normalizeStrategy(accountId: number, raw: Partial<AccountStrategy> & Record<string, unknown>): AccountStrategy {
  const base = defaultStrategy(accountId);
  const v = { ...base, ...raw };
  const ruleId = typeof v.ruleId === 'number' && Number.isInteger(v.ruleId) && v.ruleId > 0 ? v.ruleId : null;
  return {
    accountId,
    enabled: Boolean(v.enabled) && ruleId != null,
    ruleId,
    symbols: cleanSymbols(v.symbols),
    positionSizePercent: clamp(Number(v.positionSizePercent), 1, 100),
    maxPositions: clamp(Math.round(Number(v.maxPositions)), 1, 50),
    earningsBlackoutDays: clamp(Math.round(Number(v.earningsBlackoutDays)), 0, 10),
    // 0~20%, 0.5 단위
    dailyLossLimitPercent: Math.round(clamp(Number(v.dailyLossLimitPercent), 0, 20) * 2) / 2,
    // AI 검증 — 옛 계좌(칸 없음)는 끔
    aiCheck: v.aiCheck === true,
  };
}

function readMap(): StrategyMap {
  return readSetting<StrategyMap>(STRATEGIES_KEY, {});
}

function writeMap(map: StrategyMap): void {
  writeSetting(STRATEGIES_KEY, map);
}

/** 계좌 하나의 설정 — 없으면 기본값을 돌려준다 (저장하지는 않는다) */
export function getStrategy(accountId: number): AccountStrategy {
  const saved = readMap()[String(accountId)];
  return saved ? normalizeStrategy(accountId, saved) : defaultStrategy(accountId);
}

/** 존재하는 계좌 전부의 설정 (저장된 적 없는 계좌는 기본값) */
export function listStrategies(): AccountStrategy[] {
  const map = readMap();
  return listAccounts().map((account) => {
    const saved = map[String(account.id)];
    return saved ? normalizeStrategy(account.id, saved) : defaultStrategy(account.id);
  });
}

/** 스케줄러가 매 틱 훑는 대상 — 켜져 있고 계좌가 실제로 존재하는 것만 */
export function listActiveStrategies(): AccountStrategy[] {
  return listStrategies().filter((s) => s.enabled);
}

export class StrategyRuleError extends Error {}

/**
 * 저장. ⚠️ 켜려면 규칙이 있어야 한다 — `ruleExists` 로 확인한다(호출부가 매매 규칙 저장소를 넘긴다 — 두 저장소가 서로를 import 하지 않게).
 */
export function saveStrategy(
  accountId: number,
  patch: Partial<AccountStrategy>,
  ruleExists: (id: number) => boolean,
): AccountStrategy {
  const wantEnabled = Boolean({ ...getStrategy(accountId), ...patch }.enabled);
  const merged = normalizeStrategy(accountId, { ...getStrategy(accountId), ...patch });
  if (merged.ruleId != null && !ruleExists(merged.ruleId)) merged.ruleId = null;
  if (wantEnabled && merged.ruleId == null) throw new StrategyRuleError('매매 규칙을 고르세요.');
  const map = readMap();
  map[String(accountId)] = merged as StrategyMap[string];
  writeMap(map);
  return merged;
}

/** 이 규칙을 쓰는 계좌 id — 「매매 규칙」 의 「적용된 곳」 */
export function accountsUsingRule(ruleId: number): number[] {
  return listStrategies().filter((s) => s.ruleId === ruleId).map((s) => s.accountId);
}

/** 규칙을 지울 때 — 그 규칙을 쓰던 계좌는 자동매매를 끄고 규칙을 비운다. 바뀐 계좌 id */
export function detachRule(ruleId: number): number[] {
  const map = readMap();
  const changed: number[] = [];
  for (const s of listStrategies()) {
    if (s.ruleId !== ruleId) continue;
    map[String(s.accountId)] = { ...s, ruleId: null, enabled: false } as StrategyMap[string];
    changed.push(s.accountId);
  }
  if (changed.length) writeMap(map);
  return changed;
}

/** 계좌를 지우면 설정·고점·판단 기록도 함께 지운다 (남겨 두면 계좌 id 가 재사용될 때 섞인다) */
export function deleteStrategy(accountId: number): void {
  const map = readMap();
  delete map[String(accountId)];
  writeMap(map);
  for (const key of [PEAKS_KEY, NOTES_KEY, JUDGED_KEY, STOPS_KEY]) {
    const m = readSetting<Record<string, unknown>>(key, {});
    delete m[String(accountId)];
    writeSetting(key, m);
  }
}

// ── 계좌 × 종목 값 (최고가 · 판단 날짜 · 손절 날짜) ──────────────────────────
type PerSymbol<T> = Record<string, Record<string, T>>;

function readPer<T>(key: string, accountId: number, symbol: string): T | null {
  return readSetting<PerSymbol<T>>(key, {})[String(accountId)]?.[symbol] ?? null;
}

function writePer<T>(key: string, accountId: number, symbol: string, value: T | null): void {
  const all = readSetting<PerSymbol<T>>(key, {});
  const forAccount = all[String(accountId)] ?? {};
  if (value == null) {
    if (!(symbol in forAccount)) return;
    delete forAccount[symbol];
  } else {
    forAccount[symbol] = value;
  }
  all[String(accountId)] = forAccount;
  writeSetting(key, all);
}

export const getPeak = (accountId: number, symbol: string): number | null => readPer<number>(PEAKS_KEY, accountId, symbol);

/** 고점은 올라갈 때만 갱신한다 — 내려갈 때 따라 내리면 트레일링이 아니다 */
export function updatePeak(accountId: number, symbol: string, price: number): number {
  const prev = getPeak(accountId, symbol) ?? 0;
  if (!Number.isFinite(price) || price <= 0) return prev;
  const next = Math.max(prev, price);
  if (next !== prev) writePer(PEAKS_KEY, accountId, symbol, next);
  return next;
}

/** 포지션을 정리했으면 고점도 버린다 — 다음에 다시 샀을 때 옛 고점으로 즉시 청산되지 않게 */
export const clearPeak = (accountId: number, symbol: string): void => writePer<number>(PEAKS_KEY, accountId, symbol, null);

/** 마지막으로 신호를 본 시장 날짜 */
export const getJudgedDay = (accountId: number, symbol: string): string | null => readPer<string>(JUDGED_KEY, accountId, symbol);
export const setJudgedDay = (accountId: number, symbol: string, day: string): void => writePer(JUDGED_KEY, accountId, symbol, day);

/** 마지막 손절 날(시장 날짜) — 「손절 뒤 다시 매수」 대기. 트레일링·익절·신호 매도는 남기지 않는다 */
export const getStopDay = (accountId: number, symbol: string): string | null => readPer<string>(STOPS_KEY, accountId, symbol);
export const setStopDay = (accountId: number, symbol: string, day: string): void => writePer(STOPS_KEY, accountId, symbol, day);
