import {
  createContext, useCallback, useContext, useEffect, useMemo, useRef, useState,
  type CSSProperties, type ReactNode,
} from 'react';
import { HugeiconsIcon } from '@hugeicons/react';
import { Alert02Icon, Cancel01Icon, CheckmarkCircle01Icon, InformationCircleIcon } from '@hugeicons/core-free-icons';

export type ToastVariant = 'success' | 'error' | 'warning' | 'info' | 'loading';

export interface ToastOptions {
  description?: string;
  /** Milliseconds before auto-dismiss. Loading toasts never auto-dismiss. */
  duration?: number;
  /** Replaces an existing notification for the same operation. */
  dedupeKey?: string;
  action?: { label: string; onClick: () => void };
}

export interface ToastRecord extends ToastOptions {
  id: string;
  variant: ToastVariant;
  message: string;
  createdAt: number;
}

interface ToastApi {
  show: (variant: ToastVariant, message: string, options?: ToastOptions) => string;
  success: (message: string, options?: ToastOptions) => string;
  error: (message: string, options?: ToastOptions) => string;
  warning: (message: string, options?: ToastOptions) => string;
  info: (message: string, options?: ToastOptions) => string;
  loading: (message: string, options?: ToastOptions) => string;
  update: (id: string, patch: Partial<Omit<ToastRecord, 'id' | 'createdAt'>>) => void;
  dismiss: (id?: string) => void;
}

const DURATIONS: Record<ToastVariant, number> = { success: 4000, info: 5000, warning: 6000, error: 7000, loading: 0 };
const ToastContext = createContext<ToastApi | null>(null);
let sequence = 0;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const timers = useRef(new Map<string, number>());
  const dedupeIds = useRef(new Map<string, string>());

  const clearTimer = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) window.clearTimeout(timer);
    timers.current.delete(id);
  }, []);

  const dismiss = useCallback((id?: string) => {
    if (id === undefined) {
      timers.current.forEach((timer) => window.clearTimeout(timer));
      timers.current.clear();
      dedupeIds.current.clear();
      setToasts([]);
      return;
    }
    clearTimer(id);
    setToasts((current) => {
      const removed = current.find((toast) => toast.id === id);
      if (removed?.dedupeKey) dedupeIds.current.delete(removed.dedupeKey);
      return current.filter((toast) => toast.id !== id);
    });
  }, [clearTimer]);

  const schedule = useCallback((toast: ToastRecord) => {
    clearTimer(toast.id);
    const duration = toast.duration ?? DURATIONS[toast.variant];
    if (duration <= 0) return;
    timers.current.set(toast.id, window.setTimeout(() => dismiss(toast.id), duration));
  }, [clearTimer, dismiss]);

  const show = useCallback((variant: ToastVariant, message: string, options: ToastOptions = {}) => {
    const existingId = options.dedupeKey ? dedupeIds.current.get(options.dedupeKey) : undefined;
    const next: ToastRecord = { id: existingId ?? `toast-${++sequence}`, variant, message, createdAt: Date.now(), ...options };
    if (options.dedupeKey) dedupeIds.current.set(options.dedupeKey, next.id);
    setToasts((current) => {
      if (existingId) {
        schedule(next);
        return current.map((toast) => toast.id === existingId ? next : toast);
      }
      schedule(next);
      return [...current, next].slice(-5);
    });
    return next.id;
  }, [schedule]);

  const update = useCallback((id: string, patch: Partial<Omit<ToastRecord, 'id' | 'createdAt'>>) => {
    setToasts((current) => current.map((toast) => {
      if (toast.id !== id) return toast;
      const changed = { ...toast, ...patch };
      schedule(changed);
      return changed;
    }));
  }, [schedule]);

  useEffect(() => () => {
    timers.current.forEach((timer) => window.clearTimeout(timer));
    timers.current.clear();
  }, []);

  const api = useMemo<ToastApi>(() => ({
    show,
    success: (message, options) => show('success', message, options),
    error: (message, options) => show('error', message, options),
    warning: (message, options) => show('warning', message, options),
    info: (message, options) => show('info', message, options),
    loading: (message, options) => show('loading', message, options),
    update,
    dismiss,
  }), [show, update, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} onPause={clearTimer} onResume={schedule} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within a ToastProvider');
  return context;
}

function ToastViewport({ toasts, onDismiss, onPause, onResume }: {
  toasts: ToastRecord[];
  onDismiss: (id: string) => void;
  onPause: (id: string) => void;
  onResume: (toast: ToastRecord) => void;
}) {
  if (!toasts.length) return null;
  return (
    <div className="toast-viewport" aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast toast-${toast.variant}`}
          role={toast.variant === 'error' ? 'alert' : 'status'}
          onMouseEnter={() => onPause(toast.id)}
          onMouseLeave={() => onResume(toast)}
          onFocus={() => onPause(toast.id)}
          onBlur={() => onResume(toast)}
          style={{ '--toast-duration': `${toast.duration ?? DURATIONS[toast.variant]}ms` } as CSSProperties}
        >
          <span className="toast-icon" aria-hidden="true">
            {toast.variant === 'loading' ? <span className="spinner toast-spinner" /> : <ToastGlyph variant={toast.variant} />}
          </span>
          <div className="toast-body">
            <p className="toast-message">{toast.message}</p>
            {toast.description && <p className="toast-description">{toast.description}</p>}
            {toast.action && <button type="button" className="toast-action" onClick={() => { toast.action?.onClick(); onDismiss(toast.id); }}>{toast.action.label}</button>}
          </div>
          {toast.variant !== 'loading' && (
            <button type="button" className="toast-dismiss" aria-label="Dismiss notification" onClick={() => onDismiss(toast.id)}>
              <HugeiconsIcon icon={Cancel01Icon} size={14} strokeWidth={2} aria-hidden />
            </button>
          )}
          {toast.variant !== 'loading' && <span className="toast-progress" aria-hidden="true" />}
        </div>
      ))}
    </div>
  );
}

function ToastGlyph({ variant }: { variant: ToastVariant }) {
  const source = variant === 'success' ? CheckmarkCircle01Icon : variant === 'error' || variant === 'warning' ? Alert02Icon : InformationCircleIcon;
  return <HugeiconsIcon icon={source} size={14} strokeWidth={2} aria-hidden />;
}
