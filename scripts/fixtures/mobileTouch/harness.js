/**
 * `mobiletouch:test`(147차) 시험 틀 — 시험이 띄운 Vite 화면 안에서 `import()` 로 불러 공용 창(`ui/Dialog`)을 바로 띄운다.
 * 앱과 같은 모듈(같은 `store/leaveGuard` · 확인 창)을 쓰므로 「저장하지 않고 닫을까요?」 도 앱 그대로 뜬다. 앱 코드는 이 파일을 쓰지 않는다.
 * (.js 인 까닭: `scripts/` 는 서버 타입 검사(tsconfig.node.json — DOM · JSX 없음)에 들어간다)
 */
import { createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import Dialog, { DialogCancel } from '/src/components/ui/Dialog.tsx';
import Button from '/src/components/ui/Button.tsx';
import IconButton from '/src/components/ui/IconButton.tsx';
import Segmented from '/src/components/ui/Segmented.tsx';
import Tabs from '/src/components/ui/Tabs.tsx';
import Checkbox from '/src/components/ui/Checkbox.tsx';
import Input from '/src/components/ui/Input.tsx';
import NumberField from '/src/components/ui/NumberField.tsx';
import Select from '/src/components/ui/Select.tsx';
import InfoTip from '/src/components/ui/InfoTip.tsx';
import { LIST_ROW, LIST_TABLE_ROW } from '/src/components/ui/tokens.ts';
import { Pencil, Trash2 } from 'lucide-react';

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

/** 공용 부품 한 벌(손가락 크기 · 툴팁 시험) — 본문 위에 고정 상자로 띄운다(`data-testid="parts"`) */
export function mountParts() {
  unmount();
  host = document.createElement('div');
  document.getElementById('root').append(host);
  root = createRoot(host);
  const t = (id) => ({ 'data-testid': id });
  root.render(
    h(
      'div',
      { ...t('parts'), className: 'fixed left-4 top-24 z-[95] flex w-[340px] flex-col items-start gap-6 bg-bg-secondary p-4' },
      h('div', { className: 'flex items-center gap-6' },
        h(Button, { size: 'sm', ...t('btn-sm'), onClick: () => state.saved++, 'data-tip': '단추 설명' }, '저장'),
        h(Button, { ...t('btn-md') }, '실행'),
        h(InfoTip, { label: '설명' }, '정보 설명 글'),
        h('span', { ...t('plain-tip'), 'data-tip': '맨 글 설명', className: 'text-xs' }, '맨 글'),
      ),
      h('div', { className: 'flex items-center' },
        h(IconButton, { icon: Pencil, label: '고치기', ...t('icon-a'), onClick: () => state.saved++ }),
        h(IconButton, { icon: Trash2, label: '지우기', ...t('icon-b') }),
        h(IconButton, { icon: Pencil, label: '표 고치기', size: 'sm', ...t('icon-sm'), className: 'ml-6' }),
      ),
      h(Segmented, { label: '시장', value: 'us', onChange: () => {}, options: [{ value: 'us', label: '미국' }, { value: 'kr', label: '국내' }] }),
      h(Tabs, { label: '탭', value: 'a', onChange: () => {}, items: [{ id: 'a', label: '첫 탭' }, { id: 'b', label: '둘째' }] }),
      h('label', { className: 'flex items-center gap-2 text-xs' }, h(Checkbox, { ...t('check') }), '체크'),
      h(Input, { ...t('input'), placeholder: '입력', className: 'w-40' }),
      h(NumberField, { ...t('number'), value: 1, onChange: () => {} }),
      h(Select, { ...t('select'), defaultValue: 'a' }, h('option', { value: 'a' }, '하나'), h('option', { value: 'b' }, '둘')),
      h('div', { ...t('list-row'), className: `${LIST_ROW} w-40 rounded-md bg-bg-tertiary` }),
      h('table', null, h('tbody', null, h('tr', { ...t('table-row'), className: LIST_TABLE_ROW }, h('td', null, '표 줄')))),
    ),
  );
}
