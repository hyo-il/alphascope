import { Badge } from '../ui';
import { vixZone } from '../../utils/marketBrief';
import type { MarketBrief } from '../../types/marketBrief';
import { BriefCard, LabeledLine } from './BriefCard';
import { clean, PASSIVE_TIP } from './briefText';
import MismatchTag from './MismatchTag';

const REGIME_TONE = { 'Risk-On': 'bullish', 'Risk-Off': 'bearish', 혼조: 'warning' } as const;
const REGIME_TIP = {
  'Risk-On': '위험 자산(주식)을 사려는 분위기',
  'Risk-Off': '위험을 피하려는 분위기(안전 자산 선호)',
  혼조: '방향이 섞여 뚜렷하지 않음',
} as const;

/** ① 시장 기조(오전판) · 시장 총평(오후판) — AI 가 없으면 한 줄 안내 */
export default function RegimeCard({ brief }: { brief: MarketBrief }) {
  return (
    <BriefCard id="regime" title={brief.edition === 'morning' ? '시장 기조' : '시장 총평'}>
      {brief.brief ? <RegimeBody brief={brief} /> : <p className="text-xs text-text-muted">AI 분석이 없어 시장 기조를 쓰지 못했습니다.</p>}
    </BriefCard>
  );
}

function RegimeBody({ brief }: { brief: MarketBrief }) {
  const ai = brief.brief!;
  const vix = brief.data.assets.VIX;
  return (
    <div className="space-y-2 text-xs">
      {brief.edition === 'morning' ? (
        <>
          {ai.market_regime && (
            <div className="flex items-center gap-2">
              <Badge tone={REGIME_TONE[ai.market_regime]} title={REGIME_TIP[ai.market_regime]}>
                {ai.market_regime}
              </Badge>
              <span className="text-caption text-text-muted">{REGIME_TIP[ai.market_regime]}</span>
              <MismatchTag ai={ai} field="market_regime" />
            </div>
          )}
          {ai.regime_summary && (
            <p className="break-keep text-text-primary">
              {clean(ai.regime_summary)}
              <MismatchTag ai={ai} field="regime_summary" />
            </p>
          )}
        </>
      ) : (
        <>
          {ai.market_summary && (
            <p className="break-keep text-text-primary">
              {clean(ai.market_summary)}
              <MismatchTag ai={ai} field="market_summary" />
            </p>
          )}
          {ai.vix_comment && (
            <LabeledLine label={vix ? `VIX ${vixZone(vix.current)}` : 'VIX'} tip="VIX = 미국 주식이 앞으로 얼마나 출렁일지 시장이 예상하는 값(공포지수). 20 미만 안정 · 20~30 주의 · 30 이상 공포.">
              {clean(ai.vix_comment)}
            </LabeledLine>
          )}
        </>
      )}
      {ai.portfolio_note && (
        <LabeledLine label="패시브(가정)" tip={PASSIVE_TIP}>
          {clean(ai.portfolio_note)}
        </LabeledLine>
      )}
    </div>
  );
}
