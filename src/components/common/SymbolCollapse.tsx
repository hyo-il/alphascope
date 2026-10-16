import { useId, useState, type ReactNode } from 'react';
import { DisclosureButton } from '../ui';
import { useStockNames } from '../../hooks/useStockNames';

/**
 * 종목 목록 접기 (v2.46.0 자동매매 설정 → v2.48.0 공용 — 사용자 결정: 종목을 넣어 시험하는 곳 모두).
 * `SymbolTable` · `SymbolPicker` 의 `collapsible` 옵션이 이 껍데기를 쓴다.
 *
 * - 종목이 1개 이상이면 **접힌 한 줄 요약**(`N종목 — 앞 3개 이름 외 N개` + [펼치기])으로 연다. 0개면 펼친 채(빈 안내 + [종목 추가]).
 * - 펼치면 표·칩과 [종목 추가]. 펼침 상태는 기억하지 않는다(화면을 다시 열면 접힌 채).
 * - 목적: 종목이 많아도 아래 조건이 밀려 화면이 움직이지 않게. 요약 줄은 펼쳐도 그대로 둔다(숨기면 [접기] 혼자 빈 줄이 됐다 — v2.48.0 캡처 검토).
 */
export default function SymbolCollapse({ symbols, collapsible, children }: { symbols: string[]; collapsible?: boolean; children: ReactNode }) {
  const nameOfStock = useStockNames(collapsible ? symbols.slice(0, 3) : []);
  // 처음 열 때 종목이 있으면 접는다 — 0개면 펼친 채
  const [open, setOpen] = useState(() => !collapsible || symbols.length === 0);
  const bodyId = useId();
  if (!collapsible || symbols.length === 0) return <>{children}</>;
  const nameOf = (s: string) => nameOfStock(s) ?? s;
  const summary =
    symbols.length <= 3
      ? `${symbols.length}종목 — ${symbols.map(nameOf).join(', ')}`
      : `${symbols.length}종목 — ${symbols.slice(0, 3).map(nameOf).join(', ')} 외 ${symbols.length - 3}개`;
  return (
    <div className="space-y-2" data-symbol-collapse={open ? 'open' : 'closed'}>
      <div className="flex items-center gap-3">
        <p className="min-w-0 flex-1 truncate text-xs text-text-secondary" title={summary}>
          {summary}
        </p>
        <DisclosureButton open={open} onToggle={() => setOpen((v) => !v)} label="펼치기" controls={bodyId} />
      </div>
      {open && <div id={bodyId}>{children}</div>}
    </div>
  );
}
