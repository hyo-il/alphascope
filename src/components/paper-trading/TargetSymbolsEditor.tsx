import { Button } from '../ui';
import { useState } from 'react';
import SymbolPicker from '../common/SymbolPicker';
import DiscoverSymbolsModal from './DiscoverSymbolsModal';
import { savedSwingPicks } from './discoverSources';
import { useStockNames } from '../../hooks/useStockNames';
import { useWatchlist } from '../../hooks/useWatchlist';
import { useStrategyProfile } from '../../hooks/useStrategyProfile';
import { PROFILE_LABEL, type ProfileId } from '../../types/strategyProfile';
import { isKrSymbol } from '../../utils/market';
import { toast } from '../../store/uiStore';

/**
 * 자동매매 **대상 종목** 편집 — 설정 창 「② 대상 종목」 과 처음 켜기 안내 3단계가 **같은 컴포넌트**를 쓴다 (v2.32.0).
 *
 * - 공용 「종목 고르기」(v2.41.0 — 관심 목록 폴더별 일부·분야·검색) · [지금 살 만한가 추천 추가] · [종목 발굴] 팝업.
 * - 추천 추가 버튼은 발굴 팝업의 두 소스와 **같은 함수·같은 기본 기준**이다(`discoverSources.ts`) — 거르는 코드를 두 벌 두지 않는다.
 * - 담는 방식은 하나(중복 제거) — 이미 있던 종목은 세어서 알린다.
 */
export default function TargetSymbolsEditor({
  symbols,
  onChange,
  maxPositions,
  marketHoursOnly,
}: {
  symbols: string[];
  onChange: (symbols: string[]) => void;
  /** 동시에 들고 있을 최대 종목 수 — 대상이 이보다 많으면 한 줄로 알린다 */
  maxPositions: number;
  /** 미국 정규장에만 판단하는가 — 국내 종목 안내는 이때만 띄운다 */
  marketHoursOnly: boolean;
}) {
  const [discoverOpen, setDiscoverOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const { watchlist } = useWatchlist();
  const profile = useStrategyProfile();
  useStockNames(symbols);

  const activeId: ProfileId = profile.state?.active ?? 'standard';
  const activeParams = profile.state
    ? activeId === 'standard'
      ? profile.state.standard
      : profile.state.custom[activeId]
    : null;
  /** 발굴 팝업과 같은 기본 문턱 — 지금 프로파일의 BUY 컷 */
  const swingBuyCut = activeParams?.grades.buy ?? 65;

  /** 중복을 빼고 담는다 — 토스트에 새로 담은 수와 이미 있던 수를 함께 적는다 */
  const addSymbols = (incoming: string[], source: string, extra?: string) => {
    const upper = [...new Set(incoming.map((s) => s.toUpperCase()))];
    const merged = [...new Set([...symbols, ...upper])];
    const added = merged.length - symbols.length;
    const existing = upper.length - added;
    onChange(merged);
    const tail = existing > 0 ? `(이미 있던 ${existing}종목 제외)` : '';
    if (added) toast.success(`${source}에서 ${added}종목을 추가했습니다${tail}`, extra);
    else toast.info(`${source}에서 새로 추가할 종목이 없습니다${tail}`, extra);
  };

  const addSwing = async () => {
    setBusy(true);
    try {
      const picks = await savedSwingPicks(swingBuyCut);
      if (picks.empty) {
        toast.info('저장된 「지금 살 만한가」 결과가 없습니다 — [종목 발굴]에서 다시 실행하세요');
        return;
      }
      const basis = `기준: ${PROFILE_LABEL[activeId]} BUY 컷 ${swingBuyCut}점 이상 · STRONG/BUY`;
      // 불러온 추천이 다른 기준으로 나왔으면 그 사실만 알린다(여기서 다시 채점하지 않는다 — 팝업과 같다)
      const other =
        picks.profile && picks.profile !== activeId
          ? ` · 이 추천은 '${PROFILE_LABEL[picks.profile]}' 기준으로 나왔습니다`
          : '';
      if (!picks.symbols.length) {
        toast.info(
          '기준을 통과한 「지금 살 만한가」 종목이 없습니다',
          `전체 ${picks.stats.total}건 · 점수 미달 ${picks.stats.failScore} · 등급 제외 ${picks.stats.failGrade}${other}`,
        );
        return;
      }
      addSymbols(picks.symbols, '지금 살 만한가', basis + other);
    } catch (e) {
      toast.error('「지금 살 만한가」 결과를 불러오지 못했습니다', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const krCount = symbols.filter(isKrSymbol).length;

  return (
    <>
      {/*
        ⚠️ 발굴은 **팝업**을 연다(기준 → 탐지 → 근거 → 선택). [지금 살 만한가 추천 추가] 는 그 팝업의 **기본 기준 그대로**를
        한 번에 추가한다 — 무엇이 왜 추가되는지는 [종목 발굴] 에서 볼 수 있다. 관심 목록(폴더별 일부만)·검색은 [종목 고르기] 창 안에 있다.
      */}
      <SymbolPicker
        selected={symbols}
        onChange={onChange}
        dialogTitle="자동매매 대상 종목 고르기"
        emptyText="추가한 종목이 없습니다. 종목이 없으면 자동매매를 켤 수 없습니다."
        extraButtons={
          <>
            <Button size="sm" onClick={() => void addSwing()} disabled={busy} className="shrink-0 whitespace-nowrap">
              {busy ? '불러오는 중…' : '지금 살 만한가 추천 추가'}
            </Button>
            <Button size="sm" onClick={() => setDiscoverOpen(true)} className="shrink-0 whitespace-nowrap">
              종목 발굴
            </Button>
          </>
        }
      />
      <p className="text-[13px] text-text-muted">
        지금 살 만한가 추천 추가 = 「매수 판단 도우미 &gt; 지금 살 만한가」 에 마지막으로 저장된 결과 중 지금 기준({PROFILE_LABEL[activeId]} {swingBuyCut}점 이상 ·
        STRONG/BUY · 최대 10개). 근거를 보고 고르려면 [종목 발굴](지금 살 만한가·관심 목록).
      </p>

      {symbols.length > maxPositions && (
        <p className="text-[13px] text-text-secondary">
          대상 {symbols.length}종목 중 <b className="text-text-primary">동시에 최대 {maxPositions}종목</b>까지만 매수합니다(조건이 먼저 맞는
          순서).
        </p>
      )}
      {/*
        ⚠️ 동작은 바꾸지 않고 사실만 알린다 — 스케줄러의 시간 판정은 `isUsMarketOpen()` 하나라 국내 종목도
        미국 정규장 시간(한국 시간 밤)에 판단하고, 모의 시장가 주문은 장 시간을 보지 않아 그때의 마지막 가격으로 체결된다.
      */}
      {krCount > 0 && marketHoursOnly && (
        <p className="text-[13px] text-warning">
          국내 종목 {krCount}개가 섞여 있습니다 — 자동매매는 <b>미국 정규장 시간(한국 시간 밤)</b>에만 판단하므로, 국내 종목도 국내
          장이 닫힌 그 시간에 마지막 가격으로 판단·체결됩니다.
        </p>
      )}

      {discoverOpen && (
        <DiscoverSymbolsModal
          watchlist={watchlist}
          alreadyAdded={symbols}
          onAdd={(list, source) => addSymbols(list, source)}
          onClose={() => setDiscoverOpen(false)}
        />
      )}
    </>
  );
}
