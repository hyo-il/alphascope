import { useId, useState } from 'react';
import SymbolTable from '../common/SymbolTable';
import { DisclosureButton } from '../ui';
import { useStockNames } from '../../hooks/useStockNames';

/**
 * 자동매매 **대상 종목** 편집 — 설정 창 「② 대상 종목」 과 처음 켜기 안내 종목 단계가 **같은 컴포넌트**를 쓴다 (v2.32.0).
 *
 * - 종목 목록 표(`common/SymbolTable`, v2.44.0 — 종목 · 시장 · 분야) + 표 위 [종목 추가](관심 목록 전부 선택 · 분야 · 검색은 그 창 안).
 * - v2.44.2 에 [지금 살 만한가 추천 추가] · [종목 발굴] 창을 없앴다(사용자 결정 C-4) — 계좌가 대상 종목 전부를 매일 매매 규칙으로 판단하므로
 *   「사도 됨」 만 미리 골라 넣을 필요가 없다.
 * - `collapsible`(v2.46.0 — 자동매매 설정 창에만): 종목이 1개 이상이면 **접힌 한 줄 요약**(`N종목 — 앞 3개 이름 외 N개` + [펼치기])으로 연다.
 *   펼치면 표와 [종목 추가]. 0개면 펼친 채. 펼침 상태는 창을 닫으면 잊는다. 「최대 보유보다 많음」 안내는 접혀 있어도 보인다.
 */
export default function TargetSymbolsEditor({
  symbols,
  onChange,
  maxPositions,
  collapsible = false,
}: {
  symbols: string[];
  onChange: (symbols: string[]) => void;
  /** 동시에 들고 있을 최대 종목 수 — 대상이 이보다 많으면 한 줄로 알린다 */
  maxPositions: number;
  /** 접힌 한 줄 요약으로 열기(자동매매 설정 창) */
  collapsible?: boolean;
}) {
  const nameOfStock = useStockNames(symbols);
  // 처음 열 때 종목이 있으면 접는다 — 0개면 펼친 채(빈 안내 + [종목 추가])
  const [open, setOpen] = useState(() => !collapsible || symbols.length === 0);
  const bodyId = useId();
  const nameOf = (s: string) => nameOfStock(s) ?? s;
  const summary =
    symbols.length <= 3
      ? `${symbols.length}종목 — ${symbols.map(nameOf).join(', ')}`
      : `${symbols.length}종목 — ${symbols.slice(0, 3).map(nameOf).join(', ')} 외 ${symbols.length - 3}개`;

  return (
    <>
      {collapsible && symbols.length > 0 && (
        <div className="flex items-center gap-3">
          {/* 펼치면 요약 문장은 숨긴다 — 아래 표 도구 줄에 「N종목」 이 또 있다 */}
          <p className="min-w-0 flex-1 truncate text-xs text-text-secondary" title={open ? undefined : summary}>
            {open ? '' : summary}
          </p>
          <DisclosureButton open={open} onToggle={() => setOpen((v) => !v)} label="펼치기" controls={bodyId} />
        </div>
      )}
      {open && (
        <div id={bodyId}>
      <SymbolTable
        selected={symbols}
        onChange={onChange}
        dialogTitle="자동매매 대상 종목 추가"
        emptyText="아직 추가한 종목이 없습니다. [종목 추가] 로 넣으세요 — 종목이 없으면 자동매매를 켤 수 없습니다."
      />
        </div>
      )}
      {symbols.length > maxPositions && (
        <p className="text-caption text-text-secondary">
          대상 {symbols.length}종목 중 <b className="text-text-primary">동시에 최대 {maxPositions}종목</b>까지만 매수합니다(조건이 먼저 맞는
          순서).
        </p>
      )}
      <p className="text-caption text-text-muted">
        국내 종목은 국내 장(09:00~15:30)이, 미국 종목은 미국 장(한국 시간 밤 22:30 또는 23:30 부터)이 열린 뒤 종목마다 하루 한 번 판단합니다.
      </p>
    </>
  );
}
