'use client';

import { useEffect, useState } from 'react';
import { cx, Input } from './ui';

export function currencySymbol(currency: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency }).formatToParts(0).find((p) => p.type === 'currency')?.value ?? currency;
}

export function useMoneyFormat(currency: string) {
  const f = new Intl.NumberFormat('en-US', { style: 'currency', currency });
  return (cents: number) => f.format(cents / 100);
}

/**
 * Decimal money input that keeps what is typed ("12.", "0.5") and reports a
 * number (dollars) once it parses, or null when empty.
 */
export function MoneyInput({
  id, value, onChange, currency, invalid, placeholder, suffix, className, ariaLabel,
}: {
  id: string; value: number | null | undefined; onChange: (v: number | null) => void; currency?: string;
  invalid?: boolean; placeholder?: string; suffix?: string; className?: string; ariaLabel?: string;
}) {
  const [text, setText] = useState(value == null ? '' : String(value));
  useEffect(() => {
    setText((cur) => (cur.trim() !== '' && Number(cur) === value ? cur : value == null ? '' : String(value)));
  }, [value]);
  return (
    <div className={cx('flex items-stretch', className)}>
      {currency && (
        <span className="grid place-items-center rounded-l-ui-sm border border-r-0 border-line-strong bg-surface-2 px-3 text-sm text-muted">{currencySymbol(currency)}</span>
      )}
      <Input
        id={id}
        inputMode="decimal"
        value={text}
        placeholder={placeholder}
        aria-invalid={invalid}
        aria-label={ariaLabel}
        className={cx('tabular', currency && 'rounded-l-none', suffix && 'rounded-r-none')}
        onChange={(e) => {
          const raw = e.target.value.replace(/[^0-9.]/g, '');
          setText(raw);
          if (raw === '') onChange(null);
          else if (/^\d*\.?\d*$/.test(raw) && raw !== '.') onChange(Number(raw));
        }}
      />
      {suffix && <span className="grid place-items-center rounded-r-ui-sm border border-l-0 border-line-strong bg-surface-2 px-3 text-sm whitespace-nowrap text-muted">{suffix}</span>}
    </div>
  );
}

/** − 1 + stepper for quantities. */
export function Stepper({ id, value, onChange, min = 0, max = 9999, label }: { id: string; value: number; onChange: (n: number) => void; min?: number; max?: number; label: string }) {
  return (
    <div className="inline-flex items-stretch overflow-hidden rounded-ui-sm border border-line-strong bg-surface">
      <button type="button" aria-label={`Fewer ${label}`} disabled={value <= min} onClick={() => onChange(Math.max(min, value - 1))}
        className="grid w-9 place-items-center text-lg text-muted hover:bg-surface-2 disabled:opacity-40">−</button>
      <input id={id} aria-label={label} inputMode="numeric" value={value}
        onChange={(e) => { const n = Number(e.target.value.replace(/\D/g, '')); if (!Number.isNaN(n)) onChange(Math.min(max, Math.max(min, n))); }}
        className="w-12 border-x border-line bg-transparent text-center text-[15px] font-semibold tabular focus:outline-none" />
      <button type="button" aria-label={`More ${label}`} disabled={value >= max} onClick={() => onChange(Math.min(max, value + 1))}
        className="grid w-9 place-items-center text-lg text-muted hover:bg-surface-2 disabled:opacity-40">+</button>
    </div>
  );
}
