'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Info, TriangleAlert, X } from 'lucide-react';

import { useI18n } from '@/i18n/provider';

export type ToastKind = 'info' | 'error';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastOptions {
  /** A notice with the same id replaces the earlier one instead of piling up. */
  id?: string;
  kind?: ToastKind;
  message: string;
  action?: ToastAction;
  /** How long it stays, in ms. 0 keeps it until it is dismissed. Errors stay by default. */
  durationMs?: number;
}

interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
  action?: ToastAction;
  durationMs: number;
}

interface ToastApi {
  notify: (options: ToastOptions) => string;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

/** Errors are not timed: reading them should never be a race. */
const DEFAULT_DURATION_MS: Record<ToastKind, number> = { info: 8000, error: 0 };
const MAX_VISIBLE = 3;

interface ToastViewProps {
  toast: Toast;
  onDismiss: (id: string) => void;
}

function ToastView({ toast, onDismiss }: ToastViewProps): React.JSX.Element {
  const { t } = useI18n();
  // Hovering or focusing a notice stops its countdown, so there is time to read it and reach its button
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused || toast.durationMs <= 0) return;
    const timer = window.setTimeout(() => onDismiss(toast.id), toast.durationMs);
    return () => window.clearTimeout(timer);
  }, [paused, toast, onDismiss]);

  const isError = toast.kind === 'error';
  const Icon = isError ? TriangleAlert : Info;

  return (
    <div
      role={isError ? 'alert' : 'status'}
      data-testid="toast"
      data-kind={toast.kind}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
      // The icon and the border carry the kind besides color
      className={`pointer-events-auto flex items-start gap-3 border border-ink border-l-4 bg-sheet py-3 pl-3 pr-2 text-sm text-ink ${
        isError ? 'border-l-err' : 'border-l-accent'
      }`}
    >
      <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${isError ? 'text-err' : 'text-accent'}`} aria-hidden="true" />
      <p className="min-w-0 flex-1 break-words">{toast.message}</p>
      {toast.action && (
        <button
          type="button"
          onClick={() => {
            toast.action?.onClick();
            onDismiss(toast.id);
          }}
          className="min-h-9 shrink-0 px-1 font-semibold text-accent underline underline-offset-2 lg:min-h-0"
        >
          {toast.action.label}
        </button>
      )}
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        aria-label={t('toast.dismiss')}
        className="shrink-0 p-2 text-ink-2 hover:bg-select hover:text-ink lg:p-1"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

/**
 * Notices shown inside the page, in place of the browser's alert() and confirm(). Those block the
 * whole page, cannot be styled or translated by the page's own fonts, look different in every
 * browser, and on a phone they take over the screen. These do not take focus, are announced to
 * screen readers, and can offer an action (such as Undo).
 */
export function ToastProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { t } = useI18n();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counterRef = useRef(0);

  const dismiss = useCallback((id: string): void => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const notify = useCallback((options: ToastOptions): string => {
    counterRef.current += 1;
    const kind = options.kind ?? 'info';
    const toast: Toast = {
      id: options.id ?? `toast-${counterRef.current}`,
      kind,
      message: options.message,
      action: options.action,
      durationMs: options.durationMs ?? DEFAULT_DURATION_MS[kind],
    };
    setToasts((current) => {
      const index = current.findIndex((existing) => existing.id === toast.id);
      const next = index >= 0 ? current.map((existing, i) => (i === index ? toast : existing)) : [...current, toast];
      return next.slice(-MAX_VISIBLE);
    });
    return toast.id;
  }, []);

  const api = useMemo<ToastApi>(() => ({ notify, dismiss }), [notify, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* Always present, so that screen readers announce what is added to it. On a phone it sits above the tab bar. */}
      <div
        role="region"
        aria-live="polite"
        aria-label={t('toast.region')}
        data-testid="toasts"
        className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom,0px)+4.5rem)] z-40 mx-auto flex w-[calc(100%-1.5rem)] max-w-xl flex-col gap-2 lg:bottom-6"
      >
        {toasts.map((toast) => (
          <ToastView key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast must be used inside <ToastProvider>');
  return api;
}
