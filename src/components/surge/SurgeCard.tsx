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
    /*
     * 한 줄에 정보를 몰아넣지 않는다. 좁아지면 값이 겹쳐 읽을 수 없어지고,
     * 줄임표로 자르면 정작 필요한 숫자가 사라진다 — 줄바꿈을 허용한다.
     * 최소 높이를 두어 내용이 적은 카드도 찌그러지지 않게 한다.
     */
    <article
      className={`flex min-h-[260px] min-w-[320px] flex-col gap-3 rounded-lg border bg-bg-secondary p-4 break-keep ${grade.className}`}
    >
      <header className="flex items-start justify-between gap-3">
        <span className="flex min-w-0 items-center gap-2">
          <span className="shrink-0 text-base">{grade.icon}</span>
          <SymbolLabel symbol={detection.symbol} name={detection.name} className="text-sm" />
        </span>
        {/* 점수는 카드 우상단 고정 — 카드를 훑을 때 가장 먼저 보는 값이다 */}
        <span className="shrink-0 text-right">
          <span className="block text-sm font-semibold tabular-nums">
            {detection.surgeScore}/100
          </span>
          <span className="block text-[10px] text-text-muted">급등 점수</span>
        </span>
      </header>

      {/* 각 정보를 한 줄씩 — 좁아지면 값이 아래로 내려간다 */}
      <dl className="space-y-1.5 text-[11px] text-text-secondary">
        <Row
          label="📊 급등 패턴"
          value={`평균 ${detection.avgInterval ?? '—'}일마다 · 최근 ${detection.surgeCount}회`}
        />
        <Row label="📅 마지막 급등" value={detection.lastSurgeDate ?? '—'} />
        <Row
          label="⏰ 다음 예상"
          value={`${detection.nextEstimatedDate ?? '—'} (${daysLabel(detection.daysUntilNext)})`}
        />
        <Row label="📈 규칙성" value={`${detection.regularity ?? '—'}%`} />
      </dl>

      {/* 신호 뱃지는 별도 영역으로 — 위 숫자들과 섞이면 둘 다 안 읽힌다 */}
      <div className="space-y-1">
        <p className="text-[11px] text-text-secondary">현재 신호</p>
        <div className="flex flex-wrap gap-1.5">
          {hits.length ? (
            hits.map(([key]) => (
              <span
                key={key}
                className="rounded bg-bullish/15 px-1.5 py-0.5 text-[11px] text-bullish"
              >
                {SIGNAL_LABEL[key] ?? key} 🟢
              </span>
            ))
          ) : (
            <span className="text-[11px] text-text-muted">없음</span>
          )}
        </div>
      </div>

      <SurgeMiniChart history={detection.surgeHistory} />

      {detection.reason && (
        <p className="text-[11px] leading-relaxed text-text-muted">{detection.reason}</p>
      )}

      <div className="mt-auto flex flex-wrap gap-2 pt-1">
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

/** 라벨과 값을 한 줄에 — 좁아지면 값이 아래로 줄바꿈된다 */
function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-wrap gap-x-2">
      <dt className="shrink-0">{label}</dt>
      <dd className="min-w-0 text-text-primary">{value}</dd>
    </div>
  );
}

const BUTTON =
  'rounded border border-border px-2.5 py-1 text-[11px] text-text-secondary transition-colors hover:border-accent hover:text-accent disabled:opacity-50 disabled:hover:border-border disabled:hover:text-text-secondary';
