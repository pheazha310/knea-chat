import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import Icon from '../components/common/Icon';

export type ToastType = 'info' | 'success' | 'mention' | 'message' | 'error';

interface ToastItem {
  id: number;
  type: ToastType;
  title?: string;
  message: string;
}

interface ShowToastOptions {
  type?: ToastType;
  title?: string;
}

interface ToastContextValue {
  showToast: (message: string, options?: ShowToastOptions) => void;
}

const ToastContext = createContext<ToastContextValue>({ showToast: () => {} });

const ICONS: Record<ToastType, React.ReactNode> = {
  info: <Icon name="info" size={16} />,
  success: <Icon name="check" size={16} />,
  mention: <Icon name="user" size={16} />,
  message: <Icon name="message" size={16} />,
  error: <Icon name="alert" size={16} />,
};

const MAX_VISIBLE = 4;
const DURATION_MS = 4500;

export const ToastProvider = ({ children }: { children: React.ReactNode }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback(
    (message: string, options: ShowToastOptions = {}) => {
      const id = ++idRef.current;
      setToasts((prev) => [...prev.slice(-(MAX_VISIBLE - 1)), { id, type: options.type || 'info', title: options.title, message }]);
      setTimeout(() => dismiss(id), DURATION_MS);
    },
    [dismiss],
  );

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="toast-stack" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.type} anim-toast-in`}>
            <span className="toast-icon">{ICONS[toast.type]}</span>
            <div className="toast-body">
              {toast.title && <b>{toast.title}</b>}
              <p>{toast.message}</p>
            </div>
            <button
              className="toast-close"
              onClick={() => dismiss(toast.id)}
              aria-label="Dismiss notification"
            >
              <Icon name="x" size={12} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = () => useContext(ToastContext);
