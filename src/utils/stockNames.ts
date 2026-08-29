/**
 * 심볼 → 종목명 캐시.
 *
 * 티커만 보여 주면 "AAPL 이 뭐였더라" 를 매번 떠올려야 한다. 이름을 함께 적으려면
 * 목록의 모든 종목에 대해 이름이 필요한데, 종목마다 따로 물으면 요청이 폭발한다.
 *
 * 그래서 이 모듈이 **한 틱 동안 요청을 모아 한 번에** 받아 오고, 결과는 계속 들고 있는다.
 * 종목명은 바뀌지 않으므로 만료가 필요 없다.
 */

const cache = new Map<string, string>();
/** 이미 물어봤지만 카탈로그에 없던 심볼 — 다시 묻지 않는다 */
const missing = new Set<string>();
const pending = new Set<string>();
const listeners = new Set<() => void>();

let flushTimer: ReturnType<typeof setTimeout> | null = null;

function notify() {
  for (const listener of listeners) listener();
}

async function flush() {
  flushTimer = null;
  const symbols = [...pending];
  pending.clear();
  if (!symbols.length) return;

  try {
    const response = await fetch(`/api/stocks/names?symbols=${encodeURIComponent(symbols.join(','))}`);
    if (!response.ok) throw new Error('이름 조회 실패');
    const data = (await response.json()) as { names?: Record<string, string> };

    for (const symbol of symbols) {
      const name = data.names?.[symbol];
      if (name) cache.set(symbol, name);
      else missing.add(symbol);
    }
    notify();
  } catch {
    // 이름은 보조 정보다 — 실패해도 심볼은 그대로 보인다.
    // 다만 missing 에 넣지 않아, 다음에 다시 시도할 수 있게 둔다.
  }
}

/** 아직 모르는 심볼을 조회 대기열에 넣는다 */
export function requestStockNames(symbols: (string | null | undefined)[]): void {
  let added = false;
  for (const raw of symbols) {
    const symbol = raw?.trim().toUpperCase();
    if (!symbol || cache.has(symbol) || missing.has(symbol) || pending.has(symbol)) continue;
    pending.add(symbol);
    added = true;
  }
  if (!added || flushTimer) return;
  // 한 틱 모아서 한 번에 — 목록 20줄이 각자 부르지 않도록.
  flushTimer = setTimeout(() => void flush(), 0);
}

/** 이미 받아 둔 이름 (없으면 null) */
export function stockNameOf(symbol: string | null | undefined): string | null {
  if (!symbol) return null;
  return cache.get(symbol.trim().toUpperCase()) ?? null;
}

export function subscribeStockNames(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 이미 아는 이름을 캐시에 넣는다 (서버 응답에 이름이 함께 오는 경우) */
export function primeStockName(symbol: string, name: string | null | undefined): void {
  if (!name) return;
  const key = symbol.trim().toUpperCase();
  if (cache.get(key) === name) return;
  cache.set(key, name);
  notify();
}
