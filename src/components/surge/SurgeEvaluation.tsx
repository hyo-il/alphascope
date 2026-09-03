import type { SurgeEvaluation as Evaluation } from '../../types/surge';
import SymbolLabel from '../common/SymbolLabel';
import SurgeMiniChart from './SurgeMiniChart';
import { daysLabel, GRADE_STYLE } from './gradeStyle';

/** 검색한 종목의 급등 가능성 평가 상세 */
export default function SurgeEvaluation({
  evaluation,
  watched,
  onSelectSymbol,
  onWatch,
  onAnalyze,
}: {
  evaluation: Evaluation;
  watched: boolean;
  onSelectSymbol: (symbol: string) => void;
  onWatch: (symbol: string) => void;
  onAnalyze: (symbol: string) => void;
}) {
  const grade = GRADE_STYLE[evaluation.grade];
  const p = evaluation.periodicity;

  return (
    <article className={`rounded-lg border bg-bg-secondary p-4 ${grade.className}`}>
      <header className="flex flex-wrap items-baseline gap-2">
        <SymbolLabel symbol={evaluation.symbol} name={evaluation.name} className="text-base" />
        <span className="ml-auto text-sm font-semibold">
          급등 가능성 {evaluation.surgeScore}/100 ({evaluation.grade} {grade.icon})
        </span>
      </header>

      {evaluation.error && (
        <p className="mt-2 rounded border border-warning/40 bg-warning/10 px-2 py-1 text-[11px] text-warning">
          {evaluation.error}
        </p>
      )}

      <section className="mt-3">
        <h4 className="text-xs font-semibold text-text-secondary">📊 과거 급등 분석</h4>
        <dl className="mt-1.5 space-y-1 text-[11px] text-text-secondary">
          <Row label="분석 구간 급등 횟수" value={`${p.surgeCount}회 (일봉 ${evaluation.candleCount}개)`} />
          <Row label="평균 급등 간격" value={p.avgInterval ? `${p.avgInterval}일` : '—'} />
          <Row
            label="간격 규칙성"
            value={`${p.regularity}% ${p.isPeriodic ? '(주기적)' : '(불규칙)'}`}
          />
          <Row label="평균 급등 폭" value={p.avgSurgePercent ? `+${p.avgSurgePercent}%` : '—'} />
          <Row label="마지막 급등" value={p.lastSurgeDate ?? '—'} />
          <Row
            label="다음 급등 예상"
            value={
              p.nextEstimatedDate
                ? `${p.nextEstimatedDate} (${daysLabel(p.daysUntilNext)})`
                : '패턴 없음'
            }
          />
          <Row label="예측 신뢰도" value={`${p.confidence}%`} />
        </dl>
      </section>

      <section className="mt-3">
        <h4 className="text-xs font-semibold text-text-secondary">📈 현재 상태 체크</h4>
        {evaluation.signalDetails.length ? (
          <ul className="mt-1.5 space-y-1 text-[11px]">
            {evaluation.signalDetails.map((detail) => (
              <li key={detail.key} className="flex gap-2">
                <span className="w-32 shrink-0 text-text-secondary">{detail.label}</span>
                <span className="w-40 shrink-0 tabular-nums text-text-primary">{detail.value}</span>
                <span className={detail.hit ? 'text-bullish' : 'text-text-muted'}>
                  → {detail.verdict} {detail.hit ? '✅' : '⚪'}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1.5 text-[11px] text-text-muted">계산할 데이터가 부족합니다.</p>
        )}
      </section>

      <section className="mt-3">
        <h4 className="text-xs font-semibold text-text-secondary">💡 평가 요약</h4>
        <p className="mt-1 text-[11px] leading-relaxed text-text-primary">{evaluation.reason}</p>
      </section>

      <section className="mt-3">
        <h4 className="text-xs font-semibold text-text-secondary">급등 이력</h4>
        <div className="mt-1">
          <SurgeMiniChart history={evaluation.surgeHistory} />
        </div>
      </section>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <button type="button" onClick={() => onSelectSymbol(evaluation.symbol)} className={BUTTON}>
          차트 보기
        </button>
        <button
          type="button"
          onClick={() => onWatch(evaluation.symbol)}
          disabled={watched}
          className={BUTTON}
        >
          {watched ? '관심 등록됨' : '관심 등록'}
        </button>
        <button type="button" onClick={() => onAnalyze(evaluation.symbol)} className={BUTTON}>
          🤖 AI 추가 분석
        </button>
      </div>

      <p className="mt-3 text-[11px] text-text-muted">
        ⚠️ 이 평가는 과거 데이터와 기술적 지표에 기반한 참고 정보이며, 투자 조언이 아닙니다.
      </p>
    </article>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-32 shrink-0">{label}</dt>
      <dd className="text-text-primary">{value}</dd>
    </div>
  );
}

const BUTTON =
  'rounded border border-border px-2 py-1 text-[11px] text-text-secondary transition-colors hover:border-accent hover:text-accent disabled:opacity-50 disabled:hover:border-border disabled:hover:text-text-secondary';
