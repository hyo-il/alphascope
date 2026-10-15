import type { AccountStrategy, AccountStrategyStatus, DecisionNote } from '../types/autoTrading';
import type { RuleBody } from '../types/tradingRule';
import type { AutoTradeView } from './autoTradeStatus';

/**
 * 자동매매를 **쉬운 말로** 설명하는 곳 — 한 곳이다 (v2.32.0 → v2.44.0 매매 규칙).
 *
 * ⚠️ 분기는 사유 문장이 아니라 **`code`**(엔진이 판단할 때 붙인 종류)와 `blockedKind` 로 한다.
 * ⚠️ 숫자는 설정값·규칙 값에서만 넣는다 — 여기서 새로 지어내지 않는다.
 * 코드가 없는 기록·`other` 는 `null` 을 돌려준다(화면은 원래 문장만 보인다).
 * 규칙 자체의 한 줄 문장은 `utils/ruleText.ts`.
 */

export function explainNote(note: DecisionNote, name: string, s: Pick<AccountStrategy, 'maxPositions' | 'dailyLossLimitPercent'>, rule: RuleBody | null): string | null {
  switch (note.code) {
    case 'no_signal_buy':
      return `${name}: 매수 조건 점수가 아직 기준에 못 미쳐 기다리는 중입니다.`;
    case 'no_signal_hold':
      return `${name}: 들고 있습니다. 매도 조건이 아직 아닙니다.`;
    case 'score_buy':
      return `${name}: 매수 조건 점수가 기준 이상이라 매수했습니다.`;
    case 'score_sell':
      return `${name}: 점수가 매도 기준 아래로 떨어져 매도했습니다.`;
    case 'rr_block':
      return `${name}: 점수는 기준 이상이지만 잃을 돈이 벌 돈보다 커서(손익비 1 미만) 매수하지 않았습니다.`;
    case 'reentry_wait':
      return `${name}: 손절한 지 얼마 되지 않아 정해 둔 거래일이 지날 때까지 다시 매수하지 않습니다.`;
    case 'dead':
      return `${name}: 오르는 흐름이 꺾여(반대 신호) 매도했습니다.`;
    case 'rsi_hot':
      return `${name}: 많이 올라(반대 신호) 매도했습니다.`;
    case 'hard_stop':
      return `${name}: 매수가보다 ${rule?.sell.stopLoss.percent ?? '—'}% 넘게 떨어져 더 잃지 않으려고 매도했습니다(손절).`;
    case 'take_profit':
      return `${name}: 목표 수익 +${rule?.sell.takeProfit.percent ?? '—'}% 에 닿아 모두 매도했습니다(익절).`;
    case 'trailing':
      return `${name}: 최고가보다 많이 내려와 매도했습니다(트레일링).`;
    case 'earnings_blackout':
      return `${name}: 곧 실적 발표가 있어 새로 매수하지 않았습니다(발표 때 크게 움직일 수 있어서).`;
    case 'max_positions':
      return `${name}: 매수 조건이었지만 이미 ${s.maxPositions}종목을 들고 있어 매수하지 않았습니다.`;
    case 'daily_loss':
      return '오늘 계좌가 많이 줄어 새로 매수하지 않습니다(하루 손실 한도).';
    case 'not_enough_candles':
      return `${name}: 가격 데이터가 아직 부족해 판단하지 않았습니다.`;
    case 'error':
      return `${name}: 주문하지 못했습니다(아래 자세한 이유).`;
    // AI 검증(v2.46.0) — 이유는 줄을 펼치면(note.detail) 보인다
    case 'ai_pass':
      return `${name}: 규칙 사도 됨 · AI 검증 통과 — 매수했습니다.`;
    case 'ai_risk':
      return `${name}: 규칙은 사도 됨이었지만 AI 검증에서 위험하다고 해 매수하지 않았습니다 — ${note.detail?.[0] ?? '이유는 펼쳐서 보세요'}`;
    case 'ai_unavailable':
      return `${name}: AI 검증을 하지 못해 매수하지 않았습니다(${note.detail?.[0] ?? 'AI 오류'}).`;
    default:
      return null;
  }
}

/** 「최근 판단」 정렬 — 사거나 판 줄이 위, 기다림 줄이 아래 (같은 무리 안에서는 원래 순서) */
export function sortNotes<T extends DecisionNote>(notes: T[]): T[] {
  const rank = (n: DecisionNote) => (n.action === 'HOLD' ? 1 : 0);
  return notes.map((n, i) => ({ n, i })).sort((a, b) => rank(a.n) - rank(b.n) || a.i - b.i).map((x) => x.n);
}

/**
 * 한국 시간으로 적는다 — "2026-10-02 22:30" (기준표 「날짜 표기」).
 * 화면 문장에만 쓴다. 한국 시간을 명시하는 문장이라 브라우저 시간대가 아니라 Asia/Seoul 로 잰다.
 */
export function kstLabel(at: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(at)
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`;
}

/**
 * 「다음 판단」 — 서버가 휴장일까지 보고 계산한 시장별 다음 개장 시각(`status.nextOpen`, v2.44.1)을 한국 시간으로 보이기만 한다.
 * 예: "시장이 열린 뒤 (미국 2026-10-14 22:30 · 국내 2026-10-15 09:00, 한국 시간)". 상태를 아직 못 받았으면 시각 없이.
 * ⚠️ 화면에서 개장 시각을 계산하지 않는다(v2.44.0 까지는 평일만 보고 계산해 휴장일에 틀렸다).
 */
export function nextJudgeText(status: Pick<AccountStrategyStatus, 'nextOpen'> | null, prefix = '시장이 열린 뒤'): string {
  const label = { US: '미국', KR: '국내' } as const;
  const parts = (['US', 'KR'] as const).filter((m) => status?.nextOpen?.[m]).map((m) => `${label[m]} ${kstLabel(new Date(status!.nextOpen[m]!))}`);
  return parts.length ? `${prefix} (${parts.join(' · ')}, 한국 시간)` : prefix;
}

/** 고칠 곳은 문장 끝에 「[자동매매 설정] 에서 고칩니다」 로 알린다 — 같은 화면에 설정 버튼을 두 개 두지 않는다(v2.44.2, 사용자 결정 C-1) */
export interface NowSentence {
  text: string;
  extra: string | null;
}

const JUDGE_EXTRA = '매수·매도 판단은 종목마다 그 시장이 열린 뒤 하루 한 번(어제까지 끝난 봉 기준)이고, 손절·익절·트레일링은 1분마다 봅니다.';

/** 자동매매 바 맨 위의 "지금 상태" 한 문장 — 켜져 있을 때만. 분류는 `autoTradeView()` 를 그대로 쓴다 */
export function nowSentence(strategy: AccountStrategy, status: AccountStrategyStatus | null, view: AutoTradeView): NowSentence | null {
  if (!strategy.enabled) return null;
  const n = strategy.symbols.length;
  if (view.state === 'waiting') {
    return { text: `지금은 대상 종목의 시장이 닫혀 기다리는 중입니다. 다음 판단: ${nextJudgeText(status)}.`, extra: JUDGE_EXTRA };
  }
  if (view.state === 'blocked') {
    if (status?.blockedKind === 'daily_loss') {
      return {
        text: `오늘 계좌가 ${strategy.dailyLossLimitPercent}% 넘게 줄어 새로 매수하지 않습니다(하루 손실 한도). 이미 매수한 종목의 손절·매도는 계속하고, 다음 거래일에 저절로 풀립니다. 한도는 [자동매매 설정] 에서 고칩니다.`,
        extra: JUDGE_EXTRA,
      };
    }
    if (status?.blockedKind === 'server_off') return { text: '이 서버에서는 자동매매가 꺼져 있어 돌지 않습니다(서버 설정).', extra: null };
    if (strategy.ruleId == null) return { text: '매매 규칙을 고르세요. 「① 매매 규칙」 은 [자동매매 설정] 에서 고칩니다.', extra: null };
    if (n === 0) return { text: '대상 종목이 없어 멈춰 있습니다. 「② 대상 종목」 은 [자동매매 설정] 에서 고칩니다.', extra: null };
    return { text: `${status?.blockedReason ?? '설정 문제로 멈춰 있습니다'}. [자동매매 설정] 에서 고칩니다.`, extra: null };
  }
  const judged = status?.judgedToday ?? 0;
  // 열린 시장의 오늘 판단을 이미 마쳤으면 다음 개장을 알린다(아니면 「오늘 판단 N/M종목」)
  if (n > 0 && judged >= n) {
    return { text: `오늘 판단을 마쳤습니다. 다음 판단: ${nextJudgeText(status, '다음 개장')}.`, extra: JUDGE_EXTRA };
  }
  return {
    text: `시장이 열려 있습니다. 오늘 ${n}종목 중 ${judged}종목을 판단했고, 나머지는 1분 안에 봅니다.`,
    extra: JUDGE_EXTRA,
  };
}

// ── 백테스트 「매도한 이유」 쉬운 말 — 비교 표·종목별 표가 같은 문장을 쓴다 (숫자는 그 방법의 규칙에서) ──

export type ExitReason = 'signal' | 'stop' | 'take_profit' | 'trailing' | 'end';

export function exitReasonText(kind: ExitReason, rule: RuleBody): string {
  const s = rule.sell;
  switch (kind) {
    case 'signal': {
      const parts: string[] = [];
      if (s.scoreBelow.on) parts.push(`점수 ${s.scoreBelow.value}점 아래`);
      if (s.opposite.on) parts.push('반대 신호');
      return `매도 신호(${parts.join(' 또는 ') || '없음'})`;
    }
    case 'stop':
      return `손절(매수가보다 ${s.stopLoss.percent}% 하락)`;
    case 'take_profit':
      return `익절(매수가보다 ${s.takeProfit.percent}% 상승)`;
    case 'trailing':
      return `트레일링(최고가보다 ${s.trailing.percent}% 하락)`;
    case 'end':
      return '시험 기간이 끝나 정리';
  }
}
