/**
 * 화면 날짜 표기 (v2.42.3 — 기준표 「날짜 표기」, 사용자 결정 2026-10-13) — **한 곳**.
 * - 날짜+시각 `2026-10-08 14:30` · 날짜만 `2026-10-08` · 시각만 `14:30` (24시간, 초 없음).
 * - 시간대는 **브라우저 시간**(예전 `toLocaleString('ko-KR')` 과 같다). 봉 날짜처럼 시장 시간대로 정해야 하는 곳은 `marketDate()` 그대로.
 * ⚠️ 화면 전용 — 서버 문장·프롬프트·md 보고서·CSV 등 텍스트로 나가는 값에는 쓰지 않는다.
 * 예전에는 `toLocaleString('ko-KR')`(「2026. 9. 3. 오후 10:42:47」) · `toLocaleTimeString` · 문자열 자르기가 화면마다 섞여 있었다.
 */
type DateInput = Date | string | number | null | undefined;

function toDate(v: DateInput): Date | null {
  if (v == null || v === '') return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
const pad = (n: number) => String(n).padStart(2, '0');

/** `2026-10-08` (브라우저 시간) — 값이 없으면 '—' */
export function formatDate(v: DateInput): string {
  const d = toDate(v);
  return d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : '—';
}
/** `14:30` (24시간, 초 없음) */
export function formatTime(v: DateInput): string {
  const d = toDate(v);
  return d ? `${pad(d.getHours())}:${pad(d.getMinutes())}` : '—';
}
/** `2026-10-08 14:30` */
export function formatDateTime(v: DateInput): string {
  const d = toDate(v);
  return d ? `${formatDate(d)} ${formatTime(d)}` : '—';
}
