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
import { markReleasedEarnings, postprocess } from './postprocess';
import { checkDirections } from './directionCheck';
import { filterSectorStocks } from './sectorStocks';
import { regularSessionEnd } from '../heatmapSession';
import { marketDate } from '../../src/utils/marketDate';
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
  /** 그 미국 거래일의 정규장 끝(ms) — `heatmapSession.regularSessionEnd`(시험은 바꿔 끼운다 — 토스 0) */
  usClose: (usDay: string, now: number) => Promise<number | null>;
}

export const defaultBriefDeps: BriefDeps = {
  collect: defaultCollectDeps,
  gemini: (o) => callGemini<Partial<BriefAi>>(o),
  geminiReason: geminiDisabledReason,
  now: () => Date.now(),
  usClose: (usDay, now) => regularSessionEnd('US', usDay, now),
};

// ── 진행 상태 ──────────────────────────────────────────────────────────

/** 서버가 켜진 시각 — 진행 중에 서버가 다시 켜지면 화면이 「끊겼습니다」 를 알린다 */
const BOOT_AT = Date.now();

interface RunState {
  running: boolean;
  stage: BriefStage | null;
  edition: BriefEdition | null;
  trigger: BriefTrigger | null;
  startedAt: string | null;
  lastFinishedId: number | null;
  lastFinishedDate: string | null;
  lastError: string | null;
}

const state: RunState = { running: false, stage: null, edition: null, trigger: null, startedAt: null, lastFinishedId: null, lastFinishedDate: null, lastError: null };

/**
 * 줄을 남기지 못하고 실패한 버튼 실행(그날 한국 날짜) — 버튼 횟수에 함께 센다.
 * Gemini 를 부른 뒤 저장이 실패해도 5번 제한을 넘지 않게(메모리 — 재시작하면 0).
 */
let failedButton = { day: '', n: 0 };
const buttonUsedOn = (day: string) => countBriefs(day, 'button') + (failedButton.day === day ? failedButton.n : 0);

/** 시험용 — 진행 상태를 처음으로 */
export function resetBriefStateForTest(): void {
  Object.assign(state, { running: false, stage: null, edition: null, trigger: null, startedAt: null, lastFinishedId: null, lastFinishedDate: null, lastError: null });
  failedButton = { day: '', n: 0 };
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
    buttonUsed: buttonUsedOn(today),
    buttonLimit: BRIEF_BUTTON_DAILY_LIMIT,
    nowEdition: editionAt(now),
    autoDisabledReason: autoDisabledReason(),
    geminiDisabledReason: geminiDisabledReason(),
    lastFinishedId: state.lastFinishedId,
    lastFinishedDate: state.lastFinishedDate,
    lastError: state.lastError,
    autoTriedToday: readLastAuto() === today,
    autoDoneToday: countBriefs(today, 'auto') > 0,
    autoWindowNow: autoDue(now, null),
    bootAt: BOOT_AT,
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
  const collected = await collectAll(edition, startedMs, deps.collect);

  state.stage = 'ai';
  // 장중/종가 판단 시각 = 지표 엔진이 실제로 받은 시각(엔진 10분 캐시면 그때) — 프롬프트 · 화면이 같은 값을 쓴다
  const collectedAt = collected.market.fetchedAt ?? startedMs;
  // 「발표됨」 — 지금의 미국 날짜 그 날 정규장 끝(토스 달력 → 고정표, 조기 마감 반영 · 휴장이면 null). 프롬프트 · 뒤처리가 같은 값
  const usClose = await deps.usClose(marketDate(startedMs, 'SPY'), startedMs).catch(() => null);
  const usReleased = usClose != null && startedMs >= usClose;
  // AI 가 없어도 ② 실적 목록에 같은 「발표됨」(저장 데이터에 붙인다 — 화면은 그대로 읽는다)
  markReleasedEarnings(collected.earnings.earnings, startedMs, usClose);
  const prompt = buildPrompt({
    edition,
    today,
    assets: collected.market.assets,
    earnings: collected.earnings.earnings,
    domestic: collected.domestic,
    foreign: collected.foreign,
    at: collectedAt,
    usReleased,
    sectorStocks: collected.sectorStocks,
  });
  // 시장 데이터를 하나도 못 받았으면 AI 를 부르지 않는다 — 숫자 없이 시황을 지어낸다(한도도 아낀다)
  const noMarket = Object.keys(collected.market.assets).length === 0;
  const ai = noMarket
    ? { brief: null, model: null, tokens: null, calls: 0, error: '시장 데이터를 받지 못해 AI 분석을 하지 않았습니다' }
    : await askGemini(edition, prompt, deps);
  let brief: BriefAi | null = null;
  let aiError = ai.error;
  const checks: BriefSourceStatus[] = [];
  if (ai.brief) {
    try {
      brief = postprocess(ai.brief, collected.earnings.earnings, startedMs, usClose);
      // ③ 대표 종목 — 후보 목록 밖 · 다른 섹터는 뺀다 / 문장 ↔ 숫자 — 어긋남만 남긴다(문장은 그대로)
      const dropped = filterSectorStocks(brief, collected.sectorStocks);
      brief.mismatches = checkDirections(brief, { edition, assets: collected.market.assets, at: collectedAt });
      const n = brief.mismatches.length;
      checks.push({ group: 'check', label: 'AI 문장 검사', ok: n === 0, detail: n ? `${n}곳 숫자와 다름` : '시장 숫자와 반대인 문장 없음' });
      if (dropped) checks.push({ group: 'check', label: '대표 종목 거르기', ok: false, detail: `대표 종목 ${dropped}개 뺌(목록 밖)` });
    } catch (e) {
      brief = null;
      aiError = `AI 응답 뒤처리 실패 — ${(e as Error).message}`;
    }
  }
  const sources: BriefSourceStatus[] = [
    ...collected.sources,
    { group: 'ai', label: 'AI 분석', ok: Boolean(brief), detail: brief ? `${ai.model} · 호출 ${ai.calls}번` : (aiError ?? '실패') },
    ...(brief ? checks : []),
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
    data: { assets: collected.market.assets, earnings: collected.earnings.earnings, collectedAt: new Date(collectedAt).toISOString() },
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
    state.lastFinishedDate = kstDay(Date.parse(state.startedAt!));
    console.log(`[market-brief] ${trigger === 'auto' ? '자동' : '버튼'} ${edition === 'morning' ? '오전판' : '오후판'} 저장 #${id}`);
    return id;
  } catch (error) {
    state.lastError = (error as Error).message;
    if (trigger === 'button') {
      const day = kstDay(Date.parse(state.startedAt!));
      failedButton = { day, n: (failedButton.day === day ? failedButton.n : 0) + 1 };
    }
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
  if (buttonUsedOn(kstDay(now)) >= BRIEF_BUTTON_DAILY_LIMIT) {
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
    try {
      const removed = purgeOldBriefs(today);
      lastPurgeDay = today; // 지우기에 성공한 날만 — 실패하면 다음 확인 때 다시
      if (removed) console.log(`[market-brief] 30일 지난 기록 ${removed}줄 지움`);
    } catch (e) {
      console.warn('[market-brief] 30일 정리 실패 — 다음 확인 때 다시:', (e as Error).message);
    }
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
