'use client';

import { X } from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { cx } from './core';

/**
 * Drawer and modal on the native <dialog> element: the browser gives focus
 * trapping, Esc to close, an inert background and focus return for free.
 */
function useDialog(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<Element | null>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      opener.current = document.activeElement;
      d.showModal();
      document.documentElement.style.overflow = 'hidden';
    } else if (!open && d.open) {
      d.close();
    }
    return () => {
      document.documentElement.style.overflow = '';
    };
  }, [open]);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    const onCancel = (e: Event) => {
      e.preventDefault();
      onClose();
    };
    const onClosed = () => {
      document.documentElement.style.overflow = '';
      (opener.current as HTMLElement | null)?.focus?.();
    };
    d.addEventListener('cancel', onCancel);
    d.addEventListener('close', onClosed);
    return () => {
      d.removeEventListener('cancel', onCancel);
      d.removeEventListener('close', onClosed);
    };
  }, [onClose]);
  return ref;
}

type PanelProps = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  sub?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  width?: number;
};

export function Drawer({ open, onClose, title, sub, children, footer, width = 480 }: PanelProps) {
  const ref = useDialog(open, onClose);
  const titleId = useId();
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      className="m-0 ml-auto h-dvh max-h-dvh w-full max-w-none bg-transparent p-0 backdrop:bg-[var(--scrim)] open:flex"
      style={{ maxWidth: `min(${width}px, 100%)` }}
    >
      {open && (
        <div className="anim-slide flex h-full w-full flex-col bg-surface shadow-[var(--shadow-float)]">
          <header className="flex items-start justify-between gap-3 border-b border-subtle px-5 py-4 sm:px-6">
            <div className="min-w-0">
              <h2 id={titleId} className="font-display text-xl font-bold tracking-tight text-fg">{title}</h2>
              {sub && <p className="mt-1 text-[13px] text-fg-2">{sub}</p>}
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="press -mr-1 grid size-9 shrink-0 place-items-center rounded-[var(--radius-control)] text-fg-2 hover:bg-sunken hover:text-fg">
              <X className="size-5" />
            </button>
          </header>
          <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-5 sm:px-6">{children}</div>
          {footer && <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-subtle bg-sunken/60 px-5 py-3.5 pb-[max(0.875rem,env(safe-area-inset-bottom))] sm:px-6">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}

/** A sheet that rises from the bottom (phone first): the coach's checklist phases. Wide screens get a centred panel. */
export function Sheet({ open, onClose, title, sub, children, footer, width = 560 }: PanelProps) {
  const ref = useDialog(open, onClose);
  const titleId = useId();
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      className="m-0 mt-auto max-h-dvh w-full max-w-none bg-transparent p-0 backdrop:bg-[var(--scrim)] open:flex sm:m-auto sm:w-[calc(100%-32px)]"
      style={{ maxWidth: `min(${width}px, 100%)` }}
    >
      {open && (
        <div className="anim-sheet flex max-h-[92dvh] w-full flex-col rounded-t-[var(--radius-panel)] bg-surface shadow-[var(--shadow-float)] sm:rounded-[var(--radius-panel)]">
          <div className="mx-auto mt-2.5 h-1.5 w-10 shrink-0 rounded-full bg-strong/30 sm:hidden" aria-hidden="true" />
          <header className="flex items-start justify-between gap-3 px-5 pb-3 pt-3 sm:px-6 sm:pt-5">
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="font-display text-lg font-bold tracking-tight text-fg sm:text-xl">{title}</h2>
              {sub && <div className="mt-1 text-[13px] text-fg-2">{sub}</div>}
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="press -mr-1 grid size-9 shrink-0 place-items-center rounded-[var(--radius-control)] text-fg-2 hover:bg-sunken hover:text-fg">
              <X className="size-5" />
            </button>
          </header>
          <div className="flex-1 overflow-y-auto overscroll-contain px-5 pb-5 sm:px-6">{children}</div>
          {footer && <footer className="border-t border-subtle bg-surface px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}

export function Modal({ open, onClose, title, sub, children, footer, width = 520 }: PanelProps) {
  const ref = useDialog(open, onClose);
  const titleId = useId();
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
      className="m-auto w-[calc(100%-32px)] bg-transparent p-0 backdrop:bg-[var(--scrim)]"
      style={{ maxWidth: width }}
    >
      {open && (
        <div className="anim-modal overflow-hidden rounded-[var(--radius-panel)] bg-surface shadow-[var(--shadow-float)]">
          <header className="flex items-start justify-between gap-3 px-6 pt-5">
            <div className="min-w-0">
              <h2 id={titleId} className="font-display text-xl font-bold tracking-tight text-fg">{title}</h2>
              {sub && <p className="mt-1 text-[13px] text-fg-2">{sub}</p>}
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="press -mr-2 grid size-9 shrink-0 place-items-center rounded-[var(--radius-control)] text-fg-2 hover:bg-sunken hover:text-fg">
              <X className="size-5" />
            </button>
          </header>
          <div className="px-6 py-4">{children}</div>
          {footer && <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-subtle bg-sunken/60 px-6 py-3.5">{footer}</footer>}
        </div>
      )}
    </dialog>
  );
}

// --- Toast: one at a time, 3 s, bottom centre (top on phones) -----------------------------

type ToastMsg = { id: number; text: ReactNode; kind: 'ok' | 'error' | 'info' };
const ToastContext = createContext<(text: ReactNode, kind?: ToastMsg['kind']) => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [msg, setMsg] = useState<ToastMsg | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const show = useCallback((text: ReactNode, kind: ToastMsg['kind'] = 'ok') => {
    if (timer.current) clearTimeout(timer.current);
    setMsg({ id: Date.now(), text, kind });
    timer.current = setTimeout(() => setMsg(null), kind === 'error' ? 5000 : 3000);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 top-[max(12px,env(safe-area-inset-top))] z-[100] flex justify-center px-4 sm:top-auto sm:bottom-6" role="status" aria-live="polite">
        {msg && (
          <div key={msg.id} className="anim-toast pointer-events-none flex max-w-md items-center gap-3 rounded-[14px] bg-night px-4 py-3 text-sm font-medium text-white shadow-[var(--shadow-float)]">
            <span
              className={cx('grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-bold', msg.kind === 'error' ? 'bg-danger' : msg.kind === 'info' ? 'bg-accent' : 'bg-volt text-night')}
              aria-hidden="true"
            >
              {msg.kind === 'error' ? '!' : msg.kind === 'info' ? 'i' : '✓'}
            </span>
            <span>{msg.text}</span>
          </div>
        )}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
