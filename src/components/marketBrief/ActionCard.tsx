import WarnIcon from '../ui/WarnIcon';
import SymbolChartLink from '../common/SymbolChartLink';
import type { BriefAi } from '../../types/marketBrief';
import { BriefCard, LabeledLine } from './BriefCard';
import { clean, LABEL_W, PASSIVE_TIP } from './briefText';

/** ⑦ 액션 포인트 (AI 가 있을 때만) — 매수 신호가 아니라는 안내는 화면 글자로 늘 보인다 */
export default function ActionCard({ ai, onOpen }: { ai: BriefAi; onOpen: (symbol: string) => void }) {
  return (
    <BriefCard id="action" title="액션 포인트">
      <div className="space-y-2 text-xs">
        <p className="break-keep text-caption text-warning">
          <WarnIcon />
          AI 가 뉴스로 쓴 참고 의견입니다 — 매수 신호가 아니며, 앱의 매수 판단 · 자동매매와 상관없습니다.
        </p>
        {ai.portfolio_adjustment.passive_note && (
          <LabeledLine label="패시브(가정)" tip={PASSIVE_TIP}>
            {clean(ai.portfolio_adjustment.passive_note)}
          </LabeledLine>
        )}
        {ai.portfolio_adjustment.swing_candidates.length > 0 && (
          <div className="flex gap-2">
            <span className={`${LABEL_W} shrink-0 text-caption text-text-muted`}>스윙 후보(참고)</span>
            <ul className="min-w-0 space-y-1">
              {ai.portfolio_adjustment.swing_candidates.slice(0, 2).map((c, i) => (
                <li key={i} className="flex gap-2 break-keep text-text-primary">
                  <span className="text-text-muted">•</span>
                  <CandidateText text={c} onOpen={onOpen} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </BriefCard>
  );
}

/** 「마이크론(MU) — …」 의 앞 종목을 차트 링크로 */
function CandidateText({ text, onOpen }: { text: string; onOpen: (symbol: string) => void }) {
  const t = clean(text);
  const m = /^(.+?)\(([A-Z][A-Z.-]{0,5}|\d[0-9A-Z]{5})(?:\.(?:KS|KQ))?\)(.*)$/s.exec(t);
  if (!m) return <span>{t}</span>;
  return (
    <span>
      <SymbolChartLink symbol={m[2]} name={m[1].trim()} onOpen={onOpen} className="font-medium" />
      {m[3]}
    </span>
  );
}
