import { CircleAlert, CircleCheck, LoaderCircle } from 'lucide-react';
import { SegmentedThumb } from './segmented-thumb';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

export function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(' ');
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  pending?: boolean;
};

export function Button({ variant = 'primary', size = 'md', pending, className, children, disabled, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      disabled={disabled || pending}
      className={cx(
        'inline-flex select-none items-center justify-center gap-2 rounded-ui-sm font-medium whitespace-nowrap transition-[background-color,box-shadow,transform] duration-150 active:scale-[0.97]',
        'disabled:cursor-not-allowed disabled:opacity-60',
        size === 'md' ? 'min-h-10 px-4 text-[15px]' : 'min-h-9 px-3 text-sm',
        variant === 'primary' && 'btn-shine bg-brand text-brand-fg shadow-[0_6px_16px_-8px_var(--brand)] hover:bg-brand-strong hover:shadow-[0_10px_22px_-10px_var(--brand)]',
        variant === 'secondary' && 'border border-line-strong bg-surface text-ink hover:bg-surface-2',
        variant === 'ghost' && 'text-muted hover:bg-surface-2 hover:text-ink',
        variant === 'danger' && 'border border-line-strong bg-surface text-danger hover:bg-danger-soft',
        className,
      )}
    >
      {pending && <LoaderCircle aria-hidden className="size-4 animate-spin" />}
      {children}
    </button>
  );
}

const control =
  'w-full rounded-ui-sm border border-line-strong bg-surface px-3 text-[15px] text-ink placeholder:text-muted/70 ' +
  'transition-[border-color,box-shadow] duration-150 hover:border-muted/60 focus:border-brand focus:outline-none focus:ring-4 focus:ring-brand/15 disabled:bg-surface-2 aria-[invalid=true]:border-danger';

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={cx(control, 'min-h-10', className)} />;
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...rest} className={cx(control, 'min-h-24 py-2', className)} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select {...rest} className={cx(control, 'min-h-10 pr-8', className)}>
      {children}
    </select>
  );
}

export function Field({
  label, htmlFor, hint, error, children, className, optional,
}: {
  label: string; htmlFor: string; hint?: ReactNode; error?: string; children: ReactNode; className?: string; optional?: boolean;
}) {
  return (
    <div className={cx('flex min-w-0 flex-col gap-1.5', className)}>
      <label htmlFor={htmlFor} className="text-sm font-medium text-ink">
        {label}
        {optional && <span className="ml-1.5 font-normal text-muted">optional</span>}
      </label>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="text-sm text-danger">
          {error}
        </p>
      ) : hint ? (
        <p className="text-sm text-muted">{hint}</p>
      ) : null}
    </div>
  );
}

/** A labelled on/off control. Uses a real checkbox for keyboard and screen readers. */
export function Toggle({
  id, checked, onChange, label, description,
}: {
  id: string; checked: boolean; onChange: (v: boolean) => void; label: string; description?: string;
}) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-3 py-1">
      <span className="relative mt-0.5 inline-flex shrink-0">
        <input id={id} type="checkbox" className="peer sr-only" checked={checked} onChange={(e) => onChange(e.target.checked)} />
        <span className="h-6 w-10 rounded-full bg-line-strong transition-colors peer-checked:bg-brand peer-focus-visible:ring-2 peer-focus-visible:ring-brand peer-focus-visible:ring-offset-2" />
        <span className="absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow transition-transform peer-checked:translate-x-4" />
      </span>
      <span className="min-w-0">
        <span className="block text-[15px] font-medium text-ink">{label}</span>
        {description && <span className="block text-sm text-muted">{description}</span>}
      </span>
    </label>
  );
}

export function Card({ title, description, children, actions, className }: {
  title?: string; description?: ReactNode; children: ReactNode; actions?: ReactNode; className?: string;
}) {
  return (
    <section className={cx('rounded-ui border border-line bg-surface shadow-card', className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            {title && <h2 className="text-[17px] font-semibold">{title}</h2>}
            {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
          </div>
          {actions}
        </header>
      )}
      <div className="px-5 py-5">{children}</div>
    </section>
  );
}

export function Badge({ tone = 'neutral', children }: { tone?: 'neutral' | 'brand' | 'ok' | 'warn' | 'danger'; children: ReactNode }) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap',
        tone === 'neutral' && 'bg-surface-2 text-muted',
        tone === 'brand' && 'bg-brand-soft text-brand-text',
        tone === 'ok' && 'bg-ok-soft text-ok',
        tone === 'warn' && 'bg-warn-soft text-warn',
        tone === 'danger' && 'bg-danger-soft text-danger',
      )}
    >
      {children}
    </span>
  );
}

export function Notice({ kind, children }: { kind: 'ok' | 'error' | 'info' | 'warn'; children: ReactNode }) {
  const Icon = kind === 'ok' ? CircleCheck : CircleAlert;
  return (
    <div
      role={kind === 'error' ? 'alert' : 'status'}
      className={cx(
        'flex items-start gap-2.5 rounded-ui-sm px-3.5 py-2.5 text-sm',
        kind === 'ok' && 'bg-ok-soft text-ok',
        kind === 'error' && 'bg-danger-soft text-danger',
        kind === 'warn' && 'bg-warn-soft text-warn',
        kind === 'info' && 'bg-brand-soft text-brand-text',
      )}
    >
      <Icon aria-hidden className="mt-px size-4 shrink-0" />
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/** Sticky save bar at the bottom of a settings form. */
export function SaveBar({
  pending, dirty, status, label = 'Save changes', onSave,
}: {
  pending: boolean; dirty: boolean; status: { kind: 'ok' | 'error'; text: string } | null; label?: string; onSave: () => void;
}) {
  return (
    <div className="sticky bottom-0 z-10 -mx-4 mt-6 border-t border-line bg-bg/95 px-4 py-3 backdrop-blur sm:mx-0 sm:rounded-ui sm:border sm:px-5 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 text-sm" aria-live="polite">
          {status ? (
            <span className={status.kind === 'ok' ? 'text-ok' : 'text-danger'}>{status.text}</span>
          ) : dirty ? (
            <span className="text-muted">You have unsaved changes.</span>
          ) : (
            <span className="text-muted">All changes saved.</span>
          )}
        </div>
        <Button type="button" onClick={onSave} pending={pending} disabled={!dirty && !pending}>
          {label}
        </Button>
      </div>
    </div>
  );
}

export function PageHeader({ title, description, actions }: { title: string; description?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold sm:text-[28px]">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-[15px] text-muted">{description}</p>}
      </div>
      {actions}
    </div>
  );
}

/** Pill-style single choice with a sliding highlight. */
export function Segmented<T extends string>({
  id, value, onChange, options, label,
}: {
  id: string; value: T; onChange: (v: T) => void; label: string;
  options: { value: T; label: string; icon?: React.ComponentType<{ className?: string; 'aria-hidden'?: boolean }> }[];
}) {
  return (
    <div role="radiogroup" aria-label={label} id={id} className="inline-flex w-full flex-wrap gap-1 rounded-ui bg-surface-2 p-1 sm:w-auto">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cx(
              'relative flex min-h-9 flex-1 items-center justify-center gap-2 rounded-ui-sm px-3.5 text-sm font-medium transition-colors sm:flex-none',
              active ? 'text-ink' : 'text-muted hover:text-ink',
            )}
          >
            {active && (
              <SegmentedThumb layoutId={`${id}-thumb`} />
            )}
            {o.icon && <o.icon aria-hidden className="relative size-4" />}
            <span className="relative">{o.label}</span>
          </button>
        );
      })}
    </div>
  );
}
