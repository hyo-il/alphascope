import type { TradeSignal } from '../../types/gemini';

/** 신호 표기는 여러 화면에서 쓰므로 한 곳에 둔다 */
export const SIGNAL_LABEL: Record<TradeSignal, string> = {
  STRONG_BUY: '강력 매수',
  BUY: '매수',
  HOLD: '중립',
  SELL: '매도',
  STRONG_SELL: '강력 매도',
};

export const SIGNAL_CLASS: Record<TradeSignal, string> = {
  STRONG_BUY: 'text-bullish font-semibold',
  BUY: 'text-bullish',
  HOLD: 'text-text-secondary',
  SELL: 'text-bearish',
  STRONG_SELL: 'text-bearish font-semibold',
};

export const VOTE_CLASS: Record<string, string> = {
  BUY: 'text-bullish',
  HOLD: 'text-text-secondary',
  SELL: 'text-bearish',
};

export function confidencePercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return `${Math.round(value * 100)}%`;
}
