import { CARD_GRID } from '../ui/tokens';
import Button from '../ui/Button';
import AutoTradeIcon from '../ui/AutoTradeIcon';
import { useEffect, useMemo, useState } from 'react';
import { ArrowDown, ArrowUp, GripVertical, LoaderCircle } from 'lucide-react';
import IconButton from '../ui/IconButton';
import { ICON_SM } from '../ui/icon';
import { useFlipReorder } from '../../hooks/useFlipReorder';
import type { AccountOverviewItem, StrategyOverviewItem } from '../../hooks/usePaperOverview';
import { formatPrice, formatSignedMoney, formatSigned } from '../../utils/formatters';
import { toast } from '../../store/uiStore';
import { autoTradeView } from '../../utils/autoTradeStatus';
import { useTradingRules } from '../../hooks/useTradingRules';
import { ruleSafetyText } from '../../utils/ruleText';

/**
 * 계좌 **모아보기** — 계좌 관리에 들어가면 먼저 보이는 화면.
 *
 * 마스터-디테일이다: 여기는 "어느 계좌가 어떤가" 를 한눈에 보는 자리이고,
 * 카드를 누르면 지금까지의 상세 화면(잔고·보유·거래·자동매매 설정)으로 들어간다.
 * 계좌가 하나뿐이어도 카드 한 장을 그린다 — 계좌가 늘어날 때 화면이 달라지면
 * "내 계좌가 어디 갔나" 가 된다.
 *
 * ⚠️ 카드의 [켜기] 는 `AutoTradeBar` 와 **같은 가드**를 쓴다. 종목이 없거나 매매 규칙이 없으면
 * 켜 봐야 서버가 매 틱 `blockedReason` 만 돌려준다 — 그래서 켜지 말고 상세로 보낸다.
 */
/**
 * 상태별 테두리. **색만으로 구분하지 않는다** — 배지의 기호(●◐⚠○)와 글자가 함께 간다.
 *
 * ⚠️ **두께는 `ring`(box-shadow)으로 낸다. `border` 폭은 네 상태 모두 1px 고정이다.**
 * border 폭을 상태마다 다르게 두면 자리를 차지해서, 5초 폴링으로 상태가 바뀌는 순간
 * 카드 안쪽 내용이 1~2px 밀린다(대기 → 꺼짐에서 글자가 움찔거린다). ring 은 자리를 차지하지 않는다.
 *
 * 세기는 **대기 < 가동 중 ≤ 멈춤** 이다. 멈춤은 사람이 고쳐야 하는 유일한 상태라
 * 가동 중보다 약해 보이면 안 된다.
 * ⚠️ 대기를 옅게만 두지 말 것 — 이 앱은 한국 시간 **낮**에 주로 쓰는데 그때 미국 장은 닫혀 있어
 * **켜 둔 계좌가 대부분 대기**다. 예전 값(1px · 30%)은 사실상 보이지 않았다.
 */
const BORDER: Record<string, string> = {
  running: 'border border-bullish ring-[3px] ring-bullish shadow-lg shadow-bullish/30',
  waiting: 'border border-bullish/50 ring-2 ring-bullish/35',
  blocked: 'border border-warning ring-[3px] ring-warning shadow-lg shadow-warning/30',
  off: 'border border-border',
};

const BADGE: Record<string, string> = {
  running: 'bg-bullish/15 text-bullish',
  // 대기 배지는 중립색이다 — 청록을 여기까지 쓰면 가동 중과 구분이 흐려진다.
  waiting: 'bg-bg-tertiary text-text-secondary',
  blocked: 'bg-warning/15 text-warning',
  off: 'bg-bg-tertiary text-text-muted',
};

export default function AccountsOverview({
  accounts,
  strategies,
  error,
  hasAccounts,
  selectedId,
  onOpen,
  onToggleAuto,
  onReorder,
}: {
  accounts: AccountOverviewItem[] | null;
  strategies: StrategyOverviewItem[] | null;
  error: string | null;
  /**
   * 계좌 목록(`/api/paper/accounts`) 조회는 성공했는가.
   * 그쪽은 되는데 모아보기 묶음 라우트만 실패했다면 **서버가 옛 버전**일 가능성이 가장 높다
   * (옛 서버에는 `/accounts/overview` 가 없어 `/:id` 에 걸리고 'accountId 가 필요합니다' 가 난다).
   */
  hasAccounts: boolean;
  /** 지금 다른 화면들이 보고 있는 계좌 — **테두리가 아니라 태그**로 표시한다 */
  selectedId: number | null;
  onOpen: (accountId: number) => void;
  /** 켜기/끄기 — 실패는 이 컴포넌트가 토스트로 알린다 */
  onToggleAuto: (accountId: number, enabled: boolean) => Promise<void>;
  /** 계좌 순서 저장 (v2.48.0) — 새 순서(계좌 id 전부). 실패하면 던진다 → 이 컴포넌트가 원래 순서로 되돌리고 알린다 */
  onReorder: (ids: number[]) => Promise<void>;
}) {
  const [busyId, setBusyId] = useState<number | null>(null);
  /*
   * 계좌 순서 바꾸기 (v2.48.0 — 사용자 결정: 끌어 옮기기 + ↑↓ 둘 다). 관심 목록 편집 창과 같은 끌기 방식·피드백
   * (끄는 원래 자리 = 점선 · 놓을 자리 = 파란 줄 · FLIP 미끄러짐). 바꾸는 즉시 서버에 저장하고, 저장하는 동안은 화면에 새 순서를 먼저 보인다.
   * 실패하면 원래 순서로 되돌리고 알린다. 순서의 출처는 서버(`listAccounts()` — sort_order) 하나다.
   */
  const [pendingOrder, setPendingOrder] = useState<number[] | null>(null);
  const [savingOrder, setSavingOrder] = useState(false);
  const [dragId, setDragId] = useState<number | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const shown = useMemo(() => {
    if (!accounts || !pendingOrder) return accounts;
    const byId = new Map(accounts.map((a) => [a.account.id, a]));
    const ordered = pendingOrder.map((id) => byId.get(id)).filter((a): a is AccountOverviewItem => Boolean(a));
    // 저장하는 사이 계좌가 늘거나 줄었으면 서버 목록을 그대로 쓴다
    return ordered.length === accounts.length ? ordered : accounts;
  }, [accounts, pendingOrder]);
  // 서버가 준 순서가 새 순서와 같아지면 화면 쪽 순서를 버린다(출처는 서버 하나)
  useEffect(() => {
    if (pendingOrder && !savingOrder && accounts && accounts.map((a) => a.account.id).join(',') === pendingOrder.join(',')) setPendingOrder(null);
  }, [accounts, pendingOrder, savingOrder]);
  const flip = useFlipReorder((shown ?? []).map((a) => a.account.id).join(','));

  const moveAccount = async (id: number, to: number) => {
    if (!shown || savingOrder) return;
    const ids = shown.map((a) => a.account.id);
    const from = ids.indexOf(id);
    const target = Math.max(0, Math.min(ids.length - 1, from < to ? to - 1 : to));
    if (from < 0 || from === target) return;
    ids.splice(from, 1);
    ids.splice(target, 0, id);
    const before = pendingOrder;
    setPendingOrder(ids);
    setSavingOrder(true);
    try {
      await onReorder(ids);
    } catch (e) {
      setPendingOrder(before);
      toast.error('순서를 바꾸지 못했습니다', (e as Error).message);
    } finally {
      setSavingOrder(false);
    }
  };
  const { rules } = useTradingRules();
  const ruleOf = (id: number | null) => (id != null ? (rules?.find((r) => r.id === id) ?? null) : null);
  const ruleName = (id: number | null) => (id == null ? '없음' : (ruleOf(id)?.name ?? '—'));

  const strategyOf = (accountId: number) =>
    strategies?.find((s) => s.strategy.accountId === accountId) ?? null;

  const toggle = async (item: AccountOverviewItem, on: boolean) => {
    const found = strategyOf(item.account.id);
    if (on && found) {
      // 켤 수 없는 이유가 있으면 켜지 말고 그 계좌를 열어 준다 (AutoTradeBar 와 같은 판단).
      if (found.strategy.symbols.length === 0) {
        toast.warning('대상 종목이 없습니다', '계좌를 열어 [자동매매 설정] 에서 추가해 주세요');
        onOpen(item.account.id);
        return;
      }
      if (found.strategy.ruleId == null) {
        toast.warning('매매 규칙을 고르세요.', '계좌를 열어 [자동매매 설정] 의 「① 매매 규칙」 에서 고릅니다');
        onOpen(item.account.id);
        return;
      }
    }
    setBusyId(item.account.id);
    try {
      await onToggleAuto(item.account.id, on);
      toast.success(on ? '자동매매를 켰습니다' : '자동매매를 껐습니다', item.account.name);
    } catch (e) {
      toast.error('바꾸지 못했습니다', (e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  /*
    ⚠️ "불러오지 못했다" 와 "계좌가 없다" 를 같은 화면으로 그리지 않는다 —
    API 가 늦게 뜬 것뿐인데 계좌가 지워진 것처럼 보인다 (대시보드와 같은 규칙).
  */
  if (accounts === null) {
    return (
      <div className="flex flex-1 items-center justify-center p-6">
        <p className="text-center text-xs leading-relaxed text-text-muted">
          {error ? (
            <>
              계좌 목록을 불러오지 못했습니다.
              <br />
              <span className="text-text-muted">{error}</span>
              <br />
              저장된 계좌·보유 종목·거래 내역은 그대로 있습니다.
              {hasAccounts && (
                <>
                  <br />
                  <span className="text-warning">
                    서버가 옛 버전일 수 있습니다 — 서버를 다시 시작해 보세요.
                  </span>
                </>
              )}
            </>
          ) : (
            '계좌를 불러오는 중…'
          )}
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4">
      {error && (
        <p className="mb-2 rounded-lg bg-warning/10 px-3 py-1.5 text-caption text-warning">
          최신 값을 받지 못했습니다 ({error}) — 아래는 마지막으로 받은 값입니다.
        </p>
      )}

      {savingOrder && (
        <p className="mb-2 flex items-center gap-1.5 text-caption text-text-muted" role="status">
          <LoaderCircle {...ICON_SM} className="animate-spin" />
          순서를 저장하는 중…
        </p>
      )}
      <div className={`grid gap-3 ${CARD_GRID}`}>
        {(shown ?? []).map((item, index, list) => {
          const found = strategyOf(item.account.id);
          const strategy = found?.strategy;
          const status = found?.status;
          const on = Boolean(strategy?.enabled);
          const view = autoTradeView(strategy, status);
          const currency = item.account.currency;
          const pnl = item.totalPnl;

          return (
            <article
              key={item.account.id}
              ref={flip(String(item.account.id))}
              role="button"
              tabIndex={0}
              // 카드 전체를 잡아 끈다(관심 목록 편집과 같은 방식). 짧은 클릭은 브라우저가 끌기와 갈라 주므로 열기는 그대로다
              draggable={list.length > 1 && !savingOrder}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move';
                setDragId(item.account.id);
              }}
              onDragEnd={() => {
                setDragId(null);
                setDropIndex(null);
              }}
              onDragOver={(e) => {
                if (dragId == null) return;
                e.preventDefault();
                const box = e.currentTarget.getBoundingClientRect();
                // 카드 격자라 가로 위치로 앞/뒤를 정한다(한 줄에 여러 장)
                setDropIndex(e.clientX - box.left > box.width / 2 ? index + 1 : index);
              }}
              onDrop={(e) => {
                if (dragId == null) return;
                e.preventDefault();
                const id = dragId;
                setDragId(null);
                setDropIndex(null);
                void moveAccount(id, dropIndex ?? index);
              }}
              onClick={() => onOpen(item.account.id)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') onOpen(item.account.id);
              }}
              /*
                ⚠️ **테두리는 자동매매 상태 전용**이다. 예전에는 hover 가 테두리를 파랗게
                덮어써서, 카드를 보려고 마우스를 올리는 순간 상태 표시가 사라졌다.
                hover 는 배경으로만 알린다.
              */
              className={`relative rounded-lg bg-bg-secondary p-3 text-left transition-colors hover:bg-bg-tertiary/40 ${BORDER[view.state]} ${
                list.length > 1 ? 'cursor-grab active:cursor-grabbing' : ''
              } ${dragId === item.account.id ? 'border-dashed !border-accent/60 opacity-40' : ''}`}
            >
              {/* 놓을 자리 — 카드 앞(왼쪽)·뒤(오른쪽)에 파란 세로 줄 */}
              {dragId != null && dropIndex === index && <span aria-hidden className="absolute inset-y-2 -left-2 w-0.5 rounded bg-accent" />}
              {dragId != null && dropIndex === index + 1 && index === list.length - 1 && (
                <span aria-hidden className="absolute inset-y-2 -right-2 w-0.5 rounded bg-accent" />
              )}
              <header className="flex items-center gap-2">
                {list.length > 1 && (
                  <span aria-hidden title="끌어서 순서 바꾸기 (↑↓ 버튼으로도)" className="-ml-1 shrink-0 text-text-muted">
                    <GripVertical {...ICON_SM} />
                  </span>
                )}
                <h3 className="min-w-0 truncate text-sm font-medium text-text-primary">
                  {item.account.name}
                </h3>
                <span className="shrink-0 text-caption text-text-muted">{currency}</span>
                {item.account.id === selectedId && (
                  <span className="ml-auto shrink-0 rounded bg-bg-tertiary px-1.5 py-0.5 text-caption font-medium text-text-secondary">
                    현재 계좌
                  </span>
                )}
                {list.length > 1 && (
                  // ↑↓ — 끌기를 모르는 사람도 바꿀 수 있게(사용자 결정). 맨 위의 ↑ · 맨 아래의 ↓ 는 잠근다. 카드 열기와 겹치지 않게 막는다
                  <span className={`flex shrink-0 items-center ${item.account.id === selectedId ? '' : 'ml-auto'}`} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
                    <IconButton icon={ArrowUp} size="sm" label="위로" disabled={index === 0 || savingOrder} onClick={() => void moveAccount(item.account.id, index - 1)} />
                    <IconButton icon={ArrowDown} size="sm" label="아래로" disabled={index === list.length - 1 || savingOrder} onClick={() => void moveAccount(item.account.id, index + 2)} />
                  </span>
                )}
              </header>

              {item.error ? (
                <p className="mt-2 text-caption text-danger">평가 실패: {item.error}</p>
              ) : (
                <>
                  <p className="mt-2 text-sm font-semibold tabular-nums text-text-primary">
                    {formatPrice(item.totalValue ?? 0, currency)}
                  </p>
                  <p
                    className={`text-xs tabular-nums ${
                      (pnl ?? 0) > 0 ? 'text-bullish' : (pnl ?? 0) < 0 ? 'text-bearish' : 'text-text-secondary'
                    }`}
                  >
                    {formatSignedMoney(pnl ?? 0, currency)} ({formatSigned(item.totalReturn ?? 0, 2, '%')})
                  </p>
                  <p className="mt-1 text-caption text-text-muted">
                    현금 {formatPrice(item.account.currentCash, currency)} · 주식{' '}
                    {formatPrice(item.stockValue ?? 0, currency)}
                    {item.pendingOrders > 0 && ` · 대기 주문 ${item.pendingOrders}건`}
                  </p>
                </>
              )}

              {/*
                서버 스위치(AUTO_TRADING_ENABLED=false)로 꺼진 서버에서는 계좌 설정과 무관하게 알린다 —
                "켜기" 를 눌러도 돌지 않는다는 것을 모르면 고장으로 읽는다 (v2.16.0).
              */}
              {status && status.serverEnabled === false && !on && (
                <p className="mt-2 rounded bg-warning/10 px-2 py-1 text-caption text-warning">
                  이 서버에서는 자동매매가 꺼져 있습니다(AUTO_TRADING_ENABLED=false)
                </p>
              )}

              {/* 자동매매는 네 가지 상태다 — 가동 중 / 대기 / 멈춤 / 꺼짐 (utils/autoTradeStatus) */}
              <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-border pt-2">
                <span
                  title={view.reason ?? undefined}
                  className={`flex items-center gap-1 rounded px-1.5 py-0.5 text-caption font-medium ${BADGE[view.state]}`}
                >
                  {/*
                    깜빡이는 것은 **가동 중의 점 하나뿐**이다. 동작 줄이기를 켠 사용자에게는
                    motion-safe 가 이걸 멈춘다.
                  */}
                  <AutoTradeIcon view={view} />
                  <span>
                    {view.state === 'blocked' ? `멈춤: ${view.reason}` : view.label}
                  </span>
                </span>

                {view.hint && <span className="text-caption text-text-muted">{view.hint}</span>}

                {view.state === 'running' && status && !view.busy && strategy && (
                  <span className="text-caption text-text-muted">
                    오늘 판단 {status.judgedToday}/{strategy.symbols.length}종목
                  </span>
                )}

                {/* 사람이 고쳐야 하는 상태에서만 길을 열어 준다 (서버 스위치로 꺼진 것은 설정으로 못 푼다) */}
                {view.state === 'blocked' && view.fixable !== false && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpen(item.account.id);
                    }}
                    className="rounded border border-warning/50 px-1.5 py-0.5 text-caption font-medium text-warning transition-colors hover:bg-warning/15"
                  >
                    설정 열기
                  </button>
                )}

                {strategy && (
                  <span className="text-caption text-text-muted">
                    규칙 「{ruleName(strategy.ruleId)}」 · 대상 {strategy.symbols.length}종목 ·
                    비중 {strategy.positionSizePercent}%
                  </span>
                )}

                {/* 카드마다 파란 버튼이 생기지 않게 보조 버튼(켜기) · 빨간 글자(끄기) — 파랑은 화면의 주요 실행 하나만 (v2.42.0) */}
                <Button
                  variant={on ? 'danger-text' : 'secondary'}
                  size="sm"
                  className="ml-auto"
                  disabled={busyId === item.account.id || !strategy}
                  onClick={(e) => {
                    // 카드 클릭(상세 열기)과 겹치면 켜려다 화면이 바뀐다.
                    e.stopPropagation();
                    void toggle(item, !on);
                  }}
                >
                  {busyId === item.account.id ? '…' : on ? '끄기' : '켜기'}
                </Button>
              </div>
              {/* 손절·익절·트레일링 한 줄 — 안전장치를 모아보기에서도 한눈에. 이 계좌 규칙의 값(utils/ruleText) */}
              {strategy && ruleOf(strategy.ruleId) && (
                <p className="mt-1.5 text-caption font-medium text-text-secondary">{ruleSafetyText(ruleOf(strategy.ruleId)!)}</p>
              )}
            </article>
          );
        })}
      </div>
    </div>
  );
}
