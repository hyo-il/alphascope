/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
/**
 * 디자인 숫자 측정 (v2.42.0, `npm run design:check`) — 디자인 점검 세 겹의 둘째(CLAUDE.md 「디자인 점검」).
 *
 * 테스트 서버(기본 http://localhost:5180)의 **모든 화면 주소**(메뉴·탭 — `types/nav.ts` 의 NAV_GROUPS·PAGE_TABS 에서 읽는다) +
 * 주요 창(종목 추가 · 자동매매 설정 · 판단 기준 편집 · 날짜 고르기)을 **1280×1080 · 1440×900 · 1920×1080 · 2560×1440** 에서 열어 잰다:
 *   1. 같은 줄의 입력칸·드롭박스·버튼(높이 클래스 h-7/h-8 이 있는 것)·묶음 버튼 높이 같음
 *   2. 같은 묶음(창·구역)의 `FormRow` — 칸 오른쪽 끝 · 단위 열 왼쪽 끝 · 설명 시작점 차이 0px, 숫자 칸 폭 = 종류 변수, 이름 넘침 0 (v2.42.3)
 *   3. 글자 넘침·잘림(overflow 가 숨김인데 scrollWidth > clientWidth) — 말줄임(truncate)은 「말줄임」 으로 따로 센다
 *   4. 요소 겹침(일반 흐름의 형제 요소 사각형이 2px 넘게 겹침)
 *   5. 목록(`data-list`) 줄 사이 간격 ≥ 4px
 *   6. 글자 크기 — 13px 미만 0, 기준표(13·14·16·18) 밖 0(로그인 앱 제목 22 · 인라인 style 로 크기를 정하는 종목 지도 칸 예외)
 *   7. 화면 내용이 화면 폭을 꽉 채움(가운데로 좁힌 넓은 상자 — 좌우 여백이 같고 max-width 가 걸린 것)
 *   8. 콘솔 오류 0
 *   9. 표 숫자 칸 벌어짐(v2.42.1) — 숫자 칸 폭이 내용보다 64px 넘게 넓으면(남는 폭은 이름 칸이 가져가야 한다)
 *  10. 탭 줄 첫 탭 ↔ 같은 영역 내용 첫 요소의 왼쪽 끝(v2.42.2)
 *  11. 숫자 입력칸 — 스피너 없음 · 같은 묶음 FormRow 숫자 오른쪽 끝 0px
 *  12. 4자리 이상 숫자에 쉼표 없음(날짜·시각·버전·연도·종목 코드·「포트 N」 제외) · 13. 하이픈 음수 · 14. 같은 표 열의 소수 자릿수 다름
 *  15. 날짜 표기 — 오전/오후 시각 · 「YYYY. M. D.」 형식 0 (v2.42.3, 형식 2026-10-08 14:30)
 *  `[data-measure-skip]` 안(업데이트 내역 같은 기록 글)은 12~14 를 재지 않는다
 * 결과: `<OUT>/report.md`(화면별 표) · `<OUT>/{1280,1920}/<이름>.png` · `<OUT>/result.json`.
 *
 * 쓰는 법(테스트 서버를 띄운 뒤):
 *   DB_PATH=<사본 DB> npm run design:check            — 사본 DB 에 점검용 로그인 세션을 만든다
 *   BASE=http://localhost:5180 OUT=../../docs/design-check/v2.42.0 …   (기본 OUT = 관리 루트 docs/design-check/<changelog 맨 앞 버전>)
 * ⚠️ 실제 Windows 크롬은 재지 못한다(맥 크롬 — 스크롤바는 앱이 꾸며서 자리를 차지하는 같은 조건).
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다(v2.44.2)
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Page } from 'playwright';
import { NAV_GROUPS, PAGE_TABS } from '../src/types/nav';
import { CHANGELOG } from '../src/data/changelog';

const ROOT = path.resolve(import.meta.dirname, '..');
const BASE = process.env.BASE ?? 'http://localhost:5180';
const OUT = path.resolve(ROOT, process.env.OUT ?? `../../docs/design-check/${CHANGELOG[0].version}`);
/** v2.42.1 — 1280 이상 여러 크기를 쓴다(사용자). 1440×900 은 1080 보다 낮다(오른쪽 열 예비 스크롤). `SIZES=1920x1080,2560x1440` 로 일부만 */
const SIZES = (process.env.SIZES ?? '1280x1080,1440x900,1920x1080,2560x1440').split(',').map((x) => {
  const [w, h] = x.split('x').map(Number);
  return { w, h };
});

interface Target {
  name: string;
  hash: string;
  /** 창을 여는 동작(주소로 간 뒤) */
  open?: (page: Page) => Promise<void>;
  /** 주소로 가기 전 (v2.44.0) — 응답 바꿔치기(`page.route`)로 「규칙 없음」 같은 상태를 DB 를 건드리지 않고 만든다 */
  before?: (page: Page) => Promise<void>;
  /** 잰 뒤 되돌리기 */
  after?: (page: Page) => Promise<void>;
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
  /** 접힌 「고급 설정」 을 모두 펼친다(펼치면 안에 또 있을 수 있어 몇 번 돈다) — 접힌 폼 줄도 재기 위해 (v2.42.3) */
  const expandAdvanced = async (page: Page) => {
    for (let i = 0; i < 4; i++) {
      const closed = page.locator('button[aria-expanded="false"]', { hasText: '고급 설정' });
      const n = await closed.count();
      if (!n) break;
      for (let k = 0; k < n; k++) await closed.first().click().catch(() => {});
      await page.waitForTimeout(400);
    }
  };
  const openAccountSettings = async (page: Page) => {
    await page.getByText('현재 계좌').first().click();
    await page.waitForTimeout(1200);
    await click('자동매매 설정')(page);
  };
  list.push(
    { name: 'dialog-자동매매설정-고급', hash: '#/portfolio/paper', open: async (page) => { await openAccountSettings(page); await expandAdvanced(page); } },
    { name: 'dialog-판단기준편집-고급', hash: '#/swing/list', open: async (page) => { await click(/판단 기준/)(page); await expandAdvanced(page); } },
    { name: 'backtest-고급', hash: '#/backtest', open: expandAdvanced },
    { name: 'form-새계좌', hash: '#/portfolio/paper', open: click(/새 계좌/) },
    // v2.44.2 — 종목 지도(시장 상위 미국 100 · 내 관심 국내), 「N초 전 갱신」(장이 닫힌 시각에도 보이게 응답의 marketOpen 만 바꿔치기 — DB 는 그대로),
    // 처음 켜기 안내 종목 단계, 지정 종목 설정 창의 [종목 추가]
    ...(
      [
        ['heatmap-시장상위-미국100', { view: 'market', market: 'us', top: 100 }],
        ['heatmap-관심-국내', { view: 'watch', market: 'kr', top: 50 }],
      ] as const
    ).map(([name, v]) => ({
      name,
      hash: '#/heatmap',
      before: async (page: Page) => {
        await page.evaluate((v) => localStorage.setItem('alphascope.heatmapView', JSON.stringify({ ...v, period: '1d', off: { market: [], watch: [] }, watchSize: 'cap' })), v);
      },
    })),
    // v2.44.3 — 기준가를 확인하지 못한 종목은 등락률이 null → 「—」(지도 칸 · 관심 패널). 응답의 절반을 null 로 바꿔치기 — DB 는 그대로
    {
      name: 'heatmap-등락률없음',
      hash: '#/heatmap',
      before: async (page) => {
        await page.evaluate(() => localStorage.setItem('alphascope.heatmapView', JSON.stringify({ view: 'watch', market: 'kr', top: 50, period: '1d', off: { market: [], watch: [] }, watchSize: 'cap' })));
        await page.route('**/api/heatmap**', async (r) => {
          const res = await r.fetch();
          const body = (await res.json()) as { cells: { changeRate: number | null }[] };
          body.cells.forEach((c, i) => i % 2 === 0 && (c.changeRate = null));
          await r.fulfill({ response: res, json: body });
        });
        await page.route('**/api/quotes**', async (r) => {
          const res = await r.fetch();
          const body = (await res.json()) as { quotes: { changeRate: number | null }[] };
          body.quotes?.forEach((q, i) => i % 2 === 0 && (q.changeRate = null));
          await r.fulfill({ response: res, json: body });
        });
      },
      after: async (page) => {
        await page.unroute('**/api/heatmap**');
        await page.unroute('**/api/quotes**');
      },
      open: async (page) => { await page.waitForTimeout(2500); },
    },
    {
      name: 'heatmap-장중-N초전갱신',
      hash: '#/heatmap',
      before: async (page) => {
        await page.evaluate(() => localStorage.setItem('alphascope.heatmapView', JSON.stringify({ view: 'market', market: 'us', top: 50, period: '1d', off: { market: [], watch: [] }, watchSize: 'cap' })));
        await page.route('**/api/heatmap**', async (r) => {
          const res = await r.fetch();
          const body = (await res.json()) as Record<string, unknown>;
          await r.fulfill({ response: res, json: { ...body, marketOpen: true } });
        });
      },
      after: (page) => page.unroute('**/api/heatmap**'),
      open: async (page) => { await page.waitForTimeout(3000); },
    },
    {
      name: 'dialog-처음켜기-종목단계',
      hash: '#/portfolio/paper',
      open: async (page) => {
        await page.getByRole('button', { name: /계좌 모아보기/ }).first().click().catch(() => {});
        await page.waitForTimeout(1000);
        await click(/자동매매 처음 켜기/)(page);
        await click('있는 계좌 고르기')(page);
        await click(/^다음$/)(page);
        await click(/^다음$/)(page);
      },
    },
    {
      name: 'dialog-지정종목-설정',
      hash: '#/analysis/records',
      open: async (page) => {
        await page.getByText('내가 지정한 종목').first().locator('xpath=..').getByRole('button', { name: '설정', exact: true }).first().click();
        await page.waitForTimeout(800);
      },
    },
    // v2.44.1 — 계좌 「지금 조건」 펼침(「다음 판단」 시장별 개장 시각 — 서버가 휴장일까지 보고 계산)
    {
      name: 'account-지금조건-다음판단',
      hash: '#/portfolio/paper',
      open: async (page) => {
        await page.getByText('현재 계좌').first().click();
        await page.waitForTimeout(1200);
        await click('조건 상세 보기')(page);
      },
    },
    { name: 'dialog-종목추가', hash: '#/backtest', open: click('종목 추가') },
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
    // 매매 규칙 (v2.43.0) — 보기(잠김) · 수정 + 고급 설정 펼침 · 새 규칙(빈 규칙)
    { name: 'dialog-매매규칙-보기', hash: '#/rules', open: click('조건 보기') },
    {
      name: 'dialog-매매규칙-수정-고급',
      hash: '#/rules',
      open: async (page) => {
        await click('조건 보기')(page);
        await click(/^수정$/)(page);
        await expandAdvanced(page);
      },
    },
    { name: 'dialog-매매규칙-새규칙', hash: '#/rules', open: click('새 규칙 만들기') },
    // v2.44.0 — 자동매매 설정 「규칙 없음」 · 「손절 끔 경고」(규칙 목록 응답을 바꿔치기 — DB 는 건드리지 않는다), 처음 켜기 2단계,
    // 백테스트 방법 3개 + 종목 표 12줄(이 기기 초안) · 규칙 없음 · [계좌에 적용] 확인 창
    {
      name: 'dialog-자동매매설정-규칙없음',
      hash: '#/portfolio/paper',
      before: async (page) => { await page.route('**/api/rules', (r) => r.fulfill({ json: { rules: [] } })); },
      after: (page) => page.unroute('**/api/rules'),
      open: openAccountSettings,
    },
    {
      name: 'dialog-자동매매설정-손절끔경고',
      hash: '#/portfolio/paper',
      before: async (page) => {
        await page.route('**/api/rules', async (r) => {
          const res = await r.fetch();
          const body = (await res.json()) as { rules: { sell: { stopLoss: { on: boolean } } }[] };
          for (const x of body.rules) x.sell.stopLoss.on = false;
          await r.fulfill({ response: res, json: body });
        });
      },
      after: (page) => page.unroute('**/api/rules'),
      open: openAccountSettings,
    },
    {
      name: 'dialog-처음켜기-2단계',
      hash: '#/portfolio/paper',
      open: async (page) => {
        await page.getByRole('button', { name: /계좌 모아보기/ }).first().click().catch(() => {});
        await page.waitForTimeout(1000);
        await click(/자동매매 처음 켜기/)(page);
        await click('있는 계좌 고르기')(page);
        await click(/^다음$/)(page);
      },
    },
    {
      name: 'backtest-방법3개-종목표',
      hash: '#/backtest',
      before: async (page) => {
        await page.evaluate(async () => {
          const rules = (await (await fetch('/api/rules')).json()) as { rules: { id: number }[] };
          const id = rules.rules[0]?.id ?? null;
          const uni = (await (await fetch('/api/backtest/universe')).json()) as { sectors: { symbols: { symbol: string }[] }[] };
          const symbols = uni.sectors.flatMap((g) => g.symbols.map((x) => x.symbol)).slice(0, 12);
          localStorage.setItem('alphascope.backtestDraft', JSON.stringify({ symbols, added: [], years: 1, conditions: [{ ruleId: id }, { ruleId: id }, { ruleId: id }] }));
        });
      },
      after: (page) => page.evaluate(() => localStorage.removeItem('alphascope.backtestDraft')),
    },
    {
      name: 'backtest-규칙없음',
      hash: '#/backtest',
      before: async (page) => { await page.route('**/api/rules', (r) => r.fulfill({ json: { rules: [] } })); },
      after: (page) => page.unroute('**/api/rules'),
    },
    {
      name: 'dialog-백테스트-계좌에적용-확인',
      hash: '#/backtest',
      // 앞 대상(규칙 없음 바꿔치기)의 화면이 남지 않게 홈을 거쳐 다시 그린다
      before: async () => {},
      open: async (page) => {
        await click('계좌에 적용')(page);
        await page.locator('[role=dialog] li button').first().click();
        await page.waitForTimeout(700);
      },
    },
    // 사이드 메뉴 — 보고 있는 대메뉴를 접은 상태 (v2.43.1)
    {
      name: 'nav-보고있는대메뉴-접힘',
      hash: '#/compare',
      open: async (page) => {
        await page.locator('nav button[aria-expanded="true"]', { hasText: '차트·비교' }).first().click();
        await page.waitForTimeout(400);
      },
    },
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

  // 2. 폼 줄(FormRow) — 같은 묶음(창·구역) 안에서 (v2.42.3 기준표 「입력칸」)
  //    칸 오른쪽 끝 0px · 단위 열 왼쪽 끝 0px · 설명 시작점 0px · 숫자 칸 폭 = 종류 변수(short 64 · long 128) · 이름 넘침 0
  const groups = new Map<Element, Element[]>();
  for (const row of document.querySelectorAll('[data-formrow]')) {
    if (!visible(row)) continue;
    const g = row.closest('[role=dialog], section, main') ?? document.body;
    groups.set(g, [...(groups.get(g) ?? []), row]);
  }
  const spread = (xs: number[]) => (xs.length < 2 ? 0 : Math.max(...xs) - Math.min(...xs));
  for (const [, rows] of groups) {
    const cellRight: number[] = [];
    const unitLeft: number[] = [];
    const hintLeft: number[] = [];
    for (const row of rows) {
      const cell = row.querySelector('[data-formrow-value]');
      // 감싼 요소가 아니라 **보이는 조작 요소 자체**의 오른쪽 끝(숫자 칸은 칸 상자) — 감싼 span 에 빈 단위 자리가 남아 있으면 그 폭이 끝으로 잡혀 어긋남을 놓쳤다(v2.42.3)
      const ctrls = cell
        ? [...cell.querySelectorAll('input:not([type=checkbox]):not([type=radio]), select, [role=radiogroup], label, button')]
            .map((c) => (c.tagName === 'INPUT' ? c.parentElement! : c))
            .filter((c) => visible(c))
        : [];
      if (ctrls.length) cellRight.push(Math.max(...ctrls.map((c) => Math.round(c.getBoundingClientRect().right))));
      const unit = row.querySelector('[data-formrow-unit]');
      if (unit && visible(unit)) unitLeft.push(Math.round(unit.getBoundingClientRect().left));
      const hint = row.querySelector('[data-formrow-hint]');
      if (hint && visible(hint)) hintLeft.push(Math.round(hint.getBoundingClientRect().left));
      const lab = row.querySelector('label');
      if (lab && (lab as HTMLElement).scrollWidth > (lab as HTMLElement).clientWidth + 1)
        issues.push({ kind: '입력칸 끝 맞춤', detail: `이름이 이름 칸을 넘침 — 「${label(lab)}」` });
      for (const box of cell?.querySelectorAll('input[type=number], input[inputmode=decimal]') ?? []) {
        const w = Math.round(box.parentElement!.getBoundingClientRect().width);
        if (![64, 128].includes(w)) issues.push({ kind: '입력칸 끝 맞춤', detail: `숫자 칸 폭 ${w}px — 종류 변수(64·128)와 다름 「${label(row.querySelector('label') ?? row)}」` });
      }
    }
    const dr = spread(cellRight);
    const du = spread(unitLeft);
    const dh = spread(hintLeft);
    if (dr > 0 || du > 0 || dh > 0) issues.push({ kind: '입력칸 끝 맞춤', detail: `${rows.length}줄 — 칸 오른쪽 끝 차이 ${dr}px · 단위 열 ${du}px · 설명 시작 ${dh}px` });
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
  // 9. 표 숫자 칸 벌어짐 (v2.42.1) — 숫자 칸은 내용 폭 + 고정 여백. 칸 폭이 내용보다 64px 넘게 넓으면 남는 폭이 숫자 칸으로 간 것이다
  const NUM = /^[−+\-]?[₩$]?[−+\-]?[\d,.]+(%|%p|억|조|만|주|일|회|R)?$|^—$/;
  for (const table of document.querySelectorAll('table')) {
    if (!visible(table) || offscreen(table) || table.getBoundingClientRect().width < 600) continue;
    const rows = [...table.querySelectorAll('tbody tr')].filter((r) => r.children.length > 1).slice(0, 30);
    if (rows.length < 2) continue;
    const head = table.querySelector('thead tr');
    const cols = Math.max(...rows.map((r) => r.children.length));
    for (let c = 0; c < cols; c++) {
      const cells = rows.map((r) => r.children[c] as HTMLTableCellElement | undefined).filter((x): x is HTMLTableCellElement => !!x && x.colSpan === 1);
      const texts = cells.map((x) => x.innerText.trim()).filter(Boolean);
      if (texts.length < 2 || texts.filter((t) => NUM.test(t.replace(/\s/g, ''))).length < texts.length * 0.8) continue;
      let slack = Infinity;
      for (const cell of cells) {
        const range = document.createRange();
        range.selectNodeContents(cell);
        const content = range.getBoundingClientRect().width;
        const cs = getComputedStyle(cell);
        slack = Math.min(slack, cell.getBoundingClientRect().width - content - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight));
      }
      if (slack > 64) {
        const name = (head?.children[c] as HTMLElement | undefined)?.innerText.trim() || `${c + 1}번째 칸`;
        issues.push({ kind: '표 숫자 칸 벌어짐', detail: `${label(table.closest('section, main, [role=dialog]') ?? table)} · 「${name}」 칸이 내용보다 ${Math.round(slack)}px 넓음` });
      }
    }
  }
  // 10. 탭 줄 · 내용 왼쪽 끝 (v2.42.2) — 탭 줄(role=tablist)의 첫 탭 왼쪽과, 같은 영역에서 그 다음에 오는 내용의 첫 요소 왼쪽이 같아야 한다
  const firstLeaf = (root: Element): Element | null => {
    let el: Element | null = root;
    for (let d = 0; el && d < 12; d++) {
      const kids: Element[] = [...el.children].filter((c) => visible(c) && getComputedStyle(c).position !== 'absolute' && getComputedStyle(c).position !== 'fixed');
      const hasOwnText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent!.trim());
      // 바탕색이 있는 상자(카드·안내 상자)는 상자의 왼쪽 끝으로 잰다 — 상자 안 글자의 안쪽 여백은 상자의 일이다
      const bg = getComputedStyle(el).backgroundColor;
      const boxed = el !== root && bg !== 'transparent' && !/rgba\(.*,\s*0\)$/.test(bg);
      if (boxed || hasOwnText || !kids.length || /^(BUTTON|INPUT|SELECT|TEXTAREA|TABLE|svg|CANVAS|IMG)$/i.test(el.tagName) || el.getAttribute('role') === 'tablist') return el;
      el = kids[0];
    }
    return el;
  };
  for (const tl of document.querySelectorAll('[role=tablist]')) {
    if (!visible(tl) || offscreen(tl) || tl.closest('[data-measure-skip]')) continue;
    const firstTab = [...tl.children].find((c) => visible(c));
    if (!firstTab) continue;
    const tabLeft = firstTab.getBoundingClientRect().left;
    let node: Element = tl;
    for (let up = 0; up < 4 && node.parentElement; up++) {
      const parent: Element = node.parentElement;
      const sibs = [...parent.children];
      // 탭 줄과 같은 줄(옆)에 있는 것(오른쪽 끝 배지·버튼)은 내용이 아니다 — 탭 줄 **아래**에서 시작하는 첫 요소
      const tlBottom = tl.getBoundingClientRect().bottom;
      const next = sibs
        .slice(sibs.indexOf(node) + 1)
        .find((c) => visible(c) && !['absolute', 'fixed'].includes(getComputedStyle(c).position) && c.getBoundingClientRect().top >= tlBottom - 1);
      if (next) {
        const leaf = firstLeaf(next);
        if (leaf && visible(leaf)) {
          const cs = getComputedStyle(leaf);
          // 가운데 정렬한 안내(빈 화면 등)는 왼쪽 끝 대상이 아니다
          if (cs.textAlign !== 'center' && !leaf.closest('.text-center, .justify-center')) {
            const d = Math.round(leaf.getBoundingClientRect().left - tabLeft);
            if (Math.abs(d) > 1)
              issues.push({ kind: '탭·내용 왼쪽 끝', detail: `「${label(firstTab)}」 탭 줄 ↔ 「${label(leaf)}」 ${d > 0 ? '+' : ''}${d}px` });
          }
        }
        break;
      }
      node = parent;
    }
  }

  // 11. 숫자 입력칸 — 스피너 없음 · 같은 묶음(창·구역)의 FormRow 숫자 오른쪽 끝 0px
  const numGroups = new Map<Element, HTMLInputElement[]>();
  for (const inp of document.querySelectorAll<HTMLInputElement>('input[type=number], input[inputmode=decimal], input[inputmode=numeric]')) {
    if (!visible(inp) || offscreen(inp)) continue;
    if (inp.type === 'number' && getComputedStyle(inp).appearance !== 'textfield') issues.push({ kind: '숫자 입력칸', detail: `스피너 있음 — ${inp.getAttribute('aria-label') ?? inp.name ?? '입력칸'}` });
    const row = inp.closest('[data-formrow-value]');
    if (!row) continue;
    const g = row.closest('[role=dialog], section, main') ?? document.body;
    numGroups.set(g, [...(numGroups.get(g) ?? []), inp]);
  }
  for (const [, ins] of numGroups) {
    if (ins.length < 2) continue;
    const rights = ins.map((i) => {
      const r = i.getBoundingClientRect();
      return Math.round(r.right - parseFloat(getComputedStyle(i).paddingRight));
    });
    const d = Math.max(...rights) - Math.min(...rights);
    if (d > 0) issues.push({ kind: '숫자 입력칸', detail: `숫자 오른쪽 끝 차이 ${d}px (${ins.length}칸)` });
  }

  // 12·13. 화면 글자의 숫자 표기 — 4자리 이상 쉼표 없음 · 하이픈 음수
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seenNum = new Set<string>();
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const el = n.parentElement;
    const text = n.textContent ?? '';
    if (!el || !text.trim() || !visible(el) || offscreen(el) || el.closest('pre, code, textarea, script, style, [data-measure-skip], .tv-lightweight-charts')) continue;
    // 날짜·시각·버전·연도를 먼저 지운다(쉼표를 붙이지 않는 숫자)
    const cleaned = text
      .replace(/\d{4}-\d{2}-\d{2}|\d{4}\.\s?\d{1,2}\.\s?\d{1,2}\.?|\d{2}:\d{2}(:\d{2})?|v\d+\.\d+\.\d+|\b(19|20)\d{2}(?=년|\b)/g, ' ')
      .replace(/\(\d{6}\)|\b[0-9][0-9A-Z]{5}\b(?=\s*$)|포트 \d+/g, ' ');
    const trimmed = text.trim();
    // 종목 코드만 적힌 칸(티커 자리 — 6자리 코드)은 제외
    if (/^[0-9][0-9A-Z]{5}$/.test(trimmed)) continue;
    const big = cleaned.match(/(?<![\d.,])\d{4,}(?![\d,])/);
    if (big && !seenNum.has('c' + trimmed)) {
      seenNum.add('c' + trimmed);
      issues.push({ kind: '쉼표 없는 큰 수', detail: `${big[0]} — 「${trimmed.slice(0, 30)}」` });
    }
    const hy = cleaned.match(/(^|[\s(:·\[/])-\$?₩?\d/);
    if (hy && !seenNum.has('h' + trimmed)) {
      seenNum.add('h' + trimmed);
      issues.push({ kind: '하이픈 음수', detail: `「${trimmed.slice(0, 30)}」` });
    }
  }

  // 14. 같은 표 열 안에서 소수 자릿수 다름
  for (const table of document.querySelectorAll('table')) {
    // 줄마다 다른 값을 담는 설정표(`data-rows-differ` — 판단 기준 숫자표)는 열의 자릿수가 섞이는 게 맞다 (v2.42.3)
    if (!visible(table) || offscreen(table) || table.closest('[data-measure-skip]') || table.hasAttribute('data-rows-differ')) continue;
    const rows = [...table.querySelectorAll('tbody tr')].filter((r) => r.children.length > 1).slice(0, 40);
    const cols = rows.length ? Math.max(...rows.map((r) => r.children.length)) : 0;
    const head = table.querySelector('thead tr');
    for (let c = 0; c < cols; c++) {
      const decs = new Set<number>();
      let anyDec = false;
      for (const r of rows) {
        const cell = r.children[c] as HTMLElement | undefined;
        const t = cell?.innerText.trim().split('\n')[0] ?? '';
        const m = t.match(/^[−+\-]?[₩$]?[−+\-]?[\d,]+(\.(\d+))?(%|%p)?$/);
        if (!m) continue;
        if (m[2]) anyDec = true;
        decs.add(m[2]?.length ?? 0);
      }
      if (anyDec && decs.size > 1) {
        const name = (head?.children[c] as HTMLElement | undefined)?.innerText.trim() || `${c + 1}번째 칸`;
        issues.push({ kind: '소수 자릿수', detail: `「${name}」 칸: 소수 ${[...decs].sort().join('·')}자리가 섞임` });
      }
    }
  }
  // 15. 날짜 표기 (v2.42.3) — 오전/오후 시각 · 「2026. 9. 3.」 형식이 화면에 남아 있으면 안 된다(형식 `2026-10-08 14:30`)
  const dw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  const seenDate = new Set<string>();
  for (let n = dw.nextNode(); n; n = dw.nextNode()) {
    const el = n.parentElement;
    const text = n.textContent ?? '';
    if (!el || !text.trim() || !visible(el) || offscreen(el) || el.closest('pre, code, textarea, [data-measure-skip]')) continue;
    if (/(오전|오후)\s?\d{1,2}:\d{2}|\d{4}\.\s?\d{1,2}\.\s?\d{1,2}\./.test(text) && !seenDate.has(text.trim())) {
      seenDate.add(text.trim());
      issues.push({ kind: '날짜 표기', detail: `「${text.trim().slice(0, 40)}」` });
    }
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
    for (const t of targets().filter((x) => !process.env.ONLY || new RegExp(process.env.ONLY).test(x.name))) {
      consoleErrors = [];
      // 마우스를 화면 구석으로 — 앞 화면에서 누른 자리에 남아 있으면 새 화면의 줄에 올라가 있는 상태(마우스 오버 미리보기 등)로 찍힌다(v2.42.3)
      await page.mouse.move(0, 0);
      if (t.before) {
        // 같은 화면이 이미 떠 있으면 새로 받지 않으므로 홈을 거쳐 다시 그리게 한다
        await page.evaluate(() => (location.hash = '#/home'));
        await page.waitForTimeout(500);
        await t.before(page);
      }
      await page.evaluate((h) => (location.hash = h), t.hash);
      await page.waitForTimeout(2200);
      if (t.open) await t.open(page).catch((e) => consoleErrors.push(`창 열기 실패: ${String(e).slice(0, 120)}`));
      const issues = await page.evaluate(measure);
      await page.screenshot({ path: path.join(dir, `${t.name}.png`) });
      all.push({ size: String(size.w), name: t.name, issues, console: [...consoleErrors] });
      if (t.open) await page.keyboard.press('Escape').catch(() => {});
      if (t.after) await t.after(page).catch(() => {});
      console.log(`${size.w} ${t.name}: ${issues.length}건${consoleErrors.length ? ` · 콘솔 오류 ${consoleErrors.length}` : ''}`);
    }
    await ctx.close();
  }
  await browser.close();

  const KINDS = ['같은 줄 높이', '입력칸 끝 맞춤', '글자 잘림', '말줄임', '겹침', '목록 줄 간격', '13px 미만', '기준표 밖 크기', '화면 폭 좁힘', '표 숫자 칸 벌어짐', '탭·내용 왼쪽 끝', '숫자 입력칸', '쉼표 없는 큰 수', '하이픈 음수', '소수 자릿수', '날짜 표기'];
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
