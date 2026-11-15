/**
 * 계좌 자동매매 테스트 결과 보고 글 — `npm run -s autotrade:report` 와 시험(`oraclereport:test`)이 같이 쓴다.
 *
 * - 입력은 **읽기 전용으로 연** 앱 DB — 쓰기 0 · 외부 호출 0(토스 · 지표 엔진 · Gemini 부르지 않음 · 주문 0).
 * - ⚠️ 금액 · 수량 · 가격은 글에 넣지 않는다 — 손익은 %(스냅샷 누적 수익률 — 입출금을 뺀 값) · 나머지는 횟수 · 날 수만.
 * - 「못 산 이유」: 계좌의 판단 기록(`autoTrading.lastNotes`)은 **그날 하루치만** 남는다. 지난 날은 매수 판단 기록(`buy_judgments` —
 *   계좌와 같은 `judgeOnClose` · 끝난 봉)에서 **그 계좌의 규칙 · 종목** 줄로 센다(매수 판단 목록에 없는 종목 · 다른 규칙은 셀 수 없다 — 「덮은 종목」 칸).
 *   이 길로는 엔진 판단(기준 미달 · 손익비 · 거름망)까지만 보이고, 계좌 안전장치(보유 가득 · 현금 · 실적 회피 · 하루 손실)는 기록이 없다.
 * - 「사도 됨」 이었는데 사지 않은 날: 매수 판단 「사도 됨」(그날 봉) 뒤 6일 안에 그 계좌의 그 종목 매수가 없으면 — 까닭은 이미 보유 중 ·
 *   AI 검증 「위험」 으로 안 삼(`ai_check_uses`) · 그 밖(기록 없음)으로 나눈다.
 * - 거래일 = 계좌를 만든 날부터 그 계좌 시장(국내 종목뿐이면 국내 · 아니면 미국) 달력의 거래일 수(자동매매가 켜져 있던 날만이 아니다 — 켠 날은 기록이 없다).
 */
import type Database from 'better-sqlite3';
import { isMarketClosed } from '../../server/marketCalendar';
import { VERDICT_LABEL, verdictOf } from '../../src/types/buyJudge';
import { gateBlockLabel, type DecisionCode, type GateReason } from '../../src/types/autoTrading';
import { isKrSymbol } from '../../src/utils/market';
import { marketDate } from '../../src/utils/marketDate';

/** 계좌 판단 코드 → 보고용 짧은 이름(그날 하루치 기록 칸) */
const CODE_LABEL: Partial<Record<DecisionCode, string>> = {
  score_buy: '사도 됨',
  score_sell: '팔 신호',
  rr_block: '손익비 부족',
  bar_unconfirmed: '봉이 끝나지 않음',
  gate_block: '거름망에 걸림',
  reentry_wait: '손절 뒤 다시 매수 대기',
  dead: '데드 크로스',
  rsi_hot: '반대 신호(RSI 과열)',
  no_signal_buy: '기준 미달(매수)',
  no_signal_hold: '기준 미달(보유)',
  hard_stop: '손절',
  take_profit: '익절',
  trailing: '트레일링',
  earnings_blackout: '실적 발표 앞',
  max_positions: '보유 종목 수 가득',
  daily_loss: '하루 손실 한도',
  not_enough_candles: '일봉 부족',
  error: '오류',
  other: '그 밖(현금 · 예산 등)',
  ai_pass: 'AI 통과',
  ai_risk: 'AI 위험',
  ai_unavailable: 'AI 검증 못 함',
};
const BUY_WINDOW_DAYS = 6;
const REF_SYMBOL = { US: 'SPY', KR: '069500' } as const;
const REF_LABEL = { US: 'SPY', KR: 'KODEX 200' } as const;

type Strategy = { enabled?: boolean; ruleId?: number | null; symbols?: string[]; aiCheck?: boolean };
interface AccountRow {
  id: number;
  name: string;
  created_at: string;
  is_active: number;
}
export interface AccountLine {
  id: number;
  name: string;
  rule: string;
  ruleId: number | null;
  symbols: string[];
  ai: boolean;
  enabled: boolean;
  market: 'KR' | 'US';
  start: string;
  tradingDays: number;
  buys: number;
  sells: number;
  holding: number;
  returnPct: number | null;
  refPct: number | null;
  judged: number;
  covered: number;
  buyDays: number;
  reasons: [string, number][];
  missed: number;
  missedWhy: [string, number][];
  aiRiskSkips: number;
  lastDay: string | null;
  lastReasons: [string, number][];
}

const kstDate = (iso: string) => marketDate(Date.parse(iso), '005930');
const shift = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const fmtPct = (v: number | null) => (v == null ? '—' : `${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v).toFixed(2)}%`);
/** 많은 순 · 같으면 이름 순(글자 코드 — 기계마다 같은 순서) */
const counted = (m: Map<string, number>): [string, number][] => [...m.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
const listText = (xs: [string, number][], max = 4) => (xs.length ? xs.slice(0, max).map(([k, n]) => `${k} ${n}`).join(' · ') + (xs.length > max ? ` · 그 밖 ${xs.slice(max).reduce((s, x) => s + x[1], 0)}` : '') : '—');
const bump = (m: Map<string, number>, k: string, n = 1) => m.set(k, (m.get(k) ?? 0) + n);

export function buildAutotradeLines(db: Database.Database, o: { from?: string; to?: string; today?: string } = {}): AccountLine[] {
  const has = (t: string) => Boolean(db.prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`).get(t));
  if (!has('paper_accounts')) return [];
  const setting = <T>(key: string, fallback: T): T => {
    if (!has('gemini_settings')) return fallback;
    const row = db.prepare(`SELECT value FROM gemini_settings WHERE key = ?`).get(key) as { value: string } | undefined;
    try {
      return row ? (JSON.parse(row.value) as T) : fallback;
    } catch {
      return fallback;
    }
  };
  const strategies = setting<Record<string, Strategy>>('autoTrading.strategies', {});
  const notes = setting<Record<string, { at: string; day?: string; notes: { code?: DecisionCode; action: string; gateReason?: GateReason }[] }>>('autoTrading.lastNotes', {});
  const ruleName = new Map<number, string>(has('trading_rules') ? (db.prepare(`SELECT id, name FROM trading_rules`).all() as { id: number; name: string }[]).map((r) => [r.id, r.name]) : []);
  const today = o.today ?? kstDate(new Date().toISOString());
  const end = o.to && o.to < today ? o.to : today;
  const accounts = db.prepare(`SELECT id, name, created_at, is_active FROM paper_accounts ORDER BY id`).all() as AccountRow[];

  return accounts.map((a) => {
    const st = strategies[String(a.id)] ?? {};
    const symbols = [...new Set((st.symbols ?? []).map((s) => s.toUpperCase()))];
    const market: 'KR' | 'US' = symbols.length && symbols.every(isKrSymbol) ? 'KR' : 'US';
    const created = kstDate(a.created_at);
    const start = o.from && o.from > created ? o.from : created;
    let tradingDays = 0;
    for (let d = start; d <= end && tradingDays < 4000; d = shift(d, 1)) if (!isMarketClosed(market, d, db)) tradingDays++;

    // 매매 — 횟수만(금액 · 수량은 쓰지 않는다)
    const trades = has('paper_trades')
      ? (db.prepare(`SELECT symbol, side, quantity, traded_at FROM paper_trades WHERE account_id = ? ORDER BY traded_at, id`).all(a.id) as { symbol: string; side: string; quantity: number; traded_at: string }[])
      : [];
    const tradeDay = (t: { symbol: string; traded_at: string }) => marketDate(Date.parse(t.traded_at), t.symbol);
    const inPeriod = trades.filter((t) => tradeDay(t) >= start && tradeDay(t) <= end);
    const holding = has('paper_positions') ? (db.prepare(`SELECT COUNT(*) AS n FROM paper_positions WHERE account_id = ? AND quantity > 0`).get(a.id) as { n: number }).n : 0;

    // 수익률(%) — 스냅샷 누적 수익률(입출금을 뺀 값). 기간 시작 전 마지막 점을 기준으로 이어 붙인다
    let returnPct: number | null = null;
    if (has('paper_snapshots')) {
      const last = db.prepare(`SELECT cumulative_return AS c FROM paper_snapshots WHERE account_id = ? AND date <= ? ORDER BY date DESC LIMIT 1`).get(a.id, end) as { c: number | null } | undefined;
      const base = o.from ? (db.prepare(`SELECT cumulative_return AS c FROM paper_snapshots WHERE account_id = ? AND date < ? ORDER BY date DESC LIMIT 1`).get(a.id, o.from) as { c: number | null } | undefined) : undefined;
      if (last?.c != null) returnPct = Math.round(((1 + last.c / 100) / (1 + (base?.c ?? 0) / 100) - 1) * 10_000) / 100;
    }
    // 같은 기간 기준 지수 — 앱 캐시 일봉(받아 둔 날까지)
    let refPct: number | null = null;
    if (has('candles')) {
      const ref = REF_SYMBOL[market];
      const rows = (db.prepare(`SELECT timestamp, close FROM candles WHERE symbol = ? AND timeframe = '1d' ORDER BY timestamp`).all(ref) as { timestamp: number; close: number }[]).map((r) => ({ day: marketDate(r.timestamp, ref), close: r.close }));
      const before = rows.filter((r) => r.day < start).at(-1);
      const last = rows.filter((r) => r.day <= end).at(-1);
      if (before && last && before.close > 0 && last.day > before.day) refPct = Math.round((last.close / before.close - 1) * 10_000) / 100;
    }

    // 못 산 이유 — 매수 판단 기록(그 계좌 규칙 · 종목)
    const reasons = new Map<string, number>();
    const missedWhy = new Map<string, number>();
    let judged = 0;
    let buyDays = 0;
    let missed = 0;
    const coveredSyms = new Set<string>();
    const aiSkips = has('ai_check_uses') && has('ai_checks')
      ? (db.prepare(`SELECT c.symbol, c.market_date FROM ai_check_uses u JOIN ai_checks c ON c.id = u.check_id WHERE u.account_id = ? AND u.action = 'skipped' AND c.verdict = 'risk'`).all(a.id) as { symbol: string; market_date: string }[])
      : [];
    const aiRiskSkips = aiSkips.filter((s) => s.market_date >= start && s.market_date <= end).length;
    if (st.ruleId != null && symbols.length && has('buy_judgments')) {
      const rows = db
        .prepare(`SELECT market_date, symbol, code, gate_reason FROM buy_judgments WHERE rule_id = ? AND market_date >= ? AND market_date <= ? AND symbol IN (${symbols.map(() => '?').join(',')}) ORDER BY market_date`)
        .all(st.ruleId, start, end, ...symbols) as { market_date: string; symbol: string; code: string; gate_reason: GateReason | null }[];
      for (const r of rows) {
        judged++;
        coveredSyms.add(r.symbol);
        const v = verdictOf(r.code);
        if (v !== 'buy') {
          bump(reasons, v === 'gate_block' ? gateBlockLabel(r.gate_reason) : VERDICT_LABEL[v]);
          continue;
        }
        buyDays++;
        const after = (t: { symbol: string; traded_at: string }) => t.symbol === r.symbol && tradeDay(t) > r.market_date && tradeDay(t) <= shift(r.market_date, BUY_WINDOW_DAYS);
        if (trades.some((t) => t.side === 'BUY' && after(t))) continue;
        missed++;
        // 그날 이미 보유 중이었나 — 그날까지의 매매로 센 보유(수량은 글에 쓰지 않는다)
        const net = trades.filter((t) => t.symbol === r.symbol && tradeDay(t) <= r.market_date).reduce((s, t) => s + (t.side === 'BUY' ? t.quantity : -t.quantity), 0);
        if (net > 1e-9) bump(missedWhy, '이미 보유 중');
        else if (aiSkips.some((s) => s.symbol === r.symbol && s.market_date > r.market_date && s.market_date <= shift(r.market_date, BUY_WINDOW_DAYS))) bump(missedWhy, 'AI 검증 위험');
        else bump(missedWhy, '기록 없음(보유 가득 · 현금 · 실적 · 하루 손실 · 꺼짐 등)');
      }
    }
    // 마지막 판단 날(계좌 기록 — 그날 하루치)
    const last = notes[String(a.id)];
    const lastReasons = new Map<string, number>();
    for (const n of last?.notes ?? []) if (n.action === 'HOLD') bump(lastReasons, n.code === 'gate_block' ? gateBlockLabel(n.gateReason) : (CODE_LABEL[n.code ?? 'other'] ?? n.code ?? '그 밖'));

    return {
      id: a.id,
      name: a.name,
      rule: st.ruleId != null ? (ruleName.get(st.ruleId) ?? `(지운 규칙 #${st.ruleId})`) : '—',
      ruleId: st.ruleId ?? null,
      symbols,
      ai: Boolean(st.aiCheck),
      enabled: Boolean(st.enabled) && a.is_active === 1,
      market,
      start,
      tradingDays,
      buys: inPeriod.filter((t) => t.side === 'BUY').length,
      sells: inPeriod.filter((t) => t.side === 'SELL').length,
      holding,
      returnPct,
      refPct,
      judged,
      covered: coveredSyms.size,
      buyDays,
      reasons: counted(reasons),
      missed,
      missedWhy: counted(missedWhy),
      aiRiskSkips,
      lastDay: last ? (last.day ?? kstDate(last.at)) : null,
      lastReasons: counted(lastReasons),
    };
  });
}

/** 보고 글(한국어 · 표 · 100줄 안 · 맨 끝 「한 줄 결론」) */
export function buildAutotradeReport(db: Database.Database, o: { from?: string; to?: string; today?: string } = {}): string {
  const lines = buildAutotradeLines(db, o);
  const out: string[] = [];
  out.push('# 계좌 자동매매 테스트 보고 (읽기 전용)');
  out.push(`- 기간: ${o.from ?? '계좌를 만든 날'} ~ ${o.to ?? '오늘'} · 손익은 %만(입출금을 뺀 누적 수익률) · 금액 · 수량 · 가격은 적지 않음`);
  if (!lines.length) {
    out.push('', '계좌가 없습니다.', '', '한 줄 결론: 계좌 없음.');
    return out.join('\n');
  }
  const shown = lines.slice(0, 15);
  const nm = (l: AccountLine) => `#${l.id} ${l.name}`;
  out.push('');
  out.push('## 1. 계좌마다');
  out.push('| 계좌 | 규칙 | AI 검증 | 자동매매 | 시작일 | 거래일 | 산 | 판 | 보유 종목 | 수익률 | 기준 지수(같은 기간) |');
  out.push('|---|---|---|---|---|---|---|---|---|---|---|');
  for (const l of shown) out.push(`| ${nm(l)} | ${l.rule} | ${l.ai ? '켬' : '끔'} | ${l.enabled ? '켬' : '끔'} | ${l.start} | ${l.tradingDays} | ${l.buys} | ${l.sells} | ${l.holding} | ${fmtPct(l.returnPct)} | ${REF_LABEL[l.market]} ${fmtPct(l.refPct)} |`);
  const rets = lines.map((l) => l.returnPct).filter((v): v is number => v != null);
  out.push(`| 합계 ${lines.length}계좌 | | 켬 ${lines.filter((l) => l.ai).length} | 켬 ${lines.filter((l) => l.enabled).length} | | | ${lines.reduce((s, l) => s + l.buys, 0)} | ${lines.reduce((s, l) => s + l.sells, 0)} | ${lines.reduce((s, l) => s + l.holding, 0)} | 평균 ${fmtPct(rets.length ? Math.round((rets.reduce((s, v) => s + v, 0) / rets.length) * 100) / 100 : null)} | |`);
  if (lines.length > shown.length) out.push(`- 계좌가 많아 앞 ${shown.length}개만 보였다(합계는 전부).`);
  out.push('');
  out.push('## 2. 못 산 이유 (매수 판단 기록 — 계좌와 같은 judgeOnClose · 그 계좌 규칙 · 종목)');
  out.push('| 계좌 | 덮은 종목 | 판단 줄 | 사도 됨 | 못 산 이유(많은 순) |');
  out.push('|---|---|---|---|---|');
  for (const l of shown) out.push(`| ${nm(l)} | ${l.covered}/${l.symbols.length} | ${l.judged} | ${l.buyDays} | ${l.judged ? listText(l.reasons) : '기록 없음(매수 판단 목록 · 규칙이 다름)'} |`);
  out.push('');
  out.push('## 3. 「사도 됨」 이었는데 사지 않은 날');
  out.push(`| 계좌 | 사도 됨 | 사지 않음 | 까닭(많은 순) | AI 위험으로 안 삼(계좌 기록) |`);
  out.push('|---|---|---|---|---|');
  for (const l of shown) out.push(`| ${nm(l)} | ${l.buyDays} | ${l.missed} | ${listText(l.missedWhy, 3)} | ${l.ai ? l.aiRiskSkips : '— (끔)'} |`);
  out.push('');
  out.push('## 4. 마지막 판단 날 이유 (계좌 기록 — 그날 하루치만 남음)');
  out.push('| 계좌 | 날짜(한국) | 사지 않은 · 팔지 않은 이유(많은 순) |');
  out.push('|---|---|---|');
  for (const l of shown) out.push(`| ${nm(l)} | ${l.lastDay ?? '—'} | ${listText(l.lastReasons, 5)} |`);
  out.push('');
  out.push('## 5. AI 검증 켬 / 끔 견주기 (같은 규칙 · 같은 종목)');
  const pairs: [AccountLine, AccountLine][] = [];
  for (const on of lines.filter((l) => l.ai && l.ruleId != null)) {
    for (const off of lines.filter((l) => !l.ai && l.ruleId === on.ruleId && [...l.symbols].sort().join(',') === [...on.symbols].sort().join(','))) pairs.push([on, off]);
  }
  if (!pairs.length) out.push('- 같은 규칙 · 같은 종목으로 AI 검증만 다른 계좌 쌍이 없다.');
  else {
    out.push('| 켬 계좌 | 끔 계좌 | 수익률 켬 / 끔 | 산 켬 / 끔 | 판 켬 / 끔 | 사지 않은 「사도 됨」 켬 / 끔 | AI 위험으로 안 삼 |');
    out.push('|---|---|---|---|---|---|---|');
    for (const [on, off] of pairs.slice(0, 8)) out.push(`| ${nm(on)} | ${nm(off)} | ${fmtPct(on.returnPct)} / ${fmtPct(off.returnPct)} | ${on.buys} / ${off.buys} | ${on.sells} / ${off.sells} | ${on.missed} / ${off.missed} | ${on.aiRiskSkips} |`);
  }
  out.push('');
  out.push('- 거래일 = 계좌를 만든 날부터 그 시장 달력의 거래일 수. 기준 지수 = 앱이 받아 둔 일봉(받은 날까지). 「덮은 종목」 = 매수 판단 기록이 있는 종목 / 계좌 종목.');
  out.push('');
  const totalMissed = lines.reduce((s, l) => s + l.missed, 0);
  const topReason = counted(lines.reduce((m, l) => (l.reasons.forEach(([k, n]) => bump(m, k, n)), m), new Map<string, number>()))[0];
  const pairText = pairs.length ? ` · AI 켬/끔 쌍 ${pairs.length}개(첫 쌍 수익률 ${fmtPct(pairs[0][0].returnPct)} / ${fmtPct(pairs[0][1].returnPct)})` : '';
  out.push(`한 줄 결론: ${lines.length}계좌 · 산 ${lines.reduce((s, l) => s + l.buys, 0)}번 · 판 ${lines.reduce((s, l) => s + l.sells, 0)}번 · 가장 많은 못 산 이유(계좌 합) ${topReason ? `「${topReason[0]}」 ${topReason[1]}번` : '기록 없음'} · 「사도 됨」 인데 사지 않은 날 ${totalMissed}번${pairText}.`);
  return out.join('\n');
}
