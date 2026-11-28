/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
/**
 * 「1280 이상 그대로」 장면 목록 한 곳 — `npm run desktop:test`(`scripts/desktopSelfTest.ts`)가 1280 × 1080 · 1440 × 900 에서 이 장면마다
 * 보이는 요소의 「태그 · 클래스 · 자리 · 크기」 를 재어 정답 파일(`scripts/fixtures/desktop/<크기>/<장면>.json`)과 견준다.
 *
 * - 묶음(`DesktopGroup`)은 v2.83.0 까지 따로 견주던 옛 시험 하나씩이다(`from`) — 그 시험이 쓰던 가짜 응답 · 시계 · 여는 순서 · 재는 함수 · 견주는 꼴을
 *   그대로 옮겼다(옛 시험 목록 `scripts/fixtures/desktop/legacyScenes.json` ⊂ 여기 — `machinecheck:test` 「빠짐 0」).
 * - 새 화면 시험은 1280 · 1440 을 따로 견주지 않고 **여기에 장면을 더한다**(묶음 하나 = 같은 가짜 응답 · 같은 여는 순서).
 * - 정답은 `npm run desktop:test -- --update <장면 정규식>` 으로만 다시 뜬다 — 지시서가 「1280 이 바뀌는 장면」 으로 적은 것만.
 * - 이 파일은 Playwright 를 import 하지 않는다(브라우저 없는 `machinecheck:test` 가 장면 이름을 읽는다 — `checkScope` 가르기). 장면 여는 코드의
 *   `page` 는 시험이 넘기는 Playwright `Page` 다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { noColorLine } from './noColorClass';
import { stockNamesReply } from './stockNamesReply';

const ROOT = path.resolve(import.meta.dirname, '../..');
const json = (rel: string) => JSON.parse(fs.readFileSync(path.join(ROOT, rel), 'utf8'));

export const DESKTOP_SIZES = [
  { width: 1280, height: 1080 },
  { width: 1440, height: 900 },
] as const;
export type DeskSize = (typeof DESKTOP_SIZES)[number];
export const sizeKey = (s: { width: number; height: number }) => `${s.width}x${s.height}`;

/** 화면 여는 코드에 넘기는 Playwright `Page`(이 파일은 Playwright 를 import 하지 않는다 — 위 머리글) */
export type PageLike = any; // eslint-disable-line @typescript-eslint/no-explicit-any
export interface Helpers {
  /** 시간 감시 단계(`browserStepGuard`) */
  step<T>(label: string, fn: () => Promise<T>): Promise<T>;
  /** `designCheck` 자산 장면 하나 열기 · 닫기(홈을 거쳐 before → 주소 → open / Esc · after · 남은 창 닫기) */
  assetScene(page: PageLike, name: string): Promise<void>;
  assetLeave(page: PageLike, name: string): Promise<void>;
}
export type Reply = { status?: number; json?: unknown } | undefined;
/** 가짜 응답 — undefined 면 503 「시험 — 없음」(사용자 서버로 가지 않음) */
export type Api = (u: string, method: string) => Reply;

export interface Step {
  /** 장면 이름(묶음 안에서 하나 · 옛 시험 정답 파일의 이름 그대로) */
  name: string;
  /** 재기 전에 할 일(누르기 · 주소 바꾸기 · 시험 창 띄우기) */
  act?: (page: PageLike, h: Helpers) => Promise<void>;
  /** 잰 뒤 할 일(다음 장면을 위해 닫기) */
  leave?: (page: PageLike, h: Helpers) => Promise<void>;
  /** 이 장면만 다른 재는 함수(창 · 툴팁만 등) */
  snap?: (page: PageLike) => Promise<string[]>;
}
export interface Run {
  hash: string;
  /** 이 페이지만 응답 바꿔치기(먼저 봄) */
  override?: Api;
  steps: Step[];
}
export interface DesktopGroup {
  id: string;
  /** 옛 시험 · 확인 번호 */
  from: { test: string; check: string };
  /** 고정 시계(없으면 실제 시계) */
  fixed?: string;
  api: Api;
  /** 자산 가짜 맥락(`designReviewShots.fakeContext`)을 더함 · 장면 여는 코드의 기본 기다림 8초 */
  assetContext?: boolean;
  /** 페이지 열고 기다림 → 스크롤 막대 감춤 → 기다림 → 장면마다 act → 기다림 → 재기 */
  settle: number;
  afterStyle: number;
  stepWait: number;
  snap: (page: PageLike) => Promise<string[]>;
  /** 견줄 때 한 줄 맞춤(옛 시험 그대로) */
  norm: (line: string) => string;
  /** 장면마다 재기 전 확인(옛 시험이 큰 화면에서 함께 보던 것) */
  checks?: (page: PageLike, size: DeskSize, scene: string) => Promise<{ label: string; ok: boolean; detail?: string }[]>;
  runs: Run[];
}

// ───────── 재는 함수 · 맞춤(옛 시험 그대로) ─────────
/** body 아래 보이는 요소마다 — 클래스 낱말 순서 맞춤 · 폰 · 패드 · 손가락 이름 뺌 · 시계 · 토스트 뺌(149 · 150 · 157 · 158차) */
const bodySnap = (page: PageLike): Promise<string[]> =>
  page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.body.querySelectorAll('*')) {
      if (el.closest('[data-kst-clock], [data-toast-host], script, style')) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const cls = (el.getAttribute('class') ?? '')
        .split(/\s+/)
        .filter((c) => c && !/^(touch:|phone:|pad:)/.test(c) && c !== 'touch-hit' && c !== 'touch-hit-gap')
        .sort()
        .join(' ');
      out.push(`${el.tagName}|${cls}|${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)}`);
    }
    return out;
  });
/** #root 아래 — 148차(같은 맞춤 · 창은 body 아래라 뺌) */
const rootSnap = (page: PageLike): Promise<string[]> =>
  page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll('#root *')) {
      if (el.closest('[data-kst-clock], [data-toast-host]')) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const cls = (el.getAttribute('class') ?? '')
        .split(/\s+/)
        .filter((c) => c && !/^(touch:|phone:|pad:)/.test(c) && c !== 'touch-hit' && c !== 'touch-hit-gap')
        .sort()
        .join(' ');
      out.push(`${el.tagName}|${cls}|${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)}`);
    }
    return out;
  });
/** #root 아래 — 146차(클래스 순서 그대로 · 주 단추 바탕 옛 이름 · 손가락 이름 뺌) */
const frameSnap = (page: PageLike): Promise<string[]> =>
  page.evaluate(() => {
    const out: string[] = [];
    for (const el of document.querySelectorAll('#root *')) {
      if (el.closest('[data-kst-clock], [data-toast-host]')) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) continue;
      const cls = (el.getAttribute('class') ?? '')
        .replace('bg-accent-button text-white hover:bg-accent-button-hover active:bg-accent-button-hover', 'bg-accent text-white hover:bg-accent-hover')
        .replace(/(^|\s)(touch:\S+|touch-hit|touch-hit-gap)(?=\s|$)/g, '$1');
      out.push(`${el.tagName}|${cls}|${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)}`);
    }
    return out;
  });
/** 고른 요소와 그 안 — 147차(창 · 툴팁 · 떠 있는 시계) */
const shapeSnap = (sel: string) => (page: PageLike): Promise<string[]> =>
  page.evaluate((s: string) => {
    const out: string[] = [];
    for (const top of document.querySelectorAll(s)) {
      for (const el of [top, ...top.querySelectorAll('*')]) {
        const r = el.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;
        const cls = (el.getAttribute('class') ?? '').replace(/(^|\s)(touch:\S+|touch-hit|touch-hit-gap)(?=\s|$)/g, '$1').replace(/\s+/g, ' ').trim();
        out.push(`${el.tagName}|${cls}|${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)}`);
      }
    }
    return out;
  }, sel);

const spaceNorm = (x: string) => x.replace(/\s+/g, ' ').replace(/ ?\| ?/g, '|');
const frameNorm = (x: string) => spaceNorm(noColorLine(spaceNorm(x)));

// ───────── 가짜 응답 ─────────
const CLIENT_VERSION = /version: '(v[\d.]+)'/.exec(fs.readFileSync(path.join(ROOT, 'src/data/changelog.ts'), 'utf8'))?.[1] ?? '';
const VERSION = { json: { version: CLIENT_VERSION, startedAt: '2026-11-25T00:00:00.000Z' } };
const NO_WRITE: Reply = { status: 503, json: { error: '시험 — 쓰지 않음' } };

/** 146 · 147차 — 관심 목록 · 시황만(만든 값) */
const FOLDERS = [{ id: 'default', name: '미분류', collapsed: false, symbols: ['AAPL', 'NVDA'] }];
const NAMES: Record<string, string> = { AAPL: '애플', NVDA: '엔비디아' };
const spark = (base: number) => Array.from({ length: 24 }, (_, i) => base + (i % 5) - i * 0.2);
const OVERVIEW = {
  indices: [
    { symbol: '^KS11', label: '코스피', price: 4123.45, change: -56.78, changeRate: -1.36, sparkline: spark(4120) },
    { symbol: '^KQ11', label: '코스닥', price: 912.34, change: 8.12, changeRate: 0.9, sparkline: spark(910) },
    { symbol: '^GSPC', label: 'S&P 500', price: 6850.25, change: 123.45, changeRate: 1.84, sparkline: spark(6840) },
    { symbol: '^IXIC', label: '나스닥', price: 23500.12, change: -1234.56, changeRate: -4.99, sparkline: spark(23490) },
    { symbol: '^DJI', label: '다우존스', price: 47800.55, change: 1234.56, changeRate: 2.65, sparkline: spark(47790) },
  ],
  rate: { baseCurrency: 'USD', quoteCurrency: 'KRW', rate: 1456.78, sparkline: spark(1450) },
};
const watchApi = (putRevision: number): Api => (u, method) => {
  if (u.includes('/api/auth/me')) return { json: { ok: true } };
  if (u.includes('/api/market-overview')) return { json: OVERVIEW };
  if (u.includes('/api/user-data/watchlist')) return { json: { folders: FOLDERS, recent: [], revision: method === 'PUT' ? putRevision : 1, updatedAt: '2026-11-25T00:00:00.000Z' } };
  if (u.includes('/api/stocks/info')) {
    const symbol = new URL(u, 'http://x').searchParams.get('symbol') ?? '';
    return { json: { stock: { symbol, name: NAMES[symbol] ?? symbol, englishName: '', market: 'NASDAQ' } } };
  }
  return undefined;
};
/** 종목 이름 — 기록한 이름 응답을 합쳐 물은 종목만(`lib/stockNamesReply`) */
const namesReply = (api: Record<string, unknown>, u: string): Reply => stockNamesReply(api, u);
/** 기록한 응답 — 주소 그대로(쓰기는 503 · 종목 이름은 `namesReply`) */
const exactApi = (api: Record<string, unknown>): Api => (u, method) => {
  if (method !== 'GET') return NO_WRITE;
  if (u.startsWith('/api/version')) return VERSION;
  const names = namesReply(api, u);
  if (names) return names;
  if (u in api) return { json: api[u] };
  return undefined;
};
/** 기록한 응답 — 주소 그대로 → 같은 경로(쿼리 다름) 첫 것(157 · 158차) */
const fuzzy = (api: Record<string, unknown>, u: string): Reply => {
  const names = namesReply(api, u);
  if (names) return names;
  if (u in api) return { json: api[u] };
  const p = u.split('?')[0];
  const k = Object.keys(api).find((x) => x.split('?')[0] === p);
  return k ? { json: api[k] } : undefined;
};

const ACCOUNT_API: Record<string, unknown> = json('scripts/fixtures/mobileAccount/api.json');
const JUDGE_API: Record<string, unknown> = json('scripts/fixtures/mobileBuyJudge/api.json');
const JUDGE_STATE = json('scripts/fixtures/mobileBuyJudge/state.json').state;
const JUDGE_HIST = json('scripts/fixtures/mobileBuyJudge/history.json');
const CHART_API: Record<string, unknown> = json('scripts/fixtures/mobileChart/api.json');
const TABLE_API: Record<string, unknown> = json('scripts/fixtures/mobileTable/api.json');

/** 증시 일정 견본(158차 — 7일 · 다른 달) */
type CalendarSample = (u: string) => unknown;
let calendarSample: CalendarSample | null = null;
/** `fixtures/mobileSchedAsset/calendarSample.ts` 는 시험이 불러 넣는다(이 파일을 가볍게 — 장면 이름만 읽는 시험이 있다) */
export function setCalendarSample(f: CalendarSample) {
  calendarSample = f;
}

// ───────── 장면 여는 코드 ─────────
const press = async (page: PageLike, h: Helpers, name: string | RegExp, role = 'button') => {
  await h.step(`누르기 ${String(name)}`, () => page.getByRole(role, { name }).first().click({ timeout: 5000 }));
  await page.waitForTimeout(900);
};
const HARNESS = '/scripts/fixtures/mobileTouch/harness.js';
const harness = (page: PageLike, fn: 'mountDialog' | 'unmount' | 'mountParts', opts?: unknown) =>
  page.evaluate(
    async ({ url, fn: f, opts: o }: { url: string; fn: string; opts: unknown }) => {
      const m = await import(/* @vite-ignore */ url);
      m[f](o);
    },
    { url: HARNESS, fn, opts },
  );

/** 158차 자산 장면(`designCheck` 이름) */
const ASSET_SCENES = [
  'asset-기록여러개-미지정',
  'asset-일별변화-표',
  'asset-자산현황-계좌카드',
  'asset-자산현황-종목별-전체',
  'asset-비율조정',
  'asset-이번달구매',
  'asset-이번달구매-살종목',
  'asset-설정창-메뉴-목표비율',
  'asset-설정창-메뉴-코어위성',
  'asset-설정창-메뉴-연금',
  'asset-설정창-메뉴-이번달구매',
  'asset-설정창-메뉴-자산분류색',
  'asset-설정창-메뉴-시트가격',
  'asset-설정창-메뉴-잠금',
  'asset-설정창-현금자동반영',
  'asset-매수창-국내',
  'asset-매도창-처음',
  'asset-새종목-입력창',
];

// ───────── 장면 목록 ─────────
export const DESKTOP_GROUPS: DesktopGroup[] = [
  {
    id: 'frame',
    from: { test: 'mobileframe:test', check: '[146-1]' },
    api: watchApi(2),
    settle: 1500,
    afterStyle: 300,
    stepWait: 0,
    snap: frameSnap,
    norm: frameNorm,
    checks: async (page) => {
      const mode = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--layout-mode').trim());
      return [{ label: '화면 모양 desk', ok: mode === 'desk', detail: mode }];
    },
    runs: [
      { hash: '#/portfolio', steps: [{ name: '계좌 관리' }] },
      {
        hash: '#/portfolio',
        steps: [
          {
            name: '차트',
            act: async (page, h) => {
              await h.step('관심 목록 패널 애플', () => page.getByTestId('watch-panel').getByRole('button', { name: /AAPL/ }).first().click());
              await page.waitForTimeout(1500);
            },
          },
        ],
      },
      { hash: '#/swing', steps: [{ name: '매수 판단' }] },
      { hash: '#/market-brief', steps: [{ name: '오늘 시황' }] },
      { hash: '#/asset', steps: [{ name: '자산 관리' }] },
    ],
  },
  {
    id: 'touch',
    from: { test: 'mobiletouch:test', check: '[147-1]' },
    api: watchApi(1),
    settle: 1500,
    afterStyle: 0,
    stepWait: 0,
    snap: shapeSnap('[data-kst-clock]'),
    norm: noColorLine,
    runs: [
      {
        hash: '#/portfolio',
        steps: [
          { name: '떠 있는 시계', snap: shapeSnap('[data-kst-clock]') },
          {
            name: '창(md)',
            act: async (page) => {
              await harness(page, 'mountDialog', { dirty: false });
              await page.waitForTimeout(400);
            },
            snap: shapeSnap('[role="dialog"][aria-labelledby]'),
            leave: async (page) => {
              await harness(page, 'unmount');
              await page.waitForTimeout(150);
            },
          },
          {
            name: '툴팁',
            act: async (page) => {
              // 가짜 응답 503 의 오류 토스트가 오른쪽 위에 떠 부품을 가린다 — 감춘다
              await page.addStyleTag({ content: '[data-toast-host] { display: none !important; }' });
              await harness(page, 'mountParts');
              await page.waitForTimeout(300);
              await page.mouse.move(0, 0);
              await page.hover('[data-testid="btn-sm"]');
              await page.waitForTimeout(600);
            },
            snap: shapeSnap('[role="tooltip"]'),
          },
        ],
      },
    ],
  },
  {
    id: 'table',
    from: { test: 'mobiletable:test', check: '[148-1]' },
    fixed: '2026-11-25T06:00:00.000Z',
    api: exactApi(TABLE_API),
    settle: 300,
    afterStyle: 4500,
    stepWait: 0,
    snap: rootSnap,
    norm: noColorLine,
    checks: async (page) => {
      const n = await page.locator('[data-scroll-table]').count();
      return [{ label: '화면 모양 desk · 미는 표 상자 없음', ok: n === 0, detail: String(n) }];
    },
    runs: [
      ['계좌 관리 모의', '#/portfolio/paper'],
      ['계좌 관리 실제', '#/portfolio/real'],
      ['자산 관리', '#/asset'],
      ['실시간 순위', '#/ranking'],
      ['매매 규칙', '#/rules'],
      ['매수 판단', '#/swing'],
      ['백테스트 결과', '#/backtest'],
      ['급등 기록', '#/surge/history'],
      ['설정 앱 기능', '#/settings-app'],
    ].map(([name, hash]) => ({ hash, steps: [{ name }] })),
  },
  {
    id: 'account',
    from: { test: 'mobileaccount:test', check: '[149-1]' },
    fixed: '2026-11-26T05:00:00.000Z',
    api: exactApi(ACCOUNT_API),
    settle: 3500,
    afterStyle: 0,
    stepWait: 1500,
    snap: bodySnap,
    norm: noColorLine,
    runs: [
      { hash: '#/portfolio/paper', steps: [{ name: '모의 카드 보기' }] },
      { hash: '#/portfolio/paper', override: (u) => (u === '/api/paper/accounts-view' ? { json: { view: 'list' } } : undefined), steps: [{ name: '모의 목록 보기' }] },
      {
        hash: '#/portfolio/paper',
        steps: [
          {
            name: '모의 계좌를 연 화면',
            act: async (page, h) => {
              await h.step('계좌 열기', () => page.locator('article[role="button"]').first().click({ timeout: 5000 }));
              await page.waitForTimeout(1800);
            },
          },
        ],
      },
      { hash: '#/portfolio/real', steps: [{ name: '실제 계좌' }] },
      { hash: '#/portfolio/paper', steps: [{ name: '새 계좌 창', act: (page, h) => press(page, h, '+ 새 계좌') }] },
      { hash: '#/portfolio/paper', steps: [{ name: '자동매매 설정 창 단계 1', act: (page, h) => press(page, h, '자동매매 처음 켜기') }] },
    ],
  },
  {
    id: 'buyjudge',
    from: { test: 'mobilebuyjudge:test', check: '[150-1]' },
    fixed: '2026-11-26T08:00:00.000Z',
    api: (u, method) => {
      if (method !== 'GET') return NO_WRITE;
      if (u.startsWith('/api/version')) return VERSION;
      if (u === '/api/buy-judge') return { json: JUDGE_STATE };
      if (u === '/api/buy-judge/history') return { json: JUDGE_HIST.history };
      if (u.startsWith('/api/buy-judge/days?')) return { json: JUDGE_HIST.days };
      if (/^\/api\/buy-judge\/history\/[^/?]+$/.test(u)) return { json: JUDGE_HIST.symbolDays };
      const names = namesReply(JUDGE_API, u);
      if (names) return names;
      if (u in JUDGE_API) return { json: JUDGE_API[u] };
      return undefined;
    },
    settle: 3500,
    afterStyle: 0,
    stepWait: 1200,
    snap: bodySnap,
    norm: noColorLine,
    runs: [
      { hash: '#/swing/list', steps: [{ name: '판단 처음' }] },
      {
        hash: '#/swing/list',
        steps: [
          {
            name: '판단 줄 펼침',
            act: async (page, h) => {
              await h.step('첫 줄 펼치기', () => page.locator('[data-buy-judge-table] tbody tr').first().click({ timeout: 5000 }));
              await page.waitForTimeout(900);
            },
          },
        ],
      },
      {
        // v2.84.0 — 목표 바꾸기 창(「목표의 절반으로 자동」 체크 자리 = 150차 전 맨 체크박스와 같게 · 창 안만 잼)
        hash: '#/swing/list',
        steps: [
          {
            name: '목표 바꾸기 창',
            act: async (page, h) => {
              await h.step('첫 줄 펼치기', () => page.locator('[data-buy-judge-table] tbody tr').first().click({ timeout: 5000 }));
              await page.waitForTimeout(900);
              await h.step('조건 바꾸기', () => page.getByRole('button', { name: '조건 바꾸기' }).first().click({ timeout: 5000 }));
              await page.waitForTimeout(900);
            },
            snap: shapeSnap('[role="dialog"]'),
          },
        ],
      },
      {
        hash: '#/swing/history',
        steps: [
          {
            name: '판단 기록 펼침',
            act: async (page, h) => {
              await h.step('첫 날짜 펼치기', () => page.locator('[data-date-group] > button').first().click({ timeout: 5000 }));
              await page.waitForTimeout(600);
              await h.step('종목별 이유 펼치기', () => page.locator('[aria-controls="buy-judge-reasons"]').first().click({ timeout: 5000 }));
              await page.waitForTimeout(600);
              await h.step('첫 종목 펼치기', () => page.locator('#buy-judge-reasons button[aria-expanded]').first().click({ timeout: 5000 }));
              await page.waitForTimeout(1200);
            },
          },
        ],
      },
    ],
  },
  {
    id: 'chart',
    from: { test: 'mobilechart:test', check: '[157-1]' },
    fixed: '2026-11-27T05:00:00.000Z',
    api: (u, method) => {
      if (u.startsWith('/api/auth/me')) return { json: { ok: true } };
      if (u.startsWith('/api/version')) return VERSION;
      if (method === 'POST' && u === '/api/paper/orders') return { json: { pending: true, order: { id: 1 } } };
      if (method !== 'GET') return NO_WRITE;
      return fuzzy(CHART_API, u);
    },
    settle: 2500,
    afterStyle: 0,
    stepWait: 0,
    snap: bodySnap,
    norm: spaceNorm,
    runs: [
      {
        hash: '#/home',
        steps: [
          {
            name: '차트 처음',
            act: async (page, h) => {
              await h.step('애플 고르기', () => page.getByRole('button', { name: /애플/ }).first().click({ timeout: 8000 }));
              await page.waitForTimeout(3500);
            },
          },
          ...['기업정보', '투자자 동향', '뉴스', 'AI 분석'].map((t) => ({
            name: `아래 탭 ${t}`,
            act: async (page: PageLike, h: Helpers) => {
              await h.step(`탭 ${t}`, () => page.getByRole('tab', { name: t, exact: true }).first().click({ timeout: 5000 }));
              await page.waitForTimeout(1500);
            },
          })),
          {
            name: '기업 비교',
            act: async (page, h) => {
              await h.step('기업 비교로', () => page.evaluate(() => (location.hash = '#/compare')));
              await page.waitForTimeout(2000);
            },
          },
        ],
      },
    ],
  },
  {
    id: 'schedasset',
    from: { test: 'mobileschedasset:test', check: '[158-1]' },
    fixed: '2026-11-27T05:00:00.000Z',
    assetContext: true,
    api: (u, method) => {
      if (u.startsWith('/api/auth/me')) return { json: { ok: true } };
      if (u.startsWith('/api/version')) return VERSION;
      if (u.startsWith('/api/calendar?')) {
        if (!calendarSample) throw new Error('증시 일정 견본이 없습니다 — setCalendarSample');
        return { json: calendarSample(u) };
      }
      if (method !== 'GET') return NO_WRITE;
      return fuzzy(CHART_API, u);
    },
    settle: 2500,
    afterStyle: 0,
    stepWait: 0,
    snap: bodySnap,
    norm: spaceNorm,
    runs: [
      {
        hash: '#/calendar',
        steps: [
          { name: '증시 일정' },
          {
            name: '증시 일정 날짜 고르기',
            act: async (page, h) => {
              await h.step('날짜 고르기 열기', () => page.getByRole('button', { name: '2026년 11월', exact: true }).click({ timeout: 5000 }));
              await page.waitForTimeout(600);
            },
            leave: (page) => page.keyboard.press('Escape'),
          },
          ...ASSET_SCENES.map((name) => ({
            name,
            act: (page: PageLike, h: Helpers) => h.assetScene(page, name),
            leave: (page: PageLike, h: Helpers) => h.assetLeave(page, name),
          })),
        ],
      },
    ],
  },
];

/** 장면 하나 — 묶음 · 이름 · 정답 파일 이름 */
export interface SceneRef { group: string; name: string; id: string }
export const sceneId = (group: string, name: string) => `${group}/${name}`;
/** 정답 파일 — `scripts/fixtures/desktop/<크기>/<묶음>__<이름>.json`(빈칸 · `/` 는 `_`) */
export const fixtureFile = (size: { width: number; height: number }, group: string, name: string) =>
  path.join(ROOT, 'scripts/fixtures/desktop', sizeKey(size), `${group}__${name.replace(/[\s/]+/g, '_')}.json`);
export function allScenes(): SceneRef[] {
  return DESKTOP_GROUPS.flatMap((g) => g.runs.flatMap((r) => r.steps.map((s) => ({ group: g.id, name: s.name, id: sceneId(g.id, s.name) }))));
}
