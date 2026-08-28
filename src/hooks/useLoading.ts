import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * 비동기 조회 + 로딩·오류 상태를 한 번에.
 *
 * 두 가지를 구분하는 게 핵심이다:
 * - `isLoading`  : **처음** 그릴 때. 이때만 스켈레톤을 띄운다.
 * - `isRefreshing`: 이미 데이터가 있는 상태의 재조회(폴링·수동 새로고침).
 *   여기서도 스켈레톤을 띄우면 1초 폴링마다 화면이 깜빡인다.
 *
 * 늦게 도착한 응답이 최신 값을 덮어쓰지 않도록 요청마다 순번을 붙인다.
 */
export interface LoadingState<T> {
  data: T | null;
  isLoading: boolean;
  isRefreshing: boolean;
  error: string | null;
  /** 다시 불러온다 (오류 화면의 '재시도' 버튼용) */
  reload: () => Promise<void>;
  /** 조회 없이 로컬 상태만 갱신 (삭제 직후 목록 반영 등) */
  setData: (updater: T | ((previous: T | null) => T)) => void;
}

export function useLoading<T>(
  fetcher: () => Promise<T>,
  /** 값이 바뀌면 다시 불러온다 (useEffect 의존성과 같은 역할) */
  deps: unknown[] = [],
  options: { enabled?: boolean } = {},
): LoadingState<T> {
  const enabled = options.enabled ?? true;

  const [data, setDataState] = useState<T | null>(null);
  const [isLoading, setIsLoading] = useState(enabled);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 최신 fetcher 를 참조로 들고 있는다 — 인라인 화살표 함수를 deps 에 넣으면
  // 매 렌더마다 새 함수라서 무한 루프가 된다.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const sequence = useRef(0);
  const hasData = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(async () => {
    if (!enabled) return;
    const ticket = ++sequence.current;

    if (hasData.current) setIsRefreshing(true);
    else setIsLoading(true);

    try {
      const result = await fetcherRef.current();
      if (!mounted.current || ticket !== sequence.current) return;
      setDataState(result);
      hasData.current = true;
      setError(null);
    } catch (e) {
      if (!mounted.current || ticket !== sequence.current) return;
      setError((e as Error).message);
    } finally {
      if (mounted.current && ticket === sequence.current) {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);

  useEffect(() => {
    if (!enabled) {
      setIsLoading(false);
      return;
    }
    void run();
  }, [run, enabled]);

  const setData = useCallback((updater: T | ((previous: T | null) => T)) => {
    setDataState((previous) =>
      typeof updater === 'function' ? (updater as (p: T | null) => T)(previous) : updater,
    );
    hasData.current = true;
  }, []);

  return { data, isLoading, isRefreshing, error, reload: run, setData };
}
