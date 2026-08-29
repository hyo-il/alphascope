import { useEffect, useRef, useState } from 'react';
import type { StockSearchResult } from '../../types/toss';
import { InlineSpinner } from './LoadingOverlay';
import SymbolPickerList from './SymbolPickerList';
import { useStockNames } from '../../hooks/useStockNames';

/**
 * 종목 여러 개를 태그(칩)로 고르는 입력.
 *
 * `SymbolSearch` 와 자동완성 소스(`/api/stocks/search`)는 같지만 역할이 다르다 —
 * 저쪽은 "한 종목으로 이동", 이쪽은 "여러 종목을 담기" 다. 선택 후 입력이
 * 비워지고 계속 담을 수 있어야 해서 한 컴포넌트로 합치면 양쪽이 다 어색해진다.
 */
/**
 * 토스 API 의 `symbol` 은 영문·숫자·점·하이픈만 허용한다.
 * "애플" 을 그대로 담으면 분석이 통째로 실패하는데, 그 사실이 분석 결과 목록에
 * 가서야 드러난다. 담는 순간 막는다 — 이름으로 찾으려면 드롭다운에서 골라야 한다.
 */
const SYMBOL_PATTERN = /^[A-Za-z0-9.\-]+$/;

const MARKET_LABEL: Record<string, string> = {
  KOSPI: '코스피',
  KOSDAQ: '코스닥',
  NASDAQ: '나스닥',
  NYSE: 'NYSE',
  AMEX: 'AMEX',
};

export default function SymbolTagInput({
  symbols,
  onChange,
  /** 빠른 추가 — 관심 목록 */
  watchlist = [],
  /** 빠른 추가 — 최근 조회 */
  recent = [],
  placeholder = '종목명 또는 심볼로 검색…',
}: {
  symbols: string[];
  onChange: (symbols: string[]) => void;
  watchlist?: string[];
  recent?: string[];
  placeholder?: string;
}) {
  /** 열려 있는 빠른 추가 목록 */
  const [picker, setPicker] = useState<'watchlist' | 'recent' | null>(null);
  const names = useStockNames([...symbols, ...watchlist, ...recent]);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<StockSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const text = query.trim();
    if (!text) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);

    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/stocks/search?q=${encodeURIComponent(text)}`, { signal: controller.signal })
        .then((response) => response.json())
        .then((data) => {
          setResults(Array.isArray(data.results) ? data.results : []);
          setHighlight(0);
          setSearching(false);
        })
        .catch((error) => {
          if ((error as Error).name !== 'AbortError') setSearching(false);
        });
    }, 180);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  // 바깥을 클릭하면 드롭다운을 닫는다.
  useEffect(() => {
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, []);

  const [inputError, setInputError] = useState<string | null>(null);

  const add = (symbol: string) => {
    const next = symbol.trim().toUpperCase();
    if (!next) return;
    if (!SYMBOL_PATTERN.test(next)) {
      setInputError(`"${symbol.trim()}" 은 심볼이 아닙니다. 목록에서 종목을 고르세요.`);
      return;
    }
    setInputError(null);
    if (symbols.includes(next)) return;
    onChange([...symbols, next]);
    setQuery('');
    setResults([]);
    setOpen(false);
  };

  const remove = (symbol: string) => onChange(symbols.filter((item) => item !== symbol));

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      // 드롭다운에서 고른 게 있으면 그것을, 없으면 입력값 그대로 (심볼 직접 입력).
      if (open && results[highlight]) add(results[highlight].symbol);
      else if (query.trim()) add(query);
      return;
    }
    if (event.key === 'Escape') {
      setOpen(false);
      return;
    }
    /*
     * ⚠️ 여기서 백스페이스로 마지막 태그를 지우면 안 된다 (흔한 태그 입력 관례지만).
     *
     * 검색어를 지우려고 백스페이스를 누르다 보면 입력이 빈 뒤에도 몇 번 더 눌리는데,
     * 그 순간부터 담아 둔 종목이 하나씩 조용히 사라진다. 실제로 "검색창을 지웠더니
     * 분석 대상이 전부 없어졌다" 는 신고가 이 동작 때문이었다.
     * 종목 제거는 칩의 ✕ 로만 — 명시적인 조작으로 한정한다.
     */
    if (!open || results.length === 0) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlight((index) => (index + 1) % results.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight((index) => (index - 1 + results.length) % results.length);
    }
  };

  return (
    <div ref={rootRef} className="relative">
      {/* 담긴 종목 */}
      <div className="mb-2 flex flex-wrap gap-1.5">
        {symbols.length === 0 && (
          <span className="text-xs text-text-muted">분석할 종목을 추가하세요.</span>
        )}
        {symbols.map((item) => (
          <span
            key={item}
            className="inline-flex items-center gap-1 rounded bg-bg-tertiary py-1 pl-2 pr-1 text-xs text-text-primary"
          >
            <span className="font-medium">{item}</span>
            {names(item) && <span className="text-text-secondary">{names(item)}</span>}
            <button
              type="button"
              onClick={() => remove(item)}
              aria-label={`${item} 제거`}
              title="제거"
              className="rounded px-1 text-text-muted transition-colors hover:bg-bearish/20 hover:text-bearish"
            >
              ✕
            </button>
          </span>
        ))}
      </div>

      {/* 검색 입력 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex items-center">
          <span className="pointer-events-none absolute left-2 text-xs text-text-muted">🔍</span>
          <input
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setInputError(null);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            spellCheck={false}
            className="w-64 rounded border border-border bg-bg-tertiary py-1.5 pl-7 pr-7 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
          />
          {searching && <InlineSpinner className="pointer-events-none -ml-6" />}
        </div>

        {inputError && <span className="text-xs text-warning">{inputError}</span>}
      </div>

      {/* 빠른 추가 — 이미 골라 둔 종목 뭉치를 한 번에 옮긴다 */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setPicker(picker === 'watchlist' ? null : 'watchlist')}
          className={`rounded border px-2.5 py-1 text-xs transition-colors ${
            picker === 'watchlist'
              ? 'border-accent text-accent'
              : 'border-border text-text-secondary hover:bg-bg-tertiary'
          }`}
        >
          📋 관심 목록에서 추가 ({watchlist.length})
        </button>
        <button
          type="button"
          onClick={() => setPicker(picker === 'recent' ? null : 'recent')}
          className={`rounded border px-2.5 py-1 text-xs transition-colors ${
            picker === 'recent'
              ? 'border-accent text-accent'
              : 'border-border text-text-secondary hover:bg-bg-tertiary'
          }`}
        >
          🕐 최근 조회에서 추가 ({recent.length})
        </button>

        {symbols.length > 0 && (
          <button
            type="button"
            onClick={() => onChange([])}
            className="ml-auto rounded border border-bearish/40 px-2.5 py-1 text-xs text-bearish transition-colors hover:bg-bearish/10"
          >
            🗑 전체 삭제
          </button>
        )}
      </div>

      {picker && (
        <div className="mt-2">
          <SymbolPickerList
            title={picker === 'watchlist' ? '관심 목록' : '최근 조회'}
            candidates={picker === 'watchlist' ? watchlist : recent}
            already={symbols}
            emptyMessage={
              picker === 'watchlist'
                ? '관심 목록이 비어 있습니다. 종목 화면의 ☆ 로 담아 보세요.'
                : '최근 조회한 종목이 없습니다.'
            }
            onAdd={(picked) => {
              onChange([...symbols, ...picked]);
              setPicker(null);
            }}
            onCancel={() => setPicker(null)}
          />
        </div>
      )}

      {/* 자동완성 */}
      {open && results.length > 0 && (
        <ul className="absolute left-0 top-full z-40 mt-1 max-h-64 w-80 overflow-y-auto rounded-md border border-border bg-bg-secondary py-1 shadow-xl">
          {results.map((result, index) => {
            const already = symbols.includes(result.symbol);
            return (
              <li key={`${result.market}-${result.symbol}`}>
                <button
                  type="button"
                  disabled={already}
                  onMouseEnter={() => setHighlight(index)}
                  onClick={() => add(result.symbol)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors disabled:opacity-40 ${
                    index === highlight && !already ? 'bg-bg-tertiary' : ''
                  }`}
                >
                  <span className="w-16 shrink-0 font-medium tabular-nums text-accent">
                    {result.symbol}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-text-primary">{result.name}</span>
                  <span className="shrink-0 text-[10px] text-text-muted">
                    {already ? '추가됨' : (MARKET_LABEL[result.market] ?? result.market)}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {open && searching && results.length === 0 && (
        <p className="absolute left-0 top-full z-40 mt-1 flex w-80 items-center gap-2 rounded-md border border-border bg-bg-secondary px-3 py-2 text-xs text-text-muted shadow-xl">
          <InlineSpinner />
          검색 중…
        </p>
      )}

      {open && !searching && query.trim() && results.length === 0 && (
        <p className="absolute left-0 top-full z-40 mt-1 w-80 rounded-md border border-border bg-bg-secondary px-3 py-2 text-xs text-text-muted shadow-xl">
          검색 결과가 없습니다. 영문 심볼(AAPL)은 Enter 로 바로 추가할 수 있습니다.
        </p>
      )}
    </div>
  );
}
