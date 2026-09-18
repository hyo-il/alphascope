import { useEffect, useRef, useState } from 'react';
import { InlineSpinner } from './LoadingOverlay';
import type { StockSearchResult } from '../../types/toss';
import { hasHangul, searchStocksApi } from '../../utils/stockSearch';

interface Props {
  symbol: string;
  onSubmit: (symbol: string) => void;
  /** 관심 목록처럼 좁은 자리에서 쓸 때 (입력창을 늘리고 버튼 글자를 바꾼다) */
  placeholder?: string;
  submitLabel?: string;
  compact?: boolean;
  /** 고르고 나면 입력을 비운다 — 담기용으로 쓸 때 */
  clearOnSubmit?: boolean;
  /** 이미 담긴 종목인지 — 드롭다운에 '추가됨' 을 붙인다 */
  isAdded?: (symbol: string) => boolean;
  /** 팝업처럼 검색만 하러 연 자리에서 — 열자마자 바로 칠 수 있게 한다 */
  autoFocus?: boolean;
  /**
   * 드롭다운을 위로 열지.
   *
   * 기본은 `compact`(관심 목록 입력창이 패널 **맨 아래**에 있어 아래로 열면 잘린다)를 따른다.
   * 비교 화면의 빈 칸처럼 좁지만 화면 위쪽에 있는 자리는 반대로 위가 잘리므로 끈다.
   */
  dropUp?: boolean;
}

const MARKET_LABEL: Record<string, string> = {
  KOSPI: '코스피',
  KOSDAQ: '코스닥',
  NASDAQ: '나스닥',
  NYSE: 'NYSE',
  AMEX: 'AMEX',
};

/** 미국 시장은 한 덩어리로 묶어 배지에 'US' 로 적는다 (서버 정렬도 미국을 앞에 둔다) */
const US_MARKETS = new Set(['NASDAQ', 'NYSE', 'AMEX']);

/**
 * 종목 검색 — 한글 종목명 자동완성.
 *
 * 토스 API 의 `symbol` 은 영문·숫자만 허용해서 "삼성전자" 를 그대로 보내면 실패한다.
 * 그래서 서버의 전종목 카탈로그에서 찾아 심볼(005930)로 바꿔 넘긴다.
 */
export default function SymbolSearch({
  symbol,
  onSubmit,
  placeholder = '종목명 또는 심볼',
  submitLabel = '조회',
  compact = false,
  clearOnSubmit = false,
  isAdded,
  autoFocus = false,
  dropUp,
}: Props) {
  const [value, setValue] = useState(symbol);
  const [results, setResults] = useState<StockSearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  /** 검색 요청이 도는 중 — "결과 없음" 과 "아직 안 옴" 을 구분하기 위해 필요하다 */
  const [searching, setSearching] = useState(false);
  /**
   * 한글 IME 가 글자를 조합하는 중.
   *
   * 조합 중에는 값이 `ㅇ` → `애` → `애프` → `애플` 로 흔들린다. 서버는 자모로 맞춰 주지만
   * (`server/hangul.ts`), 그래도 중간 글자에서 "검색 결과가 없습니다" 가 번쩍이면
   * 사용자는 검색이 안 되는 줄 안다. 조합이 끝날 때까지 그 안내만 접어 둔다.
   */
  const [composing, setComposing] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const up = dropUp ?? compact;

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
    setValue(clearOnSubmit ? '' : result.symbol);
    setOpen(false);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const query = value.trim();
    if (!query) return;

    // 목록이 열려 있으면 선택된 항목을, 아니면 입력값을 그대로 심볼로 본다.
    if (open && results[highlight]) {
      choose(results[highlight]);
      return;
    }

    /*
     * 한글이 섞여 있으면 심볼일 수 없다 — 검색으로 심볼을 찾아야 한다.
     * ⚠️ 자동완성은 180ms 디바운스라, 치자마자 Enter(또는 [추가])를 누르면 results 가
     * 아직 비어 있다. 예전에는 여기서 조용히 return 해서 "한글 검색이 안 된다" 로 보였다.
     * 확정 시점에는 직접 한 번 더 물어 **결과를 기다린다**.
     */
    if (hasHangul(query)) {
      if (results[0]) {
        choose(results[0]);
        return;
      }

      setSearching(true);
      const found = await searchStocksApi(query).catch(() => [] as StockSearchResult[]);
      setSearching(false);
      setResults(found);

      if (found[0]) {
        choose(found[0]);
        return;
      }
      setOpen(true); // 결과 없음 안내를 띄운다 — 아무 반응이 없는 것보다 낫다
      return;
    }

    onSubmit(query.toUpperCase());
    if (clearOnSubmit) setValue('');
    setOpen(false);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    /*
     * Esc 는 결과 유무와 무관하게 받는다 — "결과가 없습니다" 안내가 떠 있을 때도
     * 닫을 수 있어야 한다. 예전에는 아래 가드에 먼저 걸려 마우스로 바깥을 눌러야 했다.
     */
    if (e.key === 'Escape') {
      setOpen(false);
      return;
    }
    if (!open || results.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlight((h) => (h + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlight((h) => (h - 1 + results.length) % results.length);
    }
  };

  return (
    /* 폭은 바깥 래퍼가 정한다 — 여기서는 주어진 폭을 그대로 채운다 */
    <div ref={rootRef} className="relative w-full">
      <form onSubmit={submit} className="flex items-center gap-1.5">
        <input
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={() => setComposing(false)}
          autoFocus={autoFocus}
          placeholder={placeholder}
          spellCheck={false}
          className={`rounded-md border border-border bg-bg-tertiary text-text-primary placeholder:text-text-muted focus:border-accent focus:outline-none ${
            /*
             * 폭은 **바깥 래퍼가 정한다.** 여기서 w-48 로 고정하면 탐색 홈처럼 가운데
             * 정렬된 자리(max-w-md)에서 입력만 왼쪽에 쏠려 축이 어긋나 보인다.
             * 헤더는 감싸는 div 가 w-48 shrink-0 으로 폭을 잡아 준다.
             */
            compact ? 'min-w-0 flex-1 py-1 pl-2 pr-6 text-xs' : 'min-w-0 flex-1 py-1.5 pl-2.5 pr-7 text-sm'
          }`}
        />
        {/* 음수 마진으로 맞추면 compact(pr-6)와 기본(pr-7)에서 자리가 달라진다 */}
        {searching && (
          <InlineSpinner
            className={`pointer-events-none absolute top-1/2 -translate-y-1/2 ${
              compact ? 'right-[4.25rem]' : 'right-[4.75rem]'
            }`}
          />
        )}
        <button
          type="submit"
          className={
            compact
              ? 'shrink-0 rounded border border-border px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-bg-tertiary hover:text-text-primary'
              : 'rounded-md bg-accent px-2.5 py-1.5 text-sm text-white transition-colors hover:bg-accent-hover'
          }
        >
          {submitLabel}
        </button>
      </form>

      {open && results.length > 0 && (
        <ul
          className={`absolute z-40 max-h-72 w-80 min-w-full overflow-y-auto rounded-md border border-border bg-bg-secondary py-1 shadow-xl ${
            /*
             * 좁은 패널(관심 목록)의 입력창은 패널 맨 아래에 있다 — 아래로 열면 화면 밖으로
             * 잘리고, 오른쪽으로도 넘친다. 위·오른쪽 기준으로 붙인다.
             */
            up ? 'bottom-full right-0 mb-1' : 'left-0 top-full mt-1'
          }`}
        >
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
                {/*
                  `NVDA — 엔비디아 [US]` 형식. 티커를 앞에 두는 이유는 영문 티커로 찾는
                  경우가 많아 방금 친 글자가 맨 앞에서 바로 확인되기 때문이고,
                  **이름 없이 티커만 적지는 않는다** — 어떤 종목인지 떠오르지 않는다.
                */}
                <span className="w-16 shrink-0 font-medium tabular-nums text-accent">
                  {result.symbol}
                </span>
                <span className="min-w-0 flex-1 truncate text-text-primary">
                  <span className="text-text-muted">— </span>
                  {result.englishName || result.name}
                  {result.englishName && result.name && result.englishName !== result.name && (
                    <span className="ml-1 text-text-muted">{result.name}</span>
                  )}
                </span>
                <span
                  className={`shrink-0 rounded px-1 py-0.5 text-[10px] ${
                    US_MARKETS.has(result.market)
                      ? 'bg-accent/15 text-accent'
                      : 'bg-bg-tertiary text-text-muted'
                  }`}
                >
                  {US_MARKETS.has(result.market) ? 'US' : (MARKET_LABEL[result.market] ?? result.market)}
                </span>
                {isAdded?.(result.symbol) && (
                  <span className="shrink-0 text-[10px] text-text-muted">추가됨</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* 아직 응답 전인데 "결과 없음" 을 띄우면 오해를 부른다 — searching 을 함께 본다. */}
      {open && searching && results.length === 0 && (
        <p
          className={`absolute z-40 flex w-80 items-center gap-2 rounded-md border border-border bg-bg-secondary px-3 py-2 text-xs text-text-muted shadow-xl ${
            up ? 'bottom-full right-0 mb-1' : 'left-0 top-full mt-1'
          }`}
        >
          <InlineSpinner />
          검색 중…
        </p>
      )}

      {open && !searching && !composing && value.trim() && value.trim() !== symbol && results.length === 0 && (
        /*
         * ⚠️ 이 안내도 드롭다운과 같은 방향으로 열어야 한다. 관심 목록의 입력창은
         * 패널 맨 아래·오른쪽 끝에 있어서, 아래로 열면 화면 밖으로 잘려 읽을 수 없다.
         * (드롭다운만 고치고 이 블록을 빠뜨려 "메시지가 잘린다" 는 신고가 있었다.)
         */
        <div
          className={`absolute z-40 w-80 max-w-[calc(100vw-2rem)] space-y-1 rounded-md border border-border bg-bg-secondary px-3 py-2 text-xs shadow-xl ${
            up ? 'bottom-full right-0 mb-1' : 'left-0 top-full mt-1'
          }`}
        >
          <p className="break-keep text-text-secondary">
            '{value.trim()}'에 대한 검색 결과가 없습니다.
          </p>
          {/* 한글로 찾지 못했다면 영문 티커가 가장 빠른 길이다 */}
          <p className="break-keep text-text-muted">
            {/[가-힣]/.test(value)
              ? '미국 주식은 영문 티커(예: GOOGL)로 검색해 보세요.'
              : '심볼을 직접 입력하면 그대로 조회합니다.'}
          </p>
        </div>
      )}
    </div>
  );
}
