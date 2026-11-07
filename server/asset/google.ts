/**
 * 구글 시트 읽기 · 쓰기 — **새 의존성 없이** Node 내장 `crypto` 로 서비스 계정 JWT(RS256)를 서명해 접근 토큰을 받고,
 * Sheets API v4 `values:batchGet`(읽기) · `values:batchUpdate`(쓰기 — 값 칸만 · 한 요청)를 `fetch` 로 부른다(v2.61.0 · v2.62.0 · v2.63.0 쓰기).
 *
 * - 범위(scope)는 `spreadsheets`(읽기 · 쓰기 — v2.62.0). **쓰기 함수는 `valuesWrite` 하나**(쓰는 방식 RAW / USER_ENTERED 는 인자) · 부르는 곳은
 *   `sheet.ts` 세 곳(`writeAssetClass` 「티커」 D14~D42 자산 분류 · `writeTargetRatio` 목표 비율 여섯 칸 · `writeAccountDates` 계좌 이름 날짜(v2.64.0) — RAW)과
 *   시트 가격(v2.65.0 — `priceSheet.ts` 바꾸기 · 되돌리기 USER_ENTERED · `priceWriter.ts` 10초 쓰기 RAW)뿐(`asset:test` · `assetprice:test` 가 검색으로 확인).
 *   서식 쓰기(스프레드시트 단위 batchUpdate)는 쓰지 않는다. 시트 쓰기는 서비스 계정이 시트의 「편집자」 여야 된다.
 * - 토큰은 만료 1분 전까지 메모리에 둔다(열쇠 파일이 바뀌면 새로 받는다).
 * - 실패는 쉬운 말 이유(`AssetSheetError.kind`)로 바꾼다. ⚠️ 구글 응답 본문 · 열쇠 내용 · 시트 ID 는 로그 · 오류 문구에 싣지 않는다.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import type { AssetSheetErrorKind } from '../../src/types/asset';
import type { AssetSheetConfig } from './config';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SHEETS_URL = 'https://sheets.googleapis.com/v4/spreadsheets';
const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const TOKEN_LIFETIME_S = 3600;
const TIMEOUT_MS = 15_000;

export class AssetSheetError extends Error {
  constructor(
    readonly kind: AssetSheetErrorKind,
    message: string,
    /** 구글이 돌려준 HTTP 상태(그 밖 응답 실패만 — 시트 가격 10초 쓰기가 429 · 5xx 를 보고 쉰다 · v2.65.0) */
    readonly status?: number,
    /** 400(탭 이름 없음)일 때 구글이 알려 준 범위의 탭 이름 — 점검 스크립트(`asset:check-sheet` · v2.65.1)가 「어디인지」 에 쓴다 · 문구는 그대로 */
    readonly tab?: string,
  ) {
    super(message);
  }
}

interface ServiceAccountKey {
  client_email: string;
  private_key: string;
}

function readKey(keyFile: string): ServiceAccountKey {
  let raw: string;
  try {
    raw = fs.readFileSync(keyFile, 'utf8');
  } catch {
    throw new AssetSheetError('key-file', '서비스 계정 열쇠 파일이 없습니다(`.env` 의 GOOGLE_SA_KEY_FILE 경로를 확인하세요).');
  }
  try {
    const key = JSON.parse(raw) as Partial<ServiceAccountKey>;
    if (typeof key.client_email === 'string' && typeof key.private_key === 'string') return { client_email: key.client_email, private_key: key.private_key };
  } catch {
    /* 아래 오류 */
  }
  throw new AssetSheetError('key-file', '서비스 계정 열쇠 파일의 모양이 맞지 않습니다(구글에서 받은 JSON 그대로여야 합니다).');
}

const b64url = (v: Buffer | string) => Buffer.from(v).toString('base64url');

/** 서비스 계정 JWT — 시험이 서명을 확인하려고 내보낸다 */
export function signJwt(key: ServiceAccountKey, nowS: number): string {
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iss: key.client_email, scope: SCOPE, aud: TOKEN_URL, iat: nowS, exp: nowS + TOKEN_LIFETIME_S }));
  const signature = crypto.createSign('RSA-SHA256').update(`${header}.${claims}`).sign(key.private_key);
  return `${header}.${claims}.${b64url(signature)}`;
}

/** 네트워크 실패를 쉬운 말로 */
async function send(url: string, init: RequestInit): Promise<Response> {
  try {
    return await fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch {
    throw new AssetSheetError('network', '구글에 연결하지 못했습니다(네트워크).');
  }
}

let cachedToken: { keyFile: string; mtimeMs: number; token: string; expiresAt: number } | null = null;

/** 시험이 토큰 캐시를 비운다 */
export function resetTokenCache(): void {
  cachedToken = null;
}

async function accessToken(keyFile: string): Promise<string> {
  let mtimeMs = 0;
  try {
    mtimeMs = fs.statSync(keyFile).mtimeMs;
  } catch {
    /* readKey 가 「열쇠 파일 없음」 으로 알린다 */
  }
  if (cachedToken && cachedToken.keyFile === keyFile && cachedToken.mtimeMs === mtimeMs && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.token;
  const key = readKey(keyFile);
  let assertion: string;
  try {
    assertion = signJwt(key, Math.floor(Date.now() / 1000));
  } catch {
    throw new AssetSheetError('key-file', '서비스 계정 열쇠로 서명하지 못했습니다(열쇠 파일을 확인하세요).');
  }
  const res = await send(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString(),
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number };
  if (!res.ok || typeof body.access_token !== 'string') {
    throw new AssetSheetError('auth', `구글 인증에 실패했습니다(${res.status} — 서비스 계정 열쇠가 지워졌거나 바뀌었는지 확인하세요).`);
  }
  cachedToken = { keyFile, mtimeMs, token: body.access_token, expiresAt: Date.now() + (body.expires_in ?? TOKEN_LIFETIME_S) * 1000 };
  return body.access_token;
}

export type ValueRender = 'UNFORMATTED_VALUE' | 'FORMULA';
/** 범위 하나의 값 — 줄 → 칸. 빈 칸은 구글이 줄 끝을 잘라 보낸다(없는 칸 = 빈 칸) */
export type CellRows = (string | number | boolean)[][];

/**
 * 여러 범위를 한 번에 읽는다(`values:batchGet` · 줄 단위). 돌려주는 배열은 `ranges` 순서 그대로.
 * 403 = 시트를 서비스 계정에 공유하지 않음 · 404 = 시트 ID 가 틀림 · 400 = 탭 이름이 없음(시트 모양이 바뀜).
 */
export async function batchGet(config: AssetSheetConfig, ranges: string[], render: ValueRender): Promise<CellRows[]> {
  const token = await accessToken(config.keyFile);
  const params = new URLSearchParams({ valueRenderOption: render, majorDimension: 'ROWS' });
  for (const r of ranges) params.append('ranges', r);
  const res = await send(`${SHEETS_URL}/${encodeURIComponent(config.sheetId)}/values:batchGet?${params.toString()}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  await throwIfFailed(res, 'read');
  const body = (await res.json().catch(() => null)) as { valueRanges?: { values?: CellRows }[] } | null;
  if (!body?.valueRanges || body.valueRanges.length !== ranges.length) throw new AssetSheetError('network', '구글 시트 응답의 모양이 올바르지 않습니다.');
  return body.valueRanges.map((v) => v.values ?? []);
}

/**
 * 구글 응답 실패 → 쉬운 말(읽기 · 쓰기 공용). 403 은 둘 — 구글 클라우드 프로젝트에서 Sheets API 를 켜지 않음(SERVICE_DISABLED) ·
 * 시트를 공유하지 않음(쓰기는 「편집자」 여야 한다). 이유 칸만 본다(본문을 남기지 않는다).
 */
async function throwIfFailed(res: Response, action: 'read' | 'write'): Promise<void> {
  if (res.ok) return;
  if (res.status === 401) resetTokenCache();
  if (res.status === 403) {
    const err = (await res.json().catch(() => null)) as { error?: { details?: { reason?: string }[] } } | null;
    if (err?.error?.details?.some((d) => d.reason === 'SERVICE_DISABLED' || d.reason === 'API_DISABLED')) {
      throw new AssetSheetError('api-disabled', '구글 클라우드 프로젝트에서 Google Sheets API 가 켜져 있지 않습니다(서비스 계정이 속한 프로젝트에서 「사용」 을 누르세요).');
    }
    throw new AssetSheetError(
      'not-shared',
      action === 'read'
        ? '시트를 읽을 권한이 없습니다(시트를 서비스 계정 이메일에 「뷰어」 로 공유했는지 확인하세요).'
        : '시트에 쓸 권한이 없습니다(시트를 서비스 계정 이메일에 「편집자」 로 공유했는지 확인하세요).',
    );
  }
  if (res.status === 404) throw new AssetSheetError('not-found', '시트를 찾지 못했습니다(`.env` 의 ASSET_SHEET_ID 를 확인하세요).');
  if (res.status === 400) {
    // 구글 오류 글 「Unable to parse range: '탭'!B12」 에서 탭 이름만(본문은 남기지 않는다)
    const err = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
    const tab = err?.error?.message?.match(/Unable to parse range:\s*'?((?:[^'!]|'')+?)'?!/)?.[1]?.replace(/''/g, "'");
    throw new AssetSheetError('shape', `시트 모양이 바뀌었어요(${action === 'read' ? '읽을' : '쓸'} 탭 이름이 시트에 없습니다).`, 400, tab);
  }
  throw new AssetSheetError('network', `구글 시트 응답이 올바르지 않습니다(${res.status}).`, res.status);
}

/** 쓸 칸 하나 — 범위(한 칸) · 값(숫자는 JSON 숫자로 — 시트에 숫자로 들어간다) */
export interface CellWrite {
  range: string;
  value: string | number;
}

/**
 * 쓰는 방식(구글 `valueInputOption`) — `RAW`: 글자는 글자 그대로(「=E14」 도 글자로 들어간다) ·
 * `USER_ENTERED`: 사람이 친 것처럼(「=」 로 시작하면 수식) — **수식 칸을 쓸 때만**(시트 가격 [바꾸기] · [되돌리기] · v2.65.0).
 */
export type ValueInput = 'RAW' | 'USER_ENTERED';

/**
 * **시트 쓰기 — 이 앱의 유일한 쓰기 함수**(`values:batchUpdate` · 여러 칸을 **한 요청**으로). 쓰는 방식은 인자로 고른다(기본 `RAW`).
 * 숫자는 JSON 숫자로 보내 시트에 숫자로 들어간다(글자 「10」 이 아니다 — 시트 수식이 깨지지 않게).
 * 부르는 곳: `sheet.ts` `writeAssetClass` · `writeTargetRatio` · `writeAccountDates`(RAW) · `priceSheet.ts` `convertSheetPrices` · `restoreSheetPrices`(USER_ENTERED) ·
 * `priceWriter.ts` `priceTick`(가격 · 환율 숫자 — RAW) — 모두 칸 · 값 확인을 거친 뒤.
 */
export async function valuesWrite(config: AssetSheetConfig, cells: CellWrite[], input: ValueInput = 'RAW'): Promise<void> {
  const token = await accessToken(config.keyFile);
  const res = await send(`${SHEETS_URL}/${encodeURIComponent(config.sheetId)}/values:batchUpdate`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ valueInputOption: input, data: cells.map((c) => ({ range: c.range, majorDimension: 'ROWS', values: [[c.value]] })) }),
  });
  await throwIfFailed(res, 'write');
}
