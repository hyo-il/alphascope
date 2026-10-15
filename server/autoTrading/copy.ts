/**
 * 계좌 복사 (v2.46.0, A-8) — 같은 초기 자금 · 통화 · 수수료 · 슬리피지 + 같은 자동매매 설정(매매 규칙 · 대상 종목 · 계좌 운용 · 안전장치 · AI 검증)의 새 계좌.
 * 보유 종목·거래 기록은 복사하지 않고, **자동매매는 꺼진 채**로 만든다(사용자가 확인한 뒤 켠다).
 * AI 검증 켠 계좌와 끈 계좌를 같은 조건으로 비교하려고 만들었다.
 */
import { createAccount, getAccount, listAccounts, PaperTradingError } from '../paperTradingService';
import type { PaperAccount } from '../../src/types/paper';
import { getStrategy, saveStrategy } from './store';

/** 기본 새 이름 — 「<이름> 복사본」, 겹치면 「<이름> 복사본 2」 · 「복사본 3」 … */
export function copyName(name: string, taken: Set<string> = new Set(listAccounts().map((a) => a.name))): string {
  const base = `${name} 복사본`;
  if (!taken.has(base)) return base;
  for (let n = 2; ; n += 1) if (!taken.has(`${base} ${n}`)) return `${base} ${n}`;
}

export class CopyNameError extends PaperTradingError {}

export function copyAccount(sourceId: number, requestedName: string | null, ruleExists: (id: number) => boolean): PaperAccount {
  const source = getAccount(sourceId);
  const taken = new Set(listAccounts().map((a) => a.name));
  const name = requestedName?.trim() || copyName(source.name, taken);
  if (taken.has(name)) throw new CopyNameError(`같은 이름의 계좌가 있습니다: ${name}`);
  const account = createAccount({
    name,
    initialBalance: source.initialBalance,
    currency: source.currency,
    commissionRate: source.commissionRate,
    slippageRate: source.slippageRate,
  });
  const strategy = getStrategy(sourceId);
  // 자동매매는 꺼진 채 — 규칙이 지워졌으면 비운다(saveStrategy 가 확인)
  saveStrategy(account.id, { ...strategy, accountId: account.id, enabled: false }, ruleExists);
  return account;
}
