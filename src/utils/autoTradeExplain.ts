import { nearestEngineMa, type AccountStrategy, type AccountStrategyStatus, type DecisionNote, type RuleConfig } from '../types/autoTrading';
import { RULE_CHOICES, matchChoice } from '../types/ruleChoices';
import type { AutoTradeView } from './autoTradeStatus';

/**
 * 자동매매를 **쉬운 말로** 설명하는 곳 — 한 곳이다 (v2.32.0).
 *
 * ⚠️ 분기는 사유 문장이 아니라 **`code`**(엔진이 판단할 때 붙인 종류)와 `blockedKind` 로 한다.
 * 문장을 읽어 분기하면 엔진 문구를 다듬을 때마다 조용히 깨진다.
 * ⚠️ 숫자는 설정값에서만 넣는다 — 여기서 새로 지어내지 않는다.
 * 코드가 없는 옛 기록·`other` 는 `null` 을 돌려준다(화면은 원래 문장만 보인다).
 */

type Settings = Pick<AccountStrategy, 'hardStopLossPercent' | 'maxPositions' | 'dailyLossLimitPercent'> & Partial<Pick<AccountStrategy, 'takeProfitPercent'>>;

export function explainNote(note: DecisionNote, name: string, s: Settings): string | null {
  switch (note.code) {
    case 'no_signal_buy':
      return `${name}: 살 조건이 아직 아니라 기다리는 중입니다.`;
    case 'no_signal_hold':
      return `${name}: 들고 있습니다. 팔 조건이 아직 아닙니다.`;
    case 'golden':
      return `${name}: 최근 평균값이 위로 올라서서(오르는 흐름 시작) 매수했습니다.`;
    case 'rsi_rebound':
      return `${name}: 많이 떨어졌다가 다시 오르기 시작해 매수했습니다.`;
    case 'dead':
      return `${name}: 오르는 흐름이 꺾여 매도했습니다.`;
    case 'rsi_hot':
      return `${name}: 많이 올라 매도했습니다.`;
    case 'hard_stop':
      return `${name}: 매수가보다 ${s.hardStopLossPercent}% 넘게 떨어져 더 잃지 않으려고 매도했습니다(손절).`;
    case 'take_profit':
      return `${name}: 목표 수익 +${s.takeProfitPercent ?? '—'}% 에 닿아 모두 매도했습니다(익절).`;
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
    case 'ai_buy':
      return `${name}: AI 가 매수하자고 판단해 매수했습니다.`;
    case 'ai_sell':
      return `${name}: AI 가 매도하자고 판단해 매도했습니다.`;
    case 'ai_hold':
      return `${name}: AI 판단이 매수·매도할 때가 아니라서 그대로 둡니다.`;
    case 'ai_low_confidence':
      return `${name}: AI 신호는 있었지만 확신이 기준보다 낮아 그대로 둡니다.`;
    default:
      return null;
  }
}

/** 「최근 판단」 정렬 — 사거나 판 줄이 위, 기다림 줄이 아래 (같은 무리 안에서는 원래 순서) */
export function sortNotes<T extends DecisionNote>(notes: T[]): T[] {
  const rank = (n: DecisionNote) => (n.action === 'HOLD' ? 1 : 0);
  return notes.map((n, i) => ({ n, i })).sort((a, b) => rank(a.n) - rank(b.n) || a.i - b.i).map((x) => x.n);
}

/** 한국 시간으로 적는다 — "10월 2일 (금) 22:30" */
export function kstLabel(at: Date): string {
  return at.toLocaleString('ko-KR', {
    timeZone: 'Asia/Seoul',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/**
 * 다음 미국 정규장 시작(09:30 ET) — 평일만 본다.
 * 스케줄러의 시간 판정(`server/marketHours.ts` 의 `isUsMarketOpen`)이 주말만 보고 휴장일은 보지 않아 **같은 규칙**으로 센다.
 * 09:30 ET 는 UTC 로 늘 15분 경계라(시간대 차가 정수 시간) 15분씩 넘기며 찾는다.
 */
export function nextUsOpen(now = new Date()): Date {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const step = 15 * 60_000;
  let t = Math.ceil((now.getTime() + 1) / step) * step;
  for (let k = 0; k < 4 * 96 * 2; k++, t += step) {
    const parts = fmt.formatToParts(new Date(t));
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    const wd = get('weekday');
    if (wd === 'Sat' || wd === 'Sun') continue;
    if (Number(get('hour')) % 24 === 9 && Number(get('minute')) === 30) return new Date(t);
  }
  return new Date(t);
}

export interface NowSentence {
  text: string;
  /** 규칙형이면 덧붙이는 한 줄 */
  extra: string | null;
  /** [설정 열기] 를 보일지 — 설정을 고치면 풀리는 멈춤만 */
  fix: boolean;
}

/**
 * 자동매매 바 맨 위의 "지금 상태" 한 문장 — 켜져 있을 때만.
 * 분류는 `autoTradeView()`(한 곳)를 그대로 쓰고, 문장만 여기서 만든다.
 */
export function nowSentence(
  strategy: AccountStrategy,
  status: AccountStrategyStatus | null,
  view: AutoTradeView,
  now = new Date(),
): NowSentence | null {
  if (!strategy.enabled) return null;
  const extra = strategy.mode === 'rule' ? '판단은 전날 마감 기준이라 하루에 한 번만 바뀝니다.' : null;
  const n = strategy.symbols.length;

  if (view.state === 'waiting') {
    return {
      text: `지금은 미국 장이 닫혀 기다리는 중입니다. 장이 열리면 ${kstLabel(nextUsOpen(now))}(한국 시간)에 다시 판단합니다.`,
      extra,
      fix: false,
    };
  }
  if (view.state === 'blocked') {
    if (status?.blockedKind === 'daily_loss') {
      return {
        text: `오늘 계좌가 ${strategy.dailyLossLimitPercent}% 넘게 줄어 새로 매수하지 않습니다(하루 손실 한도). 이미 매수한 종목의 손절·매도는 계속하고, 다음 거래일에 저절로 풀립니다.`,
        extra,
        fix: true,
      };
    }
    if (status?.blockedKind === 'server_off') {
      return { text: '이 서버에서는 자동매매가 꺼져 있어 돌지 않습니다(서버 설정).', extra: null, fix: false };
    }
    // config — 무엇이 문제인지는 설정 값으로 가른다(문구로 가르지 않는다)
    if (n === 0) {
      return { text: '대상 종목이 없어 멈춰 있습니다. [설정 열기]에서 종목을 추가해 주세요.', extra: null, fix: true };
    }
    if (strategy.mode === 'ai') {
      return {
        text: 'AI형인데 Gemini 키가 없어 멈춰 있습니다. 규칙형으로 바꾸면 키 없이 돕니다.',
        extra: null,
        fix: true,
      };
    }
    return { text: '설정 문제로 멈춰 있습니다. [설정 열기]에서 확인해 주세요.', extra: null, fix: true };
  }

  const next = status?.nextRunAt ? kstLabel(new Date(status.nextRunAt)) : null;
  return {
    text: next
      ? `${next}에 대상 ${n}종목을 다시 봅니다. 손절은 장중에 계속 지켜봅니다.`
      : `곧(1분 안에) 대상 ${n}종목을 봅니다. 손절은 장중에 계속 지켜봅니다.`,
    extra,
    fix: false,
  };
}

// ── 「지금 조건」 한 줄 (v2.38.0) — 계좌 자동매매 바·설정 창 요약·백테스트 결과 머리줄이 같은 문장을 쓴다 ──

export interface RuleConditions {
  rule: RuleConfig;
  hardStopLossPercent: number;
  trailingStopEnabled: boolean;
  trailingStopPercent: number;
  /** 익절 (v2.39.0) — 없으면 꺼짐(20차 기록·옛 값) */
  takeProfitEnabled?: boolean;
  takeProfitPercent?: number;
}

/** 익절 한 조각 — "익절 +10%" / "익절 끔" */
export const takeProfitText = (c: { takeProfitEnabled?: boolean; takeProfitPercent?: number }) =>
  c.takeProfitEnabled ? `익절 +${c.takeProfitPercent}%` : '익절 끔';

/** 방법 이름 — 세 쉬운 선택지 중 같은 것이 있으면 그 이름(「둘 다 (지금 기본값)」 은 괄호를 뗀다), 없으면 「직접 설정」 */
export function ruleMethodName(rule: RuleConfig): string {
  const id = matchChoice(rule);
  const title = RULE_CHOICES.find((c) => c.id === id)?.title;
  return title ? title.replace(/\s*\(.*\)$/, '') : '직접 설정';
}

/** 엔진이 실제로 쓰는 이동평균 일수와 다를 때의 안내 — 예) "단기 이동평균 13일은 20일로 계산됩니다" (같으면 빈 배열) */
export function maRoundingNotes(rule: Pick<RuleConfig, 'maShort' | 'maLong'>): string[] {
  const out: string[] = [];
  for (const [label, v] of [['단기', rule.maShort], ['장기', rule.maLong]] as const) {
    const used = nearestEngineMa(v);
    if (used !== v) out.push(`${label} 이동평균 ${v}일은 ${used}일로 계산됩니다`);
  }
  return out;
}

/** 규칙형 조건 한 줄 — "추세 따라가기(5·20일) · 손절 7% · 트레일링 끔". 이동평균은 **엔진이 실제 쓰는 일수** */
export function ruleConditionLine(c: RuleConditions): string {
  const r = c.rule;
  const parts: string[] = [];
  const ma = r.useMaCross ? `${nearestEngineMa(r.maShort)}·${nearestEngineMa(r.maLong)}일` : '';
  const rsi = r.useRsi ? `RSI ${r.rsiBuyBelow}/${r.rsiSellAbove}` : '';
  parts.push(`${ruleMethodName(r)}(${[ma, rsi].filter(Boolean).join(' · ') || '조건 없음'})`);
  parts.push(`손절 ${c.hardStopLossPercent}%`);
  parts.push(c.trailingStopEnabled ? `트레일링 ${c.trailingStopPercent}%` : '트레일링 끔');
  parts.push(takeProfitText(c));
  return parts.join(' · ');
}

/** 계좌의 「지금 조건」 한 줄 — 규칙형이면 위 문장, AI형이면 매수 신호·신뢰도·손절 (지금 설정 값에서만) */
export function strategyConditionLine(s: AccountStrategy): string {
  if (s.mode === 'rule') return `규칙형 · ${ruleConditionLine(s)}`;
  const buy = s.buySignal === 'STRONG_BUY' ? 'STRONG_BUY' : 'BUY 이상';
  return `AI형 · 매수 ${buy} 신뢰도 ${Math.round(s.buyMinConfidence * 100)}% · 손절 ${s.hardStopLossPercent}% · ${
    s.trailingStopEnabled ? `트레일링 ${s.trailingStopPercent}%` : '트레일링 끔'
  } · ${takeProfitText(s)}`;
}

// ── 백테스트 「매도한 이유」 쉬운 말 (v2.40.0) — 비교 표·종목별 표·InfoTip 이 같은 문장을 쓴다 ──

export type ExitReason = 'signal' | 'stop' | 'take_profit' | 'trailing' | 'end';

/** 그 방법의 숫자로 만든 매도 이유 문장 — 예) "손절(매수가보다 7% 하락)" */
export function exitReasonText(kind: ExitReason, c: RuleConditions): string {
  const r = c.rule;
  switch (kind) {
    case 'signal':
      if (r.useMaCross && r.useRsi) return `매도 신호(평균선 교차 또는 RSI ${r.rsiSellAbove} 이상)`;
      if (r.useMaCross) return `매도 신호(${nearestEngineMa(r.maShort)}일 평균이 ${nearestEngineMa(r.maLong)}일 평균 아래로)`;
      return `매도 신호(RSI ${r.rsiSellAbove} 이상)`;
    case 'stop':
      return `손절(매수가보다 ${c.hardStopLossPercent}% 하락)`;
    case 'take_profit':
      return `익절(매수가보다 ${c.takeProfitPercent ?? '—'}% 상승)`;
    case 'trailing':
      return `트레일링(최고가보다 ${c.trailingStopPercent}% 하락)`;
    case 'end':
      return '시험 기간이 끝나 정리';
  }
}

// ── 계좌 「지금 조건」 카드 (v2.40.0) — 매수·매도 조건 문장. 숫자는 설정값에서만, 이동평균은 엔진이 실제 쓰는 일수 ──

/** 규칙형 매수 조건 — 예) "5일 평균이 20일 평균을 위로 넘을 때 또는 RSI 가 30 이하로 떨어졌다가 오를 때" */
export function ruleBuySentence(r: RuleConfig): string {
  const parts: string[] = [];
  if (r.useMaCross) parts.push(`${nearestEngineMa(r.maShort)}일 평균이 ${nearestEngineMa(r.maLong)}일 평균을 위로 넘을 때`);
  if (r.useRsi) parts.push(`RSI 가 ${r.rsiBuyBelow} 이하로 떨어졌다가 오를 때`);
  return parts.join(' 또는 ') || '매수 조건 없음(이동평균·RSI 모두 꺼짐)';
}

/** 규칙형 매도 조건 — 예) "5일 평균이 20일 평균 아래로 내려갈 때 또는 RSI 가 70 이상일 때" */
export function ruleSellSentence(r: RuleConfig): string {
  const parts: string[] = [];
  if (r.useMaCross) parts.push(`${nearestEngineMa(r.maShort)}일 평균이 ${nearestEngineMa(r.maLong)}일 평균 아래로 내려갈 때`);
  if (r.useRsi) parts.push(`RSI 가 ${r.rsiSellAbove} 이상일 때`);
  return parts.join(' 또는 ') || '매도 신호 없음(손절·익절·트레일링만)';
}

/** AI형 매수·매도 조건 — 신호·신뢰도 */
export function aiBuySentence(s: AccountStrategy): string {
  return `AI 신호 ${s.buySignal === 'STRONG_BUY' ? '강력 매수' : '매수 이상'} · 신뢰도 ${Math.round(s.buyMinConfidence * 100)}% 이상`;
}
export function aiSellSentence(s: AccountStrategy): string {
  return `AI 신호 ${s.sellSignal === 'STRONG_SELL' ? '강력 매도' : '매도 이상'} · 신뢰도 ${Math.round(s.sellMinConfidence * 100)}% 이상`;
}

/** 손절·익절 한 줄 — 계좌 모아보기 카드 */
export const safetyLine = (s: Pick<AccountStrategy, 'hardStopLossPercent' | 'takeProfitEnabled' | 'takeProfitPercent'>) =>
  `손절 −${s.hardStopLossPercent}% · ${s.takeProfitEnabled ? `익절 +${s.takeProfitPercent}%` : '익절 끔'}`;
