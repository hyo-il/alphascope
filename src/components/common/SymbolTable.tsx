import { useState, type ReactNode } from 'react';
import StockName from './StockName';
import { PickerDialog, usePickerAdded, type SymbolPickerProps } from './SymbolPicker';
import { Button, ListRemoveButton, RemoveAllButton } from '../ui';
import { TABLE_NAME_COL } from '../ui/tokens';
import { useStockNames } from '../../hooks/useStockNames';
import { useSymbolInfo } from '../../hooks/useSymbolInfo';
import { isKrSymbol } from '../../utils/market';

/**
 * 종목 목록 **표** — 공용 부품 하나 (v2.44.0, 사용자 결정 A-7). 계좌 「② 대상 종목」 과 백테스트 「① 종목」 이 같은 부품을 쓴다
 * (매수 판단은 3단계, 지정 종목은 5단계에서 같은 표로 바꾼다 — 그때까지는 칩 모양 `SymbolPicker`).
 *
 * 열: 종목(이름 (티커)) · 시장(미국/국내) · 분야(종목 지도와 같은 출처·한글 이름, 없으면 「기타」) · 목록에서 삭제(×).
 * 표 아래 [종목 고르기] — 앱의 다른 「종목 고르기」 와 **같은 창**(`PickerDialog`)을 연다. 10줄이 넘으면 표 안에서 스크롤(머리 줄 고정).
 * ⚠️ 줄 삭제는 × 아이콘(「목록에서 삭제」 — 용어집 「삭제」, 확인 창 없음). 지시서의 「빼기」 는 용어집이 쓰지 않는 이름이라 쓰지 않았다.
 */
export default function SymbolTable(
  props: Omit<SymbolPickerProps, 'title'> & {
    /** 표 아래 [종목 고르기] 옆 버튼(계좌의 [지금 살 만한가 추천 추가] · [종목 발굴]) */
    extraButtons?: ReactNode;
  },
) {
  const { selected, onChange, max, softLimit, softLimitText, extraButtons, emptyText } = props;
  const [open, setOpen] = useState(false);
  const [ownAdded, setOwnAdded] = useState<string[]>([]);
  const { added, onAddedChange } = usePickerAdded(selected, props.added, props.onAddedChange, ownAdded, setOwnAdded);
  useStockNames(selected);
  const info = useSymbolInfo(selected);
  const soft = softLimit != null && selected.length > softLimit;

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <span className="text-xs text-text-secondary tabular-nums">
          {selected.length}종목{max != null ? ` / 최대 ${max}종목` : ''}
        </span>
        {selected.length > 0 && (
          <span className="ml-auto">
            <RemoveAllButton onClick={() => onChange([])} />
          </span>
        )}
      </div>

      {selected.length === 0 ? (
        <p className="rounded-lg bg-bg-tertiary/40 px-3 py-3 text-xs text-text-muted">{emptyText ?? '아직 고른 종목이 없습니다.'}</p>
      ) : (
        <div className="max-h-[23rem] overflow-y-auto rounded-lg bg-bg-tertiary/40 [scrollbar-gutter:stable]" data-symbol-table>
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 z-10 bg-bg-secondary text-caption text-text-muted">
              <tr className="border-b border-border/50">
                <th className={`${TABLE_NAME_COL} py-2 pl-3 pr-4`}>종목</th>
                <th className="whitespace-nowrap py-2 pr-6">시장</th>
                <th className="whitespace-nowrap py-2 pr-6">분야</th>
                <th className="py-2 pr-2" aria-label="목록에서 삭제" />
              </tr>
            </thead>
            <tbody>
              {selected.map((s) => (
                <tr key={s} className="border-b border-border/30 last:border-b-0">
                  <td className="max-w-0 py-1.5 pl-3 pr-4">
                    <span className="block truncate">
                      <StockName symbol={s} />
                    </span>
                  </td>
                  <td className="whitespace-nowrap py-1.5 pr-6 text-text-secondary">{isKrSymbol(s) ? '국내' : '미국'}</td>
                  <td className="whitespace-nowrap py-1.5 pr-6 text-text-secondary">{info.get(s) ? (info.get(s)!.sector ?? '기타') : '…'}</td>
                  <td className="py-1 pr-2 text-right">
                    <ListRemoveButton onClick={() => onChange(selected.filter((x) => x !== s))} name={s} label="목록에서 삭제" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {soft && softLimit != null && (
        <p className="text-caption text-danger">{softLimitText ? softLimitText(selected.length, softLimit) : `${softLimit}개까지 — 지금 ${selected.length}개`}</p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={() => setOpen(true)} className="shrink-0 whitespace-nowrap">
          종목 고르기
        </Button>
        {extraButtons}
      </div>

      {open && <PickerDialog {...props} added={added} onAddedChange={onAddedChange} onClose={() => setOpen(false)} />}
    </div>
  );
}
