import { useState } from 'react';
import { Button } from '../ui';
import { LIST_TABLE_ROW, TABLE_NAME_COL, TABLE_NUM_COL, TABLE_NUM_GAP } from '../ui/tokens';
import { formatDateTime } from '../../utils/dateFormat';
import { modal } from '../../store/uiStore';
import { PRICE_SKIP_LABEL, type AssetPriceSheetStatus } from '../../types/asset';

/**
 * 설정 창 「시트 가격」 구역(v2.65.0 · 자산 관리 2단계) — 시트 「티커」 의 가격(E열) · 환율(C9)이 GOOGLEFINANCE 인지 토스인지.
 * - 한 줄 상태: 「시트 가격: Google(GOOGLEFINANCE) / 토스 · 마지막 쓴 시각 ○ · 쓰는 중 / 장 닫힘」.
 * - [시트 가격을 토스로 바꾸기](이미 토스면 「남은 종목도 토스로 바꾸기」 — 바꿀 줄이 없으면 숨김) · [되돌리기](토스이거나 되돌리지 못한 원래 수식이 남았을 때).
 *   둘 다 확인 창(`modal.confirm` — 누르면 「처리 중」)을 거친다. 실패는 이유 한 줄.
 * - 스위치가 꺼진 서버(맥 기본)는 안내 한 줄 + 버튼 막음.
 * - 「토스 가격 없음 — 시트 값 그대로」 목록(종목 · 코드 · 이유) — 이름 · 코드는 화면에만.
 */
export default function AssetPriceSheetSection({
  status,
  onAction,
  onBusy,
}: {
  status: AssetPriceSheetStatus;
  /** 서버에 바꾸기 · 되돌리기 — 실패면 이유 문구 */
  onAction: (kind: 'convert' | 'restore') => Promise<string | null>;
  /** 저장 중 표시(구역 제목 옆 스피너) */
  onBusy: (busy: boolean) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toss = status.source === 'toss';
  const showConvert = !toss || status.remaining > 0;
  const showRestore = toss || status.hasBackup;

  const run = (kind: 'convert' | 'restore') => {
    modal.confirm(
      kind === 'convert'
        ? {
            title: toss ? '남은 종목도 토스로 바꾸기' : '시트 가격을 토스로 바꾸기',
            message: '시트 「티커」 의 가격(E열) · 환율(C9)을 토스 값으로, 원화 표기(F열) 수식을 바꿉니다. 원래 수식은 저장되어 [되돌리기] 로 돌아갈 수 있습니다.',
            confirmText: '바꾸기',
            onConfirm: () => act(kind),
          }
        : {
            title: '되돌리기',
            message: '저장해 둔 원래 GOOGLEFINANCE 수식을 다시 넣습니다.',
            confirmText: '되돌리기',
            onConfirm: () => act(kind),
          },
    );
  };
  const act = async (kind: 'convert' | 'restore') => {
    setError(null);
    setBusy(true);
    onBusy(true);
    const failed = await onAction(kind);
    setBusy(false);
    onBusy(false);
    if (failed) setError(failed);
  };

  return (
    <div className="space-y-2" data-setting="price-sheet">
      <p className="text-xs text-text-primary keep-all" data-price-state>
        시트 가격: <span className="font-medium">{toss ? '토스' : 'Google(GOOGLEFINANCE)'}</span>
        {toss && (
          <>
            <span className="text-text-muted"> · 마지막 쓴 시각 </span>
            <span className="whitespace-nowrap tabular-nums">{status.lastWrittenAt ? formatDateTime(status.lastWrittenAt) : '—'}</span>
            <span className="text-text-muted"> · </span>
            <span className="whitespace-nowrap">{status.state === 'writing' ? '쓰는 중' : status.state === 'closed' ? '장 닫힘' : '꺼짐'}</span>
          </>
        )}
      </p>
      {!status.enabled && <p className="text-caption text-warning keep-all">이 서버에서는 시트 가격 쓰기가 꺼져 있습니다(오라클에서만 켬)</p>}
      {(showConvert || showRestore) && (
        <div className="flex flex-wrap items-center gap-2">
          {showConvert && (
            <Button size="sm" disabled={!status.enabled || busy} onClick={() => run('convert')} data-price-convert>
              {toss ? '남은 종목도 토스로 바꾸기' : '시트 가격을 토스로 바꾸기'}
            </Button>
          )}
          {showRestore && (
            <Button size="sm" disabled={!status.enabled || busy} onClick={() => run('restore')} data-price-restore>
              되돌리기
            </Button>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="text-xs text-danger keep-all">
          {error}
        </p>
      )}
      {status.skipped.length > 0 && (
        <div className="space-y-1" data-price-skipped>
          <p className="text-caption text-text-muted">토스 가격 없음 — 시트 값 그대로</p>
          <div className="rounded-lg bg-bg-tertiary/40">
            <table className="w-full text-left text-xs">
              <thead className="bg-bg-secondary text-caption text-text-muted">
                <tr className="border-b border-border/50">
                  <th className={`${TABLE_NAME_COL} py-2 pl-3 pr-4`}>종목</th>
                  <th className={`${TABLE_NUM_COL} py-2 pr-4`}>코드</th>
                  <th className={`${TABLE_NUM_COL} ${TABLE_NUM_GAP} py-2 pr-3`}>이유</th>
                </tr>
              </thead>
              <tbody>
                {status.skipped.map((s) => {
                  const name = s.name || `티커 ${s.row}행`;
                  return (
                    <tr key={`${s.row}-${s.reason}`} className={`border-b border-border/30 last:border-b-0 ${LIST_TABLE_ROW}`}>
                      <td className="max-w-0 py-1.5 pl-3 pr-4">
                        <span className="block truncate font-medium text-text-primary" title={name}>
                          {name}
                        </span>
                      </td>
                      <td className={`${TABLE_NUM_COL} py-1.5 pr-4 tabular-nums text-text-secondary`}>{s.code}</td>
                      <td className={`${TABLE_NUM_COL} ${TABLE_NUM_GAP} py-1.5 pr-3 text-caption text-text-muted`}>{PRICE_SKIP_LABEL[s.reason]}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
