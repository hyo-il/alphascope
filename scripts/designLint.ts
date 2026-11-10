/**
 * 디자인 규칙 검사 (`npm run design:lint`) — 디자인 점검 세 겹의 첫째(docs/rules/design.md 「디자인 점검 세 겹」).
 * 컴포넌트에서 아래가 **0개**인지 본다. 예외는 그 줄 바로 위(또는 같은 줄)에 `design-lint-ignore: <이유>` 주석을 단다.
 *   1. px 숫자로 적은 글자 크기(`text-[NNpx]`) — 글자 크기는 `index.css` @theme 4단계(text-base·sm·xs·caption)만
 *   2. 직접 적은 색 — Tailwind 기본 팔레트(`text-blue-500` 등)·className 안의 `#hex`
 *   3. 공용 부품을 쓰지 않은 `<input>`(체크박스·라디오·range·hidden·file 제외)·`<select>` — `ui/Input`·`ui/Select`·`ui/NumberField`
 *   4. 화면 루트를 가운데로 좁히는 `mx-auto max-w-*` — 모든 화면은 폭을 꽉 채운다
 *   5. lg·2xl 글자(`text-lg`·`text-2xl`) — 기준표에 없는 크기
 *   6. 툴팁용 `title=`(브라우저 기본 툴팁) — 앱 툴팁 `data-tip`(설명) · `data-tip-clip`(잘렸을 때만)을 쓴다. **하나라도 있으면 실패.**
 *      툴팁인지는 형 정보로 가린다(`scripts/lib/tooltipTitles.ts` — 우리 부품의 `title` 속성 · `iframe` 은 툴팁이 아님).
 *   7. `IconButton` 의 정해진 두 크기 밖(`size` 가 md · sm 아님 · `className` 에 높이 · 폭)
 * 끝나면 어긴 곳 수를 출력하고, 하나라도 있으면 exit 1.
 * 시험용: `DESIGN_LINT_EXTRA=<파일,…>` 를 주면 그 파일도 검사한다(`tooltip:test` 의 가짜 파일 — 커밋하지 않는다).
 */
import fs from 'node:fs';
import path from 'node:path';
import { appProgram, iconButtonSizeHits, titleAttrs } from './lib/tooltipTitles';

const ROOT = path.resolve(import.meta.dirname, '..');
const FILES: string[] = [];
const walk = (dir: string) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.tsx$/.test(e.name)) FILES.push(p);
  }
};
walk(path.join(ROOT, 'src/components'));
FILES.push(path.join(ROOT, 'src/App.tsx'));
const EXTRA = (process.env.DESIGN_LINT_EXTRA ?? '').split(',').map((f) => f.trim()).filter(Boolean).map((f) => path.resolve(f));
FILES.push(...EXTRA);

const PALETTE = /\b(?:text|bg|border|ring|from|to|via|fill|stroke|outline|decoration|divide)-(?:red|blue|green|yellow|gray|slate|zinc|neutral|stone|orange|amber|lime|emerald|teal|cyan|sky|indigo|violet|purple|fuchsia|pink|rose)-\d{2,3}\b/;
const RULES: { id: string; test: (line: string, file: string) => boolean; why: string }[] = [
  { id: 'px-글자', test: (l) => /\btext-\[\d+(?:\.\d+)?px\]/.test(l), why: 'text-[NNpx] — 기준표의 text-base·sm·xs·caption 을 쓴다' },
  { id: '기본 팔레트 색', test: (l) => PALETTE.test(l), why: 'Tailwind 기본 팔레트 — 앱 색 토큰(text-primary·danger…)을 쓴다' },
  { id: 'className #hex', test: (l) => /className=.*#[0-9a-fA-F]{3,8}\b/.test(l), why: 'className 안 #hex — 토큰을 쓴다' },
  {
    id: '맨 input',
    test: (l, f) => !f.includes('/ui/') && /<input\b/.test(l) && !/type="(checkbox|radio|range|hidden|file)"/.test(l),
    why: '<input> — ui/Input · ui/NumberField 를 쓴다(체크박스·라디오 제외). 여러 줄 태그면 type 이 다음 줄에 있을 수 있다 — 그때는 아래 검사가 다시 본다',
  },
  { id: '맨 select', test: (l, f) => !f.includes('/ui/') && /<select\b/.test(l), why: '<select> — ui/Select 를 쓴다' },
  { id: '가운데 좁힘', test: (l) => /\bmx-auto\b/.test(l) && /\bmax-w-/.test(l), why: 'mx-auto max-w-* — 화면은 폭을 꽉 채운다(읽기 폭 상한이 필요한 작은 상자는 예외 주석)' },
  { id: '기준표 밖 크기', test: (l) => /\btext-(?:lg|2xl|3xl)\b/.test(l), why: 'text-lg·2xl — 기준표 4단계(+로그인 앱 제목 text-xl)만' },
];

const hits: { file: string; line: number; id: string; text: string; why: string }[] = [];
for (const file of FILES) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (/^\s*(\*|\/\/|\/\*)/.test(line)) return; // 주석 줄
    const ignored = /design-lint-ignore/.test(line) || /design-lint-ignore/.test(lines[i - 1] ?? '');
    for (const r of RULES) {
      if (!r.test(line, file)) continue;
      // 여러 줄 <input — 다음 6줄 안에 체크박스류 type 이 있으면 통과
      if (r.id === '맨 input' && lines.slice(i, i + 7).join(' ').match(/type="(checkbox|radio|range|hidden|file)"/)) continue;
      if (ignored) continue;
      hits.push({ file: path.relative(ROOT, file), line: i + 1, id: r.id, text: line.trim().slice(0, 140), why: r.why });
    }
  });
}

// 6 · 7 — 형 정보가 필요한 규칙(앱 tsconfig 프로그램 하나)
{
  const program = appProgram(EXTRA);
  const scan = [...FILES, path.join(ROOT, 'src/main.tsx')];
  for (const a of titleAttrs(program, scan)) {
    if (!a.native || /design-lint-ignore/.test(a.text)) continue;
    hits.push({ file: a.file, line: a.line, id: '툴팁용 title', text: a.text, why: '브라우저 기본 툴팁 — data-tip(설명) · data-tip-clip(잘렸을 때만)을 쓴다' });
  }
  for (const h of iconButtonSizeHits(scan, program)) hits.push({ file: h.file, line: h.line, id: '아이콘 버튼 크기', text: h.text, why: h.why });
}

const by = new Map<string, number>();
for (const h of hits) by.set(h.id, (by.get(h.id) ?? 0) + 1);
for (const h of hits) console.log(`${h.file}:${h.line}  [${h.id}]  ${h.text}`);
console.log(`\n디자인 규칙 검사 — 어긴 곳 ${hits.length}개${hits.length ? ` (${[...by].map(([k, v]) => `${k} ${v}`).join(' · ')})` : ''}`);
process.exit(hits.length ? 1 : 0);
