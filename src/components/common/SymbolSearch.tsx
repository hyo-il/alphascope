import { useEffect, useRef, useState } from 'react';
import { InlineSpinner } from './LoadingOverlay';
import type { StockSearchResult } from '../../types/toss';

interface Props {
  symbol: string;
  onSubmit: (symbol: string) => void;
}

const MARKET_LABEL: Record<string, string> = {
  KOSPI: '코스피',
  KOSDAQ: '코스닥',
  NASDAQ: '나스닥',
  NYSE: 'NYSE',
  AMEX: 'AMEX',
};

/**
 * 종목 검색 — 한글 종목명 자동완성.
 *
 * 토스 API 의 `symbol` 은 영문·숫자만 허용해서 "삼성전자" 를 그대로 보내면 실패한다.
 * 그래서 서버의 전종목 카탈로그에서 찾아 심볼(005930)로 바꿔 넘긴다.
 */
export default function SymbolSearch({ symbol, onSubmit }: Props) {
  const [value, setValue] = useState(symbol);
  const [results, setResults] = useState<StockSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  /** 검색 요청이 도는 중 — "결과 없음" 과 "아직 안 옴" 을 구분하기 위해 필요하다 */
  const [searching, setSearching] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => setValue(symbol), [symbol]);

  // 입력이 바뀌면 잠깐 기다렸다 검색한다 (연타 시 요청이 쌓이지 않도록).
  useEffect(() => {
    const query = value.trim();
    if (!query || query === symbol) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);

    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch(`/api/stocks/search?q=${encodeURIComponent(query)}`, { signal: controller.signal })
        .then((res) => res.json())
        .then((data) => {
          setResults(Array.isArray(data.results) ? data.results : []);
          setHighlight(0);
          setSearching(false);
        })
        .catch((error) => {
          /* 검색 실패는 조용히 넘긴다 — 직접 입력으로도 조회할 수 있다.
             단, 취소(abort)는 다음 요청이 이어받으므로 스피너를 끄지 않는다. */
          if ((error as Error).name !== 'AbortError') setSearching(false);
        });
    }, 180);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [value, symbol]);

  // 바깥을 클릭하면 닫는다.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const choose = (result: StockSearchResult) => {
    onSubmit(result.symbol);
    setValue(result.symbol);
    setOpen(false);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const query = value.trim();
    if (!query) return;

    // 목록이 열려 있으면 선택된 항목을, 아니면 입력값을 그대로 심볼로 본다.
    if (open && results[highlight]) {
      choose(results[highlight]);
      return;
    }

    // 한글이 섞여 있으면 심볼일 수 없다 — 검색 결과의 첫 항목을 쓴다.
    if (/[가-힣]/.test(query)) {
      if (results[0]) choose(results[0]);
      return;
    }

    onSubmit(query.toUpperCase());
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!open || results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => (h + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => (h - 1 + results.length) % results.length);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <form onSubmit={submit} className="flex items-center gap-1.5">
        <input
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="종목명 또는 심볼"
          spellCheck={false}
          className="w-48 rounded-md border border-border bg-bg-tertiary py-1.5 pl-2.5 pr-7 text-sm text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none"
        />
        {searching && (
          <InlineSpinner className="pointer-events-none -ml-8 mr-[18px]" />
        )}
        <button
          type="submit"
          className="rounded-md bg-accent px-2.5 py-1.5 text-sm text-white transition-colors hover:bg-accent-hover"
        >
          조회
        </button>
      </form>

      {open && results.length > 0 && (
        <ul className="absolute left-0 top-full z-40 mt-1 max-h-72 w-80 overflow-y-auto rounded-md border border-border bg-bg-secondary py-1 shadow-xl">
          {results.map((result, index) => (
            <li key={`${result.market}-${result.symbol}`}>
              <button
                type="button"
                onMouseEnter={() => setHighlight(index)}
                onClick={() => choose(result)}
                className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
                  index === highlight ? 'bg-bg-tertiary' : ''
                }`}
              >
                <span className="w-16 shrink-0 font-medium tabular-nums text-accent">
                  {result.symbol}
                </span>
                <span className="min-w-0 flex-1 truncate text-text-primary">{result.name}</span>
                <span className="shrink-0 text-[10px] text-text-muted">
                  {MARKET_LABEL[result.market] ?? result.market}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* 아직 응답 전인데 "결과 없음" 을 띄우면 오해를 부른다 — searching 을 함께 본다. */}
      {open && searching && results.length === 0 && (
        <p className="absolute left-0 top-full z-40 mt-1 flex w-80 items-center gap-2 rounded-md border border-border bg-bg-secondary px-3 py-2 text-xs text-text-muted shadow-xl">
          <InlineSpinner />
          검색 중…
        </p>
      )}

      {open && !searching && value.trim() && value.trim() !== symbol && results.length === 0 && (
        <p className="absolute left-0 top-full z-40 mt-1 w-80 rounded-md border border-border bg-bg-secondary px-3 py-2 text-xs text-text-muted shadow-xl">
          검색 결과가 없습니다. 심볼을 직접 입력하면 그대로 조회합니다.
        </p>
      )}
    </div>
  );
}
