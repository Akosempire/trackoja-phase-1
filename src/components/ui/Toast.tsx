import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

/**
 * Toasts for every state a request can be in.
 *
 * The reason this exists as one system rather than per-page notices: a save has a
 * beginning, a middle and an end, and the middle is the part pages forget. A
 * `loading` toast is sticky and is resolved in place by `update`, so the merchant
 * sees one message that turns into success or failure instead of nothing happening
 * and then a banner appearing somewhere else.
 *
 * Accessibility: errors announce assertively (role="alert"), everything else
 * politely, and the viewport is a live region so a screen reader hears the outcome.
 */

export type ToastVariant = 'success' | 'error' | 'warning' | 'info' | 'loading';

export interface ToastOptions {
  description?: string;
  /** Milliseconds before auto-dismiss. Loading toasts never auto-dismiss. */
  duration?: number;
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
  /** Sticky until updated, so it can become the outcome of the same operation. */
  loading: (message: string, options?: ToastOptions) => string;
  update: (id: string, patch: Partial<Omit<ToastRecord, 'id' | 'createdAt'>>) => void;
  dismiss: (id?: string) => void;
}

const DURATIONS: Record<ToastVariant, number> = {
  success: 4000,
  info: 5000,
  warning: 6000,
  error: 7000,
  loading: 0, // sticky
};

const ToastContext = createContext<ToastApi | null>(null);

let sequence = 0;
const nextId = () => `toast-${++sequence}`;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastRecord[]>([]);
  const timers = useRef(new Map<string, number>());

  const clearTimer = useCallback((id: string) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const dismiss = useCallback(
    (id?: string) => {
      if (id === undefined) {
        timers.current.forEach((timer) => window.clearTimeout(timer));
        timers.current.clear();
        setToasts([]);
        return;
      }
      clearTimer(id);
      setToasts((current) => current.filter((toast) => toast.id !== id));
    },
    [clearTimer]
  );

  const schedule = useCallback(
    (toast: ToastRecord) => {
      clearTimer(toast.id);
      const duration = toast.duration ?? DURATIONS[toast.variant];
      if (duration <= 0) return;
      timers.current.set(
        toast.id,
        window.setTimeout(() => dismiss(toast.id), duration)
      );
    },
    [clearTimer, dismiss]
  );

  const show = useCallback(
    (variant: ToastVariant, message: string, options: ToastOptions = {}) => {
      const id = nextId();
      const toast: ToastRecord = { id, variant, message, createdAt: Date.now(), ...options };
      setToasts((current) => [...current, toast]);
      schedule(toast);
      return id;
    },
    [schedule]
  );

  /** Resolving a loading toast keeps it in place and restarts the dismiss timer. */
  const update = useCallback(
    (id: string, patch: Partial<Omit<ToastRecord, 'id' | 'createdAt'>>) => {
      setToasts((current) => {
        const next = current.map((toast) => (toast.id === id ? { ...toast, ...patch } : toast));
        const changed = next.find((toast) => toast.id === id);
        if (changed) schedule(changed);
        return next;
      });
    },
    [schedule]
  );

  useEffect(
    () => () => {
      timers.current.forEach((timer) => window.clearTimeout(timer));
      timers.current.clear();
    },
    []
  );

  const api = useMemo<ToastApi>(
    () => ({
      show,
      success: (message, options) => show('success', message, options),
      error: (message, options) => show('error', message, options),
      warning: (message, options) => show('warning', message, options),
      info: (message, options) => show('info', message, options),
      loading: (message, options) => show('loading', message, options),
      update,
      dismiss,
    }),
    [show, update, dismiss]
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within a ToastProvider');
  return context;
}

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: ToastRecord[];
  onDismiss: (id: string) => void;
}) {
  if (toasts.length === 0) return null;

  // One polite live region for the stack, with errors announced assertively so a
  // failure is not queued behind chatter.
  return (
    <div className="toast-viewport" aria-live="polite" aria-atomic="false">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`toast toast-${toast.variant}`}
          role={toast.variant === 'error' ? 'alert' : 'status'}
        >
          <span className="toast-icon" aria-hidden="true">
            {toast.variant === 'loading' ? (
              <span className="spinner toast-spinner" />
            ) : (
              <ToastGlyph variant={toast.variant} />
            )}
          </span>

          <div className="toast-body">
            <p className="toast-message">{toast.message}</p>
            {toast.description && <p className="toast-description">{toast.description}</p>}
          </div>

          {toast.variant !== 'loading' && (
            <button
              type="button"
              className="toast-dismiss"
              aria-label="Dismiss notification"
              onClick={() => onDismiss(toast.id)}
            >
              ×
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

function ToastGlyph({ variant }: { variant: ToastVariant }) {
  const common = {
    width: 14,
    height: 14,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2.2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  };
  if (variant === 'success') return <svg {...common}><path d="M4.5 12.5 9 17l10.5-10.5" /></svg>;
  if (variant === 'error') return <svg {...common}><path d="M6 6l12 12M18 6L6 18" /></svg>;
  if (variant === 'warning') return <svg {...common}><path d="M12 8v5M12 17h.01" /></svg>;
  return <svg {...common}><path d="M12 11v6M12 7h.01" /></svg>;
}
