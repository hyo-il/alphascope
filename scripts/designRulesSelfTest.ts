/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
/**
 * 155차 앱 전체 색 · 글 규칙 시험(`npm run designrules:test` · v2.81.0) — 지시서 「꼭 지킬 동작」 1 ~ 8 줄마다(시험 이름 앞 [155-n]).
 *
 * - 화면(1 · 2 · 3 · 4 · 5): 사본 DB 로 시험 서버(4117 · 스위치 끔 `testServerEnv`)와 Vite(5197 · 프록시만 그 서버로)를 이 시험이 띄우고,
 *   154차 `designReviewShots` 의 **모든 장면**(메뉴 · 탭 · 창 · 판 — 같은 여는 코드 · 같은 가짜 응답)을 1440 × 900 · 402 × 874(손가락) 두 크기로
 *   **함께**(맥락 둘) 연다. 찍지 않고 장면마다 잰다:
 *   1 밝은 파랑(`--color-accent`) 바탕 단추 0 · 2 빨간(bearish · danger) 글 · 바탕 요소는 모두 뜻 표시(`data-tone` = down · sell · invalid ·
 *   danger-confirm · 오류 알림 error — 조상 포함) 또는 음수 숫자 글(− · ▼ 로 시작하거나 − 숫자) · 4 화면 글 + 툴팁 글(`data-tip` · `data-tip-clip` · `aria-label` ·
 *   `placeholder`)에 개발용 글 0. 클래스로 찾지 않는다(계산된 색 + `data-*` · 역할 이름).
 * - 코드(4 · 5 · 6 · 7 · 8): [ⓘ] 안 글은 DOM 에 없어서 화면 코드 글을 함께 훑는다 · 확인 창 수 · 바뀐 파일의 배치 클래스 · 매매 코드 범위 · `design:lint` 새 규칙.
 * - 외부 호출: Gemini 0(서버 스위치 끔 + 부르는 주소 가짜) · 자산은 가짜 응답(실제 시트 0) · 토스 주문 0.
 * 크기마다 따로 돌리려면 `SIZES=1440x900` (기본 두 크기 함께).
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import { TEST_SERVER_SWITCHES } from './lib/testServerEnv';
import 'dotenv/config';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { chromium, type Browser, type Page } from 'playwright';
import { createBrowserStepGuard } from './lib/browserStepGuard';
import { chasuChanged, chasuEnd, chasuPatch, type Chasu } from './lib/chasuRange';
import { closeLeftovers } from './designCheck';
import { allScenes, fakeContext, prepareData, waitLoaded, type Scene } from './designReviewShots';
import { FEATURE_OFF_HOW, FEATURE_OFF_TEXT } from '../src/components/ui/featureOffText';

const root = path.resolve(import.meta.dirname, '..');
const CHASU: Chasu = { base: '523db6b', version: 'v2.81.0' };
const API_PORT = 4117;
const WEB_PORT = 5197;
const API = `http://127.0.0.1:${API_PORT}`;
const WEB = `http://127.0.0.1:${WEB_PORT}`;
const SIZES = (process.env.SIZES ?? '1440x900,402x874').split(',').map((s) => {
  const [w, h] = s.split('x').map(Number);
  return { w, h };
});
/** 개발용 글(테마 9-1 R4) — 화면 글 · 툴팁 글 · 화면 코드 글 */
const DEV_TEXT = /_ENABLED\b|CLIENT_ID|CLIENT_SECRET|(^|[^\w])\.env\b|npm run|(^|[^\w/])db\/|yfinance|\/candles|\/api\//i;
/** 빨강의 뜻 — 하락 · 매도 · 틀린 칸 · 확인 창 위험 단추 + 오류 알림 글(불러오기 · 저장 실패 — 「틀림」 쪽으로 봄 · 155차 정함) */
const TONES = ['down', 'sell', 'invalid', 'danger-confirm', 'error'];

const guard = createBrowserStepGuard();
let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = '') {
  guard.mark(name);
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? ` — ${detail}` : ''}`);
}
const git = (args: string[]) => spawnSync('git', args, { cwd: root, encoding: 'utf8' }).stdout;

// ───────── 코드 ─────────
// [155-4] 화면 코드 글 — [ⓘ] 안 글 · 꺼진 상태에서만 보이는 글은 DOM 에 없을 수 있어 코드에서 본다(주석 · 주소 문자열 제외)
{
  const files: string[] = [];
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx$/.test(e.name)) files.push(p);
    }
  };
  walk(path.join(root, 'src/components'));
  files.push(path.join(root, 'src/App.tsx'), path.join(root, 'src/data/changelog.ts'));
  const hits: string[] = [];
  for (const f of files) {
    fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (/^\s*(\*|\/\/|\/\*|\{\/\*)/.test(line)) return;
      const shown = line
        .replace(/\{\/\*.*?\*\/\}/g, '')
        .replace(/(^|\s)\/\/.*$/, '$1')
        .replace(/fetch\([^)]*\)/g, '')
        .replace(/(['"`])\/api\/[^'"`]*\1/g, '')
        .replace(/import\.meta\.env\.\w+/g, '');
      if (DEV_TEXT.test(shown)) hits.push(`${path.relative(root, f)}:${i + 1}`);
    });
  }
  check('[155-4] 화면 코드 글(src/components · App · 업데이트 내역)에 개발용 글 0(설정 이름 · .env · npm run · db/ · yfinance · /candles · /api/)', hits.length === 0, hits.join(' · '));
  const off = fs.readFileSync(path.join(root, 'src/components/ui/FeatureOff.tsx'), 'utf8');
  check('[155-4] 꺼진 기능 안내 부품 글 = 「이 기능은 꺼져 있습니다」 · [ⓘ] 「서버 설정에서 켭니다.」', FEATURE_OFF_TEXT === '이 기능은 꺼져 있습니다' && FEATURE_OFF_HOW === '서버 설정에서 켭니다.' && /<InfoTip/.test(off) && /\{FEATURE_OFF_TEXT\}/.test(off) && /\{FEATURE_OFF_HOW\}/.test(off));
  const users = git(['grep', '-l', '<FeatureOff', '--', 'src/components']).split('\n').filter(Boolean);
  check('[155-4] 꺼진 기능 안내를 이 부품으로(자동매매 · Gemini · 지정 종목 분석 · 백테스트 AI 설명 · 뉴스 AI)', ['AutoTradeBar', 'AccountsOverview', 'ChartAiPanel', 'NewsPanel', 'CustomResult', 'ScheduledSymbols'].every((n) => users.some((u) => u.includes(n))), users.join(' · '));
}

// [155-5] 확인 창 — 새로 만들지 않고 없애지 않음(파일마다 modal.confirm · danger: true 수가 기준 커밋과 같음)
{
  const count = (txt: string, re: RegExp) => (txt.match(re) ?? []).length;
  const files = git(['grep', '-l', '-e', 'modal.confirm', '-e', 'danger: true', CHASU.base, '--', 'src']).split('\n').filter(Boolean).map((l) => l.replace(`${CHASU.base}:`, ''));
  const now = git(['grep', '-l', '-e', 'modal.confirm', '-e', 'danger: true', '--', 'src']).split('\n').filter(Boolean);
  const all = [...new Set([...files, ...now])];
  const diff: string[] = [];
  for (const f of all) {
    const before = spawnSync('git', ['show', `${CHASU.base}:${f}`], { cwd: root, encoding: 'utf8' }).stdout ?? '';
    const after = fs.existsSync(path.join(root, f)) ? fs.readFileSync(path.join(root, f), 'utf8') : '';
    for (const re of [/modal\.confirm\(/g, /danger: true/g]) if (count(before, re) !== count(after, re)) diff.push(`${f} ${re.source} ${count(before, re)}→${count(after, re)}`);
  }
  check(`[155-5] 확인 창 수 그대로(파일 ${all.length}개 · modal.confirm · danger: true) — 새 확인 창 0 · 없앤 확인 창 0`, diff.length === 0, diff.join(' · '));
  const bar = fs.readFileSync(path.join(root, 'src/components/paper-trading/AutoTradeBar.tsx'), 'utf8');
  const overview = fs.readFileSync(path.join(root, 'src/components/paper-trading/AccountsOverview.tsx'), 'utf8');
  check('[155-5] 자동매매 끄기 = 보조 단추 · 누르면 바로 toggle(확인 창 없음 그대로)', /variant=\{on \? 'secondary' : 'primary'\}\s*onClick=\{\(\) => void toggle\(\)\}/.test(bar) && /variant="secondary"[\s\S]{0,200}onClick=\{\(\) => void toggle\(item, !on\)\}/.test(overview));
  const removeAll = fs.readFileSync(path.join(root, 'src/components/ui/RemoveAllButton.tsx'), 'utf8');
  check('[155-5] 「모두 삭제」 글 단추 = 회색 글(빨강 0) · 확인 창은 쓰는 쪽이 정함(그대로)', /text-text-secondary/.test(removeAll) && !/danger/.test(removeAll.replace(/\/\*[\s\S]*?\*\//g, '')));
}

// [155-6] 1280 이상 배치 — 바뀐 화면 파일의 배치 클래스(여백 · 크기 · 칸 · 글자 크기)가 기준 커밋과 같다(색 · 글 · 아이콘만 바뀜)
{
  const LAYOUT = /^(?:[a-z-]+:)*-?(?:[mp][trblxyse]?-|w-|h-|min-|max-|flex|grid|gap-|space-|inline|block$|hidden$|items-|justify-|self-|shrink|grow|basis-|col-|row-|absolute$|relative$|fixed$|sticky$|inset|top-|left-|right-|bottom-|z-|overflow|whitespace|truncate$|text-(?:xs|sm|base|caption|left|right|center)$|font-|leading-|tracking-|align-|order-|aspect-|rounded)/;
  const tokens = (txt: string) => {
    const m = new Map<string, number>();
    for (const t of txt.split(/[\s'"`{}()?:,]+/)) if (LAYOUT.test(t)) m.set(t, (m.get(t) ?? 0) + 1);
    return m;
  };
  /** 글 · 아이콘만 바뀐 곳에서 빠지거나 더해진 배치 클래스 — 파일 · 까닭(이름 붙은 목록) */
  const ALLOW: Record<string, string> = {
    'src/components/chart/QuickOrderPanel.tsx': '계좌 없을 때 [계좌 생성] 을 공용 주 단추로(R1 · 계좌가 있으면 안 보임)',
    'src/components/paper-trading/AutoTradeBar.tsx': '자동매매 꺼짐 경고 상자 → 꺼진 기능 안내 한 줄(R4 · 사용자 결정 3)',
    'src/components/paper-trading/AccountsOverview.tsx': '자동매매 꺼짐 경고 상자 → 꺼진 기능 안내 한 줄(R4)',
    'src/components/chart/tabs/ChartAiPanel.tsx': 'Gemini 꺼짐 글 → 꺼진 기능 안내(R4)',
    'src/components/chart/tabs/NewsPanel.tsx': 'Gemini 꺼짐 글 → 꺼진 기능 안내(R4)',
    'src/components/layout/Settings.tsx': '코드 글자 상자(<code>) 를 쉬운 말로(R4)',
    'src/components/asset/AssetView.tsx': '코드 글자 상자(<code>) 를 쉬운 말로(R4)',
    'src/components/auth/LoginScreen.tsx': '코드 글자 상자(<code>) 를 쉬운 말로(R4)',
    'src/App.tsx': '코드 글자 상자(<code>) 를 쉬운 말로(R4)',
    'src/components/surge/SurgeSettings.tsx': '코드 글자 상자(<code>) 를 쉬운 말로(R4)',
    'src/components/calendar/CalendarView.tsx': '일요일 머리 빨강 지움 — 조건 클래스 틀만 바뀜(R2 · py-1 그대로)',
  };
  const changed = chasuChanged(root, CHASU, ['src']).filter((f) => /\.tsx$/.test(f));
  const moved: string[] = [];
  for (const f of changed) {
    if (!git(['ls-tree', '--name-only', CHASU.base, '--', f]).trim()) continue; // 새 파일(부품)은 견줄 것이 없음
    const before = tokens(spawnSync('git', ['show', `${CHASU.base}:${f}`], { cwd: root, encoding: 'utf8' }).stdout ?? '');
    // 뒤 모양 = 155차 끝 커밋의 파일(끝난 차수면 커밋끼리 — 157차 이후 작업 트리 변경을 155차 몫으로 세지 않음 · CLAUDE.md 2-3)
    const end = chasuEnd(root, CHASU);
    const after = tokens(
      end
        ? (spawnSync('git', ['show', `${end}:${f}`], { cwd: root, encoding: 'utf8' }).stdout ?? '')
        : fs.existsSync(path.join(root, f)) ? fs.readFileSync(path.join(root, f), 'utf8') : '',
    );
    const keys = new Set([...before.keys(), ...after.keys()]);
    const d = [...keys].filter((k) => (before.get(k) ?? 0) !== (after.get(k) ?? 0)).map((k) => `${k} ${before.get(k) ?? 0}→${after.get(k) ?? 0}`);
    if (d.length && !ALLOW[f]) moved.push(`${f}: ${d.slice(0, 6).join(', ')}`);
  }
  check(`[155-6] 바뀐 화면 파일 ${changed.length}개 — 배치 클래스가 기준 커밋(${CHASU.base})과 같음(이름 붙은 글 · 아이콘 바뀜 ${Object.keys(ALLOW).length}곳 밖)`, moved.length === 0, moved.join(' / '));
}

// [155-7] 매매 판단 · 주문 계산 · 계좌 계산 · 자동매매 · 서버 판단 코드 0(바뀐 곳은 안내 글 한 줄뿐)
{
  const TRADING = ['server/rules', 'server/buyJudge', 'server/autoTrading', 'server/aiCheck', 'server/paperTradingService.ts', 'server/paperPerformanceService.ts', 'server/paperSnapshotScheduler.ts', 'src/utils/quickOrderQuantity.ts', 'src/utils/fx.ts'];
  const files = chasuChanged(root, CHASU, TRADING);
  const lines = chasuPatch(root, CHASU, TRADING).split('\n').filter((l) => /^[+-](?![+-])/.test(l));
  const onlyText = lines.every((l) => /SERVER_OFF_REASON = '이 서버에서는 자동매매가 꺼져 있습니다/.test(l));
  check('[155-7] 매매 판단 · 주문 · 계좌 · 자동매매 코드 — 바뀐 줄은 자동매매 꺼짐 안내 글(SERVER_OFF_REASON) 하나뿐', onlyText && files.every((f) => f === 'server/autoTrading/scheduler.ts'), `${files.join(' · ')} / ${lines.length}줄`);
  const serverText = chasuChanged(root, CHASU, ['server', 'src/services']);
  console.log(`      (알림) 바뀐 서버 파일 — 안내 글만: ${serverText.join(' · ')}`);
}

// [155-8] design:lint 새 규칙 — 밝은 파랑 단추 · danger-text · 화면 글 *_ENABLED 를 잡는다
{
  const tmp = path.join(os.tmpdir(), `designrules-${process.pid}.tsx`);
  fs.writeFileSync(tmp, [
    'export const A = () => <button className="rounded bg-accent px-2 text-white">x</button>;',
    'export const B = () => <Button variant="danger-text">x</Button>;',
    'export const C = () => <p>꺼짐(GEMINI_ENABLED=false)</p>;',
    '// 주석 안의 AUTO_TRADING_ENABLED 는 괜찮다',
    'export const D = () => <div className="h-full bg-accent" />;',
  ].join('\n'));
  const r = spawnSync('npx', ['tsx', 'scripts/designLint.ts'], { cwd: root, encoding: 'utf8', env: { ...process.env, DESIGN_LINT_EXTRA: tmp } });
  fs.rmSync(tmp, { force: true });
  const out = r.stdout ?? '';
  const mine = out.split('\n').filter((l) => l.includes(path.basename(tmp)));
  check('[155-8] design:lint — 가짜 파일의 밝은 파랑 단추 · danger-text · 화면 글 *_ENABLED 를 실패로(주석 · 진행 막대는 통과)',
    r.status === 1 && mine.length === 3 && mine.some((l) => l.includes('[밝은 파랑 단추]')) && mine.some((l) => l.includes('[danger-text]')) && mine.some((l) => l.includes('[화면 글 설정 이름]')), mine.join(' / ') || out.slice(-300));
  const real = spawnSync('npx', ['tsx', 'scripts/designLint.ts'], { cwd: root, encoding: 'utf8' });
  check('[155-8] design:lint — 지금 코드는 0건', real.status === 0, (real.stdout ?? '').slice(-300));
}

// ───────── 화면 ─────────
/** 장면 하나에서 잰다(브라우저 안) */
function inspect(args: { devText: string; tones: string[] }) {
  const DEV = new RegExp(args.devText, 'i');
  const rgb = (c: string) => {
    const m = c.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
    return m ? { r: +m[1], g: +m[2], b: +m[3], a: m[4] == null ? 1 : +m[4] } : null;
  };
  const isRed = (c: string, minA: number) => {
    const v = rgb(c);
    return !!v && v.r === 255 && v.g === 91 && v.b === 91 && v.a >= minA;
  };
  const isLightBlue = (c: string) => {
    const v = rgb(c);
    return !!v && v.r === 49 && v.g === 130 && v.b === 246 && v.a >= 0.5;
  };
  const visible = (el: Element) => {
    const h = el as HTMLElement;
    if (!h.checkVisibility?.({ opacityProperty: true, visibilityProperty: true })) return false;
    const r = h.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };
  const ownText = (el: Element) =>
    [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent ?? '').join('').trim();
  const label = (el: Element) => `${el.tagName.toLowerCase()}「${((el as HTMLElement).innerText ?? '').trim().replace(/\s+/g, ' ').slice(0, 30)}」`;
  const NEG = /^[−\-▼(]|[−-]\s?[₩$]?\d/;

  const lightBlue: string[] = [];
  const reds: string[] = [];
  let primary = 0;
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('[aria-hidden="true"]') || !visible(el)) continue;
    const cs = getComputedStyle(el);
    const isButton = el.tagName === 'BUTTON' || el.getAttribute('role') === 'button' || el.tagName === 'A';
    if (isButton && isLightBlue(cs.backgroundColor)) lightBlue.push(label(el));
    if (isButton) {
      const v = rgb(cs.backgroundColor);
      if (v && v.r === 27 && v.g === 100 && v.b === 218) primary++;
    }
    const text = ownText(el);
    const redText = text !== '' && isRed(cs.color, 0.3);
    const redBg = isRed(cs.backgroundColor, 0.05);
    if (!redText && !redBg) continue;
    const tone = el.closest('[data-tone]')?.getAttribute('data-tone') ?? '';
    if (args.tones.includes(tone)) continue;
    const all = ((el as HTMLElement).innerText ?? '').trim();
    if (NEG.test(all)) continue; // 음수 숫자 칸(등락 · 손익 · 지도 범례)
    reds.push(`${label(el)}${redBg ? '(바탕)' : ''}`);
  }
  const tipText = [...document.querySelectorAll('[data-tip],[data-tip-clip],[aria-label],[placeholder],[title]')]
    .map((e) => ['data-tip', 'data-tip-clip', 'aria-label', 'placeholder', 'title'].map((a) => e.getAttribute(a) ?? '').join(' '))
    .join('\n');
  const body = document.body.innerText;
  const dev = [...new Set(`${body}\n${tipText}`.split('\n').filter((l) => DEV.test(l)).map((l) => l.trim().slice(0, 60)))];
  return { lightBlue, reds, dev, primary, featureOff: document.querySelectorAll('[data-feature-off]').length };
}

interface SizeResult { scenes: number; skipped: number; failedOpen: string[]; lightBlue: string[]; reds: string[]; dev: string[]; primary: number; featureOff: string[]; featureTip: string; r3: Record<string, string> }

async function openScene(page: Page, s: Scene) {
  if (s.before) {
    await page.evaluate(() => (location.hash = '#/home'));
    await page.waitForTimeout(400);
    await s.before(page);
  }
  await page.evaluate((h) => (location.hash = h), s.hash);
  await page.waitForTimeout(1300);
  if (s.open) await s.open(page);
  await waitLoaded(page);
}

async function runSize(browser: Browser, token: string, size: { w: number; h: number }, scenes: Scene[]): Promise<SizeResult> {
  const touch = size.w < 1280;
  const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h }, ...(touch ? { isMobile: true, hasTouch: true } : {}) });
  await ctx.addCookies([{ name: 'as_session', value: token, url: WEB }]);
  await ctx.addInitScript('window.__name = (f) => f');
  await fakeContext(ctx);
  const page = await ctx.newPage();
  page.setDefaultTimeout(6000);
  const res: SizeResult = { scenes: 0, skipped: 0, failedOpen: [], lightBlue: [], reds: [], dev: [], primary: 0, featureOff: [], featureTip: '', r3: {} };
  await guard.step(`${size.w} 홈 열기`, async () => {
    await page.goto(`${WEB}/#/home`);
    await page.waitForTimeout(2000);
    await page.getByRole('button', { name: /애플/ }).first().click().catch(() => {});
    await page.waitForTimeout(1200);
  });
  for (const s of scenes) {
    if (s.skip?.(size.w)) {
      res.skipped++;
      continue;
    }
    await page.mouse.move(0, 0).catch(() => {});
    const opened = await guard.step(`${size.w} ${s.file} 열기`, () => openScene(page, s).then(() => true).catch(() => false));
    if (!opened) {
      res.failedOpen.push(s.file);
    } else {
      res.scenes++;
      const r = await guard.step(`${size.w} ${s.file} 재기`, () => page.evaluate(inspect, { devText: DEV_TEXT.source, tones: TONES }));
      res.lightBlue.push(...r.lightBlue.map((x) => `${s.file} ${x}`));
      res.reds.push(...r.reds.map((x) => `${s.file} ${x}`));
      res.dev.push(...r.dev.map((x) => `${s.file} ${x}`));
      res.primary += r.primary;
      if (r.featureOff) res.featureOff.push(s.file);
      // [155-4] 꺼진 기능 [ⓘ] — 장면에서 처음 보일 때 한 번 누르고 툴팁 글을 읽는다
      if (r.featureOff && !res.featureTip) {
        res.featureTip = await guard.step(`${size.w} 꺼진 기능 [ⓘ]`, async () => {
          const btn = page.locator('[data-feature-off] button').first();
          await btn.scrollIntoViewIfNeeded().catch(() => {});
          if (touch) await btn.tap().catch(() => {});
          else await btn.hover().catch(() => {});
          await page.waitForTimeout(700);
          const t = (await page.getByRole('tooltip').first().innerText().catch(() => '')) ?? '';
          await page.mouse.move(0, 0).catch(() => {});
          await page.keyboard.press('Escape').catch(() => {});
          return t;
        });
      }
      if (size.w >= 1280 && s.file === '차트비교-차트') res.r3 = { ...res.r3, ...(await guard.step('빠른 주문 색', () => quickOrderColors(page))) };
      if (s.file === '계좌-계좌관리-상세-거래내역') res.r3 = { ...res.r3, ...(await guard.step(`${size.w} 거래 내역 딱지`, () => tradeBadges(page))) };
    }
    if (s.open) await page.keyboard.press('Escape').catch(() => {});
    if (s.after) await s.after(page).catch(() => {});
    await closeLeftovers(page);
  }
  if (size.w >= 1280) res.r3 = { ...res.r3, ...(await guard.step('확인 창 마지막 단추', () => confirmDialog(page))) };
  await ctx.close();
  return res;
}

const COLOR = { bullish: 'rgb(51, 196, 99)', bearish: 'rgb(255, 91, 91)', bgPrimary: 'rgb(20, 20, 20)' };
/** [155-3] 빠른 주문 네 단추의 바탕 · 글 색 */
async function quickOrderColors(page: Page): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const name of ['지정가 매수', '시장가 매수', '지정가 매도', '시장가 매도']) {
    const b = page.getByRole('button', { name, exact: true }).first();
    out[name] = await b.evaluate((el) => `${getComputedStyle(el).backgroundColor}|${getComputedStyle(el).color}|${el.getAttribute('data-tone') ?? ''}`).catch(() => '없음');
  }
  return out;
}
/** [155-3] 거래 내역 딱지(`data-side`) — 매수 초록 + 「매수」 · 매도 빨강 + 「매도」 */
async function tradeBadges(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const rows = [...document.querySelectorAll('[data-side="buy"],[data-side="sell"]')].map((el) => ({ side: el.getAttribute('data-side'), text: (el as HTMLElement).innerText.trim(), color: getComputedStyle(el).color, tone: el.getAttribute('data-tone') ?? '' }));
    return { 거래내역: JSON.stringify(rows.slice(0, 40)) };
  });
}
/** [155-5] 「모든 기기에서 로그아웃」 — 바깥 단추는 빨강 아님 · 확인 창이 뜨고 마지막 단추만 빨강(누르지 않고 Esc) */
async function confirmDialog(page: Page): Promise<Record<string, string>> {
  await page.evaluate(() => (location.hash = '#/settings-app'));
  await page.waitForTimeout(1500);
  await waitLoaded(page);
  const outer = page.getByRole('button', { name: '모든 기기에서 로그아웃' });
  const outerColor = await outer.evaluate((el) => `${getComputedStyle(el).color}|${getComputedStyle(el).backgroundColor}`).catch(() => '없음');
  await outer.click().catch(() => {});
  await page.waitForTimeout(600);
  const dlg = page.getByRole('dialog').last();
  const buttons = await dlg.getByRole('button').evaluateAll((els) => els.filter((e) => (e as HTMLElement).innerText.trim() !== '').map((e) => `${(e as HTMLElement).innerText.trim()}|${getComputedStyle(e).backgroundColor}|${getComputedStyle(e).color}|${e.getAttribute('data-tone') ?? ''}`)).catch(() => [] as string[]);
  await page.keyboard.press('Escape').catch(() => {});
  await page.waitForTimeout(400);
  const closed = (await page.getByRole('dialog').count()) === 0;
  return { 로그아웃바깥: outerColor, 로그아웃창: JSON.stringify(buttons), 로그아웃닫힘: String(closed) };
}

let server: ChildProcess | null = null;
let serverLog = '';
let viteClose: (() => Promise<void>) | null = null;
try {
  server = spawn('node_modules/.bin/tsx', ['server/index.ts'], {
    cwd: root,
    detached: true,
    env: { ...process.env, API_PORT: String(API_PORT), INDICATORS_PORT: process.env.INDICATORS_PORT ?? '5002', ...TEST_SERVER_SWITCHES },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  server.stdout!.on('data', (d) => (serverLog += d));
  server.stderr!.on('data', (d) => (serverLog += d));
  await guard.step('시험 서버 띄우기', async () => {
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(`${API}/api/version`)).ok) return;
      } catch {
        /* 아직 */
      }
      await new Promise((r) => setTimeout(r, 500));
    }
    throw new Error(`시험 서버가 뜨지 않았습니다\n${serverLog.slice(-1500)}`);
  });
  const { createServer } = await import('vite');
  const vite = await createServer({
    root,
    configFile: path.join(root, 'vite.config.ts'),
    logLevel: 'error',
    server: { host: '127.0.0.1', port: WEB_PORT, strictPort: true, hmr: false, proxy: { '/api': { target: API, changeOrigin: false } } },
  });
  await guard.step('Vite 띄우기', () => vite.listen());
  viteClose = () => vite.close();

  const { createSession } = await import('../server/auth');
  const token = createSession('designrules-test');
  const browser = await guard.step('브라우저 띄우기', () => chromium.launch({ channel: 'chrome' }));
  const scenes = allScenes().scenes.filter((s) => !process.env.ONLY || new RegExp(process.env.ONLY).test(s.file));
  const t0 = Date.now();
  // 백테스트 결과 장면 — 결과가 없으면 하나 만든다(사본 DB)
  await guard.step('백테스트 결과 준비', async () => {
    const ctx = await browser.newContext();
    await ctx.addCookies([{ name: 'as_session', value: token, url: WEB }]);
    const p = await ctx.newPage();
    await p.goto(`${WEB}/#/home`);
    await prepareData(p).catch((e) => console.log(`      (알림) 백테스트 준비 실패: ${String(e).slice(0, 100)}`));
    await ctx.close();
  });
  const results = await Promise.all(SIZES.map((size) => runSize(browser, token, size, scenes).then((r) => ({ size, r }))));
  console.log(`      (알림) 장면 ${scenes.length}개 × ${SIZES.length}크기 — ${Math.round((Date.now() - t0) / 1000)}초`);
  for (const { size, r } of results) {
    const w = size.w;
    check(`[155-1] ${w} — 장면 ${r.scenes}개 열림(건너뜀 ${r.skipped} · 열기 실패 ${r.failedOpen.length}) · 거의 모든 장면을 잼`, r.scenes >= scenes.length - r.skipped - 3, r.failedOpen.join(' · '));
    check(`[155-1] ${w} — 바탕이 밝은 파랑(--color-accent)인 단추 0 · 주 단추(--color-accent-button) ${r.primary}개`, r.lightBlue.length === 0 && r.primary > 0, r.lightBlue.slice(0, 12).join(' · '));
    if (r.reds.length) {
      const uniq = new Map<string, number>();
      for (const x of r.reds) uniq.set(x, (uniq.get(x) ?? 0) + 1);
      console.log(`      (알림) ${w} 빨강 뜻 없음 목록:\n${[...uniq].map(([k, n]) => `        ${k}${n > 1 ? ` ×${n}` : ''}`).join('\n')}`);
    }
    check(`[155-2] ${w} — 빨간 글 · 바탕은 하락 · 매도 · 틀린 칸(오류 알림 포함) · 확인 창 위험 단추에만(뜻 표시 data-tone 또는 음수 숫자) — 그 밖 0`, r.reds.length === 0, `${r.reds.length}개: ${r.reds.slice(0, 15).join(' · ')}`);
    check(`[155-4] ${w} — 모든 장면 화면 글 · 툴팁 글에 개발용 글 0`, r.dev.length === 0, r.dev.slice(0, 12).join(' · '));
    check(`[155-4] ${w} — 꺼진 기능 자리에 「${FEATURE_OFF_TEXT}」(${r.featureOff.length}장면) · [ⓘ] 를 누르면 「${FEATURE_OFF_HOW}」`, r.featureOff.length > 0 && r.featureTip.includes(FEATURE_OFF_HOW), `${r.featureOff.join(' · ')} / 툴팁 「${r.featureTip}」`);
    const badges = JSON.parse(r.r3['거래내역'] ?? '[]') as { side: string; text: string; color: string; tone: string }[];
    check(`[155-3] ${w} — 거래 내역 딱지: 매수 = 초록 + 「매수」 · 매도 = 빨강 + 「매도」(${badges.filter((b) => b.side === 'buy').length} · ${badges.filter((b) => b.side === 'sell').length}개)`,
      badges.some((b) => b.side === 'buy') && badges.every((b) => (b.side === 'buy' ? b.color === COLOR.bullish && b.text === '매수' : b.color === COLOR.bearish && b.text === '매도' && b.tone === 'sell')), JSON.stringify(badges.slice(0, 4)));
    if (w >= 1280) {
      const q = r.r3;
      const buyOk = ['지정가 매수', '시장가 매수'].every((n) => q[n]?.startsWith(`${COLOR.bullish}|${COLOR.bgPrimary}`));
      const sellOk = ['지정가 매도', '시장가 매도'].every((n) => q[n] === `${COLOR.bearish}|${COLOR.bgPrimary}|sell`);
      check(`[155-3] ${w} — 빠른 주문 [매수] 바탕 초록(bullish) · [매도] 바탕 빨강(bearish) · 글 bg-primary`, buyOk && sellOk, JSON.stringify(q));
      const dlg = JSON.parse(q['로그아웃창'] ?? '[]') as string[];
      const last = dlg[dlg.length - 1] ?? '';
      check(`[155-5] ${w} — 「모든 기기에서 로그아웃」: 바깥 단추 빨강 아님 · 확인 창이 뜨고 마지막 단추만 빨강 바탕(bearish) + 글 bg-primary · Esc 로 닫힘(로그아웃 안 함)`,
        !q['로그아웃바깥']?.includes('255, 91, 91') && dlg.length >= 2 && last.endsWith(`|${COLOR.bearish}|${COLOR.bgPrimary}|danger-confirm`) && dlg.slice(0, -1).every((b) => !b.includes('255, 91, 91')) && q['로그아웃닫힘'] === 'true',
        `${q['로그아웃바깥']} / ${dlg.join(' · ')}`);
    }
  }
  // [155-3] 호가창 — 매도 호가 잔량 빨강 · 매수 호가 초록(그대로) · 가격 등락 색은 오름 초록 · 내림 빨강
  {
    const ob = fs.readFileSync(path.join(root, 'src/components/chart/OrderbookPanel.tsx'), 'utf8');
    check('[155-3] 호가창 — 매도 호가 잔량 빨강(bearish) · 매수 호가 초록(bullish) 그대로 · 가격은 오름 초록 · 내림 빨강', /isAsk \? 'bg-bearish\/20' : 'bg-bullish\/20'/.test(ob) && /rate > 0\s*\? 'text-bullish'\s*: rate < 0\s*\? 'text-bearish'/.test(ob));
  }
  await browser.close();
} catch (e) {
  fail++;
  console.log(`FAIL  시험 중 오류 — ${(e as Error).message}`);
} finally {
  if (viteClose) await (viteClose as () => Promise<void>)().catch(() => {});
  if (server) {
    try {
      process.kill(-server.pid!, 'SIGTERM');
    } catch {
      server.kill('SIGTERM');
    }
  }
  guard.stop();
}
console.log(`결과: ${pass}개 통과 / ${fail}개 실패`);
process.exit(fail === 0 ? 0 : 1);
