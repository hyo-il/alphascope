/**
 * 오늘 시황 — AI 문장 ↔ 시장 데이터 방향 검사(v2.59.6, 사용자 결정 2026-10-30). Gemini 를 더 부르지 않는다(서버 글자 검사).
 *
 * - 보는 글: ① 시장 기조 라벨(`market_regime`) · 요약(`regime_summary`) · 총평(`market_summary`) · 「오늘 예상 방향」 근거 · ③ 주도 섹터 이유 · ④ 테마 「왜 중요」 · ⑥ 국면.
 * - 방법: 글을 마디(문장 · 쉼표 · 「지만 · 으나 · 반면」)로 나누고, 마디 안 시장 이름 뒤(다음 시장 이름 전까지)의 방향 말을
 *   **같은 브리핑의 시장 데이터 부호**와 맞춘다. 문장은 고치지 않는다 — 어긋남만 `brief.mismatches` 에 남기고 화면이 표시한다.
 * - **애매하면 검사하지 않는다**(틀린 경고보다 경고 없음): 오름 · 내림 말이 한 마디에 함께 · 방향 말 바로 뒤 전망 · 우려 · 부정(가능성 · 우려 · 않 …) ·
 *   보합(등락 절댓값 0.3% 미만, 금리는 3bp 미만) · 정책 금리 이야기(인하 · 인상 · 동결 · 연준 …) 속 「금리」 · 괄호 안 글 ·
 *   방향 말 앞 장중 흐름 · 지난 일(장 초반 · 출발 · 한때 · 지난주) · 경제를 말하는 「호조 · 회복 · 부진」(수출 · 실적 · 경기 …) ·
 *   시장 이름 바로 뒤 「대비 · 보다 · 에서 · 선물」(견준 대상 · 그 안의 업종 · 선물) · 「유가증권시장」 ·
 *   미국 국채가 아닌 금리(국고채 · 일본 · 대출 …) · 원/달러가 아닌 환율(엔 · 위안 · 유로) · 채권의 「강세 · 약세 · 가격」(수익률과 반대) · 「S&P글로벌」(지표 이름).
 * - 「방어 · 선방 · 견조」 는 「덜 빠졌다」 일 수 있어 −1% 보다 나쁠 때만 어긋남(주식 지수만). 같은 마디에 오름 말이 있어도 방어 말로 판단한다.
 * - 단어 목록 · 임계값은 이 파일 상수 한 곳.
 */

import { ASSET_LABEL, BRIEF_FLAT_PCT, isIntradayBar } from '../../src/utils/marketBrief';
import type { BriefAi, BriefAsset, BriefAssetKey, BriefEdition, BriefMismatch } from '../../src/types/marketBrief';

/** 보합 — 등락률 절댓값이 이보다 작으면 방향을 따지지 않는다(%) — 화면 · 예상 · 채점과 같은 값(`BRIEF_FLAT_PCT`) */
export const FLAT_PCT = BRIEF_FLAT_PCT;
/** 금리 보합 — 전일 대비 절대 변화가 이보다 작으면(%p = 3bp) */
export const FLAT_RATE_PP = 0.03;
/** 「방어 · 선방」 이 어긋남이 되는 등락률(%) — 이보다 나쁘면 */
export const DEFENSE_PCT = -1;
/** 기조 라벨(Risk-On · Risk-Off) — S&P500 · 나스닥이 둘 다 이만큼 반대로 움직였을 때만(%) */
export const REGIME_PCT = 1;

type Kind = 'index' | 'rate' | 'other';

interface MarketTerm {
  /** 화면 글자 */
  name: string;
  pattern: RegExp;
  keys: BriefAssetKey[];
  kind: Kind;
}

/** 시장 이름 — 앞에 있을수록 먼저 잡는다(「원달러」 를 「달러」 보다 먼저 · 「국내 증시」 를 「코스피」 와 따로) */
export const MARKET_TERMS: MarketTerm[] = [
  { name: '국내 증시', pattern: /(?:국내|한국)\s*(?:증시|주식\s*시장|주식시장|시장|지수|주식)/g, keys: ['KOSPI', 'KOSDAQ'], kind: 'index' },
  { name: '코스닥', pattern: /코스닥|KOSDAQ/gi, keys: ['KOSDAQ'], kind: 'index' },
  { name: '코스피', pattern: /코스피|KOSPI/gi, keys: ['KOSPI'], kind: 'index' },
  { name: '미국 증시', pattern: /(?:미국|뉴욕)\s*(?:증시|주식\s*시장|주식시장|주식|지수)|미\s*증시|월가/g, keys: ['SP500', 'NASDAQ', 'DOW'], kind: 'index' },
  { name: 'S&P500', pattern: /S&P\s*500|S&P(?!\s*글로벌)|에스앤피/gi, keys: ['SP500'], kind: 'index' },
  { name: '나스닥', pattern: /나스닥|NASDAQ/gi, keys: ['NASDAQ'], kind: 'index' },
  // 「미국배당다우존스」 같은 이름 속 다우는 지수가 아니다
  { name: '다우', pattern: /(?<![가-힣A-Za-z])다우(?:존스)?(?!\s*(?:ETF|배당))/g, keys: ['DOW'], kind: 'index' },
  { name: '러셀2000', pattern: /러셀/g, keys: ['RUSSELL2000'], kind: 'index' },
  { name: 'VIX', pattern: /VIX|공포\s*지수/gi, keys: ['VIX'], kind: 'other' },
  { name: '원/달러 환율', pattern: /원\s*[/·-]?\s*달러\s*환율|원\s*[/·-]?\s*달러|환율/g, keys: ['USDKRW'], kind: 'other' },
  { name: '달러 인덱스', pattern: /달러\s*인덱스|DXY|달러화/gi, keys: ['DXY'], kind: 'other' },
  { name: '미국 2년물 금리', pattern: /2년물|2년\s*(?:국채|금리)/g, keys: ['US2Y'], kind: 'rate' },
  { name: '미국 10년물 금리', pattern: /10년물|10년\s*(?:국채|금리)/g, keys: ['US10Y'], kind: 'rate' },
  { name: '미국 국채 금리', pattern: /국채\s*(?:금리|수익률)|채권\s*금리|시장\s*금리|금리/g, keys: ['US10Y', 'US2Y'], kind: 'rate' },
  { name: '금', pattern: /금값|금\s*가격|금\s*선물|골드|(?<![가-힣])금(?=은|이|도|과|·|,|\s)/g, keys: ['GOLD'], kind: 'other' },
  { name: '유가', pattern: /유가(?!증권)|원유|WTI/gi, keys: ['WTI'], kind: 'other' },
  { name: '천연가스', pattern: /천연\s*가스/g, keys: ['NATGAS'], kind: 'other' },
];

/** 방향 말 */
export const UP_WORDS = /상승|반등|강세|올랐|오른|오르|올라|급등|랠리|호조|회복|신고가/g;
export const DOWN_WORDS = /하락|급락|약세|내렸|내린|떨어|부진|폭락|반락|밀렸|밀려/g;
/** 「덜 빠졌다」 일 수 있는 말 — 주식 지수에서만, −1% 보다 나쁠 때 어긋남. 「방어적 대응 · 방어주 · 방어 업종」(자세 · 업종)은 아니다 */
export const DEFENSE_WORDS = /방어(?=력|했|하|에\s*성공)|선방|견조|버텼|버티|하방\s*경직/g;
/** 경제 · 실적을 말하는 「호조 · 회복 · 부진」 — 바로 앞(8자 안)에 이 말이 있으면 지수 방향이 아니다(「수출 호조」 · 「경기 회복」) */
const ECONOMY_BEFORE = /수출|실적|지표|고용|소비|경기|경제|업황|수요|매출|이익/;
const ECONOMY_WORDS = /^(?:호조|회복|부진|견조)$/;
/** 그 말 바로 뒤(8자 안)가 경제 · 실적이면 같다(「견조한 고용지표」) */
const ECONOMY_AFTER = /지표|실적|수출|고용|소비|경기|매출|이익|수요/;
/** 시장 이름 바로 뒤가 이 말이면 그 뒤 방향은 지수가 아니라 견준 대상 · 그 안의 업종이다(「코스피 대비 강세」 · 「코스피에서 반도체주 상승」 · 「나스닥 선물」) */
const NOT_INDEX_AFTER = /^\s*(?:대비|보다|에서|내에서|내\s|안에서|선물|200\s*선물)/;
/** 방향 말 바로 뒤(10자 안)에 오면 그 말은 지금 일이 아니다 — 전망 · 우려 · 부정 · 가정 · 폭 이야기(상승폭 반납 · 하락폭 축소) */
export const HEDGE_AFTER = /출발|이후|반납|꺾|둔화|축소|제한|가능|우려|리스크|위험|기대|전망|예상|경계|않|없|못|여부|압력|요인|시나리오|수\s*있|수도|대비|하면|되면|할\s*경우|것으로|할\s*것|일\s*것|듯/;
/** 방향 말 바로 앞(8자 안) — 가정 · 부정 · 장중 흐름 · 지난 일(「장 초반 상승」 · 「지난주 상승」 — 오늘 마감 방향이 아니다) */
export const HEDGE_BEFORE = /(?:^|\s)시\s|경우|면\s|않|만약|초반|한때|지난\s*주|지난\s*달|지난해/;
/** 「금리」 가 정책 금리 이야기인 마디 — 시장 금리(국채 수익률)와 다르다 */
const POLICY_RATE = /인하|인상|동결|기준\s*금리|연준|Fed|FOMC|금통위|통화\s*정책|피벗/i;
/** 미국 국채가 아닌 금리(국고채 · 일본 · 유럽 · 대출 …)가 나오는 마디 — 금리 이름을 미국 국채로 보지 않는다 */
const OTHER_RATE = /국고채|한국\s*국채|일본|日|JGB|독일|분트|유럽|영국|길트|중국|대출|모기지|예금|실질\s*금리/;
/** 원/달러가 아닌 환율(엔 · 위안 · 유로)이 나오는 마디 — 「환율」 을 원/달러로 보지 않는다 */
const OTHER_FX = /엔화|엔\s*[/·]|[/·]\s*엔|엔\s*달러|달러\s*엔|엔캐리|위안|유로/;

/** 마디 나누기 — 문장 끝 · 쉼표 · 세미콜론 · 줄바꿈 · 대조 이음말 */
const CLAUSE_SPLIT = /[.!?;\n]|,\s*|(?<=[가-힣])(?:지만|으나|는데|반면|면서도)\s+|반면\s*/;

type Dir = 'up' | 'down' | 'defense';

const MINUS = '−';
const signed = (v: number, digits: number, unit: string) => `${v > 0 ? '+' : v < 0 ? MINUS : ''}${Math.abs(v).toFixed(digits)}${unit}`;

interface Found {
  term: MarketTerm;
  start: number;
  end: number;
}

/** 마디 안의 시장 이름 — 겹치면 앞 목록 · 긴 것 */
function findMarkets(clause: string): Found[] {
  const found: Found[] = [];
  for (const term of MARKET_TERMS) {
    for (const m of clause.matchAll(term.pattern)) {
      const start = m.index ?? 0;
      const end = start + m[0].length;
      if (found.some((f) => start < f.end && end > f.start)) continue;
      found.push({ term, start, end });
    }
  }
  return found.sort((a, b) => a.start - b.start);
}

/** 한 토막의 방향 말 — 전망 · 부정이 붙은 말은 뺀다. 오름 · 내림이 섞이면 null(애매) */
function directionOf(segment: string): { dir: Dir; word: string } | null {
  const hits: { dir: Dir; word: string }[] = [];
  const scan = (re: RegExp, dir: Dir) => {
    for (const m of segment.matchAll(re)) {
      const at = m.index ?? 0;
      const after = segment.slice(at + m[0].length, at + m[0].length + 10);
      const before = segment.slice(Math.max(0, at - 8), at);
      if (HEDGE_AFTER.test(after) || HEDGE_BEFORE.test(before)) continue;
      if (ECONOMY_WORDS.test(m[0]) && (ECONOMY_BEFORE.test(before) || ECONOMY_AFTER.test(after.slice(0, 8)))) continue;
      hits.push({ dir, word: m[0] });
    }
  };
  scan(UP_WORDS, 'up');
  scan(DOWN_WORDS, 'down');
  scan(DEFENSE_WORDS, 'defense');
  if (!hits.length) return null;
  const down = hits.find((h) => h.dir === 'down');
  const positive = hits.find((h) => h.dir !== 'down');
  if (down && positive) return null;
  return hits.find((h) => h.dir === 'defense') ?? hits[0];
}

/** 그 값의 움직임 — 지수 · 그 밖은 등락률(%), 금리는 절대 변화(%p) */
const moveOf = (kind: Kind, a: BriefAsset) => (kind === 'rate' ? a.change : a.change_pct);

/** 방향 말과 숫자가 어긋나나 — 보합이면 false(검사하지 않음) */
function contradicts(kind: Kind, dir: Dir, move: number): boolean {
  const flat = kind === 'rate' ? FLAT_RATE_PP : FLAT_PCT;
  if (Math.abs(move) < flat) return false;
  if (dir === 'defense') return kind === 'index' && move < DEFENSE_PCT;
  return dir === 'up' ? move < 0 : move > 0;
}

export interface CheckInput {
  edition: BriefEdition;
  assets: Partial<Record<BriefAssetKey, BriefAsset>>;
  /** 시장 데이터를 받은 시각(ms) — 장중 표시 */
  at: number;
}

/** 숫자 글 — 「코스피 −5.53%(장중)」 · 「10년 +0.120%p」 */
function actualText(key: BriefAssetKey, kind: Kind, a: BriefAsset, at: number): string {
  const v = kind === 'rate' ? signed(a.change, 3, '%p') : signed(a.change_pct, 2, '%');
  const live = a.data_date && isIntradayBar(key, a.data_date, at) ? '(장중)' : '';
  return `${ASSET_LABEL[key] ?? key} ${v}${live}`;
}

/** 글 하나 검사 — 어긋난 시장마다 한 건 */
export function checkText(field: string, text: string, input: CheckInput): BriefMismatch[] {
  const out: BriefMismatch[] = [];
  const plain = text.replace(/\([^)]*\)|（[^）]*）/g, ' '); // 괄호 안은 풀이 · 덧말 — 보지 않는다
  for (const clause of plain.split(CLAUSE_SPLIT)) {
    if (!clause?.trim()) continue;
    const markets = findMarkets(clause);
    const policy = POLICY_RATE.test(clause);
    for (let i = 0; i < markets.length; i++) {
      const { term } = markets[i];
      if (term.kind === 'rate' && (policy || OTHER_RATE.test(clause))) continue;
      if (term.keys.includes('USDKRW') && OTHER_FX.test(clause)) continue;
      if (NOT_INDEX_AFTER.test(clause.slice(markets[i].end))) continue;
      // 이 시장 이름 뒤 ~ 다음 시장 이름 전. 비어 있으면(「코스피와 코스닥 모두 하락」) 다음 토막의 방향을 함께 쓴다
      let segEnd = i + 1 < markets.length ? markets[i + 1].start : clause.length;
      let said = directionOf(clause.slice(markets[i].end, segEnd));
      for (let j = i + 1; !said && j < markets.length && /^[\s와과및·,도]*$/.test(clause.slice(markets[j - 1].end, markets[j].start)); j++) {
        segEnd = j + 1 < markets.length ? markets[j + 1].start : clause.length;
        said = directionOf(clause.slice(markets[j].end, segEnd));
      }
      if (!said) continue;
      // 채권은 「강세 · 약세 · 가격」 이 값(가격) 방향이라 수익률과 반대 — 금리 시장은 「금리 · 수익률 + 상승 · 하락」 만 본다
      if (term.kind === 'rate' && (/강세|약세/.test(said.word) || /가격/.test(clause))) continue;
      const values = term.keys.map((k) => [k, input.assets[k]] as const).filter((e): e is readonly [BriefAssetKey, BriefAsset] => Boolean(e[1]));
      if (!values.length) continue;
      // 여러 지수를 묶은 이름(국내 증시 · 미국 증시)은 받은 값 모두가 어긋날 때만
      if (!values.every(([, a]) => contradicts(term.kind, said.dir, moveOf(term.kind, a)))) continue;
      if (out.some((m) => m.market === term.name)) continue;
      out.push({ field, market: term.name, said: said.word, actual: values.map(([k, a]) => actualText(k, term.kind, a, input.at)).join(' · ') });
    }
  }
  return out;
}

/** 기조 라벨 — Risk-On 인데 S&P500 · 나스닥이 둘 다 −1% 보다 나쁨 / Risk-Off 인데 둘 다 +1% 보다 좋음 (오전판만) */
function checkRegime(label: BriefAi['market_regime'], input: CheckInput): BriefMismatch[] {
  if (label !== 'Risk-On' && label !== 'Risk-Off') return [];
  const keys: BriefAssetKey[] = ['SP500', 'NASDAQ'];
  const values = keys.map((k) => [k, input.assets[k]] as const).filter((e): e is readonly [BriefAssetKey, BriefAsset] => Boolean(e[1]));
  if (values.length < keys.length) return [];
  const bad = values.every(([, a]) => (label === 'Risk-On' ? a.change_pct <= -REGIME_PCT : a.change_pct >= REGIME_PCT));
  return bad ? [{ field: 'market_regime', market: '미국 증시', said: label, actual: values.map(([k, a]) => actualText(k, 'index', a, input.at)).join(' · ') }] : [];
}

/** 브리핑 하나 — 보는 글 전부. 돌려주는 순서 = 화면 칸 순서 */
export function checkDirections(brief: BriefAi, input: CheckInput): BriefMismatch[] {
  const out: BriefMismatch[] = [];
  if (input.edition === 'morning') {
    out.push(...checkRegime(brief.market_regime, input));
    if (brief.regime_summary) out.push(...checkText('regime_summary', brief.regime_summary, input));
  } else if (brief.market_summary) {
    out.push(...checkText('market_summary', brief.market_summary, input));
  }
  brief.leading_sectors.forEach((s, i) => s.reason && out.push(...checkText(`leading_sectors.${i}.reason`, s.reason, input)));
  brief.key_themes.forEach((t, i) => t.why_important && out.push(...checkText(`key_themes.${i}.why_important`, t.why_important, input)));
  if (brief.swing_check.phase) out.push(...checkText('swing_check.phase', brief.swing_check.phase, input));
  // 「오늘 예상 방향」 근거(v2.60.0) — 입력 숫자와 반대 표현이면 같은 표시(예상 말 「~ 전망 · 예상」 이 붙은 방향은 HEDGE 로 검사 안 함)
  (brief.today_outlook ?? []).forEach((o, i) => o.reasons.forEach((r, j) => out.push(...checkText(`today_outlook.${i}.reasons.${j}`, r, input))));
  return out;
}
