import type { WatchFolder } from '../types/watchlist';
import { DEFAULT_FOLDER_ID } from '../types/watchlist';

/**
 * 관심 목록·최근 조회의 **서버 저장 계층**.
 *
 * 목록은 기기 간에 같아야 한다 — 다른 PC 로 서버에 접속했는데 관심 목록이 비어 있으면
 * 스윙 분석 대상(=관심 목록)부터 달라진다. 그래서 목록만 서버에 두고,
 * **기기별 화면 설정(패널 높이·접힘·마지막 폴더)은 localStorage 에 그대로 남긴다.**
 *
 * ⚠️ 이 파일은 **모듈 단위로 한 벌**이다. `useWatchlist()` 는 여러 화면에서 각각 불리는데
 * 인스턴스마다 서버를 읽고 쓰면 요청이 그 수만큼 늘고 revision 이 서로 어긋난다
 * (v2.9.0 의 계좌 공유 상태와 같은 이유).
 *
 * ⚠️ **폴링하지 않는다.** 앱 시작 시 한 번과 탭이 다시 보일 때 한 번만 받는다.
 */

const URL = '/api/user-data/watchlist';

/** 관심 목록은 사람이 손으로 고친다 — 짧게 모아 보낸다 */
const FOLDERS_DEBOUNCE_MS = 500;
/** 최근 조회는 종목을 볼 때마다 바뀐다 — 매번 보내면 요청이 쏟아진다 */
const RECENT_DEBOUNCE_MS = 2000;

export interface WatchlistPayload {
  folders: WatchFolder[] | null;
  recent: string[] | null;
  revision: number;
  updatedAt: string | null;
}

/** 화면 구석에 보여 줄 상태 — 조용히 두면 기기 간에 어긋난 걸 모른다 */
export type SyncState = 'idle' | 'saving' | 'offline';

type StateListener = (state: SyncState) => void;
const stateListeners = new Set<StateListener>();
let syncState: SyncState = 'idle';

function setState(next: SyncState) {
  if (syncState === next) return;
  syncState = next;
  /*
   * ⚠️ 구독자 깨우기는 **마이크로태스크로 미룬다.** `queueSave()` 는 `persistFolders()` 안에서
   * 불리고, 그건 다시 setState 업데이터 **안**에서 불린다 — 여기서 곧바로 알리면 다른
   * 컴포넌트의 setState 를 렌더 도중 호출하게 되어 React 가 경고를 낸다
   * (`useWatchlist` 의 broadcastFolders 가 같은 이유로 미룬다).
   */
  queueMicrotask(() => {
    for (const listener of stateListeners) listener(syncState);
  });
}

export function getSyncState(): SyncState {
  return syncState;
}

export function subscribeSyncState(listener: StateListener): () => void {
  stateListeners.add(listener);
  return () => stateListeners.delete(listener);
}

/** 서버가 알려 준 마지막 revision — 저장할 때 그대로 돌려보낸다 */
let revision = 0;
export const getRevision = () => revision;

/**
 * 서버 값이 도착했을 때 화면에 반영하는 통로.
 * `useWatchlist` 가 등록한다 — 이 파일이 React 상태를 직접 건드리지 않게 하기 위해서다.
 */
let applyRemote: ((payload: { folders?: WatchFolder[]; recent?: string[] }) => void) | null = null;
export function registerApply(fn: typeof applyRemote) {
  applyRemote = fn;
}

/** 지금 화면이 들고 있는 값을 가져오는 통로 (충돌 합치기에 쓴다) */
let readLocal: (() => { folders: WatchFolder[]; recent: string[] }) | null = null;
export function registerRead(fn: typeof readLocal) {
  readLocal = fn;
}

export async function fetchRemote(): Promise<WatchlistPayload | null> {
  try {
    const res = await fetch(URL);
    if (!res.ok) return null;
    const body = (await res.json()) as WatchlistPayload;
    revision = body.revision;
    setState('idle');
    return body;
  } catch {
    // 서버가 안 뜬 것뿐이다 — 화면은 localStorage 값으로 계속 돈다.
    setState('offline');
    return null;
  }
}

// ── 합치기 ───────────────────────────────────────────────────────────────────

/**
 * 두 목록을 **잃지 않는 방향**으로 합친다.
 *
 * ⚠️ 어느 쪽에도 있던 종목이 사라지면 안 된다. 그래서 한쪽을 버리지 않고 **합집합**을 만든다.
 * 같은 id 의 폴더는 하나로 보고, 한쪽에만 있는 폴더는 그대로 남긴다.
 * (삭제가 되살아날 수는 있다 — 종목이 사라지는 것보다는 낫다는 판단이다.)
 */
export function mergeFolders(a: WatchFolder[], b: WatchFolder[]): WatchFolder[] {
  const byId = new Map<string, WatchFolder>();
  const order: string[] = [];

  for (const folder of [...a, ...b]) {
    const found = byId.get(folder.id);
    if (!found) {
      byId.set(folder.id, { ...folder, symbols: [...folder.symbols] });
      order.push(folder.id);
      continue;
    }
    for (const symbol of folder.symbols) {
      if (!found.symbols.includes(symbol)) found.symbols.push(symbol);
    }
  }

  // 같은 종목이 두 폴더에 들어가면 먼저 나온 쪽만 남긴다 (normalize 와 같은 규칙).
  const seen = new Set<string>();
  const merged = order.map((id) => {
    const folder = byId.get(id)!;
    return {
      ...folder,
      symbols: folder.symbols.filter((s) => {
        if (seen.has(s)) return false;
        seen.add(s);
        return true;
      }),
    };
  });

  const others = merged.filter((f) => f.id !== DEFAULT_FOLDER_ID);
  const fallback = merged.find((f) => f.id === DEFAULT_FOLDER_ID);
  return [
    fallback ?? { id: DEFAULT_FOLDER_ID, name: '미분류', collapsed: false, symbols: [] },
    ...others,
  ];
}

/** 최근 조회는 최신순이 뜻이 있다 — 내 쪽을 앞에 두고 합친 뒤 20개로 자른다 */
export function mergeRecent(mine: string[], theirs: string[]): string[] {
  return [...new Set([...mine, ...theirs])].slice(0, 20);
}

// ── 보내기 ───────────────────────────────────────────────────────────────────

let timer: ReturnType<typeof setTimeout> | null = null;
let queued: { folders?: WatchFolder[]; recent?: string[] } = {};
let inFlight = false;

/** 변경을 모아 보낸다 — 화면은 이미 바뀐 뒤이고 서버 저장만 미룬다 */
export function queueSave(patch: { folders?: WatchFolder[]; recent?: string[] }) {
  queued = { ...queued, ...patch };
  setState('saving');

  const delay = patch.folders ? FOLDERS_DEBOUNCE_MS : RECENT_DEBOUNCE_MS;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void flush(), delay);
}

export async function flush(): Promise<void> {
  if (inFlight) return;
  const payload = queued;
  if (payload.folders === undefined && payload.recent === undefined) {
    setState('idle');
    return;
  }

  inFlight = true;
  queued = {};
  try {
    const res = await fetch(URL, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...payload, baseRevision: revision }),
    });

    if (res.status === 409) {
      /*
        다른 기기가 먼저 바꿨다. **서버 값을 그대로 채택하지 않고 합친다** —
        채택만 하면 방금 내가 담은 종목이 조용히 사라진다.
      */
      const body = (await res.json()) as { current: WatchlistPayload };
      const server = body.current;
      revision = server.revision;

      const local = readLocal?.() ?? { folders: [], recent: [] };
      const folders = mergeFolders(local.folders, server.folders ?? []);
      const recent = mergeRecent(local.recent, server.recent ?? []);
      applyRemote?.({ folders, recent });

      inFlight = false;
      // 합친 결과를 새 revision 으로 다시 보낸다 (한 번만 — 계속 부딪히면 다음 변경에 맡긴다).
      queued = { folders, recent };
      await flush();
      return;
    }

    if (!res.ok) {
      // 400(검증 실패) 등은 다시 보내도 같다 — 대기 상태로 남기지 않는다.
      setState('idle');
      return;
    }

    const body = (await res.json()) as WatchlistPayload;
    revision = body.revision;
    setState(queued.folders || queued.recent ? 'saving' : 'idle');
  } catch {
    // 서버가 안 되면 localStorage 에만 남는다. 다음에 연결되면 올린다.
    queued = { ...payload, ...queued };
    setState('offline');
  } finally {
    inFlight = false;
    if (queued.folders || queued.recent) {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void flush(), FOLDERS_DEBOUNCE_MS);
    }
  }
}

/** 밀린 저장이 있으면 올린다 — 탭이 다시 보일 때·온라인이 됐을 때 부른다 */
export function retryPending(): void {
  if (queued.folders || queued.recent) void flush();
}
