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
import { dailyLossBlock, evaluateDailyLoss } from './guards';
import { listActiveStrategies, getStrategy, readNotes, recordNotes } from './store';
import { geminiDisabledReason } from '../gemini/client';
import { countToday } from '../gemini/store';
import type {
  AccountStrategy,
  AccountStrategyStatus,
  AutoTradeRunResult,
  BlockedKind,
} from '../../src/types/autoTrading';

/**
 * 이 서버에서 자동매매를 돌리는가 — `AUTO_TRADING_ENABLED=false` 면 스케줄러를 시작하지 않고
 * 수동 실행도 막는다 (v2.16.0). **복사본 DB 로 띄운 테스트 서버**가 모의 주문·Gemini 호출을 하지 않게 하는 스위치다.
 */
export function isAutoTradingEnabled(): boolean {
  return process.env.AUTO_TRADING_ENABLED?.trim().toLowerCase() !== 'false';
}

export const SERVER_OFF_REASON = '이 서버에서는 자동매매가 꺼져 있습니다(AUTO_TRADING_ENABLED=false)';

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

/** 마지막 바퀴의 판단(건너뜀 사유 포함)을 저장한다 — 화면의 「최근 판단」 이 읽는다 */
function rememberNotes(accountId: number, notes: AutoTradeRunResult['notes']): void {
  recordNotes(accountId, notes);
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

/**
 * 이 계좌가 지금 돌 수 없는 이유 (없으면 null).
 *
 * ⚠️ **성격이 다른 두 가지를 한 문자열에 섞지 않는다** — `blockedKind` 로 함께 돌려준다.
 * - `market_closed` = **정상 대기**. 켜져 있고, 장이 열리면 저절로 돈다. 사람이 할 일이 없다.
 * - `config` = **설정 문제**. 키가 없거나 대상 종목이 0개라 사람이 고쳐야 돈다.
 * 둘 다 "멈춤" 으로 보이면 정상 대기를 고장으로 읽고(미국 정규장은 한국 시간으로 밤이다),
 * 반대로 진짜 고장 난 계좌를 방치하게 된다.
 */
function blocked(strategy: AccountStrategy): {
  reason: string | null;
  kind: BlockedKind;
} {
  if (!strategy.enabled) return { reason: null, kind: null };
  // 서버 스위치가 가장 먼저다 — 설정이 켜져 있어도 이 서버에서는 돌지 않는다
  if (!isAutoTradingEnabled()) return { reason: SERVER_OFF_REASON, kind: 'server_off' };
  const geminiOff = geminiDisabledReason();
  if (strategy.mode === 'ai' && geminiOff) {
    return {
      reason: `${geminiOff} — 규칙형으로 바꾸면 키 없이 동작합니다`,
      kind: 'config',
    };
  }
  if (!strategy.symbols.length) {
    return { reason: '자동매매 대상 종목이 없습니다', kind: 'config' };
  }
  /*
    하루 손실 한도(킬 스위치, v2.16.0) — ⚠ 멈춤으로 보이지만 **신규 매수만** 막힌 상태다.
    틱은 이 kind 로는 바퀴를 건너뛰지 않는다(보유 재평가 매도는 돌아야 한다). 매수는 tryBuy 가 막는다.
    장 마감(대기)보다 먼저 본다 — 닿은 사실이 "대기" 뒤에 가려지면 안 된다.
  */
  const loss = dailyLossBlock(strategy);
  if (loss) return { reason: loss, kind: 'daily_loss' };
  if (strategy.marketHoursOnly && !isUsMarketOpen()) {
    return { reason: '정규장 시간이 아닙니다', kind: 'market_closed' };
  }
  return { reason: null, kind: null };
}

export function getStrategyStatus(accountId: number): AccountStrategyStatus {
  const strategy = getStrategy(accountId);
  const s = stateOf(accountId);
  const b = blocked(strategy);
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
    blockedReason: b.reason,
    blockedKind: b.kind,
    serverEnabled: isAutoTradingEnabled(),
    lastNotes: readNotes(accountId).notes,
    lastNotesAt: readNotes(accountId).at,
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
    // 청산 다음에 하루 손실 한도를 잰다 (신규 매수 차단 여부)
    await evaluateDailyLoss(strategy).catch(() => null);

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
    rememberNotes(accountId, result.notes);
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
        if (exits.length) {
          s.lastError = null;
          rememberNotes(strategy.accountId, exits);
        }
        // ② 청산 다음 — 하루 손실 한도를 1분마다 잰다 (닿으면 그 거래일 끝까지 신규 매수 차단)
        await evaluateDailyLoss(strategy).catch((e) => {
          s.lastError = `하루 손실 한도 계산 실패: ${(e as Error).message}`;
        });

        // 매수·재평가는 주기가 됐을 때만
        if (!dueForCycle(strategy)) continue;
        if (strategy.marketHoursOnly && !isUsMarketOpen()) {
          s.nextRunAt = new Date(Date.now() + strategy.intervalMinutes * 60_000).toISOString();
          continue;
        }
        // 킬 스위치(daily_loss)로는 바퀴를 건너뛰지 않는다 — 보유 재평가 매도는 돌고, 매수만 tryBuy 가 막는다
        const b = blocked(strategy);
        if (b.reason && b.kind !== 'daily_loss') continue;

        const cycle = await runStrategyCycle(strategy);
        s.lastRunAt = new Date().toISOString();
        s.nextRunAt = new Date(Date.now() + strategy.intervalMinutes * 60_000).toISOString();
        s.lastError = cycle.errors.length ? cycle.errors.join(' / ') : null;
        rememberNotes(strategy.accountId, cycle.notes);
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
  if (!isAutoTradingEnabled()) return; // 호출부(index.ts)가 로그를 남긴다
  timer = setInterval(() => void tick(), TICK_MS);
}

export function stopAutoTradingScheduler(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
