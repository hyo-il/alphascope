/**
 * Gemini API 호출 래퍼.
 *
 * 토스 쪽의 httpClient 와 같은 역할을 한다 — 인증·동시성·재시도가 여기 한 곳에 모인다.
 * 무료 티어의 실질 병목은 하루 한도가 아니라 분당 요청 수(RPM)라서,
 * 호출은 전부 이 파일의 큐를 지나간다. 종목 10개를 한꺼번에 돌리면
 * 5 × 10 = 50 요청이 동시에 나가 429 를 맞는다.
 */

const BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

/** 기본 모델. 4개 에이전트를 돌려야 하므로 가장 싸고 빠른 것을 쓴다. */
export const DEFAULT_MODEL = process.env.GEMINI_MODEL ?? 'gemini-3.5-flash-lite';

/** 동시에 날릴 수 있는 요청 수 — 한 종목의 에이전트 4명이 병렬로 도는 정도 */
const MAX_CONCURRENCY = Number(process.env.GEMINI_CONCURRENCY ?? 4);

/** 요청 사이 최소 간격(ms). 분당 한도를 넘지 않도록 완만하게 흘려보낸다. */
const MIN_INTERVAL_MS = Number(process.env.GEMINI_MIN_INTERVAL_MS ?? 250);

const MAX_RETRIES = 3;

export class GeminiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    /** 한도 초과인지 — 스케줄러가 이걸 보고 주기를 늦춘다 */
    readonly rateLimited = false,
  ) {
    super(message);
    this.name = 'GeminiError';
  }
}

/**
 * 키가 있는지. 없으면 Gemini 기능 전체가 비활성화된다 —
 * 기존 기능(토스·Claude 수동 분석)에는 아무 영향이 없어야 한다.
 */
export function isGeminiEnabled(): boolean {
  const key = process.env.GEMINI_API_KEY?.trim();
  return Boolean(key) && !key!.startsWith('your_');
}

function apiKey(): string {
  if (!isGeminiEnabled()) {
    throw new GeminiError('GEMINI_API_KEY 가 설정되지 않았습니다. .env 를 확인하세요.');
  }
  return process.env.GEMINI_API_KEY!.trim();
}

// ── 동시성 큐 ────────────────────────────────────────────────
let active = 0;
let lastStart = 0;
const waiting: (() => void)[] = [];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function acquire(): Promise<void> {
  if (active >= MAX_CONCURRENCY) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  active++;
  const gap = Date.now() - lastStart;
  if (gap < MIN_INTERVAL_MS) await sleep(MIN_INTERVAL_MS - gap);
  lastStart = Date.now();
}

function release(): void {
  active--;
  waiting.shift()?.();
}

// ── 호출 ────────────────────────────────────────────────────

/** generateContent 응답에서 실제로 읽는 부분만 */
interface GeminiResponse {
  candidates?: {
    content?: { parts?: { text?: string }[] };
    finishReason?: string;
  }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { totalTokenCount?: number };
  error?: { message?: string };
}

export interface GeminiPart {
  text?: string;
  inlineData?: { mimeType: string; data: string };
}

export interface GeminiCallOptions {
  /** 역할을 규정하는 시스템 프롬프트 */
  system: string;
  /** 사용자 파트 — 텍스트와 (기술 분석가만) 차트 이미지 */
  parts: GeminiPart[];
  /** 구조화 출력 스키마. 주면 반드시 이 모양의 JSON 이 온다. */
  schema?: unknown;
  model?: string;
  temperature?: number;
}

export interface GeminiCallResult<T> {
  data: T;
  raw: string;
  model: string;
  /** 이번 호출에 쓴 토큰 — 예산 감시용 */
  tokens: number;
  elapsedMs: number;
}

/**
 * Gemini 를 한 번 호출하고 JSON 을 파싱해 돌려준다.
 *
 * 429 와 5xx 는 지수 백오프로 재시도한다. 400 은 프롬프트나 스키마가 잘못된 것이라
 * 재시도해도 같은 결과라서 즉시 던진다.
 */
export async function callGemini<T>(options: GeminiCallOptions): Promise<GeminiCallResult<T>> {
  const model = options.model ?? DEFAULT_MODEL;
  const body = {
    systemInstruction: { parts: [{ text: options.system }] },
    contents: [{ role: 'user', parts: options.parts }],
    generationConfig: {
      temperature: options.temperature ?? 0.4,
      ...(options.schema
        ? { responseMimeType: 'application/json', responseSchema: options.schema }
        : {}),
    },
  };

  const key = apiKey();
  const url = `${BASE_URL}/models/${model}:generateContent`;
  const startedAt = Date.now();

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    await acquire();
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      });
    } catch (error) {
      release();
      if (attempt === MAX_RETRIES) {
        throw new GeminiError(`Gemini 호출 실패: ${(error as Error).message}`);
      }
      await sleep(2 ** attempt * 1000);
      continue;
    }
    release();

    if (response.status === 429 || response.status >= 500) {
      if (attempt === MAX_RETRIES) {
        throw new GeminiError(
          response.status === 429
            ? 'Gemini 요청 한도를 초과했습니다. 분석 주기를 늘리거나 종목 수를 줄이세요.'
            : `Gemini 서버 오류 (${response.status})`,
          response.status,
          response.status === 429,
        );
      }
      // Retry-After 를 존중하되, 없으면 지수 백오프
      const retryAfter = Number(response.headers.get('retry-after'));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 1500);
      continue;
    }

    const json = (await response.json().catch(() => null)) as GeminiResponse | null;
    if (!response.ok) {
      throw new GeminiError(json?.error?.message ?? `Gemini 오류 (${response.status})`, response.status);
    }

    const candidate = json?.candidates?.[0];
    const text: string = (candidate?.content?.parts ?? [])
      .map((part) => part?.text ?? '')
      .join('')
      .trim();

    if (!text) {
      // 안전 필터에 걸리면 parts 가 비어서 온다 — 원인을 구분해 알린다.
      const reason = candidate?.finishReason ?? json?.promptFeedback?.blockReason ?? 'unknown';
      throw new GeminiError(`Gemini 가 빈 응답을 반환했습니다 (finishReason: ${reason})`);
    }

    return {
      data: options.schema ? (parseJson<T>(text) as T) : (text as unknown as T),
      raw: text,
      model,
      tokens: Number(json?.usageMetadata?.totalTokenCount ?? 0),
      elapsedMs: Date.now() - startedAt,
    };
  }

  throw new GeminiError('Gemini 호출에 실패했습니다.');
}

/**
 * 구조화 출력을 켜도 모델이 ```json 펜스를 두르는 경우가 드물게 있다.
 * 파싱은 관대하게 하되, 실패하면 원문을 함께 알려 디버깅이 되게 한다.
 */
function parseJson<T>(text: string): T {
  const cleaned = text
    .replace(/^\s*```(?:json)?/i, '')
    .replace(/```\s*$/, '')
    .trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1)) as T;
      } catch {
        /* 아래에서 던진다 */
      }
    }
    throw new GeminiError(`Gemini 응답을 JSON 으로 읽지 못했습니다: ${cleaned.slice(0, 200)}`);
  }
}
