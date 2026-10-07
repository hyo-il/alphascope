import type { ReactNode } from 'react';
import type { AccountStrategy } from '../../types/autoTrading';
import { Button, Panel } from '../ui';
import { useAppStore } from '../../store/appStore';
import { usePaperAccounts } from '../../hooks/usePaperTrading';
import { aiBuySentence, aiSellSentence, ruleBuySentence, ruleMethodName, ruleSellSentence } from '../../utils/autoTradeExplain';

/**
 * 계좌 「지금 조건」 카드 (v2.40.0) — 자동매매 바 바로 아래. 예전 바의 회색 한 줄을 옮겼다(두 번 보이지 않게).
 * 손절·익절·트레일링 값은 한 단계 굵게(500) — 초보자가 안전장치를 한눈에 보게. **색은 쓰지 않는다**(상태색과 섞이지 않게).
 * 문장은 `utils/autoTradeExplain.ts` 한 곳(매수·매도 조건 · 방법 이름). 숫자는 지금 설정 값에서만.
 */
function Line({ label, children, strong = false }: { label: string; children: ReactNode; strong?: boolean }) {
  return (
    <div className="contents">
      <dt className="text-text-muted">{label}</dt>
      <dd className={strong ? 'font-medium text-text-primary' : 'text-text-secondary'}>{children}</dd>
    </div>
  );
}

export default function ConditionCard({ strategy: s, onOpenSettings }: { strategy: AccountStrategy; onOpenSettings: () => void }) {
  const setPage = useAppStore((st) => st.setPage);
  const setPreset = useAppStore((st) => st.setBacktestPreset);
  const { accounts } = usePaperAccounts();
  const name = accounts.find((a) => a.id === s.accountId)?.name ?? '이 계좌';
  const rule = s.mode === 'rule';

  const tryBacktest = () => {
    setPreset({
      from: name,
      symbols: [...s.symbols],
      rule: { ...s.rule },
      hardStopLossPercent: s.hardStopLossPercent,
      trailingStopEnabled: s.trailingStopEnabled,
      trailingStopPercent: s.trailingStopPercent,
      takeProfitEnabled: s.takeProfitEnabled,
      takeProfitPercent: s.takeProfitPercent,
    });
    setPage('backtest');
  };

  return (
    <Panel pad="sm" className="mx-4 my-2 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-xs font-semibold text-text-primary">지금 조건</p>
        <span className="ml-auto flex items-center gap-2">
          <Button size="sm" onClick={onOpenSettings}>
            설정 열기
          </Button>
          {rule && (
            <Button size="sm" onClick={tryBacktest}>
              백테스트에서 시험하기
            </Button>
          )}
        </span>
      </div>
      <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1 text-[13px]">
        <Line label="판단 방식">{rule ? `규칙형 · ${ruleMethodName(s.rule)}` : 'AI형'}</Line>
        <Line label="매수 조건">{rule ? ruleBuySentence(s.rule) : aiBuySentence(s)}</Line>
        <Line label="매도 조건">{rule ? ruleSellSentence(s.rule) : aiSellSentence(s)}</Line>
        <Line label="손절" strong>
          −{s.hardStopLossPercent}% (매수가보다 이만큼 내려가면 매도)
        </Line>
        <Line label="익절" strong>
          {s.takeProfitEnabled ? `+${s.takeProfitPercent}% (매수가보다 이만큼 오르면 매도)` : '끔'}
        </Line>
        <Line label="트레일링" strong>
          {s.trailingStopEnabled ? `최고가보다 ${s.trailingStopPercent}% 하락하면 매도` : '끔'}
        </Line>
        <Line label="대상 종목">{s.symbols.length}개</Line>
        <Line label="판단 주기">
          {s.intervalMinutes}분마다{s.marketHoursOnly ? ' (미국 정규장)' : ''} · 손절·익절·트레일링은 1분마다
        </Line>
      </dl>
    </Panel>
  );
}
