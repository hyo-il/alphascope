import { useEffect, useState } from 'react';
import type { StockSearchResult } from '../types/toss';

/**
 * 현재 종목의 이름·시장 정보 (전종목 카탈로그).
 * 통화 판단(원화/달러)과 헤더의 종목명 표시에 쓴다.
 */
export function useStockInfo(symbol: string | null): StockSearchResult | null {
  const [stock, setStock] = useState<StockSearchResult | null>(null);

  useEffect(() => {
    if (!symbol) return;
    const controller = new AbortController();

    fetch(`/api/stocks/info?symbol=${encodeURIComponent(symbol)}`, { signal: controller.signal })
      .then((res) => res.json())
      .then((data) => setStock(data.stock ?? null))
      .catch(() => setStock(null));

    return () => controller.abort();
  }, [symbol]);

  return stock;
}
