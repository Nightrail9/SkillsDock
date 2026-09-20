import { useCallback, useRef, useState } from 'react';
import { AddToastFn, ToastType } from '../types';

export interface ToastItem {
  id: number;
  type: ToastType;
  title: string;
  description?: string;
}

/** 单条 Toast 自动消失时长 */
const AUTO_DISMISS_MS = 5000;
/** 同屏最多保留的 Toast 数（超出丢弃最旧） */
const MAX_TOASTS = 5;

export function useToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast: AddToastFn = useCallback((type, title, description) => {
    const id = nextId.current++;
    setToasts((prev) => [...prev.slice(-(MAX_TOASTS - 1)), { id, type, title, description }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, AUTO_DISMISS_MS);
  }, []);

  return { toasts, addToast, dismissToast };
}
