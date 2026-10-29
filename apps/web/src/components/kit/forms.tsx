'use client';

import Link from 'next/link';
import { Check } from 'lucide-react';
import { useId, useRef, type InputHTMLAttributes, type KeyboardEvent, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { cx } from './core';

export const controlClass = cx(
  'h-10 w-full rounded-[var(--radius-control)] border border-control bg-surface px-3 text-sm text-fg placeholder:text-fg-3',
  'transition-[border-color,box-shadow] duration-150 focus:border-accent focus:shadow-[0_0_0_4px_var(--accent-soft)] focus:outline-none',
  'disabled:cursor-not-allowed disabled:bg-sunken disabled:text-fg-3 aria-[invalid=true]:border-danger aria-[invalid=true]:shadow-[0_0_0_4px_rgb(194_39_45/0.12)]',
  'max-sm:h-11',
);

export function Field({
  label, hint, error, htmlFor, children, className, optional, labelAction,
}: { label: ReactNode; hint?: ReactNode; error?: string; htmlFor?: string; children: ReactNode; className?: string; optional?: boolean; labelAction?: ReactNode }) {
  return (
    <div className={cx('flex min-w-0 flex-col gap-1.5', className)}>
      <div className="flex items-center justify-between gap-2">
        <label htmlFor={htmlFor} className="text-[13px] font-semibold text-fg">
          {label}
          {optional && <span className="ml-1 font-normal text-fg-2">(optional)</span>}
        </label>
        {labelAction}
      </div>
      {children}
      {error ? (
        <p id={htmlFor ? `${htmlFor}-error` : undefined} className="anim-fade text-xs font-medium text-danger" role="alert">{error}</p>
      ) : hint ? (
        <p id={htmlFor ? `${htmlFor}-hint` : undefined} className="text-xs text-fg-2">{hint}</p>
      ) : null}
    </div>
  );
}

type InputProps = InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean; mono?: boolean };

export function Input({ className, invalid, mono, ...rest }: InputProps) {
  return <input aria-invalid={invalid || undefined} className={cx(controlClass, mono && 'mono', className)} {...rest} />;
}

/** Input with a fixed prefix/suffix (".tentpole.app", "mi", "$"). */
export function AffixInput({ prefix, suffix, className, invalid, mono, ...rest }: InputProps & { prefix?: ReactNode; suffix?: ReactNode }) {
  return (
    <div
      className={cx(
        'flex h-10 w-full items-stretch overflow-hidden rounded-[var(--radius-control)] border border-control bg-surface transition-[border-color,box-shadow] duration-150',
        'focus-within:border-accent focus-within:shadow-[0_0_0_4px_var(--accent-soft)] max-sm:h-11',
        invalid && 'border-danger',
        className,
      )}
    >
      {prefix && <span className="flex shrink-0 items-center border-r border-subtle bg-sunken px-3 text-[13px] text-fg-2">{prefix}</span>}
      <input aria-invalid={invalid || undefined} className={cx('min-w-0 flex-1 bg-transparent px-3 text-sm text-fg placeholder:text-fg-3 focus:outline-none', mono && 'mono')} {...rest} />
      {suffix && <span className="mono flex shrink-0 items-center border-l border-subtle bg-sunken px-3 text-[13px] text-fg-2">{suffix}</span>}
    </div>
  );
}

export function Textarea({ className, invalid, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }) {
  return <textarea aria-invalid={invalid || undefined} className={cx(controlClass, 'h-auto min-h-24 py-2.5 leading-relaxed', className)} {...rest} />;
}

export function Select({ className, children, invalid, ...rest }: SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }) {
  return (
    <select
      aria-invalid={invalid || undefined}
      className={cx(
        controlClass,
        'cursor-pointer appearance-none bg-[length:16px] bg-[right_10px_center] bg-no-repeat pr-9',
        "bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23535C6B' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")]",
        className,
      )}
      {...rest}
    >
      {children}
    </select>
  );
}

/** Arrow keys move between options in a radio group (WAI-ARIA radio pattern). */
function useRovingKeys<T>(values: readonly T[], value: T, onChange: (v: T) => void) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKeyDown = (e: KeyboardEvent) => {
    const i = values.indexOf(value);
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = (i + step + values.length) % values.length;
    onChange(values[next]!);
    refs.current[next]?.focus();
  };
  return { refs, onKeyDown };
}

export function Segmented<T extends string>({
  options, value, onChange, label, className, size = 'md', fill,
}: { options: readonly { value: T; label: ReactNode }[]; value: T; onChange: (v: T) => void; label: string; className?: string; size?: 'sm' | 'md'; fill?: boolean }) {
  const { refs, onKeyDown } = useRovingKeys(options.map((o) => o.value), value, onChange);
  return (
    <div role="radiogroup" aria-label={label} onKeyDown={onKeyDown} className={cx('inline-flex max-w-full gap-1 rounded-[calc(var(--radius-control)+2px)] bg-sunken p-1', fill && 'flex w-full', className)}>
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(o.value)}
            className={cx(
              'min-w-0 flex-1 whitespace-nowrap rounded-[var(--radius-control)] px-2.5 font-semibold transition-[background-color,color,box-shadow] duration-200',
              size === 'sm' ? 'h-7 text-xs' : 'h-8 text-[13px] max-sm:h-10',
              on ? 'bg-surface text-fg shadow-[0_1px_3px_rgb(16_19_26/0.15)]' : 'text-fg-2 hover:text-fg',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Toggle({ checked, onChange, label, sub, disabled, id }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; sub?: ReactNode; disabled?: boolean; id?: string }) {
  const auto = useId();
  const tid = id ?? auto;
  const sw = (
    <button
      id={tid}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx('relative h-6 w-10 shrink-0 rounded-full transition-colors duration-200 disabled:opacity-50', checked ? 'bg-accent' : 'bg-[#C5CAD3] dark:bg-control')}
    >
      <span className={cx('absolute top-[3px] size-[18px] rounded-full bg-white shadow-[0_1px_3px_rgb(0_0_0/0.25)] transition-[left] duration-250 ease-[var(--ease-pop)]', checked ? 'left-[19px]' : 'left-[3px]')} />
      {!label && <span className="sr-only">Toggle</span>}
    </button>
  );
  if (!label) return sw;
  return (
    <div className="flex items-start gap-3">
      {sw}
      <label htmlFor={tid} className="cursor-pointer select-none">
        <span className="block text-sm font-semibold text-fg">{label}</span>
        {sub && <span className="mt-0.5 block text-[13px] text-fg-2">{sub}</span>}
      </label>
    </div>
  );
}

export function Checkbox({ checked, onChange, children, id, invalid }: { checked: boolean; onChange: (v: boolean) => void; children: ReactNode; id?: string; invalid?: boolean }) {
  const auto = useId();
  const cid = id ?? auto;
  return (
    <label htmlFor={cid} className="flex cursor-pointer items-start gap-2.5 text-sm text-fg-2">
      <span className="relative mt-0.5 grid size-[18px] shrink-0 place-items-center">
        <input
          id={cid}
          type="checkbox"
          checked={checked}
          aria-invalid={invalid || undefined}
          onChange={(e) => onChange(e.target.checked)}
          className={cx('peer size-[18px] cursor-pointer appearance-none rounded-[5px] border border-control bg-surface transition-colors checked:border-accent checked:bg-accent', invalid && 'border-danger')}
        />
        <Check className="pointer-events-none absolute size-3 text-on-accent opacity-0 peer-checked:opacity-100" strokeWidth={3} aria-hidden="true" />
      </span>
      <span>{children}</span>
    </label>
  );
}

/** Choice cards (mail server, payments, plans): role="radio" + aria-checked. */
export function RadioCards<T extends string>({
  options, value, onChange, label, columns = 2,
}: { options: readonly { value: T; label: ReactNode; sub?: ReactNode; extra?: ReactNode }[]; value: T; onChange: (v: T) => void; label: string; columns?: 1 | 2 | 3 }) {
  const { refs, onKeyDown } = useRovingKeys(options.map((o) => o.value), value, onChange);
  const cols = columns === 3 ? 'sm:grid-cols-3' : columns === 2 ? 'sm:grid-cols-2' : '';
  return (
    <div role="radiogroup" aria-label={label} onKeyDown={onKeyDown} className={cx('grid gap-3', cols)}>
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => { refs.current[i] = el; }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(o.value)}
            className={cx(
              'press relative flex flex-col items-start gap-1 rounded-[var(--radius-card)] border p-4 text-left transition-[border-color,background-color,box-shadow] duration-200',
              on ? 'border-accent bg-accent-soft/40 shadow-[0_0_0_1px_var(--accent)]' : 'border-subtle bg-surface hover:border-control',
            )}
          >
            <span className="flex w-full items-center justify-between gap-2">
              <span className="text-sm font-semibold text-fg">{o.label}</span>
              <span className={cx('grid size-[18px] shrink-0 place-items-center rounded-full border transition-colors', on ? 'border-accent bg-accent' : 'border-control')}>
                {on && <span className="anim-pop size-1.5 rounded-full bg-on-accent" />}
              </span>
            </span>
            {o.sub && <span className="text-[13px] text-fg-2">{o.sub}</span>}
            {o.extra}
          </button>
        );
      })}
    </div>
  );
}

export function Slider({ value, onChange, min, max, step = 1, label, display, id }: { value: number; onChange: (v: number) => void; min: number; max: number; step?: number; label: string; display?: ReactNode; id?: string }) {
  const fill = ((value - min) / (max - min)) * 100;
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="text-[13px] font-semibold text-fg">{label}</label>
        <span className="mono text-xs text-fg-2">{display ?? value}</span>
      </div>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="range" style={{ ['--fill' as string]: `${fill}%` }} />
    </div>
  );
}

/** Text tabs with a 2 px accent underline. Pass href for route tabs, or onSelect for in-page tabs. */
export function Tabs<T extends string>({
  tabs, value, onSelect, label, className,
}: { tabs: readonly { value: T; label: ReactNode; href?: string; badge?: ReactNode }[]; value: T; onSelect?: (v: T) => void; label: string; className?: string }) {
  return (
    <div role="tablist" aria-label={label} className={cx('no-scrollbar -mx-[var(--gutter)] flex gap-1 overflow-x-auto border-b border-subtle px-[var(--gutter)] sm:mx-0 sm:px-0', className)}>
      {tabs.map((t) => {
        const on = t.value === value;
        const cls = cx(
          'relative flex h-11 shrink-0 items-center gap-2 px-2.5 text-sm font-semibold transition-colors',
          on ? 'text-fg' : 'text-fg-2 hover:text-fg',
        );
        const bar = <span className={cx('absolute inset-x-1.5 -bottom-px h-0.5 origin-left rounded-full bg-accent transition-transform duration-300 ease-[var(--ease-out)]', on ? 'scale-x-100' : 'scale-x-0')} />;
        return t.href ? (
          <Link key={t.value} href={t.href} role="tab" aria-selected={on} className={cls} scroll={false}>
            {t.label}
            {t.badge}
            {bar}
          </Link>
        ) : (
          <button key={t.value} type="button" role="tab" aria-selected={on} onClick={() => onSelect?.(t.value)} className={cls}>
            {t.label}
            {t.badge}
            {bar}
          </button>
        );
      })}
    </div>
  );
}

/** Filter chips with counts: aria-pressed, selected is ink. */
export function FilterChips<T extends string>({
  chips, value, onChange, label, variant = 'pill',
}: { chips: readonly { value: T; label: ReactNode; count?: number; href?: string }[]; value: T; onChange?: (v: T) => void; label: string; variant?: 'pill' | 'segmented' }) {
  const seg = variant === 'segmented';
  return (
    <div role="group" aria-label={label} className={cx('no-scrollbar flex max-w-full gap-1.5 overflow-x-auto', seg && 'rounded-[calc(var(--radius-control)+2px)] bg-sunken p-1')}>
      {chips.map((c) => {
        const on = c.value === value;
        const cls = cx(
          'press inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap px-3 text-[13px] font-semibold transition-colors duration-200',
          seg
            ? cx('rounded-[var(--radius-control)]', on ? 'bg-surface text-fg shadow-[0_1px_3px_rgb(16_19_26/0.15)]' : 'text-fg-2 hover:text-fg')
            : cx('rounded-full border', on ? 'border-night bg-night text-white dark:border-fg dark:bg-fg dark:text-night' : 'border-control bg-surface text-fg hover:border-fg-3'),
        );
        const inner = (
          <>
            {c.label}
            {c.count !== undefined && <span className="mono text-[11px] opacity-70">{c.count}</span>}
          </>
        );
        return c.href ? (
          <Link key={c.value} href={c.href} aria-pressed={on} className={cls} scroll={false}>{inner}</Link>
        ) : (
          <button key={c.value} type="button" aria-pressed={on} onClick={() => onChange?.(c.value)} className={cls}>{inner}</button>
        );
      })}
    </div>
  );
}
