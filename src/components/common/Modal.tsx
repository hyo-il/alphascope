import { useEffect, useState } from 'react';
import { useUiStore, type ModalRow } from '../../store/uiStore';
import Button from '../ui/Button';

const TONE: Record<NonNullable<ModalRow['tone']>, string> = {
  default: 'text-text-primary',
  bullish: 'text-bullish',
  bearish: 'text-bearish',
  muted: 'text-text-muted',
};

/**
 * 앱 공통 확인창 (브라우저 confirm 대체).
 * 앱 루트에 한 번만 두고, 내용은 `modal.confirm(...)` 으로 넣는다.
 */
export default function ModalHost() {
  const request = useUiStore((s) => s.modal);
  const close = useUiStore((s) => s.closeModal);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!request) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        request.onCancel?.();
        close();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [request, close]);

  // 새 확인창이 뜨면 이전 진행 상태를 물려받지 않는다.
  useEffect(() => setBusy(false), [request]);

  if (!request) return null;

  const cancel = () => {
    request.onCancel?.();
    close();
  };

  // 전역 confirm 과 이름이 겹치지 않게 accept 로 둔다.
  const accept = async () => {
    setBusy(true);
    try {
      await request.onConfirm?.();
    } finally {
      close();
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="alphascope-modal-title"
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-6"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) cancel();
      }}
    >
      <div className="w-full max-w-sm rounded-xl bg-bg-secondary shadow-xl">
        <div className="px-4 pt-4">
          <h2
            id="alphascope-modal-title"
            className="text-sm font-semibold text-text-primary"
          >
            {request.title}
          </h2>
        </div>

        <div className="space-y-3 px-4 py-3">
          {request.message && (
            <p className="text-xs leading-relaxed whitespace-pre-line text-text-secondary">
              {request.message}
            </p>
          )}

          {Boolean(request.rows?.length) && (
            <dl className="space-y-1 rounded-md bg-bg-tertiary/50 px-3 py-2.5">
              {request.rows!.map((row) => (
                <div key={row.label} className="flex justify-between text-[13px]">
                  <dt className="text-text-muted">{row.label}</dt>
                  <dd className={`tabular-nums ${TONE[row.tone ?? 'default']}`}>{row.value}</dd>
                </div>
              ))}
            </dl>
          )}
        </div>

        <div className="flex justify-end gap-2 px-4 pb-4">
          {!request.alertOnly && (
            <Button variant="ghost" onClick={cancel} disabled={busy}>
              {request.cancelText ?? '취소'}
            </Button>
          )}
          {/* 확인 버튼 하나만 색을 준다 — 지우기는 빨강, 그 밖은 파랑 (v2.36.0 공용 Button) */}
          <Button variant={request.danger ? 'danger' : 'primary'} onClick={() => void accept()} disabled={busy} autoFocus>
            {busy ? '처리 중…' : (request.confirmText ?? '확인')}
          </Button>
        </div>
      </div>
    </div>
  );
}
