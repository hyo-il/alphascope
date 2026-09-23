import { useState } from 'react';
import SymbolSearch from '../common/SymbolSearch';
import WatchFolderView from './WatchFolderView';
import WatchlistManager from './WatchlistManager';
import TrashIcon from '../common/TrashIcon';
import type { useWatchlist } from '../../hooks/useWatchlist';
import { DEFAULT_FOLDER_ID } from '../../types/watchlist';
import { useQuotes } from '../../hooks/useQuotes';
import { useStockNames } from '../../hooks/useStockNames';
import { COMPARE_DRAG_TYPE } from '../../types/compare';
import { formatPercent, formatPrice } from '../../utils/formatters';
import { usePaperAccounts, usePaperAccountDetail } from '../../hooks/usePaperTrading';
import { useAutoTradeStatusOnly } from '../../hooks/useAutoTrading';
import AccountMiniView from './AccountMiniView';

interface Props {
  currentSymbol: string;
  /** `useWatchlist()` 결과 그대로 — 폴더 조작이 많아 통째로 받는다 */
  watch: ReturnType<typeof useWatchlist>;
  recent: string[];
  onSelect: (symbol: string) => void;
  /** 최근 조회에서 제거 */
  onRemoveRecent: (symbol: string) => void;
  /** 계좌 탭에서 '계좌 관리로 이동' — 계좌가 하나도 없을 때의 진입점 */
  onGoToAccounts: () => void;
  /** 최근 조회 전체 비우기 — forEach 로 N번 지우면 setState 가 그만큼 연쇄된다 */
  onClearRecent: () => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  /**
   * 기업 비교 화면에서는 클릭의 뜻이 달라진다 — 차트 전환이 아니라 비교에 담기/빼기다.
   * 비교는 검색이 아니라 **관심 목록에서 고르는 것이 기본 방법**이라 패널이 그 자리를 맡는다.
   */
  compareMode?: boolean;
  /** 지금 비교 중인 종목 — ✓ 와 배경색으로 표시한다 */
  compareSymbols?: string[];
}

type PanelTab = 'watch' | 'recent' | 'account';

/** 별 아이콘 — 관심 목록을 뜻한다 */
function StarIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="currentColor" className={className} aria-hidden>
      <path d="M10 1.6l2.47 5.3 5.53.68-4.09 3.9 1.06 5.72L10 14.5l-4.97 2.7 1.06-5.72L2 7.58l5.53-.68L10 1.6z" />
    </svg>
  );
}

/** 시계 아이콘 — 최근 조회를 뜻한다 */
function ClockIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" className={className} aria-hidden>
      <circle cx="10" cy="10" r="7.5" />
      <path d="M10 5.5V10l3 2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 지갑 아이콘 — 계좌를 뜻한다 */
function WalletIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6" className={className} aria-hidden>
      <rect x="2" y="5" width="16" height="12" rx="2" />
      <path d="M2 5V4.5A1.5 1.5 0 013.5 3h10A1.5 1.5 0 0115 4.5V5" />
      <circle cx="14.5" cy="11" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** 오른쪽 사이드 패널 — 관심 목록과 최근 조회. 클릭하면 즉시 그 종목 차트로 전환된다. */
export default function WatchPanel({
  currentSymbol,
  watch,
  recent,
  onSelect,
  onRemoveRecent,
  onClearRecent,
  onGoToAccounts,
  collapsed,
  onToggleCollapse,
  compareMode = false,
  compareSymbols = [],
}: Props) {
  const [tab, setTab] = useState<PanelTab>('watch');
  /** 관리 팝업 — 폴더·종목 조작은 전부 저기서 한다 */
  const [managing, setManaging] = useState(false);

  /*
   * 계좌 탭용 — 모의투자 계좌 요약.
   * ⚠️ 상세 조회는 **1초 폴링**이다. 접혀 있거나 다른 탭을 보고 있으면 부르지 않는다 —
   * 보이지 않는 패널에 Rate Limit 을 쓰지 않는다는 규칙(호가·빠른주문과 같다).
   * 계좌 목록은 폴링이 아니라 1회 조회라 그대로 둔다 (탭을 열자마자 채워져 있어야 한다).
   */
  const paperAccounts = usePaperAccounts();
  const accountTabActive = !collapsed && tab === 'account';
  const paperDetail = usePaperAccountDetail(
    accountTabActive ? paperAccounts.selectedId : null,
  );
  /*
   * 계좌명 옆 자동매매 점 — 15초다 (상세는 1초).
   * ⚠️ 새 폴링을 만들지 않는다. 탭이 보일 때만 돌고, 같은 `accountTabActive` 가드를 쓴다.
   */
  const paperAuto = useAutoTradeStatusOnly(paperAccounts.selectedId, accountTabActive);

  const { folders, watchlist, visibleSymbols } = watch;

  /*
   * 폴링 대상은 **펼쳐진 폴더의 종목뿐**이다. 접어 둔 폴더까지 1초마다 받아 오면
   * 보지도 않는 값에 Rate Limit 을 쓴다.
   */
  const symbols = tab === 'watch' ? visibleSymbols : recent;
  const quotes = useQuotes(collapsed ? [] : symbols);
  // 티커만 있으면 어떤 종목인지 바로 떠오르지 않는다 — 이름을 함께 적는다.
  const names = useStockNames(collapsed ? [] : symbols);

  // 접힌 상태 — 눈에 띄는 세로 탭. 세로 텍스트로 정체가 바로 드러난다.
  if (collapsed) {
    return (
      <button
        type="button"
        onClick={onToggleCollapse}
        title="관심 목록 열기"
        className="group flex w-9 shrink-0 flex-col items-center gap-2 border-l border-border bg-bg-secondary py-3 transition-colors hover:bg-bg-tertiary"
      >
        <span className="flex h-6 w-6 items-center justify-center rounded text-base text-text-secondary transition-colors group-hover:bg-bg-tertiary group-hover:text-text-primary">
          ‹
        </span>

        <span className="flex flex-col items-center gap-0.5 text-warning">
          <StarIcon className="h-5 w-5" />
          <span className="text-[10px] tabular-nums text-text-secondary">{watchlist.length}</span>
        </span>

        <span
          className="text-[11px] leading-tight tracking-widest text-text-secondary transition-colors group-hover:text-text-primary"
          style={{ writingMode: 'vertical-rl' }}
        >
          관심
        </span>

        <span className="my-0.5 h-px w-4 bg-border" />

        <span className="flex flex-col items-center gap-0.5 text-text-muted">
          <ClockIcon className="h-5 w-5" />
          <span className="text-[10px] tabular-nums text-text-secondary">{recent.length}</span>
        </span>

        <span
          className="text-[11px] leading-tight tracking-widest text-text-secondary transition-colors group-hover:text-text-primary"
          style={{ writingMode: 'vertical-rl' }}
        >
          최근
        </span>

        <span className="my-0.5 h-px w-4 bg-border" />

        <span className="flex flex-col items-center gap-0.5 text-text-muted">
          <WalletIcon className="h-5 w-5" />
        </span>

        <span
          className="text-[11px] leading-tight tracking-widest text-text-secondary transition-colors group-hover:text-text-primary"
          style={{ writingMode: 'vertical-rl' }}
        >
          계좌
        </span>
      </button>
    );
  }

  return (
    <aside className="flex w-[250px] shrink-0 flex-col border-l border-border bg-bg-secondary">
      <div className="flex items-center border-b border-border">
        {(
          [
            /*
             * ⚠️ 탭이 셋이 되면서 라벨을 줄였다. 250px 패널에서 ⚙️·접기 버튼을 빼면
             * 탭 하나에 70px 남짓인데, "관심 목록"(text-xs 5자)은 아이콘까지 78px 라
             * 줄바꿈이 났다. 아이콘이 이미 뜻을 나르므로 두 글자로 충분하다.
             */
            ['watch', '관심', <StarIcon key="s" className="h-3 w-3" />],
            ['recent', '최근', <ClockIcon key="c" className="h-3 w-3" />],
            ['account', '계좌', <WalletIcon key="w" className="h-3 w-3" />],
          ] as const
        ).map(([id, label, icon]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            title={id === 'watch' ? '관심 목록' : id === 'recent' ? '최근 조회' : '모의투자 계좌'}
            className={`flex flex-1 items-center justify-center gap-1.5 border-b-2 py-2 text-xs transition-colors ${
              tab === id
                ? 'border-accent text-text-primary'
                : 'border-transparent text-text-secondary hover:text-text-primary'
            }`}
          >
            {icon}
            {label}
          </button>
        ))}
        {tab === 'watch' && (
          <button
            type="button"
            onClick={() => setManaging(true)}
            title="관심 목록 관리 (폴더·순서)"
            className="px-1.5 text-sm text-text-muted transition-colors hover:text-text-primary"
          >
            ⚙️
          </button>
        )}
        <button
          type="button"
          onClick={onToggleCollapse}
          title="접기"
          className="px-2 text-xs text-text-muted transition-colors hover:text-text-primary"
        >
          ›
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {tab === 'account' ? (
          <AccountMiniView
            accounts={paperAccounts.accounts}
            selectedId={paperAccounts.selectedId}
            onSelectAccount={paperAccounts.select}
            detail={paperDetail.detail}
            loading={paperAccounts.loading}
            error={paperAccounts.error ?? paperDetail.error}
            currentSymbol={currentSymbol}
            onSelectSymbol={onSelect}
            onGoToAccounts={onGoToAccounts}
            strategy={paperAuto.strategy}
            status={paperAuto.status}
          />
        ) : tab === 'watch' ? (
          folders.map((folder) => (
            <WatchFolderView
              key={folder.id}
              folder={folder}
              currentSymbol={currentSymbol}
              quotes={quotes}
              nameOf={names}
              onSelect={onSelect}
              onToggle={watch.toggleFolder}
              onRemoveSymbol={watch.remove}
              compareMode={compareMode}
              selectedSymbols={compareSymbols}
            />
          ))
        ) : recent.length === 0 ? (
          <p className="px-3 py-6 text-center text-xs text-text-muted">
            최근 조회한 종목이 없습니다.
          </p>
        ) : (
          recent.map((symbol) => {
            const quote = quotes[symbol];
            const rate = quote?.changeRate ?? null;
            const color =
              rate == null
                ? 'text-text-muted'
                : rate > 0
                  ? 'text-bullish'
                  : rate < 0
                    ? 'text-bearish'
                    : 'text-text-secondary';

            const picked = compareMode && compareSymbols.includes(symbol);
            const highlighted = compareMode ? picked : symbol === currentSymbol;

            return (
              <div
                key={symbol}
                className={`group flex items-center transition-colors hover:bg-bg-tertiary/60 ${
                  highlighted ? 'bg-accent/10' : ''
                }`}
              >
                <button
                  type="button"
                  onClick={() => onSelect(symbol)}
                  draggable={compareMode}
                  onDragStart={(e) => {
                    e.dataTransfer.setData(COMPARE_DRAG_TYPE, symbol);
                    e.dataTransfer.setData('text/plain', symbol);
                    e.dataTransfer.effectAllowed = 'copy';
                  }}
                  className="flex min-w-0 flex-1 items-center justify-between py-2 pl-3 pr-1 text-left"
                >
                  <span className="flex min-w-0 flex-col">
                    <span
                      className={`truncate text-xs font-medium ${
                        highlighted ? 'text-accent' : 'text-text-primary'
                      }`}
                    >
                      {picked && <span className="mr-1 text-accent">✓</span>}
                      {names(symbol) ? `${names(symbol)} (${symbol})` : symbol}
                    </span>
                  </span>
                  <span
                    className="shrink-0 text-right"
                    title={quote?.stale ? '실시간 조회 실패 — 마지막 캐시 종가입니다.' : undefined}
                  >
                    <span className="block text-xs tabular-nums text-text-secondary">
                      {quote?.price != null
                        ? `${quote.stale ? '· ' : ''}${formatPrice(quote.price, quote.currency)}`
                        : '—'}
                    </span>
                    <span className={`block text-[11px] tabular-nums ${color}`}>
                      {rate == null ? '—' : formatPercent(rate)}
                    </span>
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => onRemoveRecent(symbol)}
                  title="최근 조회에서 삭제"
                  aria-label={`${symbol} 삭제`}
                  /*
                    ⚠️ 항상 보인다. hover 에서만 나타나게 두었더니 **버튼이 있는 줄도 몰랐다** —
                    "최근 조회에서 종목을 못 지운다" 는 신고가 그것이었다. 평소엔 옅게 두고
                    올리면 빨강으로 또렷해진다.
                  */
                  className="mr-2 shrink-0 rounded p-1 text-text-muted/70 transition-colors hover:bg-bearish/15 hover:text-bearish"
                >
                  <TrashIcon className="h-3.5 w-3.5" />
                </button>
              </div>
            );
          })
        )}
      </div>

      {tab === 'account' ? (
        <p className="border-t border-border px-3 py-2 text-[10px] text-text-muted">
          모의투자 계좌의 현재 상태입니다. 거래는 차트의 빠른주문에서 진행하세요.
        </p>
      ) : tab === 'watch' ? (
        <div className="border-t border-border p-2">
          {/*
            패널의 빠른 추가는 **'미분류' 로만** 넣는다. 폴더를 고르는 일까지 여기서 하면
            좁은 폭에 드롭다운이 하나 더 붙는다 — 분류는 관리 팝업(⚙️)에서 한다.
          */}
          <SymbolSearch
            symbol=""
            onSubmit={(symbol) => watch.add(symbol, DEFAULT_FOLDER_ID)}
            placeholder="+ 빠른 추가 (구글, 애플…)"
            submitLabel="추가"
            compact
            clearOnSubmit
            isAdded={(candidate: string) => watchlist.includes(candidate)}
          />
        </div>
      ) : (
        recent.length > 0 && (
          <button
            type="button"
            onClick={onClearRecent}
            className="flex items-center justify-center gap-1.5 border-t border-border py-2 text-xs text-text-muted transition-colors hover:text-bearish"
          >
            <TrashIcon className="h-3.5 w-3.5" />
            기록 모두 지우기
          </button>
        )
      )}

      <p className="border-t border-border px-3 py-1.5 text-[10px] leading-relaxed text-text-muted">
        {compareMode ? (
          <>
            클릭: 빈 칸에 차례로 담기 · ✓ 다시 클릭: 빼기
            <br />
            드래그: 원하는 칸에 놓기 (찬 칸은 교체)
          </>
        ) : (
          '클릭: 종목 전환 · ⚙️ 에서 폴더·순서 관리'
        )}
      </p>

      {managing && <WatchlistManager watch={watch} onClose={() => setManaging(false)} />}
    </aside>
  );
}
