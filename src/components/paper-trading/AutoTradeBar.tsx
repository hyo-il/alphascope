import { useState } from 'react';
import AutoTradeSettings from './AutoTradeSettings';
import { useAutoTrading } from '../../hooks/useAutoTrading';
import { useGeminiStatus } from '../../hooks/useGemini';
import { toast } from '../../store/uiStore';

/**
 * 계좌 대시보드 상단의 자동매매 바.
 *
 * 한 줄에 **지금 도는가 / 왜 안 도는가 / 켜고 끄기 / 설정**만 둔다.
 * 조건·종목은 설정 패널로 보낸다 — 계좌 화면은 잔고와 거래를 보는 자리이지
 * 전략을 편집하는 자리가 아니다.
 */
export default function AutoTradeBar({ accountId }: { accountId: number | null }) {
  const { strategy, status, error, save } = useAutoTrading(accountId);
  const { state: gemini } = useGeminiStatus(60_000);
  const [open, setOpen] = useState(false);
  const [toggling, setToggling] = useState(false);

  if (!accountId || !strategy) return null;

  const on = strategy.enabled;
  const geminiEnabled = gemini?.enabled ?? false;

  const toggle = async () => {
    // 종목이 없으면 켜지지 않는다 — 서버도 같은 상태를 blockedReason 으로 알려 주지만,
    // 켜 놓고 아무 일도 일어나지 않는 것보다 켜는 순간 막고 이유를 말하는 편이 낫다.
    if (!on && strategy.symbols.length === 0) {
      toast.warning('대상 종목이 없습니다', '[자동매매 설정] 에서 종목을 먼저 담아 주세요');
      setOpen(true);
      return;
    }
    if (!on && strategy.mode === 'ai' && !geminiEnabled) {
      toast.warning('Gemini 키가 설정되지 않았습니다', '규칙형으로 바꾸면 키 없이 동작합니다');
      setOpen(true);
      return;
    }
    setToggling(true);
    try {
      await save({ enabled: !on });
      toast.success(on ? '자동매매를 껐습니다' : '자동매매를 켰습니다');
    } catch (e) {
      toast.error('바꾸지 못했습니다', (e as Error).message);
    } finally {
      setToggling(false);
    }
  };

  const nextRun = status?.nextRunAt ? new Date(status.nextRunAt).toLocaleTimeString('ko-KR') : null;

  return (
    <>
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        <span className="text-xs font-medium text-text-primary">🤖 자동매매</span>

        <span
          className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
            on ? 'bg-bullish/15 text-bullish' : 'bg-bg-tertiary text-text-muted'
          }`}
        >
          {on ? '켜짐' : '꺼짐'}
        </span>

        <span className="rounded border border-border px-1.5 py-0.5 text-[10px] text-text-secondary">
          {strategy.mode === 'ai' ? 'AI형' : '규칙형'}
        </span>

        <span className="text-[11px] text-text-muted">종목 {strategy.symbols.length}개</span>

        {/*
          켜져 있는데 못 도는 이유가 있으면 그것을 먼저 보여 준다.
          "켜짐" 만 떠 있고 아무 일도 일어나지 않으면 사용자는 고장으로 읽는다.
        */}
        {on && status?.blockedReason && (
          <span className="rounded bg-warning/15 px-2 py-0.5 text-[10px] text-warning">
            ⚠️ {status.blockedReason}
          </span>
        )}
        {on && !status?.blockedReason && nextRun && (
          <span className="text-[11px] text-text-muted">
            다음 실행 {nextRun}
            {strategy.mode === 'ai' && status ? ` · 오늘 호출 ${status.callsToday}회` : ''}
          </span>
        )}
        {error && <span className="text-[11px] text-bearish">상태 조회 실패: {error}</span>}

        <span className="ml-auto flex items-center gap-2">
          <span className="rounded bg-warning/15 px-2 py-0.5 text-[10px] text-warning">
            모의 — 실제 주문은 나가지 않습니다
          </span>
          <button
            type="button"
            onClick={() => setOpen(true)}
            className="rounded border border-border px-2 py-1 text-[11px] text-text-secondary transition-colors hover:border-accent hover:text-accent"
          >
            자동매매 설정
          </button>
          <button
            type="button"
            onClick={() => void toggle()}
            disabled={toggling}
            className={`rounded px-3 py-1 text-[11px] font-medium transition-colors disabled:opacity-50 ${
              on
                ? 'border border-border text-text-secondary hover:border-bearish hover:text-bearish'
                : 'bg-accent text-white hover:bg-accent-hover'
            }`}
          >
            {toggling ? '…' : on ? '끄기' : '켜기'}
          </button>
        </span>
      </div>

      {open && (
        <AutoTradeSettings
          strategy={strategy}
          geminiEnabled={geminiEnabled}
          onSave={save}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
