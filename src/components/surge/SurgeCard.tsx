import type { SurgeDetection } from '../../types/surge';
import SymbolLabel from '../common/SymbolLabel';
import SurgeMiniChart from './SurgeMiniChart';
import { daysLabel, GRADE_STYLE } from './gradeStyle';

const SIGNAL_LABEL: Record<string, string> = {
  rsiOversold: 'RSI 과매도',
  volumeIncreasing: '거래량↑',
  nearSupport: '지지선 근처',
  bollingerLower: '볼린저 하단',
  macdCrossing: 'MACD 양전환',
  priceCompressed: '변동성 축소',
  nearCycleDate: '예상일 근접',
};

/** 탐지 결과 한 종목 — 목록의 기본 단위 */
export default function SurgeCard({
  detection,
  watched,
  onSelectSymbol,
  onWatch,
  onPaperBuy,
  onAnalyze,
}: {
  detection: SurgeDetection;
  watched: boolean;
  onSelectSymbol: (symbol: string) => void;
  onWatch: (symbol: string) => void;
  onPaperBuy: (symbol: string, price: number | null) => void;
  onAnalyze: (symbol: string) => void;
}) {
  const grade = GRADE_STYLE[detection.grade];
  const hits = Object.entries(detection.signals ?? {}).filter(([, on]) => on);

  return (
    <article className={`rounded-lg border bg-bg-secondary p-3 ${grade.className}`}>
      <header className="flex flex-wrap items-baseline gap-2">
        <span className="text-base">{grade.icon}</span>
        <SymbolLabel symbol={detection.symbol} name={detection.name} className="text-sm" />
        <span className="ml-auto text-sm font-semibold tabular-nums">
          급등 점수 {detection.surgeScore}/100
        </span>
      </header>

      <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-text-secondary">
        <div className="flex gap-1">
          <dt>📊 급등 패턴</dt>
          <dd className="text-text-primary">
            평균 {detection.avgInterval ?? '—'}일마다 · {detection.surgeCount}회
          </dd>
        </div>
        <div className="flex gap-1">
          <dt>📅 마지막 급등</dt>
          <dd className="text-text-primary">{detection.lastSurgeDate ?? '—'}</dd>
        </div>
        <div className="flex gap-1">
          <dt>⏰ 다음 예상</dt>
          <dd className="text-text-primary">
            {detection.nextEstimatedDate ?? '—'} ({daysLabel(detection.daysUntilNext)})
          </dd>
        </div>
        <div className="flex gap-1">
          <dt>📈 규칙성</dt>
          <dd className="text-text-primary">{detection.regularity ?? '—'}%</dd>
        </div>
      </dl>

      <p className="mt-2 text-[11px] text-text-secondary">
        현재 신호:{' '}
        {hits.length ? (
          hits.map(([key]) => (
            <span key={key} className="mr-1 text-bullish">
              {SIGNAL_LABEL[key] ?? key} 🟢
            </span>
          ))
        ) : (
          <span className="text-text-muted">없음</span>
        )}
      </p>

      <div className="mt-2">
        <SurgeMiniChart history={detection.surgeHistory} />
      </div>

      {detection.reason && (
        <p className="mt-2 text-[11px] leading-relaxed text-text-muted">{detection.reason}</p>
      )}

      <div className="mt-3 flex flex-wrap gap-1.5">
        <button type="button" onClick={() => onSelectSymbol(detection.symbol)} className={BUTTON}>
          차트 보기
        </button>
        <button
          type="button"
          onClick={() => onWatch(detection.symbol)}
          disabled={watched}
          className={BUTTON}
        >
          {watched ? '관심 등록됨' : '관심 등록'}
        </button>
        <button
          type="button"
          onClick={() => onPaperBuy(detection.symbol, detection.priceAtDetection)}
          className={BUTTON}
        >
          모의 매수
        </button>
        <button type="button" onClick={() => onAnalyze(detection.symbol)} className={BUTTON}>
          AI 분석
        </button>
      </div>
    </article>
  );
}

const BUTTON =
  'rounded border border-border px-2 py-1 text-[11px] text-text-secondary transition-colors hover:border-accent hover:text-accent disabled:opacity-50 disabled:hover:border-border disabled:hover:text-text-secondary';
