import { useEffect, useState } from 'react';
import { isKrSymbol } from '../utils/market';
import type { InvestorFlow } from '../utils/investorFlow';
import { usePolling } from './usePolling';

/** 다시 받기 주기 — 서버 장중 캐시(`server/investorTrading.ts` `SHORT_TTL_MS`)와 같다 */
export const FLOW_REFRESH_MS = 60_000;

type FlowResult = { flow: InvestorFlow | null } | { error: string };

function pickFlow(payload: Record<string, unknown>): FlowResult | undefined {
  if (typeof payload.pollError === 'string') return { error: payload.pollError };
  if (typeof payload.error === 'string') return { error: payload.error };
  if (typeof payload.supported === 'boolean') return { flow: payload.supported ? (payload.flow as InvestorFlow) : null };
  return undefined;
}

/**
 * 국내 종목의 투자자 동향 — 「투자자 동향」 탭과 수동 분석 프롬프트가 함께 쓴다.
 *
 * ⚠️ **국내 종목이 아니면 요청하지 않는다**(토스가 국내만 준다). `enabled` 가 false 여도 부르지 않는다.
 * - 받은 뒤 **1분마다 다시 받는다** — 공용 폴러 `usePolling`(숨은 탭에서는 쉼 · 같은 종목을 두 화면이 봐도 요청 1번).
 *   그 훅을 쓰는 화면이 내려가면(탭을 닫으면) 멈추고, 종목이 바뀌면 새 주소로 처음부터.
 * - 다시 받기가 실패하면 보던 값은 그대로 두고 `error` 만 채운다(처음 받기 실패면 값 없이 `error`).
 * - 서버가 종목별로 캐시하므로(장중 1분) 여러 화면 · 여러 창이 불러도 토스 호출은 종목당 1분 1번 이하다.
 */
export function useInvestorFlow(symbol: string, enabled = true) {
  const supported = isKrSymbol(symbol);
  const active = supported && enabled;
  const result = usePolling<FlowResult>(
    `/api/investor-trading?symbol=${encodeURIComponent(symbol)}`,
    pickFlow,
    FLOW_REFRESH_MS,
    active,
  );

  /** 마지막으로 받은 값(그 종목) — 다시 받기가 실패해도 보던 값을 지우지 않는다 */
  const [kept, setKept] = useState<{ symbol: string; flow: InvestorFlow | null } | null>(null);
  useEffect(() => {
    if (result && 'flow' in result) setKept({ symbol, flow: result.flow });
  }, [result, symbol]);

  const fresh = result && 'flow' in result ? result : null;
  const flow = !active ? null : fresh ? fresh.flow : kept?.symbol === symbol ? kept.flow : null;
  const error = active && result && 'error' in result ? result.error : null;
  const received = fresh != null || error != null || kept?.symbol === symbol;
  return { supported, flow, error, loading: active && !received };
}
