import { useEffect } from 'react';
import { CircleCheck, CircleX, Info, TriangleAlert, X } from 'lucide-react';
import { useUiStore, type ToastItem, type ToastType } from '../../store/uiStore';
import { ICON, ICON_SM } from '../ui/icon';

/** 자동으로 사라지기까지의 시간 */
const AUTO_DISMISS_MS = 3000;

/**
 * v2.36.0: 이모지(✅❌⚠️ℹ️)·색 테두리 대신 모양이 다른 선 아이콘 + 색. 글은 흰색(색 글자는 아이콘만) — 차분하게.
 */
const STYLE: Record<ToastType, { icon: typeof Info; color: string }> = {
  success: { icon: CircleCheck, color: 'text-bullish' },
  error: { icon: CircleX, color: 'text-bearish' },
  warning: { icon: TriangleAlert, color: 'text-warning' },
  info: { icon: Info, color: 'text-text-secondary' },
};

function Toast({ item }: { item: ToastItem }) {
  const dismiss = useUiStore((s) => s.dismissToast);
  const style = STYLE[item.type];
  const Icon = style.icon;

  useEffect(() => {
    const timer = setTimeout(() => dismiss(item.id), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [item.id, dismiss]);

  return (
    <div
      role="status"
      className="pointer-events-auto flex min-w-[240px] max-w-sm items-start gap-2 rounded-xl bg-bg-elevated px-3 py-2.5 shadow-xl"
    >
      <span className={`mt-px ${style.color}`}>
        <Icon {...ICON} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium text-text-primary">{item.message}</p>
        {item.detail && (
          <p className="mt-0.5 text-[13px] leading-relaxed text-text-secondary">{item.detail}</p>
        )}
      </div>
      <button
        type="button"
        onClick={() => dismiss(item.id)}
        aria-label="닫기"
        className="text-text-muted transition-colors hover:text-text-primary"
      >
        <X {...ICON_SM} />
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
