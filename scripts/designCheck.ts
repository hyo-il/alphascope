/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
/**
 * 디자인 숫자 측정 (`npm run design:check`) — 디자인 점검 세 겹의 둘째(docs/rules/design.md 「디자인 점검 세 겹」).
 *
 * 테스트 서버(기본 http://localhost:5180)의 **모든 화면 주소**(메뉴·탭 — `types/nav.ts` 의 NAV_GROUPS·PAGE_TABS 에서 읽는다) +
 * 주요 창(종목 추가 · 자동매매 설정 · 판단 기준 편집 · 날짜 고르기)을 **1280×1080 · 1440×900 · 1920×1080 · 2560×1440** 에서 열어 잰다:
 *   1. 같은 줄의 입력칸·드롭박스·버튼(높이 클래스 h-7/h-8 이 있는 것)·묶음 버튼 높이 같음
 *   2. 같은 묶음(창·구역)의 `FormRow` — 칸 오른쪽 끝 · 단위 열 왼쪽 끝 · 설명 시작점 차이 0px, 숫자 칸 폭 = 종류 변수, 이름 넘침 0
 *   3. 글자 넘침·잘림(overflow 가 숨김인데 scrollWidth > clientWidth) — 말줄임(truncate)은 「말줄임」 으로 따로 센다
 *   4. 요소 겹침(일반 흐름의 형제 요소 사각형이 2px 넘게 겹침)
 *   5. 목록(`data-list`) 줄 사이 간격 ≥ 4px
 *   6. 글자 크기 — 13px 미만 0, 기준표(13·14·16·18) 밖 0(로그인 앱 제목 22 · 인라인 style 로 크기를 정하는 종목 지도 칸 예외)
 *   7. 화면 내용이 화면 폭을 꽉 채움(가운데로 좁힌 넓은 상자 — 좌우 여백이 같고 max-width 가 걸린 것)
 *   8. 콘솔 오류 0
 *   9. 표 숫자 칸 벌어짐 — 숫자 칸 폭이 내용보다 64px 넘게 넓으면(남는 폭은 이름 칸이 가져가야 한다)
 *  10. 탭 줄 첫 탭 ↔ 같은 영역 내용 첫 요소의 왼쪽 끝
 *  11. 숫자 입력칸 — 스피너 없음 · 같은 묶음 FormRow 숫자 오른쪽 끝 0px
 *  12. 4자리 이상 숫자에 쉼표 없음(날짜·시각·버전·연도·종목 코드·「포트 N」 제외) · 13. 하이픈 음수 · 14. 같은 표 열의 소수 자릿수 다름
 *  15. 날짜 표기 — 오전/오후 시각 · 「YYYY. M. D.」 형식 0 (형식 2026-10-08 14:30)
 *  16. 차트 축 숫자 잘림 — 칸이 여럿인 차트의 오른쪽 축 글자가 칸 위아래 끝에 닿음 0(가격 칸 맨 아래 · 거래량 칸 맨 위 숫자가 경계에서 맞붙지 않게)
 *  `[data-measure-skip]` 안(업데이트 내역 같은 기록 글)은 12~14 를 재지 않는다
 * 결과: `<OUT>/report.md`(화면별 표) · `<OUT>/{1280,1920}/<이름>.png` · `<OUT>/result.json`.
 *
 * 쓰는 법(테스트 서버를 띄운 뒤):
 *   DB_PATH=<사본 DB> npm run design:check            — 사본 DB 에 점검용 로그인 세션을 만든다
 *   BASE=http://localhost:5180 OUT=../../docs/design-check/<버전> …   (기본 OUT = 관리 루트 docs/design-check/<changelog 맨 앞 버전>)
 * ⚠️ 실제 Windows 크롬은 재지 못한다(맥 크롬 — 스크롤바는 앱이 꾸며서 자리를 차지하는 같은 조건).
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type Locator, type Page } from 'playwright';
import { NAV_GROUPS, PAGE_TABS } from '../src/types/nav';
import { rankingSample, usHaltsSample } from './fixtures/usHalts/screenSample';
import { briefSample, daySample, daysSample, mismatchSample, outlookSample, statusSample } from './fixtures/marketBrief/screenSample';
import { assetNewPlanSample, assetTradesSample, assetHistorySample, assetSheetFailureSample, assetSheetSample, assetStatusSample, assetSummaryFailureSample, assetSummarySample } from './fixtures/asset/screenSample';
import { CHANGELOG } from '../src/data/changelog';
import { sortDayRows } from '../src/utils/buyJudgeOrder';

const ROOT = path.resolve(import.meta.dirname, '..');
const BASE = process.env.BASE ?? 'http://localhost:5180';
const OUT = path.resolve(ROOT, process.env.OUT ?? `../../docs/design-check/${CHANGELOG[0].version}`);
/** 1280 이상 여러 크기를 쓴다(사용자). 1440×900 은 1080 보다 낮다(오른쪽 열 예비 스크롤). `SIZES=1920x1080,2560x1440` 로 일부만 */
const SIZES = (process.env.SIZES ?? '1280x1080,1440x900,1920x1080,2560x1440').split(',').map((x) => {
  const [w, h] = x.split('x').map(Number);
  return { w, h };
});

interface Target {
  name: string;
  hash: string;
  /** 창을 여는 동작(주소로 간 뒤) */
  open?: (page: Page) => Promise<void>;
  /** 주소로 가기 전 — 응답 바꿔치기(`page.route`)로 「규칙 없음」 같은 상태를 DB 를 건드리지 않고 만든다 */
  before?: (page: Page) => Promise<void>;
  /** 잰 뒤 되돌리기 */
  after?: (page: Page) => Promise<void>;
}

/** 계좌 모아보기의 보기(서버 저장) — 목록 보기를 잰 뒤 카드로 되돌린다(사본 DB) */
async function setAccountsView(page: Page, view: 'card' | 'list') {
  await page.evaluate((v) => fetch('/api/paper/accounts-view', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ view: v }) }), view);
}

/** 종목 지도 시장 — 열 때마다 한국 시간으로 고르므로(localStorage 에 기억하지 않는다) 연 뒤에 직접 누른다 */
async function pickMarket(page: Page, market: 'us' | 'kr') {
  await page.getByRole('radiogroup', { name: '시장' }).getByRole('radio', { name: market === 'us' ? '미국' : '국내' }).click();
  await page.waitForTimeout(1500);
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
  /** 접힌 「고급 설정」 을 모두 펼친다(펼치면 안에 또 있을 수 있어 몇 번 돈다) — 접힌 폼 줄도 재기 위해 */
  const expandAdvanced = async (page: Page) => {
    for (let i = 0; i < 4; i++) {
      const closed = page.getByRole('button', { name: '고급 설정', expanded: false });
      const n = await closed.count();
      if (!n) break;
      for (let k = 0; k < n; k++) await closed.first().click().catch(() => {});
      await page.waitForTimeout(400);
    }
  };
  /** 계좌 상세로 — 앞 대상이 연 창은 닫고, 이미 상세(같은 주소라 화면이 남는다)면 그대로 */
  const openAccountDetail = async (page: Page) => {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    if (!(await page.getByRole('button', { name: /계좌 모아보기/ }).count())) {
      await page.getByText('현재 계좌').first().click();
    }
    await page.waitForTimeout(1500);
  };
  const openAccountSettings = async (page: Page) => {
    await page.getByText('현재 계좌').first().click();
    await page.waitForTimeout(1200);
    await click('자동매매 설정')(page);
  };
  /** v2.69.0 — 앱 툴팁을 연 채로 잰다(마우스를 대상 가운데에 · 0.3초 뒤 열림 + 여유) */
  const hoverTip = async (page: Page, target: Locator) => {
    await page.mouse.move(2, 2);
    await page.waitForTimeout(300);
    const b = await target.first().boundingBox().catch(() => null);
    if (b) await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
    await page.waitForTimeout(500);
  };
  list.push(
    // v2.69.0 — [ⓘ] 설명이 열린 장면(증시 일정 「데이터 출처」 — 앱 툴팁과 같은 상자)
    { name: 'tooltip-정보-증시일정', hash: '#/calendar', open: async (page) => { await page.waitForTimeout(800); await hoverTip(page, page.getByRole('button', { name: '데이터 출처', exact: true })); } },
    // v2.69.1 — 앱 전체 툴팁(129차 묶음 A · B · C 대표 자리)이 열린 장면
    { name: 'tooltip-A-메뉴접기', hash: '#/rules', open: async (page) => { await page.waitForTimeout(800); await hoverTip(page, page.getByRole('button', { name: '메뉴 접기', exact: true })); } },
    {
      // 실제 순위(토스 시세 조회만) — 가짜 순위의 없는 종목은 줄 미리보기가 봉을 못 받아 콘솔 오류
      name: 'tooltip-B-실시간순위-관심별',
      hash: '#/ranking',
      open: async (page: Page) => { await page.waitForTimeout(1500); await hoverTip(page, page.getByRole('button', { name: /관심 목록에 추가$/ })); },
    },
    {
      name: 'tooltip-C-거래정지-시각',
      hash: '#/ushalts',
      before: async (page: Page) => {
        await page.route('**/api/us-halts', (r) => r.fulfill({ json: usHaltsSample(Date.now(), true, 3) }).catch(() => {}));
        await page.route('**/api/rankings/live**', (r) => r.fulfill({ json: rankingSample(new URL(r.request().url()).searchParams.get('kind') as 'gainers', Date.now()) }).catch(() => {}));
      },
      open: async (page: Page) => { await page.waitForTimeout(1200); await hoverTip(page, page.getByRole('cell', { name: /\d{1,2}:\d{2}/ }).first().locator('span[data-tip]')); },
      after: async (page: Page) => {
        await page.unroute('**/api/us-halts');
        await page.unroute('**/api/rankings/live**');
      },
    },
    { name: 'dialog-자동매매설정-고급', hash: '#/portfolio/paper', open: async (page) => { await openAccountSettings(page); await expandAdvanced(page); } },
    { name: 'backtest-고급', hash: '#/backtest', open: expandAdvanced },
    // 계좌 상세 윗줄의 [입금] · [출금] 창(v2.52.0) — 금액을 넣은 모양으로 잰다. 출금은 출금할 수 있는 돈보다 많이 넣어 막힌 모양
    ...(['입금', '출금'] as const).map((label) => ({
      name: `dialog-${label}`,
      hash: '#/portfolio/paper',
      open: async (page: Page) => {
        await openAccountDetail(page);
        await click(label)(page);
        await page.getByRole('textbox', { name: `${label}할 금액` }).fill(label === '입금' ? '1000000' : '999999999999');
        await page.waitForTimeout(300);
      },
    })),
    // 계좌 상세 「거래내역」 탭 — 입출금 줄이 체결과 섞인다(사본 DB 에 입출금이 있으면)
    { name: 'account-거래내역', hash: '#/portfolio/paper', open: async (page) => { await openAccountDetail(page); await click('거래내역')(page); } },
    // 오른쪽 패널 계좌 탭 — 맨 아래 고정 「총 평가 · 총 손익」(v2.52.0)
    // 끝나면 관심 탭으로 되돌린다 — 계좌 탭이 남으면 다음 대상의 「계좌」 고르기 상자가 둘로 잡힌다
    { name: 'panel-계좌탭', hash: '#/chart', open: async (page) => { await page.getByTestId('watch-panel').getByRole('button', { name: '계좌', exact: true }).click(); await page.waitForTimeout(1500); }, after: async (page) => { await page.getByTestId('watch-panel').getByRole('button', { name: '관심', exact: true }).click().catch(() => undefined); } },
    // v2.69.3 — 오른쪽 패널 최근 탭(톱니 자리를 비워 탭 줄이 관심 탭과 같은 x) · 끝나면 관심 탭으로
    { name: 'panel-최근탭', hash: '#/chart', open: async (page) => { await page.getByTestId('watch-panel').getByRole('button', { name: '최근', exact: true }).click(); await page.waitForTimeout(800); }, after: async (page) => { await page.getByTestId('watch-panel').getByRole('button', { name: '관심', exact: true }).click().catch(() => undefined); } },
    { name: 'form-새계좌', hash: '#/portfolio/paper', open: click(/새 계좌/) },
    // 차트 아래 「AI 분석」 탭(간단 · 전체 모드), 검증 기록(AI 검증 계좌 하나 · 빈 화면 · AI 분석 성적표), 퀀트 메뉴 접힘
    ...(['간단', '전체'] as const).map((mode) => ({
      name: `chart-아래AI탭-${mode}`,
      hash: '#/home',
      open: async (page: Page) => {
        await page.locator('header input').first().fill('AAPL');
        await page.keyboard.press('Enter');
        await page.waitForTimeout(3000);
        await page.getByRole('tab', { name: 'AI 분석', exact: true }).first().click();
        await page.waitForTimeout(1500);
        if (mode === '전체') await click('분석 방식·프롬프트 수정 보기')(page);
      },
    })),
    {
      name: 'records-aicheck-계좌하나',
      hash: '#/records/aicheck',
      open: async (page) => {
        await page.waitForTimeout(1200);
        const sel = page.getByRole('combobox', { name: '계좌', exact: true }); // 오른쪽 계좌 탭의 「모의투자 계좌 선택」 과 갈리게
        // 기록이 있는 계좌(점검 DB 에 심은 「AI 검증 비교 A」)가 있으면 그것, 없으면 첫 계좌
        const named = sel.locator('option', { hasText: 'AI 검증 비교' });
        const v = await ((await named.count()) ? named.first() : sel.locator('option').nth(1)).getAttribute('value');
        if (v) await sel.selectOption(v);
        await page.waitForTimeout(1500);
      },
    },
    {
      name: 'records-빈화면',
      hash: '#/records/target',
      before: async (page) => {
        await page.route('**/api/target-analysis?**', (r) =>
          r.fulfill({ json: { records: [], stats: { scored: 0, aiHit: 0, baseHit: 0, aiRate: null, baseRate: null, weak: true, rawScored: 0 }, progress: { running: false, total: 0, done: 0, results: [] } } }));
        await page.route('**/api/ai-check/records**', (r) =>
          r.fulfill({ json: { rows: [], total: 0, stats: { blocked: { n: { 5: 0, 10: 0, 20: 0 }, avg: { 5: null, 10: null, 20: null } }, passed: { n: { 5: 0, 10: 0, 20: 0 }, avg: { 5: null, 10: null, 20: null } }, unavailable: 0 } } }));
      },
      after: async (page) => {
        await page.unroute('**/api/target-analysis?**');
        await page.unroute('**/api/ai-check/records**');
      },
      open: async (page) => {
        await page.waitForTimeout(1500);
        await page.getByRole('tab', { name: 'AI 검증' }).click();
        await page.waitForTimeout(1500);
      },
    },
    // v2.68.3 — 탭 줄 아래 가림 띠(공용 ScrollTopShade): 매수 판단 · 급등 탐지 · 검증 기록을 스크롤해 첫 칸 아래 끝이 위 끝 3px 아래에 오게(내용이 짧으면 끝에 빈 칸을 붙여 스크롤이 생기게)
    ...(['#/swing/list', '#/surge/list', '#/records/analysis'] as const).map((hash) => ({
      name: `${hash.split('/')[1]}-스크롤탭줄`,
      hash,
      open: async (page: Page) => {
        await page.waitForTimeout(2500);
        await page.evaluate(() => {
          const sc = document.querySelector('[data-page-scroll]') as HTMLElement | null;
          if (!sc) return;
          const pad = document.createElement('div');
          pad.style.height = '1500px';
          sc.appendChild(pad);
          // 첫 칸 — 탭 내용을 감싼 상자(급등 탐지 · 검증 기록)면 그 안의 첫 칸
          const wrap = sc.children[1] as HTMLElement | undefined;
          const first = wrap && wrap.getBoundingClientRect().height > 300 ? ((wrap.firstElementChild as HTMLElement | null) ?? wrap) : wrap;
          if (first) sc.scrollTop = first.getBoundingClientRect().bottom - sc.getBoundingClientRect().top - 3;
        }).catch(() => {});
        await page.waitForTimeout(200);
      },
    })),
    { name: 'records-analysis-성적표', hash: '#/records/analysis', open: async (page) => { await page.waitForTimeout(1200); await page.getByRole('radio', { name: '성적표' }).click().catch(() => page.getByRole('button', { name: '성적표' }).click()); await page.waitForTimeout(1500); } },
    { name: 'nav-퀀트접힘', hash: '#/rules', open: click(/^퀀트/) },
    // 실험실은 소메뉴 「급등 탐지」 를 보인다(펼친 메뉴 · 접힌 메뉴 플라이아웃)
    { name: 'nav-실험실-펼침', hash: '#/surge/list' },
    {
      name: 'nav-접힌메뉴-실험실',
      hash: '#/rules',
      open: async (page: Page) => {
        await page.getByRole('button', { name: '메뉴 접기' }).click();
        await page.waitForTimeout(400);
        await page.getByRole('navigation').getByRole('button', { name: '실험실', exact: true }).hover();
        await page.waitForTimeout(400);
      },
    },
    // 계좌 모아보기 목록 보기(서버 저장 값을 목록으로 바꿔 두고 재고, 끝나면 카드로 되돌린다) · 목록에서 끄는 중(첫 줄을 둘째 줄 아래 반으로 — 놓지 않는다)
    ...(['account-목록', 'account-목록-끄는중'] as const).map((name) => ({
      name,
      hash: '#/portfolio/paper',
      before: (page: Page) => setAccountsView(page, 'list'),
      after: (page: Page) => setAccountsView(page, 'card'),
      open: async (page: Page) => {
        await page.waitForSelector('tr[draggable=true]', { timeout: 8000 });
        if (name !== 'account-목록-끄는중') return;
        await page.evaluate(() => {
          const rows = [...document.querySelectorAll('tr[draggable=true]')] as HTMLElement[];
          if (rows.length < 2) return;
          const dt = new DataTransfer();
          rows[0].dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
          (window as unknown as { __dt: DataTransfer }).__dt = dt;
        });
        await page.waitForTimeout(200);
        await page.evaluate(() => {
          const rows = [...document.querySelectorAll('tr[draggable=true]')] as HTMLElement[];
          const dt = (window as unknown as { __dt: DataTransfer }).__dt;
          if (rows.length < 2 || !dt) return;
          const r = rows[1].getBoundingClientRect();
          rows[1].dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.left + 40, clientY: r.bottom - 4 }));
        });
        await page.waitForTimeout(400);
      },
    })),
    // 계좌 모아보기 카드 끄는 중(첫 카드를 둘째 카드 앞으로 끄는 순간 — 놓지 않는다)
    {
      name: 'account-순서-끄는중',
      hash: '#/portfolio/paper',
      // 앞 대상이 목록 보기를 쟀어도 카드로 다시 그린다(홈을 거쳐 보기를 새로 받는다)
      before: (page: Page) => setAccountsView(page, 'card'),
      open: async (page: Page) => {
        await page.waitForSelector('article[draggable=true]', { timeout: 8000 });
        await page.evaluate(() => {
          const cards = [...document.querySelectorAll('article[draggable=true]')] as HTMLElement[];
          if (cards.length < 2) return;
          const dt = new DataTransfer();
          cards[0].dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
          (window as unknown as { __dt: DataTransfer }).__dt = dt;
        });
        // 끌기 시작 상태가 그려진 뒤에 놓을 자리를 지난다(같은 틱이면 화면이 아직 끄는 중을 모른다)
        await page.waitForTimeout(200);
        await page.evaluate(() => {
          const cards = [...document.querySelectorAll('article[draggable=true]')] as HTMLElement[];
          const dt = (window as unknown as { __dt: DataTransfer }).__dt;
          if (cards.length < 2 || !dt) return;
          const r = cards[1].getBoundingClientRect();
          cards[1].dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: r.right - 10, clientY: r.top + 10 }));
        });
        await page.waitForTimeout(400);
      },
    },
    // 매수 판단 [실행] 중(서버 응답을 늦춘다) · 완료 알림
    {
      name: 'swing-실행중',
      hash: '#/swing/list',
      before: async (page: Page) => {
        await page.route('**/api/buy-judge/recalc', async (r) => {
          await new Promise((res) => setTimeout(res, 8000));
          await r.continue().catch(() => undefined);
        });
      },
      after: (page: Page) => page.unroute('**/api/buy-judge/recalc'),
      open: async (page: Page) => {
        await page.waitForSelector('table', { timeout: 30000 });
        await page.getByRole('button', { name: '실행', exact: true }).click();
        await page.waitForTimeout(700);
      },
    },
    {
      name: 'swing-실행완료',
      hash: '#/swing/list',
      open: async (page: Page) => {
        await page.waitForSelector('table', { timeout: 30000 });
        // 앞 대상(실행 중)의 늦춘 요청이 끝나고 남긴 알림을 지운다 — 같은 창을 이어 쓰므로 알림이 두 개로 찍혔다
        await page.waitForFunction(() => !document.querySelector('[aria-busy=true]'), undefined, { timeout: 20000 });
        await page.waitForTimeout(300);
        for (const b of await page.getByRole('button', { name: '닫기' }).all()) await b.click().catch(() => undefined);
        await page.getByRole('button', { name: '실행', exact: true }).click();
        await page.getByText('실행이 완료됐습니다').first().waitFor({ timeout: 30000 });
        await page.waitForTimeout(300);
      },
    },
    // 백테스트 히스토리 날짜별 목록(펼침). 기록은 바꿔치기(규칙은 지금 목록의 첫 규칙)
    {
      name: 'backtest-히스토리-날짜펼침',
      hash: '#/backtest',
      before: async (page: Page) => {
        const rules = (await page.evaluate(async () => (await (await fetch('/api/rules')).json()) as { rules: { id: number; name: string; buy: unknown; sell: unknown; reentryWaitDays: number }[] })).rules;
        const r0 = rules[0];
        // 규칙 목록 한 줄 = 규칙 본문 + id·이름 — 기록에는 본문만(buy · sell · reentryWaitDays)
        const body = r0 ? { buy: r0.buy, sell: r0.sell, reentryWaitDays: r0.reentryWaitDays } : undefined;
        const item = (id: number, createdAt: string, symbols: string[], years: number, n: number) => ({
          id, createdAt, server: 'mac',
          summary: {
            kind: 'custom', createdAt, symbols: symbols.length, requested: symbols.length, years,
            input: { symbols, years, conditions: Array.from({ length: n }, (_, k) => ({ label: 'ABC'[k], ruleId: r0?.id ?? 1, ruleName: r0?.name ?? '기본 규칙', rule: body })) },
            inputKey: `k${id}`, rule: 3.21 * (id % 3) - 2, hold: 12.5,
          },
        });
        const reports = [
          item(9003, '2026-10-16T02:10:00Z', ['AAPL', 'NVDA', 'MSFT', 'AMZN', 'GOOGL', 'META', 'TSLA', 'LLY', 'JPM', 'XOM'], 3, 2),
          item(9002, '2026-10-16T01:05:00Z', ['005930', '000660'], 1, 1),
          item(9001, '2026-10-14T06:30:00Z', ['AAPL', 'NVDA'], 2, 1),
        ];
        // (목록 바꿔치기보다 먼저) 화면은 맨 위 기록의 상세를 연다 — 사본 DB 의 실제 기록 하나를 빌려 id 만 바꿔 준다(없으면 404 — 그때는 콘솔 오류 1건이 의도)
        const real = await page.evaluate(async () => {
          const list = (await (await fetch('/api/backtest/reports')).json()) as { reports: { id: number }[] };
          const id = list.reports[0]?.id;
          if (id == null) return null;
          const res = await fetch(`/api/backtest/reports/${id}`);
          return res.ok ? await res.json() : null;
        });
        await page.route('**/api/backtest/reports', (r) => r.fulfill({ json: { reports } }));
        await page.route('**/api/backtest/reports/*', (r) => {
          const id = Number(r.request().url().split('/').pop());
          return real ? r.fulfill({ json: { ...real, id } }) : r.fulfill({ status: 404, json: { error: '시험용 기록입니다' } });
        });
      },
      after: async (page: Page) => {
        await page.unroute('**/api/backtest/reports');
        await page.unroute('**/api/backtest/reports/*');
      },
      open: async (page: Page) => {
        await page.waitForTimeout(800);
        await page.getByRole('button', { name: /2026-10-16/ }).first().click();
        await page.waitForTimeout(500);
      },
    },
    // 종목 지도(시장 상위 미국 100 · 내 관심 국내), 「N초 전 갱신」(장이 닫힌 시각에도 보이게 응답의 marketOpen 만 바꿔치기 — DB 는 그대로),
    // 처음 켜기 안내 종목 단계, 지정 종목 설정 창의 [종목 추가]
    ...(
      [
        ['heatmap-시장상위-미국100', { view: 'market', market: 'us', top: 100 }],
        ['heatmap-관심-국내', { view: 'watch', market: 'kr', top: 50 }],
      ] as const
    ).map(([name, { market, ...v }]) => ({
      name,
      hash: '#/heatmap',
      before: async (page: Page) => {
        await page.evaluate((v) => localStorage.setItem('alphascope.heatmapView', JSON.stringify({ ...v, period: '1d', off: { market: [], watch: [] }, watchSize: 'cap' })), v);
      },
      open: (page: Page) => pickMarket(page, market),
    })),
    // 거래정지 — 긴 종목명 · 긴 사유 · 순위 칸까지 모든 칸 한 줄인지(가짜 응답 — DB · Nasdaq · 토스 그대로). 「상위」(기본) · 「전체」(순위 칸 없음) · 「급상승」 · 정규장 밖
    // 「며칠째9」 = 장기 정지 9줄(5줄 칸 + 칸 안 스크롤 · v2.58.1)
    ...([['예시', 'top', true, 3], ['전체', 'all', true, 3], ['급상승', 'gainers', true, 3], ['정규장밖', 'top', false, 3], ['며칠째9', 'top', true, 9]] as const).map(([label, view, regular, ongoing]) => ({
      name: `ushalts-${label}`,
      hash: '#/ushalts',
      before: async (page: Page) => {
        await page.evaluate((v) => localStorage.setItem('alphascope.usHaltsView.v2', JSON.stringify({ view: v, top: 10 })), view);
        await page.route('**/api/us-halts', (r) => r.fulfill({ json: usHaltsSample(Date.now(), regular, ongoing) }).catch(() => {}));
        await page.route('**/api/rankings/live**', (r) => r.fulfill({ json: rankingSample(new URL(r.request().url()).searchParams.get('kind') as 'gainers', Date.now()) }).catch(() => {}));
      },
      after: async (page: Page) => {
        await page.unroute('**/api/us-halts');
        await page.unroute('**/api/rankings/live**');
        await page.evaluate(() => localStorage.removeItem('alphascope.usHaltsView.v2'));
      },
    })),
    // 오늘 시황 — 채워진 브리핑(오전판 · 오후판) · AI 없음(데이터만) · 진행 중(가짜 응답 — DB · Gemini 그대로)
    ...(
      [
        ['오전판', 'morning', true, {}],
        ['오후판', 'afternoon', true, {}],
        ['AI없음', 'morning', false, { gemini: false }],
        ['진행중', 'afternoon', true, { running: true }],
      ] as const
    ).map(([label, edition, withAi, st]) => ({
      name: `market-brief-${label}`,
      hash: '#/market-brief',
      before: async (page: Page) => {
        const brief = briefSample(edition, withAi);
        await page.route('**/api/market-brief/status', (r) => r.fulfill({ json: statusSample(st) }).catch(() => {}));
        await page.route('**/api/market-brief/days', (r) => r.fulfill({ json: daysSample }).catch(() => {}));
        await page.route(/\/api\/market-brief\?/, (r) => r.fulfill({ json: daySample(brief) }).catch(() => {}));
      },
      open: async (page: Page) => {
        // 수집 상태를 펼쳐 함께 잰다
        await page.getByRole('button', { name: '수집 상태 보기' }).click().catch(() => {});
      },
      after: async (page: Page) => {
        await page.unroute('**/api/market-brief/status');
        await page.unroute('**/api/market-brief/days');
        await page.unroute(/\/api\/market-brief\?/);
      },
    })),
    // 자산 관리(v2.61.0 · v2.62.0 · v2.62.1 · v2.62.2 탭) — 잠김 · 풀림(총 자산 탭: 하루 기록 0 · 1 · 여러 개 · 「미지정」 + 가격 못 받음 · 연금 포함 /
    // 「자산 현황」 탭 계좌 카드(미지정 「-」) · 「설정」 창 · 분류 색 바꾼 뒤) · 읽기 실패.
    // 가짜 응답만(구글 · DB 그대로 — 쓰기 주소는 막는다)
    ...(
      [
        ['잠김', false, 'ok', 0, {}, false, false, null],
        // v2.65.4 — 쓰지 않아 저절로 잠김(잠금 화면 위 「30분 동안 쓰지 않아 잠갔어요」)
        ['잠김-쓰지않음', false, 'ok', 0, {}, false, false, null],
        ['기록0', true, 'ok', 0, { vsLast: false }, false, false, null],
        // v2.65.1 — 시트를 바꾼 뒤 빈 차트(「원본 시트 연결 뒤 ○부터 쌓입니다」)
        ['기록0-시트바뀜', true, 'ok', 0, { vsLast: false }, false, false, null],
        ['기록1', true, 'ok', 1, {}, false, false, null],
        ['기록여러개-미지정', true, 'ok', 30, { none: true }, false, false, null],
        ['연금포함-자산현황', true, 'ok', 30, { pension: true }, true, false, null],
        ['설정창', true, 'ok', 30, { pension: true }, false, true, null],
        ['설정창-종목추가', true, 'ok', 30, { pension: true }, false, true, '종목 추가'],
        ['설정창-계좌추가', true, 'ok', 30, { pension: true }, false, true, '계좌 추가'],
        ['색바꿈-자산현황', true, 'ok', 30, { pension: true, none: true, colors: { gold: 'green', cash: 'red', stock: 'teal', retirement: 'brown' } }, true, false, null],
        ['읽기실패', true, 'fail', 0, {}, false, false, null],
      ] as const
    ).map(([label, unlocked, sheet, records, sum, openSheet, openSettings, addButton]) => ({
      name: `asset-${label}`,
      hash: '#/asset',
      before: async (page: Page) => {
        await page.evaluate((on) => localStorage.setItem('alphascope.asset.includePension', on ? '1' : '0'), 'pension' in sum && sum.pension === true);
        await page.route('**/api/asset/status', (r) => r.fulfill({ json: assetStatusSample(unlocked, true, label === '잠김-쓰지않음') }).catch(() => {}));
        // v2.65.4 — 화면을 누르면 touch(1분에 한 번) — 가짜로 답한다(시험 서버로 가면 잠김 응답에 화면이 다시 그려진다)
        await page.route('**/api/asset/touch', (r) => r.fulfill({ json: { ok: true, lockMinutes: 30, remainingMs: 30 * 60_000 } }).catch(() => {}));
        await page.route('**/api/asset/sheet', (r) =>
          (sheet === 'fail' ? r.fulfill({ status: 502, json: assetSheetFailureSample }) : r.fulfill({ json: assetSheetSample() })).catch(() => {}),
        );
        await page.route('**/api/asset/summary**', (r) =>
          (sheet === 'fail' ? r.fulfill({ status: 502, json: assetSummaryFailureSample }) : r.fulfill({ json: assetSummarySample(sum) })).catch(() => {}),
        );
        await page.route('**/api/asset/history**', (r) => r.fulfill({ json: assetHistorySample(records, label.includes('시트바뀜') ? '2026-11-07T23:10:00.000Z' : null) }).catch(() => {}));
        await page.route('**/api/asset/class', (r) => r.fulfill({ status: 503, json: { error: '시험 — 쓰지 않음', kind: 'disabled' } }).catch(() => {}));
        await page.route('**/api/asset/settings', (r) => r.fulfill({ status: 400, json: { error: '시험 — 저장하지 않음' } }).catch(() => {}));
      },
      open: async (page: Page) => {
        await page.waitForTimeout(800);
        if (openSheet) {
          await page.getByRole('tab', { name: '자산 현황' }).click().catch(() => {});
          await page.waitForTimeout(500);
          // 계좌 카드가 보이게(사진은 화면 크기만 찍는다)
          await page.locator('[data-account-cards]').scrollIntoViewIfNeeded().catch(() => {});
          await page.waitForTimeout(200);
        }
        if (openSettings) {
          await page.locator('[data-asset-settings]').click().catch(() => {});
          await page.waitForTimeout(400);
        }
        if (addButton) {
          // 설정 창 안의 [종목 추가] · [계좌 추가] 창(시트 종목 · 시트 계좌만)
          await page.getByRole('button', { name: addButton, exact: true }).click().catch(() => {});
          await page.waitForTimeout(400);
        }
      },
      after: async (page: Page) => {
        for (const p of ['**/api/asset/status', '**/api/asset/sheet', '**/api/asset/summary**', '**/api/asset/history**', '**/api/asset/class', '**/api/asset/settings']) await page.unroute(p);
        await page.keyboard.press('Escape').catch(() => {});
        await page.keyboard.press('Escape').catch(() => {});
        await page.evaluate(() => {
          localStorage.removeItem('alphascope.asset.includePension');
          localStorage.removeItem('alphascope.asset.closedAccounts');
          localStorage.removeItem('alphascope.asset.tab');
          localStorage.removeItem('alphascope.asset.settingsMenu');
        });
        // touch 는 ESC(키 입력)까지 가짜로 받은 뒤 푼다
        await page.unroute('**/api/asset/touch');
      },
    })),
    // 자산 관리 v2.63.0 · v2.64.0 — 「비율 조정」 탭(괜찮음 · 조정 필요 섞임 · 빠진 금액 줄 · 목표 합 ≠ 100 · 목표 빈칸) ·
    // 설정 창 「목표 비율」(합 맞음 · 틀림 · 쓰기 꺼짐) · 「비율 조정 범위」 · 「자산 현황」 종목별(전체 · 코어 · 위성). 가짜 응답만(쓰기 주소는 막는다)
    ...(
      [
        ['비율조정', { pension: true, none: true }, async () => {}],
        ['비율조정-합틀림', { target: { cash: 20, gold: 5, bond: 10, invest: 60, core: null, satellite: 30 }, band: 3 }, async () => {}],
        ['설정창-목표비율', { pension: true }, async (page: Page) => {
          await page.locator('[data-edit-target]').click().catch(() => {});
          await page.waitForTimeout(500);
        }],
        ['설정창-목표비율-합틀림', {}, async (page: Page) => {
          await page.locator('[data-edit-target]').click().catch(() => {});
          await page.waitForTimeout(400);
          await page.locator('[data-ratio="cash"]').fill('15').catch(() => {});
          await page.locator('[data-ratio="satellite"]').fill('35').catch(() => {});
          await page.waitForTimeout(200);
        }],
        ['설정창-쓰기꺼짐', { writeEnabled: false }, async (page: Page) => {
          await page.locator('[data-edit-target]').click().catch(() => {});
          await page.waitForTimeout(500);
        }],
        // v2.64.0 — 「이번 달 구매」 구역(완료 · 미완료 + 휴장일 확인 못 함 · 월급 없음 + 목표 합 틀림) · 구매일 팝업 · [구매 완료] 확인 창 · 자산 현황 요약 목표 비율 순서
        ['이번달구매', { pension: true }, async (page: Page) => {
          await page.locator('#as-asset-monthly-buy').scrollIntoViewIfNeeded().catch(() => {});
          await page.waitForTimeout(200);
        }],
        ['이번달구매-미완료', { purchaseDone: false, calendarUnchecked: true }, async (page: Page) => {
          await page.locator('[data-purchase-later]').click().catch(() => {});
          await page.waitForTimeout(200);
          await page.locator('#as-asset-monthly-buy').scrollIntoViewIfNeeded().catch(() => {});
          await page.waitForTimeout(200);
        }],
        ['이번달구매-월급없음-합틀림', { purchaseDone: false, salary: null, target: { cash: 25, gold: 5, bond: 10, invest: 65, core: 70, satellite: null } }, async (page: Page) => {
          await page.locator('[data-purchase-later]').click().catch(() => {});
          await page.waitForTimeout(200);
          await page.locator('#as-asset-monthly-buy').scrollIntoViewIfNeeded().catch(() => {});
          await page.waitForTimeout(200);
        }],
        // v2.64.1 — 시작 전 차례(팝업 · [구매 완료] 없음 · 「시작 전 차례 — 묻지 않음」)
        ['이번달구매-시작전차례', { skipped: true }, async (page: Page) => {
          await page.locator('#as-asset-monthly-buy').scrollIntoViewIfNeeded().catch(() => {});
          await page.waitForTimeout(200);
        }],
        // v2.65.4 — 미리 구매 완료(「미리 구매 완료할 수 있어요」 + [구매 완료] · 확인 창 · 「완료 ○(미리)」)
        ['이번달구매-미리완료가능', { early: 'can' }, async (page: Page) => {
          await page.locator('#as-asset-monthly-buy').scrollIntoViewIfNeeded().catch(() => {});
          await page.waitForTimeout(200);
        }],
        ['이번달구매-미리완료확인창', { early: 'can' }, async (page: Page) => {
          await page.locator('#as-asset-monthly-buy [data-purchase-done]').click().catch(() => {});
          await page.waitForTimeout(300);
        }],
        ['이번달구매-미리완료함', { early: 'done' }, async (page: Page) => {
          await page.locator('#as-asset-monthly-buy').scrollIntoViewIfNeeded().catch(() => {});
          await page.waitForTimeout(200);
        }],
        ['구매일팝업', { purchaseDone: false }, async () => {}],
        ['구매일팝업-확인창', { purchaseDone: false }, async (page: Page) => {
          await page.locator('[data-purchase-dialog]').waitFor({ timeout: 3000 }).catch(() => {});
          await page.getByRole('dialog').locator('[data-purchase-done]').click().catch(() => {});
          await page.waitForTimeout(300);
        }],
        // v2.65.0 — 설정 창 「시트 가격」(Google · 토스 + 토스 가격 없음 목록 · 스위치 꺼진 서버 · 바꾸기 / 되돌리기 확인 창)
        // v2.65.1 — 줄이 옮겨짐(되돌리기 때 쓰지 않은 줄 목록)
        ...([
          ['Google', 'google', null],
          ['줄이옮겨짐', 'google-moved', null],
          ['옛시트백업', 'google-archived', null],
          ['토스', 'toss', null],
          ['꺼짐', 'off', null],
          ['바꾸기확인창', 'google', '[data-price-convert]'],
          ['되돌리기확인창', 'toss', '[data-price-restore]'],
        ] as const).map(([label, price, button]) => [`설정창-시트가격-${label}`, { price }, async (page: Page) => {
          await page.locator('[data-asset-settings]').click().catch(() => {});
          await page.waitForTimeout(400);
          // v2.65.2 — 설정 창 왼쪽 메뉴 「시트 가격」
          await page.getByRole('dialog').getByRole('tab', { name: '시트 가격', exact: true }).click().catch(() => {});
          await page.waitForTimeout(200);
          await page.locator('[data-setting="price-sheet"]').scrollIntoViewIfNeeded().catch(() => {});
          await page.waitForTimeout(200);
          if (button) {
            await page.locator(button).click().catch(() => {});
            await page.waitForTimeout(300);
          }
        }] as const),
        // v2.65.2 — 설정 창 왼쪽 메뉴(목표 비율 · 코어 · 위성 · 연금 · 자산 분류 색 · 시트 가격 · v2.65.4 잠금)
        ...(['목표 비율', '코어 · 위성', '연금', '자산 분류 색', '시트 가격', '잠금'] as const).map((m) => [`설정창-메뉴-${m.replace(/ · /g, '').replace(/ /g, '')}`, { pension: true }, async (page: Page) => {
          await page.locator('[data-asset-settings]').click().catch(() => {});
          await page.waitForTimeout(400);
          await page.getByRole('dialog').getByRole('tab', { name: m, exact: true }).click().catch(() => {});
          await page.waitForTimeout(300);
        }] as const),
        // v2.65.3 — 계좌 카드(분류는 글자만 · 「미지정」 · 머리 줄 끝 화살표 ▸/▾ — ISA 계좌를 접음 · 위 안내 한 줄)
        ['자산현황-계좌카드', {}, async (page: Page) => {
          await page.getByRole('tab', { name: '자산 현황' }).click().catch(() => {});
          await page.waitForTimeout(500);
          await page.locator('tbody[data-account="ISA 계좌"] [data-account-head]').click().catch(() => {});
          await page.locator('[data-account-hint]').scrollIntoViewIfNeeded().catch(() => {});
          await page.waitForTimeout(200);
        }],
        // v2.68.2 — 스크롤해 도구 줄 끝이 3px 남을 때 탭 줄 바로 밑(가림 띠)
        ['자산현황-스크롤탭줄', {}, async (page: Page) => {
          await page.getByRole('tab', { name: '자산 현황' }).click().catch(() => {});
          await page.waitForTimeout(500);
          await page.evaluate(() => {
            const sc = document.querySelector('[data-asset-scroll]') as HTMLElement | null;
            const tool = document.querySelector('[data-open-class-dialog]') as HTMLElement | null;
            if (sc && tool) sc.scrollTop = tool.getBoundingClientRect().bottom - sc.getBoundingClientRect().top - 3;
          }).catch(() => {});
          await page.waitForTimeout(200);
        }],
        ['자산현황-요약목표비율', {}, async (page: Page) => {
          await page.getByRole('tab', { name: '자산 현황' }).click().catch(() => {});
          await page.waitForTimeout(500);
        }],
        ...(['전체', '코어', '위성'] as const).map((f) => [`자산현황-종목별-${f}`, { none: true }, async (page: Page) => {
          await page.getByRole('tab', { name: '자산 현황' }).click().catch(() => {});
          await page.waitForTimeout(500);
          await page.getByRole('radio', { name: '종목별' }).click().catch(() => {});
          await page.waitForTimeout(200);
          if (f !== '전체') await page.getByRole('radio', { name: f, exact: true }).click().catch(() => {});
          await page.locator('[data-symbol-view]').scrollIntoViewIfNeeded().catch(() => {});
          await page.waitForTimeout(200);
        }] as const),
        // v2.65.3 — 「자산 분류 정하기」 창(처음 · 미지정만 보기 · 바꾼 것 있음 · 일부 실패 · 닫기 확인 · 쓰기 꺼짐) · 총 자산 「미지정」 줄 링크로 열기
        ...([
          ['처음', {}, null],
          ['미지정만', {}, 'only'],
          ['바꾼것있음', {}, 'pick'],
          ['일부실패', {}, 'partial'],
          ['닫기확인', {}, 'close'],
          ['쓰기꺼짐', { writeEnabled: false }, 'pick'],
          // v2.65.4 — 같은 코드가 「티커」 2줄 · 줄마다 값이 다름(「「티커」 2줄」 · 「줄마다 다름」)
          ['티커2줄', {}, 'dup'],
        ] as const).map(([label, sum, step]) => [`분류창-${label}`, sum, async (page: Page) => {
          if (step === 'dup') {
            await page.unroute('**/api/asset/sheet');
            await page.route('**/api/asset/sheet', (r) => r.fulfill({ json: assetSheetSample({ dupCode: true }) }).catch(() => {}));
          }
          await page.getByRole('tab', { name: '자산 현황' }).click().catch(() => {});
          await page.waitForTimeout(500);
          await page.locator('[data-open-class-dialog]').first().click().catch(() => {});
          await page.locator('[data-class-dialog]').waitFor({ timeout: 3000 }).catch(() => {});
          const pick = async (row: number, name: string) => page.locator(`[data-class-row="${row}"]`).getByRole('radio', { name, exact: true }).click().catch(() => {});
          if (step === 'only') await page.locator('[data-class-only]').check().catch(() => {});
          if (step === 'pick' || step === 'partial' || step === 'close') {
            await pick(18, '채권');
            await pick(24, '금');
            await pick(15, '주식');
            await pick(16, '미지정');
          }
          if (step === 'partial') {
            // 「금」 묶음만 실패(가짜 응답) — 나머지는 다시 읽은 시트 값(가짜)
            await page.unroute('**/api/asset/class');
            await page.route('**/api/asset/class', (r) => {
              const body = JSON.parse(r.request().postData() ?? '{}') as { assetClass?: string };
              return (body.assetClass === '금' ? r.fulfill({ status: 409, json: { error: '「티커」 D24 칸에 수식이 있어 하나도 쓰지 않았습니다(수식을 덮어쓰지 않습니다).', kind: 'formula-cell' } }) : r.fulfill({ json: assetSheetSample() })).catch(() => {});
            });
            await page.locator('[data-class-save]').click().catch(() => {});
          }
          if (step === 'close') await page.keyboard.press('Escape').catch(() => {});
          await page.waitForTimeout(400);
        }] as const),
        // v2.66.0 — 자산 현황 [매수] [매도] · 매수 창(국내 · 미국) · 매도 창 · 모두 매도 안내 · 기록 창
        ...([
          ['매매-계좌별표', null, null],
          ['매수창-국내', 'buy:6', ['10', '70000']],
          ['매수창-미국', 'buy:5', ['2.5', '110.1234']],
          ['매도창', 'sell:5', ['2.5', '120']],
          ['매도창-모두매도', 'sell:6', ['30', '72000']],
          ['매매-기록창', 'history', null],
        ] as const).map(([label, step, inputs]) => [label, {}, async (page: Page) => {
          await page.getByRole('tab', { name: '자산 현황' }).click().catch(() => {});
          await page.waitForTimeout(500);
          await page.locator('[data-account-cards]').scrollIntoViewIfNeeded().catch(() => {});
          if (step === 'history') {
            await page.locator('[data-trade-history-open]').click().catch(() => {});
            await page.locator('[data-trade-row]').first().waitFor({ timeout: 3000 }).catch(() => {});
          } else if (step) {
            const [side, row] = step.split(':');
            await page.locator(`[data-trade-${side}="${row}"]`).click().catch(() => {});
            await page.locator('[data-trade-dialog]').waitFor({ timeout: 3000 }).catch(() => {});
            if (inputs) {
              await page.locator('[data-trade-qty]').fill(inputs[0]).catch(() => {});
              await page.locator('[data-trade-price]').fill(inputs[1]).catch(() => {});
            }
          }
          await page.waitForTimeout(300);
        }] as const),
        // v2.68.0 · v2.68.1 · v2.68.2 — 평단 계산기(「더 사면 평단은?」 1차 · 2차 · 3차 · 5차 · 5차 맨 아래 · 미국 · 「목표 평단까지」 됨 · 안 됨 · 지금 가격 없음)
        ...([
          ['계산기-국내', 6, [['60000', '10'], ['55000', '10']], null],
          ['계산기-1차', 6, [], null],
          ['계산기-목표', 6, [], '68500'],
          ['계산기-미국', 5, [['90', '2.5']], '100'],
          ['계산기-여러줄', 7, [['1200', '1'], ['1100.5', '2'], ['1000', '3']], null],
          ['계산기-5차', 6, [['60000', '1'], ['58000', '2'], ['56000', '3'], ['54000', '4'], ['52000', '5']], null],
          ['계산기-5차-아래', 6, [['60000', '1'], ['58000', '2'], ['56000', '3'], ['54000', '4'], ['52000', '5']], 'bottom'],
          ['계산기-거꾸로안됨', 6, [], '64000'],
          ['계산기-가격없음', 16, [], '10'],
        ] as const).map(([label, row, lines, target]) => [label, {}, async (page: Page) => {
          await page.getByRole('tab', { name: '자산 현황' }).click().catch(() => {});
          await page.waitForTimeout(500);
          await page.locator(`[data-avgcalc-open="${row}"]`).click().catch(() => {});
          await page.locator('[data-avgcalc]').waitFor({ timeout: 3000 }).catch(() => {});
          for (let i = 0; i < lines.length; i++) {
            if (i > 0) await page.locator('[data-avgcalc-add]').click().catch(() => {});
            await page.locator('[data-avgcalc-price]').nth(i).fill(lines[i][0]).catch(() => {});
            await page.locator('[data-avgcalc-qty]').nth(i).fill(lines[i][1]).catch(() => {});
          }
          if (target === 'bottom') {
            await page.evaluate(() => {
              const body = document.querySelector('[data-avgcalc]')?.parentElement;
              if (body) body.scrollTop = body.scrollHeight;
            }).catch(() => {});
          } else if (target) {
            await page.locator('[data-avgcalc]').getByRole('tab', { name: '목표 평단까지' }).click().catch(() => {});
            await page.locator('[data-avgcalc-target]').fill(target).catch(() => {});
          }
          await page.waitForTimeout(300);
        }] as const),
        // v2.67.0 — 새 종목 매수 창 · 확인 화면 · 모두 매도 미리 보기 · 409 안내
        ...([
          ['새종목-입력창', null],
          ['새종목-확인', assetNewPlanSample()],
          ['새종목-확인-적립식', assetNewPlanSample({ section: '적립식 계좌', ticker: { group: '적립식 투자', row: 33, status: 'insert' }, notice: '합친 표 「적립식 주식」 은 직접 고쳐 주세요.' })],
          ['새종목-이미가짐', assetNewPlanSample({ prefixEditable: false, ticker: { group: '개별 투자', row: 15, status: 'existing' }, existing: { row: 5, quantity: 10, avgPrice: 100.5 } })],
        ] as const).map(([label, plan]) => [label, {}, async (page: Page) => {
          await page.getByRole('tab', { name: '자산 현황' }).click().catch(() => {});
          await page.waitForTimeout(500);
          await page.route('**/api/stocks/search**', (r) => r.fulfill({ json: { results: [{ symbol: 'FAKN', name: '가짜 새미국주', englishName: '', market: 'NASDAQ' }], catalogSize: 1 } }).catch(() => {}));
          await page.route('**/api/stocks/info**', (r) => r.fulfill({ json: { stock: { symbol: 'FAKN', name: '가짜 새미국주', englishName: '', market: 'NASDAQ' } } }).catch(() => {}));
          if (plan) await page.route('**/api/asset/trade/new/plan', (r) => r.fulfill({ json: plan }).catch(() => {}));
          await page.locator('[data-trade-new]').click().catch(() => {});
          await page.locator('[data-newbuy-form]').waitFor({ timeout: 3000 }).catch(() => {});
          await page.locator('[data-newbuy-search] input').fill('FAKN').catch(() => {});
          await page.locator('[data-newbuy-search] li button').first().click({ timeout: 3000 }).catch(() => {});
          await page.waitForTimeout(200);
          await page.locator('[data-newbuy-qty]').fill('2.5').catch(() => {});
          await page.locator('[data-newbuy-price]').fill('110.25').catch(() => {});
          if (plan) {
            await page.locator('[data-newbuy-next]').click().catch(() => {});
            await page.locator('[data-newbuy-confirm]').waitFor({ timeout: 3000 }).catch(() => {});
          }
          await page.waitForTimeout(300);
        }] as const),
        // v2.67.2 — 새 종목 창: 글자를 친 뒤 뜨는 목록 · 저장 뒤 버튼 줄 아래 안내
        ['새종목-검색목록', {}, async (page: Page) => {
          await page.getByRole('tab', { name: '자산 현황' }).click().catch(() => {});
          await page.waitForTimeout(500);
          await page.route('**/api/stocks/search**', (r) => r.fulfill({ json: { results: [{ symbol: 'FAKN', name: '가짜 새미국주', englishName: '', market: 'NASDAQ' }, { symbol: '999201', name: '가짜 새국내주', englishName: '', market: 'KOSPI' }], catalogSize: 2 } }).catch(() => {}));
          await page.locator('[data-trade-new]').click().catch(() => {});
          await page.locator('[data-newbuy-form]').waitFor({ timeout: 3000 }).catch(() => {});
          await page.locator('[data-newbuy-search] input').fill('가짜').catch(() => {});
          await page.locator('[data-newbuy-search] li button').first().waitFor({ timeout: 3000 }).catch(() => {});
          await page.waitForTimeout(300);
        }],
        ['새종목-저장뒤안내', {}, async (page: Page) => {
          await page.getByRole('tab', { name: '자산 현황' }).click().catch(() => {});
          await page.waitForTimeout(500);
          await page.route('**/api/stocks/search**', (r) => r.fulfill({ json: { results: [{ symbol: 'FAKN', name: '가짜 새미국주', englishName: '', market: 'NASDAQ' }], catalogSize: 1 } }).catch(() => {}));
          await page.route('**/api/stocks/info**', (r) => r.fulfill({ json: { stock: { symbol: 'FAKN', name: '가짜 새미국주', englishName: '', market: 'NASDAQ' } } }).catch(() => {}));
          await page.route('**/api/asset/trade/new/plan', (r) => r.fulfill({ json: assetNewPlanSample({ section: '적립식 계좌', notice: '합친 표 「적립식 주식」 은 직접 고쳐 주세요.' }) }).catch(() => {}));
          await page.route('**/api/asset/trade/new', (r) => r.fulfill({ json: { id: 3, mode: 'new', notice: '합친 표 「적립식 주식」 은 직접 고쳐 주세요.' } }).catch(() => {}));
          await page.locator('[data-trade-new]').click().catch(() => {});
          await page.locator('[data-newbuy-form]').waitFor({ timeout: 3000 }).catch(() => {});
          await page.locator('[data-newbuy-search] input').fill('FAKN').catch(() => {});
          await page.locator('[data-newbuy-search] li button').first().click({ timeout: 3000 }).catch(() => {});
          await page.waitForTimeout(200);
          await page.locator('[data-newbuy-qty]').fill('1').catch(() => {});
          await page.locator('[data-newbuy-price]').fill('10').catch(() => {});
          await page.locator('[data-newbuy-next]').click().catch(() => {});
          await page.locator('[data-newbuy-save]').click({ timeout: 3000 }).catch(() => {});
          await page.locator('[data-newbuy-saved-notes]').waitFor({ timeout: 3000 }).catch(() => {});
          await page.waitForTimeout(300);
        }],
        ['매도창-409안내', {}, async (page: Page) => {
          await page.getByRole('tab', { name: '자산 현황' }).click().catch(() => {});
          await page.waitForTimeout(500);
          await page.route('**/api/asset/trade', (r) => r.fulfill({ status: 409, json: { error: '「요약」 B5 · 「요약」 B7 칸이 이 종목을 써요. 그 칸을 먼저 정리한 뒤 다시 눌러 주세요.', kind: 'row-referenced' } }).catch(() => {}));
          await page.locator('[data-trade-sell="6"]').click().catch(() => {});
          await page.locator('[data-trade-dialog]').waitFor({ timeout: 3000 }).catch(() => {});
          await page.locator('[data-trade-qty]').fill('30').catch(() => {});
          await page.locator('[data-trade-price]').fill('72000').catch(() => {});
          await page.locator('[data-trade-save]').click().catch(() => {});
          await page.getByRole('button', { name: '지우기' }).click({ timeout: 3000 }).catch(() => {});
          await page.locator('[data-trade-error]').waitFor({ timeout: 3000 }).catch(() => {});
          await page.waitForTimeout(300);
        }],
        ['분류창-총자산링크', { none: true }, async (page: Page) => {
          await page.getByRole('tab', { name: '총 자산' }).click().catch(() => {});
          await page.waitForTimeout(500);
          await page.locator('[data-group="none"] [data-open-class-dialog]').click().catch(() => {});
          await page.locator('[data-class-dialog]').waitFor({ timeout: 3000 }).catch(() => {});
          await page.waitForTimeout(300);
        }],
        // v2.69.0 — 앱 툴팁이 열린 장면(위 줄 아이콘 버튼 · 화면 오른쪽 끝 · 잘린 긴 이름 · 아래 끝에서 위로 뒤집힘 · 평단 계산기 아이콘)
        ['툴팁-아이콘버튼', {}, async (page: Page) => hoverTip(page, page.locator('[data-asset-settings]'))],
        ['툴팁-오른쪽끝', {}, async (page: Page) => hoverTip(page, page.locator('[data-asset-lock]'))],
        ['툴팁-긴이름', {}, async (page: Page) => {
          await page.getByRole('tab', { name: '자산 현황' }).click().catch(() => {});
          await page.waitForTimeout(500);
          // 이름 칸 하나를 좁혀 잘린 모양을 만든다(잘렸을 때만 뜨는 툴팁)
          await page.evaluate(() => {
            const s = document.querySelector('[data-account-cards] tbody tr [data-tip-clip]') as HTMLElement | null;
            if (s) {
              s.style.maxWidth = '48px';
              s.setAttribute('data-measure-cut', '');
            }
          }).catch(() => {});
          await hoverTip(page, page.locator('[data-measure-cut]'));
        }],
        ['툴팁-아래끝위로', {}, async (page: Page) => {
          await page.getByRole('tab', { name: '자산 현황' }).click().catch(() => {});
          await page.waitForTimeout(500);
          // 계산기 아이콘 하나가 화면 아래 끝에 오도록 스크롤
          await page.evaluate(() => {
            const sc = document.querySelector('[data-asset-scroll]') as HTMLElement | null;
            const btns = [...document.querySelectorAll('[data-avgcalc-open]')] as HTMLElement[];
            const b = btns[btns.length - 1];
            if (sc && b) sc.scrollTop += b.getBoundingClientRect().bottom - (innerHeight - 6);
          }).catch(() => {});
          await page.waitForTimeout(200);
          const btns = page.locator('[data-avgcalc-open]');
          const n = await btns.count();
          if (n) {
            const b = await btns.nth(n - 1).boundingBox().catch(() => null);
            if (b) {
              await page.mouse.move(2, 2);
              await page.waitForTimeout(300);
              await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
              await page.waitForTimeout(500);
            }
          }
        }],
      ] as const
    ).map(([label, sum, act]) => ({
      name: `asset-${label}`,
      hash: '#/asset',
      before: async (page: Page) => {
        await page.evaluate((on) => {
          localStorage.setItem('alphascope.asset.includePension', on ? '1' : '0');
          localStorage.setItem('alphascope.asset.tab', 'rebalance');
        }, 'pension' in sum && sum.pension === true);
        await page.route('**/api/asset/status', (r) => r.fulfill({ json: assetStatusSample(true) }).catch(() => {}));
        await page.route('**/api/asset/touch', (r) => r.fulfill({ json: { ok: true, lockMinutes: 30, remainingMs: 30 * 60_000 } }).catch(() => {}));
        await page.route('**/api/asset/sheet', (r) => r.fulfill({ json: assetSheetSample() }).catch(() => {}));
        await page.route('**/api/asset/summary**', (r) => r.fulfill({ json: assetSummarySample(sum as Parameters<typeof assetSummarySample>[0]) }).catch(() => {}));
        await page.route('**/api/asset/history**', (r) => r.fulfill({ json: assetHistorySample(30) }).catch(() => {}));
        await page.route('**/api/asset/class', (r) => r.fulfill({ status: 503, json: { error: '시험 — 쓰지 않음', kind: 'disabled' } }).catch(() => {}));
        await page.route('**/api/asset/settings', (r) => r.fulfill({ status: 400, json: { error: '시험 — 저장하지 않음' } }).catch(() => {}));
        await page.route('**/api/asset/target-ratio', (r) => r.fulfill({ status: 503, json: { error: '시험 — 쓰지 않음', kind: 'disabled' } }).catch(() => {}));
        await page.route('**/api/asset/purchase-done', (r) => r.fulfill({ status: 503, json: { error: '시험 — 쓰지 않음', kind: 'disabled' } }).catch(() => {}));
        await page.route('**/api/asset/price-source/**', (r) => r.fulfill({ status: 503, json: { error: '시험 — 쓰지 않음', kind: 'disabled' } }).catch(() => {}));
        await page.route('**/api/asset/trade', (r) => r.fulfill({ status: 503, json: { error: '시험 — 쓰지 않음', kind: 'disabled' } }).catch(() => {}));
        await page.route('**/api/asset/trade/new', (r) => r.fulfill({ status: 503, json: { error: '시험 — 쓰지 않음', kind: 'disabled' } }).catch(() => {}));
        await page.route('**/api/asset/trades**', (r) => r.fulfill({ json: assetTradesSample(50, 120) }).catch(() => {}));
      },
      open: async (page: Page) => {
        await page.waitForTimeout(800);
        await act(page);
      },
      after: async (page: Page) => {
        for (const p of ['**/api/asset/status', '**/api/asset/sheet', '**/api/asset/summary**', '**/api/asset/history**', '**/api/asset/trade', '**/api/asset/trades**', '**/api/asset/class', '**/api/asset/settings', '**/api/asset/target-ratio', '**/api/asset/purchase-done', '**/api/asset/price-source/**']) await page.unroute(p);
        await page.keyboard.press('Escape').catch(() => {});
        await page.keyboard.press('Escape').catch(() => {});
        // v2.65.3 — 「자산 분류 정하기」 창은 바꾼 것이 있으면 ESC 가 확인 창을 연다 → 확인 창의 [닫기] 로 끝낸다
        for (let i = 0; i < 4 && (await page.locator('[data-class-dialog]').count()) > 0; i++) {
          const confirm = page.getByRole('dialog').filter({ hasText: '저장하지 않고 닫을까요' });
          if ((await confirm.count()) > 0) await confirm.getByRole('button', { name: '닫기', exact: true }).last().click().catch(() => {});
          else await page.keyboard.press('Escape').catch(() => {});
          await page.waitForTimeout(150);
        }
        await page.evaluate(() => {
          localStorage.removeItem('alphascope.asset.includePension');
          localStorage.removeItem('alphascope.asset.tab');
          localStorage.removeItem('alphascope.asset.statusView');
          localStorage.removeItem('alphascope.asset.settingsMenu');
          localStorage.removeItem('alphascope.asset.closedAccounts');
          localStorage.removeItem('alphascope.asset.classOnlyUnassigned');
        });
        await page.unroute('**/api/asset/touch');
      },
    })),
    // 오늘 시황 — 지난 날 브리핑(「오늘 예상 방향」 채점됨 · 맞음/틀림 · 실제 등락률, v2.60.0)
    {
      name: 'market-brief-지난날채점',
      hash: '#/market-brief',
      before: async (page: Page) => {
        const past = briefSample('morning', true, 11);
        await page.route('**/api/market-brief/status', (r) => r.fulfill({ json: statusSample() }).catch(() => {}));
        await page.route('**/api/market-brief/days', (r) => r.fulfill({ json: daysSample }).catch(() => {}));
        await page.route(/\/api\/market-brief\?/, (r) => r.fulfill({ json: daySample(past, outlookSample('morning', 'past')) }).catch(() => {}));
      },
      after: async (page: Page) => {
        await page.unroute('**/api/market-brief/status');
        await page.unroute('**/api/market-brief/days');
        await page.unroute(/\/api\/market-brief\?/);
      },
    },
    // 오늘 시황 — 문장 ↔ 숫자 어긋남 「숫자와 다름」 · 대표 종목 링크 · 검사 줄(v2.59.6)
    {
      name: 'market-brief-숫자와다름',
      hash: '#/market-brief',
      before: async (page: Page) => {
        await page.route('**/api/market-brief/status', (r) => r.fulfill({ json: statusSample() }).catch(() => {}));
        await page.route('**/api/market-brief/days', (r) => r.fulfill({ json: daysSample }).catch(() => {}));
        await page.route(/\/api\/market-brief\?/, (r) => r.fulfill({ json: daySample(mismatchSample()) }).catch(() => {}));
      },
      open: async (page: Page) => {
        await page.getByRole('button', { name: '수집 상태 보기' }).click().catch(() => {});
      },
      after: async (page: Page) => {
        await page.unroute('**/api/market-brief/status');
        await page.unroute('**/api/market-brief/days');
        await page.unroute(/\/api\/market-brief\?/);
      },
    },
    // 기준가를 확인하지 못한 종목은 등락률이 null → 「—」(지도 칸 · 관심 패널). 응답의 절반을 null 로 바꿔치기 — DB 는 그대로
    {
      name: 'heatmap-등락률없음',
      hash: '#/heatmap',
      before: async (page) => {
        await page.evaluate(() => localStorage.setItem('alphascope.heatmapView', JSON.stringify({ view: 'watch', top: 50, period: '1d', off: { market: [], watch: [] }, watchSize: 'cap' })));
        // 다음 대상으로 넘어가며 unroute 하는 사이 도착한 응답은 이미 처리된 것으로 나온다 — 그 경우는 넘어간다(점검이 통째로 멈추지 않게)
        await page.route('**/api/heatmap**', async (r) => {
          try {
            const res = await r.fetch();
            const body = (await res.json()) as { cells: { changeRate: number | null }[] };
            body.cells.forEach((c, i) => i % 2 === 0 && (c.changeRate = null));
            await r.fulfill({ response: res, json: body });
          } catch {
            /* 이미 처리됨 · 페이지 닫힘 */
          }
        });
        await page.route('**/api/quotes**', async (r) => {
          try {
            const res = await r.fetch();
            const body = (await res.json()) as { quotes: { changeRate: number | null }[] };
            body.quotes?.forEach((q, i) => i % 2 === 0 && (q.changeRate = null));
            await r.fulfill({ response: res, json: body });
          } catch {
            /* 이미 처리됨 · 페이지 닫힘 */
          }
        });
      },
      after: async (page) => {
        await page.unroute('**/api/heatmap**');
        await page.unroute('**/api/quotes**');
      },
      open: async (page) => { await pickMarket(page, 'kr'); await page.waitForTimeout(2500); },
    },
    {
      name: 'heatmap-장중-N초전갱신',
      hash: '#/heatmap',
      before: async (page) => {
        await page.evaluate(() => localStorage.setItem('alphascope.heatmapView', JSON.stringify({ view: 'market', top: 50, period: '1d', off: { market: [], watch: [] }, watchSize: 'cap' })));
        await page.route('**/api/heatmap**', async (r) => {
          const res = await r.fetch();
          const body = (await res.json()) as Record<string, unknown>;
          await r.fulfill({ response: res, json: { ...body, marketOpen: true } });
        });
      },
      after: (page) => page.unroute('**/api/heatmap**'),
      open: async (page) => { await pickMarket(page, 'us'); await page.waitForTimeout(3000); },
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
      hash: '#/records/analysis',
      // 종목이 있으면 접힌 한 줄로 연다(응답의 종목만 바꿔치기)
      before: async (page) => {
        await page.route('**/api/gemini/scheduled', async (r) => {
          if (r.request().method() !== 'GET') return r.continue();
          const res = await r.fetch();
          const body = (await res.json()) as Record<string, unknown>;
          await r.fulfill({ response: res, json: { ...body, symbols: ['AAPL', 'NVDA', 'MSFT', '005930', 'LLY', 'XOM'] } });
        });
      },
      after: (page) => page.unroute('**/api/gemini/scheduled'),
      open: async (page) => {
        await page.getByText('내가 지정한 종목').first().locator('xpath=..').getByRole('button', { name: '설정', exact: true }).first().click();
        await page.waitForTimeout(800);
      },
    },
    // 계좌 「지금 조건」 펼침(「다음 판단」 시장별 개장 시각 — 서버가 휴장일까지 보고 계산)
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
    // v2.67.2 — 공용 SymbolSearch 를 쓰는 다른 자리(「종목 추가」 버튼 그대로)
    {
      name: 'search-관심목록관리',
      hash: '#/chart',
      open: async (page) => {
        await page.getByRole('button', { name: '관심 목록 관리 (폴더·순서)' }).click();
        await page.getByRole('dialog').getByRole('button', { name: '종목 추가', exact: true }).click();
        await page.waitForTimeout(500);
      },
    },
    {
      name: 'search-비교',
      hash: '#/compare',
      open: async (page) => {
        await page.reload(); // 앞 장면(관심 목록 관리)의 창이 열려 있으면 버튼을 가린다
        await page.waitForTimeout(1200);
        const storeUrl = '/src/store/appStore.ts';
        await page.evaluate(async (url) => {
          const m = (await import(/* @vite-ignore */ url)) as { useAppStore: { getState: () => { clearCompareSymbols: () => void } } };
          m.useAppStore.getState().clearCompareSymbols();
        }, storeUrl);
        await page.waitForTimeout(300);
        await click('종목 검색')(page);
      },
    },
    {
      name: 'search-종목추가창',
      hash: '#/backtest',
      open: async (page) => {
        await click('종목 추가')(page);
        await page.getByRole('tab', { name: '새 종목 검색' }).click();
        await page.waitForTimeout(400);
      },
    },
    {
      name: 'dialog-자동매매설정',
      hash: '#/portfolio/paper',
      open: async (page) => {
        await page.getByText('현재 계좌').first().click();
        await page.waitForTimeout(1200);
        await click('자동매매 설정')(page);
      },
    },
    // 매매 규칙 — 보기(잠김) · 수정 + 고급 설정 펼침 · 새 규칙(빈 규칙)
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
    // 자동매매 설정 「규칙 없음」 · 「손절 끔 경고」(규칙 목록 응답을 바꿔치기 — DB 는 건드리지 않는다), 처음 켜기 2단계,
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
      // ① 종목은 접힌 채로 연다 → 표를 재려면 펼친다
      open: click('펼치기'),
    },
    // 트레일링 기준 차이 안내(백테스트 안내 · 결과 위 한 줄) · 계좌 「지금 조건」 · 「최근 판단」 총점 순위 문장.
    // 응답을 받아 고쳐 보낸다: 규칙의 트레일링을 켜고, 최근 판단에 총점 순위 줄을 넣는다(엔진이 만드는 문장 그대로)
    { name: 'backtest-안내-트레일링', hash: '#/backtest', open: click('백테스트는 무엇인가요?') },
    {
      name: 'backtest-결과-트레일링',
      hash: '#/backtest',
      before: async (page: Page) => {
        await page.route('**/api/backtest/reports/*', async (r) => {
          if (r.request().method() !== 'GET') return r.continue();
          const res = await r.fetch();
          const body = await res.json();
          const walk = (o: unknown): void => {
            if (!o || typeof o !== 'object') return;
            for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
              if (k === 'sell' && v && typeof v === 'object' && 'trailing' in v) (v as { trailing: { on: boolean } }).trailing.on = true;
              else walk(v);
            }
          };
          walk(body);
          await r.fulfill({ response: res, json: body });
        });
      },
      after: (page: Page) => page.unroute('**/api/backtest/reports/*'),
      open: async (page: Page) => {
        await page.reload();
        await page.waitForTimeout(2500);
        await page.getByText('트레일링은 계좌는 실시간 최고가', { exact: false }).last().scrollIntoViewIfNeeded();
        await page.waitForTimeout(300);
      },
    },
    // 「최근 판단」 묶음 접기(처음엔 가장 최근만 펼침) · 둘째 묶음도 펼침 · 「매수·매도만」
    ...(['접힘', '펼침', '매수매도만'] as const).map((v) => ({
      name: `account-최근판단-${v}`,
      hash: '#/portfolio/paper',
      before: async (page: Page) => {
        await page.route('**/api/auto-trading/status/*', async (r) => {
          const res = await r.fetch();
          const body = await res.json();
          // 하루치: 미국 판단(22:31) 묶음 + 국내 판단(09:05) 묶음, 최근이 위
          const us = new Date(); us.setHours(22, 31, 0, 0);
          const kr = new Date(); kr.setHours(9, 5, 0, 0);
          const U = { at: us.toISOString(), market: 'US' };
          const K = { at: kr.toISOString(), market: 'KR' };
          const notes = [
            { symbol: 'MSFT', action: 'BUY', reason: '매수 점수 80점(기준 65점) → 35주 · 총점 순위 1위(3종목 중)', code: 'score_buy', rank: { n: 1, of: 3 }, ...U },
            { symbol: 'NVDA', action: 'HOLD', reason: '보유 종목 수가 가득 차 사지 않았습니다 (총점 순위 2위 / 3종목 중)', code: 'max_positions', rank: { n: 2, of: 3 }, ...U },
            { symbol: 'AAPL', action: 'HOLD', reason: '보유 종목 수가 가득 차 사지 않았습니다 (총점 순위 3위 / 3종목 중)', code: 'max_positions', rank: { n: 3, of: 3 }, ...U },
            { symbol: '005930', action: 'HOLD', reason: '점수 72/100 — 시장 기준 KODEX 200 가 200일선 아래라 사지 않습니다 (KODEX 200 ₩88,750 · 200일선 ₩99,193) (10-15 마감 기준)', code: 'gate_block', gateReason: 'market', ...K },
            { symbol: '035420', action: 'SELL', reason: '점수 40점 — 50점 아래로 떨어져 매도 (10-15 마감 기준)', code: 'score_sell', ...K },
            { symbol: '000660', action: 'HOLD', reason: '점수 40/100 — 기준 65점 미만 (10-15 마감 기준)', code: 'no_signal_buy', ...K },
          ];
          const status = (body.status ?? body) as { lastNotes: unknown[]; lastNotesAt: string | null };
          status.lastNotes = notes;
          status.lastNotesAt = new Date().toISOString();
          await r.fulfill({ response: res, json: body });
        });
        await page.route('**/api/rules', async (r) => {
          if (r.request().method() !== 'GET') return r.continue();
          const res = await r.fetch();
          const body = (await res.json()) as { rules: { sell: { trailing: { on: boolean } } }[] };
          for (const rule of body.rules) rule.sell.trailing.on = true;
          await r.fulfill({ response: res, json: body });
        });
      },
      after: async (page: Page) => {
        await page.unroute('**/api/auto-trading/status/*');
        await page.unroute('**/api/rules');
      },
      open: async (page: Page) => {
        await page.reload();
        await page.waitForTimeout(1500);
        await page.getByText('현재 계좌').first().click();
        await page.waitForTimeout(1500);
        await click('조건 상세 보기')(page);
        await click(/최근 판단 보기/)(page);
        await page.waitForTimeout(400);
        if (v === '펼침') await page.locator('[data-notes-group]').nth(1).getByRole('button').first().click();
        if (v === '매수매도만') await page.getByRole('radio', { name: '매수·매도만' }).click();
        await page.waitForTimeout(300);
      },
    })),
    {
      // 보관 100개: 사본 DB 의 실제 기록으로 날짜 목록 [더 보기] 를 한 번 누른 모습(기록이 30일보다 많아야 버튼이 보인다)
      name: 'backtest-히스토리-더보기',
      hash: '#/backtest',
      open: async (page: Page) => {
        // 앞 대상(날짜펼침)이 바꿔치기한 목록이 같은 창에 남아 있다 — 새로 읽는다
        await page.reload();
        const more = page.getByRole('button', { name: '더 보기', exact: true });
        await more.waitFor({ timeout: 15000 });
        await more.click();
        await page.waitForTimeout(500);
        await page.getByRole('list', { name: '날짜별 백테스트' }).locator('li').last().scrollIntoViewIfNeeded();
        await page.waitForTimeout(300);
      },
    },
    {
      // 종목 12개면 ① 이 「…외 N개」 한 줄로 접혀 있다(아래 ② 방법이 밀리지 않는다)
      name: 'backtest-종목접힘',
      hash: '#/backtest',
      before: async (page) => {
        await page.evaluate(async () => {
          const uni = (await (await fetch('/api/backtest/universe')).json()) as { sectors: { symbols: { symbol: string }[] }[] };
          const symbols = uni.sectors.flatMap((g) => g.symbols.map((x) => x.symbol)).slice(0, 12);
          localStorage.setItem('alphascope.backtestDraft', JSON.stringify({ symbols, added: [], years: 1, conditions: [{ ruleId: null }] }));
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
    // 매수 판단 — 상태는 응답 바꿔치기로 만든다(DB 를 건드리지 않는다)
    {
      name: 'swing-빈목록',
      hash: '#/swing/list',
      before: async (page) => {
        await page.route('**/api/buy-judge', (r) =>
          r.fulfill({ json: { ruleId: 1, ruleName: '기본 규칙', symbols: [], retention: '1y', computedAt: new Date().toISOString(), rows: [] } }));
      },
      after: (page) => page.unroute('**/api/buy-judge'),
    },
    {
      name: 'swing-규칙없음',
      hash: '#/swing/list',
      before: async (page) => {
        await page.route('**/api/buy-judge', (r) =>
          r.fulfill({ json: { ruleId: null, ruleName: null, symbols: ['AAPL', 'NVDA', '005930'], retention: '1y', computedAt: new Date().toISOString(), rows: [] } }));
      },
      after: (page) => page.unroute('**/api/buy-judge'),
    },
    {
      name: 'swing-줄펼침',
      hash: '#/swing/list',
      // 앞 대상(바꿔치기)의 화면이 남지 않게 홈을 거쳐 다시 그린다
      before: async () => {},
      open: async (page) => {
        await page.locator('[data-buy-judge-table] tbody tr').first().click();
        await page.waitForTimeout(500);
      },
    },
    {
      name: 'swing-목표수익가능성결과',
      hash: '#/swing/list',
      before: async (page) => {
        const goal = (await page.evaluate(async () => (await (await fetch('/api/swing/goal')).json()))) as { targetPct: number; stopPct: number; days: number };
        const sym = (await page.evaluate(async () => (await (await fetch('/api/buy-judge')).json()).symbols[0])) as string;
        const rec = {
          id: 9001, symbol: sym, createdAt: new Date().toISOString(), baseDate: '2026-10-14', entryPrice: 100,
          targetPct: goal.targetPct, stopPct: goal.stopPct, days: goal.days, pTarget: 42, pStop: 35, pNeither: 23, normalized: false,
          summary: '점검용 결과입니다. 최근 추세는 유지되고 있으나 실적 발표가 기간 안에 있습니다.',
          reasons: ['20일선 위에서 움직입니다', '거래량이 평균보다 많습니다'], risks: ['실적 발표가 기간 안에 있습니다'],
          agents: [], base: { target: 31, stop: 38, neither: 31, expectancy: -0.12, samples: 250 },
          promptVersion: 't1', model: 'test', tokens: 0, outcome: null, outcomeDate: null, dueDate: '2026-11-12',
        };
        await page.route('**/api/target-analysis?**', (r) =>
          r.fulfill({ json: { records: [rec], stats: { scored: 0, aiHit: 0, baseHit: 0, aiRate: null, baseRate: null, weak: true, rawScored: 0 } } }));
      },
      after: (page) => page.unroute('**/api/target-analysis?**'),
      open: async (page) => {
        await page.locator('[data-buy-judge-table] tbody tr').first().click();
        await page.waitForTimeout(500);
      },
    },
    {
      // 실제 응답의 두 번째 줄을 「손익비 부족」 으로 바꾼다(판단 글자 · 경고 아이콘 · 손절가~비중 칸 확인용)
      name: 'swing-손익비부족섞임',
      hash: '#/swing/list',
      before: async (page) => {
        await page.route('**/api/buy-judge', async (r) => {
          const res = await r.fetch();
          const body = (await res.json()) as { rows: { verdict: string; reference: unknown }[] };
          const withRef = body.rows.find((x) => x.reference);
          if (body.rows[1] && withRef) Object.assign(body.rows[1], { verdict: 'rr_block', reference: withRef.reference });
          // 국내 줄(원화 큰 가격 — 가장 넓은 숫자 칸)도 하나: 같은 계획을 원화 크기로 키운다
          const kr = body.rows.find((x) => /^\d/.test((x as unknown as { symbol: string }).symbol));
          const ref = withRef?.reference as Record<string, number> | undefined;
          if (kr && ref) {
            const big = Object.fromEntries(Object.entries(ref).map(([k, v]) => [k, typeof v === 'number' && k !== 'ratio' && k !== 'sizePercent' ? Math.round(v * 4000) : v]));
            Object.assign(kr, { verdict: 'rr_block', reference: big });
          }
          await r.fulfill({ response: res, json: body });
        });
      },
      after: (page) => page.unroute('**/api/buy-judge'),
    },
    {
      // 「거름망에 걸림 · 70/100」(빨강). 실제 응답의 첫 줄을 바꾼다
      name: 'swing-거름망',
      hash: '#/swing/list',
      before: async (page) => {
        await page.route('**/api/buy-judge', async (r) => {
          const res = await r.fetch();
          const body = (await res.json()) as { rows: { verdict: string; score: number }[] };
          // 이유 4가지를 앞 네 줄에(1280 에서 가장 긴 「(시장 데이터 없음)」 이 판단 칸에 들어가는지)
          const reasons = ['market_nodata', 'market', 'below200', 'short'];
          body.rows.slice(0, 4).forEach((row, k) => Object.assign(row, { verdict: 'gate_block', score: 70, gateReason: reasons[k] }));
          await r.fulfill({ response: res, json: body });
        });
      },
      after: (page) => page.unroute('**/api/buy-judge'),
    },
    // 매매 규칙 「거름망」 칸: 예시 규칙 보기(잠김 · 켜짐) · 수정에서 50/200 고르기(추천)
    {
      name: 'dialog-매매규칙-예시200',
      hash: '#/rules',
      open: async (page: Page) => {
        await page.getByRole('row').filter({ hasText: '기본 규칙 + 200일선' }).getByRole('button', { name: '조건 보기' }).click();
        await page.waitForTimeout(500);
        await page.locator('[data-gate="above200"]').scrollIntoViewIfNeeded();
        await page.waitForTimeout(200);
      },
    },
    {
      // 거름망 꺼진 규칙(기본 규칙)의 보기 상태 — 잠김 · 빈 체크
      name: 'dialog-매매규칙-거름망끔',
      hash: '#/rules',
      open: async (page: Page) => {
        await page.getByRole('row').filter({ has: page.getByRole('cell', { name: '기본 규칙', exact: true }) }).first().getByRole('button', { name: '조건 보기' }).click();
        await page.waitForTimeout(500);
        await page.locator('[data-gate="above200"]').scrollIntoViewIfNeeded();
        await page.waitForTimeout(200);
      },
    },
    {
      name: 'dialog-매매규칙-50200',
      hash: '#/rules',
      open: async (page: Page) => {
        await click('조건 보기')(page);
        await click(/^수정$/)(page);
        await expandAdvanced(page);
        await page.getByRole('checkbox', { name: '이동평균 교차 사용' }).check();
        await page.getByLabel('장기 이동평균').selectOption('200');
        await page.getByLabel('단기 이동평균').selectOption('50');
        await page.getByRole('checkbox', { name: '주가가 200일선 위일 때만 매수 사용' }).check();
        await page.locator('[data-gate="above200"]').scrollIntoViewIfNeeded();
        await page.waitForTimeout(300);
      },
    },
    { name: 'dialog-매수판단-조건보기', hash: '#/swing/list', before: async () => {}, open: click('조건 보기') },
    // 매수 판단 히스토리 = 날짜별 목록(펼침) · 아래 접힌 「종목별 사지 않은 이유」(펼침). 응답 바꿔치기 — DB 는 그대로
    ...(['날짜펼침', '사지않은이유'] as const).map((which) => ({
      name: `swing-history-${which}`,
      hash: '#/swing/history',
      before: async (page: Page) => {
        const row = (symbol: string, verdict: 'buy' | 'below' | 'rr_block' | 'gate_block', score: number, r5: number | null = null, r10: number | null = null, r20: number | null = null) =>
          ({ symbol, ruleName: '기본 규칙', verdict, score, maxScore: 100, r5, r10, r20 });
        const days = [
          { marketDate: '2026-10-15', rows: [row('005930', 'below', 51), row('AAPL', 'buy', 72, 2.31, -1.4, 5.02), row('LLY', 'rr_block', 66), row('NVDA', 'buy', 68, -0.85, null, null), row('XOM', 'below', 45), { ...row('MSFT', 'gate_block', 70), gateReason: 'market' }], buys: 2, nonBuys: 4 },
          { marketDate: '2026-10-14', rows: [row('005930', 'below', 47), row('AAPL', 'below', 60), row('LLY', 'below', 41), row('NVDA', 'buy', 70, 1.2, 3.4, null), row('XOM', 'below', 44)], buys: 1, nonBuys: 4 },
          { marketDate: '2026-10-13', rows: [row('AAPL', 'below', 58), row('NVDA', 'below', 62)], buys: 0, nonBuys: 2 },
        ];
        // 서버(`historyDays`)와 같은 순서로 보낸다 — 사도 됨 → 손익비 부족 → 기준 미달
        const served = days.map((d) => ({ ...d, rows: sortDayRows(d.rows) }));
        await page.route('**/api/buy-judge/days?**', (r) => r.fulfill({ json: { days: served, totalDays: 45 } }));
        const reasons = [
          { symbol: 'AAPL', days: 20, below: 15, rrBlock: 2, gateBlock: 2, gateReasons: { market: 1, below200: 1 }, buy: 1, mostMissing: '추세' },
          { symbol: 'LLY', days: 20, below: 20, rrBlock: 0, gateBlock: 0, buy: 0, mostMissing: '타이밍' },
          { symbol: '005930', days: 18, below: 15, rrBlock: 2, gateBlock: 0, buy: 1, mostMissing: '거래량' },
        ];
        await page.route('**/api/buy-judge/history', (r) =>
          r.fulfill({ json: { stats: { n5: 2, n10: 2, n20: 1, avg5: 0.73, avg10: -0.1, avg20: 5.02, smallSample: true }, reasons, counts: { all: 61, nonBuy: 58 } } }));
        await page.route('**/api/buy-judge/history/*', (r) =>
          r.fulfill({ json: { days: [
            { marketDate: '2026-10-14', ruleName: '기본 규칙', verdict: 'below', score: 47, maxScore: 100, minScore: 65, reason: '점수 47점 — 기준 65점 미달' },
            { marketDate: '2026-10-13', ruleName: '기본 규칙', verdict: 'rr_block', score: 66, maxScore: 100, minScore: 65, reason: '손익비 0.84 — 1 미만이라 매수하지 않습니다' },
          ] } }));
      },
      after: async (page: Page) => {
        await page.unroute('**/api/buy-judge/history');
        await page.unroute('**/api/buy-judge/history/*');
        await page.unroute('**/api/buy-judge/days?**');
      },
      open: async (page: Page) => {
        await page.waitForTimeout(800);
        if (which === '날짜펼침') {
          await page.getByRole('button', { name: /2026-10-15/ }).first().click();
        } else {
          await click('종목별 사지 않은 이유 보기')(page);
          await page.getByRole('button', { name: /애플/ }).first().click();
        }
        await page.waitForTimeout(600);
      },
    })),
    {
      name: 'dialog-매수판단-기록지우기',
      hash: '#/swing/history',
      before: async (page) => {
        await page.route('**/api/buy-judge/history', (r) =>
          r.fulfill({ json: { stats: { n5: 0, n10: 0, n20: 0, avg5: null, avg10: null, avg20: null, smallSample: true }, reasons: [], counts: { all: 61, nonBuy: 58 } } }));
      },
      after: (page) => page.unroute('**/api/buy-judge/history'),
      open: click('기록 삭제'),
    },
    {
      name: 'dialog-보관기간-줄이기',
      hash: '#/settings-app',
      // 지워질 줄 수만 바꿔치기 — [삭제] 를 누르지 않으므로 실제로 바뀌지 않는다
      before: async (page) => { await page.route('**/api/buy-judge/retention?dryRun=1', (r) => r.fulfill({ json: { willDelete: 42 } })); },
      after: (page) => page.unroute('**/api/buy-judge/retention?dryRun=1'),
      open: async (page) => {
        await page.getByRole('radiogroup', { name: '매수 판단 기록 보관 기간' }).getByText('6개월').click()
          .catch(() => page.getByText('6개월', { exact: true }).first().click());
        await page.waitForTimeout(600);
      },
    },
    // AI 검증 · 계좌 복사 — 사본 DB 에 심은 계좌(「AI 검증 비교 A」 · 「AI 검증 빈 계좌」)를 골라 둔다(앱이 처음 읽는 선택 계좌라 새로 고침)
    ...((): Target[] => {
      const pickAccount = (name: string) => async (page: Page) => {
        await page.evaluate(async (name) => {
          const { accounts } = (await (await fetch('/api/paper/accounts')).json()) as { accounts: { id: number; name: string }[] };
          const id = accounts.find((a) => a.name === name)?.id;
          if (id) localStorage.setItem('alphascope.paperAccountId', String(id));
        }, name);
        await page.reload();
        await page.waitForTimeout(2000);
      };
      const openDetail = async (page: Page) => {
        await page.getByText('현재 계좌').first().click();
        await page.waitForTimeout(1500);
      };
      const A = 'AI 검증 비교 A';
      return [
        {
          name: 'account-AI검증-최근판단',
          hash: '#/portfolio/paper',
          before: pickAccount(A),
          open: async (page) => {
            await openDetail(page);
            await click(/최근 판단 보기/)(page);
            await page.getByRole('button', { name: 'AI 이유 보기' }).first().click();
            await page.getByRole('button', { name: '까닭 보기' }).first().click();
            await page.waitForTimeout(400);
          },
        },
        {
          name: 'account-AI검증기록',
          hash: '#/portfolio/paper',
          before: pickAccount(A),
          open: async (page) => {
            await openDetail(page);
            await page.getByRole('button', { name: 'AI 검증 기록' }).first().click();
            await page.waitForTimeout(1500);
            await page.locator('tbody tr[aria-expanded]').nth(1).click();
            await page.waitForTimeout(400);
          },
        },
        {
          name: 'dialog-자동매매설정-AI켬-접힘',
          hash: '#/portfolio/paper',
          before: pickAccount(A),
          open: async (page) => {
            await openDetail(page);
            await click('자동매매 설정')(page);
          },
        },
        {
          name: 'dialog-자동매매설정-AI켬-펼침',
          hash: '#/portfolio/paper',
          before: pickAccount(A),
          open: async (page) => {
            await openDetail(page);
            await click('자동매매 설정')(page);
            await click('펼치기')(page);
          },
        },
        {
          // Gemini 가 켜진 서버처럼(경고 없음) · 끔 상태 — 응답 바꿔치기
          name: 'dialog-자동매매설정-AI끔-Gemini켬',
          hash: '#/portfolio/paper',
          before: async (page) => {
            await page.route('**/api/gemini/status', (r) => r.fulfill({ json: { enabled: true, model: 'test', reason: null, usage: { date: '2026-10-15', items: [], totalCalls: 0 } } }));
            await pickAccount(A)(page);
          },
          after: (page) => page.unroute('**/api/gemini/status'),
          open: async (page) => {
            await openDetail(page);
            await click('자동매매 설정')(page);
            await page.getByRole('radiogroup', { name: 'AI 검증' }).getByText('끔').click();
            await page.waitForTimeout(300);
          },
        },
        {
          name: 'dialog-자동매매설정-0종목',
          hash: '#/portfolio/paper',
          before: pickAccount('AI 검증 빈 계좌'),
          open: async (page) => {
            await openDetail(page);
            await click('자동매매 설정')(page);
          },
        },
        {
          name: 'dialog-계좌복사',
          hash: '#/portfolio/paper',
          before: pickAccount(A),
          open: async (page) => {
            await openDetail(page);
            await click('계좌 복사')(page);
            await page.waitForTimeout(800);
          },
        },
      ];
    })(),
    // 사이드 메뉴 — 보고 있는 대메뉴를 접은 상태
    {
      name: 'nav-보고있는대메뉴-접힘',
      hash: '#/compare',
      open: async (page) => {
        await page.getByRole('navigation').getByRole('button', { name: '차트·비교', expanded: true }).click();
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
    // v2.69.4 차트 보기 — 크게 확대한 일봉 · 가격 축 휠 · 드로잉 선택 「삭제」 버튼 · 오른쪽 클릭 메뉴(잰 뒤 [초기화] · 그림 지움)
    ...(() => {
      const chartBox = async (page: Page) => (await page.getByTestId('candle-chart').boundingBox())!;
      const zoomIn = async (page: Page) => {
        const b = await chartBox(page);
        await page.mouse.move(b.x + b.width * 0.85, b.y + b.height * 0.3);
        for (let i = 0; i < 8; i++) {
          await page.mouse.wheel(0, -100);
          await page.waitForTimeout(60);
        }
        await page.waitForTimeout(400);
      };
      const drawTrend = async (page: Page) => {
        const b = await chartBox(page);
        await page.getByRole('radio', { name: '추세선', exact: true }).click();
        await page.mouse.click(b.x + b.width * 0.25, b.y + b.height * 0.2);
        await page.mouse.click(b.x + b.width * 0.55, b.y + b.height * 0.5);
        await page.waitForTimeout(700);
      };
      /** 차트를 왼쪽으로 끌어 마지막 봉 오른쪽 빈 곳을 넓힌 뒤 그 빈 곳에 자를 끈다 — `release` 가 아니면 끄는 중(놓지 않음). 돌려주는 값 = 자 안쪽 한 점 */
      const rulerInEmpty = async (page: Page, release: boolean) => {
        const b = await chartBox(page);
        await page.mouse.move(b.x + b.width * 0.7, b.y + b.height * 0.85);
        await page.mouse.down();
        await page.mouse.move(b.x + b.width * 0.3, b.y + b.height * 0.85, { steps: 8 });
        await page.mouse.up();
        await page.waitForTimeout(300);
        await page.getByRole('radio', { name: '자', exact: true }).click();
        const from = { x: b.x + b.width * 0.62, y: b.y + b.height * 0.22 };
        const to = { x: b.x + b.width * 0.8, y: b.y + b.height * 0.42 };
        await page.mouse.move(from.x, from.y);
        await page.mouse.down();
        await page.mouse.move(to.x, to.y, { steps: 8 });
        await page.waitForTimeout(200);
        if (release) {
          await page.mouse.up();
          await page.mouse.move(0, 0);
          await page.waitForTimeout(700);
        }
        return { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
      };
      const reset = async (page: Page) => {
        await page.keyboard.press('Escape');
        const clear = page.getByRole('button', { name: '모두 삭제', exact: true });
        if (await clear.isEnabled()) await clear.click();
        await page.getByRole('button', { name: '초기화', exact: true }).click();
        await page.mouse.move(0, 0);
        await page.waitForTimeout(300);
      };
      return [
        { name: 'chart-크게확대-일봉', hash: '#/chart', open: zoomIn, after: reset },
        {
          name: 'chart-가격축휠-늘림',
          hash: '#/chart',
          open: async (page: Page) => {
            const b = await chartBox(page);
            await page.mouse.move(b.x + b.width - 30, b.y + b.height * 0.3);
            await page.mouse.wheel(0, -100);
            await page.mouse.wheel(0, -100);
            await page.waitForTimeout(400);
          },
          after: reset,
        },
        {
          name: 'chart-드로잉선택-삭제버튼',
          hash: '#/chart',
          open: async (page: Page) => {
            await drawTrend(page);
            const b = await chartBox(page);
            await page.mouse.click(b.x + b.width * 0.4, b.y + b.height * 0.35);
            await page.waitForTimeout(400);
          },
          after: reset,
        },
        {
          name: 'chart-드로잉-오른쪽클릭메뉴',
          hash: '#/chart',
          open: async (page: Page) => {
            await drawTrend(page);
            const b = await chartBox(page);
            await page.mouse.click(b.x + b.width * 0.4, b.y + b.height * 0.35, { button: 'right' });
            await page.waitForTimeout(400);
          },
          after: reset,
        },
        // v2.69.5 — 마지막 봉 오른쪽 빈 곳에 그린 자(그리는 중 · 그린 뒤) · 모양 위 「삭제」 · 모양 위 오른쪽 클릭 메뉴
        { name: 'chart-자-빈곳-그리는중', hash: '#/chart', open: async (page: Page) => { await zoomIn(page); await rulerInEmpty(page, false); }, after: async (page: Page) => { await page.mouse.up(); await reset(page); } },
        { name: 'chart-자-빈곳-그린뒤', hash: '#/chart', open: async (page: Page) => { await zoomIn(page); await rulerInEmpty(page, true); }, after: reset },
        {
          name: 'chart-모양위-삭제버튼',
          hash: '#/chart',
          open: async (page: Page) => {
            await zoomIn(page);
            const r = await rulerInEmpty(page, true);
            await page.mouse.click(r.x, r.y);
            await page.waitForTimeout(400);
          },
          after: reset,
        },
        {
          name: 'chart-모양위-오른쪽클릭메뉴',
          hash: '#/chart',
          open: async (page: Page) => {
            await zoomIn(page);
            const r = await rulerInEmpty(page, true);
            await page.mouse.click(r.x, r.y, { button: 'right' });
            await page.waitForTimeout(400);
          },
          after: reset,
        },
      ];
    })(),
    // v2.69.5 — 가벼운 캔들 차트(실시간 순위 미리보기 · 기업 비교)를 크게 확대 — 봉 높이 차이(메인 · 캡처와 같은 축 설정)
    ...(['#/ranking', '#/compare'] as const).map((hash) => ({
      name: `${hash === '#/ranking' ? 'ranking-미리보기' : 'compare-차트'}-크게확대`,
      hash,
      open: async (page: Page) => {
        // 기업 비교가 비어 있으면 관심 목록의 SK하이닉스를 한 칸에 넣는다(클릭: 빈 칸에 차례로 추가)
        if (hash === '#/compare' && !(await page.getByTestId('lite-candle-chart').count())) {
          await page.getByRole('button', { name: /SK하이닉스/ }).first().click();
        }
        await page.waitForTimeout(5000); // 봉이 다 들어온 뒤 확대(먼저 확대하면 데이터가 들어오며 처음 범위로 돌아간다)
        const lite = page.getByTestId('lite-candle-chart').first();
        if (!(await lite.count())) return;
        const b = (await lite.boundingBox())!;
        await page.mouse.move(b.x + b.width * 0.85, b.y + b.height * 0.4);
        // 라이브러리 기본 휠 확대는 한 번에 조금씩 — 봉 10~20개가 될 만큼
        for (let i = 0; i < 40; i++) {
          await page.mouse.wheel(0, -100);
          await page.waitForTimeout(40);
        }
        await page.mouse.move(0, 0);
        await page.waitForTimeout(500);
      },
    })),
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

  // 2. 폼 줄(FormRow) — 같은 묶음(창·구역) 안에서 (기준표 「폼 줄 · 입력칸」)
  //    칸 오른쪽 끝 0px · 단위 열 왼쪽 끝 0px · 설명 시작점 0px · 숫자 칸 폭 = 종류 변수(short 64 · long 128 · fill 값 칸 폭) · 이름 넘침 0
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
      // 감싼 요소가 아니라 **보이는 조작 요소 자체**의 오른쪽 끝(숫자 칸은 칸 상자) — 감싼 span 에 빈 단위 자리가 남아 있으면 그 폭이 끝으로 잡혀 어긋남을 놓쳤다
      const ctrls = cell
        ? [...cell.querySelectorAll('input:not([type=checkbox]):not([type=radio]), select, [role=radiogroup], label, button')]
            .map((c) => (c.tagName === 'INPUT' ? c.parentElement! : c))
            .filter((c) => visible(c) && !c.closest('ul')) // 열린 검색 목록(떠 있는 층)의 버튼은 칸이 아니다
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
        if (![64, 128, Math.round(cell!.getBoundingClientRect().width)].includes(w)) issues.push({ kind: '입력칸 끝 맞춤', detail: `숫자 칸 폭 ${w}px — 종류 변수(64·128 · 값 칸 채움)와 다름 「${label(row.querySelector('label') ?? row)}」` });
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
  // 9. 표 숫자 칸 벌어짐 — 숫자 칸은 내용 폭 + 고정 여백. 칸 폭이 내용보다 64px 넘게 넓으면 남는 폭이 숫자 칸으로 간 것이다
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
  // 10. 탭 줄 · 내용 왼쪽 끝 — 탭 줄(role=tablist)의 첫 탭 왼쪽과, 같은 영역에서 그 다음에 오는 내용의 첫 요소 왼쪽이 같아야 한다
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
    // 줄마다 다른 값을 담는 설정표(`data-rows-differ` — 판단 기준 숫자표)는 열의 자릿수가 섞이는 게 맞다
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
  // 15. 날짜 표기 — 오전/오후 시각 · 「2026. 9. 3.」 형식이 화면에 남아 있으면 안 된다(형식 `2026-10-08 14:30`)
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
  // 16. 차트 축 숫자 잘림 — 칸(pane)이 여럿인 차트(가격 · 거래량 · 지표)의 오른쪽 축 글자가 칸 위아래 끝에 닿으면(잘려서 옆 칸 숫자와 맞붙음).
  //     축 글자는 캔버스라 글자 상자가 없다 — 오른쪽 축 캔버스에서 축 글자색(회색) 점이 있는 줄을 찾아 첫 줄 · 끝 줄이 칸 끝에 닿는지 본다.
  //     현재가 상자(초록 · 빨강 바탕 · 흰 글자)는 회색이 아니라 빠진다. 마지막 줄(tr)은 시간 축이라 뺀다.
  document.querySelectorAll('.tv-lightweight-charts').forEach((root) => {
    if (!visible(root) || offscreen(root)) return;
    const paneRows = [...root.querySelectorAll('tr')].filter((tr) => tr.children.length >= 3).slice(0, -1);
    if (paneRows.length < 2) return;
    paneRows.forEach((tr, pi) => {
      const cv = tr.children[tr.children.length - 1].querySelector('canvas');
      const h = cv?.height ?? 0;
      const w = cv?.width ?? 0;
      if (!cv || h < 2 || w < 2) return;
      const data = cv.getContext('2d')?.getImageData(0, 0, w, h).data;
      if (!data) return;
      const scale = h / Math.max(1, cv.getBoundingClientRect().height);
      const inkRow = (y: number) => {
        for (let x = Math.ceil(4 * scale); x < w; x++) {
          const i = (y * w + x) * 4;
          if (Math.abs(data[i] - data[i + 1]) < 12 && Math.abs(data[i + 1] - data[i + 2]) < 12 && data[i] > 60 && data[i] < 200) return true;
        }
        return false;
      };
      const edge = Math.max(1, Math.round(scale));
      const top = [...Array(edge).keys()].some((y) => inkRow(y));
      const bottom = [...Array(edge).keys()].some((y) => inkRow(h - 1 - y));
      if (top || bottom) issues.push({ kind: '차트 축 숫자 잘림', detail: `${label(root.closest('section, main') ?? root)} · ${pi + 1}번째 칸 ${top ? '위' : ''}${top && bottom ? ' · ' : ''}${bottom ? '아래' : ''} 끝(칸 높이 ${Math.round(h / scale)}px)` });
    });
  });
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
      // 마우스를 화면 구석으로 — 앞 화면에서 누른 자리에 남아 있으면 새 화면의 줄에 올라가 있는 상태(마우스 오버 미리보기 등)로 찍힌다
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
    `- 화면 ${all.length / SIZES.length}개 × 크기 ${SIZES.length} · 캡처는 같은 폴더의 ${SIZES.map((s) => `${s.w}/`).join(' · ')}`,
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
