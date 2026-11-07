import { useMemo, useState } from 'react';
import { Check, Plus } from 'lucide-react';
import { Button, Dialog, ListRemoveButton, RemoveAllButton } from '../ui';
import { ICON_SM } from '../ui/icon';
import { LIST_TABLE_ROW, TABLE_NAME_COL } from '../ui/tokens';

/**
 * 계좌 목록 표 + [계좌 추가] (v2.62.2 · 자산 관리 「연금으로 볼 계좌」) — 종목 표(`common/SymbolTable`)와 **같은 모양 · 같은 흐름**:
 * 표 위 도구 줄 [＋ 계좌 추가] … N계좌 · [모두 삭제] / 표(계좌 · 목록에서 삭제 ×) / 비었을 때 한 줄.
 * [계좌 추가] 창 = 아직 표에 없는 시트 계좌만 — 여러 개 골라 [추가] 를 눌러야 `onChange` 를 한 번 부른다([취소] · ESC 는 버림 · 바깥을 눌러도 닫히지 않음).
 * 종목 부품(종목 이름 · 티커 · 관심 목록)이 계좌에는 맞지 않아 따로 두었다 — 글자 · 줄 높이 · 버튼 이름은 종목 표와 같다.
 */
export interface AccountChoice {
  key: string;
  /** 시트 이름 그대로(「( 날짜 )」 포함) */
  name: string;
}

export default function AssetAccountTable({
  accounts,
  selected,
  onChange,
  emptyText,
  dialogTitle,
}: {
  /** 시트 계좌(시트 순서) — 표 · 창 모두 이 순서 */
  accounts: AccountChoice[];
  selected: string[];
  onChange: (next: string[]) => void;
  emptyText: string;
  dialogTitle: string;
}) {
  const [open, setOpen] = useState(false);
  const nameOf = (key: string) => accounts.find((a) => a.key === key)?.name ?? key;
  /** 시트 순서로 */
  const ordered = (keys: string[]) => [...accounts.map((a) => a.key).filter((k) => keys.includes(k)), ...keys.filter((k) => !accounts.some((a) => a.key === k))];
  const rows = ordered(selected);
  return (
    <div className="space-y-2" data-account-table>
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" icon={Plus} onClick={() => setOpen(true)} className="shrink-0 whitespace-nowrap">
          계좌 추가
        </Button>
        <span className="ml-auto flex shrink-0 items-center gap-2">
          <span className="text-caption text-text-muted tabular-nums">{selected.length}계좌</span>
          {selected.length > 0 && <RemoveAllButton onClick={() => onChange([])} />}
        </span>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-lg bg-bg-tertiary/40 px-3 py-3 text-xs text-text-muted keep-all">{emptyText}</p>
      ) : (
        <div className="rounded-lg bg-bg-tertiary/40">
          <table className="w-full text-left text-xs">
            <thead className="bg-bg-secondary text-caption text-text-muted">
              <tr className="border-b border-border/50">
                <th className={`${TABLE_NAME_COL} py-2 pl-3 pr-4`}>계좌</th>
                <th className="py-2 pr-2" aria-label="목록에서 삭제" />
              </tr>
            </thead>
            <tbody>
              {rows.map((k) => (
                <tr key={k} className={`border-b border-border/30 last:border-b-0 ${LIST_TABLE_ROW}`}>
                  <td className="max-w-0 py-1.5 pl-3 pr-4">
                    <span className="block truncate font-medium text-text-primary" title={nameOf(k)}>
                      {nameOf(k)}
                    </span>
                  </td>
                  <td className="py-1.5 pr-2 text-right">
                    <ListRemoveButton onClick={() => onChange(selected.filter((x) => x !== k))} name={nameOf(k)} label="목록에서 삭제" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {open && (
        <AccountPickerDialog
          title={dialogTitle}
          choices={accounts.filter((a) => !selected.includes(a.key))}
          onAdd={(keys) => onChange(ordered([...selected, ...keys]))}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}

/** [계좌 추가] 창 — 아직 없는 계좌만 · 누르면 고름(체크) · [추가] 때 한 번 */
function AccountPickerDialog({ title, choices, onAdd, onClose }: { title: string; choices: AccountChoice[]; onAdd: (keys: string[]) => void; onClose: () => void }) {
  const [picked, setPicked] = useState<string[]>([]);
  const sel = useMemo(() => new Set(picked), [picked]);
  const toggle = (k: string) => setPicked((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]));
  return (
    <Dialog
      title={title}
      titleAside="고른 뒤 [추가] 를 누르면 한 번에 반영됩니다"
      onClose={onClose}
      closeOnBackdrop={false}
      size="md"
      z={98}
      bodyClassName="p-3"
      footer={
        <>
          <span className="mr-auto text-caption text-text-muted tabular-nums" aria-live="polite">
            {picked.length > 0 ? `${picked.length}계좌 추가` : '바뀐 것이 없습니다'}
          </span>
          <Button onClick={onClose}>취소</Button>
          <Button
            variant="primary"
            disabled={picked.length === 0}
            onClick={() => {
              if (picked.length === 0) return;
              onAdd(picked);
              onClose();
            }}
          >
            추가
          </Button>
        </>
      }
    >
      <div data-account-picker>
        <p className="px-1 py-1 text-xs font-medium text-text-secondary">
          시트 계좌 <span className="text-text-muted">{choices.length}</span>
        </p>
        {choices.length === 0 ? (
          <p className="px-2 py-1.5 text-caption text-text-muted keep-all">더 넣을 수 있는 계좌가 없습니다 — 시트의 계좌가 모두 표에 있습니다.</p>
        ) : (
          <ul data-list className="space-y-1">
            {choices.map((a) => {
              const on = sel.has(a.key);
              return (
                <li key={a.key}>
                  <button
                    type="button"
                    onClick={() => toggle(a.key)}
                    aria-pressed={on}
                    className={`flex min-h-9 w-full min-w-0 items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors ${on ? 'bg-bg-elevated text-text-primary' : 'hover:bg-bg-tertiary'}`}
                  >
                    <span className={`flex h-4 w-4 shrink-0 items-center justify-center ${on ? 'text-text-primary' : 'text-transparent'}`}>
                      <Check {...ICON_SM} aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1 truncate font-medium" title={a.name}>
                      {a.name}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Dialog>
  );
}
