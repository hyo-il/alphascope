/// <reference lib="dom" />
/**
 * 차트 보기 시험(132차 · v2.69.4) — `npm run chartview:test` · ⚠️ `DB_PATH=<사본>` 으로만 돈다(맨 첫 import · DB 는 쓰지 않는다).
 *
 * 132차 지시서 「꼭 지킬 동작」(시험 이름 앞의 [132-n]):
 *   1 크게 확대(일봉 · 봉 10개 안팎 · 이동평균 · 거래량 · 최고 / 최저)해도 가격 축이 보이는 봉의 저가 ~ 고가 근처(0 없음) ·
 *     가장 높은 봉과 낮은 봉의 화면 높이 차이(픽셀) · 가로 확대 · 스크롤 · 종목 바꿈 뒤에도 다시 맞음 · 화면 밖까지 뻗은 드로잉이 축을 넓히지 않음
 *   2 가격 축 위 휠 위 → 축 범위 좁아짐 · 아래 → 넓어짐 · 그림 영역 휠은 가로 확대 그대로 · 축 두 번 누르기 / [초기화] 로 자동 맞춤
 *   3 드로잉 도구마다 — 선택 → 「삭제」 버튼(칸 안) · 선택 → 오른쪽 클릭 → 「삭제」 · 툴바 「선택 삭제」 · Delete 키 · 다른 그림은 남음 · 다시 열어도 없음
 *   4 캔들 · 지표 값 · 거래량 · 최고 / 최저 표시 값 그대로(같은 데이터로 — 넣은 값과 차트 값이 같음 · 그리는 함수 바뀐 줄 0)
 *   5 서버 · 매매 · 주문 · 로그인 코드 · 서버가 함께 쓰는 src · designCheck 판정 부분 바뀐 줄 0(132차 v2.69.4 동안만)
 * 화면은 Vite + Playwright, `/api` 는 모두 `page.route` 가짜(만든 값) — 토스 · 서버 호출 0.
 * 축 범위 · 시리즈 값은 차트 칸 요소의 손잡이(`[data-testid="candle-chart"]` 의 `__chartProbe`)로 잰다.
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { createBrowserStepGuard } from './lib/browserStepGuard';
import { serverSharedSrc } from './lib/serverSharedSrc';

const root = path.resolve(import.meta.dirname, '..');
const PORT = 5198;
const WEB = `http://127.0.0.1:${PORT}`;
const SIZES = [{ width: 1280, height: 1080 }, { width: 1440, height: 900 }];
const BASE = '815ad1c'; // 132차 기준 커밋(v2.69.3)

const guard = createBrowserStepGuard();
let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = '') {
  guard.mark(name);
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? ` — ${detail}` : ''}`);
}
const code = (rel: string) => fs.readFileSync(path.join(root, rel), 'utf8');
const git = (...a: string[]) => execFileSync('git', a, { cwd: root, encoding: 'utf8' });

// ── [132-4] 값을 그리는 함수 바뀐 줄 0 — 캔들 · 지표 · 거래량 · 최고 / 최저 · 현재가 봉 ──
{
  /** `export function 이름(` 부터 다음 맨 앞 `}` 까지 */
  const fnBody = (text: string, name: string) => text.match(new RegExp(`export function ${name}\\([\\s\\S]*?\\n\\}\\n`))?.[0] ?? null;
  const theme = 'src/components/chart/chartTheme.ts';
  const same = ['renderIndicators', 'drawExtremeMarkers', 'extentOf'].map((n) => ({ n, ok: fnBody(code(theme), n) !== null && fnBody(code(theme), n) === fnBody(git('show', `${BASE}:${theme}`), n) }));
  check('[132-4] 지표 · 거래량 그리기(renderIndicators) · 최고 / 최저 표시(drawExtremeMarkers · extentOf) 바뀐 줄 0', same.every((s) => s.ok), JSON.stringify(same));
  const others = git('diff', '--name-only', BASE, '--', 'src/utils/liveCandle.ts', 'src/components/chart/ChartInfoBar.tsx', 'src/hooks/useCandleData.ts', 'src/hooks/useIndicators.ts', 'src/types/chart.ts').trim();
  check('[132-4] 현재가 봉(liveCandle) · 정보 줄(ChartInfoBar) · 캔들 · 지표 받기 · 지표 종류 바뀐 파일 0', others === '', others);
  const candle = git('diff', '-U0', BASE, '--', 'src/components/chart/CandleChart.tsx');
  check('[132-4] 메인 차트의 캔들 넣기(setData) · 현재가 봉(update) 줄 바뀜 0', !/^[-+].*(setData|candleSeries\.update|liveCandle\()/m.test(candle));
}

// ── [132-5] 서버 · 매매 · 주문 · 로그인 · 서버가 함께 쓰는 src · designCheck 판정 부분 바뀐 줄 0(132차 v2.69.4 동안만) ──
{
  const head = code('src/data/changelog.ts').match(/version: '(v[\d.]+)'/)?.[1];
  if (head !== 'v2.69.3' && head !== 'v2.69.4') console.log(`건너뜀  [132-5] 지금 버전 ${head} — 132차(v2.69.4) 범위 시험`);
  else {
    const diff = (...p: string[]) => git('diff', '--name-only', BASE, '--', ...p).trim();
    check(`[132-5] git diff ${BASE} -- server python src/services = 0개`, diff('server', 'python', 'src/services') === '', diff('server', 'python', 'src/services'));
    const shared = serverSharedSrc();
    const CHANGELOG = 'src/data/changelog.ts';
    const touched = diff(...shared.closure.filter((f) => f !== CHANGELOG));
    check(`[132-5] 서버가 함께 쓰는 src ${shared.direct.length}개 + 그 가져오기 파일(전체 ${shared.closure.length}개 · 업데이트 내역 밖) 바뀐 줄 0`, shared.direct.length === 54 && touched === '', `${shared.direct.length} · ${touched}`);
    const cl = git('diff', '-U0', BASE, '--', CHANGELOG).split('\n');
    check('[132-5] 업데이트 내역(changelog.ts)은 맨 앞 항목 더하기만(지운 · 바꾼 줄 0)', cl.filter((l) => /^-(?!--)/.test(l)).length === 0);
    const ops = diff('deploy', 'db', 'scripts/lib/testServerEnv.ts', 'scripts/lib/requireCopyDb.ts', 'scripts/lib/requireTossKeys.ts', '.env.example');
    check('[132-5] 배포 · DB 정의 · 시험 서버 스위치 · 사본 DB 막기 바뀐 파일 0', ops === '', ops);
    const baseDc = git('show', `${BASE}:scripts/designCheck.ts`).split('\n');
    const startT = baseDc.findIndex((l) => l.startsWith('function targets(): Target[] {')) + 1;
    const endT = baseDc.findIndex((l) => l === '  return list;') + 1;
    const hunks = [...git('diff', '-U0', BASE, '--', 'scripts/designCheck.ts').matchAll(/^@@ -(\d+)(?:,(\d+))? /gm)].map((m) => ({ from: Number(m[1]), n: m[2] == null ? 1 : Number(m[2]) }));
    const outside = hunks.filter((h) => h.from <= startT || h.from + Math.max(h.n, 1) - 1 >= endT);
    check(`[132-5] designCheck.ts — 판정 부분(장면 목록 ${startT}~${endT}줄 밖) 바뀐 줄 0(바뀐 덩어리 ${hunks.length}개 모두 장면)`, startT > 0 && endT > startT && outside.length === 0, JSON.stringify(outside));
  }
}

// ── 만든 값(가짜) — 국내 종목 일봉 300개. 마지막 11봉은 사용자 캡처와 같은 띠(1,070,000 ~ 1,587,000) ──
const DAY = 86_400_000;
const T0 = Date.UTC(2025, 8, 1, 6, 30);
type Bar = { timestamp: number; open: number; high: number; low: number; close: number; volume: number };
function makeBars(seed: number, base: number, tail: [number, number] | null): Bar[] {
  let x = seed;
  const rnd = () => ((x = (x * 9301 + 49297) % 233280) / 233280);
  const bars: Bar[] = [];
  for (let i = 0; i < 300; i++) {
    // 기준값 둘레를 천천히 오르내림(이동평균이 봉 근처에 있게)
    const close = base * (1 + 0.12 * Math.sin(i / 17) + (rnd() - 0.5) * 0.04);
    const open = close * (1 + (rnd() - 0.5) * 0.03);
    bars.push({ timestamp: T0 + i * DAY, open, high: Math.max(open, close) * (1 + rnd() * 0.02), low: Math.min(open, close) * (1 - rnd() * 0.02), close, volume: Math.round(2_000_000 + rnd() * 9_000_000) });
  }
  if (tail) {
    // 마지막 15봉: 저가 tail[0] · 고가 tail[1] 이 들어 있는 띠(크게 확대하면 보이는 봉이 모두 이 안)
    const [lo, hi] = tail;
    for (let k = 0; k < 15; k++) {
      const mid = lo + (hi - lo) * (0.3 + 0.4 * ((k * 7) % 5) / 4);
      bars[285 + k] = { ...bars[285 + k], open: mid * 0.99, close: mid * 1.01, high: mid * 1.03, low: mid * 0.97 };
    }
    bars[293] = { ...bars[293], low: lo, open: lo * 1.03, close: lo * 1.05, high: lo * 1.07 };
    bars[296] = { ...bars[296], high: hi, open: hi * 0.95, close: hi * 0.97, low: hi * 0.93 };
  }
  return bars.map((b) => ({ ...b, open: Math.round(b.open), high: Math.round(b.high), low: Math.round(b.low), close: Math.round(b.close) }));
}
const DATA: Record<string, Bar[]> = {
  '000660': makeBars(7, 1_330_000, [1_070_000, 1_587_000]),
  '005930': makeBars(11, 210_000, [180_000, 240_000]),
  // 달러 종목(133차 — 자 정보 「$」 · 소수 둘째). 값은 만든 것
  AAPL: makeBars(5, 230, null).map((b) => ({ ...b })),
};
const sma = (bars: Bar[], n: number) => bars.map((_, i) => (i + 1 < n ? null : bars.slice(i + 1 - n, i + 1).reduce((s, b) => s + b.close, 0) / n));
function indicatorsOf(bars: Bar[]) {
  const nul = bars.map(() => null);
  return { timestamps: bars.map((b) => b.timestamp), sma5: sma(bars, 5), sma20: sma(bars, 20), sma60: sma(bars, 60), sma50: nul, sma120: nul, sma200: nul, ema12: nul, ema26: nul, bbUpper: nul, bbMiddle: nul, bbLower: nul, vwap: nul, rsi14: nul, macd: nul, macdSignal: nul, macdHistogram: nul, stochK: nul, stochD: nul, atr14: nul, obv: nul };
}

// ── 페이지 안에서 재기(손잡이 __chartProbe) ──
type Probe = { chart: import('lightweight-charts').IChartApi; candleSeries: import('lightweight-charts').ISeriesApi<'Candlestick'>; drawings: { getAllDrawings(): { id: string; type: string; anchors: { price: number }[] }[]; getSelectedDrawing(): { id: string; type: string } | null } };
const probe = <T, A = undefined>(page: Page, fn: (p: Probe, arg: A) => T, arg?: A): Promise<T> =>
  page.getByTestId('candle-chart').evaluate((el, [src, a]) => {
    const p = (el as unknown as { __chartProbe: Probe }).__chartProbe;
    return new Function('p', 'a', `return (${src})(p, a)`)(p, a);
  }, [fn.toString(), arg] as const) as Promise<T>;

/**
 * 보이는 봉의 저가 · 고가 · 가격 축 범위 · 두 봉의 화면 높이 차이.
 * `range` = 라이브러리가 자동 맞춤에 쓴 값 범위(칸 여백 · 최고 / 최저 화살표 자리 빼고) — 보이는 봉 · 이동평균만이면 그 둘의 최저 ~ 최고와 같다.
 * 보이는 봉은 가장자리에서 반 칸 걸친 봉을 넣는지에 따라 하나 차이가 나므로 좁게 · 넓게 둘 다 잰다.
 */
const axisState = (page: Page) =>
  probe(page, (p) => {
    const lr = p.chart.timeScale().getVisibleLogicalRange()!;
    const data = p.candleSeries.data() as unknown as { low: number; high: number; time: number }[];
    const ext = (from: number, to: number) => {
      const vis = data.slice(Math.max(0, from), Math.min(data.length - 1, to) + 1);
      const times = new Set(vis.map((d) => d.time));
      const lines = p.chart.panes()[0].getSeries().slice(1).flatMap((s) => (s.data() as unknown as { time: number; value: number }[]).filter((d) => times.has(d.time)).map((d) => d.value));
      return { n: vis.length, lo: Math.min(...vis.map((d) => d.low)), hi: Math.max(...vis.map((d) => d.high)), min: Math.min(...vis.map((d) => d.low), ...lines), max: Math.max(...vis.map((d) => d.high), ...lines) };
    };
    const narrow = ext(Math.ceil(lr.from), Math.floor(lr.to));
    const wide = ext(Math.floor(lr.from), Math.ceil(lr.to));
    const r = p.candleSeries.priceScale().getVisibleRange()!;
    const paneH = p.chart.panes()[0].getHeight();
    const px = Math.abs((p.candleSeries.priceToCoordinate(narrow.lo) ?? 0) - (p.candleSeries.priceToCoordinate(narrow.hi) ?? 0));
    // 축 눈금이 가리키는 맨 아래 · 맨 위 값(칸 위아래 끝)
    const bottom = p.candleSeries.coordinateToPrice(paneH) ?? NaN;
    const top = p.candleSeries.coordinateToPrice(0) ?? NaN;
    return { bars: narrow.n, lo: narrow.lo, hi: narrow.hi, narrow, wide, from: r.from, to: r.to, bottom, top, px, paneH, auto: p.candleSeries.priceScale().options().autoScale, span: lr.to - lr.from, lrFrom: lr.from };
  });
/**
 * 축이 보이는 봉에 맞음 — 칸 맨 아래 값 > 0 · 자동 맞춤 범위 = 보이는 봉 · 이동평균의 최저 ~ 최고(드로잉 · 화면 밖 값이 넓히지 않음) ·
 * 두 봉 높이 차이가 칸의 35% 넘음(최고 / 최저 화살표가 확대할수록 커져 위아래로 최대 51px 씩 자리를 잡는다 — 라이브러리 규칙)
 */
const fits = (s: Awaited<ReturnType<typeof axisState>>) => {
  const near = (v: number, a: number, b: number) => v >= Math.min(a, b) - 1 && v <= Math.max(a, b) + 1;
  return s.bottom > 0 && near(s.from, s.narrow.min, s.wide.min) && near(s.to, s.narrow.max, s.wide.max) && s.px >= s.paneH * 0.35;
};
const fmt = (s: Awaited<ReturnType<typeof axisState>>) => `봉 ${s.bars} · 저 ${Math.round(s.lo)} · 고 ${Math.round(s.hi)} · 맞춤 범위 ${Math.round(s.from)} ~ ${Math.round(s.to)} · 칸 끝 눈금 ${Math.round(s.bottom)} ~ ${Math.round(s.top)} · 높이 차이 ${Math.round(s.px)}/${Math.round(s.paneH)}px`;

const paneBox = (page: Page, index: number) =>
  probe(page, (p, i) => {
    const el = p.chart.panes()[i].getHTMLElement()!.getBoundingClientRect();
    return { x: el.x, y: el.y, w: p.chart.timeScale().width(), h: el.height, axisX: el.x + p.chart.timeScale().width() + 20 };
  }, index);

async function open(browser: Browser, size: { width: number; height: number }, _unused?: undefined, init?: string, symbol = '000660') {
  const ctx = await browser.newContext({ viewport: { width: size.width, height: size.height }, deviceScaleFactor: 1 });
  await ctx.addInitScript('window.__name = (f) => f');
  if (init) await ctx.addInitScript(init);
  // 지표 3개(5 · 20 · 60일선) · 거래량 · 최고 / 최저 — 사용자 캡처 상태(앱 기본 지표)
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 160)));
  await page.route(/\/api\//, (r) => {
    const url = new URL(r.request().url());
    const sym = url.searchParams.get('symbol') ?? '';
    const bars = DATA[sym];
    if (url.pathname === '/api/auth/me') return r.fulfill({ json: { ok: true } });
    if (url.pathname === '/api/candles' && bars) return r.fulfill({ json: url.searchParams.get('before') ? { symbol: sym, timeframe: '1d', candles: [], mock: false } : { symbol: sym, timeframe: '1d', candles: bars, mock: false } });
    if (url.pathname === '/api/indicators' && bars) return r.fulfill({ json: { symbol: sym, timeframe: '1d', indicators: indicatorsOf(bars) } });
    if (url.pathname === '/api/prices' && bars) return r.fulfill({ json: { price: { symbol: sym, close: bars.at(-1)!.close, change: 0, changeRate: 0, volume: 0, fetchedAt: Date.now() }, mock: false } });
    return r.fulfill({ status: 503, json: { error: '시험 — 없음' } });
  });
  await guard.step('페이지 열기', () => page.goto(`${WEB}/#/chart`));
  await choose(page, symbol);
  return { page, ctx, errors };
}

/** 차트 위 종목 검색 칸에 코드를 넣고 Enter — 캔들이 다 들어올 때까지 */
async function choose(page: Page, symbol: string) {
  const input = page.getByPlaceholder('종목명 또는 티커').first();
  await guard.step(`종목 고르기 ${symbol}`, async () => {
    await input.fill(symbol);
    await input.press('Enter');
    await page.getByTestId('candle-chart').waitFor({ timeout: 30_000 });
    await page.waitForFunction(
      ([c]) => {
        const p = (document.querySelector('[data-testid="candle-chart"]') as unknown as { __chartProbe?: Probe })?.__chartProbe;
        const d = p?.candleSeries.data() as { close: number }[] | undefined;
        return !!d && d.length === 300 && Math.abs(d[299].close - c) < 1;
      },
      [DATA[symbol].at(-1)!.close],
      { timeout: 30_000 },
    );
  });
  await page.mouse.move(2, 2);
  await page.waitForTimeout(400);
}

/** 그림 영역 휠로 가로 확대 — 보이는 봉이 `bars` 개 안팎이 될 때까지(마우스는 오른쪽 끝 근처) */
async function zoomTo(page: Page, bars: number) {
  const b = await paneBox(page, 0);
  await page.mouse.move(b.x + b.w * 0.92, b.y + b.h * 0.5);
  for (let i = 0; i < 20 && (await axisState(page)).span > bars + 2; i++) {
    await page.mouse.wheel(0, -100);
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(250);
}

const drawingCount = (page: Page) => probe(page, (p) => p.drawings.getAllDrawings().length);
const selectedType = (page: Page) => probe(page, (p) => p.drawings.getSelectedDrawing()?.type ?? null);

const TOOLS = [
  { label: '수평선', type: 'horizontal-line', clicks: 1 },
  { label: '추세선', type: 'trend-line', clicks: 2 },
  { label: '자', type: 'date-price-range', clicks: 2 },
  { label: '피보나치', type: 'fib-retracement', clicks: 2 },
  { label: '박스', type: 'rectangle', clicks: 2 },
] as const;

/** 도구로 하나 그린다 — 가격 칸 비율 자리(fx, fy) 에서 (gx, gy) 까지 끌기 */
async function draw(page: Page, label: string, clicks: number, from: [number, number], to: [number, number]) {
  const b = await paneBox(page, 0);
  await page.getByRole('radio', { name: label, exact: true }).click();
  const a = { x: b.x + b.w * from[0], y: b.y + b.h * from[1] };
  const c = { x: b.x + b.w * to[0], y: b.y + b.h * to[1] };
  if (clicks === 1) await page.mouse.click(a.x, a.y);
  else {
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(c.x, c.y, { steps: 6 });
    await page.mouse.up();
  }
  await page.waitForTimeout(250);
  // 수평선은 그은 클릭이 그 선 위라 곧바로 선택돼 있다 — 시험마다 선택이 없는 상태에서 시작한다
  await page.mouse.click(b.x + b.w * 0.97, b.y + b.h * 0.97);
  await page.waitForTimeout(700);
}

/** 그 그림을 맞히는 자리(화면 좌표) — 도구마다 그린 자리 안쪽 */
const hitPoint = async (page: Page, label: string) => {
  const b = await paneBox(page, 0);
  return label === '수평선' ? { x: b.x + b.w * 0.6, y: b.y + b.h * 0.3 } : { x: b.x + b.w * 0.4, y: b.y + b.h * 0.45 };
};
const inside = async (page: Page, testOrRole: 'button' | 'menu') => {
  const chart = (await page.getByTestId('candle-chart').boundingBox())!;
  const el = testOrRole === 'button' ? page.getByTestId('drawing-delete') : page.getByRole('menu', { name: '드로잉 메뉴' });
  const r = await el.boundingBox();
  return !!r && r.x >= chart.x && r.y >= chart.y && r.x + r.width <= chart.x + chart.width + 0.5 && r.y + r.height <= chart.y + chart.height + 0.5;
};

// ════════════════════════════════════════════════════════════════════════════════════════════════
// [133-n] 사용자 시나리오 — 사람처럼 마우스로(mouse.move · down · up · 오른쪽 클릭). 앱 안 함수를 부르지 않고,
// 화면에 그려진 글(캔버스 fillText 를 엿봄) · 요소 자리 · 그림 수만 읽는다.
// 132차 시험은 그림을 늘 봉이 있는 가운데(가로 30~60%)에만 그리고, 캔버스 글을 읽지 않았고, 높이 비율을 큰 화면에서 35% 로만 봐서
// 빈 곳에 그린 자(폭 0 · 0 bars · 0 days · $) · 낮은 차트 칸의 납작한 봉을 못 잡았다.
// ════════════════════════════════════════════════════════════════════════════════════════════════
const ONLY = process.env.ONLY;
/** 캔버스에 그린 글을 모은다(페이지 좌표) — 자 정보 · 최고 / 최저 표시 글 · 라이브러리 기본 영어 글을 그대로 본다 */
const CANVAS_SPY = `
  window.__texts = [];
  const fill = CanvasRenderingContext2D.prototype.fillText;
  CanvasRenderingContext2D.prototype.fillText = function (t, x, y, ...rest) {
    const m = this.getTransform();
    const dpr = window.devicePixelRatio || 1;
    window.__texts.push({ t: String(t), x: (m.a * x + m.c * y + m.e) / dpr, y: (m.b * x + m.d * y + m.f) / dpr, c: this.canvas });
    if (window.__texts.length > 4000) window.__texts.splice(0, 2000);
    return fill.call(this, t, x, y, ...rest);
  };
  window.__ctx = [];
  window.addEventListener('contextmenu', (e) => window.__ctx.push(e.defaultPrevented));
`;
type Drawn = { t: string; x: number; y: number };
const clearTexts = (page: Page) => page.evaluate(() => { (window as unknown as { __texts: unknown[] }).__texts.length = 0; });
const texts = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { __texts: { t: string; x: number; y: number; c: HTMLCanvasElement }[] }).__texts.map((r) => {
      const b = r.c.getBoundingClientRect();
      return { t: r.t, x: b.x + r.x, y: b.y + r.y };
    }),
  ) as Promise<Drawn[]>;
const lastCtxPrevented = (page: Page) => page.evaluate(() => (window as unknown as { __ctx: boolean[] }).__ctx.at(-1) ?? null);

/** 화면 좌표 — 봉 번호(논리 자리) → x, 가격 → y (가격 칸 기준 페이지 좌표) */
const geo = (page: Page) =>
  probe(page, (p) => {
    const el = p.chart.panes()[0].getHTMLElement()!.getBoundingClientRect();
    const data = p.candleSeries.data() as unknown as { time: number }[];
    const ts = p.chart.timeScale();
    return { px: el.x, py: el.y, w: ts.width(), h: el.height, bs: ts.options().barSpacing, last: data.length - 1, lastX: el.x + (ts.logicalToCoordinate((data.length - 1) as never) ?? 0) };
  });
const barX = (page: Page, i: number) => probe(page, (p, n) => p.chart.panes()[0].getHTMLElement()!.getBoundingClientRect().x + (p.chart.timeScale().logicalToCoordinate(n as never) ?? NaN), i);

/** 마지막으로 그린 그림의 두 끝점 화면 자리(페이지 좌표) — 그림이 스스로 쓰는 좌표 변환으로(그려진 그대로) */
const lastShape = (page: Page) =>
  probe(page, (p) => {
    const el = p.chart.panes()[0].getHTMLElement()!.getBoundingClientRect();
    const all = p.drawings.getAllDrawings() as unknown as { type: string; anchors: unknown[]; getViewport(): unknown; anchorToPixel(a: unknown, v: unknown): { x: number; y: number } | null }[];
    const d = all.at(-1);
    if (!d) return null;
    const v = d.getViewport();
    const pts = d.anchors.map((a) => d.anchorToPixel(a, v));
    return { type: d.type, pts: pts.map((q) => (q ? { x: el.x + q.x, y: el.y + q.y } : null)) };
  });

/** 끌어 그리기(2점 도구) · 누르기(수평선) — 진짜 마우스. `during` 은 끌고 있는 동안(놓기 전) 부른다 */
async function dragDraw(page: Page, label: string, a: { x: number; y: number }, b: { x: number; y: number }, during?: () => Promise<void>) {
  await page.getByRole('radio', { name: label, exact: true }).click();
  if (label === '수평선') {
    await page.mouse.click(a.x, a.y);
  } else {
    await page.mouse.move(a.x, a.y);
    await page.mouse.down();
    await page.mouse.move(b.x, b.y, { steps: 8 });
    await page.waitForTimeout(150);
    if (during) await during();
    await page.mouse.up();
  }
  await page.waitForTimeout(300);
}

/** 그림이 없는 빈 자리 누르기(선택 풀기) — 가격 칸 왼쪽 아래 구석 */
async function clickBlank(page: Page) {
  const g = await geo(page);
  await page.mouse.click(g.px + 6, g.py + g.h - 6);
  await page.waitForTimeout(650); // 앞 클릭과 0.5초 넘게 띄운다(두 번 누르기로 보지 않게)
}

const KRW_MONEY = /^[+−]₩\d{1,3}(,\d{3})*$/;
const USD_MONEY = /^[+−]\$\d{1,3}(,\d{3})*\.\d{2}$/;
const PCT = /^[+−]\d{1,3}(,\d{3})*\.\d{2}%$/;
const BARS_DAYS = /^(\d+)봉 · (\d+)일$/;
const ENGLISH = /bars|days|\$/;

async function userScenario(browser: Browser) {
  // 낮은 차트 칸(사용자 캡처 — 차트 칸 약 320px): 1280 폭에서 창 높이를 줄여 맞춘다
  // 사용자가 차트 아래 탭을 끌어 높여 둔 상태 = 저장된 아래 탭 높이(앱이 끌기 손잡이로 저장하는 그 값)
  const tabsHeight = (px: number) => `localStorage.setItem('alphascope.chartTabsHeight', '${px}');`;
  let tabs = 420;
  for (let i = 0; i < 2; i++) {
    const tmp = await open(browser, { width: 1280, height: 1080 }, undefined, tabsHeight(tabs));
    const h = (await tmp.page.getByTestId('candle-chart').boundingBox())!.height;
    await tmp.ctx.close();
    tabs = Math.round(tabs + (h - 320));
  }
  const sizes = [{ width: 1280, height: 1080, low: true }, { width: 1280, height: 1080, low: false }, { width: 1440, height: 900, low: false }];

  for (const size of sizes) {
    const tag = size.low ? `낮은 칸 ${size.width}×${size.height}` : `${size.width}×${size.height}`;
    const { page, ctx, errors } = await open(browser, size, undefined, CANVAS_SPY + (size.low ? tabsHeight(tabs) : ''));
    const chartH = (await page.getByTestId('candle-chart').boundingBox())!.height;
    if (size.low) check(`[133-T] ${tag} — 차트 칸 높이 ${Math.round(chartH)}px(사용자 캡처 약 320px · 300~340)`, chartH >= 300 && chartH <= 340, String(chartH));

    // ── 1. 크게 확대 → 보이는 봉 높이 비율 · 최고 / 최저 표시 보임 ──
    await zoomTo(page, 11);
    await clearTexts(page);
    await page.mouse.move(2, 2);
    await page.waitForTimeout(400);
    const z = await axisState(page);
    const ratio = z.px / z.paneH;
    check(`[133-4] ${tag} — 확대(${z.bars}봉) 때 보이는 봉(고가 ~ 저가)이 가격 칸의 ${Math.round(ratio * 100)}% (70% 이상 · ${Math.round(z.px)}/${Math.round(z.paneH)}px)`, ratio >= 0.7, fmt(z));
    {
      const g = await geo(page);
      const t = await texts(page);
      const seen = (s: string) => t.some((r) => r.t.startsWith(s) && r.y - 7 >= g.py && r.y + 7 <= g.py + g.h);
      check(`[133-4] ${tag} — 최고 / 최저 표시 글(₩1,587,000 · ₩1,070,000)이 가격 칸 안에 보임`, seen('₩1,587,000') && seen('₩1,070,000'), JSON.stringify(t.filter((r) => r.t.includes('₩1,')).slice(-4)));
    }

    // ── 2. 자 — 마지막 봉 오른쪽 빈 곳에서 끌어 그리기(사용자 캡처 1 · 2) ──
    // 빈 곳이 봉 5칸 넘게 보이도록 차트를 왼쪽으로 끌어 옮긴다(사람처럼)
    for (let i = 0; i < 4; i++) {
      const gg = await geo(page);
      if (gg.lastX + gg.bs * 5.5 < gg.px + gg.w) break;
      await page.mouse.move(gg.px + gg.w * 0.75, gg.py + gg.h * 0.9);
      await page.mouse.down();
      await page.mouse.move(gg.px + gg.w * 0.25, gg.py + gg.h * 0.9, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(300);
    }
    await page.mouse.move(2, 2);
    await page.waitForTimeout(300);
    const g = await geo(page);
    check(`[133-T] ${tag} — 마지막 봉 오른쪽에 빈 곳(봉 4칸 넘게)이 있음`, g.lastX + g.bs * 4.5 < g.px + g.w, JSON.stringify(g));
    const emptyA = { x: g.lastX + g.bs * 1.5, y: g.py + g.h * 0.35 };
    const emptyB = { x: g.lastX + g.bs * 4.5, y: g.py + g.h * 0.6 };
    let preview: { box: { x: number; y: number; width: number; height: number } | null; text: string } = { box: null, text: '' };
    await dragDraw(page, '자', emptyA, emptyB, async () => {
      const info = page.getByTestId('measure-info');
      preview = { box: (await info.count()) ? await info.boundingBox() : null, text: (await info.count()) ? (await info.innerText()).replace(/\s*\n\s*/g, '|') : '' };
    });
    {
      const b = preview.box;
      check(`[133-1] ${tag} — 그리는 중 자 정보가 커서 오른쪽(커서 x ${Math.round(emptyB.x)} → 상자 왼쪽 ${b ? Math.round(b.x) : '없음'} · 4~24px)`, !!b && b.x >= emptyB.x + 4 && b.x <= emptyB.x + 24 && b.y <= emptyB.y && b.y + b.height >= emptyB.y, JSON.stringify(b));
      const parts = preview.text.split('|');
      const bd = parts[2]?.match(BARS_DAYS);
      check(`[133-1] ${tag} — 그리는 중 글: 원화 「₩」 · 소수 없음 · 등락률 · 「3봉 · 3일」(「${preview.text}」)`, KRW_MONEY.test(parts[0] ?? '') && PCT.test(parts[1] ?? '') && bd?.[1] === '3' && bd?.[2] === '3' && !ENGLISH.test(preview.text), preview.text);
    }
    await clearTexts(page);
    await page.mouse.move(2, 2);
    await page.waitForTimeout(400);
    {
      const s = await lastShape(page);
      const w = s?.pts[0] && s.pts[1] ? Math.abs(s.pts[1].x - s.pts[0].x) : 0;
      check(`[133-2] ${tag} — 빈 곳에 그린 자가 놓은 자리 그대로(폭 ${Math.round(w)}px · 끌어 그은 폭 ${Math.round(emptyB.x - emptyA.x)}px · 시작점 x 차이 ${s?.pts[0] ? Math.round(s.pts[0].x - emptyA.x) : '—'}px)`, !!s?.pts[0] && Math.abs(s.pts[0].x - emptyA.x) <= g.bs * 0.6 && Math.abs(w - (emptyB.x - emptyA.x)) <= g.bs * 0.6, JSON.stringify(s));
      const t = await texts(page);
      const bd = t.find((r) => BARS_DAYS.test(r.t));
      check(`[133-1] ${tag} — 그린 뒤 라이브러리 영어 글(bars · days · $) 0 · 앱 글 「3봉 · 3일」`, !t.some((r) => ENGLISH.test(r.t)) && bd?.t === '3봉 · 3일', JSON.stringify(t.filter((r) => ENGLISH.test(r.t) || /봉|₩/.test(r.t)).map((r) => r.t).slice(0, 8)));
      const money = t.find((r) => /^[+−][₩$]/.test(r.t) && r.t !== '');
      check(`[133-1] ${tag} — 그린 뒤 가격 차 원화 「₩」 · 소수 없음(「${money?.t ?? '없음'}」)`, !!money && KRW_MONEY.test(money.t));
      const endX = s?.pts[1]?.x ?? emptyB.x;
      check(`[133-1] ${tag} — 그린 뒤 정보 자리: 끝점(놓은 자리) 오른쪽 또는 모자라면 왼쪽(글 x ${bd ? Math.round(bd.x) : '—'} · 끝점 ${Math.round(endX)})`, !!bd && (bd.x >= endX + 4 || bd.x <= endX - 4) && Math.abs(bd.x - endX) <= 160);
    }
    await page.getByRole('button', { name: '모두 삭제', exact: true }).click();
    await page.waitForTimeout(300);

    // ── 3. 봉이 있는 곳에서 자 — 마지막 봉 3개 앞 → 마지막 봉 ──
    {
      const g2 = await geo(page);
      const a = { x: await barX(page, g2.last - 3), y: g2.py + g2.h * 0.3 };
      const b = { x: await barX(page, g2.last), y: g2.py + g2.h * 0.55 };
      check(`[133-T] ${tag} — 봉 위 자의 두 봉이 화면 안(${Math.round(a.x)} · ${Math.round(b.x)})`, a.x > g2.px + 4 && b.x < g2.px + g2.w);
      let txt = '';
      await dragDraw(page, '자', a, b, async () => { txt = (await page.getByTestId('measure-info').count()) ? (await page.getByTestId('measure-info').innerText()).replace(/\s*\n\s*/g, '|') : ''; });
      check(`[133-1] ${tag} — 봉 위 자 그리는 중 「3봉 · 3일」(「${txt}」)`, txt.split('|')[2] === '3봉 · 3일' && KRW_MONEY.test(txt.split('|')[0] ?? ''), txt);
      await clearTexts(page);
      await page.mouse.move(2, 2);
      await page.waitForTimeout(400);
      const t = await texts(page);
      check(`[133-1] ${tag} — 봉 위 자 그린 뒤 「3봉 · 3일」 · 영어 글 0`, t.some((r) => r.t === '3봉 · 3일') && !t.some((r) => ENGLISH.test(r.t)), JSON.stringify(t.filter((r) => /봉|bars|days|\$/.test(r.t)).map((r) => r.t).slice(0, 6)));
      await page.getByRole('button', { name: '모두 삭제', exact: true }).click();
      await page.waitForTimeout(300);
    }

    // ── 4 · 5 · 6. 도구 5개 × (빈 곳 · 봉 있는 곳) × (한 번 누름 → 모양 위 「삭제」 · 오른쪽 클릭 → 메뉴 「삭제」) ──
    check(`[133-3] ${tag} — 도구줄 「선택 삭제」 없음 · 「모두 삭제」 있음`, (await page.getByRole('button', { name: '선택 삭제', exact: true }).count()) === 0 && (await page.getByRole('button', { name: '모두 삭제', exact: true }).count()) === 1);
    for (const region of ['빈 곳', '봉 있는 곳'] as const) {
      for (const tool of TOOLS) {
        for (const how of ['누름', '오른쪽 클릭', 'Delete 키'] as const) {
          const g3 = await geo(page);
          const a = region === '빈 곳' ? { x: g3.lastX + g3.bs * 1.5, y: g3.py + g3.h * 0.3 } : { x: await barX(page, g3.last - 4), y: g3.py + g3.h * 0.3 };
          const b = region === '빈 곳' ? { x: g3.lastX + g3.bs * 4.5, y: g3.py + g3.h * 0.6 } : { x: await barX(page, g3.last - 1), y: g3.py + g3.h * 0.6 };
          await dragDraw(page, tool.label, a, b);
          await clickBlank(page);
          const n0 = await drawingCount(page);
          // 누를 자리: 상자 모양(자 · 박스 · 피보나치)은 안쪽 가운데, 추세선은 선 가운데, 수평선은 선 위
          const hit = tool.label === '수평선' ? { x: a.x + 20, y: a.y } : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          const name = `[133-3] ${tag} ${region} ${tool.label} ${how}`;
          if (how === '누름') {
            await page.mouse.click(hit.x, hit.y);
            await page.waitForTimeout(300);
            const btn = page.getByTestId('drawing-delete');
            const box = (await btn.count()) ? await btn.boundingBox() : null;
            const top = tool.label === '수평선' ? a.y : Math.min(a.y, b.y);
            const [l, r] = tool.label === '수평선' ? [g3.px, g3.px + g3.w] : [Math.min(a.x, b.x), Math.max(a.x, b.x)];
            const onTop = !!box && box.y + box.height <= top + box.height + 6 && box.y + box.height >= top - 14 && box.x + box.width >= l - 4 && box.x <= r + 4;
            check(`${name} — 한 번 누르면 선택 · 모양 위(위쪽 가장자리 근처) 「삭제」 버튼(버튼 ${box ? `${Math.round(box.x)},${Math.round(box.y)}` : '없음'} · 모양 위 ${Math.round(top)})`, (await selectedType(page)) === tool.type && onTop && (await inside(page, 'button')), String(await selectedType(page)));
            if (box) await btn.click();
          } else if (how === '오른쪽 클릭') {
            await page.mouse.click(hit.x, hit.y, { button: 'right' });
            await page.waitForTimeout(250);
            const menu = page.getByRole('menu', { name: '드로잉 메뉴' });
            const items = (await menu.count()) ? (await menu.getByRole('menuitem').allTextContents()).join('·') : '';
            check(`${name} — 모양 위 오른쪽 클릭: 그 모양 선택 · 메뉴 「삭제 · 모두 삭제 · 취소」 · 브라우저 메뉴 안 뜸`, (await selectedType(page)) === tool.type && items === '삭제·모두 삭제·취소' && (await lastCtxPrevented(page)) === true, `${await selectedType(page)} · ${items}`);
            if (items) await menu.getByRole('menuitem', { name: '삭제', exact: true }).click();
          } else {
            await page.mouse.click(hit.x, hit.y);
            await page.waitForTimeout(300);
            await page.keyboard.press('Delete');
          }
          await page.waitForTimeout(250);
          check(`${name} — 지워짐(${n0} → ${await drawingCount(page)})`, n0 === 1 && (await drawingCount(page)) === 0);
          if ((await drawingCount(page)) > 0) {
            await page.getByRole('button', { name: '모두 삭제', exact: true }).click();
            await page.waitForTimeout(250);
            if (await page.getByRole('button', { name: '삭제', exact: true }).count()) await page.getByRole('button', { name: '삭제', exact: true }).last().click();
            await page.waitForTimeout(250);
          }
        }
      }
    }
    check(`[133-T] ${tag} — 페이지 오류 0`, errors.length === 0, errors.join(' | '));
    await ctx.close();
  }

  // ── 달러 종목: 「$」 · 소수 둘째 ──
  {
    const { page, ctx } = await open(browser, { width: 1440, height: 900 }, undefined, CANVAS_SPY, 'AAPL');
    await zoomTo(page, 11);
    const g = await geo(page);
    const a = { x: await barX(page, g.last - 4), y: g.py + g.h * 0.3 };
    const b = { x: await barX(page, g.last - 1), y: g.py + g.h * 0.55 };
    let txt = '';
    await dragDraw(page, '자', a, b, async () => { txt = (await page.getByTestId('measure-info').count()) ? (await page.getByTestId('measure-info').innerText()).replace(/\s*\n\s*/g, '|') : ''; });
    check(`[133-1] 달러 종목 — 그리는 중 「$」 · 소수 둘째(「${txt}」)`, USD_MONEY.test(txt.split('|')[0] ?? ''), txt);
    await clearTexts(page);
    await page.mouse.move(2, 2);
    await page.waitForTimeout(400);
    const t = await texts(page);
    const money = t.find((r) => /^[+−][₩$]/.test(r.t));
    check(`[133-1] 달러 종목 — 그린 뒤 「$」 · 소수 둘째(「${money?.t ?? '없음'}」) · bars · days 0`, !!money && USD_MONEY.test(money.t) && !t.some((r) => /bars|days/.test(r.t)));
    await ctx.close();
  }
}

const { createServer } = await import('vite');
const vite = await guard.step('Vite 띄우기', async () => {
  const v = await createServer({ root, configFile: path.join(root, 'vite.config.ts'), logLevel: 'error', server: { host: '127.0.0.1', port: PORT, strictPort: true, hmr: false } });
  await v.listen();
  return v;
});
const browser = await guard.step('브라우저 띄우기', () => chromium.launch({ channel: 'chrome' }));
try {
  await userScenario(browser);
  for (const size of ONLY === '133' ? [] : SIZES) {
    const w = size.width;

    // ── [132-1] 확대 · [132-4] 값 ──
    {
      const { page, ctx, errors } = await open(browser, size);
      const vals = await probe(page, (p) => ({
        candles: (p.candleSeries.data() as unknown as { open: number; high: number; low: number; close: number }[]).map((d) => [d.open, d.high, d.low, d.close]),
        lines: p.chart.panes()[0].getSeries().slice(1).map((s) => (s.data() as unknown as { value: number }[]).map((d) => d.value)),
        volume: (p.chart.panes()[1]?.getSeries()[0]?.data() as unknown as { value: number }[] | undefined)?.map((d) => d.value) ?? [],
      }));
      const bars = DATA['000660'];
      const ma = [sma(bars, 5), sma(bars, 20), sma(bars, 60)].map((l) => l.filter((v): v is number => v != null));
      check(`[132-4] ${w}px — 캔들 300개 값 = 넣은 값(시가 · 고가 · 저가 · 종가)`, JSON.stringify(vals.candles) === JSON.stringify(bars.map((b) => [b.open, b.high, b.low, b.close])));
      check(`[132-4] ${w}px — 이동평균 3줄(5 · 20 · 60일선) 값 = 넣은 값 · 거래량 300개 = 넣은 값`, vals.lines.length === 3 && vals.lines.every((l, i) => l.length === ma[i].length && l.every((v, j) => Math.abs(v - ma[i][j]) < 1e-6)) && JSON.stringify(vals.volume) === JSON.stringify(bars.map((b) => b.volume)), `${vals.lines.length}줄 · 거래량 ${vals.volume.length}`);

      // 사용자가 그렸을 법한 드로잉 — 거래량 칸까지 끈 자(앵커 가격이 칸 아래 = 축이 0 근처로 넓어지던 원인) · 옛 구간 추세선
      const b0 = await paneBox(page, 0);
      const b1 = await paneBox(page, 1);
      await page.getByRole('radio', { name: '자', exact: true }).click();
      await page.mouse.move(b0.x + b0.w * 0.3, b0.y + b0.h * 0.2);
      await page.mouse.down();
      await page.mouse.move(b0.x + b0.w * 0.5, b1.y + b1.h * 0.9, { steps: 6 });
      await page.mouse.up();
      await page.waitForTimeout(300);
      await draw(page, '추세선', 2, [0.05, 0.05], [0.35, 0.95]);
      const anchors = await probe(page, (p) => p.drawings.getAllDrawings().flatMap((d) => d.anchors.map((a) => a.price)));
      check(`[132-1] ${w}px — 화면 밖까지 뻗은 드로잉 2개(앵커 최저 ${Math.round(Math.min(...anchors))} — 거래량 칸 아래)`, anchors.length === 4 && Math.min(...anchors) < 1_000_000, JSON.stringify(anchors.map(Math.round)));

      await zoomTo(page, 11);
      const zoomed = await axisState(page);
      check(`[132-1] ${w}px — 크게 확대(${zoomed.bars}봉): 가격 축이 보이는 봉의 저가 ~ 고가 근처 · 0 없음(${fmt(zoomed)})`, zoomed.bars >= 9 && zoomed.bars <= 14 && fits(zoomed) && zoomed.auto, fmt(zoomed));
      check(`[132-1] ${w}px — 가장 높은 봉과 낮은 봉의 화면 높이 차이 ${Math.round(zoomed.px)}px(가격 칸 ${Math.round(zoomed.paneH)}px 의 35% 넘음 · 고치기 전 사용자 캡처는 약 16%)`, zoomed.px >= zoomed.paneH * 0.35, fmt(zoomed));
      check(`[132-1] ${w}px — 사용자 캡처 띠(1,070,000 ~ 1,587,000)가 보이는 봉의 저 · 고`, zoomed.lo === 1_070_000 && zoomed.hi === 1_587_000, fmt(zoomed));

      // 스크롤(끌기) — 왼쪽으로 옮겨도 다시 맞음
      await page.mouse.move(b0.x + b0.w * 0.6, b0.y + b0.h * 0.8);
      await page.mouse.down();
      await page.mouse.move(b0.x + b0.w * 0.95, b0.y + b0.h * 0.8, { steps: 8 });
      await page.mouse.up();
      await page.waitForTimeout(300);
      const panned = await axisState(page);
      check(`[132-1] ${w}px — 끌어 옮긴 뒤(앞 ${Math.round(zoomed.lrFrom - panned.lrFrom)}봉)에도 다시 맞음(${fmt(panned)})`, panned.lrFrom < zoomed.lrFrom - 1.5 && fits(panned), fmt(panned));
      // 더 넓게(가로 축소) — 다시 맞음
      await page.mouse.move(b0.x + b0.w * 0.5, b0.y + b0.h * 0.5);
      await page.mouse.wheel(0, 100);
      await page.waitForTimeout(300);
      const wider = await axisState(page);
      check(`[132-1] ${w}px — 가로 축소 뒤(${wider.bars}봉)에도 다시 맞음(${fmt(wider)})`, wider.bars > panned.bars && fits(wider), fmt(wider));

      // 종목 바꿈 — 다른 가격대(20만 원대)로 다시 맞음 · 드로잉은 종목별이라 지워짐
      await choose(page, '005930');
      await zoomTo(page, 11);
      const other = await axisState(page);
      check(`[132-1] ${w}px — 종목 바꿈 뒤(005930 · ${other.bars}봉)에도 다시 맞음(${fmt(other)})`, other.hi === 240_000 && fits(other) && (await drawingCount(page)) === 0, fmt(other));
      check(`[132-1] [132-4] ${w}px — 페이지 오류 0`, errors.length === 0, errors.join(' | '));
      await ctx.close();
    }

    // ── [132-2] 가격 축 휠 ──
    {
      const { page, ctx, errors } = await open(browser, size);
      await zoomTo(page, 30);
      const b0 = await paneBox(page, 0);
      const before = await axisState(page);
      const midY = b0.y + b0.h * 0.5;
      const priceUnder = () => probe(page, (p, y) => p.candleSeries.coordinateToPrice(y)!, b0.h * 0.5);
      const p0 = await priceUnder();
      await page.mouse.move(b0.axisX, midY);
      await page.mouse.wheel(0, -100);
      await page.waitForTimeout(250);
      const up = await axisState(page);
      const p1 = await priceUnder();
      check(`[132-2] ${w}px — 가격 축 위 휠 위: 축 범위 좁아짐(${Math.round(before.top - before.bottom)} → ${Math.round(up.top - up.bottom)}) · 막대 커짐(${Math.round(before.px)} → ${Math.round(up.px)}px) · 자동 맞춤 꺼짐`, up.top - up.bottom < (before.top - before.bottom) * 0.8 && up.px > before.px * 1.2 && !up.auto, `${fmt(before)} → ${fmt(up)}`);
      check(`[132-2] ${w}px — 마우스 아래 가격 제자리(${Math.round(p0)} → ${Math.round(p1)} · 1px 안)`, Math.abs(p1 - p0) <= (up.top - up.bottom) / up.paneH, `${p0} → ${p1}`);
      check(`[132-2] ${w}px — 가격 축 휠은 가로(보이는 봉)를 바꾸지 않음`, Math.abs(up.span - before.span) < 1e-6);
      await page.mouse.wheel(0, 100);
      await page.mouse.wheel(0, 100);
      await page.waitForTimeout(250);
      const down = await axisState(page);
      check(`[132-2] ${w}px — 가격 축 위 휠 아래: 축 범위 넓어짐(${Math.round(up.top - up.bottom)} → ${Math.round(down.top - down.bottom)}) · 막대 작아짐`, down.top - down.bottom > (up.top - up.bottom) * 1.5 && down.px < up.px, fmt(down));
      // 트랙패드 — 작은 움직임 여러 번이 조금씩
      const tp0 = await axisState(page);
      for (let i = 0; i < 5; i++) await page.mouse.wheel(0, -4);
      await page.waitForTimeout(250);
      const tp = await axisState(page);
      const ratio = (tp.top - tp.bottom) / (tp0.top - tp0.bottom);
      check(`[132-2] ${w}px — 트랙패드 작은 움직임 5번 = 조금씩 늘어남(범위 ×${ratio.toFixed(2)})`, ratio < 0.99 && ratio > 0.75, String(ratio));
      // 그림 영역 휠 = 가로 확대 그대로(세로 범위는 축 휠로 정한 그대로)
      await page.mouse.move(b0.x + b0.w * 0.5, midY);
      await page.mouse.wheel(0, -100);
      await page.waitForTimeout(250);
      const plot = await axisState(page);
      check(`[132-2] ${w}px — 그림 영역 휠: 가로 확대(${tp.span.toFixed(1)} → ${plot.span.toFixed(1)}봉) · 세로는 그대로`, plot.span < tp.span * 0.8 && Math.abs(plot.top - tp.top) < 1 && Math.abs(plot.bottom - tp.bottom) < 1, `${tp.span} → ${plot.span}`);
      // 시간 축 위 휠 = 가로 확대 그대로
      const tAxisY = (await page.getByTestId('candle-chart').boundingBox())!;
      await page.mouse.move(b0.x + b0.w * 0.5, tAxisY.y + tAxisY.height - 8);
      await page.mouse.wheel(0, 100);
      await page.waitForTimeout(250);
      const tAxis = await axisState(page);
      check(`[132-2] ${w}px — 아래 시간 축 위 휠: 가로(${plot.span.toFixed(1)} → ${tAxis.span.toFixed(1)}봉)만 바뀜`, tAxis.span > plot.span * 1.2 && Math.abs(tAxis.top - plot.top) < 1, `${plot.span} → ${tAxis.span}`);
      // 거래량 칸 축 위 휠 — 그 칸만
      const b1 = await paneBox(page, 1);
      const volBefore = await probe(page, (p) => p.chart.panes()[1].getSeries()[0].priceScale().getVisibleRange());
      await page.mouse.move(b1.axisX, b1.y + b1.h * 0.5);
      await page.mouse.wheel(0, -100);
      await page.waitForTimeout(250);
      const volAfter = await probe(page, (p) => p.chart.panes()[1].getSeries()[0].priceScale().getVisibleRange());
      const priceAfterVol = await axisState(page);
      check(`[132-2] ${w}px — 거래량 칸 축 위 휠: 거래량 축만 좁아짐 · 가격 축 그대로`, !!volBefore && !!volAfter && volAfter.to - volAfter.from < (volBefore.to - volBefore.from) * 0.8 && Math.abs(priceAfterVol.top - tAxis.top) < 1, JSON.stringify({ volBefore, volAfter }));
      // 가격 축 두 번 누르기 = 자동 맞춤
      await page.mouse.dblclick(b0.axisX, midY);
      await page.waitForTimeout(300);
      const dbl = await axisState(page);
      check(`[132-2] ${w}px — 가격 축 두 번 누르기: 자동 맞춤으로 돌아옴(${fmt(dbl)})`, dbl.auto && fits(dbl), fmt(dbl));
      // 다시 늘린 뒤 [초기화] = 자동 맞춤(거래량 칸까지) · 확대 · 위치 처음으로
      await page.mouse.move(b0.axisX, midY);
      await page.mouse.wheel(0, -100);
      await page.waitForTimeout(200);
      await page.getByRole('button', { name: '초기화', exact: true }).click();
      await page.waitForTimeout(300);
      const reset = await axisState(page);
      const volAuto = await probe(page, (p) => p.chart.panes()[1].getSeries()[0].priceScale().options().autoScale);
      check(`[132-2] ${w}px — [초기화]: 가격 · 거래량 축 모두 자동 맞춤(${fmt(reset)})`, reset.auto && volAuto && fits(reset), fmt(reset));
      check(`[132-2] ${w}px — 페이지 오류 0`, errors.length === 0, errors.join(' | '));
      await ctx.close();
    }

    // ── [132-3] 드로잉 삭제 — 도구마다 ──
    {
      const { page, ctx, errors } = await open(browser, size);
      const b0 = await paneBox(page, 0);
      // 남아 있어야 하는 다른 그림 — 수평선(칸 아래쪽)
      await draw(page, '수평선', 1, [0.6, 0.88], [0.6, 0.88]);
      const keepId = await probe(page, (p) => p.drawings.getAllDrawings()[0]?.id ?? '');
      const others = async () => probe(page, (p, id) => p.drawings.getAllDrawings().some((d) => d.id === id), keepId);

      // 툴바가 1280 에서도 한 줄(「선택 삭제」 · 「모두 삭제」 · 「초기화」 · 봉 단위가 같은 줄)
      const tops = await Promise.all([
        page.getByRole('radiogroup', { name: '봉 단위' }),
        page.getByRole('button', { name: '선택 삭제', exact: true }),
        page.getByRole('button', { name: '모두 삭제', exact: true }),
        page.getByRole('button', { name: '초기화', exact: true }),
      ].map(async (l) => { const r = (await l.boundingBox())!; return Math.round(r.y + r.height / 2); }));
      check(`[132-3] ${w}px — 툴바 한 줄(봉 단위 · 선택 삭제 · 모두 삭제 · 초기화 가운데 높이 ${[...new Set(tops)].join(' · ')})`, Math.max(...tops) - Math.min(...tops) <= 1, JSON.stringify(tops));
      check(`[132-3] ${w}px — 고른 그림이 없으면 툴바 「선택 삭제」 꺼짐`, await page.getByRole('button', { name: '선택 삭제', exact: true }).isDisabled());

      for (const tool of TOOLS) {
        const t = tool.label;
        const redraw = () => draw(page, t, tool.clicks, [0.3, 0.3], [0.5, 0.6]);
        const target = async () => probe(page, (p, a) => p.drawings.getAllDrawings().filter((d) => d.type === a.type && d.id !== a.keep).length, { type: tool.type, keep: keepId });

        // ① 누르면 선택 + 「삭제」 버튼(칸 안) — 앞 클릭에서 0.2초 안에 다시 눌러도(못 맞혀 곧바로 다시 누르는 경우)
        await redraw();
        const hp = await hitPoint(page, t);
        await page.mouse.click(b0.x + b0.w * 0.9, b0.y + b0.h * 0.1);
        await page.waitForTimeout(200);
        await page.mouse.click(hp.x, hp.y);
        await page.waitForTimeout(250);
        const btn = page.getByTestId('drawing-delete');
        check(`[132-3] ${w}px ${t} — 앞 클릭 0.2초 뒤 눌러도 선택 · 「삭제」 버튼 보임(차트 칸 안)`, (await selectedType(page)) === tool.type && (await btn.isVisible()) && (await inside(page, 'button')), String(await selectedType(page)));
        check(`[132-3] ${w}px ${t} — 고르면 툴바 「선택 삭제」 켜짐`, await page.getByRole('button', { name: '선택 삭제', exact: true }).isEnabled());
        await btn.click();
        await page.waitForTimeout(250);
        check(`[132-3] ${w}px ${t} — 「삭제」 버튼: 그것만 지워짐 · 다른 그림 남음`, (await target()) === 0 && (await others()) && !(await btn.isVisible()));

        // ② 선택 → 빈 곳 오른쪽 클릭 → 메뉴 「삭제」
        await redraw();
        await page.mouse.click(hp.x, hp.y);
        await page.waitForTimeout(250);
        await page.mouse.click(b0.x + b0.w * 0.85, b0.y + b0.h * 0.12, { button: 'right' });
        const menu = page.getByRole('menu', { name: '드로잉 메뉴' });
        const menuOpen = await menu.isVisible();
        check(`[132-3] ${w}px ${t} — 선택한 뒤 빈 곳 오른쪽 클릭: 메뉴(삭제 · 모두 삭제 · 취소) · 칸 안`, menuOpen && (await menu.getByRole('menuitem').allTextContents()).join('·') === '삭제·모두 삭제·취소' && (await inside(page, 'menu')));
        check(`[132-3] ${w}px ${t} — 메뉴가 열린 동안 떠 있는 「삭제」 버튼은 숨김(메뉴와 겹치지 않게)`, !(await btn.isVisible()));
        await menu.getByRole('menuitem', { name: '삭제', exact: true }).click();
        await page.waitForTimeout(250);
        check(`[132-3] ${w}px ${t} — 메뉴 「삭제」: 그것만 지워짐 · 다른 그림 남음 · 메뉴 닫힘`, (await target()) === 0 && (await others()) && !(await menu.isVisible()));

        // ③ 그림 위 오른쪽 클릭(선택 안 된 채) → 그것을 고르고 메뉴 → 「삭제」
        await redraw();
        await page.mouse.click(hp.x, hp.y, { button: 'right' });
        await page.waitForTimeout(200);
        check(`[132-3] ${w}px ${t} — 그림 위 오른쪽 클릭: 그것을 고르고 메뉴`, (await selectedType(page)) === tool.type && (await menu.isVisible()));
        await menu.getByRole('menuitem', { name: '삭제', exact: true }).click();
        await page.waitForTimeout(250);
        check(`[132-3] ${w}px ${t} — 그 메뉴 「삭제」 로 지워짐 · 다른 그림 남음`, (await target()) === 0 && (await others()));

        // ④ 툴바 「선택 삭제」
        await redraw();
        await page.mouse.click(hp.x, hp.y);
        await page.waitForTimeout(250);
        await page.getByRole('button', { name: '선택 삭제', exact: true }).click();
        await page.waitForTimeout(250);
        check(`[132-3] ${w}px ${t} — 툴바 「선택 삭제」: 그것만 지워짐 · 다른 그림 남음 · 버튼 다시 꺼짐`, (await target()) === 0 && (await others()) && (await page.getByRole('button', { name: '선택 삭제', exact: true }).isDisabled()));

        // ⑤ Delete 키 · ⑥ Backspace 키
        for (const key of ['Delete', 'Backspace']) {
          await redraw();
          await page.mouse.click(hp.x, hp.y);
          await page.waitForTimeout(250);
          await page.keyboard.press(key);
          await page.waitForTimeout(250);
          check(`[132-3] ${w}px ${t} — ${key} 키: 그것만 지워짐 · 다른 그림 남음`, (await target()) === 0 && (await others()));
        }
      }

      // 메뉴 닫기 — Esc · 바깥 누르기 · 휠
      const menu = page.getByRole('menu', { name: '드로잉 메뉴' });
      const keepHit = { x: b0.x + b0.w * 0.6, y: b0.y + b0.h * 0.88 };
      const closes: [string, () => Promise<void>][] = [
        ['Esc', () => page.keyboard.press('Escape')],
        ['바깥 누르기', () => page.mouse.click(5, 5)],
        ['휠', async () => { await page.mouse.move(b0.x + b0.w * 0.5, b0.y + b0.h * 0.5); await page.mouse.wheel(0, 40); }],
      ];
      for (const [name, act] of closes) {
        await page.waitForTimeout(600);
        await page.mouse.click(keepHit.x, keepHit.y, { button: 'right' });
        await page.waitForTimeout(200);
        const opened = await menu.isVisible();
        await act();
        await page.waitForTimeout(250);
        check(`[132-3] ${w}px — 메뉴는 ${name}에 닫힘(그림은 남음)`, opened && !(await menu.isVisible()) && (await others()));
      }
      // 화면 끝 — 오른쪽 아래 끝에서 연 메뉴 · 왼쪽 위 끝에서 고른 「삭제」 버튼도 칸 안
      await page.mouse.click(5, 5);
      await draw(page, '추세선', 2, [0.005, 0.02], [0.99, 0.97]);
      const edgeId = await probe(page, (p) => p.drawings.getAllDrawings().find((d) => d.type === 'trend-line')?.id ?? '');
      await page.mouse.click(b0.x + b0.w * 0.006, b0.y + b0.h * 0.025);
      await page.waitForTimeout(250);
      check(`[132-3] ${w}px — 왼쪽 위 끝에서 고른 그림의 「삭제」 버튼도 칸 안(잘리지 않음)`, (await page.getByTestId('drawing-delete').isVisible()) && (await inside(page, 'button')));
      await page.mouse.click(b0.x + b0.w * 0.985, b0.y + b0.h * 0.96, { button: 'right' });
      await page.waitForTimeout(250);
      check(`[132-3] ${w}px — 오른쪽 아래 끝에서 연 메뉴도 칸 안(누른 자리 반대쪽으로)`, (await menu.isVisible()) && (await inside(page, 'menu')));
      await page.keyboard.press('Escape');
      await probe(page, (p, id) => (p.drawings as unknown as { removeDrawing(id: string): void }).removeDrawing(id), edgeId);

      // 입력 칸에 글자를 쓰는 중이면 Delete · Backspace 로 그림을 지우지 않음
      await page.mouse.click(keepHit.x + 40, keepHit.y);
      await page.waitForTimeout(250);
      const sel = await selectedType(page);
      const input = page.getByPlaceholder('종목명 또는 티커').first();
      await input.click();
      await input.press('End');
      await input.press('Backspace');
      await input.press('Delete');
      check(`[132-3] ${w}px — 입력 칸에서 Backspace · Delete 는 그림을 지우지 않음`, sel === 'horizontal-line' && (await others()), String(sel));

      // 다시 열어도 없음 — 다 지운 뒤 새로 열기(지운 그림이 되살아나지 않음)
      await page.getByRole('button', { name: '모두 삭제', exact: true }).click();
      await page.waitForTimeout(250);
      const zero = await drawingCount(page);
      await page.reload();
      await choose(page, '000660');
      check(`[132-3] ${w}px — 지운 뒤 다시 열어도 그림 없음(${zero} → ${await drawingCount(page)})`, zero === 0 && (await drawingCount(page)) === 0);
      check(`[132-3] ${w}px — 페이지 오류 0`, errors.length === 0, errors.join(' | '));
      await ctx.close();
    }
  }
} finally {
  await guard.step('브라우저 닫기', () => browser.close());
  await guard.step('Vite 닫기', () => vite.close());
  guard.stop();
}
console.log(`\n차트 보기 시험 — 통과 ${pass} · 실패 ${fail}`);
process.exit(fail ? 1 : 0);
