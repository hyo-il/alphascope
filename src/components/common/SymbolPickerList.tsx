import { useEffect, useState } from 'react';
import { useStockNames } from '../../hooks/useStockNames';

/**
 * 여러 종목을 체크해서 한 번에 담는 목록.
 *
 * 관심 목록·최근 조회처럼 **이미 사용자가 고른 종목 뭉치**를 분석 대상으로 옮길 때 쓴다.
 * 하나씩 검색해 담게 하면 관심 목록에 10개가 있을 때 열 번을 반복해야 한다.
 *
 * 이미 담긴 종목은 체크된 채로 비활성 — 무엇이 이미 들어가 있는지 보이면서도
 * 실수로 중복을 만들 수 없다.
 */
export default function SymbolPickerList({
  title,
  candidates,
  /** 이미 분석 대상에 담긴 종목 */
  already,
  onAdd,
  onCancel,
  emptyMessage,
}: {
  title: string;
  candidates: string[];
  already: string[];
  onAdd: (symbols: string[]) => void;
  onCancel: () => void;
  emptyMessage: string;
}) {
  const selectable = candidates.filter((symbol) => !already.includes(symbol));
  const [checked, setChecked] = useState<string[]>([]);
  const names = useStockNames(candidates);

  // 목록이 바뀌면(관심 목록 → 최근 조회 전환 등) 선택을 비운다.
  useEffect(() => {
    setChecked([]);
  }, [title, candidates.join(',')]);

  const toggle = (symbol: string) =>
    setChecked((prev) =>
      prev.includes(symbol) ? prev.filter((item) => item !== symbol) : [...prev, symbol],
    );

  const allChecked = selectable.length > 0 && checked.length === selectable.length;

  return (
    <div className="rounded-lg border border-border bg-bg-primary p-3">
      <div className="mb-2 flex items-center gap-2">
        <p className="text-xs font-medium text-text-primary">{title}</p>
        <span className="text-[11px] text-text-muted">
          {candidates.length}종목 · 담을 수 있는 것 {selectable.length}개
        </span>
      </div>

      {candidates.length === 0 ? (
        <p className="py-3 text-center text-xs text-text-muted">{emptyMessage}</p>
      ) : (
        <ul className="max-h-56 space-y-0.5 overflow-y-auto">
          {candidates.map((symbol) => {
            const isAlready = already.includes(symbol);
            return (
              <li key={symbol}>
                <label
                  className={`flex items-center gap-2 rounded px-2 py-1.5 text-xs ${
                    isAlready ? 'text-text-muted' : 'text-text-primary hover:bg-bg-tertiary'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={isAlready || checked.includes(symbol)}
                    disabled={isAlready}
                    onChange={() => toggle(symbol)}
                  />
                  <span className="font-medium tabular-nums">{symbol}</span>
                  {names(symbol) && (
                    <span className="truncate text-text-secondary">{names(symbol)}</span>
                  )}
                  {isAlready && <span className="ml-auto shrink-0 text-[10px]">이미 추가됨</span>}
                </label>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-2 flex flex-wrap gap-2 border-t border-border pt-2">
        <button
          type="button"
          onClick={() => onAdd(checked)}
          disabled={checked.length === 0}
          className="rounded bg-accent px-2.5 py-1 text-xs text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
        >
          선택한 종목 추가 ({checked.length})
        </button>
        <button
          type="button"
          onClick={() => setChecked(allChecked ? [] : selectable)}
          disabled={selectable.length === 0}
          className="rounded border border-border px-2.5 py-1 text-xs text-text-secondary transition-colors hover:bg-bg-tertiary disabled:opacity-40"
        >
          {allChecked ? '선택 해제' : '전체 선택'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="ml-auto rounded px-2.5 py-1 text-xs text-text-muted transition-colors hover:text-text-primary"
        >
          취소
        </button>
      </div>
    </div>
  );
}
