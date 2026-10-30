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
import { poolText, SECTOR_STOCKS_KEEP, type SectorStockPool } from './sectorStocks';
import { ASSET_LABEL, isIntradayBar, vixZone } from '../../src/utils/marketBrief';
import { FOMC_MEETINGS } from '../../src/data/fomc';
import { kstClockText, marketDate } from '../../src/utils/marketDate';
import { daysBetween } from './earnings';
import { OUTLOOK_CONFIDENCES, OUTLOOK_DIRECTIONS, OUTLOOK_TARGETS, type BriefAsset, type BriefAssetKey, type BriefEarning, type BriefEdition, type BriefSectorMove, type BriefSectorTrend } from '../../src/types/marketBrief';
import { FLAT_PCT, OUTLOOK_REASONS_MAX } from './outlook';

// v2: 날짜 · D+N 을 각 시장 현지 날짜로(v2.59.3) · v3: 장 마감 뒤 미국 D+0 은 [D+0 · 발표됨](v2.59.4) ·
// v4: 숫자와 반대인 방향 표현 금지 · 장중 값은 「장중(마감 전) — HH:MM 기준」 · 대표 종목은 후보 목록에서 [{ticker, name}](v2.59.6)
// v5: 지수 5 · 20일 흐름 · 미국 지수 선물 · 섹터 1주 흐름 입력 · 오후판 미국 지수 · 「오늘 예상 방향」(today_outlook)(v2.60.0)
export const MARKET_BRIEF_PROMPT_VERSION = 'brief-v5';

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
/** 대표 종목 — [주도 섹터 대표 종목 후보] 의 티커 · 이름 그대로(서버가 목록 밖을 뺀다 — `sectorStocks.ts`) */
const STOCK = {
  type: 'OBJECT',
  properties: { ticker: STR, name: STR },
  required: ['ticker', 'name'],
};
const SECTOR = {
  type: 'OBJECT',
  properties: {
    emoji: STR,
    name: { type: 'STRING', enum: BRIEF_SECTORS },
    stars: { type: 'STRING', enum: ['★★★', '★★☆', '★☆☆'] },
    reason: STR,
    stocks_kr: { type: 'ARRAY', items: STOCK },
    stocks_us: { type: 'ARRAY', items: STOCK },
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

/** 「오늘 예상 방향」(v2.60.0) — 대상 · 방향 · 확신은 정해진 말만(서버도 다시 거른다 — `outlook.normalizeOutlook`) */
const OUTLOOK = (edition: BriefEdition) => ({
  type: 'ARRAY',
  items: {
    type: 'OBJECT',
    properties: {
      target: { type: 'STRING', enum: OUTLOOK_TARGETS[edition] },
      direction: { type: 'STRING', enum: OUTLOOK_DIRECTIONS },
      confidence: { type: 'STRING', enum: OUTLOOK_CONFIDENCES },
      reasons: { type: 'ARRAY', items: STR },
      watch: STR,
    },
    required: ['target', 'direction', 'confidence', 'reasons', 'watch'],
  },
});

export const SCHEMA: Record<BriefEdition, unknown> = {
  morning: {
    type: 'OBJECT',
    properties: { market_regime: { type: 'STRING', enum: ['Risk-On', 'Risk-Off', '혼조'] }, regime_summary: STR, today_outlook: OUTLOOK('morning'), ...COMMON_PROPS },
    required: ['market_regime', 'regime_summary', 'today_outlook', ...COMMON_REQUIRED],
  },
  afternoon: {
    type: 'OBJECT',
    properties: { market_summary: STR, vix_comment: STR, today_outlook: OUTLOOK('afternoon'), ...COMMON_PROPS },
    required: ['market_summary', 'vix_comment', 'today_outlook', ...COMMON_REQUIRED],
  },
};

// ── 입력 글 ───────────────────────────────────────────────────────────────

const num4 = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 4 });

/** 지수(정규장이 있는 것) — 「종가」 · 「장중」 을 가린다. 선물 · 환율 · 금리는 거의 하루 내내 움직여 「기준」 으로 적는다 */
const INDEX_KEYS: BriefAssetKey[] = ['KOSPI', 'KOSDAQ', 'SP500', 'NASDAQ', 'DOW', 'RUSSELL2000', 'VIX'];
const RATE_KEYS: BriefAssetKey[] = ['US2Y', 'US10Y'];

const KR_INDEX_KEYS: BriefAssetKey[] = ['KOSPI', 'KOSDAQ'];

/**
 * 그 값의 기준 라벨 — 「10/28(수) 종가」 · 「10/29(목) 장중(마감 전) — 14:20 기준」 · 「10/28(수) 기준」.
 * 장중이면 받은 시각을 밝힌다(국내 지수는 한국 시각 · 미국 지수는 「한국 HH:MM」) — AI 가 장중 값을 마감처럼 쓰지 않게(v2.59.6).
 */
export function basisLabel(key: BriefAssetKey, v: BriefAsset, at: number): string {
  if (!v.data_date) return '';
  if (!INDEX_KEYS.includes(key)) return `${dateLabel(v.data_date)} 기준`;
  if (!isIntradayBar(key, v.data_date, at)) return `${dateLabel(v.data_date)} 종가`;
  return `${dateLabel(v.data_date)} 장중(마감 전) — ${KR_INDEX_KEYS.includes(key) ? '' : '한국 '}${kstClockText(at).slice(0, 5)} 기준`;
}

/**
 * 원본 _fmt — 「  S&P500: 6,031.8000 (+0.53%) [10/28(수) 종가]」.
 * 금리는 등락률(%) 대신 절대 변화(%p · bp)로 — 「금리 0.74% 상승」 처럼 읽히지 않게(원본은 등락률이었다).
 */
function assetLine(key: BriefAssetKey, v: BriefAsset, at: number): string {
  const sign = v.change >= 0 ? '+' : '';
  const label = basisLabel(key, v, at);
  const date = label ? ` [${label}]` : '';
  const move = RATE_KEYS.includes(key)
    ? `전일 대비 ${sign}${v.change.toFixed(3)}%p, ${sign}${(v.change * 100).toFixed(1)}bp`
    : `${sign}${v.change_pct.toFixed(2)}%`;
  return `  ${ASSET_LABEL[key]}: ${num4(v.current)} (${move})${date}${trendText(key, v, at)}`;
}

const pct = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;

/** 최근 흐름 — 「 · 최근 흐름 5일 −3.20% · 20일 +1.10%」(v2.60.0). 장중 값이면 「장중 값 기준」 · 봉이 모자란 칸은 빼고 · 둘 다 없으면 빈 글 */
export function trendText(key: BriefAssetKey, v: BriefAsset, at: number): string {
  const t = v.trend;
  if (!t || (t.d5 == null && t.d20 == null)) return '';
  const parts = [t.d5 != null ? `5일 ${pct(t.d5)}` : '', t.d20 != null ? `20일 ${pct(t.d20)}` : ''].filter(Boolean);
  const live = v.data_date && isIntradayBar(key, v.data_date, at) ? '(장중 값 기준)' : '';
  return ` · 최근 흐름 ${parts.join(' · ')}${live}`;
}

/** 미국 지수 선물(밤사이) — 받은 시각(한국)과 함께 · 직전 세션 종가 대비 */
function futuresText(assets: Partial<Record<BriefAssetKey, BriefAsset>>, at: number): string {
  const rows = (['ES', 'NQ'] as BriefAssetKey[]).flatMap((k) => {
    const v = assets[k];
    return v ? [`  ${ASSET_LABEL[k]}: ${num4(v.current)} (직전 세션 종가 대비 ${pct(v.change_pct)})`] : [];
  });
  return rows.length ? `${rows.join('\n')}\n  (받은 시각 한국 ${kstClockText(at).slice(0, 5)} — 선물은 정규장 밖에도 거래돼 밤사이 흐름을 보여 준다. 정규장 지수와 같은 값이 아니다)` : '  (데이터 없음)';
}

const sectorRow = (list: BriefSectorMove[]) => list.map((m) => `${m.sector} ${pct(m.pct)}`).join(' · ') || '없음';

/** 섹터 1주 흐름(종목 지도) — 시장마다 강세 · 약세 한 줄씩. 받지 못한 시장은 「받지 못함」 */
export function sectorTrendText(trend: BriefSectorTrend | undefined): string {
  const one = (label: string, t: BriefSectorTrend['kr']) =>
    t ? `- ${label} 강세: ${sectorRow(t.up)}\n- ${label} 약세: ${sectorRow(t.down)}` : `- ${label}: 받지 못함`;
  return trend ? `${one('국내', trend.kr)}\n${one('미국', trend.us)}` : '(받지 못함)';
}

const TREND_HEAD = '[섹터 1주 흐름 (앱 종목 지도 · 시가총액 상위 100 · 섹터별 시총 가중 5거래일 수익률 — 강세 위 3 · 약세 아래 3)]';

/** 오늘부터 60일 안 FOMC 회의(연준 공식 일정 `data/fomc.ts`) — AI 가 경제 일정 날짜를 기억으로 쓰지 않게 */
export function fomcText(today: string, usReleased = false): string {
  const rows = FOMC_MEETINGS.filter((m) => {
    const d = daysBetween(today, m.end);
    return d >= 0 && d <= 60;
  }).map((m) => `- ${dateLabel(m.end)} [D+${daysBetween(today, m.end)}${usReleased && daysBetween(today, m.end) === 0 ? ' · 발표됨' : ''}] FOMC 금리 결정(회의 ${dateLabel(m.start)}~${dateLabel(m.end)}${m.sep ? ' · 경제전망 · 점도표 발표' : ''})`);
  return rows.length ? rows.join('\n') : '(60일 안 FOMC 회의 없음)';
}


const lines = (assets: Partial<Record<BriefAssetKey, BriefAsset>>, keys: BriefAssetKey[], at: number) =>
  keys.flatMap((k) => (assets[k] ? [assetLine(k, assets[k], at)] : [])).join('\n');

function earningsText(earnings: BriefEarning[], usReleased: boolean): string {
  return earnings.length ? earnings.map((e) => earningsLine(e, usReleased)).join('\n') : '(실적 발표 예정 없음 또는 수집 실패)';
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
      "stocks_kr": [{ "ticker": "[주도 섹터 대표 종목 후보] 의 이 섹터 국내 티커", "name": "그 줄의 종목명 그대로" }],
      "stocks_us": [{ "ticker": "[주도 섹터 대표 종목 후보] 의 이 섹터 미국 티커", "name": "그 줄의 종목명 그대로" }]
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

const OUTLOOK_NAME: Record<string, string> = { KOSPI: '오늘 국내 정규장 코스피', SP500: '오늘 밤(미국 날짜로 다음 정규장) S&P500' };

const OUTLOOK_JSON = (edition: BriefEdition) => `  "today_outlook": [
${OUTLOOK_TARGETS[edition]
  .map(
    (t) =>
      `    { "target": "${t}", "direction": "상승 또는 보합 또는 하락", "confidence": "높음 또는 보통 또는 낮음", "reasons": ["근거 1 — 위 입력 숫자를 그대로 인용", "..."], "watch": "이 예상이 뒤집힐 수 있는 조건 한 줄" }`,
  )
  .join(',\n')}
  ],`;

/** 「오늘 예상 방향」 규칙 — 보합 범위는 문장 검사 · 채점과 같은 상수 */
const OUTLOOK_RULE = (edition: BriefEdition) => `- today_outlook: ${OUTLOOK_TARGETS[edition].map((t) => `${t}(${OUTLOOK_NAME[t]})`).join(' · ')} — 정확히 ${OUTLOOK_TARGETS[edition].length}개, 이 대상만.
  ★ direction: 「상승 · 보합 · 하락」 중 하나. 보합 = 전일 정규장 종가 대비 ±${FLAT_PCT}% 안으로 끝날 것으로 볼 때.
  ★ confidence: 「높음 · 보통 · 낮음」 중 하나. 입력 근거(최근 흐름 · 선물 · 전일 등락 · 섹터 1주 · 뉴스)가 같은 방향으로 모일수록 높음, 엇갈리면 낮음. 확신이 낮으면 보합을 고를 수 있다.
  ★ reasons: 1~${OUTLOOK_REASONS_MAX}줄. 위 입력의 숫자를 그대로 근거로 쓸 것(예: "S&P500 선물 직전 세션 종가 대비 −0.92%"). 입력에 없는 숫자를 지어내지 말 것.
  ★ watch: 이 예상이 뒤집힐 수 있는 조건 한 줄(예: 발표 예정 지표 · 선물 반전).
  ★ 투자 권유 표현 금지 — 참고 예상이며 매수 · 매도 권유가 아니다.`;

const COMMON_RULES = `- 방향 표현(모든 문장): 위 시장 데이터의 등락 방향과 반대인 표현 금지 — 예: 코스피가 내렸는데 '방어' · '선방' · '강세' · '상승' 으로 쓰지 말 것.
  ★ 라벨이 [장중(마감 전)] 인 값은 아직 마감 전이다 — 그 값을 말할 때는 '장중 기준' 이라고 밝힐 것.
  ★ 뉴스 제목의 분위기보다 위 숫자를 우선할 것. 서버가 문장의 방향과 숫자를 맞춰 보고, 어긋나면 화면에 「숫자와 다름」 을 붙인다.
- leading_sectors: 2~3개. 다음 두 기준 중 하나라도 해당하면 선정 가능.

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
  ★ stocks_kr · stocks_us 는 [주도 섹터 대표 종목 후보] 에서 **그 섹터 줄의** 국내 · 미국 종목만, ticker · name 을 그대로 0~${SECTOR_STOCKS_KEEP}개.
    목록에 없는 종목 · 다른 섹터 줄의 종목은 쓰지 말 것(서버가 빼고 화면에 남지 않는다). 해당 종목이 없으면 빈 배열 [].
- upcoming_schedule: 향후 60일 주요 일정을 다음 3개 슬롯으로 분류.
  ★ 날짜와 D+N 은 각 종목 시장의 현지 날짜 기준(미국 종목 = 미국 동부, 국내 종목 = 한국). FOMC 등 미국 일정도 미국 날짜.
  ★ [D+0 · 발표됨] 표시가 붙은 미국 일정(실적 · FOMC)은 그 날 미국 장 마감이 지나 이미 발표됐을 수 있다 — 「앞둔 일정」 이 아니라 「발표 결과 확인」 관점으로 쓸 것(일정에는 남긴다). 결과 수치 · 평가(EPS 상회 · 금리 동결 등)는 입력 뉴스에 있을 때만 쓰고, 없으면 「결과 확인 필요」 로 쓸 것(지어내지 말 것).
  ★ 국내 경제 일정(금통위 · 한국 지표 등)의 날짜는 한국 날짜.
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
  ★ FOMC 날짜는 [향후 60일 FOMC 회의] 의 날짜만 쓸 것. CPI·고용지표 등 그 밖의 경제지표는 날짜를 확실히 알 때만 넣고, 모르면 넣지 말 것(날짜를 지어내지 말 것).
  ★ ticker / sector_kr 은 실적인 경우에만 채움.
- swing_check.catalysts:
  ★ catalysts 는 upcoming_schedule (②) 와 절대 중복 금지. 같은 실적 발표 일정을 반복 노출하지 말 것.
  ★ 포함 대상: FOMC 회의, CPI/PCE/고용지표 등 경제지표 발표일, 정책 이벤트, 지정학·규제 이벤트만.
  ★ 날짜를 붙일 때 FOMC 는 [향후 60일 FOMC 회의] 의 날짜만, 다른 지표는 확실한 날짜만(모르면 날짜 없이).
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
  /** 받은 시각(ms) — 장중 판단. 주지 않으면 지금 */
  at?: number;
  /** 지금이 미국 날짜 그 날 정규장 끝 뒤인가 — 미국 D+0 일정에 「발표됨」(v2.59.4) */
  usReleased?: boolean;
  /** ③ 대표 종목 후보(v2.59.6) — 없으면 빈 목록 */
  sectorStocks?: SectorStockPool;
  /** 섹터 1주 흐름(v2.60.0) */
  sectorTrend?: BriefSectorTrend;
}

const STOCKS_HEAD = '[주도 섹터 대표 종목 후보 (섹터별 시가총액 상위 — leading_sectors 의 stocks_kr · stocks_us 는 이 목록에서만)]';

export function buildPrompt(input: PromptInput): string {
  return input.edition === 'morning' ? morningPrompt(input) : afternoonPrompt(input);
}

function morningPrompt({ today, assets, earnings, domestic, foreign, at = Date.now(), usReleased = false, sectorStocks = {}, sectorTrend }: PromptInput): string {
  return `오늘 날짜는 ${todayText(today)}입니다(한국). 미국 동부 날짜는 ${todayText(marketDate(at, 'SPY'))}입니다.

${SYSTEM}
아래 시장 데이터와 뉴스를 종합하여 오전 투자 브리핑을 작성하세요.

${PROFILE}

[주요 지수 (전일 종가)]
${lines(assets, ['SP500', 'NASDAQ', 'DOW', 'RUSSELL2000'], at) || '  (데이터 없음)'}

[미국 지수 선물 (밤사이)]
${futuresText(assets, at)}

[국내 지수 (전 거래일 종가)]
${lines(assets, ['KOSPI', 'KOSDAQ'], at) || '  (데이터 없음)'}

[매크로 자산 (최근 값 — 줄마다 기준 날짜, 금리는 전일 대비 %p)]
${lines(assets, ['GOLD', 'DXY', 'US2Y', 'US10Y', 'USDKRW', 'WTI', 'NATGAS'], at) || '  (데이터 없음)'}

${TREND_HEAD}
${sectorTrendText(sectorTrend)}

[향후 60일 FOMC 회의 (연준 공식 일정)]
${fomcText(marketDate(at, 'SPY'), usReleased)}

${EARNINGS_HEAD}
${earningsText(earnings, usReleased)}

${STOCKS_HEAD}
${poolText(sectorStocks)}

[오늘 국내 뉴스]
${newsText(domestic, '국내', 30, '(국내 뉴스 없음)')}

[오늘 해외 뉴스]
${newsText(foreign, '해외', 40, '(해외 뉴스 없음)')}

아래 JSON 스키마를 정확히 따라 응답하세요. JSON 이외의 텍스트는 절대 포함하지 마세요:

{
  "market_regime": "Risk-On 또는 Risk-Off 또는 혼조",
  "regime_summary": "오늘 시장 기조를 1~2문장으로 요약",
  "portfolio_note": "패시브 포트폴리오 4개 자산 중 오늘 특이 동향 한줄 (예: 금 ETF 강세 유지 / 채권 관망)",
${OUTLOOK_JSON('morning')}
  "key_themes": [
${THEME_JSON(false)}
  ],
${REST_JSON('오늘 이 섹터가 주도하는 근거 (뉴스 기반, 1~2문장)', '현재 시장 국면 한줄 (예: 하락 추세 속 기술적 반등 시도)')}

[작성 규칙]
- 최근 흐름 · 선물 · 섹터 1주 흐름은 위에 적힌 숫자만 쓸 것(숫자를 지어내지 말 것). 「최근 흐름 5일 · 20일」 은 마지막 값 ÷ 5 · 20거래일 전 종가 − 1.
- 데이터 기준일 인식: [주요 지수]·[매크로 자산]의 [MM/DD(요일) 종가] 라벨을 인식하고
  현재 시점이 해당 종가 이후임을 전제로 어조 조정.
${OUTLOOK_RULE('morning')}
${THEME_RULE(false)}
${COMMON_RULES}`;
}

function afternoonPrompt({ today, assets, earnings, domestic, at = Date.now(), usReleased = false, sectorStocks = {}, sectorTrend }: PromptInput): string {
  const vix = assets.VIX;
  const vixBasis = vix ? basisLabel('VIX', vix, at) : '';
  const vixLevel = vix
    ? `  VIX: ${vix.current.toFixed(2)} — ${vixZone(vix.current)} 구간 (${vix.current >= 30 ? '30 이상' : vix.current >= 20 ? '20~30' : '20 미만'})${vixBasis ? ` [${vixBasis} — 미국 시장 값]` : ''}`
    : '';
  // 국내 휴장일 · 데이터가 늦은 날 — 마지막 봉이 오늘이 아니면 오늘 일처럼 쓰지 않게
  const krDate = assets.KOSPI?.data_date;
  const krStale = krDate && krDate !== today ? `\n  ※ 오늘은 장이 열리지 않았거나 오늘 값이 아직 없습니다 — 위 값은 마지막 거래일 ${dateLabel(krDate)} 값입니다.` : '';
  return `오늘 날짜는 ${todayText(today)}입니다(한국). 미국 동부 날짜는 ${todayText(marketDate(at, 'SPY'))}입니다.

${SYSTEM}
오늘 국내 장 마감 데이터와 뉴스를 분석하여 오후 투자 브리핑을 작성하세요.

${PROFILE}

[오늘 국내 지수 (당일 마감 — 장 마감 전에 받았으면 라벨이 [장중(마감 전) — 받은 시각])]
${lines(assets, ['KOSPI', 'KOSDAQ'], at) || '  (데이터 없음)'}${krStale}

[미국 지수 (마지막 정규장 종가)]
${lines(assets, ['SP500', 'NASDAQ'], at) || '  (데이터 없음)'}

[미국 지수 선물 (밤사이)]
${futuresText(assets, at)}

[시장 공포 지수]
${vixLevel || '  (데이터 없음)'}

${TREND_HEAD}
${sectorTrendText(sectorTrend)}

[향후 60일 FOMC 회의 (연준 공식 일정)]
${fomcText(marketDate(at, 'SPY'), usReleased)}

${EARNINGS_HEAD}
${earningsText(earnings, usReleased)}

${STOCKS_HEAD}
${poolText(sectorStocks)}

[오늘 국내 뉴스]
${newsText(domestic, '국내', 30, '(국내 뉴스 없음)')}

아래 JSON 스키마를 정확히 따라 응답하세요. JSON 이외의 텍스트는 절대 포함하지 마세요:

{
  "market_summary": "오늘 국내 시장(코스피·코스닥) 마감 총평 1~2문장",
  "vix_comment": "현재 VIX 수준이 스윙 트레이딩에 갖는 의미 1문장",
  "portfolio_note": "패시브 포트폴리오 4개 자산 중 오늘 주목할 동향 한줄",
${OUTLOOK_JSON('afternoon')}
  "key_themes": [
${THEME_JSON(true)}
  ],
${REST_JSON('오늘 이 섹터가 주목받는 근거 (뉴스/실적 기반, 1~2문장)', '현재 국내 시장 국면 한줄')}

[작성 규칙]
- 최근 흐름 · 선물 · 섹터 1주 흐름은 위에 적힌 숫자만 쓸 것(숫자를 지어내지 말 것). 「최근 흐름 5일 · 20일」 은 마지막 값 ÷ 5 · 20거래일 전 종가 − 1.
- market_summary: 오늘 코스피·코스닥 등락과 주요 원인을 과거형으로 서술. 지수 라벨이 [장중(마감 전)]이면 아직 마감 전이므로 "장중 기준" 흐름으로 서술(오른 · 내린 방향은 숫자 그대로). 지수 날짜가 오늘이 아니면 마지막 거래일 값이라고 밝힐 것.
- vix_comment: VIX 수치(${vix ? vix.current : 'N/A'})를 언급하며 안정/주의/공포 여부와 스윙 트레이딩 시사점 서술.
${OUTLOOK_RULE('afternoon')}
${THEME_RULE(true)}
${COMMON_RULES}`;
}
