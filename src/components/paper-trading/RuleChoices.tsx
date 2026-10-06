import type { RuleConfig } from '../../types/autoTrading';
import { nearestEngineMa } from '../../types/autoTrading';
import RuleChoiceCards from '../common/RuleChoiceCards';
import { Badge, Button } from '../ui';
import { useAppStore } from '../../store/appStore';
import { usePaperAccounts } from '../../hooks/usePaperTrading';
import { ruleMethodName } from '../../utils/autoTradeExplain';

/**
 * 규칙형 쉬운 선택지 3개 + 「지금 조건」 요약 (v2.31.0 → v2.38.0).
 *
 * - 세 선택지의 값은 **앱의 출발값(검증 전)** 이다 — "추천"·"검증된" 이라고 쓰지 않는다.
 * - 저장된 값이 셋 중 어느 것과도 같지 않으면 「직접 설정」.
 * - v2.38.0: 「과거 1년에 썼다면?」(1년 재현)을 지웠다 — 「실험실 > 백테스트」 가 대신한다(종목·조건·기간을 고를 수 있다).
 *   그 자리에 「지금 조건」 요약 + [백테스트에서 시험하기](이 계좌의 대상 종목 + 고치는 중인 조건을 채워서 연다).
 */

// 세 방법의 정의는 `types/ruleChoices.ts` 한 곳
export { RULE_CHOICES, matchChoice, type RuleChoice } from '../../types/ruleChoices';
import { matchChoice } from '../../types/ruleChoices';

function MaValue({ period }: { period: number }) {
  const used = nearestEngineMa(period);
  return used === period ? <>{period}일</> : <>{period}일 → {used}일로 계산</>;
}

export default function RuleChoices({
  rule,
  onChange,
  symbols,
  hardStopLossPercent,
  trailingStopEnabled,
  trailingStopPercent,
  accountId,
  leaveHint,
}: {
  rule: RuleConfig;
  onChange: (rule: RuleConfig) => void;
  symbols: string[];
  hardStopLossPercent: number;
  trailingStopEnabled: boolean;
  trailingStopPercent: number;
  /** [백테스트에서 시험하기] 안내 줄의 계좌 이름을 찾는다 */
  accountId: number | null;
  /** 창을 떠날 때 사라지는 것 — 버튼 아래 한 줄 */
  leaveHint?: string;
}) {
  const active = matchChoice(rule);
  const setPage = useAppStore((st) => st.setPage);
  const setPreset = useAppStore((st) => st.setBacktestPreset);
  const { accounts } = usePaperAccounts();
  const name = accounts.find((a) => a.id === accountId)?.name ?? '이 계좌';
  const off = (v: boolean) => (v ? '' : ' (안 씀)');

  const tryBacktest = () => {
    // 고치는 중인 값 그대로 넘긴다 — 이동평균은 백테스트 화면이 엔진 일수로 맞추고 안내한다
    setPreset({ from: name, symbols: [...symbols], rule: { ...rule }, hardStopLossPercent, trailingStopEnabled, trailingStopPercent });
    setPage('backtest');
  };

  const rows: [string, React.ReactNode][] = [
    ['판단 방식', '규칙형'],
    ['방법', active ? ruleMethodName(rule) : <Badge>직접 설정</Badge>],
    [
      '이동평균 단기 · 장기',
      <>
        <MaValue period={rule.maShort} /> · <MaValue period={rule.maLong} />
        {off(rule.useMaCross)}
      </>,
    ],
    ['RSI 살 때 · 팔 때', `${rule.rsiBuyBelow} 이하 반등 · ${rule.rsiSellAbove} 이상${off(rule.useRsi)}`],
    ['손절', `${hardStopLossPercent}%`],
    ['트레일링', trailingStopEnabled ? `${trailingStopPercent}%` : '끔'],
  ];

  return (
    <div className="space-y-2">
      <RuleChoiceCards rule={rule} onPick={(c) => onChange({ ...rule, ...c.rule })} />
      {!active && (
        <p className="text-[13px] text-text-secondary">
          <Badge>직접 설정</Badge> 아래 「상세 설정」 에서 고친 값입니다.
        </p>
      )}
      <p className="text-[13px] text-text-muted">
        세 가지 값은 앱의 출발값입니다(근거 검증 전). 손절(−{hardStopLossPercent}%)은 어느 방법이든 따로 지켜집니다.
      </p>
      {/* ⚠️ 고정 안내 — 지우지 않는다 */}
      <p className="rounded-md bg-warning/10 px-2.5 py-1.5 text-[13px] text-warning">
        어느 방법도 이 앱에서 돈을 번다고 확인된 적은 없습니다. 「실험실 &gt; 백테스트」 에서 과거에 시험해 보세요.
      </p>

      {/* 지금 조건 요약 (v2.38.0) */}
      <div className="space-y-2 rounded-lg bg-bg-tertiary/40 p-3">
        <p className="text-xs font-semibold text-text-primary">지금 조건</p>
        <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-1 text-[13px]">
          {rows.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-text-muted">{k}</dt>
              <dd className="text-text-primary">{v}</dd>
            </div>
          ))}
        </dl>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={tryBacktest}>
            백테스트에서 시험하기
          </Button>
          <span className="min-w-0 text-[13px] text-text-muted">
            대상 종목 {symbols.length}개와 지금 조건을 채워 「실험실 &gt; 백테스트」 를 엽니다.{leaveHint ? ` ${leaveHint}` : ''}
          </span>
        </div>
      </div>
    </div>
  );
}
