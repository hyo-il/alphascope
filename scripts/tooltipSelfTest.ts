/**
 * 앱 툴팁 시험(128차 · v2.69.0) — `npm run tooltip:test` · ⚠️ `DB_PATH=<사본>` 으로만 돈다(맨 첫 import · DB 는 쓰지 않는다).
 *
 * 128차 지시서 「꼭 지킬 동작」(시험 이름 앞의 [128-n]) 가운데 DOM 없이 보는 것:
 *   1 여닫기(순수 `ui/tooltip/hover` · 가짜 시계) · 2 자리(순수 `ui/tooltip/place`) · 4 [ⓘ] 옛 여닫기 · 자리 코드 0(소스) ·
 *   5 아이콘 버튼 두 크기(소스) · 6 `design:lint` 규칙(시험용 가짜 파일 — 끝나면 지운다) · 7 목록 문서 줄 수.
 * 129차(v2.69.1 · [129-n]): 1 툴팁용 title 0 · 툴팁 아닌 속성 95 그대로 · 바꾼 91곳 · 아이콘 버튼 이름 · 2 lint 기준 목록 0 ·
 *   3 · 6 서버 · 매매 · 서버가 함께 쓰는 src(가져오기 끝까지 — `lib/serverSharedSrc`) · 배포 · 스위치 바뀐 줄 0.
 * 131차(v2.69.3 · [131-n]): 2 옆 자리(순수 · `data-tip-side` 단 곳) · 4 `CLAUDE.md` 새 일하는 법 · 25,600바이트 안 ·
 *   5 서버 · 매매 · 주문 · 로그인 · 서버가 함께 쓰는 src 바뀐 줄 0 · designCheck 판정 부분 0.
 * 화면(Playwright)은 `tooltipui:test`.
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { serverSharedSrc } from './lib/serverSharedSrc';
import { appProgram, iconTextButtons, screenFiles, titleAttrs } from './lib/tooltipTitles';
import { createTipController, type TipClock } from '../src/components/ui/tooltip/hover';
import { placeTip, tipMaxWidth } from '../src/components/ui/tooltip/place';
import { ICON_BUTTON_BOX, TOOLTIP_BOX, TOOLTIP_CLOSE_MS, TOOLTIP_EDGE, TOOLTIP_GAP, TOOLTIP_MAX_W, TOOLTIP_OPEN_MS } from '../src/components/ui/tokens';

const root = path.resolve(import.meta.dirname, '..');
let pass = 0;
let fail = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail && !ok ? ` — ${detail}` : ''}`);
}
const read = (p: string) => fs.readFileSync(path.join(root, p), 'utf8');
/** 주석을 뺀 소스 */
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

// ── 가짜 시계 ──
function fakeClock() {
  let t = 0;
  let seq = 0;
  const timers = new Map<number, { at: number; fn: () => void }>();
  const clock: TipClock = {
    now: () => t,
    setTimeout: (fn, ms) => {
      const id = ++seq;
      timers.set(id, { at: t + ms, fn });
      return id;
    },
    clearTimeout: (id) => void timers.delete(id as number),
  };
  const advance = (ms: number) => {
    const end = t + ms;
    for (;;) {
      const next = [...timers.entries()].filter(([, v]) => v.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      timers.delete(next[0]);
      t = next[1].at;
      next[1].fn();
    }
    t = end;
  };
  return { clock, advance };
}
const make = () => {
  const c = fakeClock();
  const ctl = createTipController<string>(c.clock, { openMs: TOOLTIP_OPEN_MS, closeMs: TOOLTIP_CLOSE_MS });
  return { ctl, advance: c.advance };
};

// ── [128-1] 여닫기 ──
check('[128-1] 시간 숫자 — 열림 300ms · 닫힘 200ms · 최대 폭 320 · 간격 4 · 화면 끝 8(디자인 정의 한 곳 tokens.ts)', TOOLTIP_OPEN_MS === 300 && TOOLTIP_CLOSE_MS === 200 && TOOLTIP_MAX_W === 320 && TOOLTIP_GAP === 4 && TOOLTIP_EDGE === 8);
{
  const { ctl, advance } = make();
  ctl.hoverIn('a');
  advance(299);
  ctl.hoverOut('a');
  advance(1000);
  check('[128-1] 0.3초 전에 지나가기만 = 안 열림', ctl.current() === null);
}
{
  const { ctl, advance } = make();
  ctl.hoverIn('a');
  advance(299);
  const before = ctl.current();
  advance(1);
  check('[128-1] 올리고 0.3초 뒤 열림(299ms 에는 아직)', before === null && ctl.current() === 'a');
  ctl.hoverOut('a');
  advance(199);
  const still = ctl.current();
  advance(1);
  check('[128-1] 벗어나고 0.2초 뒤 닫힘(199ms 에는 열린 채)', still === 'a' && ctl.current() === null);
}
{
  const { ctl, advance } = make();
  ctl.hoverIn('a');
  advance(300);
  ctl.hoverOut('a');
  advance(100);
  ctl.boxIn();
  advance(5000);
  const onBox = ctl.current();
  ctl.boxOut();
  advance(100);
  ctl.hoverIn('a'); // 상자에서 대상으로 되돌아옴
  advance(5000);
  const back = ctl.current();
  ctl.hoverOut('a');
  advance(200);
  check('[128-1] 상자로 옮기면 열린 채 · 상자 ↔ 대상 오가도 열린 채 · 둘 다 벗어나면 닫힘', onBox === 'a' && back === 'a' && ctl.current() === null);
}
{
  const { ctl, advance } = make();
  ctl.focusIn('a');
  const now = ctl.current();
  ctl.focusOut('a');
  check('[128-1] 키보드 초점 = 바로 열림 · 초점이 떠나면 바로 닫힘', now === 'a' && ctl.current() === null);
  advance(0);
}
for (const [name, act] of [
  ['누름', (c: ReturnType<typeof make>['ctl']) => c.press()],
  ['Esc', (c: ReturnType<typeof make>['ctl']) => c.escape()],
  ['스크롤', (c: ReturnType<typeof make>['ctl']) => c.scroll()],
  ['창 크기 바꿈', (c: ReturnType<typeof make>['ctl']) => c.resize()],
  ['창이 초점을 잃음', (c: ReturnType<typeof make>['ctl']) => c.windowBlur()],
] as const) {
  const { ctl, advance } = make();
  ctl.hoverIn('a');
  advance(300);
  const opened = ctl.current();
  act(ctl);
  // 대상 위에 마우스가 그대로 있어도 다시 열리지 않는다(고정 안 함)
  advance(1000);
  check(`[128-1] ${name}에 닫힘(그 뒤 그대로 머물러도 다시 열리지 않음)`, opened === 'a' && ctl.current() === null);
}
{
  const { ctl, advance } = make();
  ctl.hoverIn('a');
  advance(100);
  ctl.press();
  advance(1000);
  check('[128-1] 0.3초 전에 누르면 열릴 예정도 지움', ctl.current() === null);
}
{
  const { ctl, advance } = make();
  ctl.focusIn('a');
  advance(299);
  ctl.scroll();
  const kept = ctl.current();
  advance(1);
  ctl.scroll();
  check('[128-1] 키보드 초점으로 연 뒤 0.3초 안의 스크롤은 무시 · 그 뒤 스크롤엔 닫힘', kept === 'a' && ctl.current() === null);
}
{
  const { ctl, advance } = make();
  ctl.hoverIn('a');
  advance(300);
  ctl.hoverOut('a');
  ctl.hoverIn('b');
  const switched = ctl.current();
  advance(1000);
  check('[128-1] 열린 채 다른 대상으로 옮기면 기다리지 않고 바로 바뀜(앞의 닫힘 예약도 지움)', switched === 'b' && ctl.current() === 'b');
}
{
  const { ctl, advance } = make();
  // 툴팁(a) 이 열린 채 [ⓘ](i) 를 키보드로 · 밖에서 열면 툴팁이 닫힘 — 같은 판단 하나라 늘 하나만
  ctl.hoverIn('tip');
  advance(300);
  ctl.focusIn('info');
  const one = ctl.current();
  ctl.show('tip');
  const two = ctl.current();
  ctl.hide('info'); // 이미 닫힌 [ⓘ] 를 닫아도 열린 툴팁은 그대로
  check('[128-1] 하나만 — 툴팁 ↔ [ⓘ] 서로 닫힘(한 판단의 현재 하나) · 다른 대상 hide 는 영향 없음', one === 'info' && two === 'tip' && ctl.current() === 'tip');
}
{
  const { ctl } = make();
  let n = 0;
  const off = ctl.subscribe(() => n++);
  ctl.show('a');
  ctl.show('a');
  ctl.hide('a');
  off();
  ctl.show('b');
  check('[128-1] 바뀔 때만 알림(같은 대상 다시 열기는 알림 없음 · 구독 해제 뒤 알림 없음)', n === 2);
}

// ── [128-2] 자리 ──
const VP = { w: 1280, h: 1080 };
{
  const p = placeTip({ left: 600, top: 100, right: 628, bottom: 128 }, { w: 80, h: 30 }, VP);
  check('[128-2] 대상 바로 아래 4px · 가로는 대상 가운데', p.side === 'below' && p.top === 132 && p.left === 574, JSON.stringify(p));
}
{
  const p = placeTip({ left: 600, top: 1040, right: 628, bottom: 1068 }, { w: 80, h: 30 }, VP);
  check('[128-2] 아래 자리가 모자라면 위로(대상 위 4px)', p.side === 'above' && p.top === 1040 - 4 - 30, JSON.stringify(p));
}
{
  const p = placeTip({ left: 600, top: 10, right: 628, bottom: 1070 }, { w: 80, h: 30 }, VP);
  check('[128-2] 아래도 위도 모자라면 아래 그대로', p.side === 'below', JSON.stringify(p));
}
{
  const r = placeTip({ left: 1250, top: 100, right: 1278, bottom: 128 }, { w: 300, h: 30 }, VP);
  const l = placeTip({ left: 2, top: 100, right: 30, bottom: 128 }, { w: 300, h: 30 }, VP);
  check('[128-2] 화면 오른쪽 · 왼쪽 끝에서 8px 안쪽', r.left === 1280 - 8 - 300 && l.left === 8, `${r.left} · ${l.left}`);
}
{
  const p = placeTip({ left: 600, top: 1000, right: 628, bottom: 1028 }, { w: 80, h: 48 }, VP);
  check('[128-2] 아래 화면 끝 8px 안쪽 계산(1028 + 4 + 48 = 1080 > 1072 → 위로)', p.side === 'above', JSON.stringify(p));
}
// ── [131-2] 옆 자리(data-tip-side="right") ──
{
  const p = placeTip({ left: 600, top: 100, right: 624, bottom: 124 }, { w: 80, h: 30 }, VP, 'right');
  check('[131-2] 옆 — 대상 오른쪽 4px · 세로 가운데', p.side === 'right' && p.left === 628 && p.top === 97, JSON.stringify(p));
}
{
  const p = placeTip({ left: 1200, top: 100, right: 1224, bottom: 124 }, { w: 80, h: 30 }, VP, 'right');
  check('[131-2] 옆 — 오른쪽 자리가 모자라면 왼쪽(대상 왼쪽 4px · 1228 + 80 > 1272)', p.side === 'left' && p.left === 1200 - 4 - 80 && p.top === 97, JSON.stringify(p));
}
{
  const exact = placeTip({ left: 600, top: 100, right: 1188, bottom: 124 }, { w: 80, h: 30 }, VP, 'right');
  check('[131-2] 옆 — 화면 오른쪽 끝 8px 안쪽 계산(1188 + 4 + 80 = 1272 → 오른쪽 그대로)', exact.side === 'right' && exact.left === 1192, JSON.stringify(exact));
}
{
  const top = placeTip({ left: 600, top: 0, right: 624, bottom: 10 }, { w: 80, h: 30 }, VP, 'right');
  const bottom = placeTip({ left: 600, top: 1070, right: 624, bottom: 1078 }, { w: 80, h: 30 }, VP, 'right');
  check('[131-2] 옆 — 세로는 화면 위 · 아래 끝에서 8px 안쪽', top.top === 8 && bottom.top === 1080 - 8 - 30, `${top.top} · ${bottom.top}`);
}
{
  const p = placeTip({ left: 40, top: 100, right: 60, bottom: 124 }, { w: 80, h: 30 }, { w: 100, h: 1080 }, 'right');
  check('[131-2] 옆 — 양옆 다 모자라면 기본(아래 4px · 가로 가운데)', p.side === 'below' && p.top === 128, JSON.stringify(p));
}
{
  const a = placeTip({ left: 600, top: 100, right: 628, bottom: 128 }, { w: 80, h: 30 }, VP);
  const b = placeTip({ left: 600, top: 100, right: 628, bottom: 128 }, { w: 80, h: 30 }, VP, undefined);
  check('[131-2] 표시 없음 = 기본 아래 / 위 그대로(128-2 와 같은 값)', JSON.stringify(a) === JSON.stringify(b) && a.side === 'below' && a.top === 132 && a.left === 574, JSON.stringify(a));
}
{
  const host = code('src/components/ui/Tooltip.tsx');
  check('[131-2] 툴팁 담당이 요소의 data-tip-side="right" 를 읽어 placeTip 에 넘김', /getAttribute\('data-tip-side'\) === 'right'/.test(host) && /placeTip\([^;]*, side\)/.test(host));
  // 표 안 줄마다 있는 작은 아이콘 버튼(아래로 뜨면 다음 줄을 가림) — 옆으로 단 곳
  const sites: [string, RegExp][] = [
    ['src/components/ranking/RankingView.tsx', /data-tip-side="right"/],
    ['src/components/swing/BuyJudgeTable.tsx', /<ListRemoveButton [^\n]*tipSide="right"/],
    ['src/components/asset/AssetAccountTable.tsx', /<ListRemoveButton [^\n]*label="목록에서 삭제" tipSide="right"/],
    ['src/components/common/SymbolTable.tsx', /<ListRemoveButton [^\n]*tipSide="right"/],
    ['src/components/paper-trading/AccountsOverview.tsx', /label="위로" data-tip-side="right"[\s\S]*label="아래로" data-tip-side="right"/],
    ['src/components/surge/SurgeDashboard.tsx', /label="이 회차 삭제"[\s\S]{0,400}data-tip-side="right"/],
    ['src/components/ui/ListRemoveButton.tsx', /data-tip-side=\{tipSide\}/],
  ];
  const miss = sites.filter(([f, re]) => !re.test(code(f))).map(([f]) => f);
  check(`[131-2] 옆 툴팁을 단 곳 ${sites.length - 1}파일(실시간 순위 별 · 매수 판단 · 종목 표 · 자산 계좌 표 · 계좌 ↑↓ · 급등 회차 삭제) + ListRemoveButton 선택 옵션`, miss.length === 0, miss.join(', '));
}
check('[128-2] 최대 폭 = 320 · 화면 − 16 가운데 작은 것', tipMaxWidth(1280) === 320 && tipMaxWidth(300) === 284 && tipMaxWidth(10) === 0);
check(
  '[128-2] 상자 모양 — 떠 있는 바탕 · 1px 테두리 · 둥글기 8px · 그림자 · 14px · 줄 높이 1.625 · 가로 10 · 세로 6 · 줄바꿈 지킴 · 글 길이만큼',
  ['bg-bg-elevated', 'border', 'border-border', 'rounded-lg', 'shadow-lg', 'text-xs', 'leading-relaxed', 'px-2.5', 'py-1.5', 'whitespace-pre-line', 'w-max', 'fixed'].every((c) => TOOLTIP_BOX.split(' ').includes(c)),
  TOOLTIP_BOX,
);

// ── [128-4] [ⓘ] = 같은 판단 · 같은 상자 · 옛 여닫기 · 자리 코드 0 ──
{
  const info = code('src/components/ui/InfoTip.tsx');
  const host = code('src/components/ui/Tooltip.tsx');
  const gone = ['getBoundingClientRect', 'createPortal', 'onMouseEnter', 'onMouseLeave', 'onFocus', 'onBlur', "addEventListener('keydown'", "addEventListener('scroll'", 'role="tooltip"', 'innerWidth', 'innerHeight', 'useState'];
  const left = gone.filter((s) => info.includes(s));
  check('[128-4] InfoTip 옛 여닫기 · 자리 · 상자 코드 0(소스)', left.length === 0, left.join(', '));
  check('[128-4] InfoTip = 같은 판단(tipController) · 내용만 넣음(setInfoTipContent) · data-infotip', /tipController\.(show|hide)/.test(info) && /setInfoTipContent\(/.test(info) && /data-infotip/.test(info));
  check('[128-4] 툴팁 담당이 [ⓘ] 도 같은 상자(TOOLTIP_BOX) · 같은 자리(placeTip) · 같은 판단으로 그림', /\[data-infotip\]/.test(host) && /className=\{TOOLTIP_BOX\}/.test(host) && /placeTip\(/.test(host) && /createTipController/.test(host));
  check('[128-4] 툴팁 담당은 앱 뿌리(main.tsx)에 하나', (code('src/main.tsx').match(/<TooltipHost \/>/g) ?? []).length === 1 && !/TooltipHost/.test(code('src/App.tsx')));
  check('[128-1] 터치(마우스 아닌 누름)에는 열지 않음 — pointerType mouse 만 · 누름은 닫기', /e\.pointerType !== 'mouse'\) return/.test(host) && /pointerdown', onDown, true/.test(host));
}

// ── [128-5] 아이콘 버튼 두 크기 ──
{
  const ib = code('src/components/ui/IconButton.tsx');
  check('[128-5] 아이콘 버튼 크기 두 가지만 — md 28px(h-7 w-7) · sm 24px(h-6 w-6)', JSON.stringify(ICON_BUTTON_BOX) === JSON.stringify({ md: 'h-7 w-7', sm: 'h-6 w-6' }));
  check('[128-5] IconButton — 브라우저 title 없음 · data-tip = label · aria-label = label · 아이콘 md 16 · sm 14 · busy 회전', !/\btitle=/.test(ib) && /data-tip=\{label\}/.test(ib) && /aria-label=\{label\}/.test(ib) && /size === 'sm' \? ICON_SM : ICON/.test(ib) && /ICON_BUTTON_BOX\[size\]/.test(ib) && /animate-spin/.test(ib));
}

// ── [128-6] design:lint — 툴팁용 title 하나 더하면 · 정해진 밖 크기면 실패(시험용 가짜 파일 · 끝나면 지운다 · 커밋 안 함) ──
{
  const dir = path.join(root, 'scripts', '.lint-fake-128');
  const bad = path.join(dir, 'bad.tsx');
  const good = path.join(dir, 'good.tsx');
  const lint = (file: string) => spawnSync(process.execPath, [path.join(root, 'node_modules/tsx/dist/cli.mjs'), 'scripts/designLint.ts'], { cwd: root, env: { ...process.env, DESIGN_LINT_EXTRA: file }, encoding: 'utf8' });
  try {
    fs.mkdirSync(dir, { recursive: true });
    const head = "import { X } from 'lucide-react';\nimport { IconButton } from '../../src/components/ui';\n";
    fs.writeFileSync(bad, `${head}export function Bad() {\n  return (\n    <div>\n      <span title="가짜 툴팁">a</span>\n      <IconButton icon={X} label="x" size={'lg' as 'md'} />\n      <IconButton icon={X} label="y" className="h-9 w-9" />\n    </div>\n  );\n}\n`);
    fs.writeFileSync(good, `${head}export function Good() {\n  return (\n    <div>\n      <span data-tip="앱 툴팁">a</span>\n      <IconButton icon={X} label="x" size="sm" />\n      <IconButton icon={X} label="y" className="ml-auto" />\n    </div>\n  );\n}\n`);
    const b = lint(bad);
    const g = lint(good);
    const out = b.stdout ?? '';
    check('[128-6] [129-2] design:lint — 툴팁용 title 하나 넣으면 실패(기준 목록 없음 — 하나라도 있으면)', b.status === 1 && /bad\.tsx:6 {2}\[툴팁용 title\]/.test(out), out.slice(-600));
    check('[128-6] design:lint — IconButton 정해진 밖 크기(size) · className 높이 · 폭이면 실패', /bad\.tsx:7 {2}\[아이콘 버튼 크기\]/.test(out) && /bad\.tsx:8 {2}\[아이콘 버튼 크기\]/.test(out), out.slice(-600));
    check('[128-6] design:lint — data-tip · 두 크기만 쓴 파일은 통과(지금 코드도 통과)', g.status === 0, (g.stdout ?? '').slice(-400));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  check('[128-6] 시험용 가짜 파일 지움', !fs.existsSync(dir));
}

// ── [128-7] [129-1] 목록 문서(128차 목록 · 129차에 91곳을 바꿈) — 남은 title= = 문서 「바꾸지 않음」 줄 · 바꾼 91곳 · 아이콘 + 글자 버튼 전부 ──
{
  const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: root, encoding: 'utf8' }).trim();
  const doc = path.resolve(common, '../../../docs/analysis/2026-11-10_툴팁_아이콘_목록.md');
  if (!fs.existsSync(doc)) console.log(`건너뜀  [128-7] [129-1] 목록 문서 없음(관리 루트 docs/analysis — ${doc})`);
  else {
    const md = fs.readFileSync(doc, 'utf8');
    const section = (n: number) => (md.split(/^## /m).find((s) => s.startsWith(`${n}.`)) ?? '').split('\n').filter((l) => /^\| [^|]+ \| `src\//.test(l)); // 줄 = 「| 화면 | `파일` | …」
    const cells = (l: string) => l.split(' | ').map((c) => c.replace(/^\| /, '').replace(/ \|$/, '').trim());
    const rows = section(1).map(cells).map((c) => ({ file: c[1].replace(/`/g, ''), line: Number(c[2]), tag: c[3].replace(/`/g, ''), kind: c[4], to: c[5], value: c[6].replace(/\\\|/g, '|') }));
    const keep = rows.filter((r) => r.to === '바꾸지 않음');
    const moved = rows.filter((r) => r.to.startsWith('`data-tip'));
    const program = appProgram();
    const attrs = titleAttrs(program, screenFiles());
    let grepCount = 0;
    const walk = (d: string) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (/\.tsx?$/.test(e.name)) grepCount += fs.readFileSync(p, 'utf8').split('\n').filter((l) => l.includes('title=')).length;
      }
    };
    walk(path.join(root, 'src'));
    const native = attrs.filter((a) => a.native);
    check(`[129-1] 앱 화면 코드에 툴팁용 title= 0곳(형 정보 · ${attrs.length}곳 중)`, native.length === 0, native.map((a) => `${a.file}:${a.line}`).join(', '));
    // 툴팁 아닌 부품 속성 95곳 그대로 — 파일 · 요소 · 값이 문서 「바꾸지 않음」 줄과 같다(줄 번호는 위에 한 줄 더한 곳이 있어 보지 않는다)
    const key = (f: string, t: string, v: string) => `${f}|${t}|${v.replace(/\s+/g, ' ').slice(0, 60)}`;
    const want = keep.map((r) => key(r.file, r.tag, r.value.replace(/…$/, ''))).sort();
    const have = attrs.map((a) => key(a.file, a.tag, a.value)).sort();
    const sameKeep = want.length === have.length && want.every((w, i) => have[i].startsWith(w.slice(0, w.length)));
    check(`[128-7] [129-1] 남은 title= ${grepCount}곳 = 툴팁 아닌 부품 속성 ${attrs.length}곳 = 문서 「바꾸지 않음」 ${keep.length}줄(95 · 파일 · 요소 · 값 같음)`, grepCount === attrs.length && keep.length === 95 && attrs.length === 95 && sameKeep, `${grepCount} · ${attrs.length} · ${keep.length} · 다른 첫 줄 ${want.find((w, i) => !have[i]?.startsWith(w)) ?? ''}`);
    // 바꾼 91곳 — 파일 안에 문서가 정한 속성(data-tip · data-tip-clip)과 그 값이 있다.
    // 줄 번호로 찾지 않는다(130차 — 줄이 밀리면 시험이 틀린 곳을 본다). 값으로 찾는다(공백 무시 · 문서의 「…」 앞까지).
    // 130차: 「아이콘 버튼」 줄은 공용 IconButton 으로 바뀌면 그 값이 `label` 로 간다(IconButton 이 data-tip = label).
    const squash = (t: string) => t.replace(/\s+/g, '');
    const valueOf = (r: (typeof rows)[number]) => squash(r.value.replace(/…$/, '')).slice(0, 40);
    const attrHas = (text: string, attr: string, v: string) => text.includes(`${attr}={${v}`) || text.includes(`${attr}="${v}`);
    // 값이 그대로 없으면(129차에 공용 함수로 옮긴 값 — 예: 시세 칸 글 `quoteText`) 그 파일의 그 속성 개수가 문서 줄 수 이상인지 본다
    const missing: string[] = [];
    const texts = new Map<string, string>();
    const attrOf = (r: (typeof rows)[number]) => (r.to.startsWith('`data-tip-clip') ? 'data-tip-clip' : 'data-tip');
    const countAttr = (text: string, attr: string) => text.split(`${attr}=`).length - 1;
    const byValue = new Map<(typeof rows)[number], 'attr' | 'label' | null>();
    for (const r of moved) {
      const text = texts.get(r.file) ?? squash(fs.readFileSync(path.join(root, r.file), 'utf8'));
      texts.set(r.file, text);
      const v = valueOf(r);
      byValue.set(r, attrHas(text, attrOf(r), v) ? 'attr' : r.kind === '아이콘 버튼' && attrHas(text, 'label', v) ? 'label' : null);
    }
    // 값으로 못 찾은 줄 수 ≤ 그 파일의 그 속성 개수 − 값으로 찾은 줄 수(같은 속성)
    for (const r of moved.filter((m) => byValue.get(m) == null)) {
      const attr = attrOf(r);
      const same = moved.filter((m) => m.file === r.file && attrOf(m) === attr);
      const left = countAttr(texts.get(r.file)!, attr) - same.filter((m) => byValue.get(m) === 'attr').length;
      if (left < same.filter((m) => byValue.get(m) == null).length) missing.push(`${r.file}:${r.line}(${valueOf(r).slice(0, 16)})`);
    }
    const kinds = { 설명: moved.filter((r) => r.kind === '설명').length, 긴이름: moved.filter((r) => r.kind === '긴 이름 전체 보기').length, 아이콘: moved.filter((r) => r.kind === '아이콘 버튼').length };
    check(`[129-1] 바꾼 ${moved.length}곳(설명 ${kinds.설명} · 긴 이름 ${kinds.긴이름} → data-tip-clip · 아이콘 버튼 ${kinds.아이콘}) 모두 파일에 문서가 정한 속성 · 값(줄 번호 아닌 값으로 찾음)`, moved.length === 91 && kinds.설명 === 51 && kinds.긴이름 === 15 && kinds.아이콘 === 25 && missing.length === 0, missing.join(', '));
    // 글자 없는 아이콘 버튼 25곳 — 화면 읽기 이름이 있다(공용 IconButton = label 필수 · 맨 button 은 aria-label 또는 안에 보이는 글자)
    const noName: string[] = [];
    const withText: string[] = [];
    const iconButtons: string[] = [];
    // 보이는 글자 — 글자 노드 · 값 식({p.quantity} 등) · 이름 부품(StockName). 아이콘 부품 · 그림은 글자가 아니다
    const hasText = (kids: ts.NodeArray<ts.JsxChild>): boolean =>
      kids.some((c) =>
        (ts.isJsxText(c) && c.text.trim() !== '') ||
        (ts.isJsxExpression(c) && !!c.expression && !ts.isJsxElement(c.expression) && !ts.isJsxSelfClosingElement(c.expression) && !/<\w/.test(c.expression.getText())) ||
        (ts.isJsxSelfClosingElement(c) && c.tagName.getText() === 'StockName') ||
        (ts.isJsxElement(c) && hasText(c.children)),
      );
    const attrValue = (a: ts.JsxAttributeLike) => (ts.isJsxAttribute(a) && a.initializer ? squash(a.initializer.getText()).replace(/^\{/, '').replace(/^"/, '') : '');
    type Found = { tag: string; attrs: ts.JsxAttributes; kids: ts.NodeArray<ts.JsxChild> | null };
    for (const r of moved.filter((m) => m.kind === '아이콘 버튼')) {
      const sf = program.getSourceFile(path.join(root, r.file))!;
      const v = valueOf(r);
      let found: Found | null = null;
      const visit = (n: ts.Node) => {
        if (found) return;
        const open = ts.isJsxElement(n) ? n.openingElement : ts.isJsxSelfClosingElement(n) ? n : null;
        if (open && /^(button|IconButton)$/.test(open.tagName.getText())) {
          const hit = open.attributes.properties.some((a) => ts.isJsxAttribute(a) && /^(data-tip|label)$/.test(a.name.getText()) && attrValue(a).startsWith(v));
          if (hit) found = { tag: open.tagName.getText(), attrs: open.attributes, kids: ts.isJsxElement(n) ? n.children : null };
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
      const e = found as Found | null;
      if (!e) {
        noName.push(`${r.file}:${r.line}(버튼 못 찾음)`);
        continue;
      }
      if (e.tag === 'IconButton') {
        iconButtons.push(r.file.replace('src/components/', ''));
        continue;
      }
      if (e.attrs.properties.some((p) => ts.isJsxAttribute(p) && p.name.getText() === 'aria-label')) continue;
      if (e.kids && hasText(e.kids)) withText.push(`${r.file.replace('src/components/', '')}:${r.line}`);
      else noName.push(`${r.file}:${r.line}`);
    }
    check(`[129-1] [130-5] 글자 없는 아이콘 버튼 25곳 모두 이름 있음(IconButton ${iconButtons.length}곳 · 안에 글자가 보이는 ${withText.length}곳은 그 글자가 이름 — ${withText.join(' · ')})`, noName.length === 0, noName.join(', '));
    const buttons = iconTextButtons(screenFiles());
    // 130차 — 문서 2 의 「아이콘만」 줄(조건 보기 2곳)은 공용 IconButton 으로 바뀌어 아이콘 + 글자 버튼에서 빠진다
    const iconOnlyRows = section(2).filter((l) => / \| 아이콘만 \| /.test(l)).length;
    check(`[128-7] [130-5] 목록 문서 2 — 아이콘 + 글자 버튼 ${buttons.length}곳 = 문서 ${section(2).length}줄 − 「아이콘만」 ${iconOnlyRows}줄(바꾸기 전이면 문서 줄 그대로)`, section(2).length - iconOnlyRows === buttons.length || section(2).length === buttons.length, `${buttons.length} · ${section(2).length} · ${iconOnlyRows}`);
  }
}

// ── [129-2] lint 기준 목록 코드 0 ──
{
  const lintSrc = code('scripts/designLint.ts') + code('scripts/lib/tooltipTitles.ts');
  check('[129-2] 기준 목록 파일 · 코드 0(tooltipTitleBaseline.json 없음 · 읽는 코드 없음)', !fs.existsSync(path.join(root, 'scripts/fixtures/tooltipTitleBaseline.json')) && !/Baseline|BASELINE|baseline/.test(lintSrc));
}

// ── [129-3] [129-6] 서버 · 매매 · 주문 · 로그인 코드 · 서버가 함께 쓰는 src(가져오기 끝까지) 바뀐 줄 0 · designCheck 판정 부분 0(129차 v2.69.1 동안만) ──
{
  const head = fs.readFileSync(path.join(root, 'src/data/changelog.ts'), 'utf8').match(/version: '(v[\d.]+)'/)?.[1];
  const BASE = '18a9099';
  if (head !== 'v2.69.0' && head !== 'v2.69.1') console.log(`건너뜀  [129-6] 지금 버전 ${head} — 129차(v2.69.1) 범위 시험`);
  else {
    const END = '72679bb'; // 129차 마지막 커밋(v2.69.1) — 130차 커밋이 더해져도 이 시험은 129차 범위만 본다
    const diff = (...p: string[]) => execFileSync('git', ['diff', '--name-only', `${BASE}..${END}`, '--', ...p], { cwd: root, encoding: 'utf8' }).trim();
    check(`[129-6] git diff ${BASE}..${END} -- server python src/services = 0개`, diff('server', 'python', 'src/services') === '', diff('server', 'python', 'src/services'));
    const shared = serverSharedSrc();
    // 업데이트 내역(changelog.ts)은 서버가 버전 표시에 읽어 54개 안이지만, 문서 4종(지시서 H)으로 맨 앞 항목을 더한다 — 더하기만(지운 줄 0) 따로 본다
    const CHANGELOG = 'src/data/changelog.ts';
    const touched = diff(...shared.closure.filter((f) => f !== CHANGELOG));
    check(`[129-6] 서버가 함께 쓰는 src ${shared.direct.length}개 + 그 가져오기 파일(전체 ${shared.closure.length}개 · 업데이트 내역 밖) 바뀐 줄 0`, shared.direct.length === 54 && touched === '', `${shared.direct.length} · ${touched}`);
    const cl = execFileSync('git', ['diff', '-U0', `${BASE}..${END}`, '--', CHANGELOG], { cwd: root, encoding: 'utf8' }).split('\n');
    check('[129-6] 업데이트 내역(changelog.ts)은 맨 앞 항목 더하기만(지운 · 바꾼 줄 0)', cl.filter((l) => /^-(?!--)/.test(l)).length === 0);
    const ops = diff('deploy', 'db', 'scripts/lib/testServerEnv.ts', 'scripts/lib/requireCopyDb.ts', 'scripts/lib/requireTossKeys.ts', '.env.example');
    check('[129-3] 배포 · DB 정의 · 시험 서버 스위치 · 사본 DB 막기 바뀐 파일 0', ops === '', ops);
    // 바뀐 줄은 장면을 여는 「title 로 찾기」(getByTitle — 이번에 그 title 이 data-tip 으로 옮겨 감)뿐 · 측정 판정 부분 그대로
    const dc = execFileSync('git', ['diff', '-U0', `${BASE}..${END}`, '--', 'scripts/designCheck.ts'], { cwd: root, encoding: 'utf8' }).split('\n');
    const removed = dc.filter((l) => /^-(?!--)/.test(l));
    const added = dc.filter((l) => /^\+(?!\+\+)/.test(l));
    const onlyFind = removed.every((l) => /getByTitle\(/.test(l) && added.includes(`+${l.slice(1).replace(/getByTitle\('([^']+)'\)/g, `locator('[data-tip="$1"]')`)}`));
    check(`[129-6] designCheck.ts — 판정 부분 바뀐 줄 0(지운 ${removed.length}줄은 장면을 여는 getByTitle → [data-tip] 찾기뿐 · 나머지는 장면 더하기)`, onlyFind, removed.slice(0, 3).join(' / '));
  }
}

// ── [131-4] CLAUDE.md(관리 루트 · git 밖) — 새 일하는 법 세 줄 · 크기 기준 줄 · 25,600바이트 안 ──
{
  const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: root, encoding: 'utf8' }).trim();
  const md = path.resolve(common, '../../../CLAUDE.md');
  if (!fs.existsSync(md)) console.log(`건너뜀  [131-4] CLAUDE.md 없음(관리 루트 — ${md})`);
  else {
    const text = fs.readFileSync(md, 'utf8');
    const bytes = fs.statSync(md).size;
    const rules = [/작업 뒤 찾은 화면 문제[^\n]*그 작업 안에서 고치고/, /`npm run check:all` 은 마지막에 한 번/, /캡처 검토는 바뀐 장면만 1440 하나/, /25,600바이트\(25KiB\) 안/];
    const miss = rules.filter((re) => !re.test(text)).map(String);
    check(`[131-4] CLAUDE.md 새 일하는 법 세 줄 · 크기 기준 줄 · ${bytes}바이트 ≤ 25,600`, miss.length === 0 && bytes <= 25_600 && !/900줄을 넘으면/.test(text), miss.join(' · '));
  }
}

// ── [131-5] 서버 · 매매 · 주문 · 로그인 · 서버가 함께 쓰는 src 바뀐 줄 0 · designCheck 판정 부분 0(131차 v2.69.3 동안만) ──
{
  const head = fs.readFileSync(path.join(root, 'src/data/changelog.ts'), 'utf8').match(/version: '(v[\d.]+)'/)?.[1];
  const BASE = '92af0e3';
  if (head !== 'v2.69.2' && head !== 'v2.69.3') console.log(`건너뜀  [131-5] 지금 버전 ${head} — 131차(v2.69.3) 범위 시험`);
  else {
    const diff = (...p: string[]) => execFileSync('git', ['diff', '--name-only', BASE, '--', ...p], { cwd: root, encoding: 'utf8' }).trim();
    check(`[131-5] git diff ${BASE} -- server python src/services = 0개`, diff('server', 'python', 'src/services') === '', diff('server', 'python', 'src/services'));
    const shared = serverSharedSrc();
    const CHANGELOG = 'src/data/changelog.ts';
    const touched = diff(...shared.closure.filter((f) => f !== CHANGELOG));
    check(`[131-5] 서버가 함께 쓰는 src ${shared.direct.length}개 + 그 가져오기 파일(전체 ${shared.closure.length}개 · 업데이트 내역 밖) 바뀐 줄 0`, shared.direct.length === 54 && touched === '', `${shared.direct.length} · ${touched}`);
    const cl = execFileSync('git', ['diff', '-U0', BASE, '--', CHANGELOG], { cwd: root, encoding: 'utf8' }).split('\n');
    check('[131-5] 업데이트 내역(changelog.ts)은 맨 앞 항목 더하기만(지운 · 바꾼 줄 0)', cl.filter((l) => /^-(?!--)/.test(l)).length === 0);
    const dc = execFileSync('git', ['diff', '-U0', BASE, '--', 'scripts/designCheck.ts'], { cwd: root, encoding: 'utf8' }).split('\n');
    const removed = dc.filter((l) => /^-(?!--)/.test(l));
    check(`[131-5] designCheck.ts — 지운 · 바꾼 줄 0(판정 부분 그대로 · 장면 더하기만)`, removed.length === 0, removed.slice(0, 3).join(' / '));
  }
}

console.log(`\n툴팁 시험 — 통과 ${pass} · 실패 ${fail}`);
process.exit(fail ? 1 : 0);
