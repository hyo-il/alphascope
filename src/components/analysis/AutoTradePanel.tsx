import { useEffect, useState } from 'react';
import type { AutoAnalysisSettings } from '../../types/gemini';
import { useGeminiStatus } from '../../hooks/useGemini';
import { toast } from '../../store/uiStore';
import { Skeleton } from '../common/SkeletonLoader';
import GeminiDisabledNotice from './GeminiDisabledNotice';

interface PaperAccount {
  id: number;
  name: string;
  currency: string;
  currentCash: number;
}

/**
 * 자동 매매 설정.
 *
 * 이 탭을 연 사람이 알고 싶은 것은 딱 하나 — **지금 켜져 있나?** 그래서 큰 토글을
 * 최상단에 두고, 조건은 그 아래에 둔다.
 *
 * ⚠️ 모의투자 계좌에만 주문한다. 실제 증권사 주문은 어디에서도 나가지 않는다.
 */
export default function AutoTradePanel() {
  const { state, save } = useGeminiStatus();
  const [draft, setDraft] = useState<AutoAnalysisSettings | null>(null);
  const [accounts, setAccounts] = useState<PaperAccount[] | null>(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (state?.settings && !draft) setDraft(state.settings);
  }, [state, draft]);

  useEffect(() => {
    void fetch('/api/paper/accounts')
      .then((response) => (response.ok ? response.json() : { accounts: [] }))
      .then((data) => setAccounts(data.accounts ?? []))
      .catch(() => setAccounts([]));
  }, []);

  if (!state || accounts === null) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24 w-full rounded-lg" />
        <Skeleton className="h-64 w-full rounded-lg" />
      </div>
    );
  }

  if (!state.enabled) return <GeminiDisabledNotice />;

  const settings = draft ?? state.settings!;
  const account = accounts.find((item) => item.id === settings.paperAccountId) ?? null;
  const ready = Boolean(settings.paperAccountId) && settings.symbols.length > 0;
  const active = settings.autoTrade && ready;

  const patch = (change: Partial<AutoAnalysisSettings>) => setDraft({ ...settings, ...change });

  const persist = async (change: Partial<AutoAnalysisSettings>) => {
    const next = { ...settings, ...change };
    setDraft(next);
    try {
      await save(next);
    } catch (e) {
      toast.error('설정 저장 실패', (e as Error).message);
    }
  };

  const runNow = async () => {
    setRunning(true);
    try {
      const response = await fetch('/api/gemini/run', { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? '실행 실패');
      if (data.skipped) toast.warning('실행하지 않았습니다', data.skipped);
      else if (data.errors?.length)
        toast.warning(`${data.analyzed}건 완료`, data.errors.join(' / '));
      else toast.success(`${data.analyzed}개 종목 분석 완료`);
    } catch (e) {
      toast.error('실행 실패', (e as Error).message);
    } finally {
      setRunning(false);
    }
  };

  const percent = (value: number) => `${Math.round(value * 100)}%`;

  return (
    <div className="space-y-4">
      {/* ── 스위치: 이 탭에서 가장 먼저 보여야 하는 것 ── */}
      <div
        className={`rounded-lg border p-4 transition-colors ${
          active ? 'border-bullish/50 bg-bullish/5' : 'border-border bg-bg-secondary'
        }`}
      >
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            role="switch"
            aria-checked={settings.autoTrade}
            onClick={() => void persist({ autoTrade: !settings.autoTrade })}
            className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-colors ${
              settings.autoTrade
                ? 'bg-bullish/20 text-bullish'
                : 'bg-bg-tertiary text-text-secondary hover:text-text-primary'
            }`}
          >
            <span
              className={`inline-block h-2.5 w-2.5 rounded-full ${
                active ? 'bg-bullish' : settings.autoTrade ? 'bg-warning' : 'bg-text-muted'
              }`}
            />
            {settings.autoTrade ? '자동매매 실행 중' : '자동매매 꺼짐'}
          </button>

          <span className="rounded bg-warning/15 px-2 py-1 text-[11px] text-warning">
            모의 계좌만 — 실제 주문은 나가지 않습니다
          </span>

          <button
            onClick={runNow}
            disabled={running || !settings.symbols.length}
            className="ml-auto rounded border border-border px-3 py-1.5 text-sm text-text-secondary transition-colors hover:bg-bg-tertiary disabled:opacity-40"
          >
            {running ? '분석 중…' : '▶ 지금 즉시 분석'}
          </button>
        </div>

        {/* 켜 뒀지만 조건이 모자란 상태를 분명히 알린다 — 켠 줄 알았는데 안 도는 게 최악이다 */}
        {settings.autoTrade && !ready && (
          <p className="mt-2 rounded bg-warning/10 p-2 text-xs text-warning">
            ⚠️ 켜져 있지만 주문이 나가지 않습니다 —{' '}
            {!settings.paperAccountId && '모의투자 계좌를 고르세요. '}
            {!settings.symbols.length && "'자동 분석' 탭에서 대상 종목을 추가하세요."}
          </p>
        )}
        {active && (
          <p className="mt-2 text-xs text-text-secondary">
            {settings.symbols.join(' · ')} 을(를) {settings.intervalMinutes}분마다 분석해
            <b className="text-text-primary"> {account?.name}</b> 계좌에 주문합니다.
          </p>
        )}
      </div>

      {/* ── 조건 ── */}
      <div className="space-y-4 rounded-lg border border-border bg-bg-secondary p-4">
        <label className="block text-xs text-text-secondary">
          계좌
          <select
            value={settings.paperAccountId ?? ''}
            onChange={(e) =>
              void persist({ paperAccountId: e.target.value ? Number(e.target.value) : null })
            }
            className="mt-1 w-full max-w-xs rounded border border-border bg-bg-tertiary px-2 py-1.5 text-sm text-text-primary"
          >
            <option value="">선택하세요</option>
            {accounts.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          {accounts.length === 0 && (
            <span className="mt-1 block text-[11px] text-warning">
              모의투자 계좌가 없습니다. '모의투자' 메뉴에서 먼저 만드세요.
            </span>
          )}
        </label>

        <div className="grid gap-4 sm:grid-cols-2">
          {/* 매수 조건 */}
          <fieldset className="rounded border border-border p-3">
            <legend className="px-1 text-xs font-medium text-bullish">매수 조건</legend>
            <label className="block text-[11px] text-text-secondary">
              신호
              <select
                value={settings.buySignal}
                onChange={(e) => void persist({ buySignal: e.target.value as 'BUY' | 'STRONG_BUY' })}
                className="mt-1 w-full rounded border border-border bg-bg-tertiary px-2 py-1 text-sm text-text-primary"
              >
                <option value="BUY">매수 이상 (매수 · 강력 매수)</option>
                <option value="STRONG_BUY">강력 매수만</option>
              </select>
            </label>
            <label className="mt-3 block text-[11px] text-text-secondary">
              신뢰도 {percent(settings.buyMinConfidence)} 이상
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(settings.buyMinConfidence * 100)}
                onChange={(e) => patch({ buyMinConfidence: Number(e.target.value) / 100 })}
                onMouseUp={() => void persist({ buyMinConfidence: settings.buyMinConfidence })}
                onTouchEnd={() => void persist({ buyMinConfidence: settings.buyMinConfidence })}
                className="mt-2 w-full"
              />
            </label>
          </fieldset>

          {/* 매도 조건 */}
          <fieldset className="rounded border border-border p-3">
            <legend className="px-1 text-xs font-medium text-bearish">매도 조건</legend>
            <label className="block text-[11px] text-text-secondary">
              신호
              <select
                value={settings.sellSignal}
                onChange={(e) =>
                  void persist({ sellSignal: e.target.value as 'SELL' | 'STRONG_SELL' })
                }
                className="mt-1 w-full rounded border border-border bg-bg-tertiary px-2 py-1 text-sm text-text-primary"
              >
                <option value="SELL">매도 이상 (매도 · 강력 매도)</option>
                <option value="STRONG_SELL">강력 매도만</option>
              </select>
            </label>
            <label className="mt-3 block text-[11px] text-text-secondary">
              신뢰도 {percent(settings.sellMinConfidence)} 이상
              <input
                type="range"
                min={0}
                max={100}
                value={Math.round(settings.sellMinConfidence * 100)}
                onChange={(e) => patch({ sellMinConfidence: Number(e.target.value) / 100 })}
                onMouseUp={() => void persist({ sellMinConfidence: settings.sellMinConfidence })}
                onTouchEnd={() => void persist({ sellMinConfidence: settings.sellMinConfidence })}
                className="mt-2 w-full"
              />
            </label>
            <p className="mt-2 text-[10px] text-text-muted">
              보유 중일 때만 전량 청산합니다 (공매도 없음).
            </p>
          </fieldset>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block text-[11px] text-text-secondary">
            주문 금액 — 총자산의
            <div className="mt-1 flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={100}
                value={settings.positionSizePercent}
                onChange={(e) => patch({ positionSizePercent: Number(e.target.value) })}
                onBlur={() => void persist({ positionSizePercent: settings.positionSizePercent })}
                className="w-20 rounded border border-border bg-bg-tertiary px-2 py-1 text-sm text-text-primary"
              />
              <span className="text-sm text-text-secondary">%</span>
            </div>
            <span className="mt-1 block text-[10px] text-text-muted">
              현금이 아니라 총자산 기준입니다 — 매수를 거듭해도 한 종목 비중이 줄지 않습니다.
            </span>
          </label>

          <label className="block text-[11px] text-text-secondary">
            최대 보유 종목 수
            <div className="mt-1 flex items-center gap-2">
              <input
                type="number"
                min={1}
                max={50}
                value={settings.maxPositions}
                onChange={(e) => patch({ maxPositions: Number(e.target.value) })}
                onBlur={() => void persist({ maxPositions: settings.maxPositions })}
                className="w-20 rounded border border-border bg-bg-tertiary px-2 py-1 text-sm text-text-primary"
              />
              <span className="text-sm text-text-secondary">종목</span>
            </div>
            <span className="mt-1 block text-[10px] text-text-muted">
              한도에 닿으면 신규 매수만 막습니다. 이미 보유한 종목의 추가 매수는 계속됩니다.
            </span>
          </label>
        </div>
      </div>
    </div>
  );
}
