import { Badge, InfoTip } from '../ui';
import { formatPercent } from '../../utils/formatters';
import { kstDay } from '../../utils/marketBrief';
import { kstClockText } from '../../utils/marketDate';
import type { BriefOutlook, MarketBrief, OutlookDirection, OutlookItemScore, OutlookStats, OutlookTarget, OutlookView } from '../../types/marketBrief';
import { BriefCard, LabeledLine } from './BriefCard';
import { clean } from './briefText';
import MismatchTag from './MismatchTag';

/** 대상 이름 — 코스피는 오늘 국내 정규장 · S&P500 은 오늘 밤 미국 정규장 */
const TARGET_LABEL: Record<OutlookTarget, string> = { KOSPI: '코스피 — 오늘', SP500: 'S&P500 — 오늘 밤(미국)' };
/** 방향 배지 — 가격 방향 색(상승 초록 · 하락 빨강) · 보합은 무채색 */
const DIRECTION_TONE: Record<OutlookDirection, 'bullish' | 'bearish' | 'neutral'> = { 상승: 'bullish', 하락: 'bearish', 보합: 'neutral' };

const INFO =
  'AI 가 이 브리핑의 입력 숫자(지수 최근 흐름 · 미국 지수 선물 · 섹터 1주 흐름 · 뉴스)로 쓴 참고 예상입니다. 보합 = 전일 정규장 종가 대비 ±0.3% 안. ' +
  '확신 = 근거가 한 방향으로 모인 정도(오를 · 내릴 확률이 아닙니다). 채점: 그 거래일 정규장 시작 전에 만든 마지막 예상을 그날 정규장 종가와 견줍니다 — 코스피는 한국 15:30 마감 뒤, S&P500 은 다음 날 아침(미국 마감 뒤). ' +
  '맞힌 비율은 참고 통계라 매수 판단 · 자동매매에 쓰지 않습니다.';

/** 「한국 15:30」 · 날짜가 오늘과 다르면 「한국 11-03 06:00」 */
function kstCloseText(iso: string, now = Date.now()): string {
  const ms = Date.parse(iso);
  const day = kstDay(ms);
  return `한국 ${day === kstDay(now) ? '' : `${day.slice(5)} `}${kstClockText(ms).slice(0, 5)}`;
}

/** 채점 줄 — 상태마다 한 줄 */
function ScoreLine({ score }: { score: OutlookItemScore }) {
  switch (score.status) {
    case 'scored':
      return (
        <span className="tabular-nums">
          <span className={score.hit ? 'font-medium text-text-primary' : 'text-text-secondary'}>{score.hit ? '맞음' : '틀림'}</span>
          {' · 실제 '}
          {formatPercent(score.actualPct ?? 0)}({score.actualDirection}){score.tradeDay ? ` · ${score.tradeDay.slice(5)}` : ''}
        </span>
      );
    case 'pending':
      return <span>채점 대기 — {score.closeAt ? kstCloseText(score.closeAt) : ''} 마감 뒤</span>;
    case 'waiting-data':
      return <span>채점 대기 — 마감 뒤 실제 값을 받는 중</span>;
    case 'after-open':
      return <span>장 시작 뒤 만든 예상 — 채점 안 함</span>;
    case 'superseded':
      return <span>같은 날 장 시작 전에 더 나중에 만든 예상을 채점합니다 — 이 예상은 채점 안 함</span>;
    case 'holiday':
      return <span>휴장(또는 다음 정규장이 멀다) — 채점 안 함</span>;
  }
}

/** 최근 성적 — 「최근 20번 중 N번 맞음(확신 높음 a/b · 보통 c/d · 낮음 e/f)」 · 20번이 안 되면 「지금까지 M번 중 N번」 */
function StatsLine({ stats, recent }: { stats: OutlookStats; recent: number }) {
  if (!stats.total) return <span className="text-text-muted">아직 채점한 예상이 없습니다</span>;
  const head = stats.total >= recent ? `최근 ${recent}번 중 ${stats.hits}번 맞음` : `지금까지 ${stats.total}번 중 ${stats.hits}번 맞음`;
  const parts = (['높음', '보통', '낮음'] as const).map((c) => `${c} ${stats.byConfidence[c].hits}/${stats.byConfidence[c].total}`);
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1 tabular-nums">
      {head}
      <span className="text-text-muted">(확신 {parts.join(' · ')})</span>
      <InfoTip label="맞힌 비율">
        참고 통계입니다 — 매수 판단 · 자동매매에 쓰지 않습니다. {recent}번 남짓은 우연과 가리기 어려운 적은 수라, 맞힌 비율이 높아도 예상이 믿을 만하다는 뜻은 아닙니다.
      </InfoTip>
    </span>
  );
}

function OutlookRow({ o, index, ai, score, stats, recent }: { o: BriefOutlook; index: number; ai: NonNullable<MarketBrief['brief']>; score?: OutlookItemScore; stats?: OutlookStats; recent: number }) {
  return (
    <li className="space-y-1 text-xs" data-brief-outlook={o.target}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold text-text-primary">{TARGET_LABEL[o.target]}</span>
        <Badge tone={DIRECTION_TONE[o.direction]}>{o.direction}</Badge>
        <Badge>확신 {o.confidence}</Badge>
      </div>
      {o.reasons.length > 0 && (
        <LabeledLine label="근거">
          <span className="block space-y-0.5">
            {o.reasons.map((r, j) => (
              <span key={j} className="block">
                {clean(r)}
                <MismatchTag ai={ai} field={`today_outlook.${index}.reasons.${j}`} />
              </span>
            ))}
          </span>
        </LabeledLine>
      )}
      {o.watch && <LabeledLine label="뒤집힐 조건">{clean(o.watch)}</LabeledLine>}
      {score && (
        <LabeledLine label="채점">
          <span className="text-text-secondary" data-brief-score={score.status}>
            <ScoreLine score={score} />
          </span>
        </LabeledLine>
      )}
      {stats && (
        <LabeledLine label="최근 성적">
          <span className="text-text-secondary" data-brief-stats>
            <StatsLine stats={stats} recent={recent} />
          </span>
        </LabeledLine>
      )}
    </li>
  );
}

/**
 * 「오늘 예상 방향」(v2.60.0) — 「시장 기조」 바로 아래. AI 가 입력 숫자로 쓴 참고 예상 + 채점 · 최근 성적.
 * AI 가 없으면 예상을 만들지 않는다(데이터로 대신 만들지 않는다). 그 전 브리핑(예상 없음)은 한 줄 안내.
 */
export default function OutlookCard({ brief, view }: { brief: MarketBrief; view?: OutlookView }) {
  const ai = brief.brief;
  const list = ai?.today_outlook ?? [];
  return (
    <BriefCard id="outlook" title="오늘 예상 방향" aside="참고" info={INFO}>
      {!ai ? (
        <p className="text-xs text-text-muted">AI 분석 실패로 예상이 없습니다.</p>
      ) : !list.length ? (
        <p className="text-xs text-text-muted">이 브리핑에는 예상이 없습니다(예상 칸이 생기기 전에 만든 브리핑이거나 AI 가 쓰지 않았습니다).</p>
      ) : (
        <ul className="space-y-3">
          {list.map((o, i) => (
            <OutlookRow
              key={o.target}
              o={o}
              index={i}
              ai={ai}
              score={view?.items.find((s) => s.target === o.target)}
              stats={view?.stats[o.target]}
              recent={view?.recent ?? 20}
            />
          ))}
        </ul>
      )}
      <p className="text-caption text-text-muted" data-brief-outlook-note>
        AI 가 입력 숫자로 쓴 예상입니다 — 투자 조언이 아니며, 매수 판단 · 자동매매와 상관없습니다.
      </p>
    </BriefCard>
  );
}
