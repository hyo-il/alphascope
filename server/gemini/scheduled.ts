/**
 * 내가 지정한 종목 — 하루 1번 Gemini 분석 (v2.23.0).
 *
 * - 최대 10종목(하루 최대 50호출). 저장은 `gemini_settings` 의 키 두 개(목록·상태).
 * - **미국 정규장 마감 30분 뒤 이후 첫 틱**에 그 미국 거래일 기준으로 1번. 휴장일(주말 포함)은 건너뛴다.
 *   국내 종목도 같은 시각에 돈다(그때는 국내장도 닫혀 마지막 종가 기준이다).
 * - 마지막 실행 기준일을 DB 에 남겨 **재시작해도 같은 날 두 번 돌지 않는다.**
 * - 그날 저녁 서버가 내내 꺼져 있어 놓쳤으면, 다음 확인 때 **직전 거래일 1회분만 보충**한다(다음 미국 장 시작 전까지만, v2.24.0).
 * - 종목은 순차로, Gemini 호출은 `client.ts` 의 동시성 큐를 그대로 지난다. 한 종목 실패는 기록하고 계속,
 *   **한도 초과(429)면 그날 남은 종목은 중단**한다.
 * - ⚠️ **주문을 내지 않는다.** 분석만 한다 — 주문 경로는 계좌 스케줄러(`autoTrading/`) 하나뿐이다.
 *   그래서 이 파일은 `runAnalysis` 만 부르고 모의투자 모듈을 import 하지 않는다.
 * - 스위치: `isGeminiEnabled()`(테스트 서버의 GEMINI_ENABLED=false 포함) + `GEMINI_SCHEDULED_ENABLED`(기본 true).
 * - 타이머를 새로 두지 않는다 — 모의투자 스냅샷 스케줄러의 10분 확인에 얹는다(`index.ts`).
 *   그 스케줄러는 `AUTO_TRADING_ENABLED` 와 무관하게 늘 돌므로, 이 분석은 Gemini 스위치만 따른다.
 */

import { isMarketClosed } from '../marketCalendar';
import { marketCloseMinutes, marketDate, marketMinutes } from '../../src/utils/marketDate';
import { runAnalysis } from './analyze';
import { geminiDisabledReason, GeminiError } from './client';
import { readSetting, writeSetting } from './store';
import type { GeminiAnalysis } from '../../src/types/gemini';

export const SCHEDULED_MAX = 10;
/** 마감 뒤 데이터가 완성될 시간 */
export const SCHEDULED_DELAY_MINUTES = 30;
const SYMBOLS_KEY = 'scheduled_symbols';
const STATE_KEY = 'scheduled_state';
/** 기준 시장 — 미국 마감 시각·미국 휴장일로 정한다 */
const REF = 'AAPL';

export interface ScheduledRunResult {
  /** 그 미국 거래일 (YYYY-MM-DD) */
  baseDate: string;
  startedAt: string;
  finishedAt: string | null;
  /** schedule = 그날 정기 실행 · catchup = 놓친 날 보충(v2.24.0) · manual = 지금 한 번 실행 */
  trigger: 'schedule' | 'catchup' | 'manual';
  done: { symbol: string; signal: string; confidence: number }[];
  failed: { symbol: string; error: string }[];
  /** 한도 초과로 멈춰 분석하지 못한 종목 */
  skipped: string[];
  rateLimited: boolean;
}

export interface ScheduledState {
  /** 정기 실행을 마친 마지막 기준일 — 같은 날 두 번 돌지 않는 근거 */
  lastBaseDate: string | null;
  last: ScheduledRunResult | null;
}

export interface ScheduledStatus {
  symbols: string[];
  max: number;
  running: boolean;
  /** 돌지 않는 이유 (Gemini 꺼짐·스위치) — 없으면 null */
  disabledReason: string | null;
  lastBaseDate: string | null;
  last: ScheduledRunResult | null;
  /** 다음 정기 실행 예정 시각(ISO, 대략 — 실제는 그 뒤 첫 10분 확인) */
  nextRunAt: string | null;
}

export class ScheduledError extends Error {}

// ── 저장 ────────────────────────────────────────────────

export function getScheduledSymbols(): string[] {
  const list = readSetting<unknown>(SYMBOLS_KEY, []);
  return Array.isArray(list) ? list.filter((s): s is string => typeof s === 'string') : [];
}

const SYMBOL_RE = /^[A-Z0-9][A-Z0-9.\-]{0,14}$/;

/** 목록 저장 — 형식 검사·중복 제거, 10개 초과는 거절 */
export function saveScheduledSymbols(input: unknown): string[] {
  if (!Array.isArray(input)) throw new ScheduledError('symbols 는 배열이어야 합니다.');
  const symbols = [...new Set(input.map((s) => String(s ?? '').trim().toUpperCase()).filter(Boolean))];
  const bad = symbols.filter((s) => !SYMBOL_RE.test(s));
  if (bad.length) throw new ScheduledError(`티커 형식이 아닙니다: ${bad.join(', ')} (한글 이름은 검색에서 골라 주세요)`);
  if (symbols.length > SCHEDULED_MAX) {
    throw new ScheduledError(`지정 종목은 최대 ${SCHEDULED_MAX}개입니다 (하루 최대 ${SCHEDULED_MAX * 5}호출).`);
  }
  writeSetting(SYMBOLS_KEY, symbols);
  return symbols;
}

function readState(): ScheduledState {
  const state = readSetting<ScheduledState | null>(STATE_KEY, null);
  return { lastBaseDate: state?.lastBaseDate ?? null, last: state?.last ?? null };
}

function writeState(state: ScheduledState): void {
  writeSetting(STATE_KEY, state);
}

// ── 스위치 ──────────────────────────────────────────────

export function scheduledDisabledReason(): string | null {
  const gemini = geminiDisabledReason();
  if (gemini) return gemini;
  if (process.env.GEMINI_SCHEDULED_ENABLED?.trim().toLowerCase() === 'false') {
    return '이 서버에서는 지정 종목 분석이 꺼져 있습니다(GEMINI_SCHEDULED_ENABLED=false)';
  }
  return null;
}

// ── 판정 (시계를 주입할 수 있다 — 점검 스크립트가 쓴다) ──────────────

/**
 * 지금 정기 실행을 해야 하나 — 해야 하면 그 기준일, 아니면 null.
 * 기준일 = 지금의 미국(ET) 날짜. 휴장일·마감+30분 전·이미 그날 돈 날은 null.
 */
export function dueBaseDate(now: number, lastBaseDate: string | null, closed = isMarketClosed): string | null {
  const day = marketDate(now, REF);
  if (closed('US', day)) return null;
  if (marketMinutes(now, REF) < marketCloseMinutes(REF) + SCHEDULED_DELAY_MINUTES) return null;
  if (lastBaseDate === day) return null;
  return day;
}

/** 정규장 시작 — 미국 09:30 ET (보충 실행은 이 시각 전까지만) */
const US_OPEN_MINUTES = 9 * 60 + 30;

/** day 바로 앞의 미국 거래일 (주말·휴장 건너뜀) */
function previousTradingDay(day: string, closed: typeof isMarketClosed): string {
  const d = new Date(`${day}T12:00:00Z`);
  for (let i = 0; i < 15; i++) {
    d.setUTCDate(d.getUTCDate() - 1);
    const key = d.toISOString().slice(0, 10);
    if (!closed('US', key)) return key;
  }
  return day;
}

/**
 * 놓친 날 보충(v2.24.0) — 마지막 기준일이 **직전 미국 거래일보다 이전**이면 그 직전 거래일 **1회분만**.
 * - 여러 날이 밀려 있어도 직전 거래일 하나만(그보다 앞의 날은 버린다).
 * - **다음 미국 장이 열리기 전까지만** — 오늘이 거래일이고 09:30 ET 가 지났으면 보충하지 않는다
 *   (그날 분석은 마감 뒤 정기 실행이 맡는다). 오늘이 휴장일이면 다음 개장 전이므로 보충할 수 있다.
 * - 한 번도 돈 적이 없으면(lastBaseDate null) 보충하지 않는다 — 종목을 막 지정했을 때 바로 돌지 않게.
 */
export function catchUpBaseDate(now: number, lastBaseDate: string | null, closed = isMarketClosed): string | null {
  if (!lastBaseDate) return null;
  const day = marketDate(now, REF);
  if (!closed('US', day) && marketMinutes(now, REF) >= US_OPEN_MINUTES) return null;
  const prev = previousTradingDay(day, closed);
  return lastBaseDate < prev ? prev : null;
}

export interface ScheduledDeps {
  analyze: (symbol: string) => Promise<Pick<GeminiAnalysis, 'signal' | 'confidence'>>;
  now: () => number;
}

const defaultDeps: ScheduledDeps = {
  analyze: (symbol) => runAnalysis({ symbol, trigger: 'scheduled', horizon: 'swing' }),
  now: () => Date.now(),
};

let running = false;

/** 실제 실행 — 순차, 실패는 기록하고 계속, 429 면 남은 종목 중단 */
async function runList(
  symbols: string[],
  baseDate: string,
  trigger: ScheduledRunResult['trigger'],
  deps: ScheduledDeps,
): Promise<ScheduledRunResult> {
  const result: ScheduledRunResult = {
    baseDate,
    startedAt: new Date(deps.now()).toISOString(),
    finishedAt: null,
    trigger,
    done: [],
    failed: [],
    skipped: [],
    rateLimited: false,
  };
  for (let i = 0; i < symbols.length; i++) {
    const symbol = symbols[i];
    try {
      const analysis = await deps.analyze(symbol);
      result.done.push({ symbol, signal: analysis.signal, confidence: analysis.confidence });
    } catch (error) {
      const message = (error as Error).message;
      result.failed.push({ symbol, error: message });
      if (error instanceof GeminiError && error.rateLimited) {
        result.rateLimited = true;
        result.skipped = symbols.slice(i + 1);
        break;
      }
    }
  }
  result.finishedAt = new Date(deps.now()).toISOString();
  return result;
}

/**
 * 10분 확인마다 부른다. 할 일이 없으면 아무것도 하지 않는다.
 * 돌았으면 결과를 돌려준다(점검용).
 */
export async function scheduledTick(deps: ScheduledDeps = defaultDeps, closed = isMarketClosed): Promise<ScheduledRunResult | null> {
  if (running || scheduledDisabledReason()) return null;
  const symbols = getScheduledSymbols();
  if (!symbols.length) return null;
  const state = readState();
  const today = dueBaseDate(deps.now(), state.lastBaseDate, closed);
  const catchUp = today ? null : catchUpBaseDate(deps.now(), state.lastBaseDate, closed);
  const baseDate = today ?? catchUp;
  if (!baseDate) return null;

  running = true;
  // 시작할 때 먼저 기준일을 남긴다 — 도중에 서버가 내려가도 같은 날 처음부터 다시 돌며 호출을 두 번 쓰지 않는다
  writeState({ ...state, lastBaseDate: baseDate });
  try {
    const result = await runList(symbols, baseDate, catchUp ? 'catchup' : 'schedule', deps);
    writeState({ lastBaseDate: baseDate, last: result });
    console.log(
      `[gemini] 지정 종목 ${baseDate}${catchUp ? '(놓친 날 보충)' : ''}: 완료 ${result.done.length} · 실패 ${result.failed.length}` +
        (result.rateLimited ? ` · 한도 초과로 ${result.skipped.length}종목 중단` : ''),
    );
    return result;
  } finally {
    running = false;
  }
}

/**
 * 「지금 한 번 실행」 — 정기 실행을 **대신하지 않는다**(기준일을 남기지 않는다).
 * 끝날 때까지 기다리지 않고 시작만 한다 — 10종목이면 1분을 넘는다.
 */
export function runScheduledNow(deps: ScheduledDeps = defaultDeps): { started: boolean } {
  const reason = scheduledDisabledReason();
  if (reason) throw new ScheduledError(reason);
  if (running) throw new ScheduledError('지정 종목 분석이 이미 실행 중입니다.');
  const symbols = getScheduledSymbols();
  if (!symbols.length) throw new ScheduledError('지정한 종목이 없습니다.');

  running = true;
  const baseDate = marketDate(deps.now(), REF);
  void runList(symbols, baseDate, 'manual', deps)
    .then((result) => writeState({ ...readState(), last: result }))
    .catch((error) => console.warn('[gemini] 지정 종목 즉시 실행 실패:', (error as Error).message))
    .finally(() => {
      running = false;
    });
  return { started: true };
}

/** 다음 정기 실행 예정(대략) — 오늘 아직이면 오늘 마감+30분, 아니면 다음 개장일의 그 시각 */
function nextRunAt(now: number, lastBaseDate: string | null): string | null {
  for (let i = 0; i < 10; i++) {
    const t = now + i * 86_400_000;
    const day = marketDate(t, REF);
    if (isMarketClosed('US', day) || day === lastBaseDate) continue;
    // 그날 ET 마감+30분을 UTC 로 — 시차는 그 시각의 ET 분으로 역산한다
    const target = marketCloseMinutes(REF) + SCHEDULED_DELAY_MINUTES;
    const diffMin = target - marketMinutes(t, REF);
    const at = t + diffMin * 60_000;
    if (i === 0 && at < now) return new Date(now).toISOString(); // 지금 바로(다음 확인 때)
    return new Date(at).toISOString();
  }
  return null;
}

export function getScheduledStatus(now = Date.now()): ScheduledStatus {
  const state = readState();
  const disabledReason = scheduledDisabledReason();
  return {
    symbols: getScheduledSymbols(),
    max: SCHEDULED_MAX,
    running,
    disabledReason,
    lastBaseDate: state.lastBaseDate,
    last: state.last,
    nextRunAt: disabledReason ? null : nextRunAt(now, state.lastBaseDate),
  };
}
