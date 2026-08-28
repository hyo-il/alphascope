/**
 * 자동 분석 스케줄러.
 *
 * 종목은 순차로 돈다. 종목까지 병렬로 돌리면 동시 요청이 종목 수 × 4 가 되어
 * 무료 티어의 분당 한도에 바로 걸린다 (실질 병목은 하루 한도가 아니라 RPM 이다).
 */

import type { AutoAnalysisSettings, AutoAnalysisStatus } from '../../src/types/gemini';
import { DEFAULT_HORIZON } from '../../src/services/analysis/horizons';
import { applySignal } from './autoTrade';
import { runAnalysis } from './analyze';
import { GeminiError, isGeminiEnabled } from './client';
import { countToday, readSetting, writeSetting } from './store';

const SETTINGS_KEY = 'autoAnalysis';

export const DEFAULT_SETTINGS: AutoAnalysisSettings = {
  enabled: false,
  symbols: [],
  intervalMinutes: 60,
  marketHoursOnly: true,
  horizon: DEFAULT_HORIZON,

  autoTrade: false,
  paperAccountId: null,
  buySignal: 'BUY',
  buyMinConfidence: 0.7,
  sellSignal: 'SELL',
  sellMinConfidence: 0.7,
  positionSizePercent: 10,
  maxPositions: 5,
};

let timer: NodeJS.Timeout | null = null;
let running = false;
let lastRunAt: string | null = null;
let nextRunAt: string | null = null;
let lastError: string | null = null;

export function getSettings(): AutoAnalysisSettings {
  const saved = readSetting<Partial<AutoAnalysisSettings>>(SETTINGS_KEY, {});
  const merged = { ...DEFAULT_SETTINGS, ...saved };

  // 예전 설정은 매수·매도 신뢰도가 하나(minConfidence)였다.
  // 저장된 값을 버리면 사용자가 맞춰 둔 기준이 조용히 기본값으로 돌아간다.
  if (saved.minConfidence != null) {
    if (saved.buyMinConfidence == null) merged.buyMinConfidence = saved.minConfidence;
    if (saved.sellMinConfidence == null) merged.sellMinConfidence = saved.minConfidence;
  }
  delete merged.minConfidence;
  return merged;
}

export function getStatus(): AutoAnalysisStatus {
  const settings = getSettings();
  return {
    enabled: settings.enabled,
    running,
    lastRunAt,
    nextRunAt,
    lastError,
    callsToday: countToday(),
  };
}

export function saveSettings(patch: Partial<AutoAnalysisSettings>): AutoAnalysisSettings {
  const next = { ...getSettings(), ...patch };
  // 토스 symbol 은 영문·숫자·점·하이픈만 허용한다. 한글 종목명("애플")이 들어오면
  // 분석이 매번 실패하고 그 사실은 결과 목록에 가서야 드러나므로 저장 단계에서 거른다.
  next.symbols = [
    ...new Set(
      next.symbols
        .map((s) => s.trim().toUpperCase())
        .filter((s) => s && /^[A-Z0-9.\-]+$/.test(s)),
    ),
  ];
  next.intervalMinutes = Math.max(5, Math.round(next.intervalMinutes));
  next.buyMinConfidence = Math.min(1, Math.max(0, next.buyMinConfidence));
  next.sellMinConfidence = Math.min(1, Math.max(0, next.sellMinConfidence));
  next.positionSizePercent = Math.min(100, Math.max(1, next.positionSizePercent));
  next.maxPositions = Math.min(50, Math.max(1, Math.round(next.maxPositions)));
  delete next.minConfidence;
  writeSetting(SETTINGS_KEY, next);
  reschedule();
  return next;
}

/**
 * 미국 정규장(09:30~16:00 ET) 여부.
 *
 * 공휴일까지 보지는 않는다 — 휴장일에 한 번 더 도는 비용은 분석 5회로 작고,
 * 캘린더를 잘못 판단해 장중에 쉬는 쪽이 더 나쁘다.
 */
function isUsMarketOpen(now = new Date()): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const weekday = get('weekday');
  if (weekday === 'Sat' || weekday === 'Sun') return false;
  const minutes = Number(get('hour')) * 60 + Number(get('minute'));
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60;
}

/** 설정에서 자동매매 쪽 값만 뽑는다 — 라우트와 스케줄러가 같은 규칙을 쓰도록 */
export function tradeOptionsOf(settings: AutoAnalysisSettings) {
  return {
    accountId: settings.paperAccountId!,
    buySignal: settings.buySignal,
    buyMinConfidence: settings.buyMinConfidence,
    sellSignal: settings.sellSignal,
    sellMinConfidence: settings.sellMinConfidence,
    positionSizePercent: settings.positionSizePercent,
    maxPositions: settings.maxPositions,
  };
}

/** 한 바퀴: 설정된 종목을 순서대로 분석하고, 필요하면 주문까지 건다. */
export async function runOnce(trigger: 'auto' | 'manual' = 'auto'): Promise<{
  analyzed: number;
  skipped: string | null;
  errors: string[];
}> {
  const settings = getSettings();
  const errors: string[] = [];

  if (!isGeminiEnabled()) return { analyzed: 0, skipped: 'GEMINI_API_KEY 없음', errors };
  if (!settings.symbols.length) return { analyzed: 0, skipped: '분석할 종목이 없습니다', errors };
  if (running) return { analyzed: 0, skipped: '이미 실행 중입니다', errors };
  if (trigger === 'auto' && settings.marketHoursOnly && !isUsMarketOpen()) {
    return { analyzed: 0, skipped: '정규장 시간이 아닙니다', errors };
  }

  running = true;
  let analyzed = 0;
  try {
    for (const symbol of settings.symbols) {
      try {
        const analysis = await runAnalysis({ symbol, trigger, horizon: settings.horizon });
        analyzed++;
        if (settings.autoTrade && settings.paperAccountId) {
          await applySignal(analysis, tradeOptionsOf(settings));
        }
      } catch (error) {
        errors.push(`${symbol}: ${(error as Error).message}`);
        // 한도 초과는 남은 종목도 전부 실패한다 — 바퀴를 즉시 끝낸다.
        if (error instanceof GeminiError && error.rateLimited) break;
      }
    }
    lastRunAt = new Date().toISOString();
    lastError = errors.length ? errors.join(' / ') : null;
  } finally {
    running = false;
  }
  return { analyzed, skipped: null, errors };
}

/** 설정에 맞춰 타이머를 다시 건다 */
export function reschedule(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
    nextRunAt = null;
  }
  const settings = getSettings();
  if (!settings.enabled || !isGeminiEnabled()) return;

  const periodMs = settings.intervalMinutes * 60_000;
  nextRunAt = new Date(Date.now() + periodMs).toISOString();
  timer = setInterval(() => {
    nextRunAt = new Date(Date.now() + periodMs).toISOString();
    void runOnce('auto').catch((error) => {
      lastError = (error as Error).message;
    });
  }, periodMs);
}

/** 서버 기동 시 한 번 호출한다. 키가 없으면 아무 일도 하지 않는다. */
export function startScheduler(): void {
  if (!isGeminiEnabled()) return;
  reschedule();
}
