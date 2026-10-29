/**
 * 오늘 시황 — 만들기(수집 → AI → 저장) · 자동(평일 아침 1번) · 버튼(하루 5번) · 진행 상태.
 *
 * - **한 번에 하나만** 돈다(자동 · 버튼 함께). 진행 중에 버튼을 누르면 새로 돌지 않고 진행 상태를 돌려준다.
 * - Gemini: 브리핑 1번 = 호출 1번. 실패하면 1번까지 다시 — **429(한도 초과)면 다시 하지 않는다**.
 *   원본의 모델 돌려 쓰기(최대 8번)는 옮기지 않았다 — 한도를 자동매매 AI 검증 · 종목 분석과 같이 쓴다.
 *   모델 = `GEMINI_BRIEF_MODEL`(비우면 `callGemini` 기본 모델) · 출력 8192 토큰 · temperature 0.1(원본과 같음).
 * - Gemini 가 꺼져 있거나 실패해도 **시장 데이터 · 일정 · 수집 상태만으로** 저장하고 이유를 남긴다(원본도 데이터만 보낸다).
 * - 자동: 평일(월~금, 한국 시간) 06:55 뒤 · 13시 전 · 그날 자동 기록이 없을 때 — 모의투자 스냅샷 스케줄러의 **10분 확인에 얹는다**
 *   (새 타이머 없음 → 실제로는 06:55 뒤 첫 확인, 07:05 무렵). 서버가 꺼져 놓친 날은 그날 13시 전까지만 보충한다.
 *   한국 공휴일은 건너뛰지 않는다(원본과 같음 — 미국 장 마감 정리는 평일마다 쓸모가 있다).
 *   스위치 `MARKET_BRIEF_ENABLED`(기본 켬). Gemini 스위치와 별개다 — Gemini 가 꺼져 있어도 자동은 데이터만으로 만든다.
 * - ⚠️ 판단 · 주문을 하지 않는다. 모의투자 · 자동매매 모듈을 import 하지 않는다.
 */

import { getDb } from '../db';
import { callGemini, DEFAULT_MODEL, geminiDisabledReason, GeminiError, type GeminiCallOptions, type GeminiCallResult } from '../gemini/client';
import { collectAll, defaultCollectDeps, type CollectDeps } from './collect';
import { buildPrompt, MARKET_BRIEF_PROMPT_VERSION, REQUIRED_KEYS, SCHEMA, SYSTEM } from './prompt';
import { postprocess } from './postprocess';
import { countBriefs, insertBrief, purgeOldBriefs } from './store';
import { editionAt, kstDay, kstMinutes } from '../../src/utils/marketBrief';
import {
  BRIEF_AFTERNOON_HOUR,
  BRIEF_BUTTON_DAILY_LIMIT,
  type BriefAi,
  type BriefEdition,
  type BriefSourceStatus,
  type BriefStage,
  type BriefTrigger,
  type MarketBriefStatus,
} from '../../src/types/marketBrief';

const AUTO_START_MINUTES = 6 * 60 + 55;
const LAST_AUTO_KEY = 'marketBrief.lastAutoDate';
const MAX_OUTPUT_TOKENS = 8192;
const TEMPERATURE = 0.1;

export const briefModel = () => process.env.GEMINI_BRIEF_MODEL?.trim() || DEFAULT_MODEL;

export function autoDisabledReason(): string | null {
  return process.env.MARKET_BRIEF_ENABLED?.trim().toLowerCase() === 'false'
    ? '이 서버에서는 오늘 시황 자동 만들기가 꺼져 있습니다(MARKET_BRIEF_ENABLED=false)'
    : null;
}

export class BriefLimitError extends Error {}

// ── 바꿔 끼우기(시험) ─────────────────────────────────────────────────────

type Caller = (options: GeminiCallOptions) => Promise<GeminiCallResult<Partial<BriefAi>>>;

export interface BriefDeps {
  collect: CollectDeps;
  gemini: Caller;
  /** Gemini 를 부를 수 없는 이유 — 있으면 부르지 않고 데이터만 */
  geminiReason: () => string | null;
  now: () => number;
}

export const defaultBriefDeps: BriefDeps = {
  collect: defaultCollectDeps,
  gemini: (o) => callGemini<Partial<BriefAi>>(o),
  geminiReason: geminiDisabledReason,
  now: () => Date.now(),
};

// ── 진행 상태 ──────────────────────────────────────────────────────────

interface RunState {
  running: boolean;
  stage: BriefStage | null;
  edition: BriefEdition | null;
  trigger: BriefTrigger | null;
  startedAt: string | null;
  lastFinishedId: number | null;
  lastError: string | null;
}

const state: RunState = { running: false, stage: null, edition: null, trigger: null, startedAt: null, lastFinishedId: null, lastError: null };

/** 시험용 — 진행 상태를 처음으로 */
export function resetBriefStateForTest(): void {
  Object.assign(state, { running: false, stage: null, edition: null, trigger: null, startedAt: null, lastFinishedId: null, lastError: null });
}

export function briefStatus(now = Date.now()): MarketBriefStatus {
  const today = kstDay(now);
  return {
    running: state.running,
    stage: state.stage,
    edition: state.edition,
    trigger: state.trigger,
    startedAt: state.startedAt,
    today,
    buttonUsed: countBriefs(today, 'button'),
    buttonLimit: BRIEF_BUTTON_DAILY_LIMIT,
    nowEdition: editionAt(now),
    autoDisabledReason: autoDisabledReason(),
    geminiDisabledReason: geminiDisabledReason(),
    lastFinishedId: state.lastFinishedId,
    lastError: state.lastError,
  };
}

// ── AI ─────────────────────────────────────────────────────────────────

interface AiOutcome {
  brief: Partial<BriefAi> | null;
  model: string | null;
  tokens: number | null;
  calls: number;
  error: string | null;
}

function missingKeys(edition: BriefEdition, data: unknown): string[] {
  const obj = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
  return REQUIRED_KEYS[edition].filter((k) => !(k in obj));
}

/** 1번 부르고, 실패하면(429 빼고) 1번만 다시 */
async function askGemini(edition: BriefEdition, prompt: string, deps: BriefDeps): Promise<AiOutcome> {
  const reason = deps.geminiReason();
  if (reason) return { brief: null, model: null, tokens: null, calls: 0, error: `AI 꺼짐 — ${reason}` };
  const model = briefModel();
  let lastError = '';
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const result = await deps.gemini({
        system: SYSTEM,
        parts: [{ text: prompt }],
        schema: SCHEMA[edition],
        model,
        temperature: TEMPERATURE,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        retries: 0,
      });
      const missing = missingKeys(edition, result.data);
      if (!missing.length) return { brief: result.data, model: result.model, tokens: result.tokens || null, calls: attempt, error: null };
      lastError = `응답에 빠진 키: ${missing.join(', ')}`;
    } catch (error) {
      if (error instanceof GeminiError && error.rateLimited) {
        return { brief: null, model, tokens: null, calls: attempt, error: 'Gemini 무료 한도 초과(429) — 다시 부르지 않았습니다' };
      }
      lastError = (error as Error).message;
    }
  }
  return { brief: null, model, tokens: null, calls: 2, error: `AI 분석 실패 — ${lastError}` };
}

// ── 만들기 한 번 ───────────────────────────────────────────────────────

/** 수집 → AI → 저장. 저장한 줄 id 를 돌려준다. 바깥에서 `state.running` 을 잡고 부른다 */
async function produce(edition: BriefEdition, trigger: BriefTrigger, deps: BriefDeps): Promise<number> {
  const startedMs = deps.now();
  const today = kstDay(startedMs);

  state.stage = 'collect';
  const collected = await collectAll(edition, today, deps.collect);

  state.stage = 'ai';
  const prompt = buildPrompt({
    edition,
    today,
    assets: collected.market.assets,
    earnings: collected.earnings.earnings,
    domestic: collected.domestic,
    foreign: collected.foreign,
    at: startedMs,
  });
  const ai = await askGemini(edition, prompt, deps);
  let brief: BriefAi | null = null;
  let aiError = ai.error;
  if (ai.brief) {
    try {
      brief = postprocess(ai.brief, collected.earnings.earnings, today);
    } catch (e) {
      aiError = `AI 응답 뒤처리 실패 — ${(e as Error).message}`;
    }
  }
  const sources: BriefSourceStatus[] = [
    ...collected.sources,
    { group: 'ai', label: 'AI 분석', ok: Boolean(brief), detail: brief ? `${ai.model} · 호출 ${ai.calls}번` : (aiError ?? '실패') },
  ];

  state.stage = 'save';
  return insertBrief({
    date: today,
    edition,
    trigger,
    createdAt: new Date(deps.now()).toISOString(),
    model: ai.model,
    tokens: ai.tokens,
    aiCalls: ai.calls,
    promptVersion: MARKET_BRIEF_PROMPT_VERSION,
    sources,
    data: { assets: collected.market.assets, earnings: collected.earnings.earnings },
    brief,
    aiError: brief ? null : aiError,
  });
}

/** 진행 상태를 잡고 한 번 만든다 — 이미 돌고 있으면 null */
async function runOnce(edition: BriefEdition, trigger: BriefTrigger, deps: BriefDeps): Promise<number | null> {
  if (state.running) return null;
  Object.assign(state, { running: true, stage: 'collect', edition, trigger, startedAt: new Date(deps.now()).toISOString(), lastError: null });
  try {
    const id = await produce(edition, trigger, deps);
    state.lastFinishedId = id;
    console.log(`[market-brief] ${trigger === 'auto' ? '자동' : '버튼'} ${edition === 'morning' ? '오전판' : '오후판'} 저장 #${id}`);
    return id;
  } catch (error) {
    state.lastError = (error as Error).message;
    console.warn('[market-brief] 만들기 실패:', state.lastError);
    return null;
  } finally {
    Object.assign(state, { running: false, stage: null, edition: null, trigger: null, startedAt: null });
  }
}

// ── 버튼 ──────────────────────────────────────────────────────────────

/**
 * 「시황 분석」 — 지금 시각의 판(13시 전 오전판 · 뒤 오후판). 끝까지 기다리지 않고 시작만 한다.
 * - 진행 중이면 새로 시작하지 않는다(started=false — 진행 상태를 그대로 보면 된다).
 * - 그날(한국 날짜) 버튼 기록이 5번이면 `BriefLimitError`(자동은 세지 않는다).
 */
export function startButtonRun(deps: BriefDeps = defaultBriefDeps): { started: boolean; done: Promise<number | null> } {
  if (state.running) return { started: false, done: Promise.resolve(null) };
  const now = deps.now();
  if (countBriefs(kstDay(now), 'button') >= BRIEF_BUTTON_DAILY_LIMIT) {
    throw new BriefLimitError(`오늘 버튼 ${BRIEF_BUTTON_DAILY_LIMIT}번을 다 썼습니다 — 내일 다시 눌러 주세요`);
  }
  // runOnce 는 첫 await 전에 running 을 잡는다 — 같은 틱에 두 번 눌러도 두 번째는 위에서 걸린다
  const done = runOnce(editionAt(now), 'button', deps);
  return { started: true, done };
}

// ── 자동 ──────────────────────────────────────────────────────────────

function readLastAuto(): string | null {
  const row = getDb().prepare(`SELECT value FROM app_settings WHERE key = ?`).get(LAST_AUTO_KEY) as { value: string } | undefined;
  return row?.value ?? null;
}

function writeLastAuto(day: string): void {
  getDb()
    .prepare(`INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .run(LAST_AUTO_KEY, day);
}

/** 지금 자동 오전판을 만들 때인가 — 평일 · 06:55 ≤ 지금 < 13:00(한국 시간) · 그날 아직 */
export function autoDue(now: number, lastAutoDate: string | null): boolean {
  const day = kstDay(now);
  const weekday = new Date(`${day}T12:00:00Z`).getUTCDay();
  if (weekday === 0 || weekday === 6) return false;
  const minutes = kstMinutes(now);
  if (minutes < AUTO_START_MINUTES || minutes >= BRIEF_AFTERNOON_HOUR * 60) return false;
  return lastAutoDate !== day;
}

let lastPurgeDay: string | null = null;

/**
 * 10분 확인마다 부른다. 하루 한 번 30일 지난 기록을 지우고, 때가 되면 자동 오전판을 만든다(끝날 때까지 기다린다).
 * 돌았으면 저장한 줄 id(점검용), 아니면 null.
 */
export async function marketBriefTick(deps: BriefDeps = defaultBriefDeps): Promise<number | null> {
  const now = deps.now();
  const today = kstDay(now);
  if (lastPurgeDay !== today) {
    lastPurgeDay = today;
    const removed = purgeOldBriefs(today);
    if (removed) console.log(`[market-brief] 30일 지난 기록 ${removed}줄 지움`);
  }
  if (autoDisabledReason() || state.running) return null;
  if (!autoDue(now, readLastAuto()) || countBriefs(today, 'auto') > 0) return null;
  // 시작할 때 먼저 날짜를 남긴다 — 도중에 서버가 내려가도 같은 날 다시 돌며 Gemini 를 두 번 쓰지 않는다
  writeLastAuto(today);
  return runOnce('morning', 'auto', deps);
}

/** 시험용 — 하루 한 번 지우기를 다시 */
export function resetPurgeForTest(): void {
  lastPurgeDay = null;
}
