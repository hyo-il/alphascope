/**
 * 평단 계산 · 평균 식 한 곳 시험(124차 · v2.68.0) — `npm run assetavg:test` · ⚠️ `DB_PATH=<사본>` 으로만 돈다(맨 첫 import · DB 는 쓰지 않는다).
 *
 * 124차 지시서 「꼭 지킬 동작」 1 · 2 · 3 을 확인한다(시험 이름 앞의 [124-n]). 순수 함수 + 소스 검사 — 서버 · 구글 · 토스 호출 0.
 * 값은 모두 만든 값(개인 자산 값 아님). 기대값은 손으로 계산한 값.
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import fs from 'node:fs';
import path from 'node:path';
import { addBuys, buysToTarget, tradeAfter, type AverageHolding } from '../src/utils/assetAverage';

const root = path.resolve(import.meta.dirname, '..');
let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? ` — ${detail}` : ''}`);
}
const near = (a: number | null, b: number, eps = 1e-12) => a != null && Math.abs(a - b) <= eps;
const read = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');

// ═══ 1. 계산 함수 — 국내 · 미국 ═══
{
  const kr: AverageHolding = { currency: 'KRW', qty: 30, avg: 71000, price: 65000 };
  const one = addBuys(kr, [{ price: 60000, qty: 10 }]);
  // (30 × 71,000 + 10 × 60,000) ÷ 40 = 2,730,000 ÷ 40 = 68,250
  check('[124-1] 국내 한 줄 — 새 평균 68,250 · 총 40주 · 더 드는 돈 600,000', one.newAvg === 68250 && one.newQty === 40 && one.extraCost === 600000, JSON.stringify(one));
  check('[124-1] 국내 수익률 전 = (65,000 − 71,000) ÷ 71,000', near(one.returnBefore, -6000 / 71000), String(one.returnBefore));
  check('[124-1] 국내 수익률 후 = (65,000 − 68,250) ÷ 68,250', near(one.returnAfter, -3250 / 68250), String(one.returnAfter));
  const two = addBuys(kr, [{ price: 60000, qty: 10 }, { price: 55000, qty: 10 }]);
  // 둘째 줄: (40 × 68,250 + 10 × 55,000) ÷ 50 = 3,280,000 ÷ 50 = 65,600
  check('[124-1] 국내 두 줄 — 새 평균 65,600 · 총 50주 · 더 드는 돈 1,150,000', two.newAvg === 65600 && two.newQty === 50 && two.extraCost === 1150000, JSON.stringify(two));
  const round = addBuys({ currency: 'KRW', qty: 3, avg: 1000, price: null }, [{ price: 1001, qty: 1 }]);
  check('[124-1] 국내 원 단위 반올림 — 4,001 ÷ 4 = 1,000.25 → 1,000 · 지금 가격 없으면 수익률 null', round.newAvg === 1000 && round.returnBefore === null && round.returnAfter === null, JSON.stringify(round));

  const us: AverageHolding = { currency: 'USD', qty: 12.5, avg: 101.2345, price: 95.5 };
  const u = addBuys(us, [{ price: 90, qty: 2.5 }]);
  // (12.5 × 101.2345 + 2.5 × 90) ÷ 15 = 1,490.43125 ÷ 15 = 99.362083… → 99.3621
  check('[124-1] 미국 한 줄 — 새 평균 $99.3621(소수 4자리) · 총 15주 · 더 드는 돈 $225', u.newAvg === 99.3621 && u.newQty === 15 && u.extraCost === 225, JSON.stringify(u));
  check('[124-1] 미국 수익률 전 · 후', near(u.returnBefore, (95.5 - 101.2345) / 101.2345) && near(u.returnAfter, (95.5 - 99.3621) / 99.3621), JSON.stringify(u));
  const uf = addBuys(us, [{ price: 88.1234, qty: 0.123456 }]);
  check('[124-1] 미국 소수 수량 — 총 수량 찌꺼기 없음(12.623456) · 더 드는 돈 소수 4자리', uf.newQty === 12.623456 && uf.extraCost === Number((88.1234 * 0.123456).toFixed(4)), JSON.stringify(uf));

  // 여러 줄 = 한 줄씩 차례로 더한 것
  const lines = [{ price: 60000, qty: 7 }, { price: 58000, qty: 3 }, { price: 52000, qty: 11 }];
  const all = addBuys(kr, lines);
  let q = kr.qty;
  let a = kr.avg;
  for (const l of lines) ({ afterQty: q, afterAvg: a } = tradeAfter({ side: 'buy', currency: 'KRW', beforeQty: q, beforeAvg: a, qty: l.qty, price: l.price }));
  let chain = kr;
  for (const l of lines) {
    const r = addBuys(chain, [l]);
    chain = { ...chain, qty: r.newQty, avg: r.newAvg };
  }
  check('[124-1] 여러 줄(국내 3줄) = 한 줄씩 tradeAfter 로 차례로 더한 것', all.newQty === q && all.newAvg === a && chain.qty === q && chain.avg === a, JSON.stringify({ all, q, a }));
  const ulines = [{ price: 90.5, qty: 1.5 }, { price: 85.25, qty: 0.75 }, { price: 80.1, qty: 2.000001 }];
  const uall = addBuys(us, ulines);
  let uc = us;
  for (const l of ulines) {
    const r = addBuys(uc, [l]);
    uc = { ...uc, qty: r.newQty, avg: r.newAvg };
  }
  check('[124-1] 여러 줄(미국 3줄) = 한 줄씩 차례로 더한 것', uall.newQty === uc.qty && uall.newAvg === uc.avg, JSON.stringify({ uall, uc }));
}

// ═══ 2. 거꾸로 계산 ═══
{
  const kr: AverageHolding = { currency: 'KRW', qty: 30, avg: 71000, price: 65000 };
  const exact = buysToTarget(kr, 68000);
  // 30 × 3,000 ÷ 3,000 = 30주 → (2,130,000 + 1,950,000) ÷ 60 = 68,000
  check('[124-2] 국내 딱 맞음 — 30주 · ₩1,950,000', exact.ok && exact.qty === 30 && exact.cost === 1950000, JSON.stringify(exact));
  const up = buysToTarget(kr, 68500);
  // 30 × 2,500 ÷ 3,500 = 21.43 → 22주(올림) · 22 × 65,000 = 1,430,000
  check('[124-2] 국내 올림 — 21.43 → 22주 · ₩1,430,000', up.ok && up.qty === 22 && up.cost === 1430000, JSON.stringify(up));
  if (up.ok) {
    const at = tradeAfter({ side: 'buy', currency: 'KRW', beforeQty: 30, beforeAvg: 71000, qty: up.qty, price: 65000 }).afterAvg;
    const less = tradeAfter({ side: 'buy', currency: 'KRW', beforeQty: 30, beforeAvg: 71000, qty: up.qty - 1, price: 65000 }).afterAvg;
    check('[124-2] 국내 22주면 목표 이하 · 21주면 목표 위(가장 적은 수량)', at <= 68500 && less > 68500, JSON.stringify({ at, less }));
  }
  const us: AverageHolding = { currency: 'USD', qty: 12.5, avg: 101.2345, price: 95.5 };
  const u = buysToTarget(us, 100);
  // 12.5 × 1.2345 ÷ 4.5 = 3.4291666… → 3.429167(소수 6자리 올림) · 3.429167 × 95.5 = 327.4854485 → $327.4854
  check('[124-2] 미국 — 3.429167주(소수 6자리 올림) · $327.4854', u.ok && u.qty === 3.429167 && u.cost === 327.4854, JSON.stringify(u));
  if (u.ok) {
    const at = tradeAfter({ side: 'buy', currency: 'USD', beforeQty: 12.5, beforeAvg: 101.2345, qty: u.qty, price: 95.5 }).afterAvg;
    const less = (12.5 * 101.2345 + (u.qty - 0.000001) * 95.5) / (12.5 + u.qty - 0.000001);
    check('[124-2] 미국 그 수량이면 목표 이하 · 0.000001주 적으면 (반올림 전) 목표 위', at <= 100 && less > 100, JSON.stringify({ at, less }));
  }
  const same = buysToTarget(kr, 71000);
  const higher = buysToTarget(kr, 72000);
  check('[124-2] 안 됨 ① 목표 ≥ 지금 평균 — above-avg', !same.ok && same.reason === 'above-avg' && !higher.ok && higher.reason === 'above-avg', JSON.stringify({ same, higher }));
  const eq = buysToTarget(kr, 65000);
  const below = buysToTarget(kr, 64000);
  check('[124-2] 안 됨 ② 지금 가격 ≥ 목표 — price-too-high(「지금 가격으로는 목표까지 낮출 수 없어요」)', !eq.ok && eq.reason === 'price-too-high' && !below.ok && below.reason === 'price-too-high', JSON.stringify({ eq, below }));
  const noPrice = buysToTarget({ ...kr, price: null }, 68000);
  check('[124-2] 지금 가격 없음 — no-price', !noPrice.ok && noPrice.reason === 'no-price', JSON.stringify(noPrice));
  const ui = read('src/components/asset/AssetAverageCalculator.tsx');
  check('[124-2] 창 안내 문구 「지금 가격으로는 목표까지 낮출 수 없어요」', ui.includes("'price-too-high'") && ui.includes('지금 가격으로는 목표까지 낮출 수 없어요'));
}

// ═══ 3. 평균 식 한 곳 ═══
{
  // 옛 `tradeAfter`(0a53175 `src/utils/assetTrade.ts`)로 만든 정답 402개 — 바이트 같음
  const golden = JSON.parse(read('scripts/fixtures/asset/tradeAfterGolden.json')) as { in: Parameters<typeof tradeAfter>[0]; out: ReturnType<typeof tradeAfter> }[];
  const diff = golden.filter((g) => JSON.stringify(tradeAfter(g.in)) !== JSON.stringify(g.out));
  check(`[124-3] 옛 tradeAfter 정답 ${golden.length}개와 바이트 같음(매수 · 매도 · 국내 · 미국)`, golden.length >= 400 && diff.length === 0, JSON.stringify(diff.slice(0, 2)));

  const trade = read('server/asset/trade.ts');
  const dialog = read('src/components/asset/AssetTradeDialog.tsx');
  const newBuy = read('src/components/asset/AssetNewBuyDialog.tsx');
  const calc = read('src/components/asset/AssetAverageCalculator.tsx');
  const fromAvg = /import \{[^}]*\btradeAfter\b[^}]*\} from '[./]*(?:src\/)?utils\/assetAverage'/;
  check('[124-3] 서버 recordTrade(trade.ts)가 assetAverage 의 tradeAfter 를 씀', fromAvg.test(trade) && /tradeAfter\(\{ side, currency: h\.currency/.test(trade));
  check('[124-3] 매수 창 미리 보기(AssetTradeDialog)가 assetAverage 의 tradeAfter 를 씀', fromAvg.test(dialog));
  check('[124-3] 새 종목 창(AssetNewBuyDialog)이 assetAverage 의 tradeAfter 를 씀', fromAvg.test(newBuy));
  check('[124-3] 계산기가 assetAverage 의 addBuys · buysToTarget 을 씀', /import \{[^}]*addBuys[^}]*buysToTarget[^}]*\} from '..\/..\/utils\/assetAverage'/.test(calc));
  // 가중 평균 식(× 평균 + × 가격) ÷ (수량 + 수량)이 assetAverage.ts 밖에 없다
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(path.join(root, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (/\.(ts|tsx)$/.test(e.name)) files.push(rel);
    }
  };
  ['src', 'server'].forEach(walk);
  const formula = /\*\s*\w*[Aa]vg\w*\s*\+\s*\w+\s*\*\s*\w*[Pp]rice\w*\)\s*\/\s*\(/;
  const owners = files.filter((f) => formula.test(read(f)));
  check('[124-3] 평균 식이 src · server 에서 assetAverage.ts 한 곳에만', owners.length === 1 && owners[0] === 'src/utils/assetAverage.ts', owners.join(','));
  check('[124-3] assetTrade.ts 에 평균 계산 없음(자릿수 · 검사만)', !/tradeAfter|\/ \(beforeQty/.test(read('src/utils/assetTrade.ts')));
}

// ═══ 4. 계산만 — 계산기 소스에 서버 요청 · 저장 0 ═══
{
  const calc = read('src/components/asset/AssetAverageCalculator.tsx');
  check('[124-4] 계산기 소스에 fetch · /api · 저장소(localStorage · sessionStorage) 0', !/fetch\(|\/api\/|apiFetch|localStorage|sessionStorage|onSend|onSave/.test(calc));
}

console.log(`\n결과: PASS ${pass} · FAIL ${fail}`);
process.exit(fail > 0 ? 1 : 0);
