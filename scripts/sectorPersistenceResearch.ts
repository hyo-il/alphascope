/**
 * 섹터 강세 지속성 검증 — **연구 · 사전 등록** (`npm run research:sector`, v2.21.0)
 *
 * 질문: "지난 N 기간에 강했던 섹터가 **다음** N 기간에도 강했는가?" — 종목 지도의 섹터 순위가 설명 이상의 쓸모가 있나.
 *
 * ── 사전 등록 (결과를 보기 전에 고정했다. 바꾸려면 새 실험으로 등록한다) ─────────────────────
 * - 데이터: `server/data/universe.json` 미국 100 · 국내 100 (**시장별 따로**), 일봉 최근 3년(756거래일).
 *   섹터는 종목 지도와 같은 분류(`stock_profiles` → `sectorKo`). 모르는 종목("기타")은 **제외**, 종목 3개 미만 섹터 **제외**.
 * - 기간 쌍 3개: 1개월→1개월(21→21), 3개월→1개월(63→21), 1주→1주(5→5) 거래일.
 * - 섹터 수익률 = **동일 가중**(`sectorStats` 의 equalReturn — 지도와 같은 함수). 시총 가중(capReturn)은 참고 열.
 * - 방법: 다음 기간이 겹치지 않게 굴린다(다음 기간 길이만큼 간격). 시점 t 마다 과거 기간 섹터 순위의
 *   상위 1/3 과 하위 1/3(각 floor(섹터 수/3), 최소 1)을 만들고, **다음 기간 수익률 차이(상위 평균 − 하위 평균, %p)** 를 기록.
 * - 통과 기준(모두): ① 평균 차이 > 0 ② 부트스트랩(시점 단위, 2,000회) 95% 신뢰구간 하한 > 0
 *   ③ 3년을 1년씩 3구간으로 나눴을 때 2구간 이상 평균 차이 > 0
 *   ④ 결과 섞기: 시점마다 다음 기간 섹터 수익률을 섹터끼리 무작위로 뒤바꿔(시드 고정, 1회) 같은 판정 — 통과가 나오면 "검증 무효"
 * - 다중 시험: 3쌍 × 2시장 = 6개. 리포트 첫 줄에 "6개 중 N개 통과", 1개뿐이면 "우연 가능성 있음".
 * - 결론 규칙: 통과 없음 → 섹터 강세 순위는 **설명용**으로만 유지(판정·자동매매 연결 안 함).
 *   통과가 있어도 **자동으로 기능에 연결하지 않는다** — 사용자가 결과를 보고 정한다.
 * - 한계: 생존 편향(오늘의 시총 상위로 과거를 본다), 현재 섹터 분류로 과거를 본다, 3년.
 * ────────────────────────────────────────────────────────────────────────────────────────────
 *
 * ⚠️ 미래 누설 금지: 시점 t 의 순위에는 **t 까지의 종가만** 쓴다(과거 기간 = t−back → t). 실행마다 위반 수를 세고
 * 한 시점의 증명 로그를 리포트에 남긴다. 진행 중인 봉(미확정 종가)은 뺀다.
 * 결과는 맥 `docs/analysis/sector_persistence_{날짜}.md/.json` · 오라클 `~/alphascope/reports/`.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import type { Candle } from '../src/types/toss';
import type { HeatmapCell } from '../src/types/heatmap';
import { getCandles } from '../server/candleService';
import { loadCandles } from '../server/db';
import { outputDir } from '../server/diagnose/report';
import { profiles, sectorKo, sectorStats } from '../server/heatmap';
import { UNIVERSE_PATH, type Universe } from '../server/universe';
import { isFormingBar } from '../src/utils/marketBar';
import { marketDate } from '../src/utils/marketDate';

// ── 사전 등록 상수 (바꾸지 않는다) ─────────────────────────────────────────────
const PAIRS = [
  { id: '1m→1m', label: '과거 1개월 → 다음 1개월', back: 21, fwd: 21 },
  { id: '3m→1m', label: '과거 3개월 → 다음 1개월', back: 63, fwd: 21 },
  { id: '1w→1w', label: '과거 1주 → 다음 1주', back: 5, fwd: 5 },
] as const;
const SPAN = 756; // 3년
const MIN_MEMBERS = 3;
const BOOTSTRAP = 2000;
const SEED = 20260930;
const BARS = SPAN + 63 + 30; // 3년 + 가장 긴 과거 기간 + 여유

// ── 유틸 ─────────────────────────────────────────────────────────────────────
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const round = (v: number, d = 3) => (Number.isFinite(v) ? Math.round(v * 10 ** d) / 10 ** d : v);

// ── 데이터 ───────────────────────────────────────────────────────────────────
async function loadCloses(symbols: string[]): Promise<Map<string, Map<string, number>>> {
  const out = new Map<string, Map<string, number>>();
  let done = 0;
  for (const symbol of symbols) {
    // 캐시 먼저 — 모자랄 때만 받는다(MARKET_DATA_CHART 한도는 httpClient 가 지킨다)
    let candles: Candle[] = loadCandles(symbol, '1d', BARS);
    if (candles.length < BARS - 5) candles = await getCandles(symbol, '1d', BARS).catch(() => candles);
    if (candles.length && isFormingBar(candles, '1d', symbol)) candles = candles.slice(0, -1);
    out.set(symbol, new Map(candles.map((c) => [marketDate(c.timestamp, symbol), c.close])));
    done += 1;
    if (done % 50 === 0) console.log(`[sector] 캔들 ${done}/${symbols.length}`);
  }
  return out;
}

interface Member {
  symbol: string;
  sector: string;
  cap: number;
}

interface PointDetail {
  t: string;
  pastFrom: string;
  fwdTo: string;
  sectors: { sector: string; past: number; next: number | null; members: number }[];
  top: string[];
  bottom: string[];
  diff: number;
  capDiff: number | null;
}

/** 한 시점 — 과거 기간 순위(t 까지만) · 다음 기간 수익률 차이 */
function evaluatePoint(
  members: Member[],
  closes: Map<string, Map<string, number>>,
  calendar: string[],
  t: number,
  back: number,
  fwd: number,
  guard: { violations: number },
): PointDetail | null {
  const [d0, d1, d2] = [calendar[t - back], calendar[t], calendar[t + fwd]];
  // 과거 기간 — **t 까지의 종가만**
  const past: HeatmapCell[] = [];
  const next: HeatmapCell[] = [];
  for (const m of members) {
    const c = closes.get(m.symbol)!;
    const a = c.get(d0);
    const b = c.get(d1);
    if (a && b) {
      // 누설 점검: 순위에 쓰는 두 종가의 날짜가 t 이후면 위반. 구조상 d0 = t−back, d1 = t 라 0 이어야 한다(증명 로그로 남긴다)
      if (d0 > d1 || d1 > calendar[t]) guard.violations += 1;
      past.push({ symbol: m.symbol, name: null, sector: m.sector, marketCap: m.cap, price: b, changeRate: (b / a - 1) * 100, currency: 'USD', watch: false });
    }
    const e = c.get(d2);
    if (b && e) next.push({ symbol: m.symbol, name: null, sector: m.sector, marketCap: m.cap, price: e, changeRate: (e / b - 1) * 100, currency: 'USD', watch: false });
  }
  // 지도와 같은 함수 — 동일 가중(equalReturn) · 시총 가중(capReturn)
  const pastStats = sectorStats(past).sectors.filter((s) => s.counted >= MIN_MEMBERS);
  const nextStats = new Map(sectorStats(next).sectors.map((s) => [s.sector, s]));
  const ranked = pastStats.filter((s) => nextStats.has(s.sector)).sort((a, b) => b.equalReturn - a.equalReturn);
  if (ranked.length < 3) return null;
  const k = Math.max(1, Math.floor(ranked.length / 3));
  const top = ranked.slice(0, k).map((s) => s.sector);
  const bottom = ranked.slice(-k).map((s) => s.sector);
  const nx = (names: string[], key: 'equalReturn' | 'capReturn') => mean(names.map((n) => nextStats.get(n)![key]));
  return {
    t: d1,
    pastFrom: d0,
    fwdTo: d2,
    sectors: ranked.map((s) => ({ sector: s.sector, past: s.equalReturn, next: nextStats.get(s.sector)?.equalReturn ?? null, members: s.counted })),
    top,
    bottom,
    diff: nx(top, 'equalReturn') - nx(bottom, 'equalReturn'),
    capDiff: nx(top, 'capReturn') - nx(bottom, 'capReturn'),
  };
}

interface Verdict {
  n: number;
  mean: number;
  ciLow: number;
  ciHigh: number;
  yearMeans: number[];
  positiveYears: number;
  pass: boolean;
}

function judge(points: { diff: number; yearBlock: number }[], seed: number): Verdict {
  const diffs = points.map((p) => p.diff);
  const random = rng(seed);
  const boots: number[] = [];
  for (let b = 0; b < BOOTSTRAP; b++) {
    let sum = 0;
    for (let i = 0; i < diffs.length; i++) sum += diffs[Math.floor(random() * diffs.length)];
    boots.push(sum / diffs.length);
  }
  boots.sort((a, c) => a - c);
  const yearMeans = [0, 1, 2].map((y) => mean(points.filter((p) => p.yearBlock === y).map((p) => p.diff)));
  const positiveYears = yearMeans.filter((v) => v > 0).length;
  const m = mean(diffs);
  const ciLow = boots[Math.floor(BOOTSTRAP * 0.025)];
  return {
    n: diffs.length,
    mean: m,
    ciLow,
    ciHigh: boots[Math.floor(BOOTSTRAP * 0.975)],
    yearMeans,
    positiveYears,
    pass: diffs.length > 0 && m > 0 && ciLow > 0 && positiveYears >= 2,
  };
}

// ── 본체 ─────────────────────────────────────────────────────────────────────
async function main() {
  const started = Date.now();
  const universe = JSON.parse(fs.readFileSync(UNIVERSE_PATH, 'utf8')) as Universe;
  const markets = { US: universe.us, KR: universe.kr };
  const all = [...universe.us, ...universe.kr].map((e) => e.symbol);
  const prof = profiles(all);
  const closes = await loadCloses(all);
  console.log(`[sector] 캔들 확보 ${closes.size}종목 (${Math.round((Date.now() - started) / 1000)}초)`);

  const results: {
    market: string;
    pair: (typeof PAIRS)[number]['id'];
    label: string;
    real: Verdict;
    shuffled: Verdict;
    capMean: number;
    status: '통과' | '불통과' | '검증 무효';
  }[] = [];
  const coverage: Record<string, unknown> = {};
  const leakLog: string[] = [];
  let sample: PointDetail | null = null;
  let violations = 0;

  for (const [market, list] of Object.entries(markets)) {
    const members: Member[] = list
      .map((e) => ({ symbol: e.symbol, sector: sectorKo(prof.get(e.symbol)?.sector), cap: e.marketCap ?? prof.get(e.symbol)?.market_cap ?? 0 }))
      .filter((m) => m.sector !== '기타' && m.cap > 0);
    const excludedUnknown = list.length - members.length;
    const calendar = [...new Set(members.flatMap((m) => [...(closes.get(m.symbol)?.keys() ?? [])]))].sort();
    const start = Math.max(63, calendar.length - SPAN);
    const bySector = new Map<string, number>();
    for (const m of members) bySector.set(m.sector, (bySector.get(m.sector) ?? 0) + 1);
    coverage[market] = {
      symbols: members.length,
      excludedUnknown,
      from: calendar[start],
      to: calendar.at(-1),
      tradingDays: calendar.length - start,
      sectors: Object.fromEntries([...bySector].sort((a, b) => b[1] - a[1])),
      sectorsUnder3: [...bySector].filter(([, n]) => n < MIN_MEMBERS).map(([s]) => s),
    };

    for (const [pi, pair] of PAIRS.entries()) {
      const guard = { violations: 0 };
      const points: { diff: number; capDiff: number | null; yearBlock: number; detail: PointDetail }[] = [];
      for (let t = start; t + pair.fwd < calendar.length; t += pair.fwd) {
        const detail = evaluatePoint(members, closes, calendar, t, pair.back, pair.fwd, guard);
        if (!detail) continue;
        points.push({ diff: detail.diff, capDiff: detail.capDiff, yearBlock: Math.min(2, Math.floor((t - start) / 252)), detail });
      }
      violations += guard.violations;
      // 결과 섞기: 시점마다 다음 기간 섹터 수익률을 섹터끼리 뒤바꾼다
      const random = rng(SEED + pi * 10 + (market === 'KR' ? 1 : 0));
      const shuffledPoints = points.map((p) => {
        const nexts = p.detail.sectors.map((s) => s.next as number);
        for (let i = nexts.length - 1; i > 0; i--) {
          const j = Math.floor(random() * (i + 1));
          [nexts[i], nexts[j]] = [nexts[j], nexts[i]];
        }
        const nextOf = new Map(p.detail.sectors.map((s, i) => [s.sector, nexts[i]]));
        const diff = mean(p.detail.top.map((n) => nextOf.get(n)!)) - mean(p.detail.bottom.map((n) => nextOf.get(n)!));
        return { diff, yearBlock: p.yearBlock };
      });
      const real = judge(points, SEED + pi);
      const shuffled = judge(shuffledPoints, SEED + pi + 100);
      results.push({
        market,
        pair: pair.id,
        label: pair.label,
        real,
        shuffled,
        capMean: mean(points.map((p) => p.capDiff).filter((v): v is number => v != null)),
        status: shuffled.pass ? '검증 무효' : real.pass ? '통과' : '불통과',
      });
      if (market === 'US' && pair.id === '1m→1m' && points.length) {
        sample = points[Math.floor(points.length / 2)].detail;
        leakLog.push(
          `US 1m→1m 시점 ${sample.t}: 순위에 쓴 종가 ${sample.pastFrom} ~ ${sample.t} (모두 ≤ t) · 다음 기간 ${sample.t} → ${sample.fwdTo} · 누설 위반 ${guard.violations}건`,
        );
      }
      console.log(`[sector] ${market} ${pair.id}: ${points.length}시점 · 평균 ${round(real.mean)}%p · CI [${round(real.ciLow)}, ${round(real.ciHigh)}] · 연도 +${real.positiveYears}/3 · 섞기 ${shuffled.pass ? '통과(!)' : '불통과'}`);
    }
  }

  const passed = results.filter((r) => r.status === '통과').length;
  const invalid = results.filter((r) => r.status === '검증 무효').length;
  const headline = `6개 중 ${passed}개 통과${passed === 1 ? ' — 우연 가능성 있음' : ''}${invalid ? ` · 검증 무효 ${invalid}개` : ''}`;
  const conclusion =
    passed === 0
      ? '섹터 강세 순위는 설명용으로만 유지한다(판정·자동매매에 연결하지 않는다).'
      : '통과한 조합이 있으나 자동으로 기능에 연결하지 않는다 — 사용자가 결과를 보고 정한다.';

  const { dir, server } = outputDir();
  const stamp = new Date().toISOString().slice(0, 10);
  fs.mkdirSync(dir, { recursive: true });
  const base = path.join(dir, `sector_persistence_${stamp}`);
  const pct = (v: number) => `${v > 0 ? '+' : ''}${round(v, 2)}%p`;
  const md: string[] = [];
  md.push(`# 섹터 강세 지속성 검증 (${server} · ${stamp})`);
  md.push('');
  md.push(`**${headline}.** ${conclusion}`);
  md.push('');
  md.push('| 시장 | 기간 쌍 | 시점 | 평균 차이(상위−하위, 동일 가중) | 95% CI | 연도별 (3구간) | 섞기 | 결과 | 참고: 시총 가중 |');
  md.push('|---|---|---:|---:|---|---|---|---|---:|');
  for (const r of results) {
    md.push(
      `| ${r.market} | ${r.label} | ${r.real.n} | ${pct(r.real.mean)} | [${round(r.real.ciLow, 2)}, ${round(r.real.ciHigh, 2)}] | ${r.real.yearMeans.map((v) => pct(v)).join(' · ')} (+${r.real.positiveYears}/3) | ${r.shuffled.pass ? '⚠️ 통과' : '불통과'} (${pct(r.shuffled.mean)}) | **${r.status}** | ${pct(r.capMean)} |`,
    );
  }
  md.push('');
  md.push('## 사전 등록 (결과를 보기 전에 고정)');
  md.push('- 데이터: universe.json 미국 100 · 국내 100(시장별), 일봉 최근 3년(756거래일), 섹터는 종목 지도 분류("기타" 제외, 3종목 미만 섹터 제외).');
  md.push('- 기간 쌍: 1개월→1개월(21→21) · 3개월→1개월(63→21) · 1주→1주(5→5). 다음 기간이 겹치지 않게 굴린다.');
  md.push('- 섹터 수익률 = 동일 가중(지도의 sectorStats). 상위 1/3 − 하위 1/3 의 다음 기간 수익률 차이.');
  md.push('- 통과(모두): 평균 > 0 · 부트스트랩 2,000회 95% CI 하한 > 0 · 1년 3구간 중 2구간 이상 > 0 · 결과 섞기(시드 고정 1회)에서 통과가 없을 것.');
  md.push('');
  md.push('## 대상');
  for (const [m, c] of Object.entries(coverage)) md.push(`- ${m}: ${JSON.stringify(c)}`);
  md.push('');
  md.push('## 미래 누설 점검');
  md.push(`- 전체 누설 위반 **${violations}건**.`);
  for (const l of leakLog) md.push(`- ${l}`);
  if (sample) {
    md.push('');
    md.push(`### 검산용 한 시점 (US 1m→1m, t = ${sample.t})`);
    md.push('| 섹터 | 종목 수 | 과거 21일 (동일 가중) | 다음 21일 (동일 가중) |');
    md.push('|---|---:|---:|---:|');
    for (const s of sample.sectors) md.push(`| ${s.sector}${sample.top.includes(s.sector) ? ' (상위)' : sample.bottom.includes(s.sector) ? ' (하위)' : ''} | ${s.members} | ${round(s.past, 2)}% | ${s.next == null ? '—' : `${round(s.next, 2)}%`} |`);
    md.push(`- 차이 = 상위 평균 − 하위 평균 = **${pct(sample.diff)}**`);
  }
  md.push('');
  md.push('## 한계');
  md.push('- 생존 편향: 오늘의 시총 상위 100 으로 과거 3년을 본다(그사이 빠진 종목이 없다).');
  md.push('- 현재 섹터 분류로 과거를 본다. 3년은 짧다 — 시점 수가 적은 쌍(1개월)은 신뢰구간이 넓다.');
  md.push('- 이 결과는 기능에 자동으로 연결되지 않는다.');
  fs.writeFileSync(`${base}.md`, md.join('\n'), 'utf8');
  fs.writeFileSync(
    `${base}.json`,
    JSON.stringify({ server, stamp, headline, conclusion, passed, invalid, violations, coverage, results, sample, leakLog, seed: SEED }, null, 2),
    'utf8',
  );
  console.log(`[sector] ${headline}`);
  console.log(`[sector] 리포트: ${base}.md (${Math.round((Date.now() - started) / 1000)}초)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
