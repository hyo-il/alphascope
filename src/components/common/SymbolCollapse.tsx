import { useId, useState, type ReactNode } from 'react';
import { DisclosureButton } from '../ui';
import { useStockNames } from '../../hooks/useStockNames';

/**
 * 종목 목록 접기 (공용 — 사용자 결정: 종목을 넣어 시험하는 곳 모두).
 * `SymbolTable` · `SymbolPicker` 의 `collapsible` 옵션이 이 껍데기를 쓴다.
 *
 * - 종목이 1개 이상이면 **접힌 한 줄 요약**(`N종목 — 앞 3개 이름 외 N개` + [펼치기])으로 연다. 0개면 펼친 채(빈 안내 + [종목 추가]).
 * - 펼치면 표·칩과 [종목 추가]. 펼침 상태는 기억하지 않는다(화면을 다시 열면 접힌 채). 0개에서 넣기 시작하면 펼친 채로 남는다.
 * - 목적: 종목이 많아도 아래 조건이 밀려 화면이 움직이지 않게. 요약 줄은 펼쳐도 그대로 둔다(숨기면 [접기] 혼자 빈 줄이 된다).
 */
export default function SymbolCollapse({ symbols, collapsible, children }: { symbols: string[]; collapsible?: boolean; children: ReactNode }) {
  const nameOfStock = useStockNames(collapsible ? symbols.slice(0, 3) : []);
  // 처음 열 때 종목이 있으면 접는다 — 0개면 펼친 채
  const [open, setOpen] = useState(() => !collapsible || symbols.length === 0);
  const bodyId = useId();
  const empty = symbols.length === 0;
  // 접힌 채 0개가 되면(바깥에서 목록을 비움) 펼침으로 — 그 뒤 넣기 시작해도 넣는 도중 접히지 않게
  if (collapsible && empty && !open) setOpen(true);
  if (!collapsible) return <>{children}</>;
  const nameOf = (s: string) => nameOfStock(s) ?? s;
  const summary =
    symbols.length <= 3
      ? `${symbols.length}종목 — ${symbols.map(nameOf).join(', ')}`
      : `${symbols.length}종목 — ${symbols.slice(0, 3).map(nameOf).join(', ')} 외 ${symbols.length - 3}개`;
  // ⚠️ children 은 종목 수와 상관없이 늘 같은 자리(바깥 칸의 두 번째)에 둔다 — 0↔1 에서 자리가 바뀌면 React 가 children 을
  // 새로 만들어 그 안의 「종목 추가」 창이 첫 종목을 넣자마자 닫힌다. 0개면 요약 줄만 빠진다.
  return (
    <div className="space-y-2" data-symbol-collapse={open || empty ? 'open' : 'closed'}>
      {!empty && (
        <div className="flex items-center gap-3">
          <p className="min-w-0 flex-1 truncate text-xs text-text-secondary" title={summary}>
            {summary}
          </p>
          <DisclosureButton open={open} onToggle={() => setOpen((v) => !v)} label="펼치기" controls={bodyId} />
        </div>
      )}
      {(open || empty) && <div id={bodyId}>{children}</div>}
    </div>
  );
}
