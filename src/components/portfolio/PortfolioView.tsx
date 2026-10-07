import { usePageTab } from '../../hooks/usePageTab';
import PageHeader from '../ui/PageHeader';
import type { PageTab } from '../../types/nav';
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
/** 탭 목록은 `types/nav.ts` 의 `PAGE_TABS.portfolio` 한 곳 — 주소 `#/portfolio/{paper|real}` (v2.28.0, 첫 탭 = 모의투자) */
type AccountKind = PageTab<'portfolio'>;

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
}

/*
 * 유형 탭은 주소와 짝인 `nav.sub` 다 (v2.28.0). 예전에는 App 이 `initialAccount` + `onMounted` 로 "일회성 의도" 를 넘겼다 —
 * 빠른주문의 [모의투자로 가기] 같은 곳은 이제 `setPage('portfolio', 'paper')` 로 탭을 정해 연다.
 */
export default function PortfolioView({ onSelectSymbol }: Props) {
  const [account, setAccount] = usePageTab('portfolio');

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 제목 줄 / 탭 줄을 나눈다 (v2.41.0 — 예전에는 제목·탭·배지가 한 줄이라 구분이 어려웠다) */}
      <PageHeader
        title="계좌 관리"
        tabs={ACCOUNTS}
        value={account}
        onChange={setAccount}
        tabsLabel="계좌 유형"
        tabsRight={
          account === 'paper' ? (
            <span className="rounded bg-warning/15 px-2 py-0.5 text-[13px] text-warning">모의 — 실제 주문은 나가지 않습니다</span>
          ) : null
        }
      />

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
