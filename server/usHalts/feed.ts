/**
 * Nasdaq Trader 거래정지 RSS — 받기 · 해석.
 *
 * - 주소 `https://www.nasdaqtrader.com/rss.aspx?feed=tradehalts`. 피드는 약 1분마다 새로 만들어진다(`ttl` 1) → 1분에 1번 이하로 받는다.
 * - 항목 칸은 `ndaq:` 이름공간: HaltDate · HaltTime(ET) · IssueSymbol · IssueName · Market · ReasonCode · PauseThresholdPrice ·
 *   ResumptionDate · ResumptionQuoteTime · ResumptionTradeTime. 항목 안 `pubDate` 는 04:00 GMT 고정이라 읽지 않는다.
 * - 의존성을 더하지 않는다 — 모양이 단순해(한 단계 `<item>` 안의 글자 칸) 정규식으로 읽는다. 표준 엔티티만 푼다.
 * - ⚠️ 칸 값은 받은 문자열 그대로 돌려준다(앞뒤 공백도) — 약관상 피드를 고치지 않는다. 비교 · 계산은 부르는 쪽이 `trim()` 해서 한다.
 */

export const HALTS_FEED_URL = 'https://www.nasdaqtrader.com/rss.aspx?feed=tradehalts';
/** 한 번 받기의 시간 제한 — 다음 분 받기와 겹치지 않게 1분보다 짧게 */
export const FEED_TIMEOUT_MS = 20_000;

export interface RawHaltItem {
  HaltDate: string;
  HaltTime: string;
  IssueSymbol: string;
  IssueName: string;
  Market: string;
  ReasonCode: string;
  PauseThresholdPrice: string;
  ResumptionDate: string;
  ResumptionQuoteTime: string;
  ResumptionTradeTime: string;
}

const FIELDS: (keyof RawHaltItem)[] = [
  'HaltDate',
  'HaltTime',
  'IssueSymbol',
  'IssueName',
  'Market',
  'ReasonCode',
  'PauseThresholdPrice',
  'ResumptionDate',
  'ResumptionQuoteTime',
  'ResumptionTradeTime',
];

function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (whole, ent: string) => {
    const e = ent.toLowerCase();
    if (e === 'amp') return '&';
    if (e === 'lt') return '<';
    if (e === 'gt') return '>';
    if (e === 'quot') return '"';
    if (e === 'apos') return "'";
    const code = e.startsWith('#x') ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
  });
}

function fieldOf(item: string, name: string): string {
  // 빈 칸은 `<ndaq:X />` 로 온다
  if (new RegExp(`<ndaq:${name}\\s*/>`).test(item)) return '';
  const m = new RegExp(`<ndaq:${name}>([\\s\\S]*?)</ndaq:${name}>`).exec(item);
  if (!m) return '';
  const cdata = /^<!\[CDATA\[([\s\S]*)\]\]>$/.exec(m[1]);
  return cdata ? cdata[1] : decodeEntities(m[1]);
}

/**
 * RSS 본문 → 항목 목록. RSS 가 아니면(봇 확인 · 오류 HTML 등) 던진다.
 * 종목 · 정지 날짜 · 정지 시각이 비어 있는 항목은 키를 만들 수 없어 뺀다.
 */
export function parseHaltsFeed(xml: string): RawHaltItem[] {
  if (!/<rss[\s>]/.test(xml) || !/xmlns:ndaq=/.test(xml) || !/<channel[\s>]/.test(xml)) {
    throw new Error('Nasdaq 거래정지 RSS 모양이 아닙니다(HTML · 오류 페이지일 수 있음)');
  }
  const items: RawHaltItem[] = [];
  for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
    const item = Object.fromEntries(FIELDS.map((f) => [f, fieldOf(m[1], f)])) as unknown as RawHaltItem;
    if (!item.IssueSymbol.trim() || !item.HaltDate.trim() || !item.HaltTime.trim()) continue;
    items.push(item);
  }
  return items;
}

/** 한 번 받기 — 200 이 아니거나 시간 초과 · RSS 가 아니면 던진다(부르는 쪽이 실패 수를 센다) */
export async function fetchHaltsFeed(fetchImpl: typeof fetch = fetch): Promise<RawHaltItem[]> {
  const res = await fetchImpl(HALTS_FEED_URL, {
    signal: AbortSignal.timeout(FEED_TIMEOUT_MS),
    headers: { Accept: 'application/rss+xml, application/xml, text/xml', 'User-Agent': 'AlphaScope/1.0 (personal use)' },
  });
  if (!res.ok) throw new Error(`Nasdaq 응답 ${res.status}`);
  return parseHaltsFeed(await res.text());
}
