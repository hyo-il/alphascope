/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
/**
 * 디자인 숫자 측정 (v2.42.0, `npm run design:check`) — 디자인 점검 세 겹의 둘째(CLAUDE.md 「디자인 점검」).
 *
 * 테스트 서버(기본 http://localhost:5180)의 **모든 화면 주소**(메뉴·탭 — `types/nav.ts` 의 NAV_GROUPS·PAGE_TABS 에서 읽는다) +
 * 주요 창(종목 고르기 · 자동매매 설정 · 판단 기준 편집 · 날짜 고르기)을 **1280×1080 · 1920×1080** 에서 열어 잰다:
 *   1. 같은 줄의 입력칸·드롭박스·버튼(높이 클래스 h-7/h-8 이 있는 것)·묶음 버튼 높이 같음
 *   2. 같은 묶음(창·구역)의 `FormRow` 값 칸 왼쪽·오른쪽 끝 차이 0px
 *   3. 글자 넘침·잘림(overflow 가 숨김인데 scrollWidth > clientWidth) — 말줄임(truncate)은 「말줄임」 으로 따로 센다
 *   4. 요소 겹침(일반 흐름의 형제 요소 사각형이 2px 넘게 겹침)
 *   5. 목록(`data-list`) 줄 사이 간격 ≥ 4px
 *   6. 글자 크기 — 13px 미만 0, 기준표(13·14·16·18) 밖 0(로그인 앱 제목 22 · 인라인 style 로 크기를 정하는 종목 지도 칸 예외)
 *   7. 화면 내용이 화면 폭을 꽉 채움(가운데로 좁힌 넓은 상자 — 좌우 여백이 같고 max-width 가 걸린 것)
 *   8. 콘솔 오류 0
 * 결과: `<OUT>/report.md`(화면별 표) · `<OUT>/{1280,1920}/<이름>.png` · `<OUT>/result.json`.
 *
 * 쓰는 법(테스트 서버를 띄운 뒤):
 *   DB_PATH=<사본 DB> npm run design:check            — 사본 DB 에 점검용 로그인 세션을 만든다
 *   BASE=http://localhost:5180 OUT=../../docs/design-check/v2.42.0 …   (기본 OUT = 관리 루트 docs/design-check/<changelog 맨 앞 버전>)
 * ⚠️ 실제 Windows 크롬은 재지 못한다(맥 크롬 — 스크롤바는 앱이 꾸며서 자리를 차지하는 같은 조건).
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Page } from 'playwright';
import { NAV_GROUPS, PAGE_TABS } from '../src/types/nav';
import { CHANGELOG } from '../src/data/changelog';

const ROOT = path.resolve(import.meta.dirname, '..');
const BASE = process.env.BASE ?? 'http://localhost:5180';
const OUT = path.resolve(ROOT, process.env.OUT ?? `../../docs/design-check/${CHANGELOG[0].version}`);
const SIZES = [
  { w: 1280, h: 1080 },
  { w: 1920, h: 1080 },
];

interface Target {
  name: string;
  hash: string;
  /** 창을 여는 동작(주소로 간 뒤) */
  open?: (page: Page) => Promise<void>;
}

/** 화면 주소 — 메뉴(NAV_GROUPS)의 모든 page × 그 page 의 탭(PAGE_TABS) */
function targets(): Target[] {
  const list: Target[] = [];
  for (const g of NAV_GROUPS) {
    for (const p of g.pages) {
      const tabs = (PAGE_TABS as unknown as Record<string, readonly { id: string; path: string }[]>)[p.id];
      if (tabs?.length) for (const t of tabs) list.push({ name: `${p.id}-${t.path}`, hash: `#/${p.id}/${t.path}` });
      else list.push({ name: p.id, hash: `#/${p.id}` });
    }
  }
  const click = (text: string | RegExp) => async (page: Page) => {
    await page.getByRole('button', { name: text }).first().click();
    await page.waitForTimeout(900);
  };
  list.push(
    { name: 'dialog-종목고르기', hash: '#/backtest', open: click('종목 고르기') },
    {
      name: 'dialog-자동매매설정',
      hash: '#/portfolio/paper',
      open: async (page) => {
        await page.getByText('현재 계좌').first().click();
        await page.waitForTimeout(1200);
        await click('자동매매 설정')(page);
      },
    },
    { name: 'dialog-판단기준편집', hash: '#/swing/list', open: click(/판단 기준/) },
    {
      name: 'popover-날짜고르기',
      hash: '#/calendar',
      open: async (page) => {
        await page.locator('button[aria-haspopup="dialog"]').first().click();
        await page.waitForTimeout(500);
      },
    },
  );
  return list;
}

/** 페이지 안에서 재는 함수 — 반환은 항목별 문제 목록 */
export function measure() {
  type Issue = { kind: string; detail: string };
  const issues: Issue[] = [];
  const visible = (el: Element) => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return false;
    if (r.right < 0 || r.left > innerWidth || r.bottom < 0 || r.top > innerHeight * 3) return false;
    const cs = getComputedStyle(el);
    return cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0.05;
  };
  const label = (el: Element) => ((el as HTMLElement).innerText || el.getAttribute('aria-label') || el.tagName).trim().replace(/\s+/g, ' ').slice(0, 24);
  const offscreen = (el: Element) => Boolean(el.closest('[aria-hidden="true"]'));

  // 1. 같은 줄 높이
  const controls = [...document.querySelectorAll('button, input:not([type=checkbox]):not([type=radio]):not([type=range]), select, [role=radiogroup]')]
    .map((el) => (el.tagName === 'INPUT' && el.parentElement?.className.match(/\bh-[78]\b/) ? el.parentElement! : el))
    .filter((el) => visible(el) && !offscreen(el))
    // 버튼은 기준표 높이 클래스(h-7·h-8)가 있는 것만(목록 줄·카드·아이콘 버튼은 제외), 묶음 버튼 안의 칸은 묶음 하나로 잰다
    .filter((el) => el.tagName !== 'BUTTON' || (/\bh-[78]\b/.test(el.className) && !el.closest('[role=radiogroup]')));
  // 부모가 달라도 **눈으로 한 줄**이면 같은 줄이다 — 같은 창·구역 안에서 세로 가운데가 6px 안이고 옆 칸과 32px 안으로 붙어 있는 것끼리 묶는다
  const byArea = new Map<Element, Element[]>();
  for (const el of controls) {
    const area = el.closest('[role=dialog], section, header, nav, main, aside') ?? document.body;
    byArea.set(area, [...(byArea.get(area) ?? []), el]);
  }
  for (const [, els] of byArea) {
    if (els.length < 2) continue;
    const sorted = els
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .sort((x, y) => x.r.top + x.r.height / 2 - (y.r.top + y.r.height / 2) || x.r.left - y.r.left);
    const lines: { el: Element; r: DOMRect }[][] = [];
    for (const it of sorted) {
      const mid = it.r.top + it.r.height / 2;
      const line = lines.find((g) => Math.abs(g[0].r.top + g[0].r.height / 2 - mid) < 6);
      if (line) line.push(it);
      else lines.push([it]);
    }
    for (const line of lines) {
      line.sort((x, y) => x.r.left - y.r.left);
      // 가로로 32px 넘게 떨어지면 다른 묶음(같은 높이의 다른 구역)
      let run = [line[0]];
      const flush = () => {
        if (run.length < 2) return;
        const hs = run.map((e) => Math.round(e.r.height));
        if (Math.max(...hs) - Math.min(...hs) > 1) issues.push({ kind: '같은 줄 높이', detail: run.map((e, i) => `${label(e.el)}=${hs[i]}`).join(' · ') });
      };
      for (let i = 1; i < line.length; i++) {
        if (line[i].r.left - line[i - 1].r.right > 32) {
          flush();
          run = [line[i]];
        } else run.push(line[i]);
      }
      flush();
    }
  }

  // 2. FormRow 값 칸 끝 맞춤 — 같은 창·구역(dialog·section·main) 안에서
  const groups = new Map<Element, Element[]>();
  for (const v of document.querySelectorAll('[data-formrow-value]')) {
    if (!visible(v)) continue;
    const g = v.closest('[role=dialog], section, main') ?? document.body;
    groups.set(g, [...(groups.get(g) ?? []), v]);
  }
  for (const [, vs] of groups) {
    if (vs.length < 2) continue;
    const ls = vs.map((v) => Math.round(v.getBoundingClientRect().left));
    const rs = vs.map((v) => Math.round(v.getBoundingClientRect().right));
    const dl = Math.max(...ls) - Math.min(...ls);
    const dr = Math.max(...rs) - Math.min(...rs);
    if (dl > 0 || dr > 0) issues.push({ kind: '입력칸 끝 맞춤', detail: `${vs.length}칸 왼쪽 차이 ${dl}px · 오른쪽 차이 ${dr}px` });
  }

  // 3. 넘침·잘림
  for (const el of document.querySelectorAll('body *')) {
    if (!visible(el) || offscreen(el)) continue;
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim());
    if (!hasText) continue;
    const cs = getComputedStyle(el);
    const he = el as HTMLElement;
    if (!(cs.overflowX === 'hidden' || cs.overflowX === 'clip') || he.scrollWidth <= he.clientWidth + 1) continue;
    // 말줄임(…)도 센다 — 「글자를 줄이거나 말줄임으로 숨기지 않는다」. 다만 긴 종목명·문장처럼 의도한 말줄임이 있어 따로 센다
    const ellipsis = cs.textOverflow === 'ellipsis' || /truncate|line-clamp/.test(he.className);
    issues.push({ kind: ellipsis ? '말줄임' : '글자 잘림', detail: `${label(el)} (${he.scrollWidth}>${he.clientWidth})` });
  }

  // 4. 겹침 — 일반 흐름의 형제끼리
  for (const parent of document.querySelectorAll('body *')) {
    const kids = [...parent.children].filter((c) => {
      if (!visible(c) || offscreen(c)) return false;
      const cs = getComputedStyle(c);
      return cs.position !== 'absolute' && cs.position !== 'fixed' && cs.position !== 'sticky' && cs.float === 'none';
    });
    if (kids.length < 2 || kids.length > 60) continue;
    if (parent.closest('.tv-lightweight-charts, canvas, svg, table')) continue;
    const pcs = getComputedStyle(parent);
    if (pcs.display === 'grid' && pcs.gridTemplateAreas !== 'none') continue;
    const rects = kids.map((k) => k.getBoundingClientRect());
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) {
        const a = rects[i];
        const b = rects[j];
        const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
        const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
        if (ox > 2 && oy > 2) issues.push({ kind: '겹침', detail: `${label(kids[i])} ↔ ${label(kids[j])} (${Math.round(ox)}×${Math.round(oy)})` });
      }
  }

  // 5. 목록 줄 사이 간격
  for (const list of document.querySelectorAll('[data-list]')) {
    if (!visible(list)) continue;
    const kids = [...list.children].filter((c) => visible(c) && getComputedStyle(c).position !== 'absolute');
    for (let i = 1; i < kids.length; i++) {
      const gap = kids[i].getBoundingClientRect().top - kids[i - 1].getBoundingClientRect().bottom;
      if (gap < 3.5 && gap > -1) {
        issues.push({ kind: '목록 줄 간격', detail: `${label(list.closest('section, nav, [role=dialog]') ?? list)}: ${label(kids[i - 1])}→${label(kids[i])} ${gap.toFixed(1)}px` });
        break;
      }
    }
  }

  // 6. 글자 크기
  const sizes = new Map<number, string>();
  for (const el of document.querySelectorAll('body *')) {
    if (!visible(el) || offscreen(el)) continue;
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim());
    if (!hasText || (el as HTMLElement).style.fontSize) continue;
    const fs = Math.round(parseFloat(getComputedStyle(el).fontSize) * 10) / 10;
    if (![13, 14, 16, 18].includes(fs) && !sizes.has(fs)) sizes.set(fs, label(el));
  }
  for (const [fs, ex] of sizes) issues.push({ kind: fs < 13 ? '13px 미만' : '기준표 밖 크기', detail: `${fs}px 예: ${ex}` });

  // 7. 화면 폭 — 가운데로 좁힌 넓은 상자
  for (const el of document.querySelectorAll('body *')) {
    if (!visible(el) || offscreen(el) || el.closest('[role=dialog]')) continue;
    const cs = getComputedStyle(el);
    if (cs.maxWidth === 'none') continue;
    const ml = parseFloat(cs.marginLeft);
    const mr = parseFloat(cs.marginRight);
    const w = el.getBoundingClientRect().width;
    if (w > 500 && ml > 24 && Math.abs(ml - mr) < 2) issues.push({ kind: '화면 폭 좁힘', detail: `${label(el)} 폭 ${Math.round(w)}px · 좌우 ${Math.round(ml)}px` });
  }
  return issues;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  let token = process.env.TOKEN;
  if (!token) {
    if (!process.env.DB_PATH) throw new Error('DB_PATH(사본 DB) 또는 TOKEN 이 필요합니다 — 점검용 로그인 세션을 만듭니다');
    const { createSession } = await import('../server/auth');
    token = createSession('design-check');
  }
  const browser = await chromium.launch({ channel: 'chrome' });
  const all: { size: string; name: string; issues: { kind: string; detail: string }[]; console: string[] }[] = [];
  for (const size of SIZES) {
    const dir = path.join(OUT, String(size.w));
    fs.mkdirSync(dir, { recursive: true });
    const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h } });
    await ctx.addCookies([{ name: 'as_session', value: token!, url: BASE }]);
    // tsx(esbuild) 가 함수에 넣는 __name 도우미 — 브라우저에는 없어서 측정 함수가 깨진다
    await ctx.addInitScript('window.__name = (f) => f');
    const page = await ctx.newPage();
    let consoleErrors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && consoleErrors.push(m.text().slice(0, 160)));
    page.on('pageerror', (e) => consoleErrors.push(String(e).slice(0, 160)));
    await page.goto(`${BASE}/#/home`);
    await page.waitForTimeout(2500);
    // 종목이 있어야 의미가 있는 화면(차트·AI 분석) — 홈 첫 카드(애플)를 골라 둔다(주소에는 종목이 없다)
    await page.getByRole('button', { name: /애플/ }).first().click().catch(() => {});
    await page.waitForTimeout(1500);
    for (const t of targets()) {
      consoleErrors = [];
      await page.evaluate((h) => (location.hash = h), t.hash);
      await page.waitForTimeout(2200);
      if (t.open) await t.open(page).catch((e) => consoleErrors.push(`창 열기 실패: ${String(e).slice(0, 120)}`));
      const issues = await page.evaluate(measure);
      await page.screenshot({ path: path.join(dir, `${t.name}.png`) });
      all.push({ size: String(size.w), name: t.name, issues, console: [...consoleErrors] });
      if (t.open) await page.keyboard.press('Escape').catch(() => {});
      console.log(`${size.w} ${t.name}: ${issues.length}건${consoleErrors.length ? ` · 콘솔 오류 ${consoleErrors.length}` : ''}`);
    }
    await ctx.close();
  }
  await browser.close();

  const KINDS = ['같은 줄 높이', '입력칸 끝 맞춤', '글자 잘림', '말줄임', '겹침', '목록 줄 간격', '13px 미만', '기준표 밖 크기', '화면 폭 좁힘'];
  const md: string[] = [
    `# 디자인 숫자 측정 — ${CHANGELOG[0].version}`,
    '',
    `- 측정: ${new Date().toISOString()} · ${BASE} · 맥 크롬(Playwright) · ${SIZES.map((s) => `${s.w}×${s.h}`).join(' · ')}`,
    `- 화면 ${all.length / SIZES.length}개 × 크기 ${SIZES.length} · 캡처는 같은 폴더의 1280/ · 1920/`,
    '',
    `| 크기 | 화면 | ${KINDS.join(' | ')} | 콘솔 오류 |`,
    `|---|---|${KINDS.map(() => '---').join('|')}|---|`,
  ];
  for (const r of all) {
    const cnt = (k: string) => r.issues.filter((i) => i.kind === k).length;
    md.push(`| ${r.size} | ${r.name} | ${KINDS.map((k) => (cnt(k) ? `**${cnt(k)}**` : '맞음')).join(' | ')} | ${r.console.length ? `**${r.console.length}**` : '0'} |`);
  }
  md.push('', '## 고칠 곳 상세', '');
  for (const r of all) {
    if (!r.issues.length && !r.console.length) continue;
    md.push(`### ${r.size} · ${r.name}`);
    for (const i of r.issues) md.push(`- [${i.kind}] ${i.detail}`);
    for (const c of r.console) md.push(`- [콘솔 오류] ${c}`);
    md.push('');
  }
  fs.writeFileSync(path.join(OUT, 'report.md'), md.join('\n'));
  fs.writeFileSync(path.join(OUT, 'result.json'), JSON.stringify(all, null, 1));
  const total = all.reduce((n, r) => n + r.issues.length + r.console.length, 0);
  console.log(`\n디자인 측정 — 고칠 곳 ${total}건 · 보고서 ${path.relative(process.cwd(), path.join(OUT, 'report.md'))}`);
  process.exit(0);
}

// 측정 함수만 가져다 쓰는 자체 점검(알려진 문제를 심은 페이지)에서는 실행하지 않는다
if (process.argv[1]?.endsWith('designCheck.ts'))
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
