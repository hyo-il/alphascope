/**
 * `mobiletouch:test`(147차) 시험 틀 — 시험이 띄운 Vite 화면 안에서 `import()` 로 불러 공용 창(`ui/Dialog`)을 바로 띄운다.
 * 앱과 같은 모듈(같은 `store/leaveGuard` · 확인 창)을 쓰므로 「저장하지 않고 닫을까요?」 도 앱 그대로 뜬다. 앱 코드는 이 파일을 쓰지 않는다.
 * (.js 인 까닭: `scripts/` 는 서버 타입 검사(tsconfig.node.json — DOM · JSX 없음)에 들어간다)
 */
import { createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import Dialog, { DialogCancel } from '/src/components/ui/Dialog.tsx';
import Button from '/src/components/ui/Button.tsx';

let root = null;
let host = null;
const state = { open: false, closed: 0, saved: 0 };
window.__harness = state;

export function mountDialog(o = {}) {
  unmount();
  host = document.createElement('div');
  document.getElementById('root').append(host);
  root = createRoot(host);
  state.open = true;
  const close = () => {
    state.closed++;
    state.open = false;
    root?.render(null);
  };
  const lines = Array.from({ length: o.long ? 60 : 2 }, (_, i) => h('p', { key: i, className: 'py-2 text-xs text-text-secondary' }, `시험 줄 ${i + 1}`));
  root.render(
    h(
      Dialog,
      {
        title: '시험 창',
        onClose: close,
        dirty: o.dirty,
        busy: o.busy,
        closeOnBackdrop: o.closeOnBackdrop,
        size: o.size ?? 'md',
        footer: h('div', { style: { display: 'contents' } }, h(DialogCancel, null), h(Button, { variant: 'primary', onClick: () => state.saved++ }, '저장')),
      },
      h('div', { 'data-testid': 'harness-body' }, lines),
    ),
  );
}

export function unmount() {
  root?.unmount();
  host?.remove();
  root = null;
  host = null;
  state.open = false;
}
