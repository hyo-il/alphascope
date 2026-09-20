import { useEffect, useState } from 'react';
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

/*
 * 계좌 '유형' 은 둘뿐이라 드롭다운이 아니라 **탭**이다.
 *
 * 예전에는 여기도 `<select>` 였는데, 그 아래 AccountManager 에도 개별 계좌를 고르는
 * 드롭다운이 있어 같은 모양이 두 줄로 겹쳤다. 그래서 상단의 "모의투자 계좌" 가
 * 계좌 **이름**처럼 읽혀, 새로 만든 계좌가 거기 안 보인다는 혼동이 났다.
 * 모양을 갈라 두면 역할도 갈라진다 — 위는 유형(탭), 아래는 계좌(드롭다운).
 *
 * 라벨에서 '계좌'·'(토스증권)' 을 뺀 것도 같은 이유다. 탭은 유형만 가리켜야 한다.
 */
const ACCOUNTS: { id: AccountKind; label: string }[] = [
  { id: 'paper', label: '모의투자' },
  { id: 'real', label: '실제 계좌' },
];

interface Props {
  onSelectSymbol: (symbol: string) => void;
  /** 모의투자 계좌로 열지 — 빠른주문 패널의 '모의투자로 가기' 가 여기로 온다 */
  initialAccount?: AccountKind;
  /**
   * 열고 나면 호출한다 — `initialAccount` 는 **일회성 의도**다.
   * 소비한 뒤 되돌리지 않으면, 빠른주문으로 한 번 들어온 사용자는 이후 사이드 메뉴로
   * 들어갈 때마다 모의투자 계좌가 먼저 열린다 (기본은 실제 계좌다).
   */
  onMounted?: () => void;
}

export default function PortfolioView({
  onSelectSymbol,
  initialAccount = 'paper',
  onMounted,
}: Props) {
  const [account, setAccount] = useState<AccountKind>(initialAccount);

  useEffect(() => {
    onMounted?.();
    // 마운트 시 한 번만 — 이후 계좌 전환은 이 화면 안의 선택이다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/*
        제목 · 탭 · 뱃지가 한 줄이다. 세로 여백은 탭 버튼(py-2)이 정하고 컨테이너는 주지
        않는다 — 그래야 선택 탭의 밑줄이 이 줄의 구분선과 맞닿는다 (다른 화면의 탭과 같다).
      */}
      <div className="flex shrink-0 items-stretch gap-1 border-b border-border px-3">
        <h2 className="flex items-center pr-3 text-sm font-semibold">💼 계좌 관리</h2>

        {/* `<select>` 에 붙어 있던 '계좌' 라벨이 사라진 자리를 aria-label 이 대신한다 */}
        <div role="tablist" aria-label="계좌 유형" className="flex items-stretch gap-1">
          {ACCOUNTS.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={account === item.id}
              onClick={() => setAccount(item.id)}
              className={`border-b-2 px-3 py-2 text-sm transition-colors ${
                account === item.id
                  ? 'border-accent text-text-primary'
                  : 'border-transparent text-text-secondary hover:text-text-primary'
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {account === 'paper' && (
          <span className="my-auto ml-2 rounded bg-warning/15 px-2 py-0.5 text-[11px] text-warning">
            모의 — 실제 주문은 나가지 않습니다
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1">
        {account === 'real' ? (
          <Holdings onSelectSymbol={onSelectSymbol} />
        ) : (
          <PaperTradingDashboard onSelectSymbol={onSelectSymbol} />
        )}
      </div>
    </div>
  );
}
