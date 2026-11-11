/**
 * 일별 자산 변화 점검(134차 · v2.70.0) — `npm run assetdaily:test` · ⚠️ `DB_PATH=<사본>` 으로만 돈다(맨 첫 import).
 *
 * 134차 지시서 「꼭 지킬 동작」 을 줄마다 확인한다(시험 이름 앞의 [134-n] 이 그 줄 번호 · 화면 5 는 `assetdailyui:test`).
 * - 1 기록 칸: 사본 DB 의 옛 `asset_daily` 줄이 그대로(값 · 개수) · 새 칸 NULL · 보관표도 같은 칸(새 기록의 종목별 합 = 총 자산은 `asset:test` [134-1]).
 * - 3 계산: `dailyChange.ts` 순수 함수 — 여러 경우 + 무작위 2,000번 「몫의 합 = 총 자산 변화(원 단위)」 · C-1 / C-2 · 비교 안 함.
 * - 4 메모: 이 프로세스 안 서버(로그인 문지기 + 자산 문지기 + 라우트) — 저장 · 고치기 · 빈 글 지움 · 40자 넘음 · 잠금 · 보관으로 옮김.
 * - 6 · 7 · 8: 소스 검사 · git · 바깥 호출 0(이 프로세스의 `fetch` 를 세어 127.0.0.1 밖은 0).
 * ⚠️ 출력에 가짜 금액도 찍지 않는다(통과 · 실패와 시험 이름만).
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import 'dotenv/config';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import type { AddressInfo } from 'node:net';
import { getDb } from '../server/db';
import { createSession } from '../server/auth';
import { authGuard } from '../server/authGuard';
import { lockSession, setAssetPassword, unlockSession } from '../server/asset/lock';
import { assetRouter } from '../server/asset/routes';
import { allRecords, archiveForSheetSwitch, clearArchivesForTest, clearNotesForTest, clearRecordsForTest, insertRecord, noteCountsForTest } from '../server/asset/store';
import { clearTradesForTest } from '../server/asset/trade';
import { dailyChangeOf, dailyChanges, type ChangeRecord, type ChangeTrade } from '../server/asset/dailyChange';
import { ASSET_GROUP_LABEL, type AssetDailyChange, type AssetDailyHolding, type AssetGroupKey, type AssetHistoryResponse, type AssetTotals } from '../src/types/asset';

const root = path.resolve(import.meta.dirname, '..');
let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok || !detail ? '' : ` — ${detail}`}`);
}

// ── 바깥 호출 세기(8) — 이 프로세스의 fetch 가 127.0.0.1 밖으로 나가면 센다(구글 · 토스) ──
let outside = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  if (!/^http:\/\/127\.0\.0\.1[:/]/.test(url)) outside++;
  return realFetch(input, init);
}) as typeof fetch;

// ───────────────────────── 가짜 기록 만들기 ─────────────────────────
const KEYS: AssetGroupKey[] = ['cash', 'bond', 'gold', 'stock', 'retirement', 'none'];
function totals(amounts: Partial<Record<AssetGroupKey, number>>, missing = 0, withRetirement = true): AssetTotals {
  const keys = withRetirement ? KEYS : KEYS.filter((k) => k !== 'retirement');
  const groups = keys.map((key) => ({ key, label: ASSET_GROUP_LABEL[key], amount: amounts[key] ?? 0, ratio: null }));
  return { total: groups.reduce((a, g) => a + g.amount, 0), groups, core: 0, satellite: 0, missing };
}
interface H { section: string; symbol: string | null; name?: string; market: 'US' | 'KR'; group?: AssetGroupKey; qty: number; price: number | null; pension?: boolean }
const holding = (h: H, fx: number | null): AssetDailyHolding => {
  const krw = h.price == null ? null : h.market === 'US' ? (fx == null ? null : h.qty * h.price * fx) : h.qty * h.price;
  return { section: h.section, pension: h.pension ?? false, symbol: h.symbol, name: h.name ?? h.symbol ?? '', market: h.market, group: h.group ?? 'stock', quantity: h.qty, price: krw == null ? null : h.price, currency: h.market === 'US' ? 'USD' : 'KRW', krw, missing: krw == null };
};
/** 기록 하나 — 보유 줄에서 묶음 금액을 계산한다(현금 · 퇴직 연금은 따로) · holdings=false 면 옛 기록(새 칸 없음) */
function rec(day: string, opts: { cash: number; retirement?: number; fx: number | null; hs: H[]; old?: boolean; recordedAt?: string }): ChangeRecord {
  const rows = opts.hs.map((h) => holding(h, opts.fx));
  const sum = (pension: boolean) => {
    const a: Partial<Record<AssetGroupKey, number>> = { cash: opts.cash, retirement: pension ? (opts.retirement ?? 0) : 0 };
    let missing = 0;
    for (const r of rows) {
      if (!pension && r.pension) continue;
      if (r.krw == null) missing++;
      else a[r.group] = (a[r.group] ?? 0) + r.krw;
    }
    return totals(a, missing, pension);
  };
  return { day, recordedAt: opts.recordedAt ?? `${day}T23:00:00.000Z`, plain: sum(false), pension: sum(true), fxUsdKrw: opts.old ? null : opts.fx, holdings: opts.old ? null : rows };
}
const OPT = { includePension: true, pensionSections: ['연금 저축 계좌'], sheetSwitchedAt: null, fallbackFx: null };
const sumOf = (c: AssetDailyChange) => c.shares.reduce((a, s) => a + s.amount, 0);
const share = (c: AssetDailyChange, key: string) => c.shares.find((s) => s.key === key)?.amount ?? 0;
const exact = (c: AssetDailyChange) => c.change != null && sumOf(c) === c.change;
const trade = (day: string, section: string, symbol: string, side: 'buy' | 'sell', qty: number, price: number, currency: 'KRW' | 'USD' = 'KRW'): ChangeTrade => ({ at: `${day}T05:00:00.000Z`, section, symbol, side, qty, price, currency });

// ───────────────────────── [134-3] 계산 ─────────────────────────
{
  // 매수만(C-1 · 옛 기록) — 현금 50만 → 국내 주식 10주 × 5만 · 주가 +10만
  const P = rec('2026-11-02', { cash: 1_000_000, fx: null, old: true, hs: [{ section: '개별 투자', symbol: '005930', market: 'KR', qty: 20, price: 100_000 }] });
  const D = rec('2026-11-03', { cash: 500_000, fx: null, old: true, hs: [{ section: '개별 투자', symbol: '005930', market: 'KR', qty: 30, price: 105_000 }] });
  const c = dailyChangeOf(P, D, [trade('2026-11-03', '개별 투자', '005930', 'buy', 10, 50_000)], OPT);
  // 변화 = (−500,000) + (3,150,000 − 2,000,000) = 650,000 · 순매수 500,000 → 주식 값 650,000 · 입금 · 출금 0
  check('[134-3] 매수만(C-1) — 주식 값 = 주식 변화 − 순매수 · 입금 · 출금 = 현금 변화 + 순매수 = 0 · 사고판 금액 = 순매수 · 몫의 합 = 변화', exact(c) && !c.split && share(c, 'stock') === 650_000 && share(c, 'flow') === 0 && c.traded === 500_000);
}
{
  // 매도만 — 5주 × 10만 팔아 현금 +50만 · 그 뒤 출금 20만
  const P = rec('2026-11-02', { cash: 0, fx: null, old: true, hs: [{ section: '개별 투자', symbol: '005930', market: 'KR', qty: 10, price: 100_000 }] });
  const D = rec('2026-11-03', { cash: 300_000, fx: null, old: true, hs: [{ section: '개별 투자', symbol: '005930', market: 'KR', qty: 5, price: 100_000 }] });
  const c = dailyChangeOf(P, D, [trade('2026-11-03', '개별 투자', '005930', 'sell', 5, 100_000)], OPT);
  check('[134-3] 매도만 — 순매수 −50만 · 주식 값 0 · 입금 · 출금 −20만 · 몫의 합 = 변화', exact(c) && share(c, 'stock') === 0 && share(c, 'flow') === -200_000 && c.traded === -500_000);
}
{
  // 현금만 바뀜(급여 입금)
  const hs: H[] = [{ section: '개별 투자', symbol: 'NVDA', market: 'US', qty: 3, price: 200 }];
  const c = dailyChangeOf(rec('2026-11-02', { cash: 100, fx: 1400, hs }), rec('2026-11-03', { cash: 3_000_100, fx: 1400, hs }), [], OPT);
  check('[134-3] 현금만 바뀜 — 입금 · 출금 = 현금 변화 · 주가 · 환율 0 · 매매 없음(traded null)', exact(c) && c.split && share(c, 'flow') === 3_000_000 && share(c, 'price') === 0 && share(c, 'fx') === 0 && c.traded === null && c.shares.length === 1);
}
{
  // 환율만 바뀜(C-2) — 10주 × $100 · 1,300 → 1,400 → 환율 +100,000
  const hs: H[] = [{ section: '개별 투자', symbol: 'NVDA', market: 'US', qty: 10, price: 100 }];
  const c = dailyChangeOf(rec('2026-11-02', { cash: 0, fx: 1300, hs }), rec('2026-11-03', { cash: 0, fx: 1400, hs }), [], OPT);
  check('[134-3] 환율만 바뀜(C-2) — 환율 = P 수량 × D 가격 × (D 환율 − P 환율) · 주가 0 · 기타 0', exact(c) && c.split && share(c, 'fx') === 100_000 && share(c, 'price') === 0 && share(c, 'other') === 0);
}
{
  // 미국 · 국내 섞임(C-2) — 주가 · 환율 정확히
  const P = rec('2026-11-02', { cash: 0, fx: 1300, hs: [{ section: '개별 투자', symbol: 'NVDA', market: 'US', qty: 10, price: 100 }, { section: '적립식', symbol: '005930', market: 'KR', qty: 7, price: 70_000 }] });
  const D = rec('2026-11-03', { cash: 0, fx: 1350, hs: [{ section: '개별 투자', symbol: 'NVDA', market: 'US', qty: 10, price: 110 }, { section: '적립식', symbol: '005930', market: 'KR', qty: 7, price: 69_000 }] });
  const c = dailyChangeOf(P, D, [], OPT);
  // 주가 = 10 × 10 × 1300 + 7 × (−1000) = 130,000 − 7,000 = 123,000 · 환율 = 10 × 110 × 50 = 55,000
  check('[134-3] 미국 · 국내 섞임(C-2) — 주가 = P 수량 × 가격 차 × P 환율(국내 1) · 환율 = 미국 줄만 · 기타 0', exact(c) && share(c, 'price') === 123_000 && share(c, 'fx') === 55_000 && share(c, 'other') === 0 && c.movers[0]?.symbol === 'NVDA' && c.movers[1]?.symbol === '005930');
}
{
  // 연금 포함 / 뺌 — 연금 계좌 종목 가격 변화 · 연금 계좌 매수
  const hs = (price: number, qty: number): H[] => [{ section: '연금 저축 계좌', symbol: '360750', market: 'KR', qty, price, pension: true }, { section: '개별 투자', symbol: '005930', market: 'KR', qty: 1, price: 70_000 }];
  const P = rec('2026-11-02', { cash: 1_000_000, retirement: 5_000_000, fx: null, hs: hs(10_000, 10) });
  const D = rec('2026-11-03', { cash: 900_000, retirement: 5_100_000, fx: null, hs: hs(11_000, 20) });
  const tr = [trade('2026-11-03', '연금 저축 계좌', '360750', 'buy', 10, 10_000)];
  const on = dailyChangeOf(P, D, tr, OPT);
  const off = dailyChangeOf(P, D, tr, { ...OPT, includePension: false });
  // 포함: 주가 = 10 × 1000 = 10,000 · 기타 = 수량 몫(10 × 11,000) − 순매수(100,000) = 10,000 · 입금 · 출금 = −100,000 + 100,000 = 0 · 퇴직 연금 +100,000
  // 뺌: 연금 계좌 매수는 빼고 셈 → 입금 · 출금 = −100,000 · 주가 0
  check('[134-3] 연금 포함 — 연금 계좌 주가 · 퇴직 연금 몫 · 연금 계좌 매수 순매수에 넣음', exact(on) && share(on, 'price') === 10_000 && share(on, 'retirement') === 100_000 && share(on, 'flow') === 0 && on.traded === 100_000 && share(on, 'other') === 10_000);
  check('[134-3] 연금 뺌 — 연금 계좌 줄 · 매수 · 퇴직 연금은 빼고 셈(몫의 합 = 연금 뺌 변화)', exact(off) && share(off, 'price') === 0 && share(off, 'retirement') === 0 && share(off, 'flow') === -100_000 && off.traded === null);
}
{
  // 가격 못 받은 줄 — 계산은 하되 missing 표시 · 몫의 합 그대로
  const P = rec('2026-11-02', { cash: 0, fx: 1400, hs: [{ section: '개별 투자', symbol: 'NVDA', market: 'US', qty: 10, price: 100 }, { section: '개별 투자', symbol: 'AAPL', market: 'US', qty: 5, price: 200 }] });
  const D = rec('2026-11-03', { cash: 0, fx: 1400, hs: [{ section: '개별 투자', symbol: 'NVDA', market: 'US', qty: 10, price: 101 }, { section: '개별 투자', symbol: 'AAPL', market: 'US', qty: 5, price: null }] });
  const c = dailyChangeOf(P, D, [], OPT);
  check('[134-3] 가격 못 받은 줄 — missing 1 · 그 줄은 기타(빠진 금액) · 주가는 받은 줄만 · 몫의 합 = 변화', exact(c) && c.missing === 1 && share(c, 'price') === 14_000 && share(c, 'other') === -1_400_000);
}
{
  // 새 종목 · 다 판 종목(C-2) — 수량 몫은 기타 · 순매수는 입금 · 출금 쪽에서 맞춤
  const P = rec('2026-11-02', { cash: 2_000_000, fx: 1400, hs: [{ section: '개별 투자', symbol: 'OLD', market: 'KR', qty: 10, price: 10_000 }] });
  const D = rec('2026-11-03', { cash: 2_000_000 + 100_000 - 150_000, fx: 1400, hs: [{ section: '개별 투자', symbol: 'NEW', market: 'KR', qty: 3, price: 52_000 }] });
  const tr = [trade('2026-11-03', '개별 투자', 'OLD', 'sell', 10, 10_000), trade('2026-11-03', '개별 투자', 'NEW', 'buy', 3, 50_000)];
  const c = dailyChangeOf(P, D, tr, OPT);
  // 순매수 = 150,000 − 100,000 = 50,000 · 입금 · 출금 = −50,000 + 50,000 = 0 · 주식 변화 = 156,000 − 100,000 = 56,000 → 기타 = 56,000 − 50,000 = 6,000
  check('[134-3] 새 종목 · 다 판 종목(C-2) — 수량 몫은 기타 · 입금 · 출금 0 · 사고판 금액 = 순매수', exact(c) && share(c, 'flow') === 0 && share(c, 'other') === 6_000 && c.traded === 50_000 && share(c, 'price') === 0);
}
{
  // 지난 날짜(새 칸 없음)는 C-1 · 둘 다 있으면 C-2 · 한쪽만 있으면 C-1
  const hs: H[] = [{ section: '개별 투자', symbol: 'NVDA', market: 'US', qty: 10, price: 100 }];
  const oldP = rec('2026-11-02', { cash: 0, fx: 1300, hs, old: true });
  const newP = rec('2026-11-02', { cash: 0, fx: 1300, hs });
  const D = rec('2026-11-03', { cash: 0, fx: 1400, hs });
  const c1 = dailyChangeOf(oldP, D, [], OPT);
  const c2 = dailyChangeOf(newP, D, [], OPT);
  check('[134-3] 지난 날짜(한쪽이라도 새 칸 없음)는 C-1 「주식 값」 · 둘 다 있으면 C-2 「주가 · 환율」', exact(c1) && !c1.split && share(c1, 'stock') === 100_000 && c1.movers.length === 0 && exact(c2) && c2.split && share(c2, 'fx') === 100_000 && !c2.shares.some((s) => s.key === 'stock'));
}
{
  // 첫 줄 · 시트를 바꾼 날은 비교 안 함
  const hs: H[] = [{ section: '개별 투자', symbol: '005930', market: 'KR', qty: 1, price: 1 }];
  const recs = [rec('2026-11-02', { cash: 0, fx: null, hs }), rec('2026-11-03', { cash: 5, fx: null, hs }), rec('2026-11-04', { cash: 9, fx: null, hs })];
  const rows = dailyChanges(recs, [], { includePension: true, pensionSections: [], sheetSwitchedAt: null });
  const switched = dailyChanges(recs, [], { includePension: true, pensionSections: [], sheetSwitchedAt: '2026-11-03T12:00:00.000Z' });
  check('[134-3] 첫 줄은 비교 안 함(first · 변화 null · 몫 없음) · 다음 줄부터 비교', rows[0].skip === 'first' && rows[0].change === null && rows[0].shares.length === 0 && rows[1].skip === null && rows[1].change === 5 && rows[2].prevDay === '2026-11-03');
  check('[134-3] 시트를 바꾼 날(앞 기록 < 바꾼 시각 ≤ 그날 기록)은 비교 안 함(sheet-switched) · 그 뒤는 비교', switched[1].skip === 'sheet-switched' && switched[1].change === null && switched[2].skip === null && switched[2].change === 4 && switched[0].skip === 'sheet-switched');
}
{
  // 미국 매매 환율 — D → P → 가까운 기록(대략) → 없으면 빼고 대략
  const hs: H[] = [{ section: '개별 투자', symbol: 'NVDA', market: 'US', qty: 1, price: 100 }];
  const t = [trade('2026-11-03', '개별 투자', 'NVDA', 'buy', 1, 100, 'USD')];
  const withD = dailyChangeOf(rec('2026-11-02', { cash: 0, fx: 1300, hs, old: true }), rec('2026-11-03', { cash: 0, fx: 1400, hs }), t, OPT);
  const fallback = dailyChangeOf(rec('2026-11-02', { cash: 0, fx: 1300, hs, old: true }), rec('2026-11-03', { cash: 0, fx: 1300, hs, old: true }), t, { ...OPT, fallbackFx: 1350 });
  const none = dailyChangeOf(rec('2026-11-02', { cash: 0, fx: 1300, hs, old: true }), rec('2026-11-03', { cash: 0, fx: 1300, hs, old: true }), t, OPT);
  check('[134-3] 미국 매매 — D 환율(대략 아님) · 둘 다 없으면 가까운 기록 환율(대략) · 그것도 없으면 그 매매를 빼고 대략 · 몫의 합 그대로',
    withD.traded === 140_000 && !withD.approx && fallback.traded === 135_000 && fallback.approx && none.traded === null && none.approx && exact(withD) && exact(fallback) && exact(none));
}
{
  // 많이 바뀐 종목 — 같은 코드는 계좌를 합치고 절댓값 큰 순 3개
  const hs = (k: number): H[] => [
    { section: '개별 투자', symbol: 'A', market: 'KR', qty: 1, price: 1000 + k * 10 },
    { section: '적립식', symbol: 'A', market: 'KR', qty: 1, price: 1000 + k * 10 },
    { section: '개별 투자', symbol: 'B', market: 'KR', qty: 1, price: 1000 - k * 15 },
    { section: '개별 투자', symbol: 'C', market: 'KR', qty: 1, price: 1000 + k * 5 },
    { section: '개별 투자', symbol: 'D', market: 'KR', qty: 1, price: 1000 + k * 1 },
  ];
  const c = dailyChangeOf(rec('2026-11-02', { cash: 0, fx: null, hs: hs(0) }), rec('2026-11-03', { cash: 0, fx: null, hs: hs(1) }), [], OPT);
  check('[134-3] 많이 바뀐 종목 — 같은 코드는 계좌를 합침(A +20) · 절댓값 큰 순(A · B · C) · 3개만', JSON.stringify(c.movers.map((m) => [m.symbol, m.amount])) === JSON.stringify([['A', 20], ['B', -15], ['C', 5]]));
}
{
  // 무작위 2,000번 — 몫의 합 = 변화(원 단위) · 소수 가격 · 소수 수량 · 가격 못 받음 · 새 종목 · 다 판 종목 · 연금 · 미국 · 국내
  let seed = 134;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
  const SYMS = ['NVDA', 'AAPL', '005930', '360750', 'GLD', 'TLT'];
  const SECTIONS = ['개별 투자', '적립식', '연금 저축 계좌'];
  const make = (day: string, old: boolean): ChangeRecord => {
    const hs: H[] = [];
    for (const section of SECTIONS) for (const symbol of SYMS) if (rnd() < 0.5) {
      const us = !/^\d/.test(symbol);
      hs.push({ section, symbol, market: us ? 'US' : 'KR', group: pick<AssetGroupKey>(['stock', 'stock', 'bond', 'gold', 'none']), qty: Math.round(rnd() * 10000) / 100, price: rnd() < 0.05 ? null : us ? Math.round(rnd() * 50000) / 100 : Math.round(rnd() * 200000), pension: section === '연금 저축 계좌' });
    }
    return rec(day, { cash: Math.round(rnd() * 1e9) / 7, retirement: Math.round(rnd() * 1e8) / 3, fx: rnd() < 0.1 ? null : 1300 + rnd() * 200, hs, old });
  };
  let bad = 0;
  let splitSeen = 0;
  for (let i = 0; i < 2000; i++) {
    const P = make('2026-11-02', rnd() < 0.3);
    const D = make('2026-11-03', rnd() < 0.3);
    const tr: ChangeTrade[] = Array.from({ length: Math.floor(rnd() * 4) }, () => { const s = pick(SYMS); const us = !/^\d/.test(s); return trade('2026-11-03', pick(SECTIONS), s, rnd() < 0.5 ? 'buy' : 'sell', Math.round(rnd() * 1000) / 100, us ? Math.round(rnd() * 50000) / 100 : Math.round(rnd() * 200000), us ? 'USD' : 'KRW'); });
    for (const includePension of [true, false]) {
      const c = dailyChangeOf(P, D, tr, { ...OPT, includePension, fallbackFx: rnd() < 0.5 ? 1390 : null });
      if (c.split) splitSeen++;
      const want = Math.round((includePension ? D.pension : D.plain).total) - Math.round((includePension ? P.pension : P.plain).total);
      if (!exact(c) || c.change !== want || c.shares.some((s) => !Number.isInteger(s.amount)) || c.movers.length > 3) bad++;
    }
  }
  check('[134-3] 무작위 2,000번(연금 포함 · 뺌) — 몫의 합 = 총 자산 변화(원 단위 정수) · 몫은 모두 정수 · 많이 바뀐 종목 ≤ 3 · C-1 · C-2 둘 다 나옴', bad === 0 && splitSeen > 100 && splitSeen < 3800, `틀림 ${bad} · 나눔 ${splitSeen}`);
}

// ───────────────────────── [134-1] 기록 칸 — 옛 줄 그대로 · 새 칸 NULL ─────────────────────────
const db = getDb();
{
  const hasTable = (t: string) => db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(t) !== undefined;
  const cols = (t: string) => (db.prepare(`PRAGMA table_info(${t})`).all() as { name: string }[]).map((c) => c.name);
  // 사본 DB 에 표가 없거나(맥) 새 칸이 아직 없으면 옛 모양으로 두 줄을 넣어 둔다(새 칸을 더하기 전 상태)
  if (!hasTable('asset_daily')) db.exec(`CREATE TABLE asset_daily (day TEXT PRIMARY KEY, total REAL NOT NULL, total_pension REAL NOT NULL, totals_json TEXT NOT NULL, missing INTEGER NOT NULL, recorded_at TEXT NOT NULL)`);
  const before0 = cols('asset_daily');
  if (!before0.includes('fx_usdkrw')) {
    const t = JSON.stringify({ plain: totals({ cash: 1 }), pension: totals({ cash: 2 }) });
    db.prepare(`INSERT OR IGNORE INTO asset_daily (day, total, total_pension, totals_json, missing, recorded_at) VALUES ('2001-01-02', 1, 2, ?, 0, '2001-01-02T23:00:00.000Z'), ('2001-01-03', 1, 2, ?, 0, '2001-01-03T23:00:00.000Z')`).run(t, t);
  }
  const OLD = `SELECT day, total, total_pension, totals_json, missing, recorded_at FROM asset_daily ORDER BY day`;
  const before = before0.includes('fx_usdkrw') ? null : JSON.stringify(db.prepare(OLD).all());
  const records = allRecords(); // 여기서 새 칸을 더한다
  const after = JSON.stringify(db.prepare(OLD).all());
  const nulls = (db.prepare(`SELECT COUNT(*) AS n FROM asset_daily WHERE fx_usdkrw IS NOT NULL OR holdings_json IS NOT NULL`).get() as { n: number }).n;
  check('[134-1] 사본 DB 의 옛 asset_daily 줄이 그대로(값 · 개수) · 새 칸 fx_usdkrw · holdings_json 은 NULL · 읽기는 옛 줄을 holdings null 로',
    before != null && before === after && cols('asset_daily').includes('fx_usdkrw') && cols('asset_daily').includes('holdings_json') && nulls === 0 && records.length >= 2 && records.every((r) => r.holdings === null && r.fxUsdKrw === null),
    `before ${before == null ? 'null' : 'ok'} · same ${before === after} · nulls ${nulls} · n ${records.length}`);
  // 두 번 불러도(서버 재시작) 칸을 다시 더하지 않음 — ALTER 실패 없이 같은 칸
  noteCountsForTest(); // 보관표는 처음 쓸 때 만든다(줄 수 함수가 연다)
  check('[134-1] 보관표 asset_daily_archive 도 같은 새 칸(옛 칸 + fx_usdkrw · holdings_json)', ['fx_usdkrw', 'holdings_json'].every((c) => cols('asset_daily_archive').includes(c)));
}

// ───────────────────────── [134-4] 메모 · history API(이 프로세스 안 서버) ─────────────────────────
async function main() {
  clearRecordsForTest();
  clearNotesForTest();
  clearArchivesForTest();
  clearTradesForTest();
  // 기록 셋 — 11-03 은 옛 모양(새 칸 없음) · 11-04 · 11-05 는 새 칸
  const hs: H[] = [{ section: '개별 투자', symbol: 'NVDA', market: 'US', qty: 10, price: 100 }, { section: '연금 저축 계좌', symbol: '360750', market: 'KR', qty: 2, price: 10_000, pension: true }];
  const r3 = rec('2025-11-03', { cash: 1000, retirement: 50, fx: 1300, hs, old: true });
  const r4 = rec('2025-11-04', { cash: 1000, retirement: 50, fx: 1300, hs });
  const r5 = rec('2025-11-05', { cash: 3000, retirement: 50, fx: 1400, hs: hs.map((h) => (h.symbol === 'NVDA' ? { ...h, price: 110 } : h)) });
  for (const r of [r3, r4, r5]) insertRecord(r.day, r.plain, r.pension, r.recordedAt, r.holdings ? { fxUsdKrw: r.fxUsdKrw, holdings: r.holdings } : null);

  await setAssetPassword('selftest-daily-lock-0001');
  const app = express();
  app.use(express.json());
  app.use(authGuard);
  app.use(assetRouter);
  const srv = app.listen(0, '127.0.0.1');
  await new Promise((ok) => srv.once('listening', ok));
  const base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`;
  const token = createSession('selftest-daily');
  const ck = { cookie: `as_session=${encodeURIComponent(token)}` };
  const put = (body: unknown) => fetch(`${base}/api/asset/daily-note`, { method: 'PUT', headers: { ...ck, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const history = async (q: string) => (await (await fetch(`${base}/api/asset/history?${q}`, { headers: ck })).json()) as AssetHistoryResponse;
  try {
    // 잠금 — 풀기 전 PUT 403 · 저장 0
    const locked = await put({ day: '2025-11-04', note: '급여' });
    check('[134-4] 잠겨 있으면 메모 저장 거절(403 asset-locked) · 저장 0', locked.status === 403 && ((await locked.json()) as { code?: string }).code === 'asset-locked' && noteCountsForTest().notes === 0);
    unlockSession(token);

    const s1 = await put({ day: '2025-11-04', note: '  급여  ' });
    const s2 = await put({ day: '2025-11-04', note: '급여 · 보너스' });
    const h1 = await history('range=all&pension=1');
    check('[134-4] 메모 저장(앞뒤 빈칸 지움) · 고치기(같은 날 하나) · history 줄에 실림', s1.status === 200 && ((await s1.json()) as { note: string }).note === '급여' && s2.status === 200 && noteCountsForTest().notes === 1 && h1.rows.find((r) => r.day === '2025-11-04')?.note === '급여 · 보너스');
    const long = await put({ day: '2025-11-04', note: '가'.repeat(41) });
    const max = await put({ day: '2025-11-05', note: '가'.repeat(40) });
    const noDay = await put({ day: '2025-12-25', note: '없는 날' });
    const badDay = await put({ day: '11/04', note: 'x' });
    check('[134-4] 40자까지 저장 · 41자 거절(400) · 기록 없는 날 · 틀린 날짜 거절(400)', long.status === 400 && max.status === 200 && noDay.status === 400 && badDay.status === 400 && noteCountsForTest().notes === 2);
    const del = await put({ day: '2025-11-05', note: '   ' });
    const h2 = await history('range=all&pension=1');
    check('[134-4] 빈 글이면 지움(200 · note null) · history 줄 메모 null', del.status === 200 && ((await del.json()) as { note: unknown }).note === null && noteCountsForTest().notes === 1 && h2.rows.find((r) => r.day === '2025-11-05')?.note === null);

    // history — 표 줄 = 그래프 점(같은 날짜 · 같은 순서) · 첫 줄 비교 안 함 · 옛 → 새 는 C-1 · 새 → 새 는 C-2 · 연금 갈래
    const on = h2;
    const off = await history('range=all&pension=0');
    const day = (h: AssetHistoryResponse, d: string) => h.rows.find((r) => r.day === d);
    check('[134-3] history 응답 — 표 줄 날짜 = 그래프 점 날짜(같은 순서) · 총 자산 = 점 값(원 정수) · 첫 줄 first',
      JSON.stringify(on.rows.map((r) => r.day)) === JSON.stringify(on.points.map((p) => p.day)) && on.rows.every((r, i) => r.total === Math.round(on.points[i].total)) && on.rows[0].skip === 'first');
    check('[134-3] history 응답 — 옛 기록 → 새 기록은 C-1(주식 값) · 새 → 새 는 C-2(주가 · 환율 · 많이 바뀐 종목) · 몫의 합 = 변화 · 연금 뺌 갈래는 연금 줄 뺌',
      day(on, '2025-11-04')?.split === false && day(on, '2025-11-05')?.split === true && share(day(on, '2025-11-05')!, 'fx') === 110 * 10 * 100 && share(day(on, '2025-11-05')!, 'price') === 10 * 10 * 1300 &&
      day(on, '2025-11-05')?.movers[0]?.symbol === 'NVDA' && on.rows.slice(1).every(exact) && off.rows.slice(1).every(exact) && day(off, '2025-11-05')!.total === Math.round(r5.plain.total));
    // 기간 — 기간 안 첫 줄도 기간 밖 앞 기록과 견줌(가짜 시계 대신 오늘 날짜에 가까운 기록을 하나 더)
    const today = new Date().toISOString().slice(0, 10);
    const r6 = rec(today, { cash: 3500, retirement: 50, fx: 1400, hs: hs.map((h) => (h.symbol === 'NVDA' ? { ...h, price: 110 } : h)), recordedAt: new Date().toISOString() });
    insertRecord(r6.day, r6.plain, r6.pension, r6.recordedAt, { fxUsdKrw: r6.fxUsdKrw, holdings: r6.holdings! });
    const m1 = await history('range=1m&pension=1');
    check('[134-3] 기간(1m) — 표 줄도 그래프 점과 같은 날짜만 · 기간 첫 줄은 기간 밖 앞 기록과 견줌(first 아님)', m1.points.length === 1 && m1.rows.length === 1 && m1.rows[0].day === today && m1.rows[0].prevDay === '2025-11-05' && m1.rows[0].change === 500 && m1.rows[0].skip === null);

    // 보관으로 옮길 때 메모도 함께(같은 방법 · 한 트랜잭션 · 지운 줄 0)
    const notesBefore = JSON.stringify(db.prepare(`SELECT day, note, updated_at FROM asset_daily_note ORDER BY day`).all());
    const dailyBefore = JSON.stringify(db.prepare(`SELECT day, total, total_pension, totals_json, missing, recorded_at, fx_usdkrw, holdings_json FROM asset_daily ORDER BY day`).all());
    db.transaction(() => archiveForSheetSwitch('selftestkey1', 'self', '2026-11-11T00:00:00.000Z'))();
    const notesArchived = JSON.stringify(db.prepare(`SELECT day, note, updated_at FROM asset_daily_note_archive WHERE sheet_key = 'selftestkey1' ORDER BY day`).all());
    const dailyArchived = JSON.stringify(db.prepare(`SELECT day, total, total_pension, totals_json, missing, recorded_at, fx_usdkrw, holdings_json FROM asset_daily_archive WHERE sheet_key = 'selftestkey1' ORDER BY day`).all());
    check('[134-4] 시트를 바꿔 보관으로 옮길 때 메모도 함께(값 그대로 · 원래 표 비움) · 하루 기록 새 칸도 그대로 옮김', notesBefore !== '[]' && notesBefore === notesArchived && noteCountsForTest().notes === 0 && dailyBefore === dailyArchived);

    // 화면에서도 잠금이면 칸 꺼짐 — 잠근 뒤 history 도 403(화면은 잠금 화면으로)
    lockSession(token);
    check('[134-4] 다시 잠그면 메모 저장 거절(403)', (await put({ day: '2025-11-04', note: 'x' })).status === 403);
  } finally {
    srv.close();
  }
}

await main();

// ───────────────────────── [134-4] 시트 쓰기 0 · [134-6] 로그 · [134-7] 바뀐 파일 · [134-8] 바깥 호출 ─────────────────────────
{
  const read = (f: string) => fs.readFileSync(path.join(root, f), 'utf8');
  const noteCode = read('server/asset/store.ts').split('// ── 날짜별 메모')[1] ?? '';
  const routeNote = read('server/asset/routes.ts').split("assetRouter.put('/api/asset/daily-note'")[1]?.split('\n});')[0] ?? '';
  check('[134-4] 메모 저장 코드는 시트를 쓰지 않음(valuesWrite · structureWrite · google · sheet 부름 0)', noteCode.length > 100 && routeNote.length > 50 && !/valuesWrite|structureWrite|google|readAssetSheet|write[A-Z]\w*\(/.test(noteCode + routeNote));
  // 6: 이번 작업이 더한 로그 줄(server/asset · 자산 화면)에 금액 · 수량이 없다 — 더한 줄 중 console 줄이 0 이거나 숫자 변수를 싣지 않음
  const diff = spawnSync('git', ['diff', '-U0', 'f64668b', '--', 'server/asset', 'src/components/asset', 'src/utils/assetFormat.ts'], { cwd: root, encoding: 'utf8' });
  const logLines = diff.stdout.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++') && /console\.(log|warn|error|info)/.test(l));
  check('[134-6] 새 코드의 로그 줄에 금액 · 수량 0(f64668b 와 지금 — 더한 console 줄이 값 변수를 싣지 않음)', diff.status === 0 && logLines.every((l) => !/\$\{[^}]*(total|amount|krw|qty|quantity|price|fx|note|change)/i.test(l)), logLines.join(' | '));
  // 7: 매매 · 주문 · 로그인 · 시세 · 시황 코드 바뀐 파일 0
  const trading = spawnSync('git', ['diff', '--name-only', 'f64668b', '--', 'server/autoTrading', 'server/buyJudge', 'server/rules', 'server/paperTradingService.ts', 'server/paperPerformanceService.ts', 'server/paperSnapshotScheduler.ts', 'server/aiCheck', 'server/marketBrief', 'server/usHalts', 'server/quoteService.ts', 'server/heatmapSession.ts', 'server/marketCalendar.ts', 'server/auth.ts', 'server/authGuard.ts', 'src/services', 'python'], { cwd: root, encoding: 'utf8' });
  check('[134-7] 매매 · 주문 · 자동매매 · AI 검증 · 시세 · 시황 · 로그인 · src/services · python 바뀐 파일 0(f64668b 와 지금 작업 트리)', trading.status === 0 && trading.stdout.trim() === '', trading.stdout.trim() || trading.stderr.trim());
  // 7: 서버가 함께 쓰는 src/ 파일 가운데 바뀐 것은 types/asset.ts 더하기만(지운 줄 0)
  const list = spawnSync('npx', ['tsc', '-p', 'tsconfig.node.json', '--listFilesOnly'], { cwd: root, encoding: 'utf8' });
  const shared = list.stdout.split('\n').map((l) => path.relative(root, l.trim())).filter((f) => f.startsWith('src/'));
  const changedShared = spawnSync('git', ['diff', '--name-only', 'f64668b', '--', ...shared], { cwd: root, encoding: 'utf8' }).stdout.trim().split('\n').filter(Boolean);
  const typesDel = spawnSync('git', ['diff', '-U0', 'f64668b', '--', 'src/types/asset.ts'], { cwd: root, encoding: 'utf8' }).stdout.split('\n').filter((l) => l.startsWith('-') && !l.startsWith('---'));
  check(`[134-7] 서버가 함께 쓰는 src/ ${shared.length}개 가운데 바뀐 것은 types/asset.ts 하나 · 지운 줄 0`, shared.length > 30 && JSON.stringify(changedShared) === JSON.stringify(['src/types/asset.ts']) && typesDel.length === 0, `${changedShared.join(',')} · 지운 줄 ${typesDel.length}`);
  check('[134-8] 이 시험 동안 127.0.0.1 밖 호출 0(구글 · 토스 · 주문 없음)', outside === 0, String(outside));
}

console.log(`\n결과: ${pass}개 통과 / ${fail}개 실패`);
process.exit(fail === 0 ? 0 : 1);
