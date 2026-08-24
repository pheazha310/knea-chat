import React, { createContext, useCallback, useContext, useState, useRef } from 'react';
import Icon from './Icon';

type ToastType = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  type: ToastType;
  message: string;
  removing?: boolean;
}

interface ToastContextValue {
  showToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextValue>({ showToast: () => {} });

let toastId = 0;

/** Provider that renders the toast stack and exposes `showToast`. */
export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());

  const removeToast = useCallback((id: number) => {
    setToasts((prev) => prev.map((t) => (t.id === id ? { ...t, removing: true } : t)));
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
      timers.current.delete(id);
    }, 200);
  }, []);

  const showToast = useCallback(
    (message: string, type: ToastType = 'info') => {
      const id = ++toastId;
      setToasts((prev) => [...prev.slice(-4), { id, type, message }]);
      const timer = setTimeout(() => removeToast(id), 4000);
      timers.current.set(id, timer);
    },
    [removeToast],
  );

  const iconFor = (type: ToastType) => {
    switch (type) {
      case 'success':
        return '✓';
      case 'error':
        return '✕';
      default:
        return 'i';
    }
  };

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="toast-container" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`toast toast-${t.type} ${t.removing ? 'removing' : ''}`}
          >
            <span className="toast-icon">{iconFor(t.type)}</span>
            <span className="toast-message">{t.message}</span>
            <button
              className="toast-close"
              onClick={() => removeToast(t.id)}
              aria-label="Dismiss notification"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

/** Hook to trigger toast notifications from any component. */
export const useToast = () => useContext(ToastContext);
