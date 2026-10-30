/**
 * 오늘 시황(탐색 → 오늘 시황) 점검 — `npm run marketbrief:test` · ⚠️ `DB_PATH=<사본>` 으로만 돈다(맨 첫 import).
 * **네트워크 0 · Gemini 0** — 지표 엔진 · RSS · FRED · yfinance · Gemini 는 모두 가짜를 끼운다.
 *
 * - A 수집: 지표 엔진 계산(13종 + VIX · FRED 30일 · 실패 항목 빠짐 · 시간 제한 — `marketBriefPyTest.py` 를 부른다) ·
 *   RSS(한 곳 실패 · 국내 전부 실패 → 폴백 · 오후판 해외 안 받음) · 60일 실적(대상 · 전망치 묶음 · sanity ⚠️ · 노이즈 매출 숨김 · 원화 · [D+N])
 * - B 만들기: 프롬프트([D+N] · 섹터 목록 · 판별 입력) · 스키마(섹터 enum) · 뒤처리 3단계(순서 · 국내 보존 · 상한 3/3/2 · 슬롯 다시 배치 · 해 경계) ·
 *   Gemini 꺼짐/실패/429 → 데이터만 저장 · 1번만 다시 · 자동(평일 06:55 뒤 첫 틱 1번 · 주말 0 · 같은 날 0 · 13시 뒤 0 · 스위치 끔 0) ·
 *   버튼(13시 경계 판 · 5번 뒤 막힘 · 자동은 안 셈 · 동시에 두 번 → 하나) · 30일 정리 · 같은 날 여러 줄
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
import { buildPrompt, SCHEMA, REQUIRED_KEYS, MARKET_BRIEF_PROMPT_VERSION } from '../server/marketBrief/prompt';
import { BRIEF_SECTORS } from '../server/marketBrief/earnings';
import { capAndSortBySectorPriority, daysUntilLabel, filterByLeadingSectors, markReleased, normalizeBrief, postprocess, reassignSlotsByDays } from '../server/marketBrief/postprocess';
import { regularSessionEnd, setSessionHooksForTest } from '../server/heatmapSession';
import { countBriefs, getBrief, insertBrief, listBriefDays, listBriefsOf, purgeOldBriefs } from '../server/marketBrief/store';
import { autoDue, BriefLimitError, briefStatus, marketBriefTick, resetBriefStateForTest, resetPurgeForTest, startButtonRun, type BriefDeps } from '../server/marketBrief/service';
import { geminiUsageToday } from '../server/gemini/usage';
import { GeminiError, type GeminiCallOptions } from '../server/gemini/client';
import { editionAt, isIntradayBar, scheduleItemMarket } from '../src/utils/marketBrief';
import fs from 'node:fs';
import type { BriefAi, BriefEarning, BriefScheduleItem } from '../src/types/marketBrief';

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
  const bases = upcomingEarningBases(Date.parse('2026-10-29T14:00:00+09:00'), T);
  check('60일 안(D+0 ~ D+60)만', bases.map((b) => `${b.symbol}:${b.daysUntil}`).join(',') === 'ZZA:0,0ZZ001:12,ZZB:60', JSON.stringify(bases));
  check('섹터 한국어(종목 지도와 같은 이름) · 모르면 기타', bases[0].sector === '기술' && bases[1].sector === '금융' && bases[2].sector === '기타');
  check('추정일 표시', bases[2].isEstimateDate && !bases[0].isEstimateDate);
  db.prepare(`DELETE FROM earnings_calendar WHERE symbol IN (${T.map(() => '?').join(',')})`).run(...T);
  db.prepare(`DELETE FROM stock_profiles WHERE symbol IN (${T.map(() => '?').join(',')})`).run(...T);

  // 2단계 — 10종목씩 · 묶음 사이 1초 · 묶음 하나 실패해도 계속
  const many = Array.from({ length: 25 }, (_, i) => base(`S${i}`, i));
  const chunks: string[][] = [];
  const sleeps: number[] = [];
  const got = await collectEarnings(Date.parse('2026-10-29T14:00:00+09:00'), {
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
  const capped = await collectEarnings(Date.parse('2026-10-29T14:00:00+09:00'), {
    bases: many,
    fetcher: async (symbols) => symbols.map((s) => ({ symbol: s, ok: true })),
    sleep: async () => {},
    now: () => (t += 150_000),
  });
  check('전체 상한(4분) 넘으면 남은 종목은 실적일만', capped.earnings.length === 25 && capped.estimatesOk < 25 && /상한/.test(capped.error ?? ''), capped.error ?? '');
}


// ═════════════════════════ B. 만들기 · 저장 · 자동 · 버튼 ═════════════════════════

const kst = (day: string, hm: string) => Date.parse(`${day}T${hm}:00+09:00`);
const earningOf = (symbol: string, name: string, sector: string, daysUntil: number, flag = false): BriefEarning => ({
  symbol, name, sector, date: '2026-11-01', daysUntil, isEstimateDate: false,
  epsEstimate: '$1.00', lastQuarterEps: '$0.90', yoyEps: '$0.80', revenueEstimate: '$10.00B', recommendation: 'Buy (10/12)',
  epsDispersion: '-', epsSanityFlag: flag, revenueSanityFlag: false, estimatesOk: true,
});
const assets = {
  SP500: { current: 6031.8, change: 31.8, change_pct: 0.53, data_date: '2026-10-28' },
  NASDAQ: { current: 20100.12, change: -50.5, change_pct: -0.25, data_date: '2026-10-28' },
  US2Y: { current: 3.49, change: -0.02, change_pct: -0.57, data_date: '2026-10-28' },
  KOSPI: { current: 2650.1, change: 10, change_pct: 0.38, data_date: '2026-10-29' },
  KOSDAQ: { current: 850.2, change: -3, change_pct: -0.35, data_date: '2026-10-29' },
  VIX: { current: 22.4, change: 1.2, change_pct: 5.66, data_date: '2026-10-28' },
};
const news = (n: number, foreign: boolean) => Array.from({ length: n }, (_, i) => ({ title: `${foreign ? 'US' : '국내'} 헤드라인 ${i}`, source: foreign ? 'CNBC Tech' : '연합뉴스', link: '', publishedAt: null, foreign }));

// B-1 프롬프트 · 스키마
{
  const earnings = [earningOf('INTC', '인텔', '기술', 5, true), earningOf('005930', '삼성전자', '기술', 12)];
  const morning = buildPrompt({ edition: 'morning', today: '2026-10-29', assets, earnings, domestic: news(50, false), foreign: news(60, true), at: kst('2026-10-29', '07:05') });
  check('오전판 — 날짜 · 지수 줄(원본 형식)', morning.startsWith('오늘 날짜는 2026년 10월 29일입니다(한국). 미국 동부 날짜는 2026년 10월 28일입니다.') && morning.includes('  S&P500: 6,031.8000 (+0.53%) [10/28(수) 종가]') && morning.includes('  나스닥: 20,100.1200 (-0.25%)'));
  check('오전판 — 실적 [D+N] · ⚠️ · 국내 종목 포함', morning.includes('[D+5] [기술] 인텔(INTC)') && morning.includes('예상 EPS $1.00 ⚠️') && morning.includes('삼성전자(005930)'));
  check('오전판 — 국내 30 · 해외 40 건까지', (morning.match(/\[국내\] /g) ?? []).length === 30 && (morning.match(/\[해외\] /g) ?? []).length === 40);
  check('오전판 — 섹터 목록 = 종목 지도 한국어 섹터', BRIEF_SECTORS.every((s2) => morning.includes(`"${s2}"`)) && morning.includes('"기술"'));
  check('오전판 — 원본 규칙(슬롯 · 숏 관점 · 80자 · 100자 · 실적 발표 형식)', ['this_week: **D+0 ~ D+7**', '"숏 관점"', '80자 이내', '100자 이내', '"<회사명> 실적 발표"', 'catalysts 는 upcoming_schedule (②) 와 절대 중복 금지'].every((t) => morning.includes(t)));
  const afternoon = buildPrompt({ edition: 'afternoon', today: '2026-10-29', assets, earnings, domestic: news(5, false), foreign: news(5, true), at: kst('2026-10-29', '16:00') });
  check('오후판 — 국내 지수 · VIX 구간 · 해외 뉴스 없음', afternoon.includes('  코스피: 2,650.1000 (+0.38%) [10/29(목) 종가]') && afternoon.includes('  VIX: 22.40 — 주의 구간 (20~30)') && !afternoon.includes('[해외]') && afternoon.includes('VIX 수치(22.4)'));
  const sch = SCHEMA.morning as { properties: Record<string, { items?: { properties: Record<string, { enum?: string[] }> } }>; required: string[] };
  check('스키마 — 주도 섹터 이름 enum = 섹터 목록', JSON.stringify(sch.properties.leading_sectors.items?.properties.name.enum) === JSON.stringify(BRIEF_SECTORS));
  check('스키마 — 슬롯 dict · key_themes · portfolio_adjustment', ['upcoming_schedule', 'key_themes', 'portfolio_adjustment'].every((k) => sch.required.includes(k)) && !('key_issues' in sch.properties));
  check('필수 키 — 오전 market_regime · 오후 market_summary', REQUIRED_KEYS.morning.includes('market_regime') && REQUIRED_KEYS.afternoon.includes('market_summary'));

  // 금리는 %p · bp, 선물 · 환율은 「기준」, FOMC 는 공식 일정
  const macro = buildPrompt({ edition: 'morning', today: '2026-10-29', assets: { ...assets, GOLD: { current: 2745.3, change: 12.1, change_pct: 0.44, data_date: '2026-10-28' } }, earnings, domestic: [], foreign: [], at: kst('2026-10-29', '16:00') }); // 한국 16:00 = 미국 03:00 — 두 시장 날짜가 같다
  check('금리 — 등락률 대신 %p · bp', macro.includes('  미2년물금리(%): 3.4900 (전일 대비 -0.020%p, -2.0bp) [10/28(수) 기준]'), macro.split('\n').find((l) => l.includes('미2년물')) ?? '');
  check('선물 · 환율은 「기준」 · 지수는 「종가」', macro.includes('[10/28(수) 기준]') && macro.includes('  S&P500: 6,031.8000 (+0.53%) [10/28(수) 종가]'));
  check('FOMC — 60일 안 공식 회의(12/09 점도표) · D+N', macro.includes('[향후 60일 FOMC 회의 (연준 공식 일정)]') && /- 12\/09\(수\) \[D\+41\] FOMC 금리 결정\(회의 12\/08\(화\)~12\/09\(수\) · 경제전망 · 점도표 발표\)/.test(macro) && !macro.includes('10/28(수) [D'));
  const holiday = buildPrompt({ edition: 'afternoon', today: '2026-10-30', assets, earnings, domestic: [], foreign: [], at: kst('2026-10-30', '16:00') });
  check('오후판 — 오늘 국내 값이 없으면 마지막 거래일이라고 밝힘 · VIX 날짜', holiday.includes('위 값은 마지막 거래일 10/29(목) 값입니다') && holiday.includes('[10/28(수) 종가 — 미국 시장 값]'));
  // 장중에 받은 지수는 「종가」 가 아니라 「장중」
  check('장중 — 코스피 14:00 KST 같은 날 = 장중 · 15:30 = 종가 · 지난 날 = 종가', isIntradayBar('KOSPI', '2026-10-29', kst('2026-10-29', '14:00')) && !isIntradayBar('KOSPI', '2026-10-29', kst('2026-10-29', '15:30')) && !isIntradayBar('KOSPI', '2026-10-28', kst('2026-10-29', '14:00')));
  check('장중 — 미국 지수 23:40 KST(10:40 ET) = 장중 · 06:55 KST = 종가 · 금리는 늘 종가', isIntradayBar('SP500', '2026-10-29', kst('2026-10-29', '23:40')) && !isIntradayBar('SP500', '2026-10-28', kst('2026-10-29', '06:55')) && !isIntradayBar('US10Y', '2026-10-29', kst('2026-10-29', '23:40')));
  const live = buildPrompt({ edition: 'afternoon', today: '2026-10-29', assets, earnings, domestic: [], foreign: [], at: kst('2026-10-29', '14:00') });
  check('오후판 13~15:30 프롬프트 — 코스피 [장중]', live.includes('  코스피: 2,650.1000 (+0.38%) [10/29(목) 장중]'));
  // 입력 길이 추정(실제 호출 없음) — 보고용: 실적 100종목 · 국내 80건(30 사용) · 해외 80건(40 사용)
  const big = Array.from({ length: 100 }, (_, i) => earningOf(`S${i}`, `회사${i}`, BRIEF_SECTORS[i % BRIEF_SECTORS.length], i % 60));
  const full13 = Object.fromEntries(['KOSPI', 'KOSDAQ', 'SP500', 'NASDAQ', 'DOW', 'RUSSELL2000', 'GOLD', 'DXY', 'US2Y', 'US10Y', 'USDKRW', 'WTI', 'NATGAS'].map((k) => [k, assets.SP500]));
  const longTitle = (n: number, f: boolean) => news(n, f).map((x) => ({ ...x, title: f ? 'Stocks rally as investors weigh Fed rate path and megacap earnings outlook' : '코스피 외국인 순매수에 반도체 대형주 강세…환율 1,380원대 마감' }));
  const est = buildPrompt({ edition: 'morning', today: '2026-10-29', assets: full13, earnings: big, domestic: longTitle(80, false), foreign: longTitle(80, true) });
  console.log(`INFO  입력 길이 추정(오전판 · 실적 100종목): ${est.length.toLocaleString()}자 — 실적 ${big.length}줄 포함`);
  const est20 = buildPrompt({ edition: 'morning', today: '2026-10-29', assets: full13, earnings: big.slice(0, 20), domestic: longTitle(80, false), foreign: longTitle(80, true) });
  console.log(`INFO  입력 길이 추정(오전판 · 실적 20종목): ${est20.length.toLocaleString()}자`);
}

// B-1 뒤처리 3단계
{
  const item = (date: string, event: string, ticker = '', sector = ''): BriefScheduleItem => ({ date, event, ticker, sector_kr: sector, detail: '', importance: 1 });
  const raw = (us: Partial<BriefAi['upcoming_schedule']>, leading: [string, string][]): Partial<BriefAi> => ({
    market_regime: '혼조', regime_summary: '', portfolio_note: '', key_themes: [], swing_check: { phase: '', catalysts: [], risks: [] },
    leading_sectors: leading.map(([name, stars]) => ({ emoji: '', name, stars, reason: '', stocks_kr: '', stocks_us: '' })),
    upcoming_schedule: { this_week: [], this_month: [], next_2_months: [], ...us },
    portfolio_adjustment: { passive_note: '', swing_candidates: [] },
  });
  // 한국 10-29 14:00 = 미국 10-29 01:00 — 두 시장 날짜가 같은 시각
  const T = Date.parse('2026-10-29T14:00:00+09:00');

  // ① 주도 섹터 거르기 — 비주도 제거 · 빈 섹터 보존 · 국내 종목 보존
  const f = filterByLeadingSectors(normalizeBrief(raw({ this_week: [item('10/30(금)', 'A 실적 발표', 'AAA', '기술'), item('10/30(금)', 'B 실적 발표', 'BBB', '에너지'), item('10/31(토)', 'FOMC'), item('11/02(월)', '삼성 실적 발표', '005930', '에너지'), item('11/02(월)', 'SK 실적 발표', '000660.KS', '에너지')] }, [['기술', '★★★']])));
  check('① 비주도 섹터 실적 제거 · 경제지표 보존 · 국내 종목(6자리 · .KS) 보존', f.upcoming_schedule.this_week.map((i) => i.ticker || i.event).join(',') === 'AAA,FOMC,005930,000660.KS');
  const noLead = filterByLeadingSectors(normalizeBrief(raw({ this_week: [item('10/30(금)', 'x', 'BBB', '에너지')] }, [])));
  check('① 주도 섹터가 비면 거르지 않음', noLead.upcoming_schedule.this_week.length === 1);

  // ② 날수로 다시 배치 — AI 오분류 보정 · 60일 초과 버림 · 못 읽으면 이번 달
  const r = reassignSlotsByDays(normalizeBrief(raw({ this_week: [item('12/10(목)', 'd42'), item('11/05(목)', 'd7')], next_2_months: [item('11/06(금)', 'd8'), item('11/28(토)', 'd30'), item('11/29(일)', 'd31'), item('12/28(월)', 'd60'), item('12/29(화)', 'd61'), item('미정', 'bad')] }, [])), T);
  const names = (xs: BriefScheduleItem[]) => xs.map((i) => i.event).join(',');
  check('② 0~7 / 8~30 / 31~60 · 61 버림 · 못 읽음 → 이번 달', names(r.upcoming_schedule.this_week) === 'd7' && names(r.upcoming_schedule.this_month) === 'd8,d30,bad' && names(r.upcoming_schedule.next_2_months) === 'd42,d31,d60', JSON.stringify(r.upcoming_schedule));
  const dup = reassignSlotsByDays(normalizeBrief(raw({ this_week: [item('11/02(월)', '마이크론 실적 발표', 'MU', '기술')], this_month: [item('11/02(월)', '마이크론 실적', 'mu', '기술')] }, [])), T);
  check('② 같은 일정(날짜 · 티커)을 두 슬롯에 적으면 하나만', dup.upcoming_schedule.this_week.length === 1 && dup.upcoming_schedule.this_month.length === 0);
  check('② 해 경계 — 12/20 기준 01/05 = 16일', daysUntilLabel('01/05(화)', '2026-12-20') === 16 && daysUntilLabel('12/19(토)', '2026-12-20') === 364);

  // ③ 섹터 상한 3/3/2 · 총 6/5/5 · 별점 순 → 날짜 순 · 경제지표는 섹터 상한 밖
  const week = [
    ...['10/30(금)', '10/31(토)', '11/01(일)', '11/02(월)'].map((d, i) => item(d, `기술${i}`, `T${i}`, '기술')),
    item('10/30(금)', '금융0', 'F0', '금융'),
    item('10/29(목)', 'CPI'),
    item('10/29(목)', '에너지0', 'E0', '에너지'),
  ];
  const c = capAndSortBySectorPriority(normalizeBrief(raw({ this_week: week }, [['금융', '★★★'], ['기술', '★★☆']])), T);
  check('③ 이번 주 — 별점 높은 섹터 먼저 · 섹터 3개 상한 · 총 6', names(c.upcoming_schedule.this_week) === '금융0,기술0,기술1,기술2,CPI,에너지0', names(c.upcoming_schedule.this_week));
  const two = capAndSortBySectorPriority(normalizeBrief(raw({ next_2_months: ['12/01(화)', '12/02(수)', '12/03(목)'].map((d, i) => item(d, `n${i}`, `N${i}`, '기술')) }, [['기술', '★★★']])), T);
  check('③ 다음 한 달 — 같은 섹터 2개 상한', names(two.upcoming_schedule.next_2_months) === 'n0,n1');
  const yearEnd = capAndSortBySectorPriority(normalizeBrief(raw({ this_month: [item('01/05(화)', 'jan', 'J', '기술'), item('12/28(월)', 'dec', 'D', '기술')] }, [['기술', '★★★']])), Date.parse('2026-12-20T14:00:00+09:00'));
  check('③ 해 경계 날짜 정렬(12/28 → 01/05)', names(yearEnd.upcoming_schedule.this_month) === 'dec,jan');

  // 순서 — ① 다음 ② 다음 ③: 이번 주로 잘못 넣은 D+40 실적 3개가 ② 로 다음 한 달에 간 뒤 ③ 의 상한 2 를 받는다.
  const order = postprocess(
    raw({ this_week: ['12/08(화)', '12/09(수)', '12/10(목)'].map((d, i) => item(d, `x${i}`, `X${i}`, '기술')).concat([item('11/01(일)', 'oil', 'OIL', '에너지')]) }, [['기술', '★★★']]),
    [earningOf('OIL', '오일', '에너지', 3)],
    T,
  );
  check('순서 ①→②→③ — 비주도 제거 · 다시 배치 뒤 상한 2', names(order.upcoming_schedule.next_2_months) === 'x0,x1' && order.upcoming_schedule.this_week.length === 0);
  const src = fs.readFileSync(path.join(root, 'server/marketBrief/postprocess.ts'), 'utf8');
  const body = src.slice(src.indexOf('export function postprocess'));
  check('순서 — postprocess 안 호출 순서(정렬 ⓪ → ① → ② → ③)', /alignEarningSectors[\s\S]*filterByLeadingSectors[\s\S]*reassignSlotsByDays[\s\S]*capAndSortBySectorPriority/.test(body));
  // ⓪ AI 가 섹터를 바꿔 적어도 입력 섹터로 맞춘다
  const aligned = postprocess(raw({ this_week: [item('10/30(금)', '엔비디아 실적 발표', 'NVDA', '반도체')] }, [['기술', '★★★']]), [earningOf('NVDA', '엔비디아', '기술', 1)], T);
  check('⓪ 실적 섹터를 입력 데이터로 맞춤(반도체 → 기술) → 남음', aligned.upcoming_schedule.this_week[0]?.sector_kr === '기술');
}

// v2.59.3 — 오늘 시황 날수도 종목마다 그 시장 날짜로(한국 10-30 08:00 = 미국 10-29 19:00)
{
  const AM = Date.parse('2026-10-30T08:00:00+09:00');
  const T2 = ['ZZU1', 'ZZU2', 'ZZU3', 'ZZU4', '0ZZ003', '0ZZ004'];
  db.prepare(`DELETE FROM earnings_calendar WHERE symbol IN (${T2.map(() => '?').join(',')})`).run(...T2);
  const put2 = db.prepare(`INSERT INTO earnings_calendar (symbol, earnings_date, fetched_at, is_estimate) VALUES (?, ?, 'x', 0)`);
  put2.run('ZZU1', '2026-10-29'); // 미국 오늘
  put2.run('ZZU2', '2026-10-30'); // 미국 내일
  put2.run('ZZU3', '2026-12-28'); // 미국 D+60
  put2.run('ZZU4', '2026-12-29'); // 미국 D+61
  put2.run('0ZZ003', '2026-10-30'); // 국내 오늘
  put2.run('0ZZ004', '2026-10-29'); // 국내 어제
  const b2 = upcomingEarningBases(AM, T2);
  const dn = Object.fromEntries(b2.map((b) => [b.symbol, b.daysUntil]));
  check('시황 실적 — 미국 「오늘」(10-29) 실적이 한국 아침에 D+0 으로 들어감', dn.ZZU1 === 0, JSON.stringify(dn));
  check('시황 실적 — 미국 내일 D+1 · 국내 오늘 D+0 · 국내 어제 빠짐', dn.ZZU2 === 1 && dn['0ZZ003'] === 0 && !('0ZZ004' in dn));
  check('시황 실적 — 60일 경계(미국 D+60 포함 · D+61 제외)', dn.ZZU3 === 60 && !('ZZU4' in dn));
  check('시황 실적 — AI 입력 줄의 [D+0]', earningsLine(buildEarning(b2.find((b) => b.symbol === 'ZZU1')!, null)).includes('[D+0]'));
  db.prepare(`DELETE FROM earnings_calendar WHERE symbol IN (${T2.map(() => '?').join(',')})`).run(...T2);

  const it = (date: string, event: string, ticker = ''): BriefScheduleItem => ({ date, event, ticker, sector_kr: '', detail: '', importance: 1 });
  const rb = (us: Partial<BriefAi['upcoming_schedule']>): Partial<BriefAi> => ({ portfolio_note: '', key_themes: [], leading_sectors: [], swing_check: { phase: '', catalysts: [], risks: [] }, upcoming_schedule: { this_week: [], this_month: [], next_2_months: [], ...us }, portfolio_adjustment: { passive_note: '', swing_candidates: [] } });
  const slots = reassignSlotsByDays(
    normalizeBrief(rb({ next_2_months: [it('10/29(목)', 'us-today', 'AAPL'), it('10/29(목)', 'FOMC-ish'), it('10/29(목)', 'kr-yday', '005930'), it('11/05(목)', 'us-d7', 'MSFT'), it('11/06(금)', 'us-d8', 'NVDA'), it('11/06(금)', 'kr-d7', '000660')] })),
    AM,
  );
  const nm = (xs: BriefScheduleItem[]) => xs.map((x) => x.event).join(',');
  check('슬롯 — 미국 종목 · 종목 없는 일정은 미국 날짜(10-29 = 오늘 → 이번 주)', nm(slots.upcoming_schedule.this_week).includes('us-today') && nm(slots.upcoming_schedule.this_week).includes('FOMC-ish'), JSON.stringify(slots.upcoming_schedule));
  check('슬롯 — 국내 어제(10-29)는 지난 날(해 넘김 → 60일 밖 버림)', !JSON.stringify(slots.upcoming_schedule).includes('kr-yday'));
  check('슬롯 경계 — 미국 D+7 이번 주 · D+8 이번 달 · 국내 11-06 = D+7 이번 주', nm(slots.upcoming_schedule.this_week).includes('us-d7') && nm(slots.upcoming_schedule.this_month).includes('us-d8') && nm(slots.upcoming_schedule.this_week).includes('kr-d7'));
  const fomcPrompt = buildPrompt({ edition: 'morning', today: '2026-10-29', assets: {}, earnings: [], domestic: [], foreign: [], at: Date.parse('2026-10-29T06:00:00+09:00') });
  check('프롬프트 — FOMC 는 미국 날짜(한국 10-29 06:00 = 미국 10-28 → 10-28 회의 D+0)', /- 10\/28\(수\) \[D\+0\] FOMC/.test(fomcPrompt));
  check('프롬프트 — 「각 종목 시장의 현지 날짜 기준」 한 줄', fomcPrompt.includes('날짜와 D+N 은 각 종목 시장의 현지 날짜 기준'));
  check('프롬프트 — 아침판 미국 D+0 은 「발표 결과 확인」 관점 · 국내 경제 일정은 한국 날짜 · 버전 brief-v3', fomcPrompt.includes('[D+0 · 발표됨] 표시가 붙은 미국 일정') && fomcPrompt.includes('국내 경제 일정') && MARKET_BRIEF_PROMPT_VERSION === 'brief-v3');
  check('일정 시장 판정 — 종목 · .KS · 종목 없는 국내 단서 · 그 밖 미국', scheduleItemMarket({ ticker: 'AAPL' }) === 'US' && scheduleItemMarket({ ticker: '000660.KS' }) === 'KR' && scheduleItemMarket({ ticker: '', event: '한국 10월 수출입' }) === 'KR' && scheduleItemMarket({ ticker: '', event: '금통위 기준금리 결정' }) === 'KR' && scheduleItemMarket({ ticker: '', event: 'FOMC 금리 결정' }) === 'US' && scheduleItemMarket({ ticker: '', event: '미국 CPI' }) === 'US');
  const krEv = reassignSlotsByDays(normalizeBrief(rb({ this_month: [it('11/06(금)', '한국 10월 수출입'), it('11/06(금)', '미국 고용지표')] })), AM);
  check('슬롯 — 종목 없는 국내 일정은 한국 날짜(11-06 = D+7 이번 주) · 미국 지표는 미국 날짜(D+8 이번 달)', nm(krEv.upcoming_schedule.this_week) === '한국 10월 수출입' && nm(krEv.upcoming_schedule.this_month) === '미국 고용지표', JSON.stringify(krEv.upcoming_schedule));
  const capAm = capAndSortBySectorPriority(normalizeBrief(rb({ this_week: [it('11/02(월)', 'kr-11-02', '005930'), it('10/30(금)', 'us-10-30', 'AAPL')] })), AM);
  check('정렬 — 아침 시각에 두 시장 섞여도 날수 순(미국 10-30 = D+1 · 국내 11-02 = D+3)', nm(capAm.upcoming_schedule.this_week) === 'us-10-30,kr-11-02');
}

// v2.59.4 — 미국 장 마감이 지난 미국 D+0 일정은 「발표됨」
{
  const it = (date: string, event: string, ticker = ''): BriefScheduleItem => ({ date, event, ticker, sector_kr: '', detail: '', importance: 1 });
  const rb = (us: Partial<BriefAi['upcoming_schedule']>): Partial<BriefAi> => ({ portfolio_note: '', key_themes: [], leading_sectors: [], swing_check: { phase: '', catalysts: [], risks: [] }, upcoming_schedule: { this_week: [], this_month: [], next_2_months: [], ...us }, portfolio_adjustment: { passive_note: '', swing_candidates: [] } });
  // 토스 달력은 시험 훅 — 기본 null(고정표), 조기 마감 날만 가짜 응답
  setSessionHooksForTest({
    calendar: async (market, day) =>
      market === 'US' && day === '2026-11-28'
        ? ({ result: { previousBusinessDay: { date: '2026-11-27', regularMarket: { startTime: '2026-11-27T23:30:00.000+09:00', endTime: '2026-11-28T03:00:00.000+09:00' } }, today: null, nextBusinessDay: null } } as unknown as Awaited<ReturnType<Parameters<typeof setSessionHooksForTest>[0]['calendar'] & object>>)
        : null,
  });
  const close1029 = await regularSessionEnd('US', '2026-10-29', Date.parse('2026-10-30T07:05:00+09:00'));
  check('마감 시각 — 고정표 10-29 16:00 EDT = 한국 10-30 05:00', close1029 === Date.parse('2026-10-30T05:00:00+09:00'), String(close1029));
  const closeEarly = await regularSessionEnd('US', '2026-11-27', Date.parse('2026-11-28T03:01:00+09:00'));
  check('마감 시각 — 조기 마감(11-27 13:00 EST) 은 토스 달력 값', closeEarly === Date.parse('2026-11-28T03:00:00+09:00'), String(closeEarly));
  check('마감 시각 — 휴장일(추수감사절 11-26) 은 null', (await regularSessionEnd('US', '2026-11-26', Date.parse('2026-11-27T07:00:00+09:00'))) === null);
  setSessionHooksForTest({ calendar: null });

  const items = () => normalizeBrief(rb({ this_week: [it('10/29(목)', '애플 실적 발표', 'AAPL'), it('10/30(금)', '아마존 실적 발표', 'AMZN'), it('10/29(목)', 'FOMC 금리 결정'), it('10/30(금)', '삼성전자 실적 발표', '005930'), it('10/29(목)', '한국 수출입')] }));
  const AM = Date.parse('2026-10-30T07:05:00+09:00'); // 미국 10-29 18:05 EDT
  const r1 = markReleased(items(), AM, close1029);
  const rel = (b: BriefAi) => b.upcoming_schedule.this_week.filter((x) => x.released).map((x) => x.event).join(',');
  check('발표됨 — 한국 07:05 · 미국 D+0 실적 · FOMC D+0 → 발표됨 · 미국 D+1 아님 · 국내(D+0 · 경제 일정) 아님', rel(r1) === '애플 실적 발표,FOMC 금리 결정', rel(r1));
  check('발표됨 — 마감 시각(한국 시각 툴팁용) 저장', r1.upcoming_schedule.this_week[0].usCloseAt === '2026-10-29T20:00:00.000Z');
  const c15 = Date.parse('2026-10-29T15:59:00-04:00');
  check('발표됨 — 15:59 ET 아님 · 16:00 ET 발표됨', rel(markReleased(items(), c15, close1029)) === '' && rel(markReleased(items(), Date.parse('2026-10-29T16:00:00-04:00'), close1029)) === '애플 실적 발표,FOMC 금리 결정');
  const early = normalizeBrief(rb({ this_week: [it('11/27(금)', '블프 실적', 'WMT')] }));
  check('발표됨 — 조기 마감일 13:01 ET → 발표됨', rel(markReleased(early, Date.parse('2026-11-27T13:01:00-05:00'), closeEarly)) === '블프 실적');
  // 검토 반영 — 대상 좁히기 · 추정 실적 제외 · 실적은 입력 실적일로
  const mixed = normalizeBrief(rb({ this_week: [it('10/29(목)', '미국 중간선거'), it('10/29(목)', '파월 의장 연설'), it('10/29(목)', '미국 9월 PCE'), it('10/29(목)', '메타 실적 발표', 'META'), it('10/30(금)', '아마존 실적 발표', 'AMZN')] }));
  const est = { ...earningOf('META', '메타', '기술', 0), date: '2026-10-29', isEstimateDate: true };
  const amzn = { ...earningOf('AMZN', '아마존', '기술', 0), date: '2026-10-29' }; // AI 는 10/30 으로 잘못 적었지만 입력 실적일은 10-29
  check('발표됨 대상 — 선거 · 연설 아님 · 미국 지표(PCE) 발표됨 · 추정 실적(메타) 아님 · 입력 실적일 D+0(아마존) 발표됨', rel(markReleased(mixed, AM, close1029, [est, amzn])) === '미국 9월 PCE,아마존 실적 발표', rel(markReleased(mixed, AM, close1029, [est, amzn])));
  const promptEst = buildPrompt({ edition: 'morning', today: '2026-10-30', assets: {}, earnings: [{ ...earningOf('META', '메타', '기술', 0), isEstimateDate: true }], domestic: [], foreign: [], at: AM, usReleased: true });
  check('프롬프트 — 추정 실적에는 「발표됨」 없음 · 결과 수치는 입력 뉴스에 있을 때만', promptEst.includes('[D+0] [기술] 메타(META)') && promptEst.includes('없으면 「결과 확인 필요」'));
  // 서머타임 끝(11-01) 앞뒤 — 10-30(금) 16:00 EDT · 11-02(월) 16:00 EST
  const cFri = await regularSessionEnd('US', '2026-10-30', Date.parse('2026-10-31T06:00:00+09:00'));
  const cMon = await regularSessionEnd('US', '2026-11-02', Date.parse('2026-11-03T07:00:00+09:00'));
  check('서머타임 끝 앞뒤 — 마감 = 한국 05:00(EDT) · 06:00(EST)', cFri === Date.parse('2026-10-31T05:00:00+09:00') && cMon === Date.parse('2026-11-03T06:00:00+09:00'));
  const mon = normalizeBrief(rb({ this_week: [it('11/02(월)', 'x', 'MSFT')] }));
  check('서머타임 뒤 — 한국 05:30(= 15:30 EST) 아님 · 06:00 발표됨', rel(markReleased(mon, Date.parse('2026-11-03T05:30:00+09:00'), cMon)) === '' && rel(markReleased(mon, Date.parse('2026-11-03T06:00:00+09:00'), cMon)) === 'x');
  // 슬롯 · 개수 그대로 · 저장 뒤 그대로 · 프롬프트 표시
  const pp = postprocess(rb({ this_week: [it('10/29(목)', '애플 실적 발표', 'AAPL'), it('10/30(금)', '아마존 실적 발표', 'AMZN')] }), [], AM, close1029);
  check('뒤처리 — 발표됨이어도 이번 주에 남음 · 개수 그대로', pp.upcoming_schedule.this_week.length === 2 && pp.upcoming_schedule.this_week[0].released === true);
  const usEarn = earningOf('AAPL', '애플', '기술', 0);
  const promptRel = buildPrompt({ edition: 'morning', today: '2026-10-30', assets: {}, earnings: [usEarn, earningOf('005930', '삼성전자', '기술', 0)], domestic: [], foreign: [], at: AM, usReleased: true });
  check('프롬프트 — 미국 D+0 실적 [D+0 · 발표됨] · 국내 D+0 은 그대로', promptRel.includes('[D+0 · 발표됨] [기술] 애플(AAPL)') && promptRel.includes('[D+0] [기술] 삼성전자(005930)'));
  check('프롬프트 — 「발표 결과 확인」 규칙이 [D+0 · 발표됨] 표시에 맞춤', promptRel.includes('[D+0 · 발표됨] 표시가 붙은 미국 일정'));
}

// B-2~4 만들기 · 저장 · 자동 · 버튼 — 가짜 수집 · 가짜 Gemini
db.prepare(`DELETE FROM market_briefs`).run();
db.prepare(`DELETE FROM app_settings WHERE key = 'marketBrief.lastAutoDate'`).run();

const okBrief = (edition: 'morning' | 'afternoon'): Partial<BriefAi> => ({
  ...(edition === 'morning' ? { market_regime: 'Risk-On' as const, regime_summary: '요약' } : { market_summary: '마감', vix_comment: 'VIX' }),
  portfolio_note: '현 비중 유지',
  key_themes: [{ icon: '🟢', category: '실적사이클', title: 'AI 투자', why_important: '이유', duration: '1~2개월', swing_point: '반도체' }],
  leading_sectors: [{ emoji: '💻', name: '기술', stars: '★★★', reason: '기준 A', stocks_kr: '삼성전자', stocks_us: '엔비디아' }],
  swing_check: { phase: '반등', catalysts: ['11/05 FOMC'], risks: ['금리'] },
  upcoming_schedule: { this_week: [{ date: '10/30(금)', event: '인텔 실적 발표', ticker: 'INTC', sector_kr: '기술', detail: 'd', importance: 3 }], this_month: [], next_2_months: [] },
  portfolio_adjustment: { passive_note: '현 비중 유지', swing_candidates: ['인텔(INTC) — 근거, 조건', ''] },
});

let clock = kst('2026-10-29', '07:05'); // 목요일
const geminiCalls: GeminiCallOptions[] = [];
let geminiPlan: ('ok' | '500' | '429' | 'missing')[] = [];
let geminiReason: string | null = null;
const deps: BriefDeps = {
  collect: {
    market: async (edition) => ({ assets: edition === 'morning' ? { SP500: assets.SP500, US2Y: assets.US2Y } : { KOSPI: assets.KOSPI, VIX: assets.VIX }, failed: edition === 'morning' ? ['DXY'] : [] }),
    rss: async () => `<rss><channel><item><title>뉴스</title></item></channel></rss>`,
    earnings: async () => ({ earnings: [earningOf('INTC', '인텔', '기술', 1)], estimatesOk: 1, estimatesTried: 1, error: null }),
  },
  gemini: async (o) => {
    geminiCalls.push(o);
    const step = geminiPlan.shift() ?? 'ok';
    if (step === '500') throw new GeminiError('Gemini 서버 오류 (500)', 500);
    if (step === '429') throw new GeminiError('한도', 429, true);
    const edition = (o.schema as { required: string[] }).required.includes('market_regime') ? 'morning' : 'afternoon';
    const data = step === 'missing' ? { portfolio_note: 'x' } : okBrief(edition);
    return { data, raw: '', model: o.model ?? 'm', tokens: 1234, elapsedMs: 1 };
  },
  geminiReason: () => geminiReason,
  now: () => clock,
  usClose: async () => null,
};
const runButton = async () => {
  const r = startButtonRun(deps);
  return { started: r.started, id: await r.done };
};

{
  resetBriefStateForTest();
  // 정상 — 호출 1번 · 옵션 · 저장 내용
  const a = await runButton();
  const b1 = getBrief(a.id!);
  const o = geminiCalls[0];
  check('정상 — 호출 1번 · retries 0 · 출력 8192 · temperature 0.1', geminiCalls.length === 1 && o.retries === 0 && o.maxOutputTokens === 8192 && o.temperature === 0.1);
  check('모델 — GEMINI_BRIEF_MODEL 이 비면 기본 모델', o.model === (process.env.GEMINI_MODEL ?? 'gemini-3.5-flash-lite'), String(o.model));
  check('저장 — 판 · 까닭 · 날짜 · 모델 · 토큰 · 데이터 기준 날짜', b1?.edition === 'morning' && b1.trigger === 'button' && b1.date === '2026-10-29' && b1.tokens === 1234 && b1.aiCalls === 1 && b1.data.assets.SP500?.data_date === '2026-10-28' && b1.brief?.market_regime === 'Risk-On');
  check('저장 — 수집 상태(시장 · 뉴스 · 실적 · AI)', !!b1 && b1.sources.some((x) => x.group === 'market' && !x.ok && x.detail.includes('달러인덱스')) && b1.sources.some((x) => x.group === 'news') && b1.sources.some((x) => x.group === 'earnings' && x.ok) && b1.sources.some((x) => x.group === 'ai' && x.ok));
  check('저장 — 빈 스윙 후보는 뺌', b1?.brief?.portfolio_adjustment.swing_candidates.length === 1);

  // 실패 1번 → 다시 1번 → 성공
  geminiCalls.length = 0;
  geminiPlan = ['500', 'ok'];
  const b2 = getBrief((await runButton()).id!);
  check('실패 → 1번 다시 → 성공(호출 2번)', geminiCalls.length === 2 && b2?.aiCalls === 2 && !!b2.brief);

  // 두 번 실패 → 데이터만
  geminiCalls.length = 0;
  geminiPlan = ['500', 'missing'];
  const b3 = getBrief((await runButton()).id!);
  check('두 번 실패(오류 · 빠진 키) → 다시 하지 않고 데이터만 저장', geminiCalls.length === 2 && b3?.brief === null && /AI 분석 실패 — 응답에 빠진 키/.test(b3?.aiError ?? '') && !!b3?.data.assets.SP500, b3?.aiError ?? '');

  // 429 → 다시 하지 않음
  geminiCalls.length = 0;
  geminiPlan = ['429'];
  const b4 = getBrief((await runButton()).id!);
  check('429 → 다시 부르지 않음 · 「무료 한도 초과」', geminiCalls.length === 1 && b4?.brief === null && /무료 한도 초과/.test(b4?.aiError ?? '') && b4?.aiCalls === 1);

  // 시장 데이터를 하나도 못 받음 → AI 를 부르지 않는다(지어낸 시황 방지)
  geminiCalls.length = 0;
  const realMarket = deps.collect.market;
  deps.collect.market = async () => {
    throw new Error('지표 엔진 연결 실패');
  };
  const nm = getBrief((await runButton()).id!);
  deps.collect.market = realMarket;
  db.prepare(`DELETE FROM market_briefs WHERE id = ?`).run(nm!.id); // 아래 5번 세기를 위해 이 줄은 지운다
  check('시장 데이터 0개 → AI 안 부름 · 데이터만 · 이유', geminiCalls.length === 0 && nm?.brief === null && /시장 데이터를 받지 못해/.test(nm?.aiError ?? '') && nm?.sources.find((x) => x.group === 'market')?.ok === false);
  check('수집 시각 저장(장중/종가 판단)', !!b1?.data.collectedAt);

  // Gemini 꺼짐 → 부르지 않고 데이터만
  geminiCalls.length = 0;
  geminiReason = '이 서버에서는 Gemini 가 꺼져 있습니다(GEMINI_ENABLED=false)';
  const b5 = getBrief((await runButton()).id!);
  check('Gemini 꺼짐 → 호출 0 · 데이터만 · 이유', geminiCalls.length === 0 && b5?.brief === null && b5?.aiCalls === 0 && /^AI 꺼짐/.test(b5?.aiError ?? '') && b5?.sources.find((x) => x.group === 'ai')?.ok === false);
  geminiReason = null;

  // 버튼 5번 → 6번째 막힘 · 자동은 안 셈
  check('버튼 5번 저장됨', countBriefs('2026-10-29', 'button') === 5);
  let blocked = false;
  try {
    startButtonRun(deps);
  } catch (e) {
    blocked = e instanceof BriefLimitError && /5번을 다 썼습니다/.test((e as Error).message);
  }
  check('6번째 버튼 → 막힘(「오늘 버튼 5번을 다 썼습니다」)', blocked);
  check('사용량 — 오늘 시황 호출 수(1+2+2+1+0)', geminiUsageToday(new Date(clock)).items.find((i) => i.key === 'marketBrief')?.calls === 6);

  // 저장에 실패한 버튼 실행도 횟수에 센다 · 자정을 넘겨 끝나면 시작 날짜 줄로
  {
    clock = kst('2026-11-09', '10:00');
    resetBriefStateForTest();
    const realEarn = deps.collect.earnings;
    deps.collect.earnings = async () => {
      throw new Error('x');
    };
    db.exec(`CREATE TEMP TRIGGER brief_fail BEFORE INSERT ON market_briefs BEGIN SELECT RAISE(ABORT, '디스크 가득'); END;`);
    await runButton();
    db.exec(`DROP TRIGGER brief_fail`);
    deps.collect.earnings = realEarn;
    check('저장 실패 → lastError · 진행 풀림 · 버튼 횟수 1', /디스크 가득/.test(briefStatus(clock).lastError ?? '') && !briefStatus(clock).running && briefStatus(clock).buttonUsed === 1);
    clock = kst('2026-11-09', '23:59');
    const late = startButtonRun({ ...deps, now: () => clock });
    clock = kst('2026-11-10', '00:01');
    const lateId = await late.done;
    check('자정 넘겨 끝남 → 줄 날짜 = 시작 날짜 · 상태의 lastFinishedDate 같음', getBrief(lateId!)?.date === '2026-11-09' && briefStatus(clock).lastFinishedDate === '2026-11-09');
    resetBriefStateForTest();
  }

  // 판 경계
  check('판 — 12:59 오전판 · 13:00 오후판', editionAt(kst('2026-10-30', '12:59')) === 'morning' && editionAt(kst('2026-10-30', '13:00')) === 'afternoon');
  clock = kst('2026-10-30', '13:00');
  const pm = getBrief((await runButton()).id!);
  check('13:00 버튼 → 오후판(국내 지수 · VIX)', pm?.edition === 'afternoon' && !!pm.data.assets.VIX && pm.brief?.market_summary === '마감');

  // 「발표됨」 은 만들 때 저장 — 다시 읽어도 그대로(한국 10-31 07:05 = 미국 10-30 18:05 · 가짜 브리핑의 인텔 실적 10/30)
  clock = kst('2026-10-31', '07:05');
  const usCloseCalls: string[] = [];
  const relRun = startButtonRun({ ...deps, collect: { ...deps.collect, earnings: async () => ({ earnings: [{ ...earningOf('INTC', '인텔', '기술', 0), date: '2026-10-30' }], estimatesOk: 1, estimatesTried: 1, error: null }) }, usClose: async (day) => (usCloseCalls.push(day), Date.parse('2026-10-30T16:00:00-04:00')) });
  const relBrief = getBrief((await relRun.done)!);
  const intc = relBrief?.brief?.upcoming_schedule.this_week.find((x) => x.ticker === 'INTC');
  check('저장 — 「발표됨」 · 마감 시각이 브리핑 JSON 에 남고 다시 읽어도 그대로 · 마감은 미국 날짜(10-30)로 물음', intc?.released === true && intc.usCloseAt === '2026-10-30T20:00:00.000Z' && usCloseCalls.join(',') === '2026-10-30', JSON.stringify(intc));
  check('저장 — 「발표됨」 프롬프트 표시가 Gemini 입력에 들어감', String(geminiCalls.at(-1)?.parts[0]?.text ?? '').includes('[D+0 · 발표됨] [기술] 인텔(INTC)'));

  // 동시에 두 번 → 하나
  clock = kst('2026-10-31', '10:00');
  const before = listBriefsOf('2026-10-31').length;
  const r1 = startButtonRun(deps);
  const r2 = startButtonRun(deps);
  check('진행 중 상태가 보임(단계)', briefStatus(clock).running && briefStatus(clock).stage !== null);
  await r1.done;
  check('동시에 두 번 → 하나만 시작 · 한 줄', r1.started && !r2.started && listBriefsOf('2026-10-31').length === before + 1);
  check('끝나면 진행 상태 풀림 · 마지막 줄 id', !briefStatus(clock).running && briefStatus(clock).lastFinishedId === (await r1.done));
}

// 자동
{
  const ticks: [string, string, boolean][] = [
    ['2026-11-02', '06:54', false], // 월 06:54
    ['2026-11-02', '06:55', true],
    ['2026-11-02', '12:59', true],
    ['2026-11-02', '13:00', false],
    ['2026-10-31', '07:05', false], // 토
    ['2026-11-01', '07:05', false], // 일
  ];
  check('자동 시각 — 평일 06:55 ~ 12:59 · 주말 0', ticks.every(([d, t, want]) => autoDue(kst(d, t), null) === want));
  check('자동 — 같은 날 이미 했으면 0', !autoDue(kst('2026-11-02', '07:05'), '2026-11-02'));

  resetBriefStateForTest();
  db.prepare(`DELETE FROM app_settings WHERE key = 'marketBrief.lastAutoDate'`).run();
  clock = kst('2026-11-02', '06:50');
  const early = await marketBriefTick(deps);
  clock = kst('2026-11-02', '07:00');
  const first = await marketBriefTick(deps);
  clock = kst('2026-11-02', '07:10');
  const second = await marketBriefTick(deps);
  const auto = first ? getBrief(first) : null;
  check('자동 — 06:55 뒤 첫 틱에 1번 · 오전판 · 다음 틱 0', early === null && auto?.trigger === 'auto' && auto.edition === 'morning' && second === null && countBriefs('2026-11-02', 'auto') === 1);
  check('자동은 버튼 횟수에 안 셈', briefStatus(clock).buttonUsed === 0);
  clock = kst('2026-11-03', '13:10'); // 화 — 오전에 서버가 꺼져 있었다
  check('13시 뒤에는 놓친 오전판 보충 0', (await marketBriefTick(deps)) === null && countBriefs('2026-11-03', 'auto') === 0);
  clock = kst('2026-11-04', '11:40'); // 수 — 오전에 꺼졌다가 11:40 에 켬
  check('13시 전에는 보충 1', (await marketBriefTick(deps)) !== null && countBriefs('2026-11-04', 'auto') === 1);
  clock = kst('2026-11-07', '07:05'); // 토
  check('주말 틱 0', (await marketBriefTick(deps)) === null);
  process.env.MARKET_BRIEF_ENABLED = 'false';
  clock = kst('2026-11-05', '07:05');
  check('스위치 끔(MARKET_BRIEF_ENABLED=false) → 0', (await marketBriefTick(deps)) === null && briefStatus(clock).autoDisabledReason !== null);
  delete process.env.MARKET_BRIEF_ENABLED;
  geminiReason = 'Gemini 키가 설정되지 않았습니다';
  const noAi = await marketBriefTick(deps);
  check('Gemini 꺼져도 자동은 데이터만으로 만든다', noAi !== null && getBrief(noAi)?.brief === null);
  geminiReason = null;
}

// 30일 정리 · 같은 날 여러 줄
{
  const old = (date: string) => insertBrief({ date, edition: 'morning', trigger: 'auto', createdAt: `${date}T00:00:00.000Z`, model: null, tokens: null, aiCalls: 0, promptVersion: 't', sources: [], data: { assets: {}, earnings: [] }, brief: null, aiError: 'x' });
  old('2026-09-01');
  old('2026-10-05');
  old('2026-10-06');
  const removed = purgeOldBriefs('2026-11-04');
  const days = listBriefDays().map((d) => d.date);
  check('30일 정리 — 오늘(11-04) 포함 30일: 10-06 남김 · 10-05 이전 지움', removed === 2 && days.includes('2026-10-06') && !days.includes('2026-10-05') && !days.includes('2026-09-01'));
  resetPurgeForTest();
  const list = listBriefsOf('2026-10-29');
  check('같은 날 여러 줄 — 모두 남김 · 최근 것부터', list.length === 5 && list[0].createdAt >= list[4].createdAt && list.every((i, k) => k === 0 || list[k - 1].createdAt >= i.createdAt));
  check('날짜 목록 — 최근 것부터 · 줄 수', days.every((d, k) => k === 0 || days[k - 1] > d) && days.includes('2026-11-05') && listBriefDays().find((d) => d.date === '2026-10-29')?.count === 5);
}

db.prepare(`DELETE FROM market_briefs`).run();
db.prepare(`DELETE FROM app_settings WHERE key = 'marketBrief.lastAutoDate'`).run();

console.log(`\n결과: ${pass}개 통과 / ${fail}개 실패`);
process.exit(fail ? 1 : 0);
