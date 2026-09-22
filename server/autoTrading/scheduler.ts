/**
 * 계좌별 자동매매 스케줄러 — **타이머는 하나뿐이다.**
 *
 * 계좌마다 타이머를 두면 계좌가 늘수록 Gemini 호출이 동시에 터져 분당 한도(RPM)에 걸린다.
 * 하나의 틱이 활성 계좌를 **순차로** 돌고, Gemini 호출은 `gemini/client.ts` 의 동시성 큐를
 * 그대로 지난다 — 계좌가 늘어도 전역 속도 제한이 유지된다.
 *
 * ⚠️ **주문을 내는 경로는 이 파일 하나뿐이다.** 전역 자동매매는 v2.4.0 에서 제거했다.
 * 틱이 겹치지 않게 `running` 으로 잠근다 (한 바퀴가 길어지면 다음 틱은 통째로 건너뛴다).
 *
 * 청산(손절·트레일링)은 **매 틱** 검사한다. 매수 판단만 계좌별 `intervalMinutes` 를 따른다 —
 * 급락은 60분을 기다려 주지 않는다.
 */

import { isUsMarketOpen } from '../marketHours';
import { runExitChecks, runStrategyCycle, refreshPeaks } from './engine';
import { listActiveStrategies, getStrategy } from './store';
import { isGeminiEnabled } from '../gemini/client';
import { countToday } from '../gemini/store';
import type { AccountStrategy, AccountStrategyStatus, AutoTradeRunResult } from '../../src/types/autoTrading';

/** 틱 간격 — 청산 검사 주기이기도 하다 */
const TICK_MS = 60_000;

let timer: NodeJS.Timeout | null = null;
let running = false;

interface RunState {
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastError: string | null;
  running: boolean;
}

/** 계좌별 실행 상태 (프로세스 메모리 — 재시작하면 다음 틱에 다시 잡힌다) */
const state = new Map<number, RunState>();

function stateOf(accountId: number): RunState {
  let found = state.get(accountId);
  if (!found) {
    found = { lastRunAt: null, nextRunAt: null, lastError: null, running: false };
    state.set(accountId, found);
  }
  return found;
}

/** 이 계좌가 지금 돌 수 없는 이유 (없으면 null) */
function blockedReason(strategy: AccountStrategy): string | null {
  if (!strategy.enabled) return null;
  if (strategy.mode === 'ai' && !isGeminiEnabled()) {
    return 'Gemini 키가 설정되지 않았습니다 — 규칙형으로 바꾸면 키 없이 동작합니다';
  }
  if (!strategy.symbols.length) return '자동매매 대상 종목이 없습니다';
  if (strategy.marketHoursOnly && !isUsMarketOpen()) return '정규장 시간이 아닙니다';
  return null;
}

export function getStrategyStatus(accountId: number): AccountStrategyStatus {
  const strategy = getStrategy(accountId);
  const s = stateOf(accountId);
  return {
    accountId,
    enabled: strategy.enabled,
    mode: strategy.mode,
    running: s.running,
    lastRunAt: s.lastRunAt,
    nextRunAt: s.nextRunAt,
    lastError: s.lastError,
    // 호출 수는 전역 집계다 — 계좌별로 나눠 세지 않는다 (한도가 전역이라 그게 의미 있는 수다)
    callsToday: strategy.mode === 'ai' ? countToday() : 0,
    blockedReason: blockedReason(strategy),
  };
}

/** 매수 판단을 돌 차례인지 — 청산은 이와 무관하게 매 틱 돈다 */
function dueForCycle(strategy: AccountStrategy): boolean {
  const s = stateOf(strategy.accountId);
  if (!s.lastRunAt) return true;
  return Date.now() >= new Date(s.lastRunAt).getTime() + strategy.intervalMinutes * 60_000;
}

/**
 * 한 계좌를 처리한다.
 * `force` 면 주기·정규장 판정을 건너뛴다 (사용자가 버튼으로 돌린 경우).
 */
export async function runAccount(accountId: number, force = false): Promise<AutoTradeRunResult> {
  const strategy = getStrategy(accountId);
  const s = stateOf(accountId);
  const result: AutoTradeRunResult = {
    accountId,
    evaluated: 0,
    ordered: 0,
    notes: [],
    errors: [],
    skipped: null,
  };

  if (!force && !strategy.enabled) {
    result.skipped = '자동매매가 꺼져 있습니다';
    return result;
  }

  s.running = true;
  try {
    /*
     * ① 청산 먼저. 자동매매를 꺼 두었어도 보유분의 손절은 돌아야 하는가? — 돌지 않는다.
     * 꺼 둔 계좌까지 주문을 내면 "껐는데 거래가 났다" 가 된다. 호출부가 활성 계좌만 넘긴다.
     */
    result.notes.push(...(await runExitChecks(strategy)));
    result.ordered += result.notes.filter((n) => n.orderId).length;

    // 정규장 밖에서는 청산만 하고 신규 판단은 쉰다 (수동 실행은 예외)
    if (!force && strategy.marketHoursOnly && !isUsMarketOpen()) {
      result.skipped = '정규장 시간이 아닙니다 (청산 검사만 수행)';
      s.nextRunAt = new Date(Date.now() + strategy.intervalMinutes * 60_000).toISOString();
      return result;
    }

    const cycle = await runStrategyCycle(strategy);
    result.evaluated = cycle.evaluated;
    result.ordered += cycle.ordered;
    result.notes.push(...cycle.notes);
    result.errors.push(...cycle.errors);
    result.skipped = cycle.skipped;

    s.lastRunAt = new Date().toISOString();
    s.nextRunAt = new Date(Date.now() + strategy.intervalMinutes * 60_000).toISOString();
    s.lastError = result.errors.length ? result.errors.join(' / ') : null;
  } catch (error) {
    s.lastError = (error as Error).message;
    result.errors.push(s.lastError);
  } finally {
    s.running = false;
  }

  return result;
}

async function tick(): Promise<void> {
  if (running) return; // 앞선 바퀴가 아직 돈다 — 겹쳐 돌면 같은 신호로 두 번 주문한다
  running = true;
  try {
    for (const strategy of listActiveStrategies()) {
      const s = stateOf(strategy.accountId);
      try {
        // 청산은 언제나 (분석 주기와 무관)
        await refreshPeaks(strategy);
        const exits = await runExitChecks(strategy);
        if (exits.length) s.lastError = null;

        // 매수·재평가는 주기가 됐을 때만
        if (!dueForCycle(strategy)) continue;
        if (strategy.marketHoursOnly && !isUsMarketOpen()) {
          s.nextRunAt = new Date(Date.now() + strategy.intervalMinutes * 60_000).toISOString();
          continue;
        }
        if (blockedReason(strategy)) continue;

        const cycle = await runStrategyCycle(strategy);
        s.lastRunAt = new Date().toISOString();
        s.nextRunAt = new Date(Date.now() + strategy.intervalMinutes * 60_000).toISOString();
        s.lastError = cycle.errors.length ? cycle.errors.join(' / ') : null;
      } catch (error) {
        s.lastError = (error as Error).message;
      }
    }
  } finally {
    running = false;
  }
}

export function startAutoTradingScheduler(): void {
  if (timer) return;
  timer = setInterval(() => void tick(), TICK_MS);
}

export function stopAutoTradingScheduler(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
