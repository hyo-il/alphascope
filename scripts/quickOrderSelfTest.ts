/**
 * 차트 빠른주문 수량 점검 — `npm run quickorder:test` · ⚠️ `DB_PATH=<사본>` 으로만 돈다(맨 첫 import · DB 는 쓰지 않는다).
 *
 * - 순수 함수 `src/utils/quickOrderQuantity.ts` 만 본다(서버 없이).
 * - 1 보유 3주 · 「최대」 → 시장가 · 지정가 매도 모두 3주(매수 최대 수량 아님)
 * - 2 보유 3주 · 10 → 매도 3주 · 매수 10주 / 3 보유 3주 · 2 → 매도 2주(「보유 전부」 없음)
 * - 4 「최대」 매수 = 「매수 가능」(그 가격 기준 최대) / 5 「%」 는 옛 식(14b0693 패널 `quantityFor`)과 같다(여러 조합)
 * - 6 보유 0주 → 매도 0주(매도 버튼 꺼짐) / 8 서버 보유 수량 검사 · 패널의 주문 요청 칸이 그대로인지
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  maxBuyableAt,
  quickOrderHint,
  quickOrderQuantity,
  type QuickOrderQuantityInput,
} from '../src/utils/quickOrderQuantity';

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

const FACTOR = (1 + 0.0005) * (1 + 0.001);
const base: QuickOrderQuantityInput = {
  unit: 'shares',
  quantity: 10,
  percent: 30,
  max: false,
  side: 'BUY',
  price: 100,
  cash: 7_200,
  buyCostFactor: FACTOR,
  held: 3,
};
const q = (o: Partial<QuickOrderQuantityInput>) => quickOrderQuantity({ ...base, ...o });

// ── 1 보유 3주 · 「최대」 → 매도 3주 ───────────────────────────
const current = 101.5; // 시장가 = 현재가
const limit = 100; // 지정가 = 가격 칸
const maxBuy = maxBuyableAt(base.cash, limit, FACTOR);
check('1 「최대」 매수 최대는 보유보다 크다(사용자 사례 — 71주 같은 값)', maxBuy > 3, `${maxBuy}주`);
for (const [label, price] of [['시장가', current], ['지정가', limit]] as const) {
  const s = q({ max: true, side: 'SELL', price });
  check(`1 보유 3주 · 「최대」 · ${label} 매도 = 3주 · 보유 전부`, s.quantity === 3 && s.allHeld, JSON.stringify(s));
}

// ── 2 · 3 숫자 입력 ─────────────────────────────────────────
{
  const s = q({ quantity: 10, side: 'SELL' });
  const b = q({ quantity: 10, side: 'BUY' });
  check('2 보유 3주 · 10 → 매도 3주(보유 전부)', s.quantity === 3 && s.allHeld, JSON.stringify(s));
  check('2 보유 3주 · 10 → 매수 10주', b.quantity === 10 && !b.allHeld, JSON.stringify(b));
  check('2 안내 줄 「매수 10주 · 매도 3주 (보유 전부)」', quickOrderHint('shares', 30, 3, b, s) === '매수 10주 · 매도 3주 (보유 전부)', String(quickOrderHint('shares', 30, 3, b, s)));
}
{
  const s = q({ quantity: 2, side: 'SELL' });
  const b = q({ quantity: 2, side: 'BUY' });
  check('3 보유 3주 · 2 → 매도 2주 · 「보유 전부」 없음', s.quantity === 2 && !s.allHeld, JSON.stringify(s));
  check('3 매수 · 매도가 같으면 안내 줄 없음', quickOrderHint('shares', 30, 3, b, s) === null);
  const s3 = q({ quantity: 3, side: 'SELL' });
  check('3 보유 3주 · 3 → 매도 3주(줄지 않음 · 「보유 전부」 없음)', s3.quantity === 3 && !s3.allHeld, JSON.stringify(s3));
}

// ── 4 「최대」 매수 = 「매수 가능」 ───────────────────────────
for (const [cash, price] of [[7_200, 100], [1_000_000, 263_500], [123_456.78, 17.31], [50, 100], [0, 10], [500, null]] as const) {
  const want = maxBuyableAt(cash, price, FACTOR);
  const old = price && price > 0 ? Math.floor(cash / (price * FACTOR)) : 0; // 14b0693 패널 maxBuyableAt 식
  const got = q({ max: true, side: 'BUY', cash, price }).quantity;
  check(`4 「최대」 매수 = 매수 가능 (현금 ${cash} · 가격 ${price})`, got === want && want === old, `${got} / ${want} / ${old}`);
}
{
  const b = q({ max: true, side: 'BUY', price: limit });
  const s = q({ max: true, side: 'SELL', price: limit });
  check('4 안내 줄 「매수 N주 · 매도 3주 (보유 전부)」', quickOrderHint('shares', 30, 3, b, s) === `매수 ${maxBuy}주 · 매도 3주 (보유 전부)`, String(quickOrderHint('shares', 30, 3, b, s)));
}

// ── 5 「%」 는 지금과 같다 ──────────────────────────────────
/** 14b0693 `QuickOrderPanel.quantityFor` 의 % 쪽 그대로(옛 식 — 비교용) */
function oldPercent(side: 'BUY' | 'SELL', at: number | null, cash: number, percent: number, held: number, factor: number): number {
  if (side === 'BUY') {
    if (!at || at <= 0) return 0;
    const budget = (cash * percent) / 100;
    return Math.max(0, Math.floor(budget / (at * factor)));
  }
  return Math.max(0, Math.floor((held * percent) / 100));
}
function oldPercentHint(percent: number, held: number, b: number, s: number): string {
  if (percent >= 100 && held > 0) return `매수 ${b}주 · 매도 전량 (${held}주)`;
  if (b === s) return `= 약 ${b}주`;
  return `매수 약 ${b}주 · 매도 약 ${s}주`;
}
{
  let n = 0;
  let bad = 0;
  let firstBad = '';
  for (const percent of [0, 1, 10, 30, 33, 50, 99, 100])
    for (const held of [0, 1, 3, 7, 100, 12_345])
      for (const cash of [0, 99.99, 7_200, 1_000_000, 98_765_432.1])
        for (const price of [null, 0, 0.5, 17.31, 100, 263_500])
          for (const factor of [FACTOR, 1, (1 + 0.001) * (1 + 0.0025)])
            for (const max of [false, true]) {
              n++;
              const inp = { unit: 'percent' as const, quantity: 10, percent, max, price, cash, buyCostFactor: factor, held };
              const b = quickOrderQuantity({ ...inp, side: 'BUY' });
              const s = quickOrderQuantity({ ...inp, side: 'SELL' });
              const ob = oldPercent('BUY', price, cash, percent, held, factor);
              const os = oldPercent('SELL', price, cash, percent, held, factor);
              const ok =
                b.quantity === ob && s.quantity === os && !b.allHeld && !s.allHeld &&
                quickOrderHint('percent', percent, held, b, s) === oldPercentHint(percent, held, ob, os);
              if (!ok) {
                bad++;
                if (!firstBad) firstBad = JSON.stringify({ percent, held, cash, price, factor, max, b, s, ob, os });
              }
            }
  check(`5 「%」 매수 · 매도 수량 · 안내 줄 = 옛 식 (${n}개 조합)`, bad === 0, bad ? `다름 ${bad} · ${firstBad}` : '');
}

// ── 6 보유 0주 → 매도 0주 ──────────────────────────────────
{
  const s1 = q({ held: 0, side: 'SELL', quantity: 10 });
  const s2 = q({ held: 0, side: 'SELL', max: true });
  const s3 = q({ held: 0, side: 'SELL', unit: 'percent', percent: 100 });
  check('6 보유 0주 · 숫자 / 「최대」 / 100% → 매도 0주(버튼 꺼짐 조건 `<= 0`)', s1.quantity === 0 && s2.quantity === 0 && s3.quantity === 0 && !s1.allHeld && !s2.allHeld);
  const b = q({ held: 0, side: 'BUY', max: true, price: limit });
  check('6 보유 0주 · 「최대」 안내 줄 「(보유 없음)」', quickOrderHint('shares', 30, 0, b, s2) === `매수 ${maxBuy}주 · 매도 0주 (보유 없음)`, String(quickOrderHint('shares', 30, 0, b, s2)));
}

// ── 8 서버 보유 수량 검사 · 주문 요청 모양 그대로 ─────────────────
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const server = fs.readFileSync(path.join(root, 'server/paperTradingService.ts'), 'utf8');
check(
  '8 서버 보유 수량 검사가 그대로 있다',
  server.includes('if (held < quantity) {') && server.includes('`보유 수량이 부족합니다 (보유 ${held}, 주문 ${quantity}).`'),
);
const panel = fs.readFileSync(path.join(root, 'src/components/chart/QuickOrderPanel.tsx'), 'utf8');
const body = panel.match(/submitOrder\(\{([\s\S]*?)\}\);/);
const keys = body ? [...body[1].matchAll(/^\s*(\w+)[:,]/gm)].map((m) => m[1]).join(',') : '';
check('8 패널 주문 요청 칸 = accountId,symbol,side,orderType,quantity,requestedPrice,reason', keys === 'accountId,symbol,side,orderType,quantity,requestedPrice,reason', keys);
check('8 패널 주문 수량 = 함수가 낸 수량 하나', /quantity: orderQuantity,/.test(panel) && /quickOrderQuantity\(/.test(panel));
check('A-11 패널 안에 옛 수량 계산이 남지 않았다', !/percent\) \/ 100|Math\.floor\(/.test(panel));

console.log(`\n${pass} 통과 · ${fail} 실패`);
process.exit(fail ? 1 : 0);
