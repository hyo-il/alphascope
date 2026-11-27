/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
/**
 * 전체 화면 사진(DesignMate 앱 전체 디자인 검토용 · 154차) — 찍기만 한다(측정 · 고침 없음). 다음 검토 때도 쓴다.
 *
 * 테스트 서버(사본 DB · 스위치 끔 · 웹 기본 http://127.0.0.1:5180)에 Playwright 로 접속해 지금 버전의 **모든 화면 · 창**을 네 크기
 * (1440 × 900 · 1280 × 1080 · 1133 × 744 · 402 × 874 — 1280 밑은 `isMobile` · `hasTouch`)로 찍어 한 폴더에 모은다.
 *
 * - 장면: ① `src/types/nav.ts` 의 모든 메뉴 · `PAGE_TABS` 화면 안 탭(손으로 적지 않음) ② 창 · 판 — `designCheck.ts` 의 장면(`targets`)을
 *   이름으로 골라 다시 쓴다(여는 코드 · 가짜 응답 그대로) ③ 계좌 모아보기 · 상세 · 자동매매 처음 켜기 단계는 147 · 149차 `padPhoneAudit.ts` 의 여는 코드를
 *   옮겨 왔다 ④ 차트 아래 탭 · 지표 고르기.
 * - 값: 사본 DB + 가짜 응답. 자산 관리(`/api/asset/**`) · 실제 계좌(`/api/holdings` · `/api/exchange-rate`) · Gemini 결과(`/api/gemini/analyses`)는
 *   **브라우저 맥락 전체에서** 가짜로 답한다(장면이 따로 준 가짜가 먼저) — 실제 시트 · 토스 실제 보유가 사진에 나오지 않는다 · 쓰기 요청은 503.
 * - 찍는 법: 화면은 안쪽 스크롤 상자까지 늘려 **전체 높이**(`fullPage`) 한 장 · 창 · 판은 그 상태 한 장. 스켈레톤(`.skeleton`)이 사라질 때까지 기다리고,
 *   툴팁(`role="tooltip"`)과 초점 표시를 없앤 뒤 찍는다.
 * - 결과: `<OUT>/{1440,1280,1133,402}/<메뉴>-<탭 또는 창>.png`(네 크기 같은 이름) · `<OUT>/목록.md` · `<OUT>/result-<크기>.json`.
 *
 * 쓰는 법(테스트 서버를 띄운 뒤 · 크기마다 따로 · Bash 한 번 10분 안 — 넘으면 `PART=1/2` · `PART=2/2` 로 장면을 나눈다):
 *   DB_PATH=<사본> BASE=http://127.0.0.1:5180 SIZES=1440x900 npx tsx scripts/designReviewShots.ts
 *   목록만 다시 쓰기(찍지 않음): DB_PATH=<사본> LIST_ONLY=1 npx tsx scripts/designReviewShots.ts
 *   장면 · 가짜 응답(`allScenes` · `fakeContext` · `prepareData` · `waitLoaded`)은 `designrules:test`(155차 · 색 · 글 규칙)가 다시 쓴다.
 *   OUT 기본 = 관리 루트 `docs/design-review/<오늘 KST>_<changelog 맨 앞 버전>` · `ONLY=<장면 파일 이름 정규식>`
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import fs from 'node:fs';
import path from 'node:path';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { NAV_GROUPS, PAGE_TABS } from '../src/types/nav';
import { CHANGELOG } from '../src/data/changelog';
import { closeLeftovers, targets, type Target } from './designCheck';
import { assetHistorySample, assetSheetSample, assetStatusSample, assetSummarySample, cashViewSample } from './fixtures/asset/screenSample';

const ROOT = path.resolve(import.meta.dirname, '..');
const BASE = process.env.BASE ?? 'http://127.0.0.1:5180';
const kstDate = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
const OUT = path.resolve(ROOT, process.env.OUT ?? `../../docs/design-review/${kstDate}_${CHANGELOG[0].version}`);
const ALL_SIZES = [
  { w: 1440, h: 900 },
  { w: 1280, h: 1080 },
  { w: 1133, h: 744 },
  { w: 402, h: 874 },
];
const SIZES = process.env.SIZES
  ? process.env.SIZES.split(',').map((s) => {
      const [w, h] = s.split('x').map(Number);
      return { w, h };
    })
  : ALL_SIZES;
/** 전체 높이로 늘릴 때 최대 높이(아주 긴 기록 화면이 사진 한 장을 끝없이 키우지 않게) */
const MAX_FULL_HEIGHT = 8000;

type Kind = 'page' | 'dialog';
export interface Scene {
  /** 파일 이름(확장자 없이) — `<메뉴>-<탭 또는 창>` · 네 크기 같은 이름 */
  file: string;
  /** 메뉴 › 탭 */
  where: string;
  /** 무엇을 연 상태인지 */
  state: string;
  kind: Kind;
  hash: string;
  before?: Target['before'];
  open?: Target['open'];
  after?: Target['after'];
  /** 이 크기에서는 찍지 않는다 — 까닭 */
  skip?: (w: number) => string | null;
}

const slug = (s: string) => s.replace(/[\s·]/g, '');
const tap = (name: string | RegExp, exact = true) => async (page: Page) => {
  await page.getByRole('button', { name, exact: typeof name === 'string' ? exact : undefined }).first().click({ timeout: 4000 });
  await page.waitForTimeout(900);
};
const desk = (w: number) => w >= 1280;

// ───────── ① 메뉴 · 화면 안 탭 ─────────
function pageScenes(): Scene[] {
  const list: Scene[] = [{ file: '홈', where: '홈', state: '설정에서 고른 홈 화면', kind: 'page', hash: '#/home' }];
  for (const g of NAV_GROUPS) {
    for (const p of g.pages) {
      const tabs = (PAGE_TABS as unknown as Record<string, readonly { id: string; path: string }[]>)[p.id];
      const menu = `${slug(g.label)}-${slug(p.label)}`;
      if (tabs?.length) for (const t of tabs) list.push({ file: `${menu}-${t.path}`, where: `${g.label} › ${p.label} › ${t.path}`, state: '화면 처음(아무것도 열지 않음)', kind: 'page', hash: `#/${p.id}/${t.path}` });
      else list.push({ file: menu, where: `${g.label} › ${p.label}`, state: '화면 처음(아무것도 열지 않음)', kind: 'page', hash: `#/${p.id}` });
    }
  }
  return list;
}

// ───────── ② designCheck 장면 다시 쓰기 ─────────
/** designCheck 장면 이름 → 이 폴더의 파일 이름 · 메뉴 › 탭 · 상태 · 종류 */
const FROM_DESIGN_CHECK: [string, string, string, string, Kind][] = [
  // 앱 틀
  ['앱틀-서랍', '틀-메뉴서랍', '앱 틀', '메뉴 서랍(폰 [메뉴] · 패드 [메뉴 펼치기])', 'dialog'],
  ['앱틀-관심판', '틀-관심목록판', '앱 틀', '관심 목록 옆 판', 'dialog'],
  ['앱틀-시황창', '틀-시황창', '앱 틀', '시황 띠를 눌러 연 창', 'dialog'],
  ['search-종목추가창', '틀-종목찾기', '앱 틀', '종목 찾기(종목 추가) 창', 'dialog'],
  // 탐색 — 오늘 시황은 가짜 오전판(Gemini 결과 대신)
  ['market-brief-오전판', '탐색-오늘시황-오전판', '탐색 › 오늘 시황', '가짜 오전판(만든 값)', 'page'],
  // 계좌 — 창(designCheck 가짜 응답)
  ['dialog-계좌복사', '계좌-계좌관리-계좌복사창', '계좌 › 계좌 관리', '계좌 복사 창', 'dialog'],
  // 자산 관리(전부 가짜 응답)
  ['asset-잠김', '자산-잠금화면', '계좌 › 자산 관리', '잠금 화면', 'page'],
  ['asset-기록여러개-미지정', '자산-총자산', '계좌 › 자산 관리', '총 자산(기록 여러 개)', 'page'],
  ['asset-자산현황-계좌카드', '자산-자산현황-계좌별', '계좌 › 자산 관리 › 자산 현황', '계좌별', 'page'],
  ['asset-자산현황-종목별-전체', '자산-자산현황-종목별', '계좌 › 자산 관리 › 자산 현황', '종목별(전체)', 'page'],
  ['asset-자산현황-현금펼침', '자산-자산현황-현금펼침', '계좌 › 자산 관리 › 자산 현황', '현금 줄 펼침', 'page'],
  ['asset-일별변화-표', '자산-일별변화', '계좌 › 자산 관리', '일별 변화 표', 'page'],
  ['asset-비율조정', '자산-비율조정', '계좌 › 자산 관리', '비율 조정', 'page'],
  ['asset-이번달구매', '자산-이번달구매', '계좌 › 자산 관리', '이번 달 구매', 'page'],
  ['asset-이번달구매-살종목', '자산-이번달구매-살종목', '계좌 › 자산 관리 › 이번 달 구매', '살 종목', 'page'],
  ['asset-구매일팝업', '자산-구매일팝업', '계좌 › 자산 관리', '구매일 팝업', 'dialog'],
  ['asset-매수창-국내', '자산-매수창', '계좌 › 자산 관리', '매수 창(국내)', 'dialog'],
  ['asset-매도창-처음', '자산-매도창', '계좌 › 자산 관리', '매도 창', 'dialog'],
  ['asset-새종목-입력창', '자산-새종목매수', '계좌 › 자산 관리', '새 종목 매수 창', 'dialog'],
  ['asset-계산기-국내', '자산-평단계산기', '계좌 › 자산 관리', '평단 계산기', 'dialog'],
  ['asset-분류창-처음', '자산-자산분류정하기', '계좌 › 자산 관리', '자산 분류 정하기 창', 'dialog'],
  ['asset-입출금창-이체', '자산-입출금', '계좌 › 자산 관리', '입출금 창(이체)', 'dialog'],
  ['asset-매매-기록창', '자산-매매기록', '계좌 › 자산 관리', '매매 기록 창', 'dialog'],
  ['asset-설정창-메뉴-목표비율', '자산-설정창-목표비율', '계좌 › 자산 관리 › 설정 창', '목표 비율', 'dialog'],
  ['asset-설정창-메뉴-코어위성', '자산-설정창-코어위성', '계좌 › 자산 관리 › 설정 창', '코어 · 위성', 'dialog'],
  ['asset-설정창-메뉴-연금', '자산-설정창-연금', '계좌 › 자산 관리 › 설정 창', '연금', 'dialog'],
  ['asset-설정창-메뉴-이번달구매', '자산-설정창-이번달구매', '계좌 › 자산 관리 › 설정 창', '이번 달 구매', 'dialog'],
  ['asset-설정창-메뉴-자산분류색', '자산-설정창-자산분류색', '계좌 › 자산 관리 › 설정 창', '자산 분류 색', 'dialog'],
  ['asset-설정창-메뉴-시트가격', '자산-설정창-시트가격', '계좌 › 자산 관리 › 설정 창', '시트 가격', 'dialog'],
  ['asset-설정창-메뉴-잠금', '자산-설정창-잠금', '계좌 › 자산 관리 › 설정 창', '잠금', 'dialog'],
  ['asset-설정창-현금자동반영', '자산-설정창-현금자동반영', '계좌 › 자산 관리 › 설정 창', '현금 자동 반영', 'dialog'],
  // 퀀트
  ['dialog-매매규칙-새규칙', '퀀트-매매규칙-새규칙창', '퀀트 › 매매 규칙', '새 규칙 창', 'dialog'],
  ['dialog-매매규칙-보기', '퀀트-매매규칙-조건보기창', '퀀트 › 매매 규칙', '조건 보기 창', 'dialog'],
  ['swing-판단카드펼침', '퀀트-매수판단-줄펼침', '퀀트 › 매수 판단', '판단 줄 펼침(가짜 판단)', 'page'],
  ['swing-목표바꾸기창', '퀀트-매수판단-목표바꾸기창', '퀀트 › 매수 판단', '목표 바꾸기 창', 'dialog'],
  ['swing-history-날짜펼침', '퀀트-매수판단-history-날짜펼침', '퀀트 › 매수 판단 › history', '날짜 펼침', 'page'],
  ['backtest-고급', '퀀트-백테스트-고급설정', '퀀트 › 백테스트', '고급 설정 펼침', 'page'],
  ['records-analysis-성적표', '퀀트-검증기록-analysis-성적표', '퀀트 › 검증 기록 › analysis', '성적표', 'page'],
  // 실험실
  ['ushalts-예시', '실험실-거래정지-예시', '실험실 › 거래정지', '가짜 거래정지 목록', 'page'],
  // 차트
  ['chart-아래AI탭-전체', '차트-아래탭-AI분석-전체', '차트·비교 › 차트 › 아래 탭', 'AI 분석(프롬프트 펼침 · Gemini 결과는 가짜)', 'page'],
  ['popover-날짜고르기', '증시일정-날짜고르기', '증시 일정', '날짜 고르기 판', 'dialog'],
];

function designCheckScenes(): { scenes: Scene[]; missing: string[] } {
  const all = new Map(targets().map((t) => [t.name, t]));
  const scenes: Scene[] = [];
  const missing: string[] = [];
  for (const [name, file, where, state, kind] of FROM_DESIGN_CHECK) {
    const t = all.get(name);
    if (!t) {
      missing.push(name);
      continue;
    }
    const skip =
      file === '틀-메뉴서랍' || file === '틀-관심목록판'
        ? (w: number) => (desk(w) ? '1280 이상은 메뉴 · 관심 목록이 늘 펼쳐져 있어 서랍 · 판이 없음(화면 사진에 보임)' : null)
        : name === 'chart-아래AI탭-전체'
          ? (w: number) => (w < 768 ? '폰은 위쪽 종목 검색 칸이 없어 designCheck 여는 코드(검색 칸에 AAPL)를 못 씀 — 같은 탭은 `차트-아래탭-AI분석.png`' : null)
          : undefined;
    scenes.push({ file, where, state: `${state} · designCheck 「${name}」`, kind, hash: t.hash, before: t.before, open: t.open, after: t.after, skip });
  }
  return { scenes, missing };
}

// ───────── ③ 계좌(147 · 149차 padPhoneAudit 여는 코드) ─────────
const back = async (page: Page) => {
  const b = page.getByRole('button', { name: '← 계좌 모아보기' });
  if (await b.count()) {
    await b.first().click();
    await page.waitForTimeout(800);
  }
};
const toDetail = async (page: Page) => {
  if ((await page.getByRole('button', { name: '← 계좌 모아보기' }).count()) === 0) {
    await page.locator('article[role="button"], tr[role="button"]').first().click({ timeout: 4000 });
    await page.waitForTimeout(1500);
  }
};
const tabTo = (label: string) => async (page: Page) => {
  await toDetail(page);
  await page.getByRole('button', { name: label, exact: true }).first().click({ timeout: 4000 });
  await page.waitForTimeout(1200);
};
const viewAs = (label: '카드' | '목록') => async (page: Page) => {
  await back(page);
  const r = page.getByRole('radio', { name: label });
  if (await r.count()) {
    await r.first().click();
    await page.waitForTimeout(1200);
  }
};
const wizardTo = (step: number) => async (page: Page) => {
  await back(page);
  await page.getByRole('button', { name: '자동매매 처음 켜기' }).first().click({ timeout: 4000 });
  await page.waitForTimeout(900);
  if (step === 0) return;
  await page.getByRole('button', { name: /있는 계좌 고르기/ }).first().click({ timeout: 4000 });
  await page.waitForTimeout(900);
  const cont = page.getByRole('button', { name: '이 계좌로 계속' });
  if (await cont.count()) await cont.first().click();
  for (let i = 1; i < step; i++) {
    if (i === 2) {
      // 2단계 규칙 고르기(`RuleSelect` — 네이티브 select) — 첫 규칙
      const pick = page.getByRole('dialog').getByRole('combobox').first();
      if (await pick.count()) {
        await pick.selectOption({ index: 1 }).catch(() => {});
        await page.waitForTimeout(500);
      }
    }
    await page.getByRole('button', { name: '다음', exact: true }).click({ timeout: 3000 });
    await page.waitForTimeout(900);
  }
};
/** 149차 padPhoneAudit — 계좌 자동매매 켜짐 · AI 검증 켬 · 최근 판단 3줄(가짜 · 읽기만 바꿈 · 저장은 그대로 서버) */
const autoOn = async (p: Page) => {
  await p.route(/\/api\/auto-trading\/strategies\/\d+$/, async (r) => {
    if (r.request().method() !== 'GET') return r.fallback();
    const res = await r.fetch();
    const j = await res.json();
    Object.assign(j.strategy, { enabled: true, aiCheck: true });
    const at = '2026-11-26T14:31:00.000Z';
    Object.assign(j.status, {
      enabled: true,
      serverEnabled: true,
      lastRunAt: at,
      lastNotesAt: at,
      lastNotes: [
        { symbol: 'NVDA', action: 'BUY', reason: '점수 72 ≥ 65 — 매수', code: 'buy', at, market: 'US' },
        { symbol: 'AAPL', action: 'HOLD', reason: '점수 58 < 65 — 매수 조건 아님', code: 'score_low', at, market: 'US' },
        { symbol: 'WMT', action: 'HOLD', reason: '실적 발표 3거래일 전이라 새로 매수하지 않음', code: 'earnings', at, market: 'US' },
      ],
    });
    return r.fulfill({ json: j });
  });
};
const autoOff = (p: Page) => p.unroute(/\/api\/auto-trading\/strategies\/\d+$/);
function accountScenes(): Scene[] {
  const s = (file: string, where: string, state: string, kind: Kind, open: Scene['open'], hash = '#/portfolio/paper'): Scene => ({ file, where, state, kind, hash, open });
  const W = '계좌 › 계좌 관리';
  return [
    s('계좌-계좌관리-모아보기-카드', W, '계좌 모아보기 · 카드 보기', 'page', viewAs('카드')),
    s('계좌-계좌관리-모아보기-목록', W, '계좌 모아보기 · 목록 보기', 'page', async (p) => {
      await viewAs('목록')(p);
    }),
    s('계좌-계좌관리-새계좌창', W, '새 계좌 창', 'dialog', async (p) => {
      await viewAs('카드')(p);
      await tap(/새 계좌/)(p);
    }),
    s('계좌-계좌관리-자동매매처음켜기-1새계좌', W, '자동매매 처음 켜기 1단계(새 계좌)', 'dialog', wizardTo(0)),
    s('계좌-계좌관리-자동매매처음켜기-1있는계좌', W, '자동매매 처음 켜기 1단계(있는 계좌)', 'dialog', wizardTo(1)),
    s('계좌-계좌관리-자동매매처음켜기-2규칙', W, '자동매매 처음 켜기 2단계(규칙)', 'dialog', wizardTo(2)),
    s('계좌-계좌관리-자동매매처음켜기-3종목', W, '자동매매 처음 켜기 3단계(종목)', 'dialog', wizardTo(3)),
    s('계좌-계좌관리-자동매매처음켜기-4확인', W, '자동매매 처음 켜기 4단계(확인)', 'dialog', wizardTo(4)),
    s('계좌-계좌관리-상세-보유', `${W} › 계좌`, '계좌를 연 화면 · 보유 종목', 'page', tabTo('보유 종목')),
    s('계좌-계좌관리-상세-거래내역', `${W} › 계좌`, '거래내역', 'page', tabTo('거래내역')),
    s('계좌-계좌관리-상세-성과분석', `${W} › 계좌`, '성과분석', 'page', tabTo('성과분석')),
    { ...s('계좌-계좌관리-상세-AI검증기록', `${W} › 계좌`, 'AI 검증 켬(가짜) · AI 검증 기록 탭(사본 DB — 기록 없으면 빈 화면)', 'page', tabTo('AI 검증 기록')), before: autoOn, after: autoOff },
    {
      ...s('계좌-계좌관리-상세-최근판단', `${W} › 계좌`, '자동매매 켜짐 · 최근 판단 펼침(가짜 판단 3줄)', 'page', async (p) => {
        await tabTo('보유 종목')(p);
        const d = p.getByRole('button', { name: /최근 판단/ });
        if (await d.count()) {
          await d.first().click();
          await p.waitForTimeout(800);
        }
      }),
      before: autoOn,
      after: autoOff,
    },
    s('계좌-계좌관리-상세-입금창', `${W} › 계좌`, '입금 창', 'dialog', async (p) => {
      await toDetail(p);
      await tap('입금')(p);
    }),
    s('계좌-계좌관리-상세-출금창', `${W} › 계좌`, '출금 창', 'dialog', async (p) => {
      await toDetail(p);
      await tap('출금')(p);
    }),
    s('계좌-계좌관리-상세-자동매매설정창', `${W} › 계좌`, '자동매매 설정 창', 'dialog', async (p) => {
      await toDetail(p);
      await tap('자동매매 설정')(p);
    }),
    s('계좌-계좌관리-상세-자동매매설정-종목추가', `${W} › 계좌`, '자동매매 설정 창 › 종목 추가', 'dialog', async (p) => {
      await toDetail(p);
      await tap('자동매매 설정')(p);
      // ② 대상 종목은 접힌 한 줄로 연다 — [펼치기] 뒤 [종목 추가]
      const dlg = p.getByRole('dialog');
      const more = dlg.getByRole('button', { name: /^펼치기/ });
      if (await more.count()) {
        await more.first().click();
        await p.waitForTimeout(600);
      }
      await dlg.getByRole('button', { name: /종목 추가/ }).first().click({ timeout: 3000 });
      await p.waitForTimeout(900);
    }),
  ];
}

// ───────── ④ 차트 아래 탭 · 지표 고르기 ─────────
/** 백테스트 결과 — 사본 DB 에 기록이 없으면 `prepareData` 가 한 번 돌려 둔다(토스 · yfinance 읽기만 · 사본 DB 에 씀) */
function quantScenes(): Scene[] {
  return [
    {
      file: '퀀트-백테스트-결과',
      where: '퀀트 › 백테스트',
      state: '맨 위 히스토리 결과를 연 상태(AAPL · NVDA 1년 · 첫 규칙 — 사본 DB 에서 돌린 것)',
      kind: 'page',
      hash: '#/backtest',
      open: async (page) => {
        // 히스토리 날짜 줄을 펼치고 그 안 [열기]
        const closed = page.locator('[data-date-group] > button[aria-expanded="false"]');
        if (await closed.count()) {
          await closed.first().click();
          await page.waitForTimeout(600);
        }
        await page.getByRole('button', { name: '열기', exact: true }).first().click({ timeout: 4000 });
        await page.waitForTimeout(2500);
        await page.getByRole('heading', { name: '결과' }).first().scrollIntoViewIfNeeded().catch(() => {});
      },
    },
  ];
}
export async function prepareData(page: Page) {
  await page.evaluate(async () => {
    const list = (await (await fetch('/api/backtest/reports')).json()) as { reports: unknown[] };
    if (list.reports.length) return;
    const { rules } = (await (await fetch('/api/rules')).json()) as { rules: { id: number }[] };
    if (!rules.length) return;
    await fetch('/api/backtest/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ symbols: ['AAPL', 'NVDA'], years: 1, conditions: [{ label: 'A', ruleId: rules[0].id }] }) });
    for (let i = 0; i < 90; i++) {
      const p = (await (await fetch('/api/backtest/progress')).json()) as { progress?: { running?: boolean } };
      if (!p.progress?.running) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
  });
}

/** 관심 목록 패널 탭 — 1280 이상은 오른쪽 패널 · 그 밑은 [관심 목록] 옆 판을 열고(designCheck 장면은 큰 화면 패널만) · 끝나면 관심 탭으로 */
function panelScenes(): Scene[] {
  const openTab = (label: string) => async (page: Page) => {
    // 큰 화면 = `watch-panel` · 옆 판 = `watch-sheet-panel`(WatchPanel `inSheet`)
    let panel = page.getByTestId('watch-panel');
    if (!(await panel.first().isVisible().catch(() => false))) {
      await tap('관심 목록')(page);
      panel = page.getByTestId('watch-sheet-panel');
    }
    await panel.first().getByRole('button', { name: label, exact: true }).first().click({ timeout: 4000 });
    await page.waitForTimeout(1500);
  };
  const backToWatch = async (page: Page) => {
    const panel = page.getByTestId('watch-panel');
    if (await panel.first().isVisible().catch(() => false)) await panel.first().getByRole('button', { name: '관심', exact: true }).first().click({ timeout: 3000 }).catch(() => {});
  };
  return (['계좌', '최근'] as const).map((l): Scene => ({ file: `틀-관심판-${l}탭`, where: '앱 틀 › 관심 목록 패널', state: `${l} 탭(1280 밑은 옆 판)`, kind: 'dialog', hash: '#/chart', open: openTab(l), after: backToWatch }));
}

function chartScenes(): Scene[] {
  const tab = (label: string) => async (page: Page) => {
    await page.getByRole('tab', { name: label, exact: true }).first().click({ timeout: 4000 });
    await page.waitForTimeout(1800);
  };
  const W = '차트·비교 › 차트 › 아래 탭';
  return [
    ...['차트 지표', '기업정보', '투자자 동향', '뉴스'].map((l): Scene => ({ file: `차트-아래탭-${slug(l)}`, where: W, state: `${l} 탭 · 오른쪽 열 호가 · 빠른 주문`, kind: 'page', hash: '#/chart', open: tab(l) })),
    { file: '차트-아래탭-AI분석', where: W, state: 'AI 분석 탭(Gemini 결과는 가짜)', kind: 'page', hash: '#/chart', open: tab('AI 분석') },
    { file: '차트-지표고르기', where: '차트·비교 › 차트', state: '도구 줄 [지표] 펼침', kind: 'dialog', hash: '#/chart', open: tap(/^지표/) },
  ];
}

export function allScenes(): { scenes: Scene[]; missing: string[] } {
  const dc = designCheckScenes();
  const scenes = [...pageScenes(), ...panelScenes(), ...accountScenes(), ...quantScenes(), ...chartScenes(), ...dc.scenes];
  // 계좌 › 실제 계좌는 메뉴 장면(portfolio-real)이 가짜 보유로 찍힌다
  return { scenes, missing: dc.missing };
}

// ───────── 가짜 응답(맥락 전체 — 장면의 page.route 가 먼저) ─────────
const FAKE_ACCOUNT = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts/fixtures/mobileAccount/api.json'), 'utf8')) as Record<string, unknown>;
function geminiSample(symbol: string) {
  const at = '2026-11-26T22:10:00.000Z';
  const agent = (role: string, label: string, vote: string, summary: string) => ({ role, label, vote, confidence: 62, summary, detail: {}, error: null });
  return {
    id: 990001,
    symbol,
    createdAt: at,
    model: 'gemini-예시',
    signal: 'HOLD',
    confidence: 58,
    summary: '사진용 가짜 결과입니다. 추세는 유지되지만 실적 발표가 가까워 새로 사기보다 지켜보는 쪽입니다.',
    priceAtAnalysis: 231.2,
    agents: [
      agent('technician', '기술 분석', 'BUY', '20일선 위에서 움직이고 거래량이 평균보다 많습니다.'),
      agent('quant', '퀀트', 'HOLD', '최근 변동성이 커져 손익비가 1.2 정도입니다.'),
      agent('fundamental', '기업 가치', 'HOLD', '이익 성장은 이어지지만 주가 수준이 높습니다.'),
      agent('risk_manager', '위험 관리', 'SELL', '실적 발표가 5거래일 안에 있습니다.'),
    ],
    verdict: {
      final_signal: 'HOLD',
      final_confidence: 58,
      votes: { buy: 1, hold: 2, sell: 1 },
      consensus: ['추세는 위쪽입니다'],
      conflicts: [{ issue: '실적 발표 앞 매수', resolution: '발표 뒤 다시 봅니다' }],
      action_plan: { action: '지켜보기', entry_price: null, target_price: 250, stop_loss: 215, position_size_percent: null },
      monitoring: ['실적 발표일', '20일선'],
      summary: '지켜보기 — 실적 발표 뒤 다시 판단합니다.',
    },
    paperOrderId: null,
    tradeNote: null,
    tokens: 0,
    elapsedMs: 0,
    trigger: 'manual',
    promptVersion: 'v-예시',
  };
}
export async function fakeContext(ctx: BrowserContext) {
  await ctx.route('**/api/asset/**', (r) => {
    const req = r.request();
    const url = req.url();
    if (req.method() !== 'GET') {
      if (url.includes('/api/asset/touch')) return r.fulfill({ json: { ok: true, lockMinutes: 30, remainingMs: 30 * 60_000 } });
      return r.fulfill({ status: 503, json: { error: '사진 — 쓰지 않음', kind: 'disabled' } });
    }
    if (url.includes('/api/asset/status')) return r.fulfill({ json: assetStatusSample(true) });
    if (url.includes('/api/asset/sheet')) return r.fulfill({ json: assetSheetSample() });
    if (url.includes('/api/asset/summary')) return r.fulfill({ json: assetSummarySample() });
    if (url.includes('/api/asset/history')) return r.fulfill({ json: assetHistorySample(20) });
    if (/\/api\/asset\/cash(\?|$)/.test(url)) return r.fulfill({ json: cashViewSample() });
    // 나머지 자산 주소도 테스트 서버(실제 시트)로 보내지 않는다
    return r.fulfill({ status: 503, json: { error: '사진 — 가짜 응답 없음', kind: 'disabled' } });
  });
  await ctx.route(/\/api\/(holdings|exchange-rate)(\?|$)/, (r) => r.fulfill({ json: FAKE_ACCOUNT[new URL(r.request().url()).pathname] }));
  await ctx.route(/\/api\/gemini\/analyses(\?|$)/, (r) => {
    const sym = new URL(r.request().url()).searchParams.get('symbol') ?? 'AAPL';
    return r.fulfill({ json: [geminiSample(sym)] });
  });
  // Gemini 를 부르는 주소는 막는다(테스트 서버도 GEMINI_ENABLED=false)
  await ctx.route(/\/api\/gemini\/(analyze|run)/, (r) => r.fulfill({ status: 503, json: { error: '사진 — Gemini 부르지 않음' } }));
}

// ───────── 찍기 ─────────
/** 보이는 스켈레톤(`.skeleton` — 화면 안 · 숨김 아님)이 사라질 때까지(최대 10초) — 기다린 밀리초 */
function visibleSkeletons(): number {
  return [...document.querySelectorAll<HTMLElement>('.skeleton')].filter((el) => {
    if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < window.innerWidth && r.top < window.innerHeight;
  }).length;
}
export async function waitLoaded(page: Page): Promise<number> {
  const t0 = Date.now();
  for (let i = 0; i < 40; i++) {
    if ((await page.evaluate(visibleSkeletons).catch(() => 0)) === 0) break;
    await page.waitForTimeout(250);
  }
  await page.waitForTimeout(300);
  return Date.now() - t0;
}
/** 툴팁 · 초점 표시를 없앤다 */
async function quiet(page: Page) {
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    if (!document.getElementById('__review_quiet')) {
      const st = document.createElement('style');
      st.id = '__review_quiet';
      st.textContent = '[role="tooltip"]{display:none!important}*:focus,*:focus-visible{outline:none!important}';
      document.head.appendChild(st);
    }
  });
}
/** 안쪽 스크롤 상자가 숨긴 높이 — 가장 많이 숨긴 상자 기준(화면 사진을 전체 높이로 늘릴 때) */
function hiddenHeight(): number {
  let extra = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  for (const el of document.querySelectorAll<HTMLElement>('body *')) {
    const cs = getComputedStyle(el);
    if (!/(auto|scroll)/.test(cs.overflowY)) continue;
    if (el.clientHeight < 150 || el.closest('[role="dialog"]')) continue;
    const r = el.getBoundingClientRect();
    if (r.width < window.innerWidth * 0.4) continue; // 좁은 옆 칸(호가 목록 등)은 늘리지 않는다
    extra = Math.max(extra, el.scrollHeight - el.clientHeight);
  }
  return Math.ceil(extra);
}
async function shoot(page: Page, scene: Scene, size: { w: number; h: number }, file: string): Promise<number> {
  await waitLoaded(page);
  await quiet(page);
  if (scene.kind === 'dialog') {
    await page.screenshot({ path: file });
    return size.h;
  }
  const extra = await page.evaluate(hiddenHeight);
  if (extra <= 0) {
    await page.screenshot({ path: file, fullPage: true });
    return size.h;
  }
  const tall = Math.min(MAX_FULL_HEIGHT, size.h + extra);
  await page.setViewportSize({ width: size.w, height: tall });
  await page.waitForTimeout(700);
  await waitLoaded(page);
  await quiet(page);
  await page.screenshot({ path: file, fullPage: true });
  await page.setViewportSize({ width: size.w, height: size.h });
  await page.waitForTimeout(300);
  return tall;
}

interface Row { file: string; size: number; ok: boolean; note: string; height: number }

function writeList(scenes: Scene[], missing: string[]) {
  const rows: Row[] = [];
  for (const s of SIZES.length === ALL_SIZES.length ? ALL_SIZES : ALL_SIZES) {
    const f = path.join(OUT, `result-${s.w}.json`);
    if (fs.existsSync(f)) rows.push(...(JSON.parse(fs.readFileSync(f, 'utf8')) as Row[]));
  }
  const by = (file: string, w: number) => rows.find((r) => r.file === file && r.size === w);
  const shots = ALL_SIZES.reduce((n, s) => n + scenes.filter((x) => by(x.file, s.w)?.ok).length, 0);
  const md = [
    `# 전체 화면 사진 — ${CHANGELOG[0].version}`,
    '',
    `- 버전 ${CHANGELOG[0].version} · 날짜 ${kstDate} · 장면 ${scenes.length} · 사진 ${shots}(크기 ${ALL_SIZES.map((s) => `${s.w} ${scenes.filter((x) => by(x.file, s.w)?.ok).length}`).join(' · ')})`,
    '- **값은 가짜**: 사본 DB(모의투자 계좌 · 규칙 · 기록) + 가짜 응답 — 자산 관리 전부 · 실제 계좌 보유 · Gemini 결과 · 오늘 시황 오전판은 만든 값(실제 시트 · 토스 보유 · 실제 금액 없음).',
    `- 크기: ${ALL_SIZES.map((s) => `${s.w} × ${s.h}`).join(' · ')}(1133 · 402 는 손가락 기기 — \`isMobile\` · \`hasTouch\`) · 폴더 \`{${ALL_SIZES.map((s) => s.w).join(',')}}/\` 에 같은 이름`,
    '- 찍는 법: 화면은 안쪽 스크롤까지 늘린 전체 높이 한 장(최대 8000px) · 창 · 판은 그 상태 한 장 · 로딩(스켈레톤)이 끝난 뒤 · 툴팁 · 초점 표시 없음 · 한국 시간 시계는 모든 사진 위쪽에 보임.',
    '- 만든 스크립트: `workspace/alphascope/scripts/designReviewShots.ts`(장면 = 메뉴 · 탭 자동 + designCheck 장면 + 계좌 단계).',
    '',
    '| 파일 이름 | 메뉴 › 탭 | 무엇을 연 상태 | 못 찍은 것과 까닭 |',
    '|---|---|---|---|',
  ];
  for (const s of scenes) {
    const miss = ALL_SIZES.map((z) => ({ z, r: by(s.file, z.w) }))
      .filter(({ r }) => !r || !r.ok)
      .map(({ z, r }) => `${z.w}: ${r ? r.note : '아직 안 찍음'}`);
    md.push(`| \`${s.file}.png\` | ${s.where} | ${s.state} | ${miss.length ? miss.join(' · ') : '-'} |`);
  }
  if (missing.length) md.push('', `- designCheck 에서 찾지 못한 장면 이름: ${missing.join(', ')}`);
  fs.writeFileSync(path.join(OUT, '목록.md'), md.join('\n') + '\n');
  console.log(`목록 — ${path.join(OUT, '목록.md')} · 장면 ${scenes.length} · 사진 ${shots}`);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const { scenes, missing } = allScenes();
  const names = scenes.map((s) => s.file);
  const dup = names.filter((n, i) => names.indexOf(n) !== i);
  if (dup.length) throw new Error(`같은 파일 이름: ${dup.join(', ')}`);
  if (process.env.LIST_ONLY) return writeList(scenes, missing);

  let chosen = scenes.filter((s) => !process.env.ONLY || new RegExp(process.env.ONLY).test(s.file));
  const part = process.env.PART?.match(/^(\d+)\/(\d+)$/);
  if (part) {
    const [k, n] = [Number(part[1]), Number(part[2])];
    const per = Math.ceil(chosen.length / n);
    chosen = chosen.slice((k - 1) * per, k * per);
  }
  const { createSession } = await import('../server/auth');
  const token = createSession('design-review-shots');
  const browser = await chromium.launch({ channel: 'chrome' });
  for (const size of SIZES) {
    const dir = path.join(OUT, String(size.w));
    fs.mkdirSync(dir, { recursive: true });
    const touch = size.w < 1280;
    const ctx = await browser.newContext({ viewport: { width: size.w, height: size.h }, ...(touch ? { isMobile: true, hasTouch: true } : {}) });
    await ctx.addCookies([{ name: 'as_session', value: token, url: BASE }]);
    await ctx.addInitScript('window.__name = (f) => f'); // tsx(esbuild) 도우미 — 브라우저에는 없다
    await fakeContext(ctx);
    const page = await ctx.newPage();
    page.setDefaultTimeout(6000); // 없는 단추를 30초씩 기다리지 않게(못 찍은 장면은 목록에 까닭)
    let errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e).slice(0, 120)));
    await page.goto(`${BASE}/#/home`);
    await page.waitForTimeout(2500);
    // 종목이 있어야 하는 화면(차트 · 아래 탭) — 홈 첫 카드(애플)를 골라 둔다
    await page.getByRole('button', { name: /애플/ }).first().click().catch(() => {});
    await page.waitForTimeout(1500);
    if (chosen.some((s) => s.file === '퀀트-백테스트-결과')) await prepareData(page).catch((e) => console.log(`백테스트 준비 실패: ${String(e).slice(0, 100)}`));
    const resultFile = path.join(OUT, `result-${size.w}.json`);
    const prev: Row[] = fs.existsSync(resultFile) ? (JSON.parse(fs.readFileSync(resultFile, 'utf8')) as Row[]) : [];
    const rows = new Map(prev.map((r) => [r.file, r]));
    const started = Date.now();
    for (const s of chosen) {
      const skip = s.skip?.(size.w);
      if (skip) {
        rows.set(s.file, { file: s.file, size: size.w, ok: false, note: skip, height: 0 });
        console.log(`${size.w} ${s.file}: 건너뜀 — ${skip}`);
        continue;
      }
      errors = [];
      await page.mouse.move(0, 0).catch(() => {});
      let note = '';
      let ok = true;
      try {
        if (s.before) {
          await page.evaluate(() => (location.hash = '#/home'));
          await page.waitForTimeout(500);
          await s.before(page);
        }
        await page.evaluate((h) => (location.hash = h), s.hash);
        await page.waitForTimeout(2200);
        if (s.open) await s.open(page);
      } catch (e) {
        ok = false;
        note = `창 열기 실패 — ${String(e).split('\n')[0].slice(0, 90)}`;
      }
      let height = 0;
      const t1 = Date.now();
      const file = path.join(dir, `${s.file}.png`);
      if (ok) height = await shoot(page, s, size, file);
      else fs.rmSync(file, { force: true }); // 지난번 사진이 남아 다른 상태로 보이지 않게
      if (ok && errors.length) note = `화면 오류 ${errors.length}(사진은 찍음): ${errors[0]}`;
      rows.set(s.file, { file: s.file, size: size.w, ok, note, height });
      console.log(`${size.w} ${s.file}: ${ok ? `찍음 ${height}px · 찍기 ${((Date.now() - t1) / 1000).toFixed(1)}초` : note}${ok && note ? ` · ${note}` : ''}`);
      if (s.open) await page.keyboard.press('Escape').catch(() => {});
      if (s.after) await s.after(page).catch(() => {});
      await closeLeftovers(page);
    }
    fs.writeFileSync(resultFile, JSON.stringify([...rows.values()], null, 1));
    console.log(`${size.w} — 장면 ${chosen.length} · ${Math.round((Date.now() - started) / 1000)}초`);
    await ctx.close();
  }
  await browser.close();
  writeList(scenes, missing);
}

// 장면 · 가짜 응답은 `designrules:test`(155차)도 다시 쓴다 — 바로 실행했을 때만 찍는다
if (process.argv[1]?.endsWith('designReviewShots.ts'))
  main()
    .then(() => process.exit(0))
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
