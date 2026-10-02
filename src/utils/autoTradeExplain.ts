import type { AccountStrategy, AccountStrategyStatus, DecisionNote } from '../types/autoTrading';
import type { AutoTradeView } from './autoTradeStatus';

/**
 * 자동매매를 **쉬운 말로** 설명하는 곳 — 한 곳이다 (v2.32.0).
 *
 * ⚠️ 분기는 사유 문장이 아니라 **`code`**(엔진이 판단할 때 붙인 종류)와 `blockedKind` 로 한다.
 * 문장을 읽어 분기하면 엔진 문구를 다듬을 때마다 조용히 깨진다.
 * ⚠️ 숫자는 설정값에서만 넣는다 — 여기서 새로 지어내지 않는다.
 * 코드가 없는 옛 기록·`other` 는 `null` 을 돌려준다(화면은 원래 문장만 보인다).
 */

type Settings = Pick<AccountStrategy, 'hardStopLossPercent' | 'maxPositions' | 'dailyLossLimitPercent'>;

export function explainNote(note: DecisionNote, name: string, s: Settings): string | null {
  switch (note.code) {
    case 'no_signal_buy':
      return `${name}: 살 조건이 아직 아니라 기다리는 중입니다.`;
    case 'no_signal_hold':
      return `${name}: 들고 있습니다. 팔 조건이 아직 아닙니다.`;
    case 'golden':
      return `${name}: 최근 평균값이 위로 올라서서(오르는 흐름 시작) 샀습니다.`;
    case 'rsi_rebound':
      return `${name}: 많이 떨어졌다가 다시 오르기 시작해 샀습니다.`;
    case 'dead':
      return `${name}: 오르는 흐름이 꺾여 팔았습니다.`;
    case 'rsi_hot':
      return `${name}: 많이 올라 팔았습니다.`;
    case 'hard_stop':
      return `${name}: 산 값보다 ${s.hardStopLossPercent}% 넘게 떨어져 더 잃지 않으려고 팔았습니다.`;
    case 'trailing':
      return `${name}: 가장 높았던 값보다 많이 내려와 팔았습니다.`;
    case 'earnings_blackout':
      return `${name}: 곧 실적 발표가 있어 새로 사지 않았습니다(발표 때 크게 움직일 수 있어서).`;
    case 'max_positions':
      return `${name}: 살 조건이었지만 이미 ${s.maxPositions}종목을 들고 있어 사지 않았습니다.`;
    case 'daily_loss':
      return '오늘 계좌가 많이 줄어 새로 사지 않습니다(하루 손실 한도).';
    case 'not_enough_candles':
      return `${name}: 가격 기록이 아직 부족해 판단하지 않았습니다.`;
    case 'error':
      return `${name}: 주문하지 못했습니다(아래 자세한 이유).`;
    case 'ai_buy':
      return `${name}: AI 가 사자고 판단해 샀습니다.`;
    case 'ai_sell':
      return `${name}: AI 가 팔자고 판단해 팔았습니다.`;
    case 'ai_hold':
      return `${name}: AI 판단이 사거나 팔 때가 아니라서 그대로 둡니다.`;
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
        text: `오늘 계좌가 ${strategy.dailyLossLimitPercent}% 넘게 줄어 새로 사지 않습니다(하루 손실 한도). 이미 산 종목의 손절·청산은 계속하고, 다음 거래일에 저절로 풀립니다.`,
        extra,
        fix: true,
      };
    }
    if (status?.blockedKind === 'server_off') {
      return { text: '이 서버에서는 자동매매가 꺼져 있어 돌지 않습니다(서버 설정).', extra: null, fix: false };
    }
    // config — 무엇이 문제인지는 설정 값으로 가른다(문구로 가르지 않는다)
    if (n === 0) {
      return { text: '대상 종목이 없어 멈춰 있습니다. [설정 열기]에서 종목을 담아 주세요.', extra: null, fix: true };
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
