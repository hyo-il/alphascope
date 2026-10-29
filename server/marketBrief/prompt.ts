/**
 * 오늘 시황 — Gemini 프롬프트 · 응답 스키마 (Stockproject `ai_analyzer.build_morning_briefing` · `build_afternoon_briefing` 를 옮김).
 *
 * - 지시문 · JSON 키 · 슬롯 구조는 원본 그대로: `upcoming_schedule` = this_week / this_month / next_2_months(dict — flat list 금지) ·
 *   `key_themes`(duration 포함 — key_issues 금지) · `portfolio_adjustment`(passive_note 80자 · swing_candidates 100자) ·
 *   `leading_sectors` 2~3개(기준 A/B — 하락 방향은 「숏 관점」 · 「관망」) · catalysts 는 실적 제외 · event 는 「<회사명> 실적 발표」.
 * - 바꾼 것(AlphaScope 에 맞춤): 섹터 이름 목록 = 종목 지도의 한국어 섹터(`BRIEF_SECTORS` — 스키마 enum 으로도 강제) ·
 *   실적 풀 설명 · 나스닥 이름(^IXIC = 종합지수) · 「Python 측 사후 필터」 → 「서버 사후 처리」.
 * - 응답은 `responseSchema` 로 강제한다. 프롬프트 · 스키마를 고치면 `MARKET_BRIEF_PROMPT_VERSION` 을 올린다.
 */

import { BRIEF_SECTORS, dateLabel, earningsLine } from './earnings';
import type { BriefNewsItem } from './news';
import { ASSET_LABEL, vixZone } from '../../src/utils/marketBrief';
import type { BriefAsset, BriefAssetKey, BriefEarning, BriefEdition } from '../../src/types/marketBrief';

export const MARKET_BRIEF_PROMPT_VERSION = 'brief-v1';

export const SYSTEM = '당신은 10년 이상 경력의 한국 주식 시장 전문 애널리스트입니다.';

/** 원본 응답에 반드시 있어야 하는 키 — 빠지면 실패로 보고 1번 다시 부른다 */
export const REQUIRED_KEYS: Record<BriefEdition, string[]> = {
  morning: ['market_regime', 'key_themes', 'leading_sectors', 'swing_check', 'upcoming_schedule', 'portfolio_adjustment'],
  afternoon: ['market_summary', 'key_themes', 'leading_sectors', 'swing_check', 'upcoming_schedule', 'portfolio_adjustment'],
};

const STR = { type: 'STRING' };
const SCHEDULE_ITEM = {
  type: 'OBJECT',
  properties: {
    date: { type: 'STRING', description: 'MM/DD(요일)' },
    event: STR,
    ticker: { type: 'STRING', description: '실적 발표인 경우 입력의 티커 그대로, 아니면 빈 문자열' },
    sector_kr: { type: 'STRING', description: '실적 발표인 경우 입력의 [섹터] 그대로, 아니면 빈 문자열' },
    detail: STR,
    importance: { type: 'INTEGER' },
  },
  required: ['date', 'event', 'ticker', 'sector_kr', 'detail', 'importance'],
};
const THEME = {
  type: 'OBJECT',
  properties: {
    icon: { type: 'STRING', enum: ['🔴', '🟡', '🟢'] },
    category: STR,
    title: STR,
    why_important: STR,
    duration: STR,
    swing_point: STR,
  },
  required: ['icon', 'category', 'title', 'why_important', 'duration', 'swing_point'],
};
const SECTOR = {
  type: 'OBJECT',
  properties: {
    emoji: STR,
    name: { type: 'STRING', enum: BRIEF_SECTORS },
    stars: { type: 'STRING', enum: ['★★★', '★★☆', '★☆☆'] },
    reason: STR,
    stocks_kr: STR,
    stocks_us: STR,
  },
  required: ['emoji', 'name', 'stars', 'reason', 'stocks_kr', 'stocks_us'],
};
const COMMON_PROPS = {
  portfolio_note: STR,
  key_themes: { type: 'ARRAY', items: THEME },
  leading_sectors: { type: 'ARRAY', items: SECTOR },
  swing_check: {
    type: 'OBJECT',
    properties: { phase: STR, catalysts: { type: 'ARRAY', items: STR }, risks: { type: 'ARRAY', items: STR } },
    required: ['phase', 'catalysts', 'risks'],
  },
  upcoming_schedule: {
    type: 'OBJECT',
    properties: {
      this_week: { type: 'ARRAY', items: SCHEDULE_ITEM },
      this_month: { type: 'ARRAY', items: SCHEDULE_ITEM },
      next_2_months: { type: 'ARRAY', items: SCHEDULE_ITEM },
    },
    required: ['this_week', 'this_month', 'next_2_months'],
  },
  portfolio_adjustment: {
    type: 'OBJECT',
    properties: { passive_note: STR, swing_candidates: { type: 'ARRAY', items: STR } },
    required: ['passive_note', 'swing_candidates'],
  },
};
const COMMON_REQUIRED = ['portfolio_note', 'key_themes', 'leading_sectors', 'swing_check', 'upcoming_schedule', 'portfolio_adjustment'];

export const SCHEMA: Record<BriefEdition, unknown> = {
  morning: {
    type: 'OBJECT',
    properties: { market_regime: { type: 'STRING', enum: ['Risk-On', 'Risk-Off', '혼조'] }, regime_summary: STR, ...COMMON_PROPS },
    required: ['market_regime', 'regime_summary', ...COMMON_REQUIRED],
  },
  afternoon: {
    type: 'OBJECT',
    properties: { market_summary: STR, vix_comment: STR, ...COMMON_PROPS },
    required: ['market_summary', 'vix_comment', ...COMMON_REQUIRED],
  },
};

// ── 입력 글 ───────────────────────────────────────────────────────────────

const num4 = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 });

/** 원본 _fmt — 「  S&P500: 6,031.8000 (+0.53%) [10/28(수) 종가]」 */
function assetLine(key: BriefAssetKey, v: BriefAsset): string {
  const sign = v.change >= 0 ? '+' : '';
  const date = v.data_date ? ` [${dateLabel(v.data_date)} 종가]` : '';
  return `  ${ASSET_LABEL[key]}: ${num4(v.current)} (${sign}${v.change_pct.toFixed(2)}%)${date}`;
}

const lines = (assets: Partial<Record<BriefAssetKey, BriefAsset>>, keys: BriefAssetKey[]) =>
  keys.flatMap((k) => (assets[k] ? [assetLine(k, assets[k])] : [])).join('\n');

function earningsText(earnings: BriefEarning[]): string {
  return earnings.length ? earnings.map(earningsLine).join('\n') : '(실적 발표 예정 없음 또는 수집 실패)';
}

const newsText = (items: BriefNewsItem[], tag: string, max: number, empty: string) =>
  items.slice(0, max).map((n) => `[${tag}] ${n.title} (${n.source})`).join('\n') || empty;

/** 「2026년 10월 29일」 */
export function todayText(day: string): string {
  return `${day.slice(0, 4)}년 ${day.slice(5, 7)}월 ${day.slice(8, 10)}일`;
}

const PROFILE = `[투자자 프로필]
- 패시브 포트폴리오: S&P500 ETF 55%, 미국배당다우존스 ETF 25%, 국고채10년 ETF 10%, 금 ETF 10% (장기 분기 리밸런싱)
- 스윙 트레이딩: 국내(KOSPI 대형주) + 미국(S&P500 상위) 대상, 1~3개월 보유`;

const EARNINGS_HEAD = '[향후 60일 주요 기업 실적 발표 예정 (yfinance 실제 데이터, 국내·미국 시가총액 상위 종목과 관심·자동매매 종목에서 수집)]';

const SECTOR_LIST = BRIEF_SECTORS.map((s) => `"${s}"`).join(', ');

const THEME_JSON = (beginner: boolean) => `    {
      "icon": "🔴 또는 🟡 또는 🟢 (🔴=하락 리스크, 🟡=중립/혼조, 🟢=상승 모멘텀)",
      "category": "테마 분류 (예: 실적사이클, 통화정책, 정책·규제, 지정학, 산업구조 변화)",
      "title": "테마 제목 (1~3개월 지속 가능한 펀더멘털 테마)",
      "why_important": "왜 중요한지 — 투자 초보자도 이해할 수 있는 1문장${beginner ? '. 전문용어는 괄호로 풀이 병기' : ''}",
      "duration": "예상 지속 기간 (예: '1~2개월', '분기 전반', '연말까지')",
      "swing_point": "스윙 관점 — 어떤 섹터/종목에 어떤 영향인지 구체적으로"
    }`;

const REST_JSON = (sectorReason: string, phase: string) => `  "leading_sectors": [
    {
      "emoji": "섹터 특성에 맞는 이모지",
      "name": "섹터명",
      "stars": "★★★ 또는 ★★☆ 또는 ★☆☆",
      "reason": "${sectorReason}",
      "stocks_kr": "국내 주목 대형주 종목명 (없으면 빈 문자열)",
      "stocks_us": "미국 주목 대형주 종목명 (없으면 빈 문자열)"
    }
  ],
  "swing_check": {
    "phase": "${phase}",
    "catalysts": ["향후 1~2주 내 주요 촉매제 (날짜 포함)", "..."],
    "risks": ["주요 하방 리스크", "..."]
  },
  "upcoming_schedule": {
    "this_week": [
      {
        "date": "MM/DD(요일)",
        "event": "이벤트명",
        "ticker": "티커 (실적 발표인 경우, 아니면 빈 문자열)",
        "sector_kr": "섹터명 (실적 발표인 경우, 아니면 빈 문자열)",
        "detail": "예상 EPS·매출·YoY·컨센서스 등 한 줄 요약",
        "importance": 3
      }
    ],
    "this_month": [
      { "date":"...","event":"...","ticker":"...","sector_kr":"...","detail":"...","importance": 2 }
    ],
    "next_2_months": [
      { "date":"...","event":"...","ticker":"...","sector_kr":"...","detail":"...","importance": 1 }
    ]
  },
  "portfolio_adjustment": {
    "passive_note": "패시브 4자산(S&P500 ETF / 미국배당다우존스 / 국고채10년 / 금) 비중 미세 조정 제안 한 줄. 예: '금 ETF +2%p 검토, 국고채 -2%p (변동성 상승 대응)'. 조정 불필요 시 '현 비중 유지 권장' + 1문장 근거.",
    "swing_candidates": [
      "스윙 진입 후보 1: '<종목명>(<티커>) — <진입 근거 1문장>, 진입 가격 또는 조건 1문장'",
      "스윙 진입 후보 2 (또는 빈 문자열로 0~2개 허용)"
    ]
  }
}`;

const THEME_RULE = (beginner: boolean) => `- key_themes: 정확히 3개, 1~3개월 지속 가능한 펀더멘털 테마만 선정.
  ★ 당일 단발성 뉴스, 1~2주 단기 이벤트, 단순 헤드라인, 소문 제외.
  ★ 포함 대상: 실적 사이클 흐름, 통화정책 방향(연준 금리경로), 정책·규제, 지정학, 산업구조 변화(AI·전기차 등 메가트렌드).
  duration 은 반드시 명시. swing_point 는 어떤 섹터·종목에 어떤 영향인지 구체.${
    beginner ? '\n  금융 전문용어 사용 시 괄호로 짧게 풀이 병기 (예: "FOMC(미 연준 통화정책 회의)", "EPS(주당순이익)").' : ''
  }`;

const COMMON_RULES = `- leading_sectors: 2~3개. 다음 두 기준 중 하나라도 해당하면 선정 가능.

  기준 A) 지속 가능한 상승 모멘텀
    실적 사이클, 정책 변화, 금리·환율 등 최소 3개월 이상 지속 가능한 펀더멘털 근거.
    예: "메모리 슈퍼사이클 진입, 3개월+ 실적 개선 지속 예상"

  기준 B) 시장 집중 관심 — 방향 무관
    상승·하락 방향과 무관하게 다음 3조건 모두 만족:
    ① 향후 30일 이내 실적 발표 임박 또는 주요 정책·이벤트 초점
    ② 뉴스에서 지속적·집중적 언급 (단발성 헤드라인 아님)
    ③ 향후 1~3개월 시장 방향 결정력 있음
    예: "삼성·SK하이닉스 실적 발표 임박(30일 이내) 및 AI 반도체 공급/수요 이슈로
         시장 관심 집중, 하락 리스크지만 방향성 결정력 큼"

  ★ reason 에 어느 기준(A/B)에 해당하는지 명확히 서술.
    기준 B 선정 시 "관심 집중" 명확 근거(뉴스 다수 언급·실적 임박) 포함 필수.
  ★ 여전히 금지: 1~2주 단기 이벤트만으로, 계절성 테마만으로, 컨퍼런스만으로 선정.
  ★ 기준 B 로 선정한 하락 방향 섹터는 swing_point 에 "숏 관점" 또는 "관망·발표 후 판단" 명확히 서술.
    무조건 "매수 후보" 로 처리하지 말 것.
  ★ 총 개수 2~3개 상한 유지 (기준 B 추가로 4개+ 선정 금지).
  ★ name 은 다음 섹터 명칭(실적 일정의 [섹터] 이름과 같은 목록) 중에서 **정확히 일치**하게 선택:
    ${SECTOR_LIST}
  ★ 명칭을 변형하지 말 것. 서버 사후 처리가 정확 매칭만 함.
  ★ 위 명칭에 해당하지 않는 새 섹터를 선정할 경우, upcoming_schedule 의 해당 섹터 항목이 사후 처리로 모두 제거됨.
- upcoming_schedule: 향후 60일 주요 일정을 다음 3개 슬롯으로 분류.
  ★ 각 실적 항목 옆에 표시된 [D+N] 값을 그대로 사용해 슬롯 배치:
    · this_week: **D+0 ~ D+7** (오늘~7일 후), importance=3
    · this_month: **D+8 ~ D+30** (8~30일 후), importance=2
    · next_2_months: **D+31 ~ D+60** (31~60일 후), importance=1
  ★ 예: [D+6] 인 실적은 this_week 슬롯에, [D+21] 인 실적은 this_month 슬롯에.
  ★ AI 가 날짜를 자체 계산하지 말 것. 반드시 제공된 [D+N] 사용.
  ★ 슬롯 상한은 AI 측 참고값이며 서버 사후 처리에서 재조정됨.
  ★ leading_sectors 의 섹터와 일치하는 실적만 포함. 그 외 섹터 실적은 생략.
  ★ 슬롯 한도 초과 시 임박 날짜 우선.
  ★ 실적 발표 항목의 event 필드는 반드시 "<회사명> 실적 발표" 형식으로 작성 (예: "마이크론 실적 발표", "JP모건 실적 발표").
    회사명은 실적 일정 줄의 회사명을 그대로 사용.
    단순히 "실적 발표" 만 적으면 회사명이 누락되어 가독성이 떨어짐.
  ★ ticker 는 실적 일정 줄 괄호 안의 티커를 그대로, sector_kr 은 그 줄의 [섹터] 를 그대로 적을 것.
  ★ 실적 detail 형식 (압축형): 다음 형식을 반드시 따를 것.
    "예상 EPS $<X.XX>[⚠️] (직전 $<Q>, YoY $<Y>[, ±<N>%]) | 컨센서스 <Buy/Hold/Sell>(<n>/<m>) [| 매출 $<R>B]"
    - 직전분기 EPS 는 "직전 $X.XX" 로 짧게 (직전분기 실제 → 직전).
    - 전년동기 EPS 는 "YoY $X.XX" 로 짧게 (전년동기 실제 → YoY).
    - 분산은 30% 이상일 때만 ", ±N%" 추가, 30% 미만이면 생략.
    - 컨센서스 사이 공백 제거: "Buy(39/44)".
    - 매출은 "-" 가 아닐 때만 " | 매출 $X.XB" 형식으로 끝에 추가, "-" 이면 통째로 생략.
    - 구분자는 슬래시 "/" 가 아닌 파이프 "|" 사용 (가독성).
    - 국내 종목은 입력의 원화 표기(₩)를 그대로 사용.
    예 (정상): "예상 EPS $5.41 (직전 $5.94, YoY $4.96) | 컨센서스 Buy(12/24) | 매출 $48.72B"
    예 (sanity flag): "예상 EPS $0.12 ⚠️ (직전 $0.35, YoY $0.14, ±50%) | 컨센서스 Hold(21/38) | 매출 $11.51B"
    예 (매출 차단): "예상 EPS $20.05 (직전 $12.20, YoY $1.91, ±46%) | 컨센서스 Buy(39/44)"
  ★ ⚠️ 마크가 붙은 항목(eps_sanity_flag) 끝에 ", 신뢰도 주의" 한 어절을 detail 마지막에 추가.
    예: "예상 EPS $0.12 ⚠️ (직전 $0.35, YoY $0.14, ±50%) | 컨센서스 Hold(21/38) | 매출 $11.51B, 신뢰도 주의"
  ★ 매출이 "-" 인 경우 매출 항목 생략.
  ★ 경제지표·FOMC 포함 가능, 공휴일·단순 연설 제외.
  ★ ticker / sector_kr 은 실적인 경우에만 채움.
- swing_check.catalysts:
  ★ catalysts 는 upcoming_schedule (②) 와 절대 중복 금지. 같은 실적 발표 일정을 반복 노출하지 말 것.
  ★ 포함 대상: FOMC 회의, CPI/PCE/고용지표 등 경제지표 발표일, 정책 이벤트, 지정학·규제 이벤트만.
  ★ 실적 발표 일정은 ② 에 이미 표시되므로 catalysts 에서 제외.
  ★ 최대 3개. 해당 없으면 빈 리스트 []. 억지로 채우지 말 것.
- portfolio_adjustment:
  ★ passive_note 는 1문장, 80자 이내 (한국어 기준). 4자산 중 어떤 자산 ±%p 조정 또는 "현 비중 유지" 명확히.
    예 (80자 이내): "금 ETF +2%p 검토, 국고채 -2%p (변동성 상승 대응)."
    예 (현 비중 유지): "현 비중 유지 권장 — 매크로 큰 변화 없음, 분기 리밸런싱 대기."
  ★ swing_candidates 각 항목 100자 이내, 0~2개. 형식:
    "<종목명>(<티커>) — <진입 근거 1문장>, <진입 시점/조건>"
    예 (100자 이내): "마이크론(MU) — AI 메모리 수요 강세, 06/24 실적 발표 후 가이던스 확인 후 진입 검토."
  ★ ⚠️ sanity flag 된 종목(eps_sanity_flag=True)은 swing_candidates 추천 제외 또는 "추정 신뢰도 낮음" 명시.
  ★ 투자 권유 표현 금지 ("매수하세요" 등). 권유성은 "진입 후보로 검토 가능" 형태로.
- 인사말·서문·결론 문구 금지.`;

export interface PromptInput {
  edition: BriefEdition;
  today: string;
  assets: Partial<Record<BriefAssetKey, BriefAsset>>;
  earnings: BriefEarning[];
  domestic: BriefNewsItem[];
  foreign: BriefNewsItem[];
}

export function buildPrompt(input: PromptInput): string {
  return input.edition === 'morning' ? morningPrompt(input) : afternoonPrompt(input);
}

function morningPrompt({ today, assets, earnings, domestic, foreign }: PromptInput): string {
  return `오늘 날짜는 ${todayText(today)}입니다.

${SYSTEM}
아래 시장 데이터와 뉴스를 종합하여 오전 투자 브리핑을 작성하세요.

${PROFILE}

[주요 지수 (전일 종가)]
${lines(assets, ['SP500', 'NASDAQ', 'DOW', 'RUSSELL2000']) || '  (데이터 없음)'}

[매크로 자산 (전일 종가)]
${lines(assets, ['GOLD', 'DXY', 'US2Y', 'US10Y', 'USDKRW', 'WTI', 'NATGAS']) || '  (데이터 없음)'}

${EARNINGS_HEAD}
${earningsText(earnings)}

[오늘 국내 뉴스]
${newsText(domestic, '국내', 30, '(국내 뉴스 없음)')}

[오늘 해외 뉴스]
${newsText(foreign, '해외', 40, '(해외 뉴스 없음)')}

아래 JSON 스키마를 정확히 따라 응답하세요. JSON 이외의 텍스트는 절대 포함하지 마세요:

{
  "market_regime": "Risk-On 또는 Risk-Off 또는 혼조",
  "regime_summary": "오늘 시장 기조를 1~2문장으로 요약",
  "portfolio_note": "패시브 포트폴리오 4개 자산 중 오늘 특이 동향 한줄 (예: 금 ETF 강세 유지 / 채권 관망)",
  "key_themes": [
${THEME_JSON(false)}
  ],
${REST_JSON('오늘 이 섹터가 주도하는 근거 (뉴스 기반, 1~2문장)', '현재 시장 국면 한줄 (예: 하락 추세 속 기술적 반등 시도)')}

[작성 규칙]
- 데이터 기준일 인식: [주요 지수]·[매크로 자산]의 [MM/DD(요일) 종가] 라벨을 인식하고
  현재 시점이 해당 종가 이후임을 전제로 어조 조정.
${THEME_RULE(false)}
${COMMON_RULES}`;
}

function afternoonPrompt({ today, assets, earnings, domestic }: PromptInput): string {
  const vix = assets.VIX;
  const vixLevel = vix
    ? `  VIX: ${vix.current.toFixed(2)} — ${vixZone(vix.current)} 구간 (${vix.current >= 30 ? '30 이상' : vix.current >= 20 ? '20~30' : '20 미만'})`
    : '';
  return `오늘 날짜는 ${todayText(today)}입니다.

${SYSTEM}
오늘 국내 장 마감 데이터와 뉴스를 분석하여 오후 투자 브리핑을 작성하세요.

${PROFILE}

[오늘 국내 지수 (당일 마감)]
${lines(assets, ['KOSPI', 'KOSDAQ']) || '  (데이터 없음)'}

[시장 공포 지수]
${vixLevel || '  (데이터 없음)'}

${EARNINGS_HEAD}
${earningsText(earnings)}

[오늘 국내 뉴스]
${newsText(domestic, '국내', 30, '(국내 뉴스 없음)')}

아래 JSON 스키마를 정확히 따라 응답하세요. JSON 이외의 텍스트는 절대 포함하지 마세요:

{
  "market_summary": "오늘 국내 시장(코스피·코스닥) 마감 총평 1~2문장",
  "vix_comment": "현재 VIX 수준이 스윙 트레이딩에 갖는 의미 1문장",
  "portfolio_note": "패시브 포트폴리오 4개 자산 중 오늘 주목할 동향 한줄",
  "key_themes": [
${THEME_JSON(true)}
  ],
${REST_JSON('오늘 이 섹터가 주목받는 근거 (뉴스/실적 기반, 1~2문장)', '현재 국내 시장 국면 한줄')}

[작성 규칙]
- market_summary: 오늘 코스피·코스닥 등락과 주요 원인을 과거형으로 서술.
- vix_comment: VIX 수치(${vix ? vix.current : 'N/A'})를 언급하며 안정/주의/공포 여부와 스윙 트레이딩 시사점 서술.
${THEME_RULE(true)}
${COMMON_RULES}`;
}
