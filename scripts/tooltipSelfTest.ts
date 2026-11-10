/**
 * 앱 툴팁 시험(128차 · v2.69.0) — `npm run tooltip:test` · ⚠️ `DB_PATH=<사본>` 으로만 돈다(맨 첫 import · DB 는 쓰지 않는다).
 *
 * 128차 지시서 「꼭 지킬 동작」(시험 이름 앞의 [128-n]) 가운데 DOM 없이 보는 것:
 *   1 여닫기(순수 `ui/tooltip/hover` · 가짜 시계) · 2 자리(순수 `ui/tooltip/place`) · 4 [ⓘ] 옛 여닫기 · 자리 코드 0(소스) ·
 *   5 아이콘 버튼 두 크기(소스) · 6 `design:lint` 규칙(시험용 가짜 파일 — 끝나면 지운다) · 7 목록 문서 줄 수 · 8 서버 · 매매 코드 바뀐 파일 0.
 * 화면(Playwright)은 `tooltipui:test`.
 */
import './lib/requireCopyDb'; // ⚠️ 맨 첫 import — 사본 DB 가 아니면 여기서 멈춘다
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
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
    check('[128-6] design:lint — 툴팁용 title 하나 더하면 실패(기준 목록 밖)', b.status === 1 && /bad\.tsx:6 {2}\[툴팁용 title\]/.test(out), out.slice(-600));
    check('[128-6] design:lint — IconButton 정해진 밖 크기(size) · className 높이 · 폭이면 실패', /bad\.tsx:7 {2}\[아이콘 버튼 크기\]/.test(out) && /bad\.tsx:8 {2}\[아이콘 버튼 크기\]/.test(out), out.slice(-600));
    check('[128-6] design:lint — data-tip · 두 크기만 쓴 파일은 통과(지금 코드도 통과)', g.status === 0, (g.stdout ?? '').slice(-400));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  check('[128-6] 시험용 가짜 파일 지움', !fs.existsSync(dir));
}

// ── [128-7] 목록 문서 — title= 남은 개수 = 문서 줄 수 · 아이콘 + 글자 버튼 전부 ──
{
  const common = execFileSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { cwd: root, encoding: 'utf8' }).trim();
  const doc = path.resolve(common, '../../../docs/analysis/2026-11-10_툴팁_아이콘_목록.md');
  if (!fs.existsSync(doc)) console.log(`건너뜀  [128-7] 목록 문서 없음(관리 루트 docs/analysis — ${doc})`);
  else {
    const md = fs.readFileSync(doc, 'utf8');
    const section = (n: number) => (md.split(/^## /m).find((s) => s.startsWith(`${n}.`)) ?? '').split('\n').filter((l) => /^\| [^|]+ \| `src\//.test(l)); // 줄 = 「| 화면 | `파일` | …」
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
    const buttons = iconTextButtons(screenFiles());
    check(`[128-7] 목록 문서 1 — title= 남은 ${grepCount}곳 = 문서 ${section(1).length}줄(형 분류 ${attrs.length}곳)`, grepCount === attrs.length && section(1).length === grepCount, `${grepCount} · ${attrs.length} · ${section(1).length}`);
    check(`[128-7] 목록 문서 2 — 아이콘 + 글자 버튼 ${buttons.length}곳 = 문서 ${section(2).length}줄`, section(2).length === buttons.length, `${buttons.length} · ${section(2).length}`);
  }
}

// ── [128-8] 서버 · 매매 · 주문 · 로그인 코드 바뀐 파일 0 · designCheck 판정 부분 0(이번 차수 v2.69.0 동안만) ──
{
  const head = fs.readFileSync(path.join(root, 'src/data/changelog.ts'), 'utf8').match(/version: '(v[\d.]+)'/)?.[1];
  if (head !== 'v2.69.0') console.log(`건너뜀  [128-8] 지금 버전 ${head} — 128차(v2.69.0) 범위 시험`);
  else {
    const changed = execFileSync('git', ['diff', '--name-only', '42adc73..HEAD', '--', 'server', 'python', 'src/services'], { cwd: root, encoding: 'utf8' }).trim();
    check('[128-8] git diff 42adc73..HEAD -- server python src/services = 0개', changed === '', changed);
    const dc = execFileSync('git', ['diff', '-U0', '42adc73..HEAD', '--', 'scripts/designCheck.ts'], { cwd: root, encoding: 'utf8' });
    const removed = dc.split('\n').filter((l) => /^-(?!--)/.test(l));
    check('[128-8] designCheck.ts — 지운 · 바꾼 줄 0(장면 더하기만 · 판정 부분 그대로)', removed.length === 0, removed.slice(0, 3).join(' / '));
  }
}

console.log(`\n툴팁 시험 — 통과 ${pass} · 실패 ${fail}`);
process.exit(fail ? 1 : 0);
