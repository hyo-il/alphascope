import { useEffect } from 'react';
import { useUiStore, type ToastItem, type ToastType } from '../../store/uiStore';

/** 자동으로 사라지기까지의 시간 */
const AUTO_DISMISS_MS = 3000;

const STYLE: Record<ToastType, { border: string; text: string; icon: string }> = {
  success: { border: 'border-bullish/50', text: 'text-bullish', icon: '✅' },
  error: { border: 'border-bearish/50', text: 'text-bearish', icon: '❌' },
  warning: { border: 'border-warning/50', text: 'text-warning', icon: '⚠️' },
  info: { border: 'border-accent/50', text: 'text-accent', icon: 'ℹ️' },
};

function Toast({ item }: { item: ToastItem }) {
  const dismiss = useUiStore((s) => s.dismissToast);
  const style = STYLE[item.type];

  useEffect(() => {
    const timer = setTimeout(() => dismiss(item.id), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [item.id, dismiss]);

  return (
    <div
      role="status"
      className={`pointer-events-auto flex min-w-[240px] max-w-sm items-start gap-2 rounded-lg border ${style.border} bg-bg-secondary px-3 py-2.5 shadow-xl`}
    >
      <span className="text-sm leading-none">{style.icon}</span>
      <div className="min-w-0 flex-1">
        <p className={`text-xs font-medium ${style.text}`}>{item.message}</p>
        {item.detail && (
          <p className="mt-0.5 text-[11px] leading-relaxed text-text-secondary">{item.detail}</p>
        )}
      </div>
      <button
        type="button"
        onClick={() => dismiss(item.id)}
        aria-label="닫기"
        className="text-text-muted transition-colors hover:text-text-primary"
      >
        ✕
      </button>
    </div>
  );
}

/**
 * 앱 공통 알림 (브라우저 alert 대체).
 * 우상단에 쌓이고 3초 뒤 스스로 사라진다 — 확인 클릭이 필요 없는 소식용이다.
 */
export default function ToastHost() {
  const toasts = useUiStore((s) => s.toasts);
  if (!toasts.length) return null;

  return (
    <div className="pointer-events-none fixed right-4 top-4 z-[110] flex flex-col gap-2">
      {toasts.map((item) => (
        <Toast key={item.id} item={item} />
      ))}
    </div>
  );
}
