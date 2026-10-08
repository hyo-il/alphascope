import { useEffect, useState } from 'react';
import type { PeerSummary } from '../../types/company';
import { formatCompactMoney } from '../../utils/formatters';
import { isKrSymbol } from '../../utils/market';
import { sectorKo } from '../../data/sectors';
import { PEER_MAX } from '../../data/peerPairs';
import StockName from '../common/StockName';
import { InfoTip, Segmented } from '../ui';

interface Props {
  symbol: string;
  sector: string | null;
  peers: PeerSummary[] | null;
  loading: boolean;
  error: string | null;
}

type Money = 'KRW' | 'USD';

function fixed(value: number | null, digits = 2): string {
  return value == null || !Number.isFinite(value) ? '—' : value.toFixed(digits);
}

/** 업종 중앙값 — 이상치에 덜 흔들리도록 중앙값을 쓴다. 보이는 종목으로 낸다 */
function median(values: (number | null)[]): number | null {
  const sorted = values.filter((v): v is number => v != null && Number.isFinite(v)).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

const BASIS_LABEL: Record<NonNullable<PeerSummary['basis']>, string> = {
  self: '',
  pair: '직접 정한 짝',
  industry: '같은 세부 업종',
  sector: '같은 섹터',
};

/**
 * 동종업계 비교 (v2.42.0) — 이 종목 + 최대 `PEER_MAX` 개(국내·미국 함께, 고르는 규칙은 서버 `getPeers`).
 * 금액(시총)은 **기본 원화**로 맞춘다(토스 환율 — 서버 60초 캐시 `/api/exchange-rate`), [원화 | 달러] 로 바꾼다. PER·PBR·비율은 환산하지 않는다.
 * 국내 종목 이름은 카탈로그 한글 이름(`StockName`).
 */
export default function SectorComparison({ symbol, sector, peers, loading, error }: Props) {
  const [money, setMoney] = useState<Money>('KRW');
  const [fx, setFx] = useState<{ rate: number; at: number } | null>(null);
  const [fxError, setFxError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch('/api/exchange-rate?base=USD&quote=KRW')
      .then((r) => r.json())
      .then((d) => {
        if (!alive) return;
        if (typeof d?.rate?.rate === 'number') setFx({ rate: d.rate.rate, at: d.rate.fetchedAt ?? Date.now() });
        else setFxError('환율을 받지 못했습니다');
      })
      .catch(() => alive && setFxError('환율을 받지 못했습니다'));
    return () => {
      alive = false;
    };
  }, []);

  /** 시총을 고른 통화로 — 환율이 없으면 원래 통화 그대로 */
  const cap = (p: PeerSummary): string => {
    const from = (p.currency === 'KRW' ? 'KRW' : 'USD') as Money;
    if (p.marketCap == null) return '—';
    if (from === money || !fx) return formatCompactMoney(p.marketCap, from);
    return formatCompactMoney(money === 'KRW' ? p.marketCap * fx.rate : p.marketCap / fx.rate, money);
  };

  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-xs font-medium text-text-secondary">
          동종업계 비교 {sector && <span className="text-text-muted">— {sectorKo(sector)}</span>}
        </h3>
        <InfoTip label="동종업계 고르는 법">
          최대 {PEER_MAX}개. ① 직접 정한 짝(같은 주력 사업) ② 미국·국내 시가총액 상위 종목 중 같은 세부 업종, 시가총액이 가까운 순 ③ 같은 섹터 순으로 고릅니다.
        </InfoTip>
        <span className="ml-auto flex items-center gap-2">
          {fx && (
            <span className="text-caption text-text-muted">
              환율 {fx.rate.toLocaleString('ko-KR', { maximumFractionDigits: 2 })}원 · {new Date(fx.at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 기준
            </span>
          )}
          {fxError && <span className="text-caption text-text-muted">{fxError} — 원래 통화로 보입니다</span>}
          <Segmented
            label="시가총액 통화"
            size="sm"
            value={money}
            onChange={setMoney}
            options={[
              { value: 'KRW', label: '원화' },
              { value: 'USD', label: '달러' },
            ]}
          />
        </span>
      </div>

      {loading && <p className="text-xs text-text-muted">비교 종목 불러오는 중…</p>}
      {error && <p className="text-xs text-danger">{error}</p>}

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
                  <tr key={peer.symbol} className={`border-t border-border/60 ${isTarget ? 'bg-bg-tertiary' : ''}`}>
                    <td className="py-1.5 pr-2">
                      {isKrSymbol(peer.symbol) ? (
                        <StockName symbol={peer.symbol} size="sm" className={isTarget ? 'font-semibold' : ''} />
                      ) : (
                        <>
                          <span className={isTarget ? 'font-semibold text-text-primary' : 'text-text-secondary'}>{peer.name ?? peer.symbol}</span>
                          {peer.name && <span className="ml-1.5 text-caption text-text-muted">{peer.symbol}</span>}
                        </>
                      )}
                      {peer.basis && peer.basis !== 'self' && <span className="ml-1.5 text-caption text-text-muted">· {BASIS_LABEL[peer.basis]}</span>}
                    </td>
                    <td className="py-1.5 px-2 text-right">{cap(peer)}</td>
                    <td className="py-1.5 px-2 text-right">{fixed(peer.per)}</td>
                    <td className="py-1.5 px-2 text-right">{fixed(peer.pbr)}</td>
                    <td className="py-1.5 px-2 text-right">{peer.profitMargin == null ? '—' : `${(peer.profitMargin * 100).toFixed(1)}%`}</td>
                    <td className="py-1.5 pl-2 text-right">{peer.dividendYield == null ? '—' : `${peer.dividendYield.toFixed(2)}%`}</td>
                  </tr>
                );
              })}

              <tr className="border-t border-border text-text-secondary">
                <td className="py-1.5 pr-2">업종 중앙값</td>
                <td className="py-1.5 px-2 text-right">—</td>
                <td className="py-1.5 px-2 text-right">{fixed(median(peers.map((p) => p.per)))}</td>
                <td className="py-1.5 px-2 text-right">{fixed(median(peers.map((p) => p.pbr)))}</td>
                <td className="py-1.5 px-2 text-right">—</td>
                <td className="py-1.5 pl-2 text-right">—</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-1 text-caption text-text-muted">PER·PBR 이 「—」 인 국내 종목은 yfinance 가 값을 주지 않는 경우입니다(기본정보 탭의 PER 은 앱이 따로 계산합니다).</p>
        </div>
      )}

      {peers && peers.length <= 1 && !loading && <p className="text-xs text-text-muted">비교할 종목을 찾지 못했습니다.</p>}
    </section>
  );
}
