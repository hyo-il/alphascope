/**
 * 오늘 시황 화면 견본 — `design:check` 가 응답을 바꿔치기해 채워진 화면을 잰다(DB · Gemini · 네트워크를 쓰지 않는다).
 * 글은 길이 · 줄바꿈을 보려고 실제 브리핑만큼 길게 썼다(내용은 견본 — 사실이 아니다).
 */
import type { BriefEdition, MarketBrief, MarketBriefDayResponse, MarketBriefDays, MarketBriefStatus } from '../../../src/types/marketBrief';

const earnings: MarketBrief['data']['earnings'] = [
  { symbol: 'NVDA', name: '엔비디아', sector: '기술', date: '2026-11-19', daysUntil: 21, isEstimateDate: false, epsEstimate: '$1.25', lastQuarterEps: '$1.05', yoyEps: '$0.81', revenueEstimate: '$54.92B', recommendation: 'Buy (58/64)', epsDispersion: '-', epsSanityFlag: false, revenueSanityFlag: false, estimatesOk: true },
  { symbol: 'MU', name: '마이크론', sector: '기술', date: '2026-11-02', daysUntil: 4, isEstimateDate: true, epsEstimate: '$20.05', lastQuarterEps: '$7.90', yoyEps: '$1.91', revenueEstimate: '-', recommendation: 'Buy (39/44)', epsDispersion: '분산 ±46%', epsSanityFlag: true, revenueSanityFlag: true, estimatesOk: true },
  { symbol: '005930', name: '삼성전자', sector: '기술', date: '2026-11-05', daysUntil: 7, isEstimateDate: false, epsEstimate: '₩1,235', lastQuarterEps: '₩1,100', yoyEps: '₩980', revenueEstimate: '₩79.1조', recommendation: 'Buy (30/33)', epsDispersion: '-', epsSanityFlag: false, revenueSanityFlag: false, estimatesOk: true },
  { symbol: 'JPM', name: 'JP모건 체이스', sector: '금융', date: '2026-12-15', daysUntil: 47, isEstimateDate: true, epsEstimate: '$5.41', lastQuarterEps: '$5.94', yoyEps: '$4.96', revenueEstimate: '$48.72B', recommendation: 'Buy (12/24)', epsDispersion: '-', epsSanityFlag: false, revenueSanityFlag: false, estimatesOk: true },
  { symbol: 'XOM', name: '엑슨모빌', sector: '에너지', date: '2026-12-05', daysUntil: 37, isEstimateDate: true, epsEstimate: '-', lastQuarterEps: '-', yoyEps: '-', revenueEstimate: '-', recommendation: '-', epsDispersion: '-', epsSanityFlag: false, revenueSanityFlag: false, estimatesOk: false },
];

const morningAssets: MarketBrief['data']['assets'] = {
  KOSPI: { current: 2651.37, change: 12.4, change_pct: 0.47, data_date: '2026-10-28' },
  KOSDAQ: { current: 851.02, change: -4.11, change_pct: -0.48, data_date: '2026-10-28' },
  SP500: { current: 6031.8, change: 31.8, change_pct: 0.53, data_date: '2026-10-28' },
  NASDAQ: { current: 20100.12, change: -50.5, change_pct: -0.25, data_date: '2026-10-28' },
  DOW: { current: 44210.55, change: 120.3, change_pct: 0.27, data_date: '2026-10-28' },
  RUSSELL2000: { current: 2310.4, change: -18.2, change_pct: -0.78, data_date: '2026-10-28' },
  GOLD: { current: 2745.3, change: 12.1, change_pct: 0.44, data_date: '2026-10-28' },
  DXY: { current: 104.321, change: -0.214, change_pct: -0.21, data_date: '2026-10-28' },
  US2Y: { current: 3.49, change: -0.02, change_pct: -0.57, data_date: '2026-10-27' },
  US10Y: { current: 4.212, change: 0.031, change_pct: 0.74, data_date: '2026-10-28' },
  USDKRW: { current: 1381.5, change: 6.2, change_pct: 0.45, data_date: '2026-10-28' },
  WTI: { current: 71.42, change: -1.08, change_pct: -1.49, data_date: '2026-10-28' },
  NATGAS: { current: 3.125, change: 0.087, change_pct: 2.86, data_date: '2026-10-28' },
};

const afternoonAssets: MarketBrief['data']['assets'] = {
  KOSPI: { current: 2668.02, change: 16.65, change_pct: 0.63, data_date: '2026-10-29' },
  KOSDAQ: { current: 848.7, change: -2.32, change_pct: -0.27, data_date: '2026-10-29' },
  VIX: { current: 22.4, change: 1.2, change_pct: 5.66, data_date: '2026-10-28' },
};

const common = {
  portfolio_note: '금 ETF 강세 유지 · 국고채 관망 — 달러 약세가 금값을 받치고 있습니다.',
  key_themes: [
    { icon: '🟢', category: '실적사이클', title: 'AI 데이터센터 투자 확대와 메모리 가격 반등', why_important: '빅테크가 서버 투자를 계속 늘려 반도체 회사 이익이 커질 수 있다는 뜻입니다.', duration: '1~2개월', swing_point: '메모리(마이크론 · SK하이닉스) 실적 발표 전후로 변동성이 커질 수 있어 발표 뒤 가이던스를 확인합니다.' },
    { icon: '🟡', category: '통화정책', title: '연준 금리 인하 속도 논쟁', why_important: 'FOMC(미 연준 통화정책 회의)가 금리를 얼마나 빨리 내리느냐에 따라 성장주 값이 크게 흔들립니다.', duration: '분기 전반', swing_point: '금리 민감한 소프트웨어 · 리츠는 12/09 FOMC 뒤 방향을 보고 판단합니다.' },
    { icon: '🔴', category: '지정학', title: '중동 긴장과 유가 변동', why_important: '유가가 오르면 물가가 다시 올라 금리 인하가 늦어질 수 있습니다.', duration: '연말까지', swing_point: '에너지 섹터는 숏 관점 또는 관망 — 항공 · 운송은 비용 부담이 커집니다.' },
  ],
  leading_sectors: [
    { emoji: '💻', name: '기술', stars: '★★★', reason: '기준 A — AI 서버 투자가 3개월 넘게 이어질 근거(빅테크 설비투자 계획 상향)가 뉴스에 여러 번 나왔습니다.', stocks_kr: '삼성전자, SK하이닉스', stocks_us: '엔비디아, 마이크론, 브로드컴' },
    { emoji: '🏦', name: '금융', stars: '★★☆', reason: '기준 B — 대형 은행 실적이 30일 안에 몰려 있고 금리 경로 논쟁으로 관심이 집중됩니다. 방향은 발표 뒤 판단합니다.', stocks_kr: 'KB금융', stocks_us: 'JP모건' },
  ],
  swing_check: {
    phase: '단기 과열 뒤 숨 고르기 — 대형 기술주 중심의 좁은 상승',
    catalysts: ['12/09(수) FOMC 금리 결정(점도표)', '11/06(금) 미국 10월 고용지표', '11/13(금) 미국 10월 CPI'],
    risks: ['장기 금리 재상승(10년물 4.3% 위)', '유가 급등에 따른 물가 재가속', '대형 기술주 실적 기대가 너무 높음'],
  },
  upcoming_schedule: {
    this_week: [
      { date: '11/02(월)', event: '마이크론 실적 발표', ticker: 'MU', sector_kr: '기술', detail: '예상 EPS $20.05 ⚠️ (직전 $7.90, YoY $1.91, ±46%) | 컨센서스 Buy(39/44), 신뢰도 주의', importance: 3 },
      { date: '11/05(목)', event: '삼성전자 실적 발표', ticker: '005930', sector_kr: '기술', detail: '예상 EPS ₩1,235 (직전 ₩1,100, YoY ₩980) | 컨센서스 Buy(30/33) | 매출 ₩79.1조', importance: 3 },
    ],
    this_month: [
      { date: '11/19(목)', event: '엔비디아 실적 발표', ticker: 'NVDA', sector_kr: '기술', detail: '예상 EPS $1.25 (직전 $1.05, YoY $0.81) | 컨센서스 Buy(58/64) | 매출 $54.92B', importance: 2 },
    ],
    next_2_months: [
      { date: '12/09(수)', event: 'FOMC 금리 결정', ticker: '', sector_kr: '', detail: '올해 마지막 회의 — 경제전망 · 점도표 공개', importance: 1 },
    ],
  },
  portfolio_adjustment: {
    passive_note: '금 ETF +2%p 검토, 국고채 -2%p (변동성 상승 대응).',
    swing_candidates: ['엔비디아(NVDA) — AI 서버 수요 강세, 11/19 실적 발표 후 가이던스 확인 후 진입 검토.', 'SK하이닉스(000660) — 메모리 가격 반등, 마이크론 실적 뒤 반응 확인 후 진입 후보로 검토 가능.'],
  },
};

export function briefSample(edition: BriefEdition, withAi = true, id = edition === 'morning' ? 12 : 13): MarketBrief {
  const morning = edition === 'morning';
  return {
    id,
    date: '2026-10-29',
    edition,
    trigger: morning ? 'auto' : 'button',
    createdAt: morning ? '2026-10-28T22:05:12.000Z' : '2026-10-29T06:40:03.000Z',
    model: withAi ? 'gemini-3.5-flash-lite' : null,
    tokens: withAi ? 13621 : null,
    aiCalls: withAi ? 1 : 0,
    promptVersion: 'brief-v1',
    sources: [
      { group: 'market', label: '시장 데이터', ok: morning, detail: morning ? '13개 받음' : '2개 받음 · 못 받음: VIX 공포지수' },
      { group: 'news', label: '국내 뉴스 · 연합뉴스', ok: true, detail: '20건' },
      { group: 'news', label: '국내 뉴스 · 매일경제', ok: false, detail: 'HTTP 503' },
      { group: 'news', label: '해외 뉴스 · CNBC Tech', ok: true, detail: '20건' },
      { group: 'earnings', label: '실적 일정(60일)', ok: true, detail: '5종목 · 전망치 4/5' },
      { group: 'ai', label: 'AI 분석', ok: withAi, detail: withAi ? 'gemini-3.5-flash-lite · 호출 1번' : 'Gemini 무료 한도 초과(429) — 다시 부르지 않았습니다' },
    ],
    data: { assets: morning ? morningAssets : { KOSPI: afternoonAssets.KOSPI, KOSDAQ: afternoonAssets.KOSDAQ, VIX: afternoonAssets.VIX }, earnings },
    brief: withAi
      ? morning
        ? { market_regime: 'Risk-On', regime_summary: '미국 대형 기술주가 실적 기대로 올랐지만 소형주는 내려 상승 폭이 좁습니다. 금리 · 달러가 안정돼 위험 자산 선호가 이어집니다.', ...common }
        : { market_summary: '코스피는 반도체 대형주 강세로 0.63% 올랐고, 코스닥은 2차전지 약세로 0.27% 내렸습니다.', vix_comment: 'VIX 22.4 는 주의 구간이라 스윙 진입 규모를 평소보다 줄이는 편이 안전합니다.', ...common }
      : null,
    aiError: withAi ? null : 'Gemini 무료 한도 초과(429) — 다시 부르지 않았습니다',
  };
}

export function daySample(brief: MarketBrief): MarketBriefDayResponse {
  return {
    date: brief.date,
    items: [
      { id: 13, edition: 'afternoon', trigger: 'button', createdAt: '2026-10-29T06:40:03.000Z', hasAi: true },
      { id: 12, edition: 'morning', trigger: 'auto', createdAt: '2026-10-28T22:05:12.000Z', hasAi: true },
    ],
    selected: brief,
  };
}

export const daysSample: MarketBriefDays = {
  days: [
    { date: '2026-10-29', count: 2 },
    { date: '2026-10-28', count: 1 },
    { date: '2026-10-27', count: 3 },
  ],
};

export function statusSample(o: { running?: boolean; used?: number; gemini?: boolean } = {}): MarketBriefStatus {
  return {
    running: o.running ?? false,
    stage: o.running ? 'ai' : null,
    edition: o.running ? 'afternoon' : null,
    trigger: o.running ? 'button' : null,
    startedAt: o.running ? new Date().toISOString() : null,
    today: '2026-10-29',
    buttonUsed: o.used ?? 2,
    buttonLimit: 5,
    nowEdition: 'afternoon',
    autoDisabledReason: null,
    geminiDisabledReason: o.gemini === false ? '이 서버에서는 Gemini 가 꺼져 있습니다(GEMINI_ENABLED=false)' : null,
    lastFinishedId: null,
    lastFinishedDate: null,
    lastError: null,
    autoTriedToday: true,
    autoDoneToday: true,
    autoWindowNow: false,
    bootAt: 0,
  };
}
