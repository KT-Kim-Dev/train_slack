import { useCallback, useEffect, useState } from "react";
import type { NotificationNavTarget } from "../notifications";

export interface ToastItem {
  id: number;
  title: string;
  body: string;
  target: NotificationNavTarget;
}

let pushToastFn: ((toast: Omit<ToastItem, "id">) => void) | null = null;

/** ChatPage 외부에서도 토스트를 띄울 수 있게 등록 */
export function registerToastPusher(fn: (toast: Omit<ToastItem, "id">) => void): void {
  pushToastFn = fn;
}

export function pushToast(toast: Omit<ToastItem, "id">): void {
  pushToastFn?.(toast);
}

interface Props {
  onNavigate: (target: NotificationNavTarget) => void;
}

export function ToastStack({ onNavigate }: Props): JSX.Element {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const push = useCallback((toast: Omit<ToastItem, "id">) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev.slice(-4), { ...toast, id }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 6000);
  }, []);

  useEffect(() => {
    registerToastPusher(push);
    return () => {
      registerToastPusher(() => undefined);
    };
  }, [push]);

  if (toasts.length === 0) return <></>;

  return (
    <div className="toast-stack">
      {toasts.map((t) => (
        <button
          key={t.id}
          type="button"
          className="toast-item"
          onClick={() => {
            onNavigate(t.target);
            setToasts((prev) => prev.filter((x) => x.id !== t.id));
          }}
        >
          <div className="toast-title">{t.title}</div>
          <div className="toast-body">{t.body}</div>
        </button>
      ))}
    </div>
  );
}
