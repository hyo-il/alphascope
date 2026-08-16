import { useEffect, useState } from 'react';
import type { Candle, Price } from './types/toss';

// Step 1 단계의 임시 화면 — API 연동이 살아있는지 눈으로 확인하는 용도.
// Step 2에서 차트 레이아웃으로 대체된다.
export default function App() {
  const [symbol] = useState('AAPL');
  const [candles, setCandles] = useState<Candle[] | null>(null);
  const [price, setPrice] = useState<Price | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const [c, p] = await Promise.all([
          fetch(`/api/candles?symbol=${symbol}&timeframe=1d&limit=60`).then((r) => r.json()),
          fetch(`/api/prices?symbol=${symbol}`).then((r) => r.json()),
        ]);
        if (c.error) throw new Error(c.error);
        if (p.error) throw new Error(p.error);
        setCandles(c.candles);
        setPrice(p.price);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    };
    void load();
  }, [symbol]);

  const last = candles?.at(-1);

  return (
    <div className="min-h-full p-8">
      <h1 className="text-2xl font-semibold text-accent">AlphaScope</h1>
      <p className="mt-1 text-sm text-text-secondary">
        Step 1 — 토스증권 API 연동 확인
      </p>

      {error && (
        <div className="mt-6 rounded-lg border border-bearish/40 bg-bg-secondary p-4 text-bearish">
          {error}
        </div>
      )}

      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <section className="rounded-lg border border-border bg-bg-secondary p-4">
          <h2 className="text-sm text-text-secondary">현재가 ({symbol})</h2>
          <p className="mt-2 text-3xl font-bold">
            {price ? `$${price.close.toFixed(2)}` : '—'}
          </p>
        </section>

        <section className="rounded-lg border border-border bg-bg-secondary p-4">
          <h2 className="text-sm text-text-secondary">일봉 캔들</h2>
          <p className="mt-2 text-3xl font-bold">{candles?.length ?? '—'}개</p>
          {last && (
            <p className="mt-2 text-xs text-text-muted">
              최근: {new Date(last.timestamp).toLocaleDateString('ko-KR')} · O {last.open} H{' '}
              {last.high} L {last.low} C {last.close}
            </p>
          )}
        </section>
      </div>
    </div>
  );
}
