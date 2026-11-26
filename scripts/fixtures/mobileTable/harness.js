/**
 * `mobiletable:test`(148차) 시험 틀 — 시험이 띄운 Vite 화면 안에서 `import()` 로 불러 공용 `ui/ScrollTable` 을 바로 띄운다.
 * 앱과 같은 모듈 · 같은 CSS(index.css). 앱 코드는 이 파일을 쓰지 않는다.
 * (.js 인 까닭: `scripts/` 는 서버 타입 검사(tsconfig.node.json — DOM · JSX 없음)에 들어간다)
 *
 * - `mountTable({ wideFirst, rows, cols, inset, pad })` — 넓은 표(첫 칸 날짜 · 칸 `cols` 개) · `wideFirst` = 첫 칸이 상자 폭 절반을 넘는 표
 *   · `narrow` = 넘치지 않는 표. 줄을 누르면 `window.__tableHarness.clicks` 가 는다.
 */
import { createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import ScrollTable from '/src/components/ui/ScrollTable.tsx';
import { TABLE_NAME_COL } from '/src/components/ui/tokens.ts';

let root = null;
let host = null;
const state = { clicks: 0 };
window.__tableHarness = state;

export function mountTable(o = {}) {
  unmountTable();
  host = document.createElement('div');
  host.className = 'fixed inset-0 z-50 overflow-y-auto bg-bg-primary p-4';
  host.setAttribute('data-testid', 'table-harness');
  document.body.append(host);
  root = createRoot(host);
  const cols = o.narrow ? 2 : (o.cols ?? 8);
  const rows = o.rows ?? 30;
  const first = (i) => (o.wideFirst ? `아주 긴 첫 칸 글자 — 상자 폭의 절반을 넘는 칸 ${i}` : `2026-11-${String((i % 28) + 1).padStart(2, '0')}`);
  const head = h(
    'tr',
    null,
    h('th', { className: 'whitespace-nowrap px-3 py-2 text-left' }, '날짜'),
    h('th', { className: `${TABLE_NAME_COL} px-3 text-left` }, '종목'),
    ...Array.from({ length: cols - 2 }, (_, c) => h('th', { key: c, className: 'whitespace-nowrap px-3 text-right' }, `숫자 칸 ${c + 1}`)),
  );
  const body = Array.from({ length: rows }, (_, i) =>
    h(
      'tr',
      { key: i, 'data-row': i, onClick: () => state.clicks++, className: 'h-11 cursor-pointer border-b border-border/30' },
      h('td', { className: 'whitespace-nowrap px-3' }, first(i)),
      h('td', { className: 'max-w-0 truncate px-3' }, `시험 종목 이름 ${i}`),
      ...Array.from({ length: cols - 2 }, (_, c) => h('td', { key: c, className: 'whitespace-nowrap px-3 text-right tabular-nums' }, `${(1234567 + i * 31 + c).toLocaleString()}`)),
    ),
  );
  root.render(
    h(
      'div',
      { className: 'rounded-xl bg-bg-secondary p-3' },
      h(
        ScrollTable,
        { 'data-testid': 'harness-table', className: o.pad ? 'px-4' : undefined },
        h('table', { className: o.narrow ? 'w-full text-xs' : 'w-full min-w-[900px] text-xs' }, h('thead', null, head), h('tbody', null, body)),
      ),
    ),
  );
}

export function unmountTable() {
  root?.unmount();
  host?.remove();
  root = null;
  host = null;
  state.clicks = 0;
}
