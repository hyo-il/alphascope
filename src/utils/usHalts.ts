/**
 * 거래정지 (실험실) — 화면 · 서버 · 시험이 같이 쓰는 판단 **한 곳**.
 *
 * LULD 규칙(NYSE · Nasdaq LULD Plan Amendment 12 안내): 처음 5분 → 재개 경매가 안 되면 5분 더(합계 10분) →
 * 그 뒤에는 조건이 맞으면 언제든 재개(시각이 정해지지 않음). 풀린 뒤 다시 멈추면 새 정지(다시 5분).
 * 재개 칸은 **풀린 뒤에야** 채워진다(62차 조사) — 그래서 「예상 재개」 는 규칙으로 계산한 값이다.
 */

/** LULD(가격 제한 범위 이탈) 정지 코드 — Nasdaq 상장 LUDP · LUDS, 다른 거래소 상장 M */
export const LULD_CODES = ['LUDP', 'LUDS', 'M'] as const;
export const isLuldCode = (code: string): boolean => (LULD_CODES as readonly string[]).includes(code);

export const LULD_FIRST_MS = 5 * 60_000;
export const LULD_EXTENDED_MS = 10 * 60_000;

/**
 * 예상 재개 — `now` 는 서버 시각 기준(화면은 서버 시각 차를 더해 1초마다 다시 부른다).
 * - resumed: 재개 시각이 채워졌고 지났다(오늘 표에서는 그 정지가 보이지 않는다 — 지금 멈춘 것만)
 * - announced: 재개 시각이 채워졌지만 아직 오지 않았다(뉴스 정지 T3 처럼 미리 공지된 시각)
 * - first: LULD · 정지 + 5분 전 → 정지 + 5분
 * - extended: LULD · 정지 + 5분 ~ 10분 → 정지 + 10분(연장)
 * - open: LULD · 정지 + 10분 이상 → 시각 정해지지 않음
 * - none: LULD 가 아니고 재개 시각도 없음 → 정해진 시각 없음
 */
export type ExpectedResume =
  | { kind: 'resumed'; at: number }
  | { kind: 'announced'; at: number }
  | { kind: 'first'; at: number }
  | { kind: 'extended'; at: number }
  | { kind: 'open' }
  | { kind: 'none' };

/**
 * 「안 풀림」 — **이 함수 한 곳**(화면 「정지 중」 · 서버 「며칠째 정지 중」 · 20:00 ET 뒤 이어 받기가 같이 쓴다).
 * 재개 칸(ResumptionTradeTime)이 비었거나, 공지된 재개 시각이 아직 오지 않았으면 안 풀림.
 */
export const isHaltOngoing = (halt: { resumeAtMs: number | null }, now: number): boolean =>
  halt.resumeAtMs == null || halt.resumeAtMs > now;

/** 며칠째 — 미국 날짜(YYYY-MM-DD)로 센다. 정지한 날 = 1일째, 주말 · 휴장일도 센다 */
export function haltDayCount(haltDay: string, today: string): number {
  return Math.round((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${haltDay}T12:00:00Z`)) / 86_400_000) + 1;
}

export function expectedResume(
  halt: { rawReasonCode: string; haltAtMs: number; resumeAtMs: number | null },
  now: number,
): ExpectedResume {
  if (!isHaltOngoing(halt, now)) return { kind: 'resumed', at: halt.resumeAtMs! };
  if (halt.resumeAtMs != null) return { kind: 'announced', at: halt.resumeAtMs };
  if (!isLuldCode(halt.rawReasonCode)) return { kind: 'none' };
  const elapsed = now - halt.haltAtMs;
  if (elapsed < LULD_FIRST_MS) return { kind: 'first', at: halt.haltAtMs + LULD_FIRST_MS };
  if (elapsed < LULD_EXTENDED_MS) return { kind: 'extended', at: halt.haltAtMs + LULD_EXTENDED_MS };
  return { kind: 'open' };
}

/** 원문 날짜 `MM/DD/YYYY` → `YYYY-MM-DD`. 모양이 다르면 null */
export function isoDayOfRaw(raw: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw.trim());
  return m ? `${m[3]}-${m[1]}-${m[2]}` : null;
}

/** 원문 시각 `HH:MM:SS` · `HH:MM:SS.mmm` → 그날 자정부터 ms. 모양이 다르면 null */
export function msOfRawTime(raw: string): number | null {
  const m = /^(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/.exec(raw.trim());
  if (!m) return null;
  const [h, min, s] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (h > 23 || min > 59 || s > 59) return null;
  return ((h * 60 + min) * 60 + s) * 1000 + (m[4] ? Number(m[4].padEnd(3, '0')) : 0);
}

/**
 * 같은 종목 묶기 — 화면의 오늘 표 · 「며칠째 정지 중」 칸이 같이 쓴다(그 칸 안의 줄끼리만 묶는다).
 * 줄의 기준 = **가장 최근 정지**(`latest`) · `earlier` = 그 앞의 정지(오래된 것부터 — 화면에 시각을 보이지 않고 거래대금 최대값에만 쓴다).
 * 묶음은 가장 최근 정지 시각 내림차순. 오늘 표는 이 가운데 `latest` 가 안 풀린(`isHaltOngoing`) 묶음만 보인다.
 * 풀렸다 다시 멈춘 것은 Nasdaq 이 따로 적은 새 정지다 — 저장 · 「안 풀림」 · 예상 재개(`expectedResume`)는 정지 한 건씩 그대로.
 */
export interface HaltGroup<T> {
  latest: T;
  earlier: T[];
}
export function groupHalts<T extends { rawIssueSymbol: string; haltAtMs: number; id: number }>(rows: T[]): HaltGroup<T>[] {
  const bySymbol = new Map<string, T[]>();
  for (const r of rows) {
    const key = r.rawIssueSymbol.trim();
    bySymbol.set(key, [...(bySymbol.get(key) ?? []), r]);
  }
  return [...bySymbol.values()]
    .map((list) => {
      const sorted = [...list].sort((a, b) => a.haltAtMs - b.haltAtMs || a.id - b.id);
      return { latest: sorted.at(-1)!, earlier: sorted.slice(0, -1) };
    })
    .sort((a, b) => b.latest.haltAtMs - a.latest.haltAtMs || b.latest.id - a.latest.id);
}

/**
 * 「며칠째 정지 중」 칸의 줄 — **보기와 상관없이 모든 장기 정지**(관심 · 보유만이 아님 · 정규장 밖에도). 이 함수 한 곳(화면 · 시험).
 * - 지난 날 정지(서버 `listOngoingBefore`) 가운데 안 풀린 것 + 「상태 모름」(`unlisted` — 풀렸는지 몰라 시각으로 지우지 않는다). 매초 다시 거른다.
 * - 정규장 밖에는 오늘 정지 가운데 안 풀림 · **LULD 아님**도 「1일째」 로 넣는다(「지금 정지 중」 이 꺼져 미국 자정까지 어디에도 안 보였다).
 *   LULD 는 넣지 않는다 — 마감 직전에 멈춰 재개가 안 적힌 채 「정지 중」 으로 남는 바로 그 경우(정규장에만 보이게 한 이유).
 * 줄을 먼저 거른 뒤 묶는다(묶은 뒤 거르면 같은 종목의 다른 줄의 공지 시각이 지날 때 상태 모름 줄까지 사라졌다가 다음 읽기에 다시 나타났다).
 */
export function longHaltRows<T extends { rawReasonCode: string; resumeAtMs: number | null }, O extends T & { daysHalted: number; unlisted: boolean }>(
  ongoing: O[],
  today: T[],
  regularOpen: boolean,
  now: number,
): (O | (T & { daysHalted: number; unlisted: boolean }))[] {
  const todayRows = regularOpen ? [] : today.filter((h) => !isLuldCode(h.rawReasonCode.trim()) && isHaltOngoing(h, now)).map((h) => ({ ...h, daysHalted: 1, unlisted: false }));
  return [...ongoing.filter((h) => h.unlisted || isHaltOngoing(h, now)), ...todayRows];
}

/**
 * 묶음의 거래대금 — 그 묶음 정지들의 정지 전 5분 거래대금 가운데 **가장 큰 값**(이 함수 한 곳 — 표시 · 숨기기가 같은 숫자를 쓴다).
 * 풀린 지 몇십 초 만에 다시 멈춘 정지는 앞 5분 대부분이 앞선 정지 시간이라 0 에 가깝다 — 가장 최근 값만 쓰면 가장 활발한 종목이 숨었다.
 * - usd: 아는 값 가운데 최대(0 이면 「거래 없음」) · 모두 모르면 null
 * - partial: 아는 값이 있는데 모르는 정지(null · 아직)도 있다 → 화면 정보 아이콘
 * - checking: 아직 내지 않은 정지가 하나라도 있다(방금 다시 멈춤 등) — 아는 값이 없으면 화면 「확인 중」, 숨기기는 하지 않는다
 */
export interface GroupTurnover {
  usd: number | null;
  partial: boolean;
  checking: boolean;
}
export function groupTurnover(halts: { turnover5mUsd: number | null; turnoverPending: boolean }[]): GroupTurnover {
  const known = halts.map((h) => h.turnover5mUsd).filter((v): v is number => v != null);
  const usd = known.length ? Math.max(...known) : null;
  return { usd, partial: usd != null && known.length < halts.length, checking: halts.some((h) => h.turnoverPending) };
}

/**
 * 「거래대금 $N 미만 숨기기」 — 이 함수 한 곳. 묶음 거래대금(`groupTurnover` 의 최대값)이 기준보다 작으면 숨긴다.
 * 숨기지 않는 것: 기준 없음(null) · 관심 · 보유 종목(`mine`) · 거래대금 모름(null) · **아직 확인 중인 정지가 있는 묶음**
 * (방금 다시 멈춘 정지의 값이 기준을 넘을 수 있다 — 앞선 값만으로 숨기면 「다시 정지」 토스트만 뜨고 줄이 안 보였다).
 */
export const isHiddenByTurnover = (t: GroupTurnover, minTurnoverUsd: number | null, mine: boolean): boolean =>
  minTurnoverUsd != null && !mine && !t.checking && t.usd != null && t.usd < minTurnoverUsd;

/**
 * 보기 「전체 · 상위 · 급상승 · 급하락」 — 「지금 정지 중」 표만 거른다(「며칠째 정지 중」 칸은 보기와 상관없이 모든 장기 정지).
 * - 「전체」(all): 지금 멈춘 종목 **전부** — 순위로 거르지 않고 순위를 부르지 않는다(토스 호출 0 · 순위 칸 없음).
 * - 「상위」(top) · 「급상승」(gainers) · 「급하락」(losers): 토스 오늘 상승률 · 하락률 순위(`GET /api/rankings/live?market=us&kind=gainers|losers`,
 *   실시간 순위 화면과 같은 API · 30초 캐시) 상위 N 안에 든 종목만 남긴다. 「상위」 = 상승률 상위 N ∪ 하락률 상위 N.
 *   **관심 · 보유 종목은 순위와 상관없이 늘 남긴다**(`keep`). 순서 = 이 거르기 → 거래대금 숨기기(`isHiddenByTurnover`).
 */
export type HaltRankView = 'all' | 'top' | 'gainers' | 'losers';
export type HaltRankSide = 'gainers' | 'losers';
export const HALT_RANK_VIEWS: readonly HaltRankView[] = ['all', 'top', 'gainers', 'losers'];
export const DEFAULT_HALT_RANK_VIEW: HaltRankView = 'top';
/** 보기가 읽는 순위 — 「전체」 는 없음(부르지 않는다) · 「상위」 는 둘 다 */
export const rankSidesOf = (view: HaltRankView): HaltRankSide[] => (view === 'all' ? [] : view === 'top' ? ['gainers', 'losers'] : [view]);
/** 상위 N — 토스 순위가 100개까지라 100 이 최대 */
export const HALT_RANK_TOPS = [10, 20, 50, 100] as const;
export type HaltRankTop = (typeof HALT_RANK_TOPS)[number];
export const DEFAULT_HALT_RANK_TOP: HaltRankTop = 10;

export interface HaltRankHit {
  side: HaltRankSide;
  rank: number;
  /** 등락률(%) — 서버가 토스 소수를 ×100 해 준다(`fetchRanking`). 모르면 null */
  changeRate: number | null;
}

/** 종목 맞추기 — 앞뒤 공백 · 대소문자를 무시한다(Nasdaq 원문 티커 · 토스 티커) */
const rankKey = (symbol: string) => symbol.trim().toUpperCase();

/** 순위 `rank` 1~N 인 종목 → 순위 · 등락률. 여러 순위를 넘기면 합친다(앞 순위가 먼저 — 같은 종목이 둘에 있으면 앞 것) */
export function rankHits(lists: { side: HaltRankSide; rows: { rank: number; symbol: string; changeRate: number | null }[] }[], top: number): Map<string, HaltRankHit> {
  const hits = new Map<string, HaltRankHit>();
  for (const { side, rows } of lists)
    for (const r of rows) if (r.rank >= 1 && r.rank <= top && !hits.has(rankKey(r.symbol))) hits.set(rankKey(r.symbol), { side, rank: r.rank, changeRate: r.changeRate });
  return hits;
}

/**
 * 기억된 보기 읽기 — 새 키(`next`)가 있으면 그것, 없으면 옛 키(`legacy`, v2.57.2 까지)를 옮겨 읽는다.
 * 옛 「all」 은 합친 상위(지금의 「상위」)였다 → 'top'. 옛 키의 급상승 · 급하락 · 상위 N 은 그대로. 모양이 틀리면 기본값.
 */
export function readSavedHaltView(next: unknown, legacy: unknown): { view: HaltRankView; top: HaltRankTop } {
  const pick = (raw: unknown, fromLegacy: boolean) => {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as { view?: unknown; top?: unknown };
    const view = fromLegacy && r.view === 'all' ? 'top' : HALT_RANK_VIEWS.find((v) => v === r.view);
    return { view: view ?? DEFAULT_HALT_RANK_VIEW, top: HALT_RANK_TOPS.find((n) => n === r.top) ?? DEFAULT_HALT_RANK_TOP };
  };
  return pick(next, false) ?? pick(legacy, true) ?? { view: DEFAULT_HALT_RANK_VIEW, top: DEFAULT_HALT_RANK_TOP };
}

export const rankHitOf = (hits: Map<string, HaltRankHit>, symbol: string): HaltRankHit | null => hits.get(rankKey(symbol)) ?? null;

/** 묶음 거르기 — 순위 안이거나 `keep`(관심 · 보유)이면 남긴다 */
export const filterGroupsByRank = <T extends { rawIssueSymbol: string }>(groups: HaltGroup<T>[], hits: Map<string, HaltRankHit>, keep: (row: T) => boolean): HaltGroup<T>[] =>
  groups.filter((g) => hits.has(rankKey(g.latest.rawIssueSymbol)) || keep(g.latest));
