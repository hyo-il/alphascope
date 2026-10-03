import { useState } from 'react';
import SymbolSearch from '../common/SymbolSearch';
import StockName from '../common/StockName';
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
 * - 검색으로 하나씩 · [★ 관심 목록 전부 담기] · [📈 스윙 추천 담기] · [🔎 종목 발굴] 팝업.
 * - 두 빠른 버튼은 발굴 팝업의 두 소스와 **같은 함수·같은 기본 기준**이다(`discoverSources.ts`) — 거르는 코드를 두 벌 두지 않는다.
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
    if (added) toast.success(`${source}에서 ${added}종목을 담았습니다${tail}`, extra);
    else toast.info(`${source}에서 새로 담을 종목이 없습니다${tail}`, extra);
  };

  const addWatchlist = () => {
    if (!watchlist.length) {
      toast.info('관심 목록이 비어 있습니다', '관심 목록에 종목을 먼저 담아 주세요');
      return;
    }
    // 발굴 팝업의 「★ 관심 목록」 소스와 같다 — 기준 없이 전부
    addSymbols(watchlist, '관심 목록');
  };

  const addSwing = async () => {
    setBusy(true);
    try {
      const picks = await savedSwingPicks(swingBuyCut);
      if (picks.empty) {
        toast.info('저장된 스윙 추천이 없습니다 — [🔎 종목 발굴]에서 다시 분석하세요');
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
          '기준을 통과한 스윙 추천이 없습니다',
          `전체 ${picks.stats.total}건 · 점수 미달 ${picks.stats.failScore} · 등급 제외 ${picks.stats.failGrade}${other}`,
        );
        return;
      }
      addSymbols(picks.symbols, '스윙 추천', basis + other);
    } catch (e) {
      toast.error('스윙 추천을 불러오지 못했습니다', (e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const krCount = symbols.filter(isKrSymbol).length;

  return (
    <>
      <SymbolSearch
        symbol=""
        onSubmit={(s) => addSymbols([s], '검색')}
        placeholder="종목 검색해 담기 (애플, AAPL…)"
        submitLabel="담기"
        compact
        clearOnSubmit
        dropUp={false}
        isAdded={(candidate) => symbols.includes(candidate)}
      />

      {/*
        ⚠️ 발굴은 **팝업**을 연다(기준 → 탐지 → 근거 → 선택). 빠른 버튼 두 개는 그 팝업의 **기본 기준 그대로**를
        한 번에 담는다 — 무엇이 왜 담기는지는 [🔎 종목 발굴] 에서 볼 수 있다.
      */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={addWatchlist}
          className="rounded-md border border-border px-3 py-1 text-[13px] text-text-secondary transition-colors hover:border-accent hover:text-accent"
        >
          ★ 관심 목록 전부 담기
        </button>
        <button
          type="button"
          onClick={() => void addSwing()}
          disabled={busy}
          className="rounded-md border border-border px-3 py-1 text-[13px] text-text-secondary transition-colors hover:border-accent hover:text-accent disabled:opacity-50"
        >
          {busy ? '불러오는 중…' : '📈 스윙 추천 담기'}
        </button>
        <button
          type="button"
          onClick={() => setDiscoverOpen(true)}
          className="rounded-md border border-border px-3 py-1 text-[13px] text-text-secondary transition-colors hover:border-accent hover:text-accent"
        >
          🔎 종목 발굴 (스윙·관심 목록)
        </button>
      </div>
      <p className="text-[13px] text-text-muted">
        스윙 추천 담기 = 스윙 화면에 마지막으로 저장된 추천 중 지금 기준({PROFILE_LABEL[activeId]} {swingBuyCut}점 이상 ·
        STRONG/BUY · 최대 10개). 근거를 보고 고르려면 [🔎 종목 발굴].
      </p>

      {symbols.length === 0 ? (
        <p className="rounded border border-border bg-bg-tertiary/40 px-3 py-3 text-center text-[13px] text-text-muted">
          담긴 종목이 없습니다. 종목이 없으면 자동매매를 켤 수 없습니다.
        </p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {symbols.map((symbol) => (
            <span
              key={symbol}
              className="flex items-center gap-1 rounded-full border border-border bg-bg-tertiary/60 py-0.5 pl-2 pr-1 text-[13px]"
            >
              <StockName symbol={symbol} size="sm" className="text-text-primary" />
              <button
                type="button"
                onClick={() => onChange(symbols.filter((s) => s !== symbol))}
                aria-label={`${symbol} 빼기`}
                className="rounded px-1 text-text-muted transition-colors hover:text-bearish"
              >
                ✕
              </button>
            </span>
          ))}
        </div>
      )}

      {symbols.length > maxPositions && (
        <p className="text-[13px] text-text-secondary">
          대상 {symbols.length}종목 중 <b className="text-text-primary">동시에 최대 {maxPositions}종목</b>까지만 삽니다(조건이 먼저 맞는
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
