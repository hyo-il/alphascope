import { useId, useRef, useState, type KeyboardEvent } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { ICON_SM, Popover } from '../ui';
import { CONTROL_H, TOUCH_FIELD_H, TOUCH_LIST_ROW } from '../ui/tokens';
import type { AssetCashBankGroup, AssetCashRowOption } from '../../types/asset';

/**
 * 「현금」 탭 계좌 고르기(v2.71.1 · 현금 자동 반영 설정의 **공용 부품 하나**) — 은행 묶음 머리(국민은행 · 키움증권 …) 아래 상품(입출금 · 청년 적금 · 정기 예금 #1 …).
 * - 닫힌 칸에는 은행까지 붙인 이름(「키움증권 · 적립식」 — 입출금 하나면 은행만) · 긴 이름은 말줄임 + 툴팁(`data-tip-clip`).
 * - 묶음은 부르는 쪽이 `cashBankGroups`(types/asset.ts — 서버와 같은 함수)로 만든다. 맨 위 고르기(월급 받는 계좌 따라감 · 정하지 않음 · 쓴 돈(밖으로))는 `extras`.
 * - 저장한 계좌가 시트에서 사라졌으면 빨간 「찾지 못함」(`lost`).
 * - 역할: 버튼(`aria-haspopup="listbox"`) → 목록(`role="listbox"` · 묶음 `role="group"` · 칸 `role="option"`) · ↑↓ 로 옮기고 Enter · ESC · 바깥 클릭으로 닫힌다.
 */
export interface PickerExtra {
  value: string;
  label: string;
  /** 닫힌 칸 글(없으면 label) */
  shown?: string;
}

export default function AssetCashAccountPicker({
  label,
  value,
  groups,
  idOf,
  extras = [],
  lost = null,
  disabled = false,
  onPick,
  width = 288,
  className = '',
}: {
  /** 화면 읽기용 이름(시험도 이 이름으로 찾는다) */
  label: string;
  /** 지금 값 — 계좌 id · extras 의 value · 빈 문자열(없음) */
  value: string;
  groups: AssetCashBankGroup<AssetCashRowOption>[];
  idOf: (r: AssetCashRowOption) => string;
  extras?: PickerExtra[];
  /** 저장했지만 시트에서 찾지 못한 계좌 글 */
  lost?: string | null;
  disabled?: boolean;
  onPick: (value: string) => void;
  /** 목록 폭(px) */
  width?: number;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const listId = useId();
  const extra = extras.find((x) => x.value === value);
  const item = groups.flatMap((g) => g.items).find((it) => idOf(it.row) === value);
  const shown = extra ? (extra.shown ?? extra.label) : item ? item.full : lost ? `${lost} — 찾지 못함` : '—';

  const pick = (v: string) => {
    setOpen(false);
    btn.current?.focus();
    if (v !== value) onPick(v);
  };
  const move = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const opts = [...(list.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])];
    const at = opts.indexOf(document.activeElement as HTMLButtonElement);
    const next = e.key === 'ArrowDown' ? Math.min(opts.length - 1, at + 1) : Math.max(0, at - 1);
    opts[next]?.focus();
  };
  const focusCurrent = () =>
    requestAnimationFrame(() => {
      const opts = [...(list.current?.querySelectorAll<HTMLButtonElement>('[role="option"]') ?? [])];
      (opts.find((o) => o.getAttribute('aria-selected') === 'true') ?? opts[0])?.focus();
    });

  const option = (v: string, text: string) => (
    <button
      key={v}
      type="button"
      role="option"
      aria-selected={v === value}
      className={`flex w-full min-w-0 items-center gap-2 rounded px-2 py-1 text-left text-xs text-text-primary hover:bg-bg-tertiary focus:bg-bg-tertiary focus:outline-none ${TOUCH_LIST_ROW}`}
      onClick={() => pick(v)}
    >
      <span className="inline-flex w-4 shrink-0 justify-center">{v === value && <Check {...ICON_SM} className="text-accent" />}</span>
      <span className="min-w-0 flex-1 truncate" data-tip-clip={text}>
        {text}
      </span>
    </button>
  );

  return (
    <>
      <button
        ref={btn}
        type="button"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        data-picker-value={value}
        disabled={disabled}
        onClick={() => {
          setOpen((o) => !o);
          focusCurrent();
        }}
        className={`flex min-w-0 items-center gap-1 rounded-md border border-transparent bg-bg-tertiary pr-1.5 pl-2 text-left text-xs focus:border-accent focus:outline-none disabled:opacity-50 ${CONTROL_H.sm} ${TOUCH_FIELD_H} ${lost && !extra && !item ? 'text-danger' : 'text-text-primary'} ${className}`}
        data-tone={lost && !extra && !item ? 'invalid' : undefined}
      >
        <span className="min-w-0 flex-1 truncate" data-tip-clip={shown}>
          {shown}
        </span>
        <ChevronDown {...ICON_SM} className="shrink-0 text-text-muted" />
      </button>
      {open && (
        <Popover anchorRef={btn} onClose={() => setOpen(false)} width={width} label={label}>
          <div ref={list} id={listId} role="listbox" aria-label={label} onKeyDown={move} className="max-h-72 space-y-1 overflow-y-auto p-1" data-testid="asset-cash-picker-list">
            {extras.length > 0 && (
              <div role="group" aria-label="기본" className="border-b border-border/40 pb-1">
                {extras.map((x) => option(x.value, x.label))}
              </div>
            )}
            {groups.map((g) => (
              <div key={g.bank} role="group" aria-label={g.bank} data-testid="asset-cash-picker-bank">
                <div className="truncate px-2 pt-1 text-caption font-medium text-text-secondary" data-tip-clip={g.bank}>
                  {g.bank}
                </div>
                {g.items.map((it) => option(idOf(it.row), it.label))}
              </div>
            ))}
          </div>
        </Popover>
      )}
    </>
  );
}
