import type { BriefAi, BriefSectorStock } from '../../types/marketBrief';
import SymbolChartLink from '../common/SymbolChartLink';
import { BriefCard, LabeledLine } from './BriefCard';
import { clean } from './briefText';
import MismatchTag from './MismatchTag';

/** ③ 현재 주도 섹터 (AI 가 있을 때만) */
export default function SectorsCard({ ai, onOpen }: { ai: BriefAi; onOpen: (symbol: string) => void }) {
  return (
    <BriefCard
      id="sectors"
      title="현재 주도 섹터"
      info="기준 A = 3개월 넘게 이어질 상승 근거, 기준 B = 방향과 상관없이 시장 관심이 몰린 섹터입니다. 별 = AI 가 본 관심의 크기(오를 가능성이나 매수 추천의 세기가 아닙니다). 숏 관점 = 값이 내릴 것으로 보는 쪽(이 앱은 공매도를 하지 않습니다) · 관망 = 사지 않고 지켜봄. 대표 종목은 그 섹터의 시가총액 상위 · 관심 · 자동매매 종목 가운데서만 고릅니다(목록 밖 이름은 서버가 뺍니다) — 누르면 차트로 갑니다."
    >
      <ul className="space-y-3">
        {ai.leading_sectors.map((s, i) => (
          <li key={i} className="space-y-1 text-xs">
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="text-sm font-semibold text-text-primary">{s.name}</span>
              <span className="text-caption text-text-secondary" aria-label={`별 ${(s.stars.match(/★/g) ?? []).length}개`}>
                {s.stars}
              </span>
            </div>
            {s.reason && (
              <p className="break-keep text-text-secondary">
                {clean(s.reason)}
                <MismatchTag ai={ai} field={`leading_sectors.${i}.reason`} />
              </p>
            )}
            <Stocks label="국내" stocks={s.stocks_kr} onOpen={onOpen} />
            <Stocks label="미국" stocks={s.stocks_us} onOpen={onOpen} />
          </li>
        ))}
      </ul>
    </BriefCard>
  );
}

/** 대표 종목 — 목록이면 이름을 누르면 차트(`openChart`), 글자면 그 전에 만든 브리핑(AI 자유 글 그대로) */
function Stocks({ label, stocks, onOpen }: { label: string; stocks: BriefSectorStock[] | string; onOpen: (symbol: string) => void }) {
  if (typeof stocks === 'string') return stocks ? <LabeledLine label={label}>{clean(stocks)}</LabeledLine> : null;
  if (!stocks.length) return null;
  return (
    <LabeledLine label={label}>
      <span className="inline-flex flex-wrap gap-x-3 gap-y-1" data-brief-stocks={label}>
        {stocks.map((st) => (
          <SymbolChartLink key={st.symbol} symbol={st.symbol} name={st.name} onOpen={onOpen} />
        ))}
      </span>
    </LabeledLine>
  );
}
