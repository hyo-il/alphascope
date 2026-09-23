import { useEffect, useMemo, useState } from 'react';
import { usePaperAccounts } from '../../hooks/usePaperTrading';
import type { PaperPositionValued } from '../../types/paper';
import type { Quote } from '../../types/toss';
import { useQuotes } from '../../hooks/useQuotes';
import SymbolSearch from './SymbolSearch';
import { useStockNames } from '../../hooks/useStockNames';
import { formatPercent, formatPrice } from '../../utils/formatters';
import TrashIcon from './TrashIcon';

interface Props {
  onSelect: (symbol: string) => void;
  watchlist: string[];
  recent: string[];
  /*
    ⚠️ 삭제 로직을 여기서 만들지 않는다 — `useWatchlist().remove` ·
    `useRecentSymbols().remove` 를 그대로 받는다. 두 벌로 만들면 패널과 갈라진다.
  */
  onRemoveWatch?: (symbol: string) => void;
  onRemoveRecent?: (symbol: string) => void;
  onClearRecent?: () => void;
}

/** 처음 열었을 때 고를 만한 미국 대표 종목 */
const POPULAR = ['AAPL', 'NVDA', 'TSLA', 'MSFT', 'AMZN', 'META', 'GOOGL', 'AMD', 'NFLX'];

/**
 * 종목 탐색 홈.
 *
 * 앱을 열면 임의의 종목이 아니라 이 화면에서 시작한다 — 무엇을 보고 있는지가
 * 내 선택이어야 한다. 인기·관심·보유·최근을 한 화면에 모아 바로 진입하게 한다.
 */
export default function StockExplorer({
  onSelect,
  watchlist,
  recent,
  onRemoveWatch,
  onRemoveRecent,
  onClearRecent,
}: Props) {
  const [holdings, setHoldings] = useState<PaperPositionValued[]>([]);
  /*
   * 어느 계좌의 보유인지는 **공유 상태**가 정한다 — 여기서 목록을 따로 받아 고르면
   * 다른 화면에서 계좌를 바꿨을 때 이 화면만 옛 계좌를 본다.
   */
  const { selectedId: accountId } = usePaperAccounts();

  // 모의투자 보유 종목 — 계좌가 없으면 그냥 비워 둔다.
  useEffect(() => {
    if (!accountId) {
      setHoldings([]);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const data = await fetch(`/api/paper/positions?accountId=${accountId}`).then((r) =>
          r.json(),
        );
        if (!cancelled) setHoldings(data.positions ?? []);
      } catch {
        // 모의투자를 안 쓰는 사용자도 있다 — 조용히 넘어간다.
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  const held = holdings.map((h) => h.symbol);
  /*
   * ⚠️ 시세·이름은 **여기서 한 번만** 받는다.
   * 섹션마다 폴러를 두면 인기·관심·보유·최근이 각자 1초 간격으로 돌아, 섹션에 겹쳐 있는
   * 종목(AAPL 은 보통 셋에 동시에 있다)을 초당 여러 번 받는다 —
   * CLAUDE.md 의 「같은 데이터를 두 번 받지 않는다」 원칙에 어긋난다.
   */
  const allSymbols = useMemo(
    () => [...new Set([...POPULAR, ...watchlist, ...held, ...recent])],
    // held 는 매 렌더 새 배열이라 내용으로 의존성을 만든다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [watchlist.join(','), held.join(','), recent.join(',')],
  );
  const quotes = useQuotes(allSymbols);
  const names = useStockNames(allSymbols);

  const section = (
    title: string,
    symbols: string[],
    options: {
      empty?: string;
      /** 삭제 가능한 섹션만 넘긴다 — 인기(고정 목록)·보유(실제 포지션)에는 주지 않는다 */
      onRemove?: (symbol: string) => void;
      removeLabel?: string;
      /** 최근 조회처럼 통째로 비울 수 있는 섹션만 */
      onClear?: () => void;
    } = {},
  ) => {
    if (!symbols.length) {
      return options.empty ? (
        <section key={title} className="space-y-2">
          <h3 className="text-xs font-medium text-text-secondary">{title}</h3>
          <p className="text-[11px] text-text-muted">{options.empty}</p>
        </section>
      ) : null;
    }
    return (
      <section key={title} className="space-y-2">
        <div className="flex items-center gap-2">
          <h3 className="text-xs font-medium text-text-secondary">{title}</h3>
          {options.onClear && (
            <button
              type="button"
              onClick={options.onClear}
              className="ml-auto text-[11px] text-text-muted transition-colors hover:text-bearish"
            >
              전체 지우기
            </button>
          )}
        </div>
        <SymbolGrid
          symbols={symbols}
          quotes={quotes}
          nameOf={names}
          onSelect={onSelect}
          onRemove={options.onRemove}
          removeLabel={options.removeLabel}
        />
      </section>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col items-center overflow-y-auto p-8">
      <div className="w-full max-w-3xl space-y-7">
        <div className="space-y-3 text-center">
          <h2 className="text-lg font-semibold text-text-primary">🔍 종목을 검색하세요</h2>
          <p className="text-xs text-text-muted">
            한글 종목명으로도 찾을 수 있습니다 (예: 삼성전자, 애플)
          </p>
          <div className="mx-auto max-w-md">
            <SymbolSearch symbol="" onSubmit={onSelect} />
          </div>
        </div>

        {section('인기 종목', POPULAR)}
        {section('관심 종목', watchlist, {
          empty: '관심 목록이 비어 있습니다. 종목 화면의 ☆ 로 담아 보세요.',
          onRemove: onRemoveWatch,
          removeLabel: '관심 목록에서 삭제 (모든 그룹)',
        })}
        {/* 보유는 실제 모의투자 포지션이다 — 여기 삭제를 두면 매도로 오해한다 */}
        {section('보유 종목 (모의투자)', held)}
        {section('최근 조회', recent, {
          onRemove: onRemoveRecent,
          removeLabel: '최근 조회에서 삭제',
          // 다시 보면 저절로 쌓이는 기록이라 확인창 없이 지운다 (패널의 삭제와 같은 규칙).
          onClear: onClearRecent,
        })}
      </div>
    </div>
  );
}

/**
 * 종목 카드 묶음 — **순수 표시 컴포넌트다.**
 * 시세·이름 조회는 부모가 전 섹션을 합쳐 한 번만 한다 (여기서 받으면 섹션 수만큼 폴러가 는다).
 */
function SymbolGrid({
  symbols,
  quotes,
  nameOf,
  onSelect,
  onRemove,
  removeLabel,
}: {
  symbols: string[];
  quotes: Record<string, Quote | undefined>;
  nameOf: (symbol: string) => string | null | undefined;
  onSelect: (s: string) => void;
  /** 없으면 삭제 버튼 없이 예전과 똑같이 그린다 */
  onRemove?: (symbol: string) => void;
  removeLabel?: string;
}) {
  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {symbols.map((symbol) => {
        const quote = quotes[symbol];
        const rate = quote?.changeRate ?? null;
        const tone =
          rate == null ? 'text-text-muted' : rate > 0 ? 'text-bullish' : rate < 0 ? 'text-bearish' : 'text-text-muted';

        return (
          /*
            ⚠️ 카드 안에 삭제 버튼을 넣지 않는다 — 버튼 중첩은 HTML 규칙 위반이고, 클릭이
            겹쳐 지우려다 차트로 넘어간다. 관심 목록 패널과 같은 구조다
            (wrapper + 카드 버튼 + 삭제 버튼).
          */
          <div key={symbol} className="relative">
          <button
            type="button"
            onClick={() => onSelect(symbol)}
            className={`flex w-full flex-col items-start rounded-lg border border-border bg-bg-secondary px-3 py-2.5 text-left transition-colors hover:border-accent hover:bg-bg-tertiary ${
              // 긴 이름이 휴지통 밑으로 들어가지 않게 자리를 비운다.
              onRemove ? 'pr-8' : ''
            }`}
          >
            <span className="flex min-w-0 items-baseline gap-1.5">
              <span className="truncate text-sm font-semibold text-text-primary">
                {nameOf(symbol) || symbol}
              </span>
              {nameOf(symbol) && (
                <span className="shrink-0 text-[11px] text-text-secondary">{symbol}</span>
              )}
            </span>
            {/* 포맷은 formatters 한 곳을 쓴다 — 여기서 따로 만들면 관심 목록은
                "$319.70", 탐색 화면은 "319.7" 처럼 같은 값이 다르게 보인다. */}
            <span
              className="text-sm tabular-nums text-text-secondary"
              title={quote?.stale ? '실시간 조회 실패 — 마지막 캐시 종가입니다.' : undefined}
            >
              {quote?.price != null
                ? `${quote.stale ? '· ' : ''}${formatPrice(quote.price, quote.currency)}`
                : '—'}
            </span>
            <span className={`text-[11px] tabular-nums ${tone}`}>{formatPercent(rate)}</span>
          </button>

          {onRemove && (
            <button
              type="button"
              onClick={(e) => {
                // 버튼이 분리돼 있어도 안전하게 막아 둔다.
                e.stopPropagation();
                onRemove(symbol);
              }}
              title={removeLabel}
              aria-label={`${nameOf(symbol) || symbol} ${removeLabel ?? '삭제'}`}
              /*
                ⚠️ 항상 보인다. hover 에서만 나타나게 두면 버튼이 있는 줄도 모른다 —
                이미 신고된 문제다 (관심 목록 패널과 같은 규칙).
              */
              className="absolute right-1.5 top-1.5 rounded p-1 text-text-muted transition-colors hover:bg-bearish/15 hover:text-bearish"
            >
              <TrashIcon className="h-3.5 w-3.5" />
            </button>
          )}
          </div>
        );
      })}
    </div>
  );
}
