import { useState } from 'react';
import Holdings from './Holdings';
import PaperTradingDashboard from '../paper-trading/PaperTradingDashboard';

/**
 * 계좌 > 포트폴리오 — **실제 계좌와 모의투자 계좌를 한 화면에서 전환**한다.
 *
 * 예전에는 사이드 메뉴가 달랐다. 하지만 사용자가 묻는 것은 "내 계좌가 지금 어떤가" 하나이고,
 * 실제냐 모의냐는 그 안의 선택지다. 메뉴를 나눠 두면 같은 질문을 두 곳에서 하게 된다.
 *
 * ⚠️ 모의투자는 앱 내부 SQLite 에서만 움직인다 — 실제 주문은 어디에서도 나가지 않는다.
 */
type AccountKind = 'real' | 'paper';

const ACCOUNTS: { id: AccountKind; label: string }[] = [
  { id: 'real', label: '실제 계좌 (토스증권)' },
  { id: 'paper', label: '모의투자 계좌' },
];

interface Props {
  symbol: string;
  onSelectSymbol: (symbol: string) => void;
  /** 모의투자 계좌로 열지 — 빠른주문 패널의 '모의투자로 가기' 가 여기로 온다 */
  initialAccount?: AccountKind;
}

export default function PortfolioView({ symbol, onSelectSymbol, initialAccount = 'real' }: Props) {
  const [account, setAccount] = useState<AccountKind>(initialAccount);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
        <h2 className="text-sm font-semibold">💼 포트폴리오</h2>

        <label className="ml-2 flex w-fit items-center gap-1.5 text-[11px] text-text-secondary">
          계좌
          <select
            value={account}
            onChange={(e) => setAccount(e.target.value as AccountKind)}
            className="rounded border border-border px-1.5 py-0.5 text-[11px]"
          >
            {ACCOUNTS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>

        {account === 'paper' && (
          <span className="rounded bg-warning/15 px-2 py-0.5 text-[11px] text-warning">
            모의 — 실제 주문은 나가지 않습니다
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1">
        {account === 'real' ? (
          <Holdings onSelectSymbol={onSelectSymbol} />
        ) : (
          <PaperTradingDashboard symbol={symbol} onSelectSymbol={onSelectSymbol} />
        )}
      </div>
    </div>
  );
}
