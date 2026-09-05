/**
 * 주요 미국 종목의 한글 별칭.
 *
 * ⚠️ 토스 카탈로그에도 한글명이 있지만 **정식 명칭**이라 사람들이 부르는 이름과 다르다.
 * GOOGL 의 카탈로그 이름은 "알파벳 A" 여서 "구글" 로는 찾을 수 없었다 (실제 신고).
 * 영문명(english_name)은 카탈로그에 비어 있어 "apple" 같은 영문 검색도 안 됐다.
 * 그래서 별칭 + 영문명을 여기에 둔다.
 */

/** 심볼 → 별칭 목록 (한글 통칭 · 줄임말 · 영문명) */
export const STOCK_ALIASES: Record<string, string[]> = {
  AAPL: ['애플', '아이폰', 'Apple'],
  MSFT: ['마이크로소프트', '마소', 'MS', 'Microsoft'],
  GOOGL: ['구글', '알파벳', '알파벳A', 'Google', 'Alphabet'],
  GOOG: ['구글', '알파벳', '알파벳C', 'Google', 'Alphabet'],
  AMZN: ['아마존', 'Amazon'],
  NVDA: ['엔비디아', '엔비', 'Nvidia'],
  META: ['메타', '페이스북', '페북', '인스타그램', 'Meta', 'Facebook', 'Instagram'],
  TSLA: ['테슬라', '테슬', 'Tesla'],
  NFLX: ['넷플릭스', '넷플', 'Netflix'],
  AMD: ['에이엠디', 'AMD'],
  INTC: ['인텔', 'Intel'],
  AVGO: ['브로드컴', 'Broadcom'],
  ORCL: ['오라클', 'Oracle'],
  CRM: ['세일즈포스', 'Salesforce'],
  ADBE: ['어도비', 'Adobe'],
  QCOM: ['퀄컴', 'Qualcomm'],
  TXN: ['텍사스인스트루먼트', 'Texas Instruments'],
  MU: ['마이크론', 'Micron'],
  ARM: ['암', '에이알엠', 'Arm'],
  PLTR: ['팔란티어', 'Palantir'],
  UBER: ['우버', 'Uber'],
  ABNB: ['에어비앤비', '에어비앤비', 'Airbnb'],
  COIN: ['코인베이스', 'Coinbase'],
  SQ: ['블록', '스퀘어', 'Block', 'Square'],
  PYPL: ['페이팔', 'Paypal'],
  SHOP: ['쇼피파이', 'Shopify'],
  SPOT: ['스포티파이', 'Spotify'],
  DIS: ['디즈니', 'Disney'],
  SBUX: ['스타벅스', 'Starbucks'],
  MCD: ['맥도날드', 'McDonalds'],
  NKE: ['나이키', 'Nike'],
  KO: ['코카콜라', '코카', 'Coca-Cola'],
  PEP: ['펩시', 'Pepsi'],
  WMT: ['월마트', 'Walmart'],
  COST: ['코스트코', 'Costco'],
  HD: ['홈디포', 'Home Depot'],
  JPM: ['제이피모건', 'JP모건', 'JPMorgan'],
  BAC: ['뱅크오브아메리카', 'BOA', 'Bank of America'],
  GS: ['골드만삭스', '골드만', 'Goldman Sachs'],
  V: ['비자', 'Visa'],
  MA: ['마스터카드', 'Mastercard'],
  BRK: ['버크셔', 'Berkshire'],
  'BRK-B': ['버크셔', '버크셔해서웨이', 'Berkshire'],
  JNJ: ['존슨앤존슨', '존슨앤드존슨', '존슨', 'Johnson'],
  LLY: ['일라이릴리', '릴리', 'Eli Lilly'],
  PFE: ['화이자', 'Pfizer'],
  MRNA: ['모더나', 'Moderna'],
  UNH: ['유나이티드헬스', 'UnitedHealth'],
  XOM: ['엑슨모빌', '엑슨', 'Exxon'],
  CVX: ['셰브론', 'Chevron'],
  BA: ['보잉', 'Boeing'],
  CAT: ['캐터필러', 'Caterpillar'],
  GE: ['제너럴일렉트릭', 'GE'],
  F: ['포드', 'Ford'],
  GM: ['제너럴모터스', 'GM'],
  RIVN: ['리비안', 'Rivian'],
  LCID: ['루시드', 'Lucid'],
  NIO: ['니오', 'Nio'],
  BABA: ['알리바바', 'Alibaba'],
  TSM: ['TSMC', '대만반도체', 'Taiwan Semiconductor'],
  SONY: ['소니', 'Sony'],
  ABBV: ['애브비', 'AbbVie'],
  T: ['에이티앤티', 'AT&T'],
  VZ: ['버라이즌', 'Verizon'],
  SNOW: ['스노우플레이크', 'Snowflake'],
  SOFI: ['소파이', 'SoFi'],
  RBLX: ['로블록스', 'Roblox'],
  ROKU: ['로쿠', 'Roku'],
  ZM: ['줌', 'Zoom'],
  CRWD: ['크라우드스트라이크', 'CrowdStrike'],
  NET: ['클라우드플레어', 'Cloudflare'],
  DDOG: ['데이터독', 'Datadog'],
  MRVL: ['마벨', 'Marvell'],
  DELL: ['델', 'Dell'],
  HPQ: ['에이치피', 'HP'],
  IBM: ['아이비엠', 'IBM'],
  SMCI: ['슈퍼마이크로', 'Super Micro'],
  SPY: ['S&P500 ETF', '스파이'],
  QQQ: ['나스닥100 ETF', '큐큐큐'],
  VOO: ['뱅가드 S&P500'],
  SOXL: ['반도체 3배', '속슬'],
  TQQQ: ['나스닥 3배', '티큐큐'],
};

/** 별칭 → 심볼 (검색은 이 방향으로 쓴다). 소문자로 비교한다. */
const BY_ALIAS = (() => {
  const map = new Map<string, Set<string>>();
  for (const [symbol, aliases] of Object.entries(STOCK_ALIASES)) {
    for (const alias of aliases) {
      const key = alias.toLowerCase();
      if (!map.has(key)) map.set(key, new Set());
      map.get(key)!.add(symbol);
    }
  }
  return map;
})();

/**
 * 검색어와 겹치는 별칭을 가진 심볼들.
 * "구글" 처럼 정확히 맞는 것뿐 아니라 "구" 처럼 앞부분만 쳐도 찾게 한다.
 */
export function symbolsByAlias(query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];

  const found = new Set<string>();
  for (const [alias, symbols] of BY_ALIAS) {
    if (alias.startsWith(q) || alias.includes(q)) {
      for (const symbol of symbols) found.add(symbol);
    }
  }
  return [...found];
}
