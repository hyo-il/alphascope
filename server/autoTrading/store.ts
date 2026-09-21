/**
 * 계좌별 자동매매 설정 저장소.
 *
 * 저장은 `gemini_settings` 테이블(key-value)을 재사용한다 — 새 테이블을 만들 만큼
 * 구조가 복잡하지 않고, 이미 있는 읽기/쓰기 유틸을 그대로 쓸 수 있다.
 *
 * ⚠️ **계좌마다 키를 나누지 않고 맵 하나에 담는다.** 스케줄러가 "활성화된 계좌 전부" 를
 * 매 틱 훑어야 하는데, 키가 흩어져 있으면 계좌 목록을 따로 들고 다녀야 한다.
 */

import { readSetting, writeSetting } from '../gemini/store';
import { listAccounts } from '../paperTradingService';
import {
  DEFAULT_RULE,
  defaultStrategy,
  type AccountStrategy,
  type RuleConfig,
  type StrategyMode,
} from '../../src/types/autoTrading';
import type { AutoAnalysisSettings } from '../../src/types/gemini';

const STRATEGIES_KEY = 'autoTrading.strategies';
const MIGRATED_KEY = 'autoTrading.migratedFromGlobal';
const PEAKS_KEY = 'autoTrading.trailingPeaks';
const LEGACY_GLOBAL_KEY = 'autoAnalysis';

type StrategyMap = Record<string, AccountStrategy>;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : min));

/** 토스 symbol 은 영문·숫자·점·하이픈만 허용한다 (한글 종목명이 들어오면 매번 실패한다) */
const SYMBOL_PATTERN = /^[A-Z0-9.\-]+$/;

function cleanSymbols(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : [];
  return [
    ...new Set(
      list
        .map((s) => String(s).trim().toUpperCase())
        .filter((s) => s && s.length <= 20 && SYMBOL_PATTERN.test(s)),
    ),
  ];
}

function cleanRule(raw: Partial<RuleConfig> | undefined): RuleConfig {
  const r = { ...DEFAULT_RULE, ...(raw ?? {}) };
  const maShort = clamp(Math.round(r.maShort), 2, 120);
  // 단기가 장기보다 길면 교차 판정이 뒤집힌다 — 최소 한 칸은 벌려 둔다.
  const maLong = clamp(Math.round(r.maLong), maShort + 1, 240);
  return {
    maShort,
    maLong,
    rsiBuyBelow: clamp(r.rsiBuyBelow, 5, 50),
    rsiSellAbove: clamp(r.rsiSellAbove, 50, 95),
    useMaCross: Boolean(r.useMaCross),
    useRsi: Boolean(r.useRsi),
  };
}

/** 저장 전 값을 조인다 — 화면 입력만 믿으면 거래량 0%, 손절 0% 같은 값이 그대로 들어온다 */
export function normalizeStrategy(accountId: number, raw: Partial<AccountStrategy>): AccountStrategy {
  const base = defaultStrategy(accountId);
  const next = { ...base, ...raw, accountId };

  next.mode = (next.mode === 'rule' ? 'rule' : 'ai') as StrategyMode;
  next.enabled = Boolean(next.enabled);
  next.symbols = cleanSymbols(next.symbols);

  next.positionSizePercent = clamp(next.positionSizePercent, 1, 100);
  next.maxPositions = clamp(Math.round(next.maxPositions), 1, 50);
  next.intervalMinutes = Math.max(5, Math.round(next.intervalMinutes));
  next.marketHoursOnly = Boolean(next.marketHoursOnly);

  /*
   * 손절 0% 는 "사자마자 손절" 이고 100% 는 "사실상 없음" 이다. 둘 다 사고이므로 막는다.
   * 하한을 1% 로 둔 이유: 수수료·슬리피지만으로도 -0.3% 가 찍혀서, 그보다 낮으면
   * 체결 직후 곧바로 청산된다.
   */
  next.hardStopLossPercent = clamp(next.hardStopLossPercent, 1, 50);
  next.trailingStopEnabled = Boolean(next.trailingStopEnabled);
  next.trailingStopPercent = clamp(next.trailingStopPercent, 1, 50);

  next.buySignal = next.buySignal === 'STRONG_BUY' ? 'STRONG_BUY' : 'BUY';
  next.sellSignal = next.sellSignal === 'STRONG_SELL' ? 'STRONG_SELL' : 'SELL';
  next.buyMinConfidence = clamp(next.buyMinConfidence, 0, 1);
  next.sellMinConfidence = clamp(next.sellMinConfidence, 0, 1);

  next.rule = cleanRule(next.rule);
  return next;
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

export function saveStrategy(accountId: number, patch: Partial<AccountStrategy>): AccountStrategy {
  const merged = normalizeStrategy(accountId, { ...getStrategy(accountId), ...patch });
  const map = readMap();
  map[String(accountId)] = merged;
  writeMap(map);
  return merged;
}

/** 계좌를 지우면 설정·고점 기록도 함께 지운다 (남겨 두면 계좌 id 가 재사용될 때 섞인다) */
export function deleteStrategy(accountId: number): void {
  const map = readMap();
  delete map[String(accountId)];
  writeMap(map);

  const peaks = readPeaks();
  delete peaks[String(accountId)];
  writeSetting(PEAKS_KEY, peaks);
}

// ── 트레일링 스톱의 고점 기록 ────────────────────────────────
// { accountId: { symbol: 고점 } }

type PeakMap = Record<string, Record<string, number>>;

function readPeaks(): PeakMap {
  return readSetting<PeakMap>(PEAKS_KEY, {});
}

export function getPeak(accountId: number, symbol: string): number | null {
  return readPeaks()[String(accountId)]?.[symbol] ?? null;
}

/** 고점은 올라갈 때만 갱신한다 — 내려갈 때 따라 내리면 트레일링이 아니다 */
export function updatePeak(accountId: number, symbol: string, price: number): number {
  if (!Number.isFinite(price) || price <= 0) return getPeak(accountId, symbol) ?? 0;
  const peaks = readPeaks();
  const forAccount = peaks[String(accountId)] ?? {};
  const next = Math.max(forAccount[symbol] ?? 0, price);
  forAccount[symbol] = next;
  peaks[String(accountId)] = forAccount;
  writeSetting(PEAKS_KEY, peaks);
  return next;
}

/** 포지션을 정리했으면 고점도 버린다 — 다음에 다시 샀을 때 옛 고점으로 즉시 청산되지 않게 */
export function clearPeak(accountId: number, symbol: string): void {
  const peaks = readPeaks();
  const forAccount = peaks[String(accountId)];
  if (!forAccount || !(symbol in forAccount)) return;
  delete forAccount[symbol];
  peaks[String(accountId)] = forAccount;
  writeSetting(PEAKS_KEY, peaks);
}

// ── 전역 설정 → 계좌별 1회 마이그레이션 ──────────────────────

/**
 * 기존 전역 `autoAnalysis` 에 자동매매가 켜져 있었다면, 그 값을 해당 계좌로 한 번 옮긴다.
 *
 * ⚠️ **원본은 지우지 않는다.** 2단계에서 화면을 바꿀 때까지 기존 설정 API 가 살아 있어야
 * 지금 화면이 깨지지 않는다 (지우는 것은 3단계 몫이다).
 */
export function migrateGlobalStrategy(): { migrated: boolean; accountId?: number; reason: string } {
  if (readSetting<boolean>(MIGRATED_KEY, false)) {
    return { migrated: false, reason: '이미 마이그레이션했습니다' };
  }

  const global = readSetting<Partial<AutoAnalysisSettings> | null>(LEGACY_GLOBAL_KEY, null);
  // 자동매매가 꺼져 있었으면 옮길 전략이 없다 — 분석만 쓰던 설정이다.
  if (!global?.autoTrade || !global.paperAccountId) {
    writeSetting(MIGRATED_KEY, true);
    return { migrated: false, reason: '옮길 전역 자동매매 설정이 없습니다' };
  }

  const accountId = Number(global.paperAccountId);
  if (!listAccounts().some((a) => a.id === accountId)) {
    writeSetting(MIGRATED_KEY, true);
    return { migrated: false, reason: `계좌 #${accountId} 가 없습니다` };
  }

  saveStrategy(accountId, {
    enabled: Boolean(global.enabled),
    mode: 'ai',
    symbols: cleanSymbols(global.symbols),
    positionSizePercent: global.positionSizePercent ?? 10,
    maxPositions: global.maxPositions ?? 5,
    intervalMinutes: global.intervalMinutes ?? 60,
    marketHoursOnly: global.marketHoursOnly ?? true,
    buySignal: global.buySignal ?? 'BUY',
    buyMinConfidence: global.buyMinConfidence ?? global.minConfidence ?? 0.7,
    sellSignal: global.sellSignal ?? 'SELL',
    sellMinConfidence: global.sellMinConfidence ?? global.minConfidence ?? 0.7,
    horizon: global.horizon ?? 'swing',
  });
  writeSetting(MIGRATED_KEY, true);
  return { migrated: true, accountId, reason: `계좌 #${accountId} 로 옮겼습니다` };
}
