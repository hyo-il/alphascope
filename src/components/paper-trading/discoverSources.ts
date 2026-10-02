import type { SwingRecommendation, SwingRecord } from '../../types/swing';
import type { ProfileId } from '../../types/strategyProfile';

/**
 * 자동매매 대상 종목 **소스** — 발굴 팝업(`DiscoverSymbolsModal`)과 설정 창의 빠른 버튼(v2.32.0)이 **같은 함수**를 쓴다.
 *
 * ⚠️ 판정 로직이 아니다. 스윙 추천의 기존 엔드포인트가 준 점수·등급을 **기준으로 거르기만** 한다.
 * 거르는 코드를 두 벌 두면 같은 종목이 버튼과 팝업에서 다르게 담긴다.
 */

export interface DiscoverRow {
  symbol: string;
  score: number | null;
  grade: string | null;
  /** 화면에 그대로 적는 근거 — 계산하지 않고 서버가 준 값을 옮긴다 */
  reasons: string[];
  /** 기준을 통과했는지. 떨어진 것도 목록에 남긴다 — 왜 0건인지 보여 주기 위해서다 */
  passed?: boolean;
  /** 떨어진 이유 (점수 미달 / 등급 제외) */
  fail?: 'score' | 'grade';
}

/** 필터 결과 집계 — "0종목" 의 이유를 숫자로 말하기 위한 것 */
export interface FilterStats {
  total: number;
  passed: number;
  failScore: number;
  failGrade: number;
  /** 등급별 건수 (많은 순으로 적는다) */
  gradeDist: [string, number][];
}

/** 스윙 소스의 기본 기준 — 최소 점수는 지금 프로파일의 BUY 컷이라 따로 받는다 */
export const DEFAULT_SWING_GRADES = ['STRONG', 'BUY'];
export const DEFAULT_SWING_LIMIT = 10;

/**
 * 기준으로 거르고 **떨어진 이유까지 표시**한다.
 *
 * ⚠️ 점수·등급은 서버가 준 값 그대로다. 여기서 다시 계산하지 않는다.
 * 점수를 먼저 보고, 점수를 넘긴 것만 등급을 본다 — 그래야 "점수 미달 0 · 등급 제외 7" 처럼
 * 사유가 한쪽으로 모여 읽힌다 (둘 다 걸린 것을 양쪽에 세면 합이 전체보다 커진다).
 */
export function applyCriteria(
  rows: DiscoverRow[],
  minScore: number,
  grades: string[],
): { rows: DiscoverRow[]; stats: FilterStats } {
  const dist = new Map<string, number>();
  let failScore = 0;
  let failGrade = 0;

  const marked = rows.map((row) => {
    if (row.grade) dist.set(row.grade, (dist.get(row.grade) ?? 0) + 1);
    if ((row.score ?? 0) < minScore) {
      failScore += 1;
      return { ...row, passed: false, fail: 'score' as const };
    }
    if (row.grade && !grades.includes(row.grade)) {
      failGrade += 1;
      return { ...row, passed: false, fail: 'grade' as const };
    }
    return { ...row, passed: true };
  });

  return {
    rows: marked,
    stats: {
      total: rows.length,
      passed: marked.filter((r) => r.passed).length,
      failScore,
      failGrade,
      gradeDist: [...dist.entries()].sort((a, b) => b[1] - a[1]),
    },
  };
}

/** 기준 통과분만 최대 개수로 자르고, 떨어진 것은 뒤에 붙인다 (팝업 목록과 버튼이 같은 순서) */
export function splitByLimit(marked: DiscoverRow[], limit: number): { passed: DiscoverRow[]; rejected: DiscoverRow[] } {
  return {
    passed: marked.filter((r) => r.passed).slice(0, limit),
    rejected: marked.filter((r) => !r.passed),
  };
}

const num = (v: number | null | undefined, digits = 0) =>
  v == null || !Number.isFinite(v) ? '—' : v.toFixed(digits);

export function swingRowFromRecord(r: SwingRecord): DiscoverRow {
  const reasons = [
    `진입 ${r.entryType ?? '—'} $${num(r.entryPrice, 2)} · 손절 $${num(r.stopLossPrice, 2)}`,
    `손익비 ${num(r.riskRewardRatio, 2)} · 권장 비중 ${num(r.recommendedPercent, 1)}%`,
  ];
  if (r.entryReason) reasons.push(r.entryReason);
  return { symbol: r.symbol, score: r.score, grade: r.grade, reasons };
}

export function swingRowFromRecommendation(r: SwingRecommendation): DiscoverRow {
  const reasons = [
    `진입 ${r.entry.type} $${num(r.entry.price, 2)} · 손절 $${num(r.stopLoss.price, 2)}`,
    `손익비 ${num(r.conditions.riskReward.ratio, 2)} · 권장 비중 ${num(r.position.recommendedPercent, 1)}%`,
    r.entry.reason,
  ];
  if (r.rejection) reasons.push(`제외 사유: ${r.rejection}`);
  if (r.warnings.length) reasons.push(`⚠️ ${r.warnings[0]}`);
  return { symbol: r.symbol, score: r.score, grade: r.grade, reasons };
}

/** 스윙 화면에서 마지막으로 저장된 추천 — 점수 높은 순 */
export async function loadSavedSwing(): Promise<{
  rows: DiscoverRow[];
  profile: ProfileId | null;
  analyzedAt: string | null;
}> {
  const res = await fetch('/api/swing/recommendations');
  const data = (await res.json().catch(() => ({}))) as {
    records?: SwingRecord[];
    analyzedAt?: string | null;
    error?: string;
  };
  if (!res.ok) throw new Error(data.error ?? `조회 실패 (${res.status})`);
  const all = data.records ?? [];
  return {
    rows: [...all].sort((a, b) => b.score - a.score).map(swingRowFromRecord),
    profile: (all[0]?.profile as ProfileId | undefined) ?? null,
    analyzedAt: data.analyzedAt ?? null,
  };
}

/**
 * [📈 스윙 추천 담기] — 발굴 팝업의 「스윙 추천」 을 **기본 기준 그대로**(BUY 컷 · STRONG/BUY · 10개, [다시 분석] 끔) 적용한 결과.
 * 저장된 추천이 없으면 `empty: true`.
 */
export async function savedSwingPicks(buyCut: number): Promise<{
  symbols: string[];
  empty: boolean;
  profile: ProfileId | null;
  stats: FilterStats;
}> {
  const saved = await loadSavedSwing();
  const { rows, stats } = applyCriteria(saved.rows, buyCut, DEFAULT_SWING_GRADES);
  const { passed } = splitByLimit(rows, DEFAULT_SWING_LIMIT);
  return { symbols: passed.map((r) => r.symbol), empty: saved.rows.length === 0, profile: saved.profile, stats };
}
