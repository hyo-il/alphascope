import { useEffect } from 'react';
import { CircleCheck, CircleX, Info, TriangleAlert, X } from 'lucide-react';
import { useUiStore, type ToastItem, type ToastType } from '../../store/uiStore';
import { ICON, ICON_SM } from '../ui/icon';
import { useClockStore, type ClockBox } from '../../hooks/useClockSetting';

/** 자동으로 사라지기까지의 시간 */
const AUTO_DISMISS_MS = 3000;

/**
 * 이모지·색 테두리 대신 모양이 다른 선 아이콘 + 색. 글은 흰색(색 글자는 아이콘만) — 차분하게.
 */
const STYLE: Record<ToastType, { icon: typeof Info; color: string }> = {
  success: { icon: CircleCheck, color: 'text-bullish' },
  error: { icon: CircleX, color: 'text-danger' },
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
          <p className="mt-0.5 text-caption leading-relaxed text-text-secondary">{item.detail}</p>
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
/** 토스트 묶음 기본 자리(오른쪽 위 16px) · 시계 아래로 내릴 때 띄우는 틈 · 묶음 최대 폭(max-w-sm) */
const TOAST_EDGE = 16;
const TOAST_GAP_BELOW_CLOCK = 8;
const TOAST_MAX_W = 384;
/** 한 번에 보이는 토스트 수 — 높이 900 창에서도 화면 안에 들어간다 */
const TOAST_MAX_SHOWN = 5;

/**
 * 토스트 묶음의 위 끝(px) — 시계(`useClockStore.box`)가 묶음 자리(오른쪽 끝에서 최대 폭만큼 · 화면 위쪽 절반)와 겹치면 **시계 아래 끝 + 8px**,
 * 아니면 16px. 겹침 순서(토스트 110 · 시계 30)는 그대로 — 자리만 옮겨 서로 가리지 않게.
 */
export function toastTop(box: ClockBox | null, vw: number, vh: number): number {
  if (!box) return TOAST_EDGE;
  const colLeft = vw - TOAST_EDGE - TOAST_MAX_W;
  const overlapsX = box.left + box.width > colLeft && box.left < vw - TOAST_EDGE;
  const upper = box.top + box.height / 2 < vh / 2;
  return overlapsX && upper ? Math.max(TOAST_EDGE, box.top + box.height + TOAST_GAP_BELOW_CLOCK) : TOAST_EDGE;
}

export default function ToastHost() {
  const toasts = useUiStore((s) => s.toasts);
  const clockBox = useClockStore((s) => s.box);
  if (!toasts.length) return null;
  const top = toastTop(clockBox, window.innerWidth, window.innerHeight);
  // 최근 것만(새 토스트는 끝에 붙는다 — 넘치면 가장 새 것이 가려진 채 사라졌다)
  const shown = toasts.slice(-TOAST_MAX_SHOWN);

  return (
    // 화면 밖으로 나가지 않게 — 위 끝을 내린 만큼 높이를 줄이고 넘치는 토스트는 가린다(3초 뒤 사라진다).
    // 묶음 안쪽 여백 16px(p-4) 만큼 바깥 자리를 되돌린다 — 여백이 없으면 가리기(overflow-hidden)가 토스트 그림자까지 잘랐다
    <div
      className="pointer-events-none fixed right-0 z-[110] flex flex-col gap-2 overflow-hidden p-4"
      style={{ top: top - TOAST_EDGE, maxHeight: `calc(100vh - ${top}px)` }}
      data-toast-host
    >
      {shown.map((item) => (
        <Toast key={item.id} item={item} />
      ))}
    </div>
  );
}
