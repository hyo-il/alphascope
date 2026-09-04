import type { PeerSummary } from '../../types/company';
import { formatCompactMoney } from '../../utils/formatters';

interface Props {
  symbol: string;
  sector: string | null;
  peers: PeerSummary[] | null;
  loading: boolean;
  error: string | null;
}

function fixed(value: number | null, digits = 2): string {
  return value == null || !Number.isFinite(value) ? '—' : value.toFixed(digits);
}

/** 업종 평균 — 이상치에 덜 흔들리도록 중앙값을 쓴다. */
function median(values: (number | null)[]): number | null {
  const sorted = values.filter((v): v is number => v != null && Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export default function SectorComparison({ symbol, sector, peers, loading, error }: Props) {
  return (
    <section>
      <h3 className="mb-1.5 text-xs font-medium text-text-secondary">
        동종업계 비교 {sector && <span className="text-text-muted">— {sector}</span>}
      </h3>

      {loading && <p className="text-xs text-text-muted">비교 종목 불러오는 중…</p>}
      {error && <p className="text-xs text-bearish">{error}</p>}

      {peers && peers.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-xs tabular-nums">
            <thead>
              <tr className="text-text-muted">
                <th className="py-1 pr-2 text-left font-normal">종목</th>
                <th className="py-1 px-2 text-right font-normal">시총</th>
                <th className="py-1 px-2 text-right font-normal">PER</th>
                <th className="py-1 px-2 text-right font-normal">PBR</th>
                <th className="py-1 px-2 text-right font-normal">순이익률</th>
                <th className="py-1 pl-2 text-right font-normal">배당률</th>
              </tr>
            </thead>
            <tbody>
              {peers.map((peer) => {
                const isTarget = peer.symbol === symbol;
                return (
                  <tr
                    key={peer.symbol}
                    className={`border-t border-border/60 ${isTarget ? 'bg-accent/10' : ''}`}
                  >
                    <td className="py-1 pr-2">
                      <span className={isTarget ? 'font-medium text-accent' : ''}>
                        {peer.symbol}
                      </span>
                      <span className="ml-1.5 text-text-muted">{peer.name ?? ''}</span>
                    </td>
                    <td className="py-1 px-2 text-right">{formatCompactMoney(peer.marketCap, peer.currency)}</td>
                    <td className="py-1 px-2 text-right">{fixed(peer.per)}</td>
                    <td className="py-1 px-2 text-right">{fixed(peer.pbr)}</td>
                    <td className="py-1 px-2 text-right">
                      {peer.profitMargin == null ? '—' : `${(peer.profitMargin * 100).toFixed(1)}%`}
                    </td>
                    <td className="py-1 pl-2 text-right">
                      {peer.dividendYield == null ? '—' : `${peer.dividendYield.toFixed(2)}%`}
                    </td>
                  </tr>
                );
              })}

              <tr className="border-t border-border text-text-secondary">
                <td className="py-1 pr-2">업종 중앙값</td>
                <td className="py-1 px-2 text-right">—</td>
                <td className="py-1 px-2 text-right">{fixed(median(peers.map((p) => p.per)))}</td>
                <td className="py-1 px-2 text-right">{fixed(median(peers.map((p) => p.pbr)))}</td>
                <td className="py-1 px-2 text-right">—</td>
                <td className="py-1 pl-2 text-right">—</td>
              </tr>
            </tbody>
          </table>
        </div>
      )}

      {peers && peers.length === 0 && (
        <p className="text-xs text-text-muted">이 섹터의 비교 목록이 아직 없습니다.</p>
      )}
    </section>
  );
}
