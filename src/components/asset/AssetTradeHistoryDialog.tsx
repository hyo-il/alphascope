import { useCallback, useEffect, useState } from 'react';
import { Button, Dialog } from '../ui';
import { SkeletonTable } from '../common/SkeletonLoader';
import { LIST_TABLE_ROW, TABLE_HEAD_ROW, TABLE_NUM_COL, TABLE_NUM_GAP } from '../ui/tokens';
import { formatDateTime } from '../../utils/dateFormat';
import { tradeFxText, tradeMoneyText, tradeQtyText } from './AssetTradeDialog';
import type { AssetTradesResponse } from '../../types/asset';

/**
 * 매수 · 매도 기록 창(v2.66.0) — `GET /api/asset/trades` 최근 순 · 50줄씩 더 보기(`limit` 를 늘려 다시 받는다).
 * 처음 = 스켈레톤 · 더 보기 = 표를 두고 버튼만 돈다 · 실패 = 이유 + [다시 시도](빈 목록으로 바꾸지 않는다).
 * ⚠️ 자산 값은 콘솔 · 로컬 저장소에 남기지 않는다.
 */
const PAGE = 50;
const NUM = `${TABLE_NUM_COL} ${TABLE_NUM_GAP} text-right tabular-nums`;
const TEXT = `${TABLE_NUM_COL} ${TABLE_NUM_GAP}`;

export default function AssetTradeHistoryDialog({ onLocked, onClose }: { onLocked: () => void; onClose: () => void }) {
  const [limit, setLimit] = useState(PAGE);
  const [data, setData] = useState<AssetTradesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/asset/trades?limit=${limit}`);
      const body = (await res.json().catch(() => ({}))) as Partial<AssetTradesResponse> & { error?: string; code?: string };
      if (body.code === 'asset-locked') return onLocked();
      if (res.ok && body.trades) setData({ trades: body.trades, hasMore: body.hasMore === true });
      else setError(body.error ?? '기록을 받지 못했습니다.');
    } catch {
      setError('서버에 연결하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  }, [limit, onLocked]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <Dialog title="매수 · 매도 기록" onClose={onClose} size="xl" bodyClassName="flex min-h-0 flex-col gap-3 p-4">
      <div className="min-h-0 flex-1 overflow-auto" data-trade-history>
        {data == null && error == null && <SkeletonTable rows={8} columns={9} />}
        {error && (
          <p role="alert" className="mb-2 flex items-center gap-3 rounded-lg bg-danger/10 px-3 py-1.5 text-xs text-danger" data-trade-history-error>
            <span className="min-w-0 keep-all">{error}</span>
            <Button size="sm" busy={busy} onClick={() => void load()} className="ml-auto">
              다시 시도
            </Button>
          </p>
        )}
        {data != null && data.trades.length === 0 && (
          <p className="py-8 text-center text-xs text-text-muted" data-trade-history-empty>
            아직 입력한 매수 · 매도가 없습니다.
          </p>
        )}
        {data != null && data.trades.length > 0 && (
          <table className="w-full text-left text-xs" data-rows-differ>
            <thead className="sticky top-0 bg-bg-secondary text-caption text-text-muted">
              <tr className={`border-b border-border/50 ${TABLE_HEAD_ROW}`}>
                <th className={`${TABLE_NUM_COL} pl-1 font-normal`}>날짜</th>
                <th className={`${TEXT} font-normal`}>계좌</th>
                <th className={`${TABLE_NUM_GAP} min-w-24 font-normal`}>종목</th>
                <th className={`${TEXT} font-normal`}>구분</th>
                <th className={`${NUM} font-normal`}>수량</th>
                <th className={`${NUM} font-normal`}>가격</th>
                <th className={`${NUM} font-normal`}>환율</th>
                <th className={`${NUM} font-normal`}>그 뒤 수량</th>
                <th className={`${NUM} pr-1 font-normal`}>그 뒤 평균가</th>
              </tr>
            </thead>
            <tbody>
              {data.trades.map((t) => (
                <tr key={t.id} className={`border-b border-border/30 last:border-b-0 ${LIST_TABLE_ROW} text-text-primary`} data-trade-row={t.side}>
                  <td className={`${TABLE_NUM_COL} pl-1 text-text-secondary tabular-nums`}>{formatDateTime(t.at)}</td>
                  <td className={`${TEXT} text-text-secondary`}>{t.section}</td>
                  <td className={`${TABLE_NUM_GAP} max-w-0 min-w-24`}>
                    <span className="block truncate" title={t.name}>
                      {t.name}
                    </span>
                  </td>
                  <td className={TEXT}>{t.side === 'buy' ? '매수' : '매도'}</td>
                  <td className={NUM}>{tradeQtyText(t.qty)}</td>
                  <td className={NUM}>{tradeMoneyText(t.price, t.currency)}</td>
                  <td className={NUM}>{t.fx == null ? '—' : tradeFxText(t.fx)}</td>
                  <td className={NUM}>{tradeQtyText(t.afterQty)}</td>
                  <td className={`${NUM} pr-1`}>{tradeMoneyText(t.afterAvg, t.currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {data?.hasMore && (
        <div className="flex justify-center">
          <Button size="sm" busy={busy} onClick={() => setLimit((n) => n + PAGE)} data-trade-history-more>
            50줄 더 보기
          </Button>
        </div>
      )}
    </Dialog>
  );
}
