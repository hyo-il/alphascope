import { useEffect, useState, type ReactNode } from 'react';
import type { AccountStrategy } from '../../types/autoTrading';
import type { TradingRule } from '../../types/tradingRule';
import { Button, DisclosureButton, Panel } from '../ui';
import WarnIcon from '../ui/WarnIcon';
import { useAppStore } from '../../store/appStore';
import { usePaperAccounts } from '../../hooks/usePaperTrading';
import { JUDGE_TIMING_TEXT, NO_STOP_WARNING, ruleBuyText, ruleSafetyText, ruleSellText } from '../../utils/ruleText';
import { nextJudgeText } from '../../utils/autoTradeExplain';

/**
 * 계좌 「지금 조건」 카드 (v2.40.0 → v2.44.0 매매 규칙) — 자동매매 바 바로 아래, 처음 접힘 + 한 줄 요약.
 * 손절·익절·트레일링 값은 한 단계 굵게(500), **색은 쓰지 않는다**(상태색과 섞이지 않게). 문장은 `utils/ruleText.ts` 한 곳.
 * 규칙의 손절이 꺼져 있으면 경고 한 줄(B-3).
 */
function Line({ label, children, strong = false }: { label: string; children: ReactNode; strong?: boolean }) {
  return (
    <div className="contents">
      <dt className="text-text-muted">{label}</dt>
      <dd className={strong ? 'font-medium text-text-primary' : 'text-text-secondary'}>{children}</dd>
    </div>
  );
}

export default function ConditionCard({
  strategy: s,
  rule,
  rulesLoaded,
  onOpenSettings,
}: {
  strategy: AccountStrategy;
  /** 이 계좌의 매매 규칙 — 없거나 지워졌으면 null */
  rule: TradingRule | null;
  rulesLoaded: boolean;
  onOpenSettings: () => void;
}) {
  const setPage = useAppStore((st) => st.setPage);
  const setPreset = useAppStore((st) => st.setBacktestPreset);
  const { accounts } = usePaperAccounts();
  const name = accounts.find((a) => a.id === s.accountId)?.name ?? '이 계좌';
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [s.accountId]);

  // 계좌 → 백테스트: 이 계좌의 규칙을 방법 1 로, 종목을 ① 로 (규칙이 없으면 종목만)
  const tryBacktest = () => {
    setPreset({ from: name, symbols: [...s.symbols], ruleId: rule?.id ?? null });
    setPage('backtest');
  };

  return (
    <Panel pad="sm" className="mx-4 my-2 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="shrink-0 text-xs font-semibold text-text-primary">지금 조건</p>
        <p className="min-w-0 text-caption text-text-secondary">
          {rule ? (
            <>
              규칙 「{rule.name}」 · <span className="font-medium text-text-primary">{ruleSafetyText(rule)}</span>
            </>
          ) : rulesLoaded ? (
            <span className="text-warning">매매 규칙을 고르세요.</span>
          ) : (
            '불러오는 중…'
          )}
        </p>
        <span className="ml-auto flex shrink-0 items-center gap-2">
          <DisclosureButton open={open} onToggle={() => setOpen((v) => !v)} label="지금 조건 보기" controls={`condition-card-${s.accountId}`} />
          <Button size="sm" onClick={onOpenSettings} className="whitespace-nowrap">
            설정 열기
          </Button>
          <Button size="sm" onClick={tryBacktest} className="whitespace-nowrap">
            백테스트에서 시험하기
          </Button>
        </span>
      </div>
      {rule && !rule.sell.stopLoss.on && (
        <p className="text-caption text-warning">
          <WarnIcon />
          {NO_STOP_WARNING}
        </p>
      )}
      {open && (
        <dl id={`condition-card-${s.accountId}`} className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1 text-caption">
          <Line label="매매 규칙">{rule ? `「${rule.name}」` : '없음'}</Line>
          <Line label="매수 조건">{rule ? ruleBuyText(rule) : '—'}</Line>
          <Line label="매도 조건">{rule ? ruleSellText(rule) : '—'}</Line>
          <Line label="손절 · 익절 · 트레일링" strong>
            {rule ? ruleSafetyText(rule) : '—'}
          </Line>
          <Line label="대상 종목">{s.symbols.length}개</Line>
          <Line label="판단 시각">{JUDGE_TIMING_TEXT}</Line>
          <Line label="다음 판단">{nextJudgeText(s.symbols)}</Line>
        </dl>
      )}
    </Panel>
  );
}
