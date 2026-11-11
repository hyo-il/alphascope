/**
 * 일별 자산 변화 화면 시험(134차 · v2.70.0) — `npm run assetdailyui:test` · ⚠️ `DB_PATH=<사본>` 으로만 돈다(맨 첫 import).
 *
 * 134차 지시서 「꼭 지킬 동작」 5(화면 · 1280 × 1080 · 1440 × 900)를 확인한다(시험 이름 앞의 [134-5]) · 4 의 화면 쪽(잠금 · 실패 안내)은 [134-4].
 * Vite + Playwright, `/api` 는 모두 `page.route` 가짜(만든 값) — 구글 · 토스 · 서버 호출 0. 요소는 역할 + 이름 · `data-testid` 로 찾는다.
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import 'dotenv/config';
import path from 'node:path';
import { chromium, type Browser, type Page } from 'playwright';
import { assetHistorySample, assetSheetSample, assetStatusSample, assetSummarySample } from './fixtures/asset/screenSample';
import { formatAssetWon, formatAssetWonSigned } from '../src/utils/assetFormat';
import { createBrowserStepGuard } from './lib/browserStepGuard';

const root = path.resolve(import.meta.dirname, '..');
const PORT = 5199;
const WEB = `http://127.0.0.1:${PORT}`;

const guard = createBrowserStepGuard();
let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = '') {
  guard.mark(name);
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? ` — ${detail}` : ''}`);
}

type History = ReturnType<typeof assetHistorySample>;
interface Opts {
  size: { width: number; height: number };
  /** 기간 · 연금 포함 → 응답(기본: 30줄) */
  history?: (range: string, pension: string) => History;
  /** 하루 기록 응답을 막아 두었다가 푼다(로딩 표시) */
  holdHistory?: boolean;
  /** PUT daily-note 응답 */
  note?: { status: number; json: unknown };
  holdNote?: boolean;
}

async function open(browser: Browser, o: Opts) {
  const ctx = await browser.newContext({ viewport: o.size });
  await ctx.addInitScript(() => {
    localStorage.setItem('alphascope.asset.tab', 'total');
    localStorage.setItem('alphascope.asset.includePension', '1');
  });
  const page = await ctx.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)));
  const seen = { historyUrls: [] as string[], noteBodies: [] as Record<string, unknown>[] };
  const gates = { history: () => {}, note: () => {} };
  let historyGate = new Promise<void>((ok) => (gates.history = ok));
  const noteGate = new Promise<void>((ok) => (gates.note = ok));
  let locked = false;
  await page.route(/\/api\/(?!asset\/)/, (r) => (r.request().url().includes('/api/auth/me') ? r.fulfill({ json: { ok: true } }) : r.fulfill({ status: 503, json: { error: '시험 — 없음' } })));
  await page.route('**/api/asset/status', (r) => r.fulfill({ json: assetStatusSample(!locked) }));
  await page.route('**/api/asset/touch', (r) => r.fulfill({ json: { ok: true, lockMinutes: 30, remainingMs: 30 * 60_000 } }));
  await page.route('**/api/asset/sheet', (r) => r.fulfill({ json: assetSheetSample() }));
  await page.route('**/api/asset/summary**', (r) => r.fulfill({ json: assetSummarySample({ pension: true }) }));
  await page.route('**/api/asset/history**', async (r) => {
    const u = new URL(r.request().url());
    seen.historyUrls.push(u.search);
    if (o.holdHistory) await historyGate;
    await r.fulfill({ json: (o.history ?? (() => assetHistorySample(30)))(u.searchParams.get('range') ?? '', u.searchParams.get('pension') ?? '') });
  });
  await page.route('**/api/asset/daily-note', async (r) => {
    seen.noteBodies.push(JSON.parse(r.request().postData() ?? '{}') as Record<string, unknown>);
    if (o.holdNote) await noteGate;
    const res = o.note ?? { status: 200, json: { day: 'x', note: (JSON.parse(r.request().postData() ?? '{}') as { note: string }).note.trim() || null } };
    if (res.status === 403) locked = true;
    await r.fulfill(res);
  });
  await guard.step('페이지 열기(#/asset)', () => page.goto(`${WEB}/#/asset`));
  return {
    page,
    ctx,
    errors,
    seen,
    releaseHistory: () => {
      gates.history();
      historyGate = new Promise<void>((ok) => (gates.history = ok));
    },
    releaseNote: () => gates.note(),
  };
}
const table = (page: Page) => page.getByTestId('asset-daily-table');
const rowButtons = (page: Page) => table(page).getByRole('button', { name: /자세히 보기$/ });
const waitTable = (page: Page) => guard.step('표 기다리기', () => rowButtons(page).first().waitFor({ timeout: 30_000 }));

const { createServer } = await import('vite');
const vite = await guard.step('Vite 띄우기', async () => {
  const v = await createServer({ root, configFile: path.join(root, 'vite.config.ts'), logLevel: 'error', server: { host: '127.0.0.1', port: PORT, strictPort: true, hmr: false } });
  await v.listen();
  return v;
});
const browser = await guard.step('브라우저 띄우기', () => chromium.launch({ channel: 'chrome' }));
try {
  for (const size of [{ width: 1280, height: 1080 }, { width: 1440, height: 900 }]) {
    const w = size.width;
    const sample = assetHistorySample(30);
    // ── 그래프 오버 ──
    {
      const { page, ctx, errors } = await open(browser, { size });
      await waitTable(page);
      const chart = page.getByTestId('asset-history-chart');
      await chart.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      const box = (await chart.boundingBox())!;
      // 오른쪽 끝 가까이(마지막 점 쪽 — 가격 축 왼쪽) — 상자가 차트 칸 안으로 자리를 옮기는지
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.move(box.x + box.width - 100, box.y + box.height / 2, { steps: 5 });
      const tip = page.getByTestId('asset-history-tip');
      await tip.waitFor({ timeout: 5000 });
      await page.waitForTimeout(100);
      const t = (await tip.textContent()) ?? '';
      const day = /\d{4}-\d{2}-\d{2}/.exec(t)?.[0] ?? '';
      const point = sample.points.find((p) => p.day === day);
      const row = sample.rows.find((r) => r.day === day);
      const tb = (await tip.boundingBox())!;
      check(`[134-5] ${w}px 그래프 오버 — 날짜 · 원 단위 정확한 금액(₩5,1xx,xxx,xxx) · 전날 대비(원 · %)`,
        point != null && t.includes(formatAssetWon(point.total)) && row?.change != null && t.includes(`전날보다 ${formatAssetWonSigned(row.change)}`) && /\([+−]?\d+\.\d{2}%\)/.test(t), t);
      check(`[134-5] ${w}px 그래프 오버 — 상자가 차트 칸 안(오른쪽 끝 점에서도 잘리지 않음)`, tb.x >= box.x && tb.y >= box.y && tb.x + tb.width <= box.x + box.width + 0.5 && tb.y + tb.height <= box.y + box.height + 0.5, JSON.stringify({ tb, box }));
      // 첫 점(기간 첫 기록 = 비교 안 함)은 대비 없음
      await page.mouse.move(box.x + 8, box.y + box.height / 2);
      await page.waitForTimeout(150);
      const first = (await tip.textContent().catch(() => '')) ?? '';
      check(`[134-5] ${w}px 그래프 오버 — 첫 기록은 「전날 기록 대비 없음」`, first.includes(sample.points[0].day) ? first.includes('전날 기록 대비 없음') : true, first);
      await page.mouse.move(2, 2);
      await page.waitForTimeout(150);
      check(`[134-5] ${w}px 그래프 밖으로 나가면 상자 없음`, (await tip.count()) === 0);

      // ── 표: 최신이 위 · 숫자 오른쪽 정렬 · 넘침 0 · 머리 줄 고정(표 안 스크롤) ──
      const days = await rowButtons(page).evaluateAll((els) => els.map((e) => /\d{4}-\d{2}-\d{2}/.exec(e.textContent ?? '')?.[0] ?? ''));
      check(`[134-5] ${w}px 표 — 최신 날짜가 맨 위(받은 순서의 거꾸로) · 줄 수 = 그래프 점 수`, JSON.stringify(days) === JSON.stringify([...sample.points].reverse().map((p) => p.day)));
      const heads = await table(page).locator('thead th').allTextContents();
      check(`[134-5] ${w}px 표 칸 — 날짜 · 총 자산 · 전날 대비 · 등락률 · 무엇 때문에 · 메모`, JSON.stringify(heads.map((h) => h.trim())) === JSON.stringify(['날짜', '총 자산', '전날 대비', '등락률', '무엇 때문에', '메모']));
      const layout = await page.getByTestId('asset-daily-scroll').evaluate((el) => {
        const cells = [...el.querySelectorAll('tbody tr[data-day] td')] as HTMLElement[];
        const num = cells.filter((_, i) => [1, 2, 3].includes(i % 6));
        const clipped = cells.filter((c, i) => i % 6 !== 4 && i % 6 !== 5 && c.scrollWidth > c.clientWidth + 1).length;
        const head = el.querySelector('thead') as HTMLElement;
        return {
          right: num.every((c) => getComputedStyle(c).textAlign === 'right'),
          clipped,
          hOverflow: el.scrollWidth > el.clientWidth + 1,
          scrolls: el.scrollHeight > el.clientHeight,
          sticky: getComputedStyle(head).position === 'sticky',
        };
      });
      const pageOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      check(`[134-5] ${w}px 표 — 숫자 칸 오른쪽 정렬 · 날짜 · 숫자 칸 잘림 0 · 가로 넘침 0`, layout.right && layout.clipped === 0 && !layout.hOverflow && !pageOverflow, JSON.stringify(layout));
      const reasonClipped = await page.getByTestId('asset-daily-scroll').evaluate((el) =>
        ([...el.querySelectorAll('tbody tr[data-day] td:nth-child(5) [data-tip-clip]')] as HTMLElement[]).filter((x) => x.scrollWidth > x.clientWidth + 1).length,
      );
      check(`[134-5] ${w}px 표 — 「무엇 때문에」 몫 셋(가짜 값 · 만 원 단위)이 잘리지 않음`, reasonClipped === 0, String(reasonClipped));
      check(`[134-5] ${w}px 표 — 줄이 많으면 표 안 스크롤 · 머리 줄 고정`, layout.scrolls && layout.sticky, JSON.stringify(layout));
      const latest = sample.rows.at(-1)!;
      const firstRow = table(page).locator(`tr[data-day="${latest.day}"]`);
      const firstText = (await firstRow.textContent()) ?? '';
      check(`[134-5] ${w}px 표 — 총 자산 원 단위 · 전날 대비 원 · % · 「무엇 때문에」 만 원 단위 몫`, firstText.includes(formatAssetWon(latest.total)) && firstText.includes(formatAssetWonSigned(latest.change)) && /주가 [+−]₩[\d,]+만/.test(firstText), firstText);

      // ── 줄 펼침 ──
      const detailOf = (day: string) => page.locator(`[id="asset-daily-detail-${day}"]`);
      const r2 = sample.rows.at(-2)!; // 위에서 둘째 — 가격 못 받음 1줄 · 주가 · 환율
      const btn = table(page).getByRole('button', { name: `${r2.day} 자세히 보기` });
      await btn.click();
      await detailOf(r2.day).waitFor({ timeout: 5000 });
      const dt = (await detailOf(r2.day).textContent()) ?? '';
      check(`[134-5] ${w}px 줄 펼침 — aria-expanded · 몫 전부 원 단위 · 많이 바뀐 종목 3개 · 가격 못 받음 안내`,
        (await btn.getAttribute('aria-expanded')) === 'true' && r2.shares.every((s) => dt.includes(`${s.label}`) && dt.includes(formatAssetWonSigned(s.amount))) && r2.movers.every((m) => dt.includes(m.name)) && dt.includes('가격 못 받음 1줄 — 정확하지 않음'), dt);
      const old = sample.rows[4]; // 지난 날짜(주식 값)
      await table(page).getByRole('button', { name: `${old.day} 자세히 보기` }).click();
      const oldDetail = (await detailOf(old.day).textContent()) ?? '';
      check(`[134-5] ${w}px 줄 펼침 — 지난 날짜는 「주식 값」 + 「이 날은 주가 · 환율을 나눠 볼 기록이 없어요(v2.70.0 전)」`, oldDetail.includes('주식 값') && oldDetail.includes('이 날은 주가 · 환율을 나눠 볼 기록이 없어요(v2.70.0 전)'), oldDetail);
      const ap = sample.rows.at(-4)!; // 대략(미국 매매 환율) · 사고판 금액
      await table(page).getByRole('button', { name: `${ap.day} 자세히 보기` }).click();
      const approx = (await detailOf(ap.day).textContent()) ?? '';
      check(`[134-5] ${w}px 줄 펼침 — 「대략」 · 사고판 금액(합에는 0) 안내`, approx.includes('대략') && approx.includes('사고판 금액') && approx.includes(formatAssetWonSigned(1_250_000)), approx);
      await btn.click();
      check(`[134-5] ${w}px 줄 다시 누르면 접힘`, (await btn.getAttribute('aria-expanded')) === 'false' && (await detailOf(r2.day).count()) === 0 && (await table(page).getByTestId('asset-daily-detail').count()) === 2);
      check(`[134-5] ${w}px 화면 오류 0`, errors.length === 0, errors.join(' | '));
      await ctx.close();
    }
    // ── 기간 · 연금 포함 따라감 · 로딩 표시 ──
    {
      const { page, ctx, seen, releaseHistory } = await open(browser, {
        size,
        holdHistory: true,
        history: (range, pension) => assetHistorySample(range === '3m' ? 45 : pension === '1' ? 30 : 12),
      });
      await guard.step('스켈레톤 기다리기', () => page.getByTestId('asset-daily-skeleton').waitFor({ timeout: 30_000 }));
      check(`[134-5] ${w}px 로딩 — 처음 받기 전 스켈레톤(빈 안내 · 줄을 그리지 않음)`, (await page.getByTestId('asset-daily-empty').count()) === 0 && (await rowButtons(page).count()) === 0);
      releaseHistory();
      await waitTable(page);
      check(`[134-5] ${w}px 기간 · 연금 포함 — 처음 1m · 연금 포함`, (await rowButtons(page).count()) === 30 && seen.historyUrls.at(-1) === '?range=1m&pension=1');
      await page.getByRole('radio', { name: '3개월' }).or(page.getByRole('button', { name: '3개월' })).first().click();
      await table(page).getByLabel('받는 중').waitFor({ timeout: 5000 });
      check(`[134-5] ${w}px 로딩 — 다시 받는 동안 줄은 그대로 두고 제목 옆 회전 표시`, (await rowButtons(page).count()) === 30);
      releaseHistory();
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="asset-daily-table"] tbody tr[data-day]').length === 45, null, { timeout: 5000 });
      check(`[134-5] ${w}px 기간 바꾸면 그래프와 함께 표도 바뀜(3m — 같은 응답)`, seen.historyUrls.at(-1) === '?range=3m&pension=1' && (await rowButtons(page).count()) === 45);
      await page.getByRole('radio', { name: '1개월' }).or(page.getByRole('button', { name: '1개월' })).first().click();
      releaseHistory();
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="asset-daily-table"] tbody tr[data-day]').length === 30, null, { timeout: 5000 });
      await page.getByRole('checkbox', { name: /연금 포함/ }).uncheck();
      releaseHistory();
      await page.waitForFunction(() => document.querySelectorAll('[data-testid="asset-daily-table"] tbody tr[data-day]').length === 12, null, { timeout: 5000 });
      check(`[134-5] ${w}px 연금 포함을 끄면 표도 연금 뺌 응답으로`, seen.historyUrls.at(-1) === '?range=1m&pension=0' && (await rowButtons(page).count()) === 12);
      await ctx.close();
    }
    // ── 빈 기록 ──
    {
      const { page, ctx } = await open(browser, { size, history: () => assetHistorySample(0) });
      await guard.step('빈 안내 기다리기', () => page.getByTestId('asset-daily-empty').waitFor({ timeout: 30_000 }));
      check(`[134-5] ${w}px 기록이 없으면 빈 안내 한 줄`, (await rowButtons(page).count()) === 0);
      await ctx.close();
    }
    // ── 메모 입력 · 저장 중 · 저장 ──
    {
      const { page, ctx, seen, releaseNote } = await open(browser, { size, holdNote: true });
      await waitTable(page);
      const latest = sample.rows.at(-1)!;
      await table(page).getByRole('button', { name: `${latest.day} 메모` }).click();
      const input = table(page).getByRole('textbox', { name: `${latest.day} 메모` });
      check(`[134-5] ${w}px 메모 — 누르면 바로 입력(칸에 포커스)`, await input.evaluate((el) => el === document.activeElement));
      await input.fill('급여');
      await input.press('Enter');
      await table(page).getByLabel('저장 중').waitFor({ timeout: 5000 });
      check(`[134-5] ${w}px 메모 — 저장 중 회전 표시 · 칸 잠김`, await input.isDisabled());
      releaseNote();
      await table(page).getByRole('button', { name: `${latest.day} 메모 — 급여` }).waitFor({ timeout: 5000 });
      check(`[134-5] ${w}px 메모 — Enter 로 저장(PUT { day, note }) · 저장한 글이 칸에`, JSON.stringify(seen.noteBodies.at(-1)) === JSON.stringify({ day: latest.day, note: '급여' }));
      // 바깥 누르기로 저장
      const prev = sample.rows.at(-2)!;
      await table(page).getByRole('button', { name: `${prev.day} 메모` }).click();
      await table(page).getByRole('textbox', { name: `${prev.day} 메모` }).fill('이체');
      await page.getByRole('heading', { name: '일별 자산 변화' }).click();
      await table(page).getByRole('button', { name: `${prev.day} 메모 — 이체` }).waitFor({ timeout: 5000 });
      check(`[134-5] ${w}px 메모 — 바깥 누르기에도 저장`, JSON.stringify(seen.noteBodies.at(-1)) === JSON.stringify({ day: prev.day, note: '이체' }));
      // 줄 누르기와 섞이지 않음 — 메모 칸을 눌러도 줄이 펼쳐지지 않는다
      check(`[134-5] ${w}px 메모 칸을 눌러도 줄이 펼쳐지지 않음`, (await table(page).getByTestId('asset-daily-detail').count()) === 0);
      await ctx.close();
    }
    // ── 메모 저장 실패 · 잠금 ──
    {
      const { page, ctx } = await open(browser, { size, note: { status: 400, json: { error: '메모는 40자까지 적을 수 있습니다.' } } });
      await waitTable(page);
      const latest = sample.rows.at(-1)!;
      await table(page).getByRole('button', { name: `${latest.day} 메모` }).click();
      const input = table(page).getByRole('textbox', { name: `${latest.day} 메모` });
      await input.fill('보너스');
      await input.press('Enter');
      await page.getByTestId('asset-daily-error').waitFor({ timeout: 5000 });
      check(`[134-4] ${w}px 메모 저장 실패 — 글은 그대로(칸 열린 채) · 오류 한 줄`, (await input.inputValue()) === '보너스' && ((await page.getByTestId('asset-daily-error').textContent()) ?? '').includes('40자'));
      await ctx.close();
    }
    {
      const { page, ctx } = await open(browser, { size, note: { status: 403, json: { error: '자산 관리가 잠겨 있습니다.', code: 'asset-locked' } } });
      await waitTable(page);
      const latest = sample.rows.at(-1)!;
      await table(page).getByRole('button', { name: `${latest.day} 메모` }).click();
      const input = table(page).getByRole('textbox', { name: `${latest.day} 메모` });
      await input.fill('급여');
      await input.press('Enter');
      await guard.step('잠금 화면 기다리기', () => page.getByTestId('asset-daily-table').waitFor({ state: 'detached', timeout: 10_000 }));
      check(`[134-4] ${w}px 메모 저장이 잠김(403)이면 저장하지 않고 잠금 화면으로`, (await page.getByTestId('asset-daily-table').count()) === 0 && (await page.getByRole('button', { name: /풀기/ }).count()) > 0);
      await ctx.close();
    }
  }
} finally {
  await guard.step('브라우저 닫기', () => browser.close());
  await guard.step('Vite 닫기', () => vite.close());
  guard.stop();
}
console.log(`\n결과: PASS ${pass} · FAIL ${fail}`);
process.exit(fail > 0 ? 1 : 0);
