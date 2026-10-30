/**
 * 오늘 시황(탐색 → 오늘 시황) 점검 — `npm run marketbrief:test` · ⚠️ `DB_PATH=<사본>` 으로만 돈다(맨 첫 import).
 * **네트워크 0 · Gemini 0** — 지표 엔진 · RSS · 미국 재무부 · yfinance · Gemini 는 모두 가짜를 끼운다.
 *
 * - A 수집: 지표 엔진 계산(13종 + VIX · 미2년물 재무부 · 실패 항목 빠짐 · 시간 제한 — `marketBriefPyTest.py` 를 부른다) ·
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
import { collectNews, freshNews, parseFeed, DOMESTIC_FALLBACK, DOMESTIC_RSS, FOREIGN_RSS, FOREIGN_SLOT_CANDIDATES, NEWS_MAX_AGE_MS } from '../server/marketBrief/news';
import { collectAll, sectorMoves } from '../server/marketBrief/collect';
import { checkDirections, checkText, DEFENSE_PCT, FLAT_PCT, FLAT_RATE_PP } from '../server/marketBrief/directionCheck';
import { directionOfPct, normalizeOutlook } from '../server/marketBrief/outlook';
import { actualPctOf, chooseCandidates, clearScoresForTest, outlookStats, outlookView, purgeScores, scoreOutlooks, SCORE_KEEP_DAYS, SETTLE_MARGIN_MS, targetDayOf, type DailyCloses, type ScoreDeps } from '../server/marketBrief/outlookScore';
import { getScore, upsertScore } from '../server/marketBrief/store';
import { marketDayTime } from '../server/marketHours';
import { filterSectorStocks, poolText, sectorStockPool, type SectorStockPool } from '../server/marketBrief/sectorStocks';
import { checkSources, sourceTable } from '../server/marketBrief/sourceCheck';
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
import { buildPrompt, SCHEMA, REQUIRED_KEYS, MARKET_BRIEF_PROMPT_VERSION, sectorTrendText, trendText } from '../server/marketBrief/prompt';
import { BRIEF_SECTORS } from '../server/marketBrief/earnings';
import { capAndSortBySectorPriority, daysUntilLabel, filterByLeadingSectors, markReleased, markReleasedEarnings, normalizeBrief, postprocess, reassignSlotsByDays } from '../server/marketBrief/postprocess';
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

// A-1 지표 엔진 계산 — 파이썬 시험(가짜 yfinance · 재무부)
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
  check('오후판 — 해외 뉴스는 받지 않음(4번째 자리 후보도)', !asked.some((u) => [...FOREIGN_RSS, ...FOREIGN_SLOT_CANDIDATES].some((s) => s.url === u)) && asked.length === DOMESTIC_RSS.length);

  // 해외 4번째 자리 — 후보를 차례로(v2.59.6) · Yahoo 는 목록에서 뺐다
  check('해외 — CNBC 3곳 + 4번째 자리 후보(MarketWatch → 연준) · Yahoo 없음', FOREIGN_RSS.length === 3 && FOREIGN_SLOT_CANDIDATES.map((c) => c.source).join(',') === 'MarketWatch,미국 연준 보도자료' && ![...FOREIGN_RSS, ...FOREIGN_SLOT_CANDIDATES].some((c) => /yahoo/i.test(c.url)));
  asked.length = 0;
  const slot1Down = await collectNews(true, async (url) => {
    asked.push(url);
    if (url === FOREIGN_SLOT_CANDIDATES[0].url) throw new Error('HTTP 404');
    return feed(2);
  });
  const slotRow = slot1Down.results.find((r) => r.slot);
  check('후보 1 실패 → 후보 2 사용 · 앞 후보 실패 이유를 남김', slotRow?.ok === true && slotRow.source === '미국 연준 보도자료' && slotRow.error === 'MarketWatch(HTTP 404)' && slot1Down.foreign.length === 8 && asked.includes(FOREIGN_SLOT_CANDIDATES[1].url), JSON.stringify(slotRow));
  asked.length = 0;
  const slotFirst = await collectNews(true, async (url) => (asked.push(url), feed(2)));
  check('후보 1 성공 → 후보 2 는 부르지 않음', slotFirst.results.find((r) => r.slot)?.source === 'MarketWatch' && !asked.includes(FOREIGN_SLOT_CANDIDATES[1].url));
  const slotAll = await collectNews(true, async (url) => (FOREIGN_SLOT_CANDIDATES.some((c) => c.url === url) ? Promise.reject(new Error('시간 초과')) : feed(2)));
  const allRow = slotAll.results.find((r) => r.slot);
  check('후보 모두 실패 → 「대체 소스」 실패 한 줄 · 후보마다 짧은 한국어 이유', allRow?.ok === false && allRow.source === '대체 소스' && allRow.error === '후보 모두 실패 — MarketWatch(시간 초과) · 미국 연준 보도자료(시간 초과)', JSON.stringify(allRow));

  // 수집 상태 — 실제로 받은 후보 이름(뉴스 · 미2년물)
  const SP = { current: 6031.8, change: 31.8, change_pct: 0.53, data_date: '2026-10-28' };
  const US2 = { current: 4.61, change: -0.06, change_pct: -1.28, data_date: '2026-10-29' };
  const col = await collectAll('morning', Date.parse('2026-10-29T07:05:00+09:00'), {
    market: async () => ({
      assets: { SP500: SP, US2Y: US2 },
      failed: ['DXY'],
      sources: { US2Y: { used: '미국 재무부', tried: [{ source: '미국 재무부', ok: true, error: null }] } },
    }),
    rss: async (url) => (url === FOREIGN_SLOT_CANDIDATES[0].url ? Promise.reject(new Error('HTTP 404')) : feed(2)),
    earnings: async () => ({ earnings: [], estimatesOk: 0, estimatesTried: 0, error: null }),
    sectorStocks: () => ({}),
    sectorTrend: async () => ({ kr: null, us: null }),
  });
  const us2yRow = col.sources.find((x) => x.label === '시장 데이터 · 미2년물금리(%)');
  check('수집 상태 — 미2년물 「받음 · 미국 재무부」', us2yRow?.ok === true && us2yRow.detail === '미국 재무부', JSON.stringify(us2yRow));
  const mainRow = col.sources.find((x) => x.label === '시장 데이터');
  check('수집 상태 — 시장 데이터 줄은 미2년물을 따로 세지 않음(못 받음: 달러인덱스만)', mainRow?.detail === '2개 받음 · 못 받음: 달러인덱스' && !mainRow.ok, mainRow?.detail);
  check('수집 상태 — 해외 뉴스 대체 소스에 쓴 후보 이름', col.sources.some((x) => x.label === '해외 뉴스 · 미국 연준 보도자료(대체 소스)' && x.ok && x.detail === '2건 · 다른 후보: MarketWatch(HTTP 404)'), JSON.stringify(col.sources.filter((x) => x.label.includes('대체'))));
  const colNone = await collectAll('morning', Date.parse('2026-10-29T07:05:00+09:00'), {
    market: async () => ({ assets: { SP500: SP }, failed: ['US2Y'], sources: { US2Y: { used: null, tried: [{ source: '미국 재무부', ok: false, error: 'HTTPSConnectionPool(host=home.treasury.gov): Read timed out. (read timeout=15)' }] } } }),
    rss: async () => feed(2),
    earnings: async () => ({ earnings: [], estimatesOk: 0, estimatesTried: 0, error: null }),
    sectorStocks: () => ({}),
    sectorTrend: async () => ({ kr: null, us: null }),
  });
  const noneRow = colNone.sources.find((x) => x.label === '시장 데이터 · 미2년물금리(%)');
  check('수집 상태 — 재무부 실패 → 「받지 못함」 · 짧은 한국어 이유', noneRow?.ok === false && noneRow.detail === '받지 못함 — 미국 재무부 실패(시간 초과)' && colNone.sources.find((x) => x.label === '시장 데이터')?.ok === true, JSON.stringify(noneRow));

  // 점검 명령(`marketbrief:sources`) — 모든 후보 각 1번 · 표 모양(가짜 응답 · 네트워크 0)
  const opened: string[] = [];
  let t = 0;
  const rows = await checkSources({
    rss: async (url) => {
      opened.push(url);
      if (url === FOREIGN_SLOT_CANDIDATES[0].url) return { status: 404, text: 'not found' };
      if (url === DOMESTIC_RSS[0].url) throw new Error('fetch failed');
      return { status: 200, text: feed(3) };
    },
    us2y: async () => [
      { source: '미국 재무부', status: 200, ms: 640, value: { current: 4.61, data_date: '2026-10-29' }, error: null },
    ],
    now: () => (t += 250),
  });
  const allUrls = [...DOMESTIC_RSS, DOMESTIC_FALLBACK, ...FOREIGN_RSS, ...FOREIGN_SLOT_CANDIDATES].map((x) => x.url);
  check('점검 — 뉴스 소스 · 후보 · 폴백을 각 1번(후보 1 실패여도 후보 2 까지 · 성공해도 모두)', opened.length === allUrls.length && allUrls.every((u) => opened.filter((o) => o === u).length === 1), `${opened.length}/${allUrls.length}`);
  const table = sourceTable(rows);
  check(
    '점검 — 표 모양(묶음 | 후보 | HTTP | 걸린 시간 | 받은 건수/값) · 실패 표시 · 합계',
    table.startsWith('| 묶음 | 후보 | HTTP | 걸린 시간 | 받은 건수/값 |') &&
      /\| 해외 대체 소스 후보 \| MarketWatch \| 404 \| \d+\.\d초 \| 실패 · HTTP 404 \|/.test(table) &&
      /\| 국내 뉴스 \| 연합뉴스 \| — \| \d+\.\d초 \| 실패 · fetch failed \|/.test(table) &&
      /\| 해외 대체 소스 후보 \| 미국 연준 보도자료 \| 200 \| \d+\.\d초 \| 3건 · 72시간 안 3건 \|/.test(table) &&
      table.includes('| 미2년물 금리 | 미국 재무부 | 200 | 0.6초 | 4.61%(2026-10-29) |') &&
      !/FRED/.test(table) &&
      table.endsWith(`${rows.length}곳 중 ${rows.length - 2}곳 받음 · 2곳 실패`),
    table,
  );
}

// A-2b 72시간 넘은 뉴스 거르기(v2.59.7) — 브리핑 만드는 시각 기준
{
  const NOW = Date.parse('2026-11-02T07:05:00+09:00'); // 월요일 아침판
  const ago = (ms: number) => new Date(NOW - ms).toISOString();
  const H = 3_600_000;
  const item = (publishedAt: string | null) => ({ title: 't', source: 's', link: '', publishedAt, foreign: false });
  check('나이 한도 = 72시간', NEWS_MAX_AGE_MS === 72 * H);
  const f = freshNews([item(ago(72 * H - 60_000)), item(ago(72 * H + 60_000)), item(null), item(ago(H))], NOW);
  check('71시간 59분 → 남음 · 72시간 1분 → 뺌 · 발행 시각 없음 → 남음(센다)', f.kept.length === 3 && f.stale === 1 && f.noDate === 1 && f.kept[0].publishedAt === ago(72 * H - 60_000), JSON.stringify({ kept: f.kept.length, stale: f.stale, noDate: f.noDate }));
  check('정확히 72시간 → 남음(넘은 것만 뺀다)', freshNews([item(ago(72 * H))], NOW).kept.length === 1);
  check('월요일 07:05 아침판 — 금요일 미국 장 뉴스(미국 금 15:00 ET = 한국 토 05:00)는 남음', freshNews([item('2026-10-30T19:00:00.000Z')], NOW).kept.length === 1);

  // 피드 — 발행 시각이 있는 RSS
  const dated = (dates: string[]) => `<rss><channel>${dates.map((d, i) => `<item><title>글 ${i}</title><pubDate>${new Date(d).toUTCString()}</pubDate></item>`).join('')}</channel></rss>`;
  const fresh2 = [ago(2 * H), ago(5 * H)];
  const old3 = ['2026-10-21T09:00:00.000Z', '2026-10-20T09:00:00.000Z', '2026-10-19T09:00:00.000Z'];
  const asked2: string[] = [];
  const news1 = await collectNews(
    true,
    async (url) => {
      asked2.push(url);
      if (url === FOREIGN_RSS[2].url) return dated(old3); // CNBC Finance — 9일 묵음(오라클 실제)
      if (url === FOREIGN_SLOT_CANDIDATES[0].url) return dated(old3); // MarketWatch 도 묵으면 다음 후보(연준)
      return dated([...fresh2, old3[0]]);
    },
    NOW,
  );
  const cnbcF = news1.results.find((r) => r.source === 'CNBC Finance');
  check('소스가 모두 72시간 넘음 → 실패가 아님(받음 · 0건 · 최신 날짜)', cnbcF?.ok === true && cnbcF.count === 0 && cnbcF.stale === 3 && cnbcF.newest === '2026-10-21T09:00:00.000Z', JSON.stringify(cnbcF));
  check('남긴 글만 AI 입력으로(국내 4곳 × 2 · 해외 2곳 × 2 + 대체 2)', news1.domestic.length === 8 && news1.foreign.length === 6, `${news1.domestic.length} · ${news1.foreign.length}`);
  const slot = news1.results.find((r) => r.slot);
  check('대체 소스 — 첫 후보가 모두 72시간 넘으면 다음 후보', slot?.source === '미국 연준 보도자료' && slot.error === 'MarketWatch(모두 72시간 넘음)', JSON.stringify(slot));
  check('국내에 72시간 안 글이 있으면 폴백을 부르지 않음', !asked2.includes(DOMESTIC_FALLBACK.url));

  // 폴백 — 국내 4곳이 받았어도 모두 72시간 넘으면(거르기 뒤 0건) 폴백을 부른다
  const asked3: string[] = [];
  const news2 = await collectNews(false, async (url) => (asked3.push(url), url === DOMESTIC_FALLBACK.url ? dated(fresh2) : dated(old3)), NOW);
  check('국내 거르기 뒤 0건 → 폴백(SBS) 부름 · 폴백 글도 거른 뒤', asked3.includes(DOMESTIC_FALLBACK.url) && news2.domestic.length === 2 && news2.results.some((r) => r.fallback && r.ok && r.count === 2));

  // 수집 상태 문구
  const col2 = await collectAll('morning', NOW, {
    market: async () => ({ assets: {}, failed: [] }),
    rss: async (url) => (url === FOREIGN_RSS[2].url ? dated(old3) : url === DOMESTIC_RSS[0].url ? `<rss><channel><item><title>시각 없음</title></item>${dated(fresh2).slice(14, -16)}</channel></rss>` : dated([...fresh2, old3[0]])),
    earnings: async () => ({ earnings: [], estimatesOk: 0, estimatesTried: 0, error: null }),
    sectorStocks: () => ({}),
    sectorTrend: async () => ({ kr: null, us: null }),
  });
  const row = (label: string) => col2.sources.find((x) => x.label === label);
  check('수집 상태 — 묵은 소스 「받음 · 0건(모두 72시간 넘음 — 최신 10-21)」', row('해외 뉴스 · CNBC Finance')?.ok === true && row('해외 뉴스 · CNBC Finance')?.detail === '0건(모두 72시간 넘음 — 최신 10-21)', JSON.stringify(row('해외 뉴스 · CNBC Finance')));
  check('수집 상태 — 일부 뺀 소스 「2건(72시간 넘은 1건 뺌)」', row('국내 뉴스 · 매일경제')?.detail === '2건(72시간 넘은 1건 뺌)', JSON.stringify(row('국내 뉴스 · 매일경제')));
  const sum = row('뉴스 72시간 거르기');
  // 국내: 연합 3(시각 없음 1 + 새 글 2) · 나머지 3곳 × 3 / 해외: CNBC 2곳 × 3 + Finance 3 / 대체: MarketWatch 3 → 3+9+6+3+3 = 24 · 뺀 것: 3 + 2 + 3 + 1 = 9
  // 대체 소스 — 첫 후보가 모두 묵어 건너뛰어도 그 수를 합계에 넣는다 · 후보가 모두 묵으면 실패가 아니라 「0건(모두 72시간 넘음 — 최신)」
  const mwStale = await collectAll('morning', NOW, {
    market: async () => ({ assets: {}, failed: [] }),
    rss: async (url) => (url === FOREIGN_SLOT_CANDIDATES[0].url ? dated(old3) : dated(fresh2)),
    earnings: async () => ({ earnings: [], estimatesOk: 0, estimatesTried: 0, error: null }),
    sectorStocks: () => ({}),
    sectorTrend: async () => ({ kr: null, us: null }),
  });
  // 받은 글: 국내 4 × 2 + 해외 3 × 2 + 연준 2 + 건너뛴 MarketWatch 3 = 19 · 뺀 것 = MarketWatch 3
  check('대체 소스 — 건너뛴(모두 묵은) 후보의 수도 합계에', mwStale.sources.find((x) => x.label === '뉴스 72시간 거르기')?.detail === '뉴스 19건 중 3건 뺌(72시간 넘음)', JSON.stringify(mwStale.sources.find((x) => x.label === '뉴스 72시간 거르기')));
  const allStale = await collectAll('morning', NOW, {
    market: async () => ({ assets: {}, failed: [] }),
    rss: async (url) => (url === FOREIGN_SLOT_CANDIDATES[0].url ? dated(old3) : url === FOREIGN_SLOT_CANDIDATES[1].url ? dated(['2026-10-25T09:00:00.000Z']) : dated(fresh2)),
    earnings: async () => ({ earnings: [], estimatesOk: 0, estimatesTried: 0, error: null }),
    sectorStocks: () => ({}),
    sectorTrend: async () => ({ kr: null, us: null }),
  });
  const slotAllStale = allStale.sources.find((x) => x.label.includes('(대체 소스)'));
  check('대체 소스 — 후보가 모두 묵음 → 실패가 아니라 가장 최근 후보 「받음 · 0건(모두 72시간 넘음 — 최신 10-25)」', slotAllStale?.ok === true && slotAllStale.label === '해외 뉴스 · 미국 연준 보도자료(대체 소스)' && slotAllStale.detail.startsWith('0건(모두 72시간 넘음 — 최신 10-25)'), JSON.stringify(slotAllStale));
  check('대체 소스 — 모두 묵음일 때도 합계는 두 후보 다(4 × 2 + 3 × 2 + 3 + 1 = 18 · 뺀 것 4)', allStale.sources.find((x) => x.label === '뉴스 72시간 거르기')?.detail === '뉴스 18건 중 4건 뺌(72시간 넘음)', JSON.stringify(allStale.sources.find((x) => x.label === '뉴스 72시간 거르기')));
  check('수집 상태 한 줄 — 「뉴스 N건 중 M건 뺌(72시간 넘음)」 · 시각 모르는 글은 남김', sum?.ok === true && sum.detail === '뉴스 24건 중 9건 뺌(72시간 넘음) · 발행 시각 모르는 1건은 남김', JSON.stringify(sum));
}

// A-2c 최근 흐름 입력(v2.60.0) — 지수 5 · 20일 · 선물 · 섹터 1주(종목 지도 읽기만)
{
  const at = Date.parse('2026-10-30T07:05:00+09:00');
  const k = { current: 2500, change: -50, change_pct: -1.96, data_date: '2026-10-29', trend: { d5: -3.2, d20: 1.1 } };
  check('흐름 글 — 「 · 최근 흐름 5일 −3.20% · 20일 +1.10%」(프롬프트는 하이픈 음수 그대로)', trendText('KOSPI', k, at) === ' · 최근 흐름 5일 -3.20% · 20일 +1.10%', trendText('KOSPI', k, at));
  check('흐름 글 — 20일 봉 모자람(null) → 5일만 · 흐름 없음 → 빈 글', trendText('KOSPI', { ...k, trend: { d5: 2, d20: null } }, at) === ' · 최근 흐름 5일 +2.00%' && trendText('KOSPI', { ...k, trend: undefined }, at) === '');
  check('흐름 글 — 장중 값이면 「(장중 값 기준)」', trendText('KOSPI', { ...k, data_date: '2026-10-30' }, Date.parse('2026-10-30T14:00:00+09:00')).endsWith('(장중 값 기준)'));
  const fut = { ES: { current: 7683.25, change: -71, change_pct: -0.92, data_date: '2026-10-30' }, NQ: { current: 28980.75, change: -581.25, change_pct: -1.97, data_date: '2026-10-30' } };
  const am = buildPrompt({ edition: 'morning', today: '2026-10-30', assets: { ...fut, KOSPI: k, SP500: { current: 6800, change: 20, change_pct: 0.3, data_date: '2026-10-29', trend: { d5: 1.5, d20: 4.2 } } }, earnings: [], domestic: [], foreign: [], at, sectorTrend: { kr: { up: [{ sector: '기술', pct: 4.2 }], down: [{ sector: '에너지', pct: -2.1 }] }, us: null } });
  check('오전판 프롬프트 — 선물(직전 세션 종가 대비 · 받은 시각) · 국내 지수 · 흐름 · 섹터 1주(못 받은 시장 표시)',
    am.includes('[미국 지수 선물 (밤사이)]') && am.includes('  S&P500 선물: 7,683.2500 (직전 세션 종가 대비 -0.92%)') && am.includes('받은 시각 한국 07:05') &&
      am.includes('[국내 지수 (전 거래일 종가)]') && am.includes('  코스피: 2,500.0000 (-1.96%) [10/29(목) 종가] · 최근 흐름 5일 -3.20% · 20일 +1.10%') &&
      am.includes('- 국내 강세: 기술 +4.20%') && am.includes('- 국내 약세: 에너지 -2.10%') && am.includes('- 미국: 받지 못함'), am.split('\n').filter((l) => /선물|코스피|강세|약세|미국:/.test(l)).join(' / '));
  const pm = buildPrompt({ edition: 'afternoon', today: '2026-10-30', assets: { ...fut, KOSPI: k, SP500: { current: 6800, change: 20, change_pct: 0.3, data_date: '2026-10-29' } }, earnings: [], domestic: [], foreign: [], at: Date.parse('2026-10-30T16:00:00+09:00'), sectorTrend: undefined });
  check('오후판 프롬프트 — 미국 지수(마지막 정규장 종가) · 선물 · 섹터 1주 없으면 「받지 못함」', pm.includes('[미국 지수 (마지막 정규장 종가)]') && pm.includes('  S&P500: 6,800.0000 (+0.30%)') && pm.includes('[미국 지수 선물 (밤사이)]') && pm.includes('(받지 못함)'));
  check('섹터 1주 글 — 둘 다', sectorTrendText({ kr: { up: [], down: [] }, us: { up: [{ sector: '기술', pct: 1 }], down: [] } }) === '- 국내 강세: 없음\n- 국내 약세: 없음\n- 미국 강세: 기술 +1.00%\n- 미국 약세: 없음');
  // 섹터 1주 — 종목 지도 응답을 읽기만(바꾸지 않음) · 「기타」 뺌 · 위 3 · 아래 3 · 겹치지 않음
  const sectors = [
    { sector: '기술', capReturn: 4.2, counted: 20 }, { sector: '금융', capReturn: 1.0, counted: 10 }, { sector: '기타', capReturn: 9.9, counted: 3 },
    { sector: '에너지', capReturn: -2.1, counted: 5 }, { sector: '헬스케어', capReturn: 0.5, counted: 8 }, { sector: '산업재', capReturn: -0.4, counted: 6 },
    { sector: '유틸리티', capReturn: -1.0, counted: 0 },
  ];
  const before = JSON.stringify(sectors);
  const mv = sectorMoves(sectors);
  check('섹터 1주 — 강세 위 3 · 약세 아래 3(낮은 것부터) · 「기타」 · 셀 수 0 뺌', JSON.stringify(mv) === JSON.stringify({ up: [{ sector: '기술', pct: 4.2 }, { sector: '금융', pct: 1 }, { sector: '헬스케어', pct: 0.5 }], down: [{ sector: '에너지', pct: -2.1 }, { sector: '산업재', pct: -0.4 }] }), JSON.stringify(mv));
  check('섹터 1주 — 종목 지도 응답을 바꾸지 않음(읽기만)', JSON.stringify(sectors) === before);
  // 받기 실패 → 그 시장은 빼고 · 수집 상태 줄
  const colT = await collectAll('morning', at, {
    market: async () => ({ assets: {}, failed: [] }),
    rss: async () => '<rss><channel></channel></rss>',
    earnings: async () => ({ earnings: [], estimatesOk: 0, estimatesTried: 0, error: null }),
    sectorStocks: () => ({}),
    sectorTrend: async () => ({ kr: { up: [], down: [] }, us: null }),
  });
  const tRow = colT.sources.find((x) => x.label === '섹터 1주 흐름(종목 지도)');
  check('섹터 1주 — 미국 받기 실패 → 「못 받음: 미국(그 시장은 빼고 분석)」', tRow?.ok === false && tRow.detail === '못 받음: 미국(그 시장은 빼고 분석)' && colT.sectorTrend.us === null, JSON.stringify(tRow));
  const colT2 = await collectAll('morning', at, {
    market: async () => ({ assets: {}, failed: [] }),
    rss: async () => '<rss><channel></channel></rss>',
    earnings: async () => ({ earnings: [], estimatesOk: 0, estimatesTried: 0, error: null }),
    sectorStocks: () => ({}),
    sectorTrend: async () => {
      throw new Error('boom');
    },
  });
  check('섹터 1주 — 읽기 자체가 던져도 수집은 계속(둘 다 null)', colT2.sectorTrend.kr === null && colT2.sectorTrend.us === null && colT2.sources.some((x) => x.label === '섹터 1주 흐름(종목 지도)' && !x.ok));
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
  check('오후판 13~15:30 프롬프트 — 코스피 [장중(마감 전) — 14:00 기준](받은 시각을 밝힘)', live.includes('  코스피: 2,650.1000 (+0.38%) [10/29(목) 장중(마감 전) — 14:00 기준]'), live.split('\n').find((l) => l.includes('코스피:')) ?? '');
  const usLive = buildPrompt({ edition: 'morning', today: '2026-10-30', assets: { SP500: { ...assets.SP500, data_date: '2026-10-29' } }, earnings, domestic: [], foreign: [], at: kst('2026-10-29', '23:40') });
  check('미국 지수 장중 — 「한국 HH:MM 기준」', usLive.includes('[10/29(목) 장중(마감 전) — 한국 23:40 기준]'));
  check('프롬프트(brief-v4) — 숫자와 반대인 방향 표현 금지 · 장중 기준 · 숫자 우선', live.includes('등락 방향과 반대인 표현 금지') && live.includes("'장중 기준'") && live.includes('뉴스 제목의 분위기보다 위 숫자를 우선') && MARKET_BRIEF_PROMPT_VERSION === 'brief-v5');
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
  check('프롬프트 — 아침판 미국 D+0 은 「발표 결과 확인」 관점 · 국내 경제 일정은 한국 날짜', fomcPrompt.includes('[D+0 · 발표됨] 표시가 붙은 미국 일정') && fomcPrompt.includes('국내 경제 일정'));
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
    sectorStocks: () => ({}),
    sectorTrend: async () => ({ kr: null, us: null }),
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
  score: { start: async () => null, end: async () => null, closes: async () => ({}) },
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

// ═════════════════════════ C. 정확성(v2.59.6) — 문장 ↔ 숫자 · 대표 종목 · AI 없는 「발표됨」 ═════════════════════════

// C-1 문장 ↔ 숫자 방향 검사
{
  const at = kst('2026-10-30', '14:20'); // 장중
  const crash = {
    KOSPI: { current: 2500.1, change: -146.3, change_pct: -5.53, data_date: '2026-10-30' },
    KOSDAQ: { current: 800.2, change: -39.8, change_pct: -4.74, data_date: '2026-10-30' },
    VIX: { current: 24.1, change: 2.1, change_pct: 9.5, data_date: '2026-10-29' },
  };
  const pm = { edition: 'afternoon' as const, assets: crash, at };
  const real = checkText('market_summary', '국내 증시는 양호한 실적 기대감과 경제지표 호조로 방어력을 보이고 있습니다.', pm);
  check('실제 화면 문장 「국내 증시 … 방어력」 + 코스피 −5.53% · 코스닥 −4.74%(장중) → 어긋남 1건', real.length === 1 && real[0].said === '방어' && real[0].market === '국내 증시' && real[0].actual === '코스피 −5.53%(장중) · 코스닥 −4.74%(장중)', JSON.stringify(real));
  check('「방어」 + 코스피 −5.53% → 어긋남', checkText('f', '코스피는 방어에 성공했다', pm).length === 1);
  check('「하락」 + −5.53% → 아님', checkText('f', '코스피가 5% 넘게 하락했다', pm).length === 0);
  check('「상승」 + −5.53% → 어긋남 · 장중 표시', checkText('f', '코스피는 반도체 강세로 상승했다', pm)[0]?.actual === '코스피 −5.53%(장중)');
  const flat = { ...pm, assets: { KOSPI: { ...crash.KOSPI, change_pct: 0.2 } } };
  check(`보합(|등락| < ${FLAT_PCT}%) — 0.2% 에 「하락」 → 검사 안 함`, checkText('f', '코스피는 하락 마감했다', flat).length === 0);
  check('보합 경계 — −0.3% 에 「상승」 → 어긋남 · −0.29% → 검사 안 함', checkText('f', '코스피 상승', { ...pm, assets: { KOSPI: { ...crash.KOSPI, change_pct: -0.3 } } }).length === 1 && checkText('f', '코스피 상승', { ...pm, assets: { KOSPI: { ...crash.KOSPI, change_pct: -0.29 } } }).length === 0);
  check(`「방어」 는 ${DEFENSE_PCT}% 보다 나쁠 때만 — −0.8% → 아님 · −1.2% → 어긋남`, checkText('f', '코스피는 선방했다', { ...pm, assets: { KOSPI: { ...crash.KOSPI, change_pct: -0.8 } } }).length === 0 && checkText('f', '코스피는 선방했다', { ...pm, assets: { KOSPI: { ...crash.KOSPI, change_pct: -1.2 } } }).length === 1);
  check('시장 이름 없는 문장 → 검사 안 함', checkText('f', '반도체 업종이 강세를 보이며 상승했다', pm).length === 0);
  check('전망 · 우려 말이 붙은 방향 → 검사 안 함(「반등 가능성」 · 「상승 기대」 · 「하락하지 않」)', checkText('f', '코스피는 반등 가능성이 있다', pm).length === 0 && checkText('f', '코스피 상승 기대가 크다', pm).length === 0);
  check('오름 · 내림 말이 한 마디에 섞임 → 검사 안 함', checkText('f', '코스피는 상승 출발 뒤 하락 전환', pm).length === 0);
  const mixedAssets = { ...crash, SP500: { current: 6100, change: 60, change_pct: 1.0, data_date: '2026-10-29' } };
  const mixed = checkText('f', '미국 증시는 상승했지만 국내 증시는 강세를 이어 갔다', { edition: 'morning', assets: mixedAssets, at });
  check('미국/국내 문장 섞임 — 마디별로(미국 상승 맞음 · 국내 강세 어긋남)', mixed.length === 1 && mixed[0].market === '국내 증시', JSON.stringify(mixed));
  const pair = checkText('f', '코스피와 코스닥 모두 반등했다', pm);
  check('「코스피와 코스닥 모두 반등」 → 둘 다 어긋남', pair.length === 2 && pair.map((m) => m.market).join(',') === '코스피,코스닥', JSON.stringify(pair));
  const policy = checkText('f', '연준의 금리 인하 기대에 금리가 하락했다', { edition: 'morning', assets: { US10Y: { current: 4.2, change: 0.05, change_pct: 1.2, data_date: '2026-10-29' } }, at });
  check('정책 금리 이야기(인하 · 연준) 속 「금리」 → 검사 안 함', policy.length === 0);
  const rate = { edition: 'morning' as const, assets: { US10Y: { current: 4.2, change: 0.05, change_pct: 1.2, data_date: '2026-10-29' }, US2Y: { current: 4.6, change: 0.02, change_pct: 0.4, data_date: '2026-10-29' } }, at };
  check(`금리는 %p 로 — 10년물 +0.05%p 에 「하락」 → 어긋남 · 2년물 +0.02%p(< ${FLAT_RATE_PP}%p) → 검사 안 함`, checkText('f', '10년물 국채 금리가 하락했다', rate)[0]?.actual === '미10년물금리(%) +0.050%p' && checkText('f', '2년물 금리가 하락했다', rate).length === 0, JSON.stringify(checkText('f', '10년물 국채 금리가 하락했다', rate)));
  check('괄호 안은 보지 않음 — 「원/달러 환율 하락(원화 강세)」', checkText('f', '원/달러 환율이 하락(원화 강세)했다', { edition: 'morning', assets: { USDKRW: { current: 1380, change: -12, change_pct: -0.86, data_date: '2026-10-29' } }, at }).length === 0);
  check('「미국배당다우존스」 의 다우는 지수가 아님', checkText('f', '미국배당다우존스 ETF 강세', { edition: 'morning', assets: { DOW: { current: 42000, change: -500, change_pct: -1.2, data_date: '2026-10-29' } }, at }).length === 0);
  // 경제 검토(④)가 실측한 틀린 경고 — 모두 「경고 없음」 이어야 한다(애매하면 검사하지 않는다)
  const econ = {
    edition: 'morning' as const,
    at,
    assets: {
      WTI: { current: 72, change: 1.4, change_pct: 2.0, data_date: '2026-10-29' },
      KOSPI: { current: 2600, change: -53, change_pct: -2.0, data_date: '2026-10-29' },
      KOSDAQ: { current: 830, change: -17, change_pct: -2.0, data_date: '2026-10-29' },
      USDKRW: { current: 1392, change: 11, change_pct: 0.8, data_date: '2026-10-29' },
      DXY: { current: 103.7, change: -0.6, change_pct: -0.6, data_date: '2026-10-29' },
      US10Y: { current: 4.13, change: -0.08, change_pct: -1.9, data_date: '2026-10-29' },
      US2Y: { current: 4.55, change: -0.06, change_pct: -1.3, data_date: '2026-10-29' },
      SP500: { current: 5900, change: -60, change_pct: -1.0, data_date: '2026-10-29' },
      NASDAQ: { current: 19800, change: -200, change_pct: -1.0, data_date: '2026-10-29' },
      DOW: { current: 41900, change: -400, change_pct: -0.95, data_date: '2026-10-29' },
    },
  };
  for (const text of [
    '국고채 금리 상승으로 부담',
    '일본 국채 금리 급등이 부담',
    '엔/달러 환율 급락으로 엔캐리 청산 우려가 커졌다',
    '미 10년물 국채 강세로 성장주에 우호적',
    '국채 가격 하락',
    '코스피는 장 초반 상승했으나 하락 마감',
    '미국 증시는 지난주 상승 이후 숨 고르기',
    '국내 증시는 방어적 대응이 필요한 국면',
    '국내 증시는 방어주 중심으로 버텼다', // 버텼 = 방어 말 — −2% 는 어긋남이어야 한다(아래에서 따로)
    '코스피는 수출 호조 소식에도',
    'S&P글로벌 PMI 호조',
    // ⑧ 데이터 품질 검토 실측
    '반도체는 코스피 대비 강세를 보였다',
    '코스피에서 반도체주가 상승을 주도했다',
    '미국 증시에서 경기 방어주로 자금이 이동했다',
    '미국 증시는 견조한 고용지표가 발표됐다',
    '유가증권시장에서 외국인 순매도로 하락했다',
    '국고채 금리가 하락했다',
    '나스닥 선물이 반등하고 있다',
  ]) {
    if (text.includes('버텼')) continue;
    const got = checkText('f', text, econ);
    check(`틀린 경고 없음 — 「${text}」`, got.length === 0, JSON.stringify(got));
  }
  check('방어 말(버텼) 은 그대로 잡음 — 「국내 증시는 방어주 중심으로 버텼다」 + −2% → 어긋남', checkText('f', '국내 증시는 방어주 중심으로 버텼다', econ).length === 1);
  check('금리 하락 날 「10년물 금리 상승」 → 어긋남(금리 · 수익률 + 상승/하락은 본다)', checkText('f', '10년물 금리가 상승했다', econ)[0]?.actual === '미10년물금리(%) −0.080%p');
  check('「원/달러 환율 하락」 + 원/달러 +0.8% → 어긋남(엔 · 위안이 없으면 원/달러)', checkText('f', '원/달러 환율이 하락했다', econ).length === 1);

  // 브리핑 하나 — 보는 글 전부 · 기조 라벨
  const bad = normalizeBrief({
    ...(okBrief('morning') as BriefAi),
    market_regime: 'Risk-On',
    regime_summary: '미국 증시가 랠리를 이어 갔다.',
    key_themes: [{ icon: '🟢', category: 'c', title: 't', why_important: '나스닥 강세가 이어진다', duration: 'd', swing_point: 's' }],
    leading_sectors: [{ emoji: '', name: '기술', stars: '★★★', reason: 'S&P500 상승을 이끌었다', stocks_kr: [], stocks_us: [] }],
    swing_check: { phase: '미국 증시 반등 국면', catalysts: [], risks: [] },
  });
  const usDown = { SP500: { current: 5900, change: -90, change_pct: -1.5, data_date: '2026-10-29' }, NASDAQ: { current: 19500, change: -400, change_pct: -2.0, data_date: '2026-10-29' }, DOW: { current: 41000, change: -400, change_pct: -0.97, data_date: '2026-10-29' } };
  const all = checkDirections(bad, { edition: 'morning', assets: usDown, at: kst('2026-10-30', '07:05') });
  check('브리핑 하나 — 기조 라벨 · 요약 · 주도 섹터 이유 · 테마 왜 중요 · 국면 (칸 순서)', all.map((m) => m.field).join(',') === 'market_regime,regime_summary,leading_sectors.0.reason,key_themes.0.why_important,swing_check.phase' && all[0].said === 'Risk-On' && all[0].actual === 'S&P500 −1.50% · 나스닥 −2.00%', JSON.stringify(all.map((m) => [m.field, m.said, m.actual])));
  check('기조 라벨 — S&P500 −0.8% 면 Risk-On 이어도 검사 안 함(±1% 문턱)', checkDirections({ ...bad, regime_summary: '', leading_sectors: [], key_themes: [], swing_check: { phase: '', catalysts: [], risks: [] } }, { edition: 'morning', assets: { SP500: { ...usDown.SP500, change_pct: -0.8 }, NASDAQ: usDown.NASDAQ }, at }).length === 0);
}

// C-1b 「오늘 예상 방향」(v2.60.0) — 판별 대상 · 정해진 말 · 근거 문장 검사
{
  const row = (target: string, direction = '상승', confidence = '보통', reasons: unknown = ['코스피 5일 +2.10%'], watch = 'w') => ({ target, direction, confidence, reasons, watch });
  const am = normalizeOutlook([row('SP500'), row('KOSPI', '하락', '높음'), row('KOSDAQ'), row('KOSPI', '상승')], 'morning');
  check('오전판 — 코스피 · S&P500 만(순서 고정) · 코스닥 뺌 · 같은 대상 두 번째 뺌', am.map((o) => `${o.target}:${o.direction}`).join(',') === 'KOSPI:하락,SP500:상승', JSON.stringify(am));
  const pm = normalizeOutlook([row('KOSPI'), row('SP500', '보합', '낮음')], 'afternoon');
  check('오후판 — S&P500 만(코스피 예상은 서버가 뺌)', pm.length === 1 && pm[0].target === 'SP500' && pm[0].direction === '보합');
  check('정해진 말이 아니면 그 줄을 뺌(방향 「강세」 · 확신 「매우 높음」)', normalizeOutlook([row('KOSPI', '강세'), row('SP500', '상승', '매우 높음')], 'morning').length === 0);
  check('근거 1~3줄만 · 빈 줄 뺌 · 응답이 배열이 아니면 빈 목록', normalizeOutlook([row('KOSPI', '상승', '보통', ['a', '', 'b', 'c', 'd'])], 'morning')[0].reasons.join('') === 'abc' && normalizeOutlook(null, 'morning').length === 0 && normalizeOutlook({}, 'afternoon').length === 0);
  const sch = SCHEMA.morning as { required: string[]; properties: { today_outlook: { items: { properties: Record<string, { enum?: string[] }> } } } };
  const p = sch.properties.today_outlook.items.properties;
  check('스키마 — today_outlook 필수 · 대상 · 방향 · 확신 enum', sch.required.includes('today_outlook') && p.target.enum?.join() === 'KOSPI,SP500' && p.direction.enum?.join() === '상승,보합,하락' && p.confidence.enum?.join() === '높음,보통,낮음' && (SCHEMA.afternoon as typeof sch).properties.today_outlook.items.properties.target.enum?.join() === 'SP500');
  const pr = buildPrompt({ edition: 'morning', today: '2026-10-30', assets: {}, earnings: [], domestic: [], foreign: [], at: Date.parse('2026-10-30T07:05:00+09:00') });
  check(`프롬프트 — 보합 = ±${FLAT_PCT}%(문장 검사와 같은 상수) · 확신 규칙 · 숫자 지어내지 말 것`, pr.includes(`보합 = 전일 정규장 종가 대비 ±${FLAT_PCT}% 안`) && pr.includes('엇갈리면 낮음') && pr.includes('확신이 낮으면 보합을 고를 수 있다') && pr.includes('입력에 없는 숫자를 지어내지 말 것') && pr.includes('"target": "KOSPI"') && pr.includes('"target": "SP500"'));
  check('프롬프트(오후판) — 대상은 SP500 하나', (() => { const t = buildPrompt({ edition: 'afternoon', today: '2026-10-30', assets: {}, earnings: [], domestic: [], foreign: [], at: Date.parse('2026-10-30T16:00:00+09:00') }); return t.includes('"target": "SP500"') && !t.includes('"target": "KOSPI"'); })());
  check('보합 경계 — 0.29 보합 · 0.30 상승 · 0.31 상승 · −0.30 하락(문장 검사와 같은 경계)', directionOfPct(0.29) === '보합' && directionOfPct(0.3) === '상승' && directionOfPct(0.31) === '상승' && directionOfPct(-0.3) === '하락' && directionOfPct(-0.29) === '보합' && directionOfPct(0) === '보합');
  // 근거 문장 검사 — 입력 숫자와 반대 표현이면 같은 표시
  const b = normalizeBrief({ ...(okBrief('morning') as BriefAi), key_themes: [], leading_sectors: [], swing_check: { phase: '', catalysts: [], risks: [] }, regime_summary: '' });
  b.today_outlook = normalizeOutlook([row('KOSPI', '하락', '보통', ['코스피는 전일 반등했다', '코스피 하락 가능성'])], 'morning');
  const mm = checkDirections(b, { edition: 'morning', assets: { KOSPI: { current: 2500, change: -50, change_pct: -1.96, data_date: '2026-10-29' } }, at: Date.parse('2026-10-30T07:05:00+09:00') }).filter((m) => m.field.startsWith('today_outlook'));
  check('근거 문장 검사 — 「반등」 + −1.96% → 어긋남 · 「하락 가능성」(예상 말)은 검사 안 함', mm.length === 1 && mm[0].field === 'today_outlook.0.reasons.0' && mm[0].said === '반등', JSON.stringify(mm));
}

// C-2 대표 종목 — 후보 목록 · 거르기 · 옛 글자 브리핑
const POOL: SectorStockPool = {
  기술: { kr: [{ symbol: '005930', name: '삼성전자' }, { symbol: '000660', name: 'SK하이닉스' }], us: [{ symbol: 'NVDA', name: '엔비디아' }, { symbol: 'AAPL', name: '애플' }] },
  산업재: { kr: [{ symbol: '000720', name: '현대건설' }], us: [{ symbol: 'CAT', name: '캐터필러' }] },
};
{
  const b = normalizeBrief({
    ...(okBrief('morning') as BriefAi),
    leading_sectors: [
      // 실제 화면: 기술 섹터에 아마존(목록 밖) · 현대건설(다른 섹터) · 캐터필러(다른 섹터)
      { emoji: '', name: '기술', stars: '★★★', reason: 'r', stocks_kr: [{ ticker: '000720', name: '현대건설' }, { ticker: '005930', name: '삼성전자' }] as never, stocks_us: [{ ticker: 'AMZN', name: '아마존' }, { ticker: 'CAT', name: '캐터필러' }, { ticker: '', name: '엔비디아' }] as never },
      { emoji: '', name: '헬스케어', stars: '★☆☆', reason: 'r', stocks_kr: [{ ticker: '005930', name: '삼성전자' }] as never, stocks_us: [] },
    ],
  });
  const dropped = filterSectorStocks(b, POOL);
  const tech = b.leading_sectors[0];
  check('목록 밖 이름(아마존) · 섹터 다른 종목(현대건설 · 캐터필러) 뺌 · 이름만 맞으면 목록 티커로(엔비디아 → NVDA)', JSON.stringify(tech.stocks_kr) === '[{"symbol":"005930","name":"삼성전자"}]' && JSON.stringify(tech.stocks_us) === '[{"symbol":"NVDA","name":"엔비디아"}]', JSON.stringify(tech));
  check('후보가 없는 섹터(헬스케어)의 종목도 뺌 · 뺀 수 = 4(현대건설 · 아마존 · 캐터필러 · 헬스케어 삼성전자)', JSON.stringify(b.leading_sectors[1].stocks_kr) === '[]' && dropped === 4, String(dropped));
  const legacy = normalizeBrief({ ...(okBrief('morning') as BriefAi), leading_sectors: [{ emoji: '', name: '기술', stars: '★★★', reason: 'r', stocks_kr: '삼성전자, 아마존', stocks_us: '' }] });
  filterSectorStocks(legacy, POOL);
  check('글자로 온 응답도 이름으로 걸러 목록으로(삼성전자만)', JSON.stringify(legacy.leading_sectors[0].stocks_kr) === '[{"symbol":"005930","name":"삼성전자"}]');
  const text = poolText(POOL);
  check('프롬프트 후보 줄 — 섹터마다 국내 | 미국 · 이름(티커)', text.includes('- [기술] 국내: 삼성전자(005930), SK하이닉스(000660) | 미국: 엔비디아(NVDA), 애플(AAPL)') && poolText({}).startsWith('(후보 없음'), text);
  const schemaStocks = (SCHEMA.morning as { properties: { leading_sectors: { items: { properties: { stocks_kr: { type: string; items: { required: string[] } } } } } } }).properties.leading_sectors.items.properties.stocks_kr;
  check('스키마 — stocks_kr 는 [{ticker, name}] 배열', schemaStocks.type === 'ARRAY' && schemaStocks.items.required.join(',') === 'ticker,name');
  const withPool = buildPrompt({ edition: 'afternoon', today: '2026-10-30', assets, earnings: [], domestic: [], foreign: [], at: kst('2026-10-30', '16:00'), sectorStocks: POOL });
  check('프롬프트 — 후보 목록 · 그 섹터 줄에서만 고르라는 규칙', withPool.includes('[주도 섹터 대표 종목 후보') && withPool.includes('- [산업재] 국내: 현대건설(000720) | 미국: 캐터필러(CAT)') && withPool.includes('**그 섹터 줄의** 국내 · 미국 종목만'));
  // DB 에서 후보 만들기 — 섹터를 모르는 종목은 후보가 아니다 · 시총 큰 순
  const ins = db.prepare(`INSERT OR REPLACE INTO stock_profiles (symbol, sector, market_cap, fetched_at) VALUES (?, ?, ?, '2026-10-30')`);
  ins.run('ZZBIG', 'Technology', 3e12);
  ins.run('ZZSMALL', 'Technology', 1e9);
  ins.run('ZZNOSECT', null, 5e12);
  const pool = sectorStockPool(['ZZSMALL', 'ZZBIG', 'ZZNOSECT']);
  const techUs = (pool['기술']?.us ?? []).map((x) => x.symbol);
  const small = techUs.indexOf('ZZSMALL');
  check('후보 — DB 섹터(종목 지도와 같은 한국어 「기술」) · 시총 큰 순', techUs.includes('ZZBIG') && (small === -1 || techUs.indexOf('ZZBIG') < small), JSON.stringify(techUs));
  check('후보 — 섹터 없는 종목은 어느 섹터에도 없음', !Object.values(pool).some((p) => [...p.kr, ...p.us].some((x) => x.symbol === 'ZZNOSECT')));
  db.prepare(`DELETE FROM stock_profiles WHERE symbol IN ('ZZBIG', 'ZZSMALL', 'ZZNOSECT')`).run();
}

// C-3 AI 없이 만든 브리핑에도 「발표됨」(같은 판정)
{
  const close = Date.parse('2026-10-30T16:00:00-04:00');
  const after = kst('2026-10-31', '07:05'); // 미국 10-30 18:05
  const list = [
    { ...earningOf('INTC', '인텔', '기술', 0), date: '2026-10-30' },
    { ...earningOf('META', '메타', '기술', 0), date: '2026-10-30', isEstimateDate: true },
    { ...earningOf('005930', '삼성전자', '기술', 0), date: '2026-10-31' },
    { ...earningOf('AAPL', '애플', '기술', 1), date: '2026-10-31' },
  ];
  markReleasedEarnings(list, after, close);
  check('AI 없는 실적 목록 — 미국 D+0 · 장 마감 뒤만 「발표됨」(추정일 · 국내 · 내일은 아님) · 마감 시각', list[0].released === true && list[0].usCloseAt === '2026-10-30T20:00:00.000Z' && !list[1].released && !list[2].released && !list[3].released, JSON.stringify(list.map((e) => [e.symbol, e.released])));
  markReleasedEarnings(list, close - 60_000, close);
  check('AI 없는 실적 목록 — 장 마감 전이면 없음(다시 정하면 지운다)', list.every((e) => !e.released && !e.usCloseAt));
}

// C-4 만들기 한 번 — 어긋남 저장 · 대표 종목 거르기 · 수집 상태 줄 · AI 없는 브리핑 「발표됨」 저장 · 옛 브리핑 읽기
{
  resetBriefStateForTest();
  clock = kst('2026-10-27', '14:20'); // 화요일 오후판 · 장중
  const crashMarket = async () => ({
    assets: { KOSPI: { current: 2500.1, change: -146.3, change_pct: -5.53, data_date: '2026-10-27' }, KOSDAQ: { current: 800.2, change: -39.8, change_pct: -4.74, data_date: '2026-10-27' }, VIX: assets.VIX },
    failed: [],
  });
  const lying = { ...okBrief('afternoon'), market_summary: '국내 증시는 양호한 실적 기대감과 경제지표 호조로 방어력을 보이고 있습니다.', leading_sectors: [{ emoji: '', name: '기술', stars: '★★★', reason: 'r', stocks_kr: [{ ticker: '000720', name: '현대건설' }, { ticker: '005930', name: '삼성전자' }], stocks_us: [{ ticker: 'AMZN', name: '아마존' }] }] } as unknown as Partial<BriefAi>;
  const run = startButtonRun({ ...deps, collect: { ...deps.collect, market: crashMarket, sectorStocks: () => POOL }, gemini: async (o) => (geminiCalls.push(o), { data: lying, raw: '', model: 'm', tokens: 1, elapsedMs: 1 }) });
  const saved = getBrief((await run.done)!);
  const mm = saved?.brief?.mismatches ?? [];
  check('저장 — 어긋남(market_summary · 방어 · 코스피 −5.53%(장중))', mm.length === 1 && mm[0].field === 'market_summary' && mm[0].said === '방어' && mm[0].actual.startsWith('코스피 −5.53%(장중)'), JSON.stringify(mm));
  check('저장 — 문장은 AI 글 그대로', saved?.brief?.market_summary === '국내 증시는 양호한 실적 기대감과 경제지표 호조로 방어력을 보이고 있습니다.');
  check('저장 — 수집 상태 「AI 문장 검사: 1곳 숫자와 다름」(확인 필요) · 「AI 대표 종목 확인: 2개 뺌(후보 목록 밖 …)」(회색 안내)', !!saved?.sources.some((x) => x.group === 'check' && x.label === 'AI 문장 검사' && !x.ok && x.detail === '1곳 숫자와 다름') && !!saved.sources.some((x) => x.group === 'check' && x.label === 'AI 대표 종목 확인' && x.ok && x.detail.startsWith('2개 뺌(후보 목록 밖')), JSON.stringify(saved?.sources.filter((x) => x.group === 'check')));
  check('저장 — 대표 종목은 목록 안의 것만(삼성전자)', JSON.stringify(saved?.brief?.leading_sectors[0].stocks_kr) === '[{"symbol":"005930","name":"삼성전자"}]' && JSON.stringify(saved?.brief?.leading_sectors[0].stocks_us) === '[]');
  check('Gemini 입력 — 장중(마감 전) — 14:20 기준 · 후보 목록', String(geminiCalls.at(-1)?.parts[0]?.text ?? '').includes('[10/27(화) 장중(마감 전) — 14:20 기준]') && String(geminiCalls.at(-1)?.parts[0]?.text ?? '').includes('- [기술] 국내: 삼성전자(005930)'));
  check('Gemini 호출 — 브리핑 1번 = 1번(검사가 호출을 늘리지 않음)', geminiCalls.length >= 1 && saved?.aiCalls === 1);

  // AI 없는 브리핑 — 실적 목록에 「발표됨」 저장
  geminiReason = 'Gemini 키가 설정되지 않았습니다';
  clock = kst('2026-10-31', '07:05');
  const noAiRun = startButtonRun({ ...deps, collect: { ...deps.collect, earnings: async () => ({ earnings: [{ ...earningOf('INTC', '인텔', '기술', 0), date: '2026-10-30' }], estimatesOk: 1, estimatesTried: 1, error: null }) }, usClose: async () => Date.parse('2026-10-30T16:00:00-04:00') });
  const noAi = getBrief((await noAiRun.done)!);
  check('AI 없는 브리핑 — 실적 목록에 「발표됨」 · 마감 시각 저장 · 검사 줄 없음', noAi?.brief === null && noAi.data.earnings[0]?.released === true && noAi.data.earnings[0].usCloseAt === '2026-10-30T20:00:00.000Z' && !noAi.sources.some((x) => x.group === 'check'), JSON.stringify(noAi?.data.earnings[0]));
  geminiReason = null;

  // 「오늘 예상 방향」 저장 — 판에 맞게 거른 것 · AI 없는 브리핑은 없음(데이터로 예상을 만들지 않는다)
  clock = kst('2026-10-28', '07:05');
  const withOutlook = { ...okBrief('morning'), today_outlook: [{ target: 'KOSPI', direction: '상승', confidence: '높음', reasons: ['S&P500 선물 +0.50%'], watch: 'w' }, { target: 'NASDAQ', direction: '상승', confidence: '높음', reasons: [], watch: '' }] } as unknown as Partial<BriefAi>;
  const oRun = startButtonRun({ ...deps, gemini: async (o) => (geminiCalls.push(o), { data: withOutlook, raw: '', model: 'm', tokens: 1, elapsedMs: 1 }) });
  const oSaved = getBrief((await oRun.done)!);
  check('저장 — 오늘 예상 방향(코스피만 · 나스닥은 대상 밖이라 뺌)', JSON.stringify(oSaved?.brief?.today_outlook?.map((o) => o.target)) === '["KOSPI"]', JSON.stringify(oSaved?.brief?.today_outlook));
  check('저장 — AI 없는 브리핑에는 예상이 없음', noAi?.brief === null);

  // 옛 브리핑(대표 종목이 글자 · mismatches 없음)을 그대로 읽는다
  const oldId = insertBrief({ date: '2026-10-20', edition: 'morning', trigger: 'auto', createdAt: '2026-10-19T22:05:00.000Z', model: 'm', tokens: 1, aiCalls: 1, promptVersion: 'brief-v3', sources: [], data: { assets: {}, earnings: [] }, brief: normalizeBrief(okBrief('morning')), aiError: null });
  const oldBrief = getBrief(oldId);
  check('옛 브리핑 읽기 — 대표 종목 글자 그대로 · mismatches 없음', oldBrief?.brief?.leading_sectors[0].stocks_kr === '삼성전자' && oldBrief.brief.mismatches === undefined && oldBrief.promptVersion === 'brief-v3');
}

// ═════════════════════════ D. 「오늘 예상 방향」 채점(v2.60.0) ═════════════════════════
{
  db.prepare(`DELETE FROM market_briefs`).run();
  clearScoresForTest();
  // 가짜 정규장 시간표 — 국내 09:00~15:30 KST · 미국 09:30~16:00 ET(서머타임은 marketDayTime 이 따른다) · 주말 · 아래 휴장일은 null
  const holidays = new Set(['KR|2026-11-04', 'US|2026-11-26']);
  const closed = (m: 'KR' | 'US', d: string) => holidays.has(`${m}|${d}`) || [0, 6].includes(new Date(`${d}T12:00:00Z`).getUTCDay());
  let closes: DailyCloses = {};
  let closeCalls = 0;
  const sd: ScoreDeps = {
    start: async (m, d) => (closed(m, d) ? null : marketDayTime(m, d, (m === 'KR' ? 9 * 60 : 9 * 60 + 30) * 60_000)),
    end: async (m, d) => (closed(m, d) ? null : marketDayTime(m, d, (m === 'KR' ? 15 * 60 + 30 : 16 * 60) * 60_000)),
    closes: async () => (closeCalls++, closes),
  };
  const o = (target: 'KOSPI' | 'SP500', direction: '상승' | '보합' | '하락', confidence: '높음' | '보통' | '낮음' = '보통') => ({ target, direction, confidence, reasons: ['r'], watch: 'w' });
  const put = (createdKst: string, outlook: ReturnType<typeof o>[]) => {
    const createdAt = new Date(Date.parse(`${createdKst}+09:00`)).toISOString();
    return insertBrief({ date: createdKst.slice(0, 10), edition: Number(createdKst.slice(11, 13)) < 13 ? 'morning' : 'afternoon', trigger: 'auto', createdAt, model: 'm', tokens: 1, aiCalls: 1, promptVersion: 'brief-v5', sources: [], data: { assets: {}, earnings: [] }, brief: { ...normalizeBrief(okBrief('morning')), today_outlook: outlook }, aiError: null });
  };
  const at = (kstTime: string) => Date.parse(`${kstTime}+09:00`);

  // 채점 대상 고르기
  const kr = await targetDayOf('KOSPI', at('2026-11-02T07:05:00'), sd);
  check('코스피 — 07:05 KST 오전판 → 그날(11-02) · 09:00 전', 'day' in kr && kr.day === '2026-11-02');
  check('코스피 — 장 시작(09:00) 뒤 만든 예상 → 채점 안 함', JSON.stringify(await targetDayOf('KOSPI', at('2026-11-02T09:00:00'), sd)) === '{"skip":"after-open"}');
  check('코스피 — 휴장일(11-04) · 토요일 → 채점 안 함', JSON.stringify(await targetDayOf('KOSPI', at('2026-11-04T07:05:00'), sd)) === '{"skip":"holiday"}' && JSON.stringify(await targetDayOf('KOSPI', at('2026-10-31T07:05:00'), sd)) === '{"skip":"holiday"}');
  const usAm = await targetDayOf('SP500', at('2026-10-30T07:05:00'), sd); // 미국 10-29 18:05 ET — 그날 장 끝남 → 10-30
  const usPm = await targetDayOf('SP500', at('2026-10-30T14:00:00'), sd); // 미국 10-30 01:00 ET
  check('S&P500 — 한국 아침 · 오후 예상 → 그날 밤 미국 정규장(미국 10-30)', 'day' in usAm && usAm.day === '2026-10-30' && 'day' in usPm && usPm.day === '2026-10-30');
  check('서머타임 앞 — 10-30 23:00 KST 는 미국 정규장(22:30 KST 시작) 중 → 채점 안 함', JSON.stringify(await targetDayOf('SP500', at('2026-10-30T23:00:00'), sd)) === '{"skip":"after-open"}');
  const afterDst = await targetDayOf('SP500', at('2026-11-02T23:00:00'), sd);
  check('서머타임 뒤 — 11-02 23:00 KST 는 시작(23:30 KST) 전 → 그날(미국 11-02)', 'day' in afterDst && afterDst.day === '2026-11-02' && afterDst.start === at('2026-11-02T23:30:00'));
  check('S&P500 — 토요일 아침 예상(다음 정규장이 36시간 넘게 뒤) → 채점 안 함', JSON.stringify(await targetDayOf('SP500', at('2026-10-31T07:05:00'), sd)) === '{"skip":"holiday"}');
  check('S&P500 — 미국 휴장 전날 예상 → 휴장 다음 정규장은 36시간 넘어 채점 안 함', JSON.stringify(await targetDayOf('SP500', at('2026-11-26T07:05:00'), sd)) === '{"skip":"holiday"}');

  // 같은 날 여러 예상 — 장 시작 전 마지막 것
  const b1 = put('2026-11-02T07:05:00', [o('KOSPI', '상승', '높음'), o('SP500', '하락')]);
  const b2 = put('2026-11-02T08:30:00', [o('KOSPI', '보합', '낮음'), o('SP500', '하락', '낮음')]);
  const b3 = put('2026-11-02T10:00:00', [o('KOSPI', '하락'), o('SP500', '상승', '높음')]); // 코스피는 장 중 → 제외 · S&P500 은 그날 밤 장 전 → 후보
  const chosen = await chooseCandidates([b1, b2, b3].map((id) => { const b = getBrief(id)!; return { id, createdAt: b.createdAt, outlook: b.brief!.today_outlook! }; }), sd);
  check('고르기 — 코스피 = 09:00 전 마지막(08:30 · b2) · 장중 만든 b3 제외 · S&P500 = 그날 밤 장 전 마지막(b3)', chosen.get('KOSPI|2026-11-02')?.briefId === b2 && chosen.get('SP500|2026-11-02')?.briefId === b3, JSON.stringify([...chosen.entries()].map(([k, v]) => [k, v.briefId])));

  // 채점 — 마감 + 여유 전에는 하지 않음 · 뒤에 함
  closes = { KOSPI: [{ date: '2026-10-30', close: 1000 }, { date: '2026-11-02', close: 1002.9 }], SP500: [{ date: '2026-10-30', close: 1000 }, { date: '2026-11-02', close: 1003.1 }] };
  const krEnd = at('2026-11-02T15:30:00');
  check('채점 — 국내 마감(15:30) + 여유 전에는 0 · 일봉을 받지 않음', (await scoreOutlooks(krEnd + SETTLE_MARGIN_MS - 60_000, sd)) === 0 && closeCalls === 0);
  check('채점 — 마감 + 여유 뒤 코스피 1건(미국은 아직)', (await scoreOutlooks(krEnd + SETTLE_MARGIN_MS, sd)) === 1);
  const sKr = getScore('KOSPI', '2026-11-02');
  check('채점 — +0.29% → 보합 → b2 「보합」 맞음 · 확신 낮음 저장', sKr?.actualPct === 0.29 && sKr.actualDirection === '보합' && sKr.hit && sKr.briefId === b2 && sKr.confidence === '낮음', JSON.stringify(sKr));
  check('채점 — 이미 채점한 것은 다시 받지 않음', (await scoreOutlooks(krEnd + 2 * SETTLE_MARGIN_MS, sd)) === 0);
  const usEnd = at('2026-11-03T06:00:00'); // 미국 11-02 16:00 EST = 한국 11-03 06:00
  check('채점 — 미국 마감(한국 06:00) + 여유 뒤 S&P500 +0.31% → 상승 · b3 「상승」 맞음', (await scoreOutlooks(usEnd + SETTLE_MARGIN_MS, sd)) === 1 && getScore('SP500', '2026-11-02')?.hit === true && getScore('SP500', '2026-11-02')?.actualDirection === '상승');
  check('경계 — 0.29 보합 · 0.30 상승 · 0.31 상승 · 실제 등락률은 소수 2자리', actualPctOf([{ date: 'a', close: 1000 }, { date: 'b', close: 1003 }], 'b') === 0.3 && directionOfPct(actualPctOf([{ date: 'a', close: 1000 }, { date: 'b', close: 1003 }], 'b')!) === '상승' && actualPctOf([{ date: 'b', close: 1 }], 'b') === null && actualPctOf(undefined, 'b') === null);

  // 놓친 날 보충 — 며칠 뒤 한 번에 · 일봉에 그 날이 없으면 다음 틱
  const b4 = put('2026-11-03T07:05:00', [o('KOSPI', '하락', '높음')]);
  const b5 = put('2026-11-05T07:05:00', [o('KOSPI', '상승', '보통')]);
  closes = { KOSPI: [{ date: '2026-11-02', close: 1002.9 }, { date: '2026-11-03', close: 980 }, { date: '2026-11-05', close: 990 }] };
  const later = at('2026-11-06T12:00:00');
  check('놓친 날 보충 — 11-03 · 11-05 를 한 틱에(11-04 휴장은 예상 없음)', (await scoreOutlooks(later, sd)) === 2 && getScore('KOSPI', '2026-11-03')?.hit === true && getScore('KOSPI', '2026-11-05')?.hit === true);
  check('놓친 날 보충 — 11-05 실제 = 11-03 종가 대비(바로 앞 봉 = 전 거래일)', getScore('KOSPI', '2026-11-05')?.actualPct === Math.round((990 / 980 - 1) * 10_000) / 100);
  void b4;
  void b5;
  // 덮어쓰기 — 같은 거래일에 다른 브리핑으로 채점된 줄은 새 선택으로 덮는다
  upsertScore({ target: 'KOSPI', tradeDay: '2026-11-03', briefId: 999, direction: '상승', confidence: '높음', actualPct: -2.28, actualDirection: '하락', hit: false, scoredAt: 'x' });
  check('덮어쓰기 — 같은 대상 · 같은 거래일은 한 줄 · 고른 브리핑과 다르면 다시 채점', (await scoreOutlooks(later, sd)) === 1 && getScore('KOSPI', '2026-11-03')?.briefId === b4 && (db.prepare(`SELECT COUNT(*) AS n FROM market_brief_scores WHERE target = 'KOSPI' AND trade_day = '2026-11-03'`).get() as { n: number }).n === 1);

  // 화면 상태
  const view2 = await outlookView({ id: b2, createdAt: getBrief(b2)!.createdAt, outlook: getBrief(b2)!.brief!.today_outlook! }, later, sd);
  check('화면 — b2: 코스피 채점됨(맞음 · +0.29%) · S&P500 은 더 나중 예상(b3)이 채점 → superseded', view2.items[0].status === 'scored' && view2.items[0].hit === true && view2.items[0].actualPct === 0.29 && view2.items[1].status === 'superseded', JSON.stringify(view2.items));
  const view3 = await outlookView({ id: b3, createdAt: getBrief(b3)!.createdAt, outlook: getBrief(b3)!.brief!.today_outlook! }, later, sd);
  check('화면 — b3: 코스피는 장 시작 뒤 만든 예상 · S&P500 채점됨', view3.items[0].status === 'after-open' && view3.items[1].status === 'scored');
  const b6 = put('2026-11-06T07:05:00', [o('KOSPI', '상승')]);
  const view6 = await outlookView({ id: b6, createdAt: getBrief(b6)!.createdAt, outlook: getBrief(b6)!.brief!.today_outlook! }, at('2026-11-06T12:00:00'), sd);
  check('화면 — 채점 대기(마감 시각 = 한국 15:30)', view6.items[0].status === 'pending' && view6.items[0].closeAt === new Date(at('2026-11-06T15:30:00')).toISOString());
  const view6b = await outlookView({ id: b6, createdAt: getBrief(b6)!.createdAt, outlook: getBrief(b6)!.brief!.today_outlook! }, at('2026-11-06T17:00:00'), sd);
  check('화면 — 마감 + 여유가 지났는데 아직 없음 → waiting-data', view6b.items[0].status === 'waiting-data');

  // 최근 20번 · 확신별
  clearScoresForTest();
  for (let i = 0; i < 25; i++) {
    const day = new Date(Date.parse('2026-09-01T12:00:00Z') + i * 86_400_000).toISOString().slice(0, 10);
    upsertScore({ target: 'SP500', tradeDay: day, briefId: i, direction: '상승', confidence: i % 3 === 0 ? '높음' : i % 3 === 1 ? '보통' : '낮음', actualPct: 0.5, actualDirection: '상승', hit: i % 2 === 0, scoredAt: 'x' });
  }
  const st = outlookStats('SP500');
  // 최근 20번 = i 5..24 · 맞음(짝수) 10 · 높음(i%3==0: 6,9,12,15,18,21,24 = 7 · 맞음 6,12,18,24 = 4)
  check('최근 20번 — 25번 중 최근 20번만 · 맞음 10 · 확신 높음 4/7', st.total === 20 && st.hits === 10 && st.byConfidence['높음'].total === 7 && st.byConfidence['높음'].hits === 4 && st.byConfidence['보통'].total + st.byConfidence['낮음'].total === 13, JSON.stringify(st));
  check('20번이 안 되면 있는 만큼(코스피 0번)', outlookStats('KOSPI').total === 0);
  // 1년 보관
  upsertScore({ target: 'KOSPI', tradeDay: '2025-10-01', briefId: 1, direction: '상승', confidence: '높음', actualPct: 1, actualDirection: '상승', hit: true, scoredAt: 'x' });
  upsertScore({ target: 'KOSPI', tradeDay: '2025-11-05', briefId: 2, direction: '상승', confidence: '높음', actualPct: 1, actualDirection: '상승', hit: true, scoredAt: 'x' });
  const purged = purgeScores(at('2026-11-02T07:00:00'));
  check(`1년 보관 — ${SCORE_KEEP_DAYS}일 넘은 줄만 지움(2025-10-01 지움 · 2025-11-05 남김)`, purged === 1 && !getScore('KOSPI', '2025-10-01') && !!getScore('KOSPI', '2025-11-05'));
  clearScoresForTest();
}

db.prepare(`DELETE FROM market_briefs`).run();
db.prepare(`DELETE FROM app_settings WHERE key = 'marketBrief.lastAutoDate'`).run();

console.log(`\n결과: ${pass}개 통과 / ${fail}개 실패`);
process.exit(fail ? 1 : 0);
