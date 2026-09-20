import React from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { ToastType } from '../types';
import { ToastItem } from '../hooks/useToast';

interface ToastContainerProps {
  toasts: ToastItem[];
  onDismiss: (id: number) => void;
}

const TOAST_ICON: Record<ToastType, React.ReactNode> = {
  success: <CheckCircle2 className="w-4 h-4 text-emerald-500" />,
  info: <Info className="w-4 h-4 text-indigo-500" />,
  warning: <AlertTriangle className="w-4 h-4 text-amber-500" />,
  error: <XCircle className="w-4 h-4 text-rose-500" />,
};

/** 页面顶部中间的浮动通知。按产品要求只展示错误类信息
 * （成功/提示类不弹窗，避免干扰；AI 工具启停等状态变更不再弹提示）。 */
export const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onDismiss }) => {
  const errorToasts = toasts.filter((toast) => toast.type === 'error');
  if (errorToasts.length === 0) return null;

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[100] flex flex-col gap-2 w-84 max-w-[calc(100vw-2rem)] pointer-events-none select-none">
      {errorToasts.map((toast) => (
        <div
          key={toast.id}
          role="alert"
          className="toast-enter pointer-events-auto bg-white rounded-xl shadow-lg border border-slate-200/90 px-3.5 py-3 flex items-start gap-2.5"
        >
          <div className="mt-0.5 shrink-0">{TOAST_ICON[toast.type]}</div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-semibold text-slate-800">{toast.title}</div>
            {toast.description && (
              <div className="text-[11px] leading-relaxed text-slate-500 mt-0.5 whitespace-pre-wrap break-words">
                {toast.description}
              </div>
            )}
          </div>
          <button
            onClick={() => onDismiss(toast.id)}
            className="shrink-0 mt-0.5 text-slate-300 hover:text-slate-500 transition-colors"
            aria-label="关闭通知"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
};
