/**
 * 계좌별 자동매매 스케줄러 — **타이머는 하나뿐이다** (60초 틱).
 *
 * ⚠️ **주문을 내는 경로는 이 파일 하나뿐이다.** 틱이 겹치지 않게 `running` 으로 잠근다.
 *
 * 매 틱 ① 트레일링 고점 · ② 청산(규칙의 손절 → 익절 → 트레일링) · ③ 하루 손실 한도 · ④ 신호 판단(종목마다 그 시장이 열린 뒤
 * 하루 한 번 — `engine.runSignalChecks` 가 시장 날짜로 거른다). 
 */

import { isSymbolMarketOpen, marketOf, nextMarketOpen } from '../marketHours';
import { runExitChecks, runSignalChecks, refreshPeaks } from './engine';
import { dailyLossBlock, evaluateDailyLoss } from './guards';
import { listActiveStrategies, getStrategy, getJudgedDay, readNotes, recordNotes } from './store';
import { getRule } from '../rules/store';
import { marketDate } from '../../src/utils/marketDate';
import type { AccountStrategy, AccountStrategyStatus, AutoTradeRunResult, BlockedKind } from '../../src/types/autoTrading';
import type { RuleBody } from '../../src/types/tradingRule';

/**
 * 이 서버에서 자동매매를 돌리는가 — `AUTO_TRADING_ENABLED=false` 면 스케줄러를 시작하지 않고
 * 수동 실행도 막는다. **복사본 DB 로 띄운 테스트 서버**가 모의 주문을 하지 않게 하는 스위치다.
 */
export function isAutoTradingEnabled(): boolean {
  return process.env.AUTO_TRADING_ENABLED?.trim().toLowerCase() !== 'false';
}

export const SERVER_OFF_REASON = '이 서버에서는 자동매매가 꺼져 있습니다(AUTO_TRADING_ENABLED=false)';
export const NO_RULE_REASON = '매매 규칙을 고르세요.';

/** 틱 간격 — 청산 검사 주기이기도 하다 */
const TICK_MS = 60_000;

let timer: NodeJS.Timeout | null = null;
let running = false;

interface RunState {
  lastRunAt: string | null;
  lastError: string | null;
  running: boolean;
}

/** 계좌별 실행 상태 (프로세스 메모리) */
const state = new Map<number, RunState>();

function stateOf(accountId: number): RunState {
  let found = state.get(accountId);
  if (!found) {
    found = { lastRunAt: null, lastError: null, running: false };
    state.set(accountId, found);
  }
  return found;
}

/** 계좌가 쓰는 규칙 — 없거나 지워졌으면 null */
export function ruleOf(strategy: AccountStrategy): RuleBody | null {
  return strategy.ruleId != null ? getRule(strategy.ruleId) : null;
}

/**
 * 이 계좌가 지금 돌 수 없는 이유 (없으면 null).
 * ⚠️ 성격이 다른 것을 한 문자열에 섞지 않는다 — `blockedKind` 로 함께 돌려준다.
 * - `market_closed` = 정상 대기(대상 종목의 시장이 모두 닫혀 있다) · `config` = 사람이 고쳐야 한다(규칙 없음 · 종목 0개)
 */
function blocked(strategy: AccountStrategy, now = new Date()): { reason: string | null; kind: BlockedKind } {
  if (!strategy.enabled) return { reason: null, kind: null };
  if (!isAutoTradingEnabled()) return { reason: SERVER_OFF_REASON, kind: 'server_off' };
  if (!ruleOf(strategy)) return { reason: NO_RULE_REASON, kind: 'config' };
  if (!strategy.symbols.length) return { reason: '자동매매 대상 종목이 없습니다', kind: 'config' };
  // 하루 손실 한도 — 신규 매수만 막힌 상태. 장 닫힘(대기)보다 먼저 본다(닿은 사실이 "대기" 뒤에 가려지면 안 된다)
  const loss = dailyLossBlock(strategy);
  if (loss) return { reason: loss, kind: 'daily_loss' };
  if (!strategy.symbols.some((s) => isSymbolMarketOpen(s, now))) {
    return { reason: '대상 종목의 시장이 모두 닫혀 있습니다', kind: 'market_closed' };
  }
  return { reason: null, kind: null };
}

export function getStrategyStatus(accountId: number): AccountStrategyStatus {
  const strategy = getStrategy(accountId);
  const s = stateOf(accountId);
  const b = blocked(strategy);
  const now = Date.now();
  const notes = readNotes(accountId);
  return {
    accountId,
    enabled: strategy.enabled,
    running: s.running,
    lastRunAt: s.lastRunAt,
    lastError: s.lastError,
    blockedReason: b.reason,
    blockedKind: b.kind,
    serverEnabled: isAutoTradingEnabled(),
    judgedToday: strategy.symbols.filter((sym) => getJudgedDay(accountId, sym) === marketDate(now, sym)).length,
    nextOpen: Object.fromEntries([...new Set(strategy.symbols.map(marketOf))].map((m) => [m, nextMarketOpen(m, new Date(now)).toISOString()])),
    lastNotes: notes.notes,
    lastNotesAt: notes.at,
  };
}

/** 한 계좌의 한 바퀴 — 청산 → 하루 손실 → 신호. `force`(수동 실행)면 시장 열림·오늘 판단 여부를 보지 않는다 */
async function cycle(strategy: AccountStrategy, rule: RuleBody, force: boolean): Promise<AutoTradeRunResult> {
  const s = stateOf(strategy.accountId);
  await refreshPeaks(strategy, rule);
  const exits = await runExitChecks(strategy, rule);
  // 청산 다음에 하루 손실 한도를 잰다 (신규 매수 차단 여부)
  await evaluateDailyLoss(strategy).catch((e) => {
    s.lastError = `하루 손실 한도 계산 실패: ${(e as Error).message}`;
  });
  const signals = await runSignalChecks(strategy, rule, { force });
  const notes = [...exits, ...signals.notes];
  if (notes.length) recordNotes(strategy.accountId, notes);
  if (exits.length || signals.evaluated) s.lastRunAt = new Date().toISOString();
  s.lastError = signals.errors.length ? signals.errors.join(' / ') : null;
  return { ...signals, ordered: signals.ordered + exits.filter((n) => n.orderId).length, notes };
}

/** 사용자가 버튼으로 돌린 한 바퀴 (`POST /api/auto-trading/run/:id`) */
export async function runAccount(accountId: number, force = false): Promise<AutoTradeRunResult> {
  const strategy = getStrategy(accountId);
  const empty: AutoTradeRunResult = { accountId, evaluated: 0, ordered: 0, notes: [], errors: [], skipped: null };
  if (!force && !strategy.enabled) return { ...empty, skipped: '자동매매가 꺼져 있습니다' };
  const rule = ruleOf(strategy);
  if (!rule) return { ...empty, skipped: NO_RULE_REASON };
  const s = stateOf(accountId);
  s.running = true;
  try {
    return await cycle(strategy, rule, force);
  } catch (error) {
    s.lastError = (error as Error).message;
    return { ...empty, errors: [s.lastError] };
  } finally {
    s.running = false;
  }
}

async function tick(): Promise<void> {
  if (running) return; // 앞선 바퀴가 아직 돈다 — 겹쳐 돌면 같은 신호로 두 번 주문한다
  running = true;
  try {
    for (const strategy of listActiveStrategies()) {
      const rule = ruleOf(strategy);
      if (!rule) continue; // 규칙이 지워졌다 — 상태 화면이 「매매 규칙을 고르세요」 를 보인다
      const s = stateOf(strategy.accountId);
      try {
        s.running = true;
        await cycle(strategy, rule, false);
      } catch (error) {
        s.lastError = (error as Error).message;
      } finally {
        s.running = false;
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

