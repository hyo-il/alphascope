/**
 * 미국 매수 판단 다시 계산 결과 글 — `npm run recheck:report` 와 시험(`recheck:test`)이 같이 쓴다.
 * 입력은 `buy_judgment_rechecks` 줄 · `buy_judgment_recheck_days` 줄 그대로(`server/buyJudge/recheck.ts`).
 */
import { VERDICT_LABEL, verdictOf } from '../../src/types/buyJudge';
import type { RecheckDay, RecheckRow } from '../../server/buyJudge/recheck';

type Breakdown = { key: string; score: number; max: number }[];
const parse = <T>(s: string | null): T | null => {
  if (s == null) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
};
const volumeScore = (b: Breakdown | null) => b?.find((c) => c.key === 'volume') ?? null;
const label = (code: string | null) => (code == null ? '—' : VERDICT_LABEL[verdictOf(code)]);
const sign = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '0');

/** 달라진 종류 — 판단(action) · 판단 코드(같은 action 안) · 점수만(총점 또는 조건 점수 · 거름망 이유) */
export type ChangeKind = 'action' | 'code' | 'score';
export function changeKind(r: RecheckRow): ChangeKind {
  if (r.before_action !== r.after_action) return 'action';
  if (r.before_code !== r.after_code) return 'code';
  return 'score';
}

/** 거래량 변화 % — 16:30 값을 알 때만(모르면 null) */
export function volumeChangePct(r: RecheckRow): number | null {
  const a = parse<{ volume: number }>(r.bar_before_json);
  const b = parse<{ volume: number }>(r.bar_after_json);
  if (!a || !b || !(a.volume > 0)) return null;
  return Math.round(((b.volume - a.volume) / a.volume) * 1000) / 10;
}

export function renderRecheckReport(rows: RecheckRow[], days: RecheckDay[]): string {
  if (!days.length) return '다시 계산 기록이 없습니다(20:45 ET 뒤 첫 계산 전이거나 스위치 BUYJUDGE_RECHECK_ENABLED=false).';
  const judged = rows.filter((r) => r.source === 'judgment');
  const accounts = rows.filter((r) => r.source === 'account');
  const sum = (k: 'checked' | 'same' | 'changed' | 'accounts' | 'failed' | 'symbols') => days.reduce((a, d) => a + d[k], 0);
  const kinds = { action: 0, code: 0, score: 0 };
  for (const r of judged) kinds[changeKind(r)]++;
  const actionDays = new Set(judged.filter((r) => changeKind(r) === 'action').map((r) => r.market_date));
  const out: string[] = [];
  out.push(`미국 매수 판단 다시 계산 — ${days[0].market_date} ~ ${days.at(-1)!.market_date} (${days.length}일)`);
  out.push(`다시 계산 ${sum('checked')}건 · 달라짐 ${sum('changed')}건(action 바뀜 ${kinds.action} · code 바뀜 ${kinds.code} · 점수만 바뀜 ${kinds.score}) · 같음 ${sum('same')}건`);
  out.push(`계좌 쌍 ${sum('accounts')}건(16:30 값 없음 — 최종값만) · 최종 일봉을 받지 못함 · 판단 못 함 ${sum('failed')}건 · 일봉 받은 종목 ${sum('symbols')}번`);
  out.push('');
  out.push('날짜별: ' + days.map((d) => `${d.market_date} ${d.changed}/${d.checked}${d.failed ? `(못 함 ${d.failed})` : ''}`).join(' · '));
  if (judged.length) {
    out.push('');
    out.push('달라진 줄 — 날짜 | 종목 | 규칙 | 16:30 → 최종 판단 | 총점 | 거래량 그룹 점수 | 거래량 변화');
    for (const r of judged) {
      const vb = volumeScore(parse<Breakdown>(r.before_breakdown_json));
      const va = volumeScore(parse<Breakdown>(r.after_breakdown_json));
      const vol = volumeChangePct(r);
      const verdict = r.before_code === r.after_code ? label(r.after_code) : `${label(r.before_code)} → ${label(r.after_code)}`;
      const score = r.before_score === r.after_score ? `${r.after_score}` : `${r.before_score} → ${r.after_score} (${sign(r.after_score - (r.before_score ?? 0))})`;
      const volScore = vb && va ? (vb.score === va.score ? `${va.score}/${va.max}` : `${vb.score} → ${va.score}/${va.max}`) : '—';
      out.push(`${r.market_date} | ${r.symbol} | #${r.rule_id} | ${verdict} | ${score} | ${volScore} | ${vol == null ? '모름' : `${vol > 0 ? '+' : vol < 0 ? '−' : ''}${Math.abs(vol).toFixed(1)}%`}`);
    }
  }
  if (accounts.length) {
    const buys = accounts.filter((r) => r.after_code === 'score_buy').length;
    out.push('');
    out.push(`계좌 쌍(최종값 판단만 — 계좌는 다음 정규장 시작에 같은 값으로 판단한다): ${accounts.length}건 가운데 「사도 됨」 ${buys}건`);
  }
  out.push('');
  out.push(
    actionDays.size
      ? `한 줄 결론: 판단(사도 됨 ↔ 사지 않음)이 바뀐 날 ${actionDays.size}번(${kinds.action}건) — 판단 시각(16:30 ET)을 옮길지 검토 필요`
      : sum('changed')
        ? `한 줄 결론: 판단(사도 됨 ↔ 사지 않음)이 바뀐 날 없음 — 점수 · 판단 코드만 ${sum('changed')}건 달라짐`
        : '한 줄 결론: 16:30 판단과 최종값 판단이 모두 같음',
  );
  return out.join('\n');
}
