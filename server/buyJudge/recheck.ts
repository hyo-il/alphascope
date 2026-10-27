/**
 * 미국 매수 판단 다시 계산 (v2.58.0, 사용자 결정 2026-10-27) — **기록만 더한다**(판단 · 매매 · `buy_judgments` 줄은 바꾸지 않는다).
 *
 * 왜: 매일 기록(16:30 ET)이 쓰는 그날 토스 미국 일봉은 거래량이 덜 모여 있다(2026-10-19~23 표본 38/38 적음 · 최대 41.87%,
 * 다섯 칸이 최종값과 같아진 가장 늦은 시각 20:40 ET). 점수표 「거래량」 그룹이 덜 모인 값으로 계산된다 — 판단이 실제로 바뀌는 날이 있는지 센다.
 *
 * - 언제: 미국 거래일(휴장 제외) **20:45 ET 뒤 그날(ET 날짜) 안에 한 번** — 매수 판단 스케줄러와 같은 5분 틱. 그날 16:30 기록이 끝난 날만
 *   (`buyJudge.lastRecorded` US ≥ 그날). 서버가 꺼져 그 창(20:45~24:00 ET)을 놓친 날은 **소급하지 않는다**. 마친 날은 `buyJudge.recheckLast`.
 * - 무엇을: ① 그날 `buy_judgments` 의 미국 줄 전부(그 줄의 `rule_json` 으로) ② 자동매매 켠 계좌의 (미국 종목, 규칙) 가운데 ①에 없는 쌍 —
 *   보유하지 않은 종목의 매수 쪽(`held: false`)만. 같은 함수 `rules/judge.judgeOnClose`.
 * - 최종값 받기: 종목마다 일봉을 **한 번** 받는다(`getCandles` — 일봉 timestamp 가 그날 자정이라 20:45 에는 늘 오래돼 새로 받는다).
 *   받은 뒤 그날 봉의 `fetched_at` 이 이번 계산 시작 뒤인지 본다 — 아니면(받기 실패로 캐시만) 견주지 않고 「받지 못함」 으로 센다.
 *   받은 캔들을 `judgeOnClose` 에 넘긴다(종목마다 다시 받지 않게 — 끝나지 않은 봉 검사는 위 확인이 대신한다).
 * - 16:30 값: ① 은 `buy_judgments` 줄(그 뒤 화면 [다시 계산] 이 덮었으면 그 값). 그날 봉의 16:30 값은 **받기 전 캐시** 줄의
 *   `fetched_at` 이 마감(16:00 ET) 뒤 · 그 판단 줄의 `created_at` 이전이면 그 판단이 쓴 값이다 — 아니면(그 사이 다른 화면이 다시 받음) 모름(NULL).
 *   ② 계좌는 정규장이 열린 동안만 판단해(다음 거래일 09:30 ET 뒤 — 그때 이미 최종값) 16:30 판단이 없다 → before 칸은 비우고 최종값만 남긴다.
 * - 견주는 칸: action · code · score · 켠 조건 점수(breakdown) · gate_reason. 달라진 것만 한 줄(`buy_judgment_rechecks`), 같은 것은 그날 요약
 *   (`buy_judgment_recheck_days`)에 센다. 30일 보관(그날 처리 때 한 번 정리).
 * - 스위치 `BUYJUDGE_RECHECK_ENABLED`(기본 켬). 모의 데이터 모드는 돌지 않는다(받은 값이 아니다). 주문을 내지 않는다.
 */
import { getDb, dailyFetchedAt, loadCandles } from '../db';
import { getCandles } from '../candleService';
import { judgeOnClose, JUDGE_CANDLE_LIMIT } from '../rules/judge';
import { marketRefLoader, type MarketRefLoader } from '../rules/marketRef';
import { isMarketClosed } from '../marketCalendar';
import { marketDayTime, marketOf } from '../marketHours';
import { isMockMode } from '../mockData';
import { getRule } from '../rules/store';
import { listActiveStrategies } from '../autoTrading/store';
import { dailyCloseOffsetMs } from '../../src/utils/marketBar';
import { marketDate } from '../../src/utils/marketDate';
import type { Candle } from '../../src/types/toss';
import type { RuleBody } from '../../src/types/tradingRule';
import type { RuleEvaluation } from '../rules/engine';
import * as store from './store';

/** 다시 계산 시각 — 20:45 ET(최종값이 된 가장 늦은 시각 20:40 + 5분) */
export const RECHECK_AT_MINUTES = 20 * 60 + 45;
/** 보관 — 1~2주 결과를 보면 된다 */
export const RECHECK_KEEP_DAYS = 30;
/** 받기 실패가 남으면 그날 창 안에서 다음 틱에 다시(쌍 전부 다시 — 같은 줄을 덮는다). 이만큼 해도 남으면 그날을 마친다(토스 호출 상한) */
export const RECHECK_MAX_TRIES = 3;
const KEY_LAST = 'buyJudge.recheckLast';

export const isRecheckEnabled = (): boolean => process.env.BUYJUDGE_RECHECK_ENABLED !== 'false';

const ET = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
function etParts(now: number): { day: string; minutes: number } {
  const p = Object.fromEntries(ET.formatToParts(now).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, minutes: (Number(p.hour) % 24) * 60 + Number(p.minute) };
}

/** 지금 다시 계산할 미국 날짜 — 오늘(ET)이 거래일이고 20:45 가 지났으면 오늘, 아니면 null(놓친 날은 소급하지 않는다) */
export function recheckDayOf(now: number): string | null {
  const { day, minutes } = etParts(now);
  return !isMarketClosed('US', day) && minutes >= RECHECK_AT_MINUTES ? day : null;
}

// ── 저장 ───────────────────────────────────────────────────────────────────
const readSetting = (key: string) => (getDb().prepare(`SELECT value FROM app_settings WHERE key = ?`).get(key) as { value: string } | undefined)?.value ?? null;
export const getRecheckLast = () => readSetting(KEY_LAST);
function setRecheckLast(day: string) {
  getDb().prepare(`INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(KEY_LAST, day);
}

type Breakdown = { key: string; score: number; max: number }[];
interface Bar {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}
const barOf = (c: Candle): Bar => ({ open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume });
/** 매수 판단 기록과 같은 모양(`judge.save`) — 켠 조건만 */
const breakdownOf = (ev: RuleEvaluation): Breakdown => ev.breakdown.filter((c) => c.on).map((c) => ({ key: c.key, score: c.score, max: c.max }));

export interface RecheckRow {
  id: number;
  market_date: string;
  symbol: string;
  rule_id: number;
  source: 'judgment' | 'account';
  account_ids: string | null;
  before_action: string | null;
  before_code: string | null;
  before_score: number | null;
  before_breakdown_json: string | null;
  before_gate_reason: string | null;
  after_action: string;
  after_code: string;
  after_score: number;
  after_max_score: number;
  after_breakdown_json: string;
  after_gate_reason: string | null;
  bar_before_json: string | null;
  bar_after_json: string;
  checked_at: string;
}
export interface RecheckDay {
  market_date: string;
  checked: number;
  same: number;
  changed: number;
  accounts: number;
  failed: number;
  symbols: number;
  finished_at: string;
}

export const listRecheckRows = (): RecheckRow[] => getDb().prepare(`SELECT * FROM buy_judgment_rechecks ORDER BY market_date, source DESC, symbol, rule_id`).all() as RecheckRow[];
export const listRecheckDays = (): RecheckDay[] => getDb().prepare(`SELECT * FROM buy_judgment_recheck_days ORDER BY market_date`).all() as RecheckDay[];

/** 30일 보관 — 그날(ET) − 29일보다 앞 줄을 지운다. 지운 줄 수 */
export function pruneRechecks(today: string): number {
  const cutoff = new Date(Date.parse(`${today}T12:00:00Z`) - (RECHECK_KEEP_DAYS - 1) * 86_400_000).toISOString().slice(0, 10);
  const a = getDb().prepare(`DELETE FROM buy_judgment_rechecks WHERE market_date < ?`).run(cutoff).changes;
  const b = getDb().prepare(`DELETE FROM buy_judgment_recheck_days WHERE market_date < ?`).run(cutoff).changes;
  return a + b;
}

// ── 최종 일봉 받기 ──────────────────────────────────────────────────────────
export interface FinalCandles {
  /** 받은 캔들(받지 못했으면 null) */
  candles: Candle[] | null;
  /** 받기 전 캐시의 그날 봉과 그 봉을 받은 시각 — 16:30 값을 알아내는 데 쓴다 */
  before: { bar: Bar; fetchedAt: number | null } | null;
}

/** 기본 받기 — 받기 전 캐시 줄을 읽어 두고 `getCandles` 로 새로 받은 뒤, 그날 봉이 이번에 받은 것인지(`fetched_at` ≥ 시작) 본다 */
async function loadFinalDefault(symbol: string, day: string, startedAt: number): Promise<FinalCandles> {
  const cachedBar = loadCandles(symbol, '1d', 5).find((c) => marketDate(c.timestamp, symbol) === day);
  const before = cachedBar ? { bar: barOf(cachedBar), fetchedAt: dailyFetchedAt(symbol, cachedBar.timestamp) } : null;
  try {
    const candles = await getCandles(symbol, '1d', JUDGE_CANDLE_LIMIT);
    const bar = candles.find((c) => marketDate(c.timestamp, symbol) === day);
    // 그날 봉이 없으면(거래정지 등) 받은 것은 맞다 — 판단 쪽이 「그날 봉 없음」 으로 센다. 있는데 이번에 받은 값이 아니면 받기 실패(캐시)
    if (bar && (dailyFetchedAt(symbol, bar.timestamp) ?? 0) < startedAt) return { candles: null, before };
    return { candles, before };
  } catch {
    return { candles: null, before };
  }
}

let loadFinal: (symbol: string, day: string, startedAt: number) => Promise<FinalCandles> = loadFinalDefault;
let refsFor: (now: number) => MarketRefLoader = (now) => marketRefLoader(now, undefined, undefined, false);
/** 시험 전용 — 가짜 캔들 · 시장 기준(네트워크 없음). null 이면 되돌린다 */
export function setRecheckHooksForTest(h: { load?: typeof loadFinal | null; refs?: typeof refsFor | null; mock?: boolean | null } | null): void {
  loadFinal = h?.load ?? loadFinalDefault;
  refsFor = h?.refs ?? ((now) => marketRefLoader(now, undefined, undefined, false));
  mockOverride = h?.mock ?? null;
}
let mockOverride: boolean | null = null;

// ── 한 날 ──────────────────────────────────────────────────────────────────
interface Pair {
  symbol: string;
  ruleId: number;
  rule: RuleBody;
  source: 'judgment' | 'account';
  accountIds: number[];
  before: store.JudgmentRow | null;
}

/** 다시 계산할 쌍 — ① 그날 매수 판단 기록의 미국 줄 ② 자동매매 켠 계좌의 (미국 · 보유 안 함 · 종목, 규칙) 가운데 ① 에 없는 것 */
export function recheckPairs(day: string): Pair[] {
  const db = getDb();
  const rows = (db.prepare(`SELECT * FROM buy_judgments WHERE market_date = ? ORDER BY symbol, rule_id`).all(day) as store.JudgmentRow[]).filter((r) => marketOf(r.symbol) === 'US');
  const pairs: Pair[] = [];
  for (const r of rows) {
    try {
      pairs.push({ symbol: r.symbol, ruleId: r.rule_id, rule: JSON.parse(r.rule_json) as RuleBody, source: 'judgment', accountIds: [], before: r });
    } catch {
      /* 규칙 내용이 깨진 줄 — 견줄 수 없다 */
    }
  }
  const seen = new Set(pairs.map((p) => `${p.symbol}|${p.ruleId}`));
  const held = db.prepare(`SELECT 1 FROM paper_positions WHERE account_id = ? AND symbol = ? AND quantity > 0`);
  const acct = new Map<string, Pair>();
  for (const s of listActiveStrategies()) {
    if (s.ruleId == null) continue;
    const r = getRule(s.ruleId);
    if (!r) continue;
    const { id: _id, name: _n, createdAt: _c, updatedAt: _u, usedBy: _b, ...body } = r;
    for (const symbol of s.symbols) {
      if (marketOf(symbol) !== 'US' || held.get(s.accountId, symbol)) continue;
      const key = `${symbol}|${s.ruleId}`;
      if (seen.has(key)) continue;
      const p = acct.get(key);
      if (p) p.accountIds.push(s.accountId);
      else acct.set(key, { symbol, ruleId: s.ruleId, rule: body as RuleBody, source: 'account', accountIds: [s.accountId], before: null });
    }
  }
  return [...pairs, ...acct.values()];
}

export interface RecheckResult {
  day: string;
  checked: number;
  same: number;
  changed: number;
  accounts: number;
  failed: number;
  symbols: number;
}

/** 그 날짜를 지금 시각으로 다시 계산해 기록한다 — 시험이 시각을 넣어 부른다 */
export async function recheckDay(day: string, now = Date.now()): Promise<RecheckResult> {
  const pairs = recheckPairs(day);
  const symbols = [...new Set(pairs.map((p) => p.symbol))];
  const finals = new Map<string, FinalCandles>();
  for (const s of symbols) finals.set(s, await loadFinal(s, day, now));
  const refs = refsFor(now);
  const closeAt = marketDayTime('US', day, dailyCloseOffsetMs('AAPL'));
  const out: RecheckResult = { day, checked: 0, same: 0, changed: 0, accounts: 0, failed: 0, symbols: symbols.length };
  const db = getDb();
  const upsert = db.prepare(
    `INSERT INTO buy_judgment_rechecks (market_date, symbol, rule_id, source, account_ids, before_action, before_code, before_score, before_breakdown_json, before_gate_reason,
       after_action, after_code, after_score, after_max_score, after_breakdown_json, after_gate_reason, bar_before_json, bar_after_json, checked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(market_date, symbol, rule_id, source) DO UPDATE SET
       account_ids = excluded.account_ids, before_action = excluded.before_action, before_code = excluded.before_code, before_score = excluded.before_score,
       before_breakdown_json = excluded.before_breakdown_json, before_gate_reason = excluded.before_gate_reason, after_action = excluded.after_action,
       after_code = excluded.after_code, after_score = excluded.after_score, after_max_score = excluded.after_max_score, after_breakdown_json = excluded.after_breakdown_json,
       after_gate_reason = excluded.after_gate_reason, bar_before_json = excluded.bar_before_json, bar_after_json = excluded.bar_after_json, checked_at = excluded.checked_at`,
  );
  const drop = db.prepare(`DELETE FROM buy_judgment_rechecks WHERE market_date = ? AND symbol = ? AND rule_id = ? AND source = ?`);
  for (const p of pairs) {
    const final = finals.get(p.symbol)!;
    if (!final.candles) {
      out.failed++;
      continue;
    }
    let ev: RuleEvaluation;
    let lastBar: Candle;
    try {
      const j = await judgeOnClose(p.symbol, p.rule, { held: false }, now, final.candles, refs);
      if (j.kind !== 'ok' || marketDate(j.completed.at(-1)!.timestamp, p.symbol) !== day) {
        out.failed++;
        continue;
      }
      ev = j.ev;
      lastBar = j.completed.at(-1)!;
    } catch {
      out.failed++;
      continue;
    }
    const after = breakdownOf(ev);
    const b = p.before;
    const same =
      b != null &&
      b.action === ev.action &&
      b.code === ev.code &&
      b.score === ev.score &&
      b.breakdown_json === JSON.stringify(after) &&
      (b.gate_reason ?? null) === (ev.gateReason ?? null);
    if (p.source === 'judgment') {
      out.checked++;
      if (same) {
        out.same++;
        drop.run(day, p.symbol, p.ruleId, p.source); // 앞선 시도에서 달랐다가 같아졌으면 지운다
        continue;
      }
      out.changed++;
    } else out.accounts++;
    // 16:30 판단이 쓴 봉 — 받기 전 캐시 줄을 마감 뒤 · 그 판단 기록 전에 받았을 때만
    const createdAt = b ? Date.parse(b.created_at) : NaN;
    const f = final.before?.fetchedAt ?? null;
    const barBefore = b && final.before && f != null && f >= closeAt && Number.isFinite(createdAt) && f <= createdAt ? final.before.bar : null;
    upsert.run(
      day, p.symbol, p.ruleId, p.source, p.source === 'account' ? JSON.stringify(p.accountIds) : null,
      b?.action ?? null, b?.code ?? null, b?.score ?? null, b?.breakdown_json ?? null, b?.gate_reason ?? null,
      ev.action, ev.code, ev.score, ev.maxScore, JSON.stringify(after), ev.gateReason ?? null,
      barBefore ? JSON.stringify(barBefore) : null, JSON.stringify(barOf(lastBar)), new Date(now).toISOString(),
    );
  }
  db.prepare(
    `INSERT INTO buy_judgment_recheck_days (market_date, checked, same, changed, accounts, failed, symbols, finished_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(market_date) DO UPDATE SET checked = excluded.checked, same = excluded.same, changed = excluded.changed, accounts = excluded.accounts,
       failed = excluded.failed, symbols = excluded.symbols, finished_at = excluded.finished_at`,
  ).run(day, out.checked, out.same, out.changed, out.accounts, out.failed, out.symbols, new Date(now).toISOString());
  return out;
}

// ── 틱 ─────────────────────────────────────────────────────────────────────
let running = false;
/** 그날 해 본 횟수(메모리 — 서버를 다시 켜면 처음부터) */
const tries = new Map<string, number>();

/** 한 바퀴 — 매수 판단 스케줄러가 5분마다 부른다(점검 `npm run recheck:test` 는 시각을 넣어 부른다). 돌지 않았으면 이유 */
export async function recheckTick(now = Date.now()): Promise<{ result: RecheckResult | null; skipped: string | null; pruned: number }> {
  if (!isRecheckEnabled()) return { result: null, skipped: 'disabled', pruned: 0 };
  if (mockOverride ?? isMockMode()) return { result: null, skipped: 'mock', pruned: 0 };
  const day = recheckDayOf(now);
  if (!day) return { result: null, skipped: 'not_time', pruned: 0 };
  if ((getRecheckLast() ?? '') >= day) return { result: null, skipped: 'done', pruned: 0 };
  const recorded = store.getLastRecorded().US;
  if (!recorded || recorded < day) return { result: null, skipped: 'not_recorded', pruned: 0 };
  if (running) return { result: null, skipped: 'running', pruned: 0 };
  running = true;
  try {
    const pruned = pruneRechecks(day);
    const result = await recheckDay(day, now);
    const n = (tries.get(day) ?? 0) + 1;
    tries.set(day, n);
    if (tries.size > 20) for (const k of [...tries.keys()].filter((k) => k < day)) tries.delete(k);
    // 받지 못한 쌍이 남으면 그날 창 안에서 다시(최대 RECHECK_MAX_TRIES 번)
    if (!result.failed || n >= RECHECK_MAX_TRIES) setRecheckLast(day);
    console.log(
      `[buyJudge] US ${day} 최종값으로 다시 계산 — 매수 판단 ${result.checked}건 중 달라짐 ${result.changed}건 · 계좌 ${result.accounts}쌍 · 받지 못함 ${result.failed}건 · 일봉 ${result.symbols}종목`,
    );
    return { result, skipped: null, pruned };
  } catch (e) {
    console.warn('[buyJudge] 다시 계산 실패:', e instanceof Error ? e.message : e);
    return { result: null, skipped: 'error', pruned: 0 };
  } finally {
    running = false;
  }
}

/** 시험 전용 — 횟수 기억을 비운다 */
export const resetRecheckTriesForTest = () => tries.clear();
