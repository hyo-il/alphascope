import SymbolTable from '../common/SymbolTable';
import { useStockNames } from '../../hooks/useStockNames';

/**
 * 자동매매 **대상 종목** 편집 — 설정 창 「② 대상 종목」 과 처음 켜기 안내 종목 단계가 **같은 컴포넌트**를 쓴다 (v2.32.0).
 *
 * - 종목 목록 표(`common/SymbolTable`, v2.44.0 — 종목 · 시장 · 분야) + 표 위 [종목 추가](관심 목록 전부 선택 · 분야 · 검색은 그 창 안).
 * - v2.44.2 에 [지금 살 만한가 추천 추가] · [종목 발굴] 창을 없앴다(사용자 결정 C-4) — 계좌가 대상 종목 전부를 매일 매매 규칙으로 판단하므로
 *   「사도 됨」 만 미리 골라 넣을 필요가 없다.
 */
export default function TargetSymbolsEditor({
  symbols,
  onChange,
  maxPositions,
}: {
  symbols: string[];
  onChange: (symbols: string[]) => void;
  /** 동시에 들고 있을 최대 종목 수 — 대상이 이보다 많으면 한 줄로 알린다 */
  maxPositions: number;
}) {
  useStockNames(symbols);

  return (
    <>
      <SymbolTable
        selected={symbols}
        onChange={onChange}
        dialogTitle="자동매매 대상 종목 추가"
        emptyText="아직 추가한 종목이 없습니다. 종목이 없으면 자동매매를 켤 수 없습니다."
      />
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
