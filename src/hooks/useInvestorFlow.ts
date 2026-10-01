import { useEffect, useRef, useState } from 'react';
import { isKrSymbol } from '../utils/market';
import type { InvestorFlow } from '../utils/investorFlow';

/**
 * 국내 종목의 투자자 동향 (v2.23.0) — 「투자자 동향」 탭과 수동 분석 프롬프트가 함께 쓴다.
 *
 * ⚠️ **국내 종목이 아니면 요청하지 않는다**(토스가 국내만 준다). `enabled` 가 false 여도 부르지 않는다.
 * 서버가 종목별로 캐시하므로(장중 5분) 두 화면이 각자 불러도 토스 호출은 늘지 않는다.
 */
export function useInvestorFlow(symbol: string, enabled = true) {
  const supported = isKrSymbol(symbol);
  const [flow, setFlow] = useState<InvestorFlow | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const sequence = useRef(0);

  useEffect(() => {
    const mine = ++sequence.current;
    setFlow(null);
    setError(null);
    if (!supported || !enabled) {
      setLoading(false);
      return;
    }
    setLoading(true);
    fetch(`/api/investor-trading?symbol=${encodeURIComponent(symbol)}`)
      .then(async (r) => {
        const payload = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(payload.error ?? `요청 실패 (${r.status})`);
        if (mine === sequence.current) setFlow(payload.supported ? (payload.flow as InvestorFlow) : null);
      })
      .catch((e: Error) => mine === sequence.current && setError(e.message))
      .finally(() => mine === sequence.current && setLoading(false));
  }, [symbol, supported, enabled]);

  return { supported, flow, error, loading };
}
