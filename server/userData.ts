/**
 * 사용자 데이터 저장소 (기기 간 공유) — 관심 목록·최근 조회.
 *
 * ⚠️ **서버 저장은 이 파일 한 곳을 지난다.** 라우트는 여기만 부른다.
 * 나중에 로그인이 들어오면 이 파일의 함수에 `userId` 를 더하고 테이블에 컬럼을 추가하면 된다
 * (지금은 컬럼을 만들지 않는다 — 쓰지 않는 컬럼은 누가 채우는지 헷갈리게 한다).
 *
 * ⚠️ 이 API 에는 인증이 없다. 서버 주소를 아는 사람은 목록을 바꿀 수 있다 —
 * 모의투자 계좌가 이미 같은 상태이고, 접근 제한은 별도 작업으로 예정돼 있다.
 */

import { getDb } from './db';
import { DEFAULT_FOLDER_ID, DEFAULT_FOLDER_NAME, type WatchFolder } from '../src/types/watchlist';

export class UserDataError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UserDataError';
  }
}

/** 읽은 값이 그 사이 바뀌었다 — 화면이 서버 값을 받아 합친 뒤 다시 보낸다 */
export class RevisionConflictError extends Error {
  constructor(readonly current: WatchlistPayload) {
    super('다른 기기에서 먼저 바뀌었습니다.');
    this.name = 'RevisionConflictError';
  }
}

const FOLDERS_KEY = 'watchlist.folders';
const RECENT_KEY = 'watchlist.recent';

/*
 * 상한은 **앱의 안전장치**이지 어떤 근거가 있는 수치가 아니다.
 * 실수나 장난으로 거대한 목록이 들어와 DB·화면이 감당하지 못하는 것을 막는 선이다.
 */
const MAX_FOLDERS = 50;
const MAX_SYMBOLS = 500;
const MAX_RECENT = 20;
const MAX_NAME_LEN = 40;

/** 서버도 같은 심볼 규칙을 쓴다 (토스 symbol 은 영문·숫자·. - 만 받는다) */
const SYMBOL_PATTERN = /^[A-Z0-9.\-]+$/;

export interface WatchlistPayload {
  folders: WatchFolder[] | null;
  recent: string[] | null;
  revision: number;
  updatedAt: string | null;
  /**
   * 형식이 틀려 **건너뛴** 항목의 원래 값 (최대 20개).
   *
   * ⚠️ 예전에는 이런 값 하나에 요청 전체를 400 으로 돌려보냈다. 오래 쓴 localStorage 에는
   * 과거 버그로 들어간 값(한글 이름 등)이 남아 있을 수 있어서, 그 하나 때문에 **목록 전체가
   * 저장되지 않았다** — 그러고도 화면은 "저장했습니다" 를 띄워 서버가 빈 채로 남았다
   * (2026-09-24 신고). 이제는 나머지를 저장하고 무엇을 버렸는지 알린다.
   */
  skipped?: string[];
}

interface Row {
  value: string;
  revision: number;
  updated_at: string;
}

function readKey<T>(key: string): { value: T | null; revision: number; updatedAt: string | null } {
  const row = getDb()
    .prepare(`SELECT value, revision, updated_at FROM user_data WHERE key = ?`)
    .get(key) as Row | undefined;
  if (!row) return { value: null, revision: 0, updatedAt: null };
  try {
    return { value: JSON.parse(row.value) as T, revision: row.revision, updatedAt: row.updated_at };
  } catch {
    // 손상된 값이면 없는 것으로 본다 — 여기서 던지면 목록 전체를 못 읽는다.
    return { value: null, revision: row.revision, updatedAt: row.updated_at };
  }
}

/**
 * 관심 목록의 revision 은 **폴더·최근을 합쳐 하나**로 본다.
 * 둘을 따로 세면 화면이 번호를 두 개 들고 다녀야 하고, 한쪽만 충돌하는 상황을 또 나눠야 한다.
 */
export function getWatchlist(): WatchlistPayload {
  const folders = readKey<WatchFolder[]>(FOLDERS_KEY);
  const recent = readKey<string[]>(RECENT_KEY);
  const revision = Math.max(folders.revision, recent.revision);
  const updatedAt =
    [folders.updatedAt, recent.updatedAt].filter(Boolean).sort().at(-1) ?? null;
  return { folders: folders.value, recent: recent.value, revision, updatedAt };
}

/** 최대 이만큼만 알려 준다 — 목록이 통째로 망가진 경우 토스트가 화면을 덮지 않게 */
const MAX_SKIPPED_REPORTED = 20;

/**
 * 심볼을 다듬는다. 형식이 틀리면 `null` — **던지지 않는다.**
 * 하나 때문에 목록 전체를 버리면 사용자가 잃는 것이 훨씬 크다.
 */
function cleanSymbol(raw: unknown): string | null {
  const symbol = String(raw ?? '').trim().toUpperCase();
  if (!symbol || symbol.length > 20 || !SYMBOL_PATTERN.test(symbol)) return null;
  return symbol;
}

/**
 * 들어온 폴더 목록을 다듬는다.
 *
 * ⚠️ **기본 폴더(폴더 없는 종목)는 반드시 하나 남긴다.** 화면의 `normalize()` 와 같은 규칙이다 —
 * 여기서 빠뜨리면 그 안의 종목이 통째로 사라진다 (CLAUDE.md 사고 이력).
 */
function cleanFolders(raw: unknown, skipped: string[]): WatchFolder[] {
  if (!Array.isArray(raw)) throw new UserDataError('folders 는 배열이어야 합니다.');
  if (raw.length > MAX_FOLDERS) {
    throw new UserDataError(`폴더가 너무 많습니다 (최대 ${MAX_FOLDERS}개).`);
  }

  const seen = new Set<string>();
  const cleaned: WatchFolder[] = raw.map((f) => {
    const item = (f ?? {}) as Partial<WatchFolder>;
    if (typeof item.id !== 'string' || !item.id) {
      throw new UserDataError('폴더에 id 가 없습니다.');
    }
    const name = typeof item.name === 'string' && item.name.trim() ? item.name.trim() : '이름 없음';
    return {
      id: item.id,
      name: name.slice(0, MAX_NAME_LEN),
      collapsed: Boolean(item.collapsed),
      // 같은 종목이 두 폴더에 들어가면 어느 쪽이 진짜인지 알 수 없다 — 먼저 나온 쪽만 남긴다.
      symbols: (Array.isArray(item.symbols) ? item.symbols : []).flatMap((value) => {
        const symbol = cleanSymbol(value);
        if (!symbol) {
          // 건너뛴 값은 **원래 모습 그대로** 알린다 — 사용자가 무엇을 다시 담을지 알아야 한다.
          if (skipped.length < MAX_SKIPPED_REPORTED) skipped.push(String(value).slice(0, 20));
          return [];
        }
        if (seen.has(symbol)) return [];
        seen.add(symbol);
        return [symbol];
      }),
    };
  });

  if (seen.size > MAX_SYMBOLS) {
    throw new UserDataError(`종목이 너무 많습니다 (최대 ${MAX_SYMBOLS}개).`);
  }

  const others = cleaned.filter((f) => f.id !== DEFAULT_FOLDER_ID);
  const fallback = cleaned.find((f) => f.id === DEFAULT_FOLDER_ID);
  return [
    {
      id: DEFAULT_FOLDER_ID,
      name: DEFAULT_FOLDER_NAME,
      collapsed: false,
      symbols: fallback?.symbols ?? [],
    },
    ...others,
  ];
}

function cleanRecent(raw: unknown, skipped: string[]): string[] {
  if (!Array.isArray(raw)) throw new UserDataError('recent 는 배열이어야 합니다.');
  const seen = new Set<string>();
  return raw
    .flatMap((value) => {
      const symbol = cleanSymbol(value);
      if (!symbol) {
        if (skipped.length < MAX_SKIPPED_REPORTED) skipped.push(String(value).slice(0, 20));
        return [];
      }
      if (seen.has(symbol)) return [];
      seen.add(symbol);
      return [symbol];
    })
    .slice(0, MAX_RECENT);
}

/**
 * 관심 목록 저장. `baseRevision` 이 현재와 다르면 `RevisionConflictError` 를 던진다.
 * `folders` · `recent` 는 각각 선택이다 — 보낸 것만 바꾼다.
 */
export function saveWatchlist(input: {
  folders?: unknown;
  recent?: unknown;
  baseRevision: unknown;
}): WatchlistPayload {
  const base = Number(input.baseRevision);
  if (!Number.isInteger(base) || base < 0) {
    throw new UserDataError('baseRevision 이 필요합니다.');
  }
  if (input.folders === undefined && input.recent === undefined) {
    throw new UserDataError('folders 또는 recent 중 하나는 있어야 합니다.');
  }

  // 검증은 트랜잭션 **밖**에서 먼저 한다 — 일부만 저장되는 일이 없게.
  const skipped: string[] = [];
  const folders = input.folders === undefined ? undefined : cleanFolders(input.folders, skipped);
  const recent = input.recent === undefined ? undefined : cleanRecent(input.recent, skipped);

  const current = getWatchlist();
  if (current.revision !== base) throw new RevisionConflictError(current);

  const db = getDb();
  const next = current.revision + 1;
  const now = new Date().toISOString();

  db.transaction(() => {
    const put = db.prepare(
      `INSERT INTO user_data (key, value, revision, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value,
                                      revision = excluded.revision,
                                      updated_at = excluded.updated_at`,
    );
    // 보내지 않은 쪽도 **같은 revision 으로 올려 둔다** — 그러지 않으면 두 키의 번호가
    // 갈려 다음 저장이 엉뚱하게 충돌한다.
    put.run(FOLDERS_KEY, JSON.stringify(folders ?? current.folders ?? []), next, now);
    put.run(RECENT_KEY, JSON.stringify(recent ?? current.recent ?? []), next, now);
  })();

  return { ...getWatchlist(), ...(skipped.length ? { skipped } : {}) };
}
