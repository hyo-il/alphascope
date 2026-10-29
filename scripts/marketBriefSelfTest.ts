/**
 * 오늘 시황(탐색 → 오늘 시황) 점검 — `npm run marketbrief:test` · ⚠️ `DB_PATH=<사본>` 으로만 돈다(맨 첫 import).
 * **네트워크 0 · Gemini 0** — 지표 엔진 · RSS · FRED · yfinance · Gemini 는 모두 가짜를 끼운다.
 *
 * - A 수집: 지표 엔진 계산(13종 + VIX · FRED 30일 · 실패 항목 빠짐 · 시간 제한 — `marketBriefPyTest.py` 를 부른다) ·
 *   RSS(한 곳 실패 · 국내 전부 실패 → 폴백 · 오후판 해외 안 받음) · 60일 실적(대상 · 전망치 묶음 · sanity ⚠️ · 노이즈 매출 숨김 · 원화 · [D+N])
 * - 사본 DB 의 `market_briefs` 를 비우고, 시험용 실적일 · 섹터 줄(티커 ZZ…)을 넣었다가 지운다(사본만).
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import 'dotenv/config';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getDb } from '../server/db';
import { collectNews, parseFeed, DOMESTIC_FALLBACK, DOMESTIC_RSS, FOREIGN_RSS } from '../server/marketBrief/news';
import {
  buildEarning,
  collectEarnings,
  dateLabel,
  earningsLine,
  fmtMoney,
  upcomingEarningBases,
  type EarningBase,
  type RawEstimate,
} from '../server/marketBrief/earnings';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? ` — ${detail}` : ''}`);
}

const db = getDb();

// ═════════════════════════ A. 수집 ═════════════════════════

// A-1 지표 엔진 계산 — 파이썬 시험(가짜 yfinance · FRED)
{
  const py = spawnSync(path.join(root, 'python/.venv/bin/python'), ['-I', path.join(here, 'marketBriefPyTest.py')], { encoding: 'utf8' });
  const out = `${py.stdout}${py.stderr}`;
  const lines = out.split('\n').filter((l) => /^\s+(ok|FAIL) /.test(l));
  for (const l of lines) check(`지표 엔진 · ${l.trim().replace(/^(ok|FAIL)\s+/, '')}`, l.trim().startsWith('ok'));
  check('지표 엔진 시험이 끝까지 돎', py.status === 0 && /PY_RESULT 0 fail/.test(out), out.slice(-400));
}

// A-2 RSS
{
  const rss = `<?xml version="1.0"?><rss><channel><title>피드</title>
    <item><title><![CDATA[코스피 2% 상승 &amp; 외국인 매수]]></title><link>https://a.example/1</link><pubDate>Wed, 29 Oct 2026 06:00:00 +0900</pubDate><description>본문은 읽지 않는다</description></item>
    <item><title>Fed holds rates &#8212; markets rally</title><link>https://a.example/2</link></item>
  </channel></rss>`;
  const items = parseFeed(rss, '연합뉴스', false);
  check('RSS — CDATA · 엔티티 · 시각', items.length === 2 && items[0].title === '코스피 2% 상승 & 외국인 매수' && items[0].publishedAt === '2026-10-28T21:00:00.000Z' && items[1].title === 'Fed holds rates — markets rally', JSON.stringify(items));
  check('RSS — 본문은 담지 않음', !JSON.stringify(items).includes('본문은'));
  const atom = `<feed><entry><title>Atom 제목</title><link href="https://b.example/x"/><updated>2026-10-28T12:00:00Z</updated></entry></feed>`;
  const a = parseFeed(atom, 'x', true);
  check('Atom — entry · link href', a.length === 1 && a[0].link === 'https://b.example/x' && a[0].foreign);
  const many = `<rss><channel>${Array.from({ length: 30 }, (_, i) => `<item><title>t${i}</title></item>`).join('')}</channel></rss>`;
  check('소스마다 최대 20건', parseFeed(many, 'x', false).length === 20);

  const asked: string[] = [];
  const feed = (n: number) => `<rss><channel>${Array.from({ length: n }, (_, i) => `<item><title>글 ${i}</title></item>`).join('')}</channel></rss>`;
  const oneDown = await collectNews(true, async (url) => {
    asked.push(url);
    if (url === DOMESTIC_RSS[1].url) throw new Error('HTTP 503');
    return feed(3);
  });
  check('한 곳 실패 → 나머지로 진행', oneDown.domestic.length === 9 && oneDown.foreign.length === 12);
  const bad = oneDown.results.find((r) => r.source === DOMESTIC_RSS[1].source);
  check('실패한 소스가 결과에 남음', bad?.ok === false && bad.error === 'HTTP 503');
  check('국내가 있으면 폴백을 부르지 않음', !asked.includes(DOMESTIC_FALLBACK.url));

  asked.length = 0;
  const allDown = await collectNews(true, async (url) => {
    asked.push(url);
    if (DOMESTIC_RSS.some((s) => s.url === url)) return url === DOMESTIC_RSS[0].url ? feed(0) : Promise.reject(new Error('DNS 실패'));
    return feed(2);
  });
  const fb = allDown.results.find((r) => r.fallback);
  check('국내 전부 실패(빈 피드 포함) → 폴백', asked.includes(DOMESTIC_FALLBACK.url) && allDown.domestic.length === 2 && fb?.ok === true && fb.source === 'SBS 경제');
  check('빈 피드는 실패로 표시', allDown.results.find((r) => r.source === DOMESTIC_RSS[0].source)?.error === '글 0개');

  asked.length = 0;
  await collectNews(false, async (url) => {
    asked.push(url);
    return feed(1);
  });
  check('오후판 — 해외 뉴스는 받지 않음', !asked.some((u) => FOREIGN_RSS.some((s) => s.url === u)) && asked.length === DOMESTIC_RSS.length);
}

// A-3 실적 — 원본 예시 값으로 sanity · 표기
{
  const base = (symbol: string, daysUntil = 5): EarningBase => ({ symbol, name: symbol, sector: '기술', date: '2026-11-03', daysUntil, isEstimateDate: false });
  const est = (o: Partial<RawEstimate>): RawEstimate => ({ symbol: 'X', ok: true, ...o });

  // 원본 예 (정상): 예상 EPS $5.41 (직전 $5.94, YoY $4.96) | 컨센서스 Buy(12/24) | 매출 $48.72B
  const normal = buildEarning(base('JPM'), est({ epsEstimate: 5.41, lastQuarterEps: 5.94, yearAgoEps: 4.96, revenueAvg: 48.72e9, yearAgoRevenue: 45e9, recommendation: { strongBuy: 4, buy: 8, hold: 10, sell: 2, strongSell: 0 } }));
  check('정상 — 표기', normal.epsEstimate === '$5.41' && normal.lastQuarterEps === '$5.94' && normal.yoyEps === '$4.96' && normal.revenueEstimate === '$48.72B' && normal.recommendation === 'Buy (12/24)' && !normal.epsSanityFlag, JSON.stringify(normal));

  // 원본 예 (sanity): 예상 EPS $0.12 ⚠️ (직전 $0.35 …) — 0.12/0.35 = 0.34 < 0.4
  const low = buildEarning(base('INTC'), est({ epsEstimate: 0.12, lastQuarterEps: 0.35, yearAgoEps: 0.14 }));
  check('EPS 직전 분기 0.4배 미만 → ⚠️', low.epsSanityFlag);
  const high = buildEarning(base('MU'), est({ epsEstimate: 20.05, lastQuarterEps: 7.9 }));
  check('EPS 직전 분기 2.5배 초과 → ⚠️', high.epsSanityFlag);
  const edge = buildEarning(base('A'), est({ epsEstimate: 2.5, lastQuarterEps: 1 }));
  check('정확히 2.5배는 통과(초과만)', !edge.epsSanityFlag);

  // 원본 예 (매출 차단): 예상 EPS $20.05 (직전 $12.20, YoY $1.91, ±46%) — 분산 46%: 보이지만 ⚠️ 아님
  const mu = buildEarning(base('MU'), est({ epsEstimate: 20.05, lastQuarterEps: 12.2, yearAgoEps: 1.91, epsHigh: 20.05 * 1.46, epsLow: 20.05 * 0.54, revenueAvg: 30e9, yearAgoRevenue: 9e9 }));
  check('분산 46% → 「분산 ±46%」 · ⚠️ 아님', mu.epsDispersion === '분산 ±46%' && !mu.epsSanityFlag, JSON.stringify(mu));
  check('매출 전년 동기 3배 초과 → 숨김(-)', mu.revenueSanityFlag && mu.revenueEstimate === '-');
  const wide = buildEarning(base('B'), est({ epsEstimate: 1, epsHigh: 1.6, epsLow: 0.39 }));
  check('분산 50% 초과 → ⚠️', wide.epsSanityFlag && wide.epsDispersion === '분산 ±61%', JSON.stringify(wide));
  const narrow = buildEarning(base('C'), est({ epsEstimate: 1, epsHigh: 1.2, epsLow: 0.8 }));
  check('분산 30% 미만 → 표시 없음', narrow.epsDispersion === '-');
  const lowRev = buildEarning(base('D'), est({ revenueAvg: 2e9, yearAgoRevenue: 10e9 }));
  check('매출 0.3배 미만 → 숨김', lowRev.revenueSanityFlag && lowRev.revenueEstimate === '-');

  const kr = buildEarning(base('005930'), est({ epsEstimate: 1234.6, lastQuarterEps: 1100, revenueAvg: 79.14e12, yearAgoRevenue: 70e12 }));
  check('국내 — 원화 EPS · 조', kr.epsEstimate === '₩1,235' && kr.lastQuarterEps === '₩1,100' && kr.revenueEstimate === '₩79.1조', JSON.stringify(kr));
  check('국내 — 억 · 미국 T/M', fmtMoney(5432e8, true) === '₩5,432억' && fmtMoney(1.2e12, false) === '$1.20T' && fmtMoney(500e6, false) === '$500.00M');
  const none = buildEarning(base('E'), null);
  check('전망치 못 받음 → 「-」 · estimatesOk=false', none.epsEstimate === '-' && none.recommendation === '-' && !none.estimatesOk);

  const line = earningsLine({ ...low, name: '인텔', date: '2026-11-03', daysUntil: 5 });
  check('AI 입력 줄 — [D+N] · ⚠️ · 날짜 「MM/DD(요일)」', line.startsWith('- 11/03(화) [D+5] [기술] 인텔(INTC)') && line.includes('예상 EPS $0.12 ⚠️'), line);
  check('dateLabel 요일', dateLabel('2026-10-29') === '10/29(목)' && dateLabel('2026-11-01') === '11/01(일)');

  // 1단계 — 저장된 실적일(getEarningsDate)만 · 60일 · 섹터 한국어 · 이름
  const T = ['ZZA', 'ZZB', 'ZZC', 'ZZD', '0ZZ001'];
  db.prepare(`DELETE FROM earnings_calendar WHERE symbol IN (${T.map(() => '?').join(',')})`).run(...T);
  db.prepare(`DELETE FROM stock_profiles WHERE symbol IN (${T.map(() => '?').join(',')})`).run(...T);
  const put = db.prepare(`INSERT INTO earnings_calendar (symbol, earnings_date, fetched_at, is_estimate) VALUES (?, ?, '2026-10-29T00:00:00Z', ?)`);
  put.run('ZZA', '2026-10-29', 0); // 오늘 D+0
  put.run('ZZB', '2026-12-28', 1); // D+60 (포함)
  put.run('ZZC', '2026-12-29', 0); // D+61 (제외)
  put.run('ZZD', '2026-10-28', 0); // 지난 날 (제외)
  put.run('0ZZ001', '2026-11-10', 0);
  db.prepare(`INSERT INTO stock_profiles (symbol, sector, fetched_at) VALUES ('ZZA', 'Technology', 'x'), ('0ZZ001', 'Financial Services', 'x')`).run();
  const bases = upcomingEarningBases('2026-10-29', T);
  check('60일 안(D+0 ~ D+60)만', bases.map((b) => `${b.symbol}:${b.daysUntil}`).join(',') === 'ZZA:0,0ZZ001:12,ZZB:60', JSON.stringify(bases));
  check('섹터 한국어(종목 지도와 같은 이름) · 모르면 기타', bases[0].sector === '기술' && bases[1].sector === '금융' && bases[2].sector === '기타');
  check('추정일 표시', bases[2].isEstimateDate && !bases[0].isEstimateDate);
  db.prepare(`DELETE FROM earnings_calendar WHERE symbol IN (${T.map(() => '?').join(',')})`).run(...T);
  db.prepare(`DELETE FROM stock_profiles WHERE symbol IN (${T.map(() => '?').join(',')})`).run(...T);

  // 2단계 — 10종목씩 · 묶음 사이 1초 · 묶음 하나 실패해도 계속
  const many = Array.from({ length: 25 }, (_, i) => base(`S${i}`, i));
  const chunks: string[][] = [];
  const sleeps: number[] = [];
  const got = await collectEarnings('2026-10-29', {
    bases: many,
    fetcher: async (symbols) => {
      chunks.push(symbols);
      if (symbols[0] === 'S10') throw new Error('지표 엔진 응답 500');
      return symbols.map((s) => ({ symbol: s, ok: true, epsEstimate: 1, lastQuarterEps: 1 }));
    },
    sleep: async (ms) => void sleeps.push(ms),
  });
  check('전망치 10종목씩 3묶음 · 사이 1초', chunks.map((c) => c.length).join(',') === '10,10,5' && sleeps.join(',') === '1000,1000');
  check('묶음 실패 → 그 종목만 전망치 없이 · 오류 남김', got.estimatesOk === 15 && got.estimatesTried === 25 && /일부 받기 실패/.test(got.error ?? ''));
  let t = 0;
  const capped = await collectEarnings('2026-10-29', {
    bases: many,
    fetcher: async (symbols) => symbols.map((s) => ({ symbol: s, ok: true })),
    sleep: async () => {},
    now: () => (t += 150_000),
  });
  check('전체 상한(4분) 넘으면 남은 종목은 실적일만', capped.earnings.length === 25 && capped.estimatesOk < 25 && /상한/.test(capped.error ?? ''), capped.error ?? '');
}

console.log(`\n결과: ${pass}개 통과 / ${fail}개 실패`);
process.exit(fail ? 1 : 0);
