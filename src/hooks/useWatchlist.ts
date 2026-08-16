import { useCallback, useEffect, useState } from 'react';

/**
 * 관심 목록 · 최근 조회 (localStorage).
 *
 * 서버 없이 브라우저에만 저장한다. 저장값이 깨져 있어도 앱이 죽지 않도록
 * 파싱 실패 시 빈 목록으로 되돌린다.
 */

const WATCHLIST_KEY = 'alphascope.watchlist';
const RECENT_KEY = 'alphascope.recent';
const RECENT_LIMIT = 20;

function read(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    // 저장 형식이 바뀌었거나 손상된 경우를 방어한다.
    return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function write(key: string, value: string[]): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // 저장 실패(용량 초과 등)해도 화면 동작은 유지한다.
  }
}

export function useWatchlist() {
  const [watchlist, setWatchlist] = useState<string[]>(() => read(WATCHLIST_KEY));

  const update = useCallback((next: string[]) => {
    setWatchlist(next);
    write(WATCHLIST_KEY, next);
  }, []);

  const add = useCallback(
    (symbol: string) => {
      const next = symbol.trim().toUpperCase();
      if (!next) return;
      setWatchlist((prev) => {
        if (prev.includes(next)) return prev;
        const updated = [...prev, next];
        write(WATCHLIST_KEY, updated);
        return updated;
      });
    },
    [],
  );

  const remove = useCallback((symbol: string) => {
    setWatchlist((prev) => {
      const updated = prev.filter((s) => s !== symbol);
      write(WATCHLIST_KEY, updated);
      return updated;
    });
  }, []);

  const toggle = useCallback(
    (symbol: string) => {
      const next = symbol.trim().toUpperCase();
      setWatchlist((prev) => {
        const updated = prev.includes(next) ? prev.filter((s) => s !== next) : [...prev, next];
        write(WATCHLIST_KEY, updated);
        return updated;
      });
    },
    [],
  );

  return { watchlist, add, remove, toggle, setWatchlist: update };
}

/** 종목을 볼 때마다 최근 조회에 기록한다 (최신이 앞). */
export function useRecentSymbols(currentSymbol: string) {
  const [recent, setRecent] = useState<string[]>(() => read(RECENT_KEY));

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
