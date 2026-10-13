import type { RuleUsage } from '../../types/tradingRule';

/** 「적용된 곳」 한 줄 — 매수 판단 / 계좌 N개(이름) / 백테스트. 비어 있으면 「없음」 (목록·삭제·저장 확인 창이 같은 문장을 쓴다) */
export function usageText(u: RuleUsage, accountName: (id: number) => string): string {
  const parts: string[] = [];
  if (u.buyJudge) parts.push('매수 판단');
  if (u.accounts.length) parts.push(`계좌 ${u.accounts.length}개(${u.accounts.map(accountName).join(', ')})`);
  if (u.backtest) parts.push('백테스트');
  return parts.length ? parts.join(' · ') : '없음';
}
