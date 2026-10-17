import { useState } from 'react';
import { Plus } from 'lucide-react';
import { PickerDialog, usePickerAdded, type SymbolPickerProps } from './SymbolPicker';
import { Button, RemoveAllButton } from '../ui';

/**
 * 종목 목록 **위 도구 줄** — [＋ 종목 추가] · N종목 · [모두 삭제] + 같은 「종목 추가」 창(`PickerDialog`).
 * 종목 표(`SymbolTable` — 계좌 ② · 백테스트 ①)와 매수 판단 표가 같은 줄을 쓴다 — 순서·모양이 화면마다 갈라지지 않게.
 */
export default function SymbolListBar(props: Omit<SymbolPickerProps, 'title'> & { disabled?: boolean }) {
  const { selected, onChange, max, disabled = false } = props;
  const [open, setOpen] = useState(false);
  const [ownAdded, setOwnAdded] = useState<string[]>([]);
  const { added, onAddedChange } = usePickerAdded(selected, props.added, props.onAddedChange, ownAdded, setOwnAdded);
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" icon={Plus} onClick={() => setOpen(true)} disabled={disabled} className="shrink-0 whitespace-nowrap">
          종목 추가
        </Button>
        <span className="ml-auto flex shrink-0 items-center gap-2">
          <span className="text-caption text-text-muted tabular-nums">
            {selected.length}종목{max != null ? ` / 최대 ${max}종목` : ''}
          </span>
          {selected.length > 0 && <RemoveAllButton onClick={() => onChange([])} disabled={disabled} />}
        </span>
      </div>
      {open && <PickerDialog {...props} added={added} onAddedChange={onAddedChange} onClose={() => setOpen(false)} />}
    </>
  );
}
