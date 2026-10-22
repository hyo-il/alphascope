/**
 * 미국 거래정지 (실험실) — 화면 · 서버 · 시험이 같이 쓰는 판단 **한 곳**.
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
