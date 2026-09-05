import { useCallback, useEffect, useMemo, useState } from 'react';
import { DEFAULT_FOLDER_ID, DEFAULT_FOLDER_NAME, type WatchFolder } from '../types/watchlist';

/**
 * 관심 목록(폴더) · 최근 조회 — localStorage.
 *
 * 서버 없이 브라우저에만 저장한다. 저장값이 깨져 있어도 앱이 죽지 않도록
 * 파싱 실패 시 빈 목록으로 되돌린다.
 *
 * ⚠️ 예전 형식(문자열 배열)을 자동으로 옮겨 온다. 폴더를 도입했다고 기존 관심 종목이
 * 사라지면 안 된다 — 처음 읽을 때 '미분류' 폴더에 담고, 옛 키도 그대로 갱신해 둔다
 * (되돌릴 일이 생겨도 목록이 남아 있게).
 */

const FOLDERS_KEY = 'alphascope.watchlistFolders';
const WATCHLIST_KEY = 'alphascope.watchlist';
const LAST_FOLDER_KEY = 'alphascope.watchlistLastFolder';
const RECENT_KEY = 'alphascope.recent';
const RECENT_LIMIT = 20;

function readStrings(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 저장 실패(용량 초과 등)해도 화면 동작은 유지한다.
  }
}

function emptyDefault(symbols: string[] = []): WatchFolder {
  return { id: DEFAULT_FOLDER_ID, name: DEFAULT_FOLDER_NAME, collapsed: false, symbols };
}

/** '미분류' 는 반드시 하나 있어야 하고 항상 맨 아래다. */
function normalize(folders: WatchFolder[]): WatchFolder[] {
  const seen = new Set<string>();
  const cleaned = folders
    .filter((f): f is WatchFolder => Boolean(f) && typeof f.id === 'string')
    .map((f) => ({
      id: f.id,
      name: typeof f.name === 'string' && f.name.trim() ? f.name : '이름 없음',
      collapsed: Boolean(f.collapsed),
      // 같은 종목이 두 폴더에 들어가면 어느 쪽이 진짜인지 알 수 없다 — 먼저 나온 쪽만 남긴다.
      symbols: (Array.isArray(f.symbols) ? f.symbols : [])
        .map((s) => String(s).toUpperCase())
        .filter((s) => {
          if (!s || seen.has(s)) return false;
          seen.add(s);
          return true;
        }),
    }));

  const others = cleaned.filter((f) => f.id !== DEFAULT_FOLDER_ID);
  const fallback = cleaned.find((f) => f.id === DEFAULT_FOLDER_ID) ?? emptyDefault();
  return [...others, { ...fallback, name: DEFAULT_FOLDER_NAME }];
}

function readFolders(): WatchFolder[] {
  try {
    const raw = localStorage.getItem(FOLDERS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return normalize(parsed as WatchFolder[]);
    }
  } catch {
    // 손상된 값이면 아래 마이그레이션으로 내려간다.
  }
  // 폴더가 없던 시절의 목록을 '미분류' 로 옮긴다.
  return normalize([emptyDefault(readStrings(WATCHLIST_KEY))]);
}

let folderSeq = 0;
function newFolderId(): string {
  folderSeq += 1;
  return `folder_${Date.now().toString(36)}_${folderSeq}`;
}

export function useWatchlist() {
  const [folders, setFolders] = useState<WatchFolder[]>(readFolders);
  const [lastFolderId, setLastFolderId] = useState<string>(
    () => localStorage.getItem(LAST_FOLDER_KEY) ?? DEFAULT_FOLDER_ID,
  );

  /** 폴더 순서 그대로 펼친 전체 종목 — 별 토글·급등·스윙이 쓰는 평면 목록 */
  const watchlist = useMemo(() => folders.flatMap((f) => f.symbols), [folders]);

  /** 접히지 않은 폴더의 종목만 — 폴링 대상 */
  const visibleSymbols = useMemo(
    () => folders.filter((f) => !f.collapsed).flatMap((f) => f.symbols),
    [folders],
  );

  const save = useCallback((next: WatchFolder[]) => {
    setFolders((prev) => {
      /*
       * ⚠️ 호출부가 '미분류' 를 빼고 넘겨도 그 안의 종목이 사라지면 안 된다.
       * 폴더 순서 변경이 실제로 그랬다 — 움직일 수 있는 폴더만 추려 저장하는 바람에
       * normalize 가 미분류를 **빈 폴더로 새로 만들어**, 담아 둔 종목이 통째로 날아갔다.
       */
      const merged = next.some((f) => f.id === DEFAULT_FOLDER_ID)
        ? next
        : [...next, prev.find((f) => f.id === DEFAULT_FOLDER_ID) ?? emptyDefault()];

      const normalized = normalize(merged);
      write(FOLDERS_KEY, normalized);
      // 옛 키도 함께 갱신한다 — 형식을 되돌릴 일이 생겨도 목록이 남아 있게.
      write(WATCHLIST_KEY, normalized.flatMap((f) => f.symbols));
      return normalized;
    });
  }, []);

  const rememberFolder = useCallback((folderId: string) => {
    setLastFolderId(folderId);
    try {
      localStorage.setItem(LAST_FOLDER_KEY, folderId);
    } catch {
      // 기억하지 못해도 기본 폴더로 동작한다.
    }
  }, []);

  const add = useCallback(
    (symbol: string, folderId?: string) => {
      const next = symbol.trim().toUpperCase();
      if (!next) return;
      setFolders((prev) => {
        if (prev.some((f) => f.symbols.includes(next))) return prev;
        const target = prev.some((f) => f.id === folderId) ? folderId! : lastFolderId;
        const updated = normalize(
          prev.map((f) => (f.id === target ? { ...f, symbols: [...f.symbols, next] } : f)),
        );
        write(FOLDERS_KEY, updated);
        write(WATCHLIST_KEY, updated.flatMap((f) => f.symbols));
        return updated;
      });
    },
    [lastFolderId],
  );

  const remove = useCallback((symbol: string) => {
    setFolders((prev) => {
      const updated = normalize(
        prev.map((f) => ({ ...f, symbols: f.symbols.filter((s) => s !== symbol) })),
      );
      write(FOLDERS_KEY, updated);
      write(WATCHLIST_KEY, updated.flatMap((f) => f.symbols));
      return updated;
    });
  }, []);

  const toggle = useCallback(
    (symbol: string) => {
      const next = symbol.trim().toUpperCase();
      if (!next) return;
      if (watchlist.includes(next)) remove(next);
      else add(next);
    },
    [watchlist, add, remove],
  );

  // ── 폴더 조작 ─────────────────────────────────────────────

  const createFolder = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      // 새 폴더는 '미분류' 위에 쌓는다 (normalize 가 미분류를 맨 아래로 보낸다).
      save([...folders, { id: newFolderId(), name: trimmed, collapsed: false, symbols: [] }]);
    },
    [folders, save],
  );

  const renameFolder = useCallback(
    (id: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed || id === DEFAULT_FOLDER_ID) return;
      save(folders.map((f) => (f.id === id ? { ...f, name: trimmed } : f)));
    },
    [folders, save],
  );

  /** 폴더를 지우면 그 안의 종목은 '미분류' 로 옮긴다 — 지우는 건 폴더지 종목이 아니다. */
  const deleteFolder = useCallback(
    (id: string) => {
      if (id === DEFAULT_FOLDER_ID) return;
      const target = folders.find((f) => f.id === id);
      if (!target) return;
      save(
        folders
          .filter((f) => f.id !== id)
          .map((f) =>
            f.id === DEFAULT_FOLDER_ID ? { ...f, symbols: [...f.symbols, ...target.symbols] } : f,
          ),
      );
    },
    [folders, save],
  );

  const toggleFolder = useCallback(
    (id: string) => {
      save(folders.map((f) => (f.id === id ? { ...f, collapsed: !f.collapsed } : f)));
    },
    [folders, save],
  );

  /** 폴더 순서 이동. '미분류' 는 맨 아래 고정이라 움직이지 않는다. */
  const moveFolder = useCallback(
    (id: string, direction: -1 | 1) => {
      if (id === DEFAULT_FOLDER_ID) return;
      const movable = folders.filter((f) => f.id !== DEFAULT_FOLDER_ID);
      const index = movable.findIndex((f) => f.id === id);
      const next = index + direction;
      if (index < 0 || next < 0 || next >= movable.length) return;
      const reordered = [...movable];
      [reordered[index], reordered[next]] = [reordered[next], reordered[index]];
      // '미분류' 를 함께 넘긴다 — 빼면 그 안의 종목이 사라진다 (normalize 가 새로 만든다).
      save([...reordered, ...folders.filter((f) => f.id === DEFAULT_FOLDER_ID)]);
    },
    [folders, save],
  );

  /** 폴더를 다른 폴더 자리로 끌어다 놓기 */
  const reorderFolder = useCallback(
    (draggedId: string, targetId: string) => {
      if (draggedId === targetId || draggedId === DEFAULT_FOLDER_ID) return;
      const movable = folders.filter((f) => f.id !== DEFAULT_FOLDER_ID);
      const from = movable.findIndex((f) => f.id === draggedId);
      const to = movable.findIndex((f) => f.id === targetId);
      if (from < 0 || to < 0) return;
      const reordered = [...movable];
      const [moved] = reordered.splice(from, 1);
      reordered.splice(to, 0, moved);
      save([...reordered, ...folders.filter((f) => f.id === DEFAULT_FOLDER_ID)]);
    },
    [folders, save],
  );

  /**
   * 종목을 폴더 안 특정 위치로 옮긴다 (폴더 간 이동 · 폴더 내 순서 변경 모두 이 함수다).
   * index 를 주지 않으면 맨 뒤에 붙인다.
   */
  const moveSymbol = useCallback(
    (symbol: string, toFolderId: string, index?: number) => {
      const upper = symbol.toUpperCase();
      const without = folders.map((f) => ({
        ...f,
        symbols: f.symbols.filter((s) => s !== upper),
      }));
      save(
        without.map((f) => {
          if (f.id !== toFolderId) return f;
          const at = index == null ? f.symbols.length : Math.max(0, Math.min(index, f.symbols.length));
          const symbols = [...f.symbols];
          symbols.splice(at, 0, upper);
          return { ...f, symbols };
        }),
      );
      rememberFolder(toFolderId);
    },
    [folders, save, rememberFolder],
  );

  return {
    folders,
    watchlist,
    visibleSymbols,
    lastFolderId,
    add,
    remove,
    toggle,
    createFolder,
    renameFolder,
    deleteFolder,
    toggleFolder,
    moveFolder,
    reorderFolder,
    moveSymbol,
    rememberFolder,
  };
}

/** 종목을 볼 때마다 최근 조회에 기록한다 (최신이 앞). */
export function useRecentSymbols(currentSymbol: string) {
  const [recent, setRecent] = useState<string[]>(() => readStrings(RECENT_KEY));

  useEffect(() => {
    if (!currentSymbol) return;
    setRecent((prev) => {
      const updated = [currentSymbol, ...prev.filter((s) => s !== currentSymbol)].slice(
        0,
        RECENT_LIMIT,
      );
      write(RECENT_KEY, updated);
      return updated;
    });
  }, [currentSymbol]);

  const remove = useCallback((symbol: string) => {
    setRecent((prev) => {
      const updated = prev.filter((s) => s !== symbol);
      write(RECENT_KEY, updated);
      return updated;
    });
  }, []);

  const clear = useCallback(() => {
    setRecent([]);
    write(RECENT_KEY, []);
  }, []);

  return { recent, remove, clear };
}
