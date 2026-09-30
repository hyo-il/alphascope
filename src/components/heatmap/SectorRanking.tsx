import StockName from '../common/StockName';
import type { HeatmapSector } from '../../types/heatmap';

/**
 * 섹터 강세 순위 (v2.19.0) — 종목 지도 옆 표. **설명용**이다(지난 기간의 결과, 판정·자동매매에 쓰지 않는다).
 *
 * 한 줄: 시총 가중 수익률(굵게) · 동일 가중(작게) · 상승 종목 비율 · 시장 대비 · 기여 상위 3종목.
 * 시총 가중만 보이면 초대형주 하나가 섹터를 좌우하는지 알 수 없어서 동일 가중과 상승 비율을 함께 둔다.
 * 줄을 누르면 지도에서 그 섹터를 강조한다(다시 누르면 해제).
 */

const pct = (v: number) => `${v > 0 ? '+' : ''}${v.toFixed(2)}%`;
const tone = (v: number) => (v > 0 ? 'text-bullish' : v < 0 ? 'text-bearish' : 'text-text-secondary');

export default function SectorRanking({
  sectors,
  selected,
  onSelect,
}: {
  sectors: HeatmapSector[];
  selected: string | null;
  onSelect: (sector: string | null) => void;
}) {
  if (!sectors.length) return <p className="p-3 text-[11px] text-text-muted">계산할 수 있는 섹터가 없습니다.</p>;
  return (
    <ol className="divide-y divide-border">
      {sectors.map((s, i) => {
        const active = selected === s.sector;
        return (
          <li key={s.sector}>
            <button
              type="button"
              onClick={() => onSelect(active ? null : s.sector)}
              className={`w-full px-2.5 py-1.5 text-left transition-colors hover:bg-bg-tertiary/60 ${active ? 'bg-accent/10' : ''}`}
              aria-pressed={active}
            >
              <div className="flex items-baseline gap-1.5">
                <span className="w-4 shrink-0 text-right text-[10px] tabular-nums text-text-muted">{i + 1}</span>
                <span className={`min-w-0 flex-1 truncate text-[12px] font-medium ${active ? 'text-accent' : 'text-text-primary'}`}>
                  {s.sector}
                </span>
                <span className={`text-[12px] font-semibold tabular-nums ${tone(s.capReturn)}`}>{pct(s.capReturn)}</span>
              </div>
              <div className="ml-5 flex flex-wrap gap-x-2 text-[10px] tabular-nums text-text-muted">
                <span title="동일 가중(단순 평균) 수익률">동일 {pct(s.equalReturn)}</span>
                <span title="오른 종목 / 계산한 종목">
                  상승 {s.up}/{s.counted}
                </span>
                <span className={tone(s.vsMarket)} title="시장 평균(시총 가중) 대비">
                  시장 대비 {s.vsMarket > 0 ? '+' : ''}
                  {s.vsMarket.toFixed(2)}%p
                </span>
                {s.excluded > 0 && <span title="N거래일 전 종가가 없어 뺀 종목">제외 {s.excluded}</span>}
              </div>
              <div className="ml-5 mt-0.5 flex flex-wrap gap-x-2 text-[10px] text-text-secondary">
                {s.top.map((t) => (
                  <span key={t.symbol} className="inline-flex items-baseline gap-0.5" title={`섹터 수익률 기여 ${t.contribution.toFixed(2)}%p`}>
                    <StockName symbol={t.symbol} name={t.name ?? undefined} size="sm" />
                    <span className={`tabular-nums ${tone(t.returnPct)}`}>{pct(t.returnPct)}</span>
                  </span>
                ))}
              </div>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
