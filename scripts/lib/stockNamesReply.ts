/**
 * 시험 가짜 응답 — 종목 이름(`/api/stocks/names?symbols=…`) 한 곳(`desktop:test` · `mobiletable` · `mobileaccount` · `mobilebuyjudge`).
 *
 * 앱(`src/utils/stockNames.ts`)은 한 틱 동안 모은 종목으로 요청 주소를 만들어, 시험이 붐비면 모이는 종목이 달라져
 * 기록한 주소와 글자가 달라진다(그러면 503 → 이름 없이 그려져 요소 수가 흔들렸다). 기록한 이름 응답을 모두 합쳐 **물은 종목만** 답한다 —
 * 주소가 기록과 같으면 답도 기록과 같다.
 */
const PREFIX = '/api/stocks/names?';

/** 이름 요청이면 `{ json: { names } }`(물은 종목 중 기록에 있는 것만) · 아니면 `undefined` */
export function stockNamesReply(api: Record<string, unknown>, u: string): { json: { names: Record<string, string> } } | undefined {
  if (!u.startsWith(PREFIX)) return undefined;
  const all: Record<string, string> = {};
  for (const [k, v] of Object.entries(api)) if (k.startsWith(PREFIX)) Object.assign(all, (v as { names?: Record<string, string> }).names ?? {});
  const asked = (new URLSearchParams(u.slice(u.indexOf('?') + 1)).get('symbols') ?? '').split(',').filter(Boolean);
  return { json: { names: Object.fromEntries(asked.filter((x) => all[x]).map((x) => [x, all[x]])) } };
}
