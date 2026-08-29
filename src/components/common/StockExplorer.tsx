import { useEffect, useState } from 'react';
import type { PaperPositionValued } from '../../types/paper';
import { useQuotes } from '../../hooks/useQuotes';
import SymbolSearch from './SymbolSearch';
import { useStockNames } from '../../hooks/useStockNames';

interface Props {
  onSelect: (symbol: string) => void;
  watchlist: string[];
  recent: string[];
}

/** 처음 열었을 때 고를 만한 미국 대표 종목 */
const POPULAR = ['AAPL', 'NVDA', 'TSLA', 'MSFT', 'AMZN', 'META', 'GOOGL', 'AMD', 'NFLX'];

const ACCOUNT_KEY = 'alphascope.paperAccountId';

/**
 * 종목 탐색 홈.
 *
 * 앱을 열면 임의의 종목이 아니라 이 화면에서 시작한다 — 무엇을 보고 있는지가
 * 내 선택이어야 한다. 인기·관심·보유·최근을 한 화면에 모아 바로 진입하게 한다.
 */
export default function StockExplorer({ onSelect, watchlist, recent }: Props) {
  const [holdings, setHoldings] = useState<PaperPositionValued[]>([]);

  // 모의투자 보유 종목 — 계좌가 없으면 그냥 비워 둔다.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const list = await fetch('/api/paper/accounts').then((r) => r.json());
        const accounts: { id: number }[] = list.accounts ?? [];
        if (!accounts.length) return;
        const savedId = Number(localStorage.getItem(ACCOUNT_KEY));
        const account = accounts.find((a) => a.id === savedId) ?? accounts[0];
        const data = await fetch(`/api/paper/positions?accountId=${account.id}`).then((r) =>
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
  }, []);

  const section = (title: string, symbols: string[], empty?: string) => {
    if (!symbols.length) {
      return empty ? (
        <section key={title} className="space-y-2">
          <h3 className="text-xs font-medium text-text-secondary">{title}</h3>
          <p className="text-[11px] text-text-muted">{empty}</p>
        </section>
      ) : null;
    }
    return (
      <section key={title} className="space-y-2">
        <h3 className="text-xs font-medium text-text-secondary">{title}</h3>
        <SymbolGrid symbols={symbols} onSelect={onSelect} />
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
        {section('관심 종목', watchlist, '관심 목록이 비어 있습니다. 종목 화면의 ☆ 로 담아 보세요.')}
        {section(
          '보유 종목 (모의투자)',
          holdings.map((h) => h.symbol),
        )}
        {section('최근 조회', recent)}
      </div>
    </div>
  );
}

/** 종목 카드 묶음 — 현재가·등락률을 한 번에 받아 채운다. */
function SymbolGrid({ symbols, onSelect }: { symbols: string[]; onSelect: (s: string) => void }) {
  const quotes = useQuotes(symbols);
  const names = useStockNames(symbols);

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
      {symbols.map((symbol) => {
        const quote = quotes[symbol];
        const rate = quote?.changeRate ?? null;
        const tone =
          rate == null ? 'text-text-muted' : rate > 0 ? 'text-bullish' : rate < 0 ? 'text-bearish' : 'text-text-muted';

        return (
          <button
            key={symbol}
            type="button"
            onClick={() => onSelect(symbol)}
            className="flex flex-col items-start rounded-lg border border-border bg-bg-secondary px-3 py-2.5 text-left transition-colors hover:border-accent hover:bg-bg-tertiary"
          >
            <span className="flex min-w-0 items-baseline gap-1.5">
              <span className="text-sm font-semibold text-text-primary">{symbol}</span>
              {names(symbol) && (
                <span className="truncate text-[11px] text-text-secondary">{names(symbol)}</span>
              )}
            </span>
            <span className="text-sm tabular-nums text-text-secondary">
              {quote?.price != null
                ? quote.price.toLocaleString('ko-KR', { maximumFractionDigits: 2 })
                : '—'}
            </span>
            <span className={`text-[11px] tabular-nums ${tone}`}>
              {rate == null ? '—' : `${rate > 0 ? '+' : ''}${rate.toFixed(2)}%`}
            </span>
          </button>
        );
      })}
    </div>
  );
}
