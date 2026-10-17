import { useEffect, useState } from 'react';

/** 종목 이름·분야 — `GET /api/symbols/info`. 받은 것은 모듈에 기억한다(표를 다시 그릴 때 다시 묻지 않는다) */
export interface SymbolInfo {
  symbol: string;
  name: string | null;
  /** 종목 지도와 같은 한글 분야 — 모르면 null(화면 「기타」) */
  sector: string | null;
}

const cache = new Map<string, SymbolInfo>();

export function useSymbolInfo(symbols: string[]): Map<string, SymbolInfo> {
  const [, setTick] = useState(0);
  const key = symbols.join(',');
  useEffect(() => {
    const missing = symbols.filter((s) => !cache.has(s));
    if (!missing.length) return;
    let alive = true;
    fetch(`/api/symbols/info?symbols=${encodeURIComponent(missing.join(','))}`)
      .then((r) => (r.ok ? r.json() : { items: [] }))
      .then((d: { items: SymbolInfo[] }) => {
        for (const x of d.items ?? []) cache.set(x.symbol, x);
        if (alive) setTick((t) => t + 1);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return cache;
}
