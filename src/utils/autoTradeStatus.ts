import type { AccountStrategy, AccountStrategyStatus } from '../types/autoTrading';

/**
 * 자동매매 카드 상태 — **네 가지**다.
 *
 * ⚠️ 예전에는 "가동 중 / 멈춤 / 꺼짐" 셋이었는데, 서버의 `blockedReason` 이 성격이 다른
 * 두 가지를 한 문자열에 섞고 있었다. 미국 정규장은 한국 시간으로 밤이라 **켜 둔 계좌가
 * 밤새 "멈춤: 정규장 시간이 아닙니다"** 로 보였고, 그걸 고장으로 읽게 된다.
 * 반대로 진짜 고장(키 없음·종목 0개)은 그 사이에 묻힌다.
 *
 * ⚠️ 판정은 **문구가 아니라 `blockedKind`** 로 한다. 문구를 다듬을 때마다 화면 분기가
 * 조용히 깨지면 안 된다.
 * ⚠️ 이 분류는 **한 곳**이다 — 카드·헤더 요약·오른쪽 계좌 탭이 같은 값을 써야 한다.
 */
export type AutoTradeState = 'running' | 'waiting' | 'blocked' | 'off';

export interface AutoTradeView {
  state: AutoTradeState;
  /** 색을 못 가려내는 사람도 읽을 수 있게 **기호를 반드시 함께** 둔다 */
  symbol: string;
  label: string;
  /** 배지 옆에 흐리게 붙는 보조 설명 (배지 안에 넣으면 행이 줄바꿈된다) */
  hint: string | null;
  /** 사유가 있으면 붙인다 (툴팁·배지 문구) */
  reason: string | null;
  /** 지금 이 계좌를 처리 중 */
  busy: boolean;
}

export function autoTradeView(
  strategy: AccountStrategy | null | undefined,
  status: AccountStrategyStatus | null | undefined,
): AutoTradeView {
  const busy = Boolean(status?.running);

  if (!strategy?.enabled) {
    return {
      state: 'off',
      symbol: '○',
      label: '자동매매 꺼짐',
      hint: null,
      reason: null,
      busy: false,
    };
  }

  if (status?.blockedKind === 'config') {
    return {
      state: 'blocked',
      symbol: '⚠',
      label: '멈춤',
      hint: null,
      reason: status.blockedReason,
      busy: false,
    };
  }

  if (status?.blockedKind === 'market_closed') {
    return {
      state: 'waiting',
      symbol: '◐',
      label: '대기',
      /*
        ⚠️ 이 설명을 **배지 안에 넣지 않는다.** 1280px 3열에서 배지가 한 줄을 다 먹어
        [끄기] 가 다음 줄로 밀린다 — 대기 카드만 키가 달라져 줄이 어긋나 보인다.
        뜻은 그대로 두고 자리만 배지 밖으로 옮겼다.
      */
      hint: '장이 열리면 자동으로 시작',
      reason: status.blockedReason,
      busy: false,
    };
  }

  return {
    state: 'running',
    symbol: '●',
    label: busy ? '실행 중…' : '자동매매 가동 중',
    hint: null,
    reason: null,
    busy,
  };
}

/** 점·기호 색 — 카드와 오른쪽 계좌 탭이 같은 색을 쓴다 */
export const AUTO_TRADE_TONE: Record<AutoTradeState, string> = {
  running: 'text-bullish',
  // 정상 대기라 경고색을 쓰지 않는다 — 사람이 할 일이 없는 상태다.
  waiting: 'text-text-secondary',
  blocked: 'text-warning',
  off: 'text-text-muted',
};
