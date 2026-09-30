/**
 * 급등 "다음 예상일" 표시 (v2.19.0) — 카드·검색 평가·탐지 이력이 함께 쓴다.
 *
 * 예상일 = 마지막 급등일 + 평균 간격이라, 그 뒤로 오래 급등이 없으면 **이미 지난 날짜**가 된다.
 * ⚠️ 지난 날짜를 평균 간격만큼 앞으로 밀어 새 예상일을 만들지 않는다 — 근거 없는 새 예측이다
 * (주기 예측은 진단에서 우연 수준이었다). 사실대로 "경과" 로 보여 준다.
 *
 * - 남음(≥0): `2026-10-12 (D−12)` · 오늘이면 `(오늘)`
 * - 1~3일 지남: `예상일 2026-09-27 지남 (2일 경과)` — 점수의 ±3일 근접 규칙(nearCycleDate)과 같은 폭
 * - 4일 이상 지남: 날짜를 흐리게 + `예상일 지남 (N일 경과) — 주기가 깨졌을 수 있음`
 *
 * `atDetection` 이면 기준이 오늘이 아니라 **탐지 당시**다(탐지 이력) — 문구에 그 사실을 붙인다.
 */

/** ±3일 근접 규칙과 같은 폭 — 판정(`surgeDetector` 의 nearCycleDate)을 바꾸지 않는다 */
export const RECENT_OVERDUE_DAYS = 3;

export default function NextSurgeDate({
  date,
  daysUntil,
  overdueDays,
  atDetection = false,
}: {
  date: string | null;
  daysUntil: number | null;
  overdueDays: number | null;
  atDetection?: boolean;
}) {
  if (!date || daysUntil == null) return <span className="text-text-muted">예상일 없음</span>;
  const prefix = atDetection ? '탐지 시점에 이미 ' : '';
  if (overdueDays == null) {
    return (
      <span>
        {date}{' '}
        <span className="text-text-muted">
          ({atDetection && '탐지 시 '}
          {daysUntil === 0 ? '오늘' : `D−${daysUntil}`})
        </span>
      </span>
    );
  }
  if (overdueDays <= RECENT_OVERDUE_DAYS) {
    return (
      <span className="text-warning">
        {atDetection ? `${prefix}지남` : `예상일 ${date} 지남`} ({overdueDays}일 경과)
        {atDetection && <span className="ml-1 text-text-muted">{date}</span>}
      </span>
    );
  }
  return (
    <span className="text-text-muted" title="마지막 급등 뒤로 평균 간격보다 오래 급등이 없었습니다">
      <span className="line-through opacity-60">{date}</span>{' '}
      {prefix}예상일 지남 ({overdueDays}일 경과) — 주기가 깨졌을 수 있음
    </span>
  );
}
