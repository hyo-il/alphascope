/**
 * 목표 도달 가능성 분석 (v2.24.0) — "지금 종가에 샀다면 N거래일 안에 +X% 와 −Y% 중 어디에 먼저 닿을까?"
 *
 * - 입력: `context.ts` 의 종목 컨텍스트 그대로(국내는 투자자 동향 블록 포함). **뉴스는 넣지 않는다.**
 *   거기에 질문 머리말(조건 + 실적 발표일이 기간 안인지)을 앞에 붙인다.
 * - 구조: 에이전트 4명(역할 프롬프트 그대로, 출력 스키마만 확률로) + 의장 1명 = **5호출**. 동시성 큐(`client.ts`)를 지난다.
 * - 프롬프트 버전은 `TARGET_PROMPT_VERSION`(t1) — 매매 신호 분석(v1·v1-flow)과 섞지 않는다. 적중률(`accuracy.ts`)에도 넣지 않는다.
 * - 과거 기준선은 `analysis/targetHit.ts` 의 `firstTouch` **그대로**(새 계산 없음), 채점도 같은 파일의 `touchOutcome` **그대로**.
 * - ⚠️ 기준일 = **분석 직전의 확정 종가일**이다. 장중이면 진행 중인 오늘 봉을 빼고 잰다(기준선·채점도 같은 확정 봉만).
 * - ⚠️ **분석만 한다.** 주문 모듈을 import 하지 않는다.
 * - 채점은 기록을 읽을 때 돈다(급등 채점과 같은 방식) — 새 스케줄러 없음.
 */

import { getDb } from '../db';
import type { Candle } from '../../src/types/toss';
import { isFormingBar } from '../../src/utils/marketBar';
import { marketDate } from '../../src/utils/marketDate';
import { isKrSymbol } from '../../src/utils/market';
import { dailyCandles, firstTouch, touchOutcome, type TouchOutcome } from '../analysis/targetHit';
import { getEarningsDate } from '../earningsCalendar';
import { tradingDaysUntil } from '../autoTrading/guards';
import { AGENTS } from './agents';
import { buildContext } from './context';
import { callGemini, DEFAULT_MODEL, geminiDisabledReason, GeminiError } from './client';

/** 목표 도달 분석 프롬프트 버전 — 질문·스키마를 고치면 올린다 */
export const TARGET_PROMPT_VERSION = 't1';
export const TARGET_MAX_SYMBOLS = 5;
export const TARGET_LIMITS = { targetPct: [0.5, 50], stopPct: [0.5, 30], days: [2, 120] } as const;

// ── 저장소 ───────────────────────────────────────────────

let ready = false;
function db() {
  const database = getDb();
  if (!ready) {
    // Gemini 표처럼 모듈 안에서 만든다 — 선택 기능이라 폴더째 들어내도 나머지가 멀쩡해야 한다
    database.exec(`
      CREATE TABLE IF NOT EXISTS target_analysis (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        symbol TEXT NOT NULL,
        created_at TEXT NOT NULL,
        base_date TEXT NOT NULL,
        entry_price REAL NOT NULL,
        target_pct REAL NOT NULL,
        stop_pct REAL NOT NULL,
        days INTEGER NOT NULL,
        p_target REAL NOT NULL,
        p_stop REAL NOT NULL,
        p_neither REAL NOT NULL,
        normalized INTEGER NOT NULL DEFAULT 0,
        summary TEXT,
        reasons TEXT,
        risks TEXT,
        agents TEXT,
        base_target REAL,
        base_stop REAL,
        base_neither REAL,
        base_expectancy REAL,
        base_samples INTEGER,
        prompt_version TEXT NOT NULL,
        model TEXT NOT NULL,
        tokens INTEGER DEFAULT 0,
        outcome TEXT,
        outcome_date TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_target_symbol_time ON target_analysis (symbol, created_at DESC);
    `);
    ready = true;
  }
  return database;
}

export interface TargetAgentOpinion {
  role: string;
  label: string;
  pTarget: number;
  pStop: number;
  pNeither: number;
  summary: string;
  error: string | null;
}

export interface TargetAnalysisRecord {
  id: number;
  symbol: string;
  createdAt: string;
  baseDate: string;
  entryPrice: number;
  targetPct: number;
  stopPct: number;
  days: number;
  pTarget: number;
  pStop: number;
  pNeither: number;
  /** 모델이 준 확률 합이 100 이 아니어서 비율대로 맞췄는지 */
  normalized: boolean;
  summary: string;
  reasons: string[];
  risks: string[];
  agents: TargetAgentOpinion[];
  base: { target: number; stop: number; neither: number; expectancy: number; samples: number } | null;
  promptVersion: string;
  model: string;
  tokens: number;
  outcome: TouchOutcome | null;
  /** 채점에 쓴 마지막 봉(만기일) */
  outcomeDate: string | null;
}

type Row = {
  id: number; symbol: string; created_at: string; base_date: string; entry_price: number;
  target_pct: number; stop_pct: number; days: number; p_target: number; p_stop: number; p_neither: number;
  normalized: number; summary: string | null; reasons: string | null; risks: string | null; agents: string | null;
  base_target: number | null; base_stop: number | null; base_neither: number | null; base_expectancy: number | null;
  base_samples: number | null; prompt_version: string; model: string; tokens: number;
  outcome: string | null; outcome_date: string | null;
};

const parse = <T,>(text: string | null, fallback: T): T => {
  try {
    return text ? (JSON.parse(text) as T) : fallback;
  } catch {
    return fallback;
  }
};

function toRecord(row: Row): TargetAnalysisRecord {
  return {
    id: row.id,
    symbol: row.symbol,
    createdAt: row.created_at,
    baseDate: row.base_date,
    entryPrice: row.entry_price,
    targetPct: row.target_pct,
    stopPct: row.stop_pct,
    days: row.days,
    pTarget: row.p_target,
    pStop: row.p_stop,
    pNeither: row.p_neither,
    normalized: row.normalized === 1,
    summary: row.summary ?? '',
    reasons: parse<string[]>(row.reasons, []),
    risks: parse<string[]>(row.risks, []),
    agents: parse<TargetAgentOpinion[]>(row.agents, []),
    base:
      row.base_target == null
        ? null
        : {
            target: row.base_target,
            stop: row.base_stop ?? 0,
            neither: row.base_neither ?? 0,
            expectancy: row.base_expectancy ?? 0,
            samples: row.base_samples ?? 0,
          },
    promptVersion: row.prompt_version,
    model: row.model,
    tokens: row.tokens,
    outcome: (row.outcome as TouchOutcome | null) ?? null,
    outcomeDate: row.outcome_date,
  };
}

// ── 확률 정리 ─────────────────────────────────────────────

/**
 * 0~100 으로 자르고, 합이 100 이 아니면 **비율대로** 맞춘다(정수 반올림 오차는 가장 큰 값에 몰아 합 100).
 * 셋 다 0 이면 기준선을 알 수 없으니 균등(34/33/33). 맞췄으면 normalized = true 로 기록한다.
 */
export function normalizeProbs(raw: { pTarget?: unknown; pStop?: unknown; pNeither?: unknown }): {
  pTarget: number;
  pStop: number;
  pNeither: number;
  normalized: boolean;
} {
  const clip = (v: unknown) => {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0;
  };
  const values = [clip(raw.pTarget), clip(raw.pStop), clip(raw.pNeither)];
  const sum = values.reduce((a, b) => a + b, 0);
  const exact = values.every((v) => Number.isInteger(v)) && sum === 100;
  if (exact) return { pTarget: values[0], pStop: values[1], pNeither: values[2], normalized: false };

  const scaled = sum > 0 ? values.map((v) => (v / sum) * 100) : [100 / 3, 100 / 3, 100 / 3];
  const rounded = scaled.map((v) => Math.round(v));
  const diff = 100 - rounded.reduce((a, b) => a + b, 0);
  const maxIndex = rounded.indexOf(Math.max(...rounded));
  rounded[maxIndex] += diff;
  return { pTarget: rounded[0], pStop: rounded[1], pNeither: rounded[2], normalized: true };
}

// ── 프롬프트 ──────────────────────────────────────────────

const PROB_FIELDS = {
  pTarget: { type: 'NUMBER', description: '목표(+X%)에 먼저 닿을 확률 0~100' },
  pStop: { type: 'NUMBER', description: '손절(−Y%)에 먼저 닿을 확률 0~100' },
  pNeither: { type: 'NUMBER', description: '기간 안에 둘 다 닿지 않을 확률 0~100' },
};

const AGENT_SCHEMA = {
  type: 'OBJECT',
  properties: { ...PROB_FIELDS, summary: { type: 'STRING', description: '근거 한두 문장 (한국어)' } },
  required: ['pTarget', 'pStop', 'pNeither', 'summary'],
};

const MODERATOR_SCHEMA = {
  type: 'OBJECT',
  properties: {
    ...PROB_FIELDS,
    summary: { type: 'STRING', description: '초보자도 읽는 쉬운 한국어 3줄 이내' },
    reasons: { type: 'ARRAY', items: { type: 'STRING' }, description: '근거 3개 이내' },
    risks: { type: 'ARRAY', items: { type: 'STRING' }, description: '위험 2개 이내' },
  },
  required: ['pTarget', 'pStop', 'pNeither', 'summary', 'reasons', 'risks'],
};

/** 에이전트 역할 프롬프트 뒤에 붙인다 — 역할의 관점은 유지하고 답의 형식만 바꾼다 */
const AGENT_TAIL = `

[이번 질문의 형식]
이번에는 매수·매도 투표(vote·confidence)가 아니라, 아래 질문의 **세 가지 결과의 확률**을 0~100 으로 답합니다.
세 확률의 합은 100 이어야 합니다. 당신의 역할 관점에서 판단하고, 근거가 약하면 기간 안에 "둘 다 아님" 쪽으로 확률을 둡니다.
모든 서술은 한국어로 작성합니다.`;

const MODERATOR_SYSTEM = `당신은 투자 분석 종합 의장입니다.
4명 전문가(차트 기술 분석가, 퀀트 트레이더, 펀더멘탈 애널리스트, 리스크 매니저)가 각자 낸 확률을 검토해
"정해진 기간 안에 목표와 손절 중 어디에 먼저 닿을지"에 대한 최종 확률을 냅니다.

판단 원칙:
- 다수결·단순 평균이 아닙니다. 근거의 강도로 판단하세요.
- 리스크 매니저의 반론이 타당하면 목표 확률을 낮추세요.
- 실패한 전문가의 의견은 무시하되 그만큼 확신을 낮추세요(극단적인 확률을 피하세요).
- 실적 발표가 기간 안에 있으면 변동성이 커진다는 점을 risks 에 적으세요.
- 세 확률의 합은 100 입니다. summary 는 초보자도 이해하는 쉬운 말로 3줄 이내로 씁니다.

모든 서술은 한국어로 작성합니다. 이 판단은 투자 조언이 아니며 최종 결정은 사용자가 내립니다.`;

function questionBlock(o: { targetPct: number; stopPct: number; days: number; baseDate: string; entry: number; earnings: string }): string {
  return `## 이번 질문 (목표 도달 가능성)
지금 종가(${o.baseDate} 확정 종가 ${o.entry})에 샀다면, 앞으로 ${o.days}거래일 안에
+${o.targetPct}% 에 먼저 닿을까, −${o.stopPct}% 에 먼저 닿을까, 둘 다 닿지 않을까?
- 판정 규칙: 매일의 고가·저가로 봅니다. 같은 날 둘 다 닿으면 손절로 셉니다.
- ${o.earnings}
아래 데이터를 근거로 세 결과의 확률(합 100)을 내세요.`;
}

function earningsLine(symbol: string, baseDate: string, days: number): string {
  const e = getEarningsDate(symbol);
  if (!e) return '실적 발표일: 정보 없음';
  const until = tradingDaysUntil(baseDate, e.date, isKrSymbol(symbol) ? 'KR' : 'US');
  const label = `${e.date}${e.isEstimate ? '(추정)' : ''}`;
  if (until < 0) return `실적 발표일: 최근 발표 지남(다음 일정 미확인 — 마지막 기록 ${label})`;
  return until <= days
    ? `실적 발표일: ${label} — **기간 안**(${until}거래일 뒤)이라 변동성이 커질 수 있습니다`
    : `실적 발표일: ${label} — 기간 밖(${until}거래일 뒤)`;
}

// ── 실행 ──────────────────────────────────────────────────

/** 확정 봉만 — 장중이면 진행 중인 오늘 봉을 뺀다 */
export function completedCandles(candles: Candle[], symbol: string): Candle[] {
  return candles.length && isFormingBar(candles, '1d', symbol) ? candles.slice(0, -1) : candles;
}

export interface TargetInput {
  symbol: string;
  targetPct: number;
  stopPct: number;
  days: number;
}

export async function runTargetAnalysis(input: TargetInput): Promise<TargetAnalysisRecord> {
  const symbol = input.symbol.trim().toUpperCase();
  const { targetPct, stopPct, days } = input;
  const model = DEFAULT_MODEL;

  const candles = completedCandles(await dailyCandles(symbol), symbol);
  if (candles.length < days + 30) throw new Error(`${symbol}: 일봉이 부족해 기준선을 낼 수 없습니다(${candles.length}봉)`);
  const last = candles.at(-1)!;
  const baseDate = marketDate(last.timestamp, symbol);
  const entry = last.close;
  const base = firstTouch(candles, targetPct, stopPct, days);

  const context = await buildContext(symbol);
  const question = questionBlock({ targetPct, stopPct, days, baseDate, entry, earnings: earningsLine(symbol, baseDate, days) });

  let tokens = 0;
  let rateLimitedSeen = false;
  const agents = await Promise.all(
    AGENTS.map(async (agent): Promise<TargetAgentOpinion> => {
      try {
        const result = await callGemini<{ pTarget: number; pStop: number; pNeither: number; summary: string }>({
          system: agent.system + AGENT_TAIL,
          parts: [{ text: question }, { text: context.text }],
          schema: AGENT_SCHEMA,
          model,
          temperature: 0.3,
        });
        tokens += result.tokens;
        const p = normalizeProbs(result.data);
        return { role: agent.role, label: agent.label, ...p, summary: result.data.summary ?? '', error: null };
      } catch (error) {
        if (error instanceof GeminiError && error.rateLimited) rateLimitedSeen = true;
        return { role: agent.role, label: agent.label, pTarget: 0, pStop: 0, pNeither: 0, summary: '', error: (error as Error).message };
      }
    }),
  );
  if (agents.every((a) => a.error)) {
    throw new GeminiError(`4개 에이전트가 모두 실패했습니다: ${agents[0].error}`, undefined, rateLimitedSeen);
  }

  const opinions = agents
    .map((a) =>
      a.error
        ? `## ${a.label}\n⚠️ 분석 실패: ${a.error} — 제외하세요.`
        : `## ${a.label}\n- 목표 먼저 ${a.pTarget}% · 손절 먼저 ${a.pStop}% · 둘 다 아님 ${a.pNeither}%\n- 근거: ${a.summary}`,
    )
    .join('\n\n');

  const moderator = await callGemini<{
    pTarget: number; pStop: number; pNeither: number; summary: string; reasons: string[]; risks: string[];
  }>({
    system: MODERATOR_SYSTEM,
    parts: [{ text: question }, { text: context.text }, { text: `# 전문가 확률\n\n${opinions}` }],
    schema: MODERATOR_SCHEMA,
    model,
    temperature: 0.2,
  });
  tokens += moderator.tokens;

  const p = normalizeProbs(moderator.data);
  const record = {
    symbol,
    created_at: new Date().toISOString(),
    base_date: baseDate,
    entry_price: entry,
    target_pct: targetPct,
    stop_pct: stopPct,
    days,
    p_target: p.pTarget,
    p_stop: p.pStop,
    p_neither: p.pNeither,
    normalized: p.normalized ? 1 : 0,
    summary: String(moderator.data.summary ?? ''),
    reasons: JSON.stringify((moderator.data.reasons ?? []).slice(0, 3)),
    risks: JSON.stringify((moderator.data.risks ?? []).slice(0, 2)),
    agents: JSON.stringify(agents),
    base_target: base.hitTarget,
    base_stop: base.hitStop,
    base_neither: base.neither,
    base_expectancy: base.expectancy,
    base_samples: base.samples,
    prompt_version: TARGET_PROMPT_VERSION,
    model,
    tokens,
  };
  const info = db()
    .prepare(
      `INSERT INTO target_analysis (symbol, created_at, base_date, entry_price, target_pct, stop_pct, days,
         p_target, p_stop, p_neither, normalized, summary, reasons, risks, agents,
         base_target, base_stop, base_neither, base_expectancy, base_samples, prompt_version, model, tokens)
       VALUES (@symbol, @created_at, @base_date, @entry_price, @target_pct, @stop_pct, @days,
         @p_target, @p_stop, @p_neither, @normalized, @summary, @reasons, @risks, @agents,
         @base_target, @base_stop, @base_neither, @base_expectancy, @base_samples, @prompt_version, @model, @tokens)`,
    )
    .run(record);
  if (p.normalized) console.log(`[target] ${symbol} 확률 합이 100 이 아니어서 비율대로 맞췄습니다`);
  return getTargetAnalysis(Number(info.lastInsertRowid))!;
}

export function getTargetAnalysis(id: number): TargetAnalysisRecord | null {
  const row = db().prepare(`SELECT * FROM target_analysis WHERE id = ?`).get(id) as Row | undefined;
  return row ? toRecord(row) : null;
}

export function deleteTargetAnalysis(id: number): boolean {
  return db().prepare(`DELETE FROM target_analysis WHERE id = ?`).run(id).changes > 0;
}

// ── 채점 (읽을 때) ─────────────────────────────────────────

/**
 * 기록 하나를 확정 봉으로 채점한다 — `touchOutcome` 그대로(같은 날 둘 다면 손절).
 * 기준일 봉을 찾고, 그 뒤 `days` 봉이 다 있어야 판정한다. 아직이면 null.
 */
export function scoreRecord(
  record: Pick<TargetAnalysisRecord, 'symbol' | 'baseDate' | 'targetPct' | 'stopPct' | 'days'>,
  candles: Candle[],
): { outcome: TouchOutcome; outcomeDate: string } | null {
  const done = completedCandles(candles, record.symbol);
  const i = done.findIndex((c) => marketDate(c.timestamp, record.symbol) === record.baseDate);
  if (i < 0) return null;
  const outcome = touchOutcome(done, i, record.targetPct, record.stopPct, record.days);
  if (!outcome) return null;
  return { outcome, outcomeDate: marketDate(done[i + record.days].timestamp, record.symbol) };
}

/** 만기가 지났을 법한 기록만 캔들을 받아 채점한다(달력으로 대략 — 거래일 N 은 달력일 1.4N+3 안쪽) */
async function refreshOutcomes(rows: Row[]): Promise<void> {
  const now = Date.now();
  const due = rows.filter((r) => !r.outcome && Date.parse(r.base_date) + (r.days * 1.4 + 3) * 86_400_000 < now);
  const bySymbol = new Map<string, Row[]>();
  for (const r of due) bySymbol.set(r.symbol, [...(bySymbol.get(r.symbol) ?? []), r]);
  for (const [symbol, list] of bySymbol) {
    const candles = await dailyCandles(symbol).catch(() => [] as Candle[]);
    for (const r of list) {
      const scored = scoreRecord(toRecord(r), candles);
      if (!scored) continue;
      db()
        .prepare(`UPDATE target_analysis SET outcome = ?, outcome_date = ? WHERE id = ?`)
        .run(scored.outcome, scored.outcomeDate, r.id);
      r.outcome = scored.outcome;
      r.outcome_date = scored.outcomeDate;
    }
  }
}

export async function listTargetAnalyses(symbol?: string, limit = 100): Promise<TargetAnalysisRecord[]> {
  const rows = (
    symbol
      ? db().prepare(`SELECT * FROM target_analysis WHERE symbol = ? ORDER BY created_at DESC LIMIT ?`).all(symbol.toUpperCase(), limit)
      : db().prepare(`SELECT * FROM target_analysis ORDER BY created_at DESC LIMIT ?`).all(limit)
  ) as Row[];
  await refreshOutcomes(rows);
  return rows.map(toRecord);
}

// ── 성적 ──────────────────────────────────────────────────

const ORDER: TouchOutcome[] = ['target', 'stop', 'neither'];
/** 가장 높게 준 결과(같으면 target → stop → neither 순) */
export function topPick(p: { target: number; stop: number; neither: number }): TouchOutcome {
  const values = [p.target, p.stop, p.neither];
  return ORDER[values.indexOf(Math.max(...values))];
}

export interface TargetStats {
  scored: number;
  aiHit: number;
  baseHit: number;
  aiRate: number | null;
  baseRate: number | null;
  /** 30건 미만 — 판단 보류 */
  weak: boolean;
}

/** 채점된 기록에서 AI 의 최고 확률 결과 vs 기준선의 최고 결과가 실제와 맞은 비율 (전체 기록 기준) */
export function targetStats(records: TargetAnalysisRecord[]): TargetStats {
  const scored = records.filter((r) => r.outcome && r.base);
  const aiHit = scored.filter((r) => topPick({ target: r.pTarget, stop: r.pStop, neither: r.pNeither }) === r.outcome).length;
  const baseHit = scored.filter((r) => topPick(r.base!) === r.outcome).length;
  const pct = (n: number) => (scored.length ? Math.round((n / scored.length) * 1000) / 10 : null);
  return { scored: scored.length, aiHit, baseHit, aiRate: pct(aiHit), baseRate: pct(baseHit), weak: scored.length < 30 };
}

// ── 한 번에 여러 종목 (백그라운드 + 진행률) ─────────────────

export interface TargetProgress {
  running: boolean;
  total: number;
  done: number;
  current: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  input: Omit<TargetInput, 'symbol'> | null;
  results: { symbol: string; id: number | null; error: string | null }[];
  rateLimited: boolean;
  /** 한도 초과로 멈춰 분석하지 못한 종목 */
  skipped: string[];
}

let progress: TargetProgress = {
  running: false, total: 0, done: 0, current: null, startedAt: null, finishedAt: null,
  input: null, results: [], rateLimited: false, skipped: [],
};

export function getTargetProgress(): TargetProgress {
  return progress;
}

export class TargetInputError extends Error {}
export class TargetBusyError extends Error {}

const SYMBOL_RE = /^[A-Z0-9][A-Z0-9.\-]{0,14}$/;

/** 본문 검사 — 범위 밖·6종목 이상은 TargetInputError(400) */
export function validateTargetRequest(body: unknown): { symbols: string[]; targetPct: number; stopPct: number; days: number } {
  const b = (body ?? {}) as Record<string, unknown>;
  const symbols = Array.isArray(b.symbols)
    ? [...new Set(b.symbols.map((s) => String(s ?? '').trim().toUpperCase()).filter(Boolean))]
    : [];
  if (!symbols.length) throw new TargetInputError('종목을 1개 이상 고르세요.');
  if (symbols.length > TARGET_MAX_SYMBOLS) throw new TargetInputError(`한 번에 최대 ${TARGET_MAX_SYMBOLS}종목입니다(종목당 Gemini 5호출).`);
  const bad = symbols.filter((s) => !SYMBOL_RE.test(s));
  if (bad.length) throw new TargetInputError(`종목 코드 형식이 아닙니다: ${bad.join(', ')}`);
  const num = (key: 'targetPct' | 'stopPct' | 'days', label: string) => {
    const v = Number(b[key]);
    const [lo, hi] = TARGET_LIMITS[key];
    if (!Number.isFinite(v) || v < lo || v > hi) throw new TargetInputError(`${label}은(는) ${lo}~${hi} 사이여야 합니다.`);
    return v;
  };
  const targetPct = num('targetPct', '목표 수익률(%)');
  const stopPct = num('stopPct', '손절(%)');
  const days = num('days', '기간(거래일)');
  if (!Number.isInteger(days)) throw new TargetInputError('기간(거래일)은 정수여야 합니다.');
  return { symbols, targetPct, stopPct, days };
}

/**
 * 시작만 하고 돌려준다 — 5종목이면 1분 안팎. 종목은 **순차**, 429 면 남은 종목 중단.
 * Gemini 꺼짐은 여기서 막지 않는다(라우트가 503 으로 먼저 거른다).
 */
export function startTargetAnalysis(
  request: ReturnType<typeof validateTargetRequest>,
  run: (input: TargetInput) => Promise<TargetAnalysisRecord> = runTargetAnalysis,
): Promise<void> {
  if (progress.running) throw new TargetBusyError('목표 도달 분석이 이미 실행 중입니다.');
  const { symbols, ...input } = request;
  progress = {
    running: true, total: symbols.length, done: 0, current: symbols[0], startedAt: new Date().toISOString(),
    finishedAt: null, input, results: [], rateLimited: false, skipped: [],
  };
  return (async () => {
    try {
      for (let i = 0; i < symbols.length; i++) {
        const symbol = symbols[i];
        progress = { ...progress, current: symbol };
        try {
          const record = await run({ symbol, ...input });
          progress = { ...progress, results: [...progress.results, { symbol, id: record.id, error: null }] };
        } catch (error) {
          progress = { ...progress, results: [...progress.results, { symbol, id: null, error: (error as Error).message }] };
          if (error instanceof GeminiError && error.rateLimited) {
            progress = { ...progress, rateLimited: true, skipped: symbols.slice(i + 1) };
            break;
          }
        } finally {
          progress = { ...progress, done: progress.done + 1 };
        }
      }
    } finally {
      progress = { ...progress, running: false, current: null, finishedAt: new Date().toISOString() };
    }
  })();
}

export function targetDisabledReason(): string | null {
  return geminiDisabledReason();
}
